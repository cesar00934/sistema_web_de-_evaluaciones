# Migración sobre copias

El original no se abre para escritura. La migración remota **no se ha ejecutado**. Primero usa un proyecto/cuenta Supabase de prueba, concilia datos y conserva los originales. Los JSON y las imágenes exportados son información privada: no subir a GitHub.

## SQLite

Con Flutter cerrado, desde `web-next`:

```powershell
python scripts/export_sqlite.py --source "C:/ruta/cramer_eval.sqlite" --output migration-output/sqlite-copy
npm run migrate -- migration-output/sqlite-copy/legacy.json
```

El exportador abre SQLite con `mode=ro`, crea una copia mediante backup y lee exclusivamente esa copia. Compara SHA-256 del origen antes y después, guarda `snapshot.sqlite`, `legacy.json` y `export-audit.json`. Rechaza reutilizar un destino que ya tenga snapshot. Los BLOB se exportan como archivos locales, no como Base64 para PostgreSQL.

El comando `migrate` **sin `--apply` solo planifica localmente** y no conecta con Supabase. Valida preguntas, remapeo de versiones y páginas; informa escaneos sin alumno y páginas fuera de rango. Los errores de preguntas/versiones bloquean la aplicación remota antes de cualquier escritura.

Para cargar una copia en la cuenta de prueba, completa en un archivo local no versionado o en variables de la terminal: URL, clave pública, `MIGRATION_EMAIL`, `MIGRATION_PASSWORD` y `MIGRATION_IMAGE_ROOT`. Este último apunta a una **copia** de las imágenes: conserva rutas relativas o coloca los archivos de rutas absolutas por su nombre original dentro de esa carpeta. No apuntes a carpetas ajenas. Verifica que nombres repetidos no correspondan a imágenes distintas. Se rechazan rutas que salgan de la copia. La aplicación remota es una acción explícita:

```powershell
node --env-file=.env.local scripts/run.mjs migrate migration-output/sqlite-copy/legacy.json --apply
```

Utiliza una cuenta vacía. `--resume` permite continuar la misma importación tras un fallo; no mezcla automáticamente bases distintas. La carga se hace por etapas, no en una transacción global: conserva el informe y la copia si hay errores. No se necesita `service_role`.

Se mantienen IDs de alumnos, preguntas, exámenes, versiones, escaneos válidos y resultados conciliables; las relaciones se reconstruyen. Las respuestas web usan clave compuesta escaneo/pregunta y las revisiones versión/alumno/pregunta; sus IDs originales siguen en `legacy_archive`. Todos los payloads académicos originales, incluidas notas anteriores, se conservan en ese archivo privado antes de normalizar. No se trasladan credenciales de dispositivos ni autorización Wi-Fi antigua.

Las lecturas ausentes se marcan ambiguas; no se fabrican aciertos. Los escaneos sin alumno, páginas inválidas e históricos reemplazados quedan en la cola del informe y archivo histórico, **sin activarse como resultados nuevos**. Requieren conciliación y, cuando corresponda, volver a cargar la foto y asignarla desde Escáner. No hay interfaz que reasigne directamente esos registros archivados. Los originales reemplazados permanecen auditables por ID y contenido.

Después de importar, revisa `artifacts/migration-reconciliation.json`: imágenes faltantes, elementos por conciliar, notas originales y notas recalculadas. Una discrepancia **no se considera una migración terminada**. Revisa y confirma puntajes desde Corrección. Un resultado histórico sin escaneo válido no pasa automáticamente a nota actual; conserva íntegra la nota original en el archivo para resolverla con evidencia.

## Hive y borrador del editor

Hive no es JSON ni una base SQL. Usa un proyecto Dart aislado; no ejecutes `flutter pub get` sobre el proyecto original para este procedimiento.

1. Copia la carpeta Hive a `migration-output/hive-copy`. Renombra la copia del box a su nombre original, por ejemplo `exam_data.hive`.
2. Crea en esa copia un archivo vacío `MIGRATION_COPY_ONLY`. El exportador se niega a abrir una carpeta sin ese marcador.
3. Instala las dependencias del proyecto auxiliar y exporta la copia:

```powershell
dart pub get --directory scripts/hive_export
dart --packages=scripts/hive_export/.dart_tool/package_config.json scripts/export_hive.dart migration-output/hive-copy migration-output/hive-export.json
python scripts/convert_hive.py --hive-json migration-output/hive-export.json --sqlite-json migration-output/sqlite-copy/legacy.json --output migration-output/merged/legacy.json
npm run migrate -- migration-output/merged/legacy.json
```

Si solo dispones de Hive, omite `--sqlite-json`. Se recuperan preguntas del borrador con claves/puntajes, IDs existentes o IDs deterministas cuando faltan, y evaluación borrador si no existe en SQLite. SQLite tiene prioridad cuando ya existe el mismo ID: no sobrescribir versiones emitidas. Se conservan preferencias desconocidas en archivo histórico; los binarios se extraen en `hive-assets`. Copia esos archivos también al directorio de imágenes para cargar logos/fondos. Se importan marco y archivos de decoración disponibles; los presets que solo eran un nombre de recurso Flutter deben seleccionarse de nuevo como imagen en Configuración. Se conserva la preferencia antigua para cotejo; no se afirma equivalencia visual exacta.

La aplicación remota importa nombre institucional, nombre de dispositivo, contactos, encabezados y logos disponibles. El resto del archivo histórico puede consultarse en Configuración. Al instalar Dart, evita que las cachés se confundan con datos del proyecto; `.pub-cache` y `.dart_tool` están excluidos.

## Paquetes `.cramerscan`

Se puede convertir un paquete antiguo usando su catálogo SQLite correspondiente:

```powershell
python scripts/convert_package.py --package "C:/copia/lote.cramerscan" --catalog migration-output/sqlite-copy/legacy.json --output migration-output/package/legacy.json
```

Se validan formato 1, cantidad, rutas seguras, SHA-256, extensiones, hasta 5000 entradas y 500 MB comprimidos/expandidos. Nunca se extraen rutas declaradas arbitrariamente. Conserva la carpeta `package-images` como copia fuente para la carga de adjuntos. El paquete no contiene el catálogo completo ni notas/revisiones: las tomas nuevas necesitarán reconocimiento o revisión después de importarse. No se exportan paquetes nuevos desde la interfaz web.

## Prueba realizada con archivos del repositorio

- Copia SQLite `scans-before-row-validation-20261018-213137.sqlite`: 8 alumnos, 32 preguntas, 1 examen/versión, 2 escaneos, 24 respuestas y 1 resultado; preguntas/versiones planificables. Hay un escaneo sin alumno y uno con página fuera de rango; quedan señalados para conciliación.
- Se verificó SHA-256 sin cambios en el SQLite original.
- Se exportó una copia de `exam_data_before_test_questions.hive`, con dos preguntas de borrador; el hash del original y la copia se mantuvo igual.
- Las rutas de las dos fotos de ese SQLite no corresponden a archivos presentes en este entorno. La prueba no inventó imágenes ni confirmó una carga remota.
- La restauración en Supabase, la conciliación final de notas y la copia real de imágenes quedan pendientes de configurar el destino autorizado y aportar una copia de esos archivos.
