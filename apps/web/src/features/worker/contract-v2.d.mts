/** Local adapter declarations mirrored from the supplied V2 proposal. Shared types remain participant 1's responsibility. */
export type TaskStatus = 'draft' | 'assigned' | 'in_progress' | 'submitted' | 'verified';
export type ApplicationRole = 'admin' | 'coordinator' | 'foreman' | 'worker';
export type ObservationCategory = 'access_problem' | 'visible_damage' | 'care_completed' | 'needs_inspection' | 'other';
export type User = { id: string; displayName: string; role: ApplicationRole; active: boolean; version: number };
export type Envelope<T> = { data: T; meta?: Record<string, unknown> };
export type Transport = (method: string, path: string, options?: {body?:unknown; headers?:Record<string,string>; signal?:AbortSignal}) => Promise<Envelope<unknown>>;
export declare const TASK_STATUSES: TaskStatus[];
export declare const OBSERVATION_CATEGORIES: Record<ObservationCategory,string>;
export declare const ROLE_LABELS: Record<ApplicationRole,string>;
export declare function shiftDate(iso: string): string;
export declare function clockTime(iso: string): string;
export declare function createV2Transport(options?: {base?:string;headersFor?:()=>Record<string,string>}): Transport;
export declare function createContractGateway(options: {request:Transport;user:User}): Record<string, (...args:any[])=>Promise<any>>;
