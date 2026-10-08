import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSession } from '../../lib/session'
import { ErrorNotice } from '../../components/ErrorNotice'
import { Splash } from '../../components/StatusScreens'
import { getSetupPages, hasCompletedSetup } from './setup-state'

export function CreatorEntryRoute() {
  const { user, mustChangePassword } = useSession()
  const [destination, setDestination] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  const restricted = !user || mustChangePassword || user.status !== 'active' || user.impersonatedBy !== null
  useEffect(() => {
    if (restricted) return
    let current = true
    setError(null)
    void getSetupPages().then(pages => {
      if (current) setDestination(hasCompletedSetup(pages) ? '/app/dashboard' : '/app/onboarding')
    }).catch(cause => { if (current) setError(cause) })
    return () => { current = false }
  }, [user?.id, restricted, retry])
  if (restricted) return <Navigate to="/app/dashboard" replace />
  if (error) return <ErrorNotice error={error} action="Try again" onRetry={() => setRetry(value => value + 1)} />
  return destination ? <Navigate to={destination} replace /> : <Splash label="Opening your creator workspace" />
}

export function CreatorShortcut({ pane }: { pane: 'links' | 'share' }) {
  const navigate = useNavigate()
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setError(null)
    void getSetupPages().then(pages => {
      if (!current) return
      const page = pages.find(item => item.status === 'published') ?? pages[0]
      navigate(page ? `/app/pages/${page.id}?tab=${pane === 'share' ? 'publish' : 'links'}${pane === 'share' ? '&qr=1' : ''}` : '/app/onboarding', { replace: true })
    }).catch(cause => { if (current) setError(cause) })
    return () => { current = false }
  }, [pane, navigate, retry])
  return error ? <ErrorNotice error={error} action="Try again" onRetry={() => setRetry(value => value + 1)} /> : <Splash label="Opening your page" />
}

export function CreatorEditorEntryRoute() {
  const [destination, setDestination] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let current = true
    setError(null)
    void getSetupPages().then(pages => {
      const page = pages.find(item => item.status === 'published') ?? pages[0]
      if (current) setDestination(page ? `/app/pages/${page.id}` : '/app/onboarding')
    }).catch(cause => { if (current) setError(cause) })
    return () => { current = false }
  }, [retry])
  if (error) return <ErrorNotice error={error} action="Try again" onRetry={() => setRetry(value => value + 1)} />
  return destination ? <Navigate to={destination} replace /> : <Splash label="Opening your page editor" />
}
