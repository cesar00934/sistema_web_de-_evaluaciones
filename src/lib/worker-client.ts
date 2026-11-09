import { type Version, type Answer, sheetLayout } from "./domain";
export interface Recognition {
  ok: boolean;
  error?: string;
  hash: string;
  answers: Answer[];
  page: number;
  warning: string;
  stored: Blob;
  thumbnail: Blob;
}
export function recognize(file: File, version: Version, pageNumber: number) {
  return new Promise<Recognition>((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/scan.worker.ts", import.meta.url),
    );
    const timer = setTimeout(() => {
      worker.terminate();
      reject(Error("Reconocimiento excedió 90 segundos"));
    }, 90000);
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      worker.terminate();
      reject(Error(e.message));
    };
    worker.postMessage({
      file,
      pages: sheetLayout(version.questions),
      examId: version.exam_id,
      versionId: version.id,
      pageNumber,
    });
  });
}
