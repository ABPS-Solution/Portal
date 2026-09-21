# `purchase` schema

The `purchase` schema covers the Purchase department's whole workflow: turning an authorized BOQ's material shortfall into a **Purchase Request Note (PRN)**, raising a **Raw Material Purchase Order (RM PO)** against a vendor, scheduling that PO's delivery across multiple date/quantity **tranches** (PPS Tracking), and tracking vendor performance over time. It leans heavily on `design.item_codes` (every material line references the master catalog) and `project.projects` (every PRN/PPS row is scoped to a project), and it hands off to `store` once material physically arrives (Gate Entry / GRN / QA, which live in the `store` schema, not here).

---

## design gotcha carried over from context (not a purchase table, but load-bearing)

`purchase.purchase_request_notes.boq_id` and `purchase.pps_tracking`/`prn_line_items` all key off `design.boq_drafts` (the LIVE BOQ table — see `design.md`'s naming-gotcha warning), never `design.bill_of_quantity` (the per-line mirror table). Every "which BOQ does this PRN belong to" question in this schema resolves through `boq_drafts`.

---

## purchase.purchase_request_notes

**The PRN header** — one row per Purchase Request Note, raised against a specific BOQ once Design has authorized it and a material shortfall against current stock exists. A PRN is what tells Purchase "these materials, in these quantities, are needed for this project."

| Column | Type | Description / Use Case |
|---|---|---|
| `prn_id` | text (PK) | **App-generated string, NOT a DB sequence** — derived from the BOQ id (e.g. `PRN_<boq-suffix>`). A pre-15-Sep-2026 DB-level `DEFAULT ('PRN-'\|\|nextval(prn_id_seq))` existed on this column but was **dead** (never actually triggered, since the app always supplies the derived id explicitly) and was dropped along with its orphaned sequence in migration 201 (15 Sep 2026) — confirmed live that no such default remains. |
| `project_id` | text, FK → `project.projects` | The project this PRN's materials are for. |
| `boq_id` | text, FK → `design.boq_drafts(boq_id)` `ON UPDATE CASCADE` | The BOQ this PRN was raised against — one PRN typically corresponds to one BOQ's outstanding material need. |
| `product_name` / `product_rating` | text | Denormalized from the parent BOQ, for display without a join. |
| `order_quantity` | numeric(14,3) | Denormalized order quantity from the parent BOQ at the time the PRN was created/revised. |
| `created_date` | timestamptz, default now() | When the PRN was raised. |
| `created_by` | text | Person key of whoever created it. |
| `status` | text, default `'PRN Generated'` | Lifecycle status string (e.g. Generated, Pending Authorization, Authorized, etc. — the exact set of values is enforced app-side, not by a CHECK constraint on this column). |
| `version` | integer, default 1 | Bumped on each PRN revision — a PRN can be revised when its parent BOQ's quantity changes; `boq_version_applied` tracks which BOQ version this PRN reflects. |
| `pdf_url` | text | Drive link to the generated PRN PDF. |
| `pps_pdf_url` | text | Drive link to the PPS Document — a PDF snapshot of this PRN's full delivery picture across every PO its material has ever been allocated against (added 11 Sep 2026 migration 194 as a PER-PO document; **moved to PER-PRN 16 Sep 2026 migration 202**, this column replaces the old `raw_material_purchase_orders.pps_pdf_url`), regenerated on every `savePODeliverySchedule` save that touches this PRN. |
| `pps_pdf_version` | integer, default 0 | Version counter for the PPS Document, incremented each regeneration (versioned filename `PPS_V<n>_<prnId>.pdf` for v2+). |
| `draft_line_items` | jsonb | Working/staged line-item data during PRN creation or revision, before it's committed into `prn_line_items` rows. |
| `authorized_by` | text | Person key of the authorizer (maker-checker). |
| `authorized_at` | timestamptz | When authorized. |
| `previous_snapshot` | jsonb | A snapshot of the PRN's prior state, kept for revision comparison/audit (what changed between versions). |
| `boq_version_applied` | integer | Which `boq_drafts.version` this PRN's current line items were generated against — lets the system detect a now-stale PRN when the BOQ has since moved on to a newer version. |

**Indexes/constraints of note:** `uq_prn_one_pending_per_boq` — a partial unique index ensuring only one Pending-Authorization PRN can exist per BOQ at a time (maker-checker single-flight guard).

---

## purchase.prn_line_items

**The PRN's material lines** — one row per material (item code) within a PRN, carrying the full quantity-accounting breakdown between "what the BOQ needs," "what's already in stock," "what's on order," and "what's actually left to purchase."

| Column | Type | Description / Use Case |
|---|---|---|
| `line_id` | bigint (PK) | Surrogate id. |
| `prn_id` | text, FK → `purchase_request_notes(prn_id)` `ON UPDATE CASCADE ON DELETE CASCADE` | Which PRN this line belongs to. |
| `item_code` | text, FK → `design.item_codes` | The material being requested. |
| `material_name` | text | Denormalized material name at PRN-creation time. |
| `type_of_material` | text | Denormalized material category, used to look up `material_buffer_percentage`. |
| `boq_required_quantity` | numeric(14,3) | The raw quantity the BOQ says is needed (before buffer). |
| `buffer_percent` | numeric(5,2) | The buffer percentage applied for this material's type (from `material_buffer_percentage`), to cover wastage/rejection margin. |
| `buffered_purchase_quantity` | numeric(14,3) | `boq_required_quantity` grossed up by `buffer_percent` — the real target purchase quantity. |
| `current_unassigned_store_quantity` | numeric(14,3) | Snapshot of how much free (unreserved) stock existed in Store at PRN-creation/revision time — used to net down what actually needs purchasing. |
| `purchase_quantity` | numeric(14,3) | The quantity actually recommended to purchase after netting against store stock. |
| `original_purchased_buffered_quantity` | numeric(14,3) | The buffered purchase quantity as it stood at the time a PO was first raised against this line — a frozen reference point for later revision comparisons. |
| `assigned_quantity` | numeric(14,3), default 0 | How much of this line's need has been assigned/reserved against actual store or on-order stock via `lib/prnSync.js`'s stock-reservation engine. |
| `on_order_quantity` | numeric(14,3), default 0 | How much is currently on an authorized, not-yet-received PO for this line. |
| `still_to_order_quantity` | numeric(14,3) | What remains genuinely unordered — the number that drives "PRNs With No/Partial Materials Assigned" dashboard tiles. |
| `created_by` | text | Person key of the PRN's creator. |
| `unit_type` | text | Unit of measure for this line. |
| `awaiting_po_revision` | boolean, default false | Flags that this line's quantity has changed since the last PO was placed and needs a PO revision to reconcile — drives the "Needs PO Revision" queue. |
| `received_quantity` | numeric, default 0 | Cumulative quantity of this material actually received (via Gate Entry/GRN) against this PRN line. |
| `store_qty_from_spare` / `store_qty_from_raw` | numeric, default 0 | How much of the fulfilled quantity was drawn from the Spare Store pool vs. the Raw Material Store pool respectively — the two are tracked separately since they're different physical stock pools. |
| `spare_pool_remaining` / `raw_pool_remaining` | numeric, default 0 | **The authoritative "what does this BOQ still hold" figures** — per CLAUDE.md's own documented landmine, `store.stock_reservations` is an append-only audit log, NOT a live balance; these two columns on `prn_line_items` are what actually answer "how much reserved stock remains against this line," split by pool. |

---

## purchase.pps_tracking

**PPS (Purchase-Production-Schedule) Tracking's per-material-per-PO row** — the working table that ties a PRN's material line to the specific PO/vendor it was ordered from, plus a coarse expected/actual delivery snapshot. Note: as of the delivery-schedule redesign, the *authoritative* fine-grained delivery scheduling lives in `po_delivery_schedule` (see below); this table's `expected_delivery_date`/`actual_delivery_date` are the older, coarser per-line delivery-event fields still used for the "has this line's PO actually delivered" question and the vendor-performance/dashboard delay math.

| Column | Type | Description / Use Case |
|---|---|---|
| `pps_id` | bigint (PK) | Surrogate id. |
| `project_id` | text, FK → `project.projects` | Which project this scheduling line belongs to. |
| `prn_id` | text, FK → `purchase_request_notes(prn_id)` `ON UPDATE CASCADE ON DELETE CASCADE` | Which PRN this material was requested under. **Load-bearing for cross-PRN isolation** — two different PRNs can each hold their own allocation against the same PO+item line; a real cross-PRN data-corruption bug (found/fixed 1-2 Sep 2026) came from queries that matched only on `(po_no, item_code)` and ignored `prn_id`, silently mixing sibling PRNs' schedule data. |
| `item_code` | text, FK → `design.item_codes` | The material. |
| `material_name` | text | Denormalized name; note `pps_tracking.material_name` is itself sourced from an already-combined `description` string (from the RM PO line), so it can already contain `" - Make: X"` — appending Make again on top of it (as some display code once did) doubles up into `"... - Make: X - Make: X"`. |
| `boq_quantity` | numeric(14,3) | The raw BOQ-required quantity for this material on this project. |
| `buffered_quantity` | numeric(14,3) | The buffered (wastage-margin-inflated) target quantity. |
| `store_reserved_quantity` | numeric(14,3) | How much of this need is already covered by reserved store stock. |
| `purchased_quantity` | numeric(14,3) | How much has actually been placed on a PO for this line — this is the "ordered quantity" the PPS work-queue's Unscheduled/Partial/Full 3-state rollup (`lib/ppsScheduleStatus.js`) compares scheduled quantity against. |
| `po_no` | text, FK → `raw_material_purchase_orders` | Which PO this line was purchased on. |
| `po_date` | date | The PO's order date. |
| `vendor_name` | text, FK → `vendor_information` | Which vendor the PO was placed with. |
| `expected_delivery_date` | date | Coarse expected-delivery date for this line (superseded for scheduling purposes by `po_delivery_schedule`'s per-tranche dates, but still read for some dashboard/vendor-performance math). |
| `actual_delivery_date` | date | When the material actually arrived — a receipt-event column. **Structurally stuck for "all PPS released" milestone purposes**: this field is never written by the modern schedule-based PPS Tracking screen, which is why Project Timeline's "All PPS Released" milestone was switched (1 Sep 2026) to read `lib/ppsScheduleStatus.js`'s 3-state rollup instead of this column. |
| `actual_received_quantity` | numeric(14,3) | How much was actually received against this line (may differ from `purchased_quantity` on a partial/short delivery). |
| `action_plan` | text | Free-text action plan / follow-up note entered by Purchase for a delayed or problem line, editable via `updatePPSActionPlan` (fixed 3 Sep 2026 to be wrapped in `withTransaction` for atomicity on batch updates). |
| `prn_created_date` | date | Denormalized PRN creation date, for aging/reporting without a join. |
| `link_status` | text | Free-text/status marker of how this PPS row's linkage state stands (exact semantics app-defined). |

**Unique constraint:** `pps_tracking_prn_item_po_uniq` on `(prn_id, item_code, po_no)` — one row per PRN+material+PO combination.

---

## purchase.po_delivery_schedule

**The live, authoritative delivery-schedule state for a PO** — replaces the old single-`expected_delivery_date`-per-PO model (migration 112, 19 Aug 2026). A PO's ordered quantity for one item can be split across multiple planned tranches (different quantities arriving on different dates), and — critically — **two different PRNs can independently schedule their own tranches against the same PO+item line**, which is why `prn_id` is part of both the row's identity and its uniqueness constraint.

| Column | Type | Description / Use Case |
|---|---|---|
| `schedule_id` | integer (PK) | Surrogate id. |
| `po_no` | text, FK → `raw_material_purchase_orders(po_no)` `ON DELETE CASCADE` | Which PO this tranche belongs to. |
| `item_code` | text | The material line within the PO this tranche schedules. |
| `prn_id` | text | Which PRN this tranche's quantity is allocated against — a PO line can be split across multiple PRNs, each with its own independent tranche sequence. |
| `seq` | integer | This tranche's position within its own PO+item+PRN sequence (1, 2, 3...) — re-numbered on every save to avoid transient collisions (existing rows are parked at a negative offset mid-transaction before final numbers are assigned, since Postgres checks non-deferred unique indexes per-statement, not at commit). |
| `planned_quantity` | numeric, CHECK `> 0` | How much of this tranche is planned to arrive. |
| `planned_date` | date | The currently-planned arrival date for this tranche — this is the live, editable value. |
| `original_planned_date` | date | The tranche's first-ever planned date, frozen at creation — lets the UI show how far a tranche has slipped from its original plan. |
| `fulfilled_quantity` | numeric, default 0 | How much of `planned_quantity` has actually arrived so far (partial fulfillment supported). |
| `status` | text, CHECK | `'Planned'` \| `'Partially Received'` \| `'Received'` \| `'Cancelled'`. A "deleted" tranche is soft-cancelled, not removed — its `seq` is parked negative on cancellation so it can't collide with a live tranche reusing that slot. |
| `created_by` / `created_at` | text / timestamptz | Who scheduled this tranche and when. |
| `updated_by` / `updated_at` | text / timestamptz | Who last edited it and when. |

**Unique constraint — the sharpest edge on this table:** `po_delivery_schedule_seq_uniq` on `(po_no, item_code, prn_id, seq) WHERE status <> 'Cancelled'`. This was originally `(po_no, item_code, seq)` (no `prn_id`) — correct only under a since-fixed bug where all PRNs sharing a PO line shared one seq sequence; once the read/write bugs were fixed so each PRN renumbers its own tranches 1..N independently, two sibling PRNs both wanting `seq=1` for the same PO+item legitimately collide, which is exactly why `prn_id` was added to the index in migration 163 (1 Sep 2026). A real customer PRN pair (Century Rayon, sharing one PO across a Reactor and an HT Capacitor Bank PRN) was corrupted by the pre-fix bug and had to be manually re-entered.

---

## purchase.po_delivery_schedule_history

**Append-only audit trail** for every change made to a `po_delivery_schedule` tranche — this is a pure history log, never read for live state (the live state is always `po_delivery_schedule` itself).

| Column | Type | Description / Use Case |
|---|---|---|
| `history_id` | integer (PK) | Surrogate id. |
| `schedule_id` | integer, FK → `po_delivery_schedule(schedule_id)` `ON DELETE CASCADE` | Which tranche this history row records a change to. |
| `old_date` / `new_date` | date | The tranche's planned date before/after this change. |
| `old_quantity` / `new_quantity` | numeric | The tranche's planned quantity before/after this change. |
| `changed_by` | text | Person key of whoever made the change. |
| `changed_at` | timestamptz, default now() | When the change happened. |
| `reason` | text | Free-text reason for the change, if supplied. |

---

## purchase.raw_material_purchase_orders

**The RM PO header** — one row per Purchase Order raised against a vendor for raw materials. This is the document Purchase actually sends to a vendor; its `material_rows` JSON plus the child `raw_material_po_line_items` table together describe what's being bought.

| Column | Type | Description / Use Case |
|---|---|---|
| `po_no` | text (PK) | **App-generated string, NOT a DB sequence** — format `PO_<FY>_00001`, allocated by an app-level scan-and-increment (find the highest existing number for the financial year, add one), not a DB sequence. A dead `DEFAULT ('PO-'\|\|nextval(po_no_seq))` existed on this column but was never triggered (same landmine class as `prn_id` above) and was dropped along with its orphaned sequence in migration 201 (15 Sep 2026). |
| `status` | text, CHECK, default `'Pending Authorization'` | `'Pending Authorization'` \| `'Authorized'` \| `'Rejected'`. |
| `vendor_name` | text, FK → `vendor_information` | The vendor this PO was placed with. |
| `order_date` | date, default `CURRENT_DATE` | The PO's order date. |
| `delivery_date` | date | The PO's overall (legacy/simple) expected delivery date — still printed on the PO PDF; the real scheduling detail lives in `po_delivery_schedule`, this is a single summary date. |
| `material_rows` | jsonb, default `'[]'` | The PO's material lines as JSON (mirrors the `raw_material_po_line_items` child rows — used for the PO PDF/preview rendering and revision diffing). |
| `sub_total` | numeric(16,2) | Sum of all material line amounts before tax/packing/freight. |
| `cgst_percent`/`cgst_amount`, `sgst_percent`/`sgst_amount`, `igst_percent`/`igst_amount` | numeric | GST breakdown — CGST+SGST for intra-state (Maharashtra), IGST for inter-state, computed on the material sub-total ALONE (Packing/Freight/Other are GST-inclusive and added after tax, a bug fixed 29 Aug 2026 that previously taxed them too). |
| `packing_amount` / `freight_amount` / `other_amount` | numeric(14,2) | Additional charges, entered GST-inclusive, added to the Grand Total AFTER tax (labeled "(including GST)"), hidden entirely for Import trade type. |
| `round_off_amount` | numeric(10,2) | Rounding adjustment applied to reach a clean Grand Total. |
| `grand_total` | numeric(16,2) | The PO's final total amount. |
| `warranty` | text | Warranty terms text printed on the PO. |
| `payment_terms` | text | Payment terms text. |
| `freight_terms` | text | Freight terms text. |
| `prepared_by` | text | Person key of the PO's creator. |
| `authorized_by` | text | Person key of the authorizer (maker-checker). |
| `created_at` | timestamptz, default now() | Creation timestamp. |
| `drive_file_url` | text | Drive link to the generated PO PDF. |
| `round_off` | numeric, default 0 | An older/secondary round-off value (kept alongside `round_off_amount` — likely a legacy duplicate field; check live usage before assuming which one is authoritative for a new report). |
| `supplier_ref_offer_no` | text | The vendor's own quotation/offer reference number, for cross-referencing their commercial offer. |
| `reconciled_prn_versions` | jsonb, default `'{}'` | A JSON object **keyed by `prn_id`** tracking which PRN version(s) this PO has reconciled against — noted as a landmine during the 29 Aug 2026 product-rename work because the *key itself* (not just a value) must be rewritten if a PRN id changes. |
| `revision_number` | integer, default 1 | Bumped on each PO revision (via `po_revision_requests`). |
| `folder_dated_at` | timestamptz | Timestamp used to date-stamp the Drive folder this PO's documents are filed under. |
| `notes` | text | Free-text internal notes on the PO. |
| `insurance` | text | Insurance terms text (added alongside the Import/Export PO redesign, 29 Aug 2026). |
| `trade_type` | text, CHECK, default `'Local'` | `'Local'` \| `'Import'` — **renamed from Import/Export on 30 Aug 2026** (migration 155) since an RM PO is always ABPS *buying*, so "Export" never made sense here; that language belongs to Project Invoice's separate sell-side toggle. `'Import'` triggers USD pricing (`usd_rate`) and suppresses GST entirely. **Note on migration history**: this migration was found silently unapplied on 1 Sep 2026 and applied by hand; a later audit (15 Sep 2026) discovered the migration FILE itself had its statements in the wrong order (data UPDATEs before the CHECK-constraint drop, so it could never have run cleanly as originally written) — the file has since been corrected to drop-then-migrate-then-re-add, matching the two-phase CHECK-widen pattern this codebase uses elsewhere. |
| `usd_rate` | numeric | The USD-to-INR conversion rate used for an Import-trade-type PO's pricing. |
| `pps_pdf_url` | text | **Dead as of 16 Sep 2026 (migration 202)** — the PPS Document moved from per-PO to per-PRN; this column is no longer written. See `purchase_request_notes.pps_pdf_url` for the live equivalent. Left in place, not dropped, per house convention. |
| `pps_pdf_version` | integer, default 0 | **Dead as of 16 Sep 2026** — same as above, see `purchase_request_notes.pps_pdf_version`. |
| `checking_draft_count` | integer, default 0 | **RM PO Checking Draft loop (18-19 Sep 2026).** An RM PO used to produce NO document at all until Authorized — now Create RM PO auto-generates a watermarked "FOR CHECKING ONLY" PDF (a `— DRAFT #N` suffix on the PO number, `Checked & Signed By` in place of `Checked By`/`Authorized By`) for a paper review loop with the department head. This column is the authoritative printed draft number, bumped each time "Generate Checking Draft" is clicked from **Create RM PO → Pending POs (Editing)**, never derived by counting Drive files. |
| `checking_doc_url` / `checking_doc_file_id` | text | The current checking draft's Drive link/file id — **updated in place on every regeneration** (`lib/checkingDraft.js`'s `updateFileContent`, not delete-and-reupload) so a link the reviewer has open never breaks. Cleared to NULL on Authorize or Reject, once the real signed PO PDF exists (or the PO is rejected outright). |

---

## purchase.raw_material_po_line_items

**The PO's material lines** — one row per material ordered on a given PO, the child table to `raw_material_purchase_orders` (also mirrored into that table's own `material_rows` JSON).

| Column | Type | Description / Use Case |
|---|---|---|
| `line_id` | bigint (PK) | Surrogate id. |
| `po_no` | text, FK → `raw_material_purchase_orders(po_no)` `ON DELETE CASCADE` | Which PO this line belongs to. |
| `description_of_material` | text | **A different, untouched column from `design.boq_drafts.description_of_material`** (that one is the BOQ variant-qualifier concept) — this is genuinely just the PO line's description text, now REQUIRED (was optional) as of the 30 Aug 2026 RM PO redesign. Since 11 Sep 2026, auto-fills from the selected material's combined name when a Material Name is picked (still freely editable afterward). |
| `item_code` | text, FK → `design.item_codes` | The material being purchased. |
| `quantity` | numeric(14,3) | Quantity ordered on this line. |
| `unit` | text | Unit of measure. |
| `rate_per_quantity` | numeric(14,2) | Unit rate agreed with the vendor. |
| `discount_percent` | numeric(5,2) | Any line-level discount percentage. |
| `amount` | numeric(14,2) | Line total (`quantity × rate_per_quantity`, net of discount). |
| `delivery_date` | date | Legacy per-line delivery date field — largely superseded by `po_delivery_schedule`'s per-tranche dates for actual scheduling, but still present/populated on the line. |
| `additional_description` | text | Extra free-text notes/specs for this specific line, separate from the required `description_of_material`. |

---

## purchase.po_revision_requests

**Maker-checker queue for revising an already-authorized PO** (Revise PO / Approve PO Revision) — covers both PRN-driven revisions (quantities changed because underlying PRN lines changed) and standalone/cancellation revisions.

| Column | Type | Description / Use Case |
|---|---|---|
| `request_id` | integer (PK) | Surrogate id. |
| `po_no` | text, FK → `raw_material_purchase_orders(po_no)` `ON DELETE CASCADE` | Which PO this revision targets. |
| `status` | text, CHECK, default `'Pending Authorization'` | `'Pending Authorization'` \| `'Authorized'` \| `'Rejected'`. |
| `revision_kind` | text, CHECK, default `'PRN Driven'` | `'PRN Driven'` (triggered by an underlying PRN's quantity change) \| `'Standalone'` (a manual header/line edit not tied to a PRN change) \| `'Cancellation'` (cancelling the PO outright). |
| `revised_line_items` | jsonb | The proposed new material line set for this revision. |
| `allocations` | jsonb, default `'[]'` | How the revised quantities are allocated back across the PRN(s) that fed this PO. |
| `drafted_prn_versions` | jsonb, default `'{}'` | Which PRN version(s) this revision draft was built against, for staleness detection. |
| `requested_by` | text | Person key of whoever drafted the revision. |
| `requested_at` | timestamptz, default now() | When drafted. |
| `authorized_by` | text | Person key of the authorizer (maker-checker). |
| `authorized_at` | timestamptz | When authorized/rejected. |
| `rejection_reason` | text | Free-text reason if rejected. |
| `header_changes` | jsonb | Any proposed changes to PO header fields (vendor terms, trade type, etc.) as part of this revision, separate from the line-item changes. |
| `checking_draft_count` / `checking_doc_url` / `checking_doc_file_id` | integer / text / text | **RM PO Checking Draft loop, extended to revisions (18-19 Sep 2026).** Revise RM PO's own **"Pending Revisions (Editing)"** tab reuses the exact same rich revision form to edit a drafted revision and generate its own checking draft — rendering the MERGED preview (live PO ⊕ drafted changes), via `lib/poRevisionMerge.js`'s pure-function helpers, which are also reused by the real `authorizePORevision` commit path so the preview and the actual merge can never disagree. Cleared once Authorize PO Revision commits (or the revision is rejected). |

**Unique constraint:** `po_revision_requests_one_pending` — a partial unique index ensuring only one pending revision request can exist per PO at a time.

---

## purchase.vendor_information

**The vendor master** — one row per vendor ABPS buys raw materials from, holding their registration/tax/contact details and default GST rates.

| Column | Type | Description / Use Case |
|---|---|---|
| `vendor_name` | text (PK) | The vendor's name — used as the natural key everywhere a PO/PPS row references a vendor (no surrogate id). |
| `gstin_uin` | text | The vendor's GST registration number. |
| `type_of_vendor` | text | Category/classification of the vendor (free text). |
| `contact_person` | text | Vendor's contact person name. |
| `phone_number` / `email` | text | Vendor contact details. |
| `city` / `state` / `state_code` / `address` | text | Vendor's location — `state_code` (2-digit) is used to determine CGST+SGST (intra-state, Maharashtra) vs. IGST (inter-state) on a PO. |
| `status` | text, default `'Active'` | Active/inactive flag for the vendor (soft state, not a hard delete). |
| `cgst_percent` / `sgst_percent` / `igst_percent` | numeric, defaults 9/9/0 | The vendor's default GST split, pre-filled onto a new PO for this vendor and editable per-PO. |

---

## purchase.vendor_performance

**Rolling per-vendor performance metrics** — recomputed and overwritten (not incrementally maintained in the general case) by `reconcileVendorPerformance()`, run nightly via Cloud Scheduler plus on-demand by admins; a lighter incremental bump also happens inside Store's QA-commit flow for freshness between full reconciles (deliberately not mirrored into the QA-reversal paths, since the nightly reconcile self-heals any resulting drift).

| Column | Type | Description / Use Case |
|---|---|---|
| `vendor_name` | text (PK), FK → `vendor_information` | The vendor these metrics are for. |
| `total_pos_raised` | integer, default 0 | Count of POs ever raised against this vendor. |
| `total_invoices_processed` | integer, default 0 | Count of invoices/GRNs processed for this vendor. |
| `total_quantity_ordered` | numeric(16,3), default 0 | Cumulative quantity ordered across all POs. |
| `total_quantity_received` | numeric(16,3), default 0 | Cumulative quantity actually received. |
| `transit_rejected_quantity` | numeric(16,3), default 0 | Cumulative quantity rejected at Gate Entry/transit inspection (before QA). |
| `qa_rejected_quantity` | numeric(16,3), default 0 | Cumulative quantity rejected at the QA Check step. |
| `total_discrepancies` | numeric(16,3), default 0 | Cumulative quantity/invoice discrepancies logged against this vendor. |
| `on_time_deliveries` | integer, default 0 | Count of deliveries that arrived on/before their planned date. |
| `late_deliveries` | integer, default 0 | Count of deliveries that arrived after their planned date. |
| `average_days_late` | numeric(6,1), default 0 | Average lateness (in days) across late deliveries — feeds the Purchase Dashboard's "Average Delivery Delay by Vendor" chart. |
| `last_delivery_date` | date | Most recent delivery date recorded for this vendor. |

---

## purchase.material_buffer_percentage

**Per-material-type wastage/margin buffer configuration** — a small lookup table Purchase (or admin) maintains, applied to every PRN line's `boq_required_quantity` to compute `buffered_purchase_quantity`.

| Column | Type | Description / Use Case |
|---|---|---|
| `type_of_material` | text (PK) | The material category this buffer applies to (matches `design.item_code_type_config.type_of_material`/`prn_line_items.type_of_material`). |
| `buffer_percent` | numeric(5,2), default 0 | The percentage markup applied on top of the BOQ-required quantity when computing how much to actually purchase, to cover expected wastage/rejection. |

---

## purchase.pdfshift_state

**A tiny singleton operational-state table** — tracks which PDFShift API key is currently in rotation for PDF-generation calls (the app uses PDFShift, an external paid rendering API, for PO/PRN/BOQ/etc. PDF generation — see `lib/pdfshift.js`).

| Column | Type | Description / Use Case |
|---|---|---|
| `id` | integer (PK), CHECK `id = 1` | Enforced singleton — only one row can ever exist. |
| `current_key` | integer, default 1 | Which of the configured PDFShift API keys is currently active (supports rotating keys, e.g. for quota/rate-limit reasons). |
| `updated_at` | timestamptz, default now() | When the active key was last switched. |

---

## Generated / dead / unusual columns summary

- **No true DB-`GENERATED` columns exist in this schema** (unlike `design.item_codes.item_code`). Both `purchase_request_notes.prn_id` and `raw_material_purchase_orders.po_no` LOOK like they might be sequence-generated (both once had a `DEFAULT` expression using a sequence) but that default was **dead code, confirmed dropped in migration 201 (15 Sep 2026)** — live schema for both columns now shows no default at all. The real id-generation logic lives entirely in the application:
  - **PRN id**: app-built string derived from the BOQ id (`PRN_<boq-suffix>`).
  - **RM PO number**: app-level scan-and-increment producing `PO_<FY>_00001`, `PO_<FY>_00002`, etc. — NOT a DB sequence, so two POs racing in the same instant rely on the app's own logic (not a DB-level `nextval`) to avoid collision.
  - By contrast, several document-ID sequences elsewhere in the system (Gate Number, GRN Number, Store Ticket ID, Stock Sweep Batch ID — all in `store`, not `purchase`) WERE moved to real atomic per-FY DB sequence counters in the same migration 201, closing a previously-documented "no unique constraint" landmine on GRN numbers specifically — but PRN/PO numbering in `purchase` was deliberately left as app-generated derived strings, since their ids need to encode business meaning (BOQ suffix / financial year) rather than being opaque sequence numbers.
- **`raw_material_purchase_orders.round_off` vs `round_off_amount`**: two similarly-named numeric columns exist side by side. Live schema confirms both are real, non-generated columns — worth confirming against actual application code before assuming one is dead, since this looks like a legacy duplicate.
- **Two audit/history-vs-live pairs to keep straight:**
  - `po_delivery_schedule` (live, mutable state) vs. `po_delivery_schedule_history` (append-only audit log of changes to it) — never read the history table for "what does this PO currently plan to deliver," always read the live table.
  - `prn_line_items` (live running balances: `assigned_quantity`, `on_order_quantity`, pool-remaining fields) is itself the authoritative "what does this PRN line still hold" answer — per CLAUDE.md's own documented landmine, the separate `store.stock_reservations` table (not in this schema) is only an append-only audit log and must never be read as a live balance.
- **`pps_tracking.actual_delivery_date`** is a real, live-written column but is **functionally dead for milestone-gating purposes** as of 1 Sep 2026 — the modern PPS Tracking screen never writes to it in the schedule-based flow, so any new "is this material delivered" check should use `lib/ppsScheduleStatus.js`'s 3-state rollup (Unscheduled/Partial/Full, computed from `po_delivery_schedule` vs. `pps_tracking.purchased_quantity`) instead of this column.
