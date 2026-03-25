import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { ConfigSchema } from "./config/toml.js";
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
.field label{font-size:11px;color:#8b949e;margin-bottom:3px;cursor:help;border-bottom:1px dotted #484f58;display:inline-block;width:fit-content}
.field input,.field select{background:#0d1117;border:1px solid #30363d;color:#c9d1d9;padding:7px 9px;border-radius:6px;font-size:13px;width:100%}
.field input:focus,.field select:focus{outline:none;border-color:#58a6ff}
.coins{display:flex;gap:8px;flex-wrap:wrap}
.coins label{display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;padding:5px 10px;background:#21262d;border-radius:6px;border:1px solid #30363d}
.coins input:checked+span{color:#58a6ff;font-weight:600}
.tuple{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.tuple-group{margin-bottom:10px}
.tuple-group>label{font-size:11px;color:#8b949e;margin-bottom:3px;display:block;cursor:help;border-bottom:1px dotted #484f58;width:fit-content}
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
.empty{text-align:center;padding:20px;color:#484f58;font-size:13px}
.updated{font-size:10px;color:#484f58;text-align:right;margin-top:6px}
.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
@media(max-width:768px){
  .stats-row{grid-template-columns:1fr 1fr}
  .row,.row3{grid-template-columns:1fr}
  .positions-grid{grid-template-columns:1fr}
  .stat .sv{font-size:18px}
  header h1{font-size:16px}
}
</style>
</head>
<body>
<header>
<h1>Polymarket Bot</h1>
<span class="status" id="sBadge">--</span>
</header>
<div class="container">

<div class="stats-row">
<div class="stat"><div class="sv" id="sPnl">$0.00</div><div class="sl">Total P&L</div></div>
<div class="stat"><div class="sv" id="sWR">0%</div><div class="sl">Win Rate</div></div>
<div class="stat"><div class="sv" id="sTT">0</div><div class="sl">Trades</div></div>
<div class="stat"><div class="sv" id="sWL">0/0</div><div class="sl">W/L</div></div>
</div>

<div class="card">
<h2>Live Positions</h2>
<p class="card-desc">Real-time view of active positions across all coins. Updates every 2 seconds.</p>
<div class="positions-grid" id="pGrid"><div class="empty">Waiting for data...</div></div>
<div class="updated" id="pUpd"></div>
</div>

<div class="card">
<h2>Trade History</h2>
<p class="card-desc">Recent buy/sell activity with profit/loss tracking.</p>
<div class="tbl-wrap" id="tWrap"><div class="empty">No trades yet</div></div>
</div>

<div class="card">
<h2>General</h2>
<p class="card-desc">Core bot settings. Strategy determines the trading algorithm used.</p>
<div class="row3">
<div class="field">
<label title="trade_1 uses simple price/time exits. trade_2 uses signal-based entries with trailing stop, stop-loss, and take-profit.">Strategy</label>
<select id="strategy"><option value="trade_1">trade_1</option><option value="trade_2">trade_2</option></select>
</div>
<div class="field">
<label title="Amount in USD to spend per trade. May be scaled by signal strength if position_scale is enabled.">Budget (USD)</label>
<input type="number" id="trade_usd" step="0.5" min="0.5">
</div>
<div class="field">
<label title="Number of times to retry a failed order before giving up.">Max Retries</label>
<input type="number" id="max_retries" step="1" min="1">
</div>
</div>
<div id="stratInfo"></div>
</div>

<div class="card">
<h2>Markets</h2>
<p class="card-desc">Configure which coins to trade and their market timeframes.</p>
<div class="field" style="margin-bottom:10px">
<label title="Which coins to trade. Changes require a restart to take effect.">Active Coins</label>
<div class="coins">
<label><input type="checkbox" value="btc" class="ccb"><span>BTC</span></label>
<label><input type="checkbox" value="eth" class="ccb"><span>ETH</span></label>
<label><input type="checkbox" value="sol" class="ccb"><span>SOL</span></label>
<label><input type="checkbox" value="xrp" class="ccb"><span>XRP</span></label>
</div>
</div>
<div class="row">
<div class="field">
<label title="Market duration. Shorter = more trades but less data. 5m only works for BTC.">Default Period</label>
<select id="mp"><option value="5">5m</option><option value="15">15m</option><option value="60">1h</option><option value="240">4h</option><option value="1440">1d</option></select>
</div>
<div class="field">
<label title="Override the default period for BTC. BTC supports 5-minute markets, others don't.">BTC Period Override</label>
<select id="bp"><option value="">Use default</option><option value="5">5m</option><option value="15">15m</option><option value="60">1h</option><option value="240">4h</option><option value="1440">1d</option></select>
</div>
</div>
<p class="note">Coin list changes take effect on restart.</p>
</div>

<div class="card" id="t1c">
<h2>Trade 1 Settings</h2>
<p class="card-desc">Simple strategy: exits based on time elapsed or price ratio threshold.</p>
<div class="tuple-group"><label title="Price range for entry. Both values between 0-1.">Entry Price Range</label><div class="tuple"><input type="number" id="t1em" step="0.01"><input type="number" id="t1ex" step="0.01"></div></div>
<div class="tuple-group"><label title="Price range for swap. Both values between 0-1.">Swap Price Range</label><div class="tuple"><input type="number" id="t1sm" step="0.01"><input type="number" id="t1sx" step="0.01"></div></div>
<div class="row">
<div class="field"><label title="Take profit multiplier.">Take Profit</label><input type="number" id="t1tp" step="0.1"></div>
<div class="field"><label title="Stop loss multiplier.">Stop Loss</label><input type="number" id="t1sl" step="0.1"></div>
</div>
<div class="row">
<div class="field"><label title="Sell when this fraction of market time has passed.">Exit Time Ratio</label><input type="number" id="t1et" step="0.01"></div>
<div class="field"><label title="Sell when price ratio exceeds this value.">Exit Price Ratio</label><input type="number" id="t1ep" step="0.01"></div>
</div>
</div>

<div class="card" id="t2c">
<h2>Trade 2 Settings</h2>
<p class="card-desc">Advanced signal-based strategy with momentum scoring, trailing stops, and risk management.</p>
<div class="tuple-group"><label title="Only enter when |price-0.5|/0.5 is in this range. [0.2,0.95] = enter when price shows clear direction.">Entry Price Ratio [min, max]</label><div class="tuple"><input type="number" id="t2em" step="0.01"><input type="number" id="t2ex" step="0.01"></div></div>
<div class="row">
<div class="field"><label title="Wait until this fraction of market time passes before entering. 0.4 = wait 40%.">Entry Time Ratio</label><input type="number" id="t2et" step="0.01"></div>
<div class="field"><label title="Stop entering after this fraction. 0.85 = no entries after 85% elapsed.">Max Entry Time</label><input type="number" id="t2met" step="0.01"></div>
</div>
<div class="tuple-group"><label title="Legacy exit ranges. Set both to [1.0, 1.0] to disable. Use trailing stop instead.">Exit Range 1 [min, max]</label><div class="tuple"><input type="number" id="t2e1m" step="0.01"><input type="number" id="t2e1x" step="0.01"></div></div>
<div class="tuple-group"><label title="Legacy exit ranges. Set both to [1.0, 1.0] to disable.">Exit Range 2 [min, max]</label><div class="tuple"><input type="number" id="t2e2m" step="0.01"><input type="number" id="t2e2x" step="0.01"></div></div>
<div class="tuple-group"><label title="Legacy: if sell succeeds and price in range, buy opposite. [1.0,1.0] = disabled.">Emergency Swap [min, max]</label><div class="tuple"><input type="number" id="t2esm" step="0.01"><input type="number" id="t2esx" step="0.01"></div></div>
<div class="row">
<div class="field"><label title="Sell if price drops this % from peak. 0.15 = 15% drop triggers sell. Only when in profit.">Trailing Stop %</label><input type="number" id="t2ts" step="0.01"></div>
<div class="field"><label title="Sell if loss exceeds this %. 0.30 = cut at 30% loss.">Stop Loss %</label><input type="number" id="t2slp" step="0.01"></div>
</div>
<div class="row">
<div class="field"><label title="Sell when |price-0.5|/0.5 exceeds this. 0.80 = sell when 80%+ decided.">Take Profit Ratio</label><input type="number" id="t2tpr" step="0.01"></div>
<div class="field"><label title="Minimum signal score (0-1) to enter. Higher = fewer but better trades.">Min Signal</label><input type="number" id="t2ms" step="0.01"></div>
</div>
<div class="row">
<div class="field"><label title="Max buy/sell cycles per market window when re-entry enabled.">Max Reentries</label><input type="number" id="t2mr" step="1" min="0"></div>
<div class="field"></div>
</div>
<div class="tf">
<label class="toggle"><input type="checkbox" id="t2ps"><span class="sl"></span></label>
<span class="tl" title="Scale trade amount by signal strength. Strong = full budget, weak = reduced.">Position Scale</span>
</div>
<div class="tf">
<label class="toggle"><input type="checkbox" id="t2ar"><span class="sl"></span></label>
<span class="tl" title="Allow buying again after selling in the same market window.">Allow Re-entry</span>
</div>
</div>

<button class="btn" id="saveBtn" onclick="save()">Save Settings</button>
<div class="msg" id="msg"></div>
</div>

<script>
const $=id=>document.getElementById(id);
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
if(!ps.length){g.innerHTML='<div class="empty">Waiting for market data...</div>';return}
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

async function rTrades(){
try{const r=await fetch('/api/trades');const ts=await r.json();const w=$('tWrap');
if(!ts.length){w.innerHTML='<div class="empty">No trades yet</div>';return}
const rc=ts.slice(-30).reverse();
let h='<table class="tt"><thead><tr><th>Time</th><th>Coin</th><th>Action</th><th>Side</th><th>Price</th><th>PnL</th><th>Reason</th></tr></thead><tbody>';
for(const t of rc){const ac=t.action==='BUY'?'a-buy':t.action==='SELL'?'a-sell':'a-settle';
const pc=t.pnl>=0?'pnl-pos':'pnl-neg';
h+='<tr><td>'+tAgo(t.timestamp)+'</td><td style="font-weight:600;text-transform:uppercase">'+t.coin+'</td><td class="'+ac+'">'+t.action+'</td><td>'+t.side+'</td><td>$'+t.price.toFixed(3)+'</td><td class="'+pc+'">'+fP(t.pnl)+'</td><td style="color:#8b949e;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+( t.reason||'-')+'</td></tr>'}
h+='</tbody></table>';w.innerHTML=h;
}catch(e){$('tWrap').innerHTML='<div class="empty">Connection error</div>'}}

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

loadConfig();rStats();rPos();rTrades();
setInterval(rStats,2000);setInterval(rPos,2000);setInterval(rTrades,5000);setInterval(loadConfig,10000);
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
    if (url.pathname === "/" || url.pathname === "") return serveDashboard(req, res);

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(Number(port), "0.0.0.0", () => {
    console.log(`Dashboard running on 0.0.0.0:${port}`);
  });
}
