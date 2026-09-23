import { getFirestoreDocument, hashSecret, queryFirestoreByField, setFirestoreDocument, verifySecret } from '../../server/firebaseAdminRest.js';
import { requireAuth, requireRole, sendApiError } from '../../server/auth/verifyToken.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';
import type { Worker } from '../../types';

type WorkerWithPassword = Worker & { pinHash?: string; passwordUpdatedAt?: number };
const cleanText = (value: unknown, maxLength = 128) => String(value || '').trim().slice(0, maxLength);

const findWorkerDocument = async (workerId: string) => {
  const directDoc = await getFirestoreDocument<WorkerWithPassword>(`workers/${workerId}`);
  if (directDoc) return directDoc;
  const matches = await queryFirestoreByField<WorkerWithPassword>('workers', 'id', workerId, 1);
  return matches[0] || null;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  const ip = cleanText(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown', 80).split(',')[0].trim();
  if (!checkRateLimit(`change-worker-password:ip:${ip}`, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.', code: 'RATE_LIMITED' });
  }

  try {
    const auth = await requireAuth(req);
    requireRole(auth, ['WORKER']);
    const workerId = auth.workerId;
    if (!workerId) return res.status(403).json({ error: 'No tienes permisos para esta acción.', code: 'FORBIDDEN' });

    const currentPassword = cleanText(req.body?.currentPassword);
    const newPassword = cleanText(req.body?.newPassword);
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Introduce la contraseña actual y la nueva.', code: 'PASSWORDS_REQUIRED' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.', code: 'WEAK_PASSWORD' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual.', code: 'PASSWORD_REUSED' });
    }

    const workerDoc = await findWorkerDocument(workerId);
    const worker = workerDoc ? ({ ...workerDoc.data, id: workerDoc.data.id || workerDoc.id } as WorkerWithPassword) : null;
    if (!worker || !verifySecret(currentPassword, worker.pinHash, worker.pin)) {
      writeSecurityAudit({ action: 'worker.password.change', outcome: 'denied', actorUid: auth.uid, actorRole: auth.role, targetType: 'worker', targetId: workerId, ip, reason: 'invalid_current_password' });
      return res.status(401).json({ error: 'La contraseña actual no es correcta.', code: 'INVALID_CURRENT_PASSWORD' });
    }

    await setFirestoreDocument(`workers/${workerDoc!.id}`, {
      ...worker,
      pin: '',
      pinHash: hashSecret(newPassword),
      passwordUpdatedAt: Date.now(),
    });

    writeSecurityAudit({ action: 'worker.password.change', outcome: 'allowed', actorUid: auth.uid, actorRole: auth.role, targetType: 'worker', targetId: workerId, ip });
    return res.status(200).json({ ok: true });
  } catch (error) {
    return sendApiError(res, error, 'No se pudo cambiar la contraseña.');
  }
}
