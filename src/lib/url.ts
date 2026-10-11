/**
 * Prefix a site-relative path with the configured base (GitHub Pages serves the
 * site under /Hussein-Isaac-portfolio/). Every internal link goes through this.
 *
 *   url('/')            -> /Hussein-Isaac-portfolio/
 *   url('/work/salk/')  -> /Hussein-Isaac-portfolio/work/salk/
 *   url('/#contact')    -> /Hussein-Isaac-portfolio/#contact
 */
export function url(path = '/'): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${base}${clean}`;
}
