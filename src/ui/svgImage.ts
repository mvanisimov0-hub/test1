// Превращение SVG-чертежей в растровые картинки для документов Word.

/** «Бумажные» значения переменных оформления: чертёж в документе всегда светлый */
const PAPER: Record<string, string> = {
  '--ink': '#141b22',
  '--ink-2': '#4b5866',
  '--ink-3': '#7a8693',
  '--blue': '#1f5f99',
  '--blue-soft': '#e3eef8',
  '--accent': '#a83f29',
  '--accent-soft': '#f7e6e0',
  '--bad': '#b3362d',
  '--ok': '#2c7a4b',
  '--warn': '#a96a0e',
  '--surface': '#ffffff',
  '--surface-2': '#f3f5f7',
  '--line': '#cfd6dd',
  '--line-2': '#e6eaee',
  '--font': 'Arial, sans-serif',
  '--mono': "'Courier New', monospace",
};

function resolveVars(markup: string): string {
  // var(--имя) и var(--имя, запасное значение); вложенные var в запасном значении не встречаются
  return markup
    .replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_m, name: string, fallback?: string) => PAPER[name] ?? fallback?.trim() ?? '#141b22')
    .replace(/font-family\s*[:=]\s*(["']?)inherit\1/g, (m) => m.replace('inherit', 'Arial, sans-serif'));
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось загрузить изображение'));
    img.src = src;
  });
}

/** Размеры картинки по её data URL; null — картинка не читается */
export async function imageSize(dataUrl: string): Promise<{ width: number; height: number } | null> {
  try {
    const img = await loadImage(dataUrl);
    return img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null;
  } catch {
    return null;
  }
}

/** Растеризовать SVG-чертёж со страницы в PNG (data URL). Цвета из CSS-переменных подставляются «бумажными» значениями. */
export async function svgToPng(svg: SVGSVGElement, widthPx = 1600): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const vb = svg.viewBox?.baseVal;
    let vw = vb && vb.width > 0 ? vb.width : 0;
    let vh = vb && vb.height > 0 ? vb.height : 0;
    if (!vw || !vh) {
      const r = svg.getBoundingClientRect();
      vw = r.width;
      vh = r.height;
      if (!vw || !vh) return null;
      clone.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    }
    const width = Math.round(widthPx);
    const height = Math.max(1, Math.round((widthPx * vh) / vw));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.removeAttribute('class');
    // шрифт по умолчанию для подписей без собственного font-family
    const style = clone.getAttribute('style');
    clone.setAttribute('style', `${style ? `${style};` : ''}font-family: Arial, sans-serif`);

    const markup = resolveVars(new XMLSerializer().serializeToString(clone));
    const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  } catch {
    return null;
  }
}

/** Двоичное содержимое data URL (base64 или с процентным кодированием) */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return new Uint8Array();
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}
