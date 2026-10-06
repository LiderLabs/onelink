import { request } from '../../lib/api'
import type {
  CreateSocialInput,
  SocialLink,
  SocialsResponse,
  UpdateSocialInput,
} from '../../lib/types'

// ============================================================================
// The social-links resource.
//
// Identity (`PATCH /auth/me`) is deliberately NOT here: it is the session's own
// row, and the one place that can adopt a new identity into session state is
// `lib/session.tsx`. Socials are a separate resource with a separate table
// (**D9**), so they get their own client beside the screen that uses them
// (spec §10), rather than every resource piling into `lib/api.ts`.
//
// Nothing here reshapes a response. The API already answers DTOs, and a second
// "friendlier" shape in the browser is how the two drift apart.
//
// The routes are asymmetric on purpose, and the types say so:
//
//   POST /profile/socials          201 + the created social
//   PATCH /profile/socials/:id     200 + the updated social
//   PUT /profile/socials/order     200 + the WHOLE reordered list
//   DELETE /profile/socials/:id    204 + no body at all
//
// `order` is registered before `:id` on the server for exactly this reason, and
// the id in every URL here is the row's own ULID: a foreign or missing id is a
// `404`, never a `403`, so nothing about someone else's row is discoverable.
// ============================================================================

export const socialsApi = {
  list: () => request<SocialsResponse>('/profile/socials'),

  create: (input: CreateSocialInput) =>
    request<SocialLink>('/profile/socials', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (id: string, input: UpdateSocialInput) =>
    request<SocialLink>(`/profile/socials/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  remove: (id: string) =>
    request<void>(`/profile/socials/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /**
   * Reorders by naming every row exactly once.
   *
   * The server refuses a partial list (`400` "The ordering must name every social
   * link on this profile exactly once."), because positions are dense by
   * construction and an unmentioned row would silently fall out of the ordering.
   * Hidden rows count: visibility is not order.
   */
  reorder: (socialIds: string[]) =>
    request<SocialsResponse>('/profile/socials/order', {
      method: 'PUT',
      body: JSON.stringify({ socialIds }),
    }),
}