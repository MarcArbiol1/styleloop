# StyleLoop — Progress & Handoff

A working log of what we built and how to continue. Read the **Quick start**
section first if you just want to run it. The newest session is documented at the
top; older notes follow.

---

## 2026-06-16 SESSION — big catalog + better model, then PAUSED "Find similar"

### Where it ended: "Find similar" is being PAUSED (accuracy not good enough)

We made the similarity search much better under the hood, but real-world results
on messy social photos were still inaccurate (esp. shoes & accessories), so the
user decided to **pause the "Find similar" feature** and revisit later.

> ⚠️ **NOT yet disabled in the UI.** The plan was to hide the "Find similar" button
> (`app.js:1104`, `data-find-similar`), but that edit was **declined/not applied** —
> the button is still live. If resuming the "pause" decision, remove or comment out
> that button. The handler (`app.js:1684`) and the whole backend are intact.

### What we changed today (all working, all kept)

1. **Catalog: 11 → 39,093 real products.** Swapped the hand-made 11-item catalog
   (Unsplash lifestyle photos, dead links) for the full wearable set of the
   HuggingFace dataset `ashraq/fashion-product-images-small` (44k total; ~5k
   non-wearables like cosmetics skipped). Clean product shots + rich metadata
   (articleType, baseColour, productDisplayName, etc.).
   - New script `backend/load_subset.py [TARGET] [CAP_PER_TYPE]` extracts images to
     `backend/images/<id>.jpg` and writes `backend/catalog.json`.
   - `backend/build_index.py` rewritten to embed LOCAL images (no more URL downloads).
   - Backend now SERVES the images at `http://localhost:8008/img/<id>.jpg`.
   - Buy links are Google Shopping searches of the product name — the dataset has
     **NO live buy links** (a real limitation; live links need the paid SerpAPI path).

2. **Embedder upgraded: FashionCLIP → Marqo-FashionSigLIP** (`backend/embedder.py`).
   - 768-dim, fashion-tuned, much better at design/color than the old 512-dim CLIP.
   - Loaded via **open_clip** (`hf-hub:Marqo/marqo-fashionSigLIP`), NOT transformers —
     the transformers `trust_remote_code` path hits a meta-tensor `.to(mps)` bug.
     Needed `pip install open_clip_torch ftfy` (already done in `.venv`).
   - Full re-embed of 39k took ~12 min on the Mac GPU (MPS).

3. **Search quality fixes (`backend/server.py`):**
   - **Category filter** — a "Bottom" only searches bottoms (no more belts for jeans).
     App passes `piece.category`.
   - **Color re-rank** — `color_family()` maps ~46 colors → ~11 families; +0.15 same
     family / −0.10 clash, judged against `piece.color`. App passes `piece.color`.
   - **Similarity floor** `MIN_SIM=0.50` — returns nothing rather than junk.
   - **Padded crop** (`BOX_PAD=0.08`) around Gemini's bounding box.
   - Verified in isolation: red-heels query → all 8 red heels; striped-green-shirt →
     green/olive shirts. (So the engine works on clean inputs.)

4. **Drag-and-drop upload fixed** (`app.js`, the `.upload-zone` handler + `.dragover`
   CSS). The box said "Drop a saved fit" but only click-to-browse was wired.

### THE REAL PROBLEM we diagnosed (why results still looked bad)

The weak link is now **upstream of the similarity engine** — the photo breakdown /
detection — plus a legacy bug:

- **Legacy fake "exact match" hack** (`app.js:252-295, 536-549, 788`): a hardcoded
  list of just 3 products (Nike Air Force 1, Adidas Samba, Levi's 501) with sloppy
  `includes()` text matching. Detected pieces whose text loosely contains "501",
  "samba", "air force", "straight blue jean" get **force-relabeled** to these —
  e.g. a puffer-jacket photo became three "Levi's 501 / EXACT MODEL" entries.
  **This should be removed** — it corrupts real Gemini detections. (`resolvedName`
  override at `app.js:790,797`.)
- **Likely stale browser cache**: a grey *shirt* appeared in an Air-Force-1 (Shoes)
  result — only possible if the category filter isn't reaching the browser. The
  `app.js?v=` cache-bust is now `siglip2drop`; if results look unfiltered, the
  browser is running old JS — hard-refresh (⌘⇧R) or bump the version again.
- **Honest ceiling**: "snap any social photo → exact shoppable item" is genuinely
  hard; research catalog + no live links + messy-photo crops cap the quality.

### Decision options for next time (user is weighing these)

- **(A) Fix the real bugs first** — remove the fake 3-product hack, force a clean
  reload, re-test honestly. Free, ~15 min. Lowest risk; see true quality first.
- **(B) Scope down honestly** — keep breakdown + "find similar in YOUR closet",
  drop the shoppable-catalog promise.
- **(C) Go paid** — Google Lens / SerpAPI for accurate, shoppable results + working
  links (~$50/mo hobby tier). The only path to "works like a real product."
- **(D) Pause** — what the user chose this session (but UI button not yet hidden).

### Disk usage (as of 2026-06-16) — ~4.2 GB total

- `clothing-app/` = 1.3 GB → `.venv` 1.0 GB · `catalog.db` 160 MB · `images/` 153 MB · `catalog.json` 14 MB
- `~/.cache/huggingface/` = 2.9 GB → `hub/` (models) 2.3 GB · `datasets/` 543 MB
- **Safe to delete for space** (auto re-downloads): `~/.cache/huggingface/datasets/`
  (543 MB, redundant — images already extracted) and the old unused
  `~/.cache/huggingface/hub/models--patrickjohncyh--fashion-clip` (~600 MB).

### To rebuild from scratch if ever needed
```bash
cd /Users/marcarbiolrakuljic/clothing-app/backend
.venv/bin/python load_subset.py 44000 999999   # extract images + catalog.json
.venv/bin/python build_index.py                # embed -> catalog.db (~12 min)
```

---

## TL;DR — where the project stands (original 2026-06-15 notes below)

StyleLoop is a static browser app (`index.html` + `app.js` + `styles.css`) plus a new
local **Python backend** for visual search.

- **Photo breakdown** ("Break down the fit" / Social Breakdown) now uses **real vision** —
  Google **Gemini 2.5 Flash** looks at the uploaded photo and returns the detected
  clothing items (category, color, fit, material, optional exact brand/model, and a
  bounding box per item). This replaced the old fake logic that just hashed the filename.
- **"Find similar"** now uses a real **visual vector search**: a Python backend crops the
  photo to the chosen garment, embeds it with **FashionCLIP**, and finds the nearest
  products in a **SQLite** vector store (cosine similarity via NumPy).
- It genuinely works end-to-end. The main limitation is the **catalog is tiny (11 items)**,
  so matches are bounded by what's indexed. Growing the catalog is the #1 next step.

---

## Quick start (run it tomorrow)

Two servers need to be running.

**1. Frontend (the app):**
```bash
python3 -m http.server 8001 --directory /Users/marcarbiolrakuljic/clothing-app
```
Then open **http://127.0.0.1:8001** in the browser. (The background server from today's
session will NOT still be running tomorrow — start it yourself with the line above.)

**2. Backend (visual search):**
```bash
cd /Users/marcarbiolrakuljic/clothing-app/backend
source .venv/bin/activate
python server.py        # serves http://localhost:8008  — leave the terminal open
```
Health check: open **http://localhost:8008/health** → should show `{"ok": true, "indexed": 11}`.

**3. In the app:** analyze a photo, then click **Find similar** on a piece.
The first time you analyze, it asks for your **Gemini API key** (stored in the browser only).

---

## Architecture

```
Browser app (127.0.0.1:8001)
│
├─ "Break down the fit"  ──>  Gemini 2.5 Flash (cloud, your API key)
│                              returns items + bounding boxes as JSON
│
└─ "Find similar"        ──>  Local backend (localhost:8008)
                               crop to garment box ─> FashionCLIP embed
                               ─> cosine search over SQLite catalog ─> nearest products
```

- **Gemini** = detection/description only (it's a VLM; it can't return real shoppable
  products by itself).
- **FashionCLIP + SQLite** = the actual "find visually similar products" engine.

---

## Files

**App (frontend):**
- `index.html` — markup. Note the cache-bust on the script tag: `app.js?v=fclip2`
  (bump this string whenever app.js changes, so the browser reloads fresh code).
- `app.js` — all logic. Key pieces:
  - `VISION_CONFIG` — Gemini settings (model `gemini-2.5-flash`, key stored in
    localStorage under `styleloop-gemini-key`).
  - `SEARCH_CONFIG` — backend URL (`http://localhost:8008/search`).
  - `analyzeImageWithVision()` — sends photo to Gemini, returns structured breakdown.
  - `buildAnalysis()` — shared post-processing of detected pieces.
  - `searchSimilar(piece)` — calls the backend with the photo + the piece's bounding box.
  - `renderSimilarResults()` / the modal helpers — the dark "Find similar" popup.
  - `saveState()` — hardened to not crash when localStorage is full (strips base64 images).
- `styles.css` — styles, including the `.exact-modal-*` / `.similar-*` modal styles.

**Backend (new, in `/backend`):**
- `embedder.py` — loads FashionCLIP (`patrickjohncyh/fashion-clip`, 512-dim) and
  embeds an image. Uses Apple Silicon GPU (`mps`) automatically.
- `build_index.py` — one-time: reads `catalog.json`, downloads each image, embeds it,
  stores the vector as a BLOB in `catalog.db`.
- `server.py` — Flask server. `POST /search` crops to the box, embeds, does NumPy cosine
  search over the stored vectors, returns nearest products.
- `catalog.json` — the product catalog to search (currently the app's 12 built-in products).
- `catalog.db` — the built index (11 products; one had a dead image URL).
- `requirements.txt` — flask, flask-cors, pillow, numpy, requests, torch, transformers.
- `README.md` — backend setup/run instructions.
- `.venv/` — the Python virtual environment (already set up).

---

## What we did today (chronological)

1. **Found the real bug:** the old `simulateAnalysis` never looked at the photo — it hashed
   the *filename* and returned one of 3 hardcoded outfits. That's why item detection was
   garbage.
2. **Wired real vision.** Considered local Gemma (Ollama) and Claude; chose **Google Gemini**
   (free tier, multimodal). Replaced the fake analysis with `analyzeImageWithVision()`.
3. **Fixed app-breaking issues:**
   - `QuotaExceededError` from localStorage filling with base64 photos → hardened `saveState`.
   - Safari serving stale code → added `app.js?v=...` cache-busting.
   - Local web server had stopped → restarted it.
4. **Iterated on "find product":** tried grounded exact-item search → a dark "Find similar"
   modal → pure Gemini suggestions. Matches were weak and we kept hitting Gemini's rate limit.
5. **Decided to build real vector search.** Discussed the requirements honestly (embeddings +
   a product catalog + a vector store + a backend).
6. **Built the backend** (FashionCLIP + SQLite + cropping) and rewired "Find similar" to it.
7. **Debugged the backend to working:**
   - `get_image_features` returned a wrapped object on this transformers version → fixed the
     embedder to unwrap to the 512-dim vector.
   - macOS Python lacks `enable_load_extension`, so `sqlite-vec` couldn't load → switched to
     storing vectors as SQLite BLOBs and doing cosine search in NumPy (works on any Python).
   - Verified ranking: a blazer photo returns the blazer #1 (1.000) and the wool coat #2
     (0.665) — i.e. it's matching visually, not by keywords.

---

## Known issues / gotchas

- **Gemini free-tier rate limit: ~20 requests/minute** (and a daily cap). Hitting it shows a
  "quota exceeded… retry in Ns" message and a sample breakdown. Fix: space out clicks, wait
  ~a minute, or enable billing on the Google AI Studio project (stays very cheap).
- **⚠️ Rotate the Gemini API key.** The key used today was pasted into a chat, so treat it as
  exposed: delete it in Google AI Studio and create a new one. Re-enter it in the app
  (or run `localStorage.removeItem("styleloop-gemini-key")` in the browser console to be
  re-prompted). Never ship the key in browser code for a public deployment — put it behind a
  backend.
- **Cache-busting:** after editing `app.js`, bump the `?v=` value in `index.html` (or hard
  refresh with ⌘⇧R) or Safari serves old code.
- **The frontend `http.server` is not persistent** — restart it each session.
- **Catalog is only 11 items** → matches are limited by design until it grows.

---

## Next steps (for tomorrow)

1. **Grow the catalog (highest impact).** Add products to `backend/catalog.json` — each entry
   needs at least `{name, brand, category, color, price, url, image}` with a working `image`
   URL — then re-run `python build_index.py`. More/better products = better matches.
   - Eventually: pull from a real product feed (affiliate/retailer data) instead of by hand.
2. **Rotate the Gemini API key** (see gotchas).
3. **Optional improvements:**
   - Better cropping (Gemini's bounding boxes are decent but vary; could add a dedicated
     detector/segmenter).
   - Upgrade the embedder to `Marqo/marqo-fashionSigLIP` for better fashion matching
     (768-dim — would need a fresh `build_index.py` run).
   - Decide the production path: a hosted visual-search API (e.g. Google Lens via SerpAPI)
     vs. self-hosting this FashionCLIP backend; and move the Gemini key server-side.

---

## Honest status

- The **pipeline is real and works**: Gemini detection → crop → FashionCLIP embedding →
  SQLite/NumPy cosine search.
- "Exact match in every case" is **not** achievable from an arbitrary photo (no system does
  this); what's achievable is good *visual similarity*, and quality scales with the catalog.
