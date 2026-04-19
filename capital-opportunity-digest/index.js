/**
 * capital-opportunity-digest
 * Runs weekly Monday at 9:00 AM UTC
 * Sends each active client a personalized weekly digest of their top opportunities
 * Combines grant matches + lender matches into one beautiful email
 */

import { getSupabase, logRun } from "../shared/supabase.js";
import { sendEmail } from "../shared/resend.js";
import { alertError, sendTelegram } from "../shared/telegram.js";

async function buildDigestEmail(profile, grantMatches, lenderMatches) {
  const grantHtml = grantMatches.length > 0
    ? grantMatches.slice(0, 3).map(m => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #f3f4f6;">
        <div style="font-weight:600;color:#0A1628;font-size:13px;">${m.grants?.name || "Grant Opportunity"}</div>
        <div style="color:#6b7280;font-size:11px;margin-top:2px;">${m.grants?.funder} • Up to $${m.grants?.amount_max?.toLocaleString()}</div>
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
        <span style="background:#f0fdf4;color:#16a34a;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">${m.match_score}%</span>
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">
        <a href="https://cosbycapital.com/dashboard/grants" style="color:#C9A84C;font-size:12px;font-weight:600;text-decoration:none;">Apply →</a>
      </td>
    </tr>`).join("")
    : `<tr><td colspan="3" style="padding:16px 8px;color:#9ca3af;font-size:13px;text-align:center;">No grant matches yet — complete your profile to unlock matches.</td></tr>`;

  const lenderHtml = lenderMatches.length > 0
    ? lenderMatches.slice(0, 3).map(m => `
    <tr>
      <td style="padding:12px 8px;border-bottom:1px solid #f3f4f6;">
        <div style="font-weight:600;color:#0A1628;font-size:13px;">${m.lenders?.name || "Lender"}</div>
        <div style="color:#6b7280;font-size:11px;margin-top:2px;">${m.lenders?.lender_type} • Up to $${m.lenders?.max_loan?.toLocaleString()} • ${m.estimated_rate || "Rate TBD"}</div>
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
        <span style="background:#eff6ff;color:#1d4ed8;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">${m.match_score}%</span>
      </td>
      <td style="padding:12px 8px;border-bottom:1px solid #f3f4f6;text-align:right;">
        <a href="https://cosbycapital.com/dashboard/lenders" style="color:#C9A84C;font-size:12px;font-weight:600;text-decoration:none;">Apply →</a>
      </td>
    </tr>`).join("")
    : `<tr><td colspan="3" style="padding:16px 8px;color:#9ca3af;font-size:13px;text-align:center;">No lender matches yet — your profile is being analyzed.</td></tr>`;

  const totalOpportunities = grantMatches.length + lenderMatches.length;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  return `
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#fff;">
    <div style="background:#0A1628;padding:28px 24px;text-align:center;">
      <h1 style="color:#C9A84C;margin:0;font-size:24px;">CosbyCapital</h1>
      <p style="color:#9ca3af;margin:6px 0 0;font-size:13px;">Weekly Opportunity Digest • ${today}</p>
    </div>

    <div style="padding:32px 24px 0;">
      <h2 style="color:#0A1628;margin:0 0 6px;font-size:20px;">Hi ${profile.full_name} 👋</h2>
      <p style="color:#6b7280;margin:0 0 28px;font-size:14px;">
        Here's your weekly capital update for <strong>${profile.business_name}</strong>.
        You have <strong>${totalOpportunities} active opportunity${totalOpportunities !== 1 ? "ies" : "y"}</strong> waiting for you.
      </p>

      <!-- Grant Matches -->
      <div style="margin-bottom:32px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="margin:0;color:#0A1628;font-size:15px;">🎯 Grant Matches</h3>
          <a href="https://cosbycapital.com/dashboard/grants" style="color:#C9A84C;font-size:12px;text-decoration:none;">View all ${grantMatches.length} →</a>
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Grant</th>
              <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Match</th>
              <th style="padding:10px 8px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Action</th>
            </tr>
          </thead>
          <tbody>${grantHtml}</tbody>
        </table>
      </div>

      <!-- Lender Matches -->
      <div style="margin-bottom:32px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="margin:0;color:#0A1628;font-size:15px;">🏦 Lender Matches</h3>
          <a href="https://cosbycapital.com/dashboard/lenders" style="color:#C9A84C;font-size:12px;text-decoration:none;">View all ${lenderMatches.length} →</a>
        </div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Lender</th>
              <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Match</th>
              <th style="padding:10px 8px;text-align:right;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Action</th>
            </tr>
          </thead>
          <tbody>${lenderHtml}</tbody>
        </table>
      </div>

      <div style="background:#f9fafb;border-radius:8px;padding:20px;text-align:center;margin-bottom:28px;">
        <p style="margin:0 0 12px;color:#374151;font-size:14px;">Ready to move forward? Your advisor is here to help.</p>
        <a href="https://cosbycapital.com/dashboard" style="background:#C9A84C;color:#0A1628;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">Go to My Dashboard →</a>
      </div>
    </div>

    <div style="background:#0A1628;padding:20px 24px;text-align:center;">
      <p style="color:#9ca3af;font-size:11px;margin:0 0 4px;">CosbyCapital • AI-Powered Capital Solutions</p>
      <p style="color:#6b7280;font-size:11px;margin:0;">Powered by <a href="https://cosbyaisolutions.com" style="color:#C9A84C;">Cosby AI Solutions</a> • <a href="https://cosbycapital.com/unsubscribe" style="color:#6b7280;">Unsubscribe</a></p>
    </div>
  </div>`;
}

async function main() {
  const supabase = getSupabase();
  const startTime = Date.now();
  let emailsSent = 0;
  let skipped = 0;

  console.log(`[${new Date().toISOString()}] capital-opportunity-digest starting...`);

  try {
    // Get all active profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (profilesError) throw new Error(`Profiles fetch error: ${profilesError.message}`);
    if (!profiles?.length) {
      console.log("No profiles found, exiting.");
      await logRun(supabase, "capital-opportunity-digest", "success", "No profiles found", {});
      return;
    }

    console.log(`Sending weekly digest to ${profiles.length} clients...`);

    for (const profile of profiles) {
      try {
        if (!profile.email) { skipped++; continue; }

        // Get grant matches (top 5 by score)
        const { data: grantMatches } = await supabase
          .from("grant_matches")
          .select("*, grants(*)")
          .eq("profile_id", profile.id)
          .order("match_score", { ascending: false })
          .limit(5);

        // Get lender matches (top 5 by score)
        const { data: lenderMatches } = await supabase
          .from("lender_matches")
          .select("*, lenders(*)")
          .eq("profile_id", profile.id)
          .order("match_score", { ascending: false })
          .limit(5);

        const gm = grantMatches || [];
        const lm = lenderMatches || [];

        // Only send if there's something to report
        if (gm.length === 0 && lm.length === 0) {
          skipped++;
          continue;
        }

        const html = await buildDigestEmail(profile, gm, lm);

        await sendEmail({
          to: profile.email,
          subject: `📊 Your Weekly Capital Digest — ${gm.length + lm.length} Opportunities`,
          html,
        });

        emailsSent++;

        // Rate limit
        await new Promise(r => setTimeout(r, 300));

      } catch (clientErr) {
        console.error(`Digest failed for ${profile.id}:`, clientErr.message);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = `Sent ${emailsSent} weekly digests, skipped ${skipped}`;

    await logRun(supabase, "capital-opportunity-digest", "success", summary, {
      emails_sent: emailsSent,
      skipped,
      duration_seconds: parseFloat(duration),
    });

    await sendTelegram(`✅ <b>Opportunity Digest Complete</b>\n\n📧 Digests Sent: ${emailsSent}\n⏭ Skipped: ${skipped}\n⏱ ${duration}s`);
    console.log(`[DONE] ${summary}`);

  } catch (error) {
    console.error("Fatal error:", error.message);
    await logRun(supabase, "capital-opportunity-digest", "error", error.message);
    await alertError("capital-opportunity-digest", error.message);
    process.exit(1);
  }
}

main();
