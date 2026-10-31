import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const base = path.dirname(fileURLToPath(import.meta.url));
const root = await fs.realpath(path.join(base, 'site'));
const host = '127.0.0.1';
const port = 5194;
const startUrl = `http://${host}:${port}/?source=mock&lang=ru#/`;
const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.geojson':'application/geo+json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml',
  '.webp':'image/webp', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2',
  '.ttf':'font/ttf', '.wasm':'application/wasm', '.glb':'model/gltf-binary',
  '.gltf':'model/gltf+json', '.mp4':'video/mp4', '.webm':'video/webm', '.pdf':'application/pdf'
};

function reply(res, status, message, type='text/plain; charset=utf-8', head=false) {
  res.writeHead(status, {'Content-Type':type, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
  res.end(head ? undefined : message);
}

const server = http.createServer(async (req,res) => {
  const head = req.method === 'HEAD';
  try {
    if (!['127.0.0.1:5194','localhost:5194'].includes(req.headers.host)) {
      return reply(res, 403, 'Local host only.', undefined, head);
    }
    let pathname;
    try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
    catch { return reply(res, 400, 'Invalid URL encoding.', undefined, head); }
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':') ||
        pathname.split('/').some(part => part === '.' || part === '..') || !pathname.startsWith('/')) {
      return reply(res, 400, 'Invalid path.', undefined, head);
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return reply(res, 503, JSON.stringify({error:'OFFLINE_API_UNAVAILABLE',message:'This package serves static files only. Use ?source=mock. No API operation was performed.'}), 'application/json; charset=utf-8', head);
    }
    if (req.method !== 'GET' && !head) return reply(res, 405, 'Only GET and HEAD are supported.');
    const candidate = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(root, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return reply(res, 403, 'Outside static root.', undefined, head);
    let actual, stat;
    try { actual = await fs.realpath(candidate); stat = await fs.stat(actual); }
    catch { return reply(res, 404, 'File not found.', undefined, head); }
    const realRelative = path.relative(root, actual);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative) || !stat.isFile()) return reply(res, 404, 'File not found.', undefined, head);
    const content = await fs.readFile(actual);
    res.writeHead(200, {'Content-Type':mime[path.extname(actual).toLowerCase()] || 'application/octet-stream','Content-Length':content.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(head ? undefined : content);
  } catch {
    reply(res, 500, 'Static server error.', undefined, head);
  }
});
server.on('error', error => {
  console.error(`Cannot start local mock: ${error.code || error.message}. Port ${port} must be free.`);
  process.exitCode = 1;
});
server.listen(port,host,() => {
  console.log(`Green Pavlodar offline mock: ${startUrl}`);
  console.log('Static files only; API is unavailable. External map tiles/photos need a network. Use Scheme.');
  console.log('Keep this window open. Press Ctrl+C to stop.');
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const child = spawn('rundll32.exe',['url.dll,FileProtocolHandler',startUrl],{windowsHide:true,stdio:'ignore'});
    child.on('error',() => console.log(`Open this address in a browser: ${startUrl}`));
    child.unref();
  }
});
process.on('SIGINT',() => server.close(() => process.exit(0)));
