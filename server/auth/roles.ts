export type UserRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'WORKER';

const ROLE_ALIASES: Record<string, UserRole> = {
  OWNER: 'OWNER',
  SUPERADMIN: 'OWNER',
  SUPER_ADMIN: 'OWNER',
  ADMIN_SUPER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  RESPONSABLE: 'MANAGER',
  WORKER: 'WORKER',
  OPERARIO: 'WORKER',
};

export const normalizeUserRole = (
  value: unknown,
  claims: Record<string, unknown> = {}
): UserRole | null => {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (ROLE_ALIASES[normalized]) return ROLE_ALIASES[normalized];
  if (claims.owner === true || claims.superadmin === true) return 'OWNER';
  if (claims.admin === true) return 'ADMIN';
  if (claims.manager === true) return 'MANAGER';
  if (claims.workerId || claims.worker === true) return 'WORKER';
  return null;
};

export const isAdministrativeRole = (role: UserRole | null) =>
  role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER';

export const canManageWorkers = (role: UserRole | null) =>
  role === 'OWNER' || role === 'ADMIN';

export const canManageAdministrators = (role: UserRole | null) => role === 'OWNER';
