import { createContext, useContext } from 'react';
import type { Me } from '../../shared/api/types';

/** Текущий пользователь из GET /auth/me. Нужен экранам, где действия зависят от роли. */
export const MeContext = createContext<Me | null>(null);

export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe вне Shell');
  return me;
}
