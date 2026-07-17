import pg from "pg";

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

const sql = `
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

try {
  await pool.query(sql);
  console.log("Database initialised: tables users, task_state are ready.");
} catch (e) {
  console.error("Init failed:", e.message);
  process.exit(1);
} finally {
  await pool.end();
}
