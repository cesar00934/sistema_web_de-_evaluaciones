import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { sheetLayout, type Version } from "../src/lib/domain";
async function main() {
  await mkdir("artifacts/worker", { recursive: true });
  await build({
    entryPoints: ["src/workers/scan.worker.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    outfile: "artifacts/worker/scan.js",
  });
  const fixture = JSON.parse(
      await readFile("artifacts/pdf/fixture.json", "utf8"),
    ) as { version: Version; exam: { id: string } },
    browser = await chromium.launch({
      executablePath:
        process.env.CHROME_PATH ??
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
    });
  try {
    const page = await browser.newPage();
    await page.route("**/verification-worker.js", (r) =>
      r.fulfill({
        path: "artifacts/worker/scan.js",
        contentType: "application/javascript",
      }),
    );
    await page.route("**/verification-sheet.png", (r) =>
      r.fulfill({
        path: "artifacts/pdf/preview-2.png",
        contentType: "image/png",
      }),
    );
    await page.goto("http://localhost:3000/login");
    const result = await page.evaluate(
      async (input) => {
        const blob = await (await fetch("/verification-sheet.png")).blob(),
          file = new File([blob], "synthetic-generated-sheet.png", {
            type: "image/png",
          });
        return await new Promise<{
          ok: boolean;
          error?: string;
          warning: string;
          page: number;
          answers: { status: string; selected: number | null }[];
          identity: { examId: string; versionId: string; pageNumber: number };
          bytes: number;
        }>((resolve) => {
          const worker = new Worker("/verification-worker.js");
          const timer = setTimeout(() => {
            worker.terminate();
            throw Error("Timeout");
          }, 30000);
          worker.onmessage = (e) => {
            clearTimeout(timer);
            const { stored, ...data } = e.data;
            worker.terminate();
            resolve({ ...data, bytes: stored?.size ?? 0 });
          };
          worker.postMessage({ ...input, file });
        });
      },
      {
        pages: sheetLayout(fixture.version.questions),
        examId: fixture.exam.id,
        versionId: fixture.version.id,
        pageNumber: 2,
      },
    );
    assert.equal(result.ok, true, result.error ?? "Recognition failed");
    assert.equal(result.page, 1, "QR overrides manually selected page 2");
    assert.equal(result.warning, "");
    assert.equal(result.answers.length, 5);
    assert.ok(result.answers.every((a) => a.status === "blank"));
    assert.equal(result.identity.versionId, "pdf-version");
    assert.ok(result.bytes > 1000);
    await writeFile(
      "artifacts/worker/roundtrip.json",
      JSON.stringify(
        {
          checks: [
            "Worker real en Chrome",
            "PDF renderizado → QR → página correcta",
            "OMR confirma 5 filas y detecta blanco",
            "Compresión JPEG posterior al reconocimiento",
          ],
          result,
        },
        null,
        2,
      ),
    );
    console.log(
      "PDF → imagen → QR + OMR → compresión: verificado en Web Worker real.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
