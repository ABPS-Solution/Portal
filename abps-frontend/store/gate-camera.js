// In-page camera for Gate Entry. Opening the phone's own camera app (the file
// input's camera option) sends Chrome to the background, and on low-RAM phones
// Android closes the tab there ("Unable to complete previous operation due to
// low memory") and the photo is lost. getUserMedia keeps the camera inside the
// page, so the browser never leaves the foreground.

let gateCamStream = null;
let gateCamDocType = null;

function gateIsTouchDevice() {
  return window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
}

function gateCanUseInPageCamera() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;
}

// Styled through a class, not inline, so shared/mobile.css's generic
// full-screen pop-up rule (matches inline position:fixed + inset:0) leaves these alone.
function gateEnsureCamStyles() {
  if (document.getElementById('gate-cam-styles')) return;
  const st = document.createElement('style');
  st.id = 'gate-cam-styles';
  st.textContent = '.gate-cam-sheet{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100000;background:rgba(15,23,42,0.55);display:flex;align-items:flex-end;justify-content:center;}'
    + '.gate-cam-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:100001;background:#000;display:flex;flex-direction:column;}';
  document.head.appendChild(st);
}

function gateOpenDocumentSource(docType) {
  const input = document.getElementById(docType === 'invoice' ? 'gate-invoice-file' : 'gate-challan-file');
  if (!gateIsTouchDevice() || !gateCanUseInPageCamera()) { input.click(); return; }
  gateCloseSourceSheet();
  const label = docType === 'invoice' ? 'Invoice' : 'Challan';
  const sheet = document.createElement('div');
  sheet.id = 'gate-source-sheet';
  gateEnsureCamStyles();
  sheet.className = 'gate-cam-sheet';
  sheet.onclick = e => { if (e.target === sheet) gateCloseSourceSheet(); };
  sheet.innerHTML = `
    <div style="background:#fff; width:100%; max-width:480px; border-radius:14px 14px 0 0; padding:18px 16px 22px; box-sizing:border-box;">
      <div style="font-weight:700; font-size:1rem; margin-bottom:12px; text-align:center;">Add ${label} Pages</div>
      <button class="btn" style="width:100%; margin-bottom:10px;" onclick="gateCloseSourceSheet(); gateOpenCamera(${jsArg(docType)})">Take Photos</button>
      <button class="btn" style="width:100%; margin-bottom:10px; background:#fff; color:var(--text); border:1px solid var(--border);" onclick="gateCloseSourceSheet(); document.getElementById(${jsArg(input.id)}).click()">Choose from Gallery / Files</button>
      <button class="btn" style="width:100%; background:#fff; color:var(--muted); border:none;" onclick="gateCloseSourceSheet()">Cancel</button>
    </div>`;
  document.body.appendChild(sheet);
}

function gateCloseSourceSheet() {
  const s = document.getElementById('gate-source-sheet');
  if (s) s.remove();
}

async function gateOpenCamera(docType) {
  gateCamDocType = docType;
  const label = docType === 'invoice' ? 'Invoice' : 'Challan';
  const ov = document.createElement('div');
  ov.id = 'gate-cam-overlay';
  gateEnsureCamStyles();
  ov.className = 'gate-cam-overlay';
  ov.innerHTML = `
    <div style="color:#fff; padding:12px 14px; display:flex; justify-content:space-between; align-items:center; font-size:0.9rem;">
      <span style="font-weight:700;">${label}</span>
      <span id="gate-cam-count"></span>
    </div>
    <div style="flex:1; position:relative; overflow:hidden;">
      <video id="gate-cam-video" autoplay playsinline muted style="width:100%; height:100%; object-fit:contain; background:#000;"></video>
      <div id="gate-cam-flash" style="position:absolute; inset:0; background:#fff; opacity:0; pointer-events:none; transition:opacity 0.15s;"></div>
    </div>
    <div style="display:flex; align-items:center; justify-content:space-between; padding:16px 22px 26px; gap:12px;">
      <button onclick="gateCloseCamera()" style="background:none; border:none; color:#fff; font-size:0.95rem; width:70px;">Close</button>
      <button id="gate-cam-shutter" onclick="gateCapturePhoto()" aria-label="Take photo" style="width:70px; height:70px; border-radius:50%; border:5px solid #fff; background:#e2e8f0;"></button>
      <button onclick="gateCloseCamera()" style="background:#16a34a; border:none; color:#fff; font-weight:700; font-size:0.95rem; padding:10px 0; border-radius:8px; width:70px;">Done</button>
    </div>`;
  document.body.appendChild(ov);
  gateUpdateCamCount();
  try {
    gateCamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    const video = document.getElementById('gate-cam-video');
    if (!video) { gateStopCamStream(); return; }
    video.srcObject = gateCamStream;
  } catch (err) {
    gateCloseCamera();
    await abpsAlert('Could not open the camera inside the page (' + (err && err.name || 'error') + '). Choose the photos from the gallery instead, or allow camera access for this site in Chrome settings.');
    document.getElementById(docType === 'invoice' ? 'gate-invoice-file' : 'gate-challan-file').click();
  }
}

function gateUpdateCamCount() {
  const el = document.getElementById('gate-cam-count');
  if (!el) return;
  const n = (gateCamDocType === 'invoice' ? targetGateInvoiceFiles : targetGateChallanFiles).length;
  el.textContent = n ? `${n} page${n > 1 ? 's' : ''} added` : 'Take a photo of each page';
}

function gateCapturePhoto() {
  const video = document.getElementById('gate-cam-video');
  if (!video || !video.videoWidth) return;
  const shutter = document.getElementById('gate-cam-shutter');
  if (shutter) shutter.disabled = true;
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const flash = document.getElementById('gate-cam-flash');
  if (flash) { flash.style.opacity = '0.8'; setTimeout(() => { flash.style.opacity = '0'; }, 120); }
  canvas.toBlob(blob => {
    if (shutter) shutter.disabled = false;
    if (!blob) return;
    const arr = gateCamDocType === 'invoice' ? targetGateInvoiceFiles : targetGateChallanFiles;
    const file = new File([blob], `${gateCamDocType}-page-${arr.length + 1}.jpg`, { type: 'image/jpeg' });
    arr.push(file);
    renderGateFileList(gateCamDocType === 'invoice' ? 'gate-invoice-box' : 'gate-challan-box');
    updateGateRequiredMarkers();
    gateUpdateCamCount();
    canvas.width = canvas.height = 0;
  }, 'image/jpeg', 0.85);
}

function gateStopCamStream() {
  if (gateCamStream) { gateCamStream.getTracks().forEach(t => t.stop()); gateCamStream = null; }
}

function gateCloseCamera() {
  gateStopCamStream();
  const video = document.getElementById('gate-cam-video');
  if (video) video.srcObject = null;
  const ov = document.getElementById('gate-cam-overlay');
  if (ov) ov.remove();
}

document.addEventListener('visibilitychange', () => { if (document.hidden) gateCloseCamera(); });
