import { ru } from '../src/shared/i18n/ru';
import { kk } from '../src/shared/i18n/kk';
import { validateTranslations } from '../src/shared/i18n/validate';
const result = validateTranslations(ru, kk);
for (const [kind, keys] of Object.entries(result)) console.log(`${kind}: ${keys.length}${keys.length ? '\n' + keys.join('\n') : ''}`);
console.log(`Kazakh dictionary: ${Object.keys(kk).length}/${Object.keys(ru).length} keys`);
if (Object.values(result).some(keys => keys.length)) process.exitCode = 1;
