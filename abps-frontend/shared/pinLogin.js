// ═══════════════════════════════════════════════════════════════════════
// shared/pinLogin.js — PIN login on an admin-registered PC (migration
// 140), a second login path alongside Google. Redesigned 26 Aug 2026: a
// top-level PIN / Google Account / Enrollment Code selector (see
// index.html's login-mode buttons), enrollment codes are now PER-PERSON
// (an admin issues one against a specific user, not a PC + allowlist),
// and the person redeeming a code chooses their own PC label AND their
// own PIN right there, self-service, at that one moment — every PIN
// change after that goes through an admin issuing a fresh code again.
//
// The one persistent client-side secret this introduces is
// abpsPcDeviceSecret in localStorage — a long random bearer token minted
// once at enrollment (auth.js's redeemDeviceEnrollmentCode) and replayed
// on every pinLogin call from then on. It is preserved across logout and
// session-expiry the same way abpsDeviceToken already is — see
// clearAppLocalStorageKeepingDeviceKeys() in shared/apFetch.js.
// ═══════════════════════════════════════════════════════════════════════

let activeLoginMode = null;

// Called from initializeGoogleAuthPlatformEngine() (marketing/leads.js)
// every time the login screen is (re)shown, so the default mode always
// reflects this browser's current enrollment state.
function renderPinLoginUiForThisDevice() {
  const hasDevice = !!localStorage.getItem("abpsPcDeviceSecret");
  // Google mode's own selector button is hidden (26 Aug 2026, pending
  // discussion) — never default into a mode with no visible way back to it.
  selectLoginMode(hasDevice ? 'pin' : 'enroll');
}

function selectLoginMode(mode) {
  activeLoginMode = mode;

  ['pin', 'google', 'enroll'].forEach(m => {
    const btn = document.getElementById(`login-mode-btn-${m}`);
    if (btn) {
      btn.style.background = (m === mode) ? 'var(--brand)' : '#e2e8f0';
      btn.style.color = (m === mode) ? '#fff' : '#334155';
    }
    const section = document.getElementById(`login-section-${m}`);
    if (section) section.style.display = (m === mode) ? 'block' : 'none';
  });
  // Google's own section uses flex for its button-centering row, not the
  // generic 'block' the other two use — fix that one up after the loop.
  const googleSection = document.getElementById('login-section-google');
  if (googleSection) googleSection.style.display = (mode === 'google') ? 'block' : 'none';

  if (mode === 'pin') {
    const hasDevice = !!localStorage.getItem("abpsPcDeviceSecret");
    document.getElementById('pin-login-not-registered-notice').style.display = hasDevice ? 'none' : 'block';
    document.getElementById('pin-login-input-wrap').style.display = hasDevice ? 'flex' : 'none';
    const pinInput = document.getElementById('pin-login-pin-input');
    // .disabled is left `true` after a SUCCESSFUL login (submitPinLoginAttempt
    // only ever re-enables it on failure, since success normally navigates
    // away) — logging back out without a full page refresh re-showed this
    // same input still disabled, with no way to type into it. Always reset
    // it here so re-entering PIN mode never inherits a stale disabled state.
    if (pinInput) { pinInput.value = ''; pinInput.disabled = false; if (hasDevice) pinInput.focus(); }
    const feedback = document.getElementById('pin-login-feedback');
    if (feedback) feedback.style.display = 'none';
  }
}

// selectLoginDeptButton — the pyramid department buttons in index.html
// (31 Aug 2026, replacing the plain <select>) call this instead of
// relying on a native <select> onchange. The hidden <select> itself
// stays the actual source of truth every other read site
// (shared/apFetch.js, shared/pinLogin.js's own submit functions) already
// reads .value from — setting it here and firing its existing onchange
// handler (handleLoginDepartmentSelectionChange, marketing/leads.js)
// keeps every one of those call sites correct with zero changes needed
// there, this is purely a presentation layer on top of the same state.
function selectLoginDeptButton(deptName) {
  const select = document.getElementById("app-auth-active-department-identity");
  if (select) {
    select.value = deptName;
    handleLoginDepartmentSelectionChange(deptName);
  }
  document.querySelectorAll(".login-dept-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.dept === deptName);
  });
}

// Auto-submits the instant a valid 4-digit PIN has been typed — no
// separate "Log In" button in PIN mode.
function handlePinDigitInput() {
  const pinInput = document.getElementById('pin-login-pin-input');
  const digitsOnly = pinInput.value.replace(/\D/g, '').slice(0, 4);
  if (pinInput.value !== digitsOnly) pinInput.value = digitsOnly;
  if (digitsOnly.length === 4) submitPinLoginAttempt();
}

async function submitPinLoginAttempt() {
  const engineerSelect = document.getElementById("app-auth-active-engineer-identity");
  const pinInput = document.getElementById("pin-login-pin-input");
  const feedback = document.getElementById("pin-login-feedback");
  const deviceSecret = localStorage.getItem("abpsPcDeviceSecret");

  const showFeedback = (msg, isError) => {
    if (!feedback) return;
    feedback.style.display = "block";
    feedback.style.color = isError ? "var(--warn)" : "var(--accent)";
    feedback.textContent = msg;
  };

  // The engineer dropdown is shared across all 3 modes (per the redesign)
  // and is populated with display-name values by handleLoginDepartmentSelectionChange
  // elsewhere — pinLogin needs the underlying EMAIL, so look it up from
  // the same personnel directory cache the Google flow already relies on.
  const selectedName = engineerSelect ? engineerSelect.value : '';
  const email = resolveEmailForSelectedEngineerName(selectedName);

  if (!selectedName) return showFeedback("Select your name first.", true);
  if (!email) return showFeedback("Could not resolve an account for that name. Contact your administrator.", true);
  const pin = pinInput.value.trim();
  if (!/^\d{4}$/.test(pin)) return showFeedback("Enter your 4-digit PIN.", true);
  if (!deviceSecret) return showFeedback("This PC is not set up for PIN login.", true);

  pinInput.disabled = true;
  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: "pinLogin", deviceSecret, email, pin }),
    });
    const data = await res.json();

    if (data.success) {
      // permissions.admin is the server's real perm_admin flag — a more
      // reliable admin signal than the Google path's department-dropdown
      // text match.
      completeSuccessfulLogin(data, selectedName, !!(data.permissions && data.permissions.admin));
    } else {
      showFeedback(data.error || "Login failed.", true);
      pinInput.value = "";
      pinInput.disabled = false;
      pinInput.focus();
    }
  } catch (e) {
    showFeedback("Connection error: " + e.message, true);
    pinInput.disabled = false;
  }
}

// The login screen's Name dropdown is populated with DISPLAY NAMES only
// (see handleLoginDepartmentSelectionChange, marketing/leads.js) — PIN
// login and enrollment both need the actual EMAIL, which the Google flow
// never needed (it gets the email from the verified Google ID token
// instead). globalPersonnelEmailLookupCache (shared/apFetch.js) is the
// same directory response's flat {department, name, email} list, already
// populated by the time this screen is usable. Matched on department AND
// name together, not name alone, since two people in different
// departments could share a display name.
function resolveEmailForSelectedEngineerName(name) {
  if (!name) return null;
  const dept = document.getElementById("app-auth-active-department-identity")?.value || '';
  const hit = globalPersonnelEmailLookupCache.find(p => p.name === name && p.department === dept);
  return hit ? hit.email : null;
}

async function submitDeviceEnrollmentCode() {
  const engineerSelect = document.getElementById("app-auth-active-engineer-identity");
  const codeInput = document.getElementById("device-enrollment-code-input");
  const labelInput = document.getElementById("device-enrollment-label-input");
  const pinInput = document.getElementById("device-enrollment-pin-input");
  const pinConfirmInput = document.getElementById("device-enrollment-pin-confirm-input");
  const feedback = document.getElementById("device-enrollment-feedback");

  const showFeedback = (msg, isError) => {
    if (!feedback) return;
    feedback.style.display = "block";
    feedback.style.color = isError ? "var(--warn)" : "var(--accent)";
    feedback.textContent = msg;
  };

  const selectedName = engineerSelect ? engineerSelect.value : '';
  if (!selectedName) return showFeedback("Select your name first.", true);
  const email = resolveEmailForSelectedEngineerName(selectedName);
  if (!email) return showFeedback("Could not resolve an account for that name. Contact your administrator.", true);
  const code = (codeInput.value || "").trim().toUpperCase();
  const deviceLabel = (labelInput.value || "").trim();
  const pin = pinInput.value.trim();
  const pinConfirm = pinConfirmInput.value.trim();

  if (!code) return showFeedback("Enter the enrollment code.", true);
  if (!deviceLabel) return showFeedback("Give this device a label (e.g. \"My Laptop\").", true);
  if (!/^\d{4}$/.test(pin)) return showFeedback("Choose a 4-digit PIN.", true);
  if (pin !== pinConfirm) return showFeedback("PIN and Confirm PIN don't match.", true);

  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: "redeemDeviceEnrollmentCode", code, email, deviceLabel, pin }),
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem("abpsPcDeviceSecret", data.deviceSecret);
      showFeedback(`✅ This device is set up as "${data.deviceLabel}". Reloading...`, false);
      setTimeout(() => window.location.reload(), 1200);
    } else {
      showFeedback(data.error || "Enrollment failed.", true);
    }
  } catch (e) {
    showFeedback("Connection error: " + e.message, true);
  }
}
