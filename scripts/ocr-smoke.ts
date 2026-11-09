import { createWorker } from "tesseract.js";
import sharp from "sharp";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
async function main() {
  await mkdir("artifacts/ocr", { recursive: true });
  const png = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="300"><rect width="100%" height="100%" fill="white"/><text x="40" y="100" font-family="Arial" font-size="65" fill="black">EXAMEN CRAMER</text><text x="40" y="220" font-family="Arial" font-size="65" fill="black">12345678</text></svg>',
    ),
  )
    .png()
    .toBuffer();
  let status = "";
  const worker = await createWorker("spa", 1, {
    cachePath: "artifacts/ocr",
    logger: (m) => {
      if (m.status !== status) {
        status = m.status;
        console.log(status);
      }
    },
  });
  try {
    const result = await worker.recognize(png);
    assert.match(result.data.text, /EXAMEN\s+CRAMER/);
    assert.match(result.data.text, /12345678/);
    await writeFile(
      "artifacts/ocr/smoke.json",
      JSON.stringify(
        {
          language: "spa",
          text: result.data.text,
          scope:
            "Synthetic printed text. Not a handwriting accuracy evaluation.",
        },
        null,
        2,
      ),
    );
    console.log(
      "OCR Spanish model and Tesseract 7 API verified with synthetic printed text.",
    );
  } finally {
    await worker.terminate();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
