import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
const path = resolve(process.argv[2] ?? 'data/demo-image.png');
if (!path.startsWith(resolve('data') + sep)) throw new Error('Synthetic demo image must stay inside local data/');
mkdirSync(dirname(path), {recursive:true});
await sharp({create:{width:48,height:32,channels:3,background:'#24874b'}}).png().toFile(path);
