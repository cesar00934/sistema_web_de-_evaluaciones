# Revision de dependencias: 9 noviembre 2026

Se sustituyo ExcelJS por read-excel-file 9.3.14 y write-excel-file 4.1.1 para eliminar sus dependencias obsoletas rimraf, inflight, glob, fstream, lodash.isequal y uuid. La importacion conserva codigos con ceros y acentos; la exportacion usa celdas de texto explicitas para evitar formulas no deseadas.

Next.js/plugin Next 16.4.6, ESLint 10.14.0, PGlite 0.5.16, Lucide 1.70.0 y Tesseract 7.0.0. ESLint usa plugins actuales de Next, TypeScript, React y hooks. TypeScript permanece en 6.0.3 porque typescript-eslint 8.72.2 requiere <6.1.0; no se fuerza TypeScript 7 fuera de ese rango.

Overrides limitados a los consumidores de minimatch afectados (ESLint, config-array y typescript-estree) fijan 11.0.5, que incorpora la correccion GHSA-g3hv-75wg-m249. Se verifican mediante lint y pruebas. No se usa npm audit fix --force ni se rebajan versiones para esconder alertas.

vercel.json usa scripts/npm-run.mjs para instalacion y build. Convierte la variable heredada npm_config_cache_dir a la opcion valida npm_config_cache y conserva una cache ya configurada. No suprime advertencias. Ajusta cualquier override manual en el panel Vercel para usar esos comandos.

Comprobaciones: 24 pruebas unitarias, 20 escenarios PostgreSQL/RLS, editor real en navegador, OCR real en espanol, typecheck, lint y build. Las sugerencias nuevas de estilo de React del lint no son vulnerabilidades. npm audit refleja avisos conocidos al consultar el registro; no garantiza ausencia de fallos futuros.

Fuentes: https://docs.npmjs.com/cli/using-npm/config/ ; https://github.com/advisories/GHSA-g3hv-75wg-m249 ; https://github.com/catamphetamine/read-excel-file ; https://github.com/catamphetamine/write-excel-file ; https://typescript-eslint.io/users/dependency-versions/ .
