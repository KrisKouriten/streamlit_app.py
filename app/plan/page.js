import { redirect } from "next/navigation";

// PLAN folded into DASHBOARDS (Phase 8). Budget & Forecast now lives under the
// DASHBOARDS section; this route is kept so old links/bookmarks still resolve.
export const dynamic = "force-dynamic";
export default function Plan() {
  redirect("/dashboards");
}
