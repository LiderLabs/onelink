import { AuthIcon } from './AuthPage'

/** The same mark and wordmark used by the authentication and workspace screens. */
export function OneLinkBrand({ name = 'OneLink' }: { name?: string }) {
  return (
    <span className="page-brand" aria-label={name}>
      <span className="page-brand-mark"><AuthIcon name="brand" /></span>
      <span className="page-brand-wordmark">{name === 'OneLink' ? <>One<span>Link</span></> : name}</span>
    </span>
  )
}
