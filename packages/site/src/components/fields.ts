const sdBox = (x: number, y: number, cx: number, cy: number, hw: number, hh: number) => {
  const qx = Math.abs(x - cx) - hw;
  const qy = Math.abs(y - cy) - hh;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
};

export const horizon = (x: number, y: number, w: number, h: number) => {
  const u = (x - w / 2) / (w * 0.6);
  const rim = h * (0.34 + 0.6 * u * u);
  const d = y - rim;
  const centre = Math.max(0, 1 - Math.abs(u) * 0.45);
  const v =
    d < 0
      ? Math.exp(d / (h * 0.07))
      : 0.42 * (1 - d / (h * 0.7)) + 0.58 * Math.exp(-d / (h * 0.06));
  const grain = 0.05 * Math.sin(x * 0.013) * Math.cos(y * 0.021);
  return (
    Math.max(0, Math.min(1, v * centre + grain)) * Math.min(1, Math.max(0, (h - y) / (h * 0.3)))
  );
};

export const mark = (x: number, y: number, w: number, h: number) => {
  const s = Math.min(h * 0.86, w * 0.46);
  const cx = w - s * 0.58 - Math.min(40, w * 0.04);
  const cy = h / 2 + s * 0.08;
  const r = s * 0.3;
  const th = s * 0.19;
  const angle = Math.atan2(y - cy, x - cx);
  const inGap = angle > -1.4 && angle < -0.26;
  const ring = inGap ? 1e9 : Math.abs(Math.hypot(x - cx, y - cy) - r) - th / 2;
  const square = sdBox(x, y, cx + s * 0.36, cy - s * 0.36, s * 0.105, s * 0.105);
  const d = Math.min(ring, square);
  if (d > 0) return 0.42 * Math.exp(-d / 9);
  return 0.62 + 0.38 * (0.5 + 0.5 * Math.sin((x + y) * 0.025));
};

export const rise = (x: number, y: number, w: number, h: number) => {
  const d = Math.hypot((x - w * 0.28) / (w * 0.8), (y - h * 1.08) / (h * 0.82));
  return Math.max(0, Math.min(1, (1 - d) * 1.5 + 0.05 * Math.sin(x * 0.05)));
};

export const nightBlue = [
  '#0f1218',
  '#1a2fb8',
  '#296ff0',
  '#38bdf8',
  '#a5d8ff',
  '#f6f8ff',
] as const;
export const markBlue = ['#0f1218', '#1f34a8', '#3657e6', '#6f8fff', '#c3d0ff'] as const;
export const paleBlue = ['#296ff0', '#7aa5f7', '#cfe0ff', '#ffffff'] as const;
