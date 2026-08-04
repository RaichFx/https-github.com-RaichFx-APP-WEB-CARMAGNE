type TelegramConfig = {
  botToken?: string;
  chatId?: string;
};

type TelegramResult = {
  ok: boolean;
  status?: number;
  error?: string;
};

export const sendTelegramMessage = async (
  mensaje: string,
  config: TelegramConfig
): Promise<TelegramResult> => {
  const botToken = config.botToken?.trim();
  const chatId = config.chatId?.trim();
  const cleanMessage = mensaje?.trim();

  if (!cleanMessage) {
    return { ok: false, status: 400, error: 'El mensaje de Telegram es obligatorio.' };
  }

  if (!botToken || !chatId || botToken === 'your_bot_token_here') {
    return { ok: false, status: 503, error: 'Telegram no esta configurado en el servidor.' };
  }

  const response = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: cleanMessage.slice(0, 4096),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return {
      ok: false,
      status: response.status,
      error: data?.description || 'Telegram rechazo la notificacion.',
    };
  }

  return { ok: true };
};
