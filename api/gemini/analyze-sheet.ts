import { analyzeSheetFromPayload } from '../../server/gemini';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo no permitido.' });
  }

  try {
    const result = await analyzeSheetFromPayload(req.body || {}, process.env.GEMINI_API_KEY);
    return res.status(200).json({ result });
  } catch (error: any) {
    const message = error?.message || String(error);
    const status = message.includes('obligatoria') ? 400 : 500;
    return res.status(status).json({ error: 'Error de procesamiento de IA: ' + message });
  }
}
