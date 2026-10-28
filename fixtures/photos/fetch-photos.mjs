// Фото со свободной лицензией для справочника видов и галереи Павлодара.
// Запуск: node fixtures/photos/fetch-photos.mjs
// Берём только метаданные и адреса превью (upload.wikimedia.org), файлы не скачиваем.
// Для каждого фото сохраняются автор, лицензия и ссылка — их обязательно показывать.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const UA = { 'User-Agent': 'GreenPavlodar-hackathon/0.1 (open data demo)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const FREE = /^(CC0|Public domain|CC BY(-SA)? [0-9.]+|CC BY(-SA)?)/i;

async function commonsInfo(files, width = 640) {
  const out = {};
  for (let i = 0; i < files.length; i += 40) {
    const titles = files.slice(i, i + 40).map((f) => (f.startsWith('File:') ? f : `File:${f}`)).join('|');
    const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${width}&titles=${encodeURIComponent(titles)}`;
    const j = await (await fetch(url, { headers: UA })).json();
    for (const p of Object.values(j.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const m = ii.extmetadata ?? {};
      const license = strip(m.LicenseShortName?.value);
      if (!FREE.test(license)) continue;
      out[p.title.replace(/^File:/, '').replace(/_/g, ' ')] = { src: ii.thumburl, page: ii.descriptionurl, author: strip(m.Artist?.value).slice(0, 80) || 'автор не указан', license };
    }
    await sleep(500);
  }
  return out;
}

// 1) Виды: латинское имя → статья ru.wikipedia → главное изображение статьи.
const speciesSrc = await readFile(join(root, 'apps/web/src/shared/api/mock/species.ts'), 'utf8');
const pairs = [...speciesSrc.matchAll(/id: '(sp-[a-z0-9-]+)'[^}]*?latin: '([^']+)'/g)].map((m) => [m[1], m[2].replace(/ var\..*| × .*/, '').replace(/^Petunia$/, 'Petunia')]);
const pageImage = {};
for (let i = 0; i < pairs.length; i += 20) {
  const chunk = pairs.slice(i, i + 20);
  const url = `https://ru.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=name&titles=${encodeURIComponent(chunk.map((p) => p[1]).join('|'))}`;
  const j = await (await fetch(url, { headers: UA })).json();
  const norm = new Map();
  for (const r of [...(j.query?.normalized ?? []), ...(j.query?.redirects ?? [])]) norm.set(r.from, r.to);
  const byTitle = new Map(Object.values(j.query?.pages ?? {}).map((p) => [p.title, p.pageimage]));
  for (const [id, latin] of chunk) {
    let t = latin;
    for (let k = 0; k < 3 && norm.has(t); k++) t = norm.get(t);
    if (byTitle.get(t)) pageImage[id] = byTitle.get(t);
  }
  await sleep(500);
}
const info = await commonsInfo(Object.values(pageImage));
const speciesPhotos = {};
for (const [id, file] of Object.entries(pageImage)) {
  const meta = info[file.replace(/_/g, ' ')];
  if (meta) speciesPhotos[id] = meta;
}
await writeFile(join(root, 'apps/web/src/shared/api/mock/speciesPhotos.json'), JSON.stringify(speciesPhotos, null, 1));
console.log(`Фото видов: ${Object.keys(speciesPhotos).length} из ${pairs.length}`);

// 2) Павлодар: поиск по Commons, только горизонтальные кадры от 1600 px со свободной лицензией.
const queries = ['Pavlodar', 'Pavlodar park', 'Pavlodar embankment Irtysh', 'Павлодар', 'Pavlodar street', 'Pavlodar square'];
const seen = new Map();
for (const q of queries) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=50&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1280`;
  const j = await (await fetch(url, { headers: UA })).json();
  for (const p of Object.values(j.query?.pages ?? {})) {
    const ii = p.imageinfo?.[0];
    if (!ii || ii.width < 1600 || ii.width < ii.height * 1.1) continue;
    const m = ii.extmetadata ?? {};
    const license = strip(m.LicenseShortName?.value);
    if (!FREE.test(license)) continue;
    const desc = strip(m.ImageDescription?.value);
    if (/map|карта|satellite|district|banner|coat|герб|logo|flag/i.test(p.title + desc)) continue;
    seen.set(p.title, { file: p.title, src: ii.thumburl, page: ii.descriptionurl, author: strip(m.Artist?.value).slice(0, 80) || 'автор не указан', license, licenseUrl: strip(m.LicenseUrl?.value), desc: desc.slice(0, 140) });
  }
  await sleep(700);
}
await writeFile(join(here, 'pavlodar-candidates.json'), JSON.stringify([...seen.values()], null, 1));
console.log(`Кандидатов фото Павлодара: ${seen.size} → fixtures/photos/pavlodar-candidates.json (отбирает человек)`);
