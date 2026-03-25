const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

const POLYMARKET_BASE_URL = "https://polymarket.com/event";

async function sendTelegramMessage(text: string): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error("Telegram send failed:", err);
  }
}

export async function notifyBuy(
  coin: string,
  side: "UP" | "DOWN",
  amount: number,
  price: number,
  slug: string,
): Promise<void> {
  const link = `${POLYMARKET_BASE_URL}/${slug}`;
  const msg =
    `🟢 <b>BUY ${side}</b> — ${coin}\n` +
    `💰 Amount: <b>$${amount.toFixed(2)}</b>\n` +
    `📊 Price: <b>${price.toFixed(3)}</b>\n` +
    `🔗 <a href="${link}">View on Polymarket</a>`;
  await sendTelegramMessage(msg);
}

export async function notifySell(
  coin: string,
  side: "UP" | "DOWN",
  shares: number,
  price: number,
  buyPrice: number,
  slug: string,
): Promise<void> {
  const link = `${POLYMARKET_BASE_URL}/${slug}`;
  const pnl = (price - buyPrice) * shares;
  const pnlPct = buyPrice > 0 ? ((price - buyPrice) / buyPrice * 100) : 0;
  const pnlEmoji = pnl >= 0 ? "📈" : "📉";
  const msg =
    `🔴 <b>SELL ${side}</b> — ${coin}\n` +
    `📦 Shares: <b>${shares.toFixed(2)}</b>\n` +
    `📊 Sell Price: <b>${price.toFixed(3)}</b> (bought at ${buyPrice.toFixed(3)})\n` +
    `${pnlEmoji} PnL: <b>${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}</b> (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)\n` +
    `🔗 <a href="${link}">View on Polymarket</a>`;
  await sendTelegramMessage(msg);
}

export async function notifySettlement(
  coin: string,
  side: "UP" | "DOWN",
  shares: number,
  slug: string,
): Promise<void> {
  const link = `${POLYMARKET_BASE_URL}/${slug}`;
  const msg =
    `⏰ <b>MARKET ENDED</b> — ${coin}\n` +
    `📦 Holding: <b>${shares.toFixed(2)} ${side}</b> tokens\n` +
    `💡 Tokens will auto-settle. Claim on Polymarket if needed.\n` +
    `🔗 <a href="${link}">Claim on Polymarket</a>`;
  await sendTelegramMessage(msg);
}

export async function notifyBalance(
  totalUsd: number,
): Promise<void> {
  const msg =
    `💼 <b>Portfolio Update</b>\n` +
    `💰 Total Balance: <b>$${totalUsd.toFixed(2)}</b>`;
  await sendTelegramMessage(msg);
}

export async function notifyError(
  coin: string,
  action: string,
  error: string,
): Promise<void> {
  const msg =
    `⚠️ <b>ERROR</b> — ${coin}\n` +
    `Action: ${action}\n` +
    `Error: <code>${error.slice(0, 200)}</code>`;
  await sendTelegramMessage(msg);
}
