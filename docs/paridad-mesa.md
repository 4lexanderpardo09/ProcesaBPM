# Paridad con la mesa de ayuda: revisión independiente (2026-10-25)

Un subagente comparó desde cero la mesa de ayuda (`mesa-de-ayuda/help-desk-backend` y `help-desk-frontend`, rama `main`) con ProcesaBPM (`main`), sin la lista de diferencias que ya conocíamos. Solo leyó código. Después verifiqué a mano los puntos de mayor impacto y corregí dos (ver «Correcciones»).

**Prefijos de la evidencia:**
- **MB** = `help-desk-backend/src/modules`
- **MF** = `help-desk-frontend/src`
- En ProcesaBPM: `api` = `apps/api/src/modules`, `shared` = `packages/shared/src`, `web` = `apps/web/src`.

**Resumen:** ProcesaBPM ya reproduce casi toda la mesa: flujos, novedades, errores, reapertura, lote, despacho aleatorio, topes de monto, cortes, planos, Formatos PDF, PDF con coordenadas, datasets, etiquetas, plantillas de texto y las 8 vistas de la bandeja. Las brechas reales están en reglas finas, en el front de la bandeja y en unos pocos datos.

## Correcciones al informe del subagente
- **Duplicar un Formato PDF sí existe.** «Documentos PDF → Formatos» tiene el botón «Duplicar» (`web/features/workflows/documents/components/FormatsCard.tsx:56`). El informe lo daba como faltante.
- **Agrupar el lote «por persona» existe en parte.** Se agrupa por empresa, sede o departamento del solicitante, o por corte de plano (`shared/workflow/block-config.ts:8`). Falta agrupar por un dato del formulario.
- **Cédula: confirmado.** La columna `users.document_number` existe (`packages/db/prisma/schema.prisma:509`) y la leen los planos (`api/exports/domain/line-projection.ts:40`) y la exportación de datos. Ningún contrato de `shared` ni pantalla la escribe.

## A. Lo que falta en ProcesaBPM
| # | Qué | Mesa | ProcesaBPM | Impacto | Lado | Evidencia |
|---|---|---|---|---|---|---|
| A1 | ~~**Cédula de la persona**~~ **Descartado por el usuario (2026-10-25):** no hace falta; los datos de empleados van en un Excel («Datos de Excel»), sin crear cuentas | Se captura al crear el usuario. Sale en planos (`solicitante` → cédula) y en Formatos PDF | La columna existe y los planos la leen, pero nada la llena: sale vacía. El PDF no la ofrece | **Alto** | ambos | MB/users/dto/create-user.dto.ts:72; MB/formatos-pdf/services/datos-ticket-pdf.service.ts:209; shared/contracts/identity/schemas.ts:26 y :39 |
| A2 | **Elegir firmantes y aprobador a mano** cuando no se resuelven solos | Si un cargo tiene 0 o más de un titular, se elige entre los usuarios de la empresa y se puede omitir la firma (`allowSkip`). Sin jefe inmediato también se elige a mano | Toma al titular con menos carga; si un firmante no se resuelve, falla todo el avance. Sin aprobador, error | **Alto** | ambos | MB/workflows/services/workflow-transition.service.ts:2107 y :2140; api/engine/application/assignment-resolver.ts:49 |
| A3 | **Columnas y orden de la bandeja** | Cliente, asignado, prioridad del usuario, prioridad del flujo, última actualización y la columna del campo filtrado. Se ordena (por defecto, por última actualización) | Número, título, estado, fecha y etiquetas. Orden fijo por número descendente | Medio | ambos | MF/modules/tickets/pages/TicketsPage.tsx:417-551; MB/tickets/services/ticket-listing.service.ts:354; web/features/tickets/components/TicketTable.tsx:24-36; api/tickets/data/ticket-query.repository.ts:103 |
| A4 | **Agregar un firmante paralelo nuevo al reasignar** | Sí (`crearNuevoParalelo`) | Solo mueve una firma pendiente a otra persona | Medio | back | MB/tickets/dto/reassign-ticket.dto.ts:32; shared/contracts/tickets/schemas.ts:72 |
| A5 | **Agrupar el lote por un dato del formulario** | Por un dato de la persona o por corte de plano | Por empresa, sede o departamento del solicitante, o por corte de plano | Bajo | back | MB/workflows/services/procesar-lote.service.ts:37; shared/workflow/block-config.ts:8 |
| A6 | ~~**Calculadora «saldo de viáticos»**~~ **Resuelto con fórmulas (2026-10-26):** `ANTICIPO - SUM(GASTOS.VALOR)`; la calculadora fija se quitó, y la de alimentación pasó a «Pago por franjas horarias» con tarifas de cada organización | `CALC:SALDO_VIATICOS` | Solo `MEAL_ALLOWANCE`, aunque la decisión D3 era traer las dos | Medio | back | help-desk-backend/src/common/calculos/saldo-viaticos.calculator.ts; shared/calculators/ |
| A7 | **Mantenimiento activado por el cliente** | El administrador del cliente lo activa; solo entra el rol Administrador | Solo el anuncio de plataforma bloquea el ingreso; el cliente no lo controla | Bajo | ambos | MB/system-config/system-config.controller.ts:36; MB/auth/auth.service.ts:58; api/announcements/domain/login-block-policy.ts |
| A8 | **Manual de usuario** | Docusaurus en `help-desk-frontend/docs` (unas 45 páginas) | No hay; solo Storybook | Bajo | front | `apps/web` |
| A9 | **Notificaciones en tiempo real en la web** | La campana se actualiza por WebSocket | El API tiene la pasarela, pero la web consulta cada cierto tiempo | Medio | front | MF/shared/services/notifications-ws.service.ts; `apps/web/package.json` sin `socket.io-client` |
| A10 | **Bloque `WEBHOOK`** | No aplica | Declarado pero no se puede publicar (v2) | Bajo | back | shared/workflow/engine-support.ts:15 |

**No se van a construir (decisión o reemplazo):**
- Ventas, viáticos (como módulo propio) y listas de precios: fuera del alcance (analisis.md §1).
- Campos alimentados por SQL guardado (`campo_query`): los reemplazan los datasets, por seguridad (MB/templates/templates.controller.ts:69).
- Reportes guardados con SQL (`tm_consulta`): MB/reports/reports.controller.ts:43-102. No se encontró código que los ejecute; puede ser un resto sin uso.
- Diagnóstico `dashboard/pasos-estado-null`: MB/reports/reports.controller.ts:639. Es interno de la mesa.

- **Hecho (2026-10-25): «llenar todos los que coinciden»**, el «campo trigger» de la mesa. Antes, cada campo se configuraba por separado. Ahora en el constructor está «Llenar desde un Excel»: se eligen el Excel y el campo de la clave, y quedan configurados de una vez los campos de texto del bloque cuyo código coincide con una columna.

## B. Existe en ambos pero funciona distinto: decidir con el negocio
| # | Qué | Mesa | ProcesaBPM | Opinión | Evidencia |
|---|---|---|---|---|---|
| B1 | **Paso con varios candidatos sin selección manual** | Se lo da al primero de la lista (`candidates[0]`, arbitrario) | Pool: todos lo ven y el primero que actúa lo toma | ProcesaBPM es mejor, pero cambia quién recibe el trabajo: **confirmar** | MB/assignments/assignment.service.ts:337; api/engine/domain/assignment-policy.ts:51 |
| B2 | **Asignar por cargo y sede** | Primero la regional del solicitante y, si no hay nadie, cualquiera. No filtra por empresa | Sede exacta sin respaldo (SAME_SITE), sedes superiores (PARENT_SITE) o todas (ANY_SITE); filtra por empresa | **Riesgo:** tickets que la mesa mandaba a la oficina central pueden quedar sin candidato. Conviene la opción «sede y, si no hay, cualquiera» | MB/assignments/assignment.service.ts:226; api/engine/domain/site-scope.ts:17 |
| B3 | **Adjuntos** | 10 MB por archivo, 15 archivos; no se encontró lista de tipos | 4 MB por archivo, 15 archivos, 20 MB por envío; solo PDF, imagen, Office y ZIP | **Riesgo:** archivos que hoy se aceptan serían rechazados. **Decidir el límite** | MB/documents/dto/presign-adjuntos.dto.ts:42; shared/files/file-types.ts:1-8 |
| B4 | **A quién se notifica** | Crear: al creador. Avanzar: a los nuevos asignados y observadores. Cerrar: a todos los que estuvieron asignados y observadores. Reabrir: creador y asignados. Correo solo al asignar | Crear: al solicitante si otro registró el ticket, y a los observadores. Avanzar, cerrar y reabrir: solicitante, registrador y observadores. Nunca a quien actuó. Correo y app en todo, con preferencias | **Confirmar** | MB/notifications/services/notifications.service.ts:29-176; MB/tickets/services/ticket.service.ts:1207-1350; api/notifications/domain/recipient-policy.ts:52-72; api/notifications/domain/channels.ts:8 |
| B5 | **Puntaje del ranking** | (0,7·C + 0,3·Q) · ln(n+1) · (1−e/n)², con errores de proceso; color relativo al mejor | 100 × C × Q, con errores de reapertura; mínimo 5 tickets; desempate por mediana | **Cambia el orden del ranking: confirmar** | MB/reports/reports.service.ts:391; api/reports/domain/ranking-score.ts:23 |
| B6 | **Prioridad** | Dos (la del usuario y la del flujo), que se muestran y filtran por separado; por defecto «Media» | Una sola; si no se elige, la de la subcategoría | **Confirmar** | MB/tickets/dto/ticket-filter.dto.ts:191; api/engine/application/create-ticket.service.ts:192 |
| B7 | **Observadores** | Solo usuarios; reciben aviso de cada firma paralela | Usuarios, cargos o grupos; no reciben aviso de las firmas paralelas | Medio | MB/workflows/services/workflow-transition.service.ts:1733; api/notifications/application/ticket-notification.handlers.ts:36-39 |
| B8 | **Semáforo de vencimiento** | 4 niveles en días hábiles: rojo ≤1, naranja ≤2, amarillo ≤4 | 3 estados: vencido, por vencer (menos de 24 h corridas), a tiempo; además «en pausa» | Bajo | MB/workflows/services/sla.service.ts:193; web/features/tickets/lib/sla-badge.ts:8 |
| B9 | **Vistas y paginación de la bandeja** | Las vistas según permisos `view:*`; 10 por página | Las 8 vistas siempre visibles, con conteos y limitadas por el acceso; 25 por página (máximo 100) | Bajo | MF/modules/tickets/pages/TicketsPage.tsx:94-118; MB/tickets/dto/ticket-filter.dto.ts:184; web/features/tickets/lib/inbox-params.ts:8; shared/contracts/common.ts:21 |
| B10 | **Alcance de los reportes** | Con `read Report` se ve todo | Se recorta por empresa, departamento, sede o flujo; el rol AGENTE solo ve su departamento | Mejor así; **avisar al cliente** | MB/reports/reports.controller.ts:116; api/reports/domain/report-scope.ts:63; packages/db/src/seed/role-templates.ts:52 |
| B11 | **Comentar un ticket cerrado** | No se puede: «Ticket Cerrado. No se pueden realizar más acciones» | Se puede (no mueve el ticket) | **Decidir** | MF/modules/tickets/components/TicketResponsePanel.tsx:398; api/engine/application/comment-ticket.service.ts:15 |
| B12 | **Editar un ticket** | `PUT` con cualquier campo del DTO de creación; la pantalla deja cambiar la categoría | Título, descripción, prioridad y valores corregibles, con evento; la categoría no cambia | Bajo | MB/tickets/services/ticket.service.ts:624-629; MF/modules/tickets/components/EditTicketModal.tsx:67-72; shared/contracts/tickets/schemas.ts:40 |
| B13 | **Exportar abiertos por flujo** | Filtra por estado (cerrados incluidos) y por regional | El reporte de backlog cubre solo lo abierto | Bajo | MB/tickets/services/flow-open-tickets-export.service.ts:28-40; api/reports/domain/report-sheets.ts:93 |
| B14 | **Límites de la exportación a Excel** | Rango de 3 meses (control del front) | 366 días y tope de 10 000 filas | Bajo | MF/modules/reports/utils/dateRange.ts:5; shared/contracts/reports/filters.ts:5; api/reports/application/report-export.service.ts:44 |
| B15 | **Pendientes del inicio** | Por fecha de creación | Primero por vencimiento del SLA; máximo 100 | Bajo | MB/dashboard/services/dashboard/dashboard.service.ts:108; api/dashboard/data/dashboard.repository.ts:24 |
| B16 | **A quién se atribuye un error reportado** | A la penúltima fila de asignación | A la última visita terminada de un paso de personas | Bajo | MB/tickets/services/ticket-error.service.ts:90-110; api/engine/domain/report-error-policy.ts |

## C. Distinto a propósito y mejor en ProcesaBPM: se deja así
| # | Qué | Mesa | ProcesaBPM | Evidencia |
|---|---|---|---|---|
| C1 | **Cerrar un ticket** | El back solo revisa que no esté cerrado; «permite cerrar» y «cierre obligatorio» se controlan solo en el front, sin topes ni acceso al ticket concreto | La regla de cierre del paso (NOT_ALLOWED, ALLOWED, REQUIRED), la aprobación extra por monto y el acceso al ticket se validan en el back | MB/tickets/services/ticket.service.ts:1046-1048; api/engine/domain/close-policy.ts:7 |
| C2 | **Leer o actuar sobre un ticket ajeno** | Con `read`/`update Ticket` se ve o modifica cualquier ticket por id | Filtro de acceso en la base de datos, ticket por ticket | MB/tickets/controllers/ticket.controller.ts:123-128; api/tickets/application/ticket-access.ts |
| C3 | **Persona elegida a mano** | Acepta cualquier id sin validar | Exige que sea candidata | MB/assignments/assignment.service.ts:304; api/engine/domain/assignment-policy.ts |
| C4 | **SLA** | Días hábiles a la misma hora, festivos de Colombia fijos en el código (2025–2027); corre en pausa; revisa cada 5 min; avisa solo a los asignados; sin preaviso | Calendario por empresa (horario y festivos), horas o días, vence al final de la jornada; se pausa con la novedad; revisa cada minuto; avisa a responsables y observadores; preaviso al 80 % | MB/workflows/services/sla.service.ts:273 y :340; help-desk-backend/src/common/utils/date.helper.ts:4-80; api/sla/application/sla-warning.job.ts:7; api/sla/application/sla-overdue.scheduler.ts:6 |
| C5 | **Jefe o aprobador** | Organigrama cargo → cargo jefe, en la misma regional y si no en cualquiera | Grupos de aprobación por tipo (empresa primero, luego general), delegaciones, niveles y bloqueo de autoaprobación (falta la elección manual: A2) | MB/assignments/assignment.service.ts:38-87; api/approvals/domain/resolve-approver.ts |
| C6 | **Firma paralela** | Solo se firma | Se firma o se rechaza; el primer rechazo decide y cancela las pendientes | MB/workflows/controllers/workflow.controller.ts:142; api/engine/domain/parallel-policy.ts |
| C7 | **Reabrir** | Error opcional y de tipo fijo `1`; responsable `usuarioAsignadorId`; vuelve a los asignados del paso actual | Error obligatorio de un tipo de reapertura elegido; responsable quien cerró (o el indicado); se elige paso y persona; SLA nuevo | MB/tickets/services/ticket.service.ts:1307-1312; shared/contracts/tickets/schemas.ts:90-100 |
| C8 | **Novedad** | La resuelve solo el asignado; descripción opcional; vuelve a quien la abrió; el SLA no se pausa | La resuelve el asignado, quien la abrió o un supervisor; resolución obligatoria; vuelven los titulares originales en su papel; el SLA se pausa | MB/tickets/services/ticket.service.ts:934; api/engine/domain/incident-policy.ts:47 |
| C9 | **Dos personas actuando a la vez** | Sin control | `visitId` obligatorio: si el ticket ya avanzó, 409 | shared/contracts/tickets/schemas.ts:56 |
| C10 | **Cuentas y acceso** | El admin pone la contraseña (mínimo 6); sin restablecimiento, bloqueo ni MFA; JWT en localStorage | Invitación por correo, mínimo 10 caracteres, bloqueo tras 5 intentos por 15 min, MFA, renovación de sesión, token solo en memoria | MB/users/dto/create-user.dto.ts:36; shared/contracts/auth/password.ts:3; api/auth/domain/auth-policy.ts:4 |

**Funcionan igual:**
- despacho aleatorio balanceado (los tickets de un mismo lote van juntos);
- el paso que exige el corte del plano;
- los orígenes de las columnas de los planos (ProcesaBPM tiene más);
- los momentos en que se genera cada PDF;
- crear un ticket a nombre de otra persona;
- el error de proceso con cierre forzado.

## Solo en ProcesaBPM
- **Plataforma:** varios clientes en un mismo sistema, consola de plataforma, planes, cuota de almacenamiento, purga, acceso de soporte con permiso del cliente y exportación completa de sus datos.
- **Flujos:**
  - versiones con validación al publicar;
  - bloques automáticos CONDITION, DOCUMENT, NOTIFICATION, EXPORT, WAIT y CALCULATOR;
  - delegaciones, aprobación en varios niveles y SLA distinto por empresa.
- **Tickets:** comentarios sin avanzar el ticket, tomar un ticket de un pool, rechazar una firma paralela, y vista previa del avance y de la creación.
- **Cuentas y avisos:** preferencias de notificación, preaviso del SLA, tiempo real en el API, auditoría, MFA, restablecimiento de contraseña, i18n y logo del cliente.
- **Campos:** MULTI_SELECT, USER, FILE y FORMULA, con lenguaje de fórmulas propio.

## Dudas que quedaron abiertas
- **Tipos de archivo en la mesa:** no se encontró restricción en el back (`fileFilter`, `mimetype`). Puede estar en el front o en el bucket.
- **Firmantes por empresa:** la mesa los toma de la plantilla PDF de cada empresa. En ProcesaBPM van en el paso; falta confirmar si cambian por empresa.
- **Ranking por regional:** no se comparó el de la mesa (`ROW_NUMBER` por regional) con el reporte por sede.
- **Vista «Reabiertos»:** en ProcesaBPM incluye todo ticket que se reabrió alguna vez. No se revisó el criterio exacto de la mesa.
- **Constructor de flujos:** no se comprobó que expone cada opción del API, por ejemplo todos los parámetros de un bloque.

## Orden de trabajo propuesto
1. **A2** (firmantes y aprobador a mano, con omitir firma).
2. **B2** (opción «sede y, si no hay, cualquiera») y **B3** (límite y tipos de adjuntos, por decidir).
3. **A3** (columnas y orden de la bandeja) y **A4** (agregar un firmante al reasignar).
4. **A9** (tiempo real en la web) y **A8** (manual).
5. Decisiones de negocio pendientes: **B1**, **B4**, **B5**, **B6** y **B11**.
