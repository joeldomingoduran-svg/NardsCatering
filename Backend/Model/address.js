// Offline check that an event venue is a plausible address inside the Philippines.
const PH_PLACES = `
abra|agusan del norte|agusan del sur|aklan|albay|antique|apayao|aurora|basilan|bataan|batanes|batangas|benguet|biliran|bohol|bukidnon|bulacan|cagayan|camarines norte|camarines sur|camiguin|capiz|catanduanes|cavite|cebu|cotabato|davao de oro|davao del norte|davao del sur|davao occidental|davao oriental|dinagat islands|eastern samar|guimaras|ifugao|ilocos norte|ilocos sur|iloilo|isabela|kalinga|la union|laguna|lanao del norte|lanao del sur|leyte|maguindanao|marinduque|masbate|misamis occidental|misamis oriental|mountain province|negros occidental|negros oriental|northern samar|nueva ecija|nueva vizcaya|occidental mindoro|oriental mindoro|palawan|pampanga|pangasinan|quezon|quirino|rizal|romblon|samar|sarangani|siquijor|sorsogon|south cotabato|southern leyte|sultan kudarat|sulu|surigao del norte|surigao del sur|tarlac|tawi-tawi|zambales|zamboanga del norte|zamboanga del sur|zamboanga sibugay|
metro manila|ncr|national capital region|calabarzon|mimaropa|bicol|ilocos region|cagayan valley|central luzon|western visayas|central visayas|eastern visayas|soccsksargen|caraga|barmm|davao region|northern mindanao|
manila|quezon city|caloocan|las pinas|makati|malabon|mandaluyong|marikina|muntinlupa|navotas|paranaque|pasay|pasig|san juan|taguig|valenzuela|pateros|
antipolo|bacoor|imus|dasmarinas|general trias|tagaytay|trece martires|kawit|rosario|silang|carmona|cavite city|noveleta|tanza|naic|indang|alfonso|amadeo|mendez|magallanes|maragondon|ternate|general mariano alvarez|gma|calamba|santa rosa|binan|san pedro|cabuyao|los banos|san pablo|bay|calauan|santa cruz|pagsanjan|lucena|batangas city|lipa|tanauan|santo tomas|nasugbu|balayan|cainta|taytay|angono|binangonan|cardona|morong|rodriguez|san mateo|tanay|teresa|baras|jala-jala|pililla|malolos|meycauayan|san jose del monte|marilao|bocaue|balagtas|guiguinto|plaridel|pulilan|baliuag|hagonoy|paombong|calumpit|bulakan|obando|norzagaray|angeles|san fernando|mabalacat|apalit|guagua|lubao|porac|arayat|magalang|floridablanca|san simon|olongapo|subic|iba|tarlac city|capas|concepcion|cabanatuan|palayan|gapan|science city of munoz|baguio|la trinidad|dagupan|alaminos|san carlos|urdaneta|laoag|vigan|candon|tuguegarao|santiago|ilagan|cauayan|bayombong|balanga|mariveles|cebu city|mandaue|lapu-lapu|talisay|danao|toledo|carcar|naga|bogo|consolacion|liloan|minglanilla|tagbilaran|dumaguete|bacolod|silay|bago|kabankalan|iloilo city|roxas|kalibo|boracay|puerto princesa|tacloban|ormoc|baybay|maasin|catbalogan|calbayog|borongan|davao city|tagum|digos|panabo|mati|general santos|koronadal|kidapawan|cotabato city|zamboanga city|pagadian|dipolog|dapitan|cagayan de oro|iligan|ozamiz|oroquieta|tangub|gingoog|butuan|cabadbaran|bayugan|surigao city|tandag|bislig|valencia|malaybalay|marawi|lamitan|jolo|legazpi|iriga|ligao|tabaco|virac|lucban|tayabas|candelaria|sariaya|mauban|infanta|boac|calapan|mamburao
`;

const FOREIGN = ['japan', 'usa', 'united states', 'america', 'china', 'korea', 'singapore', 'canada', 'australia', 'india', 'malaysia', 'thailand', 'vietnam', 'indonesia', 'england', 'united kingdom', 'dubai', 'taiwan', 'hong kong', 'new zealand', 'germany', 'france', 'italy', 'spain', 'saudi', 'qatar', 'kuwait', 'tokyo', 'seoul', 'bangkok', 'london', 'new york', 'california'];

const DETAIL_WORDS = new Set('st street ave avenue road rd blvd boulevard barangay purok sitio zone subdivision subd village phase blk block lot unit floor bldg building tower condominium condo residences compound highway hiway drive dr lane extension ext hall resort hotel church chapel plaza mall park garden gardens center centre gym clubhouse covered court pavilion function farm restaurant school cathedral parish hospital university college campus gymnasium arena stadium beach heights hills estate townhouse homes apartment'.split(' '));
const FAKE_WORDS = new Set('test testing sample lorem ipsum dolor abc abcd xyz qwe qwerty asd asdf zxc none wala basta dito address venue here home bahay street1 sample1 na nothing random sdf dfg'.split(' '));

const ABBREVIATIONS = [[/\bsta\b/g, 'santa'], [/\bsto\b/g, 'santo'], [/\bgen\b/g, 'general'], [/\bbrgy\b/g, 'barangay']];

// Road-distance estimates (in km) from Nard's Catering hub in Cainta, Rizal.
// Base transport fee: ₱500 for venues within 30 km; +₱40 for each km exceeding 30 km.
const CAINTA_BASE_FEE = 500;
const CAINTA_FREE_KM = 30;
const EXCESS_KM_RATE = 40;

const BROAD_PLACES = new Set(
  'abra|agusan del norte|agusan del sur|aklan|albay|antique|apayao|aurora|basilan|bataan|batanes|batangas|benguet|biliran|bohol|bukidnon|bulacan|cagayan|camarines norte|camarines sur|camiguin|capiz|catanduanes|cavite|cebu|cotabato|davao de oro|davao del norte|davao del sur|davao occidental|davao oriental|dinagat islands|eastern samar|guimaras|ifugao|ilocos norte|ilocos sur|iloilo|isabela|kalinga|la union|laguna|lanao del norte|lanao del sur|leyte|maguindanao|marinduque|masbate|misamis occidental|misamis oriental|mountain province|negros occidental|negros oriental|northern samar|nueva ecija|nueva vizcaya|occidental mindoro|oriental mindoro|palawan|pampanga|pangasinan|quezon|quirino|rizal|romblon|samar|sarangani|siquijor|sorsogon|south cotabato|southern leyte|sultan kudarat|sulu|surigao del norte|surigao del sur|tarlac|tawi-tawi|zambales|zamboanga del norte|zamboanga del sur|zamboanga sibugay|metro manila|ncr|national capital region|calabarzon|mimaropa|bicol|ilocos region|cagayan valley|central luzon|western visayas|central visayas|eastern visayas|soccsksargen|caraga|barmm|davao region|northern mindanao'.split('|')
);

const PLACE_DISTANCES_KM = {
  cainta: 0, taytay: 4, pasig: 7, angono: 9, antipolo: 10, marikina: 10, pateros: 10,
  mandaluyong: 12, taguig: 13, binangonan: 14, 'san juan': 14, makati: 15, 'san mateo': 15,
  'quezon city': 16, teresa: 16, cardona: 18, manila: 19, paranaque: 20, pasay: 20,
  rodriguez: 21, morong: 22, caloocan: 23, muntinlupa: 24, 'las pinas': 25, baras: 26,
  malabon: 26, navotas: 27, valenzuela: 27, 'san pedro': 29, tanay: 30,
  rizal: 18, 'metro manila': 18, ncr: 18, 'national capital region': 18,
  bacoor: 31, 'san jose del monte': 32, obando: 33, meycauayan: 33, binan: 34, pililla: 36,
  marilao: 36, imus: 37, carmona: 38, 'general mariano alvarez': 39, gma: 39,
  kawit: 40, 'santa rosa': 40, bocaue: 40, 'cavite city': 42, 'jala jala': 44, noveleta: 44,
  cabuyao: 45, dasmarinas: 46, balagtas: 46, rosario: 47, guiguinto: 48, bulakan: 49,
  norzagaray: 50, malolos: 52, 'general trias': 52, silang: 53, calamba: 54, plaridel: 54,
  paombong: 56, pulilan: 58, tanza: 58, 'trece martires': 59, baliuag: 60, hagonoy: 60,
  calumpit: 62, tagaytay: 65, 'los banos': 66, naic: 67, amadeo: 68, indang: 70, bay: 71,
  apalit: 72, mendez: 73, calauan: 74, 'santo tomas': 74, tanauan: 78, 'san simon': 78,
  'san pablo': 84, alfonso: 84, 'santa cruz': 90, lipa: 92, maragondon: 92, ternate: 94,
  'san fernando': 95, pagsanjan: 96, magallanes: 98, infanta: 105, guagua: 108, angeles: 112,
  'batangas city': 115, mabalacat: 118, lubao: 118, arayat: 118, candelaria: 122, lucban: 122,
  floridablanca: 126, porac: 126, tayabas: 128, sariaya: 130, lucena: 135, balanga: 135,
  mauban: 145, mariveles: 155, gapan: 115, cabanatuan: 140, palayan: 150, 'science city of munoz': 165,
  capas: 132, concepcion: 136, 'tarlac city': 150, subic: 155, olongapo: 165, iba: 215,
  nasugbu: 105, balayan: 120, baguio: 265, 'la trinidad': 272, dagupan: 230, urdaneta: 205,
  'san carlos': 220, alaminos: 265, santiago: 335, cauayan: 365, ilagan: 395, tuguegarao: 480,
  bayombong: 280, vigan: 405, candon: 350, laoag: 485,
  cavite: 48, laguna: 54, bulacan: 50, batangas: 115, pampanga: 105, quezon: 135,
  bataan: 145, tarlac: 150, 'nueva ecija': 140, zambales: 165, pangasinan: 215,
  benguet: 265, 'la union': 275, aurora: 245, calabarzon: 50, 'central luzon': 110
};

function computeTransportFee(distanceKm) {
  const numeric = Number(distanceKm);
  const km = Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 10) / 10 : 0;
  const excessKm = Math.max(0, Math.ceil(km - CAINTA_FREE_KM));
  const excessFee = excessKm * EXCESS_KM_RATE;
  return {
    distanceKm: km,
    freeKm: CAINTA_FREE_KM,
    excessKm,
    baseFee: CAINTA_BASE_FEE,
    excessRate: EXCESS_KM_RATE,
    excessFee,
    transportFee: CAINTA_BASE_FEE + excessFee
  };
}

function estimateDistanceFromCainta(address) {
  const raw = String(address || '').trim();
  if (!raw) return 0;
  const segments = raw.split(',').map(normalize).filter(Boolean);
  const placeSegments = segments.length >= 2 ? segments.slice(1) : segments;
  const matchedInPlace = PLACES.filter((p) => placeSegments.some((s) => hasPhrase(s, p)));
  const matched = matchedInPlace.length ? matchedInPlace : PLACES.filter((p) => hasPhrase(normalize(raw), p));
  if (!matched.length) return 0;
  const specific = matched.filter((p) => !BROAD_PLACES.has(p));
  const target = (specific.length ? specific : matched).find((p) => PLACE_DISTANCES_KM[p] !== undefined);
  if (target) return PLACE_DISTANCES_KM[target];
  return matched.some((p) => ['calabarzon', 'central luzon', 'mimaropa', 'bicol'].includes(p)) ? 65 : 18;
}

function calculateTransportFeeFromAddress(address, distanceKmOverride, options = {}) {
  const estimatedKm = estimateDistanceFromCainta(address);
  const hasOverride = distanceKmOverride !== undefined && distanceKmOverride !== null && String(distanceKmOverride).trim() !== '' && Number.isFinite(Number(distanceKmOverride)) && Number(distanceKmOverride) >= 0;
  let km = estimatedKm;
  if (hasOverride) {
    const providedKm = Number(distanceKmOverride);
    km = options.enforceFloor ? Math.max(estimatedKm, providedKm) : providedKm;
  }
  return { ...computeTransportFee(km), estimatedDistanceKm: estimatedKm };
}

function normalize(text) {
  let s = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [re, to] of ABBREVIATIONS) s = s.replace(re, to);
  return s;
}

const PLACES = [...new Set(PH_PLACES.split('|').map((p) => normalize(p)).filter(Boolean))].sort((a, b) => b.length - a.length);

const hasPhrase = (haystack, phrase) => ` ${haystack} `.includes(` ${phrase} `);

const OK_PAIRS = new Set(('bl br ch ck cl cr ct dr dg dl dm bm bd bs bt ds sd ft fl fr gl gr gn gs gh gm hn nh ht hw ks kl kr kn kw lb lc ld lf lg lk lm ln lp lt lv ls mb mp mn ms nc nd ng nk ns nt nv nj nl nw ph pl pr ps pt rb rc rd rf rg rk rl rm rn rp rs rt rv rw rh sc sh sk sl sm sn sp sq st sw tc th tr ts tw tb tg tm wh wr wn wd ws wl wk wt xp xt dv dw tl').split(' '));
const VOWELS = 'aeiouy';
const KEYBOARD_RUNS = ['qwer', 'wert', 'erty', 'asdf', 'sdfg', 'dfgh', 'fghj', 'ghjk', 'hjkl', 'zxcv', 'xcvb', 'cvbn', 'vbnm', 'abcd', 'bcde', 'cdef', 'defg'];

function looksLikeGibberish(word) {
  if (!/^[a-z]+$/.test(word)) return false;
  if (word.length >= 3 && !/[aeiouy]/.test(word) && !DETAIL_WORDS.has(word) && !['blk', 'brgy', 'lgu'].includes(word)) return true;
  if (word.length < 5) return false;
  if (!/[aeiouy]/.test(word)) return true;
  if (/(.)\1\1/.test(word) || /(.{2,4})\1\1/.test(word) || /^(.{2,4})\1+$/.test(word)) return true;
  if (/q(?!u)/.test(word) || KEYBOARD_RUNS.some((r) => word.includes(r))) return true;
  let badPairs = 0;
  for (let i = 0; i < word.length - 1; i++) {
    const a = word[i], b = word[i + 1];
    if (VOWELS.includes(a) || VOWELS.includes(b) || a === b) continue;
    if (!OK_PAIRS.has(a + b)) badPairs++;
  }
  return badPairs >= 2;
}

function validatePhilippineAddress(value) {
  const raw = String(value || '').trim().replace(/\s+/g, ' ');
  const fail = (message) => ({ valid: false, message });

  if (raw.length < 10 || raw.length > 200) return fail('Enter the complete venue address (street/barangay, city, province).');
  if (!/^[\p{L}\p{N}\s,.\-#/'()&]+$/u.test(raw)) return fail('The address contains invalid characters.');

  const full = normalize(raw);
  if (FOREIGN.some((f) => hasPhrase(full, f))) return fail('The venue must be located in the Philippines.');

  // With several comma-separated parts, the city/province cannot be only the street part.
  const segments = raw.split(',').map(normalize).filter(Boolean);
  const placeSegments = segments.length >= 2 ? segments.slice(1) : segments;
  const matched = PLACES.filter((p) => placeSegments.some((s) => hasPhrase(s, p)));
  if (!matched.length) return fail('Could not find a Philippine city or province in this address. Example: 123 Rizal St., Brgy. San Jose, Quezon City.');

  let rest = ` ${full} `;
  for (const p of matched) rest = rest.split(` ${p} `).join(' ');
  const tokens = rest.split(' ').filter((t) => t && !['philippines', 'ph', 'city', 'metro', 'barangay'].includes(t));
  if (tokens.length < 2) return fail('Add the street, subdivision or barangay together with the city/province.');
  if (tokens.some((t) => FAKE_WORDS.has(t))) return fail('The address looks invalid. Please enter the real venue address.');
  if (!rest.split(' ').some((t) => /\d/.test(t) || DETAIL_WORDS.has(t))) {
    return fail('Include a house/lot number or a street, barangay, subdivision or venue name (e.g. 123 Rizal St., Brgy. San Jose).');
  }
  if (tokens.some(looksLikeGibberish)) return fail('The address looks invalid. Please enter a real street, barangay or venue name.');

  return { valid: true, message: '', ...calculateTransportFeeFromAddress(raw) };
}

module.exports = {
  validatePhilippineAddress,
  computeTransportFee,
  estimateDistanceFromCainta,
  calculateTransportFeeFromAddress
};
