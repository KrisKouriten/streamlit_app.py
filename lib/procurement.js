import { query } from "./db";
import { audit } from "./governance";
import { summarise, parseProcurementCsv, MINISO_TERMS_DAYS } from "./procurement-rules.js";

const tableMissing = (e) => e?.code === "42P01" || e?.code === "42703";

export async function getProcurement() {
  try {
    const [{ rows: purchases }, { rows: budgets }] = await Promise.all([
      query(`SELECT source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag, pickup_date, delivery_ym FROM finance.procurement_purchase`),
      query(`SELECT source, ym, budget_gbp FROM finance.procurement_budget`),
    ]);
    const illustrative = purchases.length > 0 && purchases.every((p) => p.source_tag === "ILLUSTRATIVE");
    return { ready: true, loaded: purchases.length > 0, illustrative, summary: summarise(purchases, budgets), rawCount: purchases.length };
  } catch (e) {
    if (tableMissing(e)) return { ready: false, loaded: false, illustrative: false, summary: null, rawCount: 0 };
    throw e;
  }
}

// CSV upload replaces all manual/CSV purchases (keeps nothing stale); clears the
// illustrative seed on first real load.
export async function ingestProcurementCsv(csvText, actor) {
  const { records, errors } = parseProcurementCsv(csvText);
  if (!records.length) {
    const reason = errors.length ? `${errors.length} row error(s): ${errors.slice(0, 3).map((e) => `row ${e.row} ${e.reason}`).join("; ")}` : "no valid rows";
    throw new Error(`Purchases not loaded — ${reason}`);
  }
  await query(`DELETE FROM finance.procurement_purchase WHERE source_tag IN ('CSV upload','ILLUSTRATIVE')`);
  for (const r of records) {
    await query(
      `INSERT INTO finance.procurement_purchase (source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, source_tag, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CSV upload',$9)`,
      [r.source, r.supplier, r.category, r.order_ym, r.amount_gbp, r.terms_days, r.status, r.reference, actor]
    );
  }
  await audit({ actor, eventType: "procurement.upload", objectType: "procurement_purchase", objectRef: "csv", detail: { loaded: records.length, rowErrors: errors.length } });
  return { loaded: records.length, errors };
}

// Add a single purchase line directly (no CSV). Tagged 'MANUAL' so it survives a
// later CSV upload (which only replaces 'CSV upload'/'ILLUSTRATIVE' rows).
// Miniso HQ buys on fixed 180-day terms from the goods pickup date, so a pickup
// date is required and the terms are forced to 180; Local keeps its entered terms.
export async function addProcurementPurchase({ source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, pickup_date, delivery_ym }, actor) {
  if (!["MINISO", "LOCAL"].includes(source)) throw new Error("Source must be Miniso or Local");
  if (!supplier || !supplier.trim()) throw new Error("Supplier is required");
  if (!/^\d{4}-\d{2}$/.test(order_ym || "")) throw new Error("Order month must be a YYYY-MM value");
  if (!Number.isFinite(Number(amount_gbp))) throw new Error("Amount must be a number");
  if (delivery_ym && !/^\d{4}-\d{2}$/.test(delivery_ym)) throw new Error("Delivery month must be a YYYY-MM value");
  const isMiniso = source === "MINISO";
  if (isMiniso && !/^\d{4}-\d{2}-\d{2}$/.test(pickup_date || "")) throw new Error("A pickup date is required for Miniso HQ purchases");
  const effectiveTerms = isMiniso ? MINISO_TERMS_DAYS : (Number(terms_days) || 0);
  await query(
    `INSERT INTO finance.procurement_purchase (source, supplier, category, order_ym, amount_gbp, terms_days, status, reference, pickup_date, delivery_ym, source_tag, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'MANUAL',$11)`,
    [source, supplier.trim(), (category || "").trim() || null, order_ym, Number(amount_gbp), effectiveTerms,
     status === "PAID" ? "PAID" : "COMMITTED", (reference || "").trim() || null,
     isMiniso ? pickup_date : null, delivery_ym || null, actor]
  );
  await audit({ actor, eventType: "procurement.purchase.add", objectType: "procurement_purchase", objectRef: `${source}·${supplier}`, detail: { amount_gbp: Number(amount_gbp), order_ym, pickup_date: isMiniso ? pickup_date : null } });
  return { ok: true };
}

export async function setBudget({ source, ym, budget }, actor) {
  await query(
    `INSERT INTO finance.procurement_budget (source, ym, budget_gbp, updated_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (source, ym) DO UPDATE SET budget_gbp = EXCLUDED.budget_gbp, updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP`,
    [source, ym, budget, actor]
  );
  await audit({ actor, eventType: "procurement.budget", objectType: "procurement_budget", objectRef: `${source}·${ym}`, detail: { budget } });
}
