export const STAGES = [
  {
    id: "bank",
    label: "Bank & cash recs",
    tasks: ["Bank statements imported", "All accounts reconciled", "Cash & FX revaluation"],
  },
  {
    id: "journals",
    label: "Accruals & journals",
    tasks: ["Accruals posted", "Prepayments amortised", "Depreciation run", "Recurring journals posted"],
  },
  {
    id: "arap",
    label: "AR / AP & intercompany",
    tasks: ["AR aging reviewed", "AP aging reviewed", "Intercompany matched & eliminated"],
  },
  {
    id: "report",
    label: "Reporting, tax & sign-off",
    tasks: ["Flux / variance review", "VAT / tax provision", "Management pack issued", "CFO sign-off"],
  },
];

// Replace these with your real entity names. Order is preserved in the UI.
export const ENTITIES = [
  "UK Holdings", "UK Retail", "UK Logistics", "Ireland Ops",
  "France SAS", "Germany GmbH", "Spain SL", "Italy Srl",
  "Netherlands BV", "Belgium NV", "Nordics AB", "Poland Sp",
  "US Inc", "US West LLC", "Canada Ltd", "Mexico SA",
  "Brazil Ltda", "UAE FZE", "Singapore Pte", "Hong Kong Ltd",
  "Australia Pty", "Japan KK", "India Pvt", "Group Elims",
];

export const TOTAL_TASKS = STAGES.reduce((s, st) => s + st.tasks.length, 0);

export function taskKey(entity, stageId, index) {
  return `${entity}|${stageId}|${index}`;
}
