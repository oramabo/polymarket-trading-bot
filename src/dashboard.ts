import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { ConfigSchema } from "./config/toml.js";

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
  .container { max-width: 800px; margin: 24px auto; padding: 0 16px; }
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
</style>
</head>
<body>
<header>
  <h1>Polymarket Bot</h1>
  <span class="status" id="strategyBadge">--</span>
</header>
<div class="container">
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
  </div>

  <button class="btn" id="saveBtn" onclick="save()">Save Settings</button>
  <div class="msg" id="msg"></div>
</div>

<script>
const $ = id => document.getElementById(id);

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
    },
  };
}

async function load() {
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

load();
setInterval(load, 10000);
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
