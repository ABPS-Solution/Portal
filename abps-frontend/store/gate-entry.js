let targetGateInvoiceFileObj = null;
let targetGateChallanFileObj = null;
let activeParsedGatePayloadCache = null;

function resetGateEntryWorkspaceState() {
  targetGateInvoiceFileObj = null; targetGateChallanFileObj = null; activeParsedGatePayloadCache = null;
  document.getElementById('gate-invoice-file').value = ""; document.getElementById('gate-challan-file').value = "";
  const b1 = document.getElementById('gate-invoice-box'); const b2 = document.getElementById('gate-challan-box');
  if (b1) { b1.textContent = "📷 Select Invoice Image"; b1.classList.remove('done'); }
  if (b2) { b2.textContent = "📷 Select Challan Image"; b2.classList.remove('done'); }
  document.getElementById('gate-ai-verification-workspace').style.display = "none";
  document.getElementById('gate-verification-table-body').innerHTML = "";

  // FIX: metadata fields and the feedback banner survived a prior visit and showed stale
  // vendor/invoice/date/challan values on the next entry — clear them explicitly.
  const metaInvoice  = document.getElementById('gate-meta-invoice');
  const metaChallan  = document.getElementById('gate-meta-challan');
  const metaVendor   = document.getElementById('gate-meta-vendor');
  const metaPO       = document.getElementById('gate-meta-po');
  const metaDate     = document.getElementById('gate-meta-date');
  const metaTime     = document.getElementById('gate-meta-time');
  if (metaInvoice) metaInvoice.value = "";
  if (metaChallan) metaChallan.value = "";
  if (metaVendor)  metaVendor.value  = "";
  if (metaPO)      metaPO.value      = "";
  if (metaDate)    metaDate.value    = "";
  if (metaTime)    metaTime.value    = "";
  const poMsg = document.getElementById('gate-po-check-msg');
  if (poMsg) poMsg.textContent = "";

  const banner = document.getElementById('store-gate-runtime-feedback-banner');
  if (banner) { banner.style.display = "none"; banner.innerHTML = ""; }

  const parseBtn  = document.getElementById('gate-parse-ai-btn');
  const submitBtn = document.getElementById('gate-submit-btn');
  if (parseBtn)  { parseBtn.disabled = false;  parseBtn.textContent = "Process Documents with AI"; }
  if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = "Generate Gate Entry"; }
}

async function parseGateDocumentsWithAI() {
  const btn = document.getElementById('gate-parse-ai-btn');
  if (!targetGateInvoiceFileObj && !targetGateChallanFileObj) return alert("Please select at least one document (Invoice or Challan) before processing.");
  btn.disabled = true; btn.innerHTML = 'AI Processing...';
  try {
    const convertToBase64 = file => new Promise(res => {
      if (!file) return res(null); const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(file);
    });
    const inv64 = targetGateInvoiceFileObj ? await convertToBase64(targetGateInvoiceFileObj) : null;
    const ch64  = targetGateChallanFileObj  ? await convertToBase64(targetGateChallanFileObj)  : null;
    
    const existingMaterialNamesList = (window.itemCodeCatalogCache || []).map(i => i.productName);

    // Use whichever document is available, prefer invoice, fall back to challan.
    // The mimeType sent MUST match whichever file actually ended up as the
    // "invoice" blob — when only a challan was selected, the challan's own
    // file becomes invoiceBase64 (the fallback above), but the mimeType was
    // still hardcoded to "image/jpeg" regardless of the challan's real
    // format, mislabeling e.g. a PNG/HEIC file as JPEG and making Gemini's
    // API reject it outright ("Unable to process input image"). Derive both
    // from whichever File object actually supplied each blob.
    const primaryFile = targetGateInvoiceFileObj || targetGateChallanFileObj;
    const secondaryBase64 = (targetGateInvoiceFileObj && targetGateChallanFileObj) ? ch64 : null;
    const data = await apFetch({
      action: "storeProcessAIInvoiceBlob",
      invoiceBase64: inv64 || ch64,
      invoiceMimeType: primaryFile ? primaryFile.type : "image/jpeg",
      challanBase64: secondaryBase64,
      challanMimeType: targetGateChallanFileObj ? targetGateChallanFileObj.type : "image/jpeg",
      canonicalMaterialsCatalog: existingMaterialNamesList
    });
    if (!data.success) return alert("AI Processing failed: " + data.error);
    activeParsedGatePayloadCache = data.extractedData;

    if (!activeParsedGatePayloadCache || !Array.isArray(activeParsedGatePayloadCache.lineItems)) {
      activeParsedGatePayloadCache = activeParsedGatePayloadCache || {};
      activeParsedGatePayloadCache.lineItems = [];
      alert("AI could not detect any line items on this document. Please try a clearer scan or a different document.");
    }

    document.getElementById('gate-meta-invoice').value = activeParsedGatePayloadCache.invoiceNumber || "";
    document.getElementById('gate-meta-vendor').value = activeParsedGatePayloadCache.vendorName || "";
    document.getElementById('gate-meta-challan').value = activeParsedGatePayloadCache.challanNumber || "";
    document.getElementById('gate-meta-po').value = activeParsedGatePayloadCache.poNumber || "";
    if (activeParsedGatePayloadCache.poNumber) checkGatePONumber();
    checkVendorOpenRejections();

    // Always use today's upload date — not the date on the document
    const rawDateObj      = new Date();
    const formattedDateStr = String(rawDateObj.getDate()).padStart(2,'0') + '/' + String(rawDateObj.getMonth()+1).padStart(2,'0') + '/' + rawDateObj.getFullYear();
    const formattedTimeStr = rawDateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase().replace(/\s+/g, '');

    document.getElementById('gate-meta-date').value = formattedDateStr;
    document.getElementById('gate-meta-time').value = formattedTimeStr;

    const tbody = document.getElementById('gate-verification-table-body'); tbody.innerHTML = "";
    activeParsedGatePayloadCache.lineItems.forEach(item => {
      const hasCode   = (item.itemCode || "").toString().trim().toUpperCase().startsWith("ABPS");
      const codeBorder = hasCode ? "1.5px solid #86efac" : "1.5px solid #fca5a5";
      const codeBg     = hasCode ? "#f0fdf4"             : "#fff7f7";
      const codeColor  = hasCode ? "var(--brand)"        : "#b91c1c";
      tbody.innerHTML += `<tr>
        <td style="width:160px; padding:6px; vertical-align:middle;">
          <input type="text" class="gate-row-item-code-input" value="${item.itemCode || ""}"
            placeholder="Not found" readonly
            style="font-size:0.85rem; padding:5px 4px; font-weight:700; color:${codeColor}; border:${codeBorder}; background:${codeBg}; text-align:center; width:100%; border-radius:3px; cursor:not-allowed;">
        </td>
        <td style="padding:8px; font-size:0.82rem; color:#64748b; white-space:normal; word-wrap:break-word; overflow-wrap:break-word; min-width:400px;">${item.rawDescriptionLine || item.materialName || "Line Item Description"}</td>
        <td style="width:90px; padding:6px; vertical-align:middle;">
          <input type="text" class="gate-row-unit-input" value="${item.unitType || 'NOS'}"
            style="font-size:0.85rem; padding:5px 4px; font-weight:700; text-align:center; width:100%; border:1.5px solid var(--border); border-radius:3px;">
        </td>
        <td style="text-align:center; color:#64748b; font-weight:700; vertical-align:middle; width:140px;">${item.gateQuantity ?? "—"}</td>
      </tr>`;
    });
    document.getElementById('gate-ai-verification-workspace').style.display = "block";
  } catch(e) { 
    alert("AI extraction pipeline failed: " + e.message); 
  } finally { 
    btn.disabled = false; btn.textContent = "Process Documents with AI"; 
  }
}

async function commitGateEntryRecordsToBackend() {
  const btn = document.getElementById('gate-submit-btn');
  const banner = document.getElementById('store-gate-runtime-feedback-banner');
  const uploadWrapperBlock = document.getElementById('gate-upload-fields-wrapper-group');
  
  if (!activeParsedGatePayloadCache || !activeParsedGatePayloadCache.lineItems) return alert("Process data missing.");

  if (!document.getElementById('gate-meta-vendor').value.trim()) return alert("Vendor Name is compulsory.");
  if (!document.getElementById('gate-meta-invoice').value.trim()) return alert("Invoice Number is compulsory.");

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Generating Gate Entry...';
  showBlockingOverlay("Saving Gate Entry...");
  
  const codeInputs = document.querySelectorAll('.gate-row-item-code-input');
  const unitInputs = document.querySelectorAll('.gate-row-unit-input');
  const tableRows = document.querySelectorAll('#gate-verification-table-body tr');

  activeParsedGatePayloadCache.lineItems.forEach((item, idx) => {
    item.itemCode = codeInputs[idx] ? codeInputs[idx].value.trim() : "";
    // Invoice Unit — editable here so the operator can correct whatever
    // the AI read off the document before it ever reaches Store Entry.
    item.unitType = unitInputs[idx] ? (unitInputs[idx].value.trim() || 'NOS') : (item.unitType || 'NOS');
    if (!item.rawDescriptionLine && tableRows[idx]) {
      item.rawDescriptionLine = tableRows[idx].cells[1].textContent.trim();
    }
  });
  
  try {
    // Convert gate files to base64 for Drive storage
    const convertToBase64 = file => new Promise(resolve => {
      if (!file) { resolve(""); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.readAsDataURL(file);
    });
    const [invoiceBase64, challanBase64] = await Promise.all([
      convertToBase64(targetGateInvoiceFileObj),
      convertToBase64(targetGateChallanFileObj)
    ]);

    // Local cleanup — no API call needed for short fields
    const rawVendor  = document.getElementById('gate-meta-vendor').value.trim();
    const rawInvoice = document.getElementById('gate-meta-invoice').value.trim();
    const rawChallan = document.getElementById('gate-meta-challan').value.trim();
    const rawPO      = document.getElementById('gate-meta-po').value.trim();
    const cleanVendorName    = rawVendor.replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const cleanInvoiceNumber = rawInvoice.replace(/\s+/g, '').toUpperCase();
    const cleanChallanNumber = rawChallan.replace(/\s+/g, '').toUpperCase();
    const cleanPONumber      = rawPO.replace(/\s+/g, '');

    const combinedTimestampString = document.getElementById('gate-meta-date').value.trim() + " " + document.getElementById('gate-meta-time').value.trim();
    const payload = {
      action: "commitGateEntryPipelineStep", activeEngineer: appActiveOperatorIdentityString,
      metadata: {
        invoiceNumber: cleanInvoiceNumber,
        challanNumber: cleanChallanNumber,
        poNo: cleanPONumber || null,
        invoiceDate: combinedTimestampString,
        vendorName: cleanVendorName,
        invoiceImageBase64Raw: invoiceBase64,
        challanImageBase64Raw: challanBase64
      },
      lineItems: activeParsedGatePayloadCache.lineItems
    };
    const data = await apFetch(payload);
    hideBlockingOverlay();
    if (data.success) {
      if (uploadWrapperBlock) uploadWrapperBlock.style.display = "none";
      document.getElementById('gate-ai-verification-workspace').style.display = "none";
      
      banner.style.cssText = "display: block; background: #dcfce7; border-left: 4px solid #15803d; color: #15803d; padding: 20px; border-radius: var(--radius);";
      banner.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; text-align:left;">
          <div>
            <strong>Success! Gate Entry Generated.</strong><br/>
            <span>Assigned Reference Code: <strong style="font-family:monospace; font-size:1.05rem; color:#111827;">${data.gateNumber}</strong></span>
          </div>
          <button class="nav-btn-styled" onclick="
            document.getElementById('store-gate-runtime-feedback-banner').style.display = 'none';
            document.getElementById('gate-upload-fields-wrapper-group').style.display = 'block';
            resetGateEntryWorkspaceState();
          " style="background:#15803d; color:white; padding:8px 16px; font-weight:700;">+ Create New Entry</button>
        </div>`;
    } else {
      alert("Submission Error: " + data.error);
      btn.disabled = false; btn.textContent = "Generate Gate Entry";
    }
  } catch(e) { hideBlockingOverlay(); alert(e.message); btn.disabled = false; btn.textContent = "Generate Gate Entry"; }
}

window.activeGateRejectionLinks = {}; // rejectionId -> { linkedQty, itemCode, materialName, unitType }

async function checkGatePONumber() {
  const input = document.getElementById('gate-meta-po');
  const msg = document.getElementById('gate-po-check-msg');
  const po = input.value.trim();
  if (!po) { msg.textContent = ""; return; }
  try {
    const data = await apFetch({ action: "validateGatePONumber", poNo: po });
    if (!(data.success && data.found)) {
      msg.style.color = "#b91c1c";
      msg.textContent = "No authorized PO Number found";
    }
  } catch(e) { msg.textContent = ""; }
}

async function checkStoreEntryPONumber(gateNum) {
  const input = document.getElementById(`se-po-number-${gateNum}`);
  const msg = document.getElementById(`se-po-check-msg-${gateNum}`);
  if (!input || !msg) return;
  const po = input.value.trim();
  if (!po) { msg.textContent = ""; input.style.borderColor = "#fca5a5"; return; }
  try {
    const data = await apFetch({ action: "validateGatePONumber", poNo: po });
    if (!(data.success && data.found)) {
      input.style.borderColor = "#fca5a5";
      msg.style.color = "#b91c1c";
      msg.textContent = "No authorized PO Number found";
    }
  } catch(e) { msg.textContent = ""; }
}

