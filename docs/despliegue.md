# Despliegue

Guía para construir y ejecutar ProcesaBPM con Docker. Las imágenes, el script de humo y el ejemplo de Compose de este repositorio están **probados** (se construyen y arrancan en el CI de cada PR); el entorno de producción en sí (proveedor, dominio, proxy, respaldos) está por definir (§10).

## 1. Qué se construye

Un solo `Dockerfile` con tres destinos (`--target`):

| Imagen | Destino | Qué hace | Credencial de BD que recibe |
|---|---|---|---|
| `procesabpm-api` | `api` | API HTTP (puerto 3000) | `DATABASE_URL` (login de `app_runtime`) y `PLATFORM_DATABASE_URL` (login de `app_platform`, solo para el alta de tenants) |
| `procesabpm-worker` | `worker` | Cola de eventos (outbox), correos, PDF, alertas de SLA, despertar de bloques `WAIT`, despacho aleatorio, purga de archivos | `WORKER_DATABASE_URL` (login de `app_worker`) |
| `procesabpm-migrate` | `migrate` | `prisma migrate deploy` (por defecto) y la carga del catálogo global (`node seed/seed.js`) | `DATABASE_URL` del **dueño del esquema** (migraciones) o del login de `app_platform` (catálogo) |

El frontend (`apps/web`) todavía no existe: no hay imagen web.

### Cómo se construyen
- **Etapa `build`:** instala dependencias con `pnpm install --frozen-lockfile` (versiones del `pnpm-lock.yaml`), genera el cliente de Prisma y empaqueta con **esbuild** (`pnpm build` → `scripts/bundle.mjs`) el API, el worker y la carga del catálogo en módulos ES de `dist/`. Los paquetes del monorepo (`shared`, `db`) exportan TypeScript, por eso se empaquetan; las dependencias de terceros quedan **externas**.
- **Dependencias de producción:** `pnpm deploy --prod` copia solo las dependencias de producción de cada paquete, desde el lockfile (los módulos nativos, como argon2, se compilan para la imagen). `@prisma/client` declara la CLI de Prisma como dependencia par y el lockfile la resuelve, así que se **elimina** de la imagen del API (la CLI, studio, typescript, react…: más de 150 MB comprimidos); la imagen `migrate` sí lleva la CLI (paquete `packages/migrate`, solo un `package.json`).
- **Imagen base:** `node:24.21.0-bookworm-slim` fijada por versión **y digest** (un tag puede moverse, un digest no). Para actualizarla se cambian los dos valores del `ARG NODE_IMAGE`. No se usa distroless: el worker y los módulos nativos necesitan glibc, y `slim` permite depurar con `docker exec`.
- **Usuario no root** (`node`, uid 1000); los archivos de la aplicación son de `root` y de solo lectura para el proceso. El sistema de archivos puede ir de **solo lectura** (`read_only: true` + `tmpfs: /tmp`): el API y el worker no escriben en disco; Prisma y Node usan `HOME=/tmp`.
- **Fuentes del PDF:** `apps/api/assets/fonts` (Noto Sans, OFL) va dentro de las imágenes `api` y `worker`; `PDF_FONT_DIR=/app/assets/fonts` ya está fijado en la imagen.
- **`.dockerignore`:** deja fuera `.git`, `.env*`, pruebas (`**/test`, `*.spec.ts`), `docs`, `node_modules` y `dist` locales y los archivos de Compose; el script de humo comprueba que ninguna imagen lleva `.env`, pruebas, `.ts` (salvo `prisma.config.ts`) ni `.git`.

```bash
docker build --target api     -t procesabpm-api .
docker build --target worker  -t procesabpm-worker .
docker build --target migrate -t procesabpm-migrate .
# Detrás de un proxy que intercepta TLS (opcional): --secret id=extra-ca,src=/ruta/ca.pem
```

## 2. Credenciales: roles de BD y secretos

Cada servicio entra con **su** login, que se ejecuta como su rol de aplicación (`BYPASSRLS` no se hereda por pertenecer a un rol, por eso cada login lleva `ALTER ROLE … SET role`). Ver `docs/base-de-datos.md` §6.3.

| Login | Rol | Lo usa | Puede |
|---|---|---|---|
| dueño del esquema (p. ej. `procesabpm_owner`) | dueño de los objetos | **solo** la imagen `migrate` | crear y modificar el esquema; la aplicación nunca lo usa |
| `procesabpm_api` | `app_runtime` | `api` (`DATABASE_URL`) | leer y escribir datos de negocio sujeto a RLS |
| `procesabpm_worker` | `app_worker` | `worker` (`WORKER_DATABASE_URL`) | lo mismo que `app_runtime` y, además, reclamar y completar eventos del outbox |
| `procesabpm_platform` | `app_platform` (`BYPASSRLS`) | `api` (`PLATFORM_DATABASE_URL`, solo `modules/platform`) y la carga del catálogo | alta de tenants, purgas, catálogo global; **el worker nunca lo recibe** |

- `deploy/roles.sql` crea los tres logins con sus contraseñas (variables de `psql`) y es **idempotente**: se vuelve a ejecutar cuando cambia una contraseña. El CI lo ejecuta dos veces.
- **Las credenciales llegan por variables de entorno o secretos del orquestador, nunca dentro de la imagen** (ninguna imagen contiene un `.env`). En Compose o Kubernetes, usa secretos y no las escribas en el archivo; `deploy/example.env` solo muestra los nombres. Genera cada secreto con `openssl rand -base64 48`.
- `JWT_SECRET` (firma de los tokens de acceso) y `OUTBOX_TOKEN_KEY` (deriva los tokens de los enlaces de correo; solo el worker) son distintos y de al menos 32 bytes. Rotarlos invalida las sesiones y los enlaces pendientes.
- **Dueño del esquema: se probó con un superusuario.** Las migraciones crean roles (algunos con `BYPASSRLS`) y cambian dueños de funciones, así que hoy el dueño debe ser superusuario (o un rol con permisos equivalentes). En una base administrada sin superusuario (RDS, Cloud SQL…) hay que crear antes los cuatro roles `NOLOGIN` y dar al dueño las membresías y permisos necesarios; **no está probado** (§10).

## 3. Variables de entorno

Las obligatorias son las que no tienen valor por defecto. Un valor inválido o faltante impide arrancar y el error nombra la variable.

### API (`procesabpm-api`)
| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `LOG_LEVEL` | sí | | `debug`, `info`, `warn` o `error`; salida JSON por línea |
| `PORT` | sí (la imagen fija `3000`) | `3000` | Puerto HTTP |
| `NODE_ENV` | sí (la imagen fija `production`) | `production` | |
| `DATABASE_URL` | sí | | Login de `app_runtime` |
| `PLATFORM_DATABASE_URL` | sí | | Login de `app_platform` |
| `JWT_SECRET` | sí | | ≥ 32 bytes |
| `TRUST_PROXY` | no | `false` | `false`, número de proxies delante del API (`1`) o lista de direcciones/CIDR separadas por comas. Del cliente IP dependen los límites de intentos y las sesiones; `true` se rechaza |
| `DB_POOL_MAX` | no | `10` (máx. 200) | Conexiones del API a la BD |
| `DB_TX_TIMEOUT_MS` | no | `10000` (máx. 120000) | Duración máxima de una transacción; también `statement_timeout` de la BD |
| `DB_TX_MAX_WAIT_MS` | no | `5000` (máx. 60000) | Espera máxima de una conexión libre del pool |
| `DB_LOCK_TIMEOUT_MS` | no | `5000` (máx. 60000) | Espera máxima de un bloqueo de fila: pasada, la BD cancela y el API responde **503** `TEMPORARILY_UNAVAILABLE` con `Retry-After: 1` |
| `STORAGE_ENDPOINT` | sí | | URL S3 compatible (R2, S3, SeaweedFS…) |
| `STORAGE_BUCKET` | sí | | ≥ 3 caracteres; el bucket debe existir |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | sí | | |
| `STORAGE_REGION` | no | `us-east-1` | |
| `STORAGE_FORCE_PATH_STYLE` | no | `false` | `true` para SeaweedFS y MinIO |
| `STORAGE_PUBLIC_ENDPOINT` | no | | Dirección con la que los navegadores llegan al almacenamiento, si es otra (URL prefirmadas) |
| `PDF_FONT_DIR` | no | `/app/assets/fonts` (en la imagen) | |

### Worker (`procesabpm-worker`)
Además de `LOG_LEVEL`, `NODE_ENV`, `DB_*` y `STORAGE_*` (iguales a los del API):

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `WORKER_DATABASE_URL` | sí | | Login de `app_worker` |
| `PORT`, `JWT_SECRET` | sí (hoy) | | La configuración compartida los exige aunque el worker no los usa (§10) |
| `WEB_BASE_URL` | sí | | Dirección de la aplicación web; los enlaces de los correos se construyen con ella. En producción debe ser `https://` |
| `OUTBOX_TOKEN_KEY` | sí | | ≥ 32 bytes |
| `MAIL_TRANSPORT` | no | `smtp` | `smtp` o `memory` (esta última se rechaza en producción) |
| `SMTP_HOST` | sí con `smtp` | | |
| `SMTP_PORT` | no | `1025` | |
| `SMTP_SECURE` | no | `false` | `true` para TLS implícito (465) |
| `SMTP_USER` / `SMTP_PASSWORD` | no | | Van juntas; un valor vacío se rechaza (no las declares si no las usas) |
| `MAIL_FROM` | no | `ProcesaBPM <no-reply@procesabpm.local>` | |
| `MAIL_MESSAGE_ID_DOMAIN` | no | `procesabpm.local` | |
| `OUTBOX_POLLING_ENABLED` | no | `true` | |
| `OUTBOX_POLL_INTERVAL_MS` | no | `2000` | |
| `OUTBOX_BATCH_SIZE` | no | `10` (máx. 500) | Eventos reclamados por ronda |
| `OUTBOX_CONCURRENCY` | no | `4` (máx. 64) | Eventos en paralelo |
| `OUTBOX_TX_TIMEOUT_MS` | no | `30000` | Tope de la transacción de un evento; el arranque rechaza combinaciones que sobrepasen el arrendamiento de 5 min |
| `PDF_RENDER_TIMEOUT_MS` | no | `30000` (máx. 120000) | |
| `PDF_MAX_OUTPUT_BYTES` | no | 20 MB (máx. 50 MB) | |

### `migrate`
| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Login del dueño del esquema (migraciones) o de `app_platform` (`node seed/seed.js`) |

## 4. Orden de arranque

1. **Base de datos** disponible (y el bucket creado).
2. **`migrate`** con el login del dueño: aplica las migraciones pendientes y termina. Es un trabajo de una sola ejecución por despliegue (Compose: `service_completed_successfully`; Kubernetes: `Job` o `initContainer`/hook previo).
3. **Logins** (`deploy/roles.sql`) con un administrador.
4. **Catálogo global** (`node seed/seed.js`, login de `app_platform`): permisos, planes, países, festivos. Es idempotente: puede correr en cada despliegue.
5. **`api` y `worker`**, en cualquier orden; el API responde `/ready` cuando alcanza la BD.

`docker-compose.prod.example.yml` implementa exactamente esa cadena (`postgres → migrate → roles → seed → api, worker`). Es una **guía**, no algo para correr tal cual: sustituye Postgres, almacenamiento y correo por servicios administrados, pon un proxy con TLS delante del API y fija versiones reales de las imágenes.

## 5. Migrar

- Las migraciones solo avanzan; no hay migraciones inversas. Antes de migrar en producción, **respaldo** de la BD.
- Despliega `migrate` antes de las versiones nuevas de `api` y `worker`. Mientras corren las versiones viejas, el esquema nuevo debe seguir funcionando para ellas: escribe las migraciones en dos pasos (agregar, luego quitar) cuando haga falta.
- Una migración fallida deja la BD en estado «fallida» (Prisma `P3009`): hay que resolverla a mano (`prisma migrate resolve`) antes de reintentar. No reintentes a ciegas.
- `docker run --rm -e DATABASE_URL=… procesabpm-migrate` aplica; `… node seed/seed.js` carga el catálogo.

## 6. Salud y apagado ordenado

- **API:** `GET /health` (vivo; no toca la BD) y `GET /ready` (listo; comprueba la BD). El `HEALTHCHECK` de la imagen usa `/health`, para que una caída de la BD no reinicie el API en bucle; usa **`/ready` como sondeo de disponibilidad** del balanceador u orquestador.
- **Worker:** no abre puertos; el orquestador vigila el proceso (`restart: unless-stopped`) y los registros.
- **SIGTERM:** ambos procesos cierran de forma ordenada. El worker deja de reclamar eventos y **termina el lote en curso** (o, si no alcanza, los eventos reclamados se liberan solos al vencer su arrendamiento de 5 min y otro worker los toma); el API termina las peticiones abiertas. Salen con código 143 (Nest vuelve a lanzar la señal tras cerrar): es una parada limpia, 137 (`SIGKILL`) no.
- Usa `init: true` (o `docker run --init`) y **`stop_grace_period` ≥ 120 s para el worker** y 30 s para el API; con menos, Docker mata un lote en curso.

## 7. Escalar

- **API:** sin estado; se escala en réplicas detrás de un balanceador. Las sesiones viven en la BD.
- **Worker:** se escala añadiendo réplicas. Son seguras en paralelo: los eventos se reclaman con `SKIP LOCKED` y arrendamiento, y los trabajos programados (alertas de SLA, despertar de `WAIT`, despacho aleatorio, purga) se reparten en la BD de forma que cada elemento se procesa una sola vez. Más réplicas o más `OUTBOX_CONCURRENCY` suben el rendimiento de correos y PDF; el dibujo del PDF corre dentro del proceso del worker (CPU y memoria).
- **Conexiones:** cada proceso abre un pool de `DB_POOL_MAX` (10) conexiones, y el API además un pequeño pool de plataforma. El total (réplicas × pool) debe quedar por debajo de `max_connections` de Postgres. Con muchas réplicas conviene PgBouncer (§10).

## 8. Endurecimiento recomendado
`read_only: true` con `tmpfs: /tmp`, `cap_drop: [ALL]`, `no-new-privileges`, `init: true`, usuario no root (ya viene en la imagen), el API detrás de un proxy con TLS (`TRUST_PROXY` con el número de proxies), la BD y el almacenamiento solo en la red interna. El script de humo ejecuta los tres servicios con ese endurecimiento.

## 9. CI y prueba de humo

El trabajo `Docker images` de `.github/workflows/ci.yml` (en cada PR, sin publicar nada): construye los tres destinos con `buildx` y la caché de GitHub Actions y ejecuta `scripts/smoke-images.sh`, que
1. comprueba que las imágenes no corren como root, no llevan `.env`, pruebas ni código fuente y que las fuentes del PDF están;
2. levanta un PostgreSQL 18, aplica las migraciones con la imagen `migrate`, crea los logins con `deploy/roles.sql` (dos veces) y carga el catálogo (dos veces);
3. arranca el API (solo lectura, sin capacidades) y espera `/health`, `/ready` y el estado `healthy` del contenedor;
4. arranca el worker, espera el registro «Worker started», lo detiene con SIGTERM y comprueba la parada ordenada; luego detiene el API;
5. el mismo trabajo valida `docker-compose.prod.example.yml` con `docker compose config`.

Localmente: `docker build` de los tres destinos y `scripts/smoke-images.sh` (usa `API_IMAGE`, `WORKER_IMAGE`, `MIGRATE_IMAGE` si los nombres cambian).

## 10. Pendientes
- **PgBouncer** (o el pooler del proveedor): modo transacción es compatible con la forma de trabajar (`set_config(..., true)` dentro de la transacción); falta probarlo y fijar el tamaño de los pools.
- **Almacenamiento (R2/S3):** el código usa el SDK de S3 con endpoint configurable y está probado con SeaweedFS; falta probar contra Cloudflare R2 (URL prefirmadas, `STORAGE_PUBLIC_ENDPOINT`, CORS del bucket) y decidir el proveedor.
- **Proveedor de correo:** hoy SMTP genérico (`SMTP_*`); falta elegir el proveedor (Resend, SES, Brevo), configurar SPF/DKIM/DMARC del dominio y, si se desea, un transporte por API.
- **Dueño del esquema sin superusuario** (bases administradas): falta definir y probar los permisos mínimos (§2).
- **El worker exige `PORT` y `JWT_SECRET`** sin usarlos (configuración compartida): menor privilegio pide quitárselos; entra con la tarea de seguridad (#17).
- **Healthcheck del worker:** hoy solo se vigila el proceso; un latido (archivo o puerto interno) permitiría detectar un worker colgado.
- **Registro de imágenes, firma y escaneo de vulnerabilidades:** el CI construye pero no publica; falta decidir el registro, firmar las imágenes (cosign) y escanearlas (Trivy), y automatizar la actualización del digest de la imagen base.
- **Imagen web:** llega con `apps/web`.
- **Observabilidad:** métricas, trazas y alertas (el registro JSON ya incluye `requestId`).
- **Respaldos y recuperación** de la BD y del bucket, y la retención de datos de un cliente que se va (analisis.md §12).
