import { createRequire } from 'node:module';
import type { Species } from '../../../apps/web/src/shared/api/types';

// Playwright's CommonJS loader supports the app's JSON imports on Node 22/24.
// A native ESM import would require changing the application's Vite-only import syntax.
export const { species } = createRequire(import.meta.url)('../../../apps/web/src/shared/api/mock/species.ts') as { species: Species[] };
