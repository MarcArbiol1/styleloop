"""Download a balanced subset of the Fashion Product Images dataset and write
a local catalog.

Source: ashraq/fashion-product-images-small (44k clean product shots + metadata).
We save the chosen images to ./images/<id>.jpg and write catalog.json with the
metadata the app needs, plus a mapped app-category used for filtering.

Usage:  python load_subset.py [TARGET_TOTAL] [CAP_PER_TYPE]
        defaults: 5000 total, 150 per articleType
"""
import json
import os
import sys
import urllib.parse

from datasets import load_dataset

TARGET = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
CAP_PER_TYPE = int(sys.argv[2]) if len(sys.argv) > 2 else 150

IMAGES_DIR = "images"
CATALOG = "catalog.json"

# Personal Care / Home / Free Items / Sporting Goods aren't wearable outfit pieces.
SKIP_MASTER = {"Personal Care", "Free Items", "Sporting Goods", "Home"}

# articleTypes that are really outerwear even though the dataset files them under Topwear.
OUTERWEAR_TYPES = {
    "Jackets", "Blazers", "Coats", "Sweaters", "Sweatshirts",
    "Rain Jacket", "Nehru Jackets", "Waistcoat", "Shrug",
}


def app_category(master, sub, article):
    """Map the dataset's taxonomy onto the app's 5 buckets so the UI's
    category filter (Top / Bottom / Outerwear / Shoes / Accessory) works."""
    if master == "Footwear":
        return "Shoes"
    if master == "Accessories":
        return "Accessory"
    if sub == "Bottomwear":
        return "Bottom"
    if sub == "Topwear":
        return "Outerwear" if article in OUTERWEAR_TYPES else "Top"
    if sub == "Dress" or article in {"Dresses", "Jumpsuit"}:
        return "Top"  # closest single-bucket fit for a full-body garment
    if sub == "Apparel Set":
        return "Top"
    return None  # innerwear, loungewear, socks, ties, etc. -> skip


def shop_url(name):
    return "https://www.google.com/search?tbm=shop&q=" + urllib.parse.quote(name)


def main():
    os.makedirs(IMAGES_DIR, exist_ok=True)
    print(f"Loading dataset (first run downloads ~600MB)... target={TARGET}, cap/type={CAP_PER_TYPE}")
    ds = load_dataset("ashraq/fashion-product-images-small", split="train")

    per_type = {}
    catalog = []
    for row in ds:
        if len(catalog) >= TARGET:
            break
        master = row.get("masterCategory")
        if master in SKIP_MASTER:
            continue
        sub = row.get("subCategory")
        article = row.get("articleType") or "Item"
        cat = app_category(master, sub, article)
        if cat is None:
            continue
        if per_type.get(article, 0) >= CAP_PER_TYPE:
            continue

        pid = str(row.get("id"))
        name = (row.get("productDisplayName") or article).strip()
        img = row["image"].convert("RGB")
        path = os.path.join(IMAGES_DIR, f"{pid}.jpg")
        img.save(path, "JPEG", quality=88)

        catalog.append({
            "id": pid,
            "name": name,
            "brand": "",                        # not a reliable separate field here
            "category": cat,                    # app bucket used for filtering
            "articleType": article,             # fine-grained type
            "subCategory": sub,
            "color": (row.get("baseColour") or "").lower(),
            "gender": row.get("gender") or "",
            "price": None,                      # dataset has no price
            "image_file": f"{pid}.jpg",         # served by the backend
            "url": shop_url(name),              # search link (no live product link in dataset)
        })
        per_type[article] = per_type.get(article, 0) + 1
        if len(catalog) % 500 == 0:
            print(f"  saved {len(catalog)} images...")

    with open(CATALOG, "w") as f:
        json.dump(catalog, f, indent=1)

    # quick breakdown so we can see coverage
    by_cat = {}
    for c in catalog:
        by_cat[c["category"]] = by_cat.get(c["category"], 0) + 1
    print(f"\nDone. {len(catalog)} products -> {CATALOG}")
    print("By app category:", json.dumps(by_cat, indent=2))


if __name__ == "__main__":
    main()
