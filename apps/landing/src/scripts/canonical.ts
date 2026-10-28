/**
 * The address a page is known by: `/index.html` is `/`, and `/blog.html` is `/blog` (the server answers both, with
 * `build.format: 'file'`), so search engines index one address per page.
 */
export function canonicalPath(pathname: string): string {
  const clean = pathname.replace(/\/index\.html$/, '/').replace(/\.html$/, '');
  return clean === '' ? '/' : clean;
}
