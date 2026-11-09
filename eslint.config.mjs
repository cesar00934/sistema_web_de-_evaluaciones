import { defineConfig, globalIgnores } from "eslint/config";
import next from "@next/eslint-plugin-next";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import react from "@eslint-react/eslint-plugin";
export default defineConfig([
  globalIgnores([".next/**", "artifacts/**", "migration-output/**"]),
  { files: ["**/*.{ts,tsx}"], extends: [ts.configs.recommended] },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    extends: [next.configs["core-web-vitals"]],
  },
  {
    files: ["**/*.{tsx,jsx}"],
    extends: [
      hooks.configs.flat.recommended,
      react.configs["recommended-typescript"],
    ],
  },
  { rules: { "@next/next/no-img-element": "off" } },
]);
