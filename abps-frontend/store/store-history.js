let masterStoreTicketsHistoryCacheCollection = [];
/**
 * INITIALIZE MATRIX DATABASE SEARCH LOOKUP
 * Dynamic array synchronization pulling codes and building option pill rows inside view templates
 */
async function initializeStoreHistoryMatrixWorkspace() {
  const resultsFeedZone = document.getElementById("store-historical-matrix-results-feed");
  const projectsMount = document.getElementById("matrix-search-projects-checkbox-mount");

  // Full reset — leaving and re-entering this screen should look exactly
  // like a first-time visit, not carry over the previous search.
  document.querySelectorAll('input[name="matrixStoreFilter"]:checked, input[name="matrixStatusFilter"]:checked, input[name="matrixDepartmentFilter"]:checked').forEach(cb => cb.checked = false);
  const matInput = document.getElementById("matrix-material-name-search-input");
  const projInput = document.getElementById("matrix-project-search-input");
  if (matInput) matInput.value = "";
  if (projInput) projInput.value = "";
  matrixActiveMaterialSearchQuery = "";
  matrixActiveProjectSearchQuery = "";
  matrixActiveMaterialSearchDisplay = "";
  matrixActiveProjectSearchDisplay = "";
  const matClear = document.getElementById("matrix-material-search-clear-btn");
  const projClear = document.getElementById("matrix-project-search-clear-btn");
  if (matClear) matClear.style.display = "none";
  if (projClear) projClear.style.display = "none";
  const summaryEl = document.getElementById("matrix-search-summary-text");
  if (summaryEl) { summaryEl.style.display = "none"; summaryEl.innerHTML = ""; }

  if (resultsFeedZone) resultsFeedZone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Loading...</div>`;

  try {
    const [ticketsData, projectsData] = await Promise.all([
      apFetch({ action: "fetchAllHistoricalStoreTicketsStream" }),
      apFetch({ action: "pullLiveActiveProjectCodes" })
    ]);

    if (!ticketsData.success || !projectsData.success) {
      if (resultsFeedZone) resultsFeedZone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn);">Verification Failure: Sync dropped from database workbook targets.</div>`;
      return;
    }

    masterStoreTicketsHistoryCacheCollection = ticketsData.tickets;
    window.matrixKnownProjectCodes = (projectsData.projects || []).map(c => c.toString().trim());
    loadItemCodeCatalogIntoCache();

    if (resultsFeedZone) resultsFeedZone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted);">Set your filters above and click Search.</div>`;

  } catch (error) {
    if (resultsFeedZone) resultsFeedZone.innerHTML = `<div style="text-align:center; padding:20px; color:var(--warn);">Network Exception: ${error.message}</div>`;
  }
}

