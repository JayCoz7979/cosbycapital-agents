/**
 * capital-deadline-monitor
 * Runs daily at 8:00 AM UTC
 * Checks all active grants for deadlines within 14 days
 * Notifies matched clients via email + sends Telegram summary
 */

import { getSupabase, logRun } from "../shared/supabase.js";
import { sendEmail } from "../shared/resend.js";
import { alertError, sendTelegram } from "../shared/telegram.js";

function daysUntil(dateStr) {
  const deadline = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  return Math.round((deadline - now) / (1000 * 60 * 60 * 24));
}

function urgencyLabel(days) {
  if (days <= 3) return { label: "🔴 URGENT", color: "#dc2626", bg: "#fef2f2" };
  if (days <= 7) return { label: "🟠 This Week", color: "#d97706", bg: "#fff7ed" };
  return { label: "🟡 Coming Up", color: "#854d0e", bg: "#fef9c3" };
}

async function sendDeadlineAlert(profile, urgentGrants) {
  if (urgentGrants.length === 0) return;

  const grantsHtml = urgentGrants.map(({ grant, match, days }) => {
    const { label, color, bg } = urgencyLabel(days);
    return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
        <div>
          <h3 style="margin:0 0 2px;color:#0A1628;font-size:14px;">${grant.name}</h3>
          <p style="margin:0;color:#6b7280;font-size:12px;">${grant.funder} • Up to $${grant.amount_max?.toLocaleString()}</p>
        </div>
        <span style="background:${bg};color:${color};padding:4px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;margin-left:8px;">${label}</span>
      </div>
      <div style="display:flex;gap:12px;align-items:center;">
        <div style="background:#f9fafb;border-radius:6px;padding:8px 12px;text-align:center;min-width:72px;">
          <div style="font-size:22px;font-weight:700;color:${color};">${days}</div>
          <div style="font-size:10px;color:#6b7280;text-transform:uppercase;">day${days !== 1 ? "s" : ""} left</div>
        </div>
        <div style="flex:1;">
          <p style="margin:0 0 4px;color:#374151;font-size:12px;">Deadline: <strong>${new Date(grant.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</strong></p>
          <p style="margin:0;color:#6b7280;font-size:11px;">Match score: ${match.match_score}%</p>
        </div>
      </div>
      <div style="margin-top:10px;">
        <a href="${grant.application_url || "https://cosbycapital.com/dashboard/grants"}" style="background:#C9A84C;color:#0A1628;padding:8px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:12px;display:inline-block;">Apply Now →</a>
      </div>
    </div>`;
  }).join("");

  await sendEmail({
    to: profile.email,
    subject: `⏰ ${urgentGrants.length} Grant Deadline${urgentGrants.length > 1 ? "s" : ""} Approaching for ${profile.business_name}`,
    html: `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#fff;">
      <div style="background:#0A1628;padding:24px;text-align:center;">
        <h1 style="color:#C9A84C;margin:0;font-size:22px;">CosbyCapital</h1>
        <p style="color:#9ca3af;margin:8px 0 0;font-size:13px;">Deadline Alert</p>
      </div>
      <div style="padding:32px 24px;">
        <h2 style="color:#0A1628;margin:0 0 8px;">Action Required ⏰</h2>
        <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">Hi ${profile.full_name}, you have <strong>${urgentGrants.length} grant deadline${urgentGrants.length > 1 ? "s" : ""}</strong> approaching for ${profile.business_name}. Don't miss these opportunities:</p>
        ${grantsHtml}
        <div style="text-align:center;margin-top:24px;">
          <a href="https://cosbycapital.com/dashboard/grants" style="background:#C9A84C;color:#0A1628;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">View All Grants →</a>
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
  let alertsSent = 0;
  let grantsMonitored = 0;

  console.log(`[${new Date().toISOString()}] capital-deadline-monitor starting...`);

  try {
    // Get grants with deadlines in the next 14 days
    const now = new Date();
    const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const { data: upcomingGrants, error: grantsError } = await supabase
      .from("grants")
      .select("*")
      .eq("is_active", true)
      .not("deadline", "is", null)
      .gte("deadline", now.toISOString().split("T")[0])
      .lte("deadline", in14Days.toISOString().split("T")[0])
      .order("deadline", { ascending: true });

    if (grantsError) throw new Error(`Grants fetch error: ${grantsError.message}`);

    grantsMonitored = upcomingGrants?.length || 0;

    if (!upcomingGrants?.length) {
      console.log("No upcoming deadlines in the next 14 days.");
      await logRun(supabase, "capital-deadline-monitor", "success", "No upcoming deadlines", {
        grants_monitored: 0,
        alerts_sent: 0,
      });
      await sendTelegram(`✅ <b>Deadline Monitor</b>\n\n📅 No grant deadlines in next 14 days.`);
      return;
    }

    console.log(`Found ${upcomingGrants.length} grants with upcoming deadlines.`);

    // Get all profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("*");

    if (profilesError) throw new Error(`Profiles fetch error: ${profilesError.message}`);
    if (!profiles?.length) {
      console.log("No profiles found.");
      return;
    }

    const upcomingGrantIds = upcomingGrants.map(g => g.id);

    for (const profile of profiles) {
      try {
        if (!profile.email) continue;

        // Find matches for this profile where grant has upcoming deadline
        const { data: matches } = await supabase
          .from("grant_matches")
          .select("*, grants(*)")
          .eq("profile_id", profile.id)
          .in("grant_id", upcomingGrantIds)
          .gte("match_score", 60)
          .order("match_score", { ascending: false });

        if (!matches?.length) continue;

        // Build urgent list with days remaining
        const urgentGrants = matches
          .map(m => ({
            grant: m.grants,
            match: m,
            days: daysUntil(m.grants.deadline),
          }))
          .filter(item => item.days >= 0 && item.days <= 14)
          .sort((a, b) => a.days - b.days);

        if (urgentGrants.length === 0) continue;

        await sendDeadlineAlert(profile, urgentGrants);
        alertsSent++;

        await new Promise(r => setTimeout(r, 300));

      } catch (clientErr) {
        console.error(`Alert failed for ${profile.id}:`, clientErr.message);
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = `Monitored ${grantsMonitored} upcoming deadlines, sent ${alertsSent} client alerts`;

    await logRun(supabase, "capital-deadline-monitor", "success", summary, {
      grants_monitored: grantsMonitored,
      alerts_sent: alertsSent,
      duration_seconds: parseFloat(duration),
    });

    // Telegram summary with deadline list
    let telegramMsg = `✅ <b>Deadline Monitor Complete</b>\n\n`;
    telegramMsg += `📅 Upcoming Deadlines: ${grantsMonitored}\n`;
    telegramMsg += `📧 Alerts Sent: ${alertsSent}\n`;
    telegramMsg += `⏱ ${duration}s\n`;
    if (upcomingGrants.length > 0) {
      telegramMsg += `\n<b>Upcoming Deadlines:</b>\n`;
      upcomingGrants.slice(0, 5).forEach(g => {
        const days = daysUntil(g.deadline);
        telegramMsg += `• ${g.name?.substring(0, 50)} — ${days}d\n`;
      });
    }

    await sendTelegram(telegramMsg);
    console.log(`[DONE] ${summary}`);

  } catch (error) {
    console.error("Fatal error:", error.message);
    await logRun(supabase, "capital-deadline-monitor", "error", error.message);
    await alertError("capital-deadline-monitor", error.message);
    process.exit(1);
  }
}

main();
