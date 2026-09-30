# ProcesaBPM: análisis para extraer la Mesa de Ayuda como SaaS

Fecha: 2026-09-30
Fuente revisada: ramas `feature/viaticos-en-tickets` de back y front (el backend tiene cambios sin commit de lote/días fuera), BD local `helpdesk_pd_test` (89 tablas, MySQL 8).
**Fuera del alcance, a pedido:** el módulo propio de viáticos (`tm_viatico_*`, `src/modules/viaticos`) y ventas (`td_venta`, `th_venta_ingesta`, `tm_venta_config`, `src/modules/ventas`).
Lo que viáticos aportó **al motor de tickets** (campo `table`, `CALC:*`, `datetime`, topes de monto, cortes, pago en lote) sí entra, porque ya es genérico.

Severidad: 🔴 crítico (seguridad o pérdida/corrupción de datos) · 🟠 bug o deuda que hay que corregir antes del SaaS · 🟡 limpieza/mejora.

---

## 0. Resumen ejecutivo

El sistema ya no es una "mesa de ayuda": es un **motor de procesos (BPM ligero)** con formularios dinámicos, asignación por organigrama/cargo/regional, SLA en días hábiles, firmas y PDFs, archivos planos por cortes, y reportes de desempeño. Esa es la lógica que vale la pena llevarse.

Lo que **no** se debe copiar tal cual:

1. **No hay autorización por registro.** Cualquier usuario con `read Ticket` puede leer cualquier ticket y sus documentos por ID. Cualquiera con `update Ticket` puede transicionar, editar (`PUT /tickets/:id`) o cerrar tickets que no le están asignados. En un SaaS esto significa fuga de datos entre clientes.
2. **Inyección SQL**: en reportes, las fechas `dateFrom`/`dateTo` se concatenan dentro del SQL sin validar (23 usos). En campos dinámicos se ejecuta SQL guardado en la BD (`campo_query`/`tm_consulta`) y se reemplaza `%SEARCH%` con el texto del usuario.
3. **XSS almacenado**: la descripción del ticket se guarda como HTML crudo y se pinta sin sanitizar (`TicketWorkflow.tsx:129`). El JWT vive en `localStorage`, así que un XSS permite robar sesiones.
4. **El cron de SLA procesa tickets cerrados**: ya hay **22.964 alertas de "vencido" enviadas después del cierre**, en 15.130 tickets (el 60 % de todas las alertas).
5. **Integridad de BD débil**: solo existen 34 FKs en el núcleo. **Ninguna** tabla central (`tm_ticket`, historial, detalle, documentos, campos, pasos, transiciones, usuarios) tiene FK, y ya hay huérfanos reales. Hay 11 tablas **MyISAM**, sin transacciones, dentro de flujos que el código cree transaccionales.
6. **Varias generaciones de la misma cosa conviven**: 3 mecanismos de PDF, 2 fuentes de "asignados", 2 registros de errores, 4 tablas de documentos, 3 sistemas de "quién puede crear", y tablas de KPIs precalculados que ya no se usan.

Recomendación: el SaaS se construye como **proyecto nuevo con un modelo de datos limpio**, portando la **lógica** (reglas de negocio de §2) y **no** el esquema. El esquema actual solo sirve como referencia: Electrocréditos **no** se migra y sigue con su versión (decisión 0.1).

### 0.1 Decisiones tomadas (2026-09-30)

| Tema | Decisión |
|---|---|
| Tenant vs Empresa | **Tenant = cliente del SaaS.** Cada tenant tiene **1..N empresas**. Si tiene una sola, es la empresa por defecto y la UI no pide elegirla. |
| Base de datos | **PostgreSQL**, **una sola BD compartida** con `tenant_id` en cada tabla + Row-Level Security. |
| Electrocréditos | **No se migra.** Sigue con su versión actual. El SaaS arranca limpio, sin migración de datos. |
| Listas de precios | **No entran.** |
| PDF | Se mantienen **dos mecanismos**: ① diseñador de Formatos PDF y ② **PDF propio subido por el cliente + campos/firmas por coordenadas**. Se descarta el legado `tm_campo_plantilla`/`tm_flujo_paso_firma`. Ver §7.3. |
| Archivos/documentos | Rediseñar el almacenamiento (hay desorden confirmado): ver §7. |
| SLA | Medible en **horas hábiles o días hábiles**, con calendario (horario + festivos) **por empresa**: ver §8. |
| SLA en días | Vence al **final de la jornada** del N-ésimo día hábil. |
| SLA y novedad | El reloj se **pausa** durante la novedad y se reanuda al resolverla. |
| SLA y reasignación | Reasignar dentro del mismo paso **reinicia** el reloj para el nuevo responsable. |
| Límites de archivos | **4 MB por archivo**; subidas de **hasta 15 archivos y 20 MB en total** por envío. |
| Tipos de archivo | **PDF, imágenes, Office y ZIP** (lista exacta en §7.2). |
| Antivirus | **No** por ahora. |
| Retención | Los archivos **se guardan siempre**: el borrado es solo lógico, sin purga. |
| Cuota | Cuota por tenant según su plan (**tabla aprobada**, §7.4.2). Los PDFs del sistema **cuentan**, los borrados **cuentan** y hay **5 % de gracia**. |
| Reportes de SLA | Miden **ambos**: el SLA de cada responsable y el tiempo total del paso. |
| Proveedor de archivos | Aún no hay. Se programa contra la API S3, en desarrollo se usa MinIO y en producción se recomienda Cloudflare R2 (§7.4.3). |
| Despliegue | **Imágenes Docker**, sin atarse a ningún hosting (se elige después): ver §9. |
| Nombre del producto | **ProcesaBPM**. |
| Planos | Función **estándar** del SaaS (no es un complemento de pago). |
| Observadores de flujo | **Se mantienen**; se pueden definir por usuario, cargo o grupo. |
| Transiciones a sí mismo | **Son intencionales** (bucles de reproceso): el motor debe soportarlas (§10.3). |
| Jefe inmediato | Se reemplaza el organigrama por **grupos de aprobación explícitos**: "X aprueba a Y, Z y J" (§10). |
| Grupos de aprobación | Con **tipo**; un usuario es miembro de **un solo grupo por tipo**. Hay **aprobación multinivel** (aprobador del aprobador). |
| Stack | **NestJS + React + Prisma** (PostgreSQL). |
| Salida de un cliente | Se le **entrega una exportación completa** (datos + archivos). Plazo de conservación propuesto: **60 días** (§12). |
| Pendientes §12.1 | **Todas las propuestas aceptadas**: usuario global con membresía en varios tenants (D1), sedes jerárquicas genéricas (D2), moneda/país por empresa y español con i18n (D4), solo usuarios internos en v1 (D5), roles base + personalizados (D6), 60 días y luego borrado (D7). **Excepción D3:** se llevan **también** las calculadoras actuales (alimentación, saldo de viáticos) como funciones opcionales, además del motor de fórmulas genérico. |
| Constructor de flujos | **Visual, al estilo del Flow Builder de Truora**, con **React Flow** (confirmado): ver §13. |
| Facturación | Sin definir todavía. El modelo deja listas las tablas `plan`/`suscripcion` para agregarla después sin rediseñar. |
| PDF con formulario | **Sí**: además de coordenadas se soportan PDFs con campos de formulario (AcroForm) que se llenan por nombre. |

---

## 1. Inventario: qué se lleva y qué no

| Módulo actual (backend) | ¿Se lleva? | Nota |
|---|---|---|
| auth, users, roles, permissions (CASL) | ✅ | rediseñar el JWT y los permisos por registro (§4.1) |
| companies, departments, positions (cargos) + organigrama, regions, zones, profiles | ✅ | es la "estructura organizacional" configurable del tenant |
| categories, subcategories, priorities, rules (ReglaMapeo) | ✅ | unificar las reglas de "quién crea" (§4.3) |
| workflows (flujos, pasos, transiciones, campos, firmas, topes de monto, cortes, despacho aleatorio, lote) | ✅ **núcleo** | es el producto |
| tickets (crear, transicionar, novedad, cerrar, reabrir, errores, etiquetas, historial, exportes) | ✅ **núcleo** | |
| assignments (resolución de responsable) | ✅ **núcleo** | |
| notifications (in-app, email, websocket externo) | ✅ | rehacer con cola/outbox (§4.6) |
| documents / storage (local, S3) | ✅ | un solo modelo de adjuntos (§3.5) |
| formatos-pdf (diseñador nuevo) | ✅ | quedarse **solo** con este mecanismo de PDF |
| templates (PDF subido + coordenadas: `tm_flujo_plantilla`, `tm_pdf_campo_coord`, `tm_pdf_firma_coord`, `tm_paso_firma`) | ✅ | segundo mecanismo de PDF (decisión 0.1), rediseñado en §7.3 |
| `tm_campo_plantilla` + `tm_flujo_paso_firma` (primera generación de coordenadas) | ❌ legado | se descarta |
| planos (archivos planos por corte) | ✅ | ya es genérico |
| imports (`tm_data_excel`: Excel como fuente de datos de campos) | ✅ con cambios | tabla real por dataset, no JSON longtext |
| reports, dashboard | ✅ | reescribir las consultas (§4.2 y §3.6) |
| text-templates (snippets), tags, error-types | ✅ | |
| system-config (mantenimiento, notas de versión) | ✅ | separar la config de plataforma de la del tenant |
| price-lists | ❌ | decidido: no entra |
| viaticos, ventas | ❌ | excluidos |

---

## 2. Lógica de negocio que se extrae (lo que el SaaS debe reproducir)

### 2.1 Estructura organizacional
- **Empresa** (`td_empresa`) → hoy Arpesod/Finansueños. Los usuarios pertenecen a N empresas (`empresa_usuario`) y las categorías se habilitan por empresa (`categoria_empresa`).
- **Departamento** (con `dp_jefe_id`, sin datos), **Regional** → **Zona**, **Cargo**, **Organigrama** (cargo → cargo jefe), **Perfil** (grupos transversales), **Rol** (permisos CASL).
- Usuario: 1 rol, 1 cargo, 1 regional, 1 departamento, `es_nacional`, N perfiles, N empresas, firma (imagen).

### 2.2 Catálogo
- Categoría → Subcategoría (con prioridad por defecto). Visibilidad por departamento/empresa.
- **Una subcategoría = un flujo** (`tm_flujo.cats_id` UNIQUE).
- ReglaMapeo: quién puede crear en una subcategoría, por cargo (`regla_creadores`) o por perfil (`regla_creadores_perfil`). **Es permisivo**: sin regla, cualquiera crea.

### 2.3 Motor de flujos
- **Paso**: cargo asignado, SLA en **días hábiles** (`paso_tiempo_habil`), flags de comportamiento (ver §3.4), campos dinámicos (`tm_paso_campo`), firmantes, adjuntos descargables, iniciadores permitidos.
- **Transición**: origen → destino con nombre de condición (el usuario elige la "decisión"). `paso_destino_id NULL` = fin. `solo_tope` = solo la usa el sistema al desviar por monto.
- **Pasos de entrada** = los que no tienen transiciones entrantes activas. Si hay varios, el creador elige ("decisiones"), filtrado por `tm_flujo_paso_iniciadores`.
- **Tipos de asignación de un paso** (en orden de prioridad, `AssignmentService.getCandidatesForStep`):
  1. `asignar_a_creador` → el creador.
  2. Aprobación del jefe (`necesita_aprobacion_jefe` / `requiere_confirmacion_jefe`) → el jefe elegido manualmente, o el jefe inmediato por organigrama (cargo jefe, en la misma regional y si no en cualquiera).
  3. Usuarios explícitos del paso (`tm_flujo_paso_usuarios`).
  4. Cargo del paso + regional del creador (salvo `es_tarea_nacional`), con fallback a cualquier regional.
  - Modificadores: `requiere_seleccion_manual` (el usuario elige entre los candidatos), `es_pool` (todos los candidatos, el primero que actúa lo toma), `es_paralelo` (un firmante por cargo, todos deben firmar), `despacho_aleatorio` (queda sin asignar y un cron lo reparte round-robin cada N minutos).
- **Topes de monto** (`tm_flujo_regla_monto`): por flujo/paso/cargo/empresa, sobre un campo o una columna de un campo tabla. Acciones: bloquear, advertir (queda un comentario) o desviar a un paso de aprobación extra.
- **Plazos**: `sla` (días hábiles desde que entra al paso) o `corte` (fecha de un campo + días hábiles, ajustada al día de corte de la empresa, `tm_flujo_corte`). Semáforo: rojo ≤1 día, naranja ≤2, amarillo ≤4.
- **Lote**: pasos con `permite_despacho_masivo`/`paso_lote_config` permiten procesar varios tickets a la vez.

### 2.4 Ciclo de vida del ticket
- Crear → validar regla de creación → validar campos requeridos (captura `creacion|ambos`) → topes de monto → transacción (ticket + inicio de flujo + adjuntos + valores) → PDF inicial → notificaciones al creador y a los observadores del flujo.
- Transicionar → validar que la transición sale del paso actual → campos requeridos del paso → topes → resolver responsable(s) → historial (SLA del paso saliente: "A Tiempo"/"Atrasado") → firma/PDF → comentario/adjuntos → valores (upsert por campo) → línea de plano → notificaciones.
- **Novedad**: pausa el ticket (`Pausado`) y lo asigna a otra persona. Al resolverla vuelve a quien creó la novedad.
- **Cerrar**: SLA final, historial con `est=2`, valores finales, línea de plano (evento `cierre`), Formato PDF, notificación a participantes y observadores.
- **Reabrir**: vuelve a `Abierto`, reasigna a los últimos asignados y registra un error (tipo 1) al responsable.
- **Errores** (`tm_ticket_error`): de proceso vs informativo, con responsable. Alimentan el ranking y el cumplimiento.
- Etiquetas personales por usuario, plantillas de texto personales/compartidas.

### 2.5 Campos dinámicos
Tipos: `text, textarea, select, currency, number, date, datetime, dias, regional, table`. Tienen captura (`creacion|paso|ambos`), inmutable, requerido, orden y configuración JSON (opciones, columnas, fórmulas). Orígenes de datos: `PRESET_*`, `EXCEL:<dataset>:<col>`, `CALC:<calculadora>` y SQL crudo (a eliminar). Los montos se recalculan en el servidor (`CampoValorNormalizerService`).

### 2.6 Documentos y PDFs
- Formatos PDF (diseñador por bloques, con expresiones y marcadores), generados por una cola (`td_formato_pdf_trabajo` + cron cada minuto) al crear el ticket y al terminar cada paso.
- Firmas manuscritas por paso (`td_ticket_firma`).

### 2.7 Planos
Definición por flujo, disparada por una transición (condición) o por el cierre, con filtro JSON, columnas con origen (campo, fecha del ticket, catálogo, constante…), catálogos de traducción, formato CSV/XLSX, agrupación por empresa y corte programado (diario, semanal, mensual o cada N días) con catch-up.

### 2.8 Reportes
KPIs globales, ranking por usuario (score de cumplimiento × calidad), distribución de tiempos, novedades, categorías, detalle por usuario, tickets abiertos por flujo y exportes Excel. Todo se calcula en vivo sobre `th_ticket_asignacion` con CTEs (réplica de `v_asignaciones_completas`).

---

## 3. Base de datos: hallazgos

### 3.1 🔴 Llaves foráneas faltantes (revisión completa)

De las ~110 relaciones lógicas del núcleo, solo **34 tienen FK**, y todas están en tablas nuevas (planos, regla_monto, iniciadores, cortes, plantillas de texto, permisos). **Ninguna de las tablas transaccionales centrales tiene FK.**

Relaciones sin FK y huérfanos que ya existen (conteo real):

| Relación (sin FK) | Filas con valor | **Huérfanos** |
|---|---:|---:|
| `tm_notificacion.tick_id → tm_ticket` | 146.125 | **629** |
| `td_ticket_campo_valor.paso_campo_id → tm_paso_campo` | 595 | **170** (la definición del campo se borró físicamente) |
| `td_documento.tick_id → tm_ticket` | 20.808 | **64** |
| `td_ticketdetalle.tick_id → tm_ticket` | 29.163 | **43** |
| `td_ticket_campo_valor.tick_id → tm_ticket` | 1.350 | **40** |
| `categoria_empresa.cat_id → tm_categoria` | 76 | **28** |
| `th_ticket_asignacion.tick_id → tm_ticket` | 42.723 | **24** |
| `empresa_usuario.usu_id → tm_usuario` | 214 | **18** |
| `categoria_departamento.cat_id → tm_categoria` | 46 | **14** |
| `tm_ticket_error.error_type_id → tm_error_type` | 1.353 | **10** |
| `tm_documento_flujo.tick_id → tm_ticket` | 895 | **8** |
| `td_documento_detalle.tickd_id → td_ticketdetalle` | 2.082 | **4** |
| `td_ticket_etiqueta.tick_id`, `th_ticket_novedad.tick_id`, `tm_ticket_error.tick_id`, `tm_plano_linea.tick_id` | — | **2 c/u** |
| `tm_flujo_paso_usuarios.car_id`, `tm_flujo_paso_firma.car_id → tm_cargo` | — | **1 c/u** |

Sin FK pero hoy sin huérfanos (hay que ponerlas igual):
- `tm_ticket`: `usu_id, cat_id, cats_id, pd_id, emp_id, dp_id, reg_id, paso_actual_id, how_asig, usu_id_jefe_aprobador, usu_id_registra`
- `th_ticket_asignacion`: `usu_asig, how_asig, paso_id, error_code_id, error_subtype_id`
- `td_ticketdetalle.usu_id`, `td_ticket_etiqueta.eti_id/usu_id`, `td_ticket_firma.*`, `td_formato_pdf_trabajo.*`
- `th_ticket_novedad.paso_id_pausado/usu_asig_novedad/usu_crea_novedad`, `tm_ticket_error.usu_id_reporta/usu_id_responsable`, `tm_ticket_paralelo.*`
- `tm_notificacion.usu_id`
- `tm_usuario.rol_id/reg_id/car_id/dp_id`, `tm_usuario_perfiles.*`, `empresa_usuario.emp_id`
- `categoria_*.dp_id/emp_id`, `tm_subcategoria.cat_id/pd_id`, `tm_departamento.dp_jefe_id`, `tm_regional.zona_id`, `tm_organigrama.car_id/jefe_car_id`
- **Motor de flujos**: `tm_flujo.cats_id`, `tm_flujo_paso.flujo_id/cargo_id_asignado`, `tm_flujo_transiciones.paso_origen_id/paso_destino_id`, `tm_flujo_paso_usuarios.paso_id/usu_id`, `tm_flujo_plantilla.flujo_id/emp_id`, `tm_paso_campo.flujo_plantilla_id`, `tm_paso_firma.*`, `tm_pdf_*_coord.paso_base_id`, `tm_paso_adjunto.paso_id`, `tm_data_excel.flujo_id`
- `tm_regla_mapeo.cats_id`, `regla_creadores.*`, `regla_creadores_perfil.*`, `tm_etiqueta.usu_id`
- `tm_lista_precio.dp_id/usu_id_crea`, `tm_lista_precio_config.*`, `tm_plano_linea.plano_lin_confirmada_por`, `tm_plano_corte.plano_corte_generado_por`, `tm_formato_pdf.usu_id_modi`

**Corrección (buena práctica):**
- En el SaaS, **toda** columna `*_id` lleva FK. `ON DELETE RESTRICT` por defecto: se desactiva (`activo=false`/`deleted_at`) y no se borra. `CASCADE` solo para hijos puros (líneas de un ticket, columnas de un plano).
- Nunca borrar físicamente configuración que ya tiene datos (ver §3.7): `tm_paso_campo` se borra hoy en `flujo-plantilla-coord.service.ts:335/400/512`, y por eso existen los 170 valores huérfanos.
- En el sistema actual, antes de migrar: limpiar los huérfanos (script de reporte y decisión caso a caso) y agregar las FKs por migración. Los 629 huérfanos de notificaciones se pueden borrar.

### 3.2 🔴 Motor de almacenamiento y juegos de caracteres mezclados
- **11 tablas MyISAM**: `td_ticket_campo_valor`, `tm_ticket_paralelo`, `th_ticket_novedad`, `tm_ticket_error`, `tm_documento_flujo`, `tm_regla_mapeo`, `regla_creadores`, `tm_campo_plantilla`, `tm_flujo_paso_firma`, `tm_consulta`, `tm_zona`. MyISAM **no soporta transacciones ni FKs**. El código escribe en `td_ticket_campo_valor` y `tm_ticket_paralelo` dentro de `dataSource.transaction(...)`, así que si la transición falla esos cambios **no se revierten** (quedan valores y paralelos de transiciones que nunca ocurrieron).
- Collations mezcladas: `utf8mb4_0900_ai_ci` (49), `utf8mb3_general_ci` (21), `utf8mb4_unicode_ci` (11), `utf8mb3_spanish_ci` (5), `utf8mb4_general_ci` (3). Los JOINs entre collations distintas impiden usar índices y fallan con "Illegal mix of collations". Con utf8mb3 no se pueden guardar emojis.
- **Corrección:** todo InnoDB y todo `utf8mb4` + una sola collation (`utf8mb4_0900_ai_ci`). Aplicar en el sistema actual con `ALTER TABLE … ENGINE=InnoDB, CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`.

### 3.3 🟠 Índices
- `tm_notificacion` (**146k filas**) no tiene ningún índice aparte de la PK, y cada consulta de la campana filtra por `usu_id` + `est`. Falta `(usu_id, est, fech_not)`.
- `tm_ticket` solo tiene índices en `(cat_id,cats_id)` y `tick_estado`. Faltan `usu_id`, `paso_actual_id`, `emp_id`, `fech_crea`, `(tick_estado, est)`.
- Sin índices: `td_ticket_campo_valor (tick_id, paso_campo_id)`, `tm_ticket_paralelo (tick_id, paso_id)`, `tm_documento_flujo (tick_id, paso_id)`, `td_documento_detalle (tickd_id)`, `tm_flujo_paso (flujo_id)`, `tm_flujo_paso_usuarios (paso_id)`, `empresa_usuario (usu_id)`, `regla_creadores`.
- Índices duplicados en `th_ticket_asignacion`: `idx_tha_usu_asig` = `idx_ticketasignacion_usu_asig`; `idx_tick_id` queda cubierto por los compuestos.
- Falta UNIQUE en `tm_usuario.usu_correo`, que es la llave de login. Ya hay **2 correos duplicados** (`liderzonapopayan@…` ids 126/140, `supernumerario@…` ids 179/205, uno activo y otro inactivo). También faltan UNIQUE en `(paso_id, usu_id)` de `tm_flujo_paso_usuarios` (ya hay 1 duplicado), `(tick_id, paso_campo_id)` de valores, `(usu_id, emp_id)`, `(cat_id, emp_id)` y `(cat_id, dp_id)`.
- La búsqueda de tickets usa `LIKE '%…%'` sobre `mediumtext` (título, descripción y detalle). **Corrección:** índice FULLTEXT o un motor de búsqueda.

### 3.4 🟠 Columnas redundantes, mal tipadas o legado

**`tm_ticket`**
- `usu_asig varchar(255)` guarda ids separados por coma **y además** existe la tabla `ticket_usuarios_asig`: dos fuentes de verdad. Hay **386 tickets en los que no coinciden**, 11 tickets abiertos sin fila en la tabla y 39 con CSV multi-usuario. El listado filtra con `FIND_IN_SET(usu_asig)`, que no usa índices. **Corrección:** eliminar la columna y quedarse solo con la tabla de asignados.
- `ruta_paso_orden`, `ruta_id`: legado del PHP, sin uso real (7.758 en 0 y 10.283 NULL).
- `error_proceso`: duplica lo que ya dice `tm_ticket_error`.
- `est` (borrado lógico) convive con `tick_estado` (estado de negocio): hay 317 tickets `Cerrado` con `est=2`. `closeTicket` todavía valida `ticket.estado === 3`, código muerto (ver §4.2).
- `cat_id` duplica `tm_subcategoria.cat_id` y ya hay **1 ticket con categoría distinta a la de su subcategoría**. **Corrección:** derivarla de la subcategoría y no guardarla.
- `emp_id`, `dp_id`, `reg_id` son una "foto" del creador al crear el ticket. Está bien como snapshot, pero hay que documentarlo; el código usa `|| 1` y `|| 0` como fallback, lo que produce ids inválidos.
- **55 tickets cerrados sin `fech_cierre`**.

**`tm_flujo_paso`**: 25 columnas con flags que se solapan.

| Flag | Pasos que lo usan (de 274) | Problema |
|---|---:|---|
| `necesita_aprobacion_jefe`, `requiere_confirmacion_jefe`, `campo_id_referencia_jefe=-1` | 9 / 0 / 0 | tres formas de decir "asignar al jefe" |
| `es_aprobacion` | 4 | casi sin uso y se confunde con los anteriores |
| `permite_cerrar` (int) y `cerrar_ticket_obligatorio` | 16 / 10 | dos flags para el cierre |
| `requiere_seleccion_manual` (int), `es_pool`, `es_paralelo`, `despacho_aleatorio`, `asignar_a_creador` | 63 / 8 / 1 / 0 / 21 | son **modos excluyentes** guardados como booleanos independientes |
| `requiere_campos_plantilla` | 2 | redundante: si hay campos, se requieren |
| `paso_nom_adjunto` | — | legado de PDF (junto con `tm_flujo.flujo_nom_adjunto`) |
| `deadline_*`, `despacho_*`, `paso_lote_config` (JSON en `text`) | | |

**Corrección:** `modo_asignacion ENUM('cargo','usuarios','creador','jefe','pool','paralelo','aleatorio')` + `seleccion_manual bool` + `cierre ENUM('no','permitido','obligatorio')`. La configuración de lote va en una columna `JSON` validada.

**Otros**
- `tm_flujo_transiciones`: 6 transiciones van de un paso **a sí mismo** (pasos 718, 648 y 813). Hay que confirmar si son intencionales (bucle de reintento) o un error de configuración.
- `th_ticket_asignacion.estado_tiempo_paso` es un varchar libre con **10 valores distintos** (`A Tiempo, Atrasado, Vencido, Pausado, Reapertura, En Proceso, Pendiente, N/A, '', NULL`). `Vencido` y `Atrasado` significan lo mismo. **Corrección:** un `ENUM`, o mejor, separar el tipo de evento (asignación, cierre, reapertura, novedad) del resultado SLA (a tiempo/atrasado).
- El historial usa `est` como tipo de evento (`est=2` = cierre) y `asig_comentario LIKE 'Novedad asignada%'` para clasificar novedades (lo hace la vista). **Corrección:** columna `tipo_evento`.
- `tm_notificacion.est`: 2 = pendiente, 1 = ?, 0 = leída (números mágicos, comentario "legacy format").
- `tm_error_type.is_process_error` se copia a `tm_ticket_error.es_error_proceso` (denormalizado).
- `tm_flujo_paso_firma.cargos_ids json` y `tm_paso_firma.cargos_ids text`: listas en JSON en lugar de una tabla puente. Tampoco se puede poner FK.
- `tm_data_excel.datos_json longtext`: datasets completos en una celda, sin índices, que se cargan enteros en memoria para buscar.
- `tm_lista_precio.lp_tipo ENUM('general','promocional','finansuenos','90dias')`: negocio del cliente codificado en el esquema.
- `tm_consulta.cons_sql`: SQL ejecutable guardado en la BD (§4.1).
- Fechas mezcladas `datetime`/`timestamp` sin zona horaria definida. **Corrección:** todo en UTC (`datetime` + la app en UTC) y la zona horaria del tenant en la configuración.

### 3.5 🟠 Tablas redundantes / muertas

| Grupo | Tablas | Estado | Propuesta |
|---|---|---|---|
| Asignados actuales | `tm_ticket.usu_asig` vs `ticket_usuarios_asig` | duplicado e inconsistente | solo la tabla |
| Documentos | `td_documento` (tipo master/adjunto/firma), `td_documento_cierre` (19 filas), `td_documento_detalle`, `tm_documento_flujo` (MyISAM) | 4 tablas para lo mismo | **una** tabla `adjunto(ticket_id, detalle_id?, paso_id?, tipo, ruta, mime, tamaño, hash, subido_por)` |
| Adjuntos de paso | `tm_paso_adjunto` (0) vs `tm_paso_archivo` (0) | duplicadas y vacías | una sola |
| PDFs (3 generaciones) | ① `tm_campo_plantilla` (130, 8 activos, 1 paso) + `tm_flujo_paso_firma` (11) · ② `tm_flujo_plantilla` + `tm_paso_campo.flujo_plantilla_id` + `tm_pdf_campo_coord` (**0**) + `tm_pdf_firma_coord` (**0**) + `tm_paso_firma` (**0**) · ③ `tm_formato_pdf` (1) + `td_formato_pdf_trabajo` | 3 motores en paralelo | ② y ③ (rediseñados, §7.3); ① se descarta |
| Errores | `tm_ticket_error` vs `th_ticket_asignacion.error_code_id/error_descrip/error_subtype_id` (1.325 filas duplicadas) | doble registro | solo `ticket_error` |
| KPIs precalculados | `asignaciones_pasos` (28k, **sin uso en el código** salvo una entidad), `resumen_kpis_globales` (0), `resumen_ranking_usuarios` (57), `metricas_historicas` (0), vista `v_asignaciones_completas` | abandonadas en la migración 2026-04-09 pero no borradas | borrar |
| Observadores | `flujo_usuario` (2 filas) | poco uso, sin UI clara | confirmar (Q7) |
| Excel/SQL | `tm_consulta` (0) | peligrosa y vacía | borrar |
| Config | `tm_configuracion_sistema` (1 fila) | tabla de una sola fila con columnas | `config(clave, valor)` por tenant + config de plataforma |

### 3.6 🟠 Vista `v_asignaciones_completas` (y el CTE de reportes que la replica)
- Compara **horas** (`duracion_horas`) contra `paso_tiempo_habil`, que está en **días hábiles**: un paso de 2 días se marca "Atrasado" a las 2 horas cuando el estado no quedó guardado. Además ignora fines de semana y festivos.
- Clasifica novedades con `LIKE 'Novedad asignada%'` sobre el texto del comentario.
- `DEFINER='admin'@'%'` impide hacer dump en local (el usuario no existe). **Corrección:** `SQL SECURITY INVOKER` o borrarla.

### 3.7 🟠 Sin versionado de flujos
Editar o desactivar pasos, campos o transiciones afecta a los tickets que están en curso. Los campos se borran físicamente (de ahí los 170 huérfanos) y las transiciones cambian bajo tickets abiertos. **Corrección SaaS:** `flujo_version` inmutable una vez publicada; el ticket guarda `flujo_version_id` y las ediciones crean un borrador nuevo.

### 3.8 🟡 Inconsistencias de datos (para la versión actual de Electrocréditos; el SaaS no migra datos)
- 55 novedades `Abierta` en tickets `Cerrado` y 15 tareas paralelas `Pendiente` en tickets cerrados: `closeTicket` no las cierra.
- 3 subcategorías activas sin flujo activo (no se pueden usar).
- 2 correos duplicados, 1 duplicado en `tm_flujo_paso_usuarios`.
- `regional_id = 1` se trata como "Central/todas" en el código (`assignment.service.ts`), `cargo_id = -1` significa "jefe inmediato" en firmas y `rol_id = 3` es Administrador (hardcodeado en auth y system-config). También hay `rol_id` 1/2/3 → 'Usuario'/'Soporte'/'Admin' hardcodeados en los exportes. **Corrección:** banderas explícitas (`regional.es_central`, `rol.es_admin`, `firmante.tipo='jefe_inmediato'`).

---

## 4. Código: hallazgos

### 4.1 🔴 Seguridad

| # | Hallazgo | Evidencia | Corrección |
|---|---|---|---|
| S1 | **Sin autorización por registro (IDOR).** `GET /tickets/:id`, las descargas de documentos, `timeline`, `parallel-tasks` y `deadline` solo piden `read Ticket`. No se verifica que el usuario sea creador, asignado, observador ni que tenga `view:all`. El listado sí lo hace, pero el detalle no. | `ticket.service.ts:605`, `documents.controller.ts:119-222` | Una `TicketAccessPolicy` central (creador / asignado actual / asignado histórico / observador / `view:all` / mismo departamento si aplica), usada por detalle, documentos, comentarios y transiciones. Con CASL: condiciones sobre el sujeto (`can('read','Ticket',{ ... })`) + `accessibleBy`. |
| S2 | **Cualquiera con `update Ticket` transiciona cualquier ticket.** `POST /workflows/transition` no valida que `actorId` esté asignado al paso actual (ni en pool ni en paralelo). Lo mismo pasa con `closeTicket` y `createNovelty`. | `workflow.controller.ts:40-61`, `workflow-transition.service.ts:576+` | Validar `actor ∈ asignados_actuales` (o permiso explícito `reassign`/`manage`). |
| S3 | **`PUT /tickets/:id` hace merge de todo el `CreateTicketDto`**: se puede cambiar el creador, la subcategoría, la empresa o el paso sin pasar por el flujo. | `ticket.service.ts:579` | DTO de actualización con solo los campos editables (título/descr.) y solo para el creador o un admin. |
| S4 | **Inyección SQL en reportes**: `dateFrom`/`dateTo` llegan como `@Query` string sin validar y se concatenan en 23 lugares. | `reports.service.ts:62-98`, `reports.controller.ts:127` | DTO con `@IsDateString()` y **siempre** parámetros `?`. Prohibir la interpolación en SQL por lint (regla custom o `eslint-plugin-security`). |
| S5 | **SQL guardado en BD ejecutado por el servidor** (`campo_query` que empieza con SELECT, `tm_consulta.cons_sql`) y `%SEARCH%` reemplazado con el texto del usuario. En un SaaS, el admin de un tenant podría leer datos de otros tenants. | `templates.service.ts:215-253` | Eliminar. Los orígenes de datos quedan como una lista cerrada (`PRESET_*`, `EXCEL:*`/datasets, `CALC:*`) resuelta por código con parámetros. |
| S6 | **XSS almacenado**: la descripción se guarda sin sanitizar (el backend solo reemplaza `&nbsp;`) y se pinta con `dangerouslySetInnerHTML` sin DOMPurify. El timeline sí sanitiza. | `TicketWorkflow.tsx:129`, `RichTextEditor.tsx:233`, `ticket.service.ts:1382` | Sanitizar en el **servidor** al guardar (allowlist) y además en el cliente. CSP estricta. |
| S7 | **JWT en `localStorage`** con 24 h y sin revocación. El payload trae `reg_id, car_id, dp_id, es_nacional, perfil_ids`, que quedan desactualizados si cambia el cargo (la documentación dice que solo lleva `sub,email,role`). | `auth.service.ts:82`, `jwt.strategy.ts` | Access token corto (15 min) + refresh token en cookie `httpOnly; Secure; SameSite`, rotación y lista de revocación. Payload mínimo `{sub, tenant, sid}` y el resto se resuelve en el servidor (con caché). |
| S8 | Login acepta **MD5 y texto plano** como fallback (hoy todos los usuarios están en bcrypt, así que se puede quitar). Sin rate-limit, sin bloqueo por intentos, sin `helmet`, CORS `origin: true` con credenciales, body de 50 MB global. No existe flujo de recuperación de contraseña (la columna `usu_token_recuperacion` no se usa). | `auth.service.ts:108`, `main.ts` | Solo bcrypt/argon2, `@nestjs/throttler`, `helmet`, CORS por allowlist (por tenant), límite de body por ruta, reset por token de un solo uso (hash + expiración), MFA opcional. |
| S9 | `GET /documents/flow-template/:id` y `POST /documents/temp/upload` son `CheckPolicies(() => true)`. `PoliciesGuard` deja pasar cualquier ruta sin `@CheckPolicies`, así que `dashboard` y `system-config` dependen solo del JWT. | `documents.controller.ts:247,268`, `policies.guard.ts:56` | **Denegar por defecto**: una ruta sin política falla, salvo `@Public()` o `@AuthenticatedOnly()` explícitos. Guards globales (`APP_GUARD`) en lugar de `@UseGuards` en cada controlador. |
| S10 | `manualAssigneeId`, `targetUserId`, `manualAssignments`, `usuarioAsignadoId` (novedad) y `usuarioJefeAprobadorId` llegan del cliente y **no se validan** contra los candidatos. Se puede asignar a cualquier usuario, incluso inactivo. | `assignment.service.ts:259`, `workflow-transition.service.ts:709-790` | Validar `id ∈ getCandidatesForStep()` (o `∈ getBossCandidates()`), activo y del mismo tenant. |
| S11 | Los `templateValues.pasoCampoId` no se validan contra los campos del paso: se pueden escribir valores de campos de otros pasos o flujos. Tampoco se valida que un `select` tenga un valor de sus opciones. | `ticket.service.ts:303`, `workflow-transition.service.ts:1216` | Validar pertenencia y dominio por tipo de campo (esquema por tipo). |
| S12 | Se loguea el DTO completo de creación (datos personales, montos). | `ticket.service.ts:123` | Logger estructurado con redacción de campos sensibles. |

### 4.2 🟠 Bugs de lógica

| # | Hallazgo | Evidencia | Corrección |
|---|---|---|---|
| B1 | **El cron de SLA recorre todos los tickets con `est=1`, incluidos los cerrados**, cada 5 minutos. Carga `historiales` de todos (N+1) y envía alertas: **22.964 alertas "vencido" después del cierre** en 15.130 tickets. | `sla.service.ts:159-190` | Filtrar `tick_estado='Abierto'` en SQL, calcular la fecha límite al **entrar** al paso (`fecha_limite` guardada en la asignación) y consultar con `WHERE fecha_limite < now() AND alerta_enviada = false`. |
| B2 | Mezcla de unidades de SLA: los pasos están en días hábiles, pero la vista/CTE compara horas y el log de cierre dice "h". | §3.6, `ticket.service.ts:1013` | Una sola unidad. Para SaaS: **minutos hábiles** con calendario laboral del tenant (horario + festivos). |
| B3 | `closeTicket` no valida el estado: `estado === 3` nunca se cumple, así que se puede **cerrar dos veces** (duplica historial y notificaciones). No verifica que el paso permita cerrar ni que el actor esté asignado. No cierra novedades ni paralelos pendientes (55 + 15 casos). **No es transaccional** (6 escrituras separadas). | `ticket.service.ts:961-1165` | Máquina de estados explícita (`Abierto→Pausado→Abierto→Cerrado→Reabierto`) con guardas y todo dentro de una transacción. |
| B4 | Novedad y reapertura tampoco son transaccionales. La reapertura registra el error con `errorTypeId: 1` hardcodeado y culpa a `usuarioAsignadorId` (**quien asignó**, no quien cerró). Resolver una novedad devuelve el ticket a quien la creó, no a los asignados originales, así que en pool o paralelo se pierden los demás. | `ticket.service.ts:705-956, 1171-1279` | Guardar la "foto" de los asignados al pausar y restaurarla al resolver. Tipo de error "reapertura" configurable. Responsable = quien cerró. |
| B5 | **Efectos externos dentro de la transacción**: dentro de `executeTransition` se guardan archivos y firmas en storage, se reescribe el PDF master y se lanzan notificaciones fire-and-forget (`.then` sin await, con `userRepo` fuera del `manager`). Si la transacción hace rollback, quedan archivos, PDFs modificados y notificaciones de algo que no pasó. | `workflow-transition.service.ts:1002-1095, 1284-1317` | Patrón **outbox**: la transacción solo escribe filas, incluida una fila de evento, y un worker procesa PDFs, correos y websockets después del commit. Los archivos se suben antes a un área temporal y se "confirman" en la transacción. |
| B6 | Pasos paralelos: si un cargo tiene varios usuarios, se toma **`candidates[0]`** (arbitrario, sin orden). Lo mismo pasa en la asignación normal sin selección manual y en `resolveJefeInmediato` (`findOne` sin `order`). | `workflow-transition.service.ts:792-796`, `assignment.service.ts:57-80, 293` | Estrategia explícita por paso: menor carga, round-robin o manual obligatoria. Orden determinístico. |
| B7 | `getInitialStep` toma el paso con **menor `paso_id`** como el primero; los "pasos de entrada" se calculan por ausencia de transiciones entrantes, y los `templateFields` de creación siempre se toman del **primer** paso de entrada aunque el usuario elija otra decisión. | `workflow-transition.service.ts:289, 366-375, 519` | Paso inicial explícito (`es_inicio`) por flujo/decisión, y campos del paso elegido. |
| B8 | Organigrama por **cargo**, no por persona: si hay varios usuarios con el cargo jefe en la regional, el jefe es arbitrario. No hay jefe por departamento (`dp_jefe_id` existe pero está vacío). | `assignment.service.ts:34-81` | `usuario.jefe_id` (o una tabla de reporte directo con vigencia) y usar el organigrama por cargo solo como default. |
| B9 | `getCandidatesForStep` no filtra por **empresa**, pero `getUsersByRole` (paralelos) sí: resultados distintos para la misma regla. | `assignment.service.ts:100-213 vs 228` | Una sola función de candidatos con filtros explícitos (empresa, regional, nacional). |
| B10 | Festivos de Colombia 2025-2027 hardcodeados; desde 2028 el SLA ignora festivos. | `common/utils/date.helper.ts` | Tabla `calendario_festivo` por país/tenant + horario laboral. |
| B11 | Crons en proceso (`@Cron` SLA 5 min, despacho aleatorio 1 min, planos 30 min, cola de PDF 1 min) sin lock distribuido: con 2 instancias se duplican cortes de planos, repartos y alertas. | varios `*-scheduler.service.ts` | Cola con locks (BullMQ + Redis, ya está `ioredis` en deps) o `SELECT … FOR UPDATE SKIP LOCKED`. |
| B12 | Caché de permisos en un `Map` en memoria del proceso: con varias instancias, un cambio de permisos no se propaga. | `permissions.service.ts:38` | Redis con invalidación por evento o TTL corto. |
| B13 | Notificaciones: WebSocket depende de un **microservicio externo** (`WS_SERVICE_URL`, no está en el repo) llamado por HTTP con 5 s de timeout **en línea** con la transición; el email también es síncrono. Si el servicio cae, cada transición tarda 5 s más por cada destinatario. El frontend intenta `ws://…/socket.io` y recibe 404. | `websocket-client.service.ts`, memoria E2E | Gateway Socket.IO dentro del backend (con adaptador Redis) o SSE, alimentado por el outbox. |
| B14 | `WorkflowEngineService` es una fachada que solo delega y además **ignora el parámetro `initialTargetStepId`** que le pasa `TicketService`. | `workflow-engine.service.ts:18-33` | Quitar la fachada o darle responsabilidad real. |
| B15 | `migrateLegacyAssignments` sigue expuesto como endpoint. | `ticket.controller.ts:265` | Borrar (script de migración, no API). |

### 4.3 🟠 Redundancias de diseño

1. **Tres sistemas de "quién puede crear/iniciar"**: `ReglaMapeo` (subcategoría → cargo/perfil), `tm_flujo_paso_iniciadores` (paso de entrada → cargo/usuario) y visibilidad por `categoria_departamento`/`categoria_empresa`, más la permisión CASL `create Ticket`. Y hay **dos** caminos (lista vs creación) que antes divergían. → **Un solo concepto**: "Iniciadores del flujo/decisión" con reglas (rol, cargo, perfil, departamento, empresa, usuario).
2. **Tres identidades de agrupación de usuarios**: rol (permisos), cargo (asignación), perfil (grupos). Es válido, pero hay que documentar para qué sirve cada una. En SaaS, "perfil" = "grupo".
3. **Tres motores de PDF** (§3.5). → Solo formatos-pdf.
4. **Dos registros de error** y **dos fuentes de asignados** (§3.5).
5. `executeTransition` tiene **770 líneas**: validación, reglas, asignación, paralelos, SLA, firmas, PDFs, adjuntos, valores, planos y notificaciones en un solo método. `ticket.service.ts` tiene 1.386 líneas y `reports.service.ts` 2.307 (SQL crudo). → Descomponer: `TransitionValidator`, `AssignmentResolver`, `SlaTracker`, `FieldValueStore`, y **eventos de dominio** (`TicketTransitioned`, `TicketClosed`…) que consumen planos, PDF y notificaciones. Hoy `workflows` importa `planos`, `tickets` importa `planos`, `workflows` importa `tickets` (con `forwardRef`), lo que va contra la regla "un módulo no toca otro".
6. Tipado débil: `step: any`, `ticket: any`, `dto: any`, `as any` en el core, pese a que CLAUDE.md prohíbe `any`.
7. Frontend: de 116 archivos con `useEffect` para cargar datos, solo 10 usan React Query (aunque está instalado). Tiene `react-router` y `react-router-dom` a la vez, y `socket.io-client` sin servidor. Componentes de más de 1.000 líneas (`StepModal`, `TemplateFieldsConfig`).

### 4.4 🟡 Calidad / operación
- Sin migraciones versionadas ejecutables: son SQL sueltos con fecha, sin tabla de control, y `src/database/migrations/` tiene además otra carpeta. → Migraciones de TypeORM (o Prisma/Knex) con tabla de control, aplicadas en CI.
- Tests: hay tests rojos conocidos (`ticket.service.spec.ts` `registerErrorEvent`).
- Logs con `logger.warn` para eventos normales (`[StartFlow]`).
- Swagger público en `/api/docs` en producción.

---

## 5. Cómo debería quedar el SaaS (correcciones con buenas prácticas)

### 5.1 Multi-tenant
- **PostgreSQL, una BD compartida, `tenant_id` en cada tabla de negocio** (decidido).
  - **Primera barrera (app):** el `tenant_id` sale del token/subdominio y se guarda en `AsyncLocalStorage` por request. Una capa de repositorio lo aplica siempre y **falla** si falta. Nunca se acepta `tenant_id` en el body.
  - **Segunda barrera (BD):** Row-Level Security en cada tabla: `USING (tenant_id = current_setting('app.tenant_id')::uuid)`. La app se conecta con un rol **sin** `BYPASSRLS` y hace `SET LOCAL app.tenant_id` al abrir cada transacción. Así, un bug en un query no puede leer datos de otro tenant.
  - Llaves: `id uuid` (o `bigint` + `tenant_id`), índices y UNIQUE compuestos que empiecen por `tenant_id` (p. ej. `UNIQUE(tenant_id, email)`), y FKs compuestas `(tenant_id, x_id)` en las relaciones críticas para que sea imposible referenciar un registro de otro tenant.
  - Tablas globales (sin tenant): `tenant`, `plan`, `permiso` (catálogo de acciones), `pais`, `festivo_pais` (plantillas de festivos).
- **Empresa dentro del tenant** (decidido): `empresa(tenant_id, nombre, nit, es_default, zona_horaria, calendario_id)`. Al crear el tenant se crea una empresa por defecto. Si solo hay una, la UI no la muestra y el backend la asigna sola. Usuarios, categorías, flujos, cortes, reglas de monto, plantillas PDF y calendario pueden depender de la empresa, como hoy.
- Resolución del tenant por subdominio (`cliente.midominio.com`) + claim en el token (deben coincidir).
- Todo lo que hoy es global y hardcodeado pasa a configuración del tenant o de la empresa: festivos, horario laboral, zona horaria, rol admin, regional central, SMTP/remitente, branding, límites (usuarios, almacenamiento) por plan.
- Storage con prefijo `tenants/{tenant_id}/…` y URLs firmadas de corta duración (§7).
- PostgreSQL además aporta `JSONB` con validación para las configuraciones de campos/lote/filtros de planos, `ENUM`/`CHECK` nativos, índices parciales (`WHERE deleted_at IS NULL`), `tsvector` para la búsqueda de tickets y `SELECT … FOR UPDATE SKIP LOCKED` para las colas.

### 5.2 Modelo de datos núcleo (propuesto, simplificado)

> **Implementado:** el modelo definitivo (89 tablas) está en `packages/db` y se documenta en [base-de-datos.md](base-de-datos.md). Este bosquejo queda como antecedente.
```
tenant, plan, suscripcion
usuario (tenant_id, email UNIQUE(tenant_id,email), jefe_id?, activo, deleted_at)
rol, permiso, rol_permiso            -- CASL con condiciones
cargo, departamento, regional(es_central), zona, grupo(=perfil)
grupo_aprobacion, grupo_aprobacion_aprobador, grupo_aprobacion_miembro, delegacion   -- §10 (reemplaza tm_organigrama y el "jefe inmediato")
empresa(es_default, zona_horaria, calendario_id), usuario_empresa
calendario(nombre), calendario_horario(dia_semana, hora_ini, hora_fin), calendario_festivo(fecha, nombre)   -- §8
categoria, subcategoria(prioridad_default)
flujo, flujo_version(estado: borrador|publicada|archivada)
paso(version_id, modo_asignacion ENUM, seleccion_manual, cierre ENUM, sla_valor, sla_unidad ENUM(horas_habiles|dias_habiles), plazo ENUM(sla|corte), es_inicio)
sla_override(paso_id, empresa_id, sla_valor, sla_unidad)                    -- §8
paso_candidato(paso_id, tipo: usuario|cargo|grupo, ref_id)       -- reemplaza usuarios/firmas/cargos_ids JSON
paso_iniciador(paso_id, tipo: usuario|cargo|grupo|departamento|empresa, ref_id)  -- reemplaza ReglaMapeo + iniciadores
transicion(version_id, origen_id, destino_id?, nombre, solo_sistema)
campo(version_id, paso_id, codigo, tipo ENUM, captura ENUM, requerido, inmutable, config JSON validado)
regla_monto, corte_empresa, calendario(festivos, horario)
ticket(tenant_id, flujo_version_id, subcategoria_id, estado ENUM, paso_actual_id, creador_id, registrado_por_id, empresa_id, departamento_id, regional_id, prioridad_id, cerrado_en)
ticket_asignado(ticket_id, usuario_id, tipo ENUM, desde)          -- ÚNICA fuente de asignados
ticket_evento(ticket_id, tipo ENUM(asignacion|transicion|cierre|reapertura|novedad_ini|novedad_fin|comentario), paso_id, actor_id, asignado_id, fecha_limite, resultado_sla ENUM, payload JSON)
ticket_valor(ticket_id, campo_id, valor, UNIQUE(ticket_id,campo_id))
ticket_paralelo, ticket_novedad, ticket_error(tipo_id, responsable_id, es_proceso)
archivo(...) + ticket_documento(...)                                       -- §7
formato_pdf, plantilla_pdf, plantilla_pdf_campo, plantilla_pdf_firma, pdf_trabajo, ticket_firma   -- §7.3
plano_* (igual que hoy + tenant_id)
notificacion(usuario_id, ticket_id, tipo, leida_en)  + outbox(evento, payload, procesado_en)
```
Todas con FK (PostgreSQL, `tenant_id` + RLS), `created_at/updated_at/created_by`, borrado lógico con `deleted_at` (no `est` con números mágicos) y auditoría (`audit_log`).

### 5.3 Arquitectura backend
- Módulos por dominio con **eventos de dominio** entre ellos (Nest `EventEmitter` + outbox persistente), sin `forwardRef`.
- Guard global de JWT + guard global de políticas **deny-by-default**. Políticas por registro con CASL (condiciones) y `accessibleBy` en los listados.
- DTOs con validación estricta (`forbidNonWhitelisted: true`), sin `any`, y respuestas con DTOs (no entidades).
- Colas (BullMQ): PDFs, correos, websockets, SLA, planos, despacho aleatorio.
- SLA calculado **al entrar al paso** y guardado (`fecha_limite`). El cron solo consulta vencidos no alertados.
- Migraciones versionadas en CI, seeds por tenant (roles, permisos y catálogos base).
- Observabilidad: logs estructurados con `tenant_id`/`request_id`, métricas y trazas.

### 5.4 Frontend
- React Query para todo el acceso a datos y un solo router.
- Sin token en `localStorage` (cookie httpOnly).
- Sanitizar todo el HTML y definir una CSP.
- Partir `StepModal` y `TemplateFieldsConfig` y convertir el editor de flujos en un editor visual (grafo).

---

## 6. Preguntas pendientes

Respondidas el 2026-09-30 (ver §0.1): tenant/empresa, motor de BD, migración de Electrocréditos, listas de precios, PDF y unidad de SLA.

Siguen abiertas:
1. **Facturación**: sin definir. Mientras tanto, los tenants se crean a mano desde un panel de plataforma.
2. **Lo que falta antes de empezar**: ver §12 (cada punto trae una propuesta por defecto).
7. **Hosting**: sin definir (decidido: todo en imágenes Docker, §9). Se elige más adelante, junto con el proveedor de archivos (§7.4.3).

Respondidas el 2026-09-30 (tercera ronda): tipos de archivo, sin antivirus, retención indefinida y reportes de SLA con ambas medidas.

Respondidas el 2026-09-30 (segunda ronda): vencimiento en días hábiles, pausa por novedad, reinicio al reasignar, límites de archivos y soporte AcroForm.

---

## 7. Archivos y documentos

### 7.1 Diagnóstico: cómo se guardan hoy (desorden confirmado)

| # | Problema | Evidencia |
|---|---|---|
| F1 | **La BD no guarda la ruta, solo el nombre.** La ruta se **reconstruye por convención** y hay 4 convenciones distintas: `document/ticket/{tick}/`, `document/detalle/{tickd}/`, `document/cierre/{tick}/`, `document/flujo/{flujo}/{paso}/{usuario}/`. Si cambia un dato del registro, el archivo "desaparece": `saveOrUpdateFlowDocument` **actualiza el `flujoId`** del registro sin mover el archivo, así que la ruta reconstruida apunta a otra carpeta. | `documents.service.ts:225-256, 590-615` |
| F2 | **Sobrescritura por nombre.** Los adjuntos de ticket, comentario y cierre se guardan con el nombre original (solo sanitizado), sin prefijo único: dos "factura.pdf" en el mismo ticket se pisan. En la BD hay **6 casos** (12 filas activas apuntando a 6 archivos físicos). Solo los adjuntos de campos tabla tienen nombre único (commit `b416513`). La firma del usuario siempre se llama `firma.png`, y hay **dos implementaciones** de "guardar firma" con nombres distintos en la misma carpeta. | `storage.service.ts:144`, `documents.service.ts:552` |
| F3 | **El PDF maestro se reescribe sobre el mismo archivo** (`updateMasterPdf`, `guardarMaster`): no hay versiones, el original se pierde al estampar firmas y un estampado fallido a medias deja el archivo corrupto. Además hay **dos definiciones de "maestro"**: `documentoPrincipal()` (lo que ve la UI: `td_documento` tipo master o `ticket_{id}.pdf`) y `getMasterDocumentPath()` (lo que se estampa: el **último PDF de `tm_documento_flujo`**). Pueden ser archivos distintos. | `documents.service.ts:273-300, 391-490` |
| F4 | **Tipo de documento sin clasificar**: **20.301 de 20.808** filas de `td_documento` tienen `doc_tipo = NULL`. Los tipos se deducen por el nombre (`LIKE '%.pdf'`, `ticket_{id}.pdf`). | BD |
| F5 | **Carpetas mezcladas y sin dueño claro:** <br>• las plantillas PDF subidas van **planas** en `document/flujo/{nombre}`, el mismo prefijo que los documentos generados, y hay nombres repetidos (`1764262767_0.pdf` en 2 registros), así que una plantilla pisa a otra; <br>• adjuntos de paso en `img/pasos/`, firmas en `img/firmas/` y **también** en `document/ticket/{id}/linear_signature_*`; <br>• planos en `planos/{def}/`; formatos en `document/formato/`; <br>• adjuntos de campos tabla en `document/tabla-adjuntos/`, **sin registro en BD** (la ruta vive dentro del JSON del valor del campo); <br>• temporales en `document/temp/`, que nunca se limpian y devuelven una URL `/document/temp/...` que ningún endpoint sirve. | varios servicios |
| F6 | **Sin metadatos ni validación**: el mime se deduce de la extensión y no se guardan tamaño, hash ni quién subió el archivo (salvo en `tm_documento_flujo`). Ningún `FilesInterceptor` tiene `limits` ni `fileFilter` y el body global permite 50 MB. `file-type` está instalado pero no se usa. | grep `limits:`/`fileFilter` = 0 |
| F7 | **Los archivos nunca se borran**: los registros se desactivan (`est=0`) o se borran físicamente (`deleteFlowDocument`), pero el archivo queda. Y al revés, hay registros sin ticket (64 en `td_documento`, 8 en `tm_documento_flujo`, 4 en detalle). | §3.1 |
| F8 | **Local vs S3 inconsistente**: `getAbsolutePath` devuelve una ruta de disco en local y la key con un warning en S3. `getStream` acepta **rutas absolutas** (cualquier ruta del disco si llega desde la BD). `pdf-stamping.service` escribe directo al disco con `fs.writeFile(outputPath)`, así que no funciona en S3. | `storage.service.ts:176-180, 255-275`, `pdf-stamping.service.ts:151,309` |
| F9 | Archivos escritos **dentro de transacciones** de BD: si hay rollback quedan archivos huérfanos (B5). | §4.2 |
| F10 | Las descargas pasan por el backend sin autorización por registro (S1), y `Content-Disposition` se arma con el nombre sin escapar. | §4.1 |

### 7.2 Propuesta: un solo modelo de archivos
- **Tabla `archivo`** (el binario): `id uuid, tenant_id, storage_key (inmutable, generada: tenants/{tenant}/{yyyy}/{mm}/{uuid}), nombre_original, mime (detectado por contenido), bytes, sha256, subido_por, estado ENUM(pendiente|confirmado|eliminado), created_at, deleted_at`. El nombre del usuario **nunca** forma parte de la key, así que no hay colisiones ni problemas de caracteres.
- **La vinculación va aparte**, porque es lo que hoy está repartido en 4 tablas y varias carpetas:
  - `ticket_documento(ticket_id, archivo_id, rol ENUM(adjunto|comentario|cierre|documento_paso|documento_principal|firma|campo_tabla), evento_id?, paso_id?, campo_id?, version, vigente)`
  - `plantilla_pdf.archivo_id`, `usuario.firma_archivo_id`, `paso_archivo(paso_id, archivo_id, tipo)`, `plano_corte.archivo_id`.
  - Los adjuntos de campos tabla guardan `archivo_id` en el valor, no una ruta.
- **Nunca sobrescribir**: cada PDF generado o estampado es un archivo **nuevo** con `version + 1`, y `vigente = true` marca el actual. El original y cada versión firmada se conservan (auditoría y valor legal de las firmas).
- **Subida en dos fases:** (1) el archivo sube al bucket con URL prefirmada, o vía la API, en estado `pendiente`; (2) se valida por magic bytes y tamaño (**máx. 4 MB por archivo; máx. 15 archivos y 20 MB en total por envío**, aplicado en el backend con `limits` de multer/Busboy y también en el frontend antes de subir) sin antivirus por ahora (decidido; queda como mejora futura); (3) la transacción del negocio lo **confirma** al vincularlo. Un cron purga los `pendiente` de más de 24 h. Así se resuelve F9.
- **Tipos permitidos (decidido)**, validados por extensión **y** por contenido (magic bytes); la extensión sola no basta:
  - PDF: `.pdf`
  - Imágenes: `.jpg/.jpeg`, `.png`, `.webp`, `.gif`, `.heic`. **SVG no**, porque puede traer scripts (XSS).
  - Office: `.docx/.xlsx/.pptx` (por dentro son ZIP: se valida la estructura OOXML), `.doc/.xls/.ppt` (OLE) y `.csv` (texto).
  - `.zip`: se guarda tal cual, **nunca se descomprime en el servidor**. Así se evita el riesgo de "zip bomb". Al no haber antivirus, puede traer malware, y eso queda como riesgo aceptado.
  - Las imágenes y los PDF se sirven con `Content-Type` correcto y `X-Content-Type-Options: nosniff`; el resto como descarga (`attachment`).
- **Borrado (decidido: se guardan siempre):** solo borrado lógico (`deleted_at`) y el objeto nunca se elimina del bucket. Excepción técnica: los `pendiente` que nunca se confirmaron (subidas abandonadas) sí se purgan a las 24 h, porque no pertenecen a nada. Para bajar costos más adelante, S3 permite una regla de ciclo de vida que pasa los objetos viejos a una clase de almacenamiento más barata.
- **Descarga:** siempre por un endpoint que valida el acceso al ticket (S1) y responde con una **URL firmada de 1 a 5 minutos**. `Content-Disposition` con `filename*=UTF-8''…` (RFC 5987).
- **Un solo `StorageProvider`** (`put/get/signedUrl/delete/exists`) sobre S3-compatible: **MinIO en desarrollo** para tener paridad con producción y sin modo "disco local" ni rutas absolutas. pdf-lib trabaja siempre con buffers.
- **Cuota por tenant**: ver §7.4.

### 7.3 Documentos PDF: dos mecanismos (decisión 0.1)
1. **Diseñador de Formatos PDF** (actual `formatos-pdf`): se mantiene tal cual en lo funcional.
2. **PDF subido por el cliente + coordenadas** (actual `templates` + `tm_pdf_*_coord`), rediseñado:
   - `plantilla_pdf(tenant_id, empresa_id?, flujo_version_id, archivo_id, paginas JSONB[{ancho, alto}])`
   - `plantilla_pdf_campo(plantilla_id, campo_id | expresion, pagina, x, y, fuente, tamaño, alineacion, ancho_max)`
   - `plantilla_pdf_firma(plantilla_id, paso_id, tipo_firmante ENUM(usuario|cargo|aprobador|creador|asignado_paso), ref_id?, pagina, x, y, ancho, alto)`. Reemplaza `cargo_id = -1` y la lista `cargos_ids` en JSON.
   - **Una sola unidad de coordenadas**: puntos PDF, con el origen documentado. Hoy hubo una migración de mm a puntos y luego su rollback (`2026-02-15_*`), señal de que esto no está definido.
   - **Campos de formulario (AcroForm), decidido:** si el PDF subido trae campos, al cargarlo se leen sus nombres (pdf-lib `getForm().getFields()`) y el admin los mapea a campos del flujo o a firmas, **sin coordenadas**. `plantilla_pdf_campo` gana `modo ENUM(coordenada|acroform)` + `acroform_nombre`. Al generar se llenan los campos por nombre y se hace `flatten()` para que el documento final no quede editable. Las firmas en un campo de firma o botón se estampan como imagen en el rectángulo del widget. Un mismo PDF puede mezclar ambos modos. Hoy la columna `etiqueta` de las coordenadas cumple ese papel a medias.
- **Ambos mecanismos generan igual**: una configuración `flujo_documento(flujo_version_id, empresa_id?, tipo ENUM(disenado|plantilla), formato_id | plantilla_id, momento ENUM(creacion|cada_paso|cierre))`, y la generación pasa **siempre por la cola** (`pdf_trabajo`, hoy `td_formato_pdf_trabajo`, solo para el diseñador) fuera de la transacción. Hoy el estampado por coordenadas corre **síncrono dentro de la transición** y reescribe el maestro (F3).
- `paso_base_id` ("estampar sobre el documento de otro paso") se reemplaza por el concepto de **documento acumulado versionado**: cada paso toma la versión vigente y produce la siguiente.

### 7.4 Plan de cuota de almacenamiento por tenant
Como los archivos se guardan siempre, la cuota es la única forma de controlar el costo por cliente.

**Modelo**
- `plan(id, nombre, almacenamiento_bytes, max_usuarios, …)` es global. `tenant.plan_id` + `tenant.almacenamiento_extra_bytes` (ampliaciones compradas o de cortesía).
- `tenant_uso(tenant_id, bytes_usados, bytes_reservados, actualizado_en)`: **contador**. No se hace un `SUM()` en cada subida.
- Cada `archivo` guarda `bytes`, `empresa_id` y `origen ENUM(usuario|sistema)` para poder desglosar el uso.

**Cómo se descuenta**
1. **Al pedir la subida**: se valida `bytes_usados + bytes_reservados + tamaño ≤ límite` y se **reserva** el tamaño (`UPDATE … SET bytes_reservados = bytes_reservados + n WHERE … AND <condición>`, atómico, sin condiciones de carrera entre subidas simultáneas).
2. **Al confirmar el archivo** (en la transacción del negocio): la reserva pasa a usado.
3. **Si la subida se abandona**, el purgador de 24 h libera la reserva.
4. **Borrado lógico:** como el objeto sigue en el bucket, **sigue contando** (el costo es real). Recomendado; se puede cambiar si comercialmente conviene.
5. **Conciliación nocturna:** un job recalcula `SUM(bytes)` por tenant y corrige el contador si se desvió (por fallos o reintentos) y registra la diferencia.

**Qué pasa al acercarse al límite**
- Al 80 % y al 95 %: aviso in-app y por correo a los administradores del tenant (una vez por umbral y por periodo, no en cada subida).
- Al 105 % (100 % + gracia): se **bloquean solo las subidas de usuarios** con un mensaje claro ("Tu organización alcanzó el límite de almacenamiento…"). **Nunca** se bloquean crear, avanzar ni cerrar tickets sin adjuntos, ni la generación de PDFs del sistema: si un PDF del sistema supera la cuota se guarda igual y se marca el exceso, para no romper un flujo a mitad de camino.
- Margen de gracia de **+5 %** (decidido): el bloqueo duro llega al 105 %; entre 100 % y 105 % se permite subir con una advertencia visible.

**Visibilidad**
- Pantalla de administración del tenant: uso total vs. límite, barra de progreso y desglose por empresa, por flujo y por tipo (adjuntos de usuarios vs. PDFs del sistema), además de los archivos más pesados.
- Panel de plataforma (para nosotros): uso por tenant para facturación y detección de abusos.

**Decidido (2026-09-30):** los PDFs que genera el sistema **cuentan** contra la cuota (marcados `origen=sistema`); los archivos borrados lógicamente **siguen contando**; hay un **margen de gracia del 5 %** antes de bloquear las subidas de usuarios.

#### 7.4.1 Referencia de mercado (consultado 2026-09-30)

| Producto | Plan | Almacenamiento | Modelo |
|---|---|---|---|
| Jira Service Management | Free / Standard / Premium | 2 GB / 250 GB / ilimitado | fijo por cuenta |
| Zendesk | Team / Growth-Professional / Enterprise | 10 GB base + 2 / 5 / 10 GB **por agente** | base + por agente; venta de bloques de 25 GB |
| Pipefy | Starter / Business | 2 GB / 20 GB | fijo por cuenta |
| Smartsheet | Pro / Business / Enterprise | 20 GB / 1 TB / ilimitado | fijo por cuenta |
| monday.com | Basic | 5 GB | fijo por cuenta |
| GLPI Network Cloud | Public / Private Cloud | 5 GB / 50 GB | fijo por cuenta |
| ClickUp | Free / pagos | 60 MB / ilimitado | "ilimitado" con uso justo |

Lo que muestra el mercado: (1) el plan gratis o de entrada da **2 a 5 GB**; (2) los planes medios dan **decenas a cientos de GB**, casi siempre con una base por cuenta más un extra por usuario; (3) el tope de gama es "ilimitado" con política de uso justo; (4) el excedente se vende en **bloques** (Zendesk: 25 GB).

**Costo real para nosotros:** S3 Standard ≈ USD 0,023/GB-mes; Cloudflare R2 ≈ USD 0,015/GB-mes sin costo de descarga; Backblaze B2 ≈ USD 0,007/GB-mes. **100 GB cuestan entre USD 0,70 y 2,30 al mes.** El almacenamiento es barato; lo que hay que controlar es el crecimiento indefinido (no se borra nada) y la transferencia si se usa S3.

**Estimación con datos propios** (Electrocréditos, ~105 usuarios activos): en ~9,5 meses (dic-2025 a sep-2026) se registraron **23.804 archivos**, unos 2.500/mes. No pude medir el tamaño real porque producción está en S3 y el entorno local tiene solo 157 archivos. Suponiendo un promedio de 300 a 500 KB por archivo (adjuntos + PDFs generados), serían **≈ 0,75 a 1,25 GB/mes ≈ 9 a 15 GB/año**, es decir **≈ 100 a 150 MB por usuario al año**. Conviene confirmarlo midiendo el bucket (`aws s3 ls s3://<bucket> --recursive --summarize`). Ojo: con PDFs versionados (§7.2) cada paso genera una versión nueva y el volumen de PDFs del sistema puede duplicarse o triplicarse.

#### 7.4.2 Propuesta de cuota por plan (base por cuenta + GB por usuario, modelo tipo Zendesk)

| Plan | Base por tenant | + por usuario activo | Ejemplo 10 usuarios | Ejemplo 100 usuarios |
|---|---:|---:|---:|---:|
| Prueba / Gratis | 1 GB | — | 1 GB | — |
| Básico | 10 GB | 1 GB | 20 GB | 110 GB |
| Profesional | 25 GB | 2 GB | 45 GB | 225 GB |
| Empresarial | 100 GB | 5 GB | 150 GB | 600 GB (o "ilimitado con uso justo") |
| Bloque adicional | 25 GB | | | |

- **Por qué base + por usuario:** la cuota crece sola con el cliente sin renegociar, y un cliente pequeño no se queda corto en el primer mes.
- **Holgura:** con la estimación de ~150 MB/usuario/año, un cliente como Electrocréditos (100 usuarios) en plan Profesional (225 GB) tiene para **más de 10 años**, incluso triplicando el volumen por los PDFs versionados (~4 a 5 años). Es generoso frente al costo (225 GB ≈ USD 1,6 a 5/mes) y sigue estando por debajo de JSM Standard (250 GB).
- **Qué es "usuario activo":** usuario no desactivado en el periodo de facturación (el mismo criterio con el que se cobre la licencia).
- **Bloque adicional:** 25 GB. Precio sugerido para evaluar: USD 3 a 5/mes (costo real USD 0,20 a 0,60).
- **Ahorro futuro:** regla de ciclo de vida en el bucket que pasa los archivos de más de 12 meses a una clase de acceso poco frecuente (≈ 40 a 50 % más barata) sin que el cliente lo note. Recomendado: **R2 o B2** en lugar de S3, porque no cobran (o casi no cobran) la descarga y las descargas por URL firmada serán frecuentes.

**Tabla aprobada (2026-09-30).** Pendiente de definir junto con la facturación (pregunta 6 de la §6): los precios de cada plan y si Prueba/Gratis existe.

#### 7.4.3 Proveedor de almacenamiento (aún no hay ninguno contratado)
- **El código no se casa con ningún proveedor:** se programa contra la **API S3** (`@aws-sdk/client-s3`, ya usada hoy), que hablan S3, Cloudflare R2, Backblaze B2, MinIO, DigitalOcean Spaces y Wasabi. Cambiar de proveedor es cambiar 4 variables de entorno (`STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`) y copiar los objetos (`rclone sync`).
- **Desarrollo: MinIO en Docker** (gratis, local, S3-compatible), levantado con el `docker-compose` junto a PostgreSQL. Así el entorno local se comporta igual que producción, y se elimina el modo "disco local".
- **Producción, recomendado: Cloudflare R2** para empezar. Da 10 GB/mes gratis, luego USD 0,015/GB-mes, **no cobra la descarga** (importante con las URLs firmadas), es compatible con S3 y se crea con tarjeta en minutos. Alternativa más barata a gran escala: Backblaze B2 (USD 0,007/GB). S3 solo si el resto de la infraestructura termina en AWS.
- **Datos personales (Ley 1581 de Colombia):** los adjuntos llevan datos personales (cédulas, soportes). R2 y B2 guardan fuera de Colombia, como también AWS, que no tiene región en Colombia. Hay que declararlo en la política de tratamiento de datos y en el contrato con el cliente (transferencia/transmisión internacional). No bloquea la elección, pero debe quedar escrito.
- **Momento de la decisión:** no hace falta contratar nada hasta el primer despliegue; hasta entonces todo corre con MinIO.

---

## 8. SLA y calendario por empresa

### 8.1 Cómo funciona hoy
- `tm_flujo_paso.paso_tiempo_habil` es un entero en **días hábiles**. **No existen las horas.**
- Festivos de Colombia 2025-2027 **hardcodeados** e iguales para todas las empresas. Sábado y domingo siempre son no hábiles (no hay sábados laborables).
- `DateHelper.addBusinessDays` suma N días hábiles **conservando la hora**. Si el inicio cae en un día no hábil, salta al siguiente a la misma hora. **No hay horario laboral**: un ticket creado a las 17:59 tiene el mismo plazo que uno creado a las 08:00.
- **Zona horaria**: usa la hora local del **servidor** (`format(date,'yyyy-MM-dd')`, `setHours`). En un servidor en UTC, los tickets de Colombia creados después de las 19:00 cuentan como del día siguiente.
- Plazo por **corte** (`deadline_tipo='corte'`, 1 paso): fecha de un campo + N días hábiles, recortada al fin del periodo del corte de la empresa (`tm_flujo_corte`, por flujo + empresa). `dias_gracia` se suma en días **calendario** y puede caer en fin de semana o festivo.
- El resultado se congela en el historial al salir del paso ('A Tiempo'/'Atrasado') y el cron marca 'Vencido', con el bug B1.
- **Semáforo con umbrales fijos** (rojo ≤1 día, naranja ≤2, amarillo ≤4) y no proporcionales: un SLA de 1 día nace en rojo.
- **Novedad, reasignación y reapertura reinician el reloj**: cada una crea una fila nueva de historial para el mismo paso y el SLA se mide desde esa fila, así que el tiempo previo se pierde. Esto permite "resetear" un SLA reasignando.
- Los reportes miden horas reales (no hábiles) contra días (B2).

### 8.2 Propuesta
- **Calendario por empresa** (`calendario` del tenant):
  - horario por día de la semana con **varias franjas** (p. ej. L-V 08:00-12:00 y 14:00-18:00, S 08:00-12:00);
  - festivos importables desde una plantilla por país, más festivos propios;
  - la empresa tiene `zona_horaria` (IANA, p. ej. `America/Bogota`) y `calendario_id`; la empresa por defecto usa el calendario del tenant.
- **SLA por paso con unidad**: `sla_valor` + `sla_unidad ENUM(horas_habiles, dias_habiles)` y **override por empresa** (`sla_override(paso_id, empresa_id, valor, unidad)`). Ese es el "depende de la empresa".
  - **Horas hábiles**: solo se consume tiempo dentro de las franjas laborales del calendario de la empresa del ticket (un ticket de 4 h creado a las 17:00 vence al día siguiente a las 11:00, si la jornada es 08-18).
  - **Días hábiles**: vence al **final de la jornada** del N-ésimo día hábil (decidido), según el horario del calendario de la empresa ese día.
- **Motor puro y testeado**: `calcularVencimiento(inicio, duracion, unidad, calendario, tz)` y `minutosHabiles(inicio, fin, calendario, tz)`, con tests de tabla (fines de semana, festivos, cruces de franja, inicio fuera de horario, cambio de horario de verano en otros países).
- **Reloj SLA como entidad**: `ticket_sla(ticket_id, paso_id, empresa_id, inicio, vence_en, pausado_desde, minutos_pausados, completado_en, resultado ENUM(a_tiempo|atrasado), alertado_en)`.
  - Una novedad **pausa** el reloj y al resolverse lo reanuda, recalculando `vence_en`.
  - Una reasignación dentro del mismo paso **reinicia** el reloj para el nuevo responsable (decidido): se cierra el reloj anterior con su resultado (a tiempo/atrasado para quien lo tenía) y se abre uno nuevo. `ticket_sla` guarda además `paso_inicio_original`, y los reportes **miden ambos** (decidido): el SLA de cada responsable (desde su reloj) y el tiempo total del paso (desde `paso_inicio_original` hasta la salida del paso, en tiempo hábil y descontando las novedades), cada uno con su resultado a tiempo/atrasado.
  - La reapertura abre un reloj nuevo (configurable).
- `vence_en` se calcula **al entrar al paso** y se guarda. El cron solo hace `WHERE vence_en < now() AND completado_en IS NULL AND alertado_en IS NULL` (arregla B1), y los reportes usan `minutos_habiles` guardados (arregla B2).
- **Semáforo por porcentaje consumido** (p. ej. <50 % verde, <75 % amarillo, <100 % naranja, vencido rojo), con umbrales configurables por tenant.
- Plazo por **corte**: se mantiene, con cortes por empresa y `dias_gracia` en **días hábiles** del mismo calendario.
- Futuro: escalamiento por porcentaje consumido (notificar al jefe o reasignar al llegar al X %).


---

## 9. Despliegue: contenedores Docker (decidido 2026-09-30)

El hosting no está definido; por eso todo se empaqueta en **imágenes Docker** y se diseña para correr igual en cualquier lugar: un VPS con Docker Compose, DigitalOcean App Platform, Render, Railway, AWS ECS/Fargate, Google Cloud Run o Kubernetes.

### 9.1 Imágenes
| Imagen | Contenido | Nota |
|---|---|---|
| `api` | backend NestJS compilado | multi-stage (build con dev deps → runtime `node:22-alpine` o `distroless` solo con `dist` + deps de prod), usuario no root, `HEALTHCHECK` en `/health` |
| `worker` | **la misma imagen** que `api` con otro comando (`node dist/worker.js`) | procesa las colas: PDFs, correos, SLA, planos, despacho aleatorio y purga de subidas pendientes. Escala aparte del API. |
| `web` | build de Vite servido por `nginx:alpine` | solo estáticos + `try_files` para el SPA; cabeceras de seguridad (CSP, HSTS, nosniff) |
| `migrate` | la imagen `api` con `node dist/migrate.js` | se ejecuta como **job** antes de cada despliegue, nunca al arrancar el API (evita que dos réplicas migren a la vez) |

Imágenes versionadas por **tag de git/semver** (no solo `latest`), construidas y escaneadas (p. ej. Trivy) en CI y publicadas en un registro (GitHub Container Registry, gratis para empezar).

### 9.2 Servicios de apoyo
- **Desarrollo (`docker-compose.yml`)**: `postgres:18`, `minio` (+ creación del bucket al arrancar), `redis` (colas BullMQ, caché de permisos, adaptador de WebSocket) y `mailpit` (para ver los correos sin enviarlos).
- **Producción**: los mismos servicios, pero **gestionados** cuando el hosting lo ofrezca (PostgreSQL gestionado con backups y PITR, Redis gestionado, R2/B2 para archivos). Si al principio es un VPS, pueden correr en el mismo Compose con volúmenes y backups programados (`pg_dump` diario a R2).

### 9.3 Reglas para que la imagen sea portable
- **Sin estado en el contenedor:** nada en disco local (archivos → S3-compatible, sesiones → no hay, colas → Redis). Cualquier réplica puede morir o duplicarse.
- **Configuración solo por variables de entorno** (12-factor), validadas al arrancar (esquema con `zod`/`joi`: si falta una variable, el contenedor no arranca). Secretos por el gestor del hosting, nunca dentro de la imagen ni en el repo. Dejo anotado que hoy el `CLAUDE.md` del proyecto actual tiene credenciales de una BD RDS en texto plano: hay que rotarlas y quitarlas de ahí.
- **Crons con lock** (§4.2 B11): con varias réplicas de `worker`, cada tarea programada corre una sola vez (BullMQ repeatable jobs o `pg_advisory_lock`).
- **Logs a stdout en JSON**, con `tenant_id` y `request_id`; `/health` (vivo) y `/ready` (BD + Redis + storage alcanzables).
- **Apagado ordenado** (`enableShutdownHooks`, terminar jobs en curso ante `SIGTERM`).
- **WebSocket**: Socket.IO dentro del `api` con adaptador Redis para varias réplicas (reemplaza el microservicio externo actual, B13).


---

## 10. Aprobadores por grupo (reemplaza organigrama y "jefe inmediato")

### 10.1 Por qué cambiar
Hoy el jefe se resuelve por **cargo**: `tm_organigrama` dice "el cargo A reporta al cargo B", y el sistema busca **cualquier** usuario activo con el cargo B, primero en la regional del solicitante y luego en cualquier otra. Problemas:
- Si hay varios usuarios con el cargo jefe, se elige uno **arbitrario** (`findOne` sin orden, B8).
- No permite excepciones ("Ana aprueba a su equipo, pero Pedro, del mismo cargo, lo aprueba otra persona").
- Hay **tres flags** para lo mismo (`necesita_aprobacion_jefe`, `requiere_confirmacion_jefe`, `campo_id_referencia_jefe=-1`), más `cargo_id=-1` en las firmas.
- Si el cargo jefe está vacante, el ticket falla al transicionar, no al crearse.

Tu propuesta, **"X aprueba a Y, Z y J; W aprueba a B, N y M"**, es mejor: es explícita, la entiende cualquier administrador sin conocer el organigrama y elimina la ambigüedad. Se complementa así:

### 10.2 Modelo
```
grupo_aprobacion(tenant_id, empresa_id?, nombre, tipo_id?, activo)
    -- p. ej. "Equipo comercial Popayán"; tipo opcional (§10.4)
grupo_aprobacion_aprobador(grupo_id, usuario_id, orden)      -- 1..N aprobadores; orden 1 = principal
grupo_aprobacion_miembro(grupo_id, usuario_id)               -- los aprobados
delegacion(usuario_id, delegado_id, desde, hasta, motivo)    -- vacaciones/ausencias
```
- **Resolución:** "aprobador del solicitante" = aprobador principal del grupo donde el creador es **miembro**. Si está ausente (tiene una delegación vigente) → su delegado; si no → el siguiente aprobador por `orden`.
- En el paso: `modo_asignacion = 'aprobador'` (reemplaza los 3 flags). En firmas: `tipo_firmante = 'aprobador'` (reemplaza `cargo_id = -1`).
- Se mantiene lo que hoy funciona: el aprobador **sugerido** aparece preseleccionado al crear el ticket y el creador puede elegir otro **solo** entre los aprobadores de su grupo (hoy puede elegir a cualquiera, S10).
- **Validación temprana:** si el flujo tiene un paso de aprobación y el creador no pertenece a ningún grupo (o el grupo no tiene aprobador activo), se avisa **al crear** el ticket, no a mitad del flujo.
- **Administración:** pantalla de grupos con carga masiva (Excel: aprobador → miembros) y una vista "¿quién aprueba a quién?". Al desactivar un usuario aprobador, el sistema avisa de los grupos que se quedan sin aprobador.
- **Arranque rápido (opcional):** asistente "generar grupos desde cargos" para que un cliente nuevo que ya piensa en cargos cree los grupos iniciales y luego los ajuste.
- **`cargo`** sigue existiendo para **asignar trabajo** en los pasos ("lo atiende el Analista de Cartera de la regional"). Aprobar y atender quedan como conceptos separados.

### 10.3 Transiciones a sí mismo (confirmadas como intencionales)
Son bucles de reproceso (p. ej. "Registro de faltante" vuelve al mismo paso). El motor debe:
- Permitirlas en el editor de flujos, mostradas como un bucle.
- Tratarlas como **una nueva vuelta del paso**: se cierra el reloj SLA actual con su resultado y se abre uno nuevo (igual que la reasignación, §8.2). El historial registra el número de vuelta.
- Tener un **límite opcional de vueltas** por paso (p. ej. máximo 5) que al alcanzarse obligue a tomar otra transición o avise al observador, para evitar bucles infinitos.
- En los reportes, contar los reprocesos por paso: es un indicador de calidad útil.

### 10.4 Decidido (2026-09-30)
- **Un grupo por tipo (decidido):** los grupos tienen un **tipo** opcional (p. ej. "General", "Compras", "Viajes") y un usuario puede estar como miembro en **un solo grupo por tipo**, con restricción UNIQUE. Así un paso puede decir "aprobador de tipo Compras" y no hay ambigüedad.
- **Aprobación multinivel (decidido):** si el aprobador X es a su vez miembro de otro grupo aprobado por W, un paso puede pedir "aprobador de nivel 2" (el aprobador del aprobador) sin configurar nada más.


---

## 11. Cómo manejan los tenants los SaaS con muchos clientes (investigación 2026-09-30)

### 11.1 Los tres modelos
| Modelo | Qué es | A favor | En contra | Quién lo usa |
|---|---|---|---|---|
| **Pool** | una BD y las mismas tablas para todos, con `tenant_id` + RLS | lo más barato, un solo esquema que migrar, onboarding instantáneo | "vecino ruidoso", restaurar a un solo cliente es difícil, un bug puede exponer datos (lo mitiga RLS) | la gran mayoría de los SaaS B2B al empezar; Notion (por workspace) |
| **Bridge** | una BD con un **schema por tenant** | aislamiento lógico, personalizaciones por cliente | migraciones × N schemas, catálogo de Postgres enorme con miles de clientes, **Prisma no lo maneja bien** | SaaS con pocos clientes grandes |
| **Silo** | una BD (o instancia) por tenant | aislamiento máximo, backups y restauración por cliente, residencia de datos | costo y operación × N, onboarding lento | planes enterprise, sectores regulados |

El patrón que usa la industria a medida que crece es **híbrido**: **pool para la mayoría** y la opción de **sacar a un cliente grande a su propia BD** (silo) cuando lo pague o cuando moleste a los demás. Para escalar el pool se hace **sharding por `tenant_id`**: Notion partió su monolito en 480 shards lógicos sobre 32 BD físicas usando el workspace como llave; Citus hace lo mismo dentro de Postgres, ubicando todas las filas de un tenant en el mismo nodo.

**Decisión para ProcesaBPM (ya tomada, se confirma):** empezar en **pool + RLS**, pero **diseñado desde el día 1** para poder hacer sharding o mover un tenant a silo sin reescribir nada.

### 11.2 Reglas de diseño que habilitan escalar después (obligatorias desde el inicio)
1. **`tenant_id` en todas las tablas de negocio**, incluidas las hijas (valores, eventos, adjuntos), aunque se pueda deducir por JOIN. Es lo que exigen Citus y cualquier esquema de sharding, y lo que usa RLS.
2. **`tenant_id` al inicio de las llaves**: PK compuesta `(tenant_id, id)` o, como mínimo, `UNIQUE(tenant_id, id)`, y **FKs compuestas** `(tenant_id, x_id) → (tenant_id, id)`. Así la BD hace imposible referenciar un registro de otro cliente.
3. **IDs UUIDv7** (ordenables por tiempo, sin colisiones entre shards ni al mover un tenant). Para humanos, un **número de ticket por tenant** (`#1045`) con un contador por tenant (`tenant_secuencia`), no un autoincremental global.
4. **Todos los índices empiezan por `tenant_id`**: `(tenant_id, estado, created_at DESC)`, etc. Sin eso, RLS convierte las consultas en escaneos completos.
5. **Nada de consultas entre tenants en el código de la app.** Los reportes globales (para nosotros) van por un servicio de plataforma aparte.
6. **Catálogo de tenants** (`tenant(id, slug, estado, plan_id, db_cluster, region)`) consultado en cada request desde el principio, aunque hoy todos apunten al mismo cluster. Así, mover un cliente a su BD es cambiar su `db_cluster`.

### 11.3 RLS bien hecho (y sus trampas)
- La app se conecta con un rol **sin `BYPASSRLS`** y sin ser dueño de las tablas (el dueño se salta RLS salvo `FORCE ROW LEVEL SECURITY`). **Activar `FORCE`** en todas las tablas de negocio.
- La política compara contra `current_setting('app.tenant_id', true)::uuid`. Es una expresión **estable**, así que el planificador usa el índice. Evitar funciones `VOLATILE` en las políticas, porque degradan a escaneo completo.
- **El tenant se fija con `set_config('app.tenant_id', $1, true)` (local a la transacción) dentro de una transacción explícita.** **Nunca** con `SET` de sesión: detrás de PgBouncer en modo transacción la conexión se reutiliza y el tenant "se filtra" al siguiente cliente.
- La cola, los crons y los jobs también fijan el tenant de cada tarea; no corren "sin tenant".
- Las operaciones de plataforma (crear tenants, facturar, soporte) usan **otro rol** con acceso amplio, **auditadas** y fuera del API público.
- **Test automático de fuga en CI**: crear 2 tenants, sembrar datos y verificar que ningún endpoint de A devuelve datos de B. Es el test más importante del proyecto.

### 11.4 Prisma + RLS: cómo y con qué cuidado
- Patrón oficial: **extensión de Prisma Client** que envuelve las operaciones en una transacción y ejecuta primero `set_config(..., true)`. En NestJS, un `PrismaService` "con tenant" por request, que toma el `tenant_id` de `AsyncLocalStorage`.
- **Cuidados detectados:**
  - Prisma 7 exige un *driver adapter* (`@prisma/adapter-pg`); el pool lo maneja `pg` y hay que configurar el timeout (por defecto no tiene).
  - Hay reportes de **pérdida de rendimiento con muchas transacciones concurrentes** usando el adaptador `pg`, y un **bug reportado** (issue #30374) en el que, tras un error dentro de una transacción interactiva, las siguientes consultas del mismo cliente pueden recibir respuestas de otras consultas. Esto es **grave para un multi-tenant**.
  - **Mitigaciones:** fijar una versión de Prisma con ese bug corregido (verificarlo antes de empezar), no mantener la transacción abierta durante todo el request sino solo durante el trabajo con BD, descartar la conexión ante errores, y el test de fuga del §11.3 en CI.
  - Las **migraciones** de Prisma no crean las políticas RLS: se agregan como SQL dentro de la migración (Prisma permite migraciones con SQL personalizado).
- Si al medir el rendimiento no alcanza, la alternativa sin cambiar de stack es Drizzle o Kysely para las rutas críticas. No lo recomiendo de entrada.

### 11.5 Vecino ruidoso (un cliente que afecta a los demás)
- **Rate limit por tenant** en el API (token bucket en Redis; responder 429), además del límite por usuario.
- **Colas justas por tenant**: los PDFs, planos y exportes de un cliente grande no deben bloquear a los demás (BullMQ con grupos/concurrencia por tenant).
- **`statement_timeout`** por rol (p. ej. 15 s en el API, más alto en los workers de reportes).
- **Reportes y exportes pesados sobre una réplica de lectura** cuando exista.
- **Métricas por tenant** (requests, tiempo de BD, almacenamiento, jobs) para detectar quién consume y decidir si pasa a un plan superior o a silo.

### 11.6 Ciclo de vida del tenant
- **Alta:** crear el tenant + la empresa por defecto + roles/permisos base + calendario del país + usuario admin, en **una transacción** (en segundos, sin tocar infraestructura).
- **Suspensión** (falta de pago): solo lectura o bloqueo, sin borrar nada.
- **Exportación completa** de un tenant (JSON/CSV + archivos) desde el panel: la necesita el cliente al irse y es un derecho del titular de los datos (Ley 1581).
- **Baja:** borrado lógico y, pasado el plazo acordado (pregunta 2 de la §6), **borrado físico** de todas sus filas y objetos, con un job idempotente que recorre las tablas por `tenant_id` y el prefijo `tenants/{id}/` del bucket.
- **Backups:** en pool, el backup es de toda la BD (PITR del proveedor). Para "restaurar solo al cliente X" hace falta una herramienta de **restauración lógica por tenant** (restaurar el backup en una BD temporal y copiar las filas de ese `tenant_id`). Se documenta como procedimiento, no hace falta construirlo el primer día.
- **Mover a silo** (futuro): exportación lógica por `tenant_id` → BD dedicada → cambiar `db_cluster` en el catálogo. Funciona solo si se cumplió el §11.2.


---

## 12. Lo que aún no está definido (antes de empezar)

Cada punto trae una **propuesta por defecto**: si se acepta, queda decidido. **§12.1 quedó decidido el 2026-09-30** (ver §0.1). §12.2 y §12.3 siguen con su propuesta por defecto.

### 12.1 Afectan el modelo de datos (hay que cerrarlos antes de escribir el esquema)
| # | Tema | Propuesta por defecto |
|---|---|---|
| D1 | **¿Un mismo correo puede pertenecer a varios tenants?** (p. ej. un contador que trabaja con dos clientes) | **Sí**: `usuario` global (identidad, contraseña) + `membresia(usuario_id, tenant_id, rol, cargo, …)`. Al entrar elige la organización. Es el modelo de Slack, Notion y Jira; cambiarlo después es muy costoso. |
| D2 | **Estructura organizacional genérica.** Regional/Zona/Departamento/Cargo son de Electrocréditos; otro cliente puede tener "Sedes", "Áreas" o nada. | Mantener **Departamento/Área** y **Cargo**, y convertir Regional/Zona en **"Sedes" jerárquicas** (árbol de N niveles con nombres configurables por tenant). Las reglas "misma regional" pasan a ser "misma sede o sede padre". |
| D3 | **Cálculos de campos** (`CALC:alimentacion`, `CALC:saldo_viaticos`) | **Decidido: se llevan** como **calculadoras integradas opcionales** (parametrizables por tenant: valores y horarios de alimentación), **más** un motor de fórmulas genérico con funciones como `SUMA`, `DIAS_HABILES(a,b)`, `SI(...)`. Quien no las use, no las ve. |
| D4 | **Moneda / país / idioma** | Moneda por empresa (ISO 4217, montos en `numeric(18,2)`), país por empresa (para los festivos), interfaz **solo en español** en v1 pero con textos en archivos i18n desde el inicio. |
| D5 | **Solicitantes externos** (clientes finales del tenant que abren tickets por un portal o por correo, sin ser empleados) | **v1 solo usuarios internos**, como hoy. El modelo deja `tipo_usuario ENUM(interno, externo)` para agregar un portal después. |
| D6 | **Roles** | Roles **base sembrados** por tenant (Administrador, Supervisor, Agente, Solicitante) + roles **personalizados** con el catálogo de permisos (CASL). El admin del tenant no puede quitarse a sí mismo el último rol de administrador. |
| D7 | **Retención al cancelar** | **Exportación completa** (decidido) + **60 días** en solo lectura/suspendido; luego borrado físico definitivo, con aviso por correo a los 30, 7 y 1 días. |

### 12.2 Funcionales (se pueden cerrar durante el desarrollo)
| # | Tema | Propuesta por defecto |
|---|---|---|
| F1 | **Inicio de sesión** | Correo + contraseña, recuperación por correo, **MFA opcional** (TOTP). Google/Microsoft (SSO) para v2. |
| F2 | **Correo saliente** | Un proveedor transaccional de la plataforma (Resend, Amazon SES o Brevo) con remitente `notificaciones@procesabpm…`; dominio propio del cliente en v2. Nada de SMTP por tenant en v1. |
| F3 | **Marca por tenant** | Logo, color principal y subdominio `cliente.procesabpm.com`. Dominio propio en v2. |
| F4 | **Onboarding** | Asistente inicial (empresa, calendario, primer flujo desde una plantilla) + **importación por Excel** de usuarios, cargos, sedes y grupos de aprobación. |
| F5 | **Plantillas de flujo** | Una galería con 3 a 5 flujos de ejemplo genéricos (solicitud de soporte TI, aprobación de compra, solicitud de permiso, confirmación de pago) que el cliente copia y ajusta. |
| F6 | **Auditoría** | `audit_log` de acciones administrativas (configuración, permisos, usuarios) y de accesos a documentos, consultable por el admin del tenant. |
| F7 | **Integraciones** | v1: **webhooks** salientes por evento (ticket creado/transicionado/cerrado) y los planos. API pública con tokens en v2. |
| F8 | **Reportes v1** | Los actuales, adaptados: KPIs, cumplimiento de SLA (responsable y paso total), ranking, reprocesos, novedades, errores y exportes Excel. |
| F9 | **Móvil** | Web responsiva (PWA) en v1; sin app nativa. |

### 12.3 De proyecto
| # | Tema | Propuesta por defecto |
|---|---|---|
| P1 | **Repositorio** | **Monorepo** con pnpm workspaces (+ Turborepo): `apps/api`, `apps/web`, `packages/shared` (tipos, validaciones zod y el motor de SLA/fórmulas compartidos entre front y back). Hoy se duplica a mano (`table-field.util.ts` ↔ `tableField.ts`). |
| P2 | **CI/CD** | GitHub Actions: lint + typecheck + tests (incluido el test de fuga entre tenants) + build de imágenes Docker en cada PR. |
| P3 | **Alcance del MVP** | Por definir juntos: qué entra en la primera versión y qué queda para después. Es lo siguiente a trabajar. |
| P4 | **Legal** | Términos de servicio, política de tratamiento de datos (Ley 1581, transferencia internacional por el storage y el hosting) y acuerdo de encargado de tratamiento con cada cliente. No es código, pero se necesita antes del primer cliente. |


---

## 13. Constructor de flujos visual (referencia: Truora, Bogotá)

### 13.1 Qué hace Truora (revisado 2026-09-30)
- **Tres zonas:** una **barra lateral de bloques** agrupada en secciones (*Frequent Blocks*, *Validator Blocks*, *Advanced Blocks*), un **lienzo** donde los bloques se **arrastran y se conectan**, y un **panel de propiedades** para configurar el bloque seleccionado.
- **Bloque "Condition"**: ramifica según **variables de bloques anteriores**. Cada bloque (p. ej. un formulario) genera variables automáticamente, que los bloques siguientes pueden usar.
- Bloques de **formulario**, de **integración con APIs externas** (*Custom Integration*) y de resultado.
- **Borrador / publicar / guardar como copia** y **vista previa** para probar antes de publicar.
- **Vista de ejecución**: el mismo diagrama del constructor, con el **camino recorrido resaltado** (bloques y conexiones ejecutados) y un panel lateral en acordeón que muestra, por bloque, **entradas, salidas, estado, hora y reintentos**, y la petición y respuesta completas en las integraciones. Hacer clic en el diagrama abre el detalle en el panel, y viceversa.

### 13.2 Cómo se traduce a ProcesaBPM
**Pantalla del constructor**
- **Barra superior:** nombre del flujo, subcategoría, estado (**Borrador / Publicado v3**), botones *Guardar*, *Validar*, *Probar*, *Publicar* e *Historial de versiones*.
- **Izquierda, bloques por sección:**
  - **Frecuentes:** Inicio (formulario de creación), Paso de trabajo, Aprobación, Fin (cierre).
  - **Lógica:** Condición (automática), Decisión (la elige el usuario, como las transiciones actuales), Tope de monto, Espera/Plazo de corte.
  - **Documentos:** Generar PDF (diseñado o plantilla), Firma, Registrar en plano.
  - **Avanzados:** Notificación/correo, Webhook/Integración, Calculadora, Tareas paralelas, Pool, Despacho aleatorio, Lote.
- **Centro, lienzo** con zoom, minimapa, alineación automática y **bucles visibles** (las transiciones a sí mismo, §10.3). Las conexiones son las transiciones y llevan el nombre de la decisión o de la rama de la condición.
- **Derecha, panel de propiedades** del bloque seleccionado, en pestañas: *General* (nombre, descripción), *Asignación* (cargo / usuarios / grupo de aprobación y nivel / creador / pool / paralelo / aleatorio, sede, selección manual), *Formulario* (campos, con arrastrar para ordenar), *SLA* (valor, horas/días hábiles, ajustes por empresa), *Documento y firma*, *Reglas* (topes), *Notificaciones*. Reemplaza el `StepModal` actual de 1.052 líneas.

**Variables**
- Cada bloque **publica variables**: los campos de su formulario, `aprobado_por`, `resultado`, la respuesta del webhook, etc. La **Condición**, los PDFs, los planos y las fórmulas las eligen desde un selector, en lugar de escribir códigos.

**Validar antes de publicar**
- Bloques sin conexión o inalcanzables, pasos sin responsable posible, flujos sin Fin, condiciones sin rama "si no" y bucles sin límite: se marcan en rojo en el lienzo y bloquean la publicación.

**Versiones** (encaja con §3.7)
- Se edita un **borrador**; *Publicar* crea una **versión inmutable**; los tickets en curso siguen en su versión y los nuevos usan la última. Se puede duplicar un flujo o una versión.

**Probar**
- **Simulador**: se recorre el flujo como un ticket de prueba (se eligen el creador y la empresa, se llenan los formularios y se toman decisiones) y se ve qué responsable resolvería cada paso, qué SLA aplica y qué rama tomaría cada condición, **sin crear tickets reales**.

**Vista de ejecución en el ticket** (reemplaza el grafo actual `timeline-graph`)
- El diagrama de la versión del flujo con el **camino recorrido resaltado** y el paso actual destacado. Las vueltas de un bucle se muestran con un contador. Al hacer clic en un paso se ven: responsable(s), fechas, **SLA del responsable y del paso** (a tiempo/atrasado), valores capturados, firmas, documentos generados, novedades, y la petición y respuesta de los webhooks.

### 13.3 Novedad importante frente al sistema actual
Hoy **todas** las ramas las elige una persona (transiciones con nombre) y la única rama automática es el desvío por tope de monto. El bloque **Condición** agrega **ramas automáticas** evaluadas por el motor (p. ej. `MEDIO_PAGO empieza con "BANCOLOMBIA"` → rama A; si no → rama B), con el mismo evaluador de filtros que ya existe en los planos (`igual|distinto|empieza_con|contiene|en_lista`) más comparaciones numéricas y de fecha.

### 13.4 Técnica
- Lienzo con **React Flow (@xyflow/react)**: nodos personalizados, conexiones con etiquetas, minimapa, zoom y *auto-layout* con ELK/dagre. La posición de cada nodo se guarda en el paso (`ui_x`, `ui_y`).
- Modelo de datos: `paso.tipo_bloque ENUM(inicio|trabajo|aprobacion|condicion|decision|documento|firma|plano|notificacion|webhook|calculadora|espera|fin)` + `config JSONB` validada con zod por tipo (el esquema vive en `packages/shared` y lo usan el front y el back). Las transiciones ganan `condicion JSONB` (para las ramas automáticas) y `es_rama_defecto`.
- El motor ejecuta los bloques **automáticos** (condición, documento, notificación, webhook, calculadora, plano) sin intervención humana, en el `worker` y a través del outbox, hasta llegar al siguiente paso que requiere a una persona.

Fuentes: [Create a Flow (Truora)](https://dev.truora.com/digital-identity/tutorials/create_a_flow/) · [Advanced Blocks (Truora)](https://dev.truora.com/guides/web_advanced_blocks/) · [Flow execution view (Truora)](https://dev.truora.com/guides/flow_execution_view/)

---

## Anexo A: Scripts de verificación usados
- Relaciones sin FK y huérfanos: una consulta `LEFT JOIN … WHERE ref IS NULL` por cada relación listada en §3.1 (lista en el scratchpad de la sesión `rels.txt`).
- Integridad: tickets cerrados sin fecha, asignados CSV vs tabla, correos duplicados, transiciones que se repiten, novedades y paralelos abiertos en tickets cerrados.
- Alertas SLA tras cierre: `tm_notificacion JOIN tm_ticket WHERE not_mensaje LIKE 'ALERTA:%vencido%' AND fech_not > fech_cierre`.
