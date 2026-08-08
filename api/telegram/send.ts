type TelegramResult = {
  ok: boolean;
  status?: number;
  error?: string;
};

const telegramHtmlToSafeText = (message: string) =>
  message
    .replace(/<a\s+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/?b>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .trim();

const sendTelegramMessage = async (
  mensaje: string,
  botToken?: string,
  chatId?: string
): Promise<TelegramResult> => {
  const cleanBotToken = botToken?.trim();
  const cleanChatId = chatId?.trim();
  const cleanMessage = telegramHtmlToSafeText(mensaje || '');

  if (!cleanMessage) {
    return { ok: false, status: 400, error: 'El mensaje de Telegram es obligatorio.' };
  }

  if (!cleanBotToken || !cleanChatId || cleanBotToken === 'your_bot_token_here') {
    return { ok: false, status: 503, error: 'Telegram no esta configurado en el servidor.' };
  }

  const response = await fetch('https://api.telegram.org/bot' + cleanBotToken + '/sendMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: cleanChatId,
      text: cleanMessage.slice(0, 4096),
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  try {
    const result = await sendTelegramMessage(
      req.body?.mensaje || '',
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_CHAT_ID
    );

    if (!result.ok) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Error enviando Telegram.' });
  }
}
