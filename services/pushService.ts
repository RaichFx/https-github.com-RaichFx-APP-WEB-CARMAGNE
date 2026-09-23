import { auth, app } from './firebase';

export type PushOwnerType = 'worker' | 'admin';
export type PushPermissionStatus = 'unsupported' | 'default' | 'granted' | 'denied' | 'missing-config';
export type PushEventType = 'chat_message' | 'worker_log' | 'worker_certificate' | 'payslip_sent';

type RegisterPayload = {
  ownerType: PushOwnerType;
  ownerId: string;
  ownerName: string;
};

type PushEventPayload = {
  eventType: PushEventType;
  payload: Record<string, any>;
};

const VAPID_PUBLIC_KEY = 'BA8KhEN04yRW1CO-XKqoK18CguY6hW7SUM4iE3yAOzABQeT_ttg9OxKJVDi1S2pT_HqIGmaFoZa-xf_hJRL52BU';
let registeredSession: { ownerType: PushOwnerType; ownerId: string; registeredAt: number } | null = null;

const canUsePushApis = () =>
  typeof window !== 'undefined' &&
  typeof Notification !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  window.isSecureContext;

const getAuthToken = async () => {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Sesión no disponible. Cierra sesión y vuelve a entrar.');
  }
  return user.getIdToken();
};

const getStatusMessage = (status: PushPermissionStatus) => {
  if (status === 'granted') return 'Notificaciones activadas en este dispositivo.';
  if (status === 'denied') return 'El dispositivo tiene las notificaciones bloqueadas. Actívalas en ajustes del navegador/app.';
  if (status === 'unsupported') return 'Este navegador o dispositivo no admite notificaciones push para esta app.';
  if (status === 'missing-config') return 'Falta la configuración de notificaciones.';
  return 'Pulsa para permitir avisos aunque no estés dentro de la app.';
};

export const PushService = {
  getPermissionStatus(): PushPermissionStatus {
    if (!VAPID_PUBLIC_KEY) return 'missing-config';
    if (!canUsePushApis()) return 'unsupported';
    return Notification.permission as PushPermissionStatus;
  },

  getStatusMessage,

  isRegisteredLocally(owner: RegisterPayload) {
    return Boolean(
      registeredSession
      && registeredSession.ownerType === owner.ownerType
      && registeredSession.ownerId === owner.ownerId
      && Date.now() - registeredSession.registeredAt < 30 * 24 * 60 * 60 * 1000
    );
  },

  async requestPermissionAndRegister(owner: RegisterPayload): Promise<{ ok: boolean; status: PushPermissionStatus; message: string }> {
    if (!VAPID_PUBLIC_KEY) {
      return { ok: false, status: 'missing-config', message: getStatusMessage('missing-config') };
    }

    if (!canUsePushApis()) {
      return { ok: false, status: 'unsupported', message: getStatusMessage('unsupported') };
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      const status = permission as PushPermissionStatus;
      return { ok: false, status, message: getStatusMessage(status) };
    }

    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
    const supported = await isSupported().catch(() => false);
    if (!supported) {
      return { ok: false, status: 'unsupported', message: getStatusMessage('unsupported') };
    }

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) {
      throw new Error('No se pudo obtener el token de notificaciones del dispositivo.');
    }

    const idToken = await getAuthToken();
    const response = await fetch('/api/push/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        ...owner,
        token,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'No se pudo registrar este dispositivo para notificaciones.');
    }
    registeredSession = {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      registeredAt: Date.now(),
    };

    return { ok: true, status: 'granted', message: getStatusMessage('granted') };
  },

  async sendEvent(event: PushEventPayload): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
    const user = auth.currentUser;
    if (!user) {
      return { ok: false, skipped: true, error: 'Sin sesión Firebase.' };
    }

    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(event),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, error: data?.error || 'No se pudo enviar la notificación.' };
      }

      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || 'Error enviando notificación.' };
    }
  },
};
