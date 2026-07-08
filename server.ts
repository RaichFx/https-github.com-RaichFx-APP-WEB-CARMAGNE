import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for large JSON payloads (necessary for base64 images)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Initialize Gemini Client
  const apiKey = process.env.GEMINI_API_KEY;
  const ai = new GoogleGenAI({
    apiKey: apiKey || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  // API Endpoint to Analyze Weekly Timesheet Photo
  app.post('/api/gemini/analyze-sheet', async (req, res) => {
    try {
      const { imageBase64, mimeType, image } = req.body;
      let finalBase64 = imageBase64;
      let finalMimeType = mimeType || 'image/jpeg';

      if (!finalBase64 && image) {
        const matches = image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          finalMimeType = matches[1];
          finalBase64 = matches[2];
        } else {
          finalBase64 = image;
        }
      }

      if (!finalBase64) {
        return res.status(400).json({ error: 'La imagen en formato base64 es obligatoria.' });
      }

      if (!apiKey) {
        return res.status(500).json({ 
          error: 'La API Key de Gemini no está configurada en el servidor. Por favor, añádela en Settings > Secrets.' 
        });
      }

      const prompt = `Analiza este parte de trabajo semanal o diario. Extrae la siguiente información estructurada de manera precisa:
1. Las fechas de trabajo que cubre el parte.
2. Un resumen breve y profesional de lo que se ha trabajado (tareas, obras o conceptos).
3. El número total de horas trabajadas expresado como un número (si es posible, si no, pon el valor estimado).
4. El total o resumen de horas totales y cualquier otra indicación de total en el parte.

Por favor, sé muy preciso y lee cuidadosamente los textos manuscritos o impresos.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [
          {
            inlineData: {
              data: finalBase64,
              mimeType: finalMimeType
            }
          },
          { text: prompt }
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              dates: { 
                type: Type.STRING, 
                description: 'Fechas de trabajo o rango de fechas cubiertas, ej: "23/06/2026 al 29/06/2026"' 
              },
              tasks: { 
                type: Type.STRING, 
                description: 'Descripción resumida de las tareas y trabajos realizados' 
              },
              hours: { 
                type: Type.NUMBER, 
                description: 'Suma de horas totales como valor numérico, ej: 40' 
              },
              total: { 
                type: Type.STRING, 
                description: 'Total acumulado escrito en el parte con su unidad, ej: "40 Horas" o "42.5 horas totales"' 
              }
            },
            required: ['dates', 'tasks', 'hours', 'total']
          }
        }
      });

      const textOutput = response.text;
      if (!textOutput) {
        throw new Error('No se recibió respuesta legible de Gemini.');
      }

      const parsedData = JSON.parse(textOutput.trim());
      res.json({ result: parsedData }); // Wrap in "result" property as expected by frontend

    } catch (error: any) {
      console.error('Error en analyze-sheet:', error);
      res.status(500).json({ 
        error: 'Error de procesamiento de IA: ' + (error.message || String(error)) 
      });
    }
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} under NODE_ENV=${process.env.NODE_ENV}`);
  });
}

startServer();
