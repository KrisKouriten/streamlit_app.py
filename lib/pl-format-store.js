import { query } from "./db";
import { STORE_FORMAT, FRANCHISE_FORMAT } from "./pl-format.js";

/*
 * Governed P&L formats — DB read/write layer (Phase 19). The board-pack layouts
 * live in finance.pl_format (one row per scope kind). Code specs are the seed
 * and the fallback if the table is missing or a kind hasn't been seeded, so the
 * renderer always has a layout. Editing happens under GOVERN.
 */

const tableMissing = (e) => e?.code === "42P01";

// Code fallbacks by scope kind (generic has no fixed spec — built per entity).
const CODE_SPEC = { store: STORE_FORMAT, franchise: FRANCHISE_FORMAT };

export const SCOPE_KINDS = [
  { kind: "store", name: "Store P&L", note: "Company-owned stores and the store consolidation." },
  { kind: "franchise", name: "Franchise P&L", note: "The franchise entity." },
  { kind: "head_office", name: "Head Office / Wholesale P&L", note: "Head Office entity (wholesale elimination pending)." },
  { kind: "consolidated", name: "Consolidated P&L", note: "Whole group (wholesale elimination pending)." },
];

// Return the layout spec for a scope kind: DB row if present, else code fallback.
export async function getFormatSpec(scopeKind) {
  try {
    const { rows } = await query(`SELECT spec FROM finance.pl_format WHERE scope_kind = $1 AND is_active`, [scopeKind]);
    if (rows.length && Array.isArray(rows[0].spec) && rows[0].spec.length) return rows[0].spec;
  } catch (e) {
    if (!tableMissing(e)) throw e;
  }
  return CODE_SPEC[scopeKind] || null;
}

// All governed formats for the GOVERN screen (DB rows joined with code fallbacks).
export async function getAllFormats() {
  let rows = [];
  try {
    ({ rows } = await query(`SELECT scope_kind, name, spec, version, is_active, updated_by, updated_at FROM finance.pl_format ORDER BY scope_kind`));
  } catch (e) {
    if (!tableMissing(e)) throw e;
    return { ready: false, formats: [] };
  }
  const byKind = Object.fromEntries(rows.map((r) => [r.scope_kind, r]));
  const formats = SCOPE_KINDS.map((s) => {
    const row = byKind[s.kind];
    const spec = row?.spec?.length ? row.spec : (CODE_SPEC[s.kind] || null);
    return {
      kind: s.kind, name: row?.name || s.name, note: s.note,
      seeded: !!row, source: row ? "db" : (CODE_SPEC[s.kind] ? "code" : "none"),
      version: row?.version || null, updatedBy: row?.updated_by || null, updatedAt: row?.updated_at || null,
      spec: spec || [],
      mappedAccounts: spec ? [...new Set(spec.filter((e) => e.kind === "line").flatMap((e) => e.accounts || []))] : [],
    };
  });
  return { ready: true, formats };
}

// Seed a scope kind from a spec array (used by the seed script and to persist
// the code defaults into the DB so they become editable).
export async function upsertFormat(scopeKind, name, spec, actor) {
  await query(
    `INSERT INTO finance.pl_format (scope_kind, name, spec, updated_by)
     VALUES ($1,$2,$3::jsonb,$4)
     ON CONFLICT (scope_kind) DO UPDATE SET name = EXCLUDED.name, spec = EXCLUDED.spec,
       version = finance.pl_format.version + 1, updated_at = CURRENT_TIMESTAMP, updated_by = EXCLUDED.updated_by`,
    [scopeKind, name, JSON.stringify(spec), actor || "system"]
  );
}

// Assign a chart-of-accounts nominal to a line within a format's spec (append
// to that line's accounts, de-duplicated), then persist. Returns the new spec.
export async function assignAccountToLine(scopeKind, lineLabel, account, actor) {
  const spec = await getFormatSpec(scopeKind);
  if (!spec) throw new Error("No format for that scope");
  let hit = false;
  const next = spec.map((e) => {
    if (e.kind === "line" && e.label === lineLabel) {
      hit = true;
      const accounts = [...new Set([...(e.accounts || []), account])];
      return { ...e, accounts };
    }
    // remove the account from any other line so it maps in exactly one place
    if (e.kind === "line" && (e.accounts || []).includes(account) && e.label !== lineLabel) {
      return { ...e, accounts: e.accounts.filter((a) => a !== account) };
    }
    return e;
  });
  if (!hit) throw new Error("No such line in the format");
  const name = SCOPE_KINDS.find((s) => s.kind === scopeKind)?.name || scopeKind;
  await upsertFormat(scopeKind, name, next, actor);
  return next;
}
