function initializeStockSweepPanel() {
  sweepBasket = [];
  document.getElementById("sweep-feedback").style.display = "none";
  document.getElementById("sweep-material-search").value = "";
  document.getElementById("sweep-material-dropdown").style.display = "none";
  const st = document.getElementById("sweep-type");
  if (st) st.value = "Production Return";
  renderSweepBasket();
}

function handleSweepTypeChange() {
  const type = document.getElementById("sweep-type").value;
  const isBlockedExit = type === "Blocked → Restricted" || type === "Blocked → RM Store";
  document.getElementById("sweep-material-search-wrapper").style.display = isBlockedExit ? "none" : "block";
  document.getElementById("sweep-allocation-picker-wrapper").style.display = isBlockedExit ? "block" : "none";
  if (isBlockedExit) loadUnfreedBlockedAllocations();
}

async function loadUnfreedBlockedAllocations() {
  const sel = document.getElementById("sweep-allocation-select");
  sel.innerHTML = '<option value="">Loading...</option>';
  try {
    const data = await apFetch({ action: "fetchUnfreedSpareBlockedAllocations" });
    sweepBlockedAllocationsCache = (data.success && data.allocations) ? data.allocations : [];
    if (sweepBlockedAllocationsCache.length === 0) {
      sel.innerHTML = '<option value="">No unfreed Blocked allocations</option>';
      return;
    }
    sel.innerHTML = '<option value="">— Choose an unfreed Blocked allocation —</option>' +
      sweepBlockedAllocationsCache.map(a =>
        `<option value="${a.allocationId}">${a.materialName} (${a.itemCode}) — ${fmtQty(a.quantity)} — JC: ${a.jobCardNumber}</option>`
      ).join("");
  } catch (e) {
    sel.innerHTML = '<option value="">Error loading allocations</option>';
  }
}

function handleSweepAllocationPick(sel) {
  const allocationId = sel.value;
  if (!allocationId) return;
  const alloc = sweepBlockedAllocationsCache.find(a => String(a.allocationId) === String(allocationId));
  if (!alloc) return;
  sel.value = "";
  if (sweepBasket.some(b => b.allocationId === alloc.allocationId)) { alert("This allocation is already in the sweep list."); return; }
  sweepBasket.push({
    allocationId: alloc.allocationId, itemCode: alloc.itemCode, materialName: alloc.materialName,
    unitType: "", quantity: alloc.quantity, jobCardNumber: alloc.jobCardNumber, isBlockedExit: true,
  });
  renderSweepBasket();
}

function handleSweepSearch(query) {
  const dropdown = document.getElementById("sweep-material-dropdown");
  if (!query || query.trim().length < 1) { dropdown.style.display = "none"; return; }
  const catalog = window.itemCodeCatalogCache || [];
  const q = query.toLowerCase();
  const matches = catalog.filter(item => {
    const name = (item.productName || "").toLowerCase();
    const rating = (item.rating || "").toLowerCase();
    const combined = `${name} ${rating}`.trim();
    return name.includes(q) || rating.includes(q) || combined.includes(q);
  }).slice(0, 10);
  if (matches.length === 0) { dropdown.style.display = "none"; return; }
  dropdown.innerHTML = matches.map(item => `
    <div onclick="addToSweepBasket('${item.itemCode}', \`${item.productName.replace(/`/g,"'")}\`, \`${(item.rating||'').replace(/`/g,"'")}\`, '${(item.unitType||'NOS').replace(/'/g,"")}')"
      style="padding:8px 12px; cursor:pointer; border-bottom:1px solid #f1f5f9;"
      onmouseover="this.style.background='var(--highlight-bg)'" onmouseout="this.style.background='#fff'">
      <span style="font-family:monospace; color:var(--brand); font-weight:700; margin-right:8px;">${item.itemCode}</span>${item.productName}${item.rating ? ` <span style="color:var(--brand); font-weight:700;">${item.rating}</span>` : ""}
    </div>`).join("");
  dropdown.style.display = "block";
}

function addToSweepBasket(itemCode, materialName, rating, unitType) {
  document.getElementById("sweep-material-search").value = "";
  document.getElementById("sweep-material-dropdown").style.display = "none";
  if (sweepBasket.some(b => b.itemCode === itemCode)) { alert("This item is already in the sweep list — edit its quantity below instead."); return; }
  sweepBasket.push({ itemCode, materialName, rating: rating || "", unitType: unitType || "NOS", quantity: "", isBlockedExit: false });
  renderSweepBasket();
}

function removeFromSweepBasket(itemCode) {
  sweepBasket = sweepBasket.filter(b => b.itemCode !== itemCode);
  renderSweepBasket();
}

function updateSweepBasketField(itemCode, field, value) {
  const row = sweepBasket.find(b => b.itemCode === itemCode);
  if (row) row[field] = value;
  updateSweepSubmitState();
}

function renderSweepBasket() {
  const body = document.getElementById("sweep-basket-body");
  if (sweepBasket.length === 0) {
    body.innerHTML = '<tr id="sweep-basket-empty"><td colspan="5" style="padding:14px; text-align:center; color:var(--muted);">No items added yet.</td></tr>';
  } else {
    body.innerHTML = sweepBasket.map(b => b.isBlockedExit ? `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-family:monospace;">${b.itemCode}</td>
        <td style="padding:8px;">${b.materialName} <span style="color:var(--muted); font-size:0.78rem;">(from JC: ${b.jobCardNumber})</span></td>
        <td style="padding:8px; font-family:monospace; color:var(--muted);">—</td>
        <td style="padding:8px; font-family:monospace; font-weight:700;">${fmtQty(b.quantity)}</td>
        <td style="padding:8px;"><button onclick="removeFromSweepBasketByAllocation(${b.allocationId})" style="background:none; border:none; color:#c0435a; cursor:pointer; font-size:1rem;">✕</button></td>
      </tr>` : `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-family:monospace;">${b.itemCode}</td>
        <td style="padding:8px;">${b.materialName}${b.rating ? ` <span style="color:var(--brand); font-weight:700;">${b.rating}</span>` : ""}</td>
        <td style="padding:8px; font-family:monospace; color:var(--muted);">${b.unitType || "NOS"}</td>
        <td style="padding:8px;"><input type="number" min="0.01" step="any" required value="${b.quantity}" oninput="updateSweepBasketField('${b.itemCode}','quantity',this.value)" style="width:90px; padding:5px; border:1px solid var(--border); border-radius:4px;"></td>
        <td style="padding:8px;"><button onclick="removeFromSweepBasket('${b.itemCode}')" style="background:none; border:none; color:#c0435a; cursor:pointer; font-size:1rem;">✕</button></td>
      </tr>`).join("");
  }
  updateSweepSubmitState();
}

function removeFromSweepBasketByAllocation(allocationId) {
  sweepBasket = sweepBasket.filter(b => b.allocationId !== allocationId);
  renderSweepBasket();
}

// Submit stays enabled with blank quantities so the inline banner can
// name the offending rows, rather than a silently dead button.
function updateSweepSubmitState() {
  document.getElementById("sweep-submit-btn").disabled = sweepBasket.length === 0;
}

async function submitStockSweep() {
  const missing = sweepBasket.filter(b => !b.isBlockedExit && !(parseFloat(b.quantity) > 0));
  if (missing.length > 0) {
    showBOQBanner("sweep-feedback",
      `<strong>Quantity Required:</strong> Enter a quantity greater than 0 for: ${missing.map(m => m.itemCode).join(", ")}.`,
      "error");
    document.getElementById("sweep-feedback").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  document.getElementById("sweep-feedback").style.display = "none";
  showBlockingOverlay("Recording Stock Sweep...");
  try {
    const data = await apFetch({
      action: "commitStockSweep",
      operatorName: appActiveOperatorIdentityString,
      sweepItems: sweepBasket.map(b => b.isBlockedExit ? {
        allocationId: b.allocationId, itemCode: b.itemCode, sweepType: document.getElementById("sweep-type").value,
      } : {
        itemCode: b.itemCode,
        quantity: parseFloat(b.quantity),
        sweepType: document.getElementById("sweep-type").value,
      })
    });
    if (data.success) {
      let msg = `Sweep recorded: ${data.itemsProcessed} item(s) added and auto-distributed to BOQs.`;
      if (data.notFound && data.notFound.length) msg += ` NOT found in catalog (skipped): ${data.notFound.join(", ")}.`;
      sweepBasket = [];
      renderSweepBasket();
      const docLinks = data.pdfUrl ? [{ url: driveLink(data.pdfUrl), label: "Download Stock Sweep Record PDF" }] : [];
      showSuccessWithReset("sweep-feedback", msg, "Record Another Sweep", "initializeStockSweepPanel()", docLinks);
    } else {
      showBOQBanner("sweep-feedback", data.error || "Failed to record sweep.", "error");
    }
  } catch(e) {
    showBOQBanner("sweep-feedback", "Network error: " + e.message, "error");
  } finally {
    hideBlockingOverlay();
  }
}

