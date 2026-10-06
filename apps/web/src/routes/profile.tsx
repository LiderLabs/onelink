/**
 * `/app/profile` — the console's wiring for the profile screen.
 *
 * Two lines and no logic: the route table imports screens from `routes/*`, and
 * the screen itself lives with the rest of the profile feature
 * (`features/profile/ProfileScreen.tsx`) so the API client, the field rules and
 * the sections that apply them sit together (spec §10).
 */
export { ProfileScreen as ProfileRoute } from '../features/profile/ProfileScreen'
