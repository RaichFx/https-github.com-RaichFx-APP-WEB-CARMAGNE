import { sendTelegramMessage } from '../../server/telegram';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  try {
    const result = await sendTelegramMessage(req.body?.mensaje || '', {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    });

    if (!result.ok) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Error enviando Telegram.' });
  }
}
