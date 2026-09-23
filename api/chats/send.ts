import { listFirestoreCollection, setFirestoreDocument } from '../../server/firebaseAdminRest.js';
import { requireAuth, requireRole, requireWorkerSelf, sendApiError } from '../../server/auth/verifyToken.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';
import type { ChatMessage, Worker } from '../../types';

const cleanText = (value: unknown, maxLength = 1000) => String(value || '').trim().replace(/[\u0000-\u001F\u007F]/g, '').slice(0, maxLength);
const safeMessageId = (value: unknown) => {
  const candidate = cleanText(value, 160);
  return /^[A-Za-z0-9_-]{8,160}$/.test(candidate) ? candidate : `msg_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
};
const getMadridDateParts = (timestamp: number) => {
  const date = new Date(timestamp);
  return {
    dateStr: date.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }),
    timeStr: date.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }),
  };
};
const findActiveWorker = (workers: Worker[], workerId: string) => workers.find((worker) => worker.id === workerId && worker.active !== false);

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow','POST');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const auth = await requireAuth(req);
    if (!checkRateLimit(`chat-send:uid:${auth.uid}`, 120, 10 * 60 * 1000)) {
      return res.status(429).json({ error: 'Demasiados mensajes seguidos. Espera unos minutos.', code: 'RATE_LIMITED' });
    }
    const payload = req.body?.message || req.body || {};
    const senderId = cleanText(payload.senderId,120);
    const receiverId = cleanText(payload.receiverId,120);
    const messageText = cleanText(payload.text,1000);
    if (!messageText) return res.status(400).json({ error: 'El mensaje no puede estar vacío.', code: 'EMPTY_MESSAGE' });
    if (!senderId || !receiverId || senderId === receiverId) return res.status(400).json({ error: 'Origen o destino no válido.', code: 'INVALID_PARTICIPANTS' });

    if (senderId === 'ADMIN') requireRole(auth,['OWNER','ADMIN']);
    else requireWorkerSelf(auth,senderId);

    const workerDocs = await listFirestoreCollection<Worker>('workers',500);
    const workers = workerDocs.map((doc) => ({ ...doc.data, id: doc.data.id || doc.id }) as Worker);
    const senderWorker = senderId === 'ADMIN' ? null : findActiveWorker(workers,senderId);
    const receiverWorker = receiverId === 'ADMIN' ? null : findActiveWorker(workers,receiverId);
    if (senderId !== 'ADMIN' && !senderWorker) return res.status(403).json({ error: 'No tienes permisos para enviar mensajes.', code: 'FORBIDDEN' });
    if (receiverId !== 'ADMIN' && !receiverWorker) return res.status(404).json({ error: 'El destinatario no está disponible.', code: 'RECIPIENT_UNAVAILABLE' });

    const timestamp=Date.now();
    const {dateStr,timeStr}=getMadridDateParts(timestamp);
    const message: ChatMessage = {
      id:safeMessageId(payload.id),
      senderId,
      senderName:senderId==='ADMIN'?'EL JEFE':cleanText(senderWorker?.name,160),
      receiverId,
      receiverName:receiverId==='ADMIN'?'EL JEFE':cleanText(receiverWorker?.name,160),
      text:messageText,
      timestamp,dateStr,timeStr,read:false,
    };
    await setFirestoreDocument(`chats/${message.id}`,message);
    writeSecurityAudit({ action:'chat.message.send', outcome:'allowed', actorUid:auth.uid, actorRole:auth.role, targetType:'chat_recipient', targetId:receiverId });
    return res.status(200).json({ok:true,message});
  } catch (error) {
    return sendApiError(res,error,'No se pudo enviar el mensaje.');
  }
}
