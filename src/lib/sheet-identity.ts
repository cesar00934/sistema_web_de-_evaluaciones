import jsQR from "jsqr";
import { parseIdentity } from "./domain";
export type SheetIdentity = NonNullable<ReturnType<typeof parseIdentity>>;
export function readSheetIdentity(raster: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}) {
  const qr = jsQR(raster.data, raster.width, raster.height, {
    inversionAttempts: "attemptBoth",
  });
  return qr ? parseIdentity(qr.data) : null;
}
/** Reads identity only: never recognizes answers, uploads files or saves grades. */
export function identifySheet(image: HTMLImageElement) {
  const rotate = image.naturalWidth > image.naturalHeight;
  const sw = rotate ? image.naturalHeight : image.naturalWidth;
  const sh = rotate ? image.naturalWidth : image.naturalHeight;
  const scale = Math.min(1, 2200 / sh);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const c = canvas.getContext("2d", { willReadFrequently: true });
  if (!c) throw Error("No se pudo leer el QR de la imagen.");
  if (rotate) {
    c.translate(canvas.width, 0);
    c.rotate(Math.PI / 2);
    c.drawImage(image, 0, 0, canvas.height, canvas.width);
  } else c.drawImage(image, 0, 0, canvas.width, canvas.height);
  return readSheetIdentity(c.getImageData(0, 0, canvas.width, canvas.height));
}
