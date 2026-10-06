import { useEffect, useState } from 'react'

export function ProfileAvatar({ avatarKey, displayName, className = '' }: {
  avatarKey: string | null; displayName: string; className?: string
}) {
  const [failedKey, setFailedKey] = useState<string | null>(null)
  useEffect(() => { setFailedKey(null) }, [avatarKey])
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase() || '@'
  const safeKey = avatarKey && /^avatars\/[A-Za-z0-9_-]+\/[0-9A-HJKMNP-TV-Z]{26}\.webp$/.test(avatarKey)
  return <span className={`profile-monogram profile-avatar ${className}`} aria-hidden="true">
    {safeKey && failedKey !== avatarKey
      ? <img src={`/api/v1/media/files/${avatarKey}`} alt="" onError={() => setFailedKey(avatarKey)} />
      : initials}
  </span>
}
