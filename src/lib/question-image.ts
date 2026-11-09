"use client";
import { browserClient } from "./supabase/client";

export const imageAccept =
  "image/jpeg,image/png,image/webp,image/gif,image/bmp,.jpg,.jpeg,.png,.webp,.gif,.bmp";

// Inspect the bytes because pasted/downloaded images may have an empty MIME type.
export async function prepareQuestionImage(file: File): Promise<Blob> {
  if (!file.size) throw Error("La imagen está vacía. Selecciona otro archivo.");
  if (file.size > 8 * 1024 * 1024) throw Error("La imagen supera 8 MB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  let mime = "";
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)
    mime = "image/png";
  else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    mime = "image/jpeg";
  else if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    mime = "image/webp";
  else if (String.fromCharCode(...bytes.slice(0, 3)) === "GIF")
    mime = "image/gif";
  else if (bytes[0] === 66 && bytes[1] === 77) mime = "image/bmp";
  if (!mime) throw Error("Selecciona una imagen JPG, PNG, WebP, GIF o BMP.");
  const blob = new Blob([file], { type: mime }),
    url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw Error(
        "No se pudo abrir la imagen. Prueba guardarla como PNG o JPG.",
      );
    }
    if (img.naturalWidth * img.naturalHeight > 32_000_000)
      throw Error("La imagen supera 32 megapíxeles.");
    if (mime === "image/gif" || mime === "image/bmp") {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw Error("No se pudo preparar la imagen.");
      ctx.drawImage(img, 0, 0);
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(Error("No se pudo convertir la imagen a PNG.")),
          "image/png",
        ),
      );
    }
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadQuestionImage(blob: Blob, ownerId: string) {
  const ext =
    blob.type === "image/jpeg"
      ? "jpg"
      : blob.type === "image/webp"
        ? "webp"
        : "png";
  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await browserClient()
    .storage.from("questions")
    .upload(path, blob, { contentType: blob.type, upsert: false });
  if (error)
    throw Error(
      `No se guardó la imagen: ${error.message}. Comprueba la conexión y los permisos del bucket questions en Supabase.`,
    );
  return path;
}
