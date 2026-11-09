# Activar editor completo y administrador

Para tu proyecto que ya funciona: aplica solamente `supabase/migrations/006_editor_and_roles.sql` en Supabase → SQL Editor → New query → Run. Ejecuta el archivo completo una vez. No repitas las migraciones 001–005. La migración conserva alumnos, banco, evaluaciones, versiones y notas; crea catálogos privados, imágenes reutilizables y perfiles.

## Primera cuenta administradora

En SQL Editor, reemplaza el correo por el de tu cuenta existente:

```sql
update public.profiles set role = 'admin' where email = 'tu-correo@ejemplo.com';
select email, role from public.profiles where email = 'tu-correo@ejemplo.com';
```

Debe aparecer una fila con `admin`. Recarga la web o vuelve a iniciar sesión. Verás **Administración**, donde puedes consultar usuarios, cambiar roles y ver las calificaciones de todos los docentes o de uno seleccionado. Se protege al último administrador para no dejar el sistema sin acceso administrativo. Las nuevas cuentas son docentes; nunca reciben el rol desde metadatos editables del usuario.

Para **crear o invitar usuarios desde la web**, añade en `web-next/.env.local`:

```dotenv
SUPABASE_SECRET_KEY=tu_clave_secreta_del_proyecto
```

Usa la clave secreta de tu proyecto Supabase. Esta variable la utiliza únicamente la ruta de servidor que primero verifica sesión y rol administrador. No uses un prefijo `NEXT_PUBLIC_` para ella y no la compartas por chat. Reinicia `npm run dev`. En producción configura la variable privada en el servidor. Las operaciones administrativas de Auth necesitan una clave secreta del servidor, según la [documentación oficial de Supabase](https://supabase.com/docs/reference/javascript/admin-api).

La clave no es necesaria para consultar el panel o para el trabajo habitual del docente. Sin ella, también puedes seguir creando cuentas desde Supabase → Authentication → Users. Mantén desactivado el registro público. Para invitaciones por correo configura SMTP y la plantilla Invite user explicada en el README, además de las URLs permitidas de tu dominio.

## Editor y guardado

1. En **Evaluaciones → Nueva evaluación**, completa título, nivel, grado, sección, área, subárea, bimestre, unidad, docente y fecha.
2. Los campos de catálogo permiten seleccionar una opción existente o escribir otra. **Guardar opción** la conserva inmediatamente. Al guardar una evaluación también se conservan sus valores y los temas/competencias de las preguntas.
3. Selecciona el encabezado de la **primera página** y, por separado, el encabezado **desde la segunda página**. Están incluidos los dos encabezados y las imágenes de proceso, unidad y Practicramer de Flutter. **Nueva imagen y guardar** sube una imagen a tu biblioteca privada para futuras evaluaciones.
4. Elige marco curvo, lineal, punteado o sin marco; fondo central y marca de agua. Puedes editar indicaciones, etiqueta/dato del alumno, correo, teléfono, Facebook/web y numeración del pie. Deja vacío un contacto para omitirlo. Puedes desactivar el pie completo.
5. **Crear pregunta aquí** permite alternativas, V/F, relacionar y respuesta abierta, con imagen, claves, puntaje, subtítulo, dificultad, área, subárea, tema y competencia. **Usar en esta evaluación** incorpora la pregunta al borrador.
6. **Guardar evaluación y preguntas** persiste todo de forma atómica. Solo las preguntas con **Guardar también en mi banco** se añaden o actualizan en el banco. Desmarcar esta casilla no borra una pregunta que ya estaba allí. Editar una copia dentro de la evaluación no cambia el banco si no marcas la casilla.
7. **Vista previa PDF** muestra el formato actual sin crear una versión. Para fijar preguntas, claves y diseño, guarda y usa **Versiones y PDF → Crear versión**. Las versiones nuevas conservan el diseño y sus preguntas aunque después edites la evaluación.

El indicador distingue **Cambios sin guardar** de un guardado confirmado. Si otra pestaña guarda la misma evaluación antes, se rechaza la revisión antigua para evitar sobrescribirla. La web necesita conexión; los borradores sin guardar no sobreviven a cerrar la página.

## Diseño PDF

Se usan A4, márgenes, imágenes institucionales y fuentes Cambria/Roboto del original. Los metadatos van en tres columnas, el alumno en su marco y las preguntas dentro del marco verde. La primera cabecera se muestra solamente en la primera hoja; la de unidad/proceso/Practicramer, solamente en las siguientes. El pie incluye línea verde, contactos y `Página {pagina} de {total}`; no añade avisos de alternativas, versión ni conteo de preguntas.

Las hojas OMR conservan sus marcadores, QR y coordenadas de reconocimiento; su identificación de versión pertenece al encabezado de esa hoja. Imprime al 100 % para escanear. Las versiones antiguas sin instantánea mantienen compatibilidad y toman el formato disponible de su evaluación.

Cada docente conserva su propio banco, evaluaciones, biblioteca, alumnos y notas mediante RLS. El administrador puede leer datos académicos de todas las cuentas desde su panel; su trabajo normal en alumnos/evaluaciones/resultados sigue mostrando su propia cuenta. La lectura administrativa no permite modificar notas o alumnos ajenos.

## Verificación realizada

20 pruebas unitarias/PDF; 20 escenarios SQL con PGlite; editor real en Chrome con imágenes, claves V/F, banco opcional, catálogos tras recarga y PDF. Comparación de posiciones, fuentes y marcos contra el motor PDF original de Flutter, además de inspección visual de una y varias páginas. Las pruebas locales usan datos sintéticos y no modifican tu Supabase.

Falta ejecutar esta migración en tu proyecto y comprobar allí acceso, subida/recuperación de imágenes e invitaciones. No se crearon usuarios ni se enviaron correos reales durante estas comprobaciones. El detalle reproducible está en `docs/VERIFICATION.md`.
