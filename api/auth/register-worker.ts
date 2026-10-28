import { createHash, randomUUID } from 'crypto';
import {
  hashSecret,
  isSpanishPhone,
  normalizeSpanishPhone,
  queryFirestoreByField,
  queryFirestoreBySpanishPhone,
  createFirestoreDocumentsAtomically,
} from '../../server/firebaseAdminRest.js';
import { requireRole, sendApiError } from '../../server/auth/verifyToken.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';
import { sendTelegramMessage } from '../../server/telegram.js';
import type { Worker } from '../../types';

const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export const validSpanishIdentity = (dni: string): boolean => {
  if (!/^(?:[0-9]{8}|[XYZ][0-9]{7})[A-Z]$/.test(dni)) return false;
  const digits = dni.slice(0, -1).replace(/^[XYZ]/, letter => String('XYZ'.indexOf(letter)));
  return 'TRWAGMYFPDXBNJZSQVHLCKE'[Number(digits) % 23] === dni.slice(-1);
};
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
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const requestedRole = clean(req.body?.role, 40);
  const role = adminContext && validRoles.has(requestedRole) ? requestedRole : 'Operario';
  const active = adminContext ? req.body?.active === true : false;
  const photoUrl = adminContext ? clean(req.body?.photoUrl, 400000) : '';
  const ip = clean(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown', 80).split(',')[0].trim();

  const scope = adminContext ? 'admin-create-worker' : 'register-worker';
  const ipLimit = checkRateLimit(scope, 'ip:' + ip, adminContext ? 30 : 6, 60 * 60 * 1000);
  const phoneLimit = checkRateLimit(scope, 'phone:' + phone, 3, 60 * 60 * 1000);
  if (!ipLimit.allowed || !phoneLimit.allowed) {
    res.setHeader('Retry-After', String(Math.max(ipLimit.retryAfterSeconds, phoneLimit.retryAfterSeconds)));
    writeSecurityAudit({ action: 'auth.worker.register', outcome: 'denied', actorUid: adminContext?.uid, actorRole: adminContext?.role, metadata: { reason: 'rate_limit', source: adminContext ? 'admin' : 'self_registration' } });
    return res.status(429).json({ error: 'Demasiados registros. Espera antes de intentarlo de nuevo.', code: 'RATE_LIMITED' });
  }

  if (name.length < 2 || !dni || (!adminContext && !validSpanishIdentity(dni)) || !isSpanishPhone(phone) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 128 || !password.trim()) {
    return res.status(400).json({ error: 'Revisa nombre, DNI/NIE, teléfono y correo. La contraseña debe tener entre 8 y 128 caracteres.', code: 'INVALID_REGISTRATION' });
  }

  try {
    const [existingPhone, existingEmail, existingDni] = await Promise.all([
      queryFirestoreBySpanishPhone<Worker>('workers', 'phone', phone, 1),
      queryFirestoreByField<Worker>('workers', 'email', email, 1),
      queryFirestoreByField<Worker>('workers', 'dni', dni, 1),
    ]);
    if (existingPhone.length > 0 || existingEmail.length > 0 || existingDni.length > 0) {
      writeSecurityAudit({ action: 'auth.worker.register', outcome: 'denied', actorUid: adminContext?.uid, actorRole: adminContext?.role, metadata: { reason: 'identity_exists', source: adminContext ? 'admin' : 'self_registration' } });
      return res.status(409).json({ error: 'No se pudo completar el registro con esos datos.', code: 'REGISTRATION_CONFLICT' });
    }

    const now = Date.now();
    const workerId = 'W' + randomUUID();
    const worker: Worker = {
      id: workerId,
      name,
      dni,
      phone,
      email,
      pin: '',
      pinHash: hashSecret(password),
      qrCode: 'QR_' + workerId,
      role,
      active,
      registrationStatus: active ? 'approved' : 'pending',
      defaultMode: 'HORAS',
      photoUrl,
      certificates: [],
    };
    // Hash keys avoid putting phone/email/DNI in document paths. These reservations
    // cover all accounts created through this endpoint, across concurrent instances.
    // Historical accounts are checked above; their data is not migrated or changed.
    const identities = [['phone', phone], ['email', email], ['dni', dni]];
    const created = await createFirestoreDocumentsAtomically([
      { path: 'workers/' + workerId, data: worker },
      ...identities.map(([kind, value]) => ({
        path: 'worker_registration_keys/' + createHash('sha256').update(kind + ':' + value).digest('hex'),
        data: { workerId, kind, createdAt: now },
      })),
    ]);
    if (!created) {
      return res.status(409).json({ error: 'No se pudo completar el registro con esos datos.', code: 'REGISTRATION_CONFLICT' });
    }
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
