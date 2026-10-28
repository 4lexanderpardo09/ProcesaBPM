import type { CollectionEntry } from 'astro:content';

type Article = CollectionEntry<'blog'>;

/** Newest first; drafts only while developing. */
export function publishedArticles(articles: readonly Article[], includeDrafts: boolean): Article[] {
  return articles.filter((article) => includeDrafts || !article.data.draft).sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());
}

export const formatArticleDate = (date: Date): string => date.toLocaleDateString('es-CO', { dateStyle: 'long', timeZone: 'UTC' });
