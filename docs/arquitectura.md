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
| `identity` | Miembros, roles, permisos, grupos. |
| `organization` | Empresas, departamentos, cargos, sedes, calendarios. |
| `approvals` | Grupos de aprobación, delegaciones y **resolución del aprobador** (§8.12 de base-de-datos.md). |
| `catalog` | Categorías, subcategorías, prioridades. |
| `workflows` | Constructor: versiones, bloques, transiciones, campos, topes, validación y publicación. |
| `engine` | Ejecución: iniciar, transicionar, resolver responsables, ejecutar bloques automáticos. |
| `tickets` | Consultas y listados, comentarios, novedades, cierre, reapertura, etiquetas, errores. |
| `sla` | Visitas, relojes, pausas, alertas de vencimiento. |
| `files` | Subida en dos fases, cuota, descargas firmadas. |
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
- `PlatformPrismaService` (rol `app_platform`, ignora RLS) se exporta aparte y solo lo inyectan los servicios de plataforma.
- `AuthTransactionRunner` (solo para el módulo `auth`) abre transacciones antes de que exista un tenant: anónimas (solo las funciones `auth_*` por correo o hash) o con `app.user_id` (sus propias `refresh_sessions` y `auth_list_memberships`), siempre con `app.tenant_id` vacío.
- Pruebas: unitarias en `src/**/*.spec.ts` (proyecto `unit` de Vitest) y de integración y E2E contra PostgreSQL real en `test/integration/*.test.ts` (proyecto `integration`), con la BD de `packages/db` (`@procesabpm/db/testing`) en una base propia (`procesabpm_api_test`). `pnpm test` en la raíz corre los paquetes de uno en uno.

## 8. Autenticación (`modules/auth`, hecho)
- **Guard global deny-by-default** (`AccessTokenGuard`, `APP_GUARD`): toda ruta exige `Authorization: Bearer <access token>` salvo las marcadas con `@Public()` (`common/auth/public.decorator.ts`). Una prueba recorre todas las rutas registradas y falla si aparece una ruta pública nueva que no esté en su lista o una protegida que no responda 401.
- En cada petición el guard verifica la firma del JWT y, en una transacción del tenant, que la cuenta y la membresía sigan `ACTIVE`, que el tenant esté `ACTIVE` (si no, 403 `TENANT_SUSPENDED`) y que la sesión `sid` no esté revocada ni vencida y sea la del tenant `tid`. Una consulta por petición; la caché vendrá después. Luego `TenantScopeInterceptor` ejecuta el handler dentro del `TenantContext` del principal; los handlers leen el principal con `@CurrentPrincipal()`.
- **Flujo:** `POST /auth/login` → lista de organizaciones + token de selección (JWT de 2 min, audiencia propia) → `POST /auth/select-tenant` (con ese token) → access token (JWT HS256 de 15 min, claims `sub`, `tid`, `sid`) + refresh token opaco en cookie `__Secure-refresh_token` (httpOnly, Secure, SameSite=Lax, Path=/auth, 14 días absolutos) → `POST /auth/refresh` (rotación obligatoria con bloqueo de fila; un token rotado que vuelve después de 10 s revoca todas las sesiones) → `POST /auth/logout`. Recuperación: `POST /auth/password-reset/request` (siempre 202) y `/confirm`; invitaciones: `POST /auth/invitations/accept`. `GET /auth/me` devuelve el perfil y la membresía actual.
- **Contraseñas:** Argon2id (19 MiB, t=2, p=1, OWASP), mínimo 10 y máximo 128 caracteres para las nuevas.
- **Contratos:** los esquemas zod de requests y responses están en `packages/shared/src/contracts/auth`; el API los aplica con `ZodValidationPipe` (400 `VALIDATION_FAILED` con las rutas de los campos, sin repetir valores).
- **Trabajo en segundo plano:** `BackgroundTasks` (`common/background`) ejecuta lo que no debe retrasar la respuesta (p. ej. la solicitud de recuperación, para no revelar si la cuenta existe); el apagado espera a que termine.
- **IP del cliente:** `TRUST_PROXY` (`configureHttpApp`, `src/http-app.ts`).
- **Rate limit:** `@RateLimit(policy)` + `RateLimitGuard`, primero por IP y luego por correo (o por token cuando no hay correo), con la interfaz `RateLimiter`; hoy en memoria (`InMemoryRateLimiter`), luego en Redis. 429 `RATE_LIMITED` con `Retry-After`.
- **Capas:** `http/` (controlador, guard, cookie) → `application/` (un servicio por caso de uso) → `domain/` (política y elegibilidad) y `data/` (repositorios; credenciales solo por funciones `auth_*`).
