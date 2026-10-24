# Billing milestone

## Baseline observed before refactoring

- `/bills` selects the newest rental visible to the current user. Admins can create,
  edit, mark paid, and delete; renters view bills and receipts. Active renters start
  on the open tab. Other renters start on all. Each page contains ten bills.
- Bills have rent, SDG&E, AT&T, notes, due date, paid date, and four manually selected
  states: open, paid, overdue, void. Overdue is not calculated from today's date.
  All state changes are allowed, including marking a void bill paid.
- Totals are recalculated from the three dollar charges, not the stored total.
  Inputs have no nonnegative constraint, so signed credits remain supported.
- A recognized status takes precedence over the legacy paid flag. Missing status
  falls back to paid. Creation defaults the due date to today in Los Angeles;
  marking paid defaults the payment date to today in Los Angeles.
- Receipt uploads use the existing `recipts` field; reads also support `receipts`.
  Receipts can be filenames or existing URLs. Editing preserves existing files.
  Image receipts have a preview; other files open separately.
- Rental `bills` relations are preferred; legacy bill `rental` relations are used
  as fallback. Creation attaches the new bill to the rental's `bills` relation.
- Printing calls the browser's print dialog with the bill month as document title;
  it prints the current page, not a separate invoice.
- The dashboard displays the selected rental's bills by state, provides receipt
  previews, and creates open bills due in 30 days before navigating to `/bills`.

## Existing defects and deliberate corrections

- Browser filtering is not authorization. Billing will enforce authenticated roles
  and verified rental ownership on the server, in addition to PocketBase rules.
- Query failures currently become empty lists, and relation attachment failures
  are silently ignored. The new path reports errors rather than claiming success.
- Search sends a PocketBase filter expression to a plain-text matcher. Correct
  search matches id, notes, and due date as plain text.
- Status filtering currently runs after pagination. Correct filtering runs before
  pagination; pagination and filters remain available when no results match.
- Hydration can expose contradictory status/paid fields and stale paid dates.
  Status will be authoritative; non-paid states clear paidDate on writes.
- Floating dollar arithmetic is replaced by integer cents. New input rejects
  fractions of a cent; legacy numeric amounts round to the nearest cent.
- Invalid calendar dates and malformed amounts will be rejected, not coerced.

No collection, access-rule, or schema migration is part of this milestone.

## Implemented architecture

- `domain/Bill.ts`: immutable bill snapshots, integer-cent totals, explicit money
  conversion, date-only validation, and payment transitions. No Svelte, PocketBase,
  file URLs, or browser globals are used in this layer.
- `application/Billing.ts`: authenticated billing use cases for context, lists,
  filtered pages, save, mark paid, and delete. Admin checks precede mutations;
  renter reads require verified rental ownership. DTOs are plain typed objects.
- `application/BillRepository.ts`: the persistence contract. No base repositories
  or inheritance hierarchy is introduced.
- `infrastructure/`: legacy mappers, a request-scoped PocketBase adapter, and
  SvelteKit action/error helpers. Failures are not disguised as empty results.
- `ui/`: shared receipt presentation and action submission. Bills and dashboard
  retain their screens and reactive presentation state.
- Both route server loads and actions obtain PocketBase from `event.locals.pb`;
  billing pages no longer query or mutate PocketBase in the browser. Other
  dashboard features remain outside this milestone.
- The old `BillService` and `BillRecord` are removed after migrating their billing
  consumers. Existing model type imports re-export the new DTO/payment types.

## Compatibility and review repairs

- Existing stored dollar amounts are converted to integer cents on read and back
  to dollars on write; stored totals are recalculated. Signed credits remain valid.
- Dates retain their calendar portion, including legacy PocketBase timestamps.
- Status is authoritative; the legacy `paid` flag is derived on writes. Unknown
  nonempty statuses retain the old fallback to open; absent status uses `paid`.
- Both receipt spellings are read and deduplicated. Uploads append to the actual
  field present on the record, preserving existing files. The default remains the
  legacy spelling when neither field is returned. File restrictions stay in
  PocketBase; this milestone does not alter them.
- Reverse `rental.bills` links retain their existing read precedence. When none
  exist, bill-side `rental` relations are read. New bills include the canonical
  relation, and reverse links are maintained only when that field already exists.
  This fixes the reviewed implementation's assumption that every schema has it.
- Conflicting canonical and reverse rental links produce an explicit error rather
  than exposing a bill through the wrong rental. Reverse-only legacy bills remain
  supported. Reconciliation is intentionally not automatic.
- Failed creation attachments attempt rollback of the newly created bill. Failed
  rollback and partial update/delete failures report reconciliation guidance.
  Multi-record PocketBase operations are not transactional.
- Optional custom IDs entered in the existing new-bill field are validated as 15
  lowercase letters/digits; the old service silently ignored that input.
- Dashboard creation now navigates to the bill's rental explicitly instead of
  falling back to the newest rental.

## Verification and limitations

- Final local run: `npm test` passes all 53 tests in 7 files, including all
  existing inspection and greeting tests. `npm run build` passes; it does not
  deploy. `git diff --check` passes.
- Local HTTP smoke checks: anonymous `/bills` and `/dashboard` GETs redirect to
  login (303); anonymous save/create POSTs return SvelteKit action failures with
  status 401 (the action JSON transport uses HTTP 200).
- Domain/application tests cover totals, signed amounts, conversion and rounding,
  date-only/leap-day handling, payment transitions, legacy mapping, runtime input
  validation, filtering/pagination, admin actions, and renter ownership checks.
- Mocked SDK tests cover both relation schemas, conflicting ownership links,
  receipt append semantics, query errors, and failed-link rollback.
- Server-boundary tests exercise the actual bills/dashboard loads and actions for
  admin CRUD, renter access and forged mutations, anonymous sessions, invalid
  input, and PocketBase failures. All SDK calls are mocked; no network writes occur.
- Rendered Svelte tests cover renter controls, receipt preview, printing invocation,
  admin edits/payments/deletion, empty-state filters, failed saves, and dashboard
  creation. These are jsdom checks, not full browser/PDF rendering checks.
- `npm run check` currently reports three pre-existing errors in unchanged files:
  `src/routes/+layout.svelte:13` (`$props` generic syntax), and
  `src/routes/maintenance/+page.svelte:79` and `:725` (thread role/reply types).
  They are outside this billing change. Existing unrelated warnings also remain.
- Live authenticated admin/renter checks, real file uploads, and printed output
  inspection require an explicitly designated development PocketBase instance and
  test accounts. No configured instance is assumed safe for writes.
- Billing reads still materialize lists before filtering/pagination, retaining the
  small single-rental app's existing scale assumptions.
- Existing bills-page pills label non-paid states as Open even in overdue/void
  tabs; the dashboard labels those states individually. This inherited display
  inconsistency is recorded here rather than silently changed during extraction.
- Direct PocketBase access remains governed by existing collection rules. Server
  checks protect these application routes but do not tighten permissive API rules.

## Deferred inspection direction

Inspections are not implemented or refactored in this milestone. The agreed next
direction is a simple editable default template for a one-bedroom rental, printed
for handwritten condition notes and signatures. Upload the completed signed sheet
and supporting photos as attachments to an inspection record. Preserve existing
records, inspection history, and signed originals; regenerated printouts must never
replace signed evidence. Do not add a complex digital checklist or signature system.
Verify the existing attachment fields before implementing uploads; any missing
schema capability requires a separate decision, not an automatic migration.

No production data, rules, or schema changes, merge, or deployment are authorized.