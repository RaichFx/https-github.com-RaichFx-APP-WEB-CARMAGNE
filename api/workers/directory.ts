import { listFirestoreCollection } from '../../server/firebaseAdminRest.js';
import { requireAuth, requireRole, sendApiError } from '../../server/auth/verifyToken.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';
import type { Worker } from '../../types';

type WorkerDirectoryEntry = Pick<Worker, 'id' | 'name' | 'role' | 'photoUrl'>;

const cleanText = (value: unknown, maxLength = 160) =>
  String(value || '')
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
  return record.photoUrl || record.photoURL || record.photo || record.avatarUrl ||
    record.profilePhotoUrl || record.profileImageUrl || record.imageUrl || '';
};

const toDirectoryEntry = (worker: Worker): WorkerDirectoryEntry => ({
  id: cleanText(worker.id, 120),
  name: cleanText(worker.name, 160),
  role: cleanText(worker.role || 'Operario', 80),
  photoUrl: cleanText(pickWorkerPhotoUrl(worker), 2048),
});

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (!checkRateLimit(`workers-directory:ip:${ip}`, 60, 10 * 60 * 1000)) {
    writeSecurityAudit({ action: 'workers.directory.read', outcome: 'denied', ip, reason: 'rate_limit' });
    return res.status(429).json({ error: 'Demasiadas solicitudes. Espera unos minutos.', code: 'RATE_LIMITED' });
  }

  try {
    const auth = await requireAuth(req);
    requireRole(auth, ['OWNER', 'ADMIN', 'MANAGER', 'WORKER']);
    if (!checkRateLimit(`workers-directory:uid:${auth.uid}`, 120, 10 * 60 * 1000)) {
      writeSecurityAudit({ action: 'workers.directory.read', outcome: 'denied', actorUid: auth.uid, actorRole: auth.role, ip, reason: 'rate_limit' });
      return res.status(429).json({ error: 'Demasiadas solicitudes. Espera unos minutos.', code: 'RATE_LIMITED' });
    }

    const docs = await listFirestoreCollection<Worker>('workers', 500);
    const workers = docs
      .map((doc) => ({ ...doc.data, id: doc.data.id || doc.id }) as Worker)
      .filter((worker) => worker.active !== false)
      .map(toDirectoryEntry)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));

    return res.status(200).json({ workers });
  } catch (error) {
    return sendApiError(res, error, 'No se pudo cargar el directorio.');
  }
}
