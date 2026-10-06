import { getGoogleAccessToken, getServiceAccount } from '../firebaseAdminRest.js';

// Opt-in rollout: configure only the pilot UID first. No new paid infrastructure.
export const emailRecoveryEnabled = (uid: string) =>
  (process.env.FIREBASE_EMAIL_RECOVERY_WORKER_IDS || '').split(',').map(v => v.trim()).includes(uid);

export type EmailAuthAccount = { localId: string; email?: string; emailVerified?: boolean; disabled?: boolean; providerUserInfo?: { providerId: string }[] };
const apiKey = () => process.env.FIREBASE_WEB_API_KEY || 'AIzaSyCelLg2pqp1-lYi_IUgsv4FAoH4mN0WsAc';

export async function getEmailAuthAccount(uid: string): Promise<EmailAuthAccount | null> {
  const { projectId } = getServiceAccount();
  const token = await getGoogleAccessToken('https://www.googleapis.com/auth/identitytoolkit');
  const response = await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/accounts:lookup', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: [uid] }),
  });
  if (!response.ok) throw new Error('No se pudo consultar la identidad Firebase.');
  const data = await response.json();
  return data.users?.find((user: EmailAuthAccount) => user.localId === uid) || null;
}

export const hasEmailPassword = (account: EmailAuthAccount | null) =>
  !!account?.email && !!account.providerUserInfo?.some(provider => provider.providerId === 'password');

export async function verifyEmailPassword(uid: string, email: string, password: string): Promise<string | null> {
  const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + apiKey(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  // Never authenticate a different UID merely because the email matches.
  return data.localId === uid && typeof data.idToken === 'string' ? data.idToken : null;
}

export async function updateEmailPassword(idToken: string, password: string): Promise<void> {
  const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:update?key=' + apiKey(), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, password, returnSecureToken: false }),
  });
  if (!response.ok) throw new Error('No se pudo actualizar la contraseña Firebase.');
}
