/** Cancelled generations cannot publish data, errors or loading state into a newer selection. */
export function outcomeRequest<T>(load: () => Promise<T>, publish: (state: { data: T | null; error: unknown; loading: boolean }) => void) {
  let active = true;
  publish({ data: null, error: null, loading: true });
  Promise.resolve().then(load).then(
    data => { if (active) publish({ data, error: null, loading: false }); },
    error => { if (active) publish({ data: null, error, loading: false }); },
  );
  return () => { active = false; };
}
