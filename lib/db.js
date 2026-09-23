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

/*
 * Which database the app is actually talking to, safe to show on screen.
 *
 * Migrations are applied by hand in a SQL editor, and the editor opens on
 * whatever branch it opened on last. Twice now a migration has been applied,
 * verified, and reported as done while the app carried on reading a different
 * branch that never received it — because the only way to tell them apart was
 * to reveal a secret in Vercel and compare an `ep-...` hostname by eye.
 *
 * So the app says it itself. Host and database name only: the connection string
 * carries the password, and this is rendered in a browser, so nothing but those
 * two fields is ever returned. `envKey` names the variable in play, which
 * matters when several are set and only the first match is used.
 */
export function connectionTarget(env = process.env) {
  const keys = ["DATABASE_URL", ...Object.keys(env).filter((k) => k !== "DATABASE_URL")];
  const envKey = keys.find((k) => env[k] && /(^|_)(DATABASE_URL|POSTGRES_URL)(_UNPOOLED|_NON_POOLING)?$/.test(k)) || null;
  const cs = resolveConnectionString(env);
  if (!cs) return { envKey, host: null, database: null };
  try {
    const u = new URL(cs);
    return {
      envKey,
      host: u.hostname || null,                       // e.g. ep-xxxx-pooler.eu-west-2.aws.neon.tech
      database: (u.pathname || "").replace(/^\//, "") || null,
    };
  } catch {
    return { envKey, host: null, database: null };    // unparseable — say nothing rather than guess
  }
}
