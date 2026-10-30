import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useData } from './DataProvider';
import { createSessionResource, type SessionUser } from './sessionResource';

export function useSession() {
  const { api, revision } = useData();
  const session = useMemo(() => createSessionResource(async () => {
    const result = await api.me() as SessionUser | { user: SessionUser; csrfToken?: string };
    return 'user' in result ? { ...result.user, csrfToken: result.csrfToken } : result;
  }), [api]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    void session.reload();
    return session.cancel;
  }, [session, revision]);
  return { ...state, reload: session.reload, clear: session.clear };
}
