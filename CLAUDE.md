# CLAUDE.md

Guía para Claude Code en este repositorio.

## Qué es
ProcesaBPM: SaaS multi-tenant de gestión de procesos, extraído del sistema de Electrocréditos (`~/dev/mesa-de-ayuda`, solo como referencia; no se migran sus datos ni se copia su esquema). Todavía está en fase de definición.

**Antes de diseñar o programar, lee `docs/analisis.md` §0.1 (decisiones) y `docs/pendientes.md`.** Si una decisión nueva cambia algo, actualiza ambos documentos.

## Decisiones clave (resumen; el detalle está en docs/analisis.md)
- **Tenancy:** PostgreSQL, una BD compartida, `tenant_id` en todas las tablas de negocio + RLS (`FORCE`, rol de app sin `BYPASSRLS`), tenant fijado con `set_config('app.tenant_id', …, true)` dentro de la transacción. `tenant_id` al inicio de PKs/UNIQUE/índices y FKs compuestas. IDs UUIDv7. Catálogo de tenants con `db_cluster` para poder mover un tenant a su propia BD (§11).
- Cada tenant tiene 1..N **empresas** (una por defecto). Un **usuario global** puede tener membresía en varios tenants.
- **Stack:** NestJS + Prisma (verificar el fix del issue #30374 antes de fijar la versión) · React + Vite + **React Flow** · Redis/BullMQ · storage S3-compatible (MinIO en dev) · imágenes Docker (`api`, `worker`, `web`, `migrate`).
- **Flujos:** constructor visual al estilo del de Truora (§13), con versiones borrador/publicada inmutables y bloques de condición automática.
- **Aprobaciones:** grupos de aprobación explícitos ("X aprueba a Y, Z"), con tipo (un grupo por tipo por usuario), suplentes, delegaciones y multinivel. Sin organigrama por cargo (§10).
- **SLA:** horas o días hábiles con calendario (franjas, festivos, zona horaria) por empresa. En días vence al final de la jornada. Una novedad pausa el reloj; la reasignación y los bucles lo reinician. Los reportes miden al responsable y el paso total (§8).
- **Archivos:** tabla `archivo` + vínculos, clave de storage inmutable, nunca sobrescribir (versiones), 4 MB por archivo / 15 archivos y 20 MB por envío, PDF/imágenes/Office/ZIP (sin SVG), sin antivirus por ahora, se guardan siempre, cuota por plan con 5 % de gracia (§7).
- **PDF:** diseñador de formatos + PDF subido con coordenadas y/o campos AcroForm.

## Reglas obligatorias (pedidas por el usuario, 2026-09-30)
- **Todo lo que se construye va en inglés:** base de datos (tablas, columnas, enums, políticas, funciones), código (nombres de variables, clases, archivos, rutas de API), comentarios de código, tests y mensajes de commit. Solo quedan en español los textos que ve el usuario final (vía i18n) y los documentos de `docs/`.
- **Todo con tests:** unit tests para la lógica (servicios, motor de flujos, SLA, fórmulas, validaciones) **y** pruebas grandes, es decir de integración contra PostgreSQL/Redis/MinIO reales en contenedores y E2E del API y del frontend. Ninguna funcionalidad se da por terminada sin sus tests pasando. Siempre hay un test de fuga entre tenants.
- **Buenas prácticas y clean code:** nombres claros, funciones pequeñas con una sola responsabilidad, sin duplicación, capas separadas (controller → service → repository), dependencias explícitas, errores tipados, sin código muerto ni comentarios obvios, y SOLID donde aporte.

## Uso de modelos (obligatorio)
- La sesión que construye puede correr con **Sonnet**. Para las **partes críticas**, delega en un subagente con **Opus** (herramienta Agent con `model: "opus"`):
  - el diseño de la solución antes de programar;
  - el código o la revisión final, cuando un error sale caro.
- **Partes críticas:**
  - autenticación, sesiones, tokens y secretos;
  - autorización y permisos (CASL);
  - aislamiento entre tenants y acceso a datos;
  - cambios de esquema o migraciones de la BD;
  - motor de flujos (`engine`) y cálculo de SLA;
  - cuota y manejo de archivos.
- **Lo demás va con Sonnet,** sin subagentes: catálogos y CRUD de administración, pantallas, reportes, documentación y pruebas de casos ya diseñados.
- En el PR, indica qué partes se hicieron o revisaron con Opus.

## Flujo de trabajo con git (obligatorio)
- **Nunca se trabaja ni se hace push directo a `main`.** `main` siempre compila y tiene todas las pruebas en verde.
- **En Claude Code en la nube:** cada sesión trabaja y sube a su rama asignada `claude/<nombre>`, una sesión por funcionalidad. Las ramas `feat/...` quedan para el trabajo local. Todo lo demás del flujo se mantiene (PR hacia `main`, sin mergear, squash al aprobar).
- **Una rama por funcionalidad o corrección**, creada desde `main` actualizado y de vida corta (idealmente menos de 2–3 días de trabajo):
  - `feat/<modulo>-<descripcion>` (p. ej. `feat/api-auth-login`, `feat/web-workflow-builder-canvas`)
  - `fix/<descripcion>`, `refactor/<descripcion>`, `docs/<descripcion>`, `test/<descripcion>`, `chore/<descripcion>`
- **Commits pequeños en inglés con Conventional Commits:** `feat(tickets): close ticket with pending signatures check`. Cada commit compila.
- **Al terminar:** `pnpm test` y `pnpm typecheck` en verde, documentación actualizada (`docs/`), push de la rama y **Pull Request hacia `main`** con:
  - qué cambia y por qué;
  - cómo se probó;
  - las decisiones que el usuario debe confirmar.
- **Revisión automática:** cada PR (no borrador) lo revisa otro agente (`.github/workflows/claude-review.yml`) contra estas reglas y deja comentarios en línea y un veredicto. Atiende sus comentarios bloqueantes con nuevos commits en la misma rama antes de pedir el merge.
- **El agente no mergea a `main`:** el usuario revisa y aprueba el PR. Merge con **squash**, y se borra la rama.
- Si `main` avanzó mientras tanto: `git rebase origin/main` en la rama (no merges de main hacia la rama) y volver a correr las pruebas.
- Un PR = un tema. Si aparece otro problema, va en otra rama/PR.

## Estructura y comandos
- **Organización de carpetas y capas de `apps/api`, `apps/web` y `packages/shared`: `docs/arquitectura.md`** (léelo antes de crear código nuevo).
- Monorepo pnpm: `packages/db` (**terminado**: esquema Prisma, 3 migraciones, semilla, 109 pruebas), `packages/shared` (en curso: motor de SLA, condiciones y errores de dominio) y `apps/api` (en curso: base con acceso a datos por tenant; sigue la autenticación). Falta `apps/web`. El estado detallado está en `docs/pendientes.md`.
- **Antes de tocar datos o escribir el API, lee `docs/base-de-datos.md`**, sobre todo §8 "Contrato para el API": contexto por transacción, columnas sensibles de `users` (Prisma `omit`), funciones `auth_*`, secuencia de creación y avance de tickets, y reglas de aprobadores.
- La BD impone reglas de negocio (versiones publicadas inmutables, máquina de estados del ticket, coherencia ticket ↔ versión, historial de solo inserción). No las dupliques ni las evites en el API; traduce sus códigos de error (§7).
- Cambiar el esquema: sigue la lista de `docs/base-de-datos.md` §11 (RLS con `app_enable_tenant_rls`, índice por FK, pruebas, cero diferencias con Prisma).
- Desde `packages/db`: `pnpm test` (Vitest + Testcontainers, PostgreSQL 18 real; requiere Docker), `pnpm typecheck`, `pnpm validate`, `pnpm generate`, `pnpm migrate:deploy`, `pnpm seed`.
- En las pruebas, `sqlStateOf(() => operación)` recibe una función (nunca una promesa ya iniciada).
- **Al iniciar una sesión en la nube**, antes de cualquier otra cosa: `pnpm install --frozen-lockfile && pnpm --filter @procesabpm/db generate` (el script del entorno solo instala PostgreSQL 18 y pnpm, porque corre antes de que el repo esté disponible). Si PostgreSQL no responde: `sudo pg_ctlcluster 18 main start` (o sin `sudo` si eres root).
- **En Claude Code en la nube (sin Docker):** el entorno ejecuta `scripts/cloud-setup.sh` y define `TEST_DATABASE_URL`; `pnpm test` usa entonces el PostgreSQL 18 local. Si `TEST_DATABASE_URL` no está definida, las pruebas intentan Docker.
- pnpm 11 con `minimumReleaseAge`: no desactivarlo; las excepciones quedan en `pnpm-workspace.yaml`.

## Convenciones
- Idioma: ver las reglas obligatorias de arriba (identificadores en inglés; UI y documentos en español).
- TypeScript estricto, sin `any`. Validación con zod compartida en `packages/shared`.
- Autorización deny-by-default y por registro (CASL con condiciones). Nunca SQL interpolado.
- Nada de estado en disco local ni efectos externos (archivos, correos, PDFs) dentro de transacciones de BD: usar outbox + worker.
