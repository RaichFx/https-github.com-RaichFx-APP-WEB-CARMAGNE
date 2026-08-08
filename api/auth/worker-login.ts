import {
  createFirebaseCustomToken,
  isSpanishPhone,
  normalizeSpanishPhone,
  queryFirestoreByField,
  verifySecret,
} from '../../server/firebaseAdminRest';
import { checkRateLimit } from '../../server/rateLimit';
import type { Worker } from '../../types';

const publicWorker = (worker: Worker) => {
  const { pin, pinHash, ...safeWorker } = worker as Worker & { pinHash?: string };
  return safeWorker;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const phone = normalizeSpanishPhone(String(req.body?.phone || ''));
  const password = String(req.body?.password || '');
  const rateKey = `worker-login:${req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'}:${phone}`;

  if (!checkRateLimit(rateKey, 8, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  }

  if (!isSpanishPhone(phone) || !password) {
    return res.status(400).json({ error: 'Telefono o contraseña no validos.' });
  }

  try {
    const matches = await queryFirestoreByField<Worker>('workers', 'phone', phone, 1);
    const workerDoc = matches[0];

    if (!workerDoc) {
      return res.status(404).json({ error: 'Trabajador no registrado.' });
    }

    const worker = { ...workerDoc.data, id: workerDoc.data.id || workerDoc.id } as Worker;
    if (!worker.active) {
      return res.status(403).json({ error: 'Cuenta pendiente de aprobacion o desactivada.' });
    }

    if (!verifySecret(password, worker.pinHash, worker.pin || '0000')) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    const token = createFirebaseCustomToken(worker.id, {
      role: 'worker',
      workerId: worker.id,
    });

    return res.status(200).json({
      token,
      worker: publicWorker(worker),
    });
  } catch (error: any) {
    console.error('Error en worker-login:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo iniciar sesion.' });
  }
}
