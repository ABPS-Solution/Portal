let uploadDrawingsSelectedFile = null;

async function initializeUploadDrawingsPanel() {
  const projDrop   = document.getElementById("upload-drawings-project-ta-input");
  document.getElementById("upload-drawings-existing-list").style.display = "none";
  document.getElementById("upload-drawings-upload-zone").style.display = "none";
  document.getElementById("upload-drawings-feedback").style.display = "none";

  try {
    const data = await apFetch({ action:"pullLiveActiveProjectCodes", statusFilter: "Active" });
    window.sharedActiveProjectCodes = data.projects || [];
    window.sharedProjectMeta = data.projectMeta || {};
  } catch(e) {
    projDrop.placeholder = "Error loading projects";
  }
}

async function handleUploadDrawingsStatusChange(selectedStatus) {
  const projDrop = document.getElementById("upload-drawings-project-ta-input");
  const listZone = document.getElementById("upload-drawings-existing-list");
  const uploadZone = document.getElementById("upload-drawings-upload-zone");

  projDrop.value = "";
  listZone.style.display = "none";
  uploadZone.style.display = "none";

  try {
    const data = await apFetch({ action:"pullLiveActiveProjectCodes", statusFilter: selectedStatus });
    window.sharedActiveProjectCodes = data.projects || [];
    window.sharedProjectMeta = data.projectMeta || {};
    projDrop.placeholder = (data.projects || []).length === 0 ? `No projects with status: ${selectedStatus}` : "Type Project ID or Customer Name...";
  } catch(e) {
    projDrop.placeholder = "Error loading projects";
  }
}

async function handleUploadDrawingsProjectChange(projectId) {
  const listZone = document.getElementById("upload-drawings-existing-list");
  const uploadZone = document.getElementById("upload-drawings-upload-zone");

  if (!projectId) {
    listZone.style.display = "none";
    uploadZone.style.display = "none";
    return;
  }

  uploadZone.style.display = "block";
  await refreshUploadDrawingsList(projectId);
}

async function refreshUploadDrawingsList(projectId) {
  const listZone = document.getElementById("upload-drawings-existing-list");
  const mount    = document.getElementById("upload-drawings-list-mount");

  mount.innerHTML = '<div style="font-size:0.82rem; color:var(--muted);">Loading...</div>';
  listZone.style.display = "block";

  try {
    const data = await apFetch({ action:"fetchDrawingDocumentsList", projectId });

    if (!data.success || !data.documents || data.documents.length === 0) {
      mount.innerHTML = '<div style="font-size:0.82rem; color:var(--muted); font-style:italic; padding:10px; background:#f8fafc; border:1px dashed var(--border); border-radius:var(--radius);">No drawing documents uploaded yet for this project.</div>';
      return;
    }

    mount.innerHTML = data.documents.map(doc => `
      <a href="${driveLink(doc.url)}" target="_blank" style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#fff; border:1px solid var(--border); border-radius:var(--radius); text-decoration:none; color:var(--text); font-size:0.85rem; font-weight:600;">
        <span>📄 ${doc.name}</span>
        <span style="font-size:0.72rem; color:var(--muted); font-weight:400;">${formatDateTimeDMY(doc.lastUpdated) || doc.lastUpdated}</span>
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
  if (!uploadDrawingsSelectedFile) return showBOQBanner("upload-drawings-feedback", "Select a file to upload first.", "error");

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.6s linear infinite;margin-right:6px;vertical-align:middle;"></div> Uploading...';

  try {
    const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(uploadDrawingsSelectedFile); });
    const data = await apFetch({
      action: "uploadDrawingDocument",
      projectId,
      fileName: uploadDrawingsSelectedFile.name,
      base64Data: b64,
      mimeType: uploadDrawingsSelectedFile.type || "application/octet-stream"
    });

    if (data.success) {
      showBOQBanner("upload-drawings-feedback", `<strong>${data.fileName}</strong> uploaded successfully.`, "success");
      uploadDrawingsSelectedFile = null;
      document.getElementById("upload-drawings-input").value = "";
      const box = document.getElementById("upload-drawings-dropzone");
      box.textContent = "📎 Click to select a drawing document";
      box.classList.remove("done");
      await refreshUploadDrawingsList(projectId);
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

