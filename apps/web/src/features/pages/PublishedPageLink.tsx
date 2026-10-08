import { Link, useLocation, type LinkProps } from 'react-router-dom'
import { publicPagePath } from './api'

/** Keep the workspace destination with the public-page visit, including filters. */
export function PublishedPageLink({ slug, ...props }: Omit<LinkProps, 'to' | 'state'> & { slug: string }) {
  const location = useLocation()
  return <Link {...props} to={publicPagePath(slug)} state={{ publicPageReturnTo: `${location.pathname}${location.search}${location.hash}` }} />
}
