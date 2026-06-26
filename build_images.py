from pathlib import Path
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from PIL import Image

root = Path(r"c:/Users/user/Ilanot Project Dropbox/Eliezer Baumgarten/אקדמיה/digital humanities/פלטפורמות הצגה/Israel_Album")
cache_dir = root / '.image_cache'
out_dir = root / 'images'
out_dir.mkdir(exist_ok=True)

json_files = sorted(root.glob('album_*.json'))
ids = []
for jf in json_files:
    try:
        data = json.loads(jf.read_text(encoding='utf-8-sig'))
    except Exception:
        continue
    for img in data.get('images', []) or []:
        image_id = img.get('image_id')
        if image_id:
            ids.append(image_id)

unique_ids = sorted(set(ids))

def process_one(image_id: str):
    src = cache_dir / f"{image_id}.jpg"
    dst = out_dir / f"{image_id}.jpg"
    if not src.exists():
        return ('missing', image_id)
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return ('skip', image_id)
    with Image.open(src) as im:
        im = im.convert('RGB')
        im.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        im.save(dst, format='JPEG', quality=74, optimize=True, progressive=True)
    return ('written', image_id)

written = skipped = missing = 0
workers = 12

with ThreadPoolExecutor(max_workers=workers) as ex:
    futures = [ex.submit(process_one, image_id) for image_id in unique_ids]
    for i, fut in enumerate(as_completed(futures), start=1):
        status, _ = fut.result()
        if status == 'written':
            written += 1
        elif status == 'skip':
            skipped += 1
        else:
            missing += 1
        if i % 200 == 0:
            print(f"done {i}/{len(unique_ids)}")

files = list(out_dir.glob('*.jpg'))
size_mb = sum(f.stat().st_size for f in files) / (1024*1024)
print({
    'album_json_files': len(json_files),
    'unique_image_ids': len(unique_ids),
    'written': written,
    'skipped_existing': skipped,
    'missing_in_cache': missing,
    'images_dir_count': len(files),
    'images_dir_size_mb': round(size_mb, 1),
})
