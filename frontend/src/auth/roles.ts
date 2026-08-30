/**
 * Roles, mirrored from `backend/app/core/permissions.py`.
 *
 * The backend is the enforcement - every authenticated route is refused there,
 * not here. This copy exists so the interface does not offer buttons that come
 * back 403, which reads as a broken product rather than as a permission.
 *
 * Roles are **not a rank**. `read_only` and `executive` do not sit above or
 * below an analyst; they sit sideways, which is precisely what the numbered
 * comparison this replaces could not express.
 */
export type Role = 'owner' | 'admin' | 'analyst' | 'read_only' | 'executive'

export type Permission = 'write' | 'artifacts' | 'users' | 'config'

const PERMISSIONS: Record<Role, Permission[]> = {
  owner:     ['write', 'artifacts', 'users', 'config'],
  admin:     ['write', 'artifacts', 'users', 'config'],
  analyst:   ['write', 'artifacts'],
  read_only: ['artifacts'],
  executive: [],
}

export const ROLE_LABELS: Record<Role, string> = {
  owner:     'Owner',
  admin:     'Administrator',
  analyst:   'Analyst',
  read_only: 'Read-only',
  executive: 'Executive',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner:     'Full access, including other administrators.',
  admin:     'Full access and user administration.',
  analyst:   'Full access to cases and artifacts. No user administration.',
  read_only: 'Sees everything an analyst sees. Changes nothing.',
  executive: 'Case list, dashboard and reports. No artifact-level access.',
}

export const ROLE_COLORS: Record<Role, string> = {
  owner:     'bg-accent/10 text-accent border-accent/20',
  admin:     'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  analyst:   'bg-severity-low/10 text-severity-low border-severity-low/20',
  read_only: 'bg-fg-muted/10 text-fg-muted border-fg-muted/20',
  executive: 'bg-data-2/10 text-data-2 border-data-2/20',
}

/** Every role, in the order they are offered. */
export const ALL_ROLES: Role[] = ['analyst', 'read_only', 'executive', 'admin', 'owner']

export function can(role: Role | undefined, permission: Permission): boolean {
  // An unknown role gets nothing, matching the backend. Failing closed here
  // means a role the frontend has not been taught about hides controls rather
  // than showing ones that will be refused.
  return role ? PERMISSIONS[role]?.includes(permission) ?? false : false
}

/**
 * Whether an actor may hand out a role.
 *
 * Only an owner may create another owner. Everything else an administrator can
 * grant - the same rule as `may_assign_role` on the backend, restated rather
 * than derived from a position in a list.
 */
export function mayAssignRole(actorRole: Role | undefined, target: Role): boolean {
  if (target === 'owner') return actorRole === 'owner'
  return actorRole === 'owner' || actorRole === 'admin'
}

/** Whether an actor may act on someone else's account. */
export function canManage(
  actor: { id: string; role: Role } | null,
  target: { id: string; role: Role },
): boolean {
  if (!actor || actor.id === target.id) return false
  if (!can(actor.role, 'users')) return false
  if (actor.role === 'owner') return true
  // An admin cannot touch another admin, or an owner.
  return target.role !== 'admin' && target.role !== 'owner'
}
