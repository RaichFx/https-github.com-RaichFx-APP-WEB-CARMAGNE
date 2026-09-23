import { analyzeSheetFromPayload } from '../../server/gemini.js';
import { requireAuth, requireRole, sendApiError } from '../../server/auth/verifyToken.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_BASE64_CHARS = 8 * 1024 * 1024;

const readPayload = (body: any) => {
  const rawImage = String(body?.imageBase64 || body?.image || '');
  const dataUrl = rawImage.match(/^data:([^;]+);base64,(.+)$/s);
  const mimeType = String(body?.mimeType || dataUrl?.[1] || 'image/jpeg').toLowerCase();
  const imageBase64 = String(dataUrl?.[2] || rawImage).replace(/\s/g, '');
  return { imageBase64, mimeType };
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  try {
    const auth = await requireAuth(req);
    requireRole(auth, ['OWNER', 'ADMIN', 'MANAGER', 'WORKER']);
    if (!checkRateLimit(`gemini-analyze:uid:${auth.uid}`, 12, 60 * 60 * 1000) ||
        !checkRateLimit(`gemini-analyze:ip:${ip}`, 30, 60 * 60 * 1000)) {
      writeSecurityAudit({ action: 'gemini.sheet.analyze', outcome: 'denied', actorUid: auth.uid, actorRole: auth.role, ip, reason: 'rate_limit' });
      return res.status(429).json({ error: 'Has alcanzado el límite temporal de análisis.', code: 'RATE_LIMITED' });
    }

    const payload = readPayload(req.body || {});
    if (!ALLOWED_MIME_TYPES.has(payload.mimeType)) {
      return res.status(415).json({ error: 'Tipo de archivo no permitido.', code: 'UNSUPPORTED_MEDIA_TYPE' });
    }
    if (!payload.imageBase64 || payload.imageBase64.length > MAX_BASE64_CHARS) {
      return res.status(payload.imageBase64 ? 413 : 400).json({ error: payload.imageBase64 ? 'El archivo es demasiado grande.' : 'Debes adjuntar un archivo.', code: payload.imageBase64 ? 'PAYLOAD_TOO_LARGE' : 'FILE_REQUIRED' });
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload.imageBase64)) {
      return res.status(400).json({ error: 'El archivo no tiene un formato válido.', code: 'INVALID_BASE64' });
    }

    const result = await analyzeSheetFromPayload(payload, process.env.GEMINI_API_KEY);
    writeSecurityAudit({ action: 'gemini.sheet.analyze', outcome: 'allowed', actorUid: auth.uid, actorRole: auth.role, ip });
    return res.status(200).json({ result });
  } catch (error) {
    writeSecurityAudit({ action: 'gemini.sheet.analyze', outcome: 'error', ip, reason: 'request_failed' });
    return sendApiError(res, error, 'No se pudo analizar el documento.');
  }
}
