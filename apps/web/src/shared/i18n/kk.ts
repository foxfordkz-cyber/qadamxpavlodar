import type { Dict } from './ru';

// ЧЕРНОВИК казахского словаря: не проверен носителем языка, по умолчанию выключен
// (VITE_ENABLE_KK). Отсутствующие ключи показываются по-русски.
export const kk: Partial<Dict> = {
  'nav.map': 'Учаскелер картасы',
  'nav.ranking': 'Рейтинг',
  'nav.species': 'Өсімдіктер',
  'nav.tasks': 'Тапсырмалар',
  'nav.reports': 'Есептер',
  'shell.role.coordinator': 'Үйлестіруші',
  'shell.role.worker': 'Қызметкер',
  'state.loading': 'Жүктелуде…',
  'state.retry': 'Қайталау',
};
