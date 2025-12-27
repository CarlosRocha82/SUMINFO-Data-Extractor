
import { PoliceOccurrence, InvolvedPerson } from "../types";

/**
 * Remove acentos e converte para caixa alta
 */
const cleanText = (text: string): string => {
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[´`^~]/g, "")
    .toUpperCase()
    .trim();
};

/**
 * Limpa CPF deixando apenas números
 */
const cleanCpf = (text: string): string => {
  const digits = text.replace(/\D/g, "");
  return digits.length >= 11 ? digits.slice(-11) : digits || "Não informado";
};

export const extractDataOffline = (text: string): PoliceOccurrence[] => {
  const occurrences: PoliceOccurrence[] = [];
  
  // 1. Identificar inícios de ocorrência (Número + Data)
  // Padrão: Sequência de dígitos (pode ter /ano) + Data DD/MM/AAAA
  const headerRegex = /(\d{5,}(?:\/\d+)?)\s+.*?\s+(\d{2}\/\d{2}\/\d{4})/g;
  
  const matches = Array.from(text.matchAll(headerRegex));
  
  if (matches.length === 0) {
    console.warn("Nenhum cabeçalho detectado no texto.");
    return [];
  }

  for (let i = 0; i < matches.length; i++) {
    const startIdx = matches[i].index!;
    const endIdx = matches[i + 1] ? matches[i + 1].index : text.length;
    const block = text.slice(startIdx, endIdx);

    const id = matches[i][1];
    const date = matches[i][2];

    // 2. Filtro de Acidente de Trânsito
    const upperBlock = block.toUpperCase();
    const isOnlyAccident = upperBlock.includes("ACIDENTE DE TRANSITO") && 
                          !upperBlock.includes("EMBRIAGUEZ") && 
                          !upperBlock.includes("HOMICIDIO") &&
                          !upperBlock.includes("DROGAS") &&
                          !upperBlock.includes("ARMA");

    if (isOnlyAccident) continue;

    // 3. Extração do Fato (Logo após o BPM)
    let fact = "FATO NÃO IDENTIFICADO";
    // Busca por BPM, CIPM, PEL, CIA e pega o que vem depois até o fim da linha ou início de nomes
    const factMatch = block.match(/(?:BPM|CIPM|PEL|CIA|UNIDADE)\s*[-–—:]?\s*([^\n\r]+)/i);
    if (factMatch) {
      fact = factMatch[1].trim().split("  ")[0]; // Pega a primeira parte se houver muitos espaços
    }

    // 4. Envolvidos (Suspeito, Acusado, Envolvido, Conduzido, etc)
    const involved: InvolvedPerson[] = [];
    // Divide o bloco por palavras-chave de envolvidos
    const personRegex = /(?:ACUSADO|SUSPEITO|ENVOLVIDO|CONDUZIDO|AUTOR|INDICIADO|INFRATOR)/gi;
    const parts = block.split(personRegex);
    
    // O primeiro item do split é o texto antes do primeiro envolvido
    for (let j = 1; j < parts.length; j++) {
      const pText = parts[j];
      
      // Nome: Geralmente na primeira linha do bloco do envolvido
      const nameMatch = pText.match(/^\s*[:\-–]?\s*([^\n\r,;]{3,})/);
      if (!nameMatch) continue;

      const rawName = nameMatch[1].trim();
      // Filtra se capturou "CPF" ou rótulos como nome
      if (rawName.length < 3 || /^(CPF|MAE|DATA|NASC)/i.test(rawName)) continue;

      const name = cleanText(rawName);

      // CPF (11 dígitos formatados ou não)
      const cpfMatch = pText.match(/(?:CPF|DOC)\s*[:\-–]?\s*([\d\.\-]{11,15})/i);
      const cpf = cpfMatch ? cleanCpf(cpfMatch[1]) : "Não informado";

      // Data de Nascimento
      const birthMatch = pText.match(/(?:NASC|NASCIMENTO|DATA\s+NASC|DN)\s*[:\-–]?\s*(\d{2}\/\d{2}\/\d{4})/i);
      const birthDate = birthMatch ? birthMatch[1] : "Não informado";

      // Nome da Mãe
      const motherMatch = pText.match(/(?:MAE|GENITORA|FILIACAO)\s*[:\-–]?\s*([^\n\r,;]{3,})/i);
      const motherName = motherMatch ? cleanText(motherMatch[1]) : "Não informado";

      // Evitar duplicidade no mesmo bloco
      if (!involved.find(p => p.name === name)) {
        involved.push({ name, cpf, birthDate, motherName, condition: "Identificado" });
      }
    }

    // 5. Narrativa (Inicia em "No dia")
    let narrative = "NARRATIVA NÃO LOCALIZADA";
    const narrativeMatch = block.match(/No dia[\s\S]+/i);
    if (narrativeMatch) {
      narrative = narrativeMatch[0].trim();
    }

    occurrences.push({
      id,
      date,
      fact: cleanText(fact),
      isCrime: true,
      narrative,
      involved
    });
  }

  return occurrences;
};
