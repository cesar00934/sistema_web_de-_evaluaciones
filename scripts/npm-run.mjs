import { spawnSync } from "node:child_process";
import { npmEnvironment } from "./npm-environment.mjs";

const args = process.argv.slice(2);
if (!["ci", "run build", "--version"].includes(args.join(" "))) {
  throw Error("Supported commands: ci, run build, --version");
}
const windows = process.platform === "win32";
const result = spawnSync(
  windows ? "cmd.exe" : "npm",
  windows ? ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`] : args,
  {
    env: npmEnvironment(process.env),
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
