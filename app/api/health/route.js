import { NextResponse } from "next/server";
import { query, resolveConnectionString } from "../../../lib/db";

// Safe diagnostics: reports whether the required settings are present and
// whether the database is reachable. Never returns secret values or the
// connection string — only variable NAMES, booleans and counts.
export const dynamic = "force-dynamic";

export async function GET() {
  const env = process.env;

  const secret = env.SESSION_SECRET;
  const report = {
    ok: false,
    sessionSecret: secret ? (secret.length >= 16 ? "set" : "too-short") : "MISSING",
    databaseVarFound: !!resolveConnectionString(),
    databaseVarNamesSeen: Object.keys(env)
      .filter((k) => /(DATABASE_URL|POSTGRES_URL)$/.test(k))
      .sort(),
    database: "not-tested",
    users: null,
  };

  if (report.databaseVarFound) {
    try {
      const { rows } = await query("SELECT count(*)::int AS n FROM users");
      report.database = "connected";
      report.users = rows[0].n;
    } catch (e) {
      report.database = `error: ${e.code ? e.code + " " : ""}${String(e.message).slice(0, 160)}`;
    }
  }

  report.ok =
    report.sessionSecret === "set" &&
    report.database === "connected" &&
    report.users > 0;

  return NextResponse.json(report);
}
