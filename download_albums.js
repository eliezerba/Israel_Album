// download_albums.js – downloads all albums from localhost:8000 backend
// Usage: node download_albums.js          (skip already-downloaded albums)
//        node download_albums.js --force  (re-download everything, updates place/languages)
// Node handles UTF-8 natively — no encoding issues.

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const API  = 'http://localhost:8000';
const DIR  = __dirname;

function get(url) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        mod.get(url, { headers: { 'Accept': 'application/json' } }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                try { resolve(JSON.parse(text)); }
                catch(e) { reject(new Error('JSON parse error: ' + text.slice(0,200))); }
            });
        }).on('error', reject);
    });
}

async function fetchImages(albumId) {
    const all = [];
    let page = 1;
    while (true) {
        const r = await get(`${API}/api/albums/${albumId}/images?page=${page}&page_size=200`);
        const batch = r.images || [];
        all.push(...batch);
        if (batch.length < 200) break;
        page++;
    }
    return all;
}

async function main() {
    const force = process.argv.includes('--force');

    // Existing album ids already on disk
    const existing = new Set(
        force ? [] :
        fs.readdirSync(DIR)
            .filter(n => n.startsWith('album_') && n.endsWith('.json'))
            .map(n => {
                try {
                    const raw = fs.readFileSync(path.join(DIR, n), 'utf8').replace(/^\uFEFF/, '');
                    return JSON.parse(raw).album?.id;
                } catch { return null; }
            })
            .filter(Boolean)
    );
    if (force) console.log('Force mode: re-downloading all albums');
    else console.log('Already have:', [...existing].join(', ') || '(none)');

    const { albums } = await get(`${API}/api/albums`);
    const toDownload = albums.filter(a => !existing.has(a.id));
    console.log(`Need to download: ${toDownload.length} albums\n`);

    const albumsList = [];

    for (const al of toDownload) {
        process.stdout.write(`  ↓ ${al.id}  ${al.title_en || al.title_he || ''}...`);
        const meta = (await get(`${API}/api/albums/${al.id}`)).album;
        const images = await fetchImages(al.id);

        let imgNum = 0;
        const out = {
            album: {
                id:        meta.id,
                title_en:  meta.title_en  || null,
                title_he:  meta.title_he  || null,
                author:    meta.author    || null,
                publisher: meta.publisher || null,
                year:      meta.year      || null,
                place:     meta.place     || null,
                languages: meta.languages || null,
            },
            export_date:  new Date().toISOString().slice(0, 19),
            total_images: images.length,
            images: images.map(img => ({
                image_id:        img.id,
                image_num:       ++imgNum,
                album_id:        al.id,
                album_title:     meta.title_en || meta.title_he || '',
                uri:             img.uri             || null,
                width:           img.width           || null,
                height:          img.height          || null,
                caption:         img.caption         || null,
                short_caption:   img.short_caption   || null,
                ocr_text:        img.ocr_text        || null,
                ocr_translation: img.ocr_translation || null,
            }))
        };

        const title    = meta.title_en || meta.title_he || al.id;
        const safeName = title.replace(/[\\/:*?"<>|]/g, '_');
        const filename = `album_${safeName}.json`;
        const filepath = path.join(DIR, filename);

        // If a file with this name exists, append the ID to disambiguate
        const finalPath = fs.existsSync(filepath)
            ? path.join(DIR, `album_${safeName} (${al.id}).json`)
            : filepath;

        fs.writeFileSync(finalPath, JSON.stringify(out, null, 2), 'utf8');
        albumsList.push(path.basename(finalPath));
        console.log(`  ✅  ${images.length} images  →  ${path.basename(finalPath)}`);
    }

    // Also collect existing album filenames
    const allFiles = fs.readdirSync(DIR)
        .filter(n => n.startsWith('album_') && n.endsWith('.json'))
        .sort();

    fs.writeFileSync(path.join(DIR, 'albums_list.json'),
        JSON.stringify(allFiles, null, 2), 'utf8');

    console.log(`\n✅ Done.  albums_list.json updated (${allFiles.length} albums).`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
