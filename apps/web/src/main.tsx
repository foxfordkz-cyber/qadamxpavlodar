// Общая тема подключается первой, чтобы стили модулей могли её уточнять.
import './shared/ui/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DataProvider } from './shared/api/DataProvider';
import { CoordinatorApp } from './features/coordinator/CoordinatorApp';

// Кабинет работника (участник 4) подключается здесь же отдельным маршрутом/ролью,
// используя DataProvider и shared/ui.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <CoordinatorApp />
    </DataProvider>
  </StrictMode>,
);
