# ProcesaBPM: arquitectura y organización de carpetas

> Estado: **propuesta vigente** (2026-09-30). Aplica a todo el código nuevo. Si una decisión cambia, se actualiza aquí.
> Reglas de código (inglés, tests, clean code): `CLAUDE.md`. Capa de datos: `base-de-datos.md`.

## 1. Monorepo
```
ProcesaBPM/
├── apps/
│   ├── api/              # 🚧 NestJS: API HTTP + worker. Hecho: config, database (tenant), common (errores, logger, health). Faltan los módulos de §3.1
│   └── web/              # React + Vite: la aplicación del cliente
├── packages/
│   ├── db/               # ✅ hecho: Prisma, migraciones, semilla, pruebas de BD
│   └── shared/           # 🚧 en curso: lógica de dominio pura (engine/business-time, engine/conditions, errors); falta contracts, workflow, formulas, calculators, permissions
├── docs/                 # documentación (español)
├── scripts/              # cloud-setup.sh y utilidades
├── docker-compose.yml    # desarrollo: postgres 18, minio, redis, mailpit
└── pnpm-workspace.yaml
```
**Dependencias permitidas:** `web → shared`; `api → shared, db`; `shared → (nada del proyecto)`; `db → (nada del proyecto)`. El front **nunca** importa `db` ni `api`.

## 2. `packages/shared`: el contrato y la lógica pura
```
packages/shared/src/
├── contracts/            # esquemas zod de requests/responses por dominio (tickets, workflows, …)
├── workflow/             # esquemas de config por tipo de bloque, validador del grafo antes de publicar
├── engine/               # lógica pura del motor, sin I/O:
│   ├── business-time/    #   cálculo de vencimiento y minutos hábiles (calendario, franjas, festivos, zona)
│   ├── conditions/       #   evaluador de condiciones (igual, distinto, empieza_con, contiene, en_lista, >, <, fechas)
│   ├── formulas/         #   motor de fórmulas (SUMA, DIAS_HABILES, SI…) y campo tabla
│   └── calculators/      #   calculadoras integradas (alimentación, saldo de viáticos)
├── permissions/          # acciones y sujetos CASL (tipos compartidos)
└── errors/               # ✅ errores de dominio tipados y mapeo de SQLSTATE de la BD (23001, 23514, 23503, 23505, 23P01, 42501)
```
Todo lo que se calcula en ambos lados (el SLA que ve el usuario, las fórmulas del formulario) vive **una sola vez** aquí. Así se evita lo que pasaba en el sistema viejo con `table-field.util.ts` ↔ `tableField.ts`, duplicados a mano. Pruebas: solo unitarias (`*.spec.ts`), con tablas de casos.

## 3. `apps/api`: NestJS por dominios, en capas
```
apps/api/
├── src/
│   ├── main.ts                  # entrada HTTP
│   ├── worker.ts                # entrada del worker (colas, crons, outbox)
│   ├── app.module.ts
│   ├── config/                  # variables de entorno validadas con zod (no arranca si falta una)
│   ├── common/                  # transversal: guards (JWT, políticas CASL deny-by-default),
│   │                            #   filtro de errores (mapea SQLSTATE → HTTP), paginación, logger con tenant_id
│   ├── infrastructure/          # adaptadores técnicos, sin reglas de negocio
│   │   ├── database/            #   PrismaService + extensión de contexto de tenant + helper de transacción
│   │   ├── storage/             #   StorageProvider S3-compatible (MinIO/R2)
│   │   ├── queue/               #   BullMQ + outbox dispatcher
│   │   ├── mail/                #   proveedor de correo
│   │   ├── crypto/              #   AES-256-GCM (secretos de webhooks y MFA)
│   │   └── realtime/            #   gateway Socket.IO con adaptador Redis
│   └── modules/                 # un módulo por dominio (ver lista abajo)
└── test/
    ├── integration/             # repositorios y casos de uso contra PostgreSQL real
    └── e2e/                     # HTTP de punta a punta (supertest) + test de fuga entre tenants
```

### 3.1 Módulos
| Módulo | Responsabilidad |
|---|---|
| `auth` | Login, selector de organización, JWT + refresh, recuperación, MFA, invitaciones. |
| `platform` | Alta de tenants (roles base, calendario, empresa por defecto), planes, suspensión y purga. Usa el login de plataforma. |
| `authorization` | Habilidad CASL por miembro, decoradores de permisos, guard global y acceso por registro (§9). |
| `identity` | Miembros, roles, permisos, grupos. |
| `organization` | Empresas, departamentos, cargos, sedes, calendarios. |
| `approvals` | Grupos de aprobación, delegaciones y **resolución del aprobador** (§8.12 de base-de-datos.md). |
| `catalog` | Categorías, subcategorías, prioridades. |
| `workflows` | Constructor: versiones, bloques, transiciones, campos, topes, validación y publicación. |
| `engine` | **Hecho (núcleo):** iniciar, avanzar, reasignar, tomar de un pool y cerrar; resolver responsables; recorrer los bloques automáticos; topes de monto (§14). |
| `tickets` | **Hecho (lecturas y rutas):** `GET /tickets`, detalle con autorización por registro y línea de tiempo, y las rutas de `engine` (§14). Faltan comentarios, novedades, reapertura, etiquetas y errores. |
| `sla` | **Hecho:** cálculo puro de vencimiento y cierre (`domain/clock-math.ts`), de pausas por novedad (`domain/pause-math.ts`) y el job del worker que avisa relojes vencidos. |
| `files` | **Hecho:** subida en dos fases (reservar con cuota → confirmar por primeros bytes), cuota por plan con gracia, adjuntos de tickets y campos `FILE`, descargas firmadas, purge de subidas abandonadas en el worker (§8.14 de base-de-datos.md). El puerto `ObjectStorage` y sus adaptadores (S3/MinIO e in-memory) viven en `infrastructure/storage`; las reglas puras de tipos y el sniffer en `packages/shared/src/files`. |
| `documents` | Formatos PDF, plantillas (coordenadas/AcroForm) y generación versionada. |
| `exports` | Exportaciones programadas (planos). |
| `notifications` | In-app, correo, tiempo real y preferencias. |
| `webhooks` | Suscripciones y entregas firmadas. |
| `reports` | Indicadores y exportes. |
| `audit` | Registro y consulta de auditoría. |

### 3.2 Forma interna de cada módulo
```
modules/tickets/
├── tickets.module.ts
├── http/                    # controllers + mapeo DTO ↔ caso de uso (sin lógica de negocio)
├── application/             # casos de uso / servicios: create-ticket.service.ts, close-ticket.service.ts…
├── domain/                  # reglas puras: entidades, value objects, errores tipados (sin Nest ni Prisma)
├── data/                    # repositorios Prisma (única capa que toca la BD)
└── *.spec.ts                # unit tests junto al archivo que prueban
```
Reglas:
- **Flujo:** `http → application → domain`, y `application → data`.
- **Un módulo no importa los repositorios de otro:** usa su servicio público o un evento de dominio.
- **Efectos externos** (PDF, correo, websocket, webhooks) salen por el outbox, nunca dentro de la transacción.
- **Los controllers solo declaran:** ruta, validación zod (de `shared/contracts`) y política CASL.

## 4. `apps/web`: React por funcionalidades
```
apps/web/
├── src/
│   ├── app/                     # arranque: providers (React Query, i18n, auth), router, layouts, guards
│   ├── features/                # una carpeta por funcionalidad del negocio
│   │   ├── auth/
│   │   ├── tickets/             #   bandejas, detalle, crear, responder paso
│   │   ├── workflow-builder/    #   lienzo React Flow, paleta, panel de propiedades, simulador
│   │   ├── ticket-execution/    #   vista de ejecución del flujo en el ticket
│   │   ├── administration/      #   usuarios, roles, empresas, sedes, calendarios, grupos de aprobación
│   │   ├── documents/           #   diseñador de PDF y plantillas
│   │   ├── exports/
│   │   ├── reports/
│   │   └── notifications/
│   ├── shared/
│   │   ├── ui/                  # sistema de diseño (botones, tablas, formularios, modales) + Storybook
│   │   ├── api/                 # cliente HTTP (cookies httpOnly, manejo de errores)
│   │   ├── lib/                 # formato de fechas/moneda por zona horaria, utilidades
│   │   └── hooks/
│   └── i18n/es/                 # textos visibles (español); el código queda en inglés
├── e2e/                         # Playwright
└── .storybook/
```
Forma de cada funcionalidad:
```
features/tickets/
├── api/            # hooks de React Query (useTicket, useCreateTicket…) sobre shared/contracts
├── components/     # componentes propios de la funcionalidad
├── pages/          # pantallas enrutables
├── hooks/          # lógica de UI reutilizable dentro de la funcionalidad
└── *.test.tsx      # Vitest + Testing Library junto al componente
```
Reglas:
- **Una funcionalidad no importa las carpetas internas de otra:** lo común sube a `shared/`.
- **Los datos del servidor van siempre con React Query** (sin `useEffect` para cargar).
- **Los formularios usan react-hook-form + los mismos esquemas zod del back.**
- **El HTML de usuario se sanitiza** y se aplica CSP.
- **El token de sesión nunca va a `localStorage`.**

## 5. Pruebas por capa
| Capa | Herramienta | Dónde |
|---|---|---|
| Lógica pura (`shared`, `domain/`) | Vitest | `*.spec.ts` junto al código |
| Casos de uso y repositorios | Vitest + PostgreSQL real | `apps/api/test/integration` |
| API de punta a punta (incluida la fuga entre tenants) | Vitest + supertest | `apps/api/test/e2e` |
| Componentes | Vitest + Testing Library | `*.test.tsx` junto al componente |
| Flujos completos en el navegador | Playwright | `apps/web/e2e` |
| Base de datos | Vitest + Testcontainers / `TEST_DATABASE_URL` | `packages/db/test` ✅ |
| Almacenamiento S3 | MinIO real: Testcontainers, o sin Docker `TEST_S3_ENDPOINT` (+ `TEST_S3_ACCESS_KEY`/`TEST_S3_SECRET_KEY`); `scripts/cloud-setup.sh` compila MinIO con Go (no hay binarios) y lo arranca en `:9000` | `apps/api/test/integration/files` ✅ |

## 6. Orden de construcción sugerido
1. `packages/shared` (contratos base + `business-time` + `conditions` con sus pruebas). **Hecho:** `business-time`, `conditions` y `errors` (130 pruebas unitarias); faltan los contratos zod.
2. `apps/api`: `infrastructure/database` (contexto de tenant + prueba del bug de Prisma #30374), `common/` (errores, guards), `auth` y `platform`. **Hecho:** `config/`, `infrastructure/database`, filtro de errores, logger y `/health`·`/ready`; faltan los guards, `auth` y `platform`.
3. `identity`, `organization`, `approvals`, `catalog`.
4. `workflows` + `apps/web/features/workflow-builder`.
5. `engine`, `tickets`, `sla`, `files`: el corazón del producto.
6. `documents`, `notifications`, `reports`; luego lo de la v2 (`exports`, `webhooks`…).

## 7. Cómo se accede a los datos en `apps/api` (hecho)
- `TenantContext` guarda `{ tenantId, userId }` en un `AsyncLocalStorage`. En HTTP lo fija `TenantScopeInterceptor` con el principal que verificó el guard (§8); en los jobs, quien los ejecute. Rechaza ids que no sean UUID (`InvalidTenantContextError`).
- La transacción usa `DB_TX_TIMEOUT_MS` (10 s) y `DB_TX_MAX_WAIT_MS` (5 s), y el pool del rol runtime `DB_POOL_MAX` (10); los tres son opcionales y se validan con zod.
- Todo acceso a datos de un tenant pasa por `TenantTransactionRunner.withTenantTransaction(work)`: abre una transacción, fija `app.tenant_id` y `app.user_id` como locales a la transacción, verifica que la BD los confirmó y ejecuta `work`. Sin contexto lanza `MissingTenantContextError` y no consulta nada.
- `DatabaseModule` **no exporta** `PrismaService` (el cliente del rol `app_runtime`, con `omit` de las columnas sensibles de `users`): los repositorios solo reciben el `tx` del runner.
- El cliente de plataforma (rol `app_platform`, ignora RLS) vive en `PlatformDatabaseModule` (`infrastructure/database/platform-*`), que solo importa `modules/platform` y que el worker no tiene. Se usa únicamente mediante `PlatformTransactionRunner.run(tx => …)` y toda fila se escribe con `tenant_id` explícito. `src/architecture.spec.ts` falla si otro módulo importa esos archivos.
- `AuthTransactionRunner` (solo para el módulo `auth`) abre transacciones antes de que exista un tenant: anónimas (solo las funciones `auth_*` por correo o hash) o con `app.user_id` (sus propias `refresh_sessions` y `auth_list_memberships`), siempre con `app.tenant_id` vacío.
- Pruebas: unitarias en `src/**/*.spec.ts` (proyecto `unit` de Vitest) y de integración y E2E contra PostgreSQL real en `test/integration/*.test.ts` (proyecto `integration`), con la BD de `packages/db` (`@procesabpm/db/testing`) en una base propia (`procesabpm_api_test`). `pnpm test` en la raíz corre los paquetes de uno en uno.

## 8. Autenticación (`modules/auth`, hecho)
- **Guard global deny-by-default** (`RequestAuthGuard`, el único `APP_GUARD`, §9): toda ruta exige `Authorization: Bearer <access token>` salvo las marcadas con `@Public()` (`common/auth/public.decorator.ts`). Una prueba recorre todas las rutas registradas y falla si aparece una ruta pública nueva que no esté en su lista o una protegida que no responda 401.
- En cada petición el guard verifica la firma del JWT y, en una transacción del tenant, que la cuenta y la membresía sigan `ACTIVE`, que el tenant esté `ACTIVE` (si no, 403 `TENANT_SUSPENDED`) y que la sesión `sid` no esté revocada ni vencida y sea la del tenant `tid`. Una consulta por petición; la caché vendrá después. Luego `TenantScopeInterceptor` ejecuta el handler dentro del `TenantContext` del principal; los handlers leen el principal con `@CurrentPrincipal()`.
- **Flujo:** `POST /auth/login` → lista de organizaciones + token de selección (JWT de 2 min, audiencia propia) → `POST /auth/select-tenant` (con ese token) → access token (JWT HS256 de 15 min, claims `sub`, `tid`, `sid`) + refresh token opaco en cookie `__Secure-refresh_token` (httpOnly, Secure, SameSite=Lax, Path=/auth, 14 días absolutos) → `POST /auth/refresh` (rotación obligatoria con bloqueo de fila; un token rotado que vuelve después de 10 s revoca todas las sesiones) → `POST /auth/logout`. Recuperación: `POST /auth/password-reset/request` (siempre 202) y `/confirm`; invitaciones: `POST /auth/invitations/accept`. `GET /auth/me` devuelve el perfil y la membresía actual.
- **Contraseñas:** Argon2id (19 MiB, t=2, p=1, OWASP), mínimo 10 y máximo 128 caracteres para las nuevas.
- **Contratos:** los esquemas zod de requests y responses están en `packages/shared/src/contracts/auth`; el API los aplica con `ZodValidationPipe` (400 `VALIDATION_FAILED` con las rutas de los campos, sin repetir valores).
- **Trabajo en segundo plano:** `BackgroundTasks` (`common/background`) ejecuta lo que no debe retrasar la respuesta (p. ej. la solicitud de recuperación, para no revelar si la cuenta existe); el apagado espera a que termine.
- **IP del cliente:** `TRUST_PROXY` (`configureHttpApp`, `src/http-app.ts`).
- **Rate limit:** `@RateLimit(policy)` + `RateLimitGuard`, primero por IP y luego por correo (o por token cuando no hay correo), con la interfaz `RateLimiter`; hoy en memoria (`InMemoryRateLimiter`), luego en Redis. 429 `RATE_LIMITED` con `Retry-After`.
- **Capas:** `http/` (controlador, guard, cookie) → `application/` (un servicio por caso de uso) → `domain/` (política y elegibilidad) y `data/` (repositorios; credenciales solo por funciones `auth_*`).

## 9. Autorización (`modules/authorization`, hecho)
- **Un solo guard global** (`RequestAuthGuard`): primero `AccessTokenGuard` (autenticación) y luego `PermissionGuard`. Nest no garantiza el orden de varios `APP_GUARD` de módulos distintos, así que se encadenan explícitamente: la autorización nunca corre antes de la autenticación ni sin ella.
- **Deny-by-default:** una ruta autenticada que no sea `@Public()` debe declarar `@RequirePermission(acción, sujeto)` o `@RequireAnyPermission([acciones], sujeto)`, o marcarse `@AuthenticatedOnly()` (hoy solo `GET /auth/me`). Si no declara nada, responde 403, aunque el rol sea administrador. Declaraciones que se mezclan (`@Public` con un permiso, `@AuthenticatedOnly` con un permiso, en el método o en la clase) son un **conflicto**: se rechazan con 403 en tiempo de ejecución y detienen el arranque. Una prueba recorre las rutas registradas (`common/auth/route-metadata.ts`) y fija las listas de públicas y de solo autenticadas.
- **Habilidad:** `AbilityService.forPrincipal` carga las reglas del rol de la membresía actual (`role_permissions` + `permissions`, dentro de una transacción del tenant) y construye la habilidad CASL (`@casl/prisma/runtime`, `createPrismaAbility`) para cada petición. El rol sale de la BD en cada petición (se lee junto con las comprobaciones de membresía, tenant y sesión), nunca del JWT: quien cambia de rol o es desactivado pierde el acceso en la siguiente petición. Un rol inactivo no concede nada. `roles.is_admin` no se usa: el administrador lo es por tener `manage all`.
- **Nombres:** las acciones y sujetos son los del catálogo; `manage` y `all` significan lo mismo que en CASL; ninguna acción implica otra (`read` no implica `read_all`). La BD solo guarda reglas `can`.
- **Condiciones** (`role_permissions.conditions`, jsonb): un subconjunto de `where` de Prisma con los campos que el sujeto declara en el `SubjectRegistry` y los operadores `equals`, `in` y `not`. Los marcadores `${user.id}`, `${membership.departmentId}` y `${membership.siteId}` solo valen como valor completo y se resuelven recorriendo el árbol JSON (nunca por reemplazo de texto). Cualquier cosa inesperada invalida **la regla entera**, que se descarta y se registra (`authorization.rule_dropped`): una regla nunca se amplía. Un marcador sin valor (p. ej. un miembro sin departamento) descarta la regla y nunca se vuelve `null`. Un sujeto no registrado no admite condiciones.
- **Acciones con alcance** (p. ej. `read_created` de `Ticket`): sus condiciones viven en el código (`impliedConditions` del sujeto) y se combinan con AND con las guardadas; las guardadas solo pueden restringir, nunca ampliar. El catálogo de acciones con alcance está en código (`CATALOG_SCOPED_ACTIONS`: `read_created`, `read_assigned` y `read_observed` de `Ticket`) y **falla cerrado**: una regla de esas acciones cuyo sujeto no registró su condición se descarta (si no, daría todos los registros). Un auditor lo avisa al arrancar (`authorization.scoped_action_unregistered`) y el registro rechaza registrar un sujeto dos veces. `TicketsModule` registra `Ticket` al iniciar (`onModuleInit`) con sus campos y estas acciones (§14); los tests de autorización usan además un sujeto de prueba (`TestDoc`, en `test/support`).
- **Condiciones de confianza:** `impliedConditions[acción]` también puede ser una **función** `(contexto) => condición | undefined` escrita en código: salta la lista blanca de campos y operadores (puede usar relaciones y `OR`, que las condiciones guardadas no admiten) y devolver `undefined` descarta la regla (falla cerrado). Las guardadas siguen con su plantilla estricta y se combinan con AND. El contexto trae `userId` y `membership.{departmentId, siteId, positionId}` (el cargo sale de la membresía que se lee en cada petición).
- **Acceso por registro** (`domain/record-access.ts`): `ability.can(acción, 'Ticket')` con un nombre es verdadero si existe cualquier regla, aunque sea condicional, así que **no** autoriza un registro concreto. Para eso: `canOnRecord`, `canAnyOnRecord`, `assertCanOnRecord` (lanza 403) y `accessibleWhere` para listados (devuelve `{}` solo para una regla sin condiciones, y un filtro que no coincide con nada cuando no hay regla). El registro debe traer todos los campos a los que se refieren las reglas de su tipo (si falta alguno se deniega: `{ status: { not: 'X' } }` pasaría con un registro cargado sin `status`) y se copia antes de pasarlo a CASL, que escribe en el objeto que recibe. `@CurrentAbility()` entrega la habilidad de la petición al caso de uso.
- **Caché** (`AbilityCache`, interfaz lista para Redis): guarda las reglas sin resolver por (tenant, rol) y por `roles.permissions_version` (5 min de vida y 1000 entradas, LRU). La versión llega en la consulta de membresía de cada petición; si cambió, se recargan las reglas, así que la revocación vale en la siguiente petición en todas las instancias. La habilidad resuelta, que depende del miembro, nunca se cachea. El dueño (`is_owner`) y un rol admin activo reciben `manage all` sin pasar por `role_permissions`.
- **Aprovisionamiento** (`modules/platform`): `TenantRoleProvisioner.createBaseRoles(tenantId, tx?)` crea los cuatro roles de `ROLE_TEMPLATES` con sus permisos; participa en la transacción del alta de tenant (§10).

## 10. Plataforma (`modules/platform`, hecho)
- **Quién:** solo administradores de plataforma (`platform_admins`). Sus rutas llevan `@PlatformAdminOnly()` (excluyente con `@Public`, `@AuthenticatedOnly` y `@RequirePermission`); no construyen habilidad CASL. Una prueba recorre las rutas y fija la lista de las que son de plataforma.
- **Sesión:** `POST /auth/login` (la respuesta indica `platformAdmin`) → `POST /auth/platform/select` con el token de selección → JWT de 15 min con audiencia `procesabpm:platform` y claims `sub`, `sid`, sin refresh. Cada petición llama a `auth_platform_access` (sigue siendo administrador, cuenta `ACTIVE`, sesión vigente con `active_tenant_id NULL`). Un token de tenant en una ruta de plataforma responde 403; uno de plataforma en una ruta de tenant, 401 (la audiencia no coincide). `POST /auth/platform/logout` revoca la sesión.
- **Capas:** `http/platform-tenants.controller.ts` → `application/` (`TenantSignupService` orquesta `TenantRoleProvisioner`, `TenantDefaultsProvisioner` y `TenantOwnerInviter`; `TenantStatusService`) → `data/` (repositorios `tenant`, `tenant-defaults`, `tenant-owner`, `tenant-role`, `platform-audit`) con `PlatformTransactionRunner`.
- **Alta de tenant:** `POST /platform/tenants` (`{slug, name, planCode, countryCode, owner:{email, firstName, lastName}}`), una sola transacción; el orden y lo que crea están en base-de-datos.md §8.16. El slug repetido responde 409 `TENANT_SLUG_TAKEN`; plan o país desconocidos, 422 `INVALID_REFERENCE`. La invitación se encola en el outbox de plataforma como `email.invitation`; el correo lo enviará el worker.
- **Estado:** `POST /platform/tenants/:id/suspend` y `/reactivate`; un tenant suspendido responde 403 `TENANT_SUSPENDED` a sus miembros.
- **Bitácora:** cada acción de plataforma escribe en `platform_audit_logs`.

## 11. Organización y catálogo (`modules/organization`, `modules/catalog`, hecho)
- **Forma común de cada recurso:** `GET /x` (paginado: `page`, `pageSize` ≤ 100, `search`, `includeInactive`), `GET /x/:id`, `POST /x`, `PATCH /x/:id`, `POST /x/:id/activate` y `POST /x/:id/deactivate`. Los contratos zod están en `packages/shared/src/contracts/{organization,catalog}` y la paginación en `contracts/common.ts` (`pageQuerySchema`, `Page<T>`).
- **Permisos:** listar y ver → `read`; crear → `create`; editar y activar → `update`; **desactivar → `delete`** (no hay borrado físico de configuración que se usa: desactivar es el "borrar"). Los calendarios no tienen `is_active`, así que tienen `DELETE /calendars/:id` (la BD rechaza borrar uno usado por una empresa y el calendario por defecto no se borra).
- **Aislamiento:** toda consulta lleva `tenantId` además de la RLS. Un id de otro tenant responde **404 `NOT_FOUND`** (`NotFoundError`), igual que uno inexistente, nunca 403. Una referencia en el cuerpo a un registro de otro tenant (padre de una sede, calendario de una empresa, categoría de una subcategoría, listas de visibilidad) la rechazan las FK compuestas con 422 `INVALID_REFERENCE`.
- **Empresas:** moneda y zona horaria se derivan del país si no se envían (y se vuelven a derivar al cambiar el país sin enviarlas). `POST /companies/:id/make-default` pasa la marca por defecto en una transacción (limpia la anterior y luego fija la nueva, por el índice único); la empresa por defecto no se desactiva ni una inactiva pasa a ser la por defecto (422).
- **Departamentos y cargos:** nombre único por tenant (409). Comparten `NamedRecordsService` / `NamedRecordRepository`.
- **Sedes:** `GET/PUT/DELETE /site-levels/:n` nombran los niveles 1..N sin huecos (solo se borra el último y sin sedes en él). Una sede hija queda un nivel debajo de su padre. `POST /sites/:id/move {parentId|null}` valida en el dominio (`domain/site-tree.ts`) que no haya ciclos (ni consigo misma ni bajo un descendiente) y recalcula el nivel de todo el subárbol. `GET /sites/tree` devuelve el árbol anidado (las sedes cuyo padre está inactivo y oculto aparecen en la raíz).
- **Calendarios:** `PUT /calendars/:id/working-hours/:weekday` reemplaza las franjas de un día en una operación (el solape lo rechaza la exclusión de la BD: 23P01 → `OverlapError` → 409); festivos: agregar (fecha repetida → 409), quitar, listar por año e importar los del país del calendario para un año (`ON CONFLICT DO NOTHING`, devuelve cuántos agregó). `POST /calendars/:id/preview {start, amount, unit, timeZone?}` calcula el vencimiento con `calculateDueDate` y los minutos hábiles con `businessMinutesBetween` de `shared`; la zona horaria por defecto es la del país del calendario y luego la del tenant.
- **Catálogo:** prioridades (orden y color), categorías con visibilidad por empresa y departamento (`PUT /categories/:id/visibility` reemplaza ambas listas; lista vacía = visible para todos en ese eje) y subcategorías (la categoría no cambia después de crearla; `GET /subcategories?categoryId=` lista por categoría).
- **`GET /catalog/available`** (permiso `create` o `create_for_others` sobre `Ticket`): categorías y subcategorías activas visibles para las empresas del usuario (o la que se pida con `?companyId=`, que debe ser una suya) y su departamento. Quien no tiene departamento no ve las categorías restringidas por departamento. Aún no filtra por iniciadores (va con los flujos).

## 12. Identidad y aprobaciones (`modules/identity`, `modules/approvals`, hecho)
- **Miembros** (`/members`, permisos `Membership`): listado con filtros (rol, cargo, departamento, sede, estado, texto; sin `status` se ocultan los desactivados). `POST /members/invitations` hace en una transacción `invite_user` (identidad sin contraseña, o la existente intacta), la membresía `INVITED`, sus empresas (al menos una) y el token de invitación (7 días) en el outbox de plataforma como `email.invitation`; `POST /members/:id/resend-invitation` emite otro enlace. `PATCH` cambia rol, cargo, departamento, sede y empresas (las nuevas entran antes de que salgan las viejas: la regla "un miembro activo tiene empresa" se valida al COMMIT). Las reglas del dueño y del administrador (base-de-datos.md §7) las impone la BD y llegan tipadas: 403 si quien actúa no puede dar un rol admin, 422 si se rompe la invariante del dueño. El API no acepta `isOwner`.
- **Roles** (`/roles`, `Role`): CRUD; los roles base (con `system_role`) y los que tienen miembros no se borran. `PUT /roles/:id/permissions` reemplaza la lista en una operación tras validarla (permisos del catálogo, sin repetidos y condiciones solo en sujetos registrados en el `SubjectRegistry`, bien formadas y con sus campos); el trigger sube `permissions_version`, así que el cambio llega en la siguiente petición. `GET /permissions` devuelve el catálogo agrupado por sujeto (con `acceptsConditions`).
- **Grupos** (`/groups`, `Group`): CRUD y miembros (reemplazar, agregar, quitar).
- **Aprobaciones** (`/approval-group-types`, `/approval-groups`, permisos `ApprovalGroup`): tipos (el predeterminado y los usados no se borran), grupos con tipo y empresa opcional (no cambian después), aprobadores ordenados (`PUT .../approvers`: el orden de la lista es la posición) y miembros (un grupo por (tipo, empresa) por persona: 409).
- **Delegaciones** (`/delegations`, `@AuthenticatedOnly`): cualquier miembro crea y cancela las propias; `manage Delegation` extiende a las ajenas (sin él, 404). Solapes y circulares: 409.
- **`ApproverResolver`** (`modules/approvals`, exportado para el motor): `domain/resolve-approver.ts` es una función pura sobre un `ApprovalSnapshot` (probada con tablas de casos) y `ApproverSnapshotRepository` lo carga en 3 consultas sin importar el nivel. `resolveIn(tx, …)` lanza `ApproverNotFoundError`; `diagnose` (`GET /approvals/resolve`, permiso `read ApprovalGroup`) siempre responde con la traza. Las reglas están en pendientes.md.

## 13. Constructor de flujos, backend (`modules/workflows`, `packages/shared/src/workflow`, hecho)
- **`packages/shared/workflow`** (reutilizable por el frontend): `WorkflowVersionDocument` (bloques con sus candidatos, iniciadores, SLA por empresa, firmantes y archivos; transiciones; campos; topes de monto), esquemas zod del `config` de cada tipo de bloque, de la `condition` de las transiciones (operadores de `engine/conditions`) y del `config`/`dataSource` de cada tipo de campo, `validateWorkflowGraph(doc)` y `remapVersionDocument`. Los ids son opacos: un UUID o `new:<nombre>` para lo que el lienzo acaba de dibujar, así que el validador corre sobre un lienzo sin guardar. El `config` nunca lleva ids de bloques, campos ni transiciones (solo códigos de campo e ids de registros del flujo o del tenant), de modo que copiar una versión es copiar JSON.
- **El validador** (puro y determinista; errores bloquean la publicación, advertencias no) revisa: estructura (START y END, alcanzabilidad, bloques sin salida, nombres únicos), salidas por tipo de bloque (DEFAULT en los automáticos, DECISION en los de personas, CONDITION con su DEFAULT), espejo de las reglas de la BD (matriz de `validate_transition`, etiquetas y DEFAULT únicos), asignación (modo y lo que cada modo necesita), plazos CUTOFF, bucles (sin `max_loops` = advertencia; solo bloques automáticos = error), campos (códigos únicos, dónde viven, `config`, `dataSource`, fórmulas), condiciones (campo existente y **dominador** del bloque: disponible; solo en algunos caminos: advertencia; si no, error; operador compatible con el tipo) y topes de monto (campo numérico, columnas de TABLE, bloque propio y de aprobación extra dentro de la versión). El detalle de códigos está en `rules/`.
- **API** (permisos `read` / `update` / `publish` sobre `Workflow`; crear flujos, borradores, observadores y cortes es `update`): `GET/POST/PATCH /workflows`, `POST /workflows/:id/versions` (vacío o copia de `fromVersionId`), `GET .../versions/:vid` (documento completo + validación si es borrador), `DELETE` del borrador, **`PUT .../versions/:vid/graph`** (guardar el lienzo), `GET .../validation`, `POST .../publish`, edición granular (`fields`, `amount-rules`, `steps/:id/{candidates,initiators,signers,sla-overrides,files}`) y `observers` / `cutoffs` del flujo. Un flujo nuevo nace con un borrador START → END.
- **Guardar el grafo:** una transacción; los bloques conservan su id (los campos y listas cuelgan de ellos): los del request se actualizan o crean y los que faltan se borran; las transiciones se borran y se vuelven a crear (con sus ids), lo que libera las reglas de cambio de tipo y de unicidad. Lo que ya impone la BD (reglas de transición, CHECK, FK de otro tenant) no se duplica: su error cancela todo el guardado. Un grafo con problemas **se guarda** (el lienzo es trabajo en curso); solo publicar exige uno válido.
- **Publicar:** una transacción que bloquea el flujo y luego la versión (siempre en ese orden): valida (errores → 422 `WORKFLOW_NOT_PUBLISHABLE` con la lista, sin escribir nada), archiva la publicada y publica el borrador. Dos publicaciones simultáneas: la segunda encuentra una publicada (409).
- **Edición y publicación a la vez:** toda edición de un borrador toma `FOR SHARE` sobre la fila de la versión (o `FOR UPDATE` al guardar el grafo o borrar el borrador) y comprueba que sea `DRAFT` (409 si no). Sin eso, un trigger que leyó `DRAFT` antes de que otra transacción publicara podría confirmar después y cambiar una versión publicada. Una prueba lo comprueba con dos conexiones.
- **Revisión y bloqueo de la versión:** todo lo que escribe una versión (edición granular, guardado del lienzo, publicación, borrado del borrador) toma **`FOR UPDATE`** sobre `workflow_versions` primero. Los triggers de inmutabilidad leen la fila `FOR SHARE`: una transacción que tuviera SHARE y luego actualizara la fila (subir la revisión) se bloquearía con otra igual (dos titulares de SHARE pidiendo la mejora), así que ya no existe el modo SHARE. Cada edición granular incrementa `revision` y la devuelve en el encabezado `Workflow-Revision`; `PUT .../graph` **exige** `revision` (409 `STALE_REVISION` si el lienzo se leyó antes de cualquier cambio).
- **Copiar una versión:** `remapVersionDocument` da ids nuevos (de `uuidv7()` de la BD) a pasos, transiciones, campos, topes y filas hijas, y reescribe las referencias; se copian pasos, transiciones, campos, topes de monto, candidatos, iniciadores, SLA por empresa, firmantes y archivos. No se copian: el estado de ejecución (`step_runtime_states`) ni lo que cuelga del flujo o del tenant (observadores, cortes, documentos, exportaciones, formatos PDF, webhooks, calculadoras).


## 14. Motor de tickets (`modules/engine`, `modules/tickets`, `modules/sla`, `packages/shared/src/engine`, hecho el núcleo)
- **`packages/shared`** (puro; lo reutilizan el formulario y el futuro simulador): `engine/fields` (`validateCapturedValues`, `captureFieldsFor`, normalización por tipo de campo), `engine/money` (enteros escalados, nunca flotantes), `engine/amount-rules` (`evaluateAmountRules`), `engine/routing` (`routeThroughAutomaticBlocks`: recorre `START`/`CONDITION`/`DOCUMENT`/`NOTIFICATION`/`WEBHOOK`/`EXPORT` hasta un paso con persona o el END, con tope de 100 saltos), `workflow/engine-support.ts` (lo que aún no se puede publicar), `contracts/tickets` y los errores tipados del motor (`NOT_IMPLEMENTED` 501, `FIELD_VALUES_INVALID`, `AMOUNT_LIMIT_EXCEEDED`, `INITIATOR_NOT_ALLOWED` 403, `STALE_TICKET` 409…, todos 422 salvo los indicados).
- **Forma de cada caso de uso** (`modules/engine/application`): una `withTenantTransaction`; (1) **`FOR UPDATE` de la fila del ticket** (`LockedTicketLoader`; lo único que se bloquea: el job de SLA solo bloquea relojes, así que no hay ciclos), (2) leer, (3) calcular un `TicketMutation` **sin escribir** (`SubmissionValidator`, `ArrivalPlanner`, `AssignmentResolver`, `TicketSlaService`; todo error ocurre aquí) y (4) aplicarlo (`TicketMutationApplier`) en el orden que piden las restricciones de la BD (base-de-datos.md §8.7). Las partes puras están en `domain/` (`assignment-policy`, `site-scope`, `initiator-match`, `loop-policy`, `plan`) y se prueban sin BD.
- **Versión del flujo:** `PublishedVersionReader` (exportado por `WorkflowsModule`) lee el documento de una versión `PUBLISHED` o `ARCHIVED` y lo guarda en una caché de 200 entradas con expulsión FIFO por (tenant, versión): esas versiones no cambian. Un ticket usa siempre la versión con la que nació, aunque se publique otra.
- **Outbox** (solo ids, sin PII ni secretos; idempotencia por `(tipo, eventId)`): `ticket.created`, `ticket.assigned`, `ticket.transitioned`, `ticket.closed`, `block.document|notification|webhook|export`, y `sla.overdue` (la escribe la función de BD, base-de-datos.md §6.4). El motor no escribe `notifications`, no resuelve observadores ni llama webhooks: eso lo hacen los manejadores del worker, que aún no existen (los eventos quedan `PENDING`).
- **Tickets** (`modules/tickets`): `TicketsController` (rutas en base-de-datos.md §8.6–8.7), `TicketQueriesService`, y `domain/ticket-subject.ts` con las condiciones de `Ticket` (`read_created`, `read_assigned`, `read_observed`). Los controladores solo llaman a los servicios públicos de `engine`.
- **SLA** (`modules/sla`): `domain/clock-math.ts` (`openSla`, `closeSla`) lo usa el motor; `SlaOverdueJob`/`SlaOverdueScheduler` (importados por `WorkerModule`) llaman cada minuto a `claim_overdue_sla_clocks` con `WorkerTransactionRunner` (transacción sin tenant, solo para funciones `SECURITY DEFINER` del worker).
- **Pruebas** (`apps/api/test/integration/tickets-*.e2e.test.ts`, `packages/db/test/sla-overdue-claim.test.ts`, `version-locks.test.ts`): flujo completo con aprobador por grupo, condición por monto, dos ramas y cierre automático; BLOCK/WARN/EXTRA_APPROVAL (incluido el no desviar dos veces); cada modo de asignación, selección manual con un candidato inválido, alcance de sede, pool, tomar y reasignar; SLA en horas y días hábiles con festivo, a tiempo y tarde, reinicio por reasignación, bucles y `max_loops` (reloj inyectable `TestClock`); autorización por registro, observadores en vivo, listados, línea de tiempo y fuga entre tenants; carreras (10 rondas de dos transiciones simultáneas, una consigo misma, 20 creaciones a la vez, dos que toman a la vez); cierre y error diferido de la BD (422); fijación de versión.

### 14.1 Motor de tickets, parte 2 (hecho)
- **Servicios** (`modules/engine/application`): `OpenIncidentService`/`ResolveIncidentService` (novedades), `ReopenTicketService`, `ParallelTaskService` (firmar y rechazar), `DispatchStepService` + `RandomDispatchJob`/`RandomDispatchScheduler` (worker, en `DispatchModule`, que solo importa el worker). `LockedTicketLoader` se partió en `lockForAction` (bloquea y decide el 404: cualquier asignado, del tipo que sea, o quien pueda leer) y `requireOpenVisit` (abierto y `visitId` vigente); `load` los compone. `TicketAction` ahora incluye `open_incident` y `reopen`: todas las comprobaciones de permiso se hacen contra el ticket concreto (`ticketActorOf.can`), nunca a nivel de tipo.
- **Puro y probado sin BD:** `sla/domain/pause-math.ts` (`pausePeriodsOf`, `resumeSla`), `engine/domain/{incident-policy,reopen-policy,parallel-policy,round-robin,close-policy}.ts`, y en `shared` las reglas del validador (`rules/parallel.ts`, `CLOSE_REQUIRED_WITH_EXITS`).
- **Texto enriquecido:** `infrastructure/text/rich-text.ts` (`sanitize-html` 2.17.7 fijado, lista blanca de etiquetas `p br strong b em i u s ul ol li blockquote code pre a h3 h4`, enlaces `http`/`https`/`mailto` con `rel` y `target` forzados, sin estilos ni clases, y `script style textarea noscript iframe object embed svg math template` descartados con su contenido). Se aplica a la descripción del ticket, comentarios, textos de novedad y reapertura; un comentario que queda vacío se guarda como `NULL`.
- **Worker sin usuario:** `WorkerTransactionRunner.withTenant(tenantId, …)` fija `app.tenant_id` y deja `app.user_id` vacío (la RLS se aplica igual); `withoutTenant` es solo para funciones `SECURITY DEFINER` del worker.
- **Pruebas** (`apps/api/test/integration`): `tickets-incidents` (reglas, resolución, carreras, aislamiento), `tickets-incidents-sla` (pausa que cruza noches, fines de semana y festivo; pausa después del vencimiento; dos novedades; pool; reapertura), `tickets-reopen`, `tickets-parallel` (incluidas 10 rondas de las dos últimas firmas a la vez y firma contra rechazo), `tickets-dispatch` (turnos, intervalo, pausados, dos workers a la vez, dos tenants), `tickets-close-rules`; y en `packages/db/test`: `engine-part2.test.ts`.
