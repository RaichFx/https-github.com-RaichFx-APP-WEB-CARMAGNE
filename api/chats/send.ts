import {
  listFirestoreCollection,
  setFirestoreDocument,
  verifyFirebaseIdToken,
} from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import type { ChatMessage, Worker } from '../../types';

const cleanText = (value: unknown, maxLength = 1000) =>
  String(value || '')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, maxLength);

const getBearerToken = (authorization: unknown) => {
  const header = Array.isArray(authorization) ? authorization[0] : String(authorization || '');
  return header.replace(/^Bearer\s+/i, '').trim();
};

const safeMessageId = (value: unknown) => {
  const candidate = cleanText(value, 160);
  if (/^[A-Za-z0-9_-]{8,160}$/.test(candidate)) return candidate;
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const getMadridDateParts = (timestamp: number) => {
  const date = new Date(timestamp);
  return {
    dateStr: date.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }),
    timeStr: date.toLocaleTimeString('es-ES', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
};

const findActiveWorker = (workers: Worker[], workerId: string) =>
  workers.find((worker) => worker.id === workerId && worker.active !== false);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  try {
    const verified = await verifyFirebaseIdToken(getBearerToken(req.headers.authorization));
    const claims = verified.claims || {};
    const actorKey = verified.uid || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

    if (!checkRateLimit(`chat-send:${actorKey}`, 120, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Demasiados mensajes seguidos. Espera unos minutos.' });
    }

    const payload = req.body?.message || req.body || {};
    const senderId = cleanText(payload.senderId, 120);
    const receiverId = cleanText(payload.receiverId, 120);
    const text = cleanText(payload.text, 1000);
    const isAdmin = claims.admin === true || claims.role === 'admin';
    const isWorkerSender = claims.role === 'worker' && claims.workerId === senderId;

    if (!text) {
      return res.status(400).json({ error: 'El mensaje no puede estar vacio.' });
    }

    if (!senderId || !receiverId || senderId === receiverId) {
      return res.status(400).json({ error: 'Origen o destino de chat no valido.' });
    }

    if (senderId === 'ADMIN') {
      if (!isAdmin) {
        return res.status(403).json({ error: 'Solo un admin puede enviar mensajes como jefe.' });
      }
    } else if (!isWorkerSender) {
      return res.status(403).json({ error: 'No puedes enviar mensajes como otro trabajador.' });
    }

    const workerDocs = await listFirestoreCollection<Worker>('workers', 500);
    const workers = workerDocs.map((doc) => ({ ...doc.data, id: doc.data.id || doc.id }) as Worker);
    const senderWorker = senderId === 'ADMIN' ? null : findActiveWorker(workers, senderId);
    const receiverWorker = receiverId === 'ADMIN' ? null : findActiveWorker(workers, receiverId);

    if (senderId !== 'ADMIN' && !senderWorker) {
      return res.status(403).json({ error: 'Tu trabajador no esta activo.' });
    }

    if (receiverId !== 'ADMIN' && !receiverWorker) {
      return res.status(404).json({ error: 'El compañero no esta disponible.' });
    }

    const timestamp = Date.now();
    const { dateStr, timeStr } = getMadridDateParts(timestamp);
    const message: ChatMessage = {
      id: safeMessageId(payload.id),
      senderId,
      senderName: senderId === 'ADMIN' ? 'EL JEFE' : cleanText(senderWorker?.name || payload.senderName, 160),
      receiverId,
      receiverName: receiverId === 'ADMIN' ? 'EL JEFE' : cleanText(receiverWorker?.name || payload.receiverName, 160),
      text,
      timestamp,
      dateStr,
      timeStr,
      read: false,
    };

    await setFirestoreDocument(`chats/${message.id}`, message);

    return res.status(200).json({ ok: true, message });
  } catch (error: any) {
    console.error('Error enviando mensaje de chat:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo enviar el mensaje.' });
  }
}
