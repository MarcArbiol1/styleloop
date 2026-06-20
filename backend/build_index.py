"""One-time: embed the product catalog and store vectors in SQLite.

Run:  python build_index.py
Reads catalog.json (written by load_subset.py), embeds each LOCAL product image
from ./images/ with FashionCLIP, and stores the (normalized) vector as a BLOB
alongside the product metadata in catalog.db. Similarity search is done in NumPy
at query time (see server.py) — no SQLite extension needed.
"""
import json
import os
import sqlite3
import time

import numpy as np
from PIL import Image

from embedder import embed_image

DB = "catalog.db"
CATALOG = "catalog.json"
IMAGES_DIR = "images"


def main():
    products = json.load(open(CATALOG))
    db = sqlite3.connect(DB)
    db.execute("DROP TABLE IF EXISTS products")
    db.execute(
        "CREATE TABLE products (id INTEGER PRIMARY KEY, pid TEXT, name TEXT, brand TEXT, "
        "category TEXT, article_type TEXT, color TEXT, price REAL, url TEXT, "
        "image_file TEXT, embedding BLOB)"
    )

    total = len(products)
    indexed = 0
    start = time.time()
    for i, p in enumerate(products, start=1):
        path = os.path.join(IMAGES_DIR, p.get("image_file", ""))
        try:
            img = Image.open(path).convert("RGB")
            vec = embed_image(img).astype(np.float32)
        except Exception as exc:
            print(f"  skip {p.get('name')!r}: {exc}")
            continue
        db.execute(
            "INSERT INTO products (id, pid, name, brand, category, article_type, color, "
            "price, url, image_file, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (i, p.get("id", ""), p["name"], p.get("brand", ""), p.get("category", ""),
             p.get("articleType", ""), p.get("color", ""), p.get("price"),
             p.get("url", ""), p.get("image_file", ""), vec.tobytes()),
        )
        indexed += 1
        if indexed % 250 == 0:
            rate = indexed / (time.time() - start)
            eta = (total - indexed) / rate if rate else 0
            print(f"  [{indexed}/{total}] {rate:.1f} img/s, ~{eta/60:.1f} min left")

    db.commit()
    db.close()
    print(f"\nDone: indexed {indexed} products into {DB} in {(time.time()-start)/60:.1f} min")


if __name__ == "__main__":
    main()
