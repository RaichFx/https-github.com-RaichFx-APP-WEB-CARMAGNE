import {
  deleteFirestoreDocument,
  listFirestoreCollection,
  verifyFirebaseIdToken,
} from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';

type StoredChatMessage = {
  id?: string;
  timestamp?: number;
};

const CHAT_CLEANUP_DAY = 5;

const getBearerToken = (authorization: unknown) => {
  const header = Array.isArray(authorization) ? authorization[0] : String(authorization || '');
  return header.replace(/^Bearer\s+/i, '').trim();
};

const getMonthlyCutoffTimestamp = (now = new Date()) => {
  if (now.getDate() < CHAT_CLEANUP_DAY) return null;
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  try {
    const verified = await verifyFirebaseIdToken(getBearerToken(req.headers.authorization));
    const actorKey = verified.uid || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

    if (!checkRateLimit(`chat-cleanup:${actorKey}`, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'Limpieza ya solicitada recientemente. Inténtalo más tarde.' });
    }

    const cutoffTimestamp = getMonthlyCutoffTimestamp();
    if (!cutoffTimestamp) {
      return res.status(200).json({
        ok: true,
        deleted: 0,
        skipped: 'La limpieza mensual se ejecuta a partir del día 5.',
      });
    }

    const chatDocs = await listFirestoreCollection<StoredChatMessage>('chats', 500);
    const expiredDocs = chatDocs.filter((chatDoc) => {
      const timestamp = Number(chatDoc.data?.timestamp || 0);
      return timestamp > 0 && timestamp < cutoffTimestamp;
    });

    for (const chatDoc of expiredDocs) {
      await deleteFirestoreDocument(`chats/${chatDoc.id}`);
    }

    return res.status(200).json({
      ok: true,
      deleted: expiredDocs.length,
      cutoffTimestamp,
    });
  } catch (error: any) {
    console.error('Error limpiando mensajes antiguos:', error);
    return res.status(500).json({ error: error?.message || 'No se pudieron limpiar los mensajes antiguos.' });
  }
}
