import { NextResponse } from "next/server";
import { getSession, hasRole } from "../../../lib/auth";
import { listProjects, upsertProject, getPortfolio, setAllocation, getAllocation } from "../../../lib/capex";

export const dynamic = "force-dynamic";
const canManage = (s) => hasRole(s, "ADMIN", "FINANCE", "EXEC");

export async function GET(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const url = new URL(request.url);
  const scenario = url.searchParams.get("scenario") || "BASE";
  const fiscalYear = url.searchParams.get("year") ? Number(url.searchParams.get("year")) : null;
  const [projects, portfolio] = await Promise.all([listProjects({ scenario }), getPortfolio({ scenario, fiscalYear })]);
  const allocation = fiscalYear != null ? await getAllocation(fiscalYear) : null;
  return NextResponse.json({ projects, portfolio, allocation });
}

export async function POST(request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!canManage(session)) return NextResponse.json({ error: "Not authorised" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  try {
    if (body.op === "set-allocation") return NextResponse.json(await setAllocation(body, session));
    return NextResponse.json(await upsertProject(body, session));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
