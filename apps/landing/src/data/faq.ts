import type { FaqItem } from './structured-data';

/** The questions people ask before a demo. Shown on the home page and given to search engines as FAQPage. */
export const FAQ: readonly FaqItem[] = [
  {
    question: '¿Qué es ProcesaBPM?',
    answer: 'Una plataforma web para diseñar los procesos de tu empresa como un diagrama y ejecutarlos. Cada solicitud pasa por los pasos que definiste, con responsable, plazo y firma, y todos ven en qué va.',
  },
  {
    question: '¿Necesito saber programar?',
    answer: 'No. Los flujos se arman arrastrando bloques en el constructor, o se le describen con tus palabras al asistente de IA, que arma un borrador para que lo revises y lo publiques.',
  },
  {
    question: '¿Qué procesos puedo llevar en ProcesaBPM?',
    answer: 'Cualquier proceso con pasos, aprobaciones y documentos: anticipos y legalizaciones, compras, pagos a proveedores, ingreso y retiro de personal, vacaciones, permisos, cambios de turno, mantenimiento y soporte, entre otros.',
  },
  {
    question: '¿Funciona en el celular?',
    answer: 'Sí. Desde el navegador del celular se crean solicitudes, se aprueban y se firman, sin instalar nada.',
  },
  {
    question: '¿Puedo manejar varias empresas en una sola cuenta?',
    answer: 'Sí. Un grupo puede tener varias empresas en la misma cuenta, cada una con su logo, su color y sus datos separados.',
  },
  {
    question: '¿Cómo pido una demo?',
    answer: 'Llena el formulario «Pedir una demo» con el proceso que más te cuesta. Te escribimos en un día hábil y lo armamos contigo.',
  },
];
