// Демо-данные для сервера ТЗ: аккаунты всех ролей и бригады (seedV2), 114 зон OSM, виды, расценки (seedTz).
// Повторный запуск ничего не перезаписывает. Запуск: npm run seed:tz (в Docker — при каждом старте).
import { Store } from '../db.js';
import { loadConfig } from '../config.js';
import { seedV2 } from '../v2/seed.js';
import { seedTz } from './seed.js';
import { seedMunicipal,syncMunicipalZones } from '../municipal/data.js';

const store = new Store(loadConfig().dbPath);
try {
  const accounts = await seedV2(store);
  const tz = seedTz(store);
  await seedMunicipal(store);
  store.transaction(()=>syncMunicipalZones(store));
  console.log(JSON.stringify({ accounts: accounts.accounts.map(a => `${a.login} (${a.role})`), crews: accounts.crews, ...tz }, null, 2));
  if (accounts.generatedPassword) console.log('DEMO_PASSWORD не задан: создан случайный пароль демо-аккаунтов; значение не выводится. Для API-входа задайте приватный пароль до первого seed новой демонстрационной базы.');
} finally { store.close(); }
