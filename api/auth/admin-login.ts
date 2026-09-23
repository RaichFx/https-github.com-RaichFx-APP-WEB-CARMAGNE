import {
  createFirebaseCustomToken,
  getFirestoreDocument,
  queryFirestoreByField,
  verifySecret,
} from '../../server/firebaseAdminRest.js';
import { checkRateLimit } from '../../server/rateLimit.js';
import { writeSecurityAudit } from '../../server/security/audit.js';
import type { AdminUser, AppConfig } from '../../types';

const publicAdmin = (admin: AdminUser) => {
  const { password, passwordHash, ...safeAdmin } = admin;
  return safeAdmin;
};

const loginError = { error: 'Credenciales incorrectas.', code: 'INVALID_CREDENTIALS' };

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.', code: 'METHOD_NOT_ALLOWED' });
  }

  const username = String(req.body?.username || '').trim().slice(0, 80);
  const password = String(req.body?.password || '').slice(0, 128);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rateKey = `admin-login:${ip}:${username.toLowerCase()}`;

  if (!checkRateLimit(rateKey, 6, 10 * 60 * 1000)) {
    writeSecurityAudit({ action: 'auth.admin.login', outcome: 'denied', ip, reason: 'rate_limit' });
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.', code: 'RATE_LIMITED' });
  }
  if (!username || !password) return res.status(401).json(loginError);

  try {
    if (username.toLowerCase() === 'admin') {
      const configDoc = await getFirestoreDocument<AppConfig>('config/global');
      const adminPassword = configDoc?.data?.adminPassword || '';
      if (!adminPassword || !verifySecret(password, undefined, adminPassword)) {
        writeSecurityAudit({ action: 'auth.admin.login', outcome: 'denied', ip, reason: 'invalid_credentials' });
        return res.status(401).json(loginError);
      }

      const owner: AdminUser = { id: 'admin_super', username: 'admin', role: 'OWNER', active: true, createdAt: 0 };
      const token = createFirebaseCustomToken('admin_super', { role: 'OWNER', admin: true, owner: true, adminId: owner.id });
      writeSecurityAudit({ action: 'auth.admin.login', outcome: 'allowed', actorUid: owner.id, actorRole: 'OWNER', ip });
      return res.status(200).json({ token, admin: owner });
    }

    const matches = await queryFirestoreByField<AdminUser>('admins', 'username', username, 1);
    const adminDoc = matches[0];
    const admin = adminDoc ? ({ ...adminDoc.data, id: adminDoc.data.id || adminDoc.id } as AdminUser) : null;
    const validPassword = admin ? verifySecret(password, admin.passwordHash, admin.password) : false;
    if (!admin || !admin.active || !validPassword) {
      writeSecurityAudit({ action: 'auth.admin.login', outcome: 'denied', ip, reason: 'invalid_credentials' });
      return res.status(401).json(loginError);
    }

    const role = admin.role === 'MANAGER' ? 'MANAGER' : 'ADMIN';
    const token = createFirebaseCustomToken(`admin_${admin.id}`.slice(0, 128), { role, adminId: admin.id, admin: role === 'ADMIN' });
    writeSecurityAudit({ action: 'auth.admin.login', outcome: 'allowed', actorUid: admin.id, actorRole: role, ip });
    return res.status(200).json({ token, admin: publicAdmin({ ...admin, role }) });
  } catch (error) {
    console.error('Error interno en admin-login:', error);
    return res.status(500).json({ error: 'No se pudo iniciar sesión.', code: 'INTERNAL_ERROR' });
  }
}
