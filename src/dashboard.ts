import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { ConfigSchema } from "./config/toml.js";
import { botState } from "./state.js";

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
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

function getTrades(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(botState.trades));
}

function getStats(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(botState.stats));
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
<title>Polymarket Bot Dashboard</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; min-height: 100vh; }
  header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
  header h1 { font-size: 20px; color: #58a6ff; }
  .status { font-size: 13px; padding: 4px 12px; border-radius: 12px; background: #1f6feb33; color: #58a6ff; }
  .container { max-width: 900px; margin: 24px auto; padding: 0 16px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 16px; }
  .card h2 { font-size: 15px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .field { display: flex; flex-direction: column; }
  .field label { font-size: 12px; color: #8b949e; margin-bottom: 4px; }
  .field input, .field select { background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 10px; border-radius: 6px; font-size: 14px; }
  .field input:focus, .field select:focus { outline: none; border-color: #58a6ff; }
  .coins { display: flex; gap: 12px; flex-wrap: wrap; }
  .coins label { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; padding: 6px 12px; background: #21262d; border-radius: 6px; border: 1px solid #30363d; }
  .coins input:checked + span { color: #58a6ff; font-weight: 600; }
  .tuple { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .tuple-group { margin-bottom: 12px; }
  .tuple-group > label { font-size: 12px; color: #8b949e; margin-bottom: 4px; display: block; }
  .btn { background: #238636; color: #fff; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; width: 100%; }
  .btn:hover { background: #2ea043; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .msg { text-align: center; margin-top: 12px; font-size: 13px; min-height: 20px; }
  .msg.ok { color: #3fb950; }
  .msg.err { color: #f85149; }
  .note { font-size: 12px; color: #6e7681; margin-top: 8px; font-style: italic; }

  /* Stats Summary Bar */
  .stats-row { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; text-align: center; }
  .stat .stat-value { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  .stat .stat-label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }

  /* Positions Grid */
  .positions-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .position-card { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 14px; }
  .position-card .coin-name { font-size: 16px; font-weight: 700; color: #e6edf3; margin-bottom: 6px; text-transform: uppercase; }
  .position-card .side-badge { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-bottom: 8px; }
  .side-up { background: #23863633; color: #3fb950; }
  .side-down { background: #f8514933; color: #f85149; }
  .side-none { background: #30363d; color: #8b949e; }
  .position-card .detail { font-size: 12px; color: #8b949e; margin-bottom: 3px; }
  .position-card .detail span { color: #c9d1d9; float: right; }

  /* PnL colors */
  .pnl-positive { color: #3fb950; }
  .pnl-negative { color: #f85149; }

  /* Signal bar */
  .signal-bar { height: 4px; background: #21262d; border-radius: 2px; margin-top: 8px; overflow: hidden; }
  .signal-bar .fill { height: 100%; border-radius: 2px; background: #58a6ff; transition: width 0.3s; }

  /* Trade Table */
  .trade-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .trade-table th { text-align: left; font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 6px; border-bottom: 1px solid #21262d; }
  .trade-table td { padding: 7px 6px; border-bottom: 1px solid #161b22; }
  .trade-table tr:hover { background: #161b2280; }
  .action-buy { color: #3fb950; font-weight: 600; }
  .action-sell { color: #f85149; font-weight: 600; }
  .action-settle { color: #d29922; font-weight: 600; }

  /* Toggle Switch */
  .toggle { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #21262d; border: 1px solid #30363d; border-radius: 11px; transition: 0.2s; }
  .toggle .slider:before { content: ""; position: absolute; height: 16px; width: 16px; left: 2px; bottom: 2px; background: #8b949e; border-radius: 50%; transition: 0.2s; }
  .toggle input:checked + .slider { background: #238636; border-color: #238636; }
  .toggle input:checked + .slider:before { transform: translateX(18px); background: #fff; }
  .toggle-field { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .toggle-field .toggle-label { font-size: 12px; color: #8b949e; }

  .empty-state { text-align: center; padding: 24px; color: #484f58; font-size: 14px; }
</style>
</head>
<body>
<header>
  <h1>Polymarket Bot</h1>
  <span class="status" id="strategyBadge">--</span>
</header>
<div class="container">

  <!-- Stats Summary -->
  <div class="stats-row" id="statsRow">
    <div class="stat">
      <div class="stat-value" id="statPnl">$0.00</div>
      <div class="stat-label">Total P&L</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="statWinRate">0%</div>
      <div class="stat-label">Win Rate</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="statTotalTrades">0</div>
      <div class="stat-label">Total Trades</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="statWinLoss">0 / 0</div>
      <div class="stat-label">Wins / Losses</div>
    </div>
  </div>

  <!-- Live Positions -->
  <div class="card">
    <h2>Live Positions</h2>
    <div class="positions-grid" id="positionsGrid">
      <div class="empty-state">No active positions</div>
    </div>
  </div>

  <!-- Trade History -->
  <div class="card">
    <h2>Trade History</h2>
    <div id="tradeHistoryWrap">
      <div class="empty-state">No trades yet</div>
    </div>
  </div>

  <!-- Config: General -->
  <div class="card">
    <h2>General</h2>
    <div class="row3">
      <div class="field">
        <label>Strategy</label>
        <select id="strategy"><option value="trade_1">trade_1</option><option value="trade_2">trade_2</option></select>
      </div>
      <div class="field">
        <label>Budget (USD)</label>
        <input type="number" id="trade_usd" step="0.5" min="0.5">
      </div>
      <div class="field">
        <label>Max Retries</label>
        <input type="number" id="max_retries" step="1" min="1">
      </div>
    </div>
  </div>

  <!-- Config: Markets -->
  <div class="card">
    <h2>Markets</h2>
    <div class="field" style="margin-bottom:12px">
      <label>Active Coins</label>
      <div class="coins">
        <label><input type="checkbox" value="btc" class="coin-cb"><span>BTC</span></label>
        <label><input type="checkbox" value="eth" class="coin-cb"><span>ETH</span></label>
        <label><input type="checkbox" value="sol" class="coin-cb"><span>SOL</span></label>
        <label><input type="checkbox" value="xrp" class="coin-cb"><span>XRP</span></label>
      </div>
    </div>
    <div class="row">
      <div class="field">
        <label>Default Period</label>
        <select id="market_period">
          <option value="5">5m</option><option value="15">15m</option><option value="60">1h</option><option value="240">4h</option><option value="1440">1d</option>
        </select>
      </div>
      <div class="field">
        <label>BTC Period Override</label>
        <select id="btc_period">
          <option value="">Use default</option><option value="5">5m</option><option value="15">15m</option><option value="60">1h</option><option value="240">4h</option><option value="1440">1d</option>
        </select>
      </div>
    </div>
    <p class="note">Coin list changes take effect on restart.</p>
  </div>

  <!-- Config: Trade 1 -->
  <div class="card" id="trade1_card">
    <h2>Trade 1 Settings</h2>
    <div class="tuple-group">
      <label>Entry Price Range</label>
      <div class="tuple">
        <input type="number" id="t1_entry_min" step="0.01"><input type="number" id="t1_entry_max" step="0.01">
      </div>
    </div>
    <div class="tuple-group">
      <label>Swap Price Range</label>
      <div class="tuple">
        <input type="number" id="t1_swap_min" step="0.01"><input type="number" id="t1_swap_max" step="0.01">
      </div>
    </div>
    <div class="row">
      <div class="field"><label>Take Profit</label><input type="number" id="t1_take_profit" step="0.1"></div>
      <div class="field"><label>Stop Loss</label><input type="number" id="t1_stop_loss" step="0.1"></div>
    </div>
    <div class="row">
      <div class="field"><label>Exit Time Ratio</label><input type="number" id="t1_exit_time" step="0.01"></div>
      <div class="field"><label>Exit Price Ratio</label><input type="number" id="t1_exit_price" step="0.01"></div>
    </div>
  </div>

  <!-- Config: Trade 2 -->
  <div class="card" id="trade2_card">
    <h2>Trade 2 Settings</h2>
    <div class="tuple-group">
      <label>Entry Price Ratio [min, max]</label>
      <div class="tuple">
        <input type="number" id="t2_entry_min" step="0.01"><input type="number" id="t2_entry_max" step="0.01">
      </div>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label>Entry Time Ratio</label>
      <input type="number" id="t2_entry_time" step="0.01">
    </div>
    <div class="tuple-group">
      <label>Exit Price Ratio Range 1 [min, max]</label>
      <div class="tuple">
        <input type="number" id="t2_exit1_min" step="0.01"><input type="number" id="t2_exit1_max" step="0.01">
      </div>
    </div>
    <div class="tuple-group">
      <label>Exit Price Ratio Range 2 [min, max]</label>
      <div class="tuple">
        <input type="number" id="t2_exit2_min" step="0.01"><input type="number" id="t2_exit2_max" step="0.01">
      </div>
    </div>
    <div class="tuple-group">
      <label>Emergency Swap Price [min, max]</label>
      <div class="tuple">
        <input type="number" id="t2_emerg_min" step="0.01"><input type="number" id="t2_emerg_max" step="0.01">
      </div>
    </div>
    <div class="row">
      <div class="field"><label>Max Entry Time Ratio</label><input type="number" id="t2_max_entry_time_ratio" step="0.01"></div>
      <div class="field"><label>Trailing Stop %</label><input type="number" id="t2_trailing_stop_pct" step="0.01"></div>
    </div>
    <div class="row">
      <div class="field"><label>Stop Loss %</label><input type="number" id="t2_stop_loss_pct" step="0.01"></div>
      <div class="field"><label>Take Profit Ratio</label><input type="number" id="t2_take_profit_ratio" step="0.01"></div>
    </div>
    <div class="row">
      <div class="field"><label>Min Signal Strength</label><input type="number" id="t2_min_signal_strength" step="0.01"></div>
      <div class="field"><label>Max Reentries</label><input type="number" id="t2_max_reentries" step="1" min="0"></div>
    </div>
    <div class="toggle-field">
      <label class="toggle"><input type="checkbox" id="t2_position_scale"><span class="slider"></span></label>
      <span class="toggle-label">Position Scale</span>
    </div>
    <div class="toggle-field">
      <label class="toggle"><input type="checkbox" id="t2_allow_reentry"><span class="slider"></span></label>
      <span class="toggle-label">Allow Re-entry</span>
    </div>
  </div>

  <button class="btn" id="saveBtn" onclick="save()">Save Settings</button>
  <div class="msg" id="msg"></div>
</div>

<script>
const $ = id => document.getElementById(id);

/* ---- Time formatting ---- */
function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function fmtPnl(v) {
  const s = v >= 0 ? '+' : '';
  return s + '$' + v.toFixed(2);
}

/* ---- Stats ---- */
async function refreshStats() {
  try {
    const r = await fetch('/api/stats');
    const s = await r.json();
    const pnlEl = $('statPnl');
    pnlEl.textContent = fmtPnl(s.totalPnl);
    pnlEl.className = 'stat-value ' + (s.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative');
    const total = s.wins + s.losses;
    $('statWinRate').textContent = total > 0 ? Math.round((s.wins / total) * 100) + '%' : '0%';
    $('statTotalTrades').textContent = s.totalTrades;
    $('statWinLoss').textContent = s.wins + ' / ' + s.losses;
  } catch(e) {}
}

/* ---- Positions ---- */
async function refreshPositions() {
  try {
    const r = await fetch('/api/positions');
    const positions = await r.json();
    const grid = $('positionsGrid');
    if (!positions.length) {
      grid.innerHTML = '<div class="empty-state">No active positions</div>';
      return;
    }
    grid.innerHTML = positions.map(p => {
      const sideClass = p.side === 'UP' ? 'side-up' : p.side === 'DOWN' ? 'side-down' : 'side-none';
      const pnlClass = p.unrealizedPnl >= 0 ? 'pnl-positive' : 'pnl-negative';
      const strength = Math.max(0, Math.min(100, Math.round(p.signalStrength * 100)));
      return '<div class="position-card">' +
        '<div class="coin-name">' + p.coin + '</div>' +
        '<span class="side-badge ' + sideClass + '">' + p.side + '</span>' +
        '<div class="detail">Entry <span>$' + p.entryPrice.toFixed(4) + '</span></div>' +
        '<div class="detail">Current <span>$' + p.currentPrice.toFixed(4) + '</span></div>' +
        '<div class="detail">uPnL <span class="' + pnlClass + '">' + fmtPnl(p.unrealizedPnl) + '</span></div>' +
        '<div class="signal-bar"><div class="fill" style="width:' + strength + '%"></div></div>' +
        '</div>';
    }).join('');
  } catch(e) {}
}

/* ---- Trades ---- */
async function refreshTrades() {
  try {
    const r = await fetch('/api/trades');
    const trades = await r.json();
    const wrap = $('tradeHistoryWrap');
    if (!trades.length) {
      wrap.innerHTML = '<div class="empty-state">No trades yet</div>';
      return;
    }
    const recent = trades.slice(-30).reverse();
    let html = '<table class="trade-table"><thead><tr>' +
      '<th>Time</th><th>Coin</th><th>Action</th><th>Side</th><th>Price</th><th>PnL</th><th>Reason</th>' +
      '</tr></thead><tbody>';
    for (const t of recent) {
      const actionClass = t.action === 'BUY' ? 'action-buy' : t.action === 'SELL' ? 'action-sell' : 'action-settle';
      const pnlClass = t.pnl >= 0 ? 'pnl-positive' : 'pnl-negative';
      html += '<tr>' +
        '<td>' + timeAgo(t.timestamp) + '</td>' +
        '<td style="font-weight:600;text-transform:uppercase">' + t.coin + '</td>' +
        '<td class="' + actionClass + '">' + t.action + '</td>' +
        '<td>' + t.side + '</td>' +
        '<td>$' + t.price.toFixed(4) + '</td>' +
        '<td class="' + pnlClass + '">' + fmtPnl(t.pnl) + '</td>' +
        '<td style="color:#8b949e;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (t.reason || '') + '">' + (t.reason || '-') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    wrap.innerHTML = html;
  } catch(e) {}
}

/* ---- Config populate / collect ---- */
function populate(c) {
  $('strategy').value = c.strategy;
  $('strategyBadge').textContent = c.strategy;
  $('trade_usd').value = c.trade_usd;
  $('max_retries').value = c.max_retries;

  document.querySelectorAll('.coin-cb').forEach(cb => {
    cb.checked = c.market.market_coins.includes(cb.value);
  });
  $('market_period').value = c.market.market_period;
  $('btc_period').value = c.market.btc_period || '';

  $('t1_entry_min').value = c.trade_1.entry_price_range[0];
  $('t1_entry_max').value = c.trade_1.entry_price_range[1];
  $('t1_swap_min').value = c.trade_1.swap_price_range[0];
  $('t1_swap_max').value = c.trade_1.swap_price_range[1];
  $('t1_take_profit').value = c.trade_1.take_profit;
  $('t1_stop_loss').value = c.trade_1.stop_loss;
  $('t1_exit_time').value = c.trade_1.exit_time_ratio;
  $('t1_exit_price').value = c.trade_1.exit_price_ratio;

  $('t2_entry_min').value = c.trade_2.entry_price_ratio[0];
  $('t2_entry_max').value = c.trade_2.entry_price_ratio[1];
  $('t2_entry_time').value = c.trade_2.entry_time_ratio;
  $('t2_exit1_min').value = c.trade_2.exit_price_ratio_range[0][0];
  $('t2_exit1_max').value = c.trade_2.exit_price_ratio_range[0][1];
  $('t2_exit2_min').value = c.trade_2.exit_price_ratio_range[1][0];
  $('t2_exit2_max').value = c.trade_2.exit_price_ratio_range[1][1];
  $('t2_emerg_min').value = c.trade_2.emergency_swap_price?.[0] ?? '';
  $('t2_emerg_max').value = c.trade_2.emergency_swap_price?.[1] ?? '';

  $('t2_max_entry_time_ratio').value = c.trade_2.max_entry_time_ratio ?? '';
  $('t2_trailing_stop_pct').value = c.trade_2.trailing_stop_pct ?? '';
  $('t2_stop_loss_pct').value = c.trade_2.stop_loss_pct ?? '';
  $('t2_take_profit_ratio').value = c.trade_2.take_profit_ratio ?? '';
  $('t2_min_signal_strength').value = c.trade_2.min_signal_strength ?? '';
  $('t2_position_scale').checked = !!c.trade_2.position_scale;
  $('t2_allow_reentry').checked = !!c.trade_2.allow_reentry;
  $('t2_max_reentries').value = c.trade_2.max_reentries ?? '';

  toggleStrategy(c.strategy);
}

function toggleStrategy(s) {
  $('trade1_card').style.display = s === 'trade_1' ? 'block' : 'none';
  $('trade2_card').style.display = s === 'trade_2' ? 'block' : 'none';
}

$('strategy').addEventListener('change', e => toggleStrategy(e.target.value));

function collect() {
  const coins = [...document.querySelectorAll('.coin-cb:checked')].map(cb => cb.value);
  const market = { market_coins: coins, market_period: $('market_period').value };
  if ($('btc_period').value) market.btc_period = $('btc_period').value;

  return {
    strategy: $('strategy').value,
    trade_usd: parseFloat($('trade_usd').value),
    max_retries: parseInt($('max_retries').value),
    market,
    trade_1: {
      entry_price_range: [parseFloat($('t1_entry_min').value), parseFloat($('t1_entry_max').value)],
      swap_price_range: [parseFloat($('t1_swap_min').value), parseFloat($('t1_swap_max').value)],
      take_profit: parseFloat($('t1_take_profit').value),
      stop_loss: parseFloat($('t1_stop_loss').value),
      exit_time_ratio: parseFloat($('t1_exit_time').value),
      exit_price_ratio: parseFloat($('t1_exit_price').value),
    },
    trade_2: {
      entry_price_ratio: [parseFloat($('t2_entry_min').value), parseFloat($('t2_entry_max').value)],
      entry_time_ratio: parseFloat($('t2_entry_time').value),
      exit_price_ratio_range: [
        [parseFloat($('t2_exit1_min').value), parseFloat($('t2_exit1_max').value)],
        [parseFloat($('t2_exit2_min').value), parseFloat($('t2_exit2_max').value)],
      ],
      emergency_swap_price: [parseFloat($('t2_emerg_min').value), parseFloat($('t2_emerg_max').value)],
      max_entry_time_ratio: parseFloat($('t2_max_entry_time_ratio').value),
      trailing_stop_pct: parseFloat($('t2_trailing_stop_pct').value),
      stop_loss_pct: parseFloat($('t2_stop_loss_pct').value),
      take_profit_ratio: parseFloat($('t2_take_profit_ratio').value),
      min_signal_strength: parseFloat($('t2_min_signal_strength').value),
      position_scale: $('t2_position_scale').checked,
      allow_reentry: $('t2_allow_reentry').checked,
      max_reentries: parseInt($('t2_max_reentries').value),
    },
  };
}

/* ---- Load / Save config ---- */
async function loadConfig() {
  try {
    const r = await fetch('/api/config');
    const c = await r.json();
    populate(c);
  } catch(e) {
    $('msg').className = 'msg err';
    $('msg').textContent = 'Failed to load config';
  }
}

async function save() {
  const btn = $('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const r = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect()),
    });
    const data = await r.json();
    if (data.ok) {
      $('msg').className = 'msg ok';
      $('msg').textContent = 'Settings saved! Changes take effect immediately.';
      $('strategyBadge').textContent = $('strategy').value;
    } else {
      $('msg').className = 'msg err';
      $('msg').textContent = 'Error: ' + data.error;
    }
  } catch(e) {
    $('msg').className = 'msg err';
    $('msg').textContent = 'Failed to save: ' + e.message;
  }
  btn.disabled = false;
  btn.textContent = 'Save Settings';
  setTimeout(() => { $('msg').textContent = ''; }, 5000);
}

/* ---- Init & intervals ---- */
loadConfig();
refreshStats();
refreshPositions();
refreshTrades();

setInterval(refreshStats, 2000);
setInterval(refreshPositions, 2000);
setInterval(refreshTrades, 5000);
setInterval(loadConfig, 10000);
</script>
</body>
</html>`;

export function startDashboard() {
  const port = process.env.PORT || 3000;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/config" && req.method === "GET") {
      return getConfigJson(req, res);
    }
    if (url.pathname === "/api/config" && req.method === "POST") {
      return postConfig(req, res);
    }
    if (url.pathname === "/api/positions" && req.method === "GET") {
      return getPositions(req, res);
    }
    if (url.pathname === "/api/trades" && req.method === "GET") {
      return getTrades(req, res);
    }
    if (url.pathname === "/api/stats" && req.method === "GET") {
      return getStats(req, res);
    }
    if (url.pathname === "/" || url.pathname === "") {
      return serveDashboard(req, res);
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`Dashboard running on port ${port}`);
  });
}
