import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Run:  DATABASE_URL=... npm run init-db");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
});

// App tables: login accounts and the month-end close tracker.
const appSql = `
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  password    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_state (
  period      TEXT NOT NULL,
  task_key    TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  done_by     TEXT,
  done_at     TIMESTAMPTZ,
  PRIMARY KEY (period, task_key)
);

CREATE INDEX IF NOT EXISTS idx_task_state_period ON task_state (period);
`;

// Finance Operating System schema (dimensions, facts, reporting views, KPI catalogue).
const here = dirname(fileURLToPath(import.meta.url));
const financeOsSql = readFileSync(join(here, "..", "db", "schema.sql"), "utf8");

try {
  await pool.query(appSql);
  console.log("App tables ready: users, task_state.");
  await pool.query(financeOsSql);
  console.log("Finance OS schema ready: core / finance / commercial / operations / intelligence / governance.");
  console.log("\nDatabase initialised.");
} catch (e) {
  console.error("Init failed:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
