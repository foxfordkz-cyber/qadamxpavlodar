// Справочник расценок и коэффициентов (ТЗ 3.4.2, 3.8.2, 5.3). Каждое значение — с источником
// и классом данных. Администратор меняет значения через PATCH /rates; расчёты берут текущие.
export interface RateEntry {
  key: string;
  group: 'cost' | 'effect' | 'care' | 'survival';
  label: string;
  unit: string;
  value: number | null;
  source: string;
  sourceUrl?: string;
  dataClass: 'real' | 'demo' | 'estimate';
}

export const DEFAULT_RATES: RateEntry[] = [
  // --- Смета: демо-расценки команды, заменить сметными нормами акимата ---
  { key: 'price.tree', group: 'cost', label: 'Саженец дерева (если цены вида нет)', unit: '₸/шт', value: 18000, source: 'Демо-расценка команды. Заменить ценами питомника или сметными нормами.', dataClass: 'demo' },
  { key: 'price.tree.large', group: 'cost', label: 'Крупномер дерева (вариант «максимальный эффект»)', unit: '₸/шт', value: 65000, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'price.shrub', group: 'cost', label: 'Саженец кустарника (если цены вида нет)', unit: '₸/шт', value: 3000, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'price.flower', group: 'cost', label: 'Рассада цветов (если цены вида нет)', unit: '₸/шт', value: 350, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'soil.prep', group: 'cost', label: 'Подготовка территории и почвы (грунт, удобрения)', unit: '₸/м²', value: 1200, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'soil.salinity', group: 'cost', label: 'Надбавка за улучшение засолённой почвы (гипс, промывка, дренаж)', unit: '₸/м²', value: 900, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'work.tree', group: 'cost', label: 'Посадка дерева', unit: '₸/шт', value: 7000, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'work.shrub', group: 'cost', label: 'Посадка кустарника', unit: '₸/шт', value: 1500, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'work.flower', group: 'cost', label: 'Посадка цветов', unit: '₸/шт', value: 120, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'delivery.share', group: 'cost', label: 'Доставка', unit: '% от материала', value: 8, source: 'Допущение команды.', dataClass: 'estimate' },
  { key: 'care.tree', group: 'cost', label: 'Полив и уход за деревом', unit: '₸/шт в год', value: 5500, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'care.shrub', group: 'cost', label: 'Полив и уход за кустарником', unit: '₸/шт в год', value: 1500, source: 'Демо-расценка команды.', dataClass: 'demo' },
  { key: 'care.flower', group: 'cost', label: 'Полив и уход за цветником', unit: '₸/шт в год', value: 150, source: 'Демо-расценка команды.', dataClass: 'demo' },
  // --- Экологический эффект ---
  { key: 'eff.co2.tree', group: 'effect', label: 'Поглощение CO₂ взрослым деревом', unit: 'кг/год', value: 25, source: 'Типичный диапазон 10–40 кг/год, середина ≈25 (Evertreen; One Tree Planted отмечает слабую обоснованность цифры 22 кг). Для уличных деревьев Кореи 7,6–99 кг в зависимости от вида.', sourceUrl: 'https://www.evertreen.com/news/how-much-co2-does-a-tree-absorb', dataClass: 'estimate' },
  { key: 'eff.co2.shrub', group: 'effect', label: 'Поглощение CO₂ взрослым кустарником', unit: 'кг/год', value: 3, source: 'Допущение команды (~10% от дерева), источник не найден.', dataClass: 'estimate' },
  { key: 'eff.o2.ratio', group: 'effect', label: 'Кислород на 1 кг поглощённого CO₂', unit: 'кг O₂/кг CO₂', value: 0.727, source: 'Стехиометрия фотосинтеза: 32/44 по массе (6CO₂ → 6O₂).', dataClass: 'estimate' },
  { key: 'eff.rain.tree', group: 'effect', label: 'Задержание дождя кроной взрослого дерева', unit: 'л/год', value: 2228, source: 'Уличные деревья Манхэттена, i-Tree: перехват кроной в среднем ≈2228 л/год (Forests, 2023).', sourceUrl: 'https://doaj.org/article/6e46780eb1a640218ded62f98825e193', dataClass: 'estimate' },
  { key: 'eff.rain.shrub', group: 'effect', label: 'Задержание дождя кустарником', unit: 'л/год', value: 250, source: 'Допущение команды (~10% от дерева).', dataClass: 'estimate' },
  { key: 'eff.cool.max', group: 'effect', label: 'Охлаждение воздуха при полном озеленении зоны', unit: '°C', value: 0.9, source: 'Систематический обзор: парки и скверы прохладнее окружения в среднем на 0,8–1 °C.', sourceUrl: 'https://research.bangor.ac.uk/en/publications/how-effective-is-greening-of-urban-areas-in-reducing-human-exposu/', dataClass: 'estimate' },
  { key: 'eff.cool.canopy', group: 'effect', label: 'Доля кроны, при которой охлаждение максимально', unit: 'доля', value: 0.4, source: 'Допущение команды.', dataClass: 'estimate' },
  { key: 'eff.dust.tree', group: 'effect', label: 'Улавливание пыли взрослым деревом', unit: 'кг/год', value: null, source: 'Проверенный коэффициент не найден. Укажите значение из справочника организатора — до этого эффект по пыли не рассчитывается.', dataClass: 'estimate' },
  { key: 'eff.population', group: 'effect', label: 'Жителей в радиусе 400 м от зоны', unit: 'чел.', value: null, source: 'Нет данных о населении по участкам (ТЗ 5.1). Зелень на жителя не рассчитывается.', dataClass: 'estimate' },
  // --- Уход ---
  { key: 'care.water.tree', group: 'care', label: 'Объём полива молодого дерева', unit: 'л за раз', value: 50, source: 'Ориентир команды для саженцев; уточнить у дендролога.', dataClass: 'estimate' },
  { key: 'care.water.shrub', group: 'care', label: 'Объём полива кустарника', unit: 'л за раз', value: 15, source: 'Ориентир команды.', dataClass: 'estimate' },
  { key: 'care.water.flower', group: 'care', label: 'Объём полива цветника', unit: 'л/м² за раз', value: 6, source: 'Ориентир команды.', dataClass: 'estimate' },
  { key: 'care.visits', group: 'care', label: 'Допустимое число выездов бригады', unit: 'в месяц', value: 10, source: 'Настройка специалиста.', dataClass: 'estimate' },
  // --- Приживаемость ---
  { key: 'surv.base', group: 'survival', label: 'Базовая приживаемость за 1-й год при нормальном уходе', unit: '%', value: 88, source: 'Экспертное допущение команды. Модель не калибрована на данных Павлодара.', dataClass: 'estimate' },
];

export type Rates = Record<string, number | null>;
export const ratesMap = (list: RateEntry[]): Rates => Object.fromEntries(list.map((r) => [r.key, r.value]));
