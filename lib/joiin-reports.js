/*
 * Miniso UK board-pack custom reports in Joiin — scope → customReportId.
 * These are saved Joiin Custom Report Layouts; called by id they return each
 * P&L already laid out and consolidated (wholesale intercompany eliminated),
 * so the app renders Joiin's own board pack rather than recomputing it.
 * Non-secret identifiers. The 24 group company ids the reports run across live
 * in lib/entity-map.js.
 */
export const BOARDPACK_REPORTS = {
  store: "3cfd5ddb-76b2-4c4b-a466-26c30e1a8c47",
  head_office: "b1048b9f-b74a-4ace-8a6e-b997b6ae3c60",
  franchise: "fbdb42ac-599d-4c10-a629-57ea1ca50d1d",
  consolidated: "c9e07f4b-0177-46b2-be6f-aeb4bce7f072",
};

export const BOARDPACK_SCOPES = [
  { scope: "store", label: "Store" },
  { scope: "head_office", label: "Head Office" },
  { scope: "franchise", label: "Franchise" },
  { scope: "consolidated", label: "Consolidated" },
];
