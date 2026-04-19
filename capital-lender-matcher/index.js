/**
 * capital-lender-matcher
 * Runs weekly Monday at 8:00 AM UTC
 * Re-matches all active clients against lender database using Claude AI
 * Saves matches to lender_matches table, emails clients with top matches
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSupabase, logRun } from "../shared/supabase.js";
import { sendEmail } from "../shared/resend.js";
import { alertError, sendTelegram } from "../shared/telegram.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function matchClientToLenders(profile, fundingProfile, lenders) {
  const prompt = `You are an expert business financing specialist. Analyze this client profile and determine which lenders are the best fit.

CLIENT PROFILE:
- Business: ${profile.business_name} (${profile.business_type})
- Industry: ${profile.industry}
- State: ${profile.state}
- Years in Business: ${profile.years_in_business}
- Annual Revenue: $${profile.annual_revenue?.toLocaleString() || 0}
- Credit Score Range: ${profile.credit_score_range}
- Funding Goal: ${profile.funding_goal}
- Funding Amount Needed: $${fundingProfile?.funding_amount_needed?.toLocaleString() || 0}
- Funding Purpose: ${fundingProfile?.funding_purpose || "general"}
- Real Estate Investor: ${fundingProfile?.real_estate_investor ? "Yes" : "No"}
- Funding Types Interested In: ${fundingProfile?.funding_types?.join(", ") || "loans"}

AVAILABLE LENDERS (${lenders.length} total):
${lenders.slice(0, 30).map((l, i) =>
  `${i + 1}. ${l.name} | Type: ${l.lender_type} | Min: $${l.min_loan?.toLocaleString()} - Max: $${l.max_loan?.toLocaleString()} | Min Credit: ${l.min_credit_score} | Min Revenue: $${l.min_annual_revenue?.toLocaleString()} | Min Years: ${l.min_years_in_business} | Industries: ${l.industries?.join(", ")} | States: ${l.states?.join(", ")}`
).join("\n")}

Return a JSON array of the TOP 5 best lender matches. For each match include:
{
  "lender_index": number (1-based index from the list above),
  "match_score": number 0-100,
  "qualification_summary": "2-3 sentence explanation of why they qualify and what product fits best",
  "estimated_rate": "rate range if known, e.g. 7-12% APR",
  "recommended_action": "specific next step to apply"
}

Only include lenders where match_score >= 60. Return empty array if no strong matches.
Return ONLY the JSON array, no other text.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].text.trim();
  const jsonStr = text.startsWith("[") ? text : text.match(/\[[\s\S]*\]/)?.[0] || "[]";
  return JSON.parse(jsonStr);
}

async function sendLenderMatchEmail(profile, matches, lenders) {
  if (matches.length === 0) return;

  const topMatches = matches.slice(0, 3);
  const matchesHtml = topMatches.map(m => {
    const lender = lenders[m.lender_index - 1];
    if (!lender) return "";
    return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <h3 style="margin:0 0 4px;color:#0A1628;font-size:14px;">${lender.name}</h3>
        <span style="background:#eff6ff;color:#1d4ed8;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;">${m.match_score}% match</span>
      </div>
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">${lender.lender_type} • Up to $${lender.max_loan?.toLocaleString()} • ${m.estimated_rate}</p>
      <p style="margin:0 0 8px;color:#374151;font-size:13px;">${m.qualification_summary}</p>
      <p style="margin:0;color:#C9A84C;font-size:12px;font-weight:600;">Next Step: ${m.recommended_action}</p>
    </div>`;
  }).join("");

  await sendEmail({
    to: profile.email,
    subject: `💰 ${matches.length} New Lender Match${matches.length > 1 ? "es" : ""} for ${profile.business_name}`,
    html: `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:#0A1628;padding:24px;text-align:center;">
        <h1 style="color:#C9A84C;margin:0;font-size:22px;">CosbyCapital</h1>
        <p style="color:#9ca3af;margin:8px 0 0;font-size:13px;">AI-Powered Capital Solutions</p>
      </div>
      <div style="padding:32px 24px;">
        <h2 style="color:#0A1628;margin:0 0 8px;">New Lender Matches Found</h2>
        <p style="color:#6b7280;margin:0 0 24px;">Hi ${profile.full_name}, our AI found ${matches.length} lenders that match your financing profile for ${profile.business_name}:</p>
        ${matchesHtml}
        <div style="text-align:center;margin-top:24px;">
          <a href="https://cosbycapital.com/dashboard/lenders" style="background:#C9A84C;color:#0A1628;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View All Lender Matches →</a>
        </div>
      </div>
      <div style="background:#f9fafb;padding:16px 24px;text-align:center;border-top:1px solid #e5e7eb;">
        <p style="color:#9ca3af;font-size:11px;margin:0;">Powered by <a href="https://cosbyaisolutions.com" style="color:#C9A84C;">Cosby AI Solutions</a></p>
      </div>
    </div>`,
  });
}

async function main() {
  const supabase = getSupabase();
  const startTime = Date.now();
  let clientsProcessed = 0;
  let totalMatches = 0;
  let emailsSent = 0;

  console.log(`[${new Date().toISOString()}] capital-lender-matcher starting...`);

  try {
    // Get all active client profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (profilesError) throw new Error(`Profiles fetch error: ${profilesError.message}`);
    if (!profiles?.length) {
      console.log("No profiles found, exiting.");
      await logRun(supabase, "capital-lender-matcher", "success", "No profiles found", {});
      return;
    }

    // Get all active lenders
    const { data: lenders, error: lendersError } = await supabase
      .from("lenders")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (lendersError) throw new Error(`Lenders fetch error: ${lendersError.message}`);
    if (!lenders?.length) {
      console.log("No active lenders found, exiting.");
      await logRun(supabase, "capital-lender-matcher", "success", "No active lenders", {});
      return;
    }

    console.log(`Processing ${profiles.length} clients against ${lenders.length} lenders...`);

    for (const profile of profiles) {
      try {
        // Get funding profile
        const { data: fundingProfile } = await supabase
          .from("funding_profiles")
          .select("*")
          .eq("profile_id", profile.id)
          .single();

        // Run Claude matching
        const matches = await matchClientToLenders(profile, fundingProfile, lenders);

        if (!matches.length) {
          clientsProcessed++;
          continue;
        }

        // Save matches to DB
        const matchInserts = matches.map(m => ({
          profile_id: profile.id,
          lender_id: lenders[m.lender_index - 1]?.id,
          match_score: m.match_score,
          qualification_summary: m.qualification_summary,
          estimated_rate: m.estimated_rate,
          status: "matched",
          matched_at: new Date().toISOString(),
        })).filter(m => m.lender_id);

        if (matchInserts.length > 0) {
          await supabase.from("lender_matches").upsert(matchInserts, {
            onConflict: "profile_id,lender_id",
          });
          totalMatches += matchInserts.length;
        }

        // Email client if high-score matches
        const highScoreMatches = matches.filter(m => m.match_score >= 75);
        if (highScoreMatches.length > 0) {
          try {
            await sendLenderMatchEmail(profile, highScoreMatches, lenders);
            emailsSent++;
          } catch (emailErr) {
            console.error(`Email failed for ${profile.email}:`, emailErr.message);
          }
        }

        clientsProcessed++;

        // Rate limit Claude API
        await new Promise(r => setTimeout(r, 500));

      } catch (clientErr) {
        console.error(`Error processing client ${profile.id}:`, clientErr.message);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = `Processed ${clientsProcessed} clients, found ${totalMatches} lender matches, sent ${emailsSent} emails`;

    await logRun(supabase, "capital-lender-matcher", "success", summary, {
      clients_processed: clientsProcessed,
      total_matches: totalMatches,
      emails_sent: emailsSent,
      duration_seconds: parseFloat(duration),
    });

    await sendTelegram(`✅ <b>Lender Matcher Complete</b>\n\n👥 Clients: ${clientsProcessed}\n🏦 Matches: ${totalMatches}\n📧 Emails: ${emailsSent}\n⏱ ${duration}s`);
    console.log(`[DONE] ${summary}`);

  } catch (error) {
    console.error("Fatal error:", error.message);
    await logRun(supabase, "capital-lender-matcher", "error", error.message);
    await alertError("capital-lender-matcher", error.message);
    process.exit(1);
  }
}

main();
