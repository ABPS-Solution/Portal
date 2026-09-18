let uploadDrawingsSelectedFile = null;
let uploadDrawingsSelectedType = null;
const UPLOAD_DRAWINGS_TYPES = ['Customer Approved', 'Working Drawing'];

async function initializeUploadDrawingsPanel() {
  const projDrop   = document.getElementById("upload-drawings-project-ta-input");
  document.getElementById("upload-drawings-type-zone").style.display = "none";
  document.getElementById("upload-drawings-existing-list").style.display = "none";
  document.getElementById("upload-drawings-upload-zone").style.display = "none";
  document.getElementById("upload-drawings-feedback").style.display = "none";
  uploadDrawingsSelectedType = null;

  try {
    const data = await fetchWithStaleCache({ action:"pullLiveActiveProjectCodes", statusFilter: "Active" });
    window.sharedActiveProjectCodes = data.projects || [];
    window.sharedProjectMeta = data.projectMeta || {};
  } catch(e) {
    projDrop.placeholder = "Error loading projects";
  }
}

async function handleUploadDrawingsStatusChange(selectedStatus) {
  const projDrop = document.getElementById("upload-drawings-project-ta-input");
  const typeZone = document.getElementById("upload-drawings-type-zone");
  const listZone = document.getElementById("upload-drawings-existing-list");
  const uploadZone = document.getElementById("upload-drawings-upload-zone");

  projDrop.value = "";
  typeZone.style.display = "none";
  listZone.style.display = "none";
  uploadZone.style.display = "none";
  uploadDrawingsSelectedType = null;

  try {
    const data = await fetchWithStaleCache({ action:"pullLiveActiveProjectCodes", statusFilter: selectedStatus });
    window.sharedActiveProjectCodes = data.projects || [];
    window.sharedProjectMeta = data.projectMeta || {};
    projDrop.placeholder = (data.projects || []).length === 0 ? `No projects with status: ${selectedStatus}` : "Type Project ID or Customer Name...";
  } catch(e) {
    projDrop.placeholder = "Error loading projects";
  }
}

function handleUploadDrawingsProjectChange(projectId) {
  const typeZone = document.getElementById("upload-drawings-type-zone");
  const listZone = document.getElementById("upload-drawings-existing-list");
  const uploadZone = document.getElementById("upload-drawings-upload-zone");

  if (!projectId) {
    typeZone.style.display = "none";
    listZone.style.display = "none";
    uploadZone.style.display = "none";
    uploadDrawingsSelectedType = null;
    return;
  }

  typeZone.style.display = "block";
  // Default to Customer Approved every time a (new) project is picked —
  // never carry the previous project's selected type forward silently.
  selectUploadDrawingsType('Customer Approved');
}

function selectUploadDrawingsType(drawingType) {
  if (!UPLOAD_DRAWINGS_TYPES.includes(drawingType)) return;
  uploadDrawingsSelectedType = drawingType;

  const approvedBtn = document.getElementById("upload-drawings-type-btn-approved");
  const workingBtn  = document.getElementById("upload-drawings-type-btn-working");
  const activeStyle   = "flex:1; padding:9px; font-weight:700; background:var(--accent); color:#fff; border-color:var(--accent);";
  const inactiveStyle = "flex:1; padding:9px; font-weight:700; background:#fff; color:var(--text);";
  approvedBtn.style.cssText = drawingType === 'Customer Approved' ? activeStyle : inactiveStyle;
  workingBtn.style.cssText  = drawingType === 'Working Drawing'   ? activeStyle : inactiveStyle;

  document.getElementById("upload-drawings-list-heading").textContent = `Already Uploaded — ${drawingType}`;

  const uploadZone = document.getElementById("upload-drawings-upload-zone");
  uploadZone.style.display = "block";

  const projectId = document.getElementById("upload-drawings-project-ta-input").value;
  refreshUploadDrawingsList(projectId, drawingType);
}

async function refreshUploadDrawingsList(projectId, drawingType) {
  const listZone = document.getElementById("upload-drawings-existing-list");
  const mount    = document.getElementById("upload-drawings-list-mount");

  mount.innerHTML = '<div style="font-size:0.82rem; color:var(--muted);">Loading...</div>';
  listZone.style.display = "block";

  try {
    const data = await apFetch({ action:"fetchDrawingDocumentsList", projectId, drawingType });

    if (!data.success || !data.documents || data.documents.length === 0) {
      mount.innerHTML = `<div style="font-size:0.82rem; color:var(--muted); font-style:italic; padding:10px; background:#f8fafc; border:1px dashed var(--border); border-radius:var(--radius);">No ${drawingType} drawing documents uploaded yet for this project.</div>`;
      return;
    }

    mount.innerHTML = data.documents.map(doc => `
      <a href="${driveLink(doc.url)}" target="_blank" style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); text-decoration:none; color:var(--text); font-size:0.85rem; font-weight:600;">
        <span>📄 ${doc.name}</span>
        <span style="font-size:0.72rem; color:var(--muted); font-weight:400;">${formatOrdinalDateTime(doc.lastUpdated) || doc.lastUpdated}</span>
      </a>`).join("");
  } catch(e) {
    mount.innerHTML = '<div style="color:var(--warn); font-size:0.82rem;">Failed to load documents.</div>';
  }
}

function handleUploadDrawingsFileSelection(input) {
  uploadDrawingsSelectedFile = input.files[0];
  if (uploadDrawingsSelectedFile) {
    const box = document.getElementById("upload-drawings-dropzone");
    box.textContent = uploadDrawingsSelectedFile.name + " ✅";
    box.classList.add("done");
  }
}

async function submitUploadDrawing() {
  const projectId = document.getElementById("upload-drawings-project-ta-input").value;
  const btn       = document.getElementById("upload-drawings-submit-btn");

  if (!projectId) return showBOQBanner("upload-drawings-feedback", "Select a Project ID first.", "error");
  if (!uploadDrawingsSelectedType) return showBOQBanner("upload-drawings-feedback", "Select a Drawing Type first.", "error");
  if (!uploadDrawingsSelectedFile) return showBOQBanner("upload-drawings-feedback", "Select a file to upload first.", "error");

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Uploading...';

  try {
    const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(uploadDrawingsSelectedFile); });
    const data = await apFetch({
      action: "uploadDrawingDocument",
      projectId,
      drawingType: uploadDrawingsSelectedType,
      fileName: uploadDrawingsSelectedFile.name,
      base64Data: b64,
      mimeType: uploadDrawingsSelectedFile.type || "application/octet-stream"
    });

    if (data.success) {
      showBOQBanner("upload-drawings-feedback", `<strong>${data.fileName}</strong> uploaded successfully as ${uploadDrawingsSelectedType}.`, "success");
      uploadDrawingsSelectedFile = null;
      document.getElementById("upload-drawings-input").value = "";
      const box = document.getElementById("upload-drawings-dropzone");
      box.textContent = "📎 Click to select a drawing document";
      box.classList.remove("done");
      await refreshUploadDrawingsList(projectId, uploadDrawingsSelectedType);
    } else {
      showBOQBanner("upload-drawings-feedback", data.error || "Upload failed.", "error");
    }
  } catch(e) {
    showBOQBanner("upload-drawings-feedback", "Network error: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Upload Document";
  }
}
