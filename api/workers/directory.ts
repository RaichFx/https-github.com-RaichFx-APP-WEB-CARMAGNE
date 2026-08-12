import { listFirestoreCollection, verifyFirebaseIdToken } from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import type { Worker } from '../../types';

const repairTextEncoding = (value: string) =>
  value
    .replace(/\u00c3\u00a1/g, 'á').replace(/\u00c3\u00a9/g, 'é').replace(/\u00c3\u00ad/g, 'í').replace(/\u00c3\u00b3/g, 'ó').replace(/\u00c3\u00ba/g, 'ú')
    .replace(/\u00c3\u0081/g, 'Á').replace(/\u00c3\u0089/g, 'É').replace(/\u00c3\u008d/g, 'Í').replace(/\u00c3\u0093/g, 'Ó').replace(/\u00c3\u009a/g, 'Ú')
    .replace(/\u00c3\u00b1/g, 'ñ').replace(/\u00c3\u0091/g, 'Ñ')
    .replace(/\u00c2\u00bf/g, '¿').replace(/\u00c2\u00a1/g, '¡')
    .replace(/\u00e2\u20ac\u00a2/g, '')
    .replace(/\uFFFD/g, '');

const cleanText = (value: unknown, maxLength = 160) =>
  repairTextEncoding(String(value || ''))
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, maxLength);

const pickWorkerPhotoUrl = (worker: Worker) => {
  const record = worker as Worker & {
    photoURL?: string;
    photo?: string;
    avatarUrl?: string;
    profilePhotoUrl?: string;
    profileImageUrl?: string;
    imageUrl?: string;
  };

  return record.photoUrl ||
    record.photoURL ||
    record.photo ||
    record.avatarUrl ||
    record.profilePhotoUrl ||
    record.profileImageUrl ||
    record.imageUrl ||
    '';
};

const getBearerToken = (authorization: unknown) => {
  const header = Array.isArray(authorization) ? authorization[0] : String(authorization || '');
  return header.replace(/^Bearer\s+/i, '').trim();
};

const publicWorker = (worker: Worker): Worker => ({
  id: cleanText(worker.id, 120),
  name: cleanText(worker.name, 160),
  qrCode: cleanText(worker.qrCode, 120),
  active: worker.active !== false,
  pin: '',
  pinHash: '',
  dni: cleanText(worker.dni, 80),
  role: cleanText(worker.role || 'Operario', 80),
  phone: cleanText(worker.phone, 40),
  email: cleanText(worker.email, 160).toLowerCase(),
  defaultMode: worker.defaultMode,
  photoUrl: cleanText(pickWorkerPhotoUrl(worker), 250000),
  certificates: [],
});

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(`workers-directory:${ip}`, 80, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiadas consultas de directorio. Espera unos minutos.' });
  }

  try {
    const verified = await verifyFirebaseIdToken(getBearerToken(req.headers.authorization));
    const claims = verified.claims || {};
    const isWorker = claims.role === 'worker' && Boolean(claims.workerId);
    const isAdmin = claims.admin === true || claims.role === 'admin';

    if (!isWorker && !isAdmin) {
      return res.status(403).json({ error: 'No tienes permiso para ver el directorio.' });
    }

    const docs = await listFirestoreCollection<Worker>('workers', 500);
    const workers = docs
      .map((doc) => ({ ...doc.data, id: doc.data.id || doc.id }) as Worker)
      .filter((worker) => worker.active !== false)
      .map(publicWorker)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    return res.status(200).json({ workers });
  } catch (error: any) {
    console.error('Error cargando directorio de operarios:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo cargar el directorio.' });
  }
}
