import { GoogleGenAI, Type } from '@google/genai';

type AnalyzePayload = {
  imageBase64?: string;
  mimeType?: string;
  image?: string;
};

export const analyzeSheetFromPayload = async (payload: AnalyzePayload, apiKey?: string) => {
  const cleanApiKey = apiKey?.trim();

  if (!cleanApiKey) {
    throw new Error('La API Key de Gemini no esta configurada en el servidor.');
  }

  let finalBase64 = payload.imageBase64;
  let finalMimeType = payload.mimeType || 'image/jpeg';

  if (!finalBase64 && payload.image) {
    const matches = payload.image.match(/^data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      finalMimeType = matches[1];
      finalBase64 = matches[2];
    } else {
      finalBase64 = payload.image;
    }
  }

  if (!finalBase64) {
    throw new Error('La imagen en formato base64 es obligatoria.');
  }

  const ai = new GoogleGenAI({
    apiKey: cleanApiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const prompt = `Analiza este parte de trabajo semanal o diario. Extrae la siguiente informacion estructurada de manera precisa:
1. Las fechas de trabajo que cubre el parte.
2. Un resumen breve y profesional de lo que se ha trabajado (tareas, obras o conceptos).
3. El numero total de horas trabajadas expresado como un numero (si es posible, si no, pon el valor estimado).
4. El total o resumen de horas totales y cualquier otra indicacion de total en el parte.
5. Un desglose de horas trabajadas por cada dia individual que aparezca en el documento.

Por favor, se muy preciso y lee cuidadosamente los textos manuscritos o impresos.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: [
      {
        inlineData: {
          data: finalBase64,
          mimeType: finalMimeType,
        },
      },
      { text: prompt },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          dates: {
            type: Type.STRING,
            description: 'Fechas de trabajo o rango de fechas cubiertas, ej: "23/06/2026 al 29/06/2026"',
          },
          tasks: {
            type: Type.STRING,
            description: 'Descripcion resumida de las tareas y trabajos realizados',
          },
          hours: {
            type: Type.NUMBER,
            description: 'Suma de horas totales como valor numerico, ej: 40',
          },
          total: {
            type: Type.STRING,
            description: 'Total acumulado escrito en el parte con su unidad, ej: "40 Horas"',
          },
          dailyHours: {
            type: Type.ARRAY,
            description: 'Desglose diario de horas y tareas',
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING, description: 'Dia o fecha, ej: "Lunes 22" o "Martes 23"' },
                hours: { type: Type.NUMBER, description: 'Horas trabajadas este dia, ej: 8.5' },
                tasks: { type: Type.STRING, description: 'Breve tarea o concepto para este dia' },
              },
              required: ['date', 'hours'],
            },
          },
        },
        required: ['dates', 'tasks', 'hours', 'total', 'dailyHours'],
      },
    },
  });

  const textOutput = response.text;
  if (!textOutput) {
    throw new Error('No se recibio respuesta legible de Gemini.');
  }

  return JSON.parse(textOutput.trim());
};
