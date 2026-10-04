# Estado del backend de ProcesaBPM (pausa del 2026-10-04)

El trabajo está **detenido hasta nuevo aviso**: tanto el agente de la nube como el arquitecto (sesión local). Este archivo junta todo lo necesario para retomar en otra sesión sin perder contexto. **No está commiteado** (solo local); si se quiere en el repo, va en un PR.

## 1. Dónde quedó todo

- **`main` en GitHub:** `docs(pendientes)` del PR #39 sobre `0bbb32b` (P7). No hay PRs abiertos al momento de la pausa.
- **Servidor de pruebas (EC2):** `ubuntu@3.83.248.175`, repo en `~/procesabpm`, en `main` con P7 (`0bbb32b`) desplegado y verificado. #39 es solo documentación, así que no cambia nada desplegado.
  - Compose: `docker compose -f docker-compose.prod.example.yml`
  - Verificación: `BASE_URL=https://3-83-248-175.sslip.io deploy/verify.sh`
- **Agente de la nube:** sesión "Revisión del proyecto" (`session_01Q212YpPHVWPEGYg8AMZWoL`). El usuario lo detuvo. Cuando se detuvo estaba **empezando S1 (endurecimiento de la base de datos)**. Puede que haya dejado una rama a medio hacer: revisar `gh pr list` y las ramas remotas antes de seguir.

### PRs mergeados en esta etapa (todos desplegados y verificados en la EC2 antes del merge)

| PR | Qué | Commit | Pruebas unitarias en la EC2 |
|---|---|---|---|
| #31 | P2 Retención de datos | 853f882 | 515 + 1075 |
| #32 | P3 Correos de seguridad | 9c84b49 | 515 + 1121 |
| #33 | P4 Reinicio de MFA por soporte | f22eb27 | 532 + 1137 |
| #34 | P5 Anuncios que bloquean el ingreso, por audiencia | 3eb07f3 | 540 + 1173 |
| #35 | Prueba inestable del outbox (parcial) | ec80263 | solo pruebas |
| #36 | P6 Solicitud y descarga de la exportación | f3b1dce | 542 + 1208 |
| #37 | Prueba inestable del outbox (arreglo de raíz) | 0fbbf94 | solo pruebas |
| #38 | P7 Worker que arma el zip de exportación | 0bbb32b | 542 + 1278 |
| #39 | Nota B1–B18 en `pendientes.md` | (solo docs) | — |

En todos: prueba de humo completa OK, 0 errores en el API y en el worker.

## 2. Hallazgos de la revisión de seguridad final (sin arreglar)

La hizo el agente con 3 revisores de solo lectura sobre `main` `0bbb32b`. **No hay Críticos ni Altos.** Plan acordado: 4 PRs secuenciales (S1–S4), porque las pruebas comparten la base de datos.

### MEDIOS

1. **[BD] `app_is_purging()` se puede falsear.** Solo compara un setting que `app_runtime` puede fijar. Con eso, el runtime puede reescribir o borrar versiones publicadas de flujos y `stored_files` **de su propio tenant** (reproducido). No hay fuga entre tenants. → S1
2. **[BD] `app_platform` conserva `TRIGGER`/`MAINTAIN`** por privilegios por defecto. Puede crear un trigger en `audit_logs`, `platform_audit_logs` o `ticket_events` que descarte filas en silencio (reproducido). → S1
3. **[Config] La configuración de producción acepta los secretos de ejemplo** de `deploy/example.env` (`change-me…`, la llave MFA en ceros). Si se despliega tal cual, un atacante forja un *selection token* y entra como cualquier usuario, incluso administrador de plataforma, sin contraseña ni MFA. Debe fallar al arrancar con esos valores. → S2
   - **Pendiente aparte:** confirmar que el `.env` de la EC2 no usa esos valores (revisar sin imprimir los secretos).
4. **[Archivos] Subidas rechazadas fuera de cuota.** Cuando una subida falla por `HASH_MISMATCH`, se libera la clave mientras la URL firmada sigue vigente, y se pueden subir hasta 20 MB repetidos sin que cuenten en la cuota. → S3

### BAJOS

- **[BD]** `app_platform`, como dueño, puede volver a otorgar o alterar las funciones marcadas "sin EXECUTE" (la documentación lo sobreestima). → S1
- **[BD]** `support_access_grants` no tiene trigger de consentimiento. → S1
- **[BD]** Cualquier tenant puede insertar una membresía `ACTIVE` de un usuario global existente. → S1/S4
- **[BD]** `enqueue_platform_event` deja a `app_runtime` encolar `email.platform_admin_invitation` (reset de 7 días) y `tenant_deletion_requested` de otros. → S1
- **[BD]** `auth_verify_support_session` puede cerrar visitas de soporte de otro tenant. → S1
- **[Auth]** Invitar un correo revela si la cuenta existe y el nombre real de la persona. → S4
- **[Auth]** Un rol personalizado con permiso `update Role` puede darse más permisos a sí mismo. → S4
- **[Config]** `TRUST_PROXY=0.0.0.0/0` se acepta. → S2
- **[Config]** El límite de intentos por IPv6 usa la dirección completa (debería ser /64). → S2
- **[Archivos]** Faltan límites de intentos en `/files/uploads`, `/files/:id/confirm` y `/ready`. → S2
- **[Ops]** La limpieza de la prueba de humo selecciona organizaciones por nombre. → S2 o aparte

### Lo que salió sano

JWT y audiencias, rotación del refresh, MFA, RLS de las 82 tablas con `tenant_id`, las 78 funciones `SECURITY DEFINER` con `search_path`, purga sin riesgo de prefijo, exportación, outbox, tiempo real y SQL crudo.

### Plan de PRs

| PR | Contenido |
|---|---|
| S1 | Endurecimiento de BD (migración). Estaba en curso al detenerse. |
| S2 | Configuración y límites: rechazar secretos de ejemplo en producción, `TRUST_PROXY`, IPv6 /64, límites de archivos, `/ready`. |
| S3 | Cuota de subidas rechazadas. |
| S4 | Privilegios de identidad: rol que se da permisos a sí mismo, nombre del invitado, membresía `ACTIVE`. |

## 3. Funcionalidades que faltan frente a la mesa de ayuda de Electrocréditos

Comparación módulo por módulo, sin ventas, viáticos ni listas de precios (que no van al SaaS).

### Ya cubierto en ProcesaBPM

- **Tickets:** crear, avanzar, tomar, reasignar, comentar, novedades (pausan el SLA), cerrar, reabrir, historial, adjuntos y firmas de tareas en paralelo.
- **Flujos:** editor con borradores, versiones y publicación validada; enlaces entre flujos; asignación automática y aleatoria; esperas; calculadoras (reemplazan las fórmulas y consultas de las plantillas).
- **Catálogo:** categorías, subcategorías, prioridades, tipos de error.
- **Organización:** empresas, departamentos, cargos, sedes con niveles (reemplazan regional y zona), calendarios y festivos para el SLA.
- **Usuarios y permisos:** miembros por invitación, roles con permisos, grupos (antes "perfiles"), grupos de aprobación, delegaciones.
- **Documentos PDF:** plantillas, formatos y generación automática; reemplaza "formatos PDF" y los planos.
- **Reportes:** resumen, SLA, ranking, distribución de tiempos, novedades, categorías, backlog, detalle por usuario y exportación.
- **Notificaciones:** campanita, correo y tiempo real.
- **Mantenimiento y notas de cambios:** los anuncios de P5 reemplazan `system-config`.
- **Nuevo del SaaS:** multi-tenant con RLS, MFA, auditoría, consola de plataforma, soporte con permiso del cliente, purga y exportación de datos.

### Falta en el backend

| Funcionalidad de la mesa | Estado en ProcesaBPM |
|---|---|
| Etiquetas personales de tickets (`tags`) | Tablas `tags` y `ticket_tags` existen; **faltan los endpoints** |
| Plantillas de texto personales y compartidas (`text-templates`) | Tablas `text_templates` y `text_template_shares` existen; **faltan los endpoints** |
| Importar Excel como fuente de datos de campos (`imports`) | Tablas `datasets` y `dataset_rows` existen; **falta subir el Excel y consultarlo** |
| Dashboard (`stats` y pendientes) | Sin endpoint propio; se puede armar con `reports` y el listado de tickets |
| Reglas de quién puede crear en una subcategoría, por cargo o grupo (`rules`) | No se vio endpoint para configurarlas; **por confirmar** |
| Firma del usuario (imagen para los PDF) y edición del propio perfil (`profiles`) | Solo existe `GET /auth/me`; **por confirmar** |
| **B17:** avisar al dueño 7 y 1 días antes de la purga | **No construido** (necesita un planificador de avisos) |

Las tres primeras son cortas porque las tablas ya existen. Las tres "por confirmar" hay que revisarlas en el código antes de decidir.

## 4. Decisiones por defecto tomadas (a confirmar por Alexander)

### Seguridad e ingreso

| | Decisión |
|---|---|
| B1 | El bloqueo de ingreso también corta las sesiones abiertas |
| B2 | Las visitas de soporte siguen permitidas durante un bloqueo |
| B3 | El aviso de ingreso a la consola de plataforma solo le llega a ese administrador |
| B4 | Como máximo 1 aviso de bloqueo de cuenta cada 24 h |
| B5 | El reinicio de MFA por soporte es inmediato |
| B6 | Verificación de identidad para el reinicio: videollamada, devolver la llamada a un número conocido, pedido de un administrador de la empresa o en persona |

- El MFA de un administrador de plataforma no se reinicia desde la consola; se hace a mano en el servidor.

### Retención

| | Plazo |
|---|---|
| B7 | Auditoría de cada tenant: 2 años |
| B8 | Auditoría de plataforma: 5 años |
| B9 | Notificaciones no leídas: 365 días |
| B10 | Sesiones y tokens: 30 días después de vencer |

### Exportación

| | Decisión |
|---|---|
| B11 | Solo se exporta en `PENDING_DELETION` |
| B12 | La piden el dueño y los administradores con acceso total, poniendo otra vez su contraseña |
| B13 | El enlace vale 7 días; máximo 5 solicitudes |
| B14 | Incluye el número de documento de los miembros |
| B15 | Formato JSONL + CSV |
| B16 | Tope de 100 GiB o 4 h por exportación |
| B17 | Aviso al dueño 7 y 1 días antes de la purga (**no construido**, ver §3) |
| B18 | El resto de los valores abiertos del diseño quedan en su valor por defecto |

**Nuevas de P7, por confirmar:**
- Exportar el estado global de la cuenta de cada miembro.
- Exportar la IP y el user agent de `audit_logs`. En las acciones de soporte aparece la IP del administrador de plataforma.

### Tiempo real y notificaciones

- **Tiempo real:** decisiones D1–D14 (PR #25).
- **Notificaciones:** solo se notifica a quien puede ver el ticket; tipo `SYSTEM` con preferencias; no se excluye a quien hizo el cambio.

## 5. Limitaciones conocidas y requisitos antes de producción

- Los límites de intentos están en memoria por instancia; **pasarlos a Redis** antes de producción.
- Los reinicios de MFA fallidos no dejan rastro en la auditoría.
- `app_runtime` puede encolar avisos de cambio para cualquier usuario (parcialmente cubierto por S1).
- Exportación: si la BD confirma el fin pero se pierde la respuesta después de completar la subida, queda `READY` sin archivo y hay que pedir otra.
- **Bucket de S3 en producción, obligatorio:**
  - sin versionado;
  - regla `AbortIncompleteMultipartUpload` de 1 día.
- Desplegar el worker junto con el API. Migrar siempre antes del API.
- No crear anuncios dirigidos a empresas específicas (`TENANTS`) hasta que todas las instancias del API tengan P5.
- Pendiente de negocio: confirmar la regla de `MEAL_ALLOWANCE`.
- Respaldos a S3: pospuestos (decisión previa).
- Hosting: pruebas en AWS capa gratuita; producción en Contabo + S3.

## 6. Decisiones abiertas del usuario al pausar

1. ¿Se le pasa al agente la lista de §3 (funcionalidades faltantes y B17) para hacerla después de S1–S4, o se deja para después del frontend?
2. ¿El arquitecto vuelve a mergear solo (desplegar en la EC2, verificar y mergear) o el usuario aprueba cada PR? **Al momento de la pausa: no mergear nada.**
3. **OK para empezar el frontend:** pendiente. No empezar el frontend sin ese OK.

## 7. Cómo retomar

1. Leer este archivo y `docs/pendientes.md`.
2. Revisar `gh pr list` y las ramas remotas: el agente pudo dejar S1 a medias.
3. Si se reactiva el agente: mandarle por mensaje entre sesiones a "Revisión del proyecto" que siga con S1–S4 y, si el usuario lo aprueba, con §3.
4. Flujo por cada PR:
   1. Revisar el diff, enfocado en las condiciones críticas.
   2. Esperar el CI en verde.
   3. Desplegar en la EC2: `git fetch origin pull/N/head:prN`, `build`, `run --rm migrate`, `up -d`.
   4. Correr `deploy/verify.sh` y revisar errores del API y del worker.
   5. Mergear con squash y `--match-head-commit`.
   6. Volver la EC2 a `main`.
   7. Avisar al agente y al usuario.
5. Reglas que siguen vigentes:
   - BD y código en inglés; documentación y UI en español.
   - Un PR por funcionalidad, con squash; nunca push a `main`.
   - Unitarias y pruebas grandes.
   - Nunca poner credenciales, `.pem`, contraseñas, secretos TOTP ni códigos de respaldo en el chat ni en el repo.
