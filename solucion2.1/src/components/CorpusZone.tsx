"use client";

import { useState } from "react";
import { UploadCloud, FileText, CheckCircle2, Loader2, X, Trash2 } from "lucide-react";
import { addDocumentToVectorStore, clearVectorStore, removeDocumentFromVectorStore } from "@/actions/localAi";

interface CorpusZoneProps {
  corpusFiles: {uri: string, displayName: string, name: string}[];
  setCorpusFiles: React.Dispatch<React.SetStateAction<{uri: string, displayName: string, name: string}[]>>;
}

export default function CorpusZone({ corpusFiles, setCorpusFiles }: CorpusZoneProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setIsUploading(true);
    setError(null);
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append("file", file);

    try {
      const result = await addDocumentToVectorStore(formData);
      if (result.success && result.uri) {
        setCorpusFiles((prev) => [...prev, { uri: result.uri!, displayName: result.displayName || "Documento", name: result.fileId! }]);
      } else {
        setError(result.error || "Error al subir el archivo.");
      }
    } catch (err: any) {
      setError(err.message || "Error desconocido.");
    } finally {
      setIsUploading(false);
      // Reset input
      e.target.value = "";
    }
  };

  const removeCorpus = async (uriToRemove: string) => {
    setCorpusFiles((prev) => prev.filter((file) => file.uri !== uriToRemove));
    await removeDocumentFromVectorStore(uriToRemove);
  };

  const handleClearCloud = async () => {
    if (!confirm("¿Estás seguro de que deseas eliminar TODOS los archivos? Esto borrará el corpus vectorizado en ChromaDB, limpiará los borradores en memoria y solicitará la limpieza en la nube de MinerU SaaS.")) return;
    
    setIsDeleting(true);
    setError(null);
    try {
      const result = await clearVectorStore();
      if (result.success) {
        setCorpusFiles([]); // Limpia la UI localmente
        alert(`Se han eliminado ${result.count} archivos correctamente de la nube.`);
      } else {
        setError(result.error || "Error al limpiar los archivos.");
      }
    } catch (err: any) {
      setError(err.message || "Error desconocido.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="w-full bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm p-6 mb-8 mt-4 transition-all hover:shadow-md">
      <div className="flex items-center space-x-3 mb-6 justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
            <CheckCircle2 size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-zinc-800 dark:text-zinc-100">Repositorio de Éxito (Corpus)</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Sube aquí los documentos aprobados previamente como referencia.</p>
          </div>
        </div>
        <button
          onClick={handleClearCloud}
          disabled={isDeleting}
          className="flex items-center space-x-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors border border-red-200 dark:border-red-800 disabled:opacity-50"
        >
          {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          <span className="text-sm font-medium">Vaciar Nube</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Upload Button */}
        <label className="border-2 border-dashed border-zinc-300 dark:border-zinc-700 rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:border-blue-500 transition-colors group h-full min-h-[160px]">
          {isUploading ? (
            <div className="text-blue-500 flex flex-col items-center">
              <Loader2 className="animate-spin mb-2" size={32} />
              <span className="text-sm font-medium">Subiendo...</span>
            </div>
          ) : (
            <>
              <UploadCloud className="text-zinc-400 group-hover:text-blue-500 mb-2 transition-colors" size={32} />
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">Añadir PDF al Corpus</span>
              <span className="text-xs text-zinc-400 mt-1">Arrastra o haz clic</span>
            </>
          )}
          <input type="file" accept="application/pdf" className="hidden" onChange={handleFileChange} disabled={isUploading} />
        </label>

        {/* Existing Corpus Files */}
        <div className="md:col-span-2">
          {corpusFiles.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-zinc-400 bg-zinc-50 dark:bg-zinc-800/20 rounded-xl border border-zinc-100 dark:border-zinc-800/50 min-h-[160px]">
              <FileText size={24} className="mb-2 opacity-50" />
              <p className="text-sm">Aún no hay documentos en el corpus.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 items-start content-start max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
              {corpusFiles.map((file, i) => (
                <div key={i} className="flex items-center space-x-2 bg-blue-50 dark:bg-zinc-800 border border-blue-100 dark:border-zinc-700 px-4 py-3 rounded-lg w-full shrink-0 group">
                  <FileText className="text-blue-500 shrink-0" size={18} />
                  <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200 truncate flex-1" title={file.displayName}>
                    {file.displayName}
                  </span>
                  <button
                    onClick={() => removeCorpus(file.uri)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 transition-all"
                    title="Remover de esta sesión"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {error && <p className="text-red-500 text-sm mt-4">{error}</p>}
    </div>
  );
}
