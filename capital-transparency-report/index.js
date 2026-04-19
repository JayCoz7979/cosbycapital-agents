/**
 * capital-transparency-report
 * Runs monthly on the 1st at 7:00 AM UTC
 * Sends each client a full transparency report:
 * - All grant matches with status
 * - All lender matches with status
 * - Application activity
 * - What we did for them this month
 */

import { getSupabase, logRun } from "../shared/supabase.js";
import { sendEmail } from "../shared/resend.js";
import { alertError, sendTelegram } from "../shared/telegram.js";

function getMonthName(date) {
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function statusBadge(status) {
  const colors = {
    matched: { bg: "#f0fdf4", text: "#16a34a" },
    applied: { bg: "#eff6ff", text: "#1d4ed8" },
    awarded: { bg: "#fef9c3", text: "#854d0e" },
    rejected: { bg: "#fef2f2", text: "#dc2626" },
    pending: { bg: "#f9fafb", text: "#6b7280" },
  };
  const c = colors[status] || colors.pending;
  return `<span style="background:${c.bg};color:${c.text};padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${status}</span>`;
}

async function buildTransparencyReport(profile, data) {
  const { grantMatches, lenderMatches, applications } = data;
  const reportMonth = getMonthName(new Date());

  const totalGrantMatches = grantMatches.length;
  const totalLenderMatches = lenderMatches.length;
  const totalApplications = applications.length;
  const awardedGrants = applications.filter(a => a.status === "awarded");
  const totalAwarded = awardedGrants.reduce((sum, a) => sum + (a.award_amount || 0), 0);

  const grantRows = grantMatches.slice(0, 10).map(m => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#0A1628;">${m.grants?.name?.substring(0, 50) || "—"}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">${m.grants?.funder?.substring(0, 30) || "—"}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
        <span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${m.match_score}%</span>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">${statusBadge(m.status)}</td>
    </tr>`).join("") || `<tr><td colspan="4" style="padding:16px;text-align:center;color:#9ca3af;font-size:12px;">No grant matches recorded yet.</td></tr>`;

  const lenderRows = lenderMatches.slice(0, 10).map(m => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#0A1628;">${m.lenders?.name?.substring(0, 50) || "—"}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#6b7280;">${m.lenders?.type || "—"}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">
        <span style="background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">${m.match_score}%</span>
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #f3f4f6;text-align:center;">${statusBadge(m.status)}</td>
    </tr>`).join("") || `<tr><td colspan="4" style="padding:16px;text-align:center;color:#9ca3af;font-size:12px;">No lender matches recorded yet.</td></tr>`;

  return `
  <div style="font-family:sans-serif;max-width:640px;margin:0 auto;background:#fff;">
    <!-- Header -->
    <div style="background:#0A1628;padding:32px 24px;">
      <h1 style="color:#C9A84C;margin:0 0 4px;font-size:24px;">CosbyCapital</h1>
      <p style="color:#9ca3af;margin:0;font-size:13px;">Monthly Transparency Report • ${reportMonth}</p>
    </div>

    <div style="padding:32px 24px;">
      <h2 style="color:#0A1628;margin:0 0 4px;font-size:20px;">Your Capital Report</h2>
      <p style="color:#6b7280;margin:0 0 28px;font-size:14px;">Hi ${profile.full_name}, here is a complete breakdown of everything we did for <strong>${profile.business_name}</strong> this month.</p>

      <!-- Summary Cards -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:32px;">
        <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#16a34a;">${totalGrantMatches}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">Grant Matches</div>
        </div>
        <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#1d4ed8;">${totalLenderMatches}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">Lender Matches</div>
        </div>
        <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#C9A84C;">${totalApplications}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">Applications</div>
        </div>
        <div style="background:#f9fafb;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#0A1628;">$${totalAwarded.toLocaleString()}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">Capital Awarded</div>
        </div>
      </div>

      <!-- Grant Matches Table -->
      <h3 style="color:#0A1628;font-size:15px;margin:0 0 12px;">🎯 Grant Match History</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:28px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Grant Name</th>
            <th style="padding:10px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Funder</th>
            <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Score</th>
            <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Status</th>
          </tr>
        </thead>
        <tbody>${grantRows}</tbody>
      </table>

      <!-- Lender Matches Table -->
      <h3 style="color:#0A1628;font-size:15px;margin:0 0 12px;">🏦 Lender Match History</h3>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:32px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Lender</th>
            <th style="padding:10px 8px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Type</th>
            <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Score</th>
            <th style="padding:10px 8px;text-align:center;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;">Status</th>
          </tr>
        </thead>
        <tbody>${lenderRows}</tbody>
      </table>

      <!-- What We Did Section -->
      <div style="background:#0A1628;border-radius:8px;padding:20px;margin-bottom:28px;">
        <h3 style="color:#C9A84C;margin:0 0 12px;font-size:15px;">What We Did For You This Month</h3>
        <ul style="margin:0;padding-left:16px;color:#d1d5db;font-size:13px;line-height:1.8;">
          <li>Scanned thousands of federal and private grant opportunities</li>
          <li>Ran AI analysis to match your profile to ${totalGrantMatches} relevant grants</li>
          <li>Identified ${totalLenderMatches} lenders aligned with your financing needs</li>
          <li>Monitored all active deadlines and sent timely alerts</li>
          <li>Kept your opportunity pipeline fresh and up to date</li>
        </ul>
      </div>

      <div style="text-align:center;">
        <a href="https://cosbycapital.com/dashboard" style="background:#C9A84C;color:#0A1628;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;">View Full Dashboard →</a>
      </div>
    </div>

    <div style="background:#f9fafb;padding:16px 24px;text-align:center;border-top:1px solid #e5e7eb;margin-top:32px;">
      <p style="color:#9ca3af;font-size:11px;margin:0;">CosbyCapital • AI-Powered Capital Solutions</p>
      <p style="color:#9ca3af;font-size:11px;margin:4px 0 0;">Powered by <a href="https://cosbyaisolutions.com" style="color:#C9A84C;">Cosby AI Solutions</a></p>
    </div>
  </div>`;
}

async function main() {
  const supabase = getSupabase();
  const startTime = Date.now();
  let reportsSent = 0;
  let skipped = 0;

  console.log(`[${new Date().toISOString()}] capital-transparency-report starting...`);

  try {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (profilesError) throw new Error(`Profiles fetch error: ${profilesError.message}`);
    if (!profiles?.length) {
      console.log("No profiles found, exiting.");
      await logRun(supabase, "capital-transparency-report", "success", "No profiles found", {});
      return;
    }

    console.log(`Sending monthly transparency reports to ${profiles.length} clients...`);

    for (const profile of profiles) {
      try {
        if (!profile.email) { skipped++; continue; }

        const [grantMatchRes, lenderMatchRes, appRes] = await Promise.all([
          supabase.from("grant_matches").select("*, grants(name, funder, amount_max)").eq("profile_id", profile.id).order("match_score", { ascending: false }),
          supabase.from("lender_matches").select("*, lenders(name, type, max_loan)").eq("profile_id", profile.id).order("match_score", { ascending: false }),
          supabase.from("grant_applications").select("*, grants(name, funder)").eq("profile_id", profile.id).order("created_at", { ascending: false }),
        ]);

        const data = {
          grantMatches: grantMatchRes.data || [],
          lenderMatches: lenderMatchRes.data || [],
          applications: appRes.data || [],
        };

        const html = await buildTransparencyReport(profile, data);
        const reportMonth = getMonthName(new Date());

        await sendEmail({
          to: profile.email,
          subject: `📋 Your Monthly Transparency Report — ${reportMonth}`,
          html,
        });

        reportsSent++;

        await new Promise(r => setTimeout(r, 300));

      } catch (clientErr) {
        console.error(`Report failed for ${profile.id}:`, clientErr.message);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = `Sent ${reportsSent} transparency reports, skipped ${skipped}`;

    await logRun(supabase, "capital-transparency-report", "success", summary, {
      reports_sent: reportsSent,
      skipped,
      duration_seconds: parseFloat(duration),
    });

    await sendTelegram(`✅ <b>Transparency Reports Complete</b>\n\n📋 Reports Sent: ${reportsSent}\n⏭ Skipped: ${skipped}\n⏱ ${duration}s`);
    console.log(`[DONE] ${summary}`);

  } catch (error) {
    console.error("Fatal error:", error.message);
    await logRun(supabase, "capital-transparency-report", "error", error.message);
    await alertError("capital-transparency-report", error.message);
    process.exit(1);
  }
}

main();
