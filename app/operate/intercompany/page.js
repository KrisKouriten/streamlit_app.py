import { redirect } from "next/navigation";
import { getSession, hasRole } from "../../../lib/auth";
import { listTxns, getSummary, listEntitiesForPicker, CATEGORIES } from "../../../lib/intercompany";
import IntercompanyUI from "./intercompany-ui";

export const dynamic = "force-dynamic";

export default async function Intercompany() {
  const session = await getSession();
  if (!session) redirect("/login");
  const canManage = hasRole(session, "ADMIN", "FINANCE");
  const keys = Object.keys(CATEGORIES);
  const cats = [];
  for (const k of keys) {
    const c = CATEGORIES[k];
    cats.push({ key: k, label: c.label, recon: c.recon, cols: c.cols, amountLabel: c.amountLabel, csvTemplate: c.csvTemplate,
      txns: await listTxns(k), summary: await getSummary(k) });
  }
  const entities = await listEntitiesForPicker();

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "1.5rem 1.25rem 4rem" }}>
      <header style={{ marginBottom: 18 }}>
        <span className="fos-eyebrow">Operate · Intercompany</span>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em", marginTop: 10 }}>Intercompany transactions</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 3, maxWidth: "72ch", lineHeight: 1.55 }}>
          Bank cash, inventory &amp; recharges and disbursements between Miniso UK entities, with reconciliation status.
          {canManage ? " Add rows manually or upload a CSV per ledger." : " Viewing only — ADMIN/FINANCE can add and reconcile."}
        </div>
      </header>
      <IntercompanyUI cats={cats} entities={entities} canManage={canManage} />
    </div>
  );
}
