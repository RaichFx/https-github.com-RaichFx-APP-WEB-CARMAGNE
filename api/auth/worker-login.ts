import {
  createFirebaseCustomToken,
  hashSecret,
  isSpanishPhone,
  normalizeSpanishPhone,
  queryFirestoreBySpanishPhone,
  setFirestoreDocument,
  verifySecret,
} from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';
import type { Worker } from '../../types';
import { emailRecoveryEnabled, getEmailAuthAccount, hasEmailPassword, verifyEmailPassword } from '../../server/auth/emailRecovery.js';

const publicWorker = (worker: Worker) => {
  const { pin, pinHash, ...safeWorker } = worker as Worker & { pinHash?: string };
  return safeWorker;
};

const loginError = { error: 'No se pudo iniciar sesión.', code: 'INVALID_CREDENTIALS' };

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  const phone = normalizeSpanishPhone(String(req.body?.phone || ''));
  const password = String(req.body?.password || '').slice(0, 128);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rateKey = 'worker-login:' + ip + ':' + phone;

  if (!checkRateLimit('worker-login', rateKey, 8, 10 * 60 * 1000).allowed) {
    writeSecurityAudit({ action: 'auth.worker.login', outcome: 'denied', ip, reason: 'rate_limit' });
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.', code: 'RATE_LIMITED' });
  }

  if (!isSpanishPhone(phone) || !password) {
    writeSecurityAudit({ action: 'auth.worker.login', outcome: 'denied', ip, reason: 'invalid_credentials' });
    return res.status(401).json(loginError);
  }

  try {
    const matches = await queryFirestoreBySpanishPhone<Worker>('workers', 'phone', phone, 1);
    const workerDoc = matches[0];
    let worker = workerDoc
      ? ({ ...workerDoc.data, id: workerDoc.data.id || workerDoc.id } as Worker)
      : null;

    const emailAccount = worker && ((worker as Worker & { firebaseEmailRecovery?: boolean }).firebaseEmailRecovery || emailRecoveryEnabled(worker.id))
      ? await getEmailAuthAccount(worker.id) : null;
    const firebasePassword = hasEmailPassword(emailAccount);
    const validPassword = worker && !emailAccount?.disabled
      ? firebasePassword
        ? !!(await verifyEmailPassword(worker.id, emailAccount!.email!, password))
        : verifySecret(password, worker.pinHash, worker.pin)
      : false;

    if (!worker || worker.active === false || !validPassword) {
      writeSecurityAudit({ action: 'auth.worker.login', outcome: 'denied', ip, reason: 'invalid_credentials' });
      return res.status(401).json(loginError);
    }

    // Existing accounts are upgraded on their next successful login, so no
    // forced reset or data loss is needed to remove legacy clear-text PINs.
    if (!firebasePassword && !worker.pinHash?.startsWith('pbkdf2_sha256$') && worker.pin) {
      const pinHash = hashSecret(password);
      worker = { ...worker, pin: '', pinHash };
      try {
        await setFirestoreDocument('workers/' + worker.id, worker as any);
        writeSecurityAudit({ action: 'auth.worker.password_migrated', outcome: 'allowed', actorUid: worker.id, actorRole: 'WORKER', targetId: worker.id });
      } catch (migrationError) {
        console.warn('No se pudo migrar una credencial antigua:', migrationError);
      }
    }

    const token = createFirebaseCustomToken(worker.id, { role: 'worker', workerId: worker.id });
    writeSecurityAudit({ action: 'auth.worker.login', outcome: 'allowed', actorUid: worker.id, actorRole: 'WORKER', ip });
    return res.status(200).json({ token, worker: publicWorker(worker) });
  } catch (error) {
    console.error('Error interno en worker-login:', error);
    return res.status(500).json({ error: 'No se pudo iniciar sesión.', code: 'INTERNAL_ERROR' });
  }
}
