# Respaldos de la base de datos

Cada día, a las 03:30 (hora de Bogotá), el servidor saca una copia completa de PostgreSQL y la sube a un bucket de S3 dedicado.
El servidor **solo puede escribir** en ese bucket: no puede listar, leer ni borrar. Así, si alguien toma el control del
servidor, no puede borrar los respaldos. La retención la decide una regla del bucket, no el servidor.

Archivos en `deploy/backup/`:

| Archivo | Qué es |
|---|---|
| `procesabpm-backup.sh` | Saca el respaldo, lo verifica, lo sube y deja la marca de «último respaldo». |
| `procesabpm-restore.sh` | Restaura un respaldo, por defecto en una base aparte (simulacro). |
| `procesabpm-backup.service` / `.timer` | La tarea diaria de systemd. |
| `backup.env.example` | La configuración, que va en `/etc/procesabpm/backup.env`. |

## Qué contiene cada respaldo

En `s3://<bucket>/postgres/<año>/<mes>/`:

- `procesabpm-<fecha>.dump`: `pg_dump -Fc` de la base `procesabpm` (formato custom, comprimido, restaurable tabla por tabla).
- `procesabpm-<fecha>.globals.sql`: `pg_dumpall --globals-only`, es decir, los roles (`app_runtime`, `app_platform`,
  `app_worker`, los de login…) que nombran las políticas y los permisos. Lleva los hash de las contraseñas de esos roles.
- Un `.sha256` de cada uno.

Antes de subirlo, el script comprueba que el dump se lee (`pg_restore --list`). Todo va cifrado en el bucket (SSE). La
marca `/var/lib/procesabpm-backup/last-success` se escribe solo si todo salió bien; `deploy/verify.sh` avisa si tiene más
de 26 horas.

**Lo que no va en el respaldo:** los archivos adjuntos (ya están en su propio bucket de S3) y los secretos del `.env`,
sobre todo `MFA_ENCRYPTION_KEYS`. Sin esa llave, los segundos factores de los usuarios no se pueden leer después de
restaurar. Guarda una copia del `.env` en un gestor de contraseñas, fuera del servidor.

## 1. Lo que creas en AWS (una sola vez)

### 1.1 El bucket

En **S3 → Create bucket**:

1. **Nombre:** algo como `procesabpm-backups-<algo-único>`. **Región:** la misma del servidor (por ejemplo `us-east-1`).
   Debe ser **un bucket distinto** del de los adjuntos.
2. **Block Public Access:** las cuatro opciones activadas.
3. **Bucket Versioning:** *Enable*. Si algo sobrescribe un objeto, la versión anterior se conserva.
4. **Default encryption:** *SSE-S3* (lo más simple). Si prefieres KMS, crea una llave y usa `BACKUP_SSE=aws:kms` con
   `BACKUP_KMS_KEY_ID` (ver 1.3).
5. **Object Lock** (opcional, recomendado cuando haya clientes): solo se puede activar al crear el bucket. Con *Governance*
   y 30 días, ni siquiera un usuario con permisos de borrado puede borrar un respaldo antes de tiempo.

### 1.2 La retención (Lifecycle rule)

En el bucket, **Management → Create lifecycle rule**, con alcance al prefijo `postgres/`:

- *Expire current versions of objects*: **35 días** después de creados (un mes de respaldos diarios y algo más).
- *Permanently delete noncurrent versions*: **7 días** después de quedar como no actuales.
- *Delete expired object delete markers or incomplete multipart uploads*: marca la opción de incompletos, **1 día**.

Si más adelante quieres respaldos mensuales por un año, se agrega una segunda regla o una copia mensual a otro prefijo. Eso
se decide aparte.

### 1.3 El rol del servidor (IAM)

En **IAM → Roles → Create role**:

1. *Trusted entity*: **AWS service → EC2**.
2. Crea una política (**IAM → Policies → Create policy → JSON**) llamada `procesabpm-backup-write-only`. Cambia `BUCKET`
   por el nombre del bucket:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "WriteBackupsOnly",
         "Effect": "Allow",
         "Action": "s3:PutObject",
         "Resource": "arn:aws:s3:::BUCKET/postgres/*"
       }
     ]
   }
   ```

   Solo `s3:PutObject`, sin `GetObject`, `ListBucket` ni `DeleteObject`, que es justo lo que protege los respaldos. Las
   subidas grandes (multipart) también quedan cubiertas por `s3:PutObject`. Si usas KMS, agrega otra sentencia con
   `"Action": ["kms:GenerateDataKey", "kms:Encrypt"]` sobre el ARN de la llave.
3. Adjunta esa política al rol y llámalo, por ejemplo, `procesabpm-server`.
4. En **EC2 → la instancia → Actions → Security → Modify IAM role**, elige `procesabpm-server`.
5. En la instancia, **IMDSv2 required** (*Actions → Instance settings → Modify instance metadata options*). El script usa
   la red del host, así que el *hop limit* 1 predeterminado sirve.

Si el servidor no está en AWS (por ejemplo el VPS de Contabo previsto), en vez del rol crea un **usuario IAM** con la misma
política, sin consola. Pon sus claves en `/etc/procesabpm/backup.env` como `AWS_ACCESS_KEY_ID` y `AWS_SECRET_ACCESS_KEY`
(ese archivo es `chmod 600` y nunca va al repositorio).

### 1.4 Para restaurar: tu acceso de lectura

El servidor no puede leer el bucket. Para descargar un respaldo usa **tu propio usuario** (consola de S3 → el objeto →
*Download*), o un usuario/rol de operador con `s3:GetObject` y `s3:ListBucket` sobre el bucket. Ese acceso nunca se guarda
en el servidor.

## 2. Instalar en el servidor

Desde la carpeta del despliegue (donde está `docker-compose.prod.example.yml`; aquí `/opt/procesabpm`; si es otra, cámbiala
en `ExecStart` del `.service` y en `BACKUP_COMPOSE_DIR`):

```bash
sudo install -d -m 700 /etc/procesabpm
sudo install -m 600 deploy/backup/backup.env.example /etc/procesabpm/backup.env
sudo nano /etc/procesabpm/backup.env        # BACKUP_S3_URI, AWS_REGION, BACKUP_COMPOSE_DIR
sudo cp deploy/backup/procesabpm-backup.service deploy/backup/procesabpm-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now procesabpm-backup.timer

# El primer respaldo, ya, para comprobar que todo funciona:
sudo systemctl start procesabpm-backup.service
journalctl -u procesabpm-backup.service -n 30 --no-pager
cat /var/lib/procesabpm-backup/last-success
```

Si `aws` no está instalado en el servidor, el script usa la imagen `amazon/aws-cli:2.38.1`. En la consola de S3 deben
aparecer los cuatro archivos del día bajo `postgres/<año>/<mes>/`.

`systemctl list-timers procesabpm-backup.timer` dice cuándo corre el próximo. Si el servidor estaba apagado a la hora del
respaldo, este corre al arrancar (`Persistent=true`).

## 3. Restaurar

`procesabpm-restore.sh` recibe un archivo `.dump` local: una de las dos copias que el servidor guarda en
`/var/backups/procesabpm`, o uno que descargaste del bucket con tu acceso (1.4). Si su `.sha256` está al lado, lo verifica.

### 3.1 Simulacro (hazlo una vez al mes)

Restaura en una base aparte, **sin tocar la real ni detener la app**:

```bash
sudo deploy/backup/procesabpm-restore.sh /var/backups/procesabpm/procesabpm-<fecha>.dump
```

Crea (o recrea) la base `procesabpm_restore_drill` en el mismo PostgreSQL, restaura con `--exit-on-error` (si algo falla,
se detiene en vez de dejar una copia a medias) e imprime cuántos tenants, usuarios y tickets tiene, y la última migración.
Compara esos números con la base real:

```bash
docker compose -f docker-compose.prod.example.yml exec postgres sh -c \
  'psql -U "$POSTGRES_USER" -d procesabpm -c "SET row_security = off; SELECT count(*) FROM tenants; SELECT count(*) FROM tickets;"'
```

Al terminar, borra la base del simulacro:

```bash
docker compose -f docker-compose.prod.example.yml exec postgres sh -c \
  'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE procesabpm_restore_drill WITH (FORCE)"'
```

Anota la fecha y el resultado del simulacro. Un respaldo que nunca se probó no es un respaldo.

### 3.2 Restaurar de verdad (perdiste datos)

1. Detén lo que escribe: `docker compose -f docker-compose.prod.example.yml stop api worker`.
2. Restaura sobre la base real; el script pide escribir el nombre de la base para confirmar:
   ```bash
   sudo deploy/backup/procesabpm-restore.sh <archivo>.dump --into-production
   ```
3. Arranca de nuevo: `docker compose -f docker-compose.prod.example.yml up -d api worker`, y corre `deploy/verify.sh`.

Se pierde lo que pasó después de la hora del respaldo (hasta 24 horas). Si eso es demasiado, el siguiente paso es el
archivado continuo de WAL (PITR), que es otro proyecto.

### 3.3 En un servidor nuevo

El PostgreSQL nuevo no tiene los roles. Antes de restaurar el dump:

1. Levanta solo `postgres` con el mismo `.env` del servidor anterior.
2. Carga los roles del mismo respaldo. Puede avisar que algún rol ya existe; es normal:
   ```bash
   docker compose -f docker-compose.prod.example.yml exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres' \
     < procesabpm-<fecha>.globals.sql
   ```
3. Sigue con 3.2, paso 2: el script crea la base y restaura el dump.
