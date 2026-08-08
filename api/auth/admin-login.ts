import {
  createFirebaseCustomToken,
  getFirestoreDocument,
  queryFirestoreByField,
  verifySecret,
} from '../../server/firebaseAdminRest';
import { checkRateLimit } from '../../server/rateLimit';
import type { AdminUser, AppConfig } from '../../types';

const publicAdmin = (admin: AdminUser) => {
  const { password, ...safeAdmin } = admin;
  return safeAdmin;
};

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const rateKey = `admin-login:${req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'}:${username}`;

  if (!checkRateLimit(rateKey, 6, 10 * 60 * 1000)) {
    return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  }

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });
  }

  try {
    if (username === 'admin') {
      const configDoc = await getFirestoreDocument<AppConfig>('config/global');
      const adminPassword = configDoc?.data?.adminPassword || '';

      if (!adminPassword || !verifySecret(password, undefined, adminPassword)) {
        return res.status(401).json({ error: 'Credenciales incorrectas.' });
      }

      const token = createFirebaseCustomToken('admin_super', {
        role: 'admin',
        admin: true,
      });

      return res.status(200).json({ token, admin: null });
    }

    const matches = await queryFirestoreByField<AdminUser>('admins', 'username', username, 1);
    const adminDoc = matches[0];
    if (!adminDoc) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const admin = { ...adminDoc.data, id: adminDoc.data.id || adminDoc.id } as AdminUser;
    if (!admin.active || !verifySecret(password, undefined, admin.password)) {
      return res.status(401).json({ error: 'Credenciales incorrectas.' });
    }

    const token = createFirebaseCustomToken(`admin_${admin.id}`.slice(0, 128), {
      role: 'admin',
      adminId: admin.id,
      admin: true,
    });

    return res.status(200).json({
      token,
      admin: publicAdmin(admin),
    });
  } catch (error: any) {
    console.error('Error en admin-login:', error);
    return res.status(500).json({ error: error?.message || 'No se pudo iniciar sesion.' });
  }
}
