import type { User } from './contract-v2.mjs';
export declare function demoCabinet(role: 'worker' | 'foreman'): { user: User; gateway: Record<string, (...args: any[]) => Promise<any>>; shiftDate: string };
