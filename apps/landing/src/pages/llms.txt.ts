import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { FAQ } from '../data/faq';
import { CONTACT_EMAIL } from '../data/structured-data';
import { publishedArticles } from '../scripts/blog';

/**
 * /llms.txt (llmstxt.org): what ProcesaBPM is, in plain Markdown, for AI assistants that answer questions about it.
 * Built from the same FAQ and blog as the site, so it never says something the pages do not.
 */
export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL('https://procesabpm.com');
  const at = (path: string) => new URL(path, base).href;
  const articles = publishedArticles(await getCollection('blog'), false);
  const body = `# ProcesaBPM

> Plataforma web colombiana para diseñar y ejecutar los procesos de una empresa: solicitudes, aprobaciones, firmas, plazos (SLA) y documentos PDF. Los flujos se dibujan como un diagrama, o se le describen en español a un asistente de IA que arma el borrador.

## Qué hace
- Constructor visual de flujos: inicio, pasos, aprobaciones, decisiones, condiciones automáticas (por ejemplo, por monto), firmas, esperas, documentos, notificaciones, exportaciones y webhooks.
- Asistente de IA «Crear con IA»: arma el borrador del flujo a partir de una descripción y acepta cambios en un chat; el borrador se revisa antes de publicarlo.
- Cada paso tiene responsable (persona, cargo, grupo o quien escoja el solicitante) y tiempo límite en horas o días hábiles.
- Formatos PDF que se llenan con los datos de la solicitud y la firma de quien aprobó.
- Varias empresas en una sola cuenta, cada una con su marca y sus datos separados.
- Se usa desde el navegador del computador o del celular.

## Preguntas frecuentes
${FAQ.map((item) => `### ${item.question}\n${item.answer}`).join('\n\n')}

## Páginas
- [Inicio](${at('/')}): un anticipo real recorriendo su flujo, el constructor y el asistente de IA.
- [Blog](${at('/blog')})
${articles.map((article) => `- [${article.data.title}](${at(`/blog/${article.id}`)}): ${article.data.description}`).join('\n')}
- [Aviso de privacidad](${at('/privacidad')})

## Contacto
Demo: formulario en ${at('/#contacto')} · ${CONTACT_EMAIL}
`;
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
