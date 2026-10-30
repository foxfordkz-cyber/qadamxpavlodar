import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSessionResource, type SessionUser } from '../src/shared/api/sessionResource';
import { ApiError } from '../src/shared/api/transport';

const admin: SessionUser = { id: 'test-admin', displayName: 'Test admin', role: 'admin', csrfToken: 'test-token' };
const viewer: SessionUser = { id: 'test-viewer', displayName: 'Test viewer', role: 'viewer' };
const expired = () => new ApiError(401, 'unauthenticated', 'Test session expired');
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('401 discards identity and token; a later outage cannot restore them', async () => {
  let result: SessionUser | Error = admin;
  const session = createSessionResource(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  await session.reload();
  assert.equal(session.getSnapshot().data?.role, 'admin');
  result = expired();
  await session.reload();
  assert.equal(session.getSnapshot().data, null);
  assert.equal(session.getSnapshot().unauthenticated, true);
  result = new ApiError(0, 'network_error', 'Test offline');
  await session.reload();
  assert.equal(session.getSnapshot().data, null);
  assert.equal(session.getSnapshot().unauthenticated, true, 'keep the login screen during an outage');
  result = viewer;
  await session.reload();
  assert.deepEqual(session.getSnapshot(), { data: viewer, error: null, loading: false, unauthenticated: false });
});

for (const status of [0, 503]) test(`temporary error ${status} preserves a valid session`, async () => {
  let fail = false;
  const error = new ApiError(status, 'network_error', 'Test outage');
  const session = createSessionResource(async () => { if (fail) throw error; return admin; });
  await session.reload();
  fail = true;
  await session.reload();
  assert.equal(session.getSnapshot().data, admin);
  assert.equal(session.getSnapshot().unauthenticated, false);
  assert.equal(session.getSnapshot().error, error);
});

for (const outcome of ['resolve', 'reject'] as const) test(`logout ignores a late ${outcome} from the old session`, async () => {
  let delayed = false;
  const pending = deferred<SessionUser>();
  const session = createSessionResource(() => delayed ? pending.promise : Promise.resolve(admin));
  await session.reload();
  delayed = true;
  const oldRequest = session.reload();
  session.clear();
  const loggedOut = session.getSnapshot();
  assert.deepEqual(loggedOut, { data: null, error: null, loading: false, unauthenticated: true });
  if (outcome === 'resolve') pending.resolve(admin);
  else pending.reject(new ApiError(503, 'unavailable', 'Test outage'));
  await oldRequest;
  assert.equal(session.getSnapshot(), loggedOut, 'logout is complete without another /me request');
});

test('late admin response cannot replace a viewer who logged in after logout', async () => {
  const pending = deferred<SessionUser>();
  let loads = 0;
  const session = createSessionResource(() => ++loads === 1 ? pending.promise : Promise.resolve(viewer));
  const oldRequest = session.reload();
  session.clear();
  await session.reload();
  pending.resolve(admin);
  await oldRequest;
  assert.equal(session.getSnapshot().data, viewer);
  assert.equal(session.getSnapshot().unauthenticated, false);
});

test('an older 401 cannot log out the newly loaded user', async () => {
  const pending = deferred<SessionUser>();
  let loads = 0;
  const session = createSessionResource(() => ++loads === 1 ? pending.promise : Promise.resolve(viewer));
  const oldRequest = session.reload();
  await session.reload();
  pending.reject(expired());
  await oldRequest;
  assert.equal(session.getSnapshot().data, viewer);
  assert.equal(session.getSnapshot().error, null);
});

test('effect cleanup discards its request and allows the next effect to load', async () => {
  const pending = deferred<SessionUser>();
  let loads = 0;
  const session = createSessionResource(() => ++loads === 1 ? pending.promise : Promise.resolve(viewer));
  const oldRequest = session.reload();
  session.cancel();
  await session.reload();
  pending.resolve(admin);
  await oldRequest;
  assert.equal(session.getSnapshot().data, viewer);
});

test('initial network failure does not claim the user has logged out', async () => {
  const session = createSessionResource(async () => { throw new ApiError(0, 'network_error', 'Test offline'); });
  await session.reload();
  assert.equal(session.getSnapshot().data, null);
  assert.equal(session.getSnapshot().unauthenticated, false);
  assert.equal(session.getSnapshot().loading, false);
});

test('forbidden response is distinct from an expired session', async () => {
  const session = createSessionResource(async () => { throw new ApiError(403, 'forbidden', 'Test forbidden'); });
  await session.reload();
  assert.equal((session.getSnapshot().error as ApiError).status, 403);
  assert.equal(session.getSnapshot().unauthenticated, false);
});
