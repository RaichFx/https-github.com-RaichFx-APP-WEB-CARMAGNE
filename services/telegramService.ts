/**
 * Service to handle Telegram notifications
 */
export const TelegramService = {
  /**
   * Sends a message to a Telegram chat using the Bot API
   * Variables are read from environment (VITE_TELEGRAM_BOT_TOKEN and VITE_TELEGRAM_CHAT_ID)
   */
  enviarNotificacionTelegram: async (mensaje: string): Promise<boolean> => {
    const BOT_TOKEN = (import.meta as any).env?.VITE_TELEGRAM_BOT_TOKEN;
    const CHAT_ID = (import.meta as any).env?.VITE_TELEGRAM_CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID || BOT_TOKEN === 'your_bot_token_here') {
      console.warn("Telegram configuration is missing or using placeholder values.");
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: mensaje,
          parse_mode: 'HTML'
        }),
      });

      if (!response.ok) {
        const error = await response.json();
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
