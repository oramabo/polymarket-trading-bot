import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { writeFileSync } from "node:fs";
import { ConfigSchema } from "./config/toml.js";
import { dbSaveConfig, dbGetTrades } from "./services/db.js";
import { botState } from "./state.js";

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) && target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function configToToml(c: any): string {
  const lines: string[] = [];
  lines.push(`strategy = "${c.strategy}"`);
  lines.push(`trade_usd = ${c.trade_usd}`);
  lines.push(`max_retries = ${c.max_retries}`);
  lines.push('');
  lines.push('[market]');
  lines.push(`market_coins = [${c.market.market_coins.map((x: string) => `"${x}"`).join(', ')}]`);
  lines.push(`market_period = "${c.market.market_period}"`);
  if (c.market.btc_period) lines.push(`btc_period = "${c.market.btc_period}"`);
  lines.push('');
  lines.push('[trade_1]');
  lines.push(`entry_price_range = [${c.trade_1.entry_price_range.join(', ')}]`);
  lines.push(`swap_price_range = [${c.trade_1.swap_price_range.join(', ')}]`);
  lines.push(`take_profit = ${c.trade_1.take_profit}`);
  lines.push(`stop_loss = ${c.trade_1.stop_loss}`);
  lines.push(`exit_time_ratio = ${c.trade_1.exit_time_ratio}`);
  lines.push(`exit_price_ratio = ${c.trade_1.exit_price_ratio}`);
  lines.push('');
  lines.push('[trade_2]');
  lines.push(`entry_price_ratio = [${c.trade_2.entry_price_ratio.join(', ')}]`);
  lines.push(`entry_time_ratio = ${c.trade_2.entry_time_ratio}`);
  lines.push(`max_entry_time_ratio = ${c.trade_2.max_entry_time_ratio}`);
  lines.push(`exit_price_ratio_range = [[${c.trade_2.exit_price_ratio_range[0].join(', ')}], [${c.trade_2.exit_price_ratio_range[1].join(', ')}]]`);
  if (c.trade_2.emergency_swap_price) lines.push(`emergency_swap_price = [${c.trade_2.emergency_swap_price.join(', ')}]`);
  lines.push(`trailing_stop_pct = ${c.trade_2.trailing_stop_pct}`);
  lines.push(`stop_loss_pct = ${c.trade_2.stop_loss_pct}`);
  lines.push(`take_profit_ratio = ${c.trade_2.take_profit_ratio}`);
  lines.push(`min_signal_strength = ${c.trade_2.min_signal_strength}`);
  lines.push(`position_scale = ${c.trade_2.position_scale}`);
  lines.push(`allow_reentry = ${c.trade_2.allow_reentry}`);
  lines.push(`max_reentries = ${c.trade_2.max_reentries}`);
  lines.push('');
  return lines.join('\n');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function getConfigJson(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(globalThis.__CONFIG__));
}

async function postConfig(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = await readBody(req);
    const partial = JSON.parse(body);
    const merged = deepMerge(globalThis.__CONFIG__, partial);
    const validated = ConfigSchema.parse(merged);
    globalThis.__CONFIG__ = validated;

    // Persist to trade.toml so changes survive restarts
    try {
      const toml = configToToml(validated);
      writeFileSync("trade.toml", toml, "utf-8");
    } catch (e) {
      console.error("Failed to save trade.toml:", e);
    }

    // Save config snapshot to PostgreSQL
    dbSaveConfig(validated).catch(() => {});

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, config: validated }));
  } catch (err: any) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
  }
}

function getPositions(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(Array.from(botState.positions.values())));
}

async function getTrades(_req: IncomingMessage, res: ServerResponse) {
  let trades = botState.trades;
  if (trades.length === 0) {
    try {
      const result = await dbGetTrades({ limit: 50 });
      trades = result.rows.map((t: any) => ({
        coin: t.coin, side: t.side, action: t.action,
        price: parseFloat(t.price), amount: parseFloat(t.amount),
        shares: parseFloat(t.shares), pnl: parseFloat(t.pnl),
        reason: t.reason || "", timestamp: new Date(t.created_at).getTime(),
      }));
    } catch (e) {}
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(trades));
}

function getStats(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(botState.stats));
}

function getStatus(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: botState.botStatus,
    paused: botState.paused,
    uptime: Math.floor((Date.now() - botState.startedAt) / 1000),
    coins: Array.from(botState.positions.keys()),
    lastUpdates: Object.fromEntries(botState.lastPriceUpdate),
  }));
}

function getLogs(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(botState.logs));
}

async function postControl(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const { action } = JSON.parse(body);
  if (action === "pause") {
    botState.paused = true;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, paused: true }));
  } else if (action === "resume") {
    botState.paused = false;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, paused: false }));
  } else {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "unknown action" }));
  }
}

function serveDashboard(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(DASHBOARD_HTML);
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Polymarket Bot</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh}
header{background:#161b22;border-bottom:1px solid #30363d;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
header h1{font-size:18px;color:#58a6ff}
.status{font-size:12px;padding:3px 10px;border-radius:12px;background:#1f6feb33;color:#58a6ff}
.container{max-width:900px;margin:20px auto;padding:0 12px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:16px;margin-bottom:14px}
.card h2{font-size:14px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;border-bottom:1px solid #21262d;padding-bottom:6px}
.card-desc{font-size:12px;color:#484f58;margin-bottom:12px;line-height:1.4}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px}
.field{display:flex;flex-direction:column}
.field label{font-size:11px;color:#8b949e;margin-bottom:3px;display:inline-flex;align-items:center;gap:4px}
.field input,.field select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:7px 9px;border-radius:6px;font-size:13px;width:100%}
.field input:focus,.field select:focus{outline:none;border-color:#58a6ff}
.coins{display:flex;gap:8px;flex-wrap:wrap}
.coins label{display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;padding:5px 10px;background:#21262d;border-radius:6px;border:1px solid #30363d}
.coins input:checked+span{color:#58a6ff;font-weight:600}
.tuple{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.tuple-group{margin-bottom:10px}
.tuple-group>label{font-size:11px;color:#8b949e;margin-bottom:3px;display:inline-flex;align-items:center;gap:4px}
.btn{background:#238636;color:#fff;border:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;width:100%}
.btn:hover{background:#2ea043}
.btn:disabled{opacity:.5;cursor:not-allowed}
.msg{text-align:center;margin-top:10px;font-size:12px;min-height:18px}
.msg.ok{color:#3fb950}
.msg.err{color:#f85149}
.note{font-size:11px;color:#6e7681;margin-top:6px;font-style:italic}
.info-banner{padding:8px 12px;border-radius:6px;font-size:12px;line-height:1.4;margin-bottom:12px}
.info-t1{background:#1f6feb15;border:1px solid #1f6feb33;color:#79c0ff}
.info-t2{background:#23863615;border:1px solid #23863633;color:#7ee787}
.stats-row{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:14px}
.stat{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;text-align:center}
.stat .sv{font-size:22px;font-weight:700;margin-bottom:2px}
.stat .sl{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px}
.positions-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}
.position-card{background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:12px}
.position-card .cn{font-size:15px;font-weight:700;color:#e6edf3;margin-bottom:4px;text-transform:uppercase}
.side-badge{display:inline-block;font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;margin-bottom:6px}
.side-up{background:#23863633;color:#3fb950}
.side-down{background:#f8514933;color:#f85149}
.side-none{background:#30363d;color:#8b949e}
.position-card .dt{font-size:11px;color:#8b949e;margin-bottom:2px;display:flex;justify-content:space-between}
.position-card .dt span{color:#c9d1d9}
.pnl-pos{color:#3fb950}
.pnl-neg{color:#f85149}
.sig-bar{height:4px;background:#21262d;border-radius:2px;margin-top:6px;overflow:hidden}
.sig-bar .fill{height:100%;border-radius:2px;background:#58a6ff;transition:width .3s}
.tt{width:100%;border-collapse:collapse;font-size:12px}
.tt th{text-align:left;font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;padding:6px 5px;border-bottom:1px solid #21262d}
.tt td{padding:5px;border-bottom:1px solid #161b22}
.tt tr:hover{background:#161b2280}
.a-buy{color:#3fb950;font-weight:600}
.a-sell{color:#f85149;font-weight:600}
.a-settle{color:#d29922;font-weight:600}
.toggle{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0}
.toggle .sl{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#21262d;border:1px solid #30363d;border-radius:10px;transition:.2s}
.toggle .sl:before{content:"";position:absolute;height:14px;width:14px;left:2px;bottom:2px;background:#8b949e;border-radius:50%;transition:.2s}
.toggle input:checked+.sl{background:#238636;border-color:#238636}
.toggle input:checked+.sl:before{transform:translateX(16px);background:#fff}
.tf{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.tf .tl{font-size:11px;color:#8b949e;cursor:help;border-bottom:1px dotted #484f58}
.help{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:#21262d;border:1px solid #30363d;color:#8b949e;font-size:10px;cursor:pointer;flex-shrink:0;font-weight:700;line-height:1}
.help:active{background:#30363d}
.help-pop{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);background:#161b22;border:1px solid #58a6ff;border-radius:8px;padding:16px;max-width:320px;width:90%;z-index:1000;font-size:13px;color:#c9d1d9;line-height:1.5;box-shadow:0 8px 24px #00000080}
.help-pop.show{display:block}
.help-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:#00000060;z-index:999}
.help-overlay.show{display:block}
.help-pop b{color:#58a6ff}
.risk-row{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.risk-btn{flex:1;min-width:80px;padding:10px;border-radius:8px;border:1px solid #30363d;background:#0d1117;color:#8b949e;cursor:pointer;text-align:center;font-size:13px;font-weight:600;transition:.2s}
.risk-btn:hover{border-color:#58a6ff;color:#c9d1d9}
.risk-btn.active{border-width:2px}
.risk-low{border-color:#3fb950;color:#3fb950;background:#3fb95010}
.risk-med{border-color:#d29922;color:#d29922;background:#d2992210}
.risk-high{border-color:#f85149;color:#f85149;background:#f8514910}
.risk-desc{font-size:11px;color:#484f58;margin-bottom:10px}
.hint{font-size:10px;color:#6e7681;margin-top:3px;line-height:1.4}
.section-label{font-size:12px;font-weight:600;padding:6px 10px;border-radius:4px;margin-bottom:10px;display:inline-block}
.sl-buy{background:#23863620;color:#3fb950}
.sl-sell{background:#d2992220;color:#d29922}
.sl-risk{background:#f8514920;color:#f85149}
.empty{text-align:center;padding:20px;color:#484f58;font-size:13px}
.updated{font-size:10px;color:#484f58;text-align:right;margin-top:6px}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
@media(max-width:768px){
  .stats-row{grid-template-columns:1fr 1fr}
  .row,.row3{grid-template-columns:1fr}
  .positions-grid{grid-template-columns:1fr}
  .stat .sv{font-size:18px}
  header h1{font-size:16px}
.conn-bar{padding:8px 16px;font-size:12px;text-align:center;font-weight:600;transition:.3s}
.conn-ok{background:#23863620;color:#3fb950}
.conn-err{background:#f8514920;color:#f85149}
.conn-wait{background:#d2992220;color:#d29922}
.pulse{animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
}
</style>
</head>
<body>
<header>
<h1>Polymarket Bot</h1>
<span class="status" id="sBadge">--</span>
</header>
<div style="display:flex;align-items:center;gap:8px;padding:8px 16px;background:#161b22;border-bottom:1px solid #30363d">
<div class="conn-bar conn-wait pulse" id="connBar" style="flex:1;border-radius:6px;margin:0">Connecting...</div>
<button id="ctrlBtn" onclick="toggleBot()" style="padding:6px 16px;border-radius:6px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">Pause Bot</button>
</div>
<div class="container">

<div class="stats-row">
<div class="stat"><div class="sv" id="sPnl">$0.00</div><div class="sl">Total P&L</div></div>
<div class="stat"><div class="sv" id="sWR">0%</div><div class="sl">Win Rate</div></div>
<div class="stat"><div class="sv" id="sTT">0</div><div class="sl">Trades</div></div>
<div class="stat"><div class="sv" id="sWL">0/0</div><div class="sl">W/L</div></div>
</div>

<div class="help-overlay" id="hOverlay" onclick="closeHelp()"></div>
<div class="help-pop" id="hPop"><span id="hText"></span></div>

<div class="card">
<h2>Live Positions</h2>
<p class="card-desc">Real-time view of active positions across all coins. Updates every 2 seconds.</p>
<div class="positions-grid" id="pGrid"><div class="empty">Waiting for data...</div></div>
<div class="updated" id="pUpd"></div>
</div>

<div class="card">
<h2>Trade History</h2>
<p class="card-desc">Recent buy/sell activity with profit/loss tracking. Use filters to search DB history.</p>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:end">
<div class="field" style="flex:1;min-width:80px"><label>Coin</label><select id="hCoin" onchange="loadHistory()"><option value="">All</option><option value="BTC">BTC</option><option value="ETH">ETH</option><option value="SOL">SOL</option><option value="XRP">XRP</option></select></div>
<div class="field" style="flex:1;min-width:110px"><label>From</label><input type="date" id="hFrom" onchange="loadHistory()"></div>
<div class="field" style="flex:1;min-width:110px"><label>To</label><input type="date" id="hTo" onchange="loadHistory()"></div>
</div>
<div class="tbl-wrap" id="tWrap"><div class="empty">No trades yet</div></div>
<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
<span style="font-size:11px;color:#484f58" id="hInfo">-</span>
<div style="display:flex;gap:6px">
<button onclick="hPage(-1)" style="padding:4px 10px;border-radius:4px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;font-size:11px;cursor:pointer" id="hPrev" disabled>&lt; Prev</button>
<button onclick="hPage(1)" style="padding:4px 10px;border-radius:4px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;font-size:11px;cursor:pointer" id="hNext">Next &gt;</button>
</div>
</div>
</div>

<div class="card">
<h2>Console Logs</h2>
<p class="card-desc">Live console output from the bot. Errors highlighted in red.</p>
<div id="logWrap" style="max-height:300px;overflow-y:auto;background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:8px;font-family:monospace;font-size:11px;line-height:1.6">
<div class="empty">Waiting for logs...</div>
</div>
</div>

<div class="card">
<h2>Risk Profile</h2>
<p class="card-desc">Quick presets that auto-fill all Trade 2 parameters. Select one, then customize below if needed.</p>
<div class="risk-row">
<div class="risk-btn" onclick="setRisk('low')">Conservative</div>
<div class="risk-btn" onclick="setRisk('med')">Balanced</div>
<div class="risk-btn" onclick="setRisk('high')">Aggressive</div>
</div>
<div class="risk-desc" id="rDesc">Select a profile to auto-fill settings.</div>
</div>

<div class="card">
<h2>General</h2>
<p class="card-desc">Core bot settings. Strategy determines the trading algorithm used.</p>
<div class="row3">
<div class="field">
<label>Strategy <span class="help" onclick="hp('trade_1: Simple exit by time/price ratio. trade_2: Advanced signal-based with trailing stop, stop-loss, take-profit, and position sizing.')">?</span></label>
<select id="strategy"><option value="trade_1">trade_1 (Simple)</option><option value="trade_2">trade_2 (Smart)</option></select>
<div class="hint">trade_1 = basic time/price exits. trade_2 = smart signals with risk management (recommended).</div>
</div>
<div class="field">
<label>Budget per Trade ($)</label>
<input type="number" id="trade_usd" step="0.5" min="0.5">
<div class="hint">How much money to bet on each trade. The bot may use less if the signal is weak (when Position Scale is on).</div>
</div>
<div class="field">
<label>Max Retries <span class="help" onclick="hp('Times to retry a failed order before giving up.')">?</span></label>
<input type="number" id="max_retries" step="1" min="1">
</div>
</div>
<div id="stratInfo"></div>
</div>

<div class="card">
<h2>Markets</h2>
<p class="card-desc">Configure which coins to trade and their market timeframes.</p>
<div class="field" style="margin-bottom:10px">
<label >Active Coins <span class="help" onclick="hp('Select coins to trade. Changing this requires a restart.')">?</span></label>
<div class="coins">
<label><input type="checkbox" value="btc" class="ccb"><span>BTC</span></label>
<label><input type="checkbox" value="eth" class="ccb"><span>ETH</span></label>
<label><input type="checkbox" value="sol" class="ccb"><span>SOL</span></label>
<label><input type="checkbox" value="xrp" class="ccb"><span>XRP</span></label>
</div>
</div>
<div class="row">
<div class="field">
<label >Default Period <span class="help" onclick="hp('Market window length. Shorter = more trades. 5m only works for BTC.')">?</span></label>
<select id="mp"><option value="5">5m</option><option value="15">15m</option><option value="60">1h</option><option value="240">4h</option><option value="1440">1d</option></select>
</div>
<div class="field">
<label >BTC Period <span class="help" onclick="hp('Override period for BTC. BTC supports 5m markets, others start at 15m.')">?</span></label>
<select id="bp"><option value="">Use default</option><option value="5">5m</option><option value="15">15m</option><option value="60">1h</option><option value="240">4h</option><option value="1440">1d</option></select>
</div>
</div>
<p class="note">Coin list changes take effect on restart.</p>
</div>

<div class="card" id="t1c">
<h2>Trade 1 Settings</h2>
<p class="card-desc">Simple strategy: exits based on time elapsed or price ratio threshold.</p>
<div class="tuple-group"><label >Entry Price Range <span class="help" onclick="hp('Price range for entry. Both values 0-1.')">?</span></label><div class="tuple"><input type="number" id="t1em" step="0.01"><input type="number" id="t1ex" step="0.01"></div></div>
<div class="tuple-group"><label >Swap Price Range <span class="help" onclick="hp('Price range for swap. Both values 0-1.')">?</span></label><div class="tuple"><input type="number" id="t1sm" step="0.01"><input type="number" id="t1sx" step="0.01"></div></div>
<div class="row">
<div class="field"><label >Take Profit <span class="help" onclick="hp('Take profit multiplier.')">?</span></label><input type="number" id="t1tp" step="0.1"></div>
<div class="field"><label >Stop Loss <span class="help" onclick="hp('Stop loss multiplier.')">?</span></label><input type="number" id="t1sl" step="0.1"></div>
</div>
<div class="row">
<div class="field"><label >Exit Time Ratio <span class="help" onclick="hp('Sell when this fraction of time passes. 0.95 = sell after 95% elapsed.')">?</span></label><input type="number" id="t1et" step="0.01"></div>
<div class="field"><label >Exit Price Ratio <span class="help" onclick="hp('Sell when price ratio exceeds this.')">?</span></label><input type="number" id="t1ep" step="0.01"></div>
</div>
</div>

<div class="card" id="t2c">
<h2>Trade 2 Settings</h2>
<p class="card-desc">Advanced signal-based strategy with momentum scoring, trailing stops, and risk management.</p>
<span class="section-label sl-buy">When to Buy</span>
<div class="tuple-group"><label>Price Movement Range [min, max]</label><div class="tuple"><input type="number" id="t2em" step="0.01"><input type="number" id="t2ex" step="0.01"></div><div class="hint">How much must the price move from 50/50 before buying. Left = minimum move (0.2 = small move enough). Right = maximum (0.95 = almost decided). Wider range = more trades.</div></div>
<div class="row">
<div class="field"><label>Wait Before Buying</label><input type="number" id="t2et" step="0.01"><div class="hint">Wait this % of the market before buying. 0.4 means wait 2 min in a 5-min market. Gives time to see the trend.</div></div>
<div class="field"><label>Stop Buying After</label><input type="number" id="t2met" step="0.01"><div class="hint">Don't buy after this point. 0.85 = stop buying in the last 15%. Too late to make profit.</div></div>
</div>
<div class="field" style="margin-bottom:12px"><label>Minimum Confidence</label><input type="number" id="t2ms" step="0.01"><div class="hint">The bot scores each opportunity 0-1. Only buys when score is above this. Higher = fewer trades but better quality. Try 0.3 for more trades, 0.5+ for safer picks.</div></div>
<div class="tuple-group"><label >Exit Range 1 <span class="help" onclick="hp('Legacy. Set to [1.0, 1.0] to disable. Use trailing stop instead.')">?</span></label><div class="tuple"><input type="number" id="t2e1m" step="0.01"><input type="number" id="t2e1x" step="0.01"></div></div>
<div class="tuple-group"><label >Exit Range 2 <span class="help" onclick="hp('Legacy. Set to [1.0, 1.0] to disable.')">?</span></label><div class="tuple"><input type="number" id="t2e2m" step="0.01"><input type="number" id="t2e2x" step="0.01"></div></div>
<div class="tuple-group"><label >Emergency Swap <span class="help" onclick="hp('Legacy. Set to [1.0, 1.0] to disable.')">?</span></label><div class="tuple"><input type="number" id="t2esm" step="0.01"><input type="number" id="t2esx" step="0.01"></div></div>
<span class="section-label sl-sell">When to Sell</span>
<div class="field" style="margin-bottom:10px"><label>Trailing Stop</label><input type="number" id="t2ts" step="0.01"><div class="hint">If your position is winning and then drops this much from its best price, sell to protect profit. Example: 0.15 = sell if it drops 15% from peak. Set to 0.99 to never sell early (let the market decide).</div></div>
<div class="field" style="margin-bottom:10px"><label>Stop Loss</label><input type="number" id="t2slp" step="0.01"><div class="hint">Maximum loss you'll accept before cutting the position. Example: 0.30 = sell if losing 30%. Set to 0.99 to hold through any loss and let the market resolve.</div></div>
<div class="field" style="margin-bottom:10px"><label>Take Profit</label><input type="number" id="t2tpr" step="0.01"><div class="hint">Sell when the market is this decided. 0.98 = only sell when almost certain (basically hold to end). 0.70 = sell earlier when 70% decided. Lower = take smaller but safer profits.</div></div>
<div class="row">
<div class="field"><label >Max Reentries <span class="help" onclick="hp('Max buy/sell cycles per market when re-entry is enabled.')">?</span></label><input type="number" id="t2mr" step="1" min="0"></div>
<div class="field"></div>
</div>
<div class="tf">
<label class="toggle"><input type="checkbox" id="t2ps"><span class="sl"></span></label>
<span class="tl">Position Scale</span>
</div>
<div class="hint" style="margin:-6px 0 10px 44px">When ON, the bot bets more on strong signals and less on weak ones. When OFF, always bets the full budget.</div>
<div class="tf">
<label class="toggle"><input type="checkbox" id="t2ar"><span class="sl"></span></label>
<span class="tl">Allow Re-entry</span>
</div>
<div class="hint" style="margin:-6px 0 10px 44px">When ON, the bot can buy again after selling in the same market window. When OFF, only one trade per market.</div>
</div>

<button class="btn" id="saveBtn" onclick="save()">Save Settings</button>
<div class="msg" id="msg"></div>
</div>

<script>
const $=id=>document.getElementById(id);
function hp(text){$('hText').textContent=text;$('hPop').classList.add('show');$('hOverlay').classList.add('show')}
function closeHelp(){$('hPop').classList.remove('show');$('hOverlay').classList.remove('show')}
const RISK_PROFILES={
low:{trailing_stop_pct:0.99,stop_loss_pct:0.99,take_profit_ratio:0.98,min_signal_strength:0.55,entry_time_ratio:0.5,max_entry_time_ratio:0.80,position_scale:true,allow_reentry:false,max_reentries:1,desc:'Conservative: Strict entry signals, holds to market resolution. Best for binary markets.'},
med:{trailing_stop_pct:0.99,stop_loss_pct:0.99,take_profit_ratio:0.98,min_signal_strength:0.45,entry_time_ratio:0.4,max_entry_time_ratio:0.85,position_scale:true,allow_reentry:false,max_reentries:2,desc:'Balanced: Moderate entry criteria, holds to resolution. Good default.'},
high:{trailing_stop_pct:0.40,stop_loss_pct:0.50,take_profit_ratio:0.90,min_signal_strength:0.3,entry_time_ratio:0.3,max_entry_time_ratio:0.90,position_scale:true,allow_reentry:true,max_reentries:3,desc:'Aggressive: Enters early, has active exit logic. More trades but more risk.'}
};
function setRisk(level){
const p=RISK_PROFILES[level];if(!p)return;
$('t2ts').value=p.trailing_stop_pct;$('t2slp').value=p.stop_loss_pct;$('t2tpr').value=p.take_profit_ratio;
$('t2ms').value=p.min_signal_strength;$('t2et').value=p.entry_time_ratio;$('t2met').value=p.max_entry_time_ratio;
$('t2ps').checked=p.position_scale;$('t2ar').checked=p.allow_reentry;$('t2mr').value=p.max_reentries;
$('rDesc').textContent=p.desc;
document.querySelectorAll('.risk-btn').forEach((b,i)=>{b.className='risk-btn';});
const cls={low:'risk-low active',med:'risk-med active',high:'risk-high active'};
const idx={low:0,med:1,high:2};
document.querySelectorAll('.risk-btn')[idx[level]].className='risk-btn '+cls[level];
}
function tAgo(ts){const d=Math.floor((Date.now()-ts)/1000);if(d<60)return d+'s ago';if(d<3600)return Math.floor(d/60)+'m ago';return Math.floor(d/3600)+'h ago'}
function fP(v){return(v>=0?'+':'')+('$'+v.toFixed(2))}

async function rStats(){
try{const r=await fetch('/api/stats');const s=await r.json();
const e=$('sPnl');e.textContent=fP(s.totalPnl);e.className='sv '+(s.totalPnl>=0?'pnl-pos':'pnl-neg');
const t=s.wins+s.losses;$('sWR').textContent=t>0?Math.round(s.wins/t*100)+'%':'0%';
$('sTT').textContent=s.totalTrades;$('sWL').textContent=s.wins+'/'+s.losses;
}catch(e){}}

async function rPos(){
try{const r=await fetch('/api/positions');const ps=await r.json();const g=$('pGrid');
if(!ps.length){g.innerHTML='<div class="empty">No position data yet. The bot needs to connect and start a market cycle (up to 5-15 min).</div>';return}
g.innerHTML=ps.map(p=>{
const sc=p.side==='UP'?'side-up':p.side==='DOWN'?'side-down':'side-none';
const pc=p.unrealizedPnl>=0?'pnl-pos':'pnl-neg';
const st=Math.max(0,Math.min(100,Math.round((p.signalStrength||0)*100)));
const label=p.side==='NONE'?'Watching':'Holding '+p.side;
return '<div class="position-card">'+
'<div class="cn">'+p.coin+'</div>'+
'<span class="side-badge '+sc+'">'+label+'</span>'+
(p.entryPrice>0?'<div class="dt">Entry <span>$'+p.entryPrice.toFixed(3)+'</span></div>':'')+
'<div class="dt">Price <span>$'+p.currentPrice.toFixed(3)+'</span></div>'+
(p.shares>0?'<div class="dt">Shares <span>'+p.shares.toFixed(2)+'</span></div>':'')+
(p.side!=='NONE'?'<div class="dt">uPnL <span class="'+pc+'">'+fP(p.unrealizedPnl)+'</span></div>':'')+
'<div class="sig-bar"><div class="fill" style="width:'+st+'%"></div></div>'+
'</div>'}).join('');
$('pUpd').textContent='Updated '+tAgo(Date.now());
}catch(e){$('pGrid').innerHTML='<div class="empty">Connection error</div>'}}

let hOffset=0;const hLimit=15;let hTotal=0;
function renderTrades(trades,w){
if(!trades.length){w.innerHTML='<div class="empty">No trades found</div>';return}
let h='<table class="tt"><thead><tr><th>Date</th><th>Coin</th><th>Action</th><th>Side</th><th>Price</th><th>PnL</th><th>Reason</th></tr></thead><tbody>';
for(const t of trades){const ac=t.action==='BUY'?'a-buy':t.action==='SELL'?'a-sell':'a-settle';
const pc=t.pnl>=0?'pnl-pos':'pnl-neg';
const ts=t.created_at?new Date(t.created_at).toLocaleString():tAgo(t.timestamp);
const price=typeof t.price==='string'?parseFloat(t.price):t.price;
const pnl=typeof t.pnl==='string'?parseFloat(t.pnl):t.pnl;
h+='<tr><td style="white-space:nowrap;font-size:10px">'+ts+'</td><td style="font-weight:600;text-transform:uppercase">'+t.coin+'</td><td class="'+ac+'">'+t.action+'</td><td>'+t.side+'</td><td>$'+price.toFixed(3)+'</td><td class="'+pc+'">'+fP(pnl)+'</td><td style="color:#8b949e;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(t.reason||'-')+'</td></tr>'}
h+='</tbody></table>';w.innerHTML=h}

async function loadHistory(){
hOffset=0;await rTrades()}

async function rTrades(){
const w=$('tWrap');
try{
const coin=$('hCoin').value;const from=$('hFrom').value;const to=$('hTo').value;
const params=new URLSearchParams({limit:String(hLimit),offset:String(hOffset)});
if(coin)params.set('coin',coin);if(from)params.set('from',from);if(to)params.set('to',to);
const r=await fetch('/api/trades/history?'+params);const data=await r.json();
if(data.rows){hTotal=data.total;renderTrades(data.rows,w);
const page=Math.floor(hOffset/hLimit)+1;const pages=Math.ceil(hTotal/hLimit)||1;
$('hInfo').textContent='Showing '+(hOffset+1)+'-'+Math.min(hOffset+hLimit,hTotal)+' of '+hTotal+' (page '+page+'/'+pages+')';
$('hPrev').disabled=hOffset<=0;$('hNext').disabled=hOffset+hLimit>=hTotal}
else{const ts=Array.isArray(data)?data:[];renderTrades(ts,w);$('hInfo').textContent=ts.length+' trades (in-memory)'}
}catch(e){w.innerHTML='<div class="empty">Connection error</div>'}}

function hPage(dir){hOffset=Math.max(0,hOffset+dir*hLimit);rTrades()}

function showStrat(s){
$('t1c').style.display=s==='trade_1'?'block':'none';
$('t2c').style.display=s==='trade_2'?'block':'none';
const info=$('stratInfo');
if(s==='trade_1')info.innerHTML='<div class="info-banner info-t1">Simple exit strategy. Sells when time or price ratio exceeds configured thresholds.</div>';
else info.innerHTML='<div class="info-banner info-t2">Advanced signal-based strategy. Uses momentum analysis, trailing stops, stop-losses, and take-profit targets.</div>';
}
$('strategy').addEventListener('change',e=>showStrat(e.target.value));

function pop(c){
$('strategy').value=c.strategy;$('sBadge').textContent=c.strategy;
$('trade_usd').value=c.trade_usd;$('max_retries').value=c.max_retries;
document.querySelectorAll('.ccb').forEach(cb=>{cb.checked=c.market.market_coins.includes(cb.value)});
$('mp').value=c.market.market_period;$('bp').value=c.market.btc_period||'';
$('t1em').value=c.trade_1.entry_price_range[0];$('t1ex').value=c.trade_1.entry_price_range[1];
$('t1sm').value=c.trade_1.swap_price_range[0];$('t1sx').value=c.trade_1.swap_price_range[1];
$('t1tp').value=c.trade_1.take_profit;$('t1sl').value=c.trade_1.stop_loss;
$('t1et').value=c.trade_1.exit_time_ratio;$('t1ep').value=c.trade_1.exit_price_ratio;
$('t2em').value=c.trade_2.entry_price_ratio[0];$('t2ex').value=c.trade_2.entry_price_ratio[1];
$('t2et').value=c.trade_2.entry_time_ratio;$('t2met').value=c.trade_2.max_entry_time_ratio??'';
$('t2e1m').value=c.trade_2.exit_price_ratio_range[0][0];$('t2e1x').value=c.trade_2.exit_price_ratio_range[0][1];
$('t2e2m').value=c.trade_2.exit_price_ratio_range[1][0];$('t2e2x').value=c.trade_2.exit_price_ratio_range[1][1];
$('t2esm').value=c.trade_2.emergency_swap_price?.[0]??'';$('t2esx').value=c.trade_2.emergency_swap_price?.[1]??'';
$('t2ts').value=c.trade_2.trailing_stop_pct??'';$('t2slp').value=c.trade_2.stop_loss_pct??'';
$('t2tpr').value=c.trade_2.take_profit_ratio??'';$('t2ms').value=c.trade_2.min_signal_strength??'';
$('t2ps').checked=!!c.trade_2.position_scale;$('t2ar').checked=!!c.trade_2.allow_reentry;
$('t2mr').value=c.trade_2.max_reentries??'';
showStrat(c.strategy);
}

function col(){
const coins=[...document.querySelectorAll('.ccb:checked')].map(c=>c.value);
const mkt={market_coins:coins,market_period:$('mp').value};
if($('bp').value)mkt.btc_period=$('bp').value;
return{strategy:$('strategy').value,trade_usd:parseFloat($('trade_usd').value),max_retries:parseInt($('max_retries').value),market:mkt,
trade_1:{entry_price_range:[parseFloat($('t1em').value),parseFloat($('t1ex').value)],swap_price_range:[parseFloat($('t1sm').value),parseFloat($('t1sx').value)],take_profit:parseFloat($('t1tp').value),stop_loss:parseFloat($('t1sl').value),exit_time_ratio:parseFloat($('t1et').value),exit_price_ratio:parseFloat($('t1ep').value)},
trade_2:{entry_price_ratio:[parseFloat($('t2em').value),parseFloat($('t2ex').value)],entry_time_ratio:parseFloat($('t2et').value),max_entry_time_ratio:parseFloat($('t2met').value),exit_price_ratio_range:[[parseFloat($('t2e1m').value),parseFloat($('t2e1x').value)],[parseFloat($('t2e2m').value),parseFloat($('t2e2x').value)]],emergency_swap_price:[parseFloat($('t2esm').value),parseFloat($('t2esx').value)],trailing_stop_pct:parseFloat($('t2ts').value),stop_loss_pct:parseFloat($('t2slp').value),take_profit_ratio:parseFloat($('t2tpr').value),min_signal_strength:parseFloat($('t2ms').value),position_scale:$('t2ps').checked,allow_reentry:$('t2ar').checked,max_reentries:parseInt($('t2mr').value)}
}}

async function loadConfig(){try{const r=await fetch('/api/config');const c=await r.json();pop(c)}catch(e){$('msg').className='msg err';$('msg').textContent='Failed to load config'}}

async function save(){
const b=$('saveBtn');b.disabled=true;b.textContent='Saving...';
try{const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(col())});
const d=await r.json();
if(d.ok){$('msg').className='msg ok';$('msg').textContent='Saved! Changes take effect immediately.';$('sBadge').textContent=$('strategy').value}
else{$('msg').className='msg err';$('msg').textContent='Error: '+d.error}
}catch(e){$('msg').className='msg err';$('msg').textContent='Save failed: '+e.message}
b.disabled=false;b.textContent='Save Settings';setTimeout(()=>{$('msg').textContent=''},5000)}

let isPaused=false;
async function rStatus(){
try{const r=await fetch('/api/status');const s=await r.json();const bar=$('connBar');const btn=$('ctrlBtn');
isPaused=s.paused;
btn.textContent=s.paused?'Resume Bot':'Pause Bot';
btn.style.background=s.paused?'#238636':'#21262d';
btn.style.borderColor=s.paused?'#238636':'#30363d';
if(s.paused){bar.className='conn-bar';bar.style.background='#d2992220';bar.style.color='#d29922';bar.textContent='Bot PAUSED | Uptime: '+Math.floor(s.uptime/60)+'m'}
else if(s.status==='running'){bar.className='conn-bar conn-ok';bar.textContent='Bot running | Uptime: '+Math.floor(s.uptime/60)+'m | Coins: '+(s.coins.length||'starting...')}
else if(s.status==='connecting'){bar.className='conn-bar conn-wait pulse';bar.textContent='Connecting to Polymarket...'}
else if(s.status==='starting'){bar.className='conn-bar conn-wait pulse';bar.textContent='Bot starting...'}
else{bar.className='conn-bar conn-err';bar.textContent='Error: '+s.status}
}catch(e){$('connBar').className='conn-bar conn-err';$('connBar').textContent='Cannot reach bot API'}}

async function toggleBot(){
try{await fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:isPaused?'resume':'pause'})});
rStatus()}catch(e){}}

async function rLogs(){
try{const r=await fetch('/api/logs');const logs=await r.json();const w=$('logWrap');
if(!logs.length){w.innerHTML='<div class="empty">Waiting for logs...</div>';return}
const recent=logs.slice(-80);
w.innerHTML=recent.map(l=>{
const c=l.level==='error'?'#f85149':l.level==='warn'?'#d29922':'#8b949e';
const t=new Date(l.timestamp).toLocaleTimeString();
return '<div style="color:'+c+';word-break:break-all"><span style="color:#484f58">'+t+'</span> '+l.message.replace(/</g,'&lt;')+'</div>'
}).join('');
w.scrollTop=w.scrollHeight;
}catch(e){}}

loadConfig();rStatus();rStats();rPos();rTrades();rLogs();
setInterval(rStatus,3000);setInterval(rStats,2000);setInterval(rPos,2000);setInterval(rTrades,5000);setInterval(rLogs,2000);setInterval(loadConfig,10000);
</script>
</body>
</html>`;

export function startDashboard() {
  const port = process.env.PORT || 3000;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/config" && req.method === "GET") return getConfigJson(req, res);
    if (url.pathname === "/api/config" && req.method === "POST") return postConfig(req, res);
    if (url.pathname === "/api/positions" && req.method === "GET") return getPositions(req, res);
    if (url.pathname === "/api/trades" && req.method === "GET") return getTrades(req, res);
    if (url.pathname === "/api/stats" && req.method === "GET") return getStats(req, res);
    if (url.pathname === "/api/status" && req.method === "GET") return getStatus(req, res);
    if (url.pathname === "/api/logs" && req.method === "GET") return getLogs(req, res);
    if (url.pathname === "/api/control" && req.method === "POST") return postControl(req, res);
    if (url.pathname === "/api/trades/history" && req.method === "GET") {
      const result = await dbGetTrades({
        limit: parseInt(url.searchParams.get("limit") || "20"),
        offset: parseInt(url.searchParams.get("offset") || "0"),
        coin: url.searchParams.get("coin") || undefined,
        dateFrom: url.searchParams.get("from") || undefined,
        dateTo: url.searchParams.get("to") || undefined,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
    if (url.pathname === "/" || url.pathname === "") return serveDashboard(req, res);

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(Number(port), "0.0.0.0", () => {
    console.log(`Dashboard running on 0.0.0.0:${port}`);
  });
}
