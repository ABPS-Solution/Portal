// ═══════════════════════════════════════════════════════════════════════
// lib/permMap.js — translates admin_db.users' perm_* columns into the
// exact camelCase keys index.html actually checks (userPermissions.cardDetails,
// userPermissionsObject.createBOQ, etc. — found by grepping
// enforceDynamicModuleRoleGateways() and the menuPermissions array).
//
// This mismatch was the root cause of the "blank dashboard, no errors"
// bug: the backend was sending raw column names (perm_card_details) but
// every frontend permission check looks for a differently-named camelCase
// key (cardDetails) — so every check silently evaluated false, no menu
// cards rendered, and nothing threw an error because `undefined === true`
// is just `false`, not an exception.
//
// ONE KNOWN APPROXIMATION, flagged honestly: the frontend expects THREE
// separate permissions — dispatchBill, commissioningReport, purchaseOrder
// — but the schema only has ONE combined column,
// perm_dispatch_or_commission_or_po (collapsed early in the schema design
// pass). All three frontend keys currently map to that same single column,
// so a user with this permission sees all three upload cards together,
// not independently controllable. Splitting this into 3 real columns is
// a legitimate follow-up if you need them controlled separately.
// ═══════════════════════════════════════════════════════════════════════
function mapPermissionsForFrontend(dbUser) {
  return {
    cardDetails: !!dbUser.perm_card_details,
    emailLeads: !!dbUser.perm_email_leads,
    dispatchBill: !!dbUser.perm_dispatch_bill,
    commissioningReport: !!dbUser.perm_commissioning_report,
    purchaseOrder: !!dbUser.perm_purchase_order,
    searchCompany: !!dbUser.perm_search_company,
    searchTasks: !!dbUser.perm_search_tasks,
    searchStatus: !!dbUser.perm_search_status,
    searchQualification: !!dbUser.perm_search_qualification,
    searchCityState: !!dbUser.perm_search_city_state,

    liveStoreStock: !!dbUser.perm_live_rm_stock,
    storeUploadInvoice: !!dbUser.perm_gate_entry,
    storeCreateTicket: !!dbUser.perm_create_store_ticket,
    storeApproveTickets: !!dbUser.perm_approve_store_tickets,
    storeAdminMatrix: !!dbUser.perm_search_store_tickets,

    addFinishedGoodsStore: !!dbUser.perm_add_finished_goods_store,
    createBOQ: !!dbUser.perm_create_boq,
    authorizeBOQ: !!dbUser.perm_authorize_boq,
    updateBOQ: !!dbUser.perm_update_boq,
    authorizeBOQUpdate: !!dbUser.perm_authorize_boq_update,
    liveFinishedGoodsStoreStock: !!dbUser.perm_live_fg_stock,
    uploadBOQ: !!dbUser.perm_create_boq,
    uploadDrawings: !!dbUser.perm_upload_drawings,
    purchaseRequestNote: !!dbUser.perm_purchase_request_note,
    authorizePRN: !!dbUser.perm_authorize_prn,
    materialListForPurchase: !!dbUser.perm_material_list_purchase,
    createJobCardNumber: !!dbUser.perm_create_boq,
    reserveStoreStock: !!dbUser.perm_reserve_store_stock,
    expectedDeliveries: !!dbUser.perm_expected_deliveries,
    manufacturingClearance: !!dbUser.perm_manufacturing_clearance,
    projectStatus: !!dbUser.perm_project_status,
    projectInvoiceGeneration: !!dbUser.perm_project_invoice_generation,
    rejectedMaterial: !!dbUser.perm_store_inward_rejected,
    createRMPurchaseOrder: !!dbUser.perm_create_rm_po,
    authorizeRMPurchaseOrder: !!dbUser.perm_authorize_rm_po,
    searchRMPO: !!dbUser.perm_search_rm_po,
    ppsTracking: !!dbUser.perm_pps_tracking,
    authorizePRN: !!dbUser.perm_authorize_prn,
    revisePRN: !!dbUser.perm_revise_prn,
    authorizePRNRevision: !!dbUser.perm_authorize_prn_revision,
    reviseRMPO: !!dbUser.perm_revise_rm_po,
    authorizeRMPORevision: !!dbUser.perm_authorize_rm_po_revision,

    gateEntry: !!dbUser.perm_gate_entry,
    storeEntryAndGrn: !!dbUser.perm_store_entry_and_grn,
    qaCheck: !!dbUser.perm_qa_check,
    approveJCIncrease: !!dbUser.perm_approve_job_card_increase,
    itemCodeAccess: !!dbUser.perm_item_code_access,
    liveSpareStoreStock: !!dbUser.perm_live_spare_stock,

    viewDesignDashboard: !!dbUser.perm_design_dashboard,
    viewPurchaseDashboard: !!dbUser.perm_purchase_dashboard,
    viewStoreDashboard: !!dbUser.perm_store_dashboard,
    viewProductionDashboard: !!dbUser.perm_production_dashboard,
    viewMarketingDashboard: !!dbUser.perm_marketing_dashboard,

    jobCardLetterhead: !!dbUser.perm_job_card_letterhead,
    tourExpense: !!dbUser.perm_tour_expense,

    admin: !!dbUser.perm_admin,
  };
}

module.exports = { mapPermissionsForFrontend };
