# Límites y costos

Documentación consultada el **5 de noviembre de 2026**. Revisa los planes de nuevo antes de desplegar: los proveedores pueden cambiar cuotas y condiciones.

## Supabase Free

La [página de precios](https://supabase.com/pricing) anuncia 500 MB de base, CPU compartida/500 MB RAM, 1 GB de archivos, 5 GB de egreso más 5 GB de egreso cacheado y 50 000 usuarios activos mensuales. Los proyectos gratuitos pueden pausarse tras una semana sin actividad; hasta dos proyectos activos. Estas cuotas no representan usuarios simultáneos garantizados.

Con copias de 300 KB, 1 GB representa aproximadamente 3 300 imágenes antes de descontar miniaturas y banco de preguntas. Es una estimación de almacenamiento, no una prueba de capacidad. La descarga repetida consume egreso. Elimina adjuntos ya revisados desde Corrección y conserva copias de seguridad de los registros académicos. Un plan de pago solo debe contratarse con autorización.

## Vercel Hobby

Hobby permite **uso personal no comercial**, según [sus condiciones de plan](https://vercel.com/docs/plans/hobby). Una plataforma institucional no debe darse por elegible automáticamente, especialmente en una institución privada/comercial. Confirma elegibilidad con Vercel o presupuesta un plan apropiado antes de publicar. No se eligió ni contrató un plan de pago.

La documentación de [funciones](https://vercel.com/docs/functions/limitations) indica, con Fluid Compute, 300 s máximos en Hobby, 2 GB/1 CPU y un límite de 4.5 MB para cuerpos de solicitud y respuestas sin streaming. La aplicación fija 60 s para PDF y reportes. Las evaluaciones y sus vistas previas se sirven por streaming. Las exportaciones de reportes tienen un límite de 4 MB. Las imágenes suben directamente a Supabase Storage; reconocimiento y compresión se ejecutan en el navegador.

La [tabla Hobby](https://vercel.com/docs/plans/hobby) indica 100 GB de transferencia rápida, 10 GB de origen, un millón de invocaciones y 4 horas de CPU activa incluidas. Exceder cuotas puede impedir el uso hasta su renovación; gratuito no significa capacidad ilimitada.

## Crecimiento

No se afirma soporte para cientos/miles de personas activas simultáneamente. La evidencia local está en `VERIFICATION.md`. Antes de abrir a más docentes, mide latencia y errores de consultas/RPC, egress, ocupación de Storage, generación de PDF, dispositivos de baja memoria y rendimiento de filtros/agregados con datos propios.

Si aumentan los volúmenes, evalúa índices de búsqueda de texto, exportación asíncrona para documentos grandes y retención/backups institucionales. Son decisiones posteriores basadas en medición; no se han contratado ni añadido servicios adicionales. Las cuentas compartidas entre docentes no son una solución de escalamiento ni de permisos.
