export async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("Telegram error:", e.message);
  }
}

export async function alertError(agentName, error) {
  await sendTelegram(`🚨 <b>${agentName} ERROR</b>\n\n${error}\n\n<i>${new Date().toISOString()}</i>`);
}
