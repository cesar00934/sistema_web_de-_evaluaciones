import { cropWrittenAnswers } from "../lib/written-crops";
import { readSheetIdentity } from "../lib/sheet-identity";
import { type SheetPage } from "../lib/domain";
import { processOmr } from "../lib/omr";
const ctx = self as unknown as {
  onmessage: (e: MessageEvent) => void;
  postMessage: (v: unknown) => void;
};
ctx.onmessage = async (e) => {
  try {
    const { file, pages, examId, versionId, pageNumber, readWritten } =
      e.data as {
        file: File;
        pages: SheetPage[];
        examId: string;
        versionId: string;
        pageNumber: number;
        readWritten: boolean;
      };
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    if (bitmap.width * bitmap.height > 32_000_000) {
      bitmap.close();
      throw Error(
        "Imagen mayor de 32 megapíxeles. Reduce dimensiones antes de cargar.",
      );
    }
    const rotate = bitmap.width > bitmap.height,
      sw = rotate ? bitmap.height : bitmap.width,
      sh = rotate ? bitmap.width : bitmap.height,
      factor = Math.min(1, 2200 / sh),
      canvas = new OffscreenCanvas(
        Math.round(sw * factor),
        Math.round(sh * factor),
      ),
      c = canvas.getContext("2d", { willReadFrequently: true })!;
    if (rotate) {
      c.translate(canvas.width, 0);
      c.rotate(Math.PI / 2);
      c.drawImage(bitmap, 0, 0, canvas.height, canvas.width);
    } else c.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const raster = c.getImageData(0, 0, canvas.width, canvas.height),
      identity = readSheetIdentity(raster);
    if (
      identity &&
      (identity.examId !== examId || identity.versionId !== versionId)
    )
      throw Error("El QR corresponde a otro examen o versión.");
    const page = pages[(identity?.pageNumber ?? pageNumber) - 1];
    if (!page) throw Error("Página fuera de la hoja.");
    let warning = "",
      answers;
    let written: Awaited<ReturnType<typeof cropWrittenAnswers>> = [];
    let writtenWarning: string | undefined;
    try {
      const result = processOmr(raster, page);
      answers = result.answers;
      if (readWritten && page.written.length) {
        try {
          written = await cropWrittenAnswers(result.normalized, page);
        } catch {
          writtenWarning =
            "No se pudo preparar el área de escritura. Revisa la imagen.";
        }
      }
      canvas.width = result.normalized.width;
      canvas.height = result.normalized.height;
      c.putImageData(
        new ImageData(
          new Uint8ClampedArray(result.normalized.data),
          canvas.width,
          canvas.height,
        ),
        0,
        0,
      );
    } catch (error) {
      warning = error instanceof Error ? error.message : "No se pudo reconocer";
      answers = [...page.items, ...page.written].map((i) => ({
        questionId: i.questionId,
        selected: null,
        status: i.type === "openResponse" ? "manualReview" : "ambiguous",
        confidence: 0,
      }));
    }
    // Only now generate the storage copy. The source was never re-encoded for recognition.
    const stored = await canvas.convertToBlob({
      type: "image/jpeg",
      quality: 0.86,
    });
    const small = new OffscreenCanvas(
      240,
      Math.round((canvas.height / canvas.width) * 240),
    );
    small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
    const thumbnail = await small.convertToBlob({
      type: "image/jpeg",
      quality: 0.72,
    });
    ctx.postMessage({
      ok: true,
      hash,
      answers,
      page: page.pageNumber,
      warning,
      stored,
      thumbnail,
      written,
      writtenWarning,
      identity,
    });
  } catch (error) {
    ctx.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : "Imagen no válida",
    });
  }
};
