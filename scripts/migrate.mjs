import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/*
 * Migration runner. Applies db/migrations/*.sql in filename order, once each,
 * tracking what has run in public.schema_migration. The migrations are written
 * to be idempotent, so a re-run is safe even if the tracking row is missing.
 *
 * Prerequisite: the base schema exists (run `npm run init-db` first) — it
 * creates public.users and the core/finance/governance schemas the migrations
 * build on. CI does init-db then this.
 *
 * Usage:  DATABASE_URL=postgres://… node scripts/migrate.mjs
 */

const { Client } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "db", "migrations");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.  Run:  DATABASE_URL=… node scripts/migrate.mjs");
  process.exit(1);
}

const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
const client = new Client({ connectionString, ssl: isLocal ? false : { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  await client.query(
    `CREATE TABLE IF NOT EXISTS public.schema_migration (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`
  );
  const applied = new Set(
    (await client.query(`SELECT filename FROM public.schema_migration`)).rows.map((r) => r.filename)
  );

  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    process.stdout.write(`applying ${f} … `);
    try {
      await client.query(sql); // files carry their own BEGIN/COMMIT
      await client.query(`INSERT INTO public.schema_migration (filename) VALUES ($1) ON CONFLICT DO NOTHING`, [f]);
      console.log("ok");
      ran++;
    } catch (e) {
      console.error(`FAILED\n  ${e.message}`);
      await client.end();
      process.exit(1);
    }
  }
  console.log(`\nMigrations: ${ran} applied, ${files.length - ran} already present, ${files.length} total.`);
  await client.end();
}

main().catch(async (e) => {
  console.error(e);
  try { await client.end(); } catch {}
  process.exit(1);
});
