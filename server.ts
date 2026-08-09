import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { analyzeSheetFromPayload } from './server/gemini.js';
import { sendTelegramMessage } from './server/telegram.js';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.post('/api/telegram/send', async (req, res) => {
    try {
      const result = await sendTelegramMessage(req.body?.mensaje || '', {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
      });

      if (!result.ok) {
        return res.status(result.status || 500).json({ error: result.error });
      }

      res.json({ ok: true });
    } catch (error: any) {
      console.error('Error en telegram/send:', error);
      res.status(500).json({ error: error.message || String(error) });
    }
  });

  app.post('/api/gemini/analyze-sheet', async (req, res) => {
    try {
      const result = await analyzeSheetFromPayload(req.body || {}, process.env.GEMINI_API_KEY);
      res.json({ result });
    } catch (error: any) {
      console.error('Error en analyze-sheet:', error);
      const message = error.message || String(error);
      const status = message.includes('obligatoria') ? 400 : 500;
      res.status(status).json({ error: 'Error de procesamiento de IA: ' + message });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} under NODE_ENV=${process.env.NODE_ENV}`);
  });
}

startServer();
