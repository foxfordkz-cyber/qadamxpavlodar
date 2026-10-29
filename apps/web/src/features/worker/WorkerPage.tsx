import { useCallback, useEffect, useRef, useState } from 'react';
import { useData } from '../../shared/api/DataProvider';
import type { Me } from '../../shared/api/types';
import { StateView } from '../../shared/ui/components';
import { createContractGateway, createV2Transport, type User } from './contract-v2.mjs';
import { WorkerCabinet } from './WorkerCabinet';

type CrewRole = 'worker' | 'foreman';
type Setup = { user: User & { role: CrewRole }; gateway: unknown; shiftDate: string; demo: boolean };

const ORGANIZATION = 'green-pavlodar';
const todayUtc5 = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);

// В mock кабинет работает на учебном источнике демо (учётные записи Ерлан Б. и Алия С.),
// в api — на маршрутах V2 общего сервера от имени текущего пользователя.
async function loadSetup(mode: 'mock' | 'api', me: Me, role: CrewRole): Promise<Setup> {
  if (mode === 'mock') {
    const { demoCabinet } = await import('./demo-gateway.mjs');
    const { user, gateway, shiftDate } = demoCabinet(role);
    return { user: { ...user, role }, gateway, shiftDate, demo: true };
  }
  const user = { id: me.id, displayName: me.displayName, role, active: true, version: 1 };
  return { user, gateway: createContractGateway({ request: createV2Transport({ base: '/api/v1' }), user }), shiftDate: todayUtc5(), demo: false };
}

/** Кабинет бригадира и работника (маршрут #/worker). */
export function WorkerPage({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { mode } = useData();
  const role: CrewRole = me.role === 'foreman' ? 'foreman' : 'worker';
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  // Shell создаёт onLogout заново при каждой отрисовке (часы в шапке — раз в минуту). WorkerCabinet
  // перенастраивает кабинет при смене колбэка, и открытая форма сбрасывалась бы, поэтому передаём стабильный.
  const logoutRef = useRef(onLogout);
  useEffect(() => { logoutRef.current = onLogout; });
  const logout = useCallback(() => logoutRef.current(), []);
  useEffect(() => {
    let alive = true;
    setSetup(null);
    setError(null);
    loadSetup(mode, me, role).then((s) => { if (alive) setSetup(s); }, (e) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [mode, me.id, role, attempt]);
  return (
    <StateView loading={!setup && !error} error={error} hasData={!!setup} onRetry={() => setAttempt((n) => n + 1)}>
      {setup && <WorkerCabinet user={setup.user} gateway={setup.gateway} organizationId={ORGANIZATION} shiftDate={setup.shiftDate} demo={setup.demo} onLogout={logout} />}
    </StateView>
  );
}
