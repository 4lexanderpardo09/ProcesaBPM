# @procesabpm/db

Database layer of ProcesaBPM: Prisma schema, SQL migrations (RLS, roles, business-rule
triggers), global catalog seed and the integration test suite.

The full reference, written in Spanish for the team, is [`docs/base-de-datos.md`](../../docs/base-de-datos.md).
Read its §8 ("Contrato para el API") before writing data-access code.

## Commands
| Command | Purpose |
|---|---|
| `pnpm validate` | Validate `prisma/schema.prisma` |
| `pnpm generate` | Generate Prisma Client into `src/generated/prisma` |
| `pnpm migrate:deploy` | Apply migrations (`DATABASE_URL` = schema owner) |
| `pnpm seed` | Load the global catalog (`DATABASE_URL` = a login of `app_platform`) |
| `pnpm test` | Integration + unit tests against a real PostgreSQL 18 (Docker required) |
| `pnpm typecheck` | TypeScript strict check |

## Layout
- `prisma/schema.prisma`: models (tenant tables use composite keys `(tenant_id, id)`).
- `prisma/migrations/`: `init` (generated), `security_and_constraints`, `integrity_rules`.
- `src/holidays/`: public-holiday generators per country.
- `src/seed/`: global catalog, role templates, seed CLI.
- `test/`: integration suites, `test/unit/` for pure logic, `test/support/` for the container, pools and fixtures.
