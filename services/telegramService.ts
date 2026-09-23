import { auth } from './firebase';

export type TelegramEventType =
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

export const TelegramService = {
  enviarEventoTelegram: async (
    eventType: TelegramEventType,
    payload: Record<string, unknown>
  ): Promise<boolean> => {
    const user = auth.currentUser;
    if (!user) return false;

    try {
      const idToken = await user.getIdToken();
      const response = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ eventType, payload }),
      });
      if (!response.ok) {
        console.warn('No se pudo enviar la notificación de Telegram.');
        return false;
      }
      return true;
    } catch (error) {
      console.warn('No se pudo enviar la notificación de Telegram.', error);
      return false;
    }
  },
};
