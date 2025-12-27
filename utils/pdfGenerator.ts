
import { jsPDF } from "jspdf";
import { PoliceOccurrence, InvolvedPerson, PDFStyleConfig } from "../types";

/**
 * Renderiza uma única linha de texto justificada no PDF.
 */
const renderJustifiedLine = (pdfDoc: jsPDF, text: string, x: number, y: number, width: number) => {
  const words = text.trim().split(/\s+/);
  if (words.length <= 1) {
    pdfDoc.text(text, x, y);
    return;
  }

  const totalWordsWidth = words.reduce((acc, word) => acc + pdfDoc.getTextWidth(word), 0);
  const totalSpaceWidth = width - totalWordsWidth;
  const spaceWidth = totalSpaceWidth / (words.length - 1);

  let currentX = x;
  words.forEach((word, i) => {
    pdfDoc.text(word, currentX, y);
    currentX += pdfDoc.getTextWidth(word) + spaceWidth;
  });
};

export const generateResultPDF = async (occurrences: PoliceOccurrence[], config: PDFStyleConfig) => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15; // 1,5cm
  const standardFontSize = 11;
  let currentY = 25;

  const addHeaderFooter = (pdfDoc: jsPDF) => {
    // Define como negrito para as marcações de segurança
    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.setFontSize(standardFontSize); 
    pdfDoc.setTextColor(255, 0, 0); // Vermelho
    
    pdfDoc.text("RESERVADO", pageWidth / 2, 15, { align: "center" });
    pdfDoc.text("RESERVADO", pageWidth / 2, pageHeight - 10, { align: "center" });
    
    // Retorna para preto e estilo NORMAL para não afetar o texto subsequente
    pdfDoc.setTextColor(0, 0, 0);
    pdfDoc.setFont("helvetica", "normal");
  };

  const checkPageOverflow = (pdfDoc: jsPDF, neededHeight: number): number => {
    if (currentY + neededHeight > pageHeight - 20) {
      pdfDoc.addPage();
      currentY = 25;
      addHeaderFooter(pdfDoc);
    }
    return currentY;
  };

  const normalizeForDisplay = (text: string): string => {
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase();
  };

  const renderDataRow = (pdfDoc: jsPDF, label: string, value: string | undefined, x: number, y: number) => {
    const val = value ? String(value).trim().toLowerCase() : "";
    const isMissing = !value || 
                      val === "" || 
                      val === "não informado" || 
                      val === "nao informado" || 
                      val === "null" || 
                      val === "undefined";

    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.setFontSize(standardFontSize);
    pdfDoc.setTextColor(0, 0, 0);
    pdfDoc.text(label, x, y);
    
    const labelWidth = pdfDoc.getTextWidth(label + " ");

    if (isMissing) {
      pdfDoc.setFont("helvetica", "italic");
      pdfDoc.setTextColor(0, 0, 0);
      pdfDoc.text("Não informado", x + labelWidth, y);
    } else {
      pdfDoc.setFont("helvetica", config.dataBold ? "bold" : "normal");
      pdfDoc.setTextColor(config.dataColor);
      pdfDoc.text(normalizeForDisplay(String(value)), x + labelWidth, y);
    }
    
    pdfDoc.setFont("helvetica", "normal"); 
    pdfDoc.setTextColor(0, 0, 0);
    return 6; 
  };

  addHeaderFooter(doc);

  occurrences.forEach((occ) => {
    checkPageOverflow(doc, 40);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    // Exibe apenas o id, que agora contém o cabeçalho completo: Número - Data/Hora - Sufixo
    doc.text(occ.id, margin, currentY);
    currentY += 10;

    doc.setFont("helvetica", "bold");
    doc.text(`FATO: `, margin, currentY);
    const labelFatoWidth = doc.getTextWidth(`FATO: `);
    doc.setFont("helvetica", config.factBold ? "bold" : "normal");
    doc.setTextColor(config.factColor); 
    doc.text(normalizeForDisplay(occ.fact), margin + labelFatoWidth, currentY);
    doc.setTextColor(0, 0, 0);
    currentY += 10;

    if (occ.isCrime) {
      const involvedList = occ.involved || [];
      if (involvedList.length > 0) {
          involvedList.forEach((person, pIndex) => {
            checkPageOverflow(doc, 35);
            doc.setFont("helvetica", "bold");
            doc.text(`${pIndex + 1}.`, margin, currentY);
            renderDataRow(doc, "NOME:", person.name, margin + 10, currentY);
            renderDataRow(doc, "CPF:", person.cpf, margin + 10, currentY + 6);
            renderDataRow(doc, "DATA DE NASC: ", person.birthDate, margin + 10, currentY + 12);
            renderDataRow(doc, "NOME DA MAE:", person.motherName, margin + 10, currentY + 18);
            currentY += 28; 
          });
      } else {
          checkPageOverflow(doc, 35);
          renderDataRow(doc, "NOME:", "", margin + 10, currentY);
          renderDataRow(doc, "CPF:", "", margin + 10, currentY + 6);
          renderDataRow(doc, "DATA DE NASC: ", "", margin + 10, currentY + 12);
          renderDataRow(doc, "NOME DA MAE:", "", margin + 10, currentY + 18);
          currentY += 28;
      }
    } else {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.text("Dados pessoais omitidos para ocorrências não classificadas como crime.", margin, currentY);
        currentY += 8;
    }

    if (config.reportSubType !== 'personal_data_only') {
      const narrativeText = (occ.narrative || "Narrativa não informada").replace(/\s+/g, " ").trim();
      const firstLineIndent = 15;
      const availableWidth = pageWidth - (margin * 2);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(standardFontSize);
      doc.setTextColor(0, 0, 0);

      const lines = doc.splitTextToSize(narrativeText, availableWidth);

      lines.forEach((line: string, index: number) => {
        checkPageOverflow(doc, 6);
        
        // Garante que o estilo seja normal após a verificação de quebra de página
        doc.setFont("helvetica", "normal");
        doc.setFontSize(standardFontSize);
        doc.setTextColor(0, 0, 0);

        const isFirst = index === 0;
        const xPos = isFirst ? (margin + firstLineIndent) : margin;
        
        doc.text(line, xPos, currentY);
        currentY += 6;
      });
    }

    currentY += 5;
    checkPageOverflow(doc, 10);
    doc.setDrawColor(config.separatorColor);
    doc.setLineWidth(0.8);
    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 15;
  });

  return doc;
};

/**
 * Gera um PDF do tutorial / manual de instruções identico ao apresentado na tela.
 */
export const generateManualPDF = () => {
  const doc = new jsPDF();
  const margin = 15; // 1,5cm
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - (margin * 2); // 180mm
  let y = 20;

  const checkOverflow = (height: number) => {
    if (y + height > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const drawBox = (x: number, top: number, w: number, h: number, color: [number, number, number], text: string, textColor: [number, number, number] = [255, 255, 255]) => {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(x, top, w, h, 3, 3, 'F');
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    const splitText = doc.splitTextToSize(text, w - 10);
    const textHeight = splitText.length * 5;
    doc.text(splitText, x + (w / 2), top + (h / 2) - (textHeight / 2) + 4, { align: "center" });
    doc.setTextColor(0, 0, 0); // Reset
  };

  // Título
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Guia de Utilização - Tutorial Passo a Passo", pageWidth / 2, y, { align: "center" });
  y += 15;

  // 1. Carregamento
  checkOverflow(60);
  doc.setFontSize(14);
  doc.text("1. Carregamento do Documento", margin, y);
  y += 8;
  
  // Imagem 2 (Box Escuro)
  drawBox(margin, y, contentWidth, 30, [74, 34, 34], "Clique para selecionar ou arraste para esta área\no documento em PDF do SUMINFO");
  y += 35;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const step1Text = "Utilize a área de upload para inserir o arquivo SUMINFO. O programa processará automaticamente cada página, identificando cabeçalhos oficiais e separando cada ocorrência por número e data. Você também pode colar um texto copiado do PDF usando CTRL+V.";
  const splitS1 = doc.splitTextToSize(step1Text, contentWidth);
  doc.text(splitS1, margin, y);
  y += (splitS1.length * 6) + 10;

  // 2. Filtros
  checkOverflow(100);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("2. Seleção de Filtros (Simulação)", margin, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Selecione o tipo de extração. Abaixo, as opções como se estivessem selecionadas:", margin, y);
  y += 10;

  // Botão Crime Selecionado (Amarelo)
  drawBox(margin, y, (contentWidth / 2) - 5, 15, [234, 179, 8], "OCORRÊNCIAS COM CRIMES", [0, 0, 0]);
  // Botão Todas Selecionado (Amarelo)
  drawBox(margin + (contentWidth / 2) + 5, y, (contentWidth / 2) - 5, 15, [234, 179, 8], "TODAS AS OCORRÊNCIAS", [0, 0, 0]);
  y += 20;

  // Sub-opções Crime
  doc.setFont("helvetica", "bold");
  doc.text("Sub-opções para Ocorrências com Crimes:", margin, y);
  y += 8;
  drawBox(margin + 10, y, contentWidth - 20, 10, [234, 179, 8], "RELATÓRIO COMPLETO: Dados dos autores + Narrativa integral.", [0, 0, 0]);
  y += 14;
  drawBox(margin + 10, y, contentWidth - 20, 10, [234, 179, 8], "APENAS DADOS PESSOAIS: Lista otimizada (Nomes e CPFs).", [0, 0, 0]);
  y += 15;

  // 3. Execução
  checkOverflow(50);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("3. Execução e Download", margin, y);
  y += 8;

  const btnWidth = (contentWidth / 2) - 5;
  drawBox(margin, y, btnWidth, 15, [22, 163, 74], "Gerar Relatório");
  drawBox(margin + btnWidth + 10, y, btnWidth, 15, [220, 38, 38], "Realizar Nova Extração");
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const step3Text = "Clique em 'Gerar Relatório' para exportar o PDF oficial formatado. Use 'Realizar Nova Extração' para limpar o sistema e processar um novo documento.";
  const splitS3 = doc.splitTextToSize(step3Text, contentWidth);
  doc.text(splitS3, margin, y);
  y += (splitS3.length * 6) + 12;

  // 4. Customização
  checkOverflow(40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("4. Ajustes Visuais do PDF", margin, y);
  y += 8;
  
  doc.setFillColor(15, 23, 42); // bg-slate-900
  doc.roundedRect(margin, y, contentWidth, 25, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  const adjustText = "Utilize os seletores de cor e o botão NEGRITO para destacar dados pessoais e fatos. Cores vibrantes facilitam a leitura rápida em documentos impressos.";
  const splitAdj = doc.splitTextToSize(adjustText, contentWidth - 20);
  doc.text(splitAdj, margin + 10, y + 10);
  
  doc.save("Tutorial_Passo_a_Passo_Suminfo.pdf");
};
