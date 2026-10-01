# ProcesaBPM: pendientes y alcance propuesto

Actualizado: 2026-09-30. Las decisiones tomadas están en [analisis.md §0.1](analisis.md).

## 0. Hecho
- **Base de datos completa** (2026-09-30): 89 tablas, RLS en 82, 252 FK compuestas e indexadas, 59 CHECK, 34 triggers de reglas de negocio, funciones de autenticación y retención, semilla del catálogo (planes aprobados, permisos, festivos) y **109 pruebas en verde**. La revisión de integridad ([revision-bd.md](revision-bd.md)) está aplicada completa. Referencia: [base-de-datos.md](base-de-datos.md).
- Decisiones tomadas por defecto, que falta confirmar con el negocio: aprobadores distintos por empresa, regla de autoaprobación y reapertura como visita nueva (base-de-datos.md §13.2).

- **Base de `apps/api`** (2026-10-01): NestJS 11 con entradas HTTP y worker, configuración validada con zod, acceso a datos por tenant (`TenantContext` + `TenantTransactionRunner`, cliente de plataforma aparte, `omit` de columnas sensibles de `users`), filtro global de errores (SQLSTATE → HTTP), logger JSON con `tenant_id` y `request_id`, `/health` y `/ready`, y la prueba de concepto de #30374. Sin auth, módulos de negocio ni frontend todavía.
- Decisiones tomadas por defecto en `apps/api`, que falta confirmar: las cinco variables de entorno son obligatorias (sin valores por defecto); mapeo HTTP de §8.5: 23001 → 409, 23514 → 422, 23503 → 422, 23505 → 409, 23P01 → 409, 42501 → 403; los mensajes de la BD nunca se devuelven al cliente (solo el código); un contexto de tenant ausente o no confirmado responde 500 genérico.
- **`packages/shared`, primera parte** (2026-09-30): `engine/business-time` (vencimiento en horas o días hábiles y minutos hábiles, con calendario, franjas, festivos, zona horaria y pausas), `engine/conditions` (condiciones AND de transiciones) y `errors` (errores tipados + mapeo de SQLSTATE), con 130 pruebas unitarias.
- **Reglas de `shared` decididas** (2026-09-30):
  - Días de la semana `0 = domingo … 6 = sábado` en `calendar_working_hours.weekday`.
  - SLA en días hábiles: el día de inicio es el día 0 y vence al final de la jornada del N-ésimo día hábil siguiente; un inicio fuera de horario arranca en la siguiente franja.
  - Las pausas corren el vencimiento en minutos hábiles exactos (en días hábiles, el vencimiento deja de caer al final de la jornada).
  - Condiciones: un campo vacío o ausente solo cumple `not_equals`; textos sin distinguir mayúsculas ni espacios; números escritos como texto se comparan como números; `YYYY-MM-DD` se compara por día y fecha con hora por instante.
  - `mapDatabaseError` queda como está (lee `code`, `cause` y `meta.code`); se ajusta en la prueba de concepto de Prisma (§1.3). zod se agrega al crear `contracts/`.

## 1. Para poder empezar a construir

### 1.1 Alcance de la primera versión (MVP): **por definir juntos**
Propuesta base para discutir:

**v1**
- Clientes (tenants), empresas, usuarios con membresía en varios tenants, roles base y personalizados, grupos de aprobación (por tipo, multinivel) y sedes.
- Constructor de flujos visual (React Flow) con los bloques principales: inicio, paso de trabajo, aprobación, condición, decisión, tope de monto y fin. Versiones borrador/publicado y validación antes de publicar.
- Tickets de principio a fin: crear, avanzar, novedad (pausa el SLA), cerrar y reabrir; comentarios, adjuntos y etiquetas.
- Campos dinámicos (incluido el campo tabla y las fórmulas).
- SLA en horas o días hábiles con calendario por empresa y reloj por paso.
- Archivos con cuota por plan (4 MB por archivo, 15 archivos y 20 MB por envío).
- PDF con el diseñador de formatos.
- Notificaciones in-app y por correo; reportes básicos (SLA del responsable y del paso, reprocesos).
- Vista de ejecución del flujo en cada ticket.

**v2**
- PDF subido + coordenadas y PDF con campos de formulario (AcroForm).
- Planos (exportaciones programadas).
- Webhooks e integraciones.
- Simulador de flujos.
- Calculadoras integradas (alimentación, saldo de viáticos).
- Procesamiento en lote y despacho aleatorio.
- SSO con Google/Microsoft, dominio propio por cliente, portal para usuarios externos.

### 1.2 Estructura del proyecto: **en uso, falta confirmar**
Ya se creó la raíz del monorepo (`package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`) y `packages/db`, porque la BD lo necesitaba. Si prefieres otra estructura, se mueve sin problema.
- Monorepo con pnpm workspaces + Turborepo: `apps/api` (NestJS + Prisma), `apps/web` (React + Vite + React Flow), `packages/shared` (tipos, esquemas zod, motor de SLA y fórmulas compartidos).
- CI con GitHub Actions: lint, typecheck, tests (incluido el **test de fuga entre tenants**) y build de imágenes Docker en cada PR.
- `docker-compose` de desarrollo: PostgreSQL 18, MinIO, Redis y Mailpit.

### 1.3 Verificación técnica antes de escribir código
- [x] Issue de Prisma [#30374](https://github.com/prisma/orm/issues/30374): **no se reproduce en 7.10.0** (2026-10-01); se fija la versión exacta 7.10.0, la prueba de concepto queda en el CI y el runner de transacciones verifica el contexto fijado. Detalle y regla para subir de versión en [base-de-datos.md §13.3](base-de-datos.md). No hay 8.0 RC en npm (solo `8.1.0-dev.*`).
- [x] Prueba de concepto de RLS con Prisma: `TenantTransactionRunner` (`set_config(..., true)` en la transacción) con pruebas de fuga entre dos tenants en paralelo, por HTTP y contra PostgreSQL real. **Pendiente:** repetirla detrás de PgBouncer en modo transacción cuando exista el despliegue.

## 2. Funciones con propuesta por defecto (confirmar sobre la marcha)
| Tema | Propuesta |
|---|---|
| Inicio de sesión | Correo + contraseña, recuperación por correo, MFA opcional (TOTP). Google/Microsoft en v2. |
| Correo saliente | Un proveedor para toda la plataforma (Resend, Amazon SES o Brevo). |
| Marca por cliente | Logo, color principal y subdominio `cliente.procesabpm.com`. |
| Arranque de un cliente | Asistente inicial + importación desde Excel (usuarios, cargos, sedes, grupos de aprobación). |
| Flujos de ejemplo | Galería de 3 a 5 plantillas genéricas (soporte TI, compra, permiso, confirmación de pago). |
| Auditoría | Registro de acciones administrativas y de accesos a documentos. |
| Móvil | Web adaptada a celulares (PWA), sin app nativa. |

## 3. Pueden esperar al primer despliegue
- **Facturación:** precios de los planes y método de cobro. La cuota de almacenamiento por plan ya está aprobada (analisis.md §7.4.2).
- **Hosting y proveedor de archivos:** todo va en imágenes Docker; para archivos se recomienda Cloudflare R2 (analisis.md §7.4.3 y §9).
- **Dominio:** registrar `procesabpm.com` (u otro) y verificar la disponibilidad de la marca.
- **Legal:** términos de servicio, política de tratamiento de datos (Ley 1581, transferencia internacional) y acuerdo de encargado de tratamiento con cada cliente.
