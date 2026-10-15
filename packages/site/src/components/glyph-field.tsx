import { useEffect, useRef } from 'react';

type Field = (x: number, y: number, width: number, height: number) => number;

type Options = {
  field: Field;
  colors: readonly string[];
  size?: number;
  word?: string;
  wordAt?: number;
  alpha?: number;
  glow?: number;
  className?: string;
};

const ramp = ' .:-=+xX0S8#@';
const resolveMs = 1100;

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const hash = (a: number, b: number) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

export function GlyphField({
  field,
  colors,
  size = 13,
  word = '',
  wordAt = 0.62,
  alpha = 1,
  glow = 0,
  className,
}: Options) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    if (!octx) return;

    const stops = colors.map(rgb);
    const color = (v: number) => {
      const x = Math.min(0.999, Math.max(0, v)) * (stops.length - 1);
      const i = Math.floor(x);
      const f = x - i;
      const a = stops[i] ?? [0, 0, 0];
      const b = stops[i + 1] ?? a;
      return a.map((c, k) => Math.round(c + ((b[k] ?? c) - c) * f));
    };

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let cw = 8;
    let ch = 12;
    let cols = 0;
    let rows = 0;
    let progress = reduce ? 1 : 0;
    let start = 0;
    let raf = 0;

    const draw = () => {
      if (!cols) return;
      octx.clearRect(0, 0, width, height);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = (i + 0.5) * cw;
          const y = (j + 0.5) * ch;
          const v = field(x, y, width, height);
          if (v < 0.04) continue;
          const k = hash(i, j);
          const tone = Math.min(
            1,
            Math.max(
              0,
              Math.pow(v, 0.75) + (hash(i * 1.7, j * 2.9) - 0.5) * 0.14 + (k - 0.5) * 0.08,
            ),
          );
          if (k > 0.9 * (0.35 + tone * 1.05)) continue;
          const settle = (1 - tone) * 0.6 + hash(i * 0.71, j * 1.3) * 0.4;
          if (progress < settle * 0.85) continue;
          let glyph: string;
          if (progress < settle)
            glyph = ramp[1 + Math.floor(hash(i + progress * 40, j) * (ramp.length - 1))] ?? '.';
          else if (word && tone > wordAt) glyph = word[(i + j * 3) % word.length] ?? '.';
          else glyph = ramp[Math.round(tone * (ramp.length - 1))] ?? ' ';
          if (glyph === ' ') continue;
          octx.fillStyle = `rgba(${color(tone).join(',')},${String(alpha * (0.4 + 0.6 * tone))})`;
          octx.fillText(glyph, x, y);
        }
      }
      ctx.clearRect(0, 0, width, height);
      if (glow) {
        ctx.save();
        ctx.filter = `blur(${String(glow)}px)`;
        ctx.globalAlpha = 0.65;
        ctx.drawImage(off, 0, 0, width, height);
        ctx.restore();
      }
      ctx.drawImage(off, 0, 0, width, height);
    };

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      if (!width || !height) return;
      for (const c of [canvas, off]) {
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      octx.font = `400 ${String(size)}px "Geist Mono Variable", ui-monospace, monospace`;
      octx.textBaseline = 'middle';
      octx.textAlign = 'center';
      cw = octx.measureText('M').width * 1.04;
      ch = size * 1.32;
      cols = Math.ceil(width / cw);
      rows = Math.ceil(height / ch);
      draw();
    };

    let last = 0;
    const tick = (now: number) => {
      if (now - last >= 40) {
        last = now;
        progress = Math.min(1, 1 - Math.pow(1 - Math.min(1, (now - start) / resolveMs), 3));
        draw();
      }
      raf = progress < 1 ? requestAnimationFrame(tick) : 0;
    };

    const resize = new ResizeObserver(measure);
    resize.observe(canvas);
    void document.fonts.ready.then(measure);

    let seen: IntersectionObserver | undefined;
    if (!reduce) {
      seen = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            seen?.disconnect();
            start = performance.now();
            raf = requestAnimationFrame(tick);
          }
        },
        { threshold: 0.15 },
      );
      seen.observe(canvas);
    }

    return () => {
      resize.disconnect();
      seen?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [field, colors, size, word, wordAt, alpha, glow]);

  return <canvas ref={ref} aria-hidden="true" className={className ?? 'glyphs'} />;
}
