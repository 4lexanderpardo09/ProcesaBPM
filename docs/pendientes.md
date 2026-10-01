# ProcesaBPM: pendientes y alcance propuesto

Actualizado: 2026-09-30. Las decisiones tomadas están en [analisis.md §0.1](analisis.md).

## 0. Hecho
- **Base de datos completa** (2026-09-30): 89 tablas, RLS en 82, 252 FK compuestas e indexadas, 59 CHECK, 34 triggers de reglas de negocio, funciones de autenticación y retención, semilla del catálogo (planes aprobados, permisos, festivos) y **109 pruebas en verde** (136 desde 2026-10-01: arreglo de invitaciones, outbox de plataforma y rol del worker). La revisión de integridad ([revision-bd.md](revision-bd.md)) está aplicada completa. Referencia: [base-de-datos.md](base-de-datos.md).
- Decisiones tomadas por defecto, que falta confirmar con el negocio: aprobadores distintos por empresa, regla de autoaprobación y reapertura como visita nueva (base-de-datos.md §13.2).

- **Autenticación** (2026-10-01, `modules/auth`): login con Argon2id y respuesta indistinguible, bloqueo (5 intentos, 15 minutos), token de selección de organización, access token JWT + refresh token rotativo en cookie con detección de robo, logout, recuperación de contraseña por outbox, aceptación de invitaciones, `GET /auth/me`, guard global deny-by-default que verifica membresía, tenant y sesión en la BD en cada petición, contratos zod en `shared` y rate limit en memoria. Qué partes se hicieron con Sonnet y cuáles con Opus está en el PR; la revisión final la hizo un subagente Opus. También: `TenantContext` valida UUID y los tiempos de transacción y el pool son configurables.
- **Outbox de plataforma y rol del worker** (2026-10-01, migración `20261001000100`): tabla `platform_outbox_events` sin `tenant_id` y sin acceso directo para el API ni el worker, `enqueue_platform_event` (lista blanca de tipos en `platform_event_types`), rol `app_worker` (sin `BYPASSRLS`, hereda de `app_runtime`) como único con `EXECUTE` en `claim_outbox_events` y en las nuevas `claim_platform_outbox_events` (con arrendamiento), `complete_*` y `fail_*` (con ficha de intento), y la purga de los eventos de plataforma ya procesados. El correo de recuperación se encola ahí aunque el usuario no tenga organizaciones. `WORKER_DATABASE_URL` para el worker; el API no la lee. Detalle en [base-de-datos.md](base-de-datos.md) §6.3, §6.4 y §12.
- **Autorización CASL** (2026-10-01, `modules/authorization`): guard global único (token, luego permiso) deny-by-default, `@RequirePermission` / `@RequireAnyPermission` / `@AuthenticatedOnly`, habilidad por miembro desde `role_permissions` con condiciones validadas, caché por (tenant, rol) con invalidación, ayudas de acceso por registro probadas con un sujeto de prueba y `TenantRoleProvisioner` para crear los roles base de un tenant. Detalle en [arquitectura.md](arquitectura.md) §9.
- Decisiones tomadas por defecto en esta tarea, que falta confirmar:
  - **El token de recuperación viaja en el payload del outbox de plataforma** (como se pidió), legible solo por `app_worker` mediante `claim_platform_outbox_events`; `complete` y `fail` terminal lo borran. **Pregunta abierta:** que el worker genere el token al enviar el correo (así no hay ningún secreto en claro en la tabla, en copias ni en réplicas, y el plazo de 30 minutos cuenta desde el envío); costaría implementar ya el manejador del worker y que `auth_issue_user_token` consuma los tokens anteriores del mismo usuario.
  - **Caché de permisos en memoria con 30 s de vida:** otra instancia ve un cambio de permisos hasta 30 s después. Para que la revocación sea inmediata en todas las instancias haría falta una columna `roles.permissions_version` (un trigger sobre `role_permissions` la incrementa y entra en la clave de la caché, que ya viene en la misma consulta de membresía que se hace en cada petición). Es un cambio de esquema que no se pidió: **pregunta abierta**.
  - Un rol con `is_admin = true` pero sin la regla `manage all` no tiene acceso total: manda `role_permissions`, y `is_admin` queda como dato informativo. Tampoco se da acceso total a `memberships.is_owner`. **Pregunta abierta** si el dueño del tenant debe tener siempre acceso completo.
  - Una ruta autenticada sin permiso declarado responde 403 (no se detiene el arranque; se registra `authorization.undeclared_route`). Las declaraciones que se mezclan sí detienen el arranque.
  - Un tenant `SUSPENDED` bloquea también las rutas `@AuthenticatedOnly` (el guard de autenticación lo comprueba antes).
  - El job que purga los eventos procesados necesita el login de plataforma: pendiente decidir si lo corre el worker (con `PLATFORM_DATABASE_URL`) o un job aparte.
- **Pendiente:** `claim_outbox_events` (outbox por tenant) no tiene arrendamiento: un evento reclamado cuyo worker cae queda en `PROCESSING` para siempre. Se dejó igual para no cambiar su comportamiento en esta tarea; arreglarlo cuando se construya el worker.
- **Revisión de seguridad de la autenticación** (subagente Opus, 2026-10-01), ya corregido:
  - **Alto:** aceptar una invitación podía cambiar la contraseña global de un usuario existente (toma de cuenta con el token de invitación de cualquier tenant). Migración `20261001000000_invitation_keeps_password`: una invitación solo fija la contraseña de quien no tiene; si no, 23514 → 422 y nada cambia.
  - La solicitud de recuperación responde 202 de inmediato y hace el trabajo en segundo plano (`BackgroundTasks`), para que el tiempo de respuesta no revele si la cuenta existe.
  - Un usuario `DISABLED` o `LOCKED` (estado de la cuenta) pierde el acceso en la siguiente petición y no puede renovar.
  - Rotación sin carreras: se bloquea la fila (`FOR UPDATE`) y se vuelve a verificar. Un token rotado que vuelve dentro de 10 s es una carrera normal (dos pestañas) y solo se rechaza; después se trata como robo y se revocan todas las sesiones. Un refresh contra un logout ya no revoca nada más.
  - `TRUST_PROXY` (por defecto `false`; un número de proxies o sus direcciones; nunca `true`) define de dónde sale la IP del cliente para el rate limit y las sesiones.
  - Una sola definición de UUID (`uuidSchema`/`isUuid` en `shared`): el UUID nulo o máximo da 400 y no 500.
  - El rate limit revisa primero la IP (quien la agotó no gasta el cupo del correo de otro) y guarda como máximo 100 000 claves.
  - Cookie `__Secure-refresh_token`; si llegan dos cookies con ese nombre (plantada por otro sitio) no se confía en ninguna.
  - Errores tipados en lugar de `Error` genérico.
- Decisiones tomadas por defecto en la autenticación, que falta confirmar:
  - La sesión dura **14 días absolutos** desde la selección del tenant; la rotación conserva la fecha de vencimiento.
  - Mientras una cuenta está bloqueada, sus intentos no se cuentan (el bloqueo no crece). Al vencer, el contador sigue en 5, así que el siguiente fallo vuelve a bloquear; un login correcto lo pone en 0 (es como funciona `auth_register_login_attempt`).
  - Para que no se distinga un correo inexistente, el login hace el mismo trabajo en todos los fallos: una verificación Argon2id (contra un hash señuelo si no hay uno válido) y una actualización de intentos (contra un id aleatorio que no existe).
  - Un usuario con MFA recibe 501 `MFA_NOT_IMPLEMENTED` solo con la contraseña correcta (es inevitable que eso confirme la contraseña), sin registrar el intento.
  - Seleccionar un tenant sin membresía `ACTIVE` (otra organización o una invitación sin aceptar) responde 401, igual que un token inválido. Un tenant `SUSPENDED` responde 403 `TENANT_SUSPENDED` en el guard, en la selección y en el refresh; en el refresh se conservan la cookie y la sesión.
  - El logout es público y usa la cookie: revoca la sesión de ese refresh token y el access token de esa sesión deja de servir en la siguiente petición.
  - Al aceptar una invitación, un usuario nuevo debe enviar contraseña (si no, 422 `INVALID_STATE` y el token sigue sirviendo) y uno existente no debe enviarla.
  - Límites: login 30 por IP y 10 por correo cada 15 minutos; solicitud de recuperación 10 por IP y 3 por correo; confirmación de recuperación 20 por IP y 5 por token; invitación 20 por IP y 5 por token. En memoria por instancia: pasar a Redis cuando haya más de una.
  - Códigos HTTP nuevos: 401 `INVALID_CREDENTIALS` y `UNAUTHENTICATED`, 400 `INVALID_TOKEN` y `VALIDATION_FAILED`, 403 `TENANT_SUSPENDED`, 429 `RATE_LIMITED`, 501 `MFA_NOT_IMPLEMENTED`.
- **Pendientes de la revisión de seguridad** (no corregidos en esta tarea):
  - **Pregunta abierta, correo de recuperación:** `outbox_events` exige `tenant_id`, pero la contraseña es global. Hoy el evento se encola en una organización del usuario (primero una membresía `ACTIVE`) con el token en claro, como se pidió; si no tiene ninguna, no se envía. Riesgo señalado: un administrador de cualquier organización del usuario podría leer ese token desde el outbox de su tenant si algún día se expone el outbox, y `claim_outbox_events` está concedida a `app_runtime`, así que cualquier código del API puede leer los eventos de todos los tenants. Opciones: un outbox de plataforma sin tenant para los correos de identidad, o cifrar el token con una llave que solo tenga el worker, y conceder `claim_outbox_events` solo a un rol del worker.
  - Varios logins en paralelo leen el estado antes de que se registre ningún fallo, así que una ráfaga puede probar más de 5 contraseñas (acotado por el límite de 10 por correo e instancia). Arreglo: contar el intento de forma atómica en la BD antes de verificar y usar el reloj de la BD.
  - El token de selección (2 minutos) se puede usar varias veces y sigue valiendo después de un cambio de contraseña. Arreglo: `jti` de un solo uso o comparar `iat` con la fecha de cambio de contraseña.
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
- [x] Issue de Prisma [#30374](https://github.com/prisma/orm/issues/30374): **no se reproduce en 7.10.0** (2026-10-01); se fija la versión exacta 7.10.0, la prueba de concepto queda en el CI y el runner de transacciones verifica el contexto fijado. Detalle y regla para subir de versión en [base-de-datos.md §13.3](base-de-datos.md). El 8.0 RC solo existe para el CLI (`prisma@8.0.0-rc.19`); el cliente y el adaptador no tienen versión 8.0.x en npm (solo `8.1.0-dev.*`), así que la prueba contra el 8.0 queda pendiente hasta que salga el 8.0 estable.
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
