import { deleteFirestoreDocument, listFirestoreCollection } from '../../server/firebaseAdminRest.js';
import { requireAuth, requireRole, sendApiError } from '../../server/auth/verifyToken.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';

type StoredChatMessage = { id?: string; timestamp?: number };
const CHAT_CLEANUP_DAY = 5;
const getMonthlyCutoffTimestamp = (now = new Date()) => now.getDate() < CHAT_CLEANUP_DAY ? null : new Date(now.getFullYear(), now.getMonth(), 1).getTime();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  try {
    const auth = await requireAuth(req);
    requireRole(auth, ['OWNER','ADMIN']);
    if (!checkRateLimit(`chat-cleanup:uid:${auth.uid}`, 3, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'Limpieza ya solicitada recientemente.', code: 'RATE_LIMITED' });
    }

    const cutoffTimestamp = getMonthlyCutoffTimestamp();
    if (!cutoffTimestamp) return res.status(200).json({ ok: true, deleted: 0, skipped: 'La limpieza mensual se ejecuta a partir del día 5.' });

    const chatDocs = await listFirestoreCollection<StoredChatMessage>('chats', 500);
    const expiredDocs = chatDocs.filter((doc) => {
      const timestamp = Number(doc.data?.timestamp || 0);
      return timestamp > 0 && timestamp < cutoffTimestamp;
    });
    for (const chatDoc of expiredDocs) await deleteFirestoreDocument(`chats/${chatDoc.id}`);

    writeSecurityAudit({ action: 'chat.monthly_cleanup', outcome: 'allowed', actorUid: auth.uid, actorRole: auth.role, ip, reason: `deleted:${expiredDocs.length}` });
    return res.status(200).json({ ok: true, deleted: expiredDocs.length, cutoffTimestamp, hasMore: chatDocs.length === 500 });
  } catch (error) {
    return sendApiError(res, error, 'No se pudieron limpiar los mensajes antiguos.');
  }
}
