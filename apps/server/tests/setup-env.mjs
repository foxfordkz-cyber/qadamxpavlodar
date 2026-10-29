// Тестам нужен пароль демо-аккаунтов; в git его нет — генерируем на запуск.
import { randomBytes } from 'node:crypto';
process.env.DEMO_PASSWORD ??= `test-${randomBytes(12).toString('hex')}`;
