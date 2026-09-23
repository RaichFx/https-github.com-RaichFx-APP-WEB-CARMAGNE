import { requireAuth, requireRole, requireWorkerSelf, sendApiError } from '../../server/auth/verifyToken.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';
import { sendTelegramMessage } from '../../server/telegram.js';

type TelegramEventType =
  | 'TOOL_CREATED'
  | 'WORKER_EMAIL_UPDATED'
  | 'WORK_LOG'
  | 'REPORT_CREATED'
  | 'PAYSLIP_SIGNED'
  | 'CERTIFICATE_UPLOADED'
  | 'WORKER_CREATED'
  | 'REPORT_APPROVED'
  | 'REPORT_REJECTED'
  | 'PAYSLIP_SENT';

const WORKER_EVENTS = new Set<TelegramEventType>(['TOOL_CREATED','WORKER_EMAIL_UPDATED','WORK_LOG','REPORT_CREATED','PAYSLIP_SIGNED','CERTIFICATE_UPLOADED']);
const ADMIN_EVENTS = new Set<TelegramEventType>(['WORKER_CREATED','REPORT_APPROVED','REPORT_REJECTED','PAYSLIP_SENT']);
const text = (value: unknown, max = 160) => String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, max);
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;

const buildMessage = (eventType: TelegramEventType, payload: Record<string, unknown>) => {
  const workerName = text(payload.workerName || payload.name, 160) || 'Trabajador';
  switch (eventType) {
    case 'TOOL_CREATED':
      return `🛠️ Nueva herramienta registrada\nOperario: ${workerName}\nEquipo: ${text(payload.toolName,120)}\nMarca: ${text(payload.brand,80)}\nModelo: ${text(payload.model,80) || 'S/M'}`;
    case 'WORKER_EMAIL_UPDATED':
      return `📧 Correo electrónico actualizado\nOperario: ${workerName}`;
    case 'WORK_LOG': {
      const lat = number(payload.latitude); const lng = number(payload.longitude);
      const map = lat !== null && lng !== null ? `\nUbicación: https://www.google.com/maps?q=${lat},${lng}` : '';
      const report = text(payload.report,500);
      return `🕒 Nuevo fichaje\nOperario: ${workerName}\nAcción: ${text(payload.logType,40)}\nHora: ${text(payload.timeStr,40)}\nObra: ${text(payload.siteName,160)}${report ? `\nReporte: ${report}` : ''}${map}`;
    }
    case 'REPORT_CREATED':
      return `📝 Nuevo parte semanal\nOperario: ${workerName}\nPeríodo: ${text(payload.period,80)}\nEnvío: ${text(payload.dateStr,40)}${text(payload.comments,500) ? `\nComentarios: ${text(payload.comments,500)}` : ''}`;
    case 'PAYSLIP_SIGNED':
      return `✍️ Nómina firmada\nOperario: ${workerName}\nPeríodo: ${text(payload.monthStr,20)}\nImporte: ${text(payload.totalPay,32)} €`;
    case 'CERTIFICATE_UPLOADED':
      return `📄 Certificado subido\nOperario: ${workerName}\nArchivo: ${text(payload.fileName,160)}`;
    case 'WORKER_CREATED':
      return `👷 Trabajador creado\nNombre: ${workerName}\nRol: ${text(payload.workerRole,80) || 'Operario'}`;
    case 'REPORT_APPROVED':
      return `✅ Parte aprobado\nOperario: ${workerName}\nPeríodo: ${text(payload.period,80)}`;
    case 'REPORT_REJECTED':
      return `❌ Parte rechazado\nOperario: ${workerName}\nMotivo: ${text(payload.reason,500) || 'No indicado'}`;
    case 'PAYSLIP_SENT':
      return `💶 Nómina enviada\nOperario: ${workerName}\nPeríodo: ${text(payload.monthStr,20)}`;
    default:
      return '';
  }
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  try {
    const auth = await requireAuth(req);
    const eventType = text(req.body?.eventType, 40) as TelegramEventType;
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload as Record<string, unknown> : {};
    if (!WORKER_EVENTS.has(eventType) && !ADMIN_EVENTS.has(eventType)) {
      return res.status(400).json({ error: 'Tipo de evento no permitido.', code: 'INVALID_EVENT' });
    }
    if (WORKER_EVENTS.has(eventType)) requireWorkerSelf(auth, payload.workerId);
    if (ADMIN_EVENTS.has(eventType)) requireRole(auth, ['OWNER','ADMIN']);
    if (!checkRateLimit(`telegram:uid:${auth.uid}`, 40, 60 * 60 * 1000) || !checkRateLimit(`telegram:ip:${ip}`, 100, 60 * 60 * 1000)) {
      writeSecurityAudit({ action: 'telegram.event.send', outcome: 'denied', actorUid: auth.uid, actorRole: auth.role, ip, reason: 'rate_limit' });
      return res.status(429).json({ error: 'Demasiadas notificaciones. Espera unos minutos.', code: 'RATE_LIMITED' });
    }

    const message = buildMessage(eventType, payload);
    if (!message) return res.status(400).json({ error: 'Evento no válido.', code: 'INVALID_EVENT' });
    const result = await sendTelegramMessage(message, { botToken: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID });
    if (!result.ok) {
      writeSecurityAudit({ action: 'telegram.event.send', outcome: 'error', actorUid: auth.uid, actorRole: auth.role, ip, reason: 'provider_error' });
      return res.status(result.status === 503 ? 503 : 502).json({ error: 'No se pudo enviar la notificación.', code: 'TELEGRAM_ERROR' });
    }
    writeSecurityAudit({ action: 'telegram.event.send', outcome: 'allowed', actorUid: auth.uid, actorRole: auth.role, targetType: 'telegram_event', targetId: eventType, ip });
    return res.status(200).json({ ok: true });
  } catch (error) {
    return sendApiError(res, error, 'No se pudo enviar la notificación.');
  }
}
