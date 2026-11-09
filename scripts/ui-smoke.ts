import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
async function main() {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ??
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  await mkdir("artifacts/ui", { recursive: true });
  const checks: string[] = [];
  try {
    for (const size of [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({
        viewport: { width: size.width, height: size.height },
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("http://localhost:3000/sistema");
      await page.waitForURL("**/login");
      await page
        .getByRole("heading", { name: "Bienvenido de nuevo" })
        .waitFor();
      assert.equal(
        await page
          .locator("body")
          .evaluate((b) => b.scrollWidth > window.innerWidth),
        false,
      );
      await page.screenshot({
        path: `artifacts/ui/login-${size.name}.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, []);
      checks.push(
        `${size.name}: acceso protegido, login sin errores JS ni desbordamiento`,
      );
      await page.close();
    }
    const page = await browser.newPage();
    const response = await page.request.get(
      "http://localhost:3000/api/reports",
    );
    assert.equal(response.status(), 400);
    const manifest = await page.request.get(
      "http://localhost:3000/manifest.webmanifest",
    );
    assert.equal(manifest.status(), 200);
    checks.push(
      "API sin configuración rechaza petición y manifiesto PWA disponible",
    );
    await writeFile(
      "artifacts/ui/smoke.json",
      JSON.stringify(
        {
          checks,
          scope:
            "Sin credenciales: prueba de login/configuración/redirect. No valida un flujo autenticado real.",
        },
        null,
        2,
      ),
    );
    console.log(checks.join("\n"));
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
