// Учебный источник локального демо (tools/worker-demo) для режима mock общего приложения.
// Загружается лениво и только в mock; в режиме api кабинет работает через createV2Transport.
import { createDemoSource, accounts, DEMO_DATE } from '../../../../../tools/worker-demo/demo/source.mjs';

const DEMO_ACCOUNT = { foreman: 'demo-foreman-1', worker: 'demo-worker-1' };
let source = null;

export function demoCabinet(role) {
  source ??= createDemoSource({ storage: localStorage });
  const user = accounts.find(account => account.id === DEMO_ACCOUNT[role]);
  return { user, gateway: source.apiFor(user.id), shiftDate: DEMO_DATE };
}
