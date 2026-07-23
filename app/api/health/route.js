import { NextResponse } from "next/server";
import { query, resolveConnectionString } from "../../../lib/db";

// Safe diagnostics: reports whether the required settings are present and
// whether the database is reachable. Never returns secret values or the
// connection string — only variable NAMES, booleans and counts.
export const dynamic = "force-dynamic";

export async function GET() {
  const env = process.env;

  const secret = env.SESSION_SECRET;
  const flag = (v) => (v ? "set" : "MISSING");
  const report = {
    ok: false,
    sessionSecret: secret ? (secret.length >= 16 ? "set" : "too-short") : "MISSING",
    // Integration config — presence only, never values. Helps confirm a new
    // environment is fully wired without exposing any secret.
    config: {
      joiinApiKey: flag(env.JOIIN_API_KEY),
      cronSecret: flag(env.CRON_SECRET),
      mfaSecretKey: env.MFA_SECRET_KEY ? "set" : "fallback (SESSION_SECRET)",
    },
    databaseVarFound: !!resolveConnectionString(),
    databaseVarNamesSeen: Object.keys(env)
      .filter((k) => /(DATABASE_URL|POSTGRES_URL)$/.test(k))
      .sort(),
    database: "not-tested",
    users: null,
    schema: { migrationsApplied: null, latest: null },
  };

  if (report.databaseVarFound) {
    try {
      const { rows } = await query("SELECT count(*)::int AS n FROM users");
      report.database = "connected";
      report.users = rows[0].n;
    } catch (e) {
      report.database = `error: ${e.code ? e.code + " " : ""}${String(e.message).slice(0, 160)}`;
    }
    // Schema version — how many migrations have been applied, and the latest.
    // Null if the runner has never been used (migrations applied by hand).
    try {
      const { rows } = await query(
        "SELECT count(*)::int AS n, max(filename) AS latest FROM public.schema_migration"
      );
      report.schema = { migrationsApplied: rows[0].n, latest: rows[0].latest };
    } catch {
      // schema_migration absent (hand-applied migrations) — leave as null.
    }
  }

  report.ok =
    report.sessionSecret === "set" &&
    report.database === "connected" &&
    report.users > 0;

  return NextResponse.json(report);
}
