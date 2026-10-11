/** Уведомление в Telegram (топик группы). Никогда не роняет основную работу: ошибки только в лог. */
export async function notify(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    const topic = process.env.TELEGRAM_TOPIC_ID;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: false,
        ...(topic ? { message_thread_id: Number(topic) } : {}),
      }),
    });
    if (!res.ok) console.warn("Telegram:", res.status, await res.text());
  } catch (e) {
    console.warn("Telegram недоступен:", (e as Error).message);
  }
}
