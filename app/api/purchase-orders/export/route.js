import { getSession } from "../../../../lib/auth";
import { canExport } from "../../../../lib/reporting/report-access-rules";
import { confidentialStamp } from "../../../../lib/reporting/watermark";
import { posForExport } from "../../../../lib/purchase-orders";
import { displayStatus, committedAmount, challengeReasonLabels, poRef, paymentStatusOf } from "../../../../lib/po-rules";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/*
 * Excel export for the P.O Summary + Close screen (finance/admin). One row per
 * recharge allocation line (so every store and its value to allocate/invoice is
 * visible), or one row per P.O when it has no recharge. `?ids=1,2,3` limits the
 * export to the selected P.Os; omitted → all.
 */
export async function GET(request) {
  const session = await getSession();
  if (!session) return new Response(JSON.stringify({ error: "Not signed in" }), { status: 401 });
  if (!canExport(session)) return new Response(JSON.stringify({ error: "Downloading PO exports is restricted to Finance, Exec and department heads." }), { status: 403 });

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").map((n) => Number(n)).filter(Number.isInteger) : null;
  const pos = await posForExport(ids && ids.length ? ids : null);

  const rows = [];
  for (const p of pos) {
    const st = displayStatus(p);
    const base = {
      "P.O number": poRef(p), "P.O date": p.po_date ? String(p.po_date).slice(0, 10) : "",
      Supplier: p.supplier, Department: p.department, Category: p.po_category,
      "Invoice entity": p.invoice_entity_name || "",
      "Net value": Number(p.payment_value) || 0, Currency: p.currency,
      Status: st.label,
      Payment: paymentStatusOf(p).label, "Paid date": p.paid_date ? String(p.paid_date).slice(0, 10) : "",
      "Invoice no": p.invoice_number || "", "Invoice due": (p.invoice_due_date || p.payment_date) ? String(p.invoice_due_date || p.payment_date).slice(0, 10) : "",
      "Invoice net": p.invoice_amount != null ? Number(p.invoice_amount) : "",
      "Committed £": st.code === "CLOSED" ? committedAmount(p) : "",
      Challenge: p.finance_status === "CHALLENGED" ? challengeReasonLabels(p.challenge_reasons).join("; ") : "",
      "Marketing levy": p.is_marketing ? (p.marketing_levy ? "Levy" : "Non-levy (invoice)") : "",
      "Budget area": p.marketing_budget_category || "",
      Campaign: p.marketing_campaign || "",
      "Invoice action": p.invoice_action || "",
    };
    if (p.recharge && p.recharge.length) {
      for (const r of p.recharge) {
        rows.push({ ...base, "Allocate to": r.store_name || r.store_code, "Allocation %": Number(r.pct) || 0, "Allocation £": Number(r.amount) || 0 });
      }
    } else {
      rows.push({ ...base, "Allocate to": "", "Allocation %": "", "Allocation £": "" });
    }
  }

  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "P.O number": "No purchase orders" }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Purchase Orders");
  // Confidential download stamp (who + when) on a Provenance sheet.
  const prov = XLSX.utils.aoa_to_sheet([[confidentialStamp(session, new Date())]]);
  prov["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, prov, "Provenance");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="purchase-orders-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
