// ═══════════════════════════════════════════════════════════════════════
// db.js — Postgres connection pool via Cloud SQL Auth Proxy
//
// On Cloud Run, the Auth Proxy is reached over a Unix socket at
// /cloudsql/<INSTANCE_CONNECTION_NAME> (set as a Cloud Run volume mount,
// not a network call) — this is why `host` below is a socket path, not
// an IP. Locally (dev), point DB_HOST at 127.0.0.1 with the proxy binary
// running alongside your dev server instead.
// ═══════════════════════════════════════════════════════════════════════
const { Pool } = require('pg');

const isCloudRun = !!process.env.INSTANCE_CONNECTION_NAME;

const pool = new Pool({
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'postgres',
  host:     isCloudRun
              ? `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`
              : (process.env.DB_HOST || '127.0.0.1'),
  port:     isCloudRun ? undefined : (process.env.DB_PORT || 5432),

  // Small pool — db-g1-small has limited max_connections. With 20-30
  // concurrent users behind a pool (not 1 connection per user), this
  // is plenty; raise only if Cloud Monitoring shows pool exhaustion.
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Every session in the pool defaults to IST — without this, CURRENT_DATE
// and any other server-side date extraction (used as a fallback wherever
// an explicit date isn't passed, e.g. order_date/delivery_date defaults)
// computes the UTC calendar day, which is the previous day for anything
// submitted before ~5:30am IST.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Asia/Kolkata'").catch((err) => {
    console.error('Failed to set session timezone:', err);
  });
});

pool.on('error', (err) => {
  console.error('Unexpected idle client error', err);
});

// Every write that touches more than one table MUST go through this,
// not raw pool.query() calls — this is the actual fix for the
// "no rollback" problem Sheets had. If any query in `fn` throws, the
// whole transaction rolls back automatically.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
