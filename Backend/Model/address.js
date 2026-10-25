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

  return { valid: true, message: '' };
}

module.exports = { validatePhilippineAddress };
