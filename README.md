# National Albums Mediation Lab

Interactive single-page viewer for 20 Israeli heritage photobooks, with 15 visual data analyses per album.

Built with React 18 (CDN) + Tailwind CSS, no build step required.

---

## Running locally (full mode — recommended)

Requires **Node.js 16+**.

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git
cd YOUR-REPO
node server.js
```

Open **http://localhost:4040** in your browser.

### What the server does
- Serves `index.html`
- `/api/albums` — returns all `album_*.json` files from the folder
- `/img/:id` — proxies images from S3 with local disk cache (`.image_cache/`)  
  The first time you open an album, images are fetched from S3.  
  After that they are served instantly from disk. The server also pre-warms the cache in the background on startup.

### Changing the port
```bash
PORT=8080 node server.js
```

---

## GitHub Pages (static mode)

The viewer also works as a **static site** on GitHub Pages (no Node.js required).

Enable GitHub Pages in your repo settings → point to the **main** branch root.

In static mode:
- Albums load from the `album_*.json` files committed to the repo (via `albums_list.json`)
- Images load **directly from S3** using the signed URLs stored in the JSON files
- ⚠️ **S3 signed URLs expire after 7 days.** After that, images will stop loading.  
  To refresh them, re-run `download_albums.ps1` (requires the NarrativeVision Docker stack to be running locally on port 8000) and push the updated JSON files.

---

## Refreshing album data

If the NarrativeVision backend (Docker) is running locally on port 8000:

```powershell
.\download_albums.ps1
```

This downloads all albums that are not yet in the folder (skips existing ones).  
To re-download everything (to refresh expired S3 URLs), delete the existing `album_*.json` files first.

---

## Album files

Each `album_*.json` file has this structure:
```json
{
  "album": { "id": "AL048", "title_en": "...", "title_he": "...", "year": 1948, ... },
  "export_date": "2026-03-12T15:00:00",
  "total_images": 69,
  "images": [
    {
      "image_id": "uuid",
      "image_num": 1,
      "uri": "https://s3.amazonaws.com/...",
      "caption": "...",
      "short_caption": "...",
      "width": 1200,
      "height": 1600,
      "ocr_text": null,
      "ocr_translation": null
    }
  ]
}
```

To add a new album manually, drop a JSON file named `album_<title>.json` in the folder and restart the server (or refresh the page).

---

## Project structure

```
index.html          ← Single-file React app (all visualizations)
server.js           ← Node.js HTTP server + S3 image proxy
albums_list.json    ← List of album JSON filenames (for GitHub Pages)
album_*.json        ← Album data (20 albums, ~4 MB total)
download_albums.ps1 ← Script to fetch albums from local Docker backend
.gitignore          ← Excludes .image_cache/ (large binary files)
package.json        ← npm start script
.image_cache/       ← Local image cache (auto-created, not committed)
```
