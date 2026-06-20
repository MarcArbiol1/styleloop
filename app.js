const STORAGE_KEY = "styleloop-state-v1";

// Vision model used to actually look at uploaded outfit photos.
// Uses Google's Gemini API (free tier at aistudio.google.com). The browser calls
// the API directly with a key you paste once (stored in localStorage on this machine only).
// NOTE: fine for local testing; for a public deployment, move the key behind a backend.
const VISION_CONFIG = {
  enabled: true,
  endpointBase: "https://generativelanguage.googleapis.com/v1beta/models",
  model: "gemini-2.5-flash",
  keyStorageKey: "styleloop-gemini-key",
};

// Local FashionCLIP + sqlite-vec visual-similarity backend (see /backend).
// Gemini still does the photo breakdown; this does the "Find similar" matching.
const SEARCH_CONFIG = {
  endpoint: "http://localhost:8008/search",
  catalogEndpoint: "http://localhost:8008/catalog_search",
  whereEndpoint: "http://localhost:8008/where",
  calendarEndpoint: "http://localhost:8008/calendar",
};

// Where the user's pasted calendar (iCal/ICS) link is remembered.
const CALENDAR_URL_KEY = "styleloop-cal-url";

// Holds the latest "Search catalog" results (real products from the local backend),
// so the Add-to-closet handler can find the clicked product by index.
let catalogResults = [];

// Returns the stored Gemini API key, prompting for it the first time.
function getVisionApiKey() {
  let key = "";
  try {
    key = localStorage.getItem(VISION_CONFIG.keyStorageKey) || "";
  } catch (error) {
    key = "";
  }
  if (!key) {
    key = (window.prompt("Paste your Google AI Studio (Gemini) API key (free at aistudio.google.com, stored only in this browser):") || "").trim();
    if (key) {
      try {
        localStorage.setItem(VISION_CONFIG.keyStorageKey, key);
      } catch (error) {
        /* ignore storage failures */
      }
    }
  }
  return key;
}

function clearVisionApiKey() {
  try {
    localStorage.removeItem(VISION_CONFIG.keyStorageKey);
  } catch (error) {
    /* ignore */
  }
}

const colorMap = {
  black: "#1f1f1f",
  white: "#f7f4ea",
  blue: "#4e78a6",
  navy: "#253a5c",
  grey: "#8c8c87",
  gray: "#8c8c87",
  green: "#637b4f",
  cream: "#eee1c8",
  beige: "#c7b38d",
  brown: "#76533d",
  red: "#a74432",
  pink: "#ca8495",
  denim: "#587aa1",
  silver: "#c7c9c8",
  tan: "#b78b5e",
};

const cropMap = {
  Top: "50% 28%",
  Bottom: "50% 63%",
  Shoes: "50% 92%",
  Outerwear: "50% 35%",
  Accessory: "78% 42%",
  Dress: "50% 48%",
};

const catalog = [
  {
    name: "White ribbed tank",
    category: "Top",
    color: "white",
    price: 22,
    source: "New",
    brand: "Uniqlo",
    url: "https://www.uniqlo.com/us/en/search?q=white%20ribbed%20tank",
    image: "https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Black oversized blazer",
    category: "Outerwear",
    color: "black",
    price: 79,
    source: "Secondhand",
    brand: "Zara",
    url: "https://www.zara.com/search?searchTerm=black%20oversized%20blazer",
    image: "https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Straight blue jeans",
    category: "Bottom",
    color: "blue",
    price: 54,
    source: "New",
    brand: "Levi's",
    url: "https://www.levi.com/US/en_US/search/straight%20jeans",
    image: "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Black loafers",
    category: "Shoes",
    color: "black",
    price: 88,
    source: "Sustainable",
    brand: "Vivaia",
    url: "https://www.vivaia.com/search?q=black%20loafers",
    image: "https://images.unsplash.com/photo-1614252369475-531eba835eb1?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Grey zip hoodie",
    category: "Top",
    color: "grey",
    price: 42,
    source: "New",
    brand: "Nike",
    url: "https://www.nike.com/w?q=grey%20zip%20hoodie",
    image: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Cream canvas belt",
    category: "Accessory",
    color: "cream",
    price: 18,
    source: "New",
    brand: "Muji",
    url: "https://www.muji.us/search?q=canvas%20belt",
    image: "https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Navy wool coat",
    category: "Outerwear",
    color: "navy",
    price: 140,
    source: "Secondhand",
    brand: "COS",
    url: "https://www.cos.com/en_usd/search.html?q=navy%20wool%20coat",
    image: "https://images.unsplash.com/photo-1544022613-e87ca75a784a?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Nike Air Force 1 '07 White",
    category: "Shoes",
    color: "white",
    price: 115,
    source: "Sustainable",
    brand: "Nike",
    model: "Air Force 1 '07",
    exactName: "Nike Air Force 1 '07 White",
    url: "https://www.nike.com/w?q=air%20force%201%20white",
    image: "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=80",
    tags: ["nike", "air-force-1", "af1", "white-sneaker", "streetwear", "classic"],
  },
  {
    name: "Black straight trousers",
    category: "Bottom",
    color: "black",
    price: 58,
    source: "New",
    brand: "Mango",
    url: "https://shop.mango.com/us/search?kw=black%20straight%20trousers",
    image: "https://images.unsplash.com/photo-1506629905607-d405b7a30db9?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Silver hoop earrings",
    category: "Accessory",
    color: "silver",
    price: 16,
    source: "New",
    brand: "Local",
    url: "https://www.etsy.com/search?q=silver%20hoop%20earrings",
    image: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Brown leather belt",
    category: "Accessory",
    color: "brown",
    price: 28,
    source: "Secondhand",
    brand: "Vintage",
    url: "https://www.ebay.com/sch/i.html?_nkw=brown+leather+belt",
    image: "https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=900&q=80",
  },
  {
    name: "Green cropped jacket",
    category: "Outerwear",
    color: "green",
    price: 96,
    source: "New",
    brand: "Weekday",
    url: "https://www.weekday.com/search.html?q=green%20jacket",
    image: "https://images.unsplash.com/photo-1520975954732-35dd22299614?auto=format&fit=crop&w=900&q=80",
  },
];

const seedItems = [
  { name: "white sneakers", category: "Shoes", color: "white", price: 70, wears: 34 },
  { name: "black jeans", category: "Bottom", color: "black", price: 62, wears: 22 },
  { name: "grey hoodie", category: "Top", color: "grey", price: 48, wears: 28 },
  { name: "blue straight jeans", category: "Bottom", color: "blue", price: 74, wears: 17 },
  { name: "black leather jacket", category: "Outerwear", color: "black", price: 180, wears: 12 },
  { name: "white button shirt", category: "Top", color: "white", price: 45, wears: 19 },
];

let webSearchResults = [];

const state = loadState();

let currentAnalysis = null;
let currentOutfits = [];
let currentOotdDetection = [];
let selectedMood = "chill";

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    return {
      closet: parsed.closet || [],
      inspirations: parsed.inspirations || [],
      outfits: parsed.outfits || [],
      ootds: parsed.ootds || [],
      styleSignals: parsed.styleSignals || ["minimal", "streetwear", "clean lines", "neutral base", "relaxed fit"],
      context: parsed.context || {
        weather: { label: "62°F / 17°C, light rain", temp: 62, tempC: 17, condition: "Light rain", detail: "Demo weather is active until you sync location." },
        calendar: { label: "Class at 10:00", type: "School", detail: "Used to pick outfit comfort, formality, and commute needs." },
      },
    };
  }

  return {
    closet: [],
    inspirations: [],
    outfits: [],
    ootds: [],
    styleSignals: ["minimal", "streetwear", "clean lines", "neutral base", "relaxed fit"],
    context: {
      weather: { label: "62°F / 17°C, light rain", temp: 62, tempC: 17, condition: "Light rain", detail: "Demo weather is active until you sync location." },
      calendar: { label: "Class at 10:00", type: "School", detail: "Used to pick outfit comfort, formality, and commute needs." },
    },
  };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // localStorage is ~5MB; uploaded photos stored as base64 can blow the quota
    // and previously crashed the analyze flow. Strip embedded base64 image data
    // (keep normal http image URLs) and retry so saving never throws.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stripBase64Images(state)));
    } catch (error2) {
      console.warn("StyleLoop: storage full — continuing without persisting this state.", error2);
    }
  }
}

// Deep copy with base64 "data:" image strings blanked out, to stay under quota.
function stripBase64Images(value) {
  return JSON.parse(
    JSON.stringify(value),
    (key, val) => (typeof val === "string" && val.startsWith("data:") ? "" : val)
  );
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function titleCase(value) {
  return String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function colorValue(color) {
  return colorMap[normalize(color)] || "#d8d1c2";
}

function money(value) {
  return `$${Number(value || 0).toFixed(0)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const semanticAliases = {
  smart: ["work", "classic", "tailored", "office", "formal", "clean"],
  office: ["work", "smart", "tailored", "blazer", "trouser", "classic"],
  date: ["going-out", "polished", "black", "accessory", "evening"],
  party: ["going-out", "bold", "statement", "evening", "accessory"],
  school: ["casual", "comfortable", "daily", "sneaker", "denim"],
  travel: ["comfortable", "layer", "sneaker", "practical", "easy"],
  rain: ["water-resistant", "outerwear", "layer", "dark"],
  cold: ["warm", "coat", "outerwear", "layer", "wool"],
  hot: ["breathable", "lightweight", "tank", "white", "minimal"],
  streetwear: ["oversized", "hoodie", "sneaker", "denim", "casual"],
  minimal: ["clean", "neutral", "white", "black", "classic"],
  classic: ["tailored", "clean", "work", "button", "loafer"],
  chill: ["casual", "comfortable", "hoodie", "denim", "sneaker"],
};

function semanticTokens(itemOrText) {
  const raw = typeof itemOrText === "string"
    ? itemOrText
    : [
        itemOrText.name,
        itemOrText.category,
        itemOrText.color,
        itemOrText.brand,
        itemOrText.source,
        itemOrText.vibe,
        ...(itemOrText.tags || []),
      ].join(" ");
  const base = normalize(raw)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
  const expanded = base.flatMap((token) => [token, ...(semanticAliases[token] || [])]);
  return expanded;
}

function vectorize(itemOrText) {
  return semanticTokens(itemOrText).reduce((vector, token) => {
    vector[token] = (vector[token] || 0) + 1;
    return vector;
  }, {});
}

function cosineSimilarity(a, b) {
  const av = typeof a === "string" || !a.__vector ? vectorize(a) : a.__vector;
  const bv = typeof b === "string" || !b.__vector ? vectorize(b) : b.__vector;
  const keys = new Set([...Object.keys(av), ...Object.keys(bv)]);
  let dot = 0;
  let amag = 0;
  let bmag = 0;
  keys.forEach((key) => {
    dot += (av[key] || 0) * (bv[key] || 0);
    amag += (av[key] || 0) ** 2;
    bmag += (bv[key] || 0) ** 2;
  });
  if (!amag || !bmag) return 0;
  return dot / (Math.sqrt(amag) * Math.sqrt(bmag));
}

function enrichItem(item) {
  const tags = [...new Set([
    normalize(item.color),
    normalize(item.category),
    ...semanticTokens(item.name),
    ...semanticTokens(item.category),
  ])].filter(Boolean);
  return {
    ...item,
    tags: [...new Set([...(item.tags || []), ...tags])],
    __vector: vectorize({ ...item, tags }),
  };
}

function semanticScore(item, query, options = {}) {
  let score = cosineSimilarity(enrichItem(item), query);
  if (options.category && options.category !== "All" && item.category === options.category) score += 0.2;
  if (options.color && normalize(item.color) === normalize(options.color)) score += 0.16;
  if (options.budget && item.price && item.price <= options.budget) score += 0.08;
  if (options.preferSecondhand && item.source === "Secondhand") score += 0.08;
  if (options.requiredCategory && item.category === options.requiredCategory) score += 0.28;
  return score;
}

function semanticRank(items, query, options = {}) {
  return items
    .map((item) => ({ ...enrichItem(item), matchScore: semanticScore(item, query, options) }))
    .sort((a, b) => b.matchScore - a.matchScore);
}

function findOwnedMatch(piece) {
  const ranked = semanticRank(
    state.closet.filter((item) => item.category === piece.category),
    `${piece.name} ${piece.color} ${piece.category} ${(piece.tags || []).join(" ")}`,
    { category: piece.category, color: piece.color }
  );
  return ranked.find((item) => item.matchScore >= 0.42) || null;
}

function addClosetItem(item) {
  const clean = {
    id: uid("closet"),
    name: normalize(item.name) || "untitled item",
    category: item.category || "Top",
    color: normalize(item.color) || inferColor(item.name),
    price: Number(item.price || 0),
    wears: Number(item.wears || 0),
    source: item.source || "Manual",
    image: item.image || productForPiece(item)?.image || "",
    url: item.url || productForPiece(item)?.url || "",
    tags: item.tags || semanticTokens(`${item.name} ${item.category} ${item.color}`),
    createdAt: new Date().toISOString(),
  };
  state.closet.unshift(clean);
  saveState();
  renderAll();
  return clean;
}

function inferColor(text) {
  const lower = normalize(text);
  return Object.keys(colorMap).find((color) => lower.includes(color)) || "black";
}

function inferCategory(text) {
  const lower = normalize(text);
  if (/(shoe|sneaker|boot|loafer|heel|airforce|air force|af1|samba)/.test(lower)) return "Shoes";
  if (/(jean|pant|trouser|skirt|short)/.test(lower)) return "Bottom";
  if (/(coat|jacket|blazer|cardigan)/.test(lower)) return "Outerwear";
  if (/(belt|bag|hat|earring|necklace|watch)/.test(lower)) return "Accessory";
  if (/(dress)/.test(lower)) return "Dress";
  return "Top";
}

function productForPiece(piece) {
  const exact = catalog.find((product) => normalize(product.name) === normalize(piece.name));
  if (exact) return exact;
  const ranked = semanticRank(catalog, `${piece.name} ${piece.color} ${piece.category} ${(piece.tags || []).join(" ")}`, {
    category: piece.category,
    color: piece.color,
  });
  return ranked.find((product) => product.matchScore >= 0.34) || null;
}

function inferPrice(query, index) {
  const lower = normalize(query);
  let base = 42;
  if (/(coat|jacket|blazer|boot|leather)/.test(lower)) base = 95;
  if (/(sneaker|shoe|loafer|samba|adidas|nike)/.test(lower)) base = 82;
  if (/(belt|hat|bag|earring|necklace|accessory)/.test(lower)) base = 28;
  if (/(jean|trouser|cargo|pant|skirt)/.test(lower)) base = 58;
  return Math.max(15, base + index * 13);
}

function vlmTagsForPiece(piece, vibe) {
  const text = normalize(`${piece.name} ${piece.category} ${piece.color} ${vibe}`);
  const tags = [piece.category, piece.color, vibe];
  if (/(oversized|hoodie|sneaker|denim|jeans)/.test(text)) tags.push("streetwear", "casual", "comfortable");
  if (/(blazer|trouser|button|loafer|coat)/.test(text)) tags.push("tailored", "smart", "polished");
  if (/(tank|ribbed|white|cream)/.test(text)) tags.push("minimal", "lightweight", "clean");
  if (/(wool|coat|jacket|outerwear)/.test(text)) tags.push("warm", "layer", "cold");
  if (/(belt|earring|accessory)/.test(text)) tags.push("finishing-piece", "detail", "unlock");
  return [...new Set(tags.map(normalize).filter(Boolean))];
}

function simulateAnalysis(sourceName = "", sourceImage = "") {
  const sets = [
    {
      vibe: "minimal streetwear",
      pieces: [
        { name: "white ribbed tank top", category: "Top", color: "white", fit: "fitted", material: "cotton rib" },
        { name: "straight blue jeans", category: "Bottom", color: "blue", fit: "straight", material: "denim" },
        { name: "black oversized blazer", category: "Outerwear", color: "black", fit: "oversized", material: "woven" },
        { name: "white leather low-top sneakers", category: "Shoes", color: "white", fit: "low profile", material: "leather" },
        { name: "silver hoop earrings", category: "Accessory", color: "silver", fit: "small", material: "metal" },
      ],
    },
    {
      vibe: "soft casual",
      pieces: [
        { name: "grey hoodie", category: "Top", color: "grey", fit: "relaxed", material: "fleece" },
        { name: "black straight trousers", category: "Bottom", color: "black", fit: "straight", material: "twill" },
        { name: "navy wool coat", category: "Outerwear", color: "navy", fit: "longline", material: "wool" },
        { name: "white leather low-top sneakers", category: "Shoes", color: "white", fit: "low profile", material: "leather" },
        { name: "cream canvas belt", category: "Accessory", color: "cream", fit: "adjustable", material: "canvas" },
      ],
    },
    {
      vibe: "clean classic",
      pieces: [
        { name: "white button shirt", category: "Top", color: "white", fit: "classic", material: "cotton poplin" },
        { name: "black jeans", category: "Bottom", color: "black", fit: "straight", material: "denim" },
        { name: "green cropped jacket", category: "Outerwear", color: "green", fit: "cropped", material: "canvas" },
        { name: "white low-profile sneakers", category: "Shoes", color: "white", fit: "low profile", material: "leather" },
        { name: "brown leather belt", category: "Accessory", color: "brown", fit: "classic", material: "leather" },
      ],
    },
  ];
  const hash = normalize(sourceName)
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const selected = sets[hash % sets.length];
  return buildAnalysis(sourceName, sourceImage, selected.vibe, selected.pieces);
}

// The most specific descriptor we have for an item: the exact product name when
// confirmed, otherwise brand + model + color + material + name (de-duplicated).
function exactItemQuery(piece) {
  if (piece?.exactName) return piece.exactName.trim();
  const seen = new Set();
  return [piece?.brand, piece?.model, piece?.color, piece?.material, piece?.name]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .filter((word) => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}

// Precise Google Shopping search — the fallback when we can't resolve a direct link.
function shoppingSearchUrl(query, piece) {
  const term = (query || exactItemQuery(piece) || "").trim();
  if (!term) return "";
  return `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(term)}`;
}

// Visual-similarity search via the local FashionCLIP + sqlite-vec backend.
// Sends the source photo and the item's bounding box; the backend crops to the
// garment, embeds it with FashionCLIP, and returns the nearest catalog products.
async function searchSimilar(piece) {
  const response = await fetch(SEARCH_CONFIG.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: currentAnalysis?.image || piece.image || "",
      box: Array.isArray(piece.box) && piece.box.length === 4 ? piece.box : null,
      category: piece.category || null,
      color: piece.color || null,
      k: 8,
    }),
  });
  if (!response.ok) throw new Error(`backend ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.matches) ? data.matches : [];
}

// --- "Find similar" modal (in-app, dark/blue, matches the app design) ---
function ensureExactModal() {
  let modal = document.querySelector("#exact-modal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.id = "exact-modal";
  modal.className = "exact-modal-backdrop hidden";
  modal.innerHTML = `
    <div class="exact-modal-card">
      <button class="exact-modal-close" data-exact-close="1" aria-label="Close">×</button>
      <div class="exact-modal-body"></div>
    </div>`;
  document.body.append(modal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal || event.target.dataset.exactClose) closeExactModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeExactModal();
  });
  return modal;
}

function openExactModalLoading(message = "Finding item…") {
  const modal = ensureExactModal();
  modal.querySelector(".exact-modal-body").innerHTML = `
    <div class="exact-loading">
      <div class="exact-spinner"></div>
      <p>${escapeHtml(message)}</p>
    </div>`;
  modal.classList.remove("hidden");
}

function renderSimilarResults(products, query) {
  const modal = ensureExactModal();
  const body = modal.querySelector(".exact-modal-body");

  if (!products.length) {
    body.innerHTML = `
      <div class="exact-result">
        <h3>No similar items found</h3>
        <p class="exact-note">Couldn't find close matches for "${escapeHtml(query)}" right now. Try again in a moment.</p>
      </div>`;
    return;
  }

  const cards = products.map((item) => {
    const name = item.name || "Product";
    const price = item.price != null ? `$${item.price}` : "";
    const meta = [item.brand, price].filter(Boolean).map(escapeHtml).join(" · ");
    const photo = item.image
      ? `<img class="similar-photo" src="${escapeHtml(item.image)}" alt="${escapeHtml(name)}" referrerpolicy="no-referrer" onerror="this.remove()" />`
      : "";
    const href = item.url || shoppingSearchUrl(`${item.brand || ""} ${name}`.trim());
    return `
      <a class="similar-card" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
        ${photo}
        <div class="similar-info">
          <strong>${escapeHtml(name)}</strong>
          ${meta ? `<span>${meta}</span>` : ""}
        </div>
      </a>`;
  }).join("");

  body.innerHTML = `
    <div class="exact-result">
      <h3>Visually similar to ${escapeHtml(query)}</h3>
      <p class="exact-note">Ranked by FashionCLIP visual similarity from your catalog. Tap a card to open it.</p>
      <div class="similar-grid">${cards}</div>
    </div>`;
}

function renderModalMessage(title, note) {
  const modal = ensureExactModal();
  modal.querySelector(".exact-modal-body").innerHTML = `
    <div class="exact-result">
      <h3>${escapeHtml(title)}</h3>
      <p class="exact-note">${note}</p>
    </div>`;
  modal.classList.remove("hidden");
}

function closeExactModal() {
  const modal = document.querySelector("#exact-modal");
  if (modal) modal.classList.add("hidden");
}

// Shared post-processing: turns raw detected pieces (from the mock OR from the
// real vision model) into the enriched shape the UI renders.
function buildAnalysis(sourceName, sourceImage, vibe, rawPieces) {
  return {
    id: uid("analysis"),
    sourceName,
    image: sourceImage,
    vibe: vibe || "detected look",
    pieces: rawPieces.map((piece, index) => {
      // A vision result counts as a confirmed exact model only if it gave us
      // both an exact product name and a brand (otherwise it's a description).
      const visionExact = piece.exactName && piece.brand
        ? {
            exactName: piece.exactName,
            brand: piece.brand,
            model: piece.model || "",
            url: piece.url || "",
            image: piece.image || "",
          }
        : null;
      const exactProduct = visionExact;
      const product = productForPiece(piece);
      const resolvedName = exactProduct?.exactName || piece.name;
      const exactModelConfirmed = Boolean(exactProduct?.exactName && exactProduct?.brand);
      const confidence = typeof piece.confidence === "number"
        ? Math.round(piece.confidence)
        : (exactModelConfirmed ? 94 - index * 3 : 88 - index * 4);
      return {
        ...piece,
        name: resolvedName,
        exactName: exactProduct?.exactName || "",
        brand: exactProduct?.brand || piece.brand || "",
        model: exactProduct?.model || piece.model || "",
        exactModelConfirmed,
        modelConfidence: exactModelConfirmed ? Math.max(60, confidence) : Math.max(38, 68 - index * 4),
        image: sourceImage || exactProduct?.image || product?.image || "",
        url: exactProduct?.url || shoppingSearchUrl(exactProduct?.exactName || piece.name, piece) || piece.url || product?.url || "",
        tags: vlmTagsForPiece(piece, vibe),
        fit: piece.fit || "regular",
        material: piece.material || "mixed",
        crop: cropMap[piece.category] || "50% 50%",
        confidence,
        ownedMatch: findOwnedMatch(piece)?.id || null,
      };
    }),
    createdAt: new Date().toISOString(),
  };
}

// Allowed image types for the Gemini inline image part.
const VISION_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

// Sends the uploaded photo to Gemini vision and returns a real analysis.
// Gemini is asked to return JSON directly (responseMimeType); the prompt
// describes the exact shape we parse. Throws if the API is unreachable, the key
// is bad, or nothing is detected — callers fall back to the mock.
async function analyzeImageWithVision(sourceName, sourceImage) {
  const base64 = (sourceImage || "").split(",")[1];
  if (!base64) throw new Error("no image data");

  const typeMatch = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(sourceImage || "");
  const mediaType = typeMatch && VISION_MEDIA_TYPES.includes(typeMatch[1]) ? typeMatch[1] : "image/jpeg";

  const apiKey = getVisionApiKey();
  if (!apiKey) throw new Error("no API key provided");

  const prompt = `You are a fashion vision system for the app StyleLoop. Look at the outfit in the image and identify every distinct clothing item and accessory the person is wearing.
Return JSON shaped exactly like:
{"vibe": "2-3 word style summary", "pieces": [{"name": "short descriptive name", "category": "Top|Bottom|Outerwear|Shoes|Accessory|Dress", "color": "main color", "fit": "fit", "material": "material", "brand": "", "model": "", "exactName": "", "confidence": 0, "box": [0,0,1,1]}]}
Fill brand, model and exactName ONLY if you can clearly recognise the exact commercial product (for example brand "Nike", model "Air Force 1 '07", exactName "Nike Air Force 1 '07 White"). If you are not certain of the exact product, leave brand, model and exactName as empty strings instead of guessing. confidence is 0-100 per item. Use one of the listed category values exactly.
"box" is the bounding box around that single item as [left, top, right, bottom], each a fraction of the image from 0 to 1 (left/right along width, top/bottom along height). Make it tight around just that garment.`;

  const url = `${VISION_CONFIG.endpointBase}/${VISION_CONFIG.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  });

  if (!response.ok) {
    let detail = `API error ${response.status}`;
    try {
      const errBody = await response.json();
      detail = errBody?.error?.message || detail;
    } catch (error) {
      /* keep status-code detail */
    }
    // A bad/expired key surfaces as 400/403 — clear it so the next try re-prompts.
    if ((response.status === 400 || response.status === 403) && /api.?key|permission|invalid/i.test(detail)) {
      clearVisionApiKey();
    }
    throw new Error(detail);
  }

  const data = await response.json();
  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || "")
    .join("")
    .trim();
  const parsed = JSON.parse(text || "{}");
  const pieces = Array.isArray(parsed.pieces)
    ? parsed.pieces.filter((piece) => piece && piece.name && piece.category)
    : [];
  if (!pieces.length) throw new Error("no clothing detected");

  return buildAnalysis(sourceName, sourceImage, parsed.vibe || "detected look", pieces);
}

function renderAll() {
  renderContext();
  renderMetrics();
  renderStyleMemory();
  renderCloset();
  renderInspirations();
  renderOotd();
  renderShopping();
  renderInsights();
  renderMissingPreview();
}

function renderContext() {
  const weather = state.context.weather;
  const calendar = state.context.calendar;
  document.querySelector("#weather-pill").textContent = weather.label;
  document.querySelector("#calendar-pill").textContent = calendar.label;
  document.querySelector("#weather-summary").textContent = weather.label;
  document.querySelector("#weather-detail").textContent = weather.detail;
  document.querySelector("#calendar-summary").textContent = calendar.label;
  document.querySelector("#calendar-detail").textContent = calendar.detail;

  const weatherSelect = document.querySelector("#weather");
  if (weatherSelect && weather.condition) {
    weatherSelect.value = weather.condition;
  }

  renderGeneratorContext();
}

// Shows the real synced weather + next calendar event inside the outfit
// generator, and labels the "Use synced event" option with the actual event so
// it's clear the generator is using live context, not the static dropdowns.
function renderGeneratorContext() {
  const weather = state.context.weather;
  const calendar = state.context.calendar;

  const banner = document.querySelector("#generator-context");
  if (banner) {
    banner.innerHTML =
      `🌡️ <strong>${escapeHtml(weather.label)}</strong>` +
      ` &nbsp;·&nbsp; 📅 Next: <strong>${escapeHtml(calendar.label)}</strong>` +
      `<span class="generator-context-note">Generated outfits adapt to this automatically.</span>`;
  }

  const contextSelect = document.querySelector("#calendar-context");
  if (contextSelect && contextSelect.options.length) {
    const hasRealEvent = calendar.label && calendar.label !== "No upcoming events";
    contextSelect.options[0].textContent = hasRealEvent
      ? `Use synced event — ${calendar.label}`
      : "Use synced event";
  }
}

function renderMetrics() {
  document.querySelector("#closet-count").textContent = state.closet.length;
  document.querySelector("#inspiration-count").textContent = state.inspirations.length;
  document.querySelector("#outfit-count").textContent = state.outfits.length;
  document.querySelector("#ootd-count").textContent = state.ootds.length;
  document.querySelector("#ootd-items-count").textContent = state.ootds.reduce((total, ootd) => total + ootd.items.length, 0);

  const best = state.closet
    .filter((item) => item.price > 0 && item.wears > 0)
    .map((item) => item.price / item.wears)
    .sort((a, b) => a - b)[0];
  document.querySelector("#best-cpw").textContent = best ? `$${best.toFixed(2)}` : "$0";
}

function renderStyleMemory() {
  const container = document.querySelector("#style-memory");
  container.innerHTML = "";
  state.styleSignals.forEach((signal) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = signal;
    container.append(tag);
  });
}

function renderCloset() {
  const grid = document.querySelector("#closet-grid");
  grid.innerHTML = "";

  if (!state.closet.length) {
    grid.innerHTML = `<div class="empty-state">No closet items yet.</div>`;
    return;
  }

  state.closet.forEach((item) => {
    const card = document.createElement("article");
    card.className = "closet-row";
    const thumb = item.image
      ? `<img class="closet-thumb" src="${escapeHtml(item.image)}" alt="${escapeHtml(titleCase(item.name))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'" />`
      : `<div class="closet-thumb closet-thumb-swatch" style="--item-color:${colorValue(item.color)}"></div>`;
    card.innerHTML = `
      ${thumb}
      <div class="closet-row-info">
        <strong>${escapeHtml(titleCase(item.name))}</strong>
        <span>${escapeHtml(item.category)} · ${escapeHtml(titleCase(item.color))} · ${item.wears || 0} wears</span>
      </div>
      <div class="closet-row-actions">
        <button class="secondary" data-wear="${item.id}">Log wear</button>
        <button class="danger" data-remove="${item.id}">Remove</button>
      </div>
    `;
    grid.append(card);
  });
}

function renderInspirations() {
  const grid = document.querySelector("#inspiration-grid");
  grid.innerHTML = "";

  if (!state.inspirations.length) {
    grid.innerHTML = `<div class="empty-state">No saved inspiration yet.</div>`;
    return;
  }

  state.inspirations.forEach((item) => {
    const card = document.createElement("article");
    card.className = "inspiration-card";
    const media = item.image
      ? `<img src="${item.image}" alt="Saved inspiration" />`
      : `<div class="product-image"></div>`;
    card.innerHTML = `
      ${media}
      <div>
        <strong>${escapeHtml(titleCase(item.vibe || "Saved look"))}</strong>
        <span>${item.pieces.length} detected pieces</span>
      </div>
    `;
    grid.append(card);
  });
}

function extractOotdItems(image, mood) {
  const sets = {
    chill: [
      { name: "relaxed hoodie", category: "Top", color: "grey" },
      { name: "loose blue jeans", category: "Bottom", color: "blue" },
      { name: "white daily sneakers", category: "Shoes", color: "white" },
    ],
    school: [
      { name: "white everyday top", category: "Top", color: "white" },
      { name: "black straight jeans", category: "Bottom", color: "black" },
      { name: "cream canvas tote", category: "Accessory", color: "cream" },
      { name: "white low sneakers", category: "Shoes", color: "white" },
    ],
    "going out": [
      { name: "black fitted top", category: "Top", color: "black" },
      { name: "blue straight jeans", category: "Bottom", color: "blue" },
      { name: "black oversized blazer", category: "Outerwear", color: "black" },
      { name: "silver hoop earrings", category: "Accessory", color: "silver" },
    ],
    clean: [
      { name: "white button shirt", category: "Top", color: "white" },
      { name: "black straight trousers", category: "Bottom", color: "black" },
      { name: "black loafers", category: "Shoes", color: "black" },
    ],
  };

  return (sets[mood] || sets.chill).map((piece, index) => {
    const product = productForPiece(piece);
    return {
    ...piece,
    image: image || product?.image || "",
    url: product?.url || "",
    crop: cropMap[piece.category] || "50% 50%",
    confidence: 92 - index * 3,
    source: "OOTD",
    wears: 1,
    };
  });
}

function renderOotd() {
  const detected = document.querySelector("#ootd-detected");
  const feed = document.querySelector("#ootd-feed");
  if (!detected || !feed) return;

  detected.innerHTML = "";
  if (!currentOotdDetection.length) {
    detected.innerHTML = `<div class="empty-state">Log an OOTD to see extracted pieces.</div>`;
  } else {
    currentOotdDetection.forEach((piece) => detected.append(pieceCard(piece)));
  }

  feed.innerHTML = "";
  if (!state.ootds.length) {
    feed.innerHTML = `<div class="empty-state">No OOTDs yet. This should be the main daily habit.</div>`;
    return;
  }

  state.ootds.forEach((ootd) => {
    const card = document.createElement("article");
    card.className = "inspiration-card ootd-feed-card";
    const media = ootd.image ? `<img src="${ootd.image}" alt="Logged OOTD" />` : `<div class="product-image"></div>`;
    card.innerHTML = `
      ${media}
      <div>
        <strong>${escapeHtml(titleCase(ootd.mood))} fit</strong>
        <span>${ootd.items.length} pieces added · ${new Date(ootd.createdAt).toLocaleDateString()}</span>
      </div>
    `;
    feed.append(card);
  });
}

function garmentVisual(item, className = "garment-visual") {
  const color = colorValue(item.color);
  if (item.image) {
    const position = item.crop || cropMap[item.category] || "50% 50%";
    return `<div class="${className} image-crop" style="background-image:url('${escapeHtml(item.image)}');background-position:${position};"></div>`;
  }

  return `
    <div class="${className} generated-garment ${normalize(item.category)}" style="--garment:${color};">
      <span></span>
    </div>
  `;
}

function pieceCard(piece, index = 0) {
  const owned = findOwnedMatch(piece);
  const visibleTags = (piece.tags || []).slice(0, 3).map((tag) => `<span class="status">${escapeHtml(tag)}</span>`).join("");
  const exactLabel = piece.exactModelConfirmed
    ? `${piece.brand ? `${piece.brand} ` : ""}${piece.model || ""}`.trim()
    : "Exact model not confirmed";
  const modelLine = piece.exactModelConfirmed
    ? `<div class="model-line"><span>Exact model</span><strong>${escapeHtml(piece.exactName)}</strong></div>`
    : `<div class="model-line unconfirmed"><span>Closest visual ID</span><strong>${escapeHtml(titleCase(piece.name))}</strong></div>`;
  const exactQuery = exactItemQuery(piece);
  const card = document.createElement("article");
  card.className = "piece-card";
  card.innerHTML = `
    ${garmentVisual(piece, "piece-photo")}
    <div>
      <strong>${escapeHtml(piece.exactModelConfirmed ? piece.exactName : titleCase(piece.name))}</strong>
      <span>${escapeHtml(exactLabel)} · ${escapeHtml(piece.category)} · ${escapeHtml(titleCase(piece.color))} · ${owned ? "Owned" : "Missing"} · VLM ${piece.confidence || 86}%</span>
      ${modelLine}
      <div class="tag-cloud semantic-tags">${visibleTags}</div>
      <div class="mini-actions">
        <button class="secondary" data-add-detected="${escapeHtml(piece.name)}">Add to closet</button>
        <button class="secondary" data-find-similar="1" data-piece-index="${index}">Find similar</button>
      </div>
    </div>
  `;
  return card;
}

function renderAnalysisLoading() {
  const container = document.querySelector("#analysis-output");
  container.innerHTML = `<div class="analysis-note">Analyzing your photo with Gemini (${escapeHtml(VISION_CONFIG.model)})… this can take a few seconds.</div>`;
}

function renderAnalysis(analysis, note) {
  const container = document.querySelector("#analysis-output");
  container.innerHTML = "";
  if (note) {
    const banner = document.createElement("div");
    banner.className = "analysis-note warning";
    banner.textContent = note;
    container.append(banner);
  }
  const summary = document.createElement("div");
  summary.className = "piece-card";
  summary.innerHTML = `
    <div class="analysis-orbit">${analysis.pieces.length}</div>
    <div>
      <strong>${escapeHtml(titleCase(analysis.vibe))}</strong>
      <span>${analysis.pieces.filter(findOwnedMatch).length} owned matches found</span>
    </div>
  `;
  container.append(summary);
  analysis.pieces.forEach((piece, index) => container.append(pieceCard(piece, index)));
}

function renderMissingPreview() {
  const container = document.querySelector("#missing-piece-preview");
  const missing = getMissingPieces().slice(0, 3);
  container.innerHTML = "";

  if (!missing.length) {
    container.innerHTML = `<div class="empty-state">Add inspiration or generate outfits to find smart closet gaps.</div>`;
    return;
  }

  missing.forEach((piece) => {
    const match = catalog.find((product) => product.category === piece.category && normalize(product.color) === normalize(piece.color)) || catalog[0];
    const row = document.createElement("article");
    row.className = "piece-card";
    row.innerHTML = `
      ${garmentVisual(piece, "piece-photo")}
      <div>
        <strong>${escapeHtml(titleCase(piece.name))}</strong>
        <span>${money(match.price)} could unlock ${2 + Math.floor(Math.random() * 9)} outfits</span>
      </div>
    `;
    container.append(row);
  });
}

function getMissingPieces() {
  const fromInspirations = state.inspirations.flatMap((inspiration) => inspiration.pieces);
  const fromOutfits = currentOutfits.flatMap((outfit) => outfit.missing);
  const all = [...fromInspirations, ...fromOutfits].filter((piece) => !findOwnedMatch(piece));
  const seen = new Set();
  return all.filter((piece) => {
    const key = `${piece.category}-${piece.color}-${piece.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function generateOutfits() {
  const occasion = document.querySelector("#occasion").value;
  const weather = document.querySelector("#weather").value;
  const style = document.querySelector("#style-direction").value;
  const budget = Number(document.querySelector("#budget").value);
  const calendarContext = document.querySelector("#calendar-context").value;
  const syncedEvent = state.context.calendar.type || "School";
  const effectiveOccasion = calendarContext === "Use synced event" ? syncedEvent : occasion;

  const required = ["Top", "Bottom", "Shoes"];
  const weatherNotes = [];
  if (weather === "Cold") {
    required.push("Outerwear");
    weatherNotes.push("warm layer");
  }
  if (weather === "Light rain") {
    required.push("Outerwear");
    weatherNotes.push("rain-friendly layer");
  }
  if (weather === "Windy") {
    required.push("Outerwear");
    weatherNotes.push("secure outer layer");
  }
  if (weather === "Hot") {
    weatherNotes.push("light breathable pieces");
  }
  if (weather === "Warm") {
    weatherNotes.push("easy layers");
  }
  if (effectiveOccasion === "Date night" || effectiveOccasion === "Work" || calendarContext === "Formal") required.push("Accessory");
  if (effectiveOccasion === "Travel" || calendarContext === "Active commute") {
    weatherNotes.push("comfortable shoes");
  }

  const outfitNames = [
    `${style} for ${effectiveOccasion}`,
    `${weather}-ready ${effectiveOccasion}`,
    `Closet-first ${style}`,
  ];
  const contextQuery = `${style} ${effectiveOccasion} ${weather} ${state.context.calendar.label} ${weatherNotes.join(" ")} ${state.styleSignals.join(" ")}`;

  currentOutfits = outfitNames.map((name, index) => {
    const owned = [];
    const missing = [];

    required.forEach((category) => {
      const item = semanticRank(
        state.closet.filter((closetItem) => closetItem.category === category),
        `${contextQuery} ${category}`,
        { requiredCategory: category, budget }
      )[0];
      if (item) {
        owned.push(item);
      } else {
        const product = semanticRank(
          catalog.filter((candidate) => candidate.category === category && candidate.price <= budget),
          `${contextQuery} ${category}`,
          { requiredCategory: category, budget }
        )[0] || semanticRank(
          catalog.filter((candidate) => candidate.category === category),
          `${contextQuery} ${category}`,
          { requiredCategory: category }
        )[0] || catalog[index];
        missing.push({
          name: product.name,
          category: product.category,
          color: product.color,
          price: product.price,
          image: product.image,
          url: product.url,
          tags: product.tags || semanticTokens(`${product.name} ${contextQuery}`),
          matchScore: product.matchScore,
        });
      }
    });

    const semanticAverage = owned.length
      ? owned.reduce((total, item) => total + (item.matchScore || 0), 0) / owned.length
      : 0;
    const score = Math.min(98, Math.max(62, Math.round((owned.length / required.length) * 74 + semanticAverage * 28) - missing.length * 2));
    return {
      id: uid("outfit"),
      name,
      occasion: effectiveOccasion,
      weather,
      style,
      owned,
      missing,
      score,
      contextNote: `${state.context.weather.label} · ${state.context.calendar.label} · ${weatherNotes.join(", ") || "weather balanced"}`,
    };
  });

  renderOutfits();
  renderShopping();
  renderMissingPreview();
}

function renderOutfits() {
  const grid = document.querySelector("#outfit-grid");
  grid.innerHTML = "";

  if (!currentOutfits.length) {
    grid.innerHTML = `<div class="empty-state">Generate outfits to see closet matches and missing pieces.</div>`;
    return;
  }

  currentOutfits.forEach((outfit) => {
    const card = document.createElement("article");
    card.className = "outfit-card";
    const ownedList = outfit.owned.map((item) => `<span class="status good">${titleCase(item.name)}</span>`).join("");
    const missingList = outfit.missing.map((item) => `<span class="status warn">${titleCase(item.name)}</span>`).join("");
    const visualItems = [...outfit.owned, ...outfit.missing].slice(0, 4).map((item) => garmentVisual(item, "outfit-visual")).join("");
    card.innerHTML = `
      <div class="outfit-collage">${visualItems}</div>
      <div class="outfit-header">
        <div>
          <h3>${escapeHtml(outfit.name)}</h3>
          <span>${escapeHtml(outfit.contextNote || `${outfit.weather} · ${outfit.occasion}`)}</span>
        </div>
        <div class="outfit-score">${outfit.score}</div>
      </div>
      <div class="stack">
        <strong>Use from closet</strong>
        <div class="tag-cloud">${ownedList || '<span class="status warn">No owned matches yet</span>'}</div>
      </div>
      <div class="stack">
        <strong>Missing pieces</strong>
        <div class="tag-cloud">${missingList || '<span class="status good">Complete with your closet</span>'}</div>
      </div>
    `;
    grid.append(card);
  });
}

function renderShopping() {
  const grid = document.querySelector("#shopping-results");
  if (!grid) return;
  const max = Number(document.querySelector("#shop-budget")?.value || 80);
  const category = document.querySelector("#shop-category")?.value || "All";
  const source = document.querySelector("#shop-source")?.value || "Any";
  const gaps = getMissingPieces();
  const searchQuery = normalize(document.querySelector("#web-product-query")?.value || "");
  const pool = webSearchResults.length ? webSearchResults : catalog;

  const filtered = semanticRank(pool, searchQuery || `${state.styleSignals.join(" ")} ${gaps.map((gap) => gap.name).join(" ")}`, {
    category,
    budget: max,
    preferSecondhand: source === "Secondhand",
  })
    .filter((product) => product.price <= max)
    .filter((product) => category === "All" || product.category === category)
    .filter((product) => source === "Any" || product.source === source)
    .filter((product) => {
      if (!searchQuery || webSearchResults.length) return true;
      const text = normalize(`${product.name} ${product.brand} ${product.category} ${product.color}`);
      return searchQuery.split(" ").some((word) => word.length > 2 && text.includes(word)) || product.matchScore > 0.18;
    })
    .sort((a, b) => {
      const aGap = gaps.some((gap) => gap.category === a.category && normalize(gap.color) === normalize(a.color));
      const bGap = gaps.some((gap) => gap.category === b.category && normalize(gap.color) === normalize(b.color));
      return Number(bGap) - Number(aGap) || (b.matchScore || 0) - (a.matchScore || 0) || a.price - b.price;
    });

  grid.innerHTML = "";
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">No products match these filters. Try a broader search or raise the max price.</div>`;
    return;
  }

  filtered.forEach((product) => grid.append(productCard(product, false)));
}

function productCard(product, addToCloset) {
  const card = document.createElement("article");
  card.className = "product-card";
  const score = product.matchScore ? `${Math.round(product.matchScore * 100)}% vector match` : "Semantic match";
  card.innerHTML = `
    ${garmentVisual(product, "product-image")}
    <div class="product-top">
      <div>
        <strong>${escapeHtml(titleCase(product.name))}</strong>
        <span>${escapeHtml(product.brand)} · ${escapeHtml(product.category)} · ${escapeHtml(product.source)} · ${score}</span>
      </div>
      <strong>${money(product.price)}</strong>
    </div>
    <div class="product-actions">
      <button class="primary" data-product="${escapeHtml(product.name)}">Add to closet</button>
      <a class="source-link" href="${escapeHtml(product.url || "#")}" target="_blank" rel="noreferrer">View source</a>
    </div>
  `;
  return card;
}

function renderInsights() {
  const cpw = document.querySelector("#cost-per-wear");
  const unlock = document.querySelector("#unlock-list");
  if (!cpw || !unlock) return;

  cpw.innerHTML = "";
  const valued = state.closet
    .filter((item) => item.price > 0)
    .sort((a, b) => (b.wears || 0) - (a.wears || 0));

  if (!valued.length) {
    cpw.innerHTML = `<div class="empty-state">Add prices and log wears to track value.</div>`;
  } else {
    valued.slice(0, 6).forEach((item) => {
      const perWear = item.wears ? item.price / item.wears : item.price;
      const row = document.createElement("article");
      row.className = "piece-card";
      row.innerHTML = `
        ${garmentVisual(item, "piece-photo")}
        <div>
          <strong>${escapeHtml(titleCase(item.name))}</strong>
          <span>${money(perWear)} per wear · ${item.wears || 0} wears</span>
        </div>
      `;
      cpw.append(row);
    });
  }

  unlock.innerHTML = "";
  const gaps = getMissingPieces();
  if (!gaps.length) {
    unlock.innerHTML = `<div class="empty-state">Analyze inspiration to reveal high-impact missing pieces.</div>`;
  } else {
    gaps.slice(0, 6).forEach((gap, index) => {
      const row = document.createElement("article");
      row.className = "piece-card";
      row.innerHTML = `
        ${garmentVisual(gap, "piece-photo")}
        <div>
          <strong>${escapeHtml(titleCase(gap.name))}</strong>
          <span>Estimated outfit unlocks: ${8 - Math.min(index, 5)}</span>
        </div>
      `;
      unlock.append(row);
    });
  }
}

// Searches the real local product catalog (39k images) via the backend and shows
// actual product photos. Each result can be added straight to the closet.
async function runCatalogSearch() {
  const grid = document.querySelector("#catalog-results");
  if (!grid) return;
  const query = document.querySelector("#catalog-query").value.trim();
  grid.innerHTML = `<div class="empty-state">Searching the catalog…</div>`;

  try {
    const response = await fetch(SEARCH_CONFIG.catalogEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, k: 24 }),
    });
    if (!response.ok) throw new Error(`backend ${response.status}`);
    const data = await response.json();
    catalogResults = Array.isArray(data.results) ? data.results : [];
  } catch (error) {
    const notRunning = /failed to fetch|networkerror|load failed/i.test(error.message);
    grid.innerHTML = notRunning
      ? `<div class="empty-state">Search backend not running. In a terminal: <code>cd backend</code> then <code>python server.py</code> (port 8008), then search again.</div>`
      : `<div class="empty-state">Catalog search hit an error (${escapeHtml(error.message)}).</div>`;
    return;
  }

  grid.innerHTML = "";
  if (!catalogResults.length) {
    grid.innerHTML = `<div class="empty-state">No products matched "${escapeHtml(query)}". Try simpler words like "blue jeans" or "black hoodie".</div>`;
    return;
  }
  catalogResults.forEach((product, index) => grid.append(catalogCard(product, index)));
}

// A real-photo product card for the catalog search results.
function catalogCard(product, index) {
  const card = document.createElement("article");
  card.className = "product-card catalog-card";
  const name = titleCase(product.name || product.article_type || "Product");
  const meta = [product.category, titleCase(product.color || "")].filter(Boolean).map(escapeHtml).join(" · ");
  const photo = product.image
    ? `<img class="catalog-photo" src="${escapeHtml(product.image)}" alt="${escapeHtml(name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none'" />`
    : `<div class="product-image"></div>`;
  card.innerHTML = `
    ${photo}
    <div class="product-top">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${meta}</span>
      </div>
    </div>
    <div class="product-actions">
      <button class="primary" data-catalog-add="${index}">Add to closet</button>
      <a class="source-link" href="${escapeHtml(product.url || "#")}" target="_blank" rel="noreferrer">Shop online</a>
    </div>
  `;
  return card;
}

function handleFilePreview(input, target) {
  const file = input.files?.[0];
  if (!file) return null;
  const reader = new FileReader();
  reader.onload = () => {
    target.innerHTML = `<img src="${reader.result}" alt="Uploaded preview" />`;
  };
  reader.readAsDataURL(file);
  return file;
}

function weatherConditionFromCode(code, temp) {
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "Light rain";
  if ([71, 73, 75, 77, 85, 86].includes(code) || temp <= 45) return "Cold";
  if (temp >= 82) return "Hot";
  if (temp >= 68) return "Warm";
  return "Light rain";
}

function celsiusToFahrenheit(value) {
  return Math.round((value * 9) / 5 + 32);
}

// Fetches real current weather from Open-Meteo (free, no API key) for the given
// coordinates and updates the app's context. Returns true on success.
async function fetchWeather(latitude, longitude, detail) {
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m`
    );
    const data = await response.json();
    const tempC = Math.round(data.current.temperature_2m);
    const temp = celsiusToFahrenheit(data.current.temperature_2m);
    const condition = weatherConditionFromCode(data.current.weather_code, temp);
    const wind = Math.round(data.current.wind_speed_10m);
    state.context.weather = {
      label: `${temp}°F / ${tempC}°C, ${condition.toLowerCase()}`,
      temp,
      tempC,
      condition,
      detail: detail || `Synced from your location. Wind ${wind} km/h.`,
    };
    saveState();
    renderAll();
    return true;
  } catch (error) {
    return false;
  }
}

// Auto weather without a permission prompt: ask the backend for an approximate
// location (from this machine's IP) and fetch its weather. Used on page load.
async function autoWeatherFromIp() {
  try {
    const response = await fetch(SEARCH_CONFIG.whereEndpoint);
    if (!response.ok) return false;
    const loc = await response.json();
    if (loc.lat == null || loc.lon == null) return false;
    const place = [loc.city, loc.region].filter(Boolean).join(", ");
    return await fetchWeather(
      loc.lat,
      loc.lon,
      `Approx. weather for ${place || "your area"} (from your network). Click "Use my location" for exact.`
    );
  } catch (error) {
    return false;
  }
}

// "Use my location" button: precise GPS, falling back to IP-based location.
function syncWeather() {
  const detail = document.querySelector("#weather-detail");
  detail.textContent = "Requesting location…";

  if (!navigator.geolocation) {
    autoWeatherFromIp().then((ok) => {
      if (!ok) detail.textContent = "Couldn't get weather — is the backend running?";
    });
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      fetchWeather(position.coords.latitude, position.coords.longitude, "Synced from your exact location.");
    },
    () => {
      // Permission denied / unavailable — fall back to approximate IP location.
      autoWeatherFromIp().then((ok) => {
        if (!ok) detail.textContent = "Location blocked and backend unreachable — using demo weather.";
      });
    }
  );
}

// Pulls the next upcoming events from a pasted iCal/ICS link (via the backend
// proxy, which avoids browser CORS) and shows the next one as the active event.
async function syncCalendarFromUrl(url, { silent = false } = {}) {
  if (!url) return;
  if (!silent) setMethodStatus("calendar-status", "Connecting to your calendar…");
  try {
    const response = await fetch(`${SEARCH_CONFIG.calendarEndpoint}?url=${encodeURIComponent(url)}`);
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || `error ${response.status}`);
    const events = data.events || [];
    if (!events.length) {
      state.context.calendar = {
        label: "No upcoming events",
        type: "None",
        detail: "Calendar connected — no upcoming events found.",
      };
      setMethodStatus("calendar-status", "Connected, but no upcoming events found.");
    } else {
      const next = events[0];
      const more = events.slice(0, 3).map((event) => `${event.date}${event.time ? ` ${event.time}` : ""} — ${event.summary}`).join(" · ");
      state.context.calendar = {
        label: next.label,
        type: inferEventType(next.summary),
        detail: `Next up: ${more}`,
      };
      setMethodStatus("calendar-status", `Connected ✓ ${events.length} upcoming event${events.length === 1 ? "" : "s"}.`);
    }
    try {
      localStorage.setItem(CALENDAR_URL_KEY, url);
    } catch (error) {
      /* ignore storage failures */
    }
    saveState();
    renderAll();
  } catch (error) {
    const notRunning = /failed to fetch|networkerror|load failed/i.test(error.message);
    setMethodStatus(
      "calendar-status",
      notRunning ? "Can't reach the backend — start it (python server.py) and try again." : `Couldn't read that calendar (${error.message}).`,
      true
    );
  }
}

function inferEventType(text) {
  const lower = normalize(text);
  if (/(work|office|meeting|interview|presentation)/.test(lower)) return "Work";
  if (/(date|dinner|party|drinks)/.test(lower)) return "Date night";
  if (/(flight|trip|travel|airport|train)/.test(lower)) return "Travel";
  if (/(gym|run|walk|sport)/.test(lower)) return "Weekend";
  if (/(class|school|exam|lecture|study)/.test(lower)) return "School";
  return "Weekend";
}

function saveCalendarEvent(label, detail = "Added manually.") {
  const clean = label.trim();
  if (!clean) return;
  state.context.calendar = {
    label: clean,
    type: inferEventType(clean),
    detail,
  };
  saveState();
  renderAll();
}

function parseIcsEvent(text) {
  const summaries = [...text.matchAll(/SUMMARY(?:;[^:]*)?:(.+)/g)].map((match) => match[1].replace(/\\,/g, ",").trim());
  const starts = [...text.matchAll(/DTSTART(?:;[^:]*)?:(.+)/g)].map((match) => match[1].trim());
  const summary = summaries[0] || "Calendar event";
  const start = starts[0] || "";
  const time = start.match(/T(\d{2})(\d{2})/) ? `${start.match(/T(\d{2})(\d{2})/)[1]}:${start.match(/T(\d{2})(\d{2})/)[2]}` : "";
  return time ? `${summary} at ${time}` : summary;
}

function setActiveView(view) {
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `${view}-view`);
  });
  const titles = {
    dashboard: ["Today", "Your fit engine"],
    ootd: ["OOTD", "A daily fit log that builds your closet for you"],
    inspire: ["Social Breakdown", "Turn saved posts into pieces, matches, and buy links"],
    closet: ["Wardrobe", "Build a closet without a day-one upload chore"],
    outfits: ["Stylist", "Generate outfits from taste, weather, and budget"],
    shop: ["Buy", "Complete the look without rebuying your closet"],
    insights: ["Insights", "Track value, gaps, and repeat wear"],
  };
  document.querySelector("#view-eyebrow").textContent = titles[view][0];
  document.querySelector("#view-title").textContent = titles[view][1];
}

// Small inline status line under the closet capture buttons.
function setMethodStatus(id, message, isError = false) {
  const el = document.querySelector(`#${id}`);
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("error", Boolean(isError));
}

// Turns a vision/analyze error into a plain, useful message for the status line.
function visionErrorMessage(error) {
  const msg = error?.message || "unknown error";
  if (/no api key/i.test(msg)) return "A Gemini API key is needed to analyze photos — paste it when prompted.";
  if (/no clothing detected/i.test(msg)) return "Couldn't spot a clothing item in that photo — try a clearer shot.";
  if (/quota|rate|429/i.test(msg)) return "Gemini rate limit hit (free tier ~20/min). Wait a minute and try again.";
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return "Couldn't reach Gemini — check your internet connection.";
  return `Couldn't analyze the photo (${msg}).`;
}

function bindEvents() {
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.view));
  });

  document.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => setActiveView(button.dataset.jump));
  });

  document.querySelectorAll(".method").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".method").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".method-panel").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      document.querySelector(`#${button.dataset.method}-method`).classList.add("active");
    });
  });

  document.querySelector("#budget").addEventListener("input", (event) => {
    document.querySelector("#budget-value").textContent = money(event.target.value);
  });

  document.querySelector("#inspiration-upload").addEventListener("change", (event) => {
    handleFilePreview(event.target, document.querySelector("#inspiration-preview"));
  });

  document.querySelector("#ootd-daily-upload").addEventListener("change", (event) => {
    handleFilePreview(event.target, document.querySelector("#ootd-daily-preview"));
  });

  // Drag-and-drop: the upload zones say "Drop a saved fit" but only click-to-browse
  // was wired. Catch dropped image files, put them on the file input, and reuse the
  // existing change->preview handler.
  document.querySelectorAll(".upload-zone").forEach((zone) => {
    const input = zone.querySelector('input[type="file"]');
    if (!input) return;
    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add("dragover");
      }));
    ["dragleave", "dragend"].forEach((ev) =>
      zone.addEventListener(ev, () => zone.classList.remove("dragover")));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  document.querySelectorAll(".mood").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".mood").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      selectedMood = button.dataset.mood;
    });
  });

  document.querySelector("#save-social").addEventListener("click", () => {
    const url = document.querySelector("#social-url").value.trim();
    if (!url) return;
    currentAnalysis = simulateAnalysis(url, "");
    state.inspirations.unshift({ ...currentAnalysis, image: "" });
    state.styleSignals = [...new Set([currentAnalysis.vibe, ...state.styleSignals])].slice(0, 8);
    document.querySelector("#social-url").value = "";
    saveState();
    renderAnalysis(currentAnalysis);
    renderAll();
  });

  document.querySelector("#analyze-inspiration").addEventListener("click", async () => {
    const input = document.querySelector("#inspiration-upload");
    const file = input.files?.[0];
    const preview = document.querySelector("#inspiration-preview img")?.src || "";
    const button = document.querySelector("#analyze-inspiration");
    const sourceName = file?.name || "uploaded inspiration";

    let analysis;
    let note = "";
    if (VISION_CONFIG.enabled && preview) {
      renderAnalysisLoading();
      button.disabled = true;
      try {
        analysis = await analyzeImageWithVision(sourceName, preview);
      } catch (error) {
        note = `Couldn't analyze the photo with Gemini (${error.message}). Showing a sample breakdown instead.`;
        analysis = simulateAnalysis(sourceName, preview);
      } finally {
        button.disabled = false;
      }
    } else {
      analysis = simulateAnalysis(sourceName, preview);
    }

    currentAnalysis = analysis;
    state.inspirations.unshift({ ...analysis, image: preview });
    state.styleSignals = [...new Set([analysis.vibe, ...state.styleSignals])].slice(0, 8);
    saveState();
    renderAnalysis(analysis, note);
    renderAll();
  });

  document.querySelector("#analysis-output").addEventListener("click", async (event) => {
    const findSimilarBtn = event.target.closest("[data-find-similar]");
    if (findSimilarBtn) {
      const index = Number(findSimilarBtn.dataset.pieceIndex);
      const piece = currentAnalysis?.pieces?.[index];
      if (!piece) return;
      openExactModalLoading("Finding similar styles…");
      try {
        const products = await searchSimilar(piece);
        renderSimilarResults(products, piece.exactName || titleCase(piece.name));
      } catch (error) {
        const notRunning = /failed to fetch|networkerror|load failed/i.test(error.message);
        if (notRunning) {
          renderModalMessage(
            "Search backend not running",
            "Start it: in a terminal, <code>cd backend</code> then <code>python server.py</code> (port 8008). Then try again."
          );
        } else {
          renderModalMessage(
            "Search hit an error",
            `The backend is running but returned an error (${escapeHtml(error.message)}). Check the backend's terminal window for the details.`
          );
        }
      }
      return;
    }

    const addName = event.target.dataset.addDetected;
    if (addName && currentAnalysis) {
      const piece = currentAnalysis.pieces.find((item) => normalize(item.name) === normalize(addName));
      if (piece) {
        addClosetItem({ ...piece, source: "Detected inspiration" });
      }
    }
  });

  document.querySelector("#ootd-detected").addEventListener("click", (event) => {
    const addName = event.target.dataset.addDetected;
    if (addName) {
      const piece = currentOotdDetection.find((item) => normalize(item.name) === normalize(addName));
      if (piece) addClosetItem({ ...piece, source: "OOTD" });
    }
  });

  document.querySelector("#log-ootd").addEventListener("click", () => {
    const image = document.querySelector("#ootd-daily-preview img")?.src || "";
    currentOotdDetection = extractOotdItems(image, selectedMood);
    const added = currentOotdDetection.map((piece) => addClosetItem(piece));
    state.ootds.unshift({
      id: uid("ootd"),
      image,
      mood: selectedMood,
      items: added.map((item) => item.id),
      createdAt: new Date().toISOString(),
    });
    state.styleSignals = [...new Set([selectedMood, "daily fit", ...state.styleSignals])].slice(0, 8);
    saveState();
    renderAll();
    setActiveView("ootd");
  });

  document.querySelector("#seed-closet").addEventListener("click", () => {
    seedItems.forEach(addClosetItem);
  });

  document.querySelector("#catalog-search").addEventListener("click", runCatalogSearch);
  document.querySelector("#catalog-query").addEventListener("keydown", (event) => {
    if (event.key === "Enter") runCatalogSearch();
  });
  document.querySelector("#catalog-results").addEventListener("click", (event) => {
    const addButton = event.target.closest("[data-catalog-add]");
    if (!addButton) return;
    const product = catalogResults[Number(addButton.dataset.catalogAdd)];
    if (!product) return;
    addClosetItem({
      name: product.name,
      category: product.category,
      color: product.color,
      price: product.price || 0,
      image: product.image,
      url: product.url,
      source: "Catalog",
    });
    setActiveView("closet");
  });

  // Preview the uploaded photo in each closet capture method.
  document.querySelector("#ootd-upload").addEventListener("change", (event) => {
    handleFilePreview(event.target, document.querySelector("#ootd-method-preview"));
    setMethodStatus("ootd-method-status", "");
  });
  document.querySelector("#item-photo-upload").addEventListener("change", (event) => {
    handleFilePreview(event.target, document.querySelector("#photo-preview"));
    setMethodStatus("photo-status", "");
  });

  // OOTD capture: actually look at the uploaded outfit photo with Gemini and add
  // every detected piece to the closet, each keeping the photo as its image.
  document.querySelector("#slice-ootd").addEventListener("click", async () => {
    const button = document.querySelector("#slice-ootd");
    const image = document.querySelector("#ootd-method-preview img")?.src || "";
    if (!image) {
      setMethodStatus("ootd-method-status", "Add an outfit photo first.", true);
      return;
    }
    if (!VISION_CONFIG.enabled) {
      setMethodStatus("ootd-method-status", "Photo analysis is turned off.", true);
      return;
    }
    button.disabled = true;
    setMethodStatus("ootd-method-status", "Analyzing your photo with Gemini…");
    try {
      const analysis = await analyzeImageWithVision("closet OOTD", image);
      analysis.pieces.forEach((piece) => addClosetItem({ ...piece, image, source: "OOTD" }));
      document.querySelector("#ootd-method-preview").innerHTML = "";
      document.querySelector("#ootd-upload").value = "";
      setMethodStatus("ootd-method-status", `Added ${analysis.pieces.length} item${analysis.pieces.length === 1 ? "" : "s"} to your closet ✓`);
    } catch (error) {
      setMethodStatus("ootd-method-status", visionErrorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  });

  // One-tap photo: identify the single garment in the photo and add it, keeping
  // the actual photo as the item's image.
  document.querySelector("#magic-photo").addEventListener("click", async () => {
    const button = document.querySelector("#magic-photo");
    const image = document.querySelector("#photo-preview img")?.src || "";
    if (!image) {
      setMethodStatus("photo-status", "Add a photo of the item first.", true);
      return;
    }
    if (!VISION_CONFIG.enabled) {
      setMethodStatus("photo-status", "Photo analysis is turned off.", true);
      return;
    }
    button.disabled = true;
    setMethodStatus("photo-status", "Identifying the item with Gemini…");
    try {
      const analysis = await analyzeImageWithVision("closet item", image);
      const piece = analysis.pieces[0];
      if (!piece) throw new Error("no clothing detected");
      const added = addClosetItem({ ...piece, image, source: "Photo" });
      document.querySelector("#photo-preview").innerHTML = "";
      document.querySelector("#item-photo-upload").value = "";
      setMethodStatus("photo-status", `Added "${titleCase(added.name)}" to your closet ✓`);
    } catch (error) {
      setMethodStatus("photo-status", visionErrorMessage(error), true);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#closet-grid").addEventListener("click", (event) => {
    const wearId = event.target.dataset.wear;
    const removeId = event.target.dataset.remove;
    if (wearId) {
      const item = state.closet.find((closetItem) => closetItem.id === wearId);
      if (item) item.wears = Number(item.wears || 0) + 1;
    }
    if (removeId) {
      const index = state.closet.findIndex((closetItem) => closetItem.id === removeId);
      if (index >= 0) state.closet.splice(index, 1);
    }
    saveState();
    renderAll();
  });

  document.querySelector("#generate-outfits").addEventListener("click", generateOutfits);
  document.querySelector("#save-current-outfits").addEventListener("click", () => {
    state.outfits.unshift(...currentOutfits);
    saveState();
    renderAll();
  });

  document.querySelector("#sync-weather").addEventListener("click", syncWeather);

  document.querySelector("#save-event").addEventListener("click", () => {
    saveCalendarEvent(document.querySelector("#manual-event").value, "Added manually and used by the outfit generator.");
    document.querySelector("#manual-event").value = "";
  });

  document.querySelector("#calendar-upload").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const label = parseIcsEvent(String(reader.result || ""));
      saveCalendarEvent(label, "Imported from an .ics calendar file.");
    };
    reader.readAsText(file);
  });

  // Connect a live calendar by its iCal/ICS link (remembered for next time).
  const calendarUrlInput = document.querySelector("#calendar-url");
  try {
    calendarUrlInput.value = localStorage.getItem(CALENDAR_URL_KEY) || "";
  } catch (error) {
    /* ignore storage failures */
  }
  const connectCalendar = () => {
    const url = calendarUrlInput.value.trim();
    if (!url) {
      setMethodStatus("calendar-status", "Paste your calendar's iCal (.ics) link first.", true);
      return;
    }
    syncCalendarFromUrl(url);
  };
  document.querySelector("#connect-calendar").addEventListener("click", connectCalendar);
  calendarUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") connectCalendar();
  });
}

// On load, show real local weather (no prompt) and refresh a saved calendar.
function autoSyncContext() {
  autoWeatherFromIp();
  let savedCalendarUrl = "";
  try {
    savedCalendarUrl = localStorage.getItem(CALENDAR_URL_KEY) || "";
  } catch (error) {
    savedCalendarUrl = "";
  }
  if (savedCalendarUrl) syncCalendarFromUrl(savedCalendarUrl, { silent: true });
}

bindEvents();
renderAll();
renderOutfits();
runCatalogSearch();
autoSyncContext();
