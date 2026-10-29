import { getApps, initializeApp } from 'firebase/app';
import {
  getAuth, setPersistence, inMemoryPersistence, signInWithCustomToken,
  EmailAuthProvider, linkWithCredential, sendEmailVerification, signOut,
  type Auth, type User,
} from 'firebase/auth';
import { firebaseConfig } from './firebase';

const APP_NAME = 'carmagne-registration-verification';
let authPromise: Promise<Auth> | null = null;
let expectedEmail = '';
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const verificationAuth = () => {
  if (!authPromise) {
    authPromise = (async () => {
      const app = getApps().find(item => item.name === APP_NAME) || initializeApp(firebaseConfig, APP_NAME);
      const auth = getAuth(app);
      await setPersistence(auth, inMemoryPersistence);
      auth.languageCode = 'es';
      return auth;
    })().catch(error => { authPromise = null; throw error; });
  }
  return authPromise;
};
const checkedUser = async (): Promise<User> => {
  const user = (await verificationAuth()).currentUser;
  if (!user || !expectedEmail) throw new Error('Vuelve al acceso y entra con tu teléfono y contraseña para continuar.');
  await user.reload();
  if (!user.providerData.some(provider => provider.providerId === 'password') ||
      normalizeEmail(user.email || '') !== expectedEmail) {
    throw new Error('No se ha podido vincular ese correo. Vuelve al acceso para reintentar o contacta con el administrador.');
  }
  return user;
};

// A separate, memory-only session never replaces the primary worker/admin login.
// The server token contains registrationPending only: no role and no workerId.
export const RegistrationVerification = {
  async prepare(token: string, email: string, password: string): Promise<void> {
    const auth = await verificationAuth();
    expectedEmail = '';
    const { user } = await signInWithCustomToken(auth, token);
    const normalized = normalizeEmail(email);
    if (user.providerData.some(provider => provider.providerId === 'password')) {
      if (normalizeEmail(user.email || '') !== normalized) throw new Error('El correo vinculado no coincide. Contacta con el administrador.');
    } else {
      await linkWithCredential(user, EmailAuthProvider.credential(normalized, password));
    }
    expectedEmail = normalized;
    await checkedUser();
  },
  async send(): Promise<{ alreadyVerified: boolean }> {
    const user = await checkedUser();
    if (user.emailVerified) return { alreadyVerified: true };
    await sendEmailVerification(user);
    return { alreadyVerified: false };
  },
  async isVerified(): Promise<boolean> {
    return (await checkedUser()).emailVerified;
  },
  async close(): Promise<void> {
    expectedEmail = '';
    if (authPromise) await signOut(await authPromise);
  },
};
