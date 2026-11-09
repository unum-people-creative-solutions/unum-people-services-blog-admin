"use client";

import { useState, useEffect } from "react";
import { X, Cookie } from "lucide-react";

// A política vigente: link de versão quebra quando a versão sai do ar.
const POLITICA_PRIVACIDADE_URL = "https://unumpeople.com.br/privacidade";

export default function CookieBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("cookie-consent");
    if (!consent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- o consentimento fica no localStorage, que só existe no navegador
      setShowBanner(true);
    }
  }, []);

  const handleConsent = (type: "all" | "essential") => {
    localStorage.setItem("cookie-consent", type);
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-2xl border border-gray-100 p-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-start gap-4">
          <div className="bg-primary-50 p-3 rounded-full hidden sm:block">
            <Cookie className="w-6 h-6 text-primary-600" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-gray-900 leading-none">Nós valorizamos sua privacidade</h3>
            <p className="text-sm text-gray-500 leading-relaxed">
              Guardamos no navegador só o necessário para manter seu login e lembrar esta escolha. 
              Não usamos cookies de análise de tráfego nem de publicidade. Saiba mais na{" "}
              <a href={POLITICA_PRIVACIDADE_URL} target="_blank" rel="noopener noreferrer" className="text-primary-600 font-semibold hover:underline">Política de Privacidade</a>.
            </p>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto shrink-0">
          <button
            onClick={() => handleConsent("essential")}
            className="px-6 py-2.5 text-sm font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
          >
            Somente Essenciais
          </button>
          <button
            onClick={() => handleConsent("all")}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-all shadow-md shadow-primary-200"
          >
            Aceitar Tudo
          </button>
        </div>

        <button 
          onClick={() => setShowBanner(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 md:static"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
