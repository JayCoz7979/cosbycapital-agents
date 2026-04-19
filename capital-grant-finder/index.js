/**
 * capital-grant-finder
 * Runs daily at 6:00 AM UTC
 * Scrapes Grants.gov API for new grants, stores in Supabase, sends Telegram summary
 */

import { getSupabase, logRun } from "../shared/supabase.js";
import { sendTelegram, alertError } from "../shared/telegram.js";

const GRANTS_GOV_API = "https://apply07.grants.gov/grantsws/rest/opportunities/search";

const RELEVANT_CATEGORIES = [
  "Business and Commerce",
  "Employment, Labor and Training",
  "Community Development",
  "Agriculture",
  "Science and Technology and other Research and Development",
  "Housing",
  "Income Security and Social Services",
  "Education",
];

async function fetchGrantsGov(page = 0) {
  const payload = {
    keyword: "small business",
    oppStatuses: "forecasted|posted",
    rows: 25,
    startRecordNum: page * 25,
    sortBy: "openDate|desc",
  };

  const res = await fetch(GRANTS_GOV_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`Grants.gov API error: ${res.status}`);
  return res.json();
}

async function upsertGrant(supabase, opp) {
  const existing = await supabase
    .from("grants")
    .select("id")
    .eq("application_url", `https://www.grants.gov/search-results-detail/${opp.id}`)
    .single();

  if (existing.data) return { inserted: false };

  const deadline = opp.closeDate ? new Date(opp.closeDate).toISOString().split("T")[0] : null;
  const amountMax = opp.awardCeiling ? parseInt(opp.awardCeiling) : 0;
  const amountMin = opp.awardFloor ? parseInt(opp.awardFloor) : 0;

  const tags = [];
  if (opp.applicantTypes?.includes("12")) tags.push("small_business");
  if (opp.applicantTypes?.includes("06")) tags.push("nonprofit");
  if (opp.applicantTypes?.includes("25")) tags.push("for_profit");

  const { error } = await supabase.from("grants").insert({
    name: opp.title?.substring(0, 255) || "Untitled Grant",
    funder: opp.agencyName || "Federal Agency",
    category: opp.category || "Federal",
    amount_min: amountMin,
    amount_max: amountMax,
    deadline,
    eligibility_tags: tags,
    states: ["ALL"],
    description: opp.synopsis?.substring(0, 1000) || opp.title || "",
    application_url: `https://www.grants.gov/search-results-detail/${opp.id}`,
    is_active: true,
    last_updated: new Date().toISOString(),
  });

  if (error) {
    console.error("Insert error:", error.message);
    return { inserted: false };
  }

  return { inserted: true, name: opp.title, funder: opp.agencyName, amount: amountMax };
}

async function main() {
  const supabase = getSupabase();
  const startTime = Date.now();
  let totalFound = 0;
  let totalInserted = 0;
  const newGrants = [];

  console.log(`[${new Date().toISOString()}] capital-grant-finder starting...`);

  try {
    // Fetch first 3 pages (75 grants)
    for (let page = 0; page < 3; page++) {
      let data;
      try {
        data = await fetchGrantsGov(page);
      } catch (e) {
        console.error(`Page ${page} fetch error:`, e.message);
        continue;
      }

      const opportunities = data.oppHits || [];
      totalFound += opportunities.length;

      for (const opp of opportunities) {
        const result = await upsertGrant(supabase, opp);
        if (result.inserted) {
          totalInserted++;
          newGrants.push(result);
        }
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 1000));
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const summary = `Found ${totalFound} grants, inserted ${totalInserted} new`;

    await logRun(supabase, "capital-grant-finder", "success", summary, {
      total_found: totalFound,
      total_inserted: totalInserted,
      duration_seconds: parseFloat(duration),
    });

    // Telegram summary
    let msg = `✅ <b>Grant Finder Complete</b>\n\n`;
    msg += `📊 Scanned: ${totalFound} opportunities\n`;
    msg += `🆕 New grants added: ${totalInserted}\n`;
    msg += `⏱ Duration: ${duration}s\n`;
    if (newGrants.length > 0) {
      msg += `\n<b>Top New Grants:</b>\n`;
      newGrants.slice(0, 5).forEach(g => {
        msg += `• ${g.name?.substring(0, 60)} — ${g.funder}\n`;
      });
    }

    await sendTelegram(msg);
    console.log(`[DONE] ${summary} in ${duration}s`);

  } catch (error) {
    console.error("Fatal error:", error.message);
    await logRun(supabase, "capital-grant-finder", "error", error.message);
    await alertError("capital-grant-finder", error.message);
    process.exit(1);
  }
}

main();
