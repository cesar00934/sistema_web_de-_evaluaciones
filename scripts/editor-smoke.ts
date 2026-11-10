import QRCode from "qrcode";
import sharp from "sharp";
import { reportSpreadsheet } from "../src/lib/report-spreadsheet";
import { chromium } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { evaluationSchema, validateOwnedAssets } from "../src/lib/evaluation";
import { generatePdf } from "../src/lib/pdf";
import {
  questionSchema,
  sheetLayout,
  type Question,
  type Version,
} from "../src/lib/domain";
import { builtInAssets } from "../src/lib/editor-defaults";
const owner = "11111111-1111-4111-8111-111111111111";
async function main() {
  await mkdir("artifacts/ui", { recursive: true });
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text default '',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
  create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;grant usage on schema storage to authenticated,anon;grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of [
    "001_academic.sql",
    "002_storage.sql",
    "003_reports.sql",
    "004_legacy.sql",
    "005_selection.sql",
    "006_editor_and_roles.sql",
  ])
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query(
    "insert into auth.users(id,email) values($1,'docente@example.test')",
    [owner],
  );
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    owner,
  ]);
  const bundled = await build({
    entryPoints: ["scripts/fixtures/editor-harness.tsx"],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
    define: {
      "import.meta.url": "window.location.href",
      "process.env.NEXT_PUBLIC_SUPABASE_URL": "window.location.origin",
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY":
        '"local-test-publishable"',
      "process.env.NODE_ENV": '"production"',
    },
  });
  const scanWorker = await build({
    entryPoints: ["src/workers/scan.worker.ts"],
    bundle: true,
    platform: "browser",
    format: "iife",
    write: false,
  });
  const tables = new Set([
    "exams",
    "questions",
    "settings",
    "teachers",
    "courses",
    "catalog_options",
    "design_assets",
    "versions",
    "students",
    "results",
    "scans",
    "manual_grades",
  ]);
  const images = new Map<string, Buffer>();
  let commits = 0;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost"),
        chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.from(c));
      const body =
        chunks.length &&
        req.headers["content-type"]?.includes("application/json")
          ? JSON.parse(Buffer.concat(chunks).toString())
          : null;
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (url.pathname === "/auth/v1/user") {
        json({
          id: owner,
          aud: "authenticated",
          email: "docente@example.test",
          app_metadata: { provider: "email" },
          user_metadata: {},
          created_at: "2026-11-05T00:00:00Z",
        });
        return;
      }
      if (
        url.pathname === "/src/workers/scan.worker.ts" ||
        url.pathname === "/workers/scan.worker.ts"
      ) {
        res.setHeader("Content-Type", "application/javascript");
        res.end(scanWorker.outputFiles[0].contents);
        return;
      }
      if (url.pathname === "/rest/v1/rpc/commit_scan") {
        commits++;
        const result = await db.query<{ result: unknown }>(
          "select commit_scan($1,$2,$3) as result",
          [
            JSON.stringify(body.p_scan),
            JSON.stringify(body.p_answers),
            body.p_resolution,
          ],
        );
        json(result.rows[0].result);
        return;
      }
      if (url.pathname === "/rest/v1/rpc/academic_summary") {
        json(null);
        return;
      }
      if (url.pathname === "/rest/v1/rpc/review_answer") {
        const result = await db.query<{ result: unknown }>(
          "select review_answer($1,$2,$3,$4,$5) as result",
          [
            body.p_version,
            body.p_student,
            body.p_question,
            body.p_score,
            JSON.stringify(body.p_rubric),
          ],
        );
        json(result.rows[0].result);
        return;
      }
      const evidence = `${owner}/review.png`;
      if (url.pathname === `/storage/v1/object/sign/scans/${evidence}`) {
        if (req.method === "POST") {
          json({
            signedURL: `/object/sign/scans/${evidence}?token=local-test`,
          });
        } else {
          res.setHeader("Content-Type", "image/png");
          res.end(images.get(evidence));
        }
        return;
      }
      if (
        url.pathname.startsWith("/storage/v1/object/questions/") &&
        req.method === "POST"
      ) {
        const path = decodeURIComponent(
          url.pathname.slice("/storage/v1/object/questions/".length),
        );
        const data = await new Request("http://localhost/upload", {
          method: "POST",
          headers: { "Content-Type": req.headers["content-type"]! },
          body: new Uint8Array(Buffer.concat(chunks)),
        }).formData();
        const file = [...data.values()].find(
          (v) => typeof v !== "string",
        ) as File;
        assert.ok(file);
        assert.equal(file.type, "image/png");
        await db.query(
          "insert into storage.objects(bucket_id,name) values('questions',$1)",
          [path],
        );
        images.set(path, Buffer.from(await file.arrayBuffer()));
        json({ Key: `questions/${path}` });
        return;
      }
      if (url.pathname.startsWith("/storage/v1/object/sign/questions/")) {
        const path = decodeURIComponent(
          url.pathname.slice("/storage/v1/object/sign/questions/".length),
        );
        if (req.method === "POST") {
          json({
            signedURL: `/object/sign/questions/${path}?token=local-test`,
          });
          return;
        }
        res.setHeader("Content-Type", "image/png");
        res.end(images.get(path));
        return;
      }
      if (["/", "/scanner", "/review"].includes(url.pathname)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          '<html lang="es"><head><link rel="stylesheet" href="/globals.css"></head><body><div id="root"></div><script src="/harness.js"></script></body></html>',
        );
        return;
      }
      if (url.pathname === "/harness.js") {
        res.setHeader("Content-Type", "application/javascript");
        res.end(bundled.outputFiles[0].contents);
        return;
      }
      if (url.pathname === "/globals.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(await readFile("src/app/globals.css"));
        return;
      }
      if (/^\/(institutional|fonts)\/[\w.-]+$/.test(url.pathname)) {
        res.setHeader(
          "Content-Type",
          url.pathname.endsWith(".png")
            ? "image/png"
            : url.pathname.endsWith(".jpg")
              ? "image/jpeg"
              : "font/ttf",
        );
        res.end(await readFile(`public${url.pathname}`));
        return;
      }
      if (url.pathname.startsWith("/rest/v1/")) {
        const table = url.pathname.split("/").pop()!;
        if (!tables.has(table)) {
          json({ error: "Unexpected test request" }, 404);
          return;
        }
        if (req.method === "POST" && table === "catalog_options") {
          await db.query(
            "insert into catalog_options(owner_id,kind,value) values($1,$2,$3) on conflict do nothing",
            [owner, body.kind, body.value],
          );
          res.writeHead(201);
          res.end();
          return;
        }
        assert.equal(req.method, "GET");
        const reviewJoins =
          table === "results"
            ? `, (select row_to_json(s) from students s where s.owner_id=t.owner_id and s.id=t.student_id) as students,
             (select to_jsonb(v) || jsonb_build_object('exams',row_to_json(e)) from versions v join exams e
              on e.owner_id=v.owner_id and e.id=v.exam_id where v.owner_id=t.owner_id and v.id=t.version_id) as versions`
            : table === "scans"
              ? `, (select coalesce(json_agg(a),'[]') from answers a where a.owner_id=t.owner_id and a.scan_id=t.id) as answers,
               (select coalesce(json_agg(a),'[]') from attachments a where a.owner_id=t.owner_id and a.scan_id=t.id) as attachments`
              : "";
        let rows = (
          await db.query<Record<string, unknown>>(
            `select t.* ${reviewJoins} from public.${table} t where t.owner_id=$1`,
            [owner],
          )
        ).rows;
        for (const [k, v] of url.searchParams) {
          if (v.startsWith("eq."))
            rows = rows.filter((r) => String(r[k]) === v.slice(3));
          if (v.startsWith("gt."))
            rows = rows.filter((r) => Number(r[k]) > Number(v.slice(3)));
          if (v.startsWith("ilike."))
            rows = rows.filter((r) =>
              String(r[k])
                .toLowerCase()
                .includes(v.slice(6).replaceAll("%", "").toLowerCase()),
            );
        }
        const count = rows.length,
          offset = Number(url.searchParams.get("offset") ?? 0),
          limit = Number(url.searchParams.get("limit") ?? 25);
        rows = rows.slice(offset, offset + limit);
        res.setHeader(
          "Content-Range",
          `${offset}-${Math.max(offset, offset + rows.length - 1)}/${count}`,
        );
        json(
          req.headers.accept?.includes("application/vnd.pgrst.object+json")
            ? rows[0]
            : rows,
        );
        return;
      }
      if (url.pathname === "/api/evaluations") {
        const parsed = evaluationSchema.parse(body);
        validateOwnedAssets(parsed.settings, owner);
        const result = await db.query<{ revision: number }>(
          "select save_evaluation($1,$2,$3) as revision",
          [JSON.stringify(parsed), parsed.bankIds, parsed.revision],
        );
        json({ id: parsed.id, revision: result.rows[0].revision });
        return;
      }
      if (url.pathname === "/api/pdf/preview") {
        const exam = evaluationSchema.parse(body),
          questions = exam.settings.localQuestions as Question[],
          pages = sheetLayout(questions);
        const version: Version = {
          id: "preview",
          exam_id: exam.id,
          label: "Vista previa",
          questions,
          items: pages.flatMap((p) => [...p.items, ...p.written]),
          page_count: pages.length,
        };
        const bytes = await generatePdf(
          { ...exam, question_ids: questions.map((q) => q.id) },
          version,
          String(exam.settings.institution),
          "original",
          async (asset) =>
            new Uint8Array(
              images.get(asset) ??
                (await readFile(
                  `public${builtInAssets.find((a) => a.id === asset)!.url}`,
                )),
            ),
        );
        await writeFile("artifacts/pdf/editor-preview.pdf", bytes);
        res.setHeader("Content-Type", "application/pdf");
        res.end(bytes);
        return;
      }
      json({ error: "Unexpected test route" }, 404);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ??
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    const excelBytes = await reportSpreadsheet(
      ["nombres", "apellidos", "nivel", "grado", "seccion", "codigo"],
      [["Ana", "P\u00e9rez", "PRIMARIA", 3, "A", "0012"]],
    );
    const excelImport = await page.evaluate(async (bytes) => {
      const file = new File([new Uint8Array(bytes)], "alumnos.xlsx");
      return (
        window as unknown as {
          __parseStudentFile: (file: File) => Promise<{
            students: { code: string; last_names: string }[];
            errors: string[];
          }>;
        }
      ).__parseStudentFile(file);
    }, Array.from(excelBytes));
    assert.deepEqual(excelImport.errors, []);
    assert.equal(excelImport.students[0].code, "0012");
    assert.equal(excelImport.students[0].last_names, "P\u00e9rez");

    await page
      .getByRole("button", { name: "+ Nueva evaluación", exact: true })
      .click();
    const editor = page.locator(".institutional-editor");
    await editor
      .getByLabel("Título de la evaluación")
      .fill("Evaluación de unidad de prueba");
    await editor
      .locator(".asset-selector")
      .filter({ hasText: "Encabezado de la primera página" })
      .locator("select")
      .selectOption("builtin:1.jpg");
    await editor
      .locator(".asset-selector")
      .filter({ hasText: "Encabezado desde la segunda página" })
      .locator("select")
      .selectOption("builtin:4.png");
    await page
      .getByRole("button", { name: "+ Crear pregunta aquí", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Editor de pregunta" });
    await dialog
      .getByLabel("Enunciado", { exact: true })
      .fill("¿Cuánto es dos más dos?");
    await dialog.locator('input[name="topic"]').fill("Sumas guardadas");
    // PNG bytes with no MIME type used to be rejected before an understandable preview.
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "captura-sin-tipo.png",
      mimeType: "",
      buffer: await readFile("public/icon-192.png"),
    });
    await dialog.getByText("Imagen guardada:", { exact: false }).waitFor();
    assert.equal(
      await dialog
        .getByAltText("Vista previa de la imagen seleccionada")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
      192,
    );
    assert.equal(await dialog.getByRole("checkbox").last().isChecked(), false);
    await dialog
      .getByRole("button", { name: "Usar en esta evaluación", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Guardar evaluación", exact: true })
      .click();
    await page
      .getByText("Evaluación guardada.", { exact: false })
      .first()
      .waitFor();
    assert.equal((await db.query("select * from questions")).rows.length, 0);
    const saved = (
      await db.query<{ settings: { localQuestions: Question[] } }>(
        "select settings from exams",
      )
    ).rows[0];
    assert.equal(
      saved.settings.localQuestions[0].prompt,
      "¿Cuánto es dos más dos?",
    );
    assert.ok(
      saved.settings.localQuestions[0].imagePath?.startsWith(owner + "/"),
    );
    assert.equal(images.size, 1);
    await editor.getByLabel("Guardar también en mi banco").check();
    await editor
      .getByRole("button", { name: "Guardar evaluación", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".editor-toolbar button")
          ?.hasAttribute("disabled"),
    );
    assert.equal((await db.query("select * from questions")).rows.length, 1);
    assert.equal(
      (
        await db.query(
          "select * from catalog_options where kind='topic' and value='Sumas guardadas'",
        )
      ).rows.length,
      1,
    );
    await editor
      .getByRole("button", { name: "+ Crear pregunta aquí", exact: true })
      .click();
    await dialog.getByLabel("Alternativa 1", { exact: true }).fill("");
    await dialog.getByLabel("Tipo de pregunta").selectOption("trueFalse");
    await dialog
      .getByLabel("Enunciado", { exact: true })
      .fill("Indica verdadero o falso.");
    await dialog
      .getByLabel("Enunciado 1", { exact: true })
      .fill("Dos más dos es cinco.");
    assert.equal(
      await dialog
        .getByLabel("Respuesta correcta 1", { exact: true })
        .inputValue(),
      "",
    );
    await dialog
      .getByLabel("Respuesta correcta 1", { exact: true })
      .selectOption("F");
    await dialog
      .getByRole("button", { name: "+ Enunciado", exact: true })
      .click();
    await dialog
      .getByLabel("Enunciado 2", { exact: true })
      .fill("Dos más dos es cuatro.");
    await dialog
      .getByLabel("Respuesta correcta 2", { exact: true })
      .selectOption("V");
    await page.screenshot({
      path: "artifacts/ui/true-false-keys.png",
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Usar en esta evaluación", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Guardar evaluación", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".editor-toolbar button")
          ?.hasAttribute("disabled"),
    );
    const tf = (
      await db.query<{ settings: { localQuestions: Question[] } }>(
        "select settings from exams",
      )
    ).rows[0].settings.localQuestions[1];
    assert.deepEqual(tf.trueFalseAnswers, [false, true]);
    await editor
      .getByRole("button", { name: "+ Crear pregunta aquí", exact: true })
      .click();
    await dialog.getByLabel("Tipo de pregunta").selectOption("matching");
    await dialog
      .getByLabel("Enunciado", { exact: true })
      .fill("Relaciona cada país con su capital.");
    await dialog
      .getByLabel("Cantidad de elementos a relacionar")
      .selectOption("4");
    await dialog
      .getByLabel("Relación correcta 1", { exact: true })
      .selectOption("3");
    await dialog
      .getByLabel("Cantidad de elementos a relacionar")
      .selectOption("3");
    assert.equal(
      await dialog
        .getByLabel("Relación correcta 1", { exact: true })
        .inputValue(),
      "",
    );
    for (const [i, text] of ["Perú", "Francia", "Japón"].entries())
      await dialog
        .getByLabel(`Columna A, elemento ${i + 1}`, { exact: true })
        .fill(text);
    for (const [i, text] of ["Tokio", "Lima", "París"].entries())
      await dialog
        .getByLabel(`Columna B, elemento ${String.fromCharCode(97 + i)}`, {
          exact: true,
        })
        .fill(text);
    for (const [i, key] of [1, 2, 0].entries())
      await dialog
        .getByLabel(`Relación correcta ${i + 1}`, { exact: true })
        .selectOption(String(key));
    await dialog.screenshot({ path: "artifacts/ui/matching-desktop.png" });
    await dialog
      .getByRole("button", { name: "Usar en esta evaluación", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "Guardar evaluación", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".editor-toolbar button")
          ?.hasAttribute("disabled"),
    );
    const match = (
      await db.query<{ settings: { localQuestions: Question[] } }>(
        "select settings from exams",
      )
    ).rows[0].settings.localQuestions[2];
    assert.deepEqual(match.leftColumn, ["Perú", "Francia", "Japón"]);
    assert.deepEqual(match.rightColumn, ["Tokio", "Lima", "París"]);
    assert.deepEqual(match.matchingAnswers, [1, 2, 0]);
    await editor
      .getByRole("button", { name: "Vista previa PDF", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Vista previa PDF" }).waitFor();
    await page
      .getByRole("dialog", { name: "Vista previa PDF" })
      .getByRole("button", { name: "Cerrar", exact: true })
      .click();
    await page.screenshot({
      path: "artifacts/ui/editor-desktop.png",
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "Editar", exact: true })
      .first()
      .click();
    await page.getByLabel("Título de la evaluación").waitFor();
    assert.equal(
      await page.getByLabel("Título de la evaluación").inputValue(),
      "Evaluación de unidad de prueba",
    );
    assert.equal(await page.locator(".exam-question").count(), 3);
    assert.ok(
      (await page
        .locator('datalist option[value="Sumas guardadas"]')
        .count()) === 0,
    ); // Topics appear in the question composer.
    await page
      .locator(".exam-question")
      .first()
      .getByRole("button", { name: "Editar", exact: true })
      .click();
    await dialog.getByAltText("Adjunto académico").waitFor();
    assert.equal(
      await page.locator('input[name="topic"]').inputValue(),
      "Sumas guardadas",
    );
    assert.equal(
      await page.locator('datalist option[value="Sumas guardadas"]').count(),
      1,
    );
    await page
      .getByRole("dialog", { name: "Editor de pregunta" })
      .getByRole("button", { name: "Cerrar", exact: true })
      .click();
    await page
      .locator(".exam-question")
      .nth(1)
      .getByRole("button", { name: "Editar", exact: true })
      .click();
    assert.equal(
      await dialog
        .getByLabel("Respuesta correcta 1", { exact: true })
        .inputValue(),
      "F",
    );
    assert.equal(
      await dialog
        .getByLabel("Respuesta correcta 2", { exact: true })
        .inputValue(),
      "V",
    );
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator(".exam-question")
      .nth(2)
      .getByRole("button", { name: "Editar", exact: true })
      .click();
    for (const [i, key] of [1, 2, 0].entries())
      assert.equal(
        await dialog
          .getByLabel(`Relación correcta ${i + 1}`, { exact: true })
          .inputValue(),
        String(key),
      );
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await dialog.screenshot({ path: "artifacts/ui/matching-mobile.png" });
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page
      .locator(".exam-question")
      .nth(1)
      .getByRole("button", { name: "Editar", exact: true })
      .click();
    const saveBox = await dialog
      .getByRole("button", { name: "Usar en esta evaluación", exact: true })
      .boundingBox();
    assert.ok(
      saveBox && saveBox.y >= 0 && saveBox.y + saveBox.height <= 844,
      "Question action stays in the viewport",
    );
    assert.equal(
      await dialog.evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await dialog.screenshot({ path: "artifacts/ui/true-false-mobile.png" });
    await dialog.getByRole("button", { name: "Cerrar", exact: true }).click();
    assert.equal(
      await page
        .locator("body")
        .evaluate((b) => b.scrollWidth > window.innerWidth),
      false,
    );
    await page.screenshot({
      path: "artifacts/ui/editor-mobile.png",
      fullPage: true,
    });
    const examRow = (
      await db.query<{ id: string; settings: { localQuestions: Question[] } }>(
        "select id,settings from exams limit 1",
      )
    ).rows[0];
    const scanPages = sheetLayout(examRow.settings.localQuestions);
    await db.query(
      "insert into students(id,code,first_names,last_names,grade,section) values('scanner-student','scanner-code','Ana','Pérez','1','A')",
    );
    await db.query(
      "insert into versions(id,exam_id,label,questions,items,page_count,scale_maximum) values('scanner-version',$1,'Prueba de escáner',$2,$3,$4,20)",
      [
        examRow.id,
        JSON.stringify(examRow.settings.localQuestions),
        JSON.stringify(scanPages.flatMap((p) => [...p.items, ...p.written])),
        scanPages.length,
      ],
    );
    let workerStarts = 0;
    page.on("worker", () => workerStarts++);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/scanner`);
    const upload = page.locator('input[type="file"]'),
      scanButton = page.getByRole("button", {
        name: "Escanear y guardar",
        exact: true,
      });
    await scanButton.waitFor();
    await upload.setInputFiles({
      name: "hoja-antes-de-elegir-alumno.png",
      mimeType: "image/png",
      buffer: await readFile("public/icon-192.png"),
    });
    await page
      .getByAltText("Vista previa: hoja-antes-de-elegir-alumno.png", {
        exact: true,
      })
      .waitFor();
    assert.equal(workerStarts, 0);
    assert.equal(commits, 0);
    assert.equal(await scanButton.isDisabled(), true);
    await page
      .getByRole("button", {
        name: "Quitar hoja-antes-de-elegir-alumno.png",
        exact: true,
      })
      .click();
    assert.equal(await page.locator(".scan-thumbnails article").count(), 0);
    await upload.setInputFiles({
      name: "hoja-preparada.png",
      mimeType: "image/png",
      buffer: await readFile("public/icon-192.png"),
    });
    await page
      .getByAltText("Vista previa: hoja-preparada.png", { exact: true })
      .waitFor();
    await page
      .getByRole("combobox", { name: "Versión del examen", exact: true })
      .selectOption("scanner-version");
    await page
      .getByRole("combobox", { name: "Alumno para este lote", exact: true })
      .selectOption("scanner-student");
    await page.getByLabel("Guardar copia comprimida para revisión").uncheck();
    await scanButton.waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>(".scan-submit button")
          ?.disabled,
    );
    assert.equal(await scanButton.isEnabled(), true);
    assert.equal(commits, 0);
    assert.equal(workerStarts, 0);
    await page.screenshot({
      path: "artifacts/ui/scanner-ready.png",
      fullPage: true,
    });
    await scanButton.click();
    await page
      .getByText("Corrección guardada · Sin imagen", { exact: true })
      .waitFor();
    assert.equal(workerStarts, 1);
    assert.equal(commits, 1);
    assert.equal(
      (
        await db.query(
          "select * from results where student_id='scanner-student'",
        )
      ).rows.length,
      1,
    );
    assert.equal(await page.locator(".scan-thumbnails article").count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page
        .locator("body")
        .evaluate((b) => b.scrollWidth > window.innerWidth),
      false,
    );
    await page.screenshot({
      path: "artifacts/ui/scanner-mobile.png",
      fullPage: true,
    });
    // Real QR pixels: no manual version selection, two versions in one batch.
    await page.goto(`${base}/scanner`);
    const qrFiles = [];
    for (const [id, label] of [
      ["auto-a", "Version automatica A"],
      ["auto-b", "Version automatica B"],
    ]) {
      await db.query(
        "insert into versions(id,exam_id,label,questions,items,page_count,scale_maximum) values($1,$2,$3,$4,$5,$6,20)",
        [
          id,
          examRow.id,
          label,
          JSON.stringify(examRow.settings.localQuestions),
          JSON.stringify(scanPages.flatMap((p) => [...p.items, ...p.written])),
          scanPages.length,
        ],
      );
      const qr = await QRCode.toBuffer(`CE1|${examRow.id}|${id}|1`, {
        width: 240,
        margin: 4,
      });
      let buffer = await sharp({
        create: { width: 1000, height: 1400, channels: 4, background: "white" },
      })
        .composite([{ input: qr, left: 700, top: 70 }])
        .png()
        .toBuffer();
      if (id === "auto-b")
        buffer = await sharp(buffer).rotate(90).png().toBuffer();
      qrFiles.push({ name: `${id}.png`, mimeType: "image/png", buffer });
    }
    await upload.setInputFiles(qrFiles);
    await page
      .getByText("QR: Version automatica A · Página 1", { exact: true })
      .waitFor();
    await page
      .getByText("QR: Version automatica B · Página 1", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("combobox", { name: "Versión del examen", exact: true })
        .count(),
      0,
    );
    assert.equal(await scanButton.isDisabled(), true);
    await page
      .getByRole("combobox", { name: "Alumno para este lote", exact: true })
      .selectOption("scanner-student");
    await page.getByLabel("Guardar copia comprimida para revisión").uncheck();
    await page.waitForFunction(
      () =>
        !document.querySelector<HTMLButtonElement>(".scan-submit button")
          ?.disabled,
    );
    await upload.setInputFiles({
      name: "qr-no-autorizado.png",
      mimeType: "image/png",
      buffer: await QRCode.toBuffer(`CE1|otro-examen|auto-a|1`, {
        width: 400,
        margin: 4,
      }),
    });
    await page
      .getByRole("alert")
      .filter({ hasText: "no está disponible en tu cuenta" })
      .waitFor();
    assert.equal(await scanButton.isDisabled(), true);
    await page
      .getByRole("button", { name: "Quitar qr-no-autorizado.png", exact: true })
      .click();
    // A readable QR with an invalid page blocks the batch, rather than silently
    // using an unrelated manual version or guessing from labels.
    await upload.setInputFiles({
      name: "pagina-invalida.png",
      mimeType: "image/png",
      buffer: await QRCode.toBuffer(`CE1|${examRow.id}|auto-a|999`, {
        width: 400,
        margin: 4,
      }),
    });
    await page
      .getByRole("alert")
      .filter({ hasText: "El QR indica una página" })
      .waitFor();
    assert.equal(await scanButton.isDisabled(), true);
    await page
      .getByRole("button", { name: "Quitar pagina-invalida.png", exact: true })
      .click();
    await page.screenshot({
      path: "artifacts/ui/scanner-auto-qr.png",
      fullPage: true,
    });
    assert.equal(workerStarts, 1);
    assert.equal(commits, 1);
    await scanButton.click();
    await page.waitForFunction(
      () => document.querySelectorAll(".scan-thumbnails article").length === 0,
    );
    assert.equal(workerStarts, 3);
    assert.equal(commits, 3);
    const autoScans = (
      await db.query<{ version_id: string; page_number: number }>(
        "select version_id,page_number from scans where version_id in ('auto-a','auto-b') order by version_id",
      )
    ).rows;
    assert.deepEqual(
      autoScans.map((r) => [r.version_id, r.page_number]),
      [
        ["auto-a", 1],
        ["auto-b", 1],
      ],
    );
    const reviewQuestions = [
      questionSchema.parse({
        id: "review-vf",
        type: "trueFalse",
        prompt: "Marca verdadero o falso",
        trueFalseStatements: ["El agua cambia de estado"],
        trueFalseAnswers: [true],
        score: 2,
      }),
      questionSchema.parse({
        id: "review-written",
        type: "openResponse",
        prompt: "Explica tu respuesta",
        referenceAnswer: "Cambio de estado por calor",
        score: 2,
      }),
      questionSchema.parse({
        id: "review-match",
        type: "matching",
        prompt: "Relaciona",
        leftColumn: ["Hielo"],
        rightColumn: ["Sólido", "Gas"],
        matchingAnswers: [0],
        score: 1,
      }),
    ];
    const reviewPages = sheetLayout(reviewQuestions);
    await db.query(
      "insert into versions(id,exam_id,label,questions,items,page_count,scale_maximum) values('review-version',$1,'Versión de revisión',$2,$3,2,20)",
      [
        examRow.id,
        JSON.stringify(reviewQuestions),
        JSON.stringify(reviewPages.flatMap((p) => [...p.items, ...p.written])),
      ],
    );
    const transcript = JSON.stringify({
      format: "cramer-written-v1",
      answers: [
        {
          questionId: "review-written",
          label: "2",
          text: "Se derrite",
          engine: "Fixture",
        },
      ],
    });
    for (const layout of reviewPages) {
      await db.query("select commit_scan($1,$2,'reject')", [
        JSON.stringify({
          id: `review-${layout.pageNumber}`,
          version_id: "review-version",
          student_id: "scanner-student",
          page_number: layout.pageNumber,
          image_hash: String(layout.pageNumber).repeat(64),
          transcript: layout.written.length ? transcript : "",
        }),
        JSON.stringify(
          [...layout.items, ...layout.written].map((item) => ({
            questionId: item.questionId,
            selected: item.type === "openResponse" ? null : 1,
            status: item.type === "openResponse" ? "manualReview" : "answered",
            confidence: 1,
          })),
        ),
      ]);
    }
    const markers = [
      [32, 32],
      [550.28, 32],
      [550.28, 796.89],
      [32, 796.89],
    ]
      .map(([x, y]) => `<rect x="${x}" y="${y}" width="13" height="13"/>`)
      .join("");
    const rules = [250, 269, 288, 307]
      .map((y) => `<path d="M65 ${y}H530" stroke="#999" stroke-width="0.5"/>`)
      .join("");
    const evidence = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1414" viewBox="0 0 595.28 841.89"><rect width="100%" height="100%" fill="white"/>${markers}${rules}<path d="M90 261q4-12 8 0t8 0t8 0t8 0" fill="none" stroke="black" stroke-width="2"/></svg>`,
      ),
    )
      .png()
      .toBuffer();
    const evidencePath = `${owner}/review.png`;
    images.set(evidencePath, evidence);
    await db.query(
      "insert into attachments(id,scan_id,path,bytes,mime) values('review-evidence','review-2',$1,$2,'image/png')",
      [evidencePath, evidence.length],
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/review`);
    const reviewRow = page
      .getByRole("row")
      .filter({ hasText: "Versión de revisión" });
    const openReview = () =>
      reviewRow.getByRole("button", { name: "Revisar", exact: true }).click();
    await openReview();
    const writing = page.getByRole("article", {
      name: "Revisar pregunta 2",
      exact: true,
    });
    const vf = page.getByRole("article", {
      name: "Revisar pregunta 1.1",
      exact: true,
    });
    await vf.waitFor();
    assert.deepEqual(
      await vf.locator(".answer-comparison strong").allTextContents(),
      ["Falso", "Verdadero", "0 / 2"],
    );
    const matchReview = page.getByRole("article", {
      name: "Revisar pregunta 3.1",
      exact: true,
    });
    assert.deepEqual(
      await matchReview.locator(".answer-comparison strong").allTextContents(),
      ["B) Gas", "A) Sólido", "0 / 1"],
    );
    await writing
      .getByRole("paragraph")
      .filter({ hasText: /^Se derrite$/ })
      .waitFor();
    await writing
      .getByRole("link", { name: "Ver evidencia de la hoja 2" })
      .click();
    await page.locator("#evidencia-review-2 img").waitFor();
    const crops = await page.evaluate(
      async ({ pages, examId, path }) => {
        const blob = await (await fetch(path)).blob();
        const worker = new Worker("/workers/scan.worker.ts");
        try {
          return await new Promise<{
            warning: string;
            writtenWarning?: string;
            written: { questionId: string; lines: Blob[] }[];
          }>((resolve, reject) => {
            worker.onmessage = (event) => resolve(event.data);
            worker.onerror = (event) => reject(Error(event.message));
            worker.postMessage({
              file: new File([blob], "fixture.png"),
              pages,
              examId,
              versionId: "review-version",
              pageNumber: 2,
              readWritten: true,
            });
          });
        } finally {
          worker.terminate();
        }
      },
      {
        pages: reviewPages,
        examId: examRow.id,
        path: `/storage/v1/object/sign/scans/${evidencePath}`,
      },
    );
    assert.equal(crops.warning, "");
    assert.equal(crops.writtenWarning, undefined);
    assert.equal(crops.written[0].questionId, "review-written");
    assert.equal(crops.written[0].lines.length, 1);
    await vf
      .getByText("Rectificar respuesta o puntaje", { exact: true })
      .click();
    const select = vf.getByRole("combobox");
    const score = vf.getByRole("spinbutton");
    await select.selectOption("0");
    assert.equal(await score.inputValue(), "2");
    await select.selectOption("blank");
    assert.equal(await score.inputValue(), "0");
    await select.selectOption("0");
    await score.fill("1.5");
    await vf
      .getByLabel("Motivo u observación")
      .fill("Marca comprobada en la hoja");
    await vf
      .getByRole("button", { name: "Guardar revisión y recalcular nota" })
      .click();
    await vf.getByText("Puntaje docente 1.5 / 2").waitFor();
    await page.getByText("Nota 6.00 · 1 pendiente", { exact: true }).waitFor();
    assert.equal(
      (
        await db.query<{ selected: number }>(
          "select selected from answers where scan_id='review-1' and question_id='review-vf#0'",
        )
      ).rows[0].selected,
      1,
    );
    await page.screenshot({
      path: "artifacts/ui/review-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await openReview();
    await vf
      .getByText("Marca comprobada en la hoja", { exact: false })
      .waitFor();
    assert.equal(
      await page
        .locator("body")
        .evaluate((b) => b.scrollWidth > window.innerWidth),
      false,
    );
    await page.screenshot({
      path: "artifacts/ui/review-mobile.png",
      fullPage: true,
    });
    await writing
      .getByText("Revisar y confirmar puntaje", { exact: true })
      .click();
    await writing
      .getByLabel("Transcripción revisada")
      .fill("Se derrite con el calor");
    await writing.getByRole("button", { name: "Puntaje completo: 2" }).click();
    await writing
      .getByRole("button", { name: "Guardar revisión y recalcular nota" })
      .click();
    await page.getByText("Nota 14.00 · Confirmada", { exact: true }).waitFor();
    await writing
      .getByText("Se derrite con el calor", { exact: true })
      .filter({ visible: true })
      .waitFor();
    assert.equal(
      (
        await db.query<{ transcript: string }>(
          "select transcript from scans where id='review-2'",
        )
      ).rows[0].transcript,
      transcript,
    );
    assert.deepEqual(errors, []);
    const checks = [
      "QR real: versión/página automáticas, imagen girada, lote con dos versiones y página inválida bloqueada; ningún guardado antes del botón",
      "Pregunta interna guardada sin banco",
      "Imagen sin MIME: carga, miniatura, almacenamiento privado, recarga y PDF",
      "Claves F/V elegidas explícitamente, guardadas y recuperadas",
      "Relacionar: campos A/B y claves por letra, cambio de cantidad, guardado y recuperación, escritorio/móvil",
      "Banco opcional explícito",
      "Catálogos y evaluación sobreviven recarga",
      "Encabezados y vista previa PDF real",
      "Editor escritorio/móvil sin errores JS ni desbordamiento",
      "Escáner: miniatura antes de asignar alumno, quitar archivo y ningún reconocimiento/guardado hasta pulsar el botón",
      "Escanear y guardar: Worker real y commit_scan SQL real, resultado del alumno y cola vacía tras guardar",
      "Corrección: evidencia, recorte de hoja sintética, claves VF/relación, transcripción, puntaje parcial y recálculo SQL tras recargar",
    ];
    await writeFile(
      "artifacts/ui/editor-smoke.json",
      JSON.stringify(
        {
          checks,
          scope:
            "Componentes reales y SQL real mediante PGlite; transporte Auth/REST local de prueba. No valida correo, autenticación ni Storage de un Supabase alojado.",
        },
        null,
        2,
      ),
    );
    console.log(checks.join("\n"));
  } finally {
    await browser.close();
    server.close();
    await db.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
