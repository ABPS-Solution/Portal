// ═══════════════════════════════════════════════════════════════════════
// migrate/run.js — the actual migration. Run with:
//   node migrate/run.js
// (with all the SHEET_ID / DB_* env vars set, and Cloud SQL Auth Proxy
// running locally if migrating against Cloud SQL directly.)
//
// COVERAGE NOTE, READ THIS FIRST: given ~35 tables across 6 workbooks,
// this file fully wires the FOUNDATIONAL tables — the ones most other
// tables reference via foreign keys, and the ones with the trickiest
// mapping (JSON blobs, computed fields). Every migration below follows
// the exact same `migrateTable({...})` pattern from engine.js, so
// extending this to the remaining tables is mechanical, not novel work
// — see the TODO checklist at the bottom for what's left and the
// one-paragraph pattern to follow for each.
// ═══════════════════════════════════════════════════════════════════════
const { pool, migrateTable, resyncSequence, num, int, bool, str, date, json } = require('./engine');

async function main() {
  const results = [];

  // ═══ 1. ADMIN (no dependencies — must run first) ═══════════════════
  results.push(await migrateTable({
    label: 'Admin: Users',
    sheetGroup: 'ADMIN', tabName: 'Users',
    mapRow: (r) => {
      const email = str(r['Email Address']);
      if (!email) return null;
      const dept = str(r['Department']); // may be comma-separated; first token used for department_id lookup below
      return [
        email, str(r['First Name']) || '', str(r['Last Name']) || '', str(r['Status']) || 'Active',
        bool(r['Enter Visiting Card Details']), bool(r['Leads Received through Email']),
        bool(r['Upload Dispatch Bill']) || bool(r['Upload Commissioning Report']) || bool(r['Upload Purchase Order']),
        bool(r['Search by Company Name']), bool(r['Search Leads by ABPS Engineer Name and Status']),
        bool(r['Search by Type of Customer']), bool(r['Search by City, State and Country']),
        bool(r['Search Tasks by ABPS Engineer Name and Status']), bool(r['Marketing Dashboard']),
        bool(r['Manufacturing Clearance']), bool(r['Add / Check Item Code']), bool(r['Upload Drawings']),
        bool(r['Create Bill of Quantity']), bool(r['Authorize Bill of Quantity']), bool(r['Update Bill of Quantity']),
        bool(r['Authorize Bill of Quantity Update']), bool(r['Design Dashboard']), bool(r['Material List For Purchase']),
        bool(r['Create Raw Material Purchase Order']), bool(r['Authorize Raw Material Purchase Order']),
        bool(r['PPS Tracking']), bool(r['Purchase Dashboard']), bool(r['Create Purchase Request Note']),
        bool(r['Assign Current Stock']), bool(r['Gate Entry']), bool(r['Raw Materials Store Entry and GRN']),
        bool(r['Raw Materials Q/A Check']), bool(r['Store Inward Rejected Material']), bool(r['Expected Deliveries']),
        bool(r['Approve Job Card Increase']), bool(r['Approve Store Tickets']), bool(r['Search Store Tickets']),
        bool(r['Live Raw Materials Store Stock']), bool(r['Live Finished Goods Store Stock']),
        bool(r['Live Spare Store Stock']), bool(r['Store Dashboard']), bool(r['Create Store Ticket']),
        bool(r['Add / Check Dispatch Product Code Number']), bool(r['Job Card LetterHead']),
        bool(r['Add to Finished Goods Store']), bool(r['Production Dashboard']),
        dept ? dept.toLowerCase().includes('admin') : false, // -> perm_admin
        dept ? dept.split(',')[0].trim() : null, // department name, resolved to ID in SQL below
      ];
    },
    insertSql: `
      INSERT INTO admin_db.users
        (email, first_name, last_name, status, perm_card_details, perm_email_leads,
         perm_dispatch_or_commission_or_po,
         perm_search_company, perm_search_status, perm_search_qualification, perm_search_city_state,
         perm_search_tasks, perm_marketing_dashboard, perm_manufacturing_clearance, perm_item_code_access,
         perm_upload_drawings, perm_create_boq, perm_authorize_boq, perm_update_boq, perm_authorize_boq_update,
         perm_design_dashboard, perm_material_list_purchase, perm_create_rm_po, perm_authorize_rm_po,
         perm_pps_tracking, perm_purchase_dashboard, perm_purchase_request_note, perm_assign_current_stock,
         perm_gate_entry, perm_store_entry_and_grn, perm_qa_check, perm_store_inward_rejected,
         perm_expected_deliveries, perm_approve_job_card_increase, perm_approve_store_tickets,
         perm_search_store_tickets, perm_live_rm_stock, perm_live_fg_stock, perm_live_spare_stock,
         perm_store_dashboard, perm_create_store_ticket, perm_dispatch_product_code, perm_job_card_letterhead,
         perm_add_finished_goods_store, perm_production_dashboard, perm_admin, department_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
              $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,
              (SELECT department_id FROM admin_db.departments WHERE lower(name) = lower($47)))
      ON CONFLICT (email) DO NOTHING`,
  }));

  // ═══ 2. MARKETING ═══════════════════════════════════════════════════
  results.push(await migrateTable({
    label: 'Marketing: Companies',
    sheetGroup: 'MARKETING', tabName: 'Companies',
    mapRow: (r) => {
      const id = str(r['Company ID']);
      if (!id) return null;
      return [id, str(r['Company Name']) || 'Unknown', str(r['Website']), str(r['City']), str(r['State']),
              str(r['Country']), str(r['Company Address']), str(r['Type of Industry']), str(r['Type of Customer']),
              str(r['Type of Vendor']), str(r['Name of Materials Supplied']), date(r['Created Date']), str(r['Created By'])];
    },
    insertSql: `
      INSERT INTO marketing.companies
        (company_id, company_name, website, city, state, country, company_address, type_of_industry,
         type_of_customer, type_of_vendor, materials_supplied, created_date, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, now()),$13)
      ON CONFLICT (company_id) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Marketing: Enquiries',
    sheetGroup: 'MARKETING', tabName: 'Enquiries',
    mapRow: (r) => {
      const id = str(r['Enquiry ID']);
      const companyId = str(r['Company ID']);
      if (!id || !companyId) return null; // FK required — skip orphaned rows, they'll show in error report
      return [id, companyId, str(r['Status']) || 'Open', date(r['Timestamp']), str(r['Engineer Name']),
              str(r['Contact Person Name']), str(r['Position']), str(r['Phone']), str(r['Alt Phone']), str(r['Email']),
              date(r['Date of Meeting']), str(r['Time of Meeting']), str(r['Meeting Venue']), str(r['Venue Name / City']),
              str(r['Additional Meeting Details (if any)']), str(r['ABPS Business Vertical']),
              bool(r['Low Power Factor Issue']), bool(r['High Electricity Bill Issue']), bool(r['Harmonics Issue']),
              bool(r['Transformer Heating / Breakdown Issue']), bool(r['Grid Stability Issue']),
              bool(r['Purchase Inquire']), bool(r['Tender Inquire']), str(r['Existing System Details']),
              str(r['Voltage Level Requirements']), num(r['Contract Demand (MVA)']), num(r['Running Demand (MVA)']),
              num(r['Monthly Average Power Factor']), str(r['Problem Observed']), str(r['Technical Discussion Summary']),
              str(r['Existing Project']), str(r['Upcoming Project']), str(r['Products Discussed']),
              str(r['Approx Requirement']), date(r['Expected Tender / RFQ Date']), str(r['Expected Order Timeline']),
              str(r['Competitor Details']), num(r['Approx Business Potential']), bool(r['Send Company Profile']),
              bool(r['Send Technical Presentation']), bool(r['Arrange Site Visit']), bool(r['Get Enquiry']),
              bool(r['Send Offer']), bool(r['Follow-Up Required']), str(r['Card Image Link'])];
    },
    insertSql: `
      INSERT INTO marketing.enquiries
        (enquiry_id, company_id, status, ts, engineer_name, contact_person_name, position, phone, alt_phone, email,
         date_of_meeting, time_of_meeting, meeting_venue, venue_name_city, additional_meeting_details,
         abps_business_vertical, low_power_factor_issue, high_electricity_bill_issue, harmonics_issue,
         transformer_heating_issue, grid_stability_issue, purchase_inquire, tender_inquire, existing_system_details,
         voltage_level_requirements, contract_demand_mva, running_demand_mva, monthly_avg_power_factor,
         problem_observed, technical_discussion_summary, existing_project, upcoming_project, products_discussed,
         approx_requirement, expected_tender_rfq_date, expected_order_timeline, competitor_details,
         approx_business_potential, send_company_profile, send_technical_presentation, arrange_site_visit,
         get_enquiry, send_offer, follow_up_required, card_image_link)
      VALUES ($1,$2,$3,COALESCE($4,now()),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
              $24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45)
      ON CONFLICT (enquiry_id) DO NOTHING`,
  }));

  // ═══ 3. DESIGN ═══════════════════════════════════════════════════════
  results.push(await migrateTable({
    label: 'Design: Item Codes',
    sheetGroup: 'DESIGN', tabName: 'ItemCodes',
    mapRow: (r) => {
      const code = str(r['Item Code']);
      if (!code) return null;
      return [code, str(r['Material Name']) || 'Unknown', str(r['Rating']), str(r['Type of Material']),
              str(r['Unit']), str(r['Created By']), date(r['Created Date'])];
    },
    insertSql: `
      INSERT INTO design.item_codes (item_code, material_name, rating, type_of_material, unit, created_by, created_date)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()))
      ON CONFLICT (item_code) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Project: Projects',
    sheetGroup: 'PROJECT', tabName: 'Projects',
    mapRow: (r) => {
      const id = str(r['Project ID']);
      if (!id) return null;
      return [id, str(r['Project Status']) || 'Active', str(r['Company Name'])];
    },
    insertSql: `
      INSERT INTO project.projects (project_id, project_status, company_name)
      VALUES ($1,$2,$3)
      ON CONFLICT (project_id) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Design: Bill of Quantity (material_rows from "Material Rows List" column — verify this against your live sheet, see note in code)',
    sheetGroup: 'DESIGN', tabName: 'BillOfQuantity',
    mapRow: (r) => {
      const id = str(r['BOQ ID']);
      const projectId = str(r['Project ID']);
      if (!id || !projectId) return null;
      // NOTE: your sheet stored material rows as a JSON blob in "Material
      // Rows List". If your live data actually has that column populated,
      // this captures it directly. If BOQDrafts is the real source of
      // truth for line items in your instance instead, migrate BOQDrafts
      // separately (see TODO checklist) and reconstruct material_rows
      // from those rows — check your actual sheet before relying on this
      // column alone.
      return [id, projectId, str(r['Customer Name']), str(r['Product Name']), str(r['Product Rating']),
              str(r['Department']), num(r['Order Quantity']), date(r['Date']), str(r['Prepared By']),
              str(r['Authorized By']), str(r['Status']) || 'Pending Authorization', json(r['Material Rows List']),
              int(r['Version']) || 1, num(r['Total Bill Of Quantity Cost Per Set']), num(r['Total Bill Of Quantity Cost']),
              date(r['Created Timestamp']), date(r['Last Updated Timestamp'])];
    },
    insertSql: `
      INSERT INTO design.bill_of_quantity
        (boq_id, project_id, customer_name, product_name, product_rating, department, order_quantity, boq_date,
         prepared_by, authorized_by, status, material_rows, version, total_cost_per_set, total_cost, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()),$9,$10,$11,$12,$13,$14,$15,COALESCE($16,now()),COALESCE($17,now()))
      ON CONFLICT (boq_id) DO NOTHING`,
  }));

  // ═══ 4. PURCHASE ═════════════════════════════════════════════════════
  results.push(await migrateTable({
    label: 'Purchase: Vendor Information',
    sheetGroup: 'PURCHASE', tabName: 'VendorInformation',
    mapRow: (r) => {
      const name = str(r['Vendor Name']);
      if (!name) return null;
      return [name, str(r['GSTIN/UIN']), str(r['Type of Vendor']), str(r['Contact Person']), str(r['Phone Number']),
              str(r['E-Mail']), str(r['City']), str(r['State']), str(r['State Code']), str(r['Address']),
              str(r['Status']) || 'Active'];
    },
    insertSql: `
      INSERT INTO purchase.vendor_information
        (vendor_name, gstin_uin, type_of_vendor, contact_person, phone_number, email, city, state, state_code, address, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (vendor_name) DO NOTHING`,
  }));

  // ═══ 5. INVENTORY ════════════════════════════════════════════════════
  results.push(await migrateTable({
    label: 'Inventory: Master Inventory',
    sheetGroup: 'INVENTORY', tabName: 'MasterInventory',
    mapRow: (r) => {
      const code = str(r['Item Code']);
      if (!code) return null;
      return [code, str(r['Material Name']) || 'Unknown', num(r['Total Stock']) || 0, num(r['Reserved Stock']) || 0,
              str(r['Unit Type']), str(r['Type of Material']), num(r['Rate Per Quantity']),
              num(r['Total Basic Amount']), num(r['Total Invoice Amount (including GST)']), bool(r['BOQ Active'])];
    },
    // item_code has a FK to design.item_codes — run AFTER the Item Codes migration above.
    insertSql: `
      INSERT INTO inventory.master_inventory
        (item_code, material_name, total_stock, reserved_stock, unit_type, type_of_material,
         rate_per_quantity, total_basic_amount, total_invoice_amount_incl_gst, boq_active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (item_code) DO NOTHING`,
  }));

  // ═══ 6. PRODUCTION ═══════════════════════════════════════════════════
  results.push(await migrateTable({
    label: 'Production: Dispatch Product Codes',
    sheetGroup: 'PRODUCTION', tabName: 'DispatchProductCodeNumber',
    mapRow: (r) => {
      const code = str(r['Dispatched Product Code Number']);
      if (!code) return null;
      return [code, str(r['Product Name']) || 'Unknown', str(r['Rating']), str(r['Unit']), str(r['Created By']), date(r['Created Date'])];
    },
    insertSql: `
      INSERT INTO production.dispatch_product_code_number (dispatch_code, product_name, rating, unit, created_by, created_date)
      VALUES ($1,$2,$3,$4,$5,COALESCE($6,now()))
      ON CONFLICT (dispatch_code) DO NOTHING`,
  }));

  // ═══ 2b. MARKETING — remaining tables (reference Enquiries) ════════
  results.push(await migrateTable({
    label: 'Marketing: FollowUps',
    sheetGroup: 'MARKETING', tabName: 'FollowUps',
    mapRow: (r) => {
      const enquiryId = str(r['Enquiry ID']);
      if (!enquiryId) return null;
      return [str(r['Follow-Up Status']) || 'Pending', enquiryId, date(r['Date']), str(r['Time']),
              str(r['Engineer Name']), str(r['Interaction Notes']), str(r['Interaction Outcome']),
              str(r['Interaction Mode']), date(r['Next Follow-Up Date']), str(r['Next Follow-Up Time']),
              str(r['Next Action Type']), str(r['Objection Raised'])];
    },
    insertSql: `
      INSERT INTO marketing.follow_ups
        (follow_up_status, enquiry_id, event_date, event_time, engineer_name, interaction_notes,
         interaction_outcome, interaction_mode, next_follow_up_date, next_follow_up_time, next_action_type, objection_raised)
      VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    // No natural unique key in the sheet for this table (Follow-Up Number
    // isn't guaranteed unique across re-runs) — this insert is NOT
    // idempotent. Run once; re-running will duplicate rows. If you need
    // to re-run, TRUNCATE marketing.follow_ups first.
  }));

  results.push(await migrateTable({
    label: 'Marketing: Tasks',
    sheetGroup: 'MARKETING', tabName: 'Tasks',
    mapRow: (r) => {
      const enquiryId = str(r['Enquiry ID']);
      if (!enquiryId) return null;
      return [str(r['Task Status']) || 'Pending', enquiryId, date(r['Date']), str(r['Time']),
              str(r['Engineer Name']), str(r['Assigning Engineer']), str(r['Task Type']),
              str(r['Task Description']), str(r['Task Priority']), str(r['Target Time']),
              date(r['Target Date']), str(r['Completion Notes / Outcome'])];
    },
    insertSql: `
      INSERT INTO marketing.tasks
        (task_status, enquiry_id, event_date, event_time, engineer_name, assigning_engineer, task_type,
         task_description, task_priority, target_time, target_date, completion_notes)
      VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    // Same caveat as FollowUps — no natural unique key, not idempotent.
  }));

  results.push(await migrateTable({
    label: 'Marketing: Uploaded Document Information',
    sheetGroup: 'MARKETING', tabName: 'UploadedDocumentInformation',
    mapRow: (r) => {
      const enquiryId = str(r['Enquiry ID']);
      if (!enquiryId) return null;
      return [str(r['Status']) || 'Pending', enquiryId, str(r['Contact Person Name']), str(r['Company Name']),
              str(r['Project ID']), str(r['Purchase Order Number']), date(r['Purchase Order Date']),
              date(r['Committed Delivery Date']), str(r['Purchase Order Product Name']), str(r['Purchase Order Summary']),
              num(r['Basic Purchase Order Amount (in Rs)']), num(r['Purchase Order GST Amount']),
              num(r['Purchase Order Total Amount']), str(r['Payment Terms']), str(r['Name of ABPS Owner of Order']),
              str(r['Purchase Order Warranty Terms']), bool(r['ABG Required']), str(r['Scope of Work']),
              str(r['Dispatch Bill Invoice Number']), date(r['Dispatch Bill Invoice Date']), str(r['Customer PO Number']),
              date(r['Customer PO Date']), num(r['Basic Dispatch Bill Amount (in Rs)']), num(r['Dispatch Bill GST Amount']),
              num(r['Total Dispatch Bill Amount']), date(r['Date of Product Commissioning']),
              str(r['Commissioning ABPS Engineer Name']), str(r['Commissioned Product']), str(r['Customer Contact Person'])];
    },
    insertSql: `
      INSERT INTO marketing.uploaded_document_information
        (status, enquiry_id, contact_person_name, company_name, project_id, purchase_order_number, purchase_order_date,
         committed_delivery_date, purchase_order_product_name, purchase_order_summary, basic_po_amount, po_gst_amount,
         po_total_amount, payment_terms, abps_owner_of_order, po_warranty_terms, abg_required, scope_of_work,
         dispatch_bill_invoice_number, dispatch_bill_invoice_date, customer_po_number, customer_po_date,
         basic_dispatch_bill_amount, dispatch_bill_gst_amount, total_dispatch_bill_amount, date_of_product_commissioning,
         commissioning_engineer_name, commissioned_product, customer_contact_person)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
      ON CONFLICT (purchase_order_number, dispatch_bill_invoice_number) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Marketing: Purchase Order Information (line items)',
    sheetGroup: 'MARKETING', tabName: 'PurchaseOrderInformation',
    mapRow: (r) => {
      const enquiryId = str(r['Enquiry ID']);
      if (!enquiryId) return null;
      return [str(r['Status']) || 'Pending', enquiryId, str(r['Contact Person Name']), str(r['Company Name']),
              str(r['Project ID']), str(r['Purchase Order Number']), date(r['Purchase Order Date']),
              date(r['Committed Delivery Date']), str(r['Purchase Order Product Name']), str(r['Tag Numbers']),
              str(r['Unit']), num(r['Quantity']), num(r['Rate Per Quantity']), num(r['Basic Purchase Order Amount (in Rs)']),
              num(r['Purchase Order GST Amount']), num(r['Purchase Order GST Percent']), num(r['Purchase Order Total Amount']),
              str(r['Name of ABPS Owner of Order']), str(r['Purchase Order Warrenty Terms'])];
    },
    insertSql: `
      INSERT INTO marketing.purchase_order_information
        (status, enquiry_id, contact_person_name, company_name, project_id, purchase_order_number, purchase_order_date,
         committed_delivery_date, purchase_order_product_name, tag_numbers, unit, quantity, rate_per_quantity,
         basic_po_amount, po_gst_amount, po_gst_percent, po_total_amount, abps_owner_of_order, po_warranty_terms)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    // Line-item table, no natural unique key — not idempotent, same caveat as FollowUps/Tasks.
  }));

  results.push(await migrateTable({
    label: 'Marketing: Offers Sent',
    sheetGroup: 'MARKETING', tabName: 'OfferSent',
    mapRow: (r) => {
      const enquiryId = str(r['Lead ID']) || str(r['Enquiry ID']); // sheet historically used "Lead ID"
      if (!enquiryId) return null;
      return [date(r['Timestamp']), enquiryId, str(r['Company Name']), str(r['Contact Person Name']),
              str(r['Engineer Name']), int((r['Offer Version'] || '').toString().replace(/^v/i, '')) || 1,
              str(r['Email Subject']), date(r['Email Sent Date']), str(r['Email Sent Time']),
              str(r['AI Offer Summary']), str(r['Products Mentioned']), num(r['Estimated Value']), str(r['Gmail Thread Link'])];
    },
    insertSql: `
      INSERT INTO marketing.offers_sent
        (ts, enquiry_id, company_name, contact_person_name, engineer_name, offer_version, email_subject,
         email_sent_date, email_sent_time, ai_offer_summary, products_mentioned, estimated_value, gmail_thread_link)
      VALUES (COALESCE($1,now()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    // No natural unique key — not idempotent, same caveat as above.
  }));

  results.push(await migrateTable({
    label: 'Marketing: Cold Introductory Emails Sent',
    sheetGroup: 'MARKETING', tabName: 'ColdIntroductoryEmailsSent',
    mapRow: (r) => {
      const email = str(r['Recipient Email']);
      if (!email) return null;
      return [str(r['Company Name']), email, str(r['Contact Person Name']), str(r['Sent By']),
              date(r['First Contacted Date']), date(r['Last Contacted Date']), int(r['Times Contacted']) || 1,
              str(r['Last Subject']), str(r['Last Summary']), str(r['Last Thread Link'])];
    },
    insertSql: `
      INSERT INTO marketing.cold_introductory_emails_sent
        (company_name, recipient_email, contact_person_name, sent_by, first_contacted_date, last_contacted_date,
         times_contacted, last_subject, last_summary, last_thread_link)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (recipient_email) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Marketing: Processed Emails',
    sheetGroup: 'MARKETING', tabName: 'ProcessedEmails',
    mapRow: (r) => {
      const messageId = str(r['Message ID']);
      if (!messageId) return null;
      return [messageId, date(r['Timestamp']), str(r['Notes']), str(r['Creator of Note']), bool(r['Is Lead']),
              str(r['Company']), str(r['Contact Person']), str(r['AI Summary']), str(r['Subject']),
              date(r['Received Date']), str(r['Received Time']), str(r['Inbox Account']), str(r['Thread Link']), str(r['Attachments'])];
    },
    insertSql: `
      INSERT INTO marketing.processed_emails
        (message_id, ts, notes, creator_of_note, is_lead, company, contact_person, ai_summary, subject,
         received_date, received_time, inbox_account, thread_link, attachments)
      VALUES ($1,COALESCE($2,now()),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (message_id) DO NOTHING`,
  }));

  // ═══ 3b. DESIGN — BOQDrafts (references BillOfQuantity + ItemCodes) ═
  results.push(await migrateTable({
    label: 'Design: BOQ Drafts (line items)',
    sheetGroup: 'DESIGN', tabName: 'BOQDrafts',
    mapRow: (r) => {
      const boqId = str(r['BOQ ID']);
      if (!boqId) return null;
      return [date(r['Timestamp']), boqId, str(r['Customer Name']), str(r['Project ID']),
              str(r['Production Department']), str(r['Product Name']), str(r['Product Rating']),
              str(r['Description of Material']), num(r['Total Product Quantity']), num(r['Used Product Quantity']) || 0,
              num(r['Remaining Product Quantity']), str(r[' Unit Type']) || str(r['Unit Type']), str(r['Type of Store']),
              str(r['Item Code']), str(r['Make']), num(r['Quantity for 1 Set']), num(r['Order Quantity']),
              num(r['Design Rate Per Quantity']), num(r['Total Material Rate']), str(r['Prepared By']), str(r['Authorized By'])];
    },
    insertSql: `
      INSERT INTO design.boq_drafts
        (ts, boq_id, customer_name, project_id, production_department, product_name, product_rating,
         description_of_material, total_product_quantity, used_product_quantity, remaining_product_quantity,
         unit_type, type_of_store, item_code, make, qty_for_1_set, order_quantity, design_rate_per_quantity,
         total_material_rate, prepared_by, authorized_by)
      VALUES (COALESCE($1,now()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    // Line-item table, no natural unique key — not idempotent. Run AFTER
    // BillOfQuantity (FK) and AFTER ItemCodes (item_code FK, though
    // unenforced here since some legacy rows may predate the catalog).
  }));

  // ═══ 4b. PURCHASE — remaining tables ═════════════════════════════════
  results.push(await migrateTable({
    label: 'Purchase: Material Buffer Percentage (no FK — safe to run any time)',
    sheetGroup: 'PURCHASE', tabName: 'MaterialBufferPercentage',
    mapRow: (r) => {
      const type = str(r['Type of Material']);
      if (!type) return null;
      return [type, num(r['Buffer %']) || 0];
    },
    insertSql: `
      INSERT INTO purchase.material_buffer_percentage (type_of_material, buffer_percent)
      VALUES ($1,$2)
      ON CONFLICT (type_of_material) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Purchase: Purchase Request Notes',
    sheetGroup: 'PURCHASE', tabName: 'PurchaseRequestNotes',
    mapRow: (r) => {
      const id = str(r['PRN ID']);
      const projectId = str(r['Project ID']);
      const boqId = str(r['BOQ ID']);
      if (!id || !projectId || !boqId) return null;
      return [id, projectId, boqId, str(r['Product Name']), str(r['Product Rating']), num(r['Order Quantity']),
              date(r['Created Date']), str(r['Store Person']), str(r['Status']) || 'PRN Generated',
              int(r['Version']) || 1, str(r['PDF URL'])];
    },
    insertSql: `
      INSERT INTO purchase.purchase_request_notes
        (prn_id, project_id, boq_id, product_name, product_rating, order_quantity, created_date, store_person,
         status, version, pdf_url)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,now()),$8,$9,$10,$11)
      ON CONFLICT (prn_id) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Purchase: PRN Line Items',
    sheetGroup: 'PURCHASE', tabName: 'PRNLineItems',
    mapRow: (r) => {
      const prnId = str(r['PRN ID']);
      const itemCode = str(r['Item Code']);
      if (!prnId || !itemCode) return null;
      return [prnId, itemCode, str(r['Material Name']), str(r['Type of Material']), num(r['BOQ Required Quantity']),
              num(r['Buffer %']), num(r['Buffered Purchase Quantity']), num(r['Current Unassigned Store Quantity']),
              num(r['Purchase Quantity']), num(r['Original Purchased Buffered Quantity']) || num(r['Buffered Purchase Quantity']),
              num(r['Assigned Quantity']) || 0, num(r['On Order Quantity']) || 0, num(r['Still To Order Quantity']),
              str(r['Checked By Store Person'])];
    },
    insertSql: `
      INSERT INTO purchase.prn_line_items
        (prn_id, item_code, material_name, type_of_material, boq_required_quantity, buffer_percent,
         buffered_purchase_quantity, current_unassigned_store_quantity, purchase_quantity,
         original_purchased_buffered_quantity, assigned_quantity, on_order_quantity, still_to_order_quantity,
         checked_by_store_person)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    // Line-item table, no natural unique key — not idempotent. Requires PRN + ItemCodes migrated first.
  }));

  results.push(await migrateTable({
    label: 'Purchase: Raw Material Purchase Orders',
    sheetGroup: 'PURCHASE', tabName: 'RawMaterialPurchaseOrders',
    mapRow: (r) => {
      const poNo = str(r['P.O. No.']);
      const vendorName = str(r['Vendor Name']);
      if (!poNo || !vendorName) return null;
      return [poNo, str(r['Status']) || 'Pending Authorization', vendorName, str(r['Supplier Ref/ Offer No']),
              date(r['Order Date']), date(r['Delivery Date']), json(r['Material Rows List']), num(r['Sub Total']),
              num(r['CGST Percent']), num(r['CGST Amount']), num(r['SGST Percent']), num(r['SGST Amount']),
              num(r['IGST Percent']), num(r['IGST Amount']), num(r['Packing Amount']), num(r['Freight Amount']),
              num(r['Other Amount']), num(r['Round Off Amount']), num(r['Grand Total']), str(r['Grand Total In Words']),
              str(r['Warranty']), str(r['Payment Terms']), str(r['Freight Terms']), str(r['Prepared By']),
              str(r['Authorized By']), date(r['Created Timestamp']), date(r['Authorized Timestamp']), str(r['Drive File URL'])];
    },
    // Requires VendorInformation migrated first (FK).
    insertSql: `
      INSERT INTO purchase.raw_material_purchase_orders
        (po_no, status, vendor_name, supplier_ref_offer_no, order_date, delivery_date, material_rows, sub_total,
         cgst_percent, cgst_amount, sgst_percent, sgst_amount, igst_percent, igst_amount, packing_amount,
         freight_amount, other_amount, round_off_amount, grand_total, grand_total_in_words, warranty, payment_terms,
         freight_terms, prepared_by, authorized_by, created_at, authorized_at, drive_file_url)
      VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
              $22,$23,$24,$25,COALESCE($26,now()),$27,$28)
      ON CONFLICT (po_no) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Purchase: Raw Material PO Line Items',
    sheetGroup: 'PURCHASE', tabName: 'RawMaterialPOLineItems',
    mapRow: (r) => {
      const poNo = str(r['P.O. No.']);
      if (!poNo) return null;
      return [poNo, int(r['Sr No']), str(r['Description of Material']), str(r['Item Code']), num(r['Quantity']),
              str(r['Unit']), num(r['Rate Per Quantity']), num(r['Discount Percent']) || 0, num(r['Amount'])];
    },
    insertSql: `
      INSERT INTO purchase.raw_material_po_line_items
        (po_no, sr_no, description_of_material, item_code, quantity, unit, rate_per_quantity, discount_percent, amount)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    // Line-item table, no natural unique key — not idempotent. Requires PO migrated first.
  }));

  results.push(await migrateTable({
    label: 'Purchase: Vendor Performance',
    sheetGroup: 'PURCHASE', tabName: 'VendorPerformance',
    mapRow: (r) => {
      const vendorName = str(r['Vendor Name']);
      if (!vendorName) return null;
      return [vendorName, int(r['Total POs Raised']) || 0, int(r['Total Invoices Processed']) || 0,
              num(r['Total Quantity Ordered']) || 0, num(r['Total Quantity Received']) || 0,
              num(r['Transit Rejected Quantity']) || 0, num(r['QA Rejected Quantity']) || 0,
              num(r['Total Discrepancies']) || 0, int(r['On Time Deliveries']) || 0, int(r['Late Deliveries']) || 0,
              num(r['Average Days Late']) || 0, date(r['Last Delivery Date'])];
    },
    // Requires VendorInformation migrated first (FK).
    insertSql: `
      INSERT INTO purchase.vendor_performance
        (vendor_name, total_pos_raised, total_invoices_processed, total_quantity_ordered, total_quantity_received,
         transit_rejected_quantity, qa_rejected_quantity, total_discrepancies, on_time_deliveries, late_deliveries,
         average_days_late, last_delivery_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (vendor_name) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Purchase: PPS Tracking',
    sheetGroup: 'PURCHASE', tabName: 'PPSTracking',
    mapRow: (r) => {
      const projectId = str(r['Project ID']);
      if (!projectId) return null;
      return [projectId, str(r['PRN ID']), str(r['Item Code']), str(r['Material Name']), num(r['BOQ Quantity']),
              num(r['Buffered Quantity']), num(r['Store Reserved Quantity']), num(r['Purchased Quantity']),
              str(r['P.O. No.']), date(r['P.O. Date']), str(r['Vendor Name']), date(r['Expected Delivery Date']),
              date(r['Actual Delivery Date']), num(r['Actual Received Quantity']), str(r['Action Plan']),
              date(r['PRN Created Date']), str(r['Link Status'])];
    },
    // Best-effort FKs (prn_id, po_no, vendor_name) — left nullable in the
    // schema, so rows referencing not-yet-migrated PRNs/POs still insert.
    insertSql: `
      INSERT INTO purchase.pps_tracking
        (project_id, prn_id, item_code, material_name, boq_quantity, buffered_quantity, store_reserved_quantity,
         purchased_quantity, po_no, po_date, vendor_name, expected_delivery_date, actual_delivery_date,
         actual_received_quantity, action_plan, prn_created_date, link_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    // No natural unique key — not idempotent.
  }));

  // ═══ 5b. INVENTORY — remaining tables ════════════════════════════════
  results.push(await migrateTable({
    label: 'Inventory: Spare Inventory',
    sheetGroup: 'INVENTORY', tabName: 'SpareInventory',
    mapRow: (r) => {
      const code = str(r['Item Code']);
      if (!code) return null;
      return [code, str(r['Material Name']) || 'Unknown', num(r['Total Stock']) || 0, num(r['Available Stock']) || 0,
              str(r['Unit Type']), str(r['Type of Material']), date(r['Last Updated'])];
    },
    // Requires ItemCodes migrated first (FK).
    insertSql: `
      INSERT INTO inventory.spare_inventory (item_code, material_name, total_stock, available_stock, unit_type, type_of_material, last_updated)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,now()))
      ON CONFLICT (item_code) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Inventory: Inbound Store Ledger',
    sheetGroup: 'INVENTORY', tabName: 'InboundStoreLedger',
    mapRow: (r) => {
      const gateNumber = str(r['Gate Number']);
      if (!gateNumber) return null;
      return [date(r['Timestamp']), str(r['Transaction Status']) || 'Pending', str(r['Vendor Name']),
              str(r['Invoice Number']), str(r['Challan Number Invoice Description']), str(r['Item Code']),
              str(r['Material Name']), str(r['Unit Type']), str(r['Type of Material']), num(r['Quantity Received']),
              num(r['Missing Quantity']) || 0, num(r['OK Quantity']), num(r['Not OK Quantity']) || 0,
              str(r['Reason for Not OK']), str(r['Action for Rejected Material']), num(r['Rate Per Quantity']),
              num(r['Total Basic Amount']), num(r['GST Percent']), num(r['Total Invoice Amount (including GST)']),
              str(r['Drive Image URL']), str(r['Gate Entry ABPS Person']), str(r['GRN ABPS Person']),
              str(r['QA Person']), date(r['QA Timestamp']), gateNumber, str(r['GRN Number'])];
    },
    // Note: "Resolves Rejection ID" from the sheet references a rejection
    // row created AFTER this ledger row historically — since IDs are
    // regenerated as BIGSERIAL here (not preserved text IDs like other
    // tables), that specific cross-link isn't reconstructable from the
    // sheet alone. Leave resolves_rejection_id NULL on migrated rows;
    // it only matters for NEW rows created going forward.
    insertSql: `
      INSERT INTO inventory.inbound_store_ledger
        (ts, transaction_status, vendor_name, invoice_number, challan_number_desc, item_code, material_name,
         unit_type, type_of_material, quantity_received, missing_quantity, ok_quantity, not_ok_quantity,
         reason_for_not_ok, action_for_rejected_material, rate_per_quantity, total_basic_amount, gst_percent,
         total_invoice_amount_incl_gst, drive_image_url, gate_entry_person, grn_person, qa_person, qa_timestamp,
         gate_number, grn_number)
      VALUES (COALESCE($1,now()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    // No natural unique key — not idempotent.
  }));

  results.push(await migrateTable({
    label: 'Inventory: Rejected Material Tracking',
    sheetGroup: 'INVENTORY', tabName: 'RejectedMaterialTracking',
    mapRow: (r) => {
      const grnNumber = str(r['GRN Number']);
      if (!grnNumber) return null;
      return [grnNumber, str(r['Item Code']), str(r['Material Name']), str(r['Unit Type']), str(r['Vendor Name']),
              num(r['Not OK Quantity']), num(r['Outstanding Quantity']), str(r['Reason for Not OK']),
              str(r['Action for Rejected Material']), str(r['Status']) || 'Open', str(r['Set By (Store)']),
              date(r['Set Timestamp']), str(r['Purchase Reviewed By']), date(r['Purchase Reviewed Timestamp']),
              date(r['Resolved Timestamp'])];
    },
    // "Prior Rejection ID" from the sheet is a self-reference to another
    // rejection row's original ID — since IDs regenerate here (BIGSERIAL,
    // not preserved), that specific chain isn't reconstructable from the
    // sheet alone. Left NULL on migrated rows.
    insertSql: `
      INSERT INTO inventory.rejected_material_tracking
        (grn_number, item_code, material_name, unit_type, vendor_name, not_ok_quantity, outstanding_quantity,
         reason_for_not_ok, action_for_rejected_material, status, set_by_store, set_timestamp,
         purchase_reviewed_by, purchase_reviewed_timestamp, resolved_timestamp)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,now()),$13,$14,$15)`,
    // No natural unique key — not idempotent.
  }));

  results.push(await migrateTable({
    label: 'Inventory: Outbound Store Ledger',
    sheetGroup: 'INVENTORY', tabName: 'OutboundStoreLedger',
    mapRow: (r) => {
      const itemCode = str(r['Item Code']);
      if (!itemCode) return null;
      return [date(r['Timestamp']), str(r['Transaction Type']) || 'Unknown', str(r['Type of Store']),
              str(r['Project ID']), str(r['Job Card Number']), str(r['Department']), str(r['Requested By']),
              str(r['Reference ID']), itemCode, str(r['Material Name']), num(r['Quantity Removed']) || 0, str(r['Authorized By'])];
    },
    insertSql: `
      INSERT INTO inventory.outbound_store_ledger
        (ts, transaction_type, type_of_store, project_id, job_card_number, department, requested_by,
         reference_id, item_code, material_name, quantity_removed, authorized_by)
      VALUES (COALESCE($1,now()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    // No natural unique key — not idempotent.
  }));

  results.push(await migrateTable({
    label: 'Inventory: Store Tickets',
    sheetGroup: 'INVENTORY', tabName: 'StoreTickets',
    mapRow: (r) => {
      const ticketId = str(r['Ticket ID']);
      if (!ticketId) return null;
      return [ticketId, str(r['Request or Return']) === 'Return' ? 'Return' : 'Request', str(r['Type of Store']),
              str(r['Project ID']), str(r['Job Card Number']), str(r['Department']), str(r['Requested / Returned By']),
              num(r['Backorder Quantity']) || 0, date(r['Date Created']), date(r['Date Actioned']),
              str(r['Actioned By']), str(r['Status']) || 'Pending', json(r['Items']), str(r['Parent Ticket ID'])];
    },
    insertSql: `
      INSERT INTO inventory.store_tickets
        (ticket_id, request_or_return, type_of_store, project_id, job_card_number, department,
         requested_returned_by, backorder_quantity, date_created, date_actioned, actioned_by, status, items, parent_ticket_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,now()),$10,$11,$12,$13,$14)
      ON CONFLICT (ticket_id) DO NOTHING`,
    // parent_ticket_id is self-referencing — migrate in Date Created
    // order (oldest first) if your sheet isn't already sorted that way,
    // so a child ticket's parent already exists when the child inserts.
  }));

  results.push(await migrateTable({
    label: 'Inventory: Stock Assignments',
    sheetGroup: 'INVENTORY', tabName: 'StockAssignments',
    mapRow: (r) => {
      const itemCode = str(r['Item Code']);
      if (!itemCode) return null;
      return [itemCode, str(r['Material Name']), str(r['BOQ ID']), str(r['Project ID']),
              num(r['Assigned Quantity']) || 0, num(r['Utilized Quantity']) || 0, date(r['Assigned Date']), str(r['Assigned By'])];
    },
    insertSql: `
      INSERT INTO inventory.stock_assignments
        (item_code, material_name, boq_id, project_id, assigned_quantity, utilized_quantity, assigned_date, assigned_by)
      VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,now()),$8)`,
    // No natural unique key — not idempotent.
  }));

  // ═══ 6b. PRODUCTION — remaining tables ═══════════════════════════════
  results.push(await migrateTable({
    label: 'Production: Job Card Number',
    sheetGroup: 'PRODUCTION', tabName: 'JobCardNumber',
    mapRow: (r) => {
      const jcn = str(r['Job Card Number']);
      const projectId = str(r['Project ID']);
      if (!jcn || !projectId) return null;
      return [jcn, projectId, str(r['Customer Name']), str(r['Product Name']), str(r['Product Rating']),
              str(r['BOQ ID']), int(r['Set Number']), date(r['Date Created']), str(r['Status']) || 'Open', str(r['Drive Image URL'])];
    },
    insertSql: `
      INSERT INTO production.job_card_number
        (job_card_number, project_id, customer_name, product_name, product_rating, boq_id, set_number,
         date_created, status, drive_image_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()),$9,$10)
      ON CONFLICT (job_card_number) DO NOTHING`,
  }));

  results.push(await migrateTable({
    label: 'Production: Job Card Materials',
    sheetGroup: 'PRODUCTION', tabName: 'JobCardMaterials',
    mapRow: (r) => {
      const jcn = str(r['Job Card Number']);
      const itemCode = str(r['Item Code']);
      if (!jcn || !itemCode) return null;
      return [jcn, str(r['BOQ ID']), str(r['Project ID']), itemCode, str(r['Material Name']), str(r['Unit Type']),
              str(r['Type of Store']), num(r['Allotted Quantity']) || 0, num(r['Used Quantity']) || 0,
              num(r['Pending Quantity']) || 0, num(r['Remaining Quantity']), num(r['Increase Approved Quantity']) || 0,
              date(r['Last Updated'])];
    },
    // Requires JobCardNumber + ItemCodes migrated first.
    insertSql: `
      INSERT INTO production.job_card_materials
        (job_card_number, boq_id, project_id, item_code, material_name, unit_type, type_of_store,
         allotted_quantity, used_quantity, pending_quantity, remaining_quantity, increase_approved_quantity, last_updated)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,now()))`,
    // No natural unique key — not idempotent.
  }));

  results.push(await migrateTable({
    label: 'Production: Finished Goods Inventory',
    sheetGroup: 'PRODUCTION', tabName: 'FinishedGoodsInventory',
    mapRow: (r) => {
      const projectId = str(r['Project ID']);
      if (!projectId) return null;
      return [date(r['Date']), str(r['Department']), projectId, str(r['Customer Name']),
              str(r['Item Code / Dispatched Product Code Number']), str(r['Finished Good Use']),
              str(r['Job Card Number']), str(r['Product Serial Number']), str(r['Product Name']),
              str(r['Product Rating']), str(r['Unit']), str(r['Status']) || 'In Store',
              str(r['Production Department Responsible Person']), str(r['Finished Goods Store Incharge Person']),
              str(r['Additional Remarks']), str(r['Q/A Person']), bool(r['Q/A Done']), str(r['Job Card Sheet URL']),
              str(r['Certificate URL']), str(r['Inspection Clearance URL']), str(r['In Process Inspection URL'])];
    },
    insertSql: `
      INSERT INTO production.finished_goods_inventory
        (fg_date, department, project_id, customer_name, item_or_dispatch_code, finished_good_use, job_card_number,
         product_serial_number, product_name, product_rating, unit, status, production_responsible_person,
         fg_store_incharge_person, additional_remarks, qa_person, qa_done, job_card_sheet_url, certificate_url,
         inspection_clearance_url, in_process_inspection_url)
      VALUES (COALESCE($1,CURRENT_DATE),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    // No natural unique key — not idempotent.
  }));

  // ═══ 7. Resync sequences so live-app-created rows don't collide ═════
  console.log('\n── Resyncing ID sequences ──');
  await resyncSequence('marketing.company_id_seq', 'marketing.companies', 'company_id', 'COMP-');
  await resyncSequence('marketing.enquiry_id_seq', 'marketing.enquiries', 'enquiry_id', 'ENQ-');
  await resyncSequence('design.item_code_seq', 'design.item_codes', 'item_code', 'IC-');
  await resyncSequence('design.boq_id_seq', 'design.bill_of_quantity', 'boq_id', 'BOQ-');
  await resyncSequence('production.dispatch_code_seq', 'production.dispatch_product_code_number', 'dispatch_code', 'DPC-');
  await resyncSequence('purchase.prn_id_seq', 'purchase.purchase_request_notes', 'prn_id', 'PRN-');
  await resyncSequence('purchase.po_no_seq', 'purchase.raw_material_purchase_orders', 'po_no', 'PO-');
  await resyncSequence('production.job_card_number_seq', 'production.job_card_number', 'job_card_number', 'JC-');

  // ═══ Summary ══════════════════════════════════════════════════════════
  console.log('\n═══ MIGRATION SUMMARY ═══');
  let totalErrors = 0;
  results.forEach(r => {
    console.log(`${r.label}: ${r.inserted}/${r.total} inserted, ${r.errors.length} errors`);
    totalErrors += r.errors.length;
  });
  console.log(`\nTotal errors across all tables: ${totalErrors}`);
  if (totalErrors > 0) console.log('Review the error details logged above for each table before considering this migration complete.');

  await pool.end();
}

main().catch(err => { console.error('Migration crashed:', err); process.exit(1); });

// ═══════════════════════════════════════════════════════════════════════
// COVERAGE: all ~31 tables across the 6 workbooks are now migrated above.
//
// IMPORTANT — NOT ALL TABLES ARE SAFE TO RE-RUN. Tables with a real
// unique ID column (Companies, Enquiries, ItemCodes, Projects,
// BillOfQuantity, VendorInformation, VendorPerformance,
// ColdIntroductoryEmailsSent, ProcessedEmails, PurchaseRequestNotes,
// RawMaterialPurchaseOrders, MaterialBufferPercentage, StoreTickets,
// JobCardNumber, MasterInventory, SpareInventory, DispatchProductCodeNumber,
// Users) use ON CONFLICT DO NOTHING and are safe to re-run.
//
// Line-item / log-style tables with NO natural unique key in the
// original sheet (FollowUps, Tasks, PurchaseOrderInformation, OfferSent,
// BOQDrafts, PRNLineItems, RawMaterialPOLineItems, PPSTracking,
// InboundStoreLedger, RejectedMaterialTracking, OutboundStoreLedger,
// StockAssignments, JobCardMaterials, FinishedGoodsInventory) will
// INSERT DUPLICATES if you run this script twice. Each is flagged with
// a comment at its migration above. If you need to re-run after fixing
// an error partway through, TRUNCATE the affected non-idempotent tables
// first, or add a manual dedup pass before re-running.
//
// Two known reconstruction gaps, both flagged inline above where they
// occur: InboundStoreLedger's "Resolves Rejection ID" and
// RejectedMaterialTracking's "Prior Rejection ID" are self/cross-references
// to sheet row IDs that get regenerated as BIGSERIAL here — those specific
// historical links aren't reconstructable from the sheet data alone and
// are left NULL on migrated rows. This only affects historical audit
// trail completeness, not any live functionality going forward.

