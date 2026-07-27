# Corporate Reporting Centre — Testing Results

_Miniso UK Finance OS. The test state at build completion, and how each spec
testing requirement is covered._

## Headline state

- **286 tests pass** across the suite, **21 new** for the Reporting Centre.
- **`next build` is clean** (no type/lint/compile errors introduced).
- **Migration 045 applies on a fresh Postgres**, seeding all **five** corporate
  templates, with the **Weekly Trade Pack** carrying its **17** sections.
- An **end-to-end engine smoke test passed**: create → resolve → validate →
  snapshot.

## New automated tests (21)

Pure-rules unit tests, run with `node --test`:

### `tests/reporting-rules.test.mjs` (15)

Covers the lifecycle and shaping rules in `reporting-rules.js` and
`commentary-perspectives.js`:

- every transition target/source is a known status;
- the happy-path lifecycle draft → review → approval → approved → issued;
- illegal transitions and unknown actions/statuses are rejected;
- a failed validation blocks `approve` and `ready_for_approval` but not
  `start_review`;
- editable vs locked statuses;
- `validateReportInput` happy and sad paths;
- `reorderSections` respects the requested order and renumbers;
- mandatory sections cannot be excluded;
- version labels (`Draft v0.1`, `Approved v1.0`, `Approved v1.2`);
- `formatReportMoney` display units and en-GB negatives;
- `deriveDefaultTitle`;
- all ten perspectives exist and are recognised;
- `defaultIncludeFor` scales with detail level;
- `buildReportContext` produces the governed context shape (no raw data) with safe
  fallbacks;
- `renderContextPreamble` is deterministic text.

### `tests/reporting-validation.test.mjs` (6)

Covers `validation-rules.js`:

- a complete, fresh, reviewed report passes and can be issued;
- a missing mandatory section fails and blocks issue;
- an unreviewed AI commentary draft fails (cannot be issued);
- stale data warns but does not block;
- missing section data fails;
- missing confidentiality fails, while missing reviewer/approver warn.

## Spec testing requirements — coverage map

| Requirement | How it is covered |
|---|---|
| Lifecycle state machine is correct and enforces gates | **Automated** (reporting-rules) |
| Failed validation blocks approval/issue | **Automated** (both suites) |
| Validation checklist levels (PASSED/WARNING/FAILED) and `canIssue` | **Automated** (reporting-validation) |
| Ten commentary perspectives present and guarded | **Automated** (reporting-rules) |
| Report-context object carries metadata only, no raw data | **Automated** (reporting-rules) |
| Money/display-unit formatting (en-GB) | **Automated** (reporting-rules) |
| Section reorder / mandatory exclusion rules | **Automated** (reporting-rules) |
| Migration 045 applies cleanly; 5 templates seeded; Weekly Trade Pack 17 sections | **Verified at build** (fresh Postgres apply) |
| End-to-end engine: create → resolve → validate → snapshot | **Verified manually** (engine smoke test) |
| Source adapters degrade honestly (awaiting / missing) rather than fabricate | **Verified manually** via the smoke test and by design (`resolveSource` never throws); adapter internals are DB/service-backed and not unit-tested in isolation |
| AI commentary draft → review → approve → lock, auditable run | **Verified manually / by reuse** — reuses the already-tested Intelligence Layer path; not re-unit-tested here (requires a live model call) |
| Exports (PPTX/XLSX) build from the assembled shape; checksum recorded | **Verified at build / manually** — exporters are pure over the assembled shape; not unit-tested with binary assertions |
| Print/PDF view renders governed sections and approved commentary | **Verified manually** in the app |
| `next build` clean | **Verified at build** |

## What is deliberately not automated

The pure rules — the highest-risk, most reusable logic — are unit-tested. The
DB-facing engine, the source adapters, the AI commentary path and the binary
exporters are covered by the build, the migration apply and the end-to-end smoke
test rather than by isolated unit tests, matching the codebase convention of
unit-testing the pure `*-rules` layer and integration-verifying the I/O layers.
Binary-diffing PPTX/XLSX output and mocking a live model call are noted as
possible fast-follow test additions.
