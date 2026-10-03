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

- `deploy/roles.sql` crea los tres logins con sus contraseñas (variables de `psql`) y es **idempotente**: se vuelve a ejecutar cuando cambia una contraseña. El CI lo ejecuta dos veces. También repara un login creado a mano (`LOGIN` y pertenencia a su rol).
- **Las credenciales llegan por variables de entorno o secretos del orquestador, nunca dentro de la imagen** (ninguna imagen contiene un `.env`). En Compose o Kubernetes, usa secretos y no las escribas en el archivo; `deploy/example.env` solo muestra los nombres. Genera las contraseñas de BD con `openssl rand -hex 32` (van dentro de URL de conexión: base64 puede producir `/` o `+` y romperla) y los demás secretos con `openssl rand -base64 48`. `deploy/roles.sql` lee las contraseñas del entorno (no de la línea de comandos) y apaga el registro de sentencias de su sesión.
- `JWT_SECRET` (firma de los tokens de acceso) y `OUTBOX_TOKEN_KEY` (deriva los tokens de los enlaces de correo; solo el worker) son distintos y de al menos 32 bytes. Rotarlos invalida las sesiones y los enlaces pendientes.
- `MFA_ENCRYPTION_KEYS` (llaves AES-256 con las que se cifran los secretos TOTP; solo el API). Guárdala en el gestor de secretos **con copia de respaldo**: si se pierde, ningún TOTP se puede verificar (los códigos de respaldo siguen sirviendo). Los respaldos de la BD solos no sirven para descifrar nada.

#### Rotar la llave de MFA
1. Genera otra: `echo "k$(date +%Y%m):$(openssl rand -base64 32)"`.
2. Despliega con `MFA_ENCRYPTION_KEYS="nueva:…,vieja:…"` (**la primera cifra**, todas descifran). Las altas nuevas usan la nueva, y cada verificación correcta de un TOTP cifrado con una llave vieja lo vuelve a cifrar con la primera.
3. Cuando ninguna fila use la vieja, quítala. Consulta, como dueño del esquema:
   ```sql
   SELECT convert_from(substring(mfa_secret_encrypted FROM 3 FOR get_byte(mfa_secret_encrypted, 1)), 'UTF8') AS key_id, count(*)
   FROM users WHERE mfa_secret_encrypted IS NOT NULL GROUP BY 1;
   ```
   Si quitas una llave antes de tiempo, el TOTP de esas personas falla con 500 (`auth.mfa_secret_undecryptable` en el registro); sus códigos de respaldo siguen sirviendo.
- **Reloj:** el TOTP tolera ±30 s de diferencia. Los servidores del API deben sincronizar la hora (NTP/chrony).
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
| `MFA_ENCRYPTION_KEYS` | sí | | Llaves AES-256 con las que se cifran los secretos TOTP, `id:base64` separadas por comas (32 bytes cada una, p. ej. `echo "k$(date +%Y%m):$(openssl rand -base64 32)"`). La primera cifra y todas descifran. Solo el API la recibe; el worker no. Ver «Rotar la llave de MFA» |
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

`docker-compose.prod.example.yml` implementa exactamente esa cadena (`postgres → migrate → roles → seed → api, worker`). Es una **guía**, no algo para correr tal cual (el CI solo valida su sintaxis con `docker compose config`; la cadena completa se probó a mano): sustituye Postgres, almacenamiento y correo por servicios administrados, pon un proxy con TLS delante del API y fija versiones reales de las imágenes.

### Primer administrador de plataforma

No hay endpoint público para crearlo. Se crea desde el servicio `seed` (imagen `migrate`), que ya tiene el `DATABASE_URL` del login `procesabpm_platform` (`app_platform`); falta la URL pública del web en `WEB_BASE_URL`:

```bash
docker compose -f docker-compose.prod.example.yml run --rm -e WEB_BASE_URL=https://app.example.com seed \
  node seed/create-platform-admin.js --email admin@example.com [--first-name Ada --last-name Root]
```

El comando **se niega** a correr con el dueño del esquema, con un superusuario o con un login que no sea miembro de `app_platform` (mínimo privilegio): por eso no se usa el servicio `migrate`.

- Crea (o reutiliza) el usuario global, lo agrega a `platform_admins` e imprime en la terminal un **enlace de un solo uso, válido 24 h**, para fijar la contraseña. Solo se guarda su hash.
- La MFA es obligatoria: el primer inicio de sesión exige inscribir el autenticador.
- Con `--force-additional` sobre un usuario que ya tiene contraseña no se emite enlace ni se tocan sus tokens: solo se agrega a `platform_admins` (en su próximo login se le exige MFA).
- **Idempotente:** repetirlo para el único administrador que aún no eligió contraseña emite un enlace nuevo. Si ya existe otro administrador (o este ya tiene contraseña) se niega, salvo con `--force-additional`.
- Queda registrado en `platform_audit_logs` (`platform_admin.bootstrapped`, `via: cli`). Más administradores se invitan después desde la consola de plataforma.

## 5. Migrar

- Las migraciones solo avanzan; no hay migraciones inversas. Antes de migrar en producción, **respaldo** de la BD.
- Despliega `migrate` antes de las versiones nuevas de `api` y `worker`. Mientras corren las versiones viejas, el esquema nuevo debe seguir funcionando para ellas: escribe las migraciones en dos pasos (agregar, luego quitar) cuando haga falta.
- Una migración fallida deja la BD en estado «fallida» (Prisma `P3009`): hay que resolverla a mano (`prisma migrate resolve`) antes de reintentar. No reintentes a ciegas.
- `docker run --rm -e DATABASE_URL=… procesabpm-migrate` aplica; `… node seed/seed.js` carga el catálogo.

## 6. Salud y apagado ordenado

- **API:** `GET /health` (vivo; no toca la BD) y `GET /ready` (listo; comprueba la BD). El `HEALTHCHECK` de la imagen usa `/health`, para que una caída de la BD no reinicie el API en bucle; usa **`/ready` como sondeo de disponibilidad** del balanceador u orquestador.
- **Worker:** no abre puertos; el orquestador vigila el proceso (`restart: unless-stopped`) y los registros.
- **SIGTERM:** ambos procesos cierran de forma ordenada. El worker deja de reclamar eventos y **termina el lote en curso** (o, si no alcanza, los eventos reclamados se liberan solos al vencer su arrendamiento de 5 min y otro worker los toma); el API termina las peticiones abiertas. Salen con código 143 (Nest vuelve a lanzar la señal tras cerrar; 0 también es válido): es una parada limpia, 137 (`SIGKILL`) no.
- Usa `init: true` (o `docker run --init`) y **`stop_grace_period` ≥ 120 s para el worker** y 30 s para el API; con menos, Docker mata un lote en curso.

## 7. Escalar

- **API:** sin estado; se escala en réplicas detrás de un balanceador. Las sesiones viven en la BD.
- **Worker:** se escala añadiendo réplicas. Son seguras en paralelo: los eventos se reclaman con `SKIP LOCKED` y arrendamiento, y los trabajos programados (alertas de SLA, despertar de `WAIT`, despacho aleatorio, purga) se reparten en la BD de forma que cada elemento se procesa una sola vez. Más réplicas o más `OUTBOX_CONCURRENCY` suben el rendimiento de correos y PDF; el dibujo del PDF corre dentro del proceso del worker (CPU y memoria).
- **Conexiones:** cada proceso abre un pool de `DB_POOL_MAX` (10) conexiones, y el API además un pequeño pool de plataforma. El total (réplicas × pool) debe quedar por debajo de `max_connections` de Postgres. Con muchas réplicas conviene PgBouncer (§10).

## 8. Endurecimiento recomendado
Sincroniza la hora (NTP) en todos los hosts. `read_only: true` con `tmpfs: /tmp`, `cap_drop: [ALL]`, `no-new-privileges`, `init: true`, usuario no root (ya viene en la imagen), el API detrás de un proxy con TLS (`TRUST_PROXY` con el número de proxies), la BD y el almacenamiento solo en la red interna. El script de humo ejecuta los tres servicios con ese endurecimiento.

## 9. CI y prueba de humo

El trabajo `Docker images` de `.github/workflows/ci.yml` (en cada PR, sin publicar nada): construye los tres destinos con `buildx` y la caché de GitHub Actions y ejecuta `scripts/smoke-images.sh`, que
1. comprueba que las imágenes no corren como root, no llevan `.env`, pruebas ni código fuente y que las fuentes del PDF están;
2. levanta un PostgreSQL 18, aplica las migraciones con la imagen `migrate`, crea los logins con `deploy/roles.sql` (dos veces) y carga el catálogo (dos veces);
3. comprueba que el API **no arranca** sin `MFA_ENCRYPTION_KEYS` (falla con «MFA_ENCRYPTION_KEYS is required»), y luego lo arranca (solo lectura, sin capacidades) y espera `/health`, `/ready` y el estado `healthy` del contenedor;
4. arranca el worker **sin `PORT` ni `JWT_SECRET`**, espera el registro «Worker started», lo detiene con SIGTERM y comprueba la parada ordenada; luego detiene el API;
5. el mismo trabajo valida la sintaxis de `docker-compose.prod.example.yml` con `docker compose config` (no lo levanta).

Localmente: `docker build` de los tres destinos y `scripts/smoke-images.sh` (usa `API_IMAGE`, `WORKER_IMAGE`, `MIGRATE_IMAGE` si los nombres cambian).

### Verificación después de cada despliegue (`deploy/verify.sh`)

En el servidor, desde la carpeta del compose y con el `.env` de la instalación:

```bash
deploy/verify.sh                 # pruebas unitarias y prueba de humo
deploy/verify.sh --skip-unit     # solo la prueba de humo
deploy/verify.sh --skip-smoke    # solo las pruebas unitarias
```

1. **Pruebas unitarias** de `shared` y del API en un contenedor desechable (destino `test-unit` del `Dockerfile`, basado en `build`; nunca se despliega), con 2 GB de memoria y el heap limitado. No necesitan base de datos, almacenamiento ni Docker.
2. **Prueba de humo** (`smoke.js`, dentro de la imagen del worker, con `docker compose run --rm --no-deps worker node smoke.js`): recorre el API real como lo haría un cliente y escribe `OK` o `FAIL` por paso, con el motivo:
   - `/health` y `/ready`;
   - administrador de plataforma de prueba (el mismo camino del comando del primer administrador: enlace, inscripción obligatoria de MFA con el TOTP generado por el script y sesión de plataforma);
   - alta de una organización de prueba, invitación al dueño (el correo llega a Mailpit, `MAILPIT_URL`) y aceptación;
   - un flujo publicado, un archivo subido a S3 con URL prefirmada y confirmado, un ticket creado con ese archivo, avanzado y cerrado, el archivo descargado y comparado byte a byte, y un reporte;
   - **limpieza**: borra la organización de prueba (`purge_tenant`), sus archivos del bucket (prefijo `tenants/<id>/`) y al administrador y al dueño de prueba. Solo toca lo que parece de humo: slug `smoke-xxxxxxxx` **y** nombre «Smoke test (delete me)», así que una organización real nunca coincide; los restos de una corrida anterior que murió a medias (más de una hora) también se borran. La limpieza se intenta aunque un paso falle; si falla, el script dice qué borrar a mano.

Variables (todas opcionales): `COMPOSE_FILE`, `ENV_FILE` (de ahí se lee `PLATFORM_DB_PASSWORD`; entra al contenedor por nombre, nunca en la línea de comandos), `BASE_URL` (por defecto `http://api:3000` dentro de la red del compose; con la dirección pública `https://…` se prueba también el proxy), `MAILPIT_URL` (por defecto `http://mailpit:8025`), `SMOKE_PLAN_CODE`, `TEST_IMAGE`. El código de salida es 1 si algo falló. El trabajo `Docker images` del CI construye y ejecuta el destino `test-unit` y valida la sintaxis del script; `apps/api/test/integration/smoke-run.e2e.test.ts` corre todos los pasos contra un API en proceso.

## 10. Pendientes
- **PgBouncer** (o el pooler del proveedor): modo transacción es compatible con la forma de trabajar (`set_config(..., true)` dentro de la transacción); falta probarlo y fijar el tamaño de los pools.
- **Almacenamiento (AWS S3, decidido):** el código usa el SDK de S3 con endpoint configurable y está probado con SeaweedFS; falta probarlo contra S3 real (URL prefirmadas, CORS del bucket; ver «AWS (pruebas)»).
- **Proveedor de correo:** hoy SMTP genérico (`SMTP_*`); falta elegir el proveedor (Resend, SES, Brevo), configurar SPF/DKIM/DMARC del dominio y, si se desea, un transporte por API.
- **Dueño del esquema sin superusuario** (bases administradas): falta definir y probar los permisos mínimos (§2).
- **Auditoría:** retención y purga, y los registros de acceso del bucket (la descarga no pasa por el API); ver `pendientes.md`.
- **Healthcheck del worker:** hoy solo se vigila el proceso; un latido (archivo o puerto interno) permitiría detectar un worker colgado.
- **Registro de imágenes, firma y escaneo de vulnerabilidades:** el CI construye pero no publica; falta decidir el registro, firmar las imágenes (cosign) y escanearlas (Trivy), y automatizar la actualización del digest de la imagen base.
- **Imagen web:** llega con `apps/web`.
- **Observabilidad:** métricas, trazas y alertas (el registro JSON ya incluye `requestId`).
- **Respaldos y recuperación** de la BD y del bucket, y la retención de datos de un cliente que se va (analisis.md §12).

## 11. AWS (pruebas)
Para las pruebas se usa una cuenta gratuita de AWS. **Ninguna credencial va en el repositorio**: las claves se crean en AWS y se pasan por variables de entorno o secretos del orquestador (§2).

- **Servidor:** una instancia **EC2** con Docker y Docker Compose; corre `api`, `worker` y **PostgreSQL 18 en contenedor en la misma instancia** (`docker-compose.prod.example.yml` es el punto de partida). *Alternativa:* **Amazon RDS for PostgreSQL**, que ya ofrece la versión 18 (confírmalo en la consola para la región elegida). RDS no da superusuario: antes hay que resolver el «dueño del esquema sin superusuario» (§2 y §10). Para pruebas el contenedor es lo más simple.
- **Bucket S3 privado** (en la misma región que la instancia):
  - *Block Public Access* **activado** (las cuatro opciones).
  - Cifrado en reposo **SSE-S3** (AES-256, el predeterminado).
  - **Versionado desactivado**: nunca se sobrescribe un objeto (la clave de almacenamiento es inmutable y la subida usa `If-None-Match: *`).
  - **CORS** solo para el origen de la web, métodos `PUT` y `GET`, y los encabezados firmados `content-type`, `content-length` e `if-none-match` (más `ETag` expuesto si hace falta):
    ```json
    [{ "AllowedOrigins": ["https://app.ejemplo.com"], "AllowedMethods": ["PUT", "GET"],
       "AllowedHeaders": ["content-type", "content-length", "if-none-match"], "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3000 }]
    ```
  - S3 soporta `If-None-Match: *` en `PUT` (escrituras condicionales): si el objeto ya existe, la subida falla con 412 y no lo reemplaza.
  - Variables: `STORAGE_ENDPOINT=https://s3.<región>.amazonaws.com`, `STORAGE_REGION=<región>`, `STORAGE_BUCKET`, `STORAGE_FORCE_PATH_STYLE=false`, y las claves del usuario IAM.
- **Usuario IAM** exclusivo de la aplicación, con una política mínima limitada al bucket (`s3:ListBucket` es **obligatorio**: la purga de un tenant eliminado lista y borra todo `tenants/<id>/`; sin él la purga falla y se reintenta, y el `HEAD` de un objeto inexistente responde 403 en vez de 404):
  ```json
  { "Version": "2012-10-17", "Statement": [
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::BUCKET/*" },
    { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::BUCKET" } ] }
  ```
  Sin acceso de consola y con las claves rotadas periódicamente.
- **Correo: Amazon SES**, en modo *sandbox* al inicio (solo envía a direcciones verificadas): verifica el dominio (SPF/DKIM/DMARC) y pide salir del sandbox antes de la producción. El worker lo usa por SMTP (`SMTP_*`).
- Abre solo los puertos 80/443 (proxy con TLS) y el SSH restringido; la BD no se publica.

## 12. Contabo (producción)
Cuando termine la etapa de pruebas, la producción corre en **Contabo**:

- **Servidor:** un VPS con Docker Compose: `api`, `worker` y PostgreSQL 18 (más el proxy). Los **archivos siguen en AWS S3** (mismo bucket y política de la sección anterior, con claves propias de producción).
- **Respaldos de PostgreSQL:** `pg_dump` programado (diario) y/o archivado de WAL hacia un bucket S3 **distinto** del de los adjuntos y con versionado y retención; probar la restauración periódicamente. La llave `MFA_ENCRYPTION_KEYS` y los demás secretos se respaldan aparte (§2).
- **TLS:** un proxy inverso (**Caddy** o **Traefik**) termina HTTPS con certificados automáticos y reenvía al API; `TRUST_PROXY=1` (§3).
- **Firewall:** solo 80/443 (y SSH restringido por IP o clave); la BD y el worker no se exponen; actualizaciones del sistema y hora sincronizada (NTP).
- **Latencia hacia S3:** la distancia entre Contabo y AWS no afecta a las subidas ni a las descargas, porque el navegador sube y baja **directo** con la URL firmada; el API solo firma y confirma.
