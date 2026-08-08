import {
  hashSecret,
  isSpanishPhone,
  normalizeSpanishPhone,
  queryFirestoreByField,
  setFirestoreDocument,
} from '../../server/firebaseAdminRest';
import { checkRateLimit } from '../../server/rateLimit';
import type { Worker } from '../../types';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const name = String(req.body?.name || '').trim();
  const dni = String(req.body?.dni || '').trim();
  const phone = normalizeSpanishPhone(String(req.body?.phone || ''));
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const rateKey = `register-worker:${req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'}:${phone}`;

  if (!checkRateLimit(rateKey, 3, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiados registros. Espera antes de intentarlo de nuevo.' });
  }

  if (!name || !dni || !isSpanishPhone(phone) || !/\S+@\S+\.\S+/.test(email) || password.length < 4) {
    return res.status(400).json({ error: 'Datos de registro no validos.' });
  }

  try {
    const existingPhone = await queryFirestoreByField<Worker>('workers', 'phone', phone, 1);
    if (existingPhone.length > 0) {
      return res.status(409).json({ error: 'Este telefono ya esta registrado.' });
    }

    const existingEmail = await queryFirestoreByField<Worker>('workers', 'email', email, 1);
    if (existingEmail.length > 0) {
      return res.status(409).json({ error: 'Este correo ya esta registrado.' });
    }

    const now = Date.now();
    const workerId = `W${now}`;
    const worker: Worker = {
      id: workerId,
      name,
      dni,
      phone,
      email,
      pin: '',
      pinHash: hashSecret(password),
      qrCode: `QR_${now}`,
      active: false,
      defaultMode: 'HORAS',
      certificates: [],
    };

    await setFirestoreDocument(`workers/${workerId}`, worker);

    return res.status(201).json({
      ok: true,
      workerId,
      message: 'Registro recibido. Un administrador debe aprobar la cuenta antes de poder entrar.',
    });
  } catch (error: any) {
    console.error('Error en register-worker:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo registrar el trabajador.' });
  }
}
