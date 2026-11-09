// Bundle verification tools without altering application code or requiring a global TypeScript runner.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
const task = process.argv[2] ?? "test";
await mkdir("artifacts", { recursive: true });
const entries =
  task === "test"
    ? (await readdir("tests"))
        .filter((n) => n.endsWith(".test.ts"))
        .map((n) => `tests/${n}`)
    : [`scripts/${task}.ts`];
await build({
  entryPoints: entries,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outdir: "artifacts/tools",
  outExtension: { ".js": ".mjs" },
  sourcemap: true,
});
const outputs = entries.map(
  (e) => `artifacts/tools/${e.split("/").pop().replace(/\.ts$/, ".mjs")}`,
);
const result = spawnSync(
  process.execPath,
  [
    ...(task === "test" ? ["--test"] : []),
    ...outputs,
    ...process.argv.slice(3),
  ],
  { stdio: "inherit", env: process.env },
);
process.exitCode = result.status ?? 1;
