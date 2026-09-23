import { verifyFirebaseIdToken } from '../firebaseAdminRest.js';
import { normalizeUserRole, type UserRole } from './roles.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type AuthContext = {
  uid: string;
  email?: string;
  claims: Record<string, any>;
  role: UserRole;
  workerId?: string;
};

export const getBearerToken = (authorization: unknown) => {
  const header = Array.isArray(authorization) ? authorization[0] : String(authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
};

export const requireAuth = async (req: any): Promise<AuthContext> => {
  const token = getBearerToken(req?.headers?.authorization);
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Debes iniciar sesión.');

  try {
    const verified = await verifyFirebaseIdToken(token);
    const claims = verified.claims || {};
    const role = normalizeUserRole(claims.role, claims);
    if (!role) throw new ApiError(403, 'ROLE_REQUIRED', 'No tienes permisos para esta acción.');

    return {
      uid: verified.uid,
      email: verified.email,
      claims,
      role,
      workerId: claims.workerId ? String(claims.workerId) : undefined,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'INVALID_SESSION', 'La sesión no es válida o ha caducado.');
  }
};

export const requireRole = (context: AuthContext, allowed: UserRole[]) => {
  if (!allowed.includes(context.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'No tienes permisos para esta acción.');
  }
};

export const requireWorkerSelf = (context: AuthContext, workerId: unknown) => {
  const targetId = String(workerId || '');
  const isAdmin = context.role === 'OWNER' || context.role === 'ADMIN';
  if (!isAdmin && (context.role !== 'WORKER' || !targetId || context.workerId !== targetId)) {
    throw new ApiError(403, 'FORBIDDEN', 'No tienes permisos para esta acción.');
  }
};

export const sendApiError = (res: any, error: unknown, fallback = 'No se pudo completar la solicitud.') => {
  if (error instanceof ApiError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(fallback, error);
  return res.status(500).json({ error: fallback, code: 'INTERNAL_ERROR' });
};
