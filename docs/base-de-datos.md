# ProcesaBPM: base de datos

> Documento de referencia de la capa de datos. Está escrito para quien construya el API (personas o agentes).
> Fuente de verdad del código: `packages/db/`. Si cambias el esquema, actualiza este documento en el mismo commit.
>
> Última actualización: 2026-10-01 · Estado: **esquema v1 completo, 145 pruebas en verde**.

## Contenido
1. [Resumen](#1-resumen)
2. [Stack y estructura](#2-stack-y-estructura)
3. [Cómo trabajar con la BD](#3-cómo-trabajar-con-la-bd)
4. [Convenciones del esquema](#4-convenciones-del-esquema)
5. [Modelo por dominios](#5-modelo-por-dominios)
6. [Aislamiento multi-tenant](#6-aislamiento-multi-tenant)
7. [Reglas de integridad que impone la BD](#7-reglas-de-integridad-que-impone-la-bd)
8. [Contrato para el API (léelo antes de escribir código)](#8-contrato-para-el-api)
9. [Catálogo global y semillas](#9-catálogo-global-y-semillas)
10. [Pruebas](#10-pruebas)
11. [Cómo cambiar el esquema](#11-cómo-cambiar-el-esquema)
12. [Despliegue](#12-despliegue)
13. [Decisiones y pendientes](#13-decisiones-y-pendientes)

---

## 1. Resumen
| Métrica | Valor |
|---|---|
| Motor | PostgreSQL 18 |
| Tablas | 91 (9 de plataforma sin `tenant_id`: 7 catálogos globales y el outbox de plataforma con su lista de tipos; 4 de identidad/autenticación; 78 de tenant) |
| Llaves foráneas | 252, **todas con índice** y compuestas con `tenant_id` entre tablas de tenant |
| Restricciones | 59 `CHECK`, 2 de exclusión, índices únicos parciales |
| Triggers | 34 (inmutabilidad, máquina de estados, coherencia, `updated_at`) |
| Row-Level Security | forzada en 82 tablas |
| Enums | 38 |
| Pruebas | 145 (integración con PostgreSQL real + unitarias) |

La BD no es solo almacenamiento: **garantiza por sí misma** el aislamiento entre clientes y las reglas de negocio críticas. Un bug en el API no puede mezclar clientes, romper un flujo publicado ni dejar un ticket en un estado imposible.

## 2. Stack y estructura
- **PostgreSQL 18**, con IDs `uuidv7()` generados por la BD.
- **Prisma 7.10** (`prisma-client` generator + `@prisma/adapter-pg`).
- Pruebas con **Vitest 5** + **Testcontainers** (PostgreSQL 18 real en Docker).
- Extensión `btree_gist`, instalada en el esquema `extensions`.

```
packages/db/
├── prisma/
│   ├── schema.prisma                      # modelos (inglés), fuente para Prisma Client
│   └── migrations/
│       ├── 20260930000000_init/           # generada por Prisma desde schema.prisma
│       ├── 20260930000100_security_and_constraints/   # RLS, roles, CHECKs, auth, outbox
│       ├── 20260930000200_integrity_rules/            # triggers de negocio, auth avanzada, purgas
│       ├── 20261001000000_invitation_keeps_password/  # una invitación nunca cambia una contraseña existente
│       └── 20261001000100_platform_outbox_and_worker_role/  # outbox de plataforma y rol app_worker
├── prisma.config.ts
├── src/
│   ├── holidays/colombia.ts               # generador de festivos (Pascua + Ley Emiliani)
│   ├── seed/                              # catálogo global, plantillas de roles, seed CLI
│   ├── generated/prisma/                  # Prisma Client (no se versiona)
│   └── index.ts
└── test/
    ├── support/                           # contenedor, conexiones, fixtures
    ├── unit/                              # pruebas sin BD
    └── *.test.ts                          # pruebas de integración
```

## 3. Cómo trabajar con la BD
Requisitos: Node ≥ 24, pnpm 11, Docker (para las pruebas).

| Tarea | Comando (desde `packages/db`) |
|---|---|
| Instalar | `pnpm install` (en la raíz) |
| Validar el esquema | `pnpm validate` |
| Generar Prisma Client | `pnpm generate` |
| Pruebas (levantan su propio PostgreSQL) | `pnpm test` |
| Pruebas sin Docker (nube, CI) | `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm test`: usa un PostgreSQL 18 existente (superusuario) y recrea la BD `procesabpm_test` en cada corrida. |
| Preparar un sandbox Linux desde cero | `bash scripts/cloud-setup.sh` (instala PostgreSQL 18, pnpm, dependencias y Prisma Client; idempotente). |
| Verificar tipos | `pnpm typecheck` |
| Aplicar migraciones | `DATABASE_URL=<dueño del esquema> pnpm migrate:deploy` |
| Cargar el catálogo global | `DATABASE_URL=<login de app_platform> pnpm seed` |

## 4. Convenciones del esquema
| Regla | Detalle |
|---|---|
| Idioma | Tablas, columnas, enums, funciones y comentarios en **inglés**. Los textos que ve el usuario (nombres de festivos, planes, roles base) van en español como datos. |
| Nombres | `snake_case` en la BD; `PascalCase`/`camelCase` en Prisma con `@map`/`@@map`. |
| IDs | `uuid` con `DEFAULT uuidv7()`. Número visible del ticket: `next_tenant_sequence('ticket')`, un contador por tenant. |
| Tenant | Toda tabla de negocio tiene `tenant_id`; la PK es `(tenant_id, id)`. |
| Llaves foráneas | Siempre compuestas `(tenant_id, x_id)`. Los actores y responsables apuntan a `memberships (tenant_id, user_id)`: solo pueden ser miembros del tenant. |
| Borrado | Entre tablas del tenant, `NO ACTION`; desde `tenants`, `CASCADE` (vía `purge_tenant`). Configuración: `is_active`. Datos transaccionales: `deleted_at`. Historial: nunca se borra. |
| Fechas | `timestamptz(3)` en UTC; horarios laborales en `time`; zona horaria IANA por tenant, empresa y usuario (validada). |
| Dinero | `numeric(18,2)` + `currency_code` (tabla `currencies`). |
| JSON | `jsonb` solo para configuración de forma variable (config de bloques, filtros, diseño PDF), validada con zod en `packages/shared`. |
| Campos por código | PDFs, exportaciones, topes y plazos referencian campos por `fields.code` (`^[A-Z][A-Z0-9_]*$`), estable entre versiones. |
| `updated_at` | Lo mantiene un trigger en todas las tablas que lo tienen. |

## 5. Modelo por dominios

```mermaid
erDiagram
  TENANT ||--o{ COMPANY : tiene
  TENANT ||--o{ MEMBERSHIP : tiene
  USER ||--o{ MEMBERSHIP : "pertenece (N tenants)"
  MEMBERSHIP }o--|| ROLE : rol
  MEMBERSHIP ||--|{ MEMBERSHIP_COMPANY : "trabaja en"
  SUBCATEGORY ||--o| WORKFLOW : "1 flujo"
  WORKFLOW ||--o{ WORKFLOW_VERSION : versiones
  WORKFLOW_VERSION ||--o{ STEP : bloques
  WORKFLOW_VERSION ||--o{ TRANSITION : conexiones
  STEP ||--o{ FIELD : campos
  WORKFLOW_VERSION ||--o{ TICKET : "usa (fija)"
  TICKET ||--o{ TICKET_ASSIGNEE : "responsables actuales"
  TICKET ||--o{ TICKET_EVENT : "línea de tiempo"
  TICKET ||--o{ TICKET_STEP_VISIT : visitas
  TICKET_STEP_VISIT ||--o{ TICKET_SLA_CLOCK : "relojes por responsable"
  TICKET ||--o{ TICKET_FIELD_VALUE : valores
  TICKET ||--o{ TICKET_DOCUMENT : documentos
  TICKET_DOCUMENT }o--|| STORED_FILE : archivo
```

### 5.1 Plataforma (globales, sin `tenant_id`)
| Tabla | Para qué |
|---|---|
| `plans` | Planes: almacenamiento base + por usuario, % de gracia, máx. usuarios, `features` (jsonb). |
| `currencies`, `countries`, `country_holidays` | Catálogo de monedas, países (moneda y zona horaria) y festivos por país (plantilla para los calendarios). |
| `permissions` | Catálogo de permisos CASL (`action` + `subject`). |
| `users` | **Identidad global**: correo, hash de contraseña, MFA cifrado, bloqueo, idioma, zona horaria. |
| `refresh_sessions`, `user_tokens` | Sesiones de renovación y tokens de un solo uso (restablecer contraseña, invitación, verificar correo, cambio de correo). |
| `platform_admins`, `platform_announcements` | Superadministradores y avisos de mantenimiento/notas de versión. |

### 5.2 Tenant, identidad y organización
| Tabla | Para qué |
|---|---|
| `tenants` | Cliente del SaaS: slug, plan, país, zona horaria, marca, estado, `db_cluster` (para moverlo a su propia BD en el futuro), fechas de cancelación y purga. |
| `tenant_usage`, `tenant_sequences`, `tenant_settings` | Contador de almacenamiento (cuota), contadores legibles y configuración clave-valor. |
| `memberships` | Usuario ↔ tenant: rol, cargo, departamento, sede, estado, dueño, firma. **Toda referencia a una persona dentro del tenant apunta aquí.** |
| `membership_companies` | Empresas en las que trabaja el miembro (al menos una si está activo). |
| `roles`, `role_permissions` | Roles del tenant (con `system_role` para los base) y permisos con condiciones CASL. |
| `groups`, `group_members` | Grupos libres (antes "perfiles"): iniciadores, candidatos y observadores. |
| `companies` | Empresas del tenant (1..N, una por defecto), con país, moneda, zona horaria y calendario. |
| `departments`, `positions` | Áreas y cargos. El cargo sirve para **asignar trabajo**, no para aprobar. |
| `site_levels`, `sites` | Sedes en árbol con niveles nombrados por el cliente (reemplaza regional/zona). |
| `calendars`, `calendar_working_hours`, `calendar_holidays` | Calendario laboral: franjas por día (sin solapes) y festivos. `calendar_working_hours.weekday`: **0 = domingo … 6 = sábado** (igual que `Date#getDay()` de JS y `EXTRACT(DOW …)` de PostgreSQL). |
| `approval_group_types`, `approval_groups`, `approval_group_approvers`, `approval_group_members`, `delegations` | Aprobación explícita: "X (y sus suplentes, en orden) aprueba a Y, Z"; grupos por tipo y opcionalmente por empresa; delegaciones por fechas. |

### 5.3 Catálogo y motor de flujos
| Tabla | Para qué |
|---|---|
| `priorities`, `categories`, `category_companies`, `category_departments`, `subcategories` | Catálogo y su visibilidad por empresa/departamento (sin filas = visible para todos). |
| `workflows` | Un flujo por subcategoría (el vínculo no cambia nunca). |
| `workflow_versions` | `DRAFT` → `PUBLISHED` → `ARCHIVED`. Un borrador y una publicada a la vez. **Lo publicado es inmutable.** |
| `steps` | Bloques del lienzo: tipo, modo de asignación, alcance por sede, aprobación (tipo de grupo + nivel), regla de cierre, SLA (valor + unidad), plazo por corte, límite de vueltas, lote, `config` y posición en el lienzo. |
| `step_runtime_states` | Estado operativo (último despacho aleatorio y puntero del round-robin), separado de la configuración. |
| `step_candidates`, `step_initiators`, `step_sla_overrides`, `step_signers`, `step_files` | Candidatos, quién puede iniciar (reemplaza ReglaMapeo), SLA por empresa, firmantes y archivos descargables. |
| `transitions` | Conexiones dentro de una versión: `DECISION` (la elige una persona), `CONDITION` (automática con regla), `DEFAULT` (continuación automática / "si no"), `SYSTEM_ONLY` (desvío por tope). |
| `fields` | Campos de formulario (código único por versión, captura, requerido, config, origen de datos). |
| `amount_rules` | Topes de monto con moneda: bloquear, advertir o desviar a aprobación extra. |
| `company_cutoffs` | Día de corte mensual por flujo y empresa, con días hábiles de gracia. |
| `datasets`, `dataset_rows` | Excel cargado como fuente de datos, con `lookup_key` indexada. |
| `calculator_configs` | Parámetros de las calculadoras integradas (p. ej. alimentación). |

### 5.4 Tickets
| Tabla | Para qué |
|---|---|
| `tickets` | Ticket con número por tenant; flujo, versión, subcategoría, empresa, creador y fechas **fijos**; estado `OPEN`/`PAUSED`/`CLOSED`; paso actual (de su versión); `search_vector` generado para búsqueda en español. |
| `ticket_assignees` | **Única** fuente de quién tiene el ticket ahora (`PRIMARY`, `POOL`, `PARALLEL`, `INCIDENT`). |
| `ticket_events` | Línea de tiempo **de solo inserción**: creación, transiciones, asignaciones, comentarios, novedades, cierre, reapertura, errores, cambios de campos (`FIELDS_UPDATED`, con antes/después en `data`). |
| `ticket_step_visits` | Cada paso por un bloque (un bucle es una visita nueva). Mide el **tiempo total del paso** con una copia del SLA vigente al entrar. Solo una visita abierta por ticket. |
| `ticket_sla_clocks` | Reloj de **cada responsable** dentro de una visita, con copia del SLA y calendario, pausa y resultado. |
| `ticket_field_values` | Valores del formulario, atados a la versión del ticket. |
| `ticket_parallel_tasks`, `ticket_incidents` | Firmas paralelas y novedades (guardan a quién restaurar al resolverse). |
| `error_types`, `error_subtypes`, `ticket_errors` | Catálogo y registro único de errores (de solo inserción). |
| `tags`, `ticket_tags` | Etiquetas personales (solo su dueño las usa). |
| `ticket_signatures` | Firmas manuscritas por paso y vuelta (de solo inserción). |

### 5.5 Archivos, PDF, exportaciones y plataforma técnica
| Tabla | Para qué |
|---|---|
| `stored_files` | Objeto en almacenamiento S3: clave inmutable, SHA-256, tamaño (máx. 4 MB si lo sube un usuario), origen, estado `PENDING`/`CONFIRMED`/`DELETED`. |
| `ticket_documents` | Rol del archivo en el ticket y versiones (un solo documento vigente por paso). |
| `pdf_formats` | Diseños del constructor de PDF. |
| `pdf_templates`, `pdf_template_fields`, `pdf_template_signatures` | PDF subido por el cliente: campos y firmas por coordenadas o por nombre AcroForm. |
| `workflow_documents` | Qué documento produce el flujo, para qué empresa y cuándo. |
| `export_definitions`, `export_columns`, `export_catalog_entries`, `export_cutoffs`, `export_lines` | Exportaciones programadas (antes "planos"). |
| `notifications`, `notification_preferences` | Notificaciones in-app y preferencias por tipo y canal. |
| `outbox_events` | Outbox transaccional (PDF, correo, websocket, webhooks, exportaciones). |
| `webhooks`, `webhook_deliveries` | Webhooks con secreto **cifrado** y registro de entregas. |
| `audit_logs` | Auditoría de solo inserción. |
| `text_templates`, `text_template_shares` | Plantillas de texto personales y compartidas. |

## 6. Aislamiento multi-tenant

### 6.1 Cómo funciona
- **RLS forzada** en todas las tablas de tenant con la política `tenant_isolation`: `tenant_id = app_current_tenant()`.
- `tenants` solo muestra el propio tenant. `users` solo muestra al usuario actual y a los miembros del tenant actual.
- `refresh_sessions` solo expone las filas del usuario actual. `user_tokens` no es accesible para el API: todo pasa por funciones.
- **Las llaves compuestas son la segunda barrera:** aunque alguien se salte la RLS, la BD no deja apuntar a filas de otro tenant.

### 6.2 Contexto por transacción
El API, en **cada** transacción:
```sql
BEGIN;
SELECT set_config('app.tenant_id', '<uuid del tenant>', true);  -- true = local a la transacción
SELECT set_config('app.user_id',   '<uuid del usuario>', true);
-- ... consultas ...
COMMIT;
```
Nunca `SET` de sesión: detrás de PgBouncer en modo transacción, el valor pasaría al siguiente cliente (hay una prueba que lo verifica). Sin contexto, las tablas de tenant devuelven 0 filas.

### 6.3 Roles de base de datos
| Rol | Uso | Atributos |
|---|---|---|
| `app_runtime` | API | Sujeto a RLS. Sin `INSERT` en `users`/`tenants`, sin acceso a `user_tokens`/`platform_admins`, sin `UPDATE`/`DELETE` en el historial. Solo lee las columnas públicas de `users`. |
| `app_worker` | Worker (cola de eventos) | `NOLOGIN`, sin `BYPASSRLS`. **Hereda** los privilegios de tabla de `app_runtime` (una sola fuente de verdad, sin `SET ROLE` hacia él) y es el **único** que puede reclamar eventos del outbox (`claim_*`) y reportar su resultado. Sin acceso directo a las tablas de plataforma. Procesa cada evento en una transacción con su propio `app.tenant_id`, sujeto a RLS como el API. |
| `app_outbox_owner` | Dueño del outbox de plataforma | `NOLOGIN`, sin `BYPASSRLS`. Es dueño de las dos tablas del outbox de plataforma y de las 5 funciones que las tocan. Existe para que `app_platform` (cuyo login, con `BYPASSRLS`, tienen el API y los jobs de plataforma) **no tenga ningún privilegio sobre ellas**: si no, quien tenga ese login leería los tokens de recuperación en claro. |
| `app_platform` | Aprovisionamiento, facturación, purgas, semillas | `BYPASSRLS`. Dueño de las demás funciones `SECURITY DEFINER`. Sin acceso a las tablas del outbox de plataforma; solo puede ejecutar su purga. |
| Dueño del esquema | Migraciones | Crea objetos. No lo usa la aplicación. |

Los usuarios de login los crea la infraestructura. **`BYPASSRLS` no se hereda por pertenecer a un rol**, así que cada login debe ejecutarse como su rol:
```sql
CREATE ROLE procesabpm_api LOGIN PASSWORD '...' IN ROLE app_runtime;
ALTER ROLE procesabpm_api SET role = 'app_runtime';
CREATE ROLE procesabpm_worker LOGIN PASSWORD '...' IN ROLE app_worker;
ALTER ROLE procesabpm_worker SET role = 'app_worker';
CREATE ROLE procesabpm_platform LOGIN PASSWORD '...' IN ROLE app_platform;
ALTER ROLE procesabpm_platform SET role = 'app_platform';
```

**Tablas solo de plataforma** (`platform_admins`, `user_tokens`, `platform_outbox_events`, `platform_event_types`): ni `app_runtime` ni `app_worker` tienen privilegio alguno sobre ellas; solo las funciones (y `app_platform` tampoco sobre las dos del outbox). Como `ALTER DEFAULT PRIVILEGES` concede a `app_runtime` y a `app_platform` toda tabla nueva, la migración de una tabla así debe hacer `REVOKE ALL` explícito; `schema-conventions.test.ts` falla si alguna de estas tablas es accesible para los roles de la aplicación, y otra prueba compara que `app_worker` tenga exactamente los privilegios de tabla de `app_runtime`.

**Tablas temporales:** `TEMP` se revoca a `PUBLIC` en la base de datos. Con el `search_path` de las funciones `SECURITY DEFINER` (`public`), una tabla temporal con el nombre de una real la sustituye dentro de la función (comprobado), así que los roles de la aplicación no pueden crearlas; las funciones nuevas además terminan su `search_path` con `pg_temp`. Una prueba lo verifica. Pendiente: llevar el mismo `search_path` a las funciones `auth_*` existentes.

### 6.4 Funciones de entrada (`SECURITY DEFINER`; dueño `app_platform`, salvo las del outbox de plataforma, de `app_outbox_owner`; `search_path = public`)
| Función | Quién | Qué hace |
|---|---|---|
| `auth_find_user_by_email(email)` | API, sin tenant | Login: devuelve id, hash, estado, bloqueo y si tiene MFA. |
| `auth_list_memberships(user_id)` | API, con `app.user_id` = ese usuario | Selector de organización (solo las propias). |
| `auth_register_login_attempt(user_id, ok, max, minutos)` | API | Contador de intentos fallidos y bloqueo temporal. |
| `auth_find_refresh_session(hash)` | API | Renovación del token de acceso. |
| `invite_user(email, nombre, apellido)` | API, con tenant | Crea la identidad **sin contraseña**, o devuelve la existente sin tocarla. |
| `auth_issue_user_token(user, tipo, hash, expira, payload)` | API | Emite un token de un solo uso (el cambio de correo solo para uno mismo; la invitación solo si ya existe la membresía). |
| `auth_consume_user_token(hash, nuevo_hash?)` | API | Consume el token una vez y aplica su efecto: nueva contraseña (revoca las sesiones), activa la invitación, verifica o cambia el correo. Una invitación solo fija la contraseña de un usuario que no tiene; si el usuario ya tiene una y se envía otra, falla con 23514 y no cambia nada (migración `20261001000000`). |
| `auth_find_user_token(hash)` | API | Consulta un token (p. ej. para mostrar la invitación). |
| `auth_set_own_password(hash)` | API, usuario autenticado | Cambio de contraseña (el API verifica antes la actual). |
| `auth_get_own_mfa_secret()`, `auth_set_own_mfa(secreto, activo)` | API, usuario autenticado | Secreto TOTP cifrado. |
| `next_tenant_sequence(nombre)` | API, con tenant | Siguiente número (p. ej. del ticket), sin repetidos en concurrencia. |
| `claim_outbox_events(n)` | **Solo `app_worker`** | Reclama eventos de todos los tenants con `SKIP LOCKED`. Desde la migración `20261001000100` ya no tiene `EXECUTE` el API (antes lo tenía `app_runtime`). Su comportamiento no cambió: un evento reclamado cuyo worker cae queda en `PROCESSING` (pendiente: arrendamiento como el del outbox de plataforma). |
| `enqueue_platform_event(tipo, payload)` | API (`app_runtime`), sin contexto de tenant | Único acceso del API al outbox de plataforma (`platform_outbox_events`, sin `tenant_id`). Solo acepta los tipos de la tabla `platform_event_types` (hoy `email.password_reset`; agregar un tipo es insertar una fila); un tipo fuera de la lista falla con 42501 y un payload que no sea objeto o pase de 8 KiB, con 23514. |
| `claim_platform_outbox_events(n, arriendo, max_intentos)` | **Solo `app_worker`** | Reclama con arrendamiento: el evento queda `PROCESSING` y `available_at` guarda el vencimiento del arriendo (5 min), así que si el worker cae se reclama de nuevo; `attempts` cuenta los reclamos y un arriendo vencido con `max_intentos` (10) reclamos pasa a `FAILED`, sin el token. |
| `complete_platform_outbox_event(id, intento)`, `fail_platform_outbox_event(id, intento, error, reintento_en, max_intentos)` | **Solo `app_worker`** | Reportan el resultado. El `intento` es una ficha de exclusión: un worker cuyo arriendo venció no puede pisar el resultado del nuevo dueño (devuelven `false` y no cambian nada). **Todo estado final borra `token` del payload** (`DONE`, y `FAILED` por cualquier vía). `fail` con `reintento_en` vuelve el evento a `PENDING` en esa fecha, salvo que sea el último intento permitido: entonces pasa a `FAILED` (si no, quedaría `PENDING` sin que nadie pudiera reclamarlo). |
| `purge_tenant(tenant)` | Solo `app_platform` | Borra el tenant completo y las identidades que solo le pertenecían. |
| `purge_processed_outbox_events(intervalo)`, `purge_processed_platform_outbox_events(intervalo)`, `purge_read_notifications(intervalo)` | Solo `app_platform` (la del outbox de plataforma, su dueño es `app_outbox_owner` y `app_platform` solo la ejecuta) | Retención: los eventos `DONE` por su fecha de proceso y, en el outbox de plataforma, los `FAILED` por su fecha de creación. |

## 7. Reglas de integridad que impone la BD
Códigos de error que devuelve la BD: `23001` = dato inmutable · `23514` = estado de negocio inválido · `23503` = referencia inválida · `23505` = duplicado · `23P01` = solapamiento · `42501` = sin permiso.

| Área | Regla | Mecanismo | Código |
|---|---|---|---|
| Flujos | Una versión publicada o archivada no se modifica (pasos, transiciones, campos, topes, candidatos, iniciadores, SLA por empresa, firmantes, archivos). | Triggers `guard_version_config` / `guard_step_config` | 23001 |
| Flujos | Ciclo de vida `DRAFT → PUBLISHED → ARCHIVED`; solo se borran borradores; `published_at` automático. | `guard_version_lifecycle` | 23001 |
| Flujos | Un flujo no cambia de subcategoría. | `workflow_subcategory_immutable` | 23001 |
| Flujos | Bloques automáticos (START, CONDITION, DOCUMENT, EXPORT, NOTIFICATION, WEBHOOK, CALCULATOR, WAIT, END) sin responsable, sin SLA y sin cierre manual; los bloques de personas siempre tienen modo de asignación. | CHECK `steps_assignment_by_type`, `steps_automatic_without_sla` | 23514 |
| Flujos | No se cambia el tipo de un paso que ya tiene transiciones. | `step_type_change` | 23514 |
| Transiciones | Nada sale de END ni entra a START; `CONDITION` solo sale de CONDITION y exige regla; `DEFAULT` solo sale de bloques automáticos (uno por paso); `DECISION` solo sale de pasos de personas; sin etiquetas repetidas por paso; mismas versión y tenant. | `validate_transition`, índices únicos, FK compuestas | 23514 / 23505 / 23503 |
| Tickets | Número, flujo, versión, subcategoría, empresa, creador y fecha de creación son fijos. | `ticket_fixed_columns` | 23001 |
| Tickets | La versión es del flujo, el flujo es de la subcategoría, el paso actual es de la versión, y la empresa es una de las del creador. | FK compuestas | 23503 |
| Tickets | `PAUSED ⇔` hay una novedad abierta; no se cierra con firmas paralelas pendientes; cerrado ⇔ `closed_at`. Se valida **al hacer COMMIT**. | Constraint triggers diferidos + CHECK | 23514 |
| Tickets | Una sola novedad abierta y una sola visita abierta por ticket. | Índices únicos parciales | 23505 |
| Tickets | Al firmar una tarea paralela, el firmante deja de estar asignado. | `parallel_task_done` | — |
| Tickets | Los valores del formulario pertenecen a la versión del ticket. | FK `(tenant, versión, campo)` | 23503 |
| SLA | El reloj coincide con su visita (ticket, paso, vuelta); un reloj completado con SLA tiene resultado; valor y unidad van juntos. | `clock_matches_visit` + CHECK | 23514 |
| Historial | `ticket_events`, `audit_logs`, `ticket_errors` y `ticket_signatures` son de solo inserción para el API. | Privilegios | 42501 |
| Personas | Un miembro activo pertenece al menos a una empresa (se valida al COMMIT). | Constraint trigger diferido | 23514 |
| Aprobación | Un grupo por (tipo, empresa) por persona; el grupo sin empresa vale para todas. El tipo y la empresa del miembro se copian del grupo. No se cambia el alcance de un grupo con miembros. | Índice `NULLS NOT DISTINCT` + triggers | 23505 / 23514 |
| Delegaciones | Sin solapes para la misma persona y sin delegaciones circulares en el mismo periodo. | Exclusión GiST + trigger | 23P01 / 23514 |
| Calendario | Franjas del mismo día sin solaparse (los turnos nocturnos van en dos filas). | Exclusión GiST | 23P01 |
| Valores | Zona horaria IANA válida; correo en minúsculas; locale `xx-XX`; SHA-256 hexadecimal; slug del tenant; color `#RRGGBB`; moneda, país y códigos de campo con formato. | CHECK | 23514 |
| Archivos | Subida de usuario ≤ 4 MB; tamaño > 0; un único documento vigente por paso. | CHECK + índice parcial | 23514 / 23505 |
| Unicidades | Una empresa, un calendario y un tipo de grupo por defecto; un borrador y una publicada por flujo; un dueño por tenant. | Índices únicos parciales | 23505 |

## 8. Contrato para el API
Reglas que el código del API **debe** respetar; la BD rechaza lo que las viola.

1. **Contexto:** cada transacción empieza con los dos `set_config(..., true)` (§6.2). Con Prisma: una extensión de cliente que abre la transacción y fija el contexto antes de ejecutar el trabajo.
2. **Columnas sensibles de `users`:** el rol del API **no puede leer** `password_hash`, `mfa_secret_encrypted`, `failed_logins` ni `locked_until`. Prisma selecciona todas las columnas por defecto, así que el cliente debe crearse con `omit: { user: { passwordHash: true, mfaSecretEncrypted: true, failedLogins: true, lockedUntil: true } }`. Todo lo de credenciales va por las funciones `auth_*`.
2b. **Autenticación (implementada en `apps/api/src/modules/auth`):** el login, el refresh y la recuperación corren antes de que exista un tenant, en transacciones con `app.tenant_id` vacío (`AuthTransactionRunner`): anónimas para `auth_find_user_by_email`, `auth_register_login_attempt`, `auth_find_refresh_session`, `auth_find_user_token`, `auth_issue_user_token` (`PASSWORD_RESET`) y `auth_consume_user_token`; con `app.user_id` del usuario para `auth_list_memberships` y para leer, crear, rotar y revocar sus `refresh_sessions` (la RLS `own_sessions` lo exige). `auth_find_refresh_session` no devuelve `replaced_by`, así que la detección de reutilización lee la fila propia con `app.user_id` fijado. Los parámetros del bloqueo (5 intentos, 15 minutos) los pasa el API a `auth_register_login_attempt`.
3. **Identidades:** nunca `INSERT` en `users`. Una invitación es: `invite_user()`, luego insertar `memberships` (`INVITED`) y `membership_companies`, luego `auth_issue_user_token(..., 'INVITATION', ...)` y enviar el correo.
4. **Secretos:** `webhooks.secret_encrypted` y `users.mfa_secret_encrypted` se cifran en la app (AES-256-GCM, con la llave en el gestor de secretos). No se guardan hashes: se necesitan en claro para firmar y verificar.
5. **Errores:** mapear los códigos de §7 a respuestas HTTP (23001/23514 → 409 o 422; 23503 → 422; 23505 → 409; 23P01 → 409; 42501 → 403). Las reglas diferidas fallan en el **COMMIT**, no en la sentencia.
6. **Crear un ticket** (una transacción):
   - `number = next_tenant_sequence('ticket')`;
   - `workflow_id` + `workflow_version_id` (la versión `PUBLISHED`), `subcategory_id` y una `company_id` del creador;
   - `ticket_step_visits` del primer paso con persona, con copia del SLA (`step_sla_overrides` de la empresa, si no el del paso) y del calendario de la empresa;
   - `ticket_sla_clocks` por responsable, más `ticket_assignees`;
   - `ticket_events (CREATED)` y `outbox_events` para PDF y notificaciones.
7. **Avanzar:**
   - cerrar el reloj y la visita (`exited_at`, `business_minutes`, `result`);
   - abrir la visita del paso destino (`loop + 1` si ya estuvo ahí);
   - reemplazar `ticket_assignees`;
   - registrar el evento `TRANSITIONED`.

   Los bloques automáticos los ejecuta el worker hasta llegar a un paso de personas.
8. **Novedad:** en la misma transacción, `status = 'PAUSED'` + `ticket_incidents` (con `previous_assignee_ids`) + pausar los relojes (`paused_at`). Al resolver: ticket `OPEN`, novedad `RESOLVED`, sumar `paused_minutes` y restaurar asignados (validando que sigan siendo miembros activos).
9. **Reasignación dentro del paso:** cierra el reloj del responsable anterior (con su resultado) y abre uno nuevo; la visita sigue abierta (decisión de negocio).
10. **Cerrar:** no puede haber una novedad abierta ni firmas paralelas pendientes; `closed_at` y `closed_by_id` son obligatorios.
11. **Editar un flujo:** crear una versión `DRAFT` copiando la publicada, editarla y publicarla. Publicar significa: la anterior pasa a `ARCHIVED` y la nueva a `PUBLISHED`, en ese orden y en una transacción.
12. **Aprobadores** (regla del motor):
    - buscar el grupo del creador para el `approval_group_type_id` del paso, **primero** el de la empresa del ticket y si no el general (`company_id IS NULL`);
    - aprobador = el de menor `position` que esté activo y sin delegación vigente; si tiene delegación, aprueba su delegado;
    - **autoaprobación:** si el creador es el aprobador, se pasa al siguiente de la lista y, si no hay, sube un nivel;
    - `approval_level = n` significa el aprobador del aprobador, repetido n veces.
13. **Valores de campos:** incluir `workflow_version_id` (el del ticket). Al corregir un valor, registrar `FIELDS_UPDATED` con antes y después.
    Los valores numéricos y de moneda se guardan normalizados como número JSON (sin separadores de miles como `1.500.000`): el servidor normaliza al guardar, y el evaluador de condiciones no interpreta esos textos como número. En las condiciones de fecha, si un lado es `YYYY-MM-DD` y el otro trae hora, el día se toma como medianoche UTC.
14. **Archivos:** subir a `PENDING` (reservando cuota en `tenant_usage`) y confirmar en la transacción del negocio. Nunca sobrescribir: cada PDF nuevo es otra fila de `ticket_documents` con `version + 1` y la anterior pasa a `is_current = false`.
15. **Purga de tenant:** solo el servicio de plataforma, con `purge_tenant()`. Borrar los objetos del bucket (`tenants/{id}/`) es un job aparte.

## 9. Catálogo global y semillas
`src/seed/run.ts` carga, de forma **idempotente** (upsert por llave natural), en cada despliegue:

| Qué | Contenido |
|---|---|
| Monedas | COP, USD |
| Países | Colombia (COP, `America/Bogota`) |
| Festivos | Colombia, año anterior al siguiente +1, calculados por `colombianHolidays(year)`: fijos, Ley Emiliani, Pascua y Virgen de Chiquinquirá desde 2026. Coinciden con las listas 2025–2027 del sistema viejo; dos festivos el mismo día se unen. |
| Planes (aprobados) | trial 1 GB (máx. 5 usuarios) · basic 10 GB + 1 GB/usuario · professional 25 GB + 2 GB/usuario · enterprise 100 GB + 5 GB/usuario. `features` = `{}` hasta definir la facturación. |
| Permisos | `manage:all`; CRUD de la configuración; acciones de ticket (`create`, `create_for_others`, `read_created/assigned/observed/all`, `comment`, `transition`, `reassign`, `open_incident`, `close`, `reopen`, `report_error`, `delete`); Workflow (`read/update/publish`); Export; Report; AuditLog; Storage; Setting; Delegation. |

`src/seed/role-templates.ts` define los roles base que el **servicio de aprovisionamiento** crea en cada tenant nuevo (Administrador, Supervisor, Agente, Solicitante). Hay una prueba que verifica que solo usan permisos del catálogo.

## 10. Pruebas
`pnpm test` levanta PostgreSQL 18 en Docker (o usa `TEST_DATABASE_URL` si no hay Docker), aplica las migraciones, crea los roles de login como en producción y carga la semilla.

| Archivo | Cubre |
|---|---|
| `tenant-isolation.test.ts` | RLS en todas las tablas; un tenant no ve, no edita ni borra otro; sin contexto no hay filas; no hay fuga entre transacciones; `users`/`tenants` restringidos. |
| `identity-security.test.ts` | Columnas sensibles; creación de identidades; perfil propio; tokens (restablecer, expirar, invitación, cambio de correo); bloqueo por intentos; historial de solo inserción. |
| `workflow-rules.test.ts` | Inmutabilidad de lo publicado; ciclo de vida; reglas por tipo de bloque y transición; bucles permitidos. |
| `ticket-rules.test.ts` | Coherencia ticket ↔ versión, flujo, subcategoría y empresa; máquina de estados; paralelos; visitas y relojes; etiquetas; `updated_at`; búsqueda. |
| `organization-rules.test.ts` | Grupos de aprobación por tipo y empresa; delegaciones; franjas de calendario; membresía con empresa. |
| `integrity.test.ts` | FK compuestas; unicidades; CHECKs; purga de tenant. |
| `database-functions.test.ts` | Numeración concurrente; funciones de login; outbox concurrente; retención. |
| `schema-conventions.test.ts` | **Guardas para migraciones futuras:** toda FK con índice y con `tenant_id`, PK con `tenant_id` primero, trigger de `updated_at`, funciones `SECURITY DEFINER` bien configuradas. |
| `seed.test.ts` | Semilla idempotente, planes, permisos y plantillas de roles. |
| `unit/colombia-holidays.test.ts` | Festivos contra las listas del sistema viejo y la fecha de Pascua. |

Convención: `sqlStateOf(() => operación)` recibe una **función**, para que la consulta no empiece antes de esperarla.

## 11. Cómo cambiar el esquema
1. Edita `prisma/schema.prisma`. Si la tabla es de tenant: `tenantId` primero, `@@id([tenantId, id])` y relaciones con `fields: [tenantId, xId]`.
2. Genera la migración: `pnpm prisma migrate dev --create-only --name <cambio>` (o `migrate diff`). Revisa el SQL.
3. En la misma migración, agrega lo que Prisma no expresa:
   - `SELECT app_enable_tenant_rls('<tabla>');` si la tabla tiene `tenant_id`;
   - el trigger `set_updated_at` si tiene `updated_at`;
   - CHECKs, índices parciales y triggers de reglas;
   - privilegios, si la tabla es global o de solo inserción.
4. Agrega una `@@index` por cada FK nueva; `schema-conventions.test.ts` falla si falta.
5. Si hay índices únicos con `NULLS NOT DISTINCT` o columnas generadas, declara el índice o columna en Prisma (`map:`, `dbgenerated()`) para que no aparezca como diferencia, y recréalo en el SQL.
6. Escribe las pruebas de la regla nueva (que falle cuando debe fallar).
7. `pnpm test`, `pnpm typecheck` y verificación de diferencias (`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma` contra una BD migrada debe dar *empty migration*).
8. Actualiza este documento.

**Cuidados en PL/pgSQL (errores reales que encontraron las pruebas):**
- `loop` es palabra reservada: escribe `"loop"`.
- `current_setting(x, true)` devuelve NULL si no existe: usa `coalesce`.
- `BYPASSRLS` no se hereda: los logins usan `SET role`.

## 12. Despliegue
Orden en cada entorno:
1. **Migraciones** con el dueño del esquema: `pnpm migrate:deploy`. Crean los roles `app_runtime`/`app_platform` si no existen, y el esquema `extensions`.
2. **Logins** (una vez por entorno, lo hace la infraestructura): ver §6.3.
3. **Semilla** con el login de plataforma: `DATABASE_URL=<login plataforma> pnpm seed`.
4. Variables del API: `DATABASE_URL` (login de runtime, a través de PgBouncer en modo transacción) y `PLATFORM_DATABASE_URL` (login de plataforma, solo para los servicios de plataforma y los jobs de purga y retención). Variable del **worker**: solo `WORKER_DATABASE_URL` (login de `app_worker`); **no recibe el login de plataforma** (sin `BYPASSRLS`) y no existe en él el cliente de plataforma. El worker nunca lee `DATABASE_URL` y el API nunca lee `WORKER_DATABASE_URL` (`loadConfig(env, 'api' | 'worker')`, `DatabaseModule.forEntry`).
5. Jobs programados de plataforma:
   - `purge_processed_outbox_events('7 days')` y `purge_processed_platform_outbox_events('7 days')` diarios;
   - `purge_read_notifications('180 days')` semanal;
   - `purge_tenant()` para los tenants con `purge_after` vencido.
   - Estos jobs necesitan el login de plataforma, que el worker no tiene: los corre un **job de plataforma aparte**.

## 13. Decisiones y pendientes

### 13.1 Decididas (2026-09-30)
Todas las de `analisis.md` §0.1, más las de la revisión de integridad (`revision-bd.md`, **todas aplicadas**).

### 13.2 Tomadas por defecto, pendientes de que las confirme el negocio
| Tema | Decisión aplicada |
|---|---|
| Aprobadores por empresa | Se permiten: un grupo por (tipo, empresa) por persona; el de la empresa del ticket gana sobre el general. |
| Autoaprobación | Si el creador es su propio aprobador, pasa al siguiente de la lista; si no hay, sube un nivel (regla del motor, §8.12). |
| Reapertura | Abre una visita nueva del paso actual (no reanuda la anterior). |

### 13.3 Pendientes técnicos
- **Prisma [#30374](https://github.com/prisma/orm/issues/30374)**: **no se reproduce en 7.10.0** (2026-10-01). La prueba `apps/api/test/integration/prisma-30374.poc.test.ts` provoca errores de la BD dentro de transacciones interactivas con `@prisma/adapter-pg` (23505, 23514, 23503, 42501, 42601 y 22012; con el error lanzado, capturado y seguido de más consultas, en paralelo con otra consulta, y con la transacción vencida por tiempo), con dos tenants y 8 trabajadores en paralelo sobre pools de 1, 2 y 5 conexiones (el peor caso: la misma conexión se reutiliza justo después del error). Cada trabajador comprueba que lee de vuelta sus propios marcadores, solo las filas de su tenant y que el tenant no se queda en la conexión. Resultado: 5 corridas seguidas, 0 respuestas cruzadas.
  - **Decisión:** se fija **Prisma 7.10.0 exacta** (`@prisma/client` y `@prisma/adapter-pg`, sin `^`). Prisma 8.0 existe como release candidate solo para el CLI (`prisma@8.0.0-rc.19`, tag `latest`; `next` = `8.0.0-rc.10`), pero `@prisma/client` y `@prisma/adapter-pg` no tienen ninguna versión 8.0.x en npm (solo `8.1.0-dev.*`, tag `dev`; `latest` = 7.10.0), así que la prueba no se pudo correr contra el 8.0 RC (revisado 2026-10-01). Queda pendiente para cuando salga el 8.0 estable con sus paquetes de cliente y adaptador. Como el bug no se reproduce en 7.10.0, no se aplica la mitigación de descartar la conexión.
  - **Defensa adicional:** `TenantTransactionRunner` fija el contexto con una sola consulta que devuelve los valores fijados y compara con lo pedido; si la respuesta no coincide lanza `TenantContextMismatchError` antes de leer o escribir datos del tenant (falla cerrado).
  - **Regla:** la prueba queda en el CI. Antes de subir la versión de Prisma o del adaptador, debe pasar; si algún día falla, aplicar la mitigación (descartar la conexión ante cualquier error de BD dentro de la transacción) o no usar transacciones interactivas en las operaciones con RLS.
  - **Forma de los errores de Prisma 7.10 con el adaptador:** el SQLSTATE llega en `meta.driverAdapterError.cause.originalCode` (p. ej. `P2002` para 23505 y `P2010` para el resto); `mapDatabaseError` ya lo busca ahí. Los errores de Prisma sin SQLSTATE de regla (`P2028`, tiempo agotado) no se traducen y salen como 500.
- **Detrás de PgBouncer en modo transacción:** la prueba de concepto se hizo contra PostgreSQL directo; falta repetir la prueba de fuga con PgBouncer cuando exista el despliegue (§12). El contexto es local a la transacción, así que no debería cambiar nada.
- **`features` de los planes:** por definir con la facturación.
- **Más países:** agregar su generador de festivos en `src/holidays/` y registrarlo en `HOLIDAY_GENERATORS`.
- **Particionar** `ticket_events`, `notifications`, `audit_logs` y `outbox_events` por mes cuando el volumen lo pida (el diseño lo permite).
