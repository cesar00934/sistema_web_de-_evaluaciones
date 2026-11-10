import type { WrittenText } from "./review-reading";
export interface WrittenCrop {
  questionId: string;
  label: string;
  lines: Blob[];
}
export async function recognizeHandwriting(
  crops: WrittenCrop[],
  progress: (text: string) => void,
) {
  if (!crops.length) return [];
  if (crops.every((c) => !c.lines.length))
    return crops.map((c) => ({
      questionId: c.questionId,
      label: c.label,
      text: "",
      engine: "TrOCR local",
      warning:
        "No se detectó texto legible en el área de respuesta; revisa la imagen.",
    }));
  return new Promise<WrittenText[]>((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/handwriting.worker.ts", import.meta.url),
      { type: "module" },
    );
    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        Error(
          "El lector local tardó demasiado. La respuesta queda pendiente para revisión.",
        ),
      );
    }, 300000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (e) => {
      if (e.data.progress) {
        progress(e.data.progress);
        return;
      }
      finish();
      if (e.data.ok) resolve(e.data.answers);
      else reject(Error(e.data.error));
    };
    worker.onerror = (e) => {
      finish();
      reject(Error(e.message || "No se pudo iniciar el lector local."));
    };
    worker.postMessage({ crops });
  });
}
