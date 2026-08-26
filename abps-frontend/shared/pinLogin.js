// ═══════════════════════════════════════════════════════════════════════
// shared/pinLogin.js — PIN login on an admin-registered PC (migration
// 140), a second login path alongside Google (handleGooglePlatformCredentialResponse
// in shared/apFetch.js). Not everyone at ABPS has a Google account; a
// registered PC lets an admin-assigned set of people log in here with
// just their name + a 4-digit PIN instead. Google login is completely
// unaffected — both are always available side by side once a PC is
// enrolled; only PIN login additionally requires the PC to be enrolled.
//
// The one persistent client-side secret this introduces is
// abpsPcDeviceSecret in localStorage — a long random bearer token minted
// once at enrollment (auth.js's redeemDeviceEnrollmentCode) and replayed
// on every pinLogin call from then on. It is preserved across logout and
// session-expiry the same way abpsDeviceToken already is — see
// clearAppLocalStorageKeepingDeviceKeys() in shared/apFetch.js.
// ═══════════════════════════════════════════════════════════════════════

// Called from initializeGoogleAuthPlatformEngine() (marketing/leads.js)
// every time the login screen is (re)shown, so this always reflects the
// current enrollment state of this browser/PC.
async function renderPinLoginUiForThisDevice() {
  const pinSection = document.getElementById("pin-login-section");
  const deviceSecret = localStorage.getItem("abpsPcDeviceSecret");
  if (!pinSection) return;

  if (!deviceSecret) {
    pinSection.style.display = "none";
    return;
  }

  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: "fetchDeviceAllowedUsers", deviceSecret }),
    });
    const data = await res.json();

    if (!data.success) {
      // The device secret is stale (device revoked, or DB reset) —
      // silently fall back to Google-only rather than showing a broken
      // PIN form forever. Set-up-this-PC link stays available to re-enroll.
      localStorage.removeItem("abpsPcDeviceSecret");
      pinSection.style.display = "none";
      return;
    }

    document.getElementById("pin-login-device-label").textContent = data.deviceLabel;
    const userSelect = document.getElementById("pin-login-user-select");
    userSelect.innerHTML = '<option value="">— Select —</option>' +
      data.users.map(u => `<option value="${u.email.replace(/"/g, "&quot;")}">${u.name}</option>`).join("");
    document.getElementById("pin-login-pin-input").value = "";
    const feedback = document.getElementById("pin-login-feedback");
    if (feedback) feedback.style.display = "none";
    pinSection.style.display = "block";
  } catch (e) {
    console.error("renderPinLoginUiForThisDevice failed:", e);
    pinSection.style.display = "none";
  }
}

async function submitPinLoginAttempt() {
  const userSelect = document.getElementById("pin-login-user-select");
  const pinInput = document.getElementById("pin-login-pin-input");
  const submitBtn = document.getElementById("pin-login-submit-btn");
  const feedback = document.getElementById("pin-login-feedback");
  const deviceSecret = localStorage.getItem("abpsPcDeviceSecret");

  const email = userSelect.value;
  const pin = pinInput.value.trim();

  const showFeedback = (msg, isError) => {
    if (!feedback) return;
    feedback.style.display = "block";
    feedback.style.color = isError ? "var(--warn)" : "var(--accent)";
    feedback.textContent = msg;
  };

  if (!email) return showFeedback("Select your name first.", true);
  if (!/^\d{4}$/.test(pin)) return showFeedback("Enter your 4-digit PIN.", true);
  if (!deviceSecret) return showFeedback("This PC is not set up for PIN login.", true);

  submitBtn.disabled = true;
  submitBtn.textContent = "Logging in...";
  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: "pinLogin", deviceSecret, email, pin }),
    });
    const data = await res.json();

    if (data.success) {
      const selectedName = userSelect.options[userSelect.selectedIndex].textContent;
      // permissions.admin is the server's real perm_admin flag — a more
      // reliable admin signal than the Google path's department-dropdown
      // text match, and available here because there's no department
      // dropdown in the PIN flow to read from at all.
      completeSuccessfulLogin(data, selectedName, !!(data.permissions && data.permissions.admin));
    } else {
      showFeedback(data.error || "Login failed.", true);
      pinInput.value = "";
    }
  } catch (e) {
    showFeedback("Connection error: " + e.message, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Log In";
  }
}

function toggleDeviceEnrollmentPanel() {
  const section = document.getElementById("device-enrollment-section");
  if (section) section.style.display = (section.style.display === "block") ? "none" : "block";
}

async function submitDeviceEnrollmentCode() {
  const codeInput = document.getElementById("device-enrollment-code-input");
  const feedback = document.getElementById("device-enrollment-feedback");
  const code = (codeInput.value || "").trim().toUpperCase();

  const showFeedback = (msg, isError) => {
    if (!feedback) return;
    feedback.style.display = "block";
    feedback.style.color = isError ? "var(--warn)" : "var(--accent)";
    feedback.textContent = msg;
  };

  if (!code) return showFeedback("Enter the enrollment code.", true);

  try {
    const res = await fetch(GAS_URL, {
      method: "POST",
      body: JSON.stringify({ action: "redeemDeviceEnrollmentCode", code }),
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem("abpsPcDeviceSecret", data.deviceSecret);
      showFeedback(`✅ This PC is now set up as "${data.deviceLabel}".`, false);
      codeInput.value = "";
      setTimeout(() => {
        toggleDeviceEnrollmentPanel();
        renderPinLoginUiForThisDevice();
      }, 1200);
    } else {
      showFeedback(data.error || "Enrollment failed.", true);
    }
  } catch (e) {
    showFeedback("Connection error: " + e.message, true);
  }
}
