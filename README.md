# CRAMER EVAL · Web

Aplicación Next.js 16.4.6, React, TypeScript y Supabase. Toda la implementación está en esta carpeta; el código Flutter se conserva. No usa datos simulados en la aplicación. Sin configurar Supabase, muestra instrucciones de configuración y bloquea el sistema.

## Puesta en marcha

1. Instala Node.js 24 LTS. En esta carpeta ejecuta `npm ci`.
2. Crea un proyecto Supabase de prueba. En SQL Editor ejecuta, en orden, los seis archivos de `supabase/migrations/`. Si ya usas la web, aplica solamente la nueva migración 006 según [esta guía](docs/EDITOR_UPGRADE.md).
3. Copia `.env.example` a `.env.local`. Completa `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `NEXT_PUBLIC_SITE_URL`. La clave publishable es pública; RLS controla los datos. Nunca pongas `service_role` en variables `NEXT_PUBLIC_*`.
4. En Supabase → Authentication → Providers → Email, **desactiva Allow new users to sign up**. Esta configuración es obligatoria: ocultar un formulario no desactiva el registro en el proveedor.
5. En Authentication → URL Configuration configura Site URL y las URLs permitidas, incluyendo `http://localhost:3000/auth/callback` y tu dominio HTTPS de producción. Usa dominios exactos para producción.
6. Crea el primer usuario desde Authentication → Users → Add user → Create user, con correo confirmado y una contraseña segura. También puedes invitarlo con las plantillas indicadas abajo. No existe una contraseña predeterminada.
7. Ejecuta `npm run dev`. Abre `http://localhost:3000` e inicia sesión.

Cada cuenta tiene un espacio privado. Los docentes del catálogo son datos académicos, no cuentas de acceso. El rol `admin` permite consultar usuarios y resultados de todas las cuentas desde **Administración**; los docentes solo ven sus propios datos. Para activar el primer administrador y habilitar creación de usuarios desde la web, sigue [la guía del editor y roles](docs/EDITOR_UPGRADE.md). La clave secreta opcional se usa exclusivamente en el servidor para crear/invitar usuarios.

## Invitación y recuperación

El login incluye recuperación y cierre de sesión. Para invitaciones desde el panel, configura la plantilla **Invite user** con un enlace:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Activar mi cuenta</a>
```

Para **Reset password** usa:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Restablecer contraseña</a>
```

La ruta verifica el token y abre la pantalla para establecer contraseña. También se soporta el intercambio PKCE en `/auth/callback`. Configura SMTP para correos a destinatarios reales: el servicio de correo de desarrollo de Supabase tiene restricciones y límites; no se ha contratado ningún proveedor. Prueba recepción, caducidad y uso único de los enlaces en tu proyecto.

## Uso

- **Alumnos:** alta, edición, estado activo, búsqueda y paginación. Importa CSV UTF-8 o XLSX con vista previa; columnas nombres, apellidos, nivel, grado, sección y código opcional. Genera el mismo código SHA-256 del original cuando falta. Ignora registros existentes por código; no los sobrescribe con la importación.
- **Docentes y cursos:** catálogo persistente y relaciones; área y subárea de curso.
- **Banco:** opciones múltiples, V/F, relacionar y respuestas abiertas; claves, puntaje, competencia, tema, dificultad, subtítulo e imagen privada. Relacionar tiene cantidad de elementos, campos individuales para las columnas A/B y un selector de letra correcta por fila. Archivar conserva el historial.
- **Evaluaciones:** creación de preguntas dentro de la evaluación y copia opcional al banco; selección manual o automática 30/50/20; tres modos de puntaje, metadatos y catálogos persistentes. Encabezados de primera/siguientes páginas y biblioteca privada de imágenes, marcos, fondo, alumno y contactos editables. Guardado atómico con comprobación de revisiones. Las versiones fijan preguntas, claves, escala y formato institucional.
- **PDF:** original, original con QR, con hoja añadida, con QR y hoja añadida; hoja separada y claves independientes. Una o dos columnas. Hojas A4 con las coordenadas originales, 24 filas objetivas por página y cuatro respuestas escritas por página. Incluye nombre institucional, logos opcionales, docente, grupo, periodo, unidad, fecha y contacto. Configuración permite marcos rectos/curvos, imagen central de fondo y marca de agua al pie. El diseño se recompuso en PDF-Lib; no se afirma equivalencia visual píxel a píxel con el editor Flutter. Los títulos desmesurados o enunciados escritos que no caben en dos líneas producen un error explícito para evitar texto recortado.
- **Escáner:** carga o captura imágenes antes de elegir alumno/versión, con vista previa y opción de quitar archivos. **Escanear y guardar** inicia el reconocimiento y guardado solamente después de confirmar esos datos. Cada lote pertenece al mismo alumno; cámara HTTPS/localhost, hasta 50 imágenes, progreso de subida y error por archivo. El QR identifica examen/versión/página, no al alumno. OMR en Web Worker y OCR local opcional; las respuestas abiertas requieren evaluación docente.
- **Corrección:** compara la respuesta detectada, la clave y el puntaje automático de cada pregunta. Abre la evidencia para confirmar una opción o asignar un puntaje parcial con observación. Guardar recalcula la nota y las revisiones docentes se conservan al reprocesar. La relectura usa la copia comprimida de la hoja.
- **Resultados y reportes:** paginación, filtros de área, bimestre, grupo, alumno, versión y fecha original del escaneo; perfil por alumno, promedios confirmados, distribución y refuerzo por tema con puntajes revisados. Exportaciones CSV/XLSX/PDF bajo los mismos filtros, hasta 10 000 filas y 4 MB. CSV protege celdas de fórmulas. No es una integración oficial con SIAGIE.
- **Imágenes:** se guardan **después** de persistir respuestas/notas. El reconocimiento recibe el archivo original; posteriormente se crea JPEG legible y miniatura. Ningún original se guarda permanentemente por defecto. La copia no es una condición para conservar la nota. Se pueden seleccionar y borrar adjuntos con sus miniaturas, sin eliminar registros académicos. No hay borrado de alumnos, exámenes o notas en cascada desde archivos.
- **Configuración y migración:** identidad institucional, dispositivo y consulta privada de registros históricos importados.

El flujo multi dispositivo utiliza Supabase con la misma cuenta. Sustituye el receptor Wi-Fi y emparejamiento local, que no pueden trasladarse directamente al navegador. La aplicación necesita conexión para iniciar sesión, consultar evidencias y guardar. Hay un conversor de paquetes `.cramerscan` antiguos para la migración.

### Lectura de escritura a mano

Activa el lector opcional al escanear o ejecútalo desde una hoja guardada en Corrección. El navegador recorta las líneas de cada respuesta abierta y las transcribe en un Web Worker con TrOCR y WebAssembly. La primera lectura descarga aproximadamente 70 MB de archivos del modelo, más el motor. La inferencia puede reutilizar esos archivos si el navegador conserva su caché. Los recortes y las claves se mantienen fuera de las solicitudes al proveedor del modelo.

El modelo [Xenova/trocr-small-handwritten](https://huggingface.co/Xenova/trocr-small-handwritten/tree/9ef961fec33b56615026fbe77b9da68d6237cddb) tiene licencia MIT y se usa en la revisión enlazada con pesos de 8 bits. [TrOCR](https://huggingface.co/microsoft/trocr-small-handwritten) fue ajustado con el corpus IAM de escritura en inglés y lee una línea a la vez. La prueba en Chrome cubre una muestra manuscrita en inglés y una segunda inferencia con la red desactivada. La exactitud en exámenes en español, números y fórmulas requiere validación con muestras representativas. El docente contrasta la propuesta con la hoja y asigna el puntaje.

## Seguridad y almacenamiento

Todas las tablas llevan `owner_id`; claves foráneas compuestas evitan relaciones entre cuentas. RLS se aplica en tablas y objetos Storage. Los buckets `scans` y `questions` son privados, con límite de 8 MB y MIME JPG/PNG/WebP. Las rutas empiezan por el UUID autenticado. Lecturas sensibles usan enlaces de cinco minutos. La base guarda rutas y metadatos, sin imágenes Base64.

Las notas se recalculan en funciones PostgreSQL que validan al usuario y solo operan sobre sus registros. `results`, `answers`, `manual_grades` y `scans` no permiten escritura directa desde el cliente. Las versiones no tienen políticas de actualización ni borrado. Las operaciones de corrección usan transacciones y bloqueo por alumno/versión. Eliminar un objeto nunca ejecuta borrado sobre registros académicos. Las imágenes referenciadas por preguntas, versiones o logos institucionales no se pueden eliminar desde Storage por la cuenta normal.

Mantén abierta la pantalla del escáner hasta que termine el lote. Si falla Storage, la nota permanece guardada y se ofrece reintento del adjunto. No existe una cola persistente de archivos originales tras cerrar la pestaña. Las miniaturas son copias pequeñas; la imagen completa solo se solicita cuando se necesita revisión.

## Despliegue en Vercel

No se publicó el proyecto ni se contrató ningún servicio.

1. Revisa primero la elegibilidad del plan, abajo. Sube el código a un repositorio privado de GitHub, excluyendo `.env.local`, `artifacts`, `migration-output`, cachés y datos académicos. Los archivos subidos por usuarios van a Storage.
2. Importa el repositorio en Vercel y elige **Root Directory: `.` (raiz del repositorio)**, framework Next.js. Instalación `node scripts/npm-run.mjs ci`, build `node scripts/npm-run.mjs run build`, Node.js 24.x.
3. Configura las tres variables de `.env.example` para el entorno correspondiente. Las variables `NEXT_PUBLIC_*` se fijan durante el build: reconstruye si cambian. Usa un Supabase de prueba para Preview, separado de producción.
4. Aplica las migraciones al proyecto correcto, crea usuarios y configura URLs/plantillas de correo. Comprueba RLS con dos cuentas antes de cargar datos reales.
5. Solo después de tu autorización realiza el despliegue. Prueba cámara en HTTPS, login, recuperación y PDFs desde celular y PC.

El manifiesto, iconos 192/512 y `display: standalone` permiten instalar o agregar a inicio cuando el navegador lo soporte. No se instala un service worker que cachee datos académicos. Sigue siendo una aplicación conectada.

## Comprobaciones

```powershell
npm run typecheck
npm run lint
npm test
npm run test:db
npm run test:editor
npm run build
npm run load
# Prueba de TrOCR en Chrome con descarga inicial y reutilización sin red
node scripts/run.mjs handwriting-smoke
# Con npm run start ejecutándose y Chrome instalado:
npm run test:ui
# Tras generar/renderizar la muestra PDF según docs/VERIFICATION.md:
npm run test:worker
```

`test:db` usa PostgreSQL mediante PGlite con contratos locales de Auth/Storage; **no es un Supabase alojado**. `test:ui` sin credenciales comprueba login, diseño adaptable y redirecciones; no simula un usuario autenticado. Lee [la verificación y sus límites](docs/VERIFICATION.md), [migración](docs/MIGRATION.md), [arquitectura](docs/ARCHITECTURE.md) y [costos](docs/COSTS.md).

Dependencias y compatibilidad: [revision de seguridad](docs/DEPENDENCY_SECURITY.md).

El PDF institucional conserva los bloques y filas de dos columnas de Flutter. Cuando un bloque ocupa varias hojas, primero se asigna a cada hoja una secuencia consecutiva y despues se divide en columnas (izquierda de arriba abajo, seguida de derecha). Una pregunta extensa continua antes de empezar la siguiente; los subtitulos se mantienen con la primera pregunta cuando cabe completa.

El escaner lee el QR al preparar cada imagen y obtiene su version y pagina sin seleccionar una version manualmente. Cada QR se verifica contra las versiones accesibles de la cuenta y su examen. Se admiten varias versiones en el mismo lote para el alumno confirmado. Si no hay QR legible se muestra el selector manual; un QR de otra cuenta/examen o una pagina invalida bloquea el lote hasta quitar o corregir esa imagen. Esta preparacion no reconoce respuestas ni guarda notas: eso comienza al pulsar Escanear y guardar. Para deteccion automatica usa la hoja de respuestas o un PDF generado con QR.
