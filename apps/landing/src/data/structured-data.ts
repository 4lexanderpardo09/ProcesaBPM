/**
 * schema.org data for search engines and AI assistants: who ProcesaBPM is, what the product does, the questions people
 * ask, and each blog post. Only facts that are true today; no ratings, prices or customers that do not exist.
 */
const ORG_ID = (site: URL) => new URL('/#organizacion', site).href;

export const CONTACT_EMAIL = 'alexander.pardo.dev@gmail.com';

export function organizationLd(site: URL) {
  return {
    '@type': 'Organization',
    '@id': ORG_ID(site),
    name: 'ProcesaBPM',
    url: site.href,
    logo: new URL('/favicon.svg', site).href,
    email: CONTACT_EMAIL,
    areaServed: 'CO',
    description: 'Plataforma para diseñar y ejecutar los procesos de una empresa: solicitudes, aprobaciones, firmas, plazos y documentos PDF.',
  };
}

export function websiteLd(site: URL) {
  return { '@type': 'WebSite', '@id': new URL('/#sitio', site).href, url: site.href, name: 'ProcesaBPM', inLanguage: 'es-CO', publisher: { '@id': ORG_ID(site) } };
}

export function softwareLd(site: URL) {
  return {
    '@type': 'SoftwareApplication',
    name: 'ProcesaBPM',
    url: site.href,
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Gestión de procesos de negocio (BPM)',
    operatingSystem: 'Web, Android, iOS (navegador)',
    inLanguage: 'es',
    publisher: { '@id': ORG_ID(site) },
    featureList: [
      'Constructor visual de flujos con aprobaciones, decisiones, condiciones por monto, firmas y esperas',
      'Asistente de IA que arma el borrador del flujo a partir de una descripción en español',
      'Tiempo límite (SLA) por paso en horas o días hábiles',
      'Formatos PDF generados con los datos de la solicitud y la firma de quien aprobó',
      'Varias empresas en una sola cuenta, cada una con sus datos separados',
      'Aprobaciones y firmas desde el celular',
    ],
  };
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

export function faqLd(items: readonly FaqItem[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })),
  };
}

export function articleLd(site: URL, url: string, article: { title: string; description: string; publishedAt: Date; author: string }) {
  return {
    '@type': 'BlogPosting',
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt.toISOString(),
    inLanguage: 'es-CO',
    mainEntityOfPage: url,
    image: new URL('/og.png', site).href,
    author: { '@type': 'Organization', name: article.author },
    publisher: { '@id': ORG_ID(site) },
  };
}
