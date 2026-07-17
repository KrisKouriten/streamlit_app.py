import pg from "pg";

const { Pool } = pg;

let pool;

// Find the Postgres connection string. Prefer a plain DATABASE_URL, but also
// accept the names Vercel's storage integrations create — including ones with a
// project prefix (e.g. Finance_DATABASE_URL) or the POSTGRES_URL family — so the
// app works whatever the database was named when it was connected.
export function resolveConnectionString(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const keys = Object.keys(env);
  const pick = (re) => {
    const k = keys.find((key) => re.test(key) && env[key]);
    return k ? env[k] : null;
  };

  return (
    pick(/(^|_)DATABASE_URL$/) ||          // e.g. Finance_DATABASE_URL (pooled)
    pick(/(^|_)POSTGRES_URL$/) ||          // e.g. Finance_POSTGRES_URL
    pick(/(^|_)DATABASE_URL_UNPOOLED$/) || // direct connection fallback
    pick(/(^|_)POSTGRES_URL_NON_POOLING$/) ||
    null
  );
}

export function getPool() {
  if (!pool) {
    const connectionString = resolveConnectionString();
    if (!connectionString) {
      throw new Error(
        "No database connection string found. Set DATABASE_URL (or connect a Postgres database in your Vercel project) — the app also accepts Vercel's prefixed names such as Finance_DATABASE_URL."
      );
    }
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

export async function query(text, params) {
  const client = getPool();
  const res = await client.query(text, params);
  return res;
}
