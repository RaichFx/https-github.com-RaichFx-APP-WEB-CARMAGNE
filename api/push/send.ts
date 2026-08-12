import {
  getGoogleAccessToken,
  getServiceAccount,
  listFirestoreCollection,
  setFirestoreDocument,
  verifyFirebaseIdToken,
} from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';

type PushEventType = 'chat_message' | 'worker_log' | 'worker_certificate' | 'payslip_sent';
type PushSubscriptionDoc = {
  id: string;
  token: string;
  ownerType: 'worker' | 'admin';
  ownerId: string;
  ownerName?: string;
  active?: boolean;
  updatedAt?: number;
  createdAt?: number;
  authUid?: string;
  userAgent?: string;
};

type PushTarget = {
  ownerType: 'worker' | 'admin';
  ownerId?: string;
};

type PushMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
  target: PushTarget;
};

const cleanText = (value: unknown, maxLength = 260) =>
  String(value || '')
    .trim()
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, maxLength);

const getBearerToken = (authorization: unknown) => {
  const header = Array.isArray(authorization) ? authorization[0] : String(authorization || '');
  return header.replace(/^Bearer\s+/i, '').trim();
};

const normalizeLogType = (type: string) => {
  const map: Record<string, string> = {
    ENTRADA: 'entrada',
    SALIDA: 'salida',
    INICIO_DESCANSO: 'inicio de descanso',
    FIN_DESCANSO: 'fin de descanso',
  };
  return map[type] || type.toLowerCase();
};

const buildPushMessage = (
  eventType: PushEventType,
  payload: Record<string, any>,
  claims: Record<string, any>
): PushMessage => {
  if (eventType === 'chat_message') {
    const senderId = cleanText(payload.senderId, 120);
    const senderName = cleanText(payload.senderName, 120) || 'CARMAGNE';
    const receiverId = cleanText(payload.receiverId, 120);
    const text = cleanText(payload.text, 180);
    const isAdmin = claims.admin === true || claims.role === 'admin';

    if (senderId === 'ADMIN') {
      if (!isAdmin) throw new Error('Solo un admin puede enviar avisos como jefe.');
    } else if (claims.role !== 'worker' || claims.workerId !== senderId) {
      throw new Error('No puedes enviar avisos de otro trabajador.');
    }

    if (!receiverId) throw new Error('Destino de chat no valido.');

    return {
      title: senderId === 'ADMIN' ? 'Mensaje del jefe' : `Mensaje de ${senderName}`,
      body: text || 'Tienes un nuevo mensaje.',
      url: '/',
      tag: `chat-${senderId}-${receiverId}`,
      target: receiverId === 'ADMIN' ? { ownerType: 'admin' } : { ownerType: 'worker', ownerId: receiverId },
    };
  }

  if (eventType === 'worker_log') {
    const workerId = cleanText(payload.workerId, 120);
    const workerName = cleanText(payload.workerName, 120) || 'Un trabajador';
    const logType = cleanText(payload.logType, 50);
    const siteName = cleanText(payload.siteName, 120) || 'obra no indicada';
    const timeStr = cleanText(payload.timeStr, 30);

    if (claims.role !== 'worker' || claims.workerId !== workerId) {
      throw new Error('No puedes enviar fichajes de otro trabajador.');
    }

    return {
      title: `Fichaje: ${normalizeLogType(logType)}`,
      body: `${workerName} ha marcado ${normalizeLogType(logType)} en ${siteName}${timeStr ? ` a las ${timeStr}` : ''}.`,
      url: '/',
      tag: `log-${workerId}-${logType}`,
      target: { ownerType: 'admin' },
    };
  }

  if (eventType === 'worker_certificate') {
    const workerId = cleanText(payload.workerId, 120);
    const workerName = cleanText(payload.workerName, 120) || 'Un trabajador';
    const certificateName = cleanText(payload.certificateName, 120) || 'certificado';

    if (claims.role !== 'worker' || claims.workerId !== workerId) {
      throw new Error('No puedes avisar certificados de otro trabajador.');
    }

    return {
      title: 'Certificado subido',
      body: `${workerName} ha subido: ${certificateName}.`,
      url: '/',
      tag: `certificate-${workerId}`,
      target: { ownerType: 'admin' },
    };
  }

  if (eventType === 'payslip_sent') {
    const workerId = cleanText(payload.workerId, 120);
    const workerName = cleanText(payload.workerName, 120) || 'operario';
    const monthStr = cleanText(payload.monthStr, 40);
    const isAdmin = claims.admin === true || claims.role === 'admin';

    if (!isAdmin) {
      throw new Error('Solo un admin puede avisar de nominas.');
    }

    return {
      title: 'Nueva nómina disponible',
      body: `${workerName}, tienes una nómina${monthStr ? ` de ${monthStr}` : ''} lista para revisar.`,
      url: '/',
      tag: `payslip-${workerId}-${monthStr}`,
      target: { ownerType: 'worker', ownerId: workerId },
    };
  }

  throw new Error('Tipo de notificación no soportado.');
};

const getSubscriptionsForTarget = async (target: PushTarget) => {
  const allDocs = await listFirestoreCollection<PushSubscriptionDoc>('push_subscriptions', 500);
  const tokens = new Map<string, PushSubscriptionDoc>();

  allDocs
    .map((doc) => ({ ...doc.data, id: doc.data.id || doc.id }))
    .filter((sub) => sub.active !== false)
    .filter((sub) => sub.ownerType === target.ownerType)
    .filter((sub) => !target.ownerId || sub.ownerId === target.ownerId)
    .slice(0, 30)
    .forEach((sub) => {
      if (sub.token) tokens.set(sub.token, sub);
    });

  return Array.from(tokens.values());
};

const sendFcm = async (token: string, message: PushMessage, eventType: PushEventType) => {
  const serviceAccount = getServiceAccount();
  const accessToken = await getGoogleAccessToken('https://www.googleapis.com/auth/firebase.messaging');
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.projectId}/messages:send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        data: {
          title: message.title,
          body: message.body,
          url: message.url,
          tag: message.tag,
          eventType,
          icon: '/pwa-192.png',
          badge: '/pwa-192.png',
        },
        webpush: {
          fcmOptions: {
            link: message.url,
          },
        },
      },
    }),
  });

  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
};

const shouldDisableToken = (status: number, data: any) => {
  const serialized = JSON.stringify(data || {});
  return status === 404 || serialized.includes('UNREGISTERED') || serialized.includes('registration-token-not-registered');
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const eventType = cleanText(req.body?.eventType, 60) as PushEventType;
  const payload = (req.body?.payload && typeof req.body.payload === 'object') ? req.body.payload : {};
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';

  if (!['chat_message', 'worker_log', 'worker_certificate', 'payslip_sent'].includes(eventType)) {
    return res.status(400).json({ error: 'Tipo de notificación no valido.' });
  }

  try {
    const verified = await verifyFirebaseIdToken(getBearerToken(req.headers.authorization));
    const actorKey = verified.uid || ip;

    if (!checkRateLimit(`push-send-user:${actorKey}`, 40, 60 * 1000)) {
      return res.status(429).json({ error: 'Demasiadas notificaciones seguidas. Espera un minuto.' });
    }

    const message = buildPushMessage(eventType, payload, verified.claims || {});
    const targetKey = `${message.target.ownerType}:${message.target.ownerId || 'all'}`;

    if (!checkRateLimit(`push-send-target:${eventType}:${targetKey}`, 120, 60 * 60 * 1000)) {
      return res.status(429).json({ error: 'Límite de notificaciones alcanzado para este destino.' });
    }

    const subscriptions = await getSubscriptionsForTarget(message.target);
    if (subscriptions.length === 0) {
      return res.status(200).json({ ok: true, sent: 0, skipped: 'Sin dispositivos registrados.' });
    }

    let sent = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      const result = await sendFcm(subscription.token, message, eventType);
      if (result.ok) {
        sent += 1;
      } else {
        failed += 1;
        console.warn('FCM rechazo notificación:', result.status, result.data);
        if (shouldDisableToken(result.status, result.data)) {
          await setFirestoreDocument(`push_subscriptions/${subscription.id}`, {
            ...subscription,
            active: false,
            disabledAt: Date.now(),
            lastError: JSON.stringify(result.data || {}).slice(0, 500),
          });
        }
      }
    }

    return res.status(200).json({ ok: true, sent, failed });
  } catch (error: any) {
    console.error('Error enviando push:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo enviar la notificación.' });
  }
}
