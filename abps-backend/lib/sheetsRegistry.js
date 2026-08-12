// ═══════════════════════════════════════════════════════════════════════
// lib/sheetsRegistry.js — maps every synced table to its target
// spreadsheet/tab, tier (live/partial/scheduled), and the exact query
// used to build a snapshot. One place to look up "where does this table
// go" rather than scattering spreadsheet IDs across route files.
// ═══════════════════════════════════════════════════════════════════════
const SPREADSHEET_IDS = {
  ADMIN:      '172kBWsjJXTrwJbfNqowY2W0T_j-eFmo9cSpYT1RS6M4',
  MARKETING:  '1FxipeOe_vBZAiTK9vAARfQcoznr-eKetXwOqLS5PthE',
  DESIGN:     '194otofrkFgnAGZ04XFbyg_wA8no47smIiSn1La5UOG4',
  PURCHASE:   '1ASG04bDYmCnUYfl5vVxJ9XXapBYr3S2XUZCJW4iO2Bk',
  INVENTORY:  '1hvZaKCsoIbs9Ekc4FUruD0NzyylDx2hGndMy6ttzeyg',
  PRODUCTION: '1Jof66ZdSMzXbMrj_NzjFPfkKX9d6qqcOrT7Oy6svh9w',
  ACCOUNTS:   '19zm_0WgGHhDq0u2FaE4hNeCQAykFg3yCYN3x3e6xXTg',
  PROJECT:    '15cnjkkio55HAbJyvlglah7Mg42QkmUe9swX_cp-e-Ds',
};

// Each entry: { sheet, tab, tier, keyColumn, query }
// query SELECTs with camelCase-ish clean headers (column aliases become
// the sheet's header row directly).
const TABLE_REGISTRY = {
  // ── ADMIN ──────────────────────────────────────────────────────────
  users: {
    sheet: 'ADMIN', tab: 'Users', tier: 'partial', keyColumn: 'Email',
    query: `SELECT email AS "Email", first_name AS "First Name", last_name AS "Last Name",
                   (SELECT name FROM admin_db.departments d WHERE d.department_id = u.department_id) AS "Department",
                   status AS "Status",
                   perm_admin AS "Admin",
                   perm_card_details AS "Card Details", perm_email_leads AS "Email Leads",
                   perm_dispatch_bill AS "Upload Dispatch Bill", perm_commissioning_report AS "Upload Commissioning Report", perm_purchase_order AS "Upload Purchase Order",
                   perm_search_company AS "Search Company", perm_search_tasks AS "Search Tasks", perm_search_status AS "Search Status",
                   perm_search_qualification AS "Search Qualification", perm_search_city_state AS "Search City/State",
                   perm_marketing_dashboard AS "Marketing Dashboard",
                   perm_create_boq AS "Create BOQ", perm_authorize_boq AS "Authorize BOQ", perm_update_boq AS "Update BOQ",
                   perm_authorize_boq_update AS "Authorize BOQ Update", perm_upload_drawings AS "Upload Drawings",
                   perm_design_dashboard AS "Design Dashboard",
                   perm_purchase_request_note AS "Purchase Request Note", perm_material_list_purchase AS "Material List For Purchase",
                   perm_reserve_store_stock AS "Reserve Store Stock", perm_expected_deliveries AS "Expected Deliveries",
                   perm_manufacturing_clearance AS "Manufacturing Clearance", perm_project_status AS "Project Status", perm_store_inward_rejected AS "Rejected Material",
                   perm_project_invoice_generation AS "Project Invoice Generation",
                   perm_create_rm_po AS "Create RM Purchase Order", perm_authorize_rm_po AS "Authorize RM Purchase Order",
                   perm_search_rm_po AS "Search RM Purchase Order",
                   perm_revise_rm_po AS "Revise RM Purchase Order", perm_authorize_rm_po_revision AS "Authorize RM Purchase Order Revision",
                   perm_authorize_prn AS "Authorize PRN", perm_revise_prn AS "Revise PRN", perm_authorize_prn_revision AS "Authorize PRN Revision",
                   perm_pps_tracking AS "PPS Tracking", perm_purchase_dashboard AS "Purchase Dashboard",
                   perm_gate_entry AS "Gate Entry", perm_store_entry_and_grn AS "Store Entry and GRN", perm_qa_check AS "QA Check",
                   perm_approve_job_card_increase AS "Approve JC Increase", perm_item_code_access AS "Item Code Access",
                   perm_live_spare_stock AS "Live Spare Store Stock",
                   perm_live_rm_stock AS "Live RM Store Stock", perm_live_fg_stock AS "Live FG Store Stock",
                   perm_create_store_ticket AS "Create Store Ticket", perm_approve_store_tickets AS "Approve Store Tickets",
                   perm_search_store_tickets AS "Store Admin Matrix", perm_store_dashboard AS "Store Dashboard",
                   perm_add_finished_goods_store AS "Add Finished Goods Store", perm_production_dashboard AS "Production Dashboard",
                   perm_job_card_letterhead AS "Job Card Letterhead", perm_tour_expense AS "Tour Expense"
            FROM admin_db.users u ORDER BY first_name`,
  },
  gmail_connections: {
    sheet: 'ADMIN', tab: 'Gmail Connections', tier: 'live', keyColumn: 'Email',
    query: `SELECT email AS "Email", status AS "Status", connected_by AS "Connected By",
                   connected_at AS "Connected At", last_used_at AS "Last Used At"
            FROM admin_db.gmail_connections ORDER BY connected_at DESC`,
  },

  // ── MARKETING ─────────────────────────────────────────────────────
  companies: {
    sheet: 'MARKETING', tab: 'Companies', tier: 'live', keyColumn: 'Company ID',
    query: `SELECT company_id AS "Company ID", company_name AS "Company Name", website AS "Website",
                   city AS "City", state AS "State", country AS "Country", company_address AS "Company Address",
                   type_of_industry AS "Type of Industry", type_of_customer AS "Type of Customer",
                   type_of_vendor AS "Type of Vendor", materials_supplied AS "Materials Supplied",
                   created_date AS "Created Date", created_by AS "Created By"
            FROM marketing.companies ORDER BY created_date DESC`,
  },
  leads: {
    sheet: 'MARKETING', tab: 'Enquiries', tier: 'live', keyColumn: 'Enquiry ID',
    query: `SELECT e.lead_id AS "Enquiry ID", e.ts AS "Timestamp", e.status AS "Status",
                   COALESCE(TRIM(u.first_name || ' ' || u.last_name), e.engineer_name) AS "Engineer Name",
                   e.contact_person_name AS "Contact Person Name", c.company_name AS "Company Name",
                   e.position AS "Position", e.phone AS "Phone", e.alt_phone AS "Alt Phone", e.email AS "Email",
                   c.website AS "Website", c.city AS "City", c.state AS "State", c.country AS "Country",
                   c.company_address AS "Company Address",
                   e.date_of_meeting AS "Date of Meeting", e.time_of_meeting AS "Time of Meeting",
                   e.meeting_venue AS "Meeting Venue", e.venue_name_city AS "Venue Name / City",
                   e.additional_meeting_details AS "Additional Meeting Details (if any)",
                   e.abps_business_vertical AS "ABPS Business Vertical",
                   c.type_of_customer AS "Type of Customer", c.type_of_vendor AS "Type of Vendor",
                   e.low_power_factor_issue AS "Low Power Factor Issue",
                   e.high_electricity_bill_issue AS "High Electricity Bill Issue",
                   e.harmonics_issue AS "Harmonics Issue",
                   e.transformer_heating_issue AS "Transformer Heating / Breakdown Issue",
                   e.grid_stability_issue AS "Grid Stability Issue",
                   e.purchase_inquire AS "Purchase Inquire", e.tender_inquire AS "Tender Inquire",
                   e.existing_system_details AS "Existing System Details",
                   e.voltage_level_requirements AS "Voltage Level Requirements",
                   e.contract_demand_mva AS "Contract Demand (MVA)", e.running_demand_mva AS "Running Demand (MVA)",
                   e.monthly_avg_power_factor AS "Monthly Average Power Factor",
                   e.problem_observed AS "Problem Observed",
                   e.technical_discussion_summary AS "Technical Discussion Summary",
                   e.existing_project AS "Existing Project", e.upcoming_project AS "Upcoming Project",
                   e.products_discussed AS "Products Discussed", e.approx_requirement AS "Approx Requirement",
                   e.expected_tender_rfq_date AS "Expected Tender / RFQ Date",
                   e.expected_order_timeline AS "Expected Order Timeline",
                   e.competitor_details AS "Competitor Details",
                   e.approx_business_potential AS "Approx Business Potential",
                   e.send_company_profile AS "Send Company Profile",
                   e.send_technical_presentation AS "Send Technical Presentation",
                   e.arrange_site_visit AS "Arrange Site Visit", e.get_enquiry AS "Get Enquiry",
                   e.send_offer AS "Send Offer", e.follow_up_required AS "Follow-Up Required",
                   e.card_image_link AS "Card Image Link"
            FROM marketing.leads e
            LEFT JOIN marketing.companies c ON c.company_id = e.company_id
            LEFT JOIN admin_db.users u ON u.email = e.engineer_name
            ORDER BY e.ts DESC LIMIT 2000`,
  },
  follow_ups: {
    sheet: 'MARKETING', tab: 'Follow Ups', tier: 'live', keyColumn: 'Follow Up ID',
    // f.lead_id, not f.enquiry_id — migration 016 renamed the column
    // everywhere (marketing.js's own live queries already use lead_id).
    // "Enquiry ID" stays as the SHEET-facing header text on purpose,
    // matching the existing tab, same pattern as the leads registry entry.
    query: `SELECT f.follow_up_id AS "Follow Up ID", f.lead_id AS "Enquiry ID", f.follow_up_status AS "Status",
                   COALESCE(TRIM(u.first_name || ' ' || u.last_name), f.engineer_name) AS "Engineer Name",
                   f.event_date AS "Event Date", f.interaction_notes AS "Interaction Notes",
                   f.interaction_outcome AS "Interaction Outcome", f.interaction_mode AS "Interaction Mode",
                   f.next_follow_up_date AS "Next Follow-Up Date", f.next_follow_up_time AS "Next Follow-Up Time",
                   f.next_action_type AS "Next Action Type", f.objection_raised AS "Objection Raised"
            FROM marketing.follow_ups f LEFT JOIN admin_db.users u ON u.email = f.engineer_name
            ORDER BY f.event_date DESC LIMIT 2000`,
  },
  tasks: {
    sheet: 'MARKETING', tab: 'Tasks', tier: 'live', keyColumn: 'Task ID',
    query: `SELECT t.task_id AS "Task ID", t.lead_id AS "Enquiry ID", t.task_status AS "Status",
                   COALESCE(TRIM(u.first_name || ' ' || u.last_name), t.engineer_name) AS "Engineer Name",
                   COALESCE(TRIM(au.first_name || ' ' || au.last_name), t.assigning_engineer) AS "Assigning Engineer",
                   t.task_type AS "Task Type", t.task_description AS "Description", t.task_priority AS "Priority",
                   t.target_date AS "Target Date", t.target_time AS "Target Time", t.completion_notes AS "Completion Notes"
            FROM marketing.tasks t
            LEFT JOIN admin_db.users u ON u.email = t.engineer_name
            LEFT JOIN admin_db.users au ON au.email = t.assigning_engineer
            ORDER BY t.target_date ASC LIMIT 2000`,
  },
  purchase_order_information: {
    sheet: 'MARKETING', tab: 'Purchase Order Info', tier: 'live', keyColumn: 'PO Line ID',
    query: `SELECT po_line_id AS "PO Line ID", status AS "Status", lead_id AS "Enquiry ID",
                   contact_person_name AS "Contact Person Name", company_name AS "Company Name",
                   project_id AS "Project ID", purchase_order_number AS "PO Number",
                   purchase_order_date AS "PO Date", committed_delivery_date AS "Committed Delivery Date",
                   purchase_order_product_name AS "Product Name", tag_numbers AS "Tag Numbers", unit AS "Unit",
                   quantity AS "Quantity", rate_per_quantity AS "Rate per Qty", basic_po_amount AS "Basic PO Amount",
                   po_gst_amount AS "PO GST Amount", po_gst_percent AS "PO GST %", po_total_amount AS "Total Amount",
                   abps_owner_of_order AS "ABPS Owner of Order", po_warranty_terms AS "Warranty Terms"
            FROM marketing.purchase_order_information ORDER BY po_line_id DESC LIMIT 2000`,
  },
  offers_sent: {
    sheet: 'MARKETING', tab: 'Offers Sent', tier: 'live', keyColumn: 'Offer ID',
    query: `SELECT o.offer_id AS "Offer ID", o.ts AS "Timestamp", o.lead_id AS "Enquiry ID",
                   o.company_name AS "Company Name", o.contact_person_name AS "Contact Person Name",
                   COALESCE(TRIM(u.first_name || ' ' || u.last_name), o.engineer_name) AS "Engineer Name",
                   o.offer_version AS "Version", o.email_subject AS "Subject", o.email_sent_date AS "Email Sent Date",
                   o.email_sent_time AS "Email Sent Time", o.ai_offer_summary AS "AI Summary",
                   o.products_mentioned AS "Products Mentioned", o.estimated_value AS "Estimated Value",
                   o.gmail_thread_link AS "Gmail Thread Link"
            FROM marketing.offers_sent o LEFT JOIN admin_db.users u ON u.email = o.engineer_name
            ORDER BY o.ts DESC LIMIT 2000`,
  },
  cold_introductory_emails_sent: {
    sheet: 'MARKETING', tab: 'Cold Outreach', tier: 'live', keyColumn: 'Recipient Email',
    query: `SELECT c.recipient_email AS "Recipient Email", c.company_name AS "Company Name",
                   c.contact_person_name AS "Contact Person Name",
                   COALESCE(TRIM(u.first_name || ' ' || u.last_name), c.sent_by) AS "Sent By",
                   c.first_contacted_date AS "First Contacted", c.last_contacted_date AS "Last Contacted",
                   c.times_contacted AS "Times Contacted", c.last_subject AS "Last Subject",
                   c.last_summary AS "Last Summary", c.last_thread_link AS "Last Thread Link"
            FROM marketing.cold_introductory_emails_sent c LEFT JOIN admin_db.users u ON u.email = c.sent_by
            ORDER BY c.last_contacted_date DESC LIMIT 2000`,
  },
  uploaded_document_information: {
    sheet: 'MARKETING', tab: 'Uploaded Documents', tier: 'live', keyColumn: 'Doc ID',
    // lead_id, not enquiry_id — migration 016 renamed the column. "Enquiry
    // ID" stays as the Sheet-facing header text, same as follow_ups/leads.
    query: `SELECT doc_id AS "Doc ID", status AS "Status", lead_id AS "Enquiry ID",
                   contact_person_name AS "Contact Person Name", company_name AS "Company Name",
                   project_id AS "Project ID", purchase_order_number AS "PO Number",
                   purchase_order_date AS "PO Date", committed_delivery_date AS "Committed Delivery Date",
                   purchase_order_product_name AS "Product Name", purchase_order_summary AS "PO Summary",
                   basic_po_amount AS "Basic PO Amount", po_gst_amount AS "PO GST Amount",
                   po_total_amount AS "PO Total Amount", payment_terms AS "Payment Terms",
                   abps_owner_of_order AS "ABPS Owner of Order", po_warranty_terms AS "PO Warranty Terms",
                   abg_required AS "ABG Required", scope_of_work AS "Scope of Work",
                   dispatch_bill_invoice_number AS "Dispatch Invoice No", dispatch_bill_invoice_date AS "Dispatch Invoice Date",
                   customer_po_number AS "Customer PO Number", customer_po_date AS "Customer PO Date",
                   basic_dispatch_bill_amount AS "Basic Dispatch Bill Amount",
                   dispatch_bill_gst_amount AS "Dispatch Bill GST Amount",
                   total_dispatch_bill_amount AS "Total Dispatch Bill Amount",
                   date_of_product_commissioning AS "Date of Commissioning",
                   commissioning_engineer_name AS "Commissioning Engineer", commissioned_product AS "Commissioned Product",
                   customer_contact_person AS "Customer Contact Person"
            FROM marketing.uploaded_document_information ORDER BY doc_id DESC LIMIT 2000`,
  },
  processed_emails: {
    sheet: 'MARKETING', tab: 'Processed Emails', tier: 'scheduled', keyColumn: 'Message ID',
    // attachments is a JSON array — not included, doesn't display sensibly
    // as a flat sheet cell.
    query: `SELECT message_id AS "Message ID", ts AS "Timestamp", is_lead AS "Is Lead", company AS "Company",
                   contact_person AS "Contact Person", ai_summary AS "AI Summary", subject AS "Subject",
                   notes AS "Notes", creator_of_note AS "Creator of Note",
                   received_date AS "Received Date", received_time AS "Received Time",
                   inbox_account AS "Inbox Account", thread_link AS "Thread Link"
            FROM marketing.processed_emails ORDER BY ts DESC LIMIT 2000`,
  },
  // ── PROJECT ───────────────────────────────────────────────────────
  projects: {
    sheet: 'PROJECT', tab: 'Projects', tier: 'live', keyColumn: 'Project ID',
    query: `SELECT project_id AS "Project ID", project_status AS "Project Status", company_name AS "Company Name",
                   po_number AS "PO Number", delivery_date AS "Delivery Date"
            FROM project.projects ORDER BY project_id DESC LIMIT 2000`,
  },
  item_codes: {
    sheet: 'DESIGN', tab: 'Item Codes', tier: 'live', keyColumn: 'Item Code',
    query: `SELECT item_code AS "Item Code", material_name AS "Material Name", rating AS "Rating",
                   type_of_material AS "Type of Material", unit AS "Unit", created_by AS "Created By",
                   created_date AS "Created Date"
            FROM design.item_codes ORDER BY created_date DESC LIMIT 3000`,
  },
  boq_drafts: {
    sheet: 'DESIGN', tab: 'BOQDrafts', tier: 'scheduled', keyColumn: 'BOQ ID',
    query: `SELECT boq_id AS "BOQ ID", project_id AS "Project ID", customer_name AS "Customer Name",
                   product_name AS "Product Name", product_rating AS "Product Rating", department AS "Department",
                   order_quantity AS "Order Quantity", boq_date AS "Date", prepared_by AS "Prepared By",
                   authorized_by AS "Authorized By", status AS "Status", material_rows::text AS "Material Rows List",
                   version AS "Version", total_cost_per_set AS "Total Bill Of Quantity Cost Per Set",
                   total_cost AS "Total Bill Of Quantity Cost", created_at AS "Created Timestamp",
                   updated_at AS "Last Updated Timestamp"
            FROM design.boq_drafts ORDER BY boq_date DESC LIMIT 2000`,
  },
  bill_of_quantity: {
    sheet: 'DESIGN', tab: 'BillOfQuantity', tier: 'partial', keyColumn: 'Line ID', hideKeyColumn: true, groupColumn: 'BOQ ID',
    // Line ID stays as the real, globally-unique match key (hidden from
    // the sheet) — syncLiveRow matches rows by whatever the DB trigger
    // logs, which is draft_row_id, not the cosmetic per-BOQ Sr No. Sr No
    // restarts at 1 for each BOQ's own material rows and is purely
    // display; BOQs themselves stay newest-first via boq_sort_key.
    query: `SELECT draft_row_id AS "Line ID", sr_no AS "Sr No", ts AS "Timestamp", boq_id AS "BOQ ID",
                   customer_name AS "Customer Name", project_id AS "Project ID",
                   production_department AS "Production Department", product_name AS "Product Name",
                   product_rating AS "Product Rating", description_of_material AS "Description of Material",
                   total_product_quantity AS "Total Product Quantity", unit_type AS "Unit Type",
                   type_of_store AS "Type of Store", item_code AS "Item Code", make AS "Make",
                   qty_for_1_set AS "Quantity for 1 Set", order_quantity AS "Order Quantity",
                   design_rate_per_quantity AS "Design Rate Per Quantity", total_material_rate AS "Total Material Rate",
                   prepared_by AS "Prepared By", authorized_by AS "Authorized By"
            FROM (
              SELECT *,
                     ROW_NUMBER() OVER (PARTITION BY boq_id ORDER BY draft_row_id ASC) AS sr_no,
                     MAX(draft_row_id) OVER (PARTITION BY boq_id) AS boq_sort_key
              FROM design.bill_of_quantity
            ) t
            ORDER BY boq_sort_key DESC, sr_no ASC LIMIT 2000`,
  },
  // boq_update_requests intentionally has no sheet entry — this table's
  // data lives entirely in the app (Authorize BOQ Revision), never needs
  // a Google Sheet view.

  // ── PURCHASE ──────────────────────────────────────────────────────
  vendor_information: {
    sheet: 'PURCHASE', tab: 'Vendor Information', tier: 'partial', keyColumn: 'Vendor Name',
    query: `SELECT vendor_name AS "Vendor Name", gstin_uin AS "GSTIN/UIN", type_of_vendor AS "Type of Vendor",
                   contact_person AS "Contact Person", phone_number AS "Phone", email AS "Email",
                   city AS "City", state AS "State", state_code AS "State Code",
                   cgst_percent AS "CGST %", sgst_percent AS "SGST %", igst_percent AS "IGST %",
                   address AS "Address", status AS "Status"
            FROM purchase.vendor_information ORDER BY vendor_name LIMIT 2000`,
  },
  purchase_request_notes: {
    sheet: 'PURCHASE', tab: 'Purchase Request Notes', tier: 'live', keyColumn: 'PRN ID',
    query: `SELECT prn_id AS "PRN ID", project_id AS "Project ID", boq_id AS "BOQ ID", product_name AS "Product Name",
                   product_rating AS "Product Rating", order_quantity AS "Order Quantity",
                   created_date AS "Created Date", created_by AS "Created By", status AS "Status",
                   version AS "Version", pdf_url AS "PDF URL"
            FROM purchase.purchase_request_notes ORDER BY created_date DESC LIMIT 2000`,
  },
  raw_material_purchase_orders: {
    sheet: 'PURCHASE', tab: 'Raw Material POs', tier: 'live', keyColumn: 'PO No',
    // material_rows is a JSON line-item blob — not included, see
    // raw_material_po_line_items below for the flattened version.
    query: `SELECT po_no AS "PO No", status AS "Status", vendor_name AS "Vendor Name",
                   supplier_ref_offer_no AS "Supplier Ref/Offer No", order_date AS "Order Date",
                   delivery_date AS "Delivery Date", sub_total AS "Sub Total",
                   cgst_percent AS "CGST %", cgst_amount AS "CGST Amount",
                   sgst_percent AS "SGST %", sgst_amount AS "SGST Amount",
                   igst_percent AS "IGST %", igst_amount AS "IGST Amount",
                   packing_amount AS "Packing Amount", freight_amount AS "Freight Amount",
                   other_amount AS "Other Amount", round_off AS "Round Off Amount",
                   grand_total AS "Grand Total",
                   warranty AS "Warranty", payment_terms AS "Payment Terms", freight_terms AS "Freight Terms",
                   prepared_by AS "Prepared By", authorized_by AS "Authorized By",
                   created_at AS "Created At",
                   drive_file_url AS "Generated PO PDF URL"
            FROM purchase.raw_material_purchase_orders ORDER BY order_date DESC LIMIT 2000`,
  },
  pps_tracking: {
    sheet: 'PURCHASE', tab: 'PPS Tracking', tier: 'partial', keyColumn: 'PPS ID',
    query: `SELECT pps_id AS "PPS ID", project_id AS "Project ID", prn_id AS "PRN ID", item_code AS "Item Code",
                   material_name AS "Material Name", boq_quantity AS "BOQ Quantity",
                   buffered_quantity AS "Buffered Quantity", store_reserved_quantity AS "Store Reserved Qty",
                   purchased_quantity AS "Purchased Quantity", po_no AS "PO No", po_date AS "PO Date",
                   vendor_name AS "Vendor Name", expected_delivery_date AS "Expected Delivery",
                   actual_delivery_date AS "Actual Delivery", actual_received_quantity AS "Actual Received Qty",
                   action_plan AS "Action Plan", prn_created_date AS "PRN Created Date", link_status AS "Link Status"
            FROM purchase.pps_tracking ORDER BY pps_id DESC LIMIT 2000`,
  },
  vendor_performance: {
    sheet: 'PURCHASE', tab: 'Vendor Performance', tier: 'live', keyColumn: 'Vendor Name',
    query: `SELECT vendor_name AS "Vendor Name", total_pos_raised AS "Total POs",
                   total_invoices_processed AS "Total Invoices Processed",
                   total_quantity_ordered AS "Total Qty Ordered", total_quantity_received AS "Total Qty Received",
                   transit_rejected_quantity AS "Transit Rejected Qty", qa_rejected_quantity AS "QA Rejected Qty",
                   total_discrepancies AS "Total Discrepancies", on_time_deliveries AS "On-Time Deliveries",
                   late_deliveries AS "Late Deliveries", average_days_late AS "Avg Days Late",
                   last_delivery_date AS "Last Delivery Date"
            FROM purchase.vendor_performance ORDER BY vendor_name LIMIT 2000`,
  },
  material_buffer_percentage: {
    sheet: 'PURCHASE', tab: 'Material Buffer %', tier: 'scheduled', keyColumn: 'Type of Material',
    query: `SELECT type_of_material AS "Type of Material", buffer_percent AS "Buffer %" FROM purchase.material_buffer_percentage ORDER BY type_of_material LIMIT 500`,
  },
  prn_line_items: {
    sheet: 'PURCHASE', tab: 'PRN Line Items', tier: 'scheduled', keyColumn: 'Line ID', hideKeyColumn: true, groupColumn: 'PRN ID',
    // Line ID stays as the real, globally-unique match key (hidden from
    // the sheet) — syncLiveRow matches on whatever the DB trigger logs
    // (the real line_id), not the cosmetic per-PRN Sr No. Sr No restarts
    // at 1 for each PRN's own material rows and is purely display; PRNs
    // themselves stay newest-first via prn_sort_key.
    query: `SELECT line_id AS "Line ID", sr_no AS "Sr No", prn_id AS "PRN ID", item_code AS "Item Code", material_name AS "Material Name",
                   type_of_material AS "Type of Material", boq_required_quantity AS "BOQ Required Qty",
                   buffer_percent AS "Buffer %", buffered_purchase_quantity AS "Buffered Purchase Qty",
                   current_unassigned_store_quantity AS "Current Unassigned Store Qty",
                   purchase_quantity AS "Purchase Qty",
                   original_purchased_buffered_quantity AS "Original Purchased Buffered Qty",
                   assigned_quantity AS "Assigned Qty", on_order_quantity AS "On Order Qty",
                   still_to_order_quantity AS "Still To Order", created_by AS "Created By"
            FROM (
              SELECT *,
                     ROW_NUMBER() OVER (PARTITION BY prn_id ORDER BY line_id ASC) AS sr_no,
                     MAX(line_id) OVER (PARTITION BY prn_id) AS prn_sort_key
              FROM purchase.prn_line_items
            ) t
            ORDER BY prn_sort_key DESC, sr_no ASC LIMIT 3000`,
  },
  raw_material_po_line_items: {
    sheet: 'PURCHASE', tab: 'RM PO Line Items', tier: 'scheduled', keyColumn: 'Line ID', hideKeyColumn: true, groupColumn: 'PO No',
    // Line ID stays as the real, globally-unique match key (hidden from
    // the sheet) — same reasoning as prn_line_items/bill_of_quantity.
    // po_no ASC happened to sort oldest-PO-first (numeric suffix in the
    // ID string), the opposite of "newest on top" — grouping by each
    // PO's own MAX(line_id) instead makes the top-of-sheet order
    // correct regardless of how PO IDs are formatted.
    query: `SELECT line_id AS "Line ID", po_no AS "PO No", sr_no AS "Sr No",
                   description_of_material AS "Description",
                   item_code AS "Item Code", quantity AS "Quantity", unit AS "Unit",
                   rate_per_quantity AS "Rate", discount_percent AS "Discount %", amount AS "Amount"
            FROM (
              SELECT *,
                     ROW_NUMBER() OVER (PARTITION BY po_no ORDER BY line_id ASC) AS sr_no,
                     MAX(line_id) OVER (PARTITION BY po_no) AS po_sort_key
              FROM purchase.raw_material_po_line_items
            ) t
            ORDER BY po_sort_key DESC, sr_no ASC LIMIT 3000`,
  },

  // ── INVENTORY ─────────────────────────────────────────────────────
  raw_material_store: {
    sheet: 'INVENTORY', tab: 'Raw Material Store', tier: 'live', keyColumn: 'Item Code',
    query: `SELECT item_code AS "Item Code", material_name AS "Material Name", total_stock AS "Total Stock",
                   reserved_stock AS "Reserved Stock", available_stock AS "Available Stock",
                   unit_type AS "Unit Type", type_of_material AS "Type of Material",
                   latest_rate_per_quantity AS "Latest Rate per Qty"
            FROM store.raw_material_store ORDER BY material_name LIMIT 3000`,
  },
  spare_store: {
    sheet: 'INVENTORY', tab: 'Spare Store', tier: 'live', keyColumn: 'Item Code',
    query: `SELECT item_code AS "Item Code", material_name AS "Material Name", total_stock AS "Total Stock",
                   unusable_stock AS "Unusable Stock", reserved_stock AS "Reserved Stock", available_stock AS "Available Stock",
                   unit_type AS "Unit Type", type_of_material AS "Type of Material",
                   last_updated AS "Last Updated"
            FROM store.spare_store ORDER BY material_name LIMIT 2000`,
  },
  spare_blocked_allocations: {
    sheet: 'INVENTORY', tab: 'Spare Blocked Allocations', tier: 'live', keyColumn: 'Allocation ID',
    query: `SELECT allocation_id AS "Allocation ID", item_code AS "Item Code", material_name AS "Material Name",
                   job_card_number AS "Job Card Number", quantity AS "Quantity",
                   created_date AS "Created Date", created_by AS "Created By",
                   freed_date AS "Freed Date", freed_to AS "Freed To", freed_by AS "Freed By"
            FROM store.spare_blocked_allocations ORDER BY created_date DESC LIMIT 2000`,
  },
  inbound_store_ledger: {
    sheet: 'INVENTORY', tab: 'Inbound Ledger', tier: 'live', keyColumn: 'Ledger ID',
    query: `SELECT ledger_id AS "Ledger ID", ts AS "Timestamp", transaction_status AS "Status",
                   vendor_name AS "Vendor Name", invoice_number AS "Invoice Number",
                   challan_number_desc AS "Challan Number/Desc", item_code AS "Item Code",
                   material_name AS "Material Name", unit_type AS "Unit Type", type_of_material AS "Type of Material",
                   quantity_received AS "Qty Received", missing_quantity AS "Missing Qty", ok_quantity AS "OK Qty",
                   not_ok_quantity AS "Not OK Qty", reason_for_not_ok AS "Reason for Not OK",
                   action_for_rejected_material AS "Action for Rejected Material",
                   rate_per_quantity AS "Rate per Qty", total_basic_amount AS "Total Basic Amount",
                   gst_percent AS "GST %", total_invoice_amount_incl_gst AS "Total Invoice Amount (incl GST)",
                   drive_image_url AS "Image URL", gate_entry_person AS "Gate Entry Person",
                   grn_person AS "GRN Person", qa_person AS "QA Person", qa_timestamp AS "QA Timestamp",
                   gate_number AS "Gate Number", grn_number AS "GRN Number"
            FROM store.inbound_store_ledger ORDER BY ts DESC LIMIT 2000`,
  },
  outbound_store_ledger: {
    sheet: 'INVENTORY', tab: 'Outbound Ledger', tier: 'live', keyColumn: 'Ledger ID',
    query: `SELECT ledger_id AS "Ledger ID", ts AS "Timestamp", transaction_type AS "Transaction Type",
                   type_of_store AS "Type of Store", project_id AS "Project ID", job_card_number AS "Job Card Number",
                   department AS "Department", requested_by AS "Requested By", reference_id AS "Reference ID",
                   item_code AS "Item Code", material_name AS "Material Name",
                   quantity_removed AS "Qty Removed", authorized_by AS "Authorized By"
            FROM store.outbound_store_ledger ORDER BY ts DESC LIMIT 2000`,
  },
  store_tickets: {
    sheet: 'INVENTORY', tab: 'Store Tickets', tier: 'live', keyColumn: 'Ticket ID',
    // items is a JSON line-item blob — not included, doesn't display
    // sensibly as a flat sheet cell.
    query: `SELECT ticket_id AS "Ticket ID", request_or_return AS "Request/Return", type_of_store AS "Type of Store",
                   project_id AS "Project ID", job_card_number AS "Job Card Number", department AS "Department",
                   requested_returned_by AS "Requested/Returned By", backorder_quantity AS "Backorder Qty",
                   date_created AS "Date Created", date_actioned AS "Date Actioned", actioned_by AS "Actioned By",
                   status AS "Status", parent_ticket_id AS "Parent Ticket ID"
            FROM store.store_tickets ORDER BY date_created DESC LIMIT 2000`,
  },
  stock_sweeps: {
    sheet: 'INVENTORY', tab: 'Stock Sweeps', tier: 'partial', keyColumn: 'Sweep ID',
    query: `SELECT sweep_id AS "Sweep ID", batch_id AS "Batch ID", ts AS "Timestamp",
                   item_code AS "Item Code", material_name AS "Material Name", quantity AS "Quantity",
                   sweep_type AS "Sweep Type", assigned_qty AS "Auto-Assigned Qty", swept_by AS "Swept By"
            FROM store.stock_sweeps ORDER BY sweep_id DESC LIMIT 2000`,
  },
  rejected_missing_material_tracking: {
    sheet: 'INVENTORY', tab: 'Rejected / Missing Material', tier: 'live', keyColumn: 'Rejection ID',
    query: `SELECT rejection_id AS "Rejection ID", grn_number AS "GRN Number", item_code AS "Item Code",
                   material_name AS "Material Name", unit_type AS "Unit Type", vendor_name AS "Vendor Name",
                   not_ok_quantity AS "Not OK Qty", missing_quantity AS "Missing Qty", pending_quantity AS "Pending Qty",
                   reason_for_not_ok AS "Reason for Not OK", action_for_rejected_material AS "Action for Rejected Material",
                   status AS "Status", set_by_store AS "Set By Store", set_timestamp AS "Set Timestamp",
                   purchase_reviewed_by AS "Purchase Reviewed By", purchase_reviewed_timestamp AS "Purchase Reviewed Timestamp",
                   resolved_timestamp AS "Resolved Timestamp"
            FROM store.rejected_missing_material_tracking ORDER BY set_timestamp DESC LIMIT 2000`,
  },
  stock_reservations: {
    sheet: 'INVENTORY', tab: 'Stock Reservations', tier: 'live', keyColumn: 'Assignment ID',
    query: `SELECT assignment_id AS "Assignment ID", item_code AS "Item Code", material_name AS "Material Name",
                   prn_id AS "PRN ID", boq_id AS "BOQ ID", assigned_quantity AS "Assigned Qty",
                   utilized_quantity AS "Utilized Qty", assigned_date AS "Assigned Date", assigned_by AS "Assigned By"
            FROM store.stock_reservations ORDER BY assigned_date DESC LIMIT 2000`,
  },

  // ── PRODUCTION ────────────────────────────────────────────────────
  finished_goods_inventory: {
    sheet: 'PRODUCTION', tab: 'Finished Goods', tier: 'live', keyColumn: 'FG ID',
    query: `SELECT fg_id AS "FG ID", fg_date AS "Date", department AS "Department", project_id AS "Project ID",
                   customer_name AS "Customer Name", item_or_dispatch_code AS "Item Code",
                   finished_good_use AS "Finished Good Use", job_card_number AS "Job Card Number",
                   product_serial_number AS "Product Serial Number", product_name AS "Product Name",
                   product_rating AS "Product Rating", unit AS "Unit", status AS "Status",
                   production_responsible_person AS "Production Responsible Person",
                   additional_remarks AS "Additional Remarks",
                   qa_person AS "QA Person", job_card_sheet_url AS "Job Card Sheet URL",
                   certificate_url AS "Certificate URL", inspection_clearance_url AS "Inspection Clearance URL",
                   in_process_inspection_url AS "In-Process Inspection URL", warranty_card_url AS "Warranty Card URL"
            FROM production.finished_goods_inventory ORDER BY fg_date DESC LIMIT 2000`,
  },
  job_card_materials: {
    sheet: 'PRODUCTION', tab: 'Job Card Materials', tier: 'live', keyColumn: 'Row ID', hideKeyColumn: true,
    query: `SELECT row_id AS "Row ID",
                   ROW_NUMBER() OVER (PARTITION BY job_card_number ORDER BY row_id) AS "Sr No",
                   job_card_number AS "Job Card Number", boq_id AS "BOQ ID",
                   project_id AS "Project ID", item_code AS "Item Code", material_name AS "Material Name",
                   unit_type AS "Unit Type", type_of_store AS "Type of Store",
                   allotted_quantity AS "Allotted Qty", used_quantity AS "Used Qty",
                   remaining_quantity AS "Remaining Qty",
                   increase_approved_quantity AS "Increase Approved Qty", last_updated AS "Last Updated"
            FROM production.job_card_materials
            ORDER BY (regexp_match(job_card_number, 'Set-(\\d+)_'))[1]::int NULLS LAST, row_id
            LIMIT 3000`,
  },
  job_card_number: {
    sheet: 'PRODUCTION', tab: 'Job Cards', tier: 'live', keyColumn: 'Job Card Number',
    query: `SELECT job_card_number AS "Job Card Number", project_id AS "Project ID", customer_name AS "Customer Name",
                   product_name AS "Product Name", product_rating AS "Product Rating", boq_id AS "BOQ ID",
                   set_number AS "Set Number", date_created AS "Date Created", status AS "Status",
                   drive_image_url AS "Image URL"
            FROM production.job_cards ORDER BY date_created DESC LIMIT 2000`,
  },

  // ── ACCOUNTS ───────────────────────────────────────────────────────
  // keyColumn stays column A for upsert matching, but hideKeyColumn hides
  // it from view — the ID is needed internally, not for day-to-day reading.
  tour_employees: {
    sheet: 'ACCOUNTS', tab: 'Employees', tier: 'live', keyColumn: 'Employee ID', hideKeyColumn: true,
    query: `SELECT employee_id AS "Employee ID", employee_name AS "Employee Name",
                   department_name AS "Department", balance AS "Balance"
            FROM accounts.tour_employees ORDER BY employee_name`,
  },
  tour_advances: {
    sheet: 'ACCOUNTS', tab: 'Advances', tier: 'live', keyColumn: 'Advance ID', hideKeyColumn: true,
    query: `SELECT a.advance_id AS "Advance ID", e.employee_name AS "Employee Name",
                   a.amount AS "Amount", a.paid_date AS "Paid Date"
            FROM accounts.tour_advances a JOIN accounts.tour_employees e ON e.employee_id = a.employee_id
            ORDER BY a.paid_date DESC LIMIT 2000`,
  },
  tour_vouchers: {
    sheet: 'ACCOUNTS', tab: 'Vouchers', tier: 'live', keyColumn: 'Voucher ID', hideKeyColumn: true,
    query: `SELECT v.voucher_id AS "Voucher ID", e.employee_name AS "Employee Name", v.customer_name AS "Customer Name",
                   v.purpose_of_visit AS "Purpose of Visit", v.voucher_amount AS "Voucher Amount",
                   v.checked_amount AS "Checked Amount", v.checked_date AS "Checked Date"
            FROM accounts.tour_vouchers v JOIN accounts.tour_employees e ON e.employee_id = v.employee_id
            ORDER BY v.created_date DESC LIMIT 2000`,
  },
};

module.exports = { SPREADSHEET_IDS, TABLE_REGISTRY };