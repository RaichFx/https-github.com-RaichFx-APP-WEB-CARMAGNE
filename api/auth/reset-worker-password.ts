import { hashSecret, isSpanishPhone, normalizeSpanishPhone, queryFirestoreBySpanishPhone, setFirestoreDocument } from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import type { Worker } from '../../types';

type WorkerWithPassword = Worker & {
  pinHash?: string;
  passwordUpdatedAt?: number;
};

const cleanText = (value: unknown, maxLength = 120) => String(value || '').trim().slice(0, maxLength);
const normalizeDni = (value: unknown) => cleanText(value, 24).toUpperCase().replace(/[^0-9A-Z]/g, '');
const normalizeEmail = (value: unknown) => cleanText(value, 180).toLowerCase();
const publicError = 'No se pudo restablecer la contraseña con esos datos.';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const phone = normalizeSpanishPhone(cleanText(req.body?.phone, 40));
  const dni = normalizeDni(req.body?.dni);
  const email = normalizeEmail(req.body?.email);
  const newPassword = cleanText(req.body?.newPassword, 80);
  const requesterIp = cleanText(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown', 80);

  if (!checkRateLimit(`reset-worker-password:${requesterIp}:${phone || 'unknown'}`, 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
  }

  if (!isSpanishPhone(phone)) {
    return res.status(400).json({ error: 'Introduce un teléfono español válido.' });
  }

  if (!dni || !email) {
    return res.status(400).json({ error: 'Introduce tu DNI y tu email para verificar tu identidad.' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
  }

  try {
    const matches = await queryFirestoreBySpanishPhone<WorkerWithPassword>('workers', 'phone', phone, 1);
    const workerDoc = matches[0];

    if (!workerDoc) {
      return res.status(404).json({ error: publicError });
    }

    const worker = {
      ...workerDoc.data,
      id: workerDoc.data.id || workerDoc.id,
    } as WorkerWithPassword;

    if (worker.active === false) {
      return res.status(403).json({ error: 'Este usuario está desactivado. Habla con el administrador.' });
    }

    const storedDni = normalizeDni(worker.dni);
    const storedEmail = normalizeEmail(worker.email);

    if (!storedDni || !storedEmail || storedDni !== dni || storedEmail !== email) {
      return res.status(401).json({ error: publicError });
    }

    const updatedWorker: WorkerWithPassword = {
      ...worker,
      pin: '',
      pinHash: hashSecret(newPassword),
      passwordUpdatedAt: Date.now(),
    };

    await setFirestoreDocument(`workers/${workerDoc.id}`, updatedWorker as Record<string, any>);

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('reset-worker-password error', error);
    return res.status(500).json({ error: error?.message || 'No se pudo restablecer la contraseña.' });
  }
}
