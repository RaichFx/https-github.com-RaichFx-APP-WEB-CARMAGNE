import {
  getFirestoreDocument,
  hashSecret,
  setFirestoreDocument,
  verifyFirebaseIdToken,
} from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import type { Worker } from '../../types';

type WorkerWithPasswordMetadata = Worker & {
  passwordUpdatedAt?: number;
  passwordResetBy?: string;
};

const getBearerToken = (authorization: unknown) => {
  const header = Array.isArray(authorization) ? authorization[0] : String(authorization || '');
  return header.replace(/^Bearer\s+/i, '').trim();
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const workerId = String(req.body?.workerId || '').trim().slice(0, 120);
  const newPassword = String(req.body?.newPassword || '').trim().slice(0, 80);
  const requesterIp = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').slice(0, 80);

  if (!checkRateLimit('admin-reset-worker-password:' + requesterIp, 20, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiados restablecimientos. Espera unos minutos.' });
  }
  if (!/^[A-Za-z0-9_-]+$/.test(workerId)) {
    return res.status(400).json({ error: 'Trabajador no válido.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'La contraseña temporal debe tener al menos 8 caracteres.' });
  }

  try {
    const verified = await verifyFirebaseIdToken(getBearerToken(req.headers.authorization));
    const claims = verified.claims || {};
    const isAdmin = claims.admin === true || claims.role === 'admin' || claims.role === 'superadmin';
    if (!isAdmin) {
      return res.status(403).json({ error: 'No tienes permiso para restablecer contraseñas.' });
    }

    const workerDoc = await getFirestoreDocument<WorkerWithPasswordMetadata>('workers/' + workerId);
    if (!workerDoc) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const updatedWorker: WorkerWithPasswordMetadata = {
      ...workerDoc.data,
      id: workerDoc.data.id || workerId,
      pin: '',
      pinHash: hashSecret(newPassword),
      passwordUpdatedAt: Date.now(),
      passwordResetBy: String(claims.adminId || verified.uid || 'admin').slice(0, 128),
    };

    await setFirestoreDocument('workers/' + workerId, updatedWorker as Record<string, any>);
    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('admin-reset-worker-password error', error);
    return res.status(500).json({ error: error?.message || 'No se pudo restablecer la contraseña.' });
  }
}
