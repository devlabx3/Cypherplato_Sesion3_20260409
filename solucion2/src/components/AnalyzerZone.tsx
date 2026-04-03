"use client";

import { useState } from "react";
import { Upload, AlertCircle, FileText, CheckCircle, Search, Loader2, MessageSquare, Send } from "lucide-react";
import { uploadDraft, analyzeDraft, chatWithModel } from "@/actions/googleAi";

interface AnalyzerZoneProps {
  corpusUris: string[];
}

interface AnalysisResult {
  resultado: string;
  puntuacion: number;
  pilares: {
    desgloseRubros: { calificacion: string; comentario: string };
    impactoTerritorial: { calificacion: string; comentario: string };
    cronograma: { calificacion: string; comentario: string };
    calidadTecnica: { calificacion: string; comentario: string };
  };
  feedbackGeneral: string;
}

export default function AnalyzerZone({ corpusUris }: AnalyzerZoneProps) {
  const [draftUri, setDraftUri] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);

  const handleUploadNewDraft = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    // Al cargar nuevo archivo, limpia el historial y archivo anterior
    setDraftUri(null);
    setResult(null);
    setError(null);
    setChatMessages([]);
    setIsUploading(true);

    const file = e.target.files[0];
    const fileName = file.name;
    setDraftName(fileName);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await uploadDraft(formData);
      if (res.success && res.uri) {
        setDraftUri(res.uri);
      } else {
        setError(res.error || "Error subiendo el borrador.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!draftUri) return;
    if (corpusUris.length === 0) {
      setError("Necesitas al menos un documento en el Corpus para comparar.");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await analyzeDraft(draftUri, corpusUris, draftName || "borrador.pdf");
      if (res.success && res.data) {
        setResult(res.data);
      } else {
        setError(res.error || "Error en el análisis.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!draftUri || !chatInput.trim() || isChatting) return;
    
    const userMessage = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsChatting(true);

    try {
      const res = await chatWithModel(userMessage, chatMessages, draftUri, corpusUris);
      if (res.success && res.data) {
        setChatMessages(prev => [...prev, { role: "assistant", content: res.data }]);
      } else {
        setChatMessages(prev => [...prev, { role: "assistant", content: `Error: ${res.error}` }]);
      }
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setIsChatting(false);
    }
  };

  return (
    <div className="w-full bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
      <div className="border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 p-6 flex flex-col md:flex-row md:items-center justify-between">
        <div className="flex items-center space-x-3 mb-4 md:mb-0">
          <div className="p-3 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl">
            <Search size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">Analizador de Propuesta</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Evalúa un borrador contra el corpus actual (Zero-Infra RAG).</p>
          </div>
        </div>

        <div>
           <label className="relative inline-flex items-center justify-center px-6 py-3 font-medium text-white transition-all bg-zinc-900 dark:bg-white dark:text-zinc-900 rounded-lg cursor-pointer hover:bg-zinc-800 dark:hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed">
            {isUploading ? (
              <>
                <Loader2 className="mr-2 animate-spin" size={18} /> Subiendo...
              </>
            ) : (
              <>
                <Upload className="mr-2" size={18} /> Subir Nuevo Borrador
              </>
            )}
            <input type="file" accept="application/pdf" className="hidden" onChange={handleUploadNewDraft} disabled={isUploading || isAnalyzing} />
          </label>
        </div>
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl border border-red-100 dark:border-red-900/50 flex items-start space-x-3">
            <AlertCircle className="shrink-0 mt-0.5" size={20} />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {!draftUri && !isUploading && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <FileText size={48} className="mb-4 opacity-20" />
            <p className="text-lg font-medium text-zinc-500 dark:text-zinc-400">Ningún borrador cargado</p>
            <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-2">Sube un archivo PDF para comenzar el análisis</p>
          </div>
        )}

        {draftUri && !result && !isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mb-4">
              <FileText size={32} />
            </div>
            <h3 className="text-xl font-bold mb-2 text-zinc-800 dark:text-zinc-100">{draftName}</h3>
            <p className="text-zinc-500 dark:text-zinc-400 mb-8">Borrador cargado correctamente. Listo para el escrutinio.</p>
            <button
              onClick={handleAnalyze}
              className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl shadow-lg shadow-blue-600/20 transition-all flex items-center"
            >
              <Search className="mr-2" size={20} /> Iniciar Análisis con Gemini
            </button>
          </div>
        )}

        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full border-t-2 border-blue-500 animate-spin"></div>
              <div className="absolute inset-2 rounded-full border-r-2 border-purple-500 animate-spin flex items-center justify-center">
                <Search className="text-blue-500 animate-pulse" size={20} />
              </div>
            </div>
            <p className="mt-6 text-zinc-600 dark:text-zinc-300 font-medium">Gemini 2.5 Flash-Lite analizando...</p>
            <p className="text-sm text-zinc-400 mt-1">Comparando con el estándar de Platohedro</p>
          </div>
        )}

        {result && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row gap-6 mb-8">
              {/* Score Card */}
              <div className={`flex flex-col items-center justify-center p-8 rounded-2xl w-full md:w-1/3 border-2 ${
                result.resultado === "Aprobado" ? "border-green-500 bg-green-50 dark:bg-green-900/10 text-green-700 dark:text-green-400" :
                result.resultado === "Ajustar" ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/10 text-yellow-700 dark:text-yellow-400" :
                "border-red-500 bg-red-50 dark:bg-red-900/10 text-red-700 dark:text-red-400"
              }`}>
                <span className="text-6xl font-black mb-2">{result.puntuacion}</span>
                <span className="text-xl font-bold uppercase tracking-wider">{result.resultado}</span>
              </div>
              
              {/* General Feedback */}
              <div className="bg-zinc-50 dark:bg-zinc-800/50 p-6 rounded-2xl w-full md:w-2/3 border border-zinc-200 dark:border-zinc-700">
                <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100 mb-2">Comentario General</h3>
                <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed">{result.feedbackGeneral}</p>
              </div>
            </div>

            <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100 mb-6 flex items-center">
              <CheckCircle className="mr-2 text-zinc-400" size={20} />
              Evaluación de los 4 Pilares
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <PillarCard title="1. Desglose de Rubros" calificacion={result.pilares.desgloseRubros.calificacion} comentario={result.pilares.desgloseRubros.comentario} />
              <PillarCard title="2. Impacto Territorial" calificacion={result.pilares.impactoTerritorial.calificacion} comentario={result.pilares.impactoTerritorial.comentario} />
              <PillarCard title="3. Cronograma" calificacion={result.pilares.cronograma.calificacion} comentario={result.pilares.cronograma.comentario} />
              <PillarCard title="4. Calidad Técnica" calificacion={result.pilares.calidadTecnica.calificacion} comentario={result.pilares.calidadTecnica.comentario} />
            </div>

            {/* Chat section */}
            <div className="mt-12 pt-8 border-t border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center space-x-3 mb-6">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg">
                  <MessageSquare size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-800 dark:text-zinc-100">Preguntas Abiertas</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Pregunta al modelo sobre el documento usando el corpus como referencia.</p>
                </div>
              </div>

              <div className="bg-zinc-50 dark:bg-zinc-800/30 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col h-[400px]">
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-zinc-400 dark:text-zinc-500 italic text-sm">
                      Envía un mensaje para comenzar la conversación...
                    </div>
                  ) : (
                    chatMessages.map((msg, i) => (
                      <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                          msg.role === "user" 
                            ? "bg-blue-600 text-white rounded-br-none" 
                            : "bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 rounded-bl-none"
                        }`}>
                          <div className="whitespace-pre-wrap">{msg.content}</div>
                        </div>
                      </div>
                    ))
                  )}
                  {isChatting && (
                    <div className="flex justify-start">
                      <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl rounded-bl-none px-4 py-3 flex items-center space-x-2">
                        <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce delay-75"></div>
                        <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce delay-150"></div>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="p-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 rounded-b-xl flex items-end space-x-2">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    placeholder="Escribe tu duda sobre el borrador analizado..."
                    className="flex-1 max-h-32 min-h-[44px] bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
                    rows={1}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!chatInput.trim() || isChatting}
                    className="p-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 text-white rounded-xl transition-colors flex-shrink-0"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PillarCard({ title, calificacion, comentario }: { title: string, calificacion: string, comentario: string }) {
  const isGood = calificacion.toLowerCase() === "bien";
  const isAvg = calificacion.toLowerCase() === "regular";

  return (
    <div className="p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-zinc-800 dark:text-zinc-200">{title}</h4>
        <span className={`text-xs font-bold px-2 py-1 rounded-full ${
          isGood ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
          isAvg ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" :
          "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
        }`}>
          {calificacion}
        </span>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{comentario}</p>
    </div>
  );
}
