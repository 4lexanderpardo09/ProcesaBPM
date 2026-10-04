/** What the people of the organization read about their data export: the archive's LEEME.txt and the ready e-mail. */
export const dataExportsEs = {
  readme: {
    title: (organization: string) => `Exportación de datos de «${organization}»`,
    generatedAt: (date: string) => `Generada el ${date} (hora UTC).`,
    intro:
      'Este archivo contiene una copia de los datos de tu organización en ProcesaBPM, tal como estaban al generarla. Guárdalo en un lugar seguro: incluye datos personales de tus miembros y clientes.',
    contentsTitle: 'Contenido',
    contents: [
      'manifest.json: resumen técnico (versión del formato, cantidad de filas por conjunto, archivos incluidos y los que no se encontraron).',
      'data/<conjunto>.jsonl: todos los datos, un objeto JSON por línea. Las fechas van en ISO 8601 (UTC); los números grandes y los decimales, como texto.',
      'csv/<conjunto>.csv: tickets, valores de los campos, eventos (historial y comentarios), miembros y auditoría, para abrir en una hoja de cálculo (UTF-8, separados por comas). Un texto que empieza con =, +, - o @ lleva un apóstrofo delante para que la hoja no lo ejecute como fórmula.',
      'files/<id del archivo>/<nombre>: los archivos subidos y los documentos generados.',
      'files/index.csv: qué archivo es cada uno (nombre original, tipo, tamaño, ticket y campo al que pertenece) y si quedó incluido.',
    ],
    groupsTitle: 'Conjuntos de datos',
    groups: {
      organization: 'Organización: la organización, empresas, áreas, cargos, sedes y calendarios.',
      identity: 'Personas y permisos: miembros, roles y permisos, grupos, grupos de aprobación y delegaciones.',
      catalog: 'Catálogo: prioridades, categorías, subcategorías, tipos de error, etiquetas y calculadoras.',
      workflows: 'Flujos: flujos, versiones, pasos, transiciones, campos, reglas, conjuntos de datos, formatos y plantillas PDF.',
      tickets: 'Tickets: tickets, responsables, valores de los campos, eventos, visitas a los pasos, ANS, tareas paralelas, novedades, errores, etiquetas, firmas, documentos y metadatos de los archivos.',
      trail: 'Auditoría: el registro de auditoría y los accesos de soporte.',
    },
    excluded:
      'No se incluyen contraseñas, códigos de verificación ni secretos de ninguna clase, ni las notificaciones, preferencias y colas internas del sistema.',
    missingFiles: (count: number) => `${count} ${count === 1 ? 'archivo no se encontró' : 'archivos no se encontraron'} en el almacenamiento: aparecen en manifest.json (missingFiles) y en files/index.csv.`,
    withoutFiles: 'Esta exportación se pidió sin archivos: solo contiene los datos.',
  },
  readyMail: {
    subject: 'La exportación de datos de tu organización está lista',
    title: 'Tu exportación está lista',
    greeting: (firstName: string) => `Hola ${firstName},`,
    ready: (organization: string) => `La exportación de los datos de la organización «${organization}» que pediste ya está lista.`,
    expires: (date: string) => `Puedes descargarla hasta el ${date}. Después se borra.`,
    how: 'Ingresa a ProcesaBPM y abre la página de exportación: la descarga vuelve a pedir tu contraseña. Este correo no contiene ningún enlace al archivo.',
    action: 'Ir a la exportación',
  },
} as const;
