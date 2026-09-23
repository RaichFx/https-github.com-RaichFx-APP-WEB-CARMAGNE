import {
  hashSecret,
  isSpanishPhone,
  normalizeSpanishPhone,
  queryFirestoreByField,
  queryFirestoreBySpanishPhone,
  setFirestoreDocument,
} from '../../server/firebaseAdminRest.js';
import { requireRole, sendApiError } from '../../server/auth/verifyToken.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';
import { sendTelegramMessage } from '../../server/telegram.js';
import type { Worker } from '../../types';

const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max);
const validRoles = new Set(['Operario', 'Electricista', 'Encargado', 'Supervisor']);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  // A bearer token turns this into an administrator-created account.  Without
  // one, it remains a pending self-registration and can never self-activate.
  let adminContext: Awaited<ReturnType<typeof requireRole>> | null = null;
  if (req.headers?.authorization) {
    try {
      adminContext = await requireRole(req, ['OWNER', 'ADMIN']);
    } catch (error) {
      return sendApiError(res, error);
    }
  }

  const name = clean(req.body?.name, 160);
  const dni = clean(req.body?.dni, 24).toUpperCase().replace(/[^0-9A-Z]/g, '');
  const phone = normalizeSpanishPhone(clean(req.body?.phone, 40));
  const email = clean(req.body?.email, 180).toLowerCase();
  const password = String(req.body?.password || '').slice(0, 128);
  const requestedRole = clean(req.body?.role, 40);
  const role = adminContext && validRoles.has(requestedRole) ? requestedRole : 'Operario';
  const active = adminContext ? Boolean(req.body?.active) : false;
  const photoUrl = adminContext ? clean(req.body?.photoUrl, 400000) : '';
  const ip = clean(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown', 80).split(',')[0].trim();

  const scope = adminContext ? 'admin-create-worker' : 'register-worker';
  if (!checkRateLimit(scope + ':ip:' + ip, adminContext ? 30 : 6, 60 * 60 * 1000) ||
      !checkRateLimit(scope + ':phone:' + phone, 3, 60 * 60 * 1000)) {
    writeSecurityAudit({ action: 'auth.worker.register', outcome: 'denied', actorUid: adminContext?.uid, actorRole: adminContext?.role, metadata: { reason: 'rate_limit', source: adminContext ? 'admin' : 'self_registration' } });
    return res.status(429).json({ error: 'Demasiados registros. Espera antes de intentarlo de nuevo.', code: 'RATE_LIMITED' });
  }

  if (!name || !dni || !isSpanishPhone(phone) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    return res.status(400).json({ error: 'Revisa los datos. La contraseña debe tener al menos 8 caracteres.', code: 'INVALID_REGISTRATION' });
  }

  try {
    const [existingPhone, existingEmail] = await Promise.all([
      queryFirestoreBySpanishPhone<Worker>('workers', 'phone', phone, 1),
      queryFirestoreByField<Worker>('workers', 'email', email, 1),
    ]);
    if (existingPhone.length > 0 || existingEmail.length > 0) {
      writeSecurityAudit({ action: 'auth.worker.register', outcome: 'denied', actorUid: adminContext?.uid, actorRole: adminContext?.role, metadata: { reason: 'identity_exists', source: adminContext ? 'admin' : 'self_registration' } });
      return res.status(409).json({ error: 'No se pudo completar el registro con esos datos.', code: 'REGISTRATION_CONFLICT' });
    }

    const now = Date.now();
    const workerId = 'W' + now;
    const worker: Worker = {
      id: workerId,
      name,
      dni,
      phone,
      email,
      pin: '',
      pinHash: hashSecret(password),
      qrCode: 'QR_' + now,
      role,
      active,
      registrationStatus: active ? 'approved' : 'pending',
      defaultMode: 'HORAS',
      photoUrl,
      certificates: [],
    };
    await setFirestoreDocument('workers/' + workerId, worker);
    await sendTelegramMessage(
      '👷 ' + (adminContext ? 'Operario creado' : 'Nueva solicitud de trabajador') + '\nNombre: ' + name,
      { botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID }
    ).catch(() => undefined);
    writeSecurityAudit({ action: 'auth.worker.register', outcome: 'allowed', actorUid: adminContext?.uid, actorRole: adminContext?.role, targetId: workerId, metadata: { source: adminContext ? 'admin' : 'self_registration' } });
    return res.status(201).json({
      ok: true,
      worker: { ...worker, pin: '', pinHash: '' },
      message: adminContext ? 'Operario creado correctamente.' : 'Registro recibido. Un administrador debe aprobar la cuenta antes de poder entrar.'
    });
  } catch (error) {
    console.error('Error interno en register-worker:', error);
    return res.status(500).json({ error: 'No se pudo registrar el trabajador.', code: 'INTERNAL_ERROR' });
  }
}
