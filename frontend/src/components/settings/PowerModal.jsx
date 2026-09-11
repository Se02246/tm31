import React, { useState, useEffect } from 'react';
import { socket } from '../../socket';
import { 
  Power, 
  RotateCw, 
  Zap, 
  AlertTriangle, 
  X, 
  CheckCircle2, 
  ShieldCheck, 
  Lock, 
  Unlock 
} from 'lucide-react';

export default function PowerModal({ isOpen, onClose, isCooking = false }) {
  const [selectedAction, setSelectedAction] = useState(null); // 'shutdown' | 'reboot' | 'restart_app'
  const [isConfirming, setIsConfirming] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [progressData, setProgressData] = useState({
    stage: 'idle',
    progress: 0,
    message: ''
  });

  useEffect(() => {
    const handlePowerProgress = (data) => {
      if (!data) return;
      setProgressData({
        stage: data.stage || 'idle',
        progress: data.progress || 0,
        message: data.message || ''
      });
    };

    socket.on('POWER_PROGRESS', handlePowerProgress);
    return () => {
      socket.off('POWER_PROGRESS', handlePowerProgress);
    };
  }, []);

  if (!isOpen) return null;

  const handleSelectAction = (action) => {
    setSelectedAction(action);
    setIsConfirming(true);
  };

  const handleConfirmAction = async () => {
    if (!selectedAction) return;
    setIsExecuting(true);
    setIsConfirming(false);
    setProgressData({
      stage: 'stopping_motor',
      progress: 20,
      message: 'Avvio procedura di sicurezza...'
    });

    try {
      const res = await fetch('/api/system/power', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: selectedAction })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Errore durante l\'esecuzione del comando.');
        setIsExecuting(false);
      }
    } catch (err) {
      console.error('[POWER] Errore richiesta spegnimento:', err);
    }
  };

  // SCHERMATA DI AVANZAMENTO DELLA PROCEDURA DI SICUREZZA
  if (isExecuting) {
    const isDone = progressData.progress === 100;

    return (
      <div className="fixed inset-0 z-50 bg-[#0f172a] text-white flex flex-col items-center justify-center p-6 select-none animate-in fade-in duration-300">
        <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-6 shadow-2xl relative ${
          isDone ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-rose-500/10 border border-rose-500/30'
        }`}>
          {isDone ? (
            <CheckCircle2 className="w-10 h-10 text-emerald-400 animate-in zoom-in-50 duration-300" />
          ) : (
            <RotateCw className="w-10 h-10 text-rose-400 animate-spin" />
          )}
          <div className={`absolute inset-0 rounded-3xl blur-xl -z-10 animate-pulse ${
            isDone ? 'bg-emerald-500/20' : 'bg-rose-500/20'
          }`} />
        </div>

        <h2 className="text-2xl font-bold tracking-tight mb-2 text-center text-white">
          {selectedAction === 'shutdown' && 'Spegnimento del Bimby in corso'}
          {selectedAction === 'reboot' && 'Riavvio del Sistema in corso'}
          {selectedAction === 'restart_app' && 'Riavvio Software in corso'}
        </h2>

        <p className="text-sm text-gray-400 max-w-md text-center leading-relaxed mb-6">
          {progressData.message || 'Esecuzione sequenza hardware di sicurezza...'}
        </p>

        {/* Barra di Avanzamento */}
        <div className="w-full max-w-md bg-slate-800 rounded-full h-2 overflow-hidden mb-4 border border-slate-700/50">
          <div 
            className="bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 h-full transition-all duration-500"
            style={{ width: `${progressData.progress}%` }}
          />
        </div>

        {/* Fasi di sicurezza visuali */}
        <div className="flex items-center justify-center gap-3 text-xs text-gray-400 font-medium">
          <span className={`flex items-center gap-1 ${progressData.progress >= 25 ? 'text-emerald-400 font-bold' : ''}`}>
            {progressData.progress >= 25 ? '✓' : '•'} Arresto Lame
          </span>
          <span>›</span>
          <span className={`flex items-center gap-1 ${progressData.progress >= 50 ? 'text-emerald-400 font-bold' : ''}`}>
            {progressData.progress >= 50 ? '✓' : '•'} Inerzia Lame
          </span>
          <span>›</span>
          <span className={`flex items-center gap-1 ${progressData.progress >= 75 ? 'text-emerald-400 font-bold' : ''}`}>
            {progressData.progress >= 75 ? '✓' : '•'} Sblocco Coperchio
          </span>
          <span>›</span>
          <span className={`flex items-center gap-1 ${progressData.progress >= 100 ? 'text-emerald-400 font-bold' : ''}`}>
            {progressData.progress >= 100 ? '✓' : '•'} OS
          </span>
        </div>

        {isDone && selectedAction === 'shutdown' && (
          <div className="mt-6 px-4 py-2 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-gray-300 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Hardware disimpegnato. Puoi togliere l'alimentazione ora.</span>
          </div>
        )}
      </div>
    );
  }

  // DIALOGO DI CONFERMA ESPLICITA
  if (isConfirming) {
    let actionTitle = 'Spegnere il Bimby?';
    let actionDesc = 'Il sistema arresterà le lame, sbloccherà il coperchio ed eseguirà lo spegnimento sicuro del Raspberry Pi.';
    let btnColor = 'from-rose-500 to-red-600 hover:from-rose-400 hover:to-red-500';

    if (selectedAction === 'reboot') {
      actionTitle = 'Riavviare il Bimby?';
      actionDesc = 'Il sistema arresterà la cottura in corso e riavvierà il Raspberry Pi.';
      btnColor = 'from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500';
    } else if (selectedAction === 'restart_app') {
      actionTitle = 'Riavviare il Software?';
      actionDesc = 'Il demone applicativo Node.js verrà riavviato mantenendo acceso il Raspberry Pi.';
      btnColor = 'from-blue-500 to-indigo-600 hover:from-blue-400 hover:to-indigo-500';
    }

    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-200">
        <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 mb-4 shadow-inner">
            <Power className="w-7 h-7 stroke-[2.2]" />
          </div>

          <h3 className="text-lg font-bold text-gray-900 mb-2">
            {actionTitle}
          </h3>

          <p className="text-xs text-gray-600 leading-relaxed mb-4">
            {actionDesc}
          </p>

          {isCooking && (
            <div className="w-full mb-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2 text-left">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
              <span>Attenzione: il Bimby è attualmente in lavorazione. L'arresto fermerà immediatamente motore e resistenze.</span>
            </div>
          )}

          <div className="flex items-center gap-3 w-full">
            <button
              onClick={() => setIsConfirming(false)}
              className="flex-1 py-3 rounded-2xl bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 text-xs font-bold transition-all cursor-pointer"
            >
              Annulla
            </button>
            <button
              onClick={handleConfirmAction}
              className={`flex-1 py-3 rounded-2xl bg-gradient-to-r ${btnColor} active:scale-95 text-white text-xs font-bold transition-all shadow-md cursor-pointer`}
            >
              Conferma
            </button>
          </div>
        </div>
      </div>
    );
  }

  // VISTA PRINCIPALE MODALE SELEZIONE
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 select-none animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-3xl p-5 shadow-2xl flex flex-col overflow-hidden">
        
        {/* Header Modale */}
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500">
              <Power className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 tracking-tight leading-none">
                Gestione Spegnimento e Alimentazione
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Esegue la procedura di sicurezza per sbloccare il coperchio e arrestare il sistema
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-500 flex items-center justify-center transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning se in cottura */}
        {isCooking && (
          <div className="mb-3 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>Cottura o rotazione lame attiva. Lo spegnimento arresterà prima le lame e aprirà il coperchio.</span>
          </div>
        )}

        {/* Griglia Opzioni Touch-friendly */}
        <div className="grid grid-cols-3 gap-3 my-1">
          {/* Opzione 1: Spegni Dispositivo */}
          <div
            onClick={() => handleSelectAction('shutdown')}
            className="bg-white hover:bg-rose-50/50 active:scale-[0.98] border-2 border-gray-100 hover:border-rose-200 rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer transition-all shadow-xs group"
          >
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 mb-2.5 group-hover:scale-105 transition-transform">
              <Power className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-900 group-hover:text-rose-600 transition-colors">
                Spegni Bimby
              </h4>
              <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                Arresto lame, sblocco braccia coperchio e spegnimento del Raspberry Pi.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-1 text-[10px] font-bold text-rose-600">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Sblocco Coperchio</span>
            </div>
          </div>

          {/* Opzione 2: Riavvia Dispositivo */}
          <div
            onClick={() => handleSelectAction('reboot')}
            className="bg-white hover:bg-amber-50/50 active:scale-[0.98] border-2 border-gray-100 hover:border-amber-200 rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer transition-all shadow-xs group"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 mb-2.5 group-hover:scale-105 transition-transform">
              <RotateCw className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-900 group-hover:text-amber-600 transition-colors">
                Riavvia Sistema
              </h4>
              <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                Reboot completo del sistema operativo Linux (Raspberry Pi OS).
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-1 text-[10px] font-bold text-amber-600">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Reboot Completo</span>
            </div>
          </div>

          {/* Opzione 3: Riavvia Solo Software */}
          <div
            onClick={() => handleSelectAction('restart_app')}
            className="bg-white hover:bg-blue-50/50 active:scale-[0.98] border-2 border-gray-100 hover:border-blue-200 rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer transition-all shadow-xs group"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-2.5 group-hover:scale-105 transition-transform">
              <Zap className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                Riavvia Software
              </h4>
              <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                Riavvia il demone Node.js (PM2) senza riavviare l'intero sistema.
              </p>
            </div>
            <div className="mt-3 pt-2 border-t border-gray-100 flex items-center gap-1 text-[10px] font-bold text-blue-600">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Riavvio Rapido</span>
            </div>
          </div>
        </div>

        {/* Footer info sicurezza */}
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-1.5 text-emerald-600 font-semibold">
            <Unlock className="w-3.5 h-3.5" />
            <span>Le braccia del coperchio verranno sempre aperte prima dello spegnimento.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold transition-all cursor-pointer"
          >
            Annulla
          </button>
        </div>

      </div>
    </div>
  );
}
