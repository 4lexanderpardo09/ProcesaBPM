# Revisión a fondo del esquema de BD (enfoque: integridad de datos)

> **Estado: TODO APLICADO (2026-09-30).** Los 19 huecos y las mejoras de §4 y §5 se corrigieron en la migración `20260930000200_integrity_rules` y en el esquema; cada hueco tiene su prueba. La referencia vigente es [base-de-datos.md](base-de-datos.md). Este documento queda como registro de la revisión.

Fecha: 2026-09-30. Revisado contra las reglas de negocio de `analisis.md` §0.1. Método: chequeos automáticos del catálogo de PostgreSQL + **19 pruebas de intrusión** sobre la BD real (inserciones y ediciones que deberían fallar). En la revisión las 19 pasaron (los 19 huecos existían). Hoy las 19 fallan como deben.

Severidad: 🔴 corrompe datos o rompe la seguridad · 🟠 permite estados inválidos del negocio · 🟡 calidad/rendimiento.

---

## 1. 🔴 Seguridad de identidades (probado con el rol del API)
| # | Hueco confirmado | Riesgo | Corrección |
|---|---|---|---|
| 16 | El API puede **leer `password_hash` y `mfa_secret`** de cualquier miembro de su tenant. | Un bug en un endpoint que devuelva usuarios expone hashes. | Privilegios por columna: `REVOKE SELECT (password_hash, mfa_secret, failed_logins, locked_until)` a `app_runtime`. Solo las funciones `auth_*` los leen. |
| 17 | El API puede **crear una identidad global con contraseña** (`INSERT INTO users … password_hash`). | **Secuestro de cuentas entre tenants:** el admin del tenant A crea `ceo@empresaB.com` con una contraseña que conoce; cuando esa persona entra al tenant B, la cuenta ya existe con la clave del atacante. | Quitar `INSERT` en `users` a `app_runtime`. Las invitaciones pasan por una función `invite_user(email, nombre, apellido)` que crea la identidad **sin contraseña** o reutiliza la existente. La contraseña solo se fija con el token enviado al correo. |
| 18 | Un usuario puede cambiarse su **estado, bloqueo y correo**. | Se desbloquea solo tras intentos fallidos, se reactiva si está deshabilitado y cambia su correo sin verificarlo. | `GRANT UPDATE (first_name, last_name, locale, time_zone)` únicamente. Correo, contraseña, MFA y estado solo por funciones `auth_*` con verificación. |
| 19 | El API puede **borrar/editar `audit_logs`** y editar la línea de tiempo (`ticket_events`, #13). | La auditoría deja de ser prueba de nada. | Tablas de **solo inserción**: `REVOKE UPDATE, DELETE` en `audit_logs`, `ticket_events`, `ticket_errors`, `ticket_signatures`, `webhook_deliveries` (el borrado del tenant sigue funcionando por CASCADE con el rol de plataforma). |
| — | `webhooks.secret_hash`: **error de diseño**. Para firmar (HMAC) los envíos se necesita el secreto, no su hash. Lo mismo con `users.mfa_secret`: hay que leerlo para validar el TOTP. | El webhook no se podría firmar. | Guardar ambos **cifrados** (AES-256-GCM con una llave de la app o un KMS): `secret_encrypted bytea`, `mfa_secret_encrypted bytea`. |

## 2. 🔴 Coherencia del flujo y del ticket (probado)
| # | Hueco confirmado | Por qué importa | Corrección |
|---|---|---|---|
| 1 | Se puede **editar un paso de una versión PUBLICADA**. | Rompe la regla central de versionado: los tickets en curso cambiarían de comportamiento (lo mismo que pasaba en el sistema viejo, §3.7). | **Trigger de inmutabilidad**: bloquear INSERT/UPDATE/DELETE en `steps`, `transitions`, `fields`, `amount_rules`, `step_*` cuando la versión no está en DRAFT. Una versión publicada solo puede pasar a ARCHIVED. |
| 1b | Por lo anterior aparece otro problema: `steps.dispatch_last_run_at` es **estado de ejecución** guardado en la configuración (el cron lo actualiza). | Chocaría con la inmutabilidad y mezcla configuración con operación. | Moverlo a una tabla `step_runtime_state (step_id, last_dispatch_at, last_assigned_user_id)`, que además guarda el puntero del round-robin, hoy inexistente. |
| 2 | El **paso actual del ticket puede ser de otra versión** del flujo. | El motor evaluaría transiciones y campos de una versión que el ticket no usa. | FK compuesta `(tenant_id, workflow_version_id, current_step_id) → steps (tenant_id, version_id, id)`. |
| 3 | La **subcategoría del ticket puede no coincidir** con la del flujo. Además (#12), se puede **mover un flujo a otra subcategoría**. | Es exactamente el bug que tenía el sistema viejo (ticket con categoría distinta a la de su subcategoría). | Guardar `workflow_id` en el ticket con FK `(tenant_id, workflow_id, workflow_version_id) → workflow_versions`, y FK `(tenant_id, subcategory_id, workflow_id) → workflows`. Hacer `workflows.subcategory_id` inmutable (trigger). |
| 4 | Se puede guardar el **valor de un campo de otra versión** en el ticket. | Datos huérfanos del formulario y PDFs que imprimen campos que no existen. | Agregar `workflow_version_id` a `ticket_field_values` con FK compuesta a `fields (tenant_id, version_id, id)` y a `tickets (tenant_id, id, workflow_version_id)`. |
| 5 | Un ticket puede quedar **PAUSED sin novedad abierta** (o al revés). | Hay que evitar lo que ya se vio en el sistema viejo: 55 novedades abiertas en tickets cerrados y tickets pausados sin causa. | Trigger que mantiene la regla: `PAUSED ⇔ existe una novedad OPEN`. Al cerrar, no puede quedar ninguna novedad abierta ni tareas paralelas pendientes (en el sistema viejo había 15). |
| 10 | Dos transiciones **DEFAULT** desde el mismo paso, y etiquetas repetidas. | La rama "si no" queda ambigua. | Índice único parcial `(tenant_id, from_step_id) WHERE type = 'DEFAULT'` + `UNIQUE (tenant_id, from_step_id, label)`. |
| 11 | Una transición puede **salir de un paso FIN** (y también entrar a un INICIO). | Un flujo "terminado" seguiría. | Trigger que valida los tipos de paso en `transitions`: FIN sin salidas, INICIO sin entradas, CONDICIÓN solo con salidas CONDITION/DEFAULT. |
| 9 | Un paso **CONDICIÓN puede tener responsable y SLA**. | Configuraciones sin sentido que el motor tendría que interpretar. | CHECK por tipo: los bloques automáticos (START, CONDITION, DOCUMENT, EXPORT, NOTIFICATION, WEBHOOK, CALCULATOR, WAIT, END) tienen `assignment_mode = 'NONE'` y SLA nulo. Además, quitar `is_entry`, que es redundante con `type = 'START'` (o forzar la igualdad con un CHECK). |

## 3. 🟠 Reglas del negocio sin garantía en BD (probado)
| # | Hueco confirmado | Corrección |
|---|---|---|
| 6 | Un usuario puede **usar la etiqueta personal de otro**. | FK compuesta `(tenant_id, tag_id, user_id) → tags (tenant_id, id, owner_id)`. |
| 7 | **Delegaciones que se cruzan** en fechas, e incluso circulares (A→B y B→A a la vez). | Restricción de exclusión con `btree_gist`: `EXCLUDE (tenant_id WITH =, from_user_id WITH =, tstzrange(starts_at, ends_at) WITH &&)`. Lo circular se valida en la app al crear. |
| 8 | **Franjas horarias solapadas** el mismo día en un calendario (el SLA contaría horas dobles). | `EXCLUDE (tenant_id WITH =, calendar_id WITH =, weekday WITH =, tsrange(...) WITH &&)`. Los turnos que cruzan la medianoche se parten en dos filas (documentarlo). |
| 14 | `sha256` acepta cualquier texto. | `CHECK (sha256 ~ '^[0-9a-f]{64}$')`. |
| 15 | **Zona horaria inventada** (`Marte/Olympus`). Rompería todos los cálculos de SLA de esa empresa. | Trigger que valida contra `pg_timezone_names` en `tenants`, `companies` y `countries`. Lo mismo para `currency_code`: una tabla `currencies` con FK. |

## 4. 🟠 Mejoras de modelo según las reglas de negocio (no probadas: son diseño)
1. **Reloj de SLA sin "foto" del objetivo.** El vencimiento depende del SLA del paso, del ajuste por empresa y del calendario, y cualquiera de los tres puede cambiar después. **Agregar a `ticket_sla_clocks`** `sla_value`, `sla_unit` y `calendar_id` usados al abrir el reloj, para que el reporte histórico no cambie.
2. **"Tiempo total del paso" (decisión: se mide el responsable y el paso).** Hoy se deduce de los relojes. **Agregar `ticket_step_visits`** (ticket, paso, vuelta, entrada, salida, transición de salida, minutos hábiles totales, resultado) y que cada reloj apunte a su visita. Los reportes se vuelven directos y los bucles quedan contados.
3. **Aprobadores por empresa.** Hoy `UNIQUE (tenant, tipo, usuario)` impide que alguien que trabaja en dos empresas del mismo tenant tenga aprobadores distintos en cada una (p. ej. Arpesod y Finansueños). **Pregunta:** ¿se permite? Si sí, la llave pasa a `(tenant, tipo, empresa, usuario)` con `NULLS NOT DISTINCT`.
4. **Autoaprobación.** Si el creador es aprobador de su propio grupo, ¿quién aprueba? Regla sugerida: salta al siguiente aprobador del orden, o sube un nivel. Se implementa en el motor y se documenta.
5. **Topes de monto y moneda.** `max_amount` no dice en qué moneda está. Con varias empresas con monedas distintas, un tope sin empresa es ambiguo. **Agregar `currency_code`** (obligatorio si `company_id` es nulo y el tenant tiene más de una moneda).
6. **Historial de valores del formulario.** Cuando el analista corrige la "Info Base", el valor anterior se pierde. **Registrar el antes/después** en `ticket_events` (tipo `FIELDS_UPDATED`) o en `ticket_field_value_history`.
7. **Empresa del ticket vs. empresas del creador.** Hoy un ticket puede quedar en una empresa a la que el creador no pertenece. **FK `(tenant_id, creator_id, company_id) → membership_companies`**, con la regla de que toda membresía tiene al menos una empresa (la de por defecto).
8. **Tareas paralelas duplicadas con `ticket_assignees`.** Los firmantes aparecen en las dos tablas. Definir que `ticket_assignees` es "quién lo tiene" y `ticket_parallel_tasks` es "quién ya firmó", con un trigger que las mantenga coherentes (al firmar se quita de asignados).
9. **`ticket_incidents.previous_assignee_ids uuid[]`** no tiene FK. Aceptable como foto, pero al restaurar hay que validar que sigan siendo miembros activos.
10. **Usuarios huérfanos.** Al purgar un tenant, las identidades globales sin ninguna membresía quedan sueltas. Hay que purgarlas en el mismo job (salvo los admins de plataforma).
11. **Preferencias del usuario:** faltan `locale` y `time_zone` en `users` (las fechas se muestran en su zona) y preferencias de notificación por tipo (correo sí/no).
12. **Plan con funciones:** `plans` solo tiene almacenamiento y usuarios. **Agregar `features jsonb`** (exportaciones, webhooks, PDF por plantilla…) para activar la v2 por plan.
13. **`updated_at`** solo lo pone Prisma. Las actualizaciones por SQL (triggers, jobs, funciones) no lo tocan. **Trigger genérico `set_updated_at`.**
14. **Enums vs. catálogos:** en PostgreSQL no se puede quitar un valor de un enum. Para listas que van a crecer (tipos de bloque, de campo, de evento) está bien; para `notifications.type` y `export_columns.source_type`, que hoy son texto libre, conviene un enum o un CHECK.

## 5. 🟡 Rendimiento y operación
1. **91 llaves foráneas sin índice** (PostgreSQL no las indexa solo). Afecta al borrado de un tenant (cada FK obliga a buscar en la tabla hija) y a los JOIN de reportes. Las de tickets, eventos, documentos, valores, relojes y errores son las críticas. **Corrección:** índice por cada FK compuesta. Se puede generar desde el catálogo y agregar una prueba que falle si aparece una FK nueva sin índice.
2. **Tablas de alto volumen** (`ticket_events`, `notifications`, `audit_logs`, `outbox_events`, `webhook_deliveries`): definir desde ya retención y limpieza (outbox procesado > 7 días, notificaciones leídas > 180 días) y dejar lista la opción de particionar por mes.
3. **`outbox_events`:** el índice debe ser parcial `WHERE status = 'PENDING'` para que no crezca con lo procesado.
4. **`dataset_rows`:** las búsquedas por cédula en un JSON serán lentas. **Agregar `lookup_key` (texto) con índice** `(tenant_id, dataset_id, lookup_key)` y, si hace falta, GIN sobre `data`.
5. **Búsqueda de tickets:** `tsvector` + GIN (ya estaba anotado como pendiente).

---

## 6. Propuesta de cómo aplicarlo
Una migración `…_integrity_hardening` con §1, §2, §3 y §5.1, más **una prueba por cada hueco** (las 19 intrusiones de esta revisión pasan a ser pruebas que deben fallar), y los cambios de modelo de §4 que se aprueben. Todo con las pruebas de integración en verde antes de darlo por terminado.
