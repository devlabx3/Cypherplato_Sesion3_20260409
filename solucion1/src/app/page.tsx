"use client";

import { useState, useEffect } from "react";
import CorpusZone from "@/components/CorpusZone";
import AnalyzerZone from "@/components/AnalyzerZone";
import { Sparkles, Activity } from "lucide-react";
import { checkGeminiConnection, listGoogleAIFiles } from "@/actions/googleAi";

export default function Home() {
  // Estado elevado para que ambos componentes puedan interactuar si fuera necesario
  // o para que el analizador sepa qué corpus existe.
  const [corpusFiles, setCorpusFiles] = useState<{uri: string, displayName: string, name: string}[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<"checking" | "connected" | "error">("checking");

  useEffect(() => {
    async function verifyConnection() {
      const res = await checkGeminiConnection();
      if (res.success) {
        setConnectionStatus("connected");
        // Una vez comprobada la conexión, cargamos los archivos del RAG
        const filesRes = await listGoogleAIFiles();
        if (filesRes.success && filesRes.files) {
          setCorpusFiles(filesRes.files);
        }
      } else {
        setConnectionStatus("error");
      }
    }
    verifyConnection();
  }, []);

  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 font-[family-name:var(--font-geist-sans)]">
      {/* Header */}
      <header className="w-full bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-10 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center space-x-3">
          <div className="bg-gradient-to-br from-blue-500 to-purple-600 p-2 text-white rounded-xl shadow-lg shadow-blue-500/20">
            <Sparkles size={24} />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400">
              Validador Platohedro
            </h1>
            <p className="text-xs font-semibold text-zinc-500 tracking-wider uppercase">Zero-Infra RAG con Gemini 2.5 Flash Lite</p>
          </div>
          {/* Indicador de Conexión */}
          <div className="flex items-center space-x-2 bg-zinc-100 dark:bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-200 dark:border-zinc-700">
            <Activity size={14} className="text-zinc-500" />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Gemini:</span>
            {connectionStatus === "checking" && (
               <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse" title="Verificando conexión..."></span>
            )}
            {connectionStatus === "connected" && (
               <div className="relative flex h-2.5 w-2.5" title="Conexión verificada">
                 <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                 <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
               </div>
            )}
            {connectionStatus === "error" && (
               <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" title="Error de conexión"></span>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Areas */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        
        {/* Double-Zone UI */}
        <div className="flex flex-col space-y-8">
          {/* Zona Superior: Repositorio de Éxito */}
          <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CorpusZone corpusFiles={corpusFiles} setCorpusFiles={setCorpusFiles} />
          </section>

          {/* Zona Inferior: Analizador */}
          <section className="animate-in fade-in slide-in-from-bottom-8 duration-700 delay-150 fill-mode-both">
            <AnalyzerZone corpusUris={corpusFiles.map(f => f.uri)} />
          </section>
        </div>
      </div>
    </main>
  );
}
