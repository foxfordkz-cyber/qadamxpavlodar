export const sigmoid = (z: number): number => z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
export function probability(x: number[], coefficients: number[]): number {
  if (x.length !== coefficients.length) throw new Error('Survival model feature count mismatch');
  return sigmoid(x.reduce((z, v, i) => z + v * coefficients[i], 0));
}

export interface TrainingRow { x: number[]; y: 0 | 1 }

/** Full-batch Adam, fixed iterations and L2; no validation-set fitting or tuning. */
export function fitLogistic(rows: TrainingRow[], iterations = 600, learningRate = 0.035, l2 = 0.0002): number[] {
  const d = rows[0].x.length;
  const w = Array<number>(d).fill(0), m = [...w], v = [...w];
  for (let step = 1; step <= iterations; step++) {
    const gradient = Array<number>(d).fill(0);
    for (const row of rows) {
      const error = probability(row.x, w) - row.y;
      for (let j = 0; j < d; j++) gradient[j] += error * row.x[j];
    }
    for (let j = 0; j < d; j++) {
      const g = gradient[j] / rows.length + (j === 0 ? 0 : l2 * w[j]);
      m[j] = 0.9 * m[j] + 0.1 * g;
      v[j] = 0.999 * v[j] + 0.001 * g * g;
      w[j] -= learningRate * (m[j] / (1 - 0.9 ** step)) / (Math.sqrt(v[j] / (1 - 0.999 ** step)) + 1e-8);
    }
  }
  return w;
}

/** Mann–Whitney AUC with average ranks for ties. null for a single-class sample. */
export function rocAuc(y: number[], p: number[]): number | null {
  const sorted = p.map((score, i) => ({ score, y: y[i] })).sort((a, b) => a.score - b.score);
  const positives = y.filter(v => v === 1).length, negatives = y.length - positives;
  if (!positives || !negatives) return null;
  let ranks = 0;
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end].score === sorted[i].score) end++;
    for (let j = i; j < end; j++) if (sorted[j].y === 1) ranks += (i + 1 + end) / 2;
    i = end;
  }
  return (ranks - positives * (positives + 1) / 2) / (positives * negatives);
}

export function evaluate(rows: TrainingRow[], coefficients: number[]) {
  const p = rows.map(r => probability(r.x, coefficients)), y = rows.map(r => r.y);
  const brier = p.reduce((sum, v, i) => sum + (v - y[i]) ** 2, 0) / rows.length;
  const calibration = Array.from({ length: 10 }, (_, bin) => {
    const indices = p.flatMap((v, i) => Math.min(9, Math.floor(v * 10)) === bin ? [i] : []);
    return { lower: bin / 10, upper: (bin + 1) / 10, n: indices.length,
      predicted: indices.length ? indices.reduce((s, i) => s + p[i], 0) / indices.length : null,
      observed: indices.length ? indices.reduce((s, i) => s + y[i], 0) / indices.length : null };
  });
  return { rocAuc: rocAuc(y, p), brier, calibration, residualRmse: Math.sqrt(brier) };
}
