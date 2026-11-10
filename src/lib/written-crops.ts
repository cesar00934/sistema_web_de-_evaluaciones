import { geometry as G, type SheetPage } from "./domain";
import type { Raster } from "./omr";
export interface LineCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Removes the printed answer rules and segments ink into individual text lines. */
export function writtenLines(source: Raster, top: number) {
  const x0 = Math.round((65 / G.width) * source.width),
    x1 = Math.round((530 / G.width) * source.width);
  const y0 = Math.round(((top + 39) / G.height) * source.height),
    y1 = Math.min(
      source.height,
      Math.round(((top + 120) / G.height) * source.height),
    );
  const width = x1 - x0,
    height = y1 - y0,
    data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const from = ((y + y0) * source.width + x + x0) * 4,
        to = (y * width + x) * 4;
      const lum =
        0.299 * source.data[from] +
        0.587 * source.data[from + 1] +
        0.114 * source.data[from + 2];
      data[to] = data[to + 1] = data[to + 2] = lum;
      data[to + 3] = 255;
    }
  const counts = Array.from({ length: height }, (_, y) => {
    let n = 0;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] < 175) n++;
    return n;
  });
  for (let y = 0; y < height; y++)
    if (counts[y] > width * 0.55)
      for (
        let yy = Math.max(0, y - 1);
        yy <= Math.min(height - 1, y + 1);
        yy++
      ) {
        data.fill(255, yy * width * 4, (yy + 1) * width * 4);
      }
  const ink = Array.from({ length: height }, (_, y) => {
    let n = 0;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4] < 175) n++;
    return n > Math.max(1, width * 0.002);
  });
  const lines: LineCrop[] = [];
  let start = -1,
    last = -1;
  const finish = () => {
    if (start < 0) return;
    let left = width,
      right = 0;
    for (let y = start; y <= last; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4] < 175) {
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
    if (right - left >= 3 && last - start >= 2)
      lines.push({
        x: Math.max(0, left - 6),
        y: Math.max(0, start - 4),
        width: Math.min(width, right + 7) - Math.max(0, left - 6),
        height: Math.min(height, last + 5) - Math.max(0, start - 4),
      });
    start = -1;
    last = -1;
  };
  ink.forEach((v, y) => {
    if (v) {
      if (start < 0) start = y;
      last = y;
    } else if (start >= 0 && y - last > 5) finish();
  });
  finish();
  return { raster: { width, height, data }, lines };
}
export async function cropWrittenAnswers(raster: Raster, page: SheetPage) {
  const out: { questionId: string; label: string; lines: Blob[] }[] = [];
  for (const item of page.written) {
    const { raster: cleaned, lines } = writtenLines(raster, item.top!);
    const canvas = new OffscreenCanvas(cleaned.width, cleaned.height);
    canvas
      .getContext("2d")!
      .putImageData(
        new ImageData(cleaned.data, cleaned.width, cleaned.height),
        0,
        0,
      );
    const blobs: Blob[] = [];
    for (const line of lines) {
      const crop = new OffscreenCanvas(line.width + 24, line.height + 24);
      const c = crop.getContext("2d")!;
      c.fillStyle = "white";
      c.fillRect(0, 0, crop.width, crop.height);
      c.drawImage(
        canvas,
        line.x,
        line.y,
        line.width,
        line.height,
        12,
        12,
        line.width,
        line.height,
      );
      blobs.push(await crop.convertToBlob({ type: "image/png" }));
    }
    out.push({ questionId: item.questionId, label: item.label, lines: blobs });
  }
  return out;
}
