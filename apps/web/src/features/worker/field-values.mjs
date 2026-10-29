// Only authenticated upload paths, explicit HTTPS images and locally-created previews.
export function safePhotoURL(value) {
  if (typeof value !== 'string') return '';
  if (/^data:image\/(png|jpeg|webp);base64,/.test(value) || /^blob:/.test(value) || /^https:\/\//.test(value)) return value;
  return /^\/api\/v1\/uploads\/[^/?#\\\s]+(?:\?[^#\\\s]*)?$/.test(value) ? value : '';
}

export function approvedDesign(task) {
  const design = task?.design;
  return design && design.status === 'approved' && design.id === task.approvedDesignId && design.revision === task.approvedDesignVersion ? design : null;
}

export function geometryPoints(geometry) {
  return geometry?.type === 'Point' ? [geometry.coordinates] : geometry?.type === 'MultiPoint' ? geometry.coordinates : [];
}

export function positionsText(geometry) {
  return geometryPoints(geometry).map(([lng, lat]) => `${lat}, ${lng}`).join('\n');
}

export function parsePositions(text, quantity) {
  const points = String(text ?? '').trim().split('\n').filter(line => line.trim()).map(line => {
    const tokens = line.trim().split(/[,;\s]+/);
    const values = tokens.map(Number);
    if (tokens.some(token => !token) || values.length !== 2 || values.some(value => !Number.isFinite(value)) || Math.abs(values[0]) > 90 || Math.abs(values[1]) > 180) {
      throw new Error('Укажите точки в формате «широта, долгота», по одной на строку.');
    }
    return [values[1], values[0]];
  });
  if (points.length !== quantity) throw new Error('Для каждого посаженного растения нужна одна фактическая точка.');
  if (new Set(points.map(point => JSON.stringify(point))).size !== points.length) throw new Error('Фактические точки посадки не должны повторяться.');
  return points.length === 1 ? { type: 'Point', coordinates: points[0] } : { type: 'MultiPoint', coordinates: points };
}
