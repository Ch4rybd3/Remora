import { describe, expect, it } from 'vitest'

import { ALL_ROLES, ROLE_LABELS, can, canManage, mayAssignRole, type Role } from '../roles'

/**
 * This table mirrors the backend. It drifting is the failure worth catching:
 * the interface would offer buttons that come back 403, which reads as a broken
 * product rather than as a permission.
 */
describe('roles', () => {
  it('gives every role a label', () => {
    for (const role of ALL_ROLES) expect(ROLE_LABELS[role]).toBeTruthy()
  })

  it('keeps the three original roles exactly as they were', () => {
    expect(can('analyst', 'write')).toBe(true)
    expect(can('analyst', 'artifacts')).toBe(true)
    expect(can('analyst', 'users')).toBe(false)
    expect(can('admin', 'users')).toBe(true)
    expect(can('owner', 'users')).toBe(true)
  })

  it('lets read-only see everything and change nothing', () => {
    expect(can('read_only', 'artifacts')).toBe(true)
    expect(can('read_only', 'write')).toBe(false)
  })

  it('gives an executive no artifact access at all', () => {
    expect(can('executive', 'artifacts')).toBe(false)
    expect(can('executive', 'write')).toBe(false)
  })

  it('fails closed on a role it has not been taught about', () => {
    // Hiding a control is the safe direction to be wrong in; showing one that
    // will be refused is not.
    expect(can('something-new' as Role, 'write')).toBe(false)
    expect(can(undefined, 'write')).toBe(false)
  })

  describe('assigning roles', () => {
    it('lets only an owner create another owner', () => {
      expect(mayAssignRole('owner', 'owner')).toBe(true)
      expect(mayAssignRole('admin', 'owner')).toBe(false)
    })

    it('lets an admin grant everything else', () => {
      for (const role of ALL_ROLES.filter(r => r !== 'owner')) {
        expect(mayAssignRole('admin', role), role).toBe(true)
      }
    })

    it('lets nobody else grant anything', () => {
      for (const actor of ['analyst', 'read_only', 'executive'] as Role[]) {
        expect(mayAssignRole(actor, 'analyst'), actor).toBe(false)
      }
    })
  })

  describe('managing accounts', () => {
    const account = (id: string, role: Role) => ({ id, role })

    it('stops anyone managing their own account here', () => {
      // Changing your own role is not a thing this screen does.
      expect(canManage(account('me', 'owner'), account('me', 'owner'))).toBe(false)
    })

    it('lets an owner manage anyone else', () => {
      for (const role of ALL_ROLES) {
        expect(canManage(account('owner', 'owner'), account('other', role)), role).toBe(true)
      }
    })

    it('stops an admin touching another admin or an owner', () => {
      const admin = account('admin-1', 'admin')
      expect(canManage(admin, account('x', 'analyst'))).toBe(true)
      expect(canManage(admin, account('x', 'read_only'))).toBe(true)
      expect(canManage(admin, account('x', 'admin'))).toBe(false)
      expect(canManage(admin, account('x', 'owner'))).toBe(false)
    })

    it('stops a non-administrator managing anyone', () => {
      expect(canManage(account('a', 'analyst'), account('b', 'analyst'))).toBe(false)
      expect(canManage(account('a', 'read_only'), account('b', 'analyst'))).toBe(false)
    })
  })
})
