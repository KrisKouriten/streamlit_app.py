import { listProjects, getPortfolio, getProject, getAllocation } from "../../../lib/capex";

// Shared data load for the two Capex routes — /plan/capex (portfolio + appraisal)
// and /plan/capex/allocation (capital allocation). `forceView` pins the view for
// the dedicated allocation route; otherwise it honours ?view=allocation. Keeping
// this in one place means both routes read exactly the same projects / portfolio /
// capital position and only differ in which sub-view the workspace renders.
export async function loadCapexData(searchParams, forceView) {
  const sp = (await searchParams) || {};
  const scenario = sp.scenario || "BASE";
  const fiscalYear = sp.year ? Number(sp.year) : 2026;
  const view = forceView || (sp.view === "allocation" ? "allocation" : "portfolio");
  const selectedId = sp.p || null;

  const [projects, portfolio, allocation] = await Promise.all([
    listProjects({ scenario }).catch(() => []),
    getPortfolio({ scenario, fiscalYear }).catch(() => null),
    getAllocation(fiscalYear).catch(() => null),
  ]);
  const selected = selectedId ? await getProject(selectedId).catch(() => null) : null;

  return { projects, portfolio, allocation, selected, view, scenario, fiscalYear };
}
