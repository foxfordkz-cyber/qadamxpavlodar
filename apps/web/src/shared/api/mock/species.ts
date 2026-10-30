import type { EvidenceRef, Species } from '../types';
import photos from './speciesPhotos.json';

// Справочник видов для тестового источника. Характеристики — качественные оценки
// команды по общим сведениям о видах, НЕ региональный нормативный справочник.
// Перед показом жюри/городу заменить ссылками на проверенный источник
// (дендролог, ботанический сад, рекомендации акимата) — sourceType care_reference.

export const speciesEvidence: EvidenceRef = {
  id: 'ev-team-species-notes',
  sourceType: 'manual',
  sourceLabel: 'Сведения о видах, собранные командой (не проверены специалистом)',
  dataClass: 'estimate',
  note: 'Качественные оценки «низкая/средняя/высокая» по общим описаниям видов. Требуют проверки дендрологом для условий Павлодара.',
};

export const priceEvidence: EvidenceRef = {
  id: 'ev-demo-prices',
  sourceType: 'fixture',
  sourceLabel: 'Демо-цены команды (не прайс питомника)',
  dataClass: 'demo',
  note: 'Указаны для 4 видов, чтобы показать расчёт ведомости. Остальные цены неизвестны — итог помечается как неполный.',
};

// Казахские названия и источники: docs/kk-glossary.md → «Өсімдіктер».
// null означает отсутствие подтверждённого названия, интерфейс сохраняет русский вариант.
const base = { evidenceIds: [speciesEvidence.id], dataClass: 'estimate' as const, nameKk: null };

const base_: Species[] = [
  { ...base, id: 'sp-ulmus-pumila', nameRu: 'Вяз приземистый (карагач)', nameKk: null, latin: 'Ulmus pumila', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'high', matureHeightM: [10, 15], minAreaM2: 25, native: false, invasiveRisk: false, allergenic: false, notes: ['Широко используется в степных городах.', 'Даёт обильный самосев — нужен уход.'] },
  { ...base, id: 'sp-pinus-sylvestris', nameRu: 'Сосна обыкновенная', nameKk: "Кәдімгі қарағай", latin: 'Pinus sylvestris', form: 'tree', evergreen: true, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'low', matureHeightM: [15, 25], minAreaM2: 30, native: true, invasiveRisk: false, allergenic: false, notes: ['Местный вид Прииртышья (ленточные боры).', 'Плохо переносит противогололёдные реагенты.'] },
  { ...base, id: 'sp-betula-pendula', nameRu: 'Берёза повислая', nameKk: "Салпыншақ қайың", latin: 'Betula pendula', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [15, 25], minAreaM2: 25, native: true, invasiveRisk: false, allergenic: true, notes: ['Сильный аллерген (пыльца весной).'] },
  { ...base, id: 'sp-picea-pungens', nameRu: 'Ель колючая', nameKk: null, latin: 'Picea pungens', form: 'tree', evergreen: true, frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'medium', matureHeightM: [10, 20], minAreaM2: 20, native: false, invasiveRisk: false, allergenic: false, notes: ['Устойчива к городскому загрязнению воздуха.'] },
  { ...base, id: 'sp-tilia-cordata', nameRu: 'Липа мелколистная', nameKk: "Ұсақ жапырақты жөке", latin: 'Tilia cordata', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [15, 20], minAreaM2: 25, native: false, invasiveRisk: false, allergenic: false, notes: ['В молодом возрасте нуждается в поливе.'] },
  { ...base, id: 'sp-malus-baccata', nameRu: 'Яблоня ягодная (сибирская)', nameKk: "Сібір алмасы", latin: 'Malus baccata', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'medium', matureHeightM: [5, 10], minAreaM2: 12, native: false, invasiveRisk: false, allergenic: false, notes: ['Декоративное цветение, подходит для небольших участков.'] },
  { ...base, id: 'sp-fraxinus-pennsylvanica', nameRu: 'Ясень пенсильванский', nameKk: null, latin: 'Fraxinus pennsylvanica', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [12, 20], minAreaM2: 25, native: false, invasiveRisk: true, allergenic: false, notes: ['В ряде регионов считается инвазивным — решение за специалистом.'] },
  { ...base, id: 'sp-populus-balsamifera', nameRu: 'Тополь бальзамический', nameKk: "Бальзам терек", latin: 'Populus balsamifera', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'medium', matureHeightM: [20, 30], minAreaM2: 40, native: false, invasiveRisk: false, allergenic: true, notes: ['Женские экземпляры дают пух — сажать только мужские.', 'Хрупкая древесина у старых деревьев.'] },
  { ...base, id: 'sp-acer-negundo', nameRu: 'Клён ясенелистный', nameKk: "Америка үйеңкісі", latin: 'Acer negundo', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [10, 20], minAreaM2: 20, native: false, invasiveRisk: true, allergenic: true, notes: ['Агрессивный инвазивный вид.'] },
  { ...base, id: 'sp-elaeagnus-angustifolia', nameRu: 'Лох узколистный', nameKk: "Жіңішке жапырақты жиде", latin: 'Elaeagnus angustifolia', form: 'tree', evergreen: false, frostHardiness: 'medium', droughtTolerance: 'high', saltTolerance: 'high', matureHeightM: [5, 8], minAreaM2: 12, native: true, invasiveRisk: false, allergenic: false, notes: ['Переносит засоление и засуху.', 'Колючий — не у детских площадок.'] },
  { ...base, id: 'sp-sorbus-aucuparia', nameRu: 'Рябина обыкновенная', nameKk: "Кәдімгі шетен", latin: 'Sorbus aucuparia', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'low', saltTolerance: 'low', matureHeightM: [5, 10], minAreaM2: 10, native: true, invasiveRisk: false, allergenic: false, notes: ['Требовательна к влаге.'] },
  { ...base, id: 'sp-caragana-arborescens', nameRu: 'Карагана древовидная (жёлтая акация)', nameKk: "Ағаш тәріздес қараған (сары қараған)", latin: 'Caragana arborescens', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'high', matureHeightM: [2, 5], minAreaM2: 2, native: true, invasiveRisk: false, allergenic: false, notes: ['Очень вынослива, подходит для живых изгородей.'] },
  { ...base, id: 'sp-syringa-vulgaris', nameRu: 'Сирень обыкновенная', nameKk: "Кәдімгі сирень", latin: 'Syringa vulgaris', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [2, 5], minAreaM2: 3, native: false, invasiveRisk: false, allergenic: false, notes: ['Даёт корневую поросль.'] },
  { ...base, id: 'sp-rosa-majalis', nameRu: 'Шиповник майский', nameKk: null, latin: 'Rosa majalis', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'medium', matureHeightM: [1, 2], minAreaM2: 2, native: true, invasiveRisk: false, allergenic: false, notes: ['Колючий.'] },
  { ...base, id: 'sp-cotoneaster-lucidus', nameRu: 'Кизильник блестящий', nameKk: "Жылтыр ырғай", latin: 'Cotoneaster lucidus', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [1, 2], minAreaM2: 1, native: false, invasiveRisk: false, allergenic: false, notes: ['Хорошо держит форму в стриженой изгороди.'] },
  { ...base, id: 'sp-spiraea-media', nameRu: 'Спирея средняя', nameKk: "Орта тобылғы", latin: 'Spiraea media', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [1, 2], minAreaM2: 1, native: true, invasiveRisk: false, allergenic: false, notes: [] },
  { ...base, id: 'sp-hippophae-rhamnoides', nameRu: 'Облепиха крушиновидная', nameKk: "Итшомыртты шырғанақ", latin: 'Hippophae rhamnoides', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'high', matureHeightM: [2, 4], minAreaM2: 4, native: true, invasiveRisk: false, allergenic: false, notes: ['Даёт обильную корневую поросль, колючая.'] },
  { ...base, id: 'sp-dasiphora-fruticosa', nameRu: 'Лапчатка кустарниковая', nameKk: null, latin: 'Dasiphora fruticosa', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [0.5, 1.5], minAreaM2: 1, native: true, invasiveRisk: false, allergenic: false, notes: ['Низкий кустарник для бордюров.'] },
];

const flower = { ...base, form: 'flower' as const, evergreen: false, minAreaM2: 0.1, invasiveRisk: false, allergenic: false, unit: 'pcs_per_m2' as const };

// Цветы для клумб: качественные оценки команды, сроки цветения — ориентировочные.
const flowers: Species[] = [
  { ...flower, id: 'sp-tagetes', nameRu: 'Бархатцы (однолетник)', nameKk: null, latin: 'Tagetes patula', frostHardiness: 'low', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [0.2, 0.4], native: false, notes: ['Однолетник: высаживается ежегодно рассадой.'], floweringMonths: [6, 7, 8, 9], careLevel: 'low', crownDiameterM: 0.25, pricePerUnitKzt: 300, priceEvidenceId: 'ev-demo-prices' },
  { ...flower, id: 'sp-hemerocallis', nameRu: 'Лилейник', nameKk: null, latin: 'Hemerocallis fulva', frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [0.6, 0.9], native: false, notes: ['Многолетник, неприхотлив.'], floweringMonths: [6, 7, 8], careLevel: 'low', crownDiameterM: 0.5, pricePerUnitKzt: null },
  { ...flower, id: 'sp-iris-sibirica', nameRu: 'Ирис сибирский', nameKk: null, latin: 'Iris sibirica', frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [0.6, 0.9], native: true, notes: ['Любит влагу в начале лета.'], floweringMonths: [5, 6], careLevel: 'low', crownDiameterM: 0.4, pricePerUnitKzt: null },
  { ...flower, id: 'sp-echinacea', nameRu: 'Эхинацея пурпурная', nameKk: null, latin: 'Echinacea purpurea', frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [0.6, 1.0], native: false, notes: ['Многолетник, привлекает опылителей.'], floweringMonths: [7, 8, 9], careLevel: 'low', crownDiameterM: 0.45, pricePerUnitKzt: null },
  { ...flower, id: 'sp-sedum-spectabile', nameRu: 'Очиток видный', nameKk: null, latin: 'Hylotelephium spectabile', frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'high', matureHeightM: [0.3, 0.5], native: false, notes: ['Суккулент, переносит засуху и соль.'], floweringMonths: [8, 9, 10], careLevel: 'low', crownDiameterM: 0.4, pricePerUnitKzt: null },
  { ...flower, id: 'sp-salvia-nemorosa', nameRu: 'Шалфей дубравный', nameKk: null, latin: 'Salvia nemorosa', frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [0.4, 0.6], native: true, notes: [], floweringMonths: [6, 7, 8], careLevel: 'low', crownDiameterM: 0.4, pricePerUnitKzt: null },
  { ...flower, id: 'sp-petunia', nameRu: 'Петуния (однолетник)', nameKk: null, latin: 'Petunia × hybrida', frostHardiness: 'low', droughtTolerance: 'low', saltTolerance: 'low', matureHeightM: [0.2, 0.4], native: false, notes: ['Требует регулярного полива и подкормки.'], floweringMonths: [6, 7, 8, 9], careLevel: 'high', crownDiameterM: 0.3, pricePerUnitKzt: null },
];

const extra: Record<string, Partial<Species>> = {
  'sp-ulmus-pumila': { crownDiameterM: 8, careLevel: 'medium' },
  'sp-pinus-sylvestris': { crownDiameterM: 6, careLevel: 'low', pricePerUnitKzt: 15000, priceEvidenceId: 'ev-demo-prices' },
  'sp-betula-pendula': { crownDiameterM: 7, careLevel: 'medium' },
  'sp-picea-pungens': { crownDiameterM: 5, careLevel: 'low' },
  'sp-tilia-cordata': { crownDiameterM: 8, careLevel: 'medium' },
  'sp-malus-baccata': { crownDiameterM: 5, careLevel: 'medium', floweringMonths: [5] },
  'sp-fraxinus-pennsylvanica': { crownDiameterM: 8, careLevel: 'low' },
  'sp-populus-balsamifera': { crownDiameterM: 10, careLevel: 'medium' },
  'sp-acer-negundo': { crownDiameterM: 8, careLevel: 'low' },
  'sp-elaeagnus-angustifolia': { crownDiameterM: 5, careLevel: 'low', floweringMonths: [6] },
  'sp-sorbus-aucuparia': { crownDiameterM: 4, careLevel: 'medium', floweringMonths: [5, 6] },
  'sp-caragana-arborescens': { crownDiameterM: 2.5, careLevel: 'low', floweringMonths: [5, 6], pricePerUnitKzt: 2500, priceEvidenceId: 'ev-demo-prices' },
  'sp-syringa-vulgaris': { crownDiameterM: 3, careLevel: 'low', floweringMonths: [5, 6], pricePerUnitKzt: 4000, priceEvidenceId: 'ev-demo-prices' },
  'sp-rosa-majalis': { crownDiameterM: 1.5, careLevel: 'low', floweringMonths: [6] },
  'sp-cotoneaster-lucidus': { crownDiameterM: 1.5, careLevel: 'medium' },
  'sp-spiraea-media': { crownDiameterM: 1.5, careLevel: 'low', floweringMonths: [5, 6] },
  'sp-hippophae-rhamnoides': { crownDiameterM: 3, careLevel: 'low' },
  'sp-dasiphora-fruticosa': { crownDiameterM: 1, careLevel: 'low', floweringMonths: [6, 7, 8] },
};

// --- Источники о том, что сажают в Павлодаре (новости акимата и СМИ) ---
export const pavlodarEvidence: EvidenceRef[] = [
  { id: 'ev-pvl-zakon-2026', sourceType: 'municipal', sourceLabel: 'Zakon.kz: «В Павлодаре обновляют зелёный фонд и высаживают новые аллеи»', sourceUrl: 'https://www.zakon.kz/sobytiia/6532027-taza-azastan-v-pavlodare-obnovlyayut-zelenyy-fond-i-vysazhivayut-novye-allei.html', observedAt: '2026-09-19T11:02:00Z', dataClass: 'real', note: 'Зелёный пояс и мкр. Жастар: сосна, ель, берёза, рябина, можжевельник, клён татарский. Липа мелколистная: 819 деревьев на улицах за два года; по данным экспертной группы приживаемость 100%. Крупномеры с кроной.' },
  { id: 'ev-pvl-24kz-2025', sourceType: 'municipal', sourceLabel: '24.kz: «Как обновляют зелёный фонд Павлодара»', sourceUrl: 'https://24.kz/ru/news/ekologiya/738073-kak-obnovlyayut-zelenyj-fond-pavlodara', observedAt: '2025-11-01T11:20:00Z', dataClass: 'real', note: 'Аллейные посадки: липа, тополь, клён, ива, сосна, ель, берёза. Учёные выбрали липу мелколистную. Осенью высажено более 200 тыс. деревьев и кустарников.' },
  { id: 'ev-pvl-qumash-2026', sourceType: 'municipal', sourceLabel: 'Qumash.kz: закупка на посадку и уход за деревьями, 5,349 млрд ₸ (2026–2028)', sourceUrl: 'https://qumash.kz/news/ekspert-raskritikoval-zakupku-na-ozelenenie-pavlodara-na-53-mlrd-tenge/', observedAt: '2026-06-09T00:00:00Z', dataClass: 'real', note: 'Отдел ЖКХ г. Павлодара. Виды в материале не перечислены. Отмечено, что систем автополива в городе мало.' },
  { id: 'ev-team-soviet', sourceType: 'manual', sourceLabel: 'Типовой ассортимент советского городского озеленения (обобщение команды)', dataClass: 'estimate', note: 'Классические для городов СССР и Казахстана породы бульваров, дворов и живых изгородей. Обобщение команды, не нормативный перечень.' },
];

const more: Species[] = [
  { ...base, id: 'sp-acer-tataricum', nameRu: 'Клён татарский (черноклён)', nameKk: "Татар үйеңкісі", latin: 'Acer tataricum', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [5, 9], minAreaM2: 12, native: true, invasiveRisk: false, allergenic: false, notes: ['Невысокий, подходит для дворов и под ЛЭП.', 'Красные крылатки летом, яркая осенняя листва.'] },
  { ...base, id: 'sp-salix-alba', nameRu: 'Ива белая', nameKk: "Ақтал", latin: 'Salix alba', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'low', saltTolerance: 'medium', matureHeightM: [15, 25], minAreaM2: 40, native: true, invasiveRisk: false, allergenic: false, notes: ['Влаголюбива — у воды и в понижениях.', 'Сажают в аллеях Павлодара.'] },
  { ...base, id: 'sp-populus-bolleana', nameRu: 'Тополь Болле (пирамидальный)', nameKk: null, latin: 'Populus alba var. pyramidalis', form: 'tree', evergreen: false, frostHardiness: 'medium', droughtTolerance: 'high', saltTolerance: 'high', matureHeightM: [15, 25], minAreaM2: 15, native: false, invasiveRisk: false, allergenic: false, notes: ['Узкая колонновидная крона — классика бульваров.', 'Мужские клоны без пуха.'] },
  { ...base, id: 'sp-larix-sibirica', nameRu: 'Лиственница сибирская', nameKk: "Сібір балқарағайы", latin: 'Larix sibirica', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [20, 30], minAreaM2: 40, native: false, invasiveRisk: false, allergenic: false, notes: ['Хвоя желтеет и опадает осенью.', 'Нужен простор — для парков и скверов.'] },
  { ...base, id: 'sp-quercus-robur', nameRu: 'Дуб черешчатый', nameKk: "Кәдімгі емен", latin: 'Quercus robur', form: 'tree', evergreen: false, frostHardiness: 'medium', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [15, 25], minAreaM2: 50, native: false, invasiveRisk: false, allergenic: false, notes: ['Долговечен, медленно растёт.', 'Молодые посадки нужно защищать от морозобоин.'] },
  { ...base, id: 'sp-malus-niedzwetzkyana', nameRu: 'Яблоня Недзвецкого', nameKk: "Недзвецкий алмасы", latin: 'Malus niedzwetzkyana', form: 'tree', evergreen: false, frostHardiness: 'medium', droughtTolerance: 'medium', saltTolerance: 'medium', matureHeightM: [5, 8], minAreaM2: 12, native: true, invasiveRisk: false, allergenic: false, notes: ['Казахстанский вид с пурпурной листвой и розовыми цветками.', 'Яркий акцент для сквера.'] },
  { ...base, id: 'sp-prunus-padus', nameRu: 'Черёмуха обыкновенная', nameKk: "Қарапайым мойыл", latin: 'Prunus padus', form: 'tree', evergreen: false, frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [6, 10], minAreaM2: 12, native: true, invasiveRisk: false, allergenic: false, notes: ['Душистое весеннее цветение.', 'Сильный запах — не у окон спален.'] },
  { ...base, id: 'sp-juniperus-sabina', nameRu: 'Можжевельник казацкий', nameKk: "Қызыл арша", latin: 'Juniperus sabina', form: 'shrub', evergreen: true, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [0.5, 1.5], minAreaM2: 3, native: true, invasiveRisk: false, allergenic: false, notes: ['Вечнозелёный стелющийся куст для склонов и бордюров.', 'Ядовит — не для детских площадок.'] },
  { ...base, id: 'sp-ribes-aureum', nameRu: 'Смородина золотистая', nameKk: "Сары қарақат", latin: 'Ribes aureum', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'high', matureHeightM: [1.5, 2.5], minAreaM2: 2, native: false, invasiveRisk: false, allergenic: false, notes: ['Очень засухоустойчива — классика степных изгородей.', 'Жёлтые душистые цветки весной, багряная листва осенью.'] },
  { ...base, id: 'sp-lonicera-tatarica', nameRu: 'Жимолость татарская', nameKk: "Татар ұшқаты", latin: 'Lonicera tatarica', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [2, 3], minAreaM2: 3, native: true, invasiveRisk: false, allergenic: false, notes: ['Розовые цветки, красные несъедобные ягоды.'] },
  { ...base, id: 'sp-philadelphus-coronarius', nameRu: 'Чубушник венечный (жасмин садовый)', nameKk: null, latin: 'Philadelphus coronarius', form: 'shrub', evergreen: false, frostHardiness: 'medium', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [2, 3], minAreaM2: 3, native: false, invasiveRisk: false, allergenic: false, notes: ['Белое душистое цветение в июне.'] },
  { ...base, id: 'sp-cornus-alba', nameRu: 'Дёрен белый', nameKk: null, latin: 'Cornus alba', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'low', saltTolerance: 'medium', matureHeightM: [2, 3], minAreaM2: 3, native: true, invasiveRisk: false, allergenic: false, notes: ['Красные побеги украшают зимой.', 'Любит влагу.'] },
  { ...base, id: 'sp-viburnum-opulus', nameRu: 'Калина обыкновенная', nameKk: "Бүрген шәңкіш", latin: 'Viburnum opulus', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'low', saltTolerance: 'low', matureHeightM: [2, 4], minAreaM2: 4, native: true, invasiveRisk: false, allergenic: false, notes: ['Белые шапки цветков, красные ягоды зимой.'] },
  { ...base, id: 'sp-physocarpus-opulifolius', nameRu: 'Пузыреплодник калинолистный', nameKk: null, latin: 'Physocarpus opulifolius', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [1.5, 3], minAreaM2: 2, native: false, invasiveRisk: false, allergenic: false, notes: ['Сорта с пурпурной или жёлтой листвой — цветной акцент весь сезон.'] },
  { ...base, id: 'sp-berberis-vulgaris', nameRu: 'Барбарис обыкновенный', nameKk: null, latin: 'Berberis vulgaris', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [1.5, 2.5], minAreaM2: 2, native: false, invasiveRisk: false, allergenic: false, notes: ['Колючий — для защитных изгородей.'] },
  { ...base, id: 'sp-tamarix-ramosissima', nameRu: 'Тамарикс многоветвистый (гребенщик)', nameKk: "Қызыл жыңғыл", latin: 'Tamarix ramosissima', form: 'shrub', evergreen: false, frostHardiness: 'medium', droughtTolerance: 'high', saltTolerance: 'high', matureHeightM: [2, 4], minAreaM2: 3, native: true, invasiveRisk: false, allergenic: false, notes: ['Растёт на засолённых почвах.', 'Розовые метёлки летом.'] },
  { ...base, id: 'sp-rosa-rugosa', nameRu: 'Роза морщинистая', nameKk: null, latin: 'Rosa rugosa', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'high', matureHeightM: [1, 2], minAreaM2: 2, native: false, invasiveRisk: false, allergenic: false, notes: ['Переносит соль у дорог.', 'Цветёт всё лето, крупные плоды осенью.'] },
  { ...base, id: 'sp-crataegus-sanguinea', nameRu: 'Боярышник кроваво-красный', nameKk: null, latin: 'Crataegus sanguinea', form: 'shrub', evergreen: false, frostHardiness: 'high', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [3, 5], minAreaM2: 4, native: true, invasiveRisk: false, allergenic: false, notes: ['Колючий, хорош в плотной изгороди.'] },
];

const moreFlowers: Species[] = [
  { ...flower, id: 'sp-paeonia-lactiflora', nameRu: 'Пион травянистый', nameKk: null, latin: 'Paeonia lactiflora', frostHardiness: 'high', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [0.7, 1], native: false, notes: ['Многолетник-долгожитель, классика советских скверов.'], floweringMonths: [6], careLevel: 'medium', crownDiameterM: 0.8, pricePerUnitKzt: null },
  { ...flower, id: 'sp-phlox-paniculata', nameRu: 'Флокс метельчатый', nameKk: null, latin: 'Phlox paniculata', frostHardiness: 'high', droughtTolerance: 'low', saltTolerance: 'low', matureHeightM: [0.6, 1], native: false, notes: ['Душистые шапки цветков, любит полив.'], floweringMonths: [7, 8], careLevel: 'medium', crownDiameterM: 0.5, pricePerUnitKzt: null },
  { ...flower, id: 'sp-cosmos-bipinnatus', nameRu: 'Космея (однолетник)', nameKk: null, latin: 'Cosmos bipinnatus', frostHardiness: 'low', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [0.6, 1.2], native: false, notes: ['Сеется прямо в грунт, неприхотлива.'], floweringMonths: [7, 8, 9], careLevel: 'low', crownDiameterM: 0.35, pricePerUnitKzt: null },
  { ...flower, id: 'sp-zinnia-elegans', nameRu: 'Цинния (однолетник)', nameKk: null, latin: 'Zinnia elegans', frostHardiness: 'low', droughtTolerance: 'high', saltTolerance: 'medium', matureHeightM: [0.3, 0.8], native: false, notes: ['Яркие крупные соцветия, жаростойка.'], floweringMonths: [7, 8, 9], careLevel: 'low', crownDiameterM: 0.3, pricePerUnitKzt: null },
  { ...flower, id: 'sp-salvia-splendens', nameRu: 'Сальвия блестящая (однолетник)', nameKk: null, latin: 'Salvia splendens', frostHardiness: 'low', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [0.25, 0.5], native: false, notes: ['Алые «свечи» — классика советских клумб.'], floweringMonths: [6, 7, 8, 9], careLevel: 'medium', crownDiameterM: 0.25, pricePerUnitKzt: null },
  { ...flower, id: 'sp-ageratum', nameRu: 'Агератум (однолетник)', nameKk: null, latin: 'Ageratum houstonianum', frostHardiness: 'low', droughtTolerance: 'medium', saltTolerance: 'low', matureHeightM: [0.15, 0.3], native: false, notes: ['Низкий голубой бордюр.'], floweringMonths: [6, 7, 8, 9], careLevel: 'medium', crownDiameterM: 0.2, pricePerUnitKzt: null },
  { ...flower, id: 'sp-hosta', nameRu: 'Хоста', nameKk: null, latin: 'Hosta sieboldiana', frostHardiness: 'high', droughtTolerance: 'low', saltTolerance: 'low', matureHeightM: [0.4, 0.7], native: false, notes: ['Для тени у северных стен домов.'], floweringMonths: [7], careLevel: 'low', crownDiameterM: 0.6, pricePerUnitKzt: null },
];

type Use = 'alley' | 'yard' | 'square' | 'hedge' | 'flowerbed' | 'roadside' | 'greenbelt';
interface Profile { benefits: string[]; beauty: string[]; uses: Use[]; pavlodar?: string; soviet?: boolean; spacingM?: number }
// Польза и красота для города — обобщение команды по типичным свойствам видов (dataClass estimate).
const P: Record<string, Profile> = {
  'sp-ulmus-pumila': { benefits: ['Тень', 'Ветрозащита', 'Пылезадержание'], beauty: ['Плотная крона'], uses: ['alley', 'greenbelt', 'roadside'], soviet: true, spacingM: 6 },
  'sp-pinus-sylvestris': { benefits: ['Фитонциды', 'Ветрозащита', 'Зелень зимой'], beauty: ['Вечнозелёная', 'Красная кора'], uses: ['greenbelt', 'square'], pavlodar: 'ev-pvl-zakon-2026', spacingM: 5 },
  'sp-betula-pendula': { benefits: ['Светлая тень', 'Пылезадержание'], beauty: ['Белая кора', 'Золотая осень'], uses: ['yard', 'square', 'greenbelt'], pavlodar: 'ev-pvl-zakon-2026', soviet: true, spacingM: 5 },
  'sp-picea-pungens': { benefits: ['Зелень зимой', 'Шумозащита', 'Ветрозащита'], beauty: ['Голубая хвоя'], uses: ['square', 'alley', 'greenbelt'], pavlodar: 'ev-pvl-zakon-2026', soviet: true, spacingM: 5 },
  'sp-tilia-cordata': { benefits: ['Густая тень', 'Медонос', 'Пылезадержание'], beauty: ['Душистое цветение', 'Ровная крона'], uses: ['alley', 'yard', 'roadside'], pavlodar: 'ev-pvl-zakon-2026', soviet: true, spacingM: 7 },
  'sp-malus-baccata': { benefits: ['Медонос', 'Корм птицам'], beauty: ['Белое цветение', 'Плоды зимой'], uses: ['yard', 'square'], soviet: true, spacingM: 5 },
  'sp-fraxinus-pennsylvanica': { benefits: ['Тень', 'Пылезадержание'], beauty: ['Жёлтая осень'], uses: ['alley', 'roadside'], soviet: true, spacingM: 7 },
  'sp-populus-balsamifera': { benefits: ['Быстрый рост', 'Много кислорода', 'Тень'], beauty: ['Аромат почек весной'], uses: ['alley', 'greenbelt'], pavlodar: 'ev-pvl-24kz-2025', soviet: true, spacingM: 8 },
  'sp-acer-negundo': { benefits: [], beauty: [], uses: [], soviet: true },
  'sp-elaeagnus-angustifolia': { benefits: ['Растёт на засолённых почвах', 'Медонос'], beauty: ['Серебристая листва'], uses: ['roadside', 'hedge', 'greenbelt'], spacingM: 4 },
  'sp-sorbus-aucuparia': { benefits: ['Корм птицам'], beauty: ['Белое цветение', 'Красные гроздья', 'Яркая осень'], uses: ['yard', 'square'], pavlodar: 'ev-pvl-zakon-2026', soviet: true, spacingM: 4 },
  'sp-caragana-arborescens': { benefits: ['Живая изгородь', 'Обогащает почву азотом'], beauty: ['Жёлтое цветение'], uses: ['hedge', 'roadside', 'greenbelt'], soviet: true, spacingM: 0.5 },
  'sp-syringa-vulgaris': { benefits: ['Медонос'], beauty: ['Душистое весеннее цветение'], uses: ['yard', 'square', 'hedge'], soviet: true, spacingM: 1.5 },
  'sp-rosa-majalis': { benefits: ['Витаминные плоды', 'Корм птицам'], beauty: ['Розовое цветение'], uses: ['hedge', 'greenbelt'], spacingM: 0.8 },
  'sp-cotoneaster-lucidus': { benefits: ['Стриженая изгородь', 'Пылезадержание'], beauty: ['Красная осень'], uses: ['hedge', 'roadside'], soviet: true, spacingM: 0.4 },
  'sp-spiraea-media': { benefits: ['Медонос'], beauty: ['Белые «облака» цветков'], uses: ['hedge', 'yard'], spacingM: 0.7 },
  'sp-hippophae-rhamnoides': { benefits: ['Укрепляет склоны', 'Растёт на засолённых почвах'], beauty: ['Оранжевые ягоды'], uses: ['greenbelt', 'roadside'], spacingM: 1.5 },
  'sp-dasiphora-fruticosa': { benefits: ['Низкий бордюр'], beauty: ['Жёлтые цветки всё лето'], uses: ['flowerbed', 'yard'], spacingM: 0.5 },
  'sp-acer-tataricum': { benefits: ['Тень во дворе', 'Ветрозащита'], beauty: ['Красные крылатки', 'Багряная осень'], uses: ['yard', 'greenbelt', 'hedge'], pavlodar: 'ev-pvl-zakon-2026', soviet: true, spacingM: 4 },
  'sp-salix-alba': { benefits: ['Тень', 'Укрепляет берега'], beauty: ['Серебристая листва'], uses: ['alley', 'square'], pavlodar: 'ev-pvl-24kz-2025', soviet: true, spacingM: 8 },
  'sp-populus-bolleana': { benefits: ['Пылезадержание', 'Мало места у основания'], beauty: ['Колонновидная крона'], uses: ['alley', 'roadside'], soviet: true, spacingM: 4 },
  'sp-larix-sibirica': { benefits: ['Фитонциды', 'Долговечна'], beauty: ['Золотая осень', 'Нежная хвоя весной'], uses: ['square', 'greenbelt'], spacingM: 6 },
  'sp-quercus-robur': { benefits: ['Долговечен', 'Тень'], beauty: ['Мощная крона'], uses: ['square'], spacingM: 10 },
  'sp-malus-niedzwetzkyana': { benefits: ['Медонос', 'Местный вид Казахстана'], beauty: ['Розовое цветение', 'Пурпурная листва'], uses: ['square', 'yard'], spacingM: 5 },
  'sp-prunus-padus': { benefits: ['Медонос', 'Корм птицам'], beauty: ['Душистое белое цветение'], uses: ['yard', 'square'], soviet: true, spacingM: 5 },
  'sp-juniperus-sabina': { benefits: ['Фитонциды', 'Закрепляет склоны'], beauty: ['Вечнозелёный'], uses: ['flowerbed', 'square', 'greenbelt'], pavlodar: 'ev-pvl-zakon-2026', spacingM: 1 },
  'sp-ribes-aureum': { benefits: ['Живая изгородь', 'Медонос'], beauty: ['Жёлтое цветение', 'Багряная осень'], uses: ['hedge', 'roadside'], soviet: true, spacingM: 0.7 },
  'sp-lonicera-tatarica': { benefits: ['Живая изгородь', 'Медонос'], beauty: ['Розовое цветение', 'Красные ягоды'], uses: ['hedge', 'yard'], soviet: true, spacingM: 1 },
  'sp-philadelphus-coronarius': { benefits: ['Медонос'], beauty: ['Белое душистое цветение'], uses: ['yard', 'square'], soviet: true, spacingM: 1.5 },
  'sp-cornus-alba': { benefits: ['Укрепляет влажные склоны'], beauty: ['Красные побеги зимой'], uses: ['square', 'hedge'], spacingM: 1 },
  'sp-viburnum-opulus': { benefits: ['Корм птицам'], beauty: ['Белые шапки цветков', 'Красные ягоды'], uses: ['yard', 'square'], soviet: true, spacingM: 1.5 },
  'sp-physocarpus-opulifolius': { benefits: ['Неприхотлив'], beauty: ['Цветная листва весь сезон'], uses: ['hedge', 'square'], spacingM: 0.8 },
  'sp-berberis-vulgaris': { benefits: ['Защитная изгородь'], beauty: ['Красные ягоды', 'Пурпурная листва (сорта)'], uses: ['hedge'], spacingM: 0.5 },
  'sp-tamarix-ramosissima': { benefits: ['Растёт на засолённых почвах', 'Закрепляет пески'], beauty: ['Розовые метёлки'], uses: ['roadside', 'greenbelt'], spacingM: 1.5 },
  'sp-rosa-rugosa': { benefits: ['Переносит соль у дорог', 'Витаминные плоды'], beauty: ['Цветёт всё лето'], uses: ['roadside', 'hedge'], spacingM: 0.8 },
  'sp-crataegus-sanguinea': { benefits: ['Плотная изгородь', 'Корм птицам'], beauty: ['Белое цветение', 'Красные плоды'], uses: ['hedge', 'greenbelt'], soviet: true, spacingM: 0.7 },
};
const FLOWER_P: Profile = { benefits: ['Опылители', 'Сезонный акцент'], beauty: ['Цветение'], uses: ['flowerbed'] };
const SOVIET_FLOWERS = new Set(['sp-tagetes', 'sp-salvia-splendens', 'sp-paeonia-lactiflora', 'sp-petunia', 'sp-phlox-paniculata', 'sp-ageratum', 'sp-iris-sibirica', 'sp-hemerocallis']);
const MORE_EXTRA: Record<string, Partial<Species>> = {
  'sp-acer-tataricum': { crownDiameterM: 5, careLevel: 'low', floweringMonths: [5] },
  'sp-salix-alba': { crownDiameterM: 10, careLevel: 'medium' },
  'sp-populus-bolleana': { crownDiameterM: 3, careLevel: 'low' },
  'sp-larix-sibirica': { crownDiameterM: 6, careLevel: 'low' },
  'sp-quercus-robur': { crownDiameterM: 12, careLevel: 'low' },
  'sp-malus-niedzwetzkyana': { crownDiameterM: 5, careLevel: 'medium', floweringMonths: [5] },
  'sp-prunus-padus': { crownDiameterM: 5, careLevel: 'low', floweringMonths: [5] },
  'sp-juniperus-sabina': { crownDiameterM: 2, careLevel: 'low' },
  'sp-ribes-aureum': { crownDiameterM: 1.5, careLevel: 'low', floweringMonths: [5] },
  'sp-lonicera-tatarica': { crownDiameterM: 2, careLevel: 'low', floweringMonths: [5, 6] },
  'sp-philadelphus-coronarius': { crownDiameterM: 2, careLevel: 'medium', floweringMonths: [6] },
  'sp-cornus-alba': { crownDiameterM: 2, careLevel: 'medium', floweringMonths: [6] },
  'sp-viburnum-opulus': { crownDiameterM: 2.5, careLevel: 'medium', floweringMonths: [6] },
  'sp-physocarpus-opulifolius': { crownDiameterM: 1.5, careLevel: 'low', floweringMonths: [6] },
  'sp-berberis-vulgaris': { crownDiameterM: 1.5, careLevel: 'low', floweringMonths: [5] },
  'sp-tamarix-ramosissima': { crownDiameterM: 2.5, careLevel: 'low', floweringMonths: [6, 7, 8] },
  'sp-rosa-rugosa': { crownDiameterM: 1.5, careLevel: 'low', floweringMonths: [6, 7, 8] },
  'sp-crataegus-sanguinea': { crownDiameterM: 3, careLevel: 'low', floweringMonths: [5, 6] },
};

function withProfile(sp: Species): Species {
  const pr = sp.form === 'flower' ? { ...FLOWER_P, soviet: SOVIET_FLOWERS.has(sp.id) } : P[sp.id] ?? { benefits: [], beauty: [], uses: [] };
  const ev = [...sp.evidenceIds, ...(pr.pavlodar ? [pr.pavlodar] : []), ...(pr.soviet ? ['ev-team-soviet'] : [])];
  const photo = (photos as Record<string, Species['photo']>)[sp.id] ?? null;
  return { ...sp, photo, benefits: pr.benefits, beauty: pr.beauty, uses: pr.uses, pavlodarEvidenceId: pr.pavlodar ?? null, soviet: !!pr.soviet, spacingM: pr.spacingM ?? null, evidenceIds: ev };
}

export const species: Species[] = [
  ...base_.map((sp) => ({ unit: 'pcs' as const, floweringMonths: null, pricePerUnitKzt: null, ...sp, ...extra[sp.id] })),
  ...more.map((sp) => ({ unit: 'pcs' as const, floweringMonths: null, pricePerUnitKzt: null, ...sp, ...MORE_EXTRA[sp.id] })),
  ...flowers,
  ...moreFlowers,
].map(withProfile);
