// Invoice/Challan each now hold an ARRAY of files, not one — a real vendor
// invoice is routinely 2-3 pages and can't be captured in a single phone
// photo. Multiple selected IMAGES are combined into one tall stacked image
// client-side (combineGateImagesToSingleBase64 below) before either the AI
// step or the final submit — this needed zero backend/schema changes,
// since store.inbound_store_ledger.drive_image_url has always stored
// exactly one URL per document type. A single PDF is passed through
// unchanged (a PDF can already hold multiple pages on its own); mixing a
// PDF with anything else, or selecting more than one PDF, isn't supported
// (combining PDFs into one client-side needs a heavy PDF library this app
// doesn't carry) — combineGateImagesToSingleBase64 rejects that combination
// with a clear alert rather than silently dropping pages.
let targetGateInvoiceFiles = [];
let targetGateChallanFiles = [];
let activeParsedGatePayloadCache = null;

// Stacks one or more image Files vertically onto a single canvas and
// returns { base64, mimeType } — or, for a lone PDF, reads it through
// unchanged. Returns null for an empty list.
function combineGateImagesToSingleBase64(files) {
  return new Promise((resolve, reject) => {
    if (!files || files.length === 0) { resolve(null); return; }

    const hasPdf = files.some(f => f.type === 'application/pdf');
    if (hasPdf) {
      if (files.length > 1) {
        reject(new Error('A PDF can\'t be combined with other files — select either one PDF, or one/more images, not both.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ base64: reader.result.split(',')[1], mimeType: 'application/pdf' });
      reader.onerror = reject;
      reader.readAsDataURL(files[0]);
      return;
    }

    const loadImage = file => new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = e.target.result;
      };
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

    Promise.all(files.map(loadImage)).then(images => {
      // A phone camera photo is routinely 3000-4000px wide and several MB —
      // stacking 2-3 of those at full resolution produced a base64 payload
      // well over the backend's 20MB request body limit ("request entity
      // too large", a real reported failure on a genuine 3-page invoice).
      // MAX_PAGE_WIDTH caps every page down to a size still perfectly
      // readable for OCR/Gemini extraction before stacking; encodeUnderCap
      // then re-encodes at progressively lower JPEG quality (and, as a last
      // resort, shrinks further) until the result comfortably clears the
      // limit, so this can't fail again regardless of how many pages or
      // how high-res the source photos are.
      const MAX_PAGE_WIDTH = 1600;
      const scaleImage = img => {
        const scale = Math.min(1, MAX_PAGE_WIDTH / img.naturalWidth);
        return { img, width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) };
      };
      const scaled = images.map(scaleImage);

      let canvas, drawFn;
      if (scaled.length === 1) {
        canvas = document.createElement('canvas');
        canvas.width = scaled[0].width; canvas.height = scaled[0].height;
        drawFn = ctx => ctx.drawImage(scaled[0].img, 0, 0, scaled[0].width, scaled[0].height);
      } else {
        // Scale every page to a common width (the widest one, already capped
        // above) so a page shot in portrait next to one shot in landscape
        // still lines up cleanly, then stack top to bottom with a thin
        // white gap between pages.
        const gap = 14;
        const targetWidth = Math.max(...scaled.map(s => s.width));
        const heights = scaled.map(s => Math.round(s.height * (targetWidth / s.width)));
        const totalHeight = heights.reduce((a, b) => a + b, 0) + gap * (scaled.length - 1);
        canvas = document.createElement('canvas');
        canvas.width = targetWidth; canvas.height = totalHeight;
        drawFn = ctx => {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, targetWidth, totalHeight);
          let y = 0;
          scaled.forEach((s, i) => {
            ctx.drawImage(s.img, 0, y, targetWidth, heights[i]);
            y += heights[i] + gap;
          });
        };
      }
      const ctx = canvas.getContext('2d');
      drawFn(ctx);

      // A single Gate Entry request can carry BOTH the Invoice's and the
      // Challan's combined image at once (commitGateEntryPipelineStep), so
      // this per-document cap has to leave room for two of these plus the
      // line-items JSON in the SAME body — not just clear the limit on its
      // own. 4MB each keeps two documents comfortably under even the
      // tighter of this app's two backends (ERP's /exec body limit is
      // 10MB; Portal's is 20MB). Quality steps down first (cheaper, keeps
      // full page count on screen); if still over the cap even at the
      // lowest quality, the canvas itself is shrunk further and re-drawn.
      const MAX_BASE64_CHARS = 4 * 1024 * 1024;
      const qualitySteps = [0.85, 0.7, 0.55, 0.4];
      let base64 = null;
      for (const q of qualitySteps) {
        base64 = canvas.toDataURL('image/jpeg', q).split(',')[1];
        if (base64.length <= MAX_BASE64_CHARS) break;
      }
      let shrinkFactor = 1;
      while (base64.length > MAX_BASE64_CHARS && shrinkFactor > 0.25) {
        shrinkFactor *= 0.75;
        const shrunk = document.createElement('canvas');
        shrunk.width = Math.max(1, Math.round(canvas.width * shrinkFactor));
        shrunk.height = Math.max(1, Math.round(canvas.height * shrinkFactor));
        shrunk.getContext('2d').drawImage(canvas, 0, 0, shrunk.width, shrunk.height);
        base64 = shrunk.toDataURL('image/jpeg', 0.6).split(',')[1];
      }

      resolve({ base64, mimeType: 'image/jpeg' });
    }).catch(reject);
  });
}

function resetGateEntryWorkspaceState() {
  targetGateInvoiceFiles = []; targetGateChallanFiles = []; activeParsedGatePayloadCache = null;
  document.getElementById('gate-invoice-file').value = ""; document.getElementById('gate-challan-file').value = "";
  renderGateFileList('gate-invoice-box'); renderGateFileList('gate-challan-box');
  if (typeof updateGateRequiredMarkers === 'function') updateGateRequiredMarkers();
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
  if (targetGateInvoiceFiles.length === 0 && targetGateChallanFiles.length === 0) return alert("Please select at least one document (Invoice or Challan) before processing.");
  btn.disabled = true; btn.innerHTML = 'AI Processing...';
  try {
    let invoiceCombined, challanCombined;
    try {
      [invoiceCombined, challanCombined] = await Promise.all([
        combineGateImagesToSingleBase64(targetGateInvoiceFiles),
        combineGateImagesToSingleBase64(targetGateChallanFiles)
      ]);
    } catch (combineErr) {
      alert(combineErr.message);
      return;
    }

    const existingMaterialNamesList = (window.itemCodeCatalogCache || []).map(i => i.productName);

    // Use whichever document is available, prefer invoice, fall back to challan.
    // The mimeType sent MUST match whichever combined blob actually ended up
    // as the "invoice" one — when only a challan was selected, the challan's
    // own combined image becomes invoiceBase64 (the fallback below), so its
    // real mimeType has to travel with it or Gemini's API rejects a
    // mislabeled image outright ("Unable to process input image").
    const primary = invoiceCombined || challanCombined;
    const secondary = (invoiceCombined && challanCombined) ? challanCombined : null;
    const data = await apFetch({
      action: "storeProcessAIInvoiceBlob",
      invoiceBase64: primary ? primary.base64 : null,
      invoiceMimeType: primary ? primary.mimeType : "image/jpeg",
      challanBase64: secondary ? secondary.base64 : null,
      challanMimeType: secondary ? secondary.mimeType : "image/jpeg",
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

    // Always use today's upload date — not the date on the document.
    // Display-only: this field's value (combined with the time field at
    // submit into invoiceDate) is never actually read by
    // commitGateEntryPipelineStep server-side — the real recorded
    // timestamp is the ledger row's own DB-default `ts` column — so
    // reformatting it here is safe.
    const rawDateObj      = new Date();
    const formattedDateStr = formatOrdinalDate(rawDateObj);
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
        <td style="padding:8px; font-size:0.95rem; color:#000; white-space:normal; word-wrap:break-word; overflow-wrap:break-word; min-width:400px;">${item.rawDescriptionLine || item.materialName || "Line Item Description"}</td>
        <td style="width:90px; padding:6px; vertical-align:middle;">
          <input type="text" class="gate-row-unit-input" value="${item.unitType || 'NOS'}"
            readonly
            style="font-size:0.85rem; padding:5px 4px; font-weight:700; text-align:center; width:100%; border:1.5px solid var(--border); border-radius:3px; background:#f1f5f9; cursor:not-allowed;">
        </td>
        <td style="width:140px; padding:6px; vertical-align:middle;">
          <input type="number" class="gate-row-qty-input" value="${item.gateQuantity ?? ''}" step="any" min="0"
            style="font-size:1.05rem; padding:5px 4px; font-weight:700; color:#000; text-align:center; width:100%; border:1.5px solid var(--border); border-radius:3px;">
        </td>
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
  // Which number is required tracks which document was actually uploaded —
  // Invoice Number only matters if an Invoice was attached, Challan Number
  // only if a Challan was attached, and both if both were. Previously
  // Invoice Number was unconditionally required even for a challan-only
  // Gate Entry, which had no invoice number to give.
  if (targetGateInvoiceFiles.length > 0 && !document.getElementById('gate-meta-invoice').value.trim()) return alert("Invoice Number is compulsory.");
  if (targetGateChallanFiles.length > 0 && !document.getElementById('gate-meta-challan').value.trim()) return alert("Challan Number is compulsory.");

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Generating Gate Entry...';
  showBlockingOverlay("Saving Gate Entry...");
  
  const codeInputs = document.querySelectorAll('.gate-row-item-code-input');
  const unitInputs = document.querySelectorAll('.gate-row-unit-input');
  const qtyInputs  = document.querySelectorAll('.gate-row-qty-input');
  const tableRows = document.querySelectorAll('#gate-verification-table-body tr');

  activeParsedGatePayloadCache.lineItems.forEach((item, idx) => {
    item.itemCode = codeInputs[idx] ? codeInputs[idx].value.trim() : "";
    // Invoice Unit is read-only here (not operator-editable) — this just
    // reads back whatever the AI extraction/default already set.
    item.unitType = unitInputs[idx] ? (unitInputs[idx].value.trim() || 'NOS') : (item.unitType || 'NOS');
    // Invoice Qty is editable — a vendor sometimes combines a previous
    // PO's missing/shortfall units with a new PO's delivery in one
    // document; splitting that into two Gate Entries against the same
    // document (adjusting Qty and Default PO on each) is simpler than
    // splitting one line across multiple POs, so the operator needs to
    // be able to correct the AI-read quantity down to just the portion
    // this particular Gate Entry is actually for.
    item.gateQuantity = qtyInputs[idx] && qtyInputs[idx].value !== '' ? Number(qtyInputs[idx].value) : item.gateQuantity;
    if (!item.rawDescriptionLine && tableRows[idx]) {
      item.rawDescriptionLine = tableRows[idx].cells[1].textContent.trim();
    }
  });
  
  let invoiceCombined, challanCombined;
  try {
    // Combine each document type's selected pages into one image (or pass a
    // lone PDF through) for Drive storage — same combiner used at the AI
    // step, run again here since the operator may have added/removed pages
    // after that step ran.
    [invoiceCombined, challanCombined] = await Promise.all([
      combineGateImagesToSingleBase64(targetGateInvoiceFiles),
      combineGateImagesToSingleBase64(targetGateChallanFiles)
    ]);
  } catch (combineErr) {
    hideBlockingOverlay();
    alert(combineErr.message);
    btn.disabled = false; btn.textContent = "Generate Gate Entry";
    return;
  }
  const invoiceBase64 = invoiceCombined ? invoiceCombined.base64 : "";
  const challanBase64 = challanCombined ? challanCombined.base64 : "";

  try {

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
    if (input.value.trim() !== po) return; // a newer keystroke's check owns the message
    if (!(data.success && data.found)) {
      msg.style.color = "#b91c1c";
      msg.textContent = "No authorized PO Number found";
    } else {
      msg.textContent = "";
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
    if (input.value.trim() !== po) return; // a newer keystroke's check owns the message
    if (!(data.success && data.found)) {
      input.style.borderColor = "#fca5a5";
      msg.style.color = "#b91c1c";
      msg.textContent = "No authorized PO Number found";
    } else {
      // Valid again (24 Sep 2026 fix): the error used to stay up forever
      // once shown, even after the number was corrected.
      input.style.borderColor = "var(--border)";
      msg.textContent = "";
    }
  } catch(e) { msg.textContent = ""; }
}

