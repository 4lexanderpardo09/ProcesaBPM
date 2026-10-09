# Sistema de diseño de ProcesaBPM

Reglas visuales del frontend (`apps/web`). Estilo "Data-Dense / Swiss": denso, preciso, navy y azul sobre fondos claros, pensado para trabajar todo el día con tablas, formularios y flujos. Por ahora solo hay tema claro.

## Qué hay en esta carpeta
| Archivo | Para qué |
|---|---|
| `tokens.json` | Fuente de verdad: colores, tipografía, espaciado, radios y sombras, cada uno con su uso. |
| `tokens.css` | Las mismas variables como CSS (`--navy`, `--accent`, `--space-4`…) y clases de texto (`.text-body`, `.text-overline`…). Se genera desde `tokens.json`: si cambias un valor, cámbialo en los dos. |
| `logos/` | El símbolo en sus tres variantes (ver "Logo"). |
| `mockups/prototipos/` | Prototipos HTML de referencia: lista de tickets, nuevo ticket, detalle del ticket y constructor de flujos. Se abren directo en el navegador. |
| `mockups/capturas/` | Capturas de la versión revisada de la bandeja, el detalle (con el avance del flujo en diagrama) y el nuevo ticket. Donde un prototipo y una captura no coinciden, manda la captura. |

Los mockups son referencia de estructura y estilo, no código para copiar: los datos son de ejemplo y algunos detalles (sombras de color, degradados) no siguen estas reglas. **Si un mockup contradice este README, manda este README.**

## Cómo usarlo en `apps/web`
- Importa `tokens.css` una vez en el arranque de la app y usa solo sus variables. No escribas colores, radios ni sombras sueltos en los componentes.
- Los componentes base (botón, insignia, tarjeta, campo, select, pestañas, tabla, avatar) viven en `src/shared/ui` (ver `docs/arquitectura.md` §4) y se construyen con estos tokens.
- Los textos visibles van en español vía i18n; los nombres de componentes, props, clases y archivos van en inglés.
- Los diagramas de flujo (constructor y avance del flujo en el ticket) se hacen con **React Flow**, con los colores de bloque de la sección "Flujos".

## Contenido
- Español directo y sin adornos: "Nuevo ticket", "Crear y enviar", "Guardar borrador", "Limpiar filtros".
- Capitalización de oración en títulos, botones y etiquetas; encabezados de tabla y de sección en mayúsculas con `text-overline`.
- Las ayudas explican el efecto ("El primer paso del flujo recibe el ticket al crearlo y arranca su reloj de SLA"). Los errores piden una acción ("Escribe el asunto de la solicitud").
- Sin emojis.

## Color
- Fondo de la app `--bg`; barras, tarjetas, tablas y campos en `--surface`; encabezados de tarjeta, zonas de carga y hover de filas en `--surface-2`; controles segmentados en `--surface-3`.
- Texto principal `--ink`; navegación y etiquetas de campo `--slate`; secundario `--muted`. `--faint` solo para íconos inactivos y marcadores: no llega a 4.5:1 sobre blanco.
- `--navy` es la marca y la acción principal de un formulario ("Crear y enviar"). `--accent` es el color interactivo: navegación activa (`--accent-50` con texto `--accent-600`), pestaña activa, botón primario de pantalla, enlaces y foco.
- Estado = palabra + punto de color, nunca solo color. Insignia: texto en el color pleno, fondo `*-50` y borde `*-line` de la misma familia (`ok`, `warn`, `danger`, `accent`, `violet`).
- Estados de ticket: Abierto `--block-document`, En proceso `--accent`, Pausado `--warn`, En espera `--violet`, Cerrado `--muted`. SLA: a tiempo `--ok`, por vencer o en pausa `--warn`, vencido `--danger`.
- Bordes de 1px en `--line`; separadores internos en `--line-2`. El borde de los campos (`--line`) queda en 1.3:1: subirlo si se quiere cumplir 3:1 en controles.
- Contraste revisado: los textos cumplen 4.5:1 salvo `--faint` sobre blanco (2.6:1) y `--muted` sobre `--bg` (4.4:1).

## Tipografía
- `--font-sans` (Plus Jakarta Sans, Google Fonts) para toda la interfaz; `--font-mono` (IBM Plex Mono) con cifras tabulares para números de ticket, montos, contadores e identificadores.
- Página `text-page-title`; título del ticket `text-ticket-title`; tarjetas `text-card-title`; texto `text-body`; botones y celdas secundarias `text-body-sm`; etiquetas de campo e insignias `text-label`; encabezados de tabla `text-overline`; datos `text-code`.

## Forma y espacio
- Radios: `--radius-md` (8px) en botones, campos y navegación; `--radius-lg` (10px) en tarjetas; `--radius-xl` (14px) en la tabla principal; `--radius-pill` en contadores y etiquetas.
- Sombras: `--shadow-xs` en tarjetas y botones; `--shadow-md` al pasar sobre un nodo; `--shadow-lg` solo en paneles y avisos flotantes.
- Foco: contorno sólido de 2px en `--accent`, separado 2px.
- Densidad: `--space-4` entre tarjetas, `--space-5`/`--space-6` en márgenes; filas de tabla con 12px de relleno vertical. Objetivos táctiles de al menos 36px en escritorio y 44px en móvil.

## Estructura de pantalla
- Barra lateral fija (238px) con el logo a color sin fondo, las secciones "Operación" y "Configuración" y la navegación.
- Barra superior: a la izquierda las migas de pan o el estado "En vivo"; **a la derecha el usuario** (avatar, nombre, rol) y cerrar sesión.
- Contenido: título de página con su acción principal a la derecha; debajo, pestañas de bandeja con contador, y **la búsqueda junto a los filtros** (no en la barra superior).
- Detalle del ticket: encabezado con número, título, insignias y acciones; franja de datos clave; **avance del flujo a todo el ancho**; debajo, actividad y la columna de datos y adjuntos.

## Flujos
- Los flujos no son lineales: tienen decisiones, ramas que regresan (reintentos) y efectos automáticos. Se dibujan siempre como grafo con React Flow, nunca como lista de pasos.
- Color por tipo de bloque: Inicio `--block-start`, Fin `--block-end`, Paso `--block-step`, Aprobación `--block-approval`, Decisión `--block-decision`, Condición `--block-condition`, Calculadora `--block-calculator`, Espera `--block-wait`, Documento `--block-document`, Notificación `--block-notification`, Exportar `--block-export`, Webhook `--block-webhook`.
- Nodo: tarjeta blanca con franja de 4px del color del tipo a la izquierda, tipo en `text-overline` del mismo color, nombre y una línea de estado.
- En el constructor: el nodo seleccionado lleva borde `--accent` y halo `--accent-50`; las conexiones son curvas de 2px en `--faint`, punteadas para los efectos.
- En el avance del ticket: recorrido hecho en `--ok`, paso actual con borde y halo `--accent` y su conexión saliente en `--accent`, pendiente en `--faint`, reintentos punteados en `--warn`, efectos punteados. Etiquetas de rama ("Sí", "No") en una pastilla blanca. Leyenda en el encabezado de la tarjeta.

## Iconografía
Iconos de trazo de 2px con terminaciones redondeadas, viewBox 24, de 15 a 18px. Heredan el color del texto (`--muted`, `--accent` si están activos). Los botones de solo icono llevan `aria-label`.

## Logo
El símbolo es una P armada como diagrama de flujo: dos bloques de paso y uno de inicio unidos por conectores, con una flecha de retorno. Sus colores son fijos.
- `logos/procesabpm-simbolo-color.svg` (a color, sin fondo): la P en `--navy` y el bloque de inicio en `--accent`. **Es el que va en la barra lateral** (30px de alto) y en fondos claros: login, correos y documentos.
- `logos/procesabpm-simbolo.svg` (principal): sobre un cuadrado `--navy`. Para el favicon, el ícono de la app (PWA) y fondos oscuros.
- `logos/procesabpm-simbolo-azul.svg`: sobre un cuadrado `--accent`. Para redes o cuando el navy se vea muy pesado.
- Nombre junto al símbolo: "ProcesaBPM" en Plus Jakarta Sans 800, espaciado -0.02em, "Procesa" en `--navy` y "BPM" en `--accent` (sobre navy: blanco y `--accent-line`). Separación: la mitad del ancho del símbolo. Tamaño mínimo: 20px.
- No cambiar sus colores, no rotarlo y no usar la versión sin fondo sobre fondos oscuros.

## Marca por cliente
Cada organización puede definir su logo y su color principal (`docs/pendientes.md` §2). Ese color sobrescribe solo `--accent`, `--accent-600`, `--accent-50` y `--accent-line`; hay que comprobar 4.5:1 del texto sobre el nuevo color. El logo de ProcesaBPM no cambia.
