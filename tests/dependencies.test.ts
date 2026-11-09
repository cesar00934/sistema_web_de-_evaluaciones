import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readSheet } from "read-excel-file/universal";
import { parseStudentFile } from "../src/lib/imports";
import { reportSpreadsheet } from "../src/lib/report-spreadsheet";
import { npmEnvironment } from "../scripts/npm-environment.mjs";

test("XLSX export preserves numeric grades and untrusted text without converting it to formulas", async () => {
  const bytes = await reportSpreadsheet(
    ["Alumno", "Nota", "Observación"],
    [
      ["Ángela Pérez", 17.25, '=HYPERLINK("https://example.test")'],
      ["李", 0, "+SUM(1,1)"],
    ],
  );
  const rows = await readSheet(new Uint8Array(bytes).buffer);
  assert.deepEqual(rows, [
    ["Alumno", "Nota", "Observación"],
    ["Ángela Pérez", 17.25, '=HYPERLINK("https://example.test")'],
    ["李", 0, "+SUM(1,1)"],
  ]);
});

test("Student XLSX import preserves codes, accents, empty rows and active status", async () => {
  const bytes = await reportSpreadsheet(
    ["nombres", "apellidos", "nivel", "grado", "seccion", "codigo", "estado"],
    [
      ["Ana", "Pérez", "PRIMARIA", 3, "A", "0012", "ACTIVO"],
      [],
      ["Luis", "García", "PRIMARIA", 3, "B", "0099", "INACTIVO"],
    ],
  );
  const result = await parseStudentFile(
    new File([new Uint8Array(bytes)], "alumnos.xlsx"),
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.students.length, 2);
  assert.equal(result.students[0].code, "0012");
  assert.equal(result.students[0].last_names, "Pérez");
  assert.equal(result.students[1].active, false);
});

test("npm legacy cache alias is normalized without changing valid settings or secrets", () => {
  const original = { NPM_CONFIG_CACHE_DIR: "/tmp/npm-cache", TOKEN: "private" };
  const clean = npmEnvironment(original);
  assert.equal(clean.npm_config_cache, "/tmp/npm-cache");
  assert.equal(clean.NPM_CONFIG_CACHE_DIR, undefined);
  assert.equal(clean.TOKEN, "private");
  assert.equal(original.NPM_CONFIG_CACHE_DIR, "/tmp/npm-cache");
  const existing = npmEnvironment({
    npm_config_cache_dir: "/old",
    NPM_CONFIG_CACHE: "/valid",
  });
  assert.equal(existing.NPM_CONFIG_CACHE, "/valid");
  assert.equal(existing.npm_config_cache, undefined);
});

test("Vercel npm entry tolerates injected cache-dir without npm warnings", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/npm-run.mjs", "--version"],
    {
      encoding: "utf8",
      env: { ...process.env, npm_config_cache_dir: "artifacts/npm-cache-test" },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /Unknown env config|cache-dir/);
  assert.match(result.stdout, /\d+\.\d+\.\d+/);
});
