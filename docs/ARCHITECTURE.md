# Arquitectura y reglas

## Referencia revisada

Se revisaron `lib/models/academic_models.dart`, el esquema SQLite/repositorio, importación de alumnos, selección de preguntas, versiones, reglas de puntuación, geometría OMR, reconocimiento, workflow de corrección, identidad QR, conflictos, paquetes, PDF institucional/hojas, análisis, reportes, configuración, tema y documentación original.

## Correspondencias

La ampliación 006 incorpora perfiles `teacher/admin`, catálogos privados, biblioteca de imágenes y `save_evaluation`: una transacción guarda las copias de preguntas dentro del examen y solo copia al banco los IDs marcados. Un contador de revisión evita escrituras antiguas sobre la misma evaluación. Cada versión nueva guarda una instantánea del examen y su diseño. El administrador recibe políticas de lectura global y gestión de roles; las escrituras académicas permanecen limitadas al propietario. La creación de cuentas usa una ruta del servidor que comprueba el rol antes de utilizar la clave secreta de Auth. Configuración en `EDITOR_UPGRADE.md`.

| Flutter | Web |
| --- | --- |
| SQLite local | PostgreSQL con `owner_id`, RLS y claves compuestas |
| Hive (preferencias/borrador) | `settings`, evaluaciones y archivo histórico de migración |
| Pantallas por módulo | App Router bajo `/sistema`, componentes cliente con consultas autenticadas |
| VersionQuestion + banco mutable | Copia inmutable de preguntas y claves en `versions` |
| OMR nativo/Isolate | `omr.ts` y `scan.worker.ts`, sin dependencia Flutter |
| QR zxing/mobile_scanner | jsQR sobre píxeles; protocolos CE1 y JSON heredados |
| OCR pp_ocr Windows | Tesseract.js/WASM local opcional; revisión humana |
| PDF widgets Dart | PDF-Lib con fuentes locales, QR y geometría compartida |
| Wi-Fi/paquetes | Persistencia de la misma cuenta en Supabase y conversores de migración |

La aplicación no necesita servidores adicionales de reconocimiento ni servicios de IA de pago. Tesseract descarga motor/modelo de idioma en el navegador; la imagen se procesa localmente. Su precisión difiere del modelo OCR ONNX de Flutter y debe evaluarse con datos representativos. Una transcripción no asigna puntaje semántico automáticamente.

## Reglas portadas

- `manual`: puntaje de cada pregunta. `automatic20`: 20/n. `customTotal`: total/n. Sin redondeo antes del cálculo; presentación a dos decimales.
- Nota: `min(obtenido, máximo) / máximo * escala`. Máximo y escala positivos.
- Aprobado desde **11**, como el original, incluso si se configura una escala diferente. Los resultados pendientes se excluyen de promedios confirmados.
- V/F y relaciones distribuyen puntaje entre subítems con IDs `pregunta#índice`. Claves de opciones se remapean al crear cada versión.
- OMR: A4 595.28 × 841.89 pt; marcadores a 38.5 pt; primera fila y=205; espaciado 24; primera burbuja x=145; separación 55; hasta ocho alternativas; 24 filas/página. Abiertas: cuatro por página, alturas 130, desde y=205.
- Detección por componentes conexos y máscara adaptativa; transformación proyectiva desde cuatro marcadores; oscuridad interior contra fondo; umbral .28 y margen .12. Cuadrícula discordante pasa a revisión y no se completan lecturas inventadas. La reasignación automática entre páginas por conteo de filas del Flutter se sustituyó por QR o selección explícita: evita cambiar de página sin una identidad confirmada.
- QR CE1 o JSON heredado; examen/versión discordantes bloquean el registro. El alumno se confirma explícitamente, sin deducirlo del QR.
- ID o hash SHA-256 repetido: duplicado. Misma versión/alumno/página con hash nuevo: conflicto. Reemplazo transaccional o comparación pendiente; nunca sobrescritura silenciosa.
- Faltantes y duplicados mantienen pendiente. Blanco vale cero y, como en el recálculo original, no exige revisión por sí solo. Múltiple/ambiguo sí. Una revisión manual válida sustituye el puntaje automático y se conserva al releer/reemplazar.
- Adjuntos opcionales dependientes del escaneo; ningún vínculo desde registros académicos hacia Storage que pueda provocar eliminación en cascada.
- Selección automática: reparto predeterminado 30/50/20; si falta una dificultad, se completa con el resto. Se limita el redondeo de la segunda cuota para no producir una cuota negativa cuando n es muy pequeño: corrección explícita del caso límite del servicio Dart.

## Estructura

- `src/app`: rutas, autenticación, proxy de sesión y generación de documentos.
- `src/components`: interfaz responsive; listados paginados, formularios, cámara, revisión y reportes.
- `src/lib/domain.ts`: modelos, validaciones, reglas y geometría compartida.
- `src/lib/omr.ts`: algoritmo independiente de DOM para pruebas y Worker.
- `supabase/migrations`: esquema, políticas, operaciones transaccionales y agregados.
- `scripts`: exportación segura SQLite/Hive/paquetes, planificación, carga sintética y validación.

No hay Realtime. Las listas consultan 25 filas; las exportaciones usan lotes de 500 y límites explícitos. Captura procesa una imagen a la vez; no se ejecuta OMR/OCR en funciones Vercel. Los agregados se calculan en PostgreSQL, no descargando todas las notas al navegador.

## Fuentes oficiales consultadas

- [Next.js App Router y requisitos](https://nextjs.org/docs/app/getting-started/installation).
- [Autorización en cada operación](https://nextjs.org/docs/app/guides/authentication).
- [Sesiones Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs).
- [Políticas de Storage](https://supabase.com/docs/guides/storage/security/access-control).
- [Recuperación de contraseñas](https://supabase.com/docs/guides/auth/passwords).
- [getUserMedia y contexto seguro](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- [jsQR](https://github.com/cozmo/jsQR), [Tesseract.js](https://github.com/naptha/tesseract.js), [PDF-Lib](https://pdf-lib.js.org/docs/api/classes/pdfdocument).
