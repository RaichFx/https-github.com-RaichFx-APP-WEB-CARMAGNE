import { createHash } from 'crypto';
import { setFirestoreDocument, verifyFirebaseIdToken } from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';

type PushOwnerType = 'worker' | 'admin';

const cleanText = (value: unknown, maxLength = 160) =>
  String(value || '')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, maxLength);

const getBearerToken = (authorization: unknown) => {
  const header = Array.isArray(authorization) ? authorization[0] : String(authorization || '');
  return header.replace(/^Bearer\s+/i, '').trim();
};

const getTokenId = (token: string) => createHash('sha256').update(token).digest('hex');

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const token = cleanText(req.body?.token, 4000);
  const ownerType = cleanText(req.body?.ownerType, 20) as PushOwnerType;
  const ownerId = cleanText(req.body?.ownerId, 120);
  const ownerName = cleanText(req.body?.ownerName, 160);
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  if (!checkRateLimit(`push-register:${ip}`, 20, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiados registros de notificaciones. Espera unos minutos.' });
  }

  if (!token || !ownerId || !['worker', 'admin'].includes(ownerType)) {
    return res.status(400).json({ error: 'Datos de notificaciones no validos.' });
  }

  try {
    const verified = await verifyFirebaseIdToken(getBearerToken(req.headers.authorization));
    const claims = verified.claims || {};
    const isAdmin = claims.admin === true || claims.role === 'admin';
    const isSameWorker = claims.role === 'worker' && claims.workerId === ownerId;

    if ((ownerType === 'worker' && !isSameWorker) || (ownerType === 'admin' && !isAdmin)) {
      return res.status(403).json({ error: 'No tienes permiso para registrar este dispositivo.' });
    }

    const id = getTokenId(token);
    const now = Date.now();

    await setFirestoreDocument(`push_subscriptions/${id}`, {
      id,
      token,
      ownerType,
      ownerId,
      ownerName: ownerName || (ownerType === 'admin' ? 'Admin' : 'Operario'),
      active: true,
      updatedAt: now,
      createdAt: now,
      authUid: verified.uid,
      userAgent: cleanText(req.headers['user-agent'], 300),
    });

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('Error registrando push:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo registrar el dispositivo.' });
  }
}
