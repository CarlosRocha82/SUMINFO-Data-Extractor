
import React, { useState, useEffect } from 'react';
import { 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  ShieldCheck, 
  FileText, 
  UserCircle, 
  LayoutList, 
  BookOpen, 
  X,
  Palette,
  Printer,
  Bold,
  RefreshCw,
  MousePointer2,
  Info,
  ChevronRight
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { extractDataWithGemini } from './services/geminiService';
import { generateResultPDF, generateManualPDF } from './utils/pdfGenerator';
import { PoliceOccurrence, PDFStyleConfig, ReportSubType } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';

interface PageData {
  pageNum: number;
  text: string;
  startsNewOccurrence: boolean;
}

const App: React.FC = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PoliceOccurrence[] | null>(null);
  const [progress, setProgress] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [outputFilename, setOutputFilename] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [showManual, setShowManual] = useState(false);
  
  const [reportType, setReportType] = useState<'crimes' | 'all'>('crimes');
  const [reportSubType, setReportSubType] = useState<ReportSubType>('complete');
  
  const [pdfConfig, setPdfConfig] = useState<PDFStyleConfig>({
    separatorColor: '#000000',
    dataColor: '#FF0000',
    dataBold: true,
    factColor: '#0000FF',
    factBold: true
  });

  const brandColor = "#c1a562";

  const checkStartsNewOccurrence = (text: string): boolean => {
    let cleanText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    const headerTerms = [
      "RESERVADO",
      "GOVERNO DO ESTADO DO RIO DE JANEIRO",
      "SECRETARIA DE ESTADO DA POLICIA MILITAR",
      "SUBSECRETARIA DE INTELIGENCIA",
      "SUMARIO DE INFORMACOES"
    ];

    let checkArea = cleanText;
    headerTerms.forEach(term => {
      checkArea = checkArea.replace(term, "");
    });
    
    // Regex atualizada para detectar o padrão Número - Data Hora
    const occPattern = /^\s*\d{4,}\s*-\s*\d{2}\/\d{2}\/\d{4}/;
    return occPattern.test(checkArea.trim());
  };

  const readPdfPages = async (file: File): Promise<PageData[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const pages: PageData[] = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => (item as any).str).join(" ");
      
      pages.push({
        pageNum: i,
        text: pageText,
        startsNewOccurrence: checkStartsNewOccurrence(pageText)
      });

      setProgressPercent(Math.round((i / pdf.numPages) * 20));
      setProgress(`Mapeando página ${i} de ${pdf.numPages}...`);
    }
    return pages;
  };

  const processFile = async (file: File) => {
    if (file.type !== 'application/pdf') {
      setError('Por favor, selecione um arquivo PDF.');
      return;
    }
    setOutputFilename(`Relatório ${file.name.replace(/\.[^/.]+$/, "")}`);
    
    try {
      setIsProcessing(true);
      setError(null);
      setResults(null);
      setProgress('Analisando estrutura...');
      
      const pages = await readPdfPages(file);
      
      const chunks: PageData[][] = [];
      let currentChunk: PageData[] = [];
      let checkpoint = 20;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        if (page.pageNum > checkpoint && page.startsNewOccurrence && currentChunk.length > 0) {
          chunks.push(currentChunk);
          currentChunk = [page];
          checkpoint = page.pageNum + 19;
        } else {
          currentChunk.push(page);
        }
      }
      if (currentChunk.length > 0) chunks.push(currentChunk);

      let allOccurrences: PoliceOccurrence[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const subBatches: PageData[][] = [];
        const subBatchSize = 5;
        for (let j = 0; j < chunks[i].length; j += subBatchSize) {
          subBatches.push(chunks[i].slice(j, j + subBatchSize));
        }

        for (let k = 0; k < subBatches.length; k++) {
          setProgress("Processando o SUMINFO para extração de dados...");
          
          const text = subBatches[k].map(p => p.text).join("\n\n");
          const totalSubSteps = chunks.reduce((acc, c) => acc + Math.ceil(c.length / subBatchSize), 0);
          const currentStep = chunks.slice(0, i).reduce((acc, c) => acc + Math.ceil(c.length / subBatchSize), 0) + k;
          setProgressPercent(20 + Math.round((currentStep / totalSubSteps) * 80));

          try {
            const res = await extractDataWithGemini(text);
            allOccurrences = [...allOccurrences, ...res];
          } catch (batchErr: any) {
            console.error("Erro no sub-lote:", batchErr);
            if (batchErr.message.includes("IA")) {
               setError(`Falha na extração de alguns registros. Tente novamente ou use um arquivo menor.`);
            }
          }
        }
      }

      if (allOccurrences.length === 0) {
        setError('Nenhum dado pôde ser extraído com precisão.');
      } else {
        const unique = Array.from(new Map(allOccurrences.map(o => [o.id, o])).values());
        setResults(unique);
        setProgressPercent(100);
      }
    } catch (err) {
      setError('Erro crítico no processamento.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) processFile(file);
  };

  const handlePaste = async (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData('text');
    if (text && text.length > 20 && !isProcessing && !results) {
      try {
        setIsProcessing(true);
        setError(null);
        setProgress('Processando o SUMINFO para extração de dados...');
        const res = await extractDataWithGemini(text);
        if (res.length > 0) {
          setResults(res);
          setOutputFilename('Extração Manual');
        } else {
          setError('Nenhuma ocorrência identificada no texto.');
        }
      } catch (e) {
        setError('Erro na análise da IA.');
      } finally {
        setIsProcessing(false);
        setProgressPercent(100);
      }
    }
  };

  useEffect(() => {
    const pasteHandler = (e: ClipboardEvent) => handlePaste(e);
    window.addEventListener('paste', pasteHandler);
    return () => window.removeEventListener('paste', pasteHandler);
  }, [isProcessing, results]);

  const downloadPdf = async () => {
    if (!results) return;
    let filtered = reportType === 'crimes' ? results.filter(o => o.isCrime && !o.fact.toUpperCase().includes("ACIDENTE")) : results;
    if (filtered.length === 0) {
      alert('Nenhuma ocorrência atende aos filtros atuais.');
      return;
    }
    const doc = await generateResultPDF(filtered, { ...pdfConfig, reportSubType: reportType === 'crimes' ? reportSubType : 'complete' });
    doc.save(`${outputFilename}.pdf`);
  };

  const TutorialComp = () => (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-white text-black w-full max-w-5xl max-h-[95vh] overflow-y-auto rounded-3xl shadow-2xl flex flex-col border border-slate-200">
        <div className="sticky top-0 bg-slate-50 p-6 border-b border-slate-200 flex justify-between items-center z-10 rounded-t-3xl">
          <div className="flex items-center gap-3">
            <BookOpen className="text-yellow-600" size={32} />
            <h2 className="text-2xl font-black tracking-tight text-black">Tutorial de Utilização - Passo a Passo</h2>
          </div>
          <div className="flex gap-2">
            <button onClick={generateManualPDF} className="flex items-center gap-2 bg-slate-900 text-white px-5 py-2.5 rounded-xl hover:bg-slate-800 transition-all text-sm font-bold shadow-md">
              <Printer size={18} /> Imprimir Tutorial
            </button>
            <button onClick={() => setShowManual(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-black">
              <X size={26} />
            </button>
          </div>
        </div>
        
        <div className="p-8 md:p-12 space-y-12 bg-white">
          {/* Passo 1: Carregamento */}
          <section className="space-y-6">
            <div className="flex items-center gap-4">
              <span className="bg-slate-900 text-white w-10 h-10 rounded-full flex items-center justify-center font-black text-xl">1</span>
              <h3 className="text-2xl font-black uppercase tracking-tighter text-black">Carregamento do Documento</h3>
            </div>
            <div className="bg-slate-50 p-8 rounded-3xl border border-slate-200 flex flex-col md:flex-row gap-8 items-center">
              <div className="w-full md:w-1/2 min-h-48 border-2 border-dashed border-white/20 rounded-2xl flex flex-col items-center justify-center bg-[#4a2222] p-8 shadow-2xl">
                <p className="text-xl md:text-2xl text-white font-bold text-center leading-snug">
                  Clique para selecionar ou arraste para esta área<br/>
                  o documento em PDF do SUMINFO
                </p>
              </div>
              <div className="flex-1 space-y-4">
                <p className="text-black leading-relaxed font-medium">
                  Utilize a área de upload para inserir o arquivo <strong>SUMINFO</strong>. O programa processará automaticamente cada página, identificando cabeçalhos oficiais e separando cada ocorrência por número e data.
                </p>
                <div className="flex items-center gap-2 text-yellow-600 font-bold text-sm bg-yellow-50 p-3 rounded-lg border border-yellow-100">
                   <Info size={18} />
                   <span className="text-black font-semibold">Dica: Você também pode colar um texto copiado do PDF usando CTRL+V.</span>
                </div>
              </div>
            </div>
          </section>

          {/* Passo 2: Filtros */}
          <section className="space-y-6">
            <div className="flex items-center gap-4">
              <span className="bg-slate-900 text-white w-10 h-10 rounded-full flex items-center justify-center font-black text-xl">2</span>
              <h3 className="text-2xl font-black uppercase tracking-tighter text-black">Seleção de Filtros (Simulação)</h3>
            </div>
            <p className="text-black font-medium">Selecione o tipo de extração. No tutorial abaixo, todos os botões estão representados como se estivessem <strong>selecionados (em amarelo)</strong> para demonstrar as opções disponíveis:</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Box Crimes */}
              <div className="space-y-4">
                <div className="w-full py-6 px-4 rounded-xl border-2 border-yellow-400 bg-yellow-500 text-black shadow-lg flex flex-col items-center justify-center gap-2 font-black text-lg">
                  <ShieldCheck size={32} />
                  OCORRÊNCIAS COM CRIMES
                </div>
                <div className="pl-4 border-l-4 border-yellow-500 space-y-4">
                   <p className="text-sm text-black font-medium">Filtra fatos criminais, ocultando acidentes administrativos ou extravios. Ao escolher esta opção, você deve definir o nível de detalhe:</p>
                   <div className="flex flex-col gap-2">
                     <div className="flex items-center justify-center gap-3 p-4 bg-yellow-500 border-2 border-yellow-400 text-black rounded-xl font-black text-sm shadow-md">
                        <LayoutList size={20} /> RELATÓRIO COMPLETO
                     </div>
                     <p className="text-[11px] text-black font-bold italic pl-2">Gera o documento com dados dos autores e a narrativa integral da ocorrência.</p>
                     
                     <div className="flex items-center justify-center gap-3 p-4 bg-yellow-500 border-2 border-yellow-400 text-black rounded-xl font-black text-sm shadow-md">
                        <UserCircle size={20} /> APENAS DADOS PESSOAIS
                     </div>
                     <p className="text-[11px] text-black font-bold italic pl-2">Gera uma lista otimizada contendo apenas Nomes e CPFs, ocultando a narrativa.</p>
                   </div>
                </div>
              </div>

              {/* Box Geral */}
              <div className="space-y-4">
                <div className="w-full py-6 px-4 rounded-xl border-2 border-yellow-400 bg-yellow-500 text-black shadow-lg flex items-center justify-center gap-3 font-black text-lg h-fit">
                  <FileText size={32} />
                  TODAS AS OCORRÊNCIAS
                </div>
                <div className="pl-4 border-l-4 border-slate-300 space-y-4">
                   <p className="text-sm text-black font-medium leading-relaxed">
                     Extrai <strong>todo o conteúdo identificado</strong> no documento original, sem qualquer filtro de natureza. Ideal para conferência bruta de todos os registros (incluindo acidentes e ocorrências administrativas).
                   </p>
                </div>
              </div>
            </div>
          </section>

          {/* Passo 3: Finalização */}
          <section className="space-y-6">
            <div className="flex items-center gap-4">
              <span className="bg-slate-900 text-white w-10 h-10 rounded-full flex items-center justify-center font-black text-xl">3</span>
              <h3 className="text-2xl font-black uppercase tracking-tighter text-black">Execução e Download</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-green-50 rounded-3xl border-2 border-green-200 space-y-4 flex flex-col items-center text-center">
                 <div className="bg-green-600 text-white p-4 rounded-2xl shadow-xl flex items-center justify-center gap-3 font-black text-lg w-full">
                   <Download size={24} strokeWidth={3} /> Gerar Relatório
                 </div>
                 <p className="text-sm font-bold text-black">
                   Clique aqui para converter os dados filtrados em um arquivo PDF oficial. O documento gerado incluirá carimbos de "RESERVADO" e as formatações de cores que você configurou.
                 </p>
              </div>

              <div className="p-6 bg-red-50 rounded-3xl border-2 border-red-200 space-y-4 flex flex-col items-center text-center">
                 <div className="bg-red-600 text-white p-4 rounded-2xl shadow-xl flex items-center justify-center gap-3 font-black text-lg w-full">
                   <RefreshCw size={24} /> Realizar Nova Extração
                 </div>
                 <p className="text-sm font-bold text-black">
                   Este botão apaga todos os registros atuais do sistema e retorna para a tela inicial, permitindo que você processe um novo arquivo SUMINFO.
                 </p>
              </div>
            </div>
          </section>

          {/* Tutorial Customização */}
          <section className="bg-slate-50 border border-slate-200 p-8 rounded-3xl space-y-6">
             <div className="flex items-center gap-3 text-black">
                <Palette size={28} />
                <h3 className="text-xl font-black uppercase">Ajustes Visuais do PDF</h3>
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-2">
                   <h4 className="font-black text-xs uppercase text-black">Cores Dinâmicas</h4>
                   <p className="text-sm text-black font-medium">Utilize os seletores de cor para definir como os <strong>DADOS PESSOAIS</strong> e o <strong>FATO</strong> serão destacados. Isso ajuda na identificação visual rápida durante a leitura.</p>
                </div>
                <div className="space-y-2">
                   <h4 className="font-black text-xs uppercase text-black">Estilo Negrito</h4>
                   <p className="text-sm text-black font-medium">Ative ou desative o <strong>NEGRITO</strong> para as informações principais. O uso de negrito em cores vibrantes melhora significativamente a visibilidade em impressões.</p>
                </div>
             </div>
          </section>
        </div>

        <div className="p-8 border-t border-slate-200 flex justify-center bg-slate-100 rounded-b-3xl">
          <button onClick={() => setShowManual(false)} className="bg-slate-900 text-white font-black px-16 py-5 rounded-2xl shadow-2xl uppercase text-lg hover:scale-105 transition-transform active:scale-95 flex items-center gap-3">
             Começar agora <ChevronRight size={24} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {showManual && <TutorialComp />}
      <div className="max-w-4xl w-full">
        <div className="flex flex-col items-center mb-8 select-none text-white">
          <div className="flex flex-row items-baseline gap-3">
            <h1 className="text-5xl md:text-7xl font-sans font-black uppercase tracking-tight">SUMINFO</h1>
            <span className="text-4xl md:text-6xl font-sans font-normal italic opacity-90">Data Extractor</span>
          </div>
          <div className="flex justify-center gap-2 mt-4" style={{ color: brandColor }}>
             <div className="flex items-center justify-center w-8 h-8 md:w-11 md:h-11 border-[3px] md:border-[4px] rounded-lg md:rounded-xl" style={{ borderColor: brandColor }}>
                <span className="text-xl md:text-3xl font-sans font-black">C</span>
             </div>
             <div className="flex items-center justify-center w-8 h-8 md:w-11 md:h-11 border-[3px] md:border-[4px] rounded-lg md:rounded-xl" style={{ borderColor: brandColor }}>
                <span className="text-xl md:text-3xl font-sans font-black">R</span>
             </div>
          </div>
        </div>

        <div className="bg-card rounded-3xl border border-white/10 shadow-2xl p-8 md:p-12 overflow-hidden relative">
          {!results && !isProcessing && (
            <div className="flex flex-col items-center justify-center space-y-8">
              <label 
                htmlFor="file-upload" 
                className={`w-full h-72 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all border-white/20 hover:bg-white/5 ${isDragging ? 'border-yellow-500 bg-white/10' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) processFile(file); }}
              >
                <div className="text-center px-4 space-y-2">
                  <p className="text-2xl md:text-3xl text-white font-semibold">Clique para selecionar ou arraste para esta área</p>
                  <p className="text-2xl md:text-3xl text-white font-semibold">o documento em PDF do SUMINFO</p>
                </div>
                <input id="file-upload" type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} />
              </label>
              {error && <div className="text-red-400 bg-red-400/10 px-4 py-3 rounded-xl border border-red-400/20 text-sm flex items-center gap-2"><AlertCircle size={18} /> {error}</div>}
              
              <button 
                onClick={() => setShowManual(true)} 
                className="text-yellow-500 hover:text-yellow-400 font-black text-lg md:text-xl flex items-center gap-3 transition-colors"
              >
                <BookOpen size={24} /> Tutorial
              </button>
            </div>
          )}

          {isProcessing && (
            <div className="flex flex-col items-center justify-center py-12 space-y-8">
              <div className="w-24 h-24 border-4 border-white/10 border-t-yellow-500 rounded-full animate-spin"></div>
              <div className="w-full max-w-md space-y-6 text-center">
                <div className="min-h-[4rem] flex flex-col justify-center items-center">
                  {progress === "Processando o SUMINFO para extração de dados..." ? (
                    <div className="space-y-1">
                      <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Processando o SUMINFO</h3>
                      <p className="text-lg text-white/80 font-medium">para extração de dados...</p>
                    </div>
                  ) : (
                    <h3 className="text-xl font-bold tracking-tight whitespace-nowrap overflow-hidden text-ellipsis text-white">
                      {progress}
                    </h3>
                  )}
                </div>
                <div className="w-full bg-white/10 h-4 rounded-full overflow-hidden border border-white/5">
                  <div className="h-full bg-yellow-500 transition-all duration-500" style={{ width: `${progressPercent}%` }}></div>
                </div>
                <span className="text-2xl font-black text-yellow-500 font-orbitron">{progressPercent}%</span>
              </div>
            </div>
          )}

          {results && !isProcessing && (
            <div className="space-y-8">
              <div className="bg-white/5 p-6 rounded-2xl border border-white/10 space-y-8">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-500/20 rounded-xl"><CheckCircle2 className="w-8 h-8 text-green-400" /></div>
                  <div><h3 className="text-xl font-bold">Extração concluída</h3><p className="text-white/60 text-sm">{results.length} ocorrências identificadas.</p></div>
                </div>

                <div className="space-y-4 max-w-2xl mx-auto">
                  <div className="flex flex-col md:flex-row gap-4">
                    <button 
                      onClick={() => setReportType('crimes')} 
                      className={`flex-[1.5] py-6 px-4 rounded-xl border transition-all text-xl font-black flex flex-col items-center justify-center gap-2 ${reportType === 'crimes' ? 'bg-yellow-500 border-yellow-400 text-black shadow-lg scale-[1.02]' : 'bg-white/5 border-white/10 text-white hover:bg-white/10'}`}
                    >
                      <ShieldCheck size={28} />
                      Ocorrências com Crimes
                    </button>
                    
                    <div className="flex-1 flex flex-col gap-2">
                      <button 
                        onClick={() => { setReportType('crimes'); setReportSubType('complete'); }} 
                        className={`flex-1 p-3 rounded-xl border text-xl font-black transition-all flex items-center justify-center gap-3 ${reportType === 'crimes' && reportSubType === 'complete' ? 'bg-yellow-500 border-yellow-400 text-black shadow-md' : 'bg-white/5 border-white/10 text-white/60 hover:text-white'}`}
                      >
                        <LayoutList size={20} /> Relatório Completo
                      </button>
                      <button 
                        onClick={() => { setReportType('crimes'); setReportSubType('personal_data_only'); }} 
                        className={`flex-1 p-3 rounded-xl border text-xl font-black transition-all flex items-center justify-center gap-3 ${reportType === 'crimes' && reportSubType === 'personal_data_only' ? 'bg-yellow-500 border-yellow-400 text-black shadow-md' : 'bg-white/5 border-white/10 text-white/60 hover:text-white'}`}
                      >
                        <UserCircle size={20} /> Apenas Dados Pessoais
                      </button>
                    </div>
                  </div>

                  <button 
                    onClick={() => setReportType('all')} 
                    className={`w-full py-5 px-4 rounded-xl border transition-all text-xl font-black flex items-center justify-center gap-3 ${reportType === 'all' ? 'bg-yellow-500 border-yellow-400 text-black shadow-lg' : 'bg-white/5 border-white/10 text-white hover:bg-white/10'}`}
                  >
                    <FileText size={28} /> Todas as Ocorrências
                  </button>
                </div>

                <div className="flex flex-col md:flex-row gap-4 max-w-2xl mx-auto">
                  <button 
                    onClick={downloadPdf} 
                    className="flex-1 bg-green-600 hover:bg-green-500 text-white font-black px-4 py-4 rounded-2xl transition-all shadow-2xl flex items-center justify-center gap-3 text-lg tracking-tighter active:scale-[0.98]"
                  >
                    <Download size={20} strokeWidth={3} /> Gerar Relatório
                  </button>
                  <button 
                    onClick={() => setResults(null)} 
                    className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-4 rounded-2xl transition-all shadow-lg flex items-center justify-center gap-3 text-lg tracking-tighter"
                  >
                    <RefreshCw size={20} /> Realizar Nova Extração
                  </button>
                </div>

                <div className="space-y-6 bg-white rounded-2xl p-6 shadow-inner border border-white/20">
                   <div className="flex items-center gap-3 mb-4 text-black font-bold text-xl">
                      <Palette size={24} />
                      <h4 className="uppercase">Ajustes Visuais do PDF</h4>
                   </div>
                   
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                      <div className="space-y-3">
                        <label className="text-xs font-bold text-black uppercase block">COR DO FATO:</label>
                        <div className="flex gap-2">
                          <input type="color" value={pdfConfig.factColor} onChange={(e) => setPdfConfig({...pdfConfig, factColor: e.target.value})} className="h-10 w-full bg-white cursor-pointer rounded-lg border border-black/10" />
                          <button onClick={() => setPdfConfig({...pdfConfig, factBold: !pdfConfig.factBold})} className={`px-4 rounded-lg flex items-center gap-2 text-[10px] font-black transition-all ${pdfConfig.factBold ? 'bg-black text-white' : 'bg-black/5 text-black/40 border border-black/10'}`}>
                            <Bold size={14} /> NEGRITO
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="text-xs font-bold text-black uppercase block">COR DOS DADOS:</label>
                        <div className="flex gap-2">
                          <input type="color" value={pdfConfig.dataColor} onChange={(e) => setPdfConfig({...pdfConfig, dataColor: e.target.value})} className="h-10 w-full bg-white cursor-pointer rounded-lg border border-black/10" />
                          <button onClick={() => setPdfConfig({...pdfConfig, dataBold: !pdfConfig.dataBold})} className={`px-4 rounded-lg flex items-center gap-2 text-[10px] font-black transition-all ${pdfConfig.dataBold ? 'bg-black text-white' : 'bg-black/5 text-black/40 border border-black/10'}`}>
                            <Bold size={14} /> NEGRITO
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3 md:col-span-2">
                        <label className="text-xs font-bold text-black uppercase block">COR DA LINHA DIVISÓRIA:</label>
                        <input type="color" value={pdfConfig.separatorColor} onChange={(e) => setPdfConfig({...pdfConfig, separatorColor: e.target.value})} className="h-10 w-full bg-white cursor-pointer rounded-lg border border-black/10" />
                      </div>
                   </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
