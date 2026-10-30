// Общая тема подключается первой, чтобы стили модулей могли её уточнять.
import '@fontsource-variable/onest/index.css';
import '@fontsource-variable/lora/index.css';
import './shared/ui/theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DataProvider } from './shared/api/DataProvider';
import { CoordinatorApp } from './features/coordinator/CoordinatorApp';

// Кабинет бригадира и работника открывается внутри Shell на маршруте #/worker
// для этих ролей (features/worker/WorkerPage.tsx).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <CoordinatorApp />
    </DataProvider>
  </StrictMode>,
);
