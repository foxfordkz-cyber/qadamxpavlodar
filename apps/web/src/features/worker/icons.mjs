const paths = {
  leaf: '<path d="M19 3C9 2 3 6 5 13c1 4 6 5 9 2 3-3 4-7 5-12Z"/><path d="M4 21c2-7 5-10 10-14"/>',
  list: '<rect x="4" y="4" width="16" height="16" rx="0"/><path d="M8 9h1m3 0h4M8 15h1m3 0h4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
  user: '<circle cx="12" cy="8" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  photo: '<rect x="3" y="5" width="18" height="15" rx="0"/><circle cx="8" cy="10" r="1"/><path d="m3 17 5-4 4 3 4-6 5 7"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3Z"/><circle cx="12" cy="13" r="3"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.5"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 0-10 6 6 0 0 1 12 2 4 4 0 0 1 0 8"/><path d="M12 21V12m-3 3 3-3 3 3"/>',
};
export const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${paths[name] || paths.list}</svg>`;
