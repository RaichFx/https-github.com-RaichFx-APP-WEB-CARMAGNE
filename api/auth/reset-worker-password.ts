import { getFirestoreDocument, hashSecret, setFirestoreDocument } from '../../server/firebaseAdminRest.js';
import { requireAuth, requireRole, sendApiError } from '../../server/auth/verifyToken.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';
import type { Worker } from '../../types';
import { emailRecoveryEnabled, getEmailAuthAccount, hasEmailPassword } from '../../server/auth/emailRecovery.js';

type WorkerWithPassword = Worker & { pinHash?: string; passwordUpdatedAt?: number; firebaseEmailRecovery?: boolean };

const cleanText = (value: unknown, maxLength = 120) => String(value || '').trim().slice(0, maxLength);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  const ip = cleanText(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown', 80).split(',')[0].trim();
  if (!checkRateLimit('admin-password-reset-ip', ip, 20, 15 * 60 * 1000).allowed) {
    writeSecurityAudit({ action: 'worker.password.reset', outcome: 'denied', ip, reason: 'rate_limit' });
    return res.status(429).json({ error: 'Demasiadas solicitudes. Espera unos minutos.', code: 'RATE_LIMITED' });
  }

  try {
    const auth = await requireAuth(req);
    requireRole(auth, ['OWNER', 'ADMIN']);

    const workerId = cleanText(req.body?.workerId, 120);
    const newPassword = cleanText(req.body?.newPassword, 128);
    if (!workerId) {
      writeSecurityAudit({ action: 'worker.password.reset', outcome: 'denied', actorUid: auth.uid, actorRole: auth.role, ip, reason: 'missing_worker_id' });
      return res.status(400).json({ error: 'Selecciona un trabajador.', code: 'WORKER_REQUIRED' });
    }
    if (!/^[A-Za-z0-9_-]+$/.test(workerId)) {
      return res.status(400).json({ error: 'Trabajador no válido.', code: 'INVALID_WORKER' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'La contraseña temporal debe tener al menos 8 caracteres.', code: 'WEAK_PASSWORD' });
    }
    if (!checkRateLimit('admin-password-reset-uid', auth.uid, 20, 15 * 60 * 1000).allowed) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Espera unos minutos.', code: 'RATE_LIMITED' });
    }

    const workerDoc = await getFirestoreDocument<WorkerWithPassword>(`workers/${workerId}`);
    if (!workerDoc) return res.status(404).json({ error: 'Trabajador no encontrado.', code: 'WORKER_NOT_FOUND' });

    if (workerDoc.data.firebaseEmailRecovery || emailRecoveryEnabled(workerId)) {
      const account = await getEmailAuthAccount(workerId);
      if (hasEmailPassword(account)) {
        return res.status(409).json({ error: 'Esta cuenta utiliza recuperación por correo. El trabajador debe usar He olvidado mi contraseña.', code: 'EMAIL_RESET_REQUIRED' });
      }
    }

    await setFirestoreDocument(`workers/${workerId}`, {
      ...workerDoc.data,
      id: workerDoc.data.id || workerId,
      pin: '',
      pinHash: hashSecret(newPassword),
      passwordUpdatedAt: Date.now(),
    });

    writeSecurityAudit({ action: 'worker.password.reset', outcome: 'allowed', actorUid: auth.uid, actorRole: auth.role, targetType: 'worker', targetId: workerId, ip });
    return res.status(200).json({ ok: true });
  } catch (error) {
    writeSecurityAudit({ action: 'worker.password.reset', outcome: 'error', ip, reason: 'request_failed' });
    return sendApiError(res, error, 'No se pudo restablecer la contraseña.');
  }
}
