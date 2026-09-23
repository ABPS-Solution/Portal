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
  "bhiwandi": ["Maharashtra", "India"], "kalyan": ["Maharashtra", "India"],
  "dombivli": ["Maharashtra", "India"], "vasai": ["Maharashtra", "India"],
  "virar": ["Maharashtra", "India"], "ambernath": ["Maharashtra", "India"],
  "badlapur": ["Maharashtra", "India"], "ulhasnagar": ["Maharashtra", "India"],
  "malegaon": ["Maharashtra", "India"], "parbhani": ["Maharashtra", "India"],
  "jalna": ["Maharashtra", "India"], "beed": ["Maharashtra", "India"],
  "osmanabad": ["Maharashtra", "India"], "hingoli": ["Maharashtra", "India"],
  "gondia": ["Maharashtra", "India"], "bhandara": ["Maharashtra", "India"],
  "yavatmal": ["Maharashtra", "India"], "buldhana": ["Maharashtra", "India"],
  "washim": ["Maharashtra", "India"], "gadchiroli": ["Maharashtra", "India"],
  "khopoli": ["Maharashtra", "India"], "pen": ["Maharashtra", "India"],
  "taloja": ["Maharashtra", "India"], "chakan": ["Maharashtra", "India"],
  "baramati": ["Maharashtra", "India"], "shirdi": ["Maharashtra", "India"],
  "karad": ["Maharashtra", "India"], "wai": ["Maharashtra", "India"],
  "lonavala": ["Maharashtra", "India"], "alibag": ["Maharashtra", "India"],
  "dahanu": ["Maharashtra", "India"], "boisar": ["Maharashtra", "India"],
  "tarapur": ["Maharashtra", "India"], "roha": ["Maharashtra", "India"],
  "mahad": ["Maharashtra", "India"], "chiplun": ["Maharashtra", "India"],
  "amalner": ["Maharashtra", "India"], "bhusawal": ["Maharashtra", "India"],
  "shirpur": ["Maharashtra", "India"], "nandurbar": ["Maharashtra", "India"],

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
  "gandhidham": ["Gujarat", "India"], "kandla": ["Gujarat", "India"],
  "bhuj": ["Gujarat", "India"], "porbandar": ["Gujarat", "India"],
  "surendranagar": ["Gujarat", "India"], "patan": ["Gujarat", "India"],
  "palanpur": ["Gujarat", "India"], "godhra": ["Gujarat", "India"],
  "dahod": ["Gujarat", "India"], "veraval": ["Gujarat", "India"],
  "amreli": ["Gujarat", "India"], "botad": ["Gujarat", "India"],
  "dhoraji": ["Gujarat", "India"], "gondal": ["Gujarat", "India"],
  "jetpur": ["Gujarat", "India"], "wankaner": ["Gujarat", "India"],
  "sanand": ["Gujarat", "India"], "halol": ["Gujarat", "India"],
  "dahej": ["Gujarat", "India"], "hazira": ["Gujarat", "India"],
  "silvassa": ["Dadra and Nagar Haveli and Daman and Diu", "India"],
  "daman": ["Dadra and Nagar Haveli and Daman and Diu", "India"],

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
  "gulbarga": ["Karnataka", "India"], "kalaburagi": ["Karnataka", "India"],
  "bagalkot": ["Karnataka", "India"], "bijapur": ["Karnataka", "India"],
  "vijayapura": ["Karnataka", "India"], "chitradurga": ["Karnataka", "India"],
  "kolar": ["Karnataka", "India"], "mandya": ["Karnataka", "India"],
  "chikmagalur": ["Karnataka", "India"], "gadag": ["Karnataka", "India"],
  "haveri": ["Karnataka", "India"], "koppal": ["Karnataka", "India"],
  "yadgir": ["Karnataka", "India"], "ramanagara": ["Karnataka", "India"],
  "dandeli": ["Karnataka", "India"], "bhadravati": ["Karnataka", "India"],
  "harihar": ["Karnataka", "India"], "electronic city": ["Karnataka", "India"],
  "whitefield": ["Karnataka", "India"],

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
  "nagercoil": ["Tamil Nadu", "India"], "kanchipuram": ["Tamil Nadu", "India"],
  "cuddalore": ["Tamil Nadu", "India"], "kumbakonam": ["Tamil Nadu", "India"],
  "rajapalayam": ["Tamil Nadu", "India"], "pollachi": ["Tamil Nadu", "India"],
  "namakkal": ["Tamil Nadu", "India"], "tiruppur": ["Tamil Nadu", "India"],
  "ambur": ["Tamil Nadu", "India"], "krishnagiri": ["Tamil Nadu", "India"],
  "sriperumbudur": ["Tamil Nadu", "India"], "oragadam": ["Tamil Nadu", "India"],
  "neyveli": ["Tamil Nadu", "India"], "mettur": ["Tamil Nadu", "India"],
  "theni": ["Tamil Nadu", "India"], "virudhunagar": ["Tamil Nadu", "India"],
  "ariyalur": ["Tamil Nadu", "India"], "perambalur": ["Tamil Nadu", "India"],
  "gummidipoondi": ["Tamil Nadu", "India"], "ranipettai": ["Tamil Nadu", "India"],

  // Telangana / Andhra Pradesh
  "hyderabad": ["Telangana", "India"], "warangal": ["Telangana", "India"],
  "nizamabad": ["Telangana", "India"], "karimnagar": ["Telangana", "India"],
  "khammam": ["Telangana", "India"], "secunderabad": ["Telangana", "India"],
  "visakhapatnam": ["Andhra Pradesh", "India"], "vizag": ["Andhra Pradesh", "India"],
  "vijayawada": ["Andhra Pradesh", "India"], "guntur": ["Andhra Pradesh", "India"],
  "nellore": ["Andhra Pradesh", "India"], "kurnool": ["Andhra Pradesh", "India"],
  "kakinada": ["Andhra Pradesh", "India"], "rajahmundry": ["Andhra Pradesh", "India"],
  "tirupati": ["Andhra Pradesh", "India"], "anantapur": ["Andhra Pradesh", "India"],
  "adilabad": ["Telangana", "India"], "mahbubnagar": ["Telangana", "India"],
  "nalgonda": ["Telangana", "India"], "suryapet": ["Telangana", "India"],
  "siddipet": ["Telangana", "India"], "medak": ["Telangana", "India"],
  "sangareddy": ["Telangana", "India"], "hyderabad-patancheru": ["Telangana", "India"],
  "patancheru": ["Telangana", "India"], "ramagundam": ["Telangana", "India"],
  "kadapa": ["Andhra Pradesh", "India"], "chittoor": ["Andhra Pradesh", "India"],
  "eluru": ["Andhra Pradesh", "India"], "machilipatnam": ["Andhra Pradesh", "India"],
  "srikakulam": ["Andhra Pradesh", "India"], "ongole": ["Andhra Pradesh", "India"],
  "amaravati": ["Andhra Pradesh", "India"],

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
  "greater noida": ["Uttar Pradesh", "India"], "bulandshahr": ["Uttar Pradesh", "India"],
  "shahjahanpur": ["Uttar Pradesh", "India"], "faizabad": ["Uttar Pradesh", "India"],
  "ayodhya": ["Uttar Pradesh", "India"], "sultanpur": ["Uttar Pradesh", "India"],
  "raebareli": ["Uttar Pradesh", "India"], "unnao": ["Uttar Pradesh", "India"],
  "etawah": ["Uttar Pradesh", "India"], "mainpuri": ["Uttar Pradesh", "India"],
  "hapur": ["Uttar Pradesh", "India"], "hathras": ["Uttar Pradesh", "India"],
  "budaun": ["Uttar Pradesh", "India"], "orai": ["Uttar Pradesh", "India"],
  "banda": ["Uttar Pradesh", "India"], "fatehpur": ["Uttar Pradesh", "India"],
  "mirzapur": ["Uttar Pradesh", "India"], "bhadohi": ["Uttar Pradesh", "India"],
  "azamgarh": ["Uttar Pradesh", "India"], "basti": ["Uttar Pradesh", "India"],
  "deoria": ["Uttar Pradesh", "India"], "ballia": ["Uttar Pradesh", "India"],
  "kanpur dehat": ["Uttar Pradesh", "India"], "sikandrabad": ["Uttar Pradesh", "India"],
  "loni": ["Uttar Pradesh", "India"],

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
  "kaithal": ["Haryana", "India"], "kurukshetra": ["Haryana", "India"],
  "sirsa": ["Haryana", "India"], "bhiwani": ["Haryana", "India"],
  "jind": ["Haryana", "India"], "rewari": ["Haryana", "India"],
  "palwal": ["Haryana", "India"], "dharuhera": ["Haryana", "India"],
  "manesar": ["Haryana", "India"], "narnaul": ["Haryana", "India"],
  "fatehabad": ["Haryana", "India"], "pinjore": ["Haryana", "India"],
  "baddi-panchkula": ["Haryana", "India"], "panchkula": ["Haryana", "India"],

  // Rajasthan
  "jaipur": ["Rajasthan", "India"], "jodhpur": ["Rajasthan", "India"],
  "udaipur": ["Rajasthan", "India"], "kota": ["Rajasthan", "India"],
  "ajmer": ["Rajasthan", "India"], "bikaner": ["Rajasthan", "India"],
  "alwar": ["Rajasthan", "India"], "bhilwara": ["Rajasthan", "India"],
  "sikar": ["Rajasthan", "India"], "pali": ["Rajasthan", "India"],
  "bharatpur": ["Rajasthan", "India"], "sri ganganagar": ["Rajasthan", "India"],
  "ganganagar": ["Rajasthan", "India"], "hanumangarh": ["Rajasthan", "India"],
  "churu": ["Rajasthan", "India"], "jhunjhunu": ["Rajasthan", "India"],
  "nagaur": ["Rajasthan", "India"], "tonk": ["Rajasthan", "India"],
  "sawai madhopur": ["Rajasthan", "India"], "banswara": ["Rajasthan", "India"],
  "chittorgarh": ["Rajasthan", "India"], "dausa": ["Rajasthan", "India"],
  "barmer": ["Rajasthan", "India"], "jaisalmer": ["Rajasthan", "India"],
  "neemrana": ["Rajasthan", "India"], "kishangarh": ["Rajasthan", "India"],
  "beawar": ["Rajasthan", "India"], "bhiwadi-alwar": ["Rajasthan", "India"],

  // West Bengal
  "kolkata": ["West Bengal", "India"], "howrah": ["West Bengal", "India"],
  "durgapur": ["West Bengal", "India"], "asansol": ["West Bengal", "India"],
  "siliguri": ["West Bengal", "India"], "kharagpur": ["West Bengal", "India"],
  "haldia": ["West Bengal", "India"],
  "bardhaman": ["West Bengal", "India"], "burdwan": ["West Bengal", "India"],
  "malda": ["West Bengal", "India"], "baharampur": ["West Bengal", "India"],
  "krishnanagar": ["West Bengal", "India"], "raiganj": ["West Bengal", "India"],
  "jalpaiguri": ["West Bengal", "India"], "cooch behar": ["West Bengal", "India"],
  "bankura": ["West Bengal", "India"], "purulia": ["West Bengal", "India"],
  "midnapore": ["West Bengal", "India"], "santipur": ["West Bengal", "India"],
  "rishra": ["West Bengal", "India"], "naihati": ["West Bengal", "India"],
  "kalyani": ["West Bengal", "India"], "barrackpore": ["West Bengal", "India"],

  // Madhya Pradesh
  "indore": ["Madhya Pradesh", "India"], "bhopal": ["Madhya Pradesh", "India"],
  "jabalpur": ["Madhya Pradesh", "India"], "gwalior": ["Madhya Pradesh", "India"],
  "ujjain": ["Madhya Pradesh", "India"], "sagar": ["Madhya Pradesh", "India"],
  "dewas": ["Madhya Pradesh", "India"], "satna": ["Madhya Pradesh", "India"],
  "ratlam": ["Madhya Pradesh", "India"], "rewa": ["Madhya Pradesh", "India"],
  "pithampur": ["Madhya Pradesh", "India"],
  "mandsaur": ["Madhya Pradesh", "India"], "neemuch": ["Madhya Pradesh", "India"],
  "chhindwara": ["Madhya Pradesh", "India"], "singrauli": ["Madhya Pradesh", "India"],
  "burhanpur": ["Madhya Pradesh", "India"], "khandwa": ["Madhya Pradesh", "India"],
  "khargone": ["Madhya Pradesh", "India"], "shivpuri": ["Madhya Pradesh", "India"],
  "vidisha": ["Madhya Pradesh", "India"], "guna": ["Madhya Pradesh", "India"],
  "morena": ["Madhya Pradesh", "India"], "damoh": ["Madhya Pradesh", "India"],
  "katni": ["Madhya Pradesh", "India"], "mandla": ["Madhya Pradesh", "India"],
  "betul": ["Madhya Pradesh", "India"], "seoni": ["Madhya Pradesh", "India"],

  // Bihar / Jharkhand
  "patna": ["Bihar", "India"], "gaya": ["Bihar", "India"],
  "bhagalpur": ["Bihar", "India"], "muzaffarpur": ["Bihar", "India"],
  "darbhanga": ["Bihar", "India"],
  "ranchi": ["Jharkhand", "India"], "jamshedpur": ["Jharkhand", "India"],
  "dhanbad": ["Jharkhand", "India"], "bokaro": ["Jharkhand", "India"],
  "bihar sharif": ["Bihar", "India"], "arrah": ["Bihar", "India"],
  "begusarai": ["Bihar", "India"], "chhapra": ["Bihar", "India"],
  "katihar": ["Bihar", "India"], "munger": ["Bihar", "India"],
  "purnia": ["Bihar", "India"], "sasaram": ["Bihar", "India"],
  "hajipur": ["Bihar", "India"], "siwan": ["Bihar", "India"],
  "jamalpur": ["Bihar", "India"], "motihari": ["Bihar", "India"],
  "deoghar": ["Jharkhand", "India"], "hazaribagh": ["Jharkhand", "India"],
  "giridih": ["Jharkhand", "India"], "ramgarh": ["Jharkhand", "India"],
  "dumka": ["Jharkhand", "India"], "adityapur": ["Jharkhand", "India"],
  "jugsalai": ["Jharkhand", "India"],

  // Punjab
  "ludhiana": ["Punjab", "India"], "amritsar": ["Punjab", "India"],
  "jalandhar": ["Punjab", "India"], "patiala": ["Punjab", "India"],
  "bathinda": ["Punjab", "India"], "mohali": ["Punjab", "India"],
  "chandigarh": ["Chandigarh", "India"],
  "hoshiarpur": ["Punjab", "India"], "moga": ["Punjab", "India"],
  "pathankot": ["Punjab", "India"], "abohar": ["Punjab", "India"],
  "malerkotla": ["Punjab", "India"], "khanna": ["Punjab", "India"],
  "phagwara": ["Punjab", "India"], "muktsar": ["Punjab", "India"],
  "barnala": ["Punjab", "India"], "rajpura": ["Punjab", "India"],
  "kapurthala": ["Punjab", "India"], "gurdaspur": ["Punjab", "India"],
  "sangrur": ["Punjab", "India"], "derabassi": ["Punjab", "India"],
  "zirakpur": ["Punjab", "India"],

  // Kerala
  "kochi": ["Kerala", "India"], "cochin": ["Kerala", "India"],
  "thiruvananthapuram": ["Kerala", "India"], "kozhikode": ["Kerala", "India"],
  "calicut": ["Kerala", "India"], "thrissur": ["Kerala", "India"],
  "kollam": ["Kerala", "India"], "alappuzha": ["Kerala", "India"],
  "palakkad": ["Kerala", "India"],
  "kannur": ["Kerala", "India"], "kottayam": ["Kerala", "India"],
  "malappuram": ["Kerala", "India"], "kasaragod": ["Kerala", "India"],
  "pathanamthitta": ["Kerala", "India"], "idukki": ["Kerala", "India"],
  "wayanad": ["Kerala", "India"], "ernakulam": ["Kerala", "India"],

  // Odisha
  "bhubaneswar": ["Odisha", "India"], "cuttack": ["Odisha", "India"],
  "rourkela": ["Odisha", "India"], "brahmapur": ["Odisha", "India"],
  "sambalpur": ["Odisha", "India"], "angul": ["Odisha", "India"],
  "berhampur": ["Odisha", "India"], "puri": ["Odisha", "India"],
  "balasore": ["Odisha", "India"], "baripada": ["Odisha", "India"],
  "jharsuguda": ["Odisha", "India"], "jeypore": ["Odisha", "India"],
  "dhenkanal": ["Odisha", "India"], "kendujhar": ["Odisha", "India"],
  "paradip": ["Odisha", "India"], "talcher": ["Odisha", "India"],

  // Chhattisgarh
  "raipur": ["Chhattisgarh", "India"], "bhilai": ["Chhattisgarh", "India"],
  "bilaspur": ["Chhattisgarh", "India"], "durg": ["Chhattisgarh", "India"],
  "korba": ["Chhattisgarh", "India"], "raigarh": ["Chhattisgarh", "India"],
  "rajnandgaon": ["Chhattisgarh", "India"], "jagdalpur": ["Chhattisgarh", "India"],
  "ambikapur": ["Chhattisgarh", "India"], "dhamtari": ["Chhattisgarh", "India"],

  // Assam / NE
  "guwahati": ["Assam", "India"], "dibrugarh": ["Assam", "India"],
  "silchar": ["Assam", "India"], "jorhat": ["Assam", "India"],
  "shillong": ["Meghalaya", "India"], "imphal": ["Manipur", "India"],
  "agartala": ["Tripura", "India"], "aizawl": ["Mizoram", "India"],
  "itanagar": ["Arunachal Pradesh", "India"], "kohima": ["Nagaland", "India"],
  "gangtok": ["Sikkim", "India"],
  "tezpur": ["Assam", "India"], "nagaon": ["Assam", "India"],
  "tinsukia": ["Assam", "India"], "bongaigaon": ["Assam", "India"],

  // Uttarakhand / Himachal
  "dehradun": ["Uttarakhand", "India"], "haridwar": ["Uttarakhand", "India"],
  "rudrapur": ["Uttarakhand", "India"], "roorkee": ["Uttarakhand", "India"],
  "kashipur": ["Uttarakhand", "India"], "haldwani": ["Uttarakhand", "India"],
  "shimla": ["Himachal Pradesh", "India"], "baddi": ["Himachal Pradesh", "India"],
  "solan": ["Himachal Pradesh", "India"],
  "rishikesh": ["Uttarakhand", "India"], "nainital": ["Uttarakhand", "India"],
  "pantnagar": ["Uttarakhand", "India"], "sitarganj": ["Uttarakhand", "India"],
  "kotdwar": ["Uttarakhand", "India"], "mandi": ["Himachal Pradesh", "India"],
  "una": ["Himachal Pradesh", "India"], "paonta sahib": ["Himachal Pradesh", "India"],
  "kala amb": ["Himachal Pradesh", "India"],

  // J&K / Ladakh
  "srinagar": ["Jammu and Kashmir", "India"], "jammu": ["Jammu and Kashmir", "India"],
  "leh": ["Ladakh", "India"], "samba": ["Jammu and Kashmir", "India"],
  "udhampur": ["Jammu and Kashmir", "India"], "kathua": ["Jammu and Kashmir", "India"],

  // Goa
  "panaji": ["Goa", "India"], "panjim": ["Goa", "India"], "margao": ["Goa", "India"],
  "vasco da gama": ["Goa", "India"], "mapusa": ["Goa", "India"],
  "ponda": ["Goa", "India"], "verna": ["Goa", "India"],

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
// Accepts element ids or the elements themselves (lead View Details
// builds its inputs dynamically, without ids).
function wireCityAutoFillStateCountry(cityInputId, stateInputId, countryInputId) {
  const pick = x => (typeof x === 'string' ? document.getElementById(x) : x);
  const cityEl = pick(cityInputId);
  const stateEl = pick(stateInputId);
  const countryEl = pick(countryInputId);
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
