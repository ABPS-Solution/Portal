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
  "sharjah": ["Sharjah", "UAE"], "ajman": ["Ajman", "UAE"],
  "singapore": ["Singapore", "Singapore"],
  "colombo": ["Western Province", "Sri Lanka"],
  "dhaka": ["Dhaka Division", "Bangladesh"], "chittagong": ["Chittagong Division", "Bangladesh"],
  "kathmandu": ["Bagmati Province", "Nepal"],
  "riyadh": ["Riyadh", "Saudi Arabia"], "jeddah": ["Makkah", "Saudi Arabia"],
  "dammam": ["Eastern Province", "Saudi Arabia"], "mecca": ["Makkah", "Saudi Arabia"],
  "doha": ["Doha", "Qatar"], "muscat": ["Muscat", "Oman"],
  "kuwait city": ["Al Asimah", "Kuwait"],
  "manama": ["Capital Governorate", "Bahrain"],
  "amman": ["Amman Governorate", "Jordan"],
  "beirut": ["Beirut Governorate", "Lebanon"],
  "tel aviv": ["Tel Aviv District", "Israel"], "jerusalem": ["Jerusalem District", "Israel"],
  "baghdad": ["Baghdad Governorate", "Iraq"],
  "tehran": ["Tehran Province", "Iran"],

  // United Kingdom / Ireland
  "london": ["England", "United Kingdom"], "manchester": ["England", "United Kingdom"],
  "birmingham": ["England", "United Kingdom"], "leeds": ["England", "United Kingdom"],
  "liverpool": ["England", "United Kingdom"], "sheffield": ["England", "United Kingdom"],
  "bristol": ["England", "United Kingdom"], "newcastle": ["England", "United Kingdom"],
  "nottingham": ["England", "United Kingdom"], "southampton": ["England", "United Kingdom"],
  "glasgow": ["Scotland", "United Kingdom"], "edinburgh": ["Scotland", "United Kingdom"],
  "aberdeen": ["Scotland", "United Kingdom"], "cardiff": ["Wales", "United Kingdom"],
  "belfast": ["Northern Ireland", "United Kingdom"],
  "dublin": ["Leinster", "Ireland"], "cork": ["Munster", "Ireland"],

  // Italy
  "rome": ["Lazio", "Italy"], "milan": ["Lombardy", "Italy"],
  "turin": ["Piedmont", "Italy"], "naples": ["Campania", "Italy"],
  "florence": ["Tuscany", "Italy"], "bologna": ["Emilia-Romagna", "Italy"],
  "venice": ["Veneto", "Italy"], "genoa": ["Liguria", "Italy"],
  "verona": ["Veneto", "Italy"], "palermo": ["Sicily", "Italy"],

  // France
  "paris": ["Ile-de-France", "France"], "lyon": ["Auvergne-Rhone-Alpes", "France"],
  "marseille": ["Provence-Alpes-Cote d'Azur", "France"], "toulouse": ["Occitanie", "France"],
  "nice": ["Provence-Alpes-Cote d'Azur", "France"], "nantes": ["Pays de la Loire", "France"],
  "strasbourg": ["Grand Est", "France"], "bordeaux": ["Nouvelle-Aquitaine", "France"],
  "lille": ["Hauts-de-France", "France"],

  // Germany
  "berlin": ["Berlin", "Germany"], "munich": ["Bavaria", "Germany"],
  "frankfurt": ["Hesse", "Germany"], "hamburg": ["Hamburg", "Germany"],
  "cologne": ["North Rhine-Westphalia", "Germany"], "stuttgart": ["Baden-Wurttemberg", "Germany"],
  "dusseldorf": ["North Rhine-Westphalia", "Germany"], "dortmund": ["North Rhine-Westphalia", "Germany"],
  "essen": ["North Rhine-Westphalia", "Germany"], "leipzig": ["Saxony", "Germany"],
  "bremen": ["Bremen", "Germany"], "nuremberg": ["Bavaria", "Germany"],
  "hannover": ["Lower Saxony", "Germany"], "mannheim": ["Baden-Wurttemberg", "Germany"],

  // Spain / Portugal
  "madrid": ["Community of Madrid", "Spain"], "barcelona": ["Catalonia", "Spain"],
  "valencia": ["Valencian Community", "Spain"], "seville": ["Andalusia", "Spain"],
  "bilbao": ["Basque Country", "Spain"], "malaga": ["Andalusia", "Spain"],
  "lisbon": ["Lisbon District", "Portugal"], "porto": ["Porto District", "Portugal"],

  // Benelux / Alps / Nordics
  "amsterdam": ["North Holland", "Netherlands"], "rotterdam": ["South Holland", "Netherlands"],
  "the hague": ["South Holland", "Netherlands"], "eindhoven": ["North Brabant", "Netherlands"],
  "brussels": ["Brussels-Capital", "Belgium"], "antwerp": ["Flanders", "Belgium"],
  "luxembourg": ["Luxembourg District", "Luxembourg"],
  "zurich": ["Zurich", "Switzerland"], "geneva": ["Geneva", "Switzerland"],
  "basel": ["Basel-Stadt", "Switzerland"], "bern": ["Bern", "Switzerland"],
  "vienna": ["Vienna", "Austria"], "salzburg": ["Salzburg", "Austria"],
  "stockholm": ["Stockholm County", "Sweden"], "gothenburg": ["Vastra Gotaland", "Sweden"],
  "oslo": ["Oslo", "Norway"], "bergen": ["Vestland", "Norway"],
  "copenhagen": ["Capital Region", "Denmark"],
  "helsinki": ["Uusimaa", "Finland"],

  // Eastern Europe / Russia / Turkey
  "warsaw": ["Masovian Voivodeship", "Poland"], "krakow": ["Lesser Poland Voivodeship", "Poland"],
  "prague": ["Prague", "Czechia"], "budapest": ["Budapest", "Hungary"],
  "bucharest": ["Bucharest", "Romania"], "sofia": ["Sofia City Province", "Bulgaria"],
  "athens": ["Attica", "Greece"], "thessaloniki": ["Central Macedonia", "Greece"],
  "moscow": ["Moscow", "Russia"], "st petersburg": ["Saint Petersburg", "Russia"],
  "istanbul": ["Istanbul", "Turkey"], "ankara": ["Ankara", "Turkey"],
  "izmir": ["Izmir", "Turkey"],

  // North America (USA/Canada/Mexico)
  "new york": ["New York", "USA"], "houston": ["Texas", "USA"],
  "los angeles": ["California", "USA"], "san francisco": ["California", "USA"],
  "san diego": ["California", "USA"], "san jose": ["California", "USA"],
  "sacramento": ["California", "USA"], "oakland": ["California", "USA"],
  "chicago": ["Illinois", "USA"], "philadelphia": ["Pennsylvania", "USA"],
  "pittsburgh": ["Pennsylvania", "USA"], "phoenix": ["Arizona", "USA"],
  "san antonio": ["Texas", "USA"], "dallas": ["Texas", "USA"],
  "austin": ["Texas", "USA"], "fort worth": ["Texas", "USA"],
  "el paso": ["Texas", "USA"],
  "columbus": ["Ohio", "USA"], "cleveland": ["Ohio", "USA"], "cincinnati": ["Ohio", "USA"],
  "charlotte": ["North Carolina", "USA"], "raleigh": ["North Carolina", "USA"],
  "seattle": ["Washington", "USA"], "spokane": ["Washington", "USA"],
  "denver": ["Colorado", "USA"], "colorado springs": ["Colorado", "USA"],
  "washington": ["District of Columbia", "USA"], "washington dc": ["District of Columbia", "USA"],
  "boston": ["Massachusetts", "USA"], "cambridge": ["Massachusetts", "USA"],
  "detroit": ["Michigan", "USA"], "ann arbor": ["Michigan", "USA"],
  "grand rapids": ["Michigan", "USA"], "lansing": ["Michigan", "USA"],
  "nashville": ["Tennessee", "USA"], "memphis": ["Tennessee", "USA"],
  "portland": ["Oregon", "USA"], "eugene": ["Oregon", "USA"],
  "oklahoma city": ["Oklahoma", "USA"], "tulsa": ["Oklahoma", "USA"],
  "las vegas": ["Nevada", "USA"], "reno": ["Nevada", "USA"],
  "louisville": ["Kentucky", "USA"], "milwaukee": ["Wisconsin", "USA"],
  "madison": ["Wisconsin", "USA"], "albuquerque": ["New Mexico", "USA"],
  "tucson": ["Arizona", "USA"], "fresno": ["California", "USA"],
  "mesa": ["Arizona", "USA"], "atlanta": ["Georgia", "USA"],
  "savannah": ["Georgia", "USA"], "kansas city": ["Missouri", "USA"],
  "st louis": ["Missouri", "USA"], "st. louis": ["Missouri", "USA"],
  "miami": ["Florida", "USA"], "orlando": ["Florida", "USA"],
  "tampa": ["Florida", "USA"], "jacksonville": ["Florida", "USA"],
  "minneapolis": ["Minnesota", "USA"], "st paul": ["Minnesota", "USA"],
  "indianapolis": ["Indiana", "USA"], "baltimore": ["Maryland", "USA"],
  "virginia beach": ["Virginia", "USA"], "richmond": ["Virginia", "USA"],
  "new orleans": ["Louisiana", "USA"], "baton rouge": ["Louisiana", "USA"],
  "salt lake city": ["Utah", "USA"], "omaha": ["Nebraska", "USA"],
  "boise": ["Idaho", "USA"], "honolulu": ["Hawaii", "USA"],
  "anchorage": ["Alaska", "USA"], "des moines": ["Iowa", "USA"],
  "wichita": ["Kansas", "USA"], "buffalo": ["New York", "USA"],
  "rochester": ["New York", "USA"], "charleston": ["South Carolina", "USA"],
  "greenville": ["South Carolina", "USA"], "hartford": ["Connecticut", "USA"],
  "providence": ["Rhode Island", "USA"],
  // NOTE: "birmingham" deliberately NOT added here for Alabama — it's
  // already mapped to Birmingham, England above, and a bare city name is
  // ambiguous between the two. Keeping the more globally-recognized one.
  "huntsville": ["Alabama", "USA"], "jackson": ["Mississippi", "USA"],
  "little rock": ["Arkansas", "USA"], "chandler": ["Arizona", "USA"],

  "toronto": ["Ontario", "Canada"], "ottawa": ["Ontario", "Canada"],
  "mississauga": ["Ontario", "Canada"], "vancouver": ["British Columbia", "Canada"],
  "montreal": ["Quebec", "Canada"], "quebec city": ["Quebec", "Canada"],
  "calgary": ["Alberta", "Canada"], "edmonton": ["Alberta", "Canada"],
  "winnipeg": ["Manitoba", "Canada"], "halifax": ["Nova Scotia", "Canada"],

  "mexico city": ["Mexico City", "Mexico"], "guadalajara": ["Jalisco", "Mexico"],
  "monterrey": ["Nuevo Leon", "Mexico"], "tijuana": ["Baja California", "Mexico"],

  // South America
  "sao paulo": ["Sao Paulo", "Brazil"], "rio de janeiro": ["Rio de Janeiro", "Brazil"],
  "brasilia": ["Federal District", "Brazil"], "belo horizonte": ["Minas Gerais", "Brazil"],
  "buenos aires": ["Buenos Aires", "Argentina"], "santiago": ["Santiago Metropolitan", "Chile"],
  "bogota": ["Bogota D.C.", "Colombia"], "medellin": ["Antioquia", "Colombia"],
  "lima": ["Lima Region", "Peru"], "quito": ["Pichincha", "Ecuador"],
  "caracas": ["Capital District", "Venezuela"], "montevideo": ["Montevideo Department", "Uruguay"],

  // East / Southeast Asia
  "tokyo": ["Tokyo", "Japan"], "osaka": ["Osaka", "Japan"], "nagoya": ["Aichi", "Japan"],
  "yokohama": ["Kanagawa", "Japan"],
  "seoul": ["Seoul", "South Korea"], "busan": ["Busan", "South Korea"],
  "shanghai": ["Shanghai", "China"], "beijing": ["Beijing", "China"],
  "guangzhou": ["Guangdong", "China"], "shenzhen": ["Guangdong", "China"],
  "tianjin": ["Tianjin", "China"], "chengdu": ["Sichuan", "China"],
  "hong kong": ["Hong Kong", "Hong Kong"], "macau": ["Macau", "Macau"],
  "taipei": ["Taipei", "Taiwan"], "kaohsiung": ["Kaohsiung", "Taiwan"],
  "bangkok": ["Bangkok", "Thailand"], "chiang mai": ["Chiang Mai", "Thailand"],
  "kuala lumpur": ["Federal Territory", "Malaysia"], "penang": ["Penang", "Malaysia"],
  "jakarta": ["Jakarta", "Indonesia"], "surabaya": ["East Java", "Indonesia"],
  "manila": ["Metro Manila", "Philippines"], "cebu city": ["Cebu", "Philippines"],
  "ho chi minh city": ["Ho Chi Minh City", "Vietnam"], "hanoi": ["Hanoi", "Vietnam"],
  "karachi": ["Sindh", "Pakistan"], "lahore": ["Punjab", "Pakistan"],
  "islamabad": ["Islamabad Capital Territory", "Pakistan"],

  // Oceania
  "sydney": ["New South Wales", "Australia"], "melbourne": ["Victoria", "Australia"],
  "brisbane": ["Queensland", "Australia"], "perth": ["Western Australia", "Australia"],
  "adelaide": ["South Australia", "Australia"], "canberra": ["Australian Capital Territory", "Australia"],
  "auckland": ["Auckland", "New Zealand"], "wellington": ["Wellington", "New Zealand"],

  // Africa
  "johannesburg": ["Gauteng", "South Africa"], "cape town": ["Western Cape", "South Africa"],
  "durban": ["KwaZulu-Natal", "South Africa"], "pretoria": ["Gauteng", "South Africa"],
  "cairo": ["Cairo Governorate", "Egypt"], "alexandria": ["Alexandria Governorate", "Egypt"],
  "lagos": ["Lagos State", "Nigeria"], "abuja": ["Federal Capital Territory", "Nigeria"],
  "nairobi": ["Nairobi County", "Kenya"], "casablanca": ["Casablanca-Settat", "Morocco"],
  "accra": ["Greater Accra", "Ghana"], "addis ababa": ["Addis Ababa", "Ethiopia"],
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
//
// If the City is changed to something NOT in the lookup table, State/Country
// are cleared rather than left stale — but only when they still hold exactly
// the value THIS function last auto-filled (tracked via dataset). If the
// person manually edited State/Country themselves after the auto-fill, that
// manual edit is left alone; typing a new City with no match never wipes out
// something the person deliberately typed.
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
    if (!match) {
      if (stateEl.value === (stateEl.dataset.cityAutoFilledValue || ' ')) stateEl.value = '';
      if (countryEl.value === (countryEl.dataset.cityAutoFilledValue || ' ')) countryEl.value = '';
      delete stateEl.dataset.cityAutoFilledValue;
      delete countryEl.dataset.cityAutoFilledValue;
      return;
    }
    stateEl.value = match[0];
    countryEl.value = match[1];
    stateEl.dataset.cityAutoFilledValue = match[0];
    countryEl.dataset.cityAutoFilledValue = match[1];
  });
}
