
import { GoogleGenAI, Type } from "@google/genai";
import { PoliceOccurrence } from "../types";

export const extractDataWithGemini = async (text: string): Promise<PoliceOccurrence[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Extraia as ocorrências policiais deste texto para JSON.
      REGRAS CRÍTICAS DE IDENTIFICAÇÃO:
      1. id: Capture o cabeçalho COMPLETO da ocorrência exatamente como aparece no início de cada registro. 
         PADRÃO OBRIGATÓRIO: [Número] - [Data Hora] - [Unidade-Referência]
         EXEMPLO: "49294 - 20/12/2025 06:00:13 - 10BPM-19DEZ2025-03"
         NÃO altere a ordem, NÃO remova o sufixo da unidade e NÃO formate como na imagem de erro (Unidade primeiro).
      
      OUTRAS REGRAS:
      2. isCrime: true para crimes reais (tráfico, roubo, agressão), false para extravios ou acidentes simples sem crime.
      3. Envolvidos: Apenas AUTORES/SUSPEITOS. NOME e MÃE em CAIXA ALTA SEM ACENTO.
      4. Narrativa: COPIE INTEGRALMENTE o texto da narrativa. A narrativa SEMPRE começa com "No dia..." e deve ser capturada ATÉ O FINAL, incluindo OBRIGATORIAMENTE o endereço/link do "linkgeo" (ex: "LinkGeo: https://...") que é o último item de cada ocorrência. Não interrompa a narrativa antes de capturar este link.
      5. FORMATAÇÃO: Certifique-se de que todas as aspas e quebras de linha dentro da narrativa estejam devidamente escapadas para um JSON válido.

      TEXTO:
      ${text}`,
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingBudget: 0 },
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING, description: "Cabeçalho completo: Número - Data/Hora - Unidade-Sufixo" },
              date: { type: Type.STRING, description: "Apenas a data DD/MM/AAAA para fins de ordenação" },
              fact: { type: Type.STRING },
              isCrime: { type: Type.BOOLEAN },
              narrative: { type: Type.STRING },
              involved: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    cpf: { type: Type.STRING },
                    birthDate: { type: Type.STRING },
                    motherName: { type: Type.STRING }
                  },
                  required: ["name", "cpf"]
                }
              }
            },
            required: ["id", "date", "fact", "isCrime", "narrative", "involved"]
          }
        }
      }
    });

    let jsonStr = response.text.trim();
    
    const sanitizeJson = (str: string) => {
      let fixed = str;
      const quoteCount = (fixed.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        fixed += '"';
      }
      return fixed;
    };

    try {
      return JSON.parse(jsonStr);
    } catch (parseError) {
      console.warn("JSON inválido detectado, aplicando heurísticas de recuperação...");
      
      let attempt = sanitizeJson(jsonStr);
      if (!attempt.endsWith(']')) {
        if (!attempt.endsWith('}')) attempt += '}';
        attempt += ']';
      }

      try {
        return JSON.parse(attempt);
      } catch (e) {
        const lastObjectEnd = jsonStr.lastIndexOf('}');
        if (lastObjectEnd !== -1) {
          try {
            const partial = jsonStr.substring(0, lastObjectEnd + 1) + ']';
            return JSON.parse(partial);
          } catch (e2) {
            console.error("Falha total na recuperação do JSON.");
            throw new Error("A resposta da IA veio malformada ou incompleta. Tente processar menos páginas por vez.");
          }
        }
        throw parseError;
      }
    }
  } catch (error: any) {
    console.error("Erro na extração Gemini:", error);
    throw error;
  }
};
