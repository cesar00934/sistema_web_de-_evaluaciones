import { pipeline, env, RawImage } from "@huggingface/transformers";
const revision = "9ef961fec33b56615026fbe77b9da68d6237cddb";
// All inference is local. Only public model/runtime files may be downloaded.
env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = true;
// The pipeline probes for auxiliary files without forwarding its revision option.
env.remotePathTemplate = `{model}/resolve/${revision}/`;
env.backends.onnx.wasm!.numThreads = 1;
const context = self as unknown as {
  onmessage: (e: MessageEvent) => void;
  postMessage: (v: unknown) => void;
};
context.onmessage = async (e) => {
  try {
    const model = await pipeline(
      "image-to-text",
      "Xenova/trocr-small-handwritten",
      {
        device: "wasm",
        dtype: "q8",
        revision,
        progress_callback: (p) => {
          if (p.status === "progress")
            context.postMessage({
              progress: `Descargando lector local: ${Math.round(p.progress)} %`,
            });
        },
      },
    );
    try {
      const answers = [];
      for (const item of e.data.crops as {
        questionId: string;
        label: string;
        lines: Blob[];
      }[]) {
        const text = [];
        for (const [i, line] of item.lines.entries()) {
          context.postMessage({
            progress: `Leyendo pregunta ${item.label}, línea ${i + 1} de ${item.lines.length}…`,
          });
          const image = await RawImage.fromBlob(line);
          const result = await model(image, {
            max_new_tokens: 96,
            num_beams: 1,
          });
          text.push(result[0]?.generated_text ?? "");
        }
        answers.push({
          questionId: item.questionId,
          label: item.label,
          text: text.join("\n"),
          engine: "TrOCR local",
          warning: text.some((line) => line.trim())
            ? undefined
            : "No se detectó texto legible en el área de respuesta; revisa la imagen.",
        });
      }
      context.postMessage({ ok: true, answers });
    } finally {
      await model.dispose();
    }
  } catch (error) {
    context.postMessage({
      ok: false,
      error:
        error instanceof Error ? error.message : "No se pudo leer la escritura",
    });
  }
};
