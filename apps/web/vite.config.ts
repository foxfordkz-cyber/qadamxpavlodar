import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Сервер участника 3 по умолчанию ожидается на :3000. Переопределяется VITE_API_PROXY.
const apiTarget = process.env.VITE_API_PROXY ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [react()],
  // Воркер MapLibre 6 — ES-модуль.
  worker: { format: 'es' },
  server: {
    port: 5173,
    // Общие данные лежат в корневом fixtures/ — разрешаем чтение на уровень репозитория.
    fs: { allow: ['../..'] },
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
});
