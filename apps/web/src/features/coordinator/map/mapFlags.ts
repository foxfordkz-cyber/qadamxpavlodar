// Флаг для режима проверки: подменяет адрес стиля на заведомо недоступный,
// чтобы проверить резервную схему без отключения интернета. Живёт до закрытия вкладки.
const KEY = 'gp-map-broken';
export const mapBroken = {
  get value(): boolean {
    try {
      return sessionStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  },
  set value(v: boolean) {
    try {
      if (v) sessionStorage.setItem(KEY, '1');
      else sessionStorage.removeItem(KEY);
    } catch {
      /* без хранилища флаг не сохраняется */
    }
  },
};
