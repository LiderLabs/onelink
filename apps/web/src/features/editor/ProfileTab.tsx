import { ProfileScreen } from '../profile/ProfileScreen'

// ============================================================================
// The Profile tab.
//
// Profile is account-level, not page-level: a name, a bio, a photo and a set of
// social links belong to the person, not to one page. So this tab is a thin
// frame around the existing profile editor rather than a reimplementation — the
// identity form, socials list, photo cropper and live preview are exactly what
// the wireframe's Profile tab shows.
// ============================================================================

export function ProfileTab() {
  return <ProfileScreen />
}
