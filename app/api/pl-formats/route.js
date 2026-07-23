import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { assignAccountToLine, upsertFormat, SCOPE_KINDS } from "../../../lib/pl-format-store.js";
import { ingestByCompanyWorkbook } from "../../../lib/joiin-entity.js";
import { parseFormatWorkbook } from "../../../lib/pl-format-import.js";
import { audit } from "../../../lib/governance.js";

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!hasRole(session, "ADMIN", "FINANCE")) {
    return NextResponse.json({ error: "Managing P&L formats requires ADMIN or FINANCE" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const actor = session.email || session.name;
  try {
    if (body.action === "assign") {
      const { scopeKind, account, line } = body;
      if (!scopeKind || !account || !line) return NextResponse.json({ error: "Missing scope, nominal or line" }, { status: 400 });
      await assignAccountToLine(scopeKind, line, account, actor);
      await audit({ actor, eventType: "pl_format.map", objectType: "pl_format", objectRef: scopeKind, detail: { account, line } });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "workbook") {
      if (!body.file) return NextResponse.json({ error: "No workbook content" }, { status: 400 });
      const r = await ingestByCompanyWorkbook(Buffer.from(body.file, "base64"), actor);
      await audit({ actor, eventType: "joiin_entity.upload", objectType: "joiin_pl_entity", objectRef: r.months?.join(","), detail: r });
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "formatWorkbook") {
      if (!body.file) return NextResponse.json({ error: "No workbook content" }, { status: 400 });
      const parsed = parseFormatWorkbook(Buffer.from(body.file, "base64"));
      if (parsed.scopeKind === "custom" || !SCOPE_KINDS.some((s) => s.kind === parsed.scopeKind)) {
        return NextResponse.json({ error: "Couldn't tell which P&L this is from the title. Expected Store, Head Office, Franchise or Consolidated." }, { status: 400 });
      }
      if (!parsed.spec.length) return NextResponse.json({ error: "No layout rows found in the workbook." }, { status: 400 });
      await upsertFormat(parsed.scopeKind, parsed.name, parsed.spec, actor);
      await audit({ actor, eventType: "pl_format.upload", objectType: "pl_format", objectRef: parsed.scopeKind, detail: { lines: parsed.spec.length, warnings: parsed.warnings.length, needMap: parsed.needMap } });
      return NextResponse.json({ ok: true, scopeKind: parsed.scopeKind, name: parsed.name, lines: parsed.spec.length, warnings: parsed.warnings, needMap: parsed.needMap });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("pl-formats API error:", e.message);
    return NextResponse.json({ error: e.message || "Request failed" }, { status: 400 });
  }
}
