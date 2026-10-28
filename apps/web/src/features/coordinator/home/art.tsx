import type { ReactElement } from 'react';
// Собственные векторные иллюстрации в палитре интерфейса: без внешних фото,
// чтобы не выдавать чужой вид за участок Павлодара.

function pine(x: number, base: number, h: number, key: string, fill: string) {
  const w = h * 0.34;
  const tiers = 4;
  const parts = [];
  for (let i = 0; i < tiers; i++) {
    const top = base - h + (i * h) / (tiers + 1);
    const bottom = top + h / 2.4;
    const half = (w / 2) * (0.45 + (i + 1) / tiers / 1.6);
    parts.push(`M${x} ${top} L${x - half} ${bottom} L${x + half} ${bottom} Z`);
  }
  return <path key={key} d={parts.join(' ') + ` M${x - h * 0.02} ${base - h * 0.2} h${h * 0.04} V${base} h-${h * 0.04} Z`} fill={fill} />;
}

export function ForestSilhouette() {
  const rows = [
    { y: 300, n: 22, h: 150, fill: '#cfd8b0', seed: 1 },
    { y: 330, n: 18, h: 210, fill: '#b7c391', seed: 2 },
    { y: 360, n: 14, h: 290, fill: '#9cab72', seed: 3 },
  ];
  return (
    <svg className="gp-hero__art" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="gp-fog" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f1f4e4" />
          <stop offset="1" stopColor="#dfe6c8" />
        </linearGradient>
      </defs>
      <rect width="1200" height="360" fill="url(#gp-fog)" />
      {rows.map((r) =>
        Array.from({ length: r.n }, (_, i) => {
          const jitter = ((i * 73 + r.seed * 31) % 37) - 18;
          const x = (i + 0.5) * (1200 / r.n) + jitter;
          const h = r.h * (0.8 + (((i * 17 + r.seed * 7) % 10) / 25));
          return pine(x, r.y, h, `${r.seed}-${i}`, r.fill);
        }),
      )}
    </svg>
  );
}

export function StageArt({ kind }: { kind: 'site' | 'check' | 'design' | 'approve' | 'plant' | 'care' }) {
  const stroke = '#2f3a1c';
  const icons: Record<typeof kind, ReactElement> = {
    site: <><path d="M40 120 L70 60 L130 70 L150 125 L95 145 Z" fill="none" stroke={stroke} strokeWidth="3" strokeDasharray="8 5" /><circle cx="95" cy="100" r="6" fill={stroke} /></>,
    check: <><rect x="55" y="50" width="80" height="100" fill="none" stroke={stroke} strokeWidth="3" /><path d="M70 80 l10 10 l20 -22 M70 115 h45 M70 130 h30" fill="none" stroke={stroke} strokeWidth="3" /></>,
    design: <><path d="M40 140 L150 140" stroke={stroke} strokeWidth="2" />{[60, 95, 130].map((x) => <circle key={x} cx={x} cy="105" r="18" fill="none" stroke={stroke} strokeWidth="3" />)}<rect x="55" y="55" width="80" height="22" fill="none" stroke={stroke} strokeWidth="3" strokeDasharray="4 4" /></>,
    approve: <><circle cx="95" cy="98" r="45" fill="none" stroke={stroke} strokeWidth="3" /><path d="M75 98 l14 14 l28 -30" fill="none" stroke={stroke} strokeWidth="4" /></>,
    plant: <><path d="M95 150 V95" stroke={stroke} strokeWidth="4" /><path d="M95 110 C70 105 62 85 64 70 C82 72 95 85 95 110 Z M95 100 C120 95 128 75 126 60 C108 62 95 75 95 100 Z" fill={stroke} /><path d="M50 150 h90" stroke={stroke} strokeWidth="3" /></>,
    care: <><path d="M60 80 h50 l15 15 v10 h-65 Z" fill="none" stroke={stroke} strokeWidth="3" /><path d="M125 95 C140 100 145 115 140 125" fill="none" stroke={stroke} strokeWidth="3" />{[75, 90, 105].map((x) => <path key={x} d={`M${x} 115 v18`} stroke={stroke} strokeWidth="3" strokeDasharray="3 4" />)}</>,
  };
  return (
    <svg className="gp-stage__art" viewBox="0 0 190 190" aria-hidden="true">
      <circle cx="95" cy="95" r="92" fill="#dbe7a6" />
      {icons[kind]}
    </svg>
  );
}
