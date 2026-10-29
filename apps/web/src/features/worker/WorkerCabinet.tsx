/** Optional React bridge. Check against the team's React/TS versions during integration. */
import { createElement, useEffect, useRef } from 'react';
import './worker.mjs';
type User = { id: string; displayName: string; role: 'worker' | 'foreman'; active: boolean; version: number };
export type WorkerCabinetProps = { user: User; gateway: unknown; organizationId: string; shiftDate: string; demo?: boolean; onLogout: () => void };
type WorkerElement = HTMLElement & { configure: (options: Record<string, unknown>) => Promise<void> };
export function WorkerCabinet({ user, gateway, organizationId, shiftDate, demo = false, onLogout }: WorkerCabinetProps) {
  const element = useRef<WorkerElement | null>(null);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    void node.configure({ user, gateway, scope: `${demo ? 'demo' : 'production'}:${organizationId}`, date: shiftDate, demo, embedded:true });
    const listener = () => onLogout();
    node.addEventListener('worker-logout', listener);
    return () => { node.removeEventListener('worker-logout', listener); void node.configure({ user: null, gateway: null, scope: '', date: shiftDate }); };
  }, [user, gateway, organizationId, shiftDate, demo, onLogout]);
  return createElement('green-worker', { ref: element });
}
