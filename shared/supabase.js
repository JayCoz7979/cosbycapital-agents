import { createClient } from "@supabase/supabase-js";

export function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

export async function logRun(supabase, agent, status, summary, meta = {}) {
  try {
    await supabase.from("agent_run_logs").insert({
      agent_name: agent,
      status,
      summary,
      meta,
      ran_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to log run:", e.message);
  }
}
