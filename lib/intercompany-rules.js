/*
 * Intercompany — pure, unit-testable config, CSV parsing and row mapping.
 * The DB layer (lib/intercompany.js) resolves entity names to ids and inserts.
 */

export const CATEGORIES = {
  CASH: {
    key: "CASH", label: "Bank Cash",
    amountLabel: "Amount",
    recon: [
      ["recon_credit", "Credit bank reconciled"], ["recon_debit", "Debit bank reconciled"],
      ["recon_balance_sheet", "Balance sheet reconciled"], ["recon_cashflow", "Cashflow reconciled"],
    ],
    cols: ["gross_amount", "reference"],
    csvTemplate: "Credit Entity (CF Out),Date,Currency,Amount,Payment Reference (Unique ID),Debit Entity (CF In)",
  },
  INVENTORY_RECHARGES: {
    key: "INVENTORY_RECHARGES", label: "Inventory & Recharges",
    amountLabel: "Gross Amount",
    recon: [
      ["recon_credit", "Credit account reconciled"], ["recon_debit", "Debit account reconciled"],
      ["recon_balance_sheet", "Balance sheet reconciled"],
    ],
    cols: ["gross_amount", "net_amount", "vat_amount", "invoice_number", "reference"],
    csvTemplate: "Credit Entity (CF Out),Date,Currency,Gross Amount,Net Amount,VAT,Kouriten Invoice Number,Reference,Debit Entity (CF In)",
  },
  DISBURSEMENTS: {
    key: "DISBURSEMENTS", label: "Disbursements",
    amountLabel: "Gross Amount",
    recon: [["settled", "Settled on Xero"], ["recon_balance_sheet", "Balance sheet reconciled"]],
    cols: ["gross_amount", "invoice_number", "supplier_name", "nominal", "payment_method", "reference"],
    csvTemplate: "Credit Entity (CF Out),Date,Invoice Number,Currency,Gross Amount,Supplier Name,Nominal,Payment Method,Payment Reference,Debit Entity (CF In)",
  },
};

// RFC4180-ish CSV parse: handles quoted fields, embedded commas, escaped quotes, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (!nonEmpty.length) return { headers: [], records: [] };
  const headers = nonEmpty[0].map((h) => h.trim());
  const records = nonEmpty.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, records };
}

const norm = (h) => h.toLowerCase().trim();

// Normalise a date string to ISO (YYYY-MM-DD). UK house style is DD/MM/YYYY, so
// slash/dash dates are read day-first. Returns null if unparseable (row still loads).
export function toISODate(s) {
  if (s == null || String(s).trim() === "") return null;
  const v = String(s).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}
const num = (v) => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[£$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const yes = (v) => /^(y|yes|true|1)$/i.test(String(v || "").trim());

// Match a canonical field to the right CSV header.
function pick(headers, field) {
  const h = headers.map(norm);
  const eq = (...a) => { const i = h.findIndex((x) => a.includes(x)); return i < 0 ? null : headers[i]; };
  const sw = (...a) => { const i = h.findIndex((x) => a.some((p) => x.startsWith(p))); return i < 0 ? null : headers[i]; };
  const has = (...a) => { const i = h.findIndex((x) => a.some((p) => x.includes(p))); return i < 0 ? null : headers[i]; };
  switch (field) {
    case "credit": return sw("credit entity");
    case "debit": return sw("debit entity");
    case "date": return eq("date");
    case "currency": return eq("currency");
    case "gross_amount": return eq("gross amount", "amount");
    case "net_amount": return eq("net amount");
    case "vat_amount": return eq("vat");
    case "reference": return sw("payment reference") || eq("reference");
    case "invoice_number": return eq("invoice number", "kouriten invoice number");
    case "supplier_name": return sw("supplier");
    case "nominal": return sw("nominal");
    case "payment_method": return eq("payment method");
    case "recon_credit": return sw("credit - bank account reconciled", "credit - account reconciled");
    case "recon_debit": return sw("debit - bank account reconciled", "debit - account reconciled");
    case "recon_balance_sheet": return has("balance sheet reconciled");
    case "recon_cashflow": return sw("cashflow reconciled");
    case "settled": return sw("settled on xero");
    default: return null;
  }
}

// Map parsed CSV records for a category into normalized txns (entity names, not ids).
// Returns { records, errors } — a row missing credit/debit/amount is an error, never silently kept.
export function mapRows(category, headers, records) {
  const out = [], errors = [];
  const col = {};
  for (const f of ["credit", "debit", "date", "currency", "gross_amount", "net_amount", "vat_amount",
    "reference", "invoice_number", "supplier_name", "nominal", "payment_method",
    "recon_credit", "recon_debit", "recon_balance_sheet", "recon_cashflow", "settled"]) col[f] = pick(headers, f);

  records.forEach((r, idx) => {
    const creditName = col.credit ? r[col.credit]?.trim() : "";
    const debitName = col.debit ? r[col.debit]?.trim() : "";
    const gross = col.gross_amount ? num(r[col.gross_amount]) : null;
    if (!creditName || !debitName || gross == null) {
      errors.push({ row: idx + 2, reason: `missing ${!creditName ? "credit entity" : !debitName ? "debit entity" : "amount"}` });
      return;
    }
    out.push({
      category, creditName, debitName,
      txn_date: col.date ? toISODate(r[col.date]) : null,
      currency: (col.currency ? r[col.currency] : "GBP") || "GBP",
      gross_amount: gross,
      net_amount: col.net_amount ? num(r[col.net_amount]) : null,
      vat_amount: col.vat_amount ? num(r[col.vat_amount]) : null,
      reference: col.reference ? r[col.reference] : null,
      invoice_number: col.invoice_number ? r[col.invoice_number] : null,
      supplier_name: col.supplier_name ? r[col.supplier_name] : null,
      nominal: col.nominal ? r[col.nominal] : null,
      payment_method: col.payment_method ? r[col.payment_method] : null,
      recon_credit: col.recon_credit ? yes(r[col.recon_credit]) : false,
      recon_debit: col.recon_debit ? yes(r[col.recon_debit]) : false,
      recon_balance_sheet: col.recon_balance_sheet ? yes(r[col.recon_balance_sheet]) : false,
      recon_cashflow: col.recon_cashflow ? yes(r[col.recon_cashflow]) : false,
      settled: col.settled ? yes(r[col.settled]) : false,
    });
  });
  return { records: out, errors };
}
