import { classify, geometry as G, type Answer, type SheetPage } from "./domain";
export type Point = { x: number; y: number };
export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
function gray(image: Raster) {
  const a = new Uint8Array(image.width * image.height);
  for (let i = 0; i < a.length; i++)
    a[i] = Math.round(
      0.299 * image.data[i * 4] +
        0.587 * image.data[i * 4 + 1] +
        0.114 * image.data[i * 4 + 2],
    );
  return a;
}
export function homography(from: Point[], to: Point[]) {
  const m: number[][] = [];
  from.forEach((p, i) => {
    const q = to[i];
    m.push(
      [p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y, q.x],
      [0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y, q.y],
    );
  });
  for (let i = 0; i < 8; i++) {
    let pivot = i;
    for (let j = i + 1; j < 8; j++)
      if (Math.abs(m[j][i]) > Math.abs(m[pivot][i])) pivot = j;
    [m[i], m[pivot]] = [m[pivot], m[i]];
    if (Math.abs(m[i][i]) < 1e-10) throw Error("Perspectiva inválida");
    const d = m[i][i];
    for (let k = i; k <= 8; k++) m[i][k] /= d;
    for (let j = 0; j < 8; j++)
      if (j !== i) {
        const f = m[j][i];
        for (let k = i; k <= 8; k++) m[j][k] -= f * m[i][k];
      }
  }
  const h = m.map((r) => r[8]);
  return (x: number, y: number) => {
    const d = h[6] * x + h[7] * y + 1;
    return {
      x: (h[0] * x + h[1] * y + h[2]) / d,
      y: (h[3] * x + h[4] * y + h[5]) / d,
    };
  };
}
function markers(image: Raster, g: Uint8Array): Point[] {
  const { width: w, height: h } = image,
    stride = w + 1,
    integral = new Float64Array(stride * (h + 1)),
    mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += g[y * w + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
  }
  const radius = Math.max(12, Math.round(w * 0.025));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - radius),
        r = Math.min(w, x + radius + 1),
        t = Math.max(0, y - radius),
        b = Math.min(h, y + radius + 1),
        mean =
          (integral[b * stride + r] -
            integral[t * stride + r] -
            integral[b * stride + l] +
            integral[t * stride + l]) /
          ((r - l) * (b - t));
      mask[y * w + x] = +(g[y * w + x] < mean - Math.max(8, mean * 0.12));
    }
  const regions = [
      [0, 0, 0.28, 0.32, 0.1, 0.12],
      [0.72, 0, 1, 0.32, 0.9, 0.12],
      [0.72, 0.65, 1, 1, 0.9, 0.85],
      [0, 0.65, 0.28, 1, 0.1, 0.85],
    ],
    points: Point[] = [];
  for (let ri = 0; ri < 4; ri++) {
    const [l, t, r, b, ex, ey] = regions[ri],
      left = Math.floor(l * w),
      top = Math.floor(t * h),
      rw = Math.ceil(r * w) - left,
      rh = Math.ceil(b * h) - top,
      seen = new Uint8Array(rw * rh);
    let best: Point | undefined,
      bestScore = -Infinity;
    for (let yy = 0; yy < rh; yy++)
      for (let xx = 0; xx < rw; xx++) {
        const start = yy * rw + xx;
        if (seen[start] || !mask[(yy + top) * w + xx + left]) continue;
        const queue = [start];
        seen[start] = 1;
        let cursor = 0,
          area = 0,
          minX = xx,
          maxX = xx,
          minY = yy,
          maxY = yy,
          sx = 0,
          sy = 0;
        while (cursor < queue.length) {
          const v = queue[cursor++],
            x = v % rw,
            y = Math.floor(v / rw);
          area++;
          sx += x;
          sy += y;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            const nx = x + dx,
              ny = y + dy,
              n = ny * rw + nx;
            if (nx < 0 || ny < 0 || nx >= rw || ny >= rh || seen[n]) continue;
            seen[n] = 1;
            if (mask[(ny + top) * w + nx + left]) queue.push(n);
          }
        }
        const aspect = (maxX - minX + 1) / (maxY - minY + 1),
          fill = area / ((maxX - minX + 1) * (maxY - minY + 1));
        if (
          minX === 0 ||
          minY === 0 ||
          maxX === rw - 1 ||
          maxY === rh - 1 ||
          area < Math.max(12, w * h * 0.000015) ||
          area > w * h * 0.0012 ||
          aspect < 0.65 ||
          aspect > 1.5 ||
          fill < 0.72
        )
          continue;
        const cx = (left + sx / area) / w,
          cy = (top + sy / area) / h,
          alignment =
            ri === 1 ? points[0].y / h : ri === 3 ? points[2].y / h : undefined;
        const score =
          Math.log(area + 1) * 0.3 +
          fill * 4 -
          Math.hypot(cx - ex, cy - ey) * 24 -
          Math.abs(Math.log(aspect)) * 5 -
          (alignment === undefined ? 0 : Math.abs(cy - alignment) * 100);
        if (score > bestScore) {
          bestScore = score;
          best = { x: cx * w, y: cy * h };
        }
      }
    if (!best)
      throw Error("Faltan los cuatro marcadores. Se requiere revisión manual.");
    points.push(best);
  }
  for (let i = 0; i < 4; i++) {
    const a = points[i],
      b = points[(i + 1) % 4],
      c = points[(i + 2) % 4];
    if ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) <= 0)
      throw Error("Marcadores no válidos");
  }
  return points;
}
export function processOmr(
  image: Raster,
  page: SheetPage,
): { answers: Answer[]; normalized: Raster; printedRows: number } {
  const g = gray(image),
    points = markers(image, g),
    w = 1000,
    h = 1414;
  const map = homography(
    [
      { x: G.marker / G.width, y: G.marker / G.height },
      { x: 1 - G.marker / G.width, y: G.marker / G.height },
      { x: 1 - G.marker / G.width, y: 1 - G.marker / G.height },
      { x: G.marker / G.width, y: 1 - G.marker / G.height },
    ],
    points,
  );
  const data = new Uint8ClampedArray(w * h * 4),
    lum = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = map(x / (w - 1), y / (h - 1)),
        sx = Math.min(image.width - 1, Math.max(0, Math.round(p.x))),
        sy = Math.min(image.height - 1, Math.max(0, Math.round(p.y))),
        src = (sy * image.width + sx) * 4,
        dst = (y * w + x) * 4;
      data.set(image.data.subarray(src, src + 4), dst);
      lum[y * w + x] = g[sy * image.width + sx];
    }
  const at = (x: number, y: number) =>
    lum[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  function sample(row: number, option: number, dx = 0, dy = 0) {
    const cx = Math.round(((G.firstX + option * G.option) / G.width) * w) + dx,
      cy = Math.round(((G.firstY + row * G.row) / G.height) * h) + dy;
    const inner = Math.max(3, Math.round((4 / G.width) * w)),
      start = Math.max(inner + 3, Math.round((9 / G.width) * w)),
      outer = Math.max(start + 2, Math.round((13 / G.width) * w));
    let inside = 0,
      ni = 0,
      outside = 0,
      no = 0;
    for (let y = -outer; y <= outer; y++)
      for (let x = -outer; x <= outer; x++) {
        const d = x * x + y * y,
          v = at(cx + x, cy + y);
        if (d <= inner * inner) {
          inside += v;
          ni++;
        } else if (d >= start * start && d <= outer * outer) {
          outside += v;
          no++;
        }
      }
    const bg = outside / Math.max(1, no);
    return Math.max(
      0,
      Math.min(1, (bg - inside / Math.max(1, ni)) / Math.max(30, bg)),
    );
  }
  function printed(row: number, option: number) {
    const cx = Math.round(((G.firstX + option * G.option) / G.width) * w),
      cy = Math.round(((G.firstY + row * G.row) / G.height) * h),
      r = Math.round((9 / G.width) * w),
      outer = Math.round((14 / G.width) * w);
    let bg = 0,
      n = 0;
    for (let y = -outer; y <= outer; y++)
      for (let x = -outer; x <= outer; x++) {
        const d = x * x + y * y;
        if (d >= (r + 3) ** 2 && d <= outer * outer) {
          bg += at(cx + x, cy + y);
          n++;
        }
      }
    const mean = bg / Math.max(1, n),
      threshold = mean - Math.max(8, mean * 0.15);
    let ink = 0,
      count = 0;
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++)
        if (x * x + y * y <= r * r) {
          ink += +(at(cx + x, cy + y) < threshold);
          count++;
        }
    return ink / Math.max(1, count) >= 0.075;
  }
  const visible = Array.from(
      { length: 24 },
      (_, row) =>
        Array.from({ length: 8 }, (_, o) => printed(row, o)).filter(Boolean)
          .length >= 2,
    ),
    last = visible.lastIndexOf(true),
    printedRows = last + 1;
  if (
    page.items.length &&
    (visible.slice(0, last + 1).some((v) => !v) ||
      printedRows !== page.items.length)
  )
    throw Error(
      `Cuadrícula no confirmada: ${printedRows} filas, se esperaban ${page.items.length}. Revisa la página.`,
    );
  const tolerance = Math.round((3 / G.width) * w),
    answers = page.items.map((i, row) => {
      const d = Array.from({ length: i.optionCount }, (_, o) =>
        Math.max(
          ...[-tolerance, 0, tolerance].flatMap((dy) =>
            [-tolerance, 0, tolerance].map((dx) => sample(row, o, dx, dy)),
          ),
        ),
      );
      return { questionId: i.questionId, ...classify(d) };
    });
  answers.push(
    ...page.written.map((i) => ({
      questionId: i.questionId,
      selected: null,
      status: "manualReview" as const,
      confidence: 0,
    })),
  );
  return { answers, normalized: { width: w, height: h, data }, printedRows };
}
