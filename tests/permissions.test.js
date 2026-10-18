const { ROLES, ROLE_LEVEL, canAccess } = require('./test-utils');

describe('Role-Based Access Control', () => {
  describe('ROLES constant', () => {
    test('includes all expected roles', () => {
      expect(ROLES).toContain('OWNER');
      expect(ROLES).toContain('MANAGER');
      expect(ROLES).toContain('CASHIER');
      expect(ROLES).toContain('WAITER');
    });

    test('has exactly 4 roles', () => {
      expect(ROLES).toHaveLength(4);
    });
  });

  describe('ROLE_LEVEL mapping', () => {
    test('OWNER has highest level', () => {
      expect(ROLE_LEVEL.OWNER).toBeGreaterThan(ROLE_LEVEL.MANAGER);
    });

    test('MANAGER has higher level than CASHIER', () => {
      expect(ROLE_LEVEL.MANAGER).toBeGreaterThan(ROLE_LEVEL.CASHIER);
    });

    test('CASHIER has higher level than WAITER', () => {
      expect(ROLE_LEVEL.CASHIER).toBeGreaterThan(ROLE_LEVEL.WAITER);
    });

    test('WAITER has lowest level', () => {
      expect(ROLE_LEVEL.WAITER).toBe(1);
    });
  });

  describe('canAccess', () => {
    // OWNER can access everything
    test('OWNER can access OWNER-protected actions', () => {
      expect(canAccess('OWNER', 'OWNER')).toBe(true);
    });

    test('OWNER can access MANAGER-protected actions', () => {
      expect(canAccess('OWNER', 'MANAGER')).toBe(true);
    });

    test('OWNER can access CASHIER-protected actions', () => {
      expect(canAccess('OWNER', 'CASHIER')).toBe(true);
    });

    test('OWNER can access WAITER-protected actions', () => {
      expect(canAccess('OWNER', 'WAITER')).toBe(true);
    });

    // MANAGER can access MANAGER and below, not OWNER
    test('MANAGER can access MANAGER-protected actions', () => {
      expect(canAccess('MANAGER', 'MANAGER')).toBe(true);
    });

    test('MANAGER cannot access OWNER-protected actions', () => {
      expect(canAccess('MANAGER', 'OWNER')).toBe(false);
    });

    test('MANAGER can access CASHIER-protected actions', () => {
      expect(canAccess('MANAGER', 'CASHIER')).toBe(true);
    });

    // CASHIER can access CASHIER and below
    test('CASHIER can access CASHIER-protected actions', () => {
      expect(canAccess('CASHIER', 'CASHIER')).toBe(true);
    });

    test('CASHIER cannot access MANAGER-protected actions', () => {
      expect(canAccess('CASHIER', 'MANAGER')).toBe(false);
    });

    test('CASHIER can access WAITER-protected actions', () => {
      expect(canAccess('CASHIER', 'WAITER')).toBe(true);
    });

    // WAITER can only access WAITER
    test('WAITER can access WAITER-protected actions', () => {
      expect(canAccess('WAITER', 'WAITER')).toBe(true);
    });

    test('WAITER cannot access CASHIER-protected actions', () => {
      expect(canAccess('WAITER', 'CASHIER')).toBe(false);
    });

    // No role required
    test('any role can access actions with no required role', () => {
      expect(canAccess('WAITER', null)).toBe(true);
      expect(canAccess('CASHIER', undefined)).toBe(true);
    });

    // Invalid role
    test('invalid role has no access', () => {
      expect(canAccess('INVALID', 'WAITER')).toBe(false);
    });
  });
});
