# StyleLoop visual-similarity backend (FashionCLIP + sqlite-vec)

Gemini still does the photo breakdown in the app. This backend powers **"Find similar"**:
it crops the photo to the chosen garment, embeds it with **FashionCLIP**, and finds the
nearest products in a **SQLite + sqlite-vec** vector index.

## One-time setup

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # installs torch + transformers (~a few minutes)
python build_index.py                    # downloads FashionCLIP (~600MB) + builds catalog.db
```

## Run the server

```bash
source .venv/bin/activate                 # if not already active
python server.py                          # serves http://localhost:8008
```

Leave it running, then use the app normally. Click **Find similar** on any detected piece.

## Notes
- `catalog.json` is the product index (currently the app's 12 built-in products). Add more
  products there — `{name, brand, category, color, price, url, image}` — and re-run
  `python build_index.py` to grow/improve the matches.
- First search loads the model into memory (the server warms it on startup, so it's ready).
- macOS Apple Silicon uses the GPU (`mps`) automatically.
