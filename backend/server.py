"""FashionCLIP visual-similarity search server (SQLite store + NumPy cosine).

Run:  python server.py   (serves on http://localhost:8008)
POST /search  { "image": <dataURL/base64>, "box": [l,t,r,b]|null, "category": "Bottom"|null, "k": 8 }
  -> { "matches": [ {name, brand, category, color, price, url, image, similarity}, ... ] }

Two things that make results actually useful:
  1. CATEGORY FILTER — if the clicked piece is a "Bottom", we only compare against
     bottoms, so jeans never return belts or earrings.
  2. SIMILARITY FLOOR — if nothing clears MIN_SIM we return nothing ("no close match")
     instead of padding the list with junk.
"""
import base64
import io
import re
import sqlite3
from datetime import datetime, timezone

import numpy as np
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from PIL import Image

from embedder import embed_image, load_model, DIM

DB = "catalog.db"
IMAGES_DIR = "images"
IMG_BASE = "http://localhost:8008/img"
MIN_SIM = 0.50          # cosine floor; below this we don't call it a match
BOX_PAD = 0.08          # expand the crop box by this fraction on each side
COLOR_BONUS = 0.15      # added to score when the candidate's color matches the query's
COLOR_PENALTY = 0.10    # subtracted when colors clash (both known but different family)

# Map the dataset's 46 baseColour values onto a few families so "navy" matches "blue",
# "maroon" matches "red", "beige" matches "brown", etc.
COLOR_FAMILY = {}
for _fam, _names in {
    "red": ["red", "maroon", "burgundy", "rust"],
    "pink": ["pink", "magenta", "rose", "fuchsia"],
    "orange": ["orange", "coral", "peach"],
    "yellow": ["yellow", "mustard", "gold"],
    "green": ["green", "olive", "lime green", "sea green", "fluorescent green"],
    "blue": ["blue", "navy blue", "turquoise blue", "teal"],
    "purple": ["purple", "lavender", "mauve"],
    "brown": ["brown", "tan", "khaki", "beige", "cream", "coffee brown",
              "nude", "camel", "bronze", "skin", "mushroom brown"],
    "white": ["white", "off white"],
    "grey": ["grey", "silver", "steel", "charcoal", "grey melange"],
    "black": ["black"],
}.items():
    for _n in _names:
        COLOR_FAMILY[_n] = _fam


def color_family(name):
    return COLOR_FAMILY.get((name or "").strip().lower())

app = Flask(__name__)
CORS(app)  # allow the browser app (127.0.0.1:8001) to call this

_index = None  # (meta list, np.ndarray[N, DIM], category array) loaded once


def load_index():
    global _index
    if _index is None:
        db = sqlite3.connect(DB)
        rows = db.execute(
            "SELECT name, brand, category, article_type, color, price, url, image_file, embedding "
            "FROM products"
        ).fetchall()
        db.close()
        meta, vecs, cats = [], [], []
        for r in rows:
            meta.append({"name": r[0], "brand": r[1], "category": r[2], "article_type": r[3],
                         "color": r[4], "price": r[5], "url": r[6],
                         "image": f"{IMG_BASE}/{r[7]}"})
            vecs.append(np.frombuffer(r[8], dtype=np.float32))
            cats.append((r[2] or "").lower())
        mat = np.vstack(vecs) if vecs else np.zeros((0, DIM), dtype=np.float32)
        _index = (meta, mat, np.array(cats))
    return _index


def decode_image(data):
    if data.strip().startswith("data:") and "," in data:
        data = data.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(data))).convert("RGB")


def crop_to_box(img, box):
    """box = [left, top, right, bottom] as 0-1 fractions (or 0-1000). Padded a bit."""
    if not box or len(box) != 4:
        return img
    coords = list(box)
    if any(c > 1 for c in coords):
        coords = [c / 1000.0 for c in coords]
    x0, y0, x1, y1 = coords
    x0, x1 = min(x0, x1) - BOX_PAD, max(x0, x1) + BOX_PAD
    y0, y1 = min(y0, y1) - BOX_PAD, max(y0, y1) + BOX_PAD
    w, h = img.size
    left, right = int(max(0, x0) * w), int(min(1, x1) * w)
    top, bottom = int(max(0, y0) * h), int(min(1, y1) * h)
    if right - left > 10 and bottom - top > 10:
        return img.crop((left, top, right, bottom))
    return img


@app.get("/img/<path:filename>")
def serve_image(filename):
    return send_from_directory(IMAGES_DIR, filename)


@app.get("/health")
def health():
    meta, _, _ = load_index()
    return {"ok": True, "indexed": len(meta)}


@app.get("/where")
def where():
    """Approximate location from the machine's public IP — no GPS prompt.
    Done server-side (no browser CORS), and since this app runs on the user's
    own machine, the server's public IP resolves to the user's real city.
    """
    try:
        data = requests.get("https://ipwho.is/", timeout=8).json()
        if not data.get("success", True):
            raise ValueError(data.get("message", "lookup failed"))
        return jsonify({
            "lat": data["latitude"],
            "lon": data["longitude"],
            "city": data.get("city", ""),
            "region": data.get("region", ""),
            "country": data.get("country", ""),
        })
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502


def _parse_ics_dt(value):
    """Pull a datetime out of a DTSTART value like 20260618T100000Z / 20260618."""
    m = re.search(r"(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?", value)
    if not m:
        return None, ""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if m.group(4) is not None:
        hh, mm = int(m.group(4)), int(m.group(5))
        return datetime(y, mo, d, hh, mm, tzinfo=timezone.utc), f"{hh:02d}:{mm:02d}"
    return datetime(y, mo, d, tzinfo=timezone.utc), ""


@app.get("/calendar")
def calendar():
    """Fetch a calendar's iCal/ICS link server-side (avoids browser CORS) and
    return the next few upcoming events. Works with the 'secret iCal address'
    Google/Apple/Outlook calendars expose. Note: recurring events aren't expanded.
    """
    url = request.args.get("url", "").strip()
    if url.lower().startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    if not url.lower().startswith(("http://", "https://")):
        return jsonify({"error": "provide a valid iCal (.ics) link"}), 400
    try:
        raw = requests.get(url, timeout=10, headers={"User-Agent": "StyleLoop/1.0"}).text
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"could not fetch calendar ({e})"}), 502

    text = re.sub(r"\r?\n[ \t]", "", raw)  # unfold RFC5545 continuation lines
    now = datetime.now(timezone.utc)
    events = []
    for block in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", text, re.S):
        dm = re.search(r"\nDTSTART(?:;[^:\n]*)?:([^\r\n]+)", block)
        if not dm:
            continue
        dt, label_time = _parse_ics_dt(dm.group(1))
        if not dt:
            continue
        sm = re.search(r"\nSUMMARY(?:;[^:\n]*)?:([^\r\n]+)", block)
        summary = sm.group(1).strip().replace("\\,", ",").replace("\\n", " ") if sm else "Event"
        events.append((dt, summary, label_time))

    upcoming = sorted([e for e in events if e[0] >= now], key=lambda e: e[0])[:5]
    out = [{
        "summary": s,
        "time": t,
        "date": dt.strftime("%a %b %d"),
        "label": f"{s} at {t}" if t else s,
    } for dt, s, t in upcoming]
    return jsonify({"events": out, "total": len(events)})


# Everyday words -> the words this dataset actually uses (it says "Sweatshirts",
# not "hoodie"; "Casual Shoes", not "sneakers"). A token matches if ANY of its
# synonyms appears, so "black hoodie" finds black sweatshirts.
SYNONYMS = {
    "hoodie": ["sweatshirt", "hooded", "hoodie"],
    "hoodies": ["sweatshirt", "hooded"],
    "sweatshirt": ["sweatshirt", "hooded"],
    "jumper": ["sweater", "sweatshirt"],
    "sweater": ["sweater", "pullover"],
    "sneaker": ["casual shoes", "sports shoes"],
    "sneakers": ["casual shoes", "sports shoes"],
    "trainers": ["casual shoes", "sports shoes"],
    "trainer": ["casual shoes", "sports shoes"],
    "pants": ["trousers", "track pants"],
    "joggers": ["track pants"],
    "sweatpants": ["track pants"],
    "tee": ["tshirt", "t-shirt"],
    "tees": ["tshirt"],
    "t-shirt": ["tshirt"],
    "glasses": ["sunglasses"],
    "shades": ["sunglasses"],
    "bag": ["handbag", "backpack", "clutch"],
    "purse": ["handbag", "clutch"],
    "coat": ["jacket", "coat"],
    "trousers": ["trousers"],
}


@app.post("/catalog_search")
def catalog_search():
    """Plain text search over the real product catalog (no embedding needed).
    Every word in the query must appear in the product's name/type/color/category,
    so "black nike hoodie" narrows instead of widening. Returns real product photos.
    """
    body = request.get_json(force=True)
    query = (body.get("query") or "").strip().lower()
    k = min(int(body.get("k", 24)), 60)
    tokens = [t for t in query.split() if t]

    db = sqlite3.connect(DB)
    cols = "name, brand, category, article_type, color, price, url, image_file"
    if tokens:
        token_clauses, params = [], []
        for t in tokens:
            terms = [t] + [s for s in SYNONYMS.get(t, []) if s != t]
            ors = []
            for term in terms:
                like = f"%{term}%"
                ors.append("(lower(name) LIKE ? OR lower(article_type) LIKE ? OR lower(color) LIKE ? OR lower(category) LIKE ?)")
                params += [like, like, like, like]
            token_clauses.append("(" + " OR ".join(ors) + ")")
        where = " AND ".join(token_clauses)
        params.append(k)
        rows = db.execute(f"SELECT {cols} FROM products WHERE {where} LIMIT ?", params).fetchall()
    else:
        # No query yet — show a sample so the grid isn't empty on first load.
        rows = db.execute(f"SELECT {cols} FROM products LIMIT ?", (k,)).fetchall()
    db.close()

    results = [{
        "name": r[0], "brand": r[1] or "", "category": r[2], "article_type": r[3],
        "color": r[4], "price": r[5], "url": r[6], "image": f"{IMG_BASE}/{r[7]}",
    } for r in rows]
    return jsonify({"results": results})


@app.post("/search")
def search():
    body = request.get_json(force=True)
    if not body.get("image"):
        return jsonify({"error": "no image"}), 400

    img = crop_to_box(decode_image(body["image"]), body.get("box"))
    query = embed_image(img)  # already L2-normalized
    meta, mat, cats = load_index()
    if mat.shape[0] == 0:
        return jsonify({"matches": [], "error": "index is empty — run build_index.py"}), 200

    # 1. Category filter — only compare against the same kind of garment.
    wanted = (body.get("category") or "").strip().lower()
    if wanted and wanted not in ("all", ""):
        keep = np.where(cats == wanted)[0]
        if len(keep) == 0:      # unknown category -> don't filter to empty
            keep = np.arange(len(meta))
    else:
        keep = np.arange(len(meta))

    sims = mat[keep] @ query  # cosine similarity (both sides normalized)

    # 2. Color-aware re-rank — nudge same-color items up, clashing colors down,
    #    so a "red" query stops surfacing same-shaped shoes in beige/black.
    qfam = color_family(body.get("color"))
    scores = sims.copy()
    if qfam:
        for n, j in enumerate(keep):
            cfam = color_family(meta[int(j)].get("color"))
            if cfam == qfam:
                scores[n] += COLOR_BONUS
            elif cfam is not None:
                scores[n] -= COLOR_PENALTY

    k = min(int(body.get("k", 8)), len(keep))
    top = np.argsort(-scores)[:k]

    matches = []
    for j in top:
        sim = float(sims[j])           # floor is judged on real visual similarity
        if sim < MIN_SIM:              # 3. Similarity floor — skip weak matches
            continue
        item = dict(meta[int(keep[j])])
        item["similarity"] = round(sim, 3)
        matches.append(item)
    return jsonify({"matches": matches})


if __name__ == "__main__":
    load_model()  # warm up so the first real search is fast
    app.run(port=8008)
