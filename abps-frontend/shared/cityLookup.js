// ═══════════════════════════════════════════════════════════════════════
// cityLookup.js — City → State/Country auto-fill for the New Lead form
// (and any other City/State/Country trio).
//
// This is a best-effort convenience, not an authoritative geo database.
// Coverage is India-first (ABPS's real customer base) plus a modest set
// of well-known international business cities. A city name that maps to
// more than one state in real life (e.g. "Aurangabad" exists in both
// Maharashtra and Bihar) picks the more common/larger one — the fields
// stay fully editable afterward, this only sets a starting value.
// ═══════════════════════════════════════════════════════════════════════

const CITY_STATE_COUNTRY_LOOKUP = {
  // Maharashtra
  "mumbai": ["Maharashtra", "India"], "pune": ["Maharashtra", "India"],
  "nagpur": ["Maharashtra", "India"], "nashik": ["Maharashtra", "India"],
  "thane": ["Maharashtra", "India"], "aurangabad": ["Maharashtra", "India"],
  "solapur": ["Maharashtra", "India"], "kolhapur": ["Maharashtra", "India"],
  "amravati": ["Maharashtra", "India"], "nanded": ["Maharashtra", "India"],
  "akola": ["Maharashtra", "India"], "latur": ["Maharashtra", "India"],
  "dhule": ["Maharashtra", "India"], "ahmednagar": ["Maharashtra", "India"],
  "chandrapur": ["Maharashtra", "India"], "jalgaon": ["Maharashtra", "India"],
  "sangli": ["Maharashtra", "India"], "satara": ["Maharashtra", "India"],
  "ratnagiri": ["Maharashtra", "India"], "raigad": ["Maharashtra", "India"],
  "navi mumbai": ["Maharashtra", "India"], "panvel": ["Maharashtra", "India"],
  "wardha": ["Maharashtra", "India"], "ichalkaranji": ["Maharashtra", "India"],

  // Gujarat
  "ahmedabad": ["Gujarat", "India"], "surat": ["Gujarat", "India"],
  "vadodara": ["Gujarat", "India"], "rajkot": ["Gujarat", "India"],
  "bhavnagar": ["Gujarat", "India"], "jamnagar": ["Gujarat", "India"],
  "gandhinagar": ["Gujarat", "India"], "anand": ["Gujarat", "India"],
  "bharuch": ["Gujarat", "India"], "vapi": ["Gujarat", "India"],
  "ankleshwar": ["Gujarat", "India"], "mehsana": ["Gujarat", "India"],
  "morbi": ["Gujarat", "India"], "junagadh": ["Gujarat", "India"],
  "navsari": ["Gujarat", "India"], "valsad": ["Gujarat", "India"],
  "nadiad": ["Gujarat", "India"], "kalol": ["Gujarat", "India"],

  // Karnataka
  "bengaluru": ["Karnataka", "India"], "bangalore": ["Karnataka", "India"],
  "mysuru": ["Karnataka", "India"], "mysore": ["Karnataka", "India"],
  "hubli": ["Karnataka", "India"], "dharwad": ["Karnataka", "India"],
  "mangaluru": ["Karnataka", "India"], "mangalore": ["Karnataka", "India"],
  "belagavi": ["Karnataka", "India"], "belgaum": ["Karnataka", "India"],
  "davanagere": ["Karnataka", "India"], "ballari": ["Karnataka", "India"],
  "bellary": ["Karnataka", "India"], "tumakuru": ["Karnataka", "India"],
  "shivamogga": ["Karnataka", "India"], "raichur": ["Karnataka", "India"],
  "bidar": ["Karnataka", "India"], "hospet": ["Karnataka", "India"],
  "hassan": ["Karnataka", "India"], "udupi": ["Karnataka", "India"],

  // Tamil Nadu
  "chennai": ["Tamil Nadu", "India"], "coimbatore": ["Tamil Nadu", "India"],
  "madurai": ["Tamil Nadu", "India"], "tiruchirappalli": ["Tamil Nadu", "India"],
  "trichy": ["Tamil Nadu", "India"], "salem": ["Tamil Nadu", "India"],
  "tirunelveli": ["Tamil Nadu", "India"], "erode": ["Tamil Nadu", "India"],
  "vellore": ["Tamil Nadu", "India"], "thoothukudi": ["Tamil Nadu", "India"],
  "tuticorin": ["Tamil Nadu", "India"], "dindigul": ["Tamil Nadu", "India"],
  "thanjavur": ["Tamil Nadu", "India"], "hosur": ["Tamil Nadu", "India"],
  "karur": ["Tamil Nadu", "India"], "ranipet": ["Tamil Nadu", "India"],
  "sivakasi": ["Tamil Nadu", "India"], "pondicherry": ["Puducherry", "India"],
  "puducherry": ["Puducherry", "India"],

  // Telangana / Andhra Pradesh
  "hyderabad": ["Telangana", "India"], "warangal": ["Telangana", "India"],
  "nizamabad": ["Telangana", "India"], "karimnagar": ["Telangana", "India"],
  "khammam": ["Telangana", "India"], "secunderabad": ["Telangana", "India"],
  "visakhapatnam": ["Andhra Pradesh", "India"], "vizag": ["Andhra Pradesh", "India"],
  "vijayawada": ["Andhra Pradesh", "India"], "guntur": ["Andhra Pradesh", "India"],
  "nellore": ["Andhra Pradesh", "India"], "kurnool": ["Andhra Pradesh", "India"],
  "kakinada": ["Andhra Pradesh", "India"], "rajahmundry": ["Andhra Pradesh", "India"],
  "tirupati": ["Andhra Pradesh", "India"], "anantapur": ["Andhra Pradesh", "India"],

  // Uttar Pradesh
  "lucknow": ["Uttar Pradesh", "India"], "kanpur": ["Uttar Pradesh", "India"],
  "ghaziabad": ["Uttar Pradesh", "India"], "agra": ["Uttar Pradesh", "India"],
  "varanasi": ["Uttar Pradesh", "India"], "meerut": ["Uttar Pradesh", "India"],
  "allahabad": ["Uttar Pradesh", "India"], "prayagraj": ["Uttar Pradesh", "India"],
  "bareilly": ["Uttar Pradesh", "India"], "aligarh": ["Uttar Pradesh", "India"],
  "moradabad": ["Uttar Pradesh", "India"], "saharanpur": ["Uttar Pradesh", "India"],
  "gorakhpur": ["Uttar Pradesh", "India"], "noida": ["Uttar Pradesh", "India"],
  "firozabad": ["Uttar Pradesh", "India"], "jhansi": ["Uttar Pradesh", "India"],
  "mathura": ["Uttar Pradesh", "India"], "rampur": ["Uttar Pradesh", "India"],
  "muzaffarnagar": ["Uttar Pradesh", "India"],

  // Delhi / NCR
  "delhi": ["Delhi", "India"], "new delhi": ["Delhi", "India"],
  "gurugram": ["Haryana", "India"], "gurgaon": ["Haryana", "India"],
  "faridabad": ["Haryana", "India"],

  // Haryana (other)
  "panipat": ["Haryana", "India"], "ambala": ["Haryana", "India"],
  "hisar": ["Haryana", "India"], "rohtak": ["Haryana", "India"],
  "karnal": ["Haryana", "India"], "sonipat": ["Haryana", "India"],
  "yamunanagar": ["Haryana", "India"], "bahadurgarh": ["Haryana", "India"],
  "bhiwadi": ["Rajasthan", "India"],

  // Rajasthan
  "jaipur": ["Rajasthan", "India"], "jodhpur": ["Rajasthan", "India"],
  "udaipur": ["Rajasthan", "India"], "kota": ["Rajasthan", "India"],
  "ajmer": ["Rajasthan", "India"], "bikaner": ["Rajasthan", "India"],
  "alwar": ["Rajasthan", "India"], "bhilwara": ["Rajasthan", "India"],
  "sikar": ["Rajasthan", "India"], "pali": ["Rajasthan", "India"],

  // West Bengal
  "kolkata": ["West Bengal", "India"], "howrah": ["West Bengal", "India"],
  "durgapur": ["West Bengal", "India"], "asansol": ["West Bengal", "India"],
  "siliguri": ["West Bengal", "India"], "kharagpur": ["West Bengal", "India"],
  "haldia": ["West Bengal", "India"],

  // Madhya Pradesh
  "indore": ["Madhya Pradesh", "India"], "bhopal": ["Madhya Pradesh", "India"],
  "jabalpur": ["Madhya Pradesh", "India"], "gwalior": ["Madhya Pradesh", "India"],
  "ujjain": ["Madhya Pradesh", "India"], "sagar": ["Madhya Pradesh", "India"],
  "dewas": ["Madhya Pradesh", "India"], "satna": ["Madhya Pradesh", "India"],
  "ratlam": ["Madhya Pradesh", "India"], "rewa": ["Madhya Pradesh", "India"],
  "pithampur": ["Madhya Pradesh", "India"],

  // Bihar / Jharkhand
  "patna": ["Bihar", "India"], "gaya": ["Bihar", "India"],
  "bhagalpur": ["Bihar", "India"], "muzaffarpur": ["Bihar", "India"],
  "darbhanga": ["Bihar", "India"],
  "ranchi": ["Jharkhand", "India"], "jamshedpur": ["Jharkhand", "India"],
  "dhanbad": ["Jharkhand", "India"], "bokaro": ["Jharkhand", "India"],

  // Punjab
  "ludhiana": ["Punjab", "India"], "amritsar": ["Punjab", "India"],
  "jalandhar": ["Punjab", "India"], "patiala": ["Punjab", "India"],
  "bathinda": ["Punjab", "India"], "mohali": ["Punjab", "India"],
  "chandigarh": ["Chandigarh", "India"],

  // Kerala
  "kochi": ["Kerala", "India"], "cochin": ["Kerala", "India"],
  "thiruvananthapuram": ["Kerala", "India"], "kozhikode": ["Kerala", "India"],
  "calicut": ["Kerala", "India"], "thrissur": ["Kerala", "India"],
  "kollam": ["Kerala", "India"], "alappuzha": ["Kerala", "India"],
  "palakkad": ["Kerala", "India"],

  // Odisha
  "bhubaneswar": ["Odisha", "India"], "cuttack": ["Odisha", "India"],
  "rourkela": ["Odisha", "India"], "brahmapur": ["Odisha", "India"],
  "sambalpur": ["Odisha", "India"], "angul": ["Odisha", "India"],

  // Chhattisgarh
  "raipur": ["Chhattisgarh", "India"], "bhilai": ["Chhattisgarh", "India"],
  "bilaspur": ["Chhattisgarh", "India"], "durg": ["Chhattisgarh", "India"],
  "korba": ["Chhattisgarh", "India"], "raigarh": ["Chhattisgarh", "India"],

  // Assam / NE
  "guwahati": ["Assam", "India"], "dibrugarh": ["Assam", "India"],
  "silchar": ["Assam", "India"], "jorhat": ["Assam", "India"],
  "shillong": ["Meghalaya", "India"], "imphal": ["Manipur", "India"],
  "agartala": ["Tripura", "India"], "aizawl": ["Mizoram", "India"],
  "itanagar": ["Arunachal Pradesh", "India"], "kohima": ["Nagaland", "India"],
  "gangtok": ["Sikkim", "India"],

  // Uttarakhand / Himachal
  "dehradun": ["Uttarakhand", "India"], "haridwar": ["Uttarakhand", "India"],
  "rudrapur": ["Uttarakhand", "India"], "roorkee": ["Uttarakhand", "India"],
  "kashipur": ["Uttarakhand", "India"], "haldwani": ["Uttarakhand", "India"],
  "shimla": ["Himachal Pradesh", "India"], "baddi": ["Himachal Pradesh", "India"],
  "solan": ["Himachal Pradesh", "India"],

  // J&K / Ladakh
  "srinagar": ["Jammu and Kashmir", "India"], "jammu": ["Jammu and Kashmir", "India"],
  "leh": ["Ladakh", "India"],

  // Goa
  "panaji": ["Goa", "India"], "panjim": ["Goa", "India"], "margao": ["Goa", "India"],
  "vasco da gama": ["Goa", "India"],

  // International (best-known business cities)
  "dubai": ["Dubai", "UAE"], "abu dhabi": ["Abu Dhabi", "UAE"],
  "sharjah": ["Sharjah", "UAE"],
  "singapore": ["Singapore", "Singapore"],
  "colombo": ["Western Province", "Sri Lanka"],
  "dhaka": ["Dhaka Division", "Bangladesh"],
  "kathmandu": ["Bagmati Province", "Nepal"],
  "riyadh": ["Riyadh", "Saudi Arabia"], "jeddah": ["Makkah", "Saudi Arabia"],
  "doha": ["Doha", "Qatar"], "muscat": ["Muscat", "Oman"],
  "kuwait city": ["Al Asimah", "Kuwait"],
  "london": ["England", "United Kingdom"],
  "new york": ["New York", "USA"], "houston": ["Texas", "USA"],
  "shanghai": ["Shanghai", "China"], "beijing": ["Beijing", "China"],
  "hong kong": ["Hong Kong", "Hong Kong"],
};

// Looks up a city (case/whitespace-insensitive) and returns [state, country]
// or null if there's no entry. Callers decide what to do with a miss —
// this never guesses, it only returns a known mapping.
function lookupCityStateCountry(cityValue) {
  if (!cityValue) return null;
  const key = cityValue.trim().toLowerCase();
  return CITY_STATE_COUNTRY_LOOKUP[key] || null;
}

// Wires a City input so that, on blur, a recognized city fills State/Country
// — always overwriting (this is a convenience default, not a lock; the
// fields stay perfectly editable afterward, since the same city name can
// genuinely exist in more than one state or country).
function wireCityAutoFillStateCountry(cityInputId, stateInputId, countryInputId) {
  const cityEl = document.getElementById(cityInputId);
  const stateEl = document.getElementById(stateInputId);
  const countryEl = document.getElementById(countryInputId);
  if (!cityEl || !stateEl || !countryEl) return;
  // This element is reused (not re-cloned) every time a form re-opens, so
  // guard against binding the same blur listener multiple times.
  if (cityEl.dataset.cityAutoFillWired) return;
  cityEl.dataset.cityAutoFillWired = '1';
  cityEl.addEventListener('blur', () => {
    const match = lookupCityStateCountry(cityEl.value);
    if (!match) return;
    stateEl.value = match[0];
    countryEl.value = match[1];
  });
}
