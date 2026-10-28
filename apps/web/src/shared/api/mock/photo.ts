// Демонстрационное «фото»: подписанная заглушка, чтобы её нельзя было принять за реальный снимок.
export function demoPhoto(label: string, id: string): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe3f0"/><stop offset=".55" stop-color="#e8efe2"/><stop offset=".56" stop-color="#9cbf7a"/><stop offset="1" stop-color="#6f9a52"/></linearGradient></defs>
<rect width="640" height="420" fill="url(#g)"/>
<rect x="20" y="20" width="250" height="44" rx="6" fill="#1f2a1f" opacity=".82"/>
<text x="36" y="49" font-family="system-ui,sans-serif" font-size="20" fill="#fff" font-weight="700">ДЕМО-ФОТО · ${esc(id)}</text>
<text x="320" y="220" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" fill="#1f2a1f">${esc(label)}</text>
<text x="320" y="252" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" fill="#2d3b2d">Заглушка тестового источника, не снимок участка</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
