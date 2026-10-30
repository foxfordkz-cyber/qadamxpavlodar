import { ApiError } from './transport';
import type { Me } from './types';

export type SessionUser = Me & { csrfToken?: string };
interface SessionState {
  data: SessionUser | null;
  error: Error | null;
  loading: boolean;
  unauthenticated: boolean;
}

/** Auth has a shorter lifetime than cached application data: a 401 discards the user. */
export function createSessionResource(load: () => Promise<SessionUser>) {
  let state: SessionState = { data: null, error: null, loading: true, unauthenticated: false };
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: SessionState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  const cancel = () => { generation++; };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    cancel,
    clear() {
      // Also invalidate requests already in flight when logout succeeded.
      cancel();
      publish({ data: null, error: null, loading: false, unauthenticated: true });
    },
    async reload() {
      const request = ++generation;
      publish({ ...state, loading: true });
      try {
        const data = await load();
        if (request === generation) publish({ data, error: null, loading: false, unauthenticated: false });
      } catch (caught) {
        if (request !== generation) return;
        const error = caught instanceof Error ? caught : new Error(String(caught));
        if (error instanceof ApiError && error.status === 401) {
          publish({ data: null, error, loading: false, unauthenticated: true });
        } else {
          // An outage cannot restore an expired session or discard a valid one.
          publish({ ...state, error, loading: false });
        }
      }
    },
  };
}
