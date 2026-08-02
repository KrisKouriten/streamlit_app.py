import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../../lib/auth";
import {
  getOtbVersion, setOtbVersionApproval, computeOtb, getOtbSummary, reconcileVersion,
  getStoreSales, saveStoreSales, getAssumptions, saveAssumption, getInventoryPositions,
  listNewStores, saveNewStore, listClosures, saveClosure, listClearance, saveClearance,
  listMinStockRules, saveMinStockRule, deleteMinStockRule, listCommitments, listTransfers,
  saveTransfer, setTransferStatus,
} from "../../../../lib/otb";
import { ingestInventory } from "../../../../lib/inventory-ingest";

export const dynamic = "force-dynamic";

const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "OPS");
const canApprove = (s) => hasRole(s, "ADMIN", "FINANCE");

// Full OTB version detail — summary, reconciliation and every register the
// workspace renders.
export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const version = await getOtbVersion(id);
  if (!version) return NextResponse.json({ error: "OTB version not found" }, { status: 404 });
  const scenario = version.scenario_code || "BASE";
  const [summary, reconciliation, storeSales, assumptions, inventory, newStores, closures, clearance, minStock, commitments, transfers] = await Promise.all([
    getOtbSummary(id, { scenario }), reconcileVersion(id, { scenario }), getStoreSales(id, { scenario }),
    getAssumptions(id), getInventoryPositions(id), listNewStores(id), listClosures(id), listClearance(id),
    listMinStockRules(), listCommitments(id), listTransfers(id),
  ]);
  return NextResponse.json({ ok: true, version, summary, reconciliation, storeSales, assumptions, inventory, newStores, closures, clearance, minStock, commitments, transfers });
}

export async function POST(request, { params }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "compute": return NextResponse.json(await computeOtb(id, { scenario: body.scenario }, session));
      case "approve": case "lock": case "reopen": case "archive": {
        if (!canApprove(session)) return NextResponse.json({ error: "Finance or admin only" }, { status: 403 });
        return NextResponse.json(await setOtbVersionApproval(id, body.op, session, body.note));
      }
      case "save-store-sales": return NextResponse.json(await saveStoreSales(id, body.rows || [], session));
      case "save-assumption": return NextResponse.json(await saveAssumption(id, body.assumption || {}, session));
      case "ingest-inventory": return NextResponse.json(await ingestInventory(id, body.csv || "", session));
      case "save-newstore": return NextResponse.json(await saveNewStore(id, body.row || {}, session));
      case "save-closure": return NextResponse.json(await saveClosure(id, body.row || {}, session));
      case "save-clearance": return NextResponse.json(await saveClearance(id, body.row || {}, session));
      case "save-minstock": return NextResponse.json(await saveMinStockRule(body.row || {}, session));
      case "delete-minstock": return NextResponse.json(await deleteMinStockRule(body.ruleId, session));
      case "save-transfer": return NextResponse.json(await saveTransfer(id, body.transfer || {}, session));
      case "transfer-decision": {
        if (!canApprove(session)) return NextResponse.json({ error: "Finance or admin only" }, { status: 403 });
        return NextResponse.json(await setTransferStatus(body.transferId, body.status, session));
      }
      default: return NextResponse.json({ error: `Unknown op '${body.op}'` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
