import { getFirestoreDocument, patchFirestoreDocument } from './firebaseAdminRest.js';
import { requireAuth, requireRole, sendApiError, ApiError } from './auth/verifyToken.js';
import { checkRateLimit } from './rateLimit.js';
import type { Worker } from '../types';

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  try {
    const context = await requireAuth(req);
    requireRole(context, ['OWNER', 'ADMIN']);
    const limit = checkRateLimit('worker-approval', context.uid, 120, 600000);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw new ApiError(429, 'RATE_LIMITED', 'Espera antes de aprobar más solicitudes.');
    }
    const workerId = req.body?.workerId;
    if (typeof workerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(workerId))
      throw new ApiError(400, 'INVALID_WORKER', 'Trabajador no válido.');
    const existing = await getFirestoreDocument<Worker>('workers/' + workerId);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'La solicitud ya no existe.');
    if (existing.data.registrationStatus !== 'pending')
      throw new ApiError(409, 'NOT_PENDING', 'La cuenta ya no está pendiente. Recarga las solicitudes.');
    await patchFirestoreDocument('workers/' + workerId, { active: true, registrationStatus: 'approved' }, existing.updateTime!);
    return res.status(200).json({ ok: true, workerId, active: true, registrationStatus: 'approved' });
  } catch (error) {
    return sendApiError(res, error, 'No se pudo aprobar al trabajador.');
  }
}
