/**
 * capital-grant-matcher
 * Runs daily at 7:00 AM UTC
 * Matches all active clients against new grants using Claude AI
 * Saves matches to grant_matches table, emails clients with high-score matches
 */

import Anthropic from "@anthropic-ai/sdk";
import { getSupabase, logRun } from "../shared/supabase.js";
import { sendEmail } from "../shared/resend.js";
import { alertError } from "../shared/telegram.js";
import { sendTelegram } from "../shared/telegram.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function matchClientToGrants(profile, fundingProfile, grants) {
  const prompt = `You are an expert grant matching specialist. Analyze this client profile and determine which grants they qualify for.

CLIENT PROFILE:
- Business: ${profile.business_name} (${profile.business_type})
- Industry: ${profile.industry}
- State: ${profile.state}
- Years in Business: ${profile.years_in_business}
- Annual Revenue: $${profile.annual_revenue}
- Credit Score Range: ${profile.credit_score_range}
- Funding Goal: ${profile.funding_goal}
- Funding Amount Needed: $${fundingProfile?.funding_amount_needed || 0}
- Funding Purpose: ${fundingProfile?.funding_purpose || "general"}
- Real Estate Investor: ${fundingProfile?.real_estate_investor ? "Yes" : "No"}

AVAILABLE GRANTS (${grants.length} total):
${grants.slice(0, 30).map((g, i) => `${i + 1}. ${g.name} | ${g.funder} | $${g.amount_min}-$${g.amount_max} | Tags: ${g.eligibility_tags?.join(", ")} | States: ${g.states?.join(", ")}`).join("\n")}

Return a JSON array of the TOP 5 best matches only. For each match include:
{
  "grant_index": number (1-based index from the list above),
  "match_score": number 0-100,
  "eligibility_summary": "2-3 sentence explanation of why they qualify",
  "recommended_action": "specific next step"
}

Only include grants where match_score >= 60. Return empty array if no strong matches.
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

async function sendMatchEmail(profile, matches, grants) {
  if (matches.length === 0) return;

  const topMatches = matches.slice(0, 3);
  const matchesHtml = topMatches.map(m => {
    const grant = grants[m.grant_index - 1];
    if (!grant) return "";
    return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:start;">
        <h3 style="margin:0 0 4px;color:#0A1628;font-size:14px;">${grant.name}</h3>
        <span style="background:#f0fdf4;color:#16a34a;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;">${m.match_score}% match</span>
      </div>
      <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">${grant.funder} • Up to $${grant.amount_max?.toLocaleString()}</p>
      <p style="margin:0 0 8px;color:#374151;font-size:13px;">${m.eligibility_summary}</p>
      <p style="margin:0;color:#C9A84C;font-size:12px;font-weight:600;">Next Step: ${m.recommended_action}</p>
    </div>`;
  }).join("");

  await sendEmail({
    to: profile.email,
    subject: `🎯 ${matches.length} New Grant Match${matches.length > 1 ? "es" : ""} for ${profile.business_name}`,
    html: `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:#0A1628;padding:24px;text-align:center;">
        <h1 style="color:#C9A84C;margin:0;font-size:22px;">CosbyCapital</h1>
        <p style="color:#9ca3af;margin:8px 0 0;font-size:13px;">AI-Powered Capital Solutions</p>
      </div>
      <div style="padding:32px 24px;">
        <h2 style="color:#0A1628;margin:0 0 8px;">New Grant Matches Found</h2>
        <p style="color:#6b7280;margin:0 0 24px;">Hi ${profile.full_name}, our AI identified ${matches.length} new grant opportunities for ${profile.business_name}:</p>
        ${matchesHtml}
        <div style="text-align:center;margin-top:24px;">
          <a href="https://cosbycapital.com/dashboard/grants" style="background:#C9A84C;color:#0A1628;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View All Matches →</a>
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

  console.log(`[${new Date().toISOString()}] capital-grant-matcher starting...`);

  try {
    // Get active client profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (profilesError) throw new Error(`Profiles fetch error: ${profilesError.message}`);
    if (!profiles?.length) {
      console.log("No profiles found, exiting.");
      return;
    }

    // Get active grants (recently added or updated)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: grants, error: grantsError } = await supabase
      .from("grants")
      .select("*")
      .eq("is_active", true)
      .gte("last_updated", sevenDaysAgo)
      .order("last_updated", { ascending: false })
      .limit(50);

    if (grantsError) throw new Error(`Grants fetch error: ${grantsError.message}`);
    if (!grants?.length) {
      console.log("No new grants to match, exiting.");
      await logRun(supabase, "capital-grant-matcher", "success", "No new grants to match", {});
      return;
    }

    console.log(`Processing ${profiles.length} clients against ${grants.length} grants...`);

    for (const profile of profiles) {
      try {
        // Get funding profile
        const { data: fundingProfile } = await supabase
          .from("funding_profiles")
          .select("*")
          .eq("profile_id", profile.id)
          .single();

        // Get existing matches to avoid duplicates
        const { data: existingMatches } = await supabase
          .from("grant_matches")
          .select("grant_id")
          .eq("profile_id", profile.id);

        const existingGrantIds = new Set((existingMatches || []).map(m => m.grant_id));
        const newGrants = grants.filter(g => !existingGrantIds.has(g.id));

        if (!newGrants.length) {
          clientsProcessed++;
          continue;
        }

        // Run Claude matching
        const matches = await matchClientToGrants(profile, fundingProfile, newGrants);

        if (!matches.length) {
          clientsProcessed++;
          continue;
        }

        // Save matches to DB
        const matchInserts = matches.map(m => ({
          profile_id: profile.id,
          grant_id: newGrants[m.grant_index - 1]?.id,
          match_score: m.match_score,
          eligibility_summary: m.eligibility_summary,
          status: "matched",
        })).filter(m => m.grant_id);

        if (matchInserts.length > 0) {
          await supabase.from("grant_matches").upsert(matchInserts, { onConflict: "profile_id,grant_id" });
          totalMatches += matchInserts.length;
        }

        // Email client if high-score matches found
        const highScoreMatches = matches.filter(m => m.match_score >= 75);
        if (highScoreMatches.length > 0) {
          try {
            await sendMatchEmail(profile, highScoreMatches, newGrants);
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
    const summary = `Processed ${clientsProcessed} clients, found ${totalMatches} matches, sent ${emailsSent} emails`;

    await logRun(supabase, "capital-grant-matcher", "success", summary, {
      clients_processed: clientsProcessed,
      total_matches: totalMatches,
      emails_sent: emailsSent,
      duration_seconds: parseFloat(duration),
    });

    await sendTelegram(`✅ <b>Grant Matcher Complete</b>\n\n👥 Clients: ${clientsProcessed}\n🎯 Matches: ${totalMatches}\n📧 Emails: ${emailsSent}\n⏱ ${duration}s`);
    console.log(`[DONE] ${summary}`);

  } catch (error) {
    console.error("Fatal error:", error.message);
    await logRun(supabase, "capital-grant-matcher", "error", error.message);
    await alertError("capital-grant-matcher", error.message);
    process.exit(1);
  }
}

main();
