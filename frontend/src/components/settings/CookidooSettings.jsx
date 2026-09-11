import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  Trash2, 
  AlertTriangle, 
  ShieldCheck, 
  Cookie, 
  KeyRound, 
  Database,
  UserCheck,
  UserX,
  Loader2,
  ZoomIn,
  Minus,
  Plus
} from 'lucide-react';

export default function CookidooSettings({ onOpenCookidoo }) {
  const [status, setStatus] = useState({
    isLoggedIn: false,
    userName: null,
    cookieCount: 0,
    isElectron: false
  });
  const [zoomFactor, setZoomFactor] = useState(() => {
    try {
      const saved = localStorage.getItem('cookidoo_zoom');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 0.3 && parsed <= 2.0) return parsed;
      }
    } catch (e) {}
    return 0.70;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [toast, setToast] = useState(null);

  const showToast = (type, message) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
  };

  // Lettura stato da server ed Electron IPC
  const fetchStatus = async (isManual = false) => {
    setIsLoading(true);
    let updated = { isLoggedIn: false, userName: null, cookieCount: 0, isElectron: false };

    // 1. Controlla prima via Electron IPC (se in esecuzione su desktop / Electron simulator)
    if (typeof window !== 'undefined' && window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        if (ipcRenderer) {
          const res = await ipcRenderer.invoke('cookidoo:get-status');
          if (res?.success) {
            updated.isElectron = true;
            updated.cookieCount = res.cookieCount || 0;
            if (res.hasAuthCookie) {
              updated.isLoggedIn = true;
            }
          }
        }
      } catch (e) {}
    }

    // 2. Leggi stato registrato dal server (tramite injector Cookidoo)
    try {
      const res = await fetch('/api/cookidoo/status');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.isLoggedIn) {
            updated.isLoggedIn = true;
            updated.userName = data.userName;
          }
          if (typeof data.cookieCount === 'number' && data.cookieCount > 0) {
            updated.cookieCount = data.cookieCount;
          }
        }
      }
    } catch (err) {}

    // 3. Leggi zoom configurato nel server
    try {
      const resSet = await fetch('/api/settings');
      if (resSet.ok) {
        const setJson = await resSet.json();
        if (setJson?.settings?.cookidooZoom) {
          const z = parseFloat(setJson.settings.cookidooZoom);
          if (!isNaN(z) && z >= 0.3 && z <= 2.0) {
            setZoomFactor(z);
          }
        }
      }
    } catch (e) {}

    setStatus(updated);
    setIsLoading(false);

    if (isManual) {
      if (updated.isLoggedIn) {
        showToast('success', `Accesso Cookidoo attivo (${updated.userName || 'Utente Cookidoo'})`);
      } else {
        showToast('info', 'Nessun account Cookidoo attualmente connesso');
      }
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // Aggiornamento livello di zoom
  const handleUpdateZoom = async (newZoom) => {
    const clamped = Math.min(1.20, Math.max(0.40, Math.round(newZoom * 100) / 100));
    setZoomFactor(clamped);
    try {
      localStorage.setItem('cookidoo_zoom', clamped.toString());
    } catch (e) {}

    // Notifica istantanea all'interno dell'applicazione React
    window.dispatchEvent(new CustomEvent('COOKIDOO_ZOOM_CHANGED', { detail: { zoom: clamped } }));

    // Se in Electron, aggiorna direttamente via IPC
    if (typeof window !== 'undefined' && window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        if (ipcRenderer) {
          await ipcRenderer.invoke('cookidoo:set-zoom', clamped);
        }
      } catch (e) {}
    }

    // Salva impostazione sul server Node per renderla persistente
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookidooZoom: clamped })
      });
      showToast('success', `Zoom impostato al ${Math.round(clamped * 100)}%`);
    } catch (e) {
      showToast('error', 'Errore salvataggio impostazione zoom');
    }
  };

  // Esecuzione eliminazione di tutti i dati e cookie
  const handleClearData = async () => {
    setIsClearing(true);
    try {
      // 1. Se in Electron, pulisci la sessione isolata persistente
      if (typeof window !== 'undefined' && window.require) {
        try {
          const { ipcRenderer } = window.require('electron');
          if (ipcRenderer) {
            await ipcRenderer.invoke('cookidoo:clear-data');
          }
        } catch (e) {
          console.warn('Errore chiamata Electron IPC:', e);
        }
      }

      // 2. Chiamata al server per resettare lo stato Cookidoo registrato
      await fetch('/api/cookidoo/clear-data', { method: 'POST' }).catch(() => {});

      // 3. Notifica l'interfaccia di Cookidoo (webview/iframe) di ricaricarsi pulita
      window.dispatchEvent(new CustomEvent('COOKIDOO_CLEAR_DATA'));

      // 4. Pulisci eventuale storage locale del client
      try {
        sessionStorage.removeItem('cookidoo_auth');
        localStorage.removeItem('cookidoo_auth');
      } catch (e) {}

      setStatus({
        isLoggedIn: false,
        userName: null,
        cookieCount: 0,
        isElectron: status.isElectron
      });

      setShowConfirmModal(false);
      showToast('success', 'Dati di navigazione e cookie eliminati con successo!');
    } catch (err) {
      console.error('Errore pulizia dati:', err);
      showToast('error', 'Si è verificato un errore durante la pulizia dei dati');
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc] text-gray-800 select-none overflow-y-auto pr-1 relative">
      
      {/* Toast Notifica */}
      {toast && (
        <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg border flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-2 duration-200 ${
          toast.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
            : toast.type === 'error'
              ? 'bg-red-50 text-red-800 border-red-200'
              : 'bg-blue-50 text-blue-800 border-blue-200'
        }`}>
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-[#00a651]" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-red-500" />}
          {toast.type === 'info' && <ShieldCheck className="w-4 h-4 text-blue-600" />}
          <span>{toast.message}</span>
        </div>
      )}

      <div className="flex flex-col gap-3 max-w-2xl mx-auto w-full py-1">
        
        {/* CARD 1: STATO ACCOUNT & ACCESSO */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center border shrink-0 ${
                status.isLoggedIn 
                  ? 'bg-green-50 border-green-100 text-[#00a651]' 
                  : 'bg-gray-50 border-gray-200 text-gray-400'
              }`}>
                {status.isLoggedIn ? <UserCheck className="w-6 h-6 stroke-[2.2]" /> : <UserX className="w-6 h-6 stroke-[2.2]" />}
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Stato Sessione Cookidoo
                </span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${status.isLoggedIn ? 'bg-[#00a651] animate-pulse' : 'bg-gray-300'}`} />
                  <span className="text-sm font-bold text-gray-900">
                    {status.isLoggedIn ? 'Accesso Eseguito' : 'Nessun Accesso Attivo'}
                  </span>
                </div>
              </div>
            </div>

            {/* Badge Stato */}
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
              status.isLoggedIn 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-gray-100 text-gray-600 border-gray-200'
            }`}>
              {status.isLoggedIn ? (status.userName || 'Account Connesso') : 'Ospite / Disconnesso'}
            </span>
          </div>

          <p className="text-xs text-gray-500 leading-relaxed">
            {status.isLoggedIn 
              ? 'Il tuo profilo Vorwerk Cookidoo è connesso. Le tue ricette create, i preferiti e le raccolte personalizzate sono sincronizzati con il Bimby.'
              : 'Non risulta alcun account Cookidoo attivo nel browser interno. Puoi accedere direttamente aprendo la sezione Ricette per visualizzare le tue raccolte.'}
          </p>

          <div className="flex items-center justify-between pt-1 border-t border-gray-100 gap-2">
            <button
              onClick={() => fetchStatus(true)}
              disabled={isLoading}
              className="px-3.5 py-2 rounded-xl bg-gray-50 hover:bg-gray-100 active:scale-95 border border-gray-200 text-gray-700 text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#00a651]' : 'text-gray-500'}`} />
              <span>{isLoading ? 'Verifica...' : 'Verifica Accesso'}</span>
            </button>

            {onOpenCookidoo && (
              <button
                onClick={onOpenCookidoo}
                className="px-4 py-2 rounded-xl bg-[#00a651] hover:bg-[#008f45] active:scale-95 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Apri Ricettario Cookidoo</span>
              </button>
            )}
          </div>
        </div>

        {/* CARD 2: ZOOM E DIMENSIONI VISUALIZZAZIONE */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                <ZoomIn className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 tracking-tight leading-none">
                  Zoom e Dimensioni Pagina Cookidoo
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Regola l'ingrandimento per adattare al meglio i pulsanti al display 800×480
                </p>
              </div>
            </div>

            <span className={`px-2.5 py-1 rounded-full text-xs font-bold border font-mono ${
              Math.round(zoomFactor * 100) === 70 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-blue-50 text-blue-700 border-blue-200'
            }`}>
              {Math.round(zoomFactor * 100)}% {Math.round(zoomFactor * 100) === 70 && '★ Consigliato'}
            </span>
          </div>

          {/* Stepper Touchscreen e Slider */}
          <div className="flex items-center justify-between bg-gray-50/80 border border-gray-200/80 rounded-2xl p-3 gap-3">
            <button
              onClick={() => handleUpdateZoom(zoomFactor - 0.05)}
              disabled={zoomFactor <= 0.40}
              className="w-11 h-11 rounded-xl bg-white hover:bg-gray-100 active:scale-95 border border-gray-200 flex items-center justify-center text-gray-700 shadow-2xs cursor-pointer disabled:opacity-40"
              title="Riduci zoom"
            >
              <Minus className="w-5 h-5 stroke-[2.5]" />
            </button>

            <div className="flex-1 flex flex-col items-center gap-1 px-1">
              <input
                type="range"
                min="0.40"
                max="1.20"
                step="0.05"
                value={zoomFactor}
                onChange={(e) => handleUpdateZoom(parseFloat(e.target.value))}
                className="w-full accent-[#00a651] cursor-pointer h-2 bg-gray-200 rounded-lg"
              />
              <div className="w-full flex justify-between text-[10px] font-bold text-gray-400 uppercase">
                <span>40% (Compatto)</span>
                <span className="text-[#00a651]">70% (Ideale TM31)</span>
                <span>120% (Grande)</span>
              </div>
            </div>

            <button
              onClick={() => handleUpdateZoom(zoomFactor + 0.05)}
              disabled={zoomFactor >= 1.20}
              className="w-11 h-11 rounded-xl bg-white hover:bg-gray-100 active:scale-95 border border-gray-200 flex items-center justify-center text-gray-700 shadow-2xs cursor-pointer disabled:opacity-40"
              title="Aumenta zoom"
            >
              <Plus className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>

          {/* Preset Rapidi Touch */}
          <div className="flex flex-col gap-1.5 pt-0.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Preset Consigliati:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {[0.50, 0.60, 0.70, 0.80, 0.90, 1.00].map((preset) => {
                const isSelected = Math.round(zoomFactor * 100) === Math.round(preset * 100);
                const isRecommended = Math.round(preset * 100) === 70;

                return (
                  <button
                    key={preset}
                    onClick={() => handleUpdateZoom(preset)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                      isSelected
                        ? 'bg-[#00a651] text-white border-[#008f45] shadow-xs scale-102'
                        : isRecommended
                          ? 'bg-green-50 hover:bg-green-100 text-emerald-800 border-green-200 font-bold'
                          : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                    }`}
                  >
                    {Math.round(preset * 100)}% {isRecommended && !isSelected && '★'}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* CARD 3: GESTIONE DATI DEL BROWSER & COOKIE */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shrink-0">
              <Database className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 tracking-tight leading-none">
                Dati di Navigazione e Cookie
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Gestione della memoria locale, cache e credenziali salvate nel browser
              </p>
            </div>
          </div>

          <p className="text-xs text-gray-600 leading-relaxed">
            Eliminando i dati memorizzati nel browser di Cookidoo verranno rimossi tutti i cookie di sessione, 
            le informazioni di accesso e la cache delle pagine. Questa operazione disconnetterà qualsiasi 
            account Cookidoo attivo e ripristinerà il browser alle condizioni iniziali.
          </p>

          {/* Tag riepilogativi elementi eliminati */}
          <div className="flex flex-wrap gap-2 py-1">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium">
              <Cookie className="w-3.5 h-3.5 text-amber-600" />
              <span>Cookie di navigazione</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium">
              <KeyRound className="w-3.5 h-3.5 text-blue-600" />
              <span>Token di accesso e sessione</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 text-xs font-medium">
              <Database className="w-3.5 h-3.5 text-purple-600" />
              <span>Cache locale e storage</span>
            </div>
          </div>

          {/* Pulsante Eliminazione */}
          <div className="pt-2 border-t border-gray-100">
            <button
              onClick={() => setShowConfirmModal(true)}
              className="w-full py-3 rounded-xl bg-red-50 hover:bg-red-100/90 active:scale-[0.99] border border-red-200 text-red-700 text-xs font-bold transition-all shadow-2xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-red-600" />
              <span>Elimina Tutti i Dati Salvati e Cookie</span>
            </button>
          </div>
        </div>

      </div>

      {/* MODALE CONFERMA ELIMINAZIONE DATI */}
      {showConfirmModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-200"
          onClick={() => !isClearing && setShowConfirmModal(false)}
        >
          <div 
            className="bg-white rounded-3xl p-5 max-w-sm w-full border border-gray-200 shadow-2xl flex flex-col gap-4 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 text-red-600 flex items-center justify-center mx-auto shrink-0">
              <AlertTriangle className="w-6 h-6 stroke-[2.2]" />
            </div>

            <div className="text-center">
              <h3 className="text-base font-bold text-gray-900 tracking-tight">
                Eliminare tutti i dati di Cookidoo?
              </h3>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                Verranno eliminati tutti i cookie di sessione, l'accesso all'account e la cache salvata. Dovrai effettuare nuovamente l'accesso a Cookidoo.
              </p>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={isClearing}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 active:scale-95 text-gray-700 text-xs font-bold transition-all shadow-2xs cursor-pointer disabled:opacity-50"
              >
                Annulla
              </button>
              <button
                onClick={handleClearData}
                disabled={isClearing}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isClearing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Eliminazione...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Elimina Ora</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
