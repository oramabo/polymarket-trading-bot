import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "";

let pool: pg.Pool | null = null;

function getPool(): pg.Pool | null {
  if (!DATABASE_URL) return null;
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
    pool.on("error", (err) => console.error("DB pool error:", err));
  }
  return pool;
}

export async function initDb(): Promise<void> {
  const p = getPool();
  if (!p) {
    console.log("DATABASE_URL not set, skipping DB init");
    return;
  }

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        coin VARCHAR(10) NOT NULL,
        side VARCHAR(5) NOT NULL,
        action VARCHAR(10) NOT NULL,
        price DECIMAL(18,6) NOT NULL,
        amount DECIMAL(18,6) NOT NULL,
        shares DECIMAL(18,6) NOT NULL,
        pnl DECIMAL(18,6) DEFAULT 0,
        reason VARCHAR(100) DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS config_history (
        id SERIAL PRIMARY KEY,
        config_json JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS stats (
        id SERIAL PRIMARY KEY,
        total_pnl DECIMAL(18,6) DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        total_trades INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Ensure stats row exists
    const res = await p.query("SELECT COUNT(*) FROM stats");
    if (parseInt(res.rows[0].count) === 0) {
      await p.query("INSERT INTO stats (total_pnl, wins, losses, total_trades) VALUES (0, 0, 0, 0)");
    }

    console.log("DB initialized successfully");
  } catch (err) {
    console.error("DB init error:", err);
  }
}

export async function dbSaveTrade(trade: {
  coin: string;
  side: string;
  action: string;
  price: number;
  amount: number;
  shares: number;
  pnl: number;
  reason: string;
}): Promise<void> {
  const p = getPool();
  if (!p) return;

  try {
    await p.query(
      "INSERT INTO trades (coin, side, action, price, amount, shares, pnl, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [trade.coin, trade.side, trade.action, trade.price, trade.amount, trade.shares, trade.pnl, trade.reason]
    );
  } catch (err) {
    console.error("DB save trade error:", err);
  }
}

export async function dbUpdateStats(stats: {
  totalPnl: number;
  wins: number;
  losses: number;
  totalTrades: number;
}): Promise<void> {
  const p = getPool();
  if (!p) return;

  try {
    await p.query(
      "UPDATE stats SET total_pnl=$1, wins=$2, losses=$3, total_trades=$4, updated_at=NOW() WHERE id=1",
      [stats.totalPnl, stats.wins, stats.losses, stats.totalTrades]
    );
  } catch (err) {
    console.error("DB update stats error:", err);
  }
}

export async function dbSaveConfig(config: any): Promise<void> {
  const p = getPool();
  if (!p) return;

  try {
    await p.query(
      "INSERT INTO config_history (config_json) VALUES ($1)",
      [JSON.stringify(config)]
    );
  } catch (err) {
    console.error("DB save config error:", err);
  }
}

export async function dbGetTrades(limit: number = 100): Promise<any[]> {
  const p = getPool();
  if (!p) return [];

  try {
    const res = await p.query(
      "SELECT * FROM trades ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    return res.rows;
  } catch (err) {
    console.error("DB get trades error:", err);
    return [];
  }
}

export async function dbGetStats(): Promise<any | null> {
  const p = getPool();
  if (!p) return null;

  try {
    const res = await p.query("SELECT * FROM stats WHERE id=1");
    return res.rows[0] || null;
  } catch (err) {
    console.error("DB get stats error:", err);
    return null;
  }
}

export async function dbLoadLastConfig(): Promise<any | null> {
  const p = getPool();
  if (!p) return null;

  try {
    const res = await p.query(
      "SELECT config_json FROM config_history ORDER BY created_at DESC LIMIT 1"
    );
    return res.rows[0]?.config_json || null;
  } catch (err) {
    console.error("DB load config error:", err);
    return null;
  }
}
