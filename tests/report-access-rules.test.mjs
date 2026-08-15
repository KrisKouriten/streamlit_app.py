import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canAccessReport, hasFullReportAccess, accessibleTemplateKeys, filterViewableReports,
  canExport, EXPORT_ROLES,
  REPORT_VERBS, REPORT_VERB_COL,
} from "../lib/reporting/report-access-rules.js";

const opsPerms = [
  { department: "Operations", template_key: "WEEKLY_TRADE_PACK", can_view: true, can_export: false, active: true },
  { department: "Operations", template_key: "BUDGET_FORECASTS_DECK", can_view: true, can_export: true, active: true },
  { department: "Operations", template_key: "FINANCE_BOARD_DECK", can_view: false, active: true },
];

test("full-access roles see everything", () => {
  assert.equal(hasFullReportAccess(["FINANCE"]), true);
  assert.equal(hasFullReportAccess(["ADMIN"]), true);
  assert.equal(hasFullReportAccess(["EXEC"]), true);
  assert.equal(hasFullReportAccess(["OPS"]), false);
  assert.equal(canAccessReport({ roles: ["FINANCE"], permissions: [], templateKey: "FINANCE_BOARD_DECK" }), true);
});

test("non-finance role needs an explicit grant", () => {
  assert.equal(canAccessReport({ roles: ["OPS"], permissions: opsPerms, templateKey: "WEEKLY_TRADE_PACK" }), true);
  assert.equal(canAccessReport({ roles: ["OPS"], permissions: opsPerms, templateKey: "FINANCE_BOARD_DECK" }), false);
  // No permissions at all → denied for non-finance.
  assert.equal(canAccessReport({ roles: ["OPS"], permissions: [], templateKey: "WEEKLY_TRADE_PACK" }), false);
});

test("verbs are independent", () => {
  assert.equal(canAccessReport({ roles: ["OPS"], permissions: opsPerms, templateKey: "WEEKLY_TRADE_PACK", verb: "export" }), false);
  assert.equal(canAccessReport({ roles: ["OPS"], permissions: opsPerms, templateKey: "BUDGET_FORECASTS_DECK", verb: "export" }), true);
});

test("effective dates gate access", () => {
  const future = [{ template_key: "WEEKLY_TRADE_PACK", can_view: true, active: true, effective_from: "2027-01-01" }];
  assert.equal(canAccessReport({ roles: ["OPS"], permissions: future, templateKey: "WEEKLY_TRADE_PACK", today: "2026-08-02" }), false);
  assert.equal(canAccessReport({ roles: ["OPS"], permissions: future, templateKey: "WEEKLY_TRADE_PACK", today: "2027-02-01" }), true);
  const expired = [{ template_key: "WEEKLY_TRADE_PACK", can_view: true, active: true, effective_to: "2026-01-01" }];
  assert.equal(canAccessReport({ roles: ["OPS"], permissions: expired, templateKey: "WEEKLY_TRADE_PACK", today: "2026-08-02" }), false);
});

test("inactive grant is ignored", () => {
  const off = [{ template_key: "WEEKLY_TRADE_PACK", can_view: true, active: false }];
  assert.equal(canAccessReport({ roles: ["OPS"], permissions: off, templateKey: "WEEKLY_TRADE_PACK" }), false);
});

test("accessibleTemplateKeys: null for full access, list otherwise", () => {
  assert.equal(accessibleTemplateKeys({ roles: ["FINANCE"], permissions: [] }), null);
  const keys = accessibleTemplateKeys({ roles: ["OPS"], permissions: opsPerms, verb: "view" });
  assert.deepEqual(keys.sort(), ["BUDGET_FORECASTS_DECK", "WEEKLY_TRADE_PACK"]);
});

test("filterViewableReports hides ungranted reports for non-finance", () => {
  const reports = [
    { report_id: 1, template_key: "WEEKLY_TRADE_PACK" },
    { report_id: 2, template_key: "FINANCE_BOARD_DECK" },
    { report_id: 3, template_key: "BUDGET_FORECASTS_DECK" },
  ];
  const finance = filterViewableReports(reports, { roles: ["FINANCE"], permissions: [] });
  assert.equal(finance.length, 3);
  const ops = filterViewableReports(reports, { roles: ["OPS"], permissions: opsPerms });
  assert.deepEqual(ops.map((r) => r.report_id).sort(), [1, 3]);
});

test("verb vocab is complete", () => {
  assert.equal(REPORT_VERBS.length, 8);
  for (const v of REPORT_VERBS) assert.ok(REPORT_VERB_COL[v], `missing column for ${v}`);
});

test("HEAD is a full-access reporting role", () => {
  assert.equal(hasFullReportAccess(["HEAD"]), true);
  assert.equal(canAccessReport({ roles: ["HEAD"], permissions: [], templateKey: "FINANCE_BOARD_DECK", verb: "export" }), true);
});

test("canExport allows only the reporting-protection group", () => {
  for (const r of EXPORT_ROLES) assert.equal(canExport({ roles: [r] }), true, `${r} should export`);
  assert.equal(canExport({ roles: ["ADMIN"] }), true);
  assert.equal(canExport({ roles: ["EXEC"] }), true);
  assert.equal(canExport({ roles: ["FINANCE"] }), true);
  assert.equal(canExport({ roles: ["HEAD"] }), true);
  assert.equal(canExport({ roles: ["OPS"] }), false);
  assert.equal(canExport({ roles: ["FRANCHISEE"] }), false);
  assert.equal(canExport({ roles: [] }), false);
  assert.equal(canExport(null), false);
});
