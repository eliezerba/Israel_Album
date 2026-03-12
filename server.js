/**
 * server.js – National Albums Mediation Lab
 * Run: node server.js  →  http://localhost:4040
 *
 * Features:
 *  - /            Serves index.html
 *  - /api/albums  Returns all album_*.json files
 *  - /img/:id     Proxies S3 images with disk cache (.image_cache/)
 *                 First request fetches from S3 once; all subsequent
 *                 requests are served instantly from local disk.
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT       = process.env.PORT || 4040;
const FOLDER     = __dirname;
const CACHE_DIR  = path.join(FOLDER, '.image_cache');

// Create image cache directory if it doesn’t exist
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── Collect all album_*.json files ─────────────────────────────────────
function loadAlbums() {
    return fs.readdirSync(FOLDER)
        .filter(name => name.startsWith('album_') && name.endsWith('.json'))
        .map(name => {
            try {
                const raw = fs.readFileSync(path.join(FOLDER, name), 'utf8').replace(/^\uFEFF/, '');
                return JSON.parse(raw);
            } catch (e) {
                console.error('Could not parse', name, e.message);
                return null;
            }
        })
        .filter(Boolean);
}

// ── Build image_id → S3 URL lookup map ─────────────────────────────────
let urlMap = {};
function buildUrlMap() {
    urlMap = {};
    loadAlbums().forEach(album => {
        (album.images || []).forEach(img => {
            if (img.image_id && img.uri) urlMap[img.image_id] = img.uri;
        });
    });
    return urlMap;
}
buildUrlMap();

// ── Background cache warm-up ────────────────────────────────────────────
// Downloads all uncached images from S3 in the background after startup.
// Concurrency limited to 6 to avoid overwhelming the network.
function prewarmCache() {
    const ids = Object.keys(urlMap);
    const uncached = ids.filter(id => {
        const p = path.join(CACHE_DIR, id + '.jpg');
        try { const s = fs.statSync(p); return s.size === 0; } catch(e) { return true; }
    });
    if (uncached.length === 0) {
        console.log(`   ✅ All ${ids.length} images already on disk cache — instant loading!`);
        return;
    }
    console.log(`   🔄 Warming cache: ${uncached.length} images to download in background...`);

    const CONCURRENCY = 6;
    let idx = 0, done = 0, failed = 0, active = 0;

    function fetchOne(imageId, cb) {
        const s3Url = urlMap[imageId];
        if (!s3Url) { failed++; return cb(); }
        let parsed;
        try { parsed = new URL(s3Url); } catch(e) { failed++; return cb(); }
        const cachePath = path.join(CACHE_DIR, imageId + '.jpg');
        const tmpPath   = cachePath + '.tmp';
        const file = fs.createWriteStream(tmpPath);
        const req = https.get({
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers: { 'User-Agent': 'NationalAlbumsViewer/warmup' }
        }, (res) => {
            if (res.statusCode !== 200) { res.resume(); file.destroy(); try { fs.unlinkSync(tmpPath); } catch(_){} failed++; return cb(); }
            res.pipe(file);
            file.on('finish', () => file.close(() => {
                fs.rename(tmpPath, cachePath, () => { done++; cb(); });
            }));
            file.on('error', () => { file.destroy(); try { fs.unlinkSync(tmpPath); } catch(_){} failed++; cb(); });
        });
        req.on('error', () => { file.destroy(); try { fs.unlinkSync(tmpPath); } catch(_){} failed++; cb(); });
        req.setTimeout(30000, () => req.destroy());
    }

    function next() {
        while (active < CONCURRENCY && idx < uncached.length) {
            active++;
            const id = uncached[idx++];
            fetchOne(id, () => {
                active--;
                if ((done + failed) % 30 === 0 && done > 0)
                    console.log(`   📦 Cached ${done}/${uncached.length} images...`);
                if (idx < uncached.length) next();
                else if (active === 0)
                    console.log(`   ✅ Cache warm-up done: ${done} cached, ${failed} failed`);
            });
        }
    }
    next();
}
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.ico':  'image/x-icon',
};

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0]; // strip query string

    const pathname = (req.url || '/').split('?')[0];

    // ── API: list of albums ────────────────────────────────────────────
    if (pathname === '/api/albums') {
        const albums = loadAlbums();
        buildUrlMap(); // refresh URL map whenever albums are fetched
        const body = JSON.stringify(albums);
        res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        });
        res.end(body);
        return;
    }

    // ── Image proxy with disk cache ────────────────────────────────────
    if (pathname.startsWith('/img/')) {
        const imageId = decodeURIComponent(pathname.slice(5));

        // Security: only allow UUID-like IDs (hex + dashes)
        if (!imageId || !/^[0-9a-f\-]+$/i.test(imageId)) {
            res.writeHead(400); res.end('Invalid image ID'); return;
        }

        const cachePath = path.join(CACHE_DIR, imageId + '.jpg');

        // Serve from disk cache if available
        if (fs.existsSync(cachePath)) {
            const stat = fs.statSync(cachePath);
            if (stat.size > 0) {
                res.writeHead(200, {
                    'Content-Type': 'image/jpeg',
                    'Content-Length': stat.size,
                    'Cache-Control': 'public, max-age=31536000, immutable',
                });
                fs.createReadStream(cachePath).pipe(res);
                return;
            }
            // Zero-byte cached file means previous fetch failed, try again
            fs.unlinkSync(cachePath);
        }

        // Lookup the S3 URL
        const s3Url = urlMap[imageId];
        if (!s3Url) {
            // URL map might be stale, try rebuilding once
            buildUrlMap();
            const s3UrlRetry = urlMap[imageId];
            if (!s3UrlRetry) {
                res.writeHead(404); res.end('Image not found: ' + imageId); return;
            }
        }

        // Fetch from S3, stream to client and save to disk simultaneously
        let parsed;
        try { parsed = new URL(urlMap[imageId]); } catch(e) { res.writeHead(500); res.end('Bad S3 URL'); return; }

        const fetchReq = https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'NationalAlbumsViewer/1.0' } }, (s3Res) => {
            if (s3Res.statusCode !== 200) {
                console.error(`S3 → ${s3Res.statusCode} for ${imageId}`);
                res.writeHead(s3Res.statusCode || 502); res.end('S3 error ' + s3Res.statusCode);
                s3Res.resume(); return;
            }
            res.writeHead(200, {
                'Content-Type': s3Res.headers['content-type'] || 'image/jpeg',
                'Cache-Control': 'public, max-age=31536000, immutable',
            });
            const chunks = [];
            s3Res.on('data', chunk => { chunks.push(chunk); res.write(chunk); });
            s3Res.on('end', () => {
                res.end();
                const buf = Buffer.concat(chunks);
                fs.writeFile(cachePath, buf, err => {
                    if (err) { console.error('Cache write error', imageId, err.message); fs.unlink(cachePath, ()=>{}); }
                    else { process.stdout.write(`  ► cached ${imageId.slice(0,8)}… (${Math.round(buf.length/1024)}KB)\n`); }
                });
            });
            s3Res.on('error', err => { res.end(); fs.unlink(cachePath, ()=>{}); });
        });
        fetchReq.on('error', err => {
            console.error('HTTPS error:', err.message);
            if (!res.headersSent) { res.writeHead(502); res.end('Fetch error'); }
        });
        return;
    }

    // ── Static files ───────────────────────────────────────────────────────
    const safeName = path.basename(pathname === '/' ? 'index.html' : pathname);
    const filePath = path.join(FOLDER, safeName);

    // Security: reject path traversal attempts
    if (!filePath.startsWith(FOLDER + path.sep) && filePath !== path.join(FOLDER, safeName)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + safeName);
            return;
        }
        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    const albums = loadAlbums();
    console.log(`\n✅  National Albums Lab  →  http://localhost:${PORT}  (also try http://127.0.0.1:${PORT})`);
    console.log(`\n   Albums loaded (${albums.length}):`);
    albums.forEach(a => console.log('    •', a.album?.title_en || a.album?.title_he, `(${a.total_images} images)`));
    const cached = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.jpg')).length;
    console.log(`\n   Image cache: ${CACHE_DIR}`);
    console.log(`   Cached images: ${cached} / ${Object.keys(urlMap).length} total`);
    console.log('\n   Press Ctrl+C to stop.\n');
    // Start background download of all uncached images
    prewarmCache();
});
