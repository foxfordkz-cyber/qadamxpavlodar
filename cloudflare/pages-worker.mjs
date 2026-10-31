import { createApiProxy } from './api-proxy.mjs';

// These values are public deployment metadata, never credentials.
export const UPSTREAM_ORIGIN = 'https://green-pavlodar-api-demo.onrender.com';
export const BACKEND_SHA = '3b14927def04b35bf97782eae6b550da276c779f';
export const CONTRACT_SHA = 'a72131df86272804f95d8331d0f627e62272b3ea';
export const API_ROUTES = { version: 1, include: ['/api', '/api/*'], exclude: [] };
// Set these in Pages Settings > Runtime before deployment. A ZIP cannot set them.
export const RUNTIME_COMPATIBILITY = { date: '2026-07-30', flags: ['enable_request_signal'] };

export function createPagesWorker(publicOrigin, fetcher = fetch) {
  const proxy = createApiProxy({ upstreamOrigin: UPSTREAM_ORIGIN, publicOrigin }, fetcher);
  return {
    async fetch(request, env) {
      const response = await proxy(request);
      if (response !== null) return response;
      return env.ASSETS.fetch(request);
    },
  };
}
