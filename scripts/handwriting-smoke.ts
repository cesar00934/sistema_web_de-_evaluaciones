import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
async function main() {
  await mkdir("artifacts/handwriting", { recursive: true });
  await build({
    entryPoints: ["src/workers/handwriting.worker.ts"],
    bundle: true,
    platform: "browser",
    format: "esm",
    outfile: "artifacts/handwriting/worker.js",
  });
  const image = await fetch(
    "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/handwriting.jpg",
  );
  assert.ok(image.ok);
  const sample = Buffer.from(await image.arrayBuffer());
  const script = await readFile("artifacts/handwriting/worker.js");
  const server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/worker.js"
        ? "application/javascript"
        : req.url === "/sample.jpg"
          ? "image/jpeg"
          : "text/html",
    );
    res.end(
      req.url === "/worker.js"
        ? script
        : req.url === "/sample.jpg"
          ? sample
          : "<html><body>Local handwriting verification</body></html>",
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ??
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  try {
    const page = await browser.newPage();
    page.on("requestfailed", (request) => {
      console.log(request.failure()?.errorText, request.url());
    });
    page.on("console", (m) => {
      if (m.type() === "error") console.log(m.text().slice(0, 250));
    });
    await page.goto(`http://127.0.0.1:${address.port}`);
    for (const offline of [false, true]) {
      await page.context().setOffline(offline);
      // Browser route allows only our local test assets while network is disabled.
      if (offline)
        await page.route("**/worker.js", (r) =>
          r.fulfill({ body: script, contentType: "application/javascript" }),
        );
      const result = await page.evaluate(
        async ({ offline, sample }) => {
          const blob = offline
            ? new Blob([Uint8Array.from(sample)], { type: "image/jpeg" })
            : await (await fetch("/sample.jpg")).blob();
          return await new Promise<{
            ok: boolean;
            answers: { text: string }[];
            error?: string;
          }>((resolve, reject) => {
            const worker = new Worker("/worker.js", { type: "module" });
            const timer = setTimeout(() => {
              worker.terminate();
              reject(Error("HTR exceeded five minutes"));
            }, 300000);
            worker.onmessage = (e) => {
              if (e.data.progress) return;
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
              crops: [{ questionId: "sample", label: "1", lines: [blob] }],
            });
          });
        },
        { offline, sample: [...sample] },
      );
      console.log(JSON.stringify({ offline, ...result }));
      assert.ok(result.ok, result.error ?? "Handwriting recognition failed");
      assert.match(result.answers[0].text, /Brown.*commented/i);
      await writeFile(
        `artifacts/handwriting/${offline ? "offline" : "online"}.json`,
        JSON.stringify(result, null, 2),
      );
    }
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
