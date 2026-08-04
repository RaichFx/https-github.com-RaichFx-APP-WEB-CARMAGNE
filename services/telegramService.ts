/**
 * Service to handle Telegram notifications
 */
export const TelegramService = {
  /**
   * Sends a message to Telegram through the server API.
   * Bot credentials must never be exposed through VITE_* client variables.
   */
  enviarNotificacionTelegram: async (mensaje: string): Promise<boolean> => {
    if (!mensaje || !mensaje.trim()) {
      return false;
    }

    try {
      const response = await fetch('/api/telegram/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mensaje
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error("Telegram API Error:", error);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      return false;
    }
  }
};
