# Desplegar en Vercel

Este repositorio contiene la web directamente en su raiz: selecciona Root Directory `.`; no agregues otra carpeta `web-next`.

1. En Vercel, importa `cesar00934/sistema_web_de-_evaluaciones` y selecciona la rama `main`.
2. Framework: Next.js. Node.js: 24.x. Install Command: `npm ci`. Build Command: `npm run build`. Output Directory: valor automatico de Next.js. `vercel.json` ya configura framework, instalacion y build.
3. Antes de desplegar, configura estas variables en Vercel:

| Variable | Valor |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | URL de tu proyecto Supabase |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Clave publica de ese proyecto |
| NEXT_PUBLIC_SITE_URL | URL HTTPS de la web en Vercel |
| SUPABASE_SECRET_KEY | Clave secreta, solamente servidor; necesaria para crear/invitar usuarios desde Administracion |

Las dos primeras variables publicas se incorporan al build. Si cambian, haz un redeploy. No copies claves secretas a variables NEXT_PUBLIC_. `.env.local`, copias de datos, imagenes subidas y resultados de pruebas estan excluidos del repositorio. El archivo `.env.example` contiene solamente marcadores de ejemplo.

4. En Supabase, usa el esquema de `supabase/migrations`. Si el proyecto ya funciona con 001-006, no vuelvas a ejecutarlas. Si solo faltaba la ampliacion de editor/roles, sigue `docs/EDITOR_UPGRADE.md`. Las migraciones no se ejecutan automaticamente durante el build.
5. En Supabase > Authentication > URL Configuration, configura Site URL con el dominio HTTPS de produccion y permite exactamente:
   - https://TU_DOMINIO/auth/callback
   - https://TU_DOMINIO/auth/confirm
   - https://TU_DOMINIO/auth/password
   Conserva las URLs locales si seguiras desarrollando. Configura las plantillas de invitacion/recuperacion del README y el SMTP si usaras correo.
6. Mantener desactivado el registro publico y los buckets questions/scans privados. Los roles de acceso se gestionan segun `docs/EDITOR_UPGRADE.md`.
7. Ejecuta Deploy. Despues comprueba acceso, PDF institucional, carga de imagenes, camara HTTPS y lectura de escaneos. Usa dos cuentas de prueba para comprobar el aislamiento de datos.

Las fuentes y cabeceras se incluyen explicitamente en las funciones PDF mediante outputFileTracingIncludes; no dependen de archivos presentes solo en la computadora de desarrollo. Los escaneos y adjuntos van a Supabase Storage, nunca al disco de Vercel.

Referencias oficiales: https://vercel.com/docs/functions/runtimes/node-js/node-js-versions y https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions .

Esta preparacion no crea un proyecto en Vercel ni despliega automaticamente por si sola. Vercel debe tener acceso al repositorio y las variables deben configurarse en su proyecto. Si conectas el repositorio a Vercel, los siguientes pushes a main pueden activar despliegues automaticos.
