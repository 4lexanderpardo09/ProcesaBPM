# ProcesaBPM

SaaS multi-tenant de gestión de procesos (BPM ligero). Las empresas dibujan sus
propios flujos de trabajo con aprobaciones, formularios dinámicos y SLA, y cada
solicitud los recorre de principio a fin: se asigna, se aprueba, genera
documentos PDF, avisa por correo y queda medida en reportes.

Nace de extraer la lógica del sistema de gestión (mesa de ayuda) de
Electrocréditos del Cauca (`~/dev/mesa-de-ayuda`), sin los módulos de viáticos,
ventas ni listas de precios. Electrocréditos **no** se migra; sigue con su versión.

En producción: la app en **app.procesabpm.com** y el sitio público en
**procesabpm.com**.

---

## Modelo multi-tenant

Una sola base de datos PostgreSQL compartida, aislada por `tenant_id` con
Row-Level Security (RLS) forzado: cada organización solo ve lo suyo. Dentro de un
tenant pueden convivir **varias empresas**, cada una con su propia jerarquía,
horario laboral y configuración. La consola de plataforma es el único lugar que
cruza tenants, y lo hace con un rol aparte y auditado.

## Qué hace

### Flujos de trabajo (constructor visual)
- Lienzo tipo diagrama (React Flow) donde se arman los flujos con bloques y
  transiciones: pasos de formulario, de aprobación, de cálculo, de asignación,
  de espera y de cierre.
- Versionado: un flujo se edita como **borrador** y se **publica**; las
  solicitudes en curso siguen con la versión con la que empezaron.
- **Asistente de IA**: se describe el proceso en lenguaje natural y la IA arma el
  flujo en el lienzo, listo para ajustar y publicar.

### Formularios dinámicos
- Campos configurables por flujo (texto, número, fecha, selección, tablas,
  archivos, dinero con decimales exactos).
- **Datasets**: hojas de cálculo cargadas como fuente de valores de un campo
  (listas que la empresa mantiene).
- **Calculadoras** integradas que el tenant enciende y parametriza (p. ej.
  viáticos), para calcular montos dentro del formulario.

### Solicitudes (tickets)
- Cada solicitud recorre el flujo publicado: avanza entre pasos, se asigna, se
  aprueba, se devuelve, se resuelve y se cierra.
- **Asignación automática** (reparto aleatorio entre los habilitados de un paso)
  o manual.
- Etiquetas personales, comentarios, adjuntos y una bitácora por solicitud.

### Aprobaciones
- Grupos de aprobadores por tipo de flujo y por empresa; un paso de aprobación
  espera la decisión de quien corresponde.

### SLA (tiempos de atención)
- Reloj por solicitud según el **horario laboral de cada empresa** (horas o días
  hábiles).
- Avisos al 80 % del tiempo y alertas cuando un reloj se pasa de la fecha límite.

### Documentos PDF
- Genera documentos a partir de los datos de la solicitud (formatos definidos por
  la empresa) para descargar o adjuntar.

### Notificaciones
- Dentro de la app y por **correo**, con preferencias por persona y por tipo de
  aviso.
- El administrador fija una **política de correo por organización** y por tipo
  (nunca / solo a quien lo pida / salvo que la persona lo rechace); el worker la
  respeta al enviar.
- Correos con el diseño de la marca (sin imágenes externas, compatibles con
  todos los buzones).

### Correo saliente (robusto)
- Envío por Amazon SES desde `notificaciones@procesabpm.com`.
- **Rebotes y quejas**: SES los reporta vía SNS (firma verificada) y la dirección
  queda suprimida; el worker deja de escribirle para cuidar la reputación de
  envío. La consola lista las direcciones suprimidas y permite liberarlas.
- Las direcciones de prueba (`.test`, `.invalid`, `.example`) nunca van al
  proveedor real.

### Archivos
- Subida y descarga con URLs prefirmadas a almacenamiento S3-compatible (MinIO en
  desarrollo); limpieza de subidas abandonadas.

### Reportes y tablero
- Tablero del miembro con contadores y sus solicitudes pendientes.
- Reportes de desempeño y **exportación de datos** a archivo.

### Consola de plataforma
- Administración del producto por encima de los tenants: organizaciones, planes,
  **solicitudes de demo** del sitio público (con filtros y seguimiento),
  **direcciones de correo suprimidas**, anuncios y banner de inicio de sesión.
- **Acceso de soporte**: un administrador del tenant concede acceso de solo
  lectura por tiempo limitado (hasta 72 h), con historial.

### Ciclo de vida de los datos
- **Retención**: borrado nocturno de lo que pasó su ventana de conservación.
- **Purga de tenant**: al eliminar una organización se avisa al dueño, y luego se
  vacían su almacenamiento y sus datos (suspender y purgar a los 30 días).
- **Auditoría**: las acciones sensibles quedan registradas.

### Cuentas y seguridad
- Autenticación con JWT, **MFA**, enlaces de un solo uso para contraseña y avisos
  de seguridad por correo.
- Autorización centralizada con CASL (mismas reglas para la API y el tiempo real);
  nunca chequeos de rol sueltos.
- **Tiempo real** por WebSocket (cambios de solicitudes), con verificación de
  origen y token.

### Sitio público (landing)
- Página de inicio, blog, páginas legales (privacidad, términos), formulario de
  **solicitud de demo**, banner de cookies y SEO (sitemap, robots, `llms.txt`).

---

## Arquitectura

Monorepo con pnpm:

- `apps/api` — NestJS. Expone la API y, con el **mismo código**, corre un
  **worker** en segundo plano (cola BullMQ sobre Redis) para correos, SLA,
  asignación, limpieza, retención y purga. Capas por módulo:
  controller → service → repositorio, con la autorización en guards CASL.
- `apps/web` — React + Vite. La aplicación (app.procesabpm.com): flujos,
  solicitudes, personas, reportes, ajustes, perfil y la consola de plataforma.
- `apps/landing` — Astro. El sitio público (procesabpm.com), estático.
- `packages/db` — Prisma + PostgreSQL: esquema, migraciones, roles y RLS.
- `packages/shared` — contratos y lógica compartida entre la API y el front
  (esquemas, rutas, tipos).

Infra en producción: EC2 con Docker Compose (postgres, api, worker, web,
landing), Caddy como proxy inverso con TLS, Amazon SES para el correo y un bucket
S3 para archivos y respaldos.

## Operación

- Despliegue: construir las imágenes, `up -d` (corre migraciones y siembra) y
  luego `deploy/verify.sh`, que hace una **prueba de humo** real contra la API
  (administrador con MFA, organización, invitación por correo, flujo publicado,
  solicitud avanzada y cerrada, archivo con URL prefirmada, tiempo real) y revisa
  la web, el respaldo y el disco.
- **Respaldos**: respaldo nocturno de la base a S3 (ver
  [docs/operations/backups.md](docs/operations/backups.md)).
- Rebotes de correo: ver [docs/operations/email-bounces.md](docs/operations/email-bounces.md).

## Stack

NestJS + Prisma + PostgreSQL (una BD compartida con `tenant_id` + RLS) · React +
Vite + React Flow · Redis (colas BullMQ) · almacenamiento S3-compatible (MinIO en
desarrollo, S3 en producción) · Astro (landing) · Docker.

## Documentos

- [docs/analisis.md](docs/analisis.md): análisis del sistema original y diseño
  propuesto (multi-tenant, archivos, SLA, aprobadores, despliegue, constructor de
  flujos).
- [docs/base-de-datos.md](docs/base-de-datos.md): **referencia de la BD**: modelo,
  aislamiento, reglas de integridad, contrato para la API, pruebas y despliegue.
- [docs/arquitectura.md](docs/arquitectura.md): organización de carpetas del back,
  el front y el código compartido.
- [docs/despliegue.md](docs/despliegue.md): imágenes Docker, variables de entorno,
  roles de BD, orden de arranque, migraciones y escalado.
- [docs/operations/backups.md](docs/operations/backups.md): respaldos a S3.
- [docs/operations/email-bounces.md](docs/operations/email-bounces.md): rebotes y
  quejas de SES.
- [docs/pendientes.md](docs/pendientes.md): qué falta y el alcance de v1/v2.
