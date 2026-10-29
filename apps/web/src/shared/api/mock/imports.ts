// Проверка качества импортируемого слоя (ТЗ 3.1.5): пропуски, неверная СК, перепутанные оси, пересечения.
// Общая для тестового источника и сервера apps/server, чтобы правила не расходились.
export interface ImportFeature { geometry?: { type?: string; coordinates?: unknown } | null; properties?: Record<string, unknown> }
export interface ImportIssue { row: number; level: 'error' | 'warning'; text: string }

export function previewImport(format: string | undefined, feats: ImportFeature[] = [], note: string) {
  const issues: ImportIssue[] = [];
  const flat = (c: unknown): number[][] => (Array.isArray(c) && typeof c[0] === 'number' ? [c as number[]] : Array.isArray(c) ? (c as unknown[]).flatMap(flat) : []);
  const boxes: { i: number; b: number[] }[] = [];
  feats.forEach((f, i) => {
    if (!f.geometry || !f.geometry.coordinates) { issues.push({ row: i + 1, level: 'error', text: 'Нет геометрии.' }); return; }
    const pts = flat(f.geometry.coordinates);
    if (!pts.length) { issues.push({ row: i + 1, level: 'error', text: 'Пустые координаты.' }); return; }
    const bad = pts.find(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y));
    if (bad) issues.push({ row: i + 1, level: 'error', text: 'Нечисловые координаты.' });
    else if (pts.some(([x, y]) => Math.abs(x) > 180 || Math.abs(y) > 90)) issues.push({ row: i + 1, level: 'error', text: 'Координаты вне диапазона градусов — похоже на метровую систему (например, UTM). Нужен WGS 84 (EPSG:4326).' });
    else if (pts.some(([x, y]) => y > 70 && x < 60)) issues.push({ row: i + 1, level: 'warning', text: 'Похоже, перепутаны долгота и широта.' });
    else if (!pts.every(([x, y]) => x > 75 && x < 79 && y > 51 && y < 53.5)) issues.push({ row: i + 1, level: 'warning', text: 'Объект вне Павлодара.' });
    const missingProps = ['name'].filter((k) => !f.properties?.[k]);
    if (missingProps.length) issues.push({ row: i + 1, level: 'warning', text: `Не заполнено: ${missingProps.join(', ')}.` });
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    boxes.push({ i, b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  });
  for (let a = 0; a < boxes.length; a++)
    for (let c = a + 1; c < boxes.length; c++) {
      const [p, q] = [boxes[a].b, boxes[c].b];
      if (p[0] < q[2] && q[0] < p[2] && p[1] < q[3] && q[1] < p[3] && feats[boxes[a].i].geometry?.type === 'Polygon' && feats[boxes[c].i].geometry?.type === 'Polygon')
        issues.push({ row: boxes[a].i + 1, level: 'warning', text: `Возможно пересечение с объектом ${boxes[c].i + 1} (по габаритам).` });
    }
  const errors = new Set(issues.filter((x) => x.level === 'error').map((x) => x.row));
  return { format: format ?? 'geojson', total: feats.length, valid: feats.length - errors.size, invalid: errors.size, issues: issues.slice(0, 200), committed: false, note };
}
