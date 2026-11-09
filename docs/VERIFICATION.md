# Verificación y estado de entrega

Fecha: 5 de noviembre de 2026. Entorno Windows, Node.js 24.15.0, Chrome local. Dependencias fijadas en `package-lock.json`.

## Comprobado

| Comprobación | Resultado y alcance |
| --- | --- |
| `npm run typecheck` | Correcto, TypeScript estricto |
| `npm run lint` | Correcto, sin advertencias |
| `npm run build` | Compilación de producción correcta, App Router; páginas protegidas dinámicas |
| `npm test` | 20 pruebas: reglas académicas, OMR, migración, copias independientes de preguntas, banco explícito, propiedad de imágenes y PDF institucional de una/varias páginas con bloques de subtítulos |
| `npm run test:db` | 20 escenarios PostgreSQL/PGlite: transacciones, RLS, Storage, reproceso, filtros, cuentas con IDs iguales y notas distintas, banco opcional, revisiones, roles y protección del último administrador |
| `npm run test:editor` | Componentes reales en Chrome y SQL local: imágenes, claves F/V, columnas A/B y claves de relación por fila, cambio de cantidad, guardado/recarga, PDF y escritorio/móvil. Escáner: carga antes de datos, miniatura y quitar archivo; cero Workers/commits hasta el botón; después Worker real y commit_scan SQL real guardan un resultado pendiente sin copia de imagen. Transporte REST/Auth/Storage de prueba; no valida Supabase alojado |
| Referencia Flutter | `scripts/flutter-pdf-reference.py` ejecuta directamente los widgets PDF del archivo Dart original con cinco preguntas mixtas y dos bloques. Compara posiciones de preguntas, tamaños de letra y marcos contra la web: diferencia máxima 0,0044 pt en esa muestra |
| Python | 3 pruebas de exportación SQLite, binarios externos, conversión Hive y paquetes/rutas inseguras |
| Chrome escritorio/móvil | Login/configuración, acceso anónimo redirigido, sin errores JavaScript ni desbordamiento horizontal en 1440×1000 y 390×844 |
| Worker real en Chrome | PDF generado → PNG → QR reconoce versión y corrige página manual → OMR confirma cinco filas blancas → JPEG y miniatura. No es una simulación del reconocimiento |
| PDF visual | Muestra A4 mixta de tres páginas renderizada con Poppler e inspeccionada: preguntas, OMR y respuestas escritas, sin superposición en esa muestra |
| Migración local SQLite/Hive | Exportación sobre copia, planificación de relaciones/claves y hashes originales conservados; no se conectó a Supabase |

Las pruebas SQL emulan los contratos `auth.uid()` y las tablas Storage necesarias para ejecutar políticas sobre PostgreSQL. No verifican correos, firma real de JWT, REST/PostgREST ni Storage alojado. El usuario confirmó que el acceso a su Supabase funciona; esta ampliación no ejecutó migraciones remotas ni utilizó sus cuentas para crear datos de prueba.

## Carga sintética local

Una conexión PGlite, 1000 alumnos sintéticos, 200 evaluados, examen de 50 preguntas, 600 páginas de escaneo y **10 000 respuestas**. Procesamiento secuencial:

- Tiempo total de commits: 13.59 s.
- Mediana por página: 21.12 ms; percentil 95: 44.58 ms.
- Consulta paginada de 25 resultados: 0.92 ms.
- Resumen agregado: 105.45 ms.

Resultados en `artifacts/load-local.json`. No incluyen red, Supabase/Vercel, cámara, OCR ni usuarios simultáneos. No deben extrapolarse a capacidad de producción. El script crea datos sintéticos en memoria y no toca un proyecto remoto.

## Reproducir PDF y Worker

`npm test` deja las muestras de prueba en `artifacts/pdf`. Renderiza las tres páginas de `qr-sheet.pdf`:

```powershell
pdftoppm -r 90 -png artifacts/pdf/qr-sheet.pdf artifacts/pdf/preview
```

Con `npm run start` en otra terminal, ejecuta `npm run test:worker`. El script sirve solamente su Worker y la imagen de prueba a Chrome mediante rutas interceptadas de Playwright. El código productivo no incluye endpoints de demostración ni autenticación simulada. `CHROME_PATH` permite elegir otro ejecutable Chromium. `npm run test:ui` usa el mismo navegador.

Con Dart/Flutter y la caché del paquete `pdf` 3.11.3 disponibles, ejecuta `python scripts/flutter-pdf-reference.py` después de `npm test`. Requiere `pdfplumber`. Genera `artifacts/pdf/flutter-reference.pdf` a partir del cuerpo del generador original, sin modificar Flutter, y compara con `layout-web.pdf`. El JSON en `artifacts/flutter-reference/comparison.json` conserva medidas y alcance. Se usan Roboto 12 para enunciados, Roboto 10 para alternativas/VF/títulos de columnas, Roboto 9 para relaciones, Cambria Bold 11 para subtítulos y Cambria 10 para los datos. Los márgenes originales son 25/25/25/5 pt. Los textos extensos de la web se ajustan a su columna para evitar invadir la contigua; el motor Dart puede desbordar algunos de esos textos. Las hojas OMR conservan su pie por debajo de los marcadores.

Para Python: `python -m unittest discover -s tests -p '*_test.py'`. Los temporales permanecen dentro de `artifacts` y los originales del repositorio no se alteran.

## Implementado, pendiente de validación alojada

La persistencia real está conectada mediante Supabase y sus migraciones, sin datos de muestra en las pantallas. La aplicación requiere configurar el proyecto para usar estos flujos. Antes de trabajar con registros reales:

1. Aplicar migraciones y desactivar registro público; crear dos cuentas de prueba.
2. Comprobar login/logout, invitación y recuperación por correo, enlace vencido y contraseña nueva; verificar SMTP y URLs de redirect.
3. Crear datos en la cuenta A y verificar que B no pueda leerlos ni asociar sus IDs desde REST/RPC/Storage; probar también una sesión anónima.
4. Crear una evaluación mixta, descargar original/versión/claves/hojas, imprimir al 100 % y probar fotos desde celular y webcam físicos. Confirmar identidad, página, iluminación, perspectiva, dudas y revisión.
5. Probar varias páginas, reintento del mismo archivo, comparación/reemplazo concurrentes y relectura sin perder rúbricas. Calibrar OMR/OCR con hojas reales; no se midió precisión sobre un corpus representativo ni manuscritos.
6. Eliminar copias y miniaturas seleccionadas, recargar y verificar que alumno/respuestas/revisiones/nota siguen presentes. Probar fallos de red durante carga y borrado.
7. Ejecutar la migración en una cuenta/proyecto de prueba y conciliar cada discrepancia. Las imágenes referidas por el backup SQLite inspeccionado no están disponibles en este entorno.
8. Evaluar elegibilidad Vercel y medir rendimiento alojado antes de aumentar usuarios activos. No se realizó despliegue.

## Diferencias y pendientes funcionales explícitos

- El panel administrativo está implementado con lectura global y gestión de usuarios/roles; requiere aplicar 006 y asignar el primer administrador. Los docentes conservan espacios privados; no se implementa colaboración de edición sobre un banco compartido.
- OCR Tesseract integrado para ejecutarse en el navegador, pendiente de validación práctica con sus descargas de motor/idioma y datos reales. No se afirma que reproduzca la precisión de pp_ocr.
- El PDF institucional reproduce márgenes, marcos, fuentes y encabezados del editor original con sus seis imágenes incluidas. Se inspeccionaron renderizados de una y varias páginas con encabezado de unidad solo desde la segunda. Falta validar impresión física con contenido representativo; no se afirma identidad de cada píxel entre motores PDF.
- Escaneos migrados sin alumno, páginas inválidas, históricos reemplazados y resultados sin evidencia: se archivan y se informan, requieren conciliación; no se dan por convertidos a resultados confirmados.
- El emparejamiento Wi-Fi nativo se sustituye por datos compartidos mediante Supabase para la misma cuenta. No se incluyen Bluetooth, modo sin conexión, exportación web `.cramerscan` o integración SIAGIE.

Estos pendientes impiden afirmar una migración productiva completa o una equivalencia funcional/visual absoluta. El código, la configuración y las verificaciones locales están disponibles para continuar la validación con un destino autorizado.
