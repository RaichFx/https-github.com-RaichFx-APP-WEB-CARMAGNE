import { getFirestoreDocument, hashSecret, queryFirestoreByField, setFirestoreDocument, verifyFirebaseIdToken, verifySecret } from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import type { Worker } from '../../types';

type WorkerWithPassword = Worker & {
  pinHash?: string;
  passwordUpdatedAt?: number;
};

const cleanText = (value: unknown, maxLength = 120) => String(value || '').trim().slice(0, maxLength);
const getBearerToken = (req: any) => {
  const authorization = String(req.headers?.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
};

const findWorkerDocument = async (workerId: string) => {
  const directDoc = await getFirestoreDocument<WorkerWithPassword>(`workers/${workerId}`);
  if (directDoc) return directDoc;

  const matches = await queryFirestoreByField<WorkerWithPassword>('workers', 'id', workerId, 1);
  return matches[0] || null;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  const requesterIp = cleanText(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown', 80);
  if (!checkRateLimit(`change-worker-password:${requesterIp}`, 10, 15 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
  }

  const currentPassword = cleanText(req.body?.currentPassword, 80);
  const newPassword = cleanText(req.body?.newPassword, 80);

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Introduce la contraseña actual y la nueva.' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser diferente a la actual.' });
  }

  try {
    const session = await verifyFirebaseIdToken(getBearerToken(req));
    const role = String(session.claims?.role || '');
    const workerId = String(session.claims?.workerId || session.uid || '').trim();

    if (role !== 'worker' || !workerId) {
      return res.status(403).json({ error: 'No tienes permiso para cambiar esta contraseña.' });
    }

    const workerDoc = await findWorkerDocument(workerId);
    if (!workerDoc) {
      return res.status(404).json({ error: 'Trabajador no encontrado.' });
    }

    const worker = {
      ...workerDoc.data,
      id: workerDoc.data.id || workerDoc.id,
    } as WorkerWithPassword;

    if (!verifySecret(currentPassword, worker.pinHash, worker.pin || '0000')) {
      return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
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
    console.error('change-worker-password error', error);
    return res.status(500).json({ error: error?.message || 'No se pudo cambiar la contraseña.' });
  }
}
