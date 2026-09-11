import React, { useState, useEffect } from 'react';
import { socket } from '../../socket';
import { AlertTriangle, RotateCcw, X, Zap } from 'lucide-react';

/**
 * PowerLossModal - Modale ad altissima priorità per il recupero della sessione
 * di cottura a seguito di un blackout o riavvio improvviso del sistema.
 */
export default function PowerLossModal({ onAccept, onDiscard }) {
  const [isOpen, setIsOpen] = useState(false);
  const [recoveryData, setRecoveryData] = useState(null);

  useEffect(() => {
    // 1. Ascolto evento Socket.IO emesso dal server al momento della connessione
    const handleRecoveryAvailable = (data) => {
      if (data && data.recipeTitle) {
        console.log('⚡ [POWER LOSS] Rilevata sessione da ripristinare:', data);
        setRecoveryData(data);
        setIsOpen(true);
      }
    };

    const handleRecoveryDismissed = () => {
      setIsOpen(false);
      setRecoveryData(null);
    };

    socket.on('RECOVERY_AVAILABLE', handleRecoveryAvailable);
    socket.on('RECOVERY_DISMISSED', handleRecoveryDismissed);

    // 2. Controllo iniziale via REST nel caso il socket si sia connesso prima del montaggio
    fetch('/api/recipe/recovery')
      .then((res) => res.json())
      .then((data) => {
        if (data?.hasRecovery) {
          console.log('⚡ [POWER LOSS] Recupero rilevato via REST:', data);
          setRecoveryData(data);
          setIsOpen(true);
        }
      })
      .catch((err) => {
        // Silenzioso se l'endpoint non è raggiungibile durante il boot
      });

    return () => {
      socket.off('RECOVERY_AVAILABLE', handleRecoveryAvailable);
      socket.off('RECOVERY_DISMISSED', handleRecoveryDismissed);
    };
  }, []);

  const handleAccept = () => {
    console.log('▶️ [POWER LOSS] Accettato ripristino sessione');
    socket.emit('RECOVERY_ACCEPT');
    setIsOpen(false);
    setRecoveryData(null);
    if (typeof onAccept === 'function') {
      onAccept(recoveryData);
    }
  };

  const handleDiscard = () => {
    console.log('🛑 [POWER LOSS] Scartato ripristino sessione');
    socket.emit('RECOVERY_DISCARD');
    setIsOpen(false);
    setRecoveryData(null);
    if (typeof onDiscard === 'function') {
      onDiscard(recoveryData);
    }
  };

  if (!isOpen || !recoveryData) {
    return null;
  }

  const recipeTitle = recoveryData.recipeTitle || 'Ricetta in corso';
  const stepIndex = recoveryData.stepIndex ?? (recoveryData.currentStepIndex !== undefined ? recoveryData.currentStepIndex + 1 : 1);
  const totalSteps = recoveryData.totalSteps || 0;

  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm select-none p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="powerloss-title"
    >
      <div 
        className="bg-white rounded-3xl p-7 shadow-2xl border border-gray-100 max-w-md w-full text-center relative overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cerchio icona avviso blackout */}
        <div className="w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-200 text-amber-500 flex items-center justify-center mx-auto mb-4 shadow-inner relative">
          <Zap className="w-8 h-8 stroke-[2.2] fill-amber-400 text-amber-500 animate-pulse" />
          <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center shadow-xs">
            <AlertTriangle className="w-3.5 h-3.5 stroke-[2.5]" />
          </div>
        </div>

        {/* Badge identificativo */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200/70 text-[11px] font-bold uppercase tracking-wider mb-2.5">
          <span>Ripristino di emergenza</span>
        </div>

        {/* Titolo principale */}
        <h2 id="powerloss-title" className="text-2xl font-bold text-gray-900 tracking-tight mb-2">
          Recupero Sessione
        </h2>

        {/* Descrizione con titolo ricetta e passaggio evidenziati */}
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          Sembra che ci sia stata un'interruzione di corrente. Stavi cucinando{' '}
          <strong className="text-gray-900 font-bold underline decoration-amber-300 decoration-2 underline-offset-2">
            {recipeTitle}
          </strong>{' '}
          al Passaggio <strong className="text-gray-900 font-bold">{stepIndex}</strong>
          {totalSteps > 0 ? ` di ${totalSteps}` : ''}. Vuoi riprendere?
        </p>

        {/* Pulsanti di azione: Ignora (grigio/rosso) e Riprendi (Verde gigante) */}
        <div className="flex items-center gap-3 w-full">
          {/* Tasto Ignora */}
          <button
            type="button"
            onClick={handleDiscard}
            className="px-5 py-4 min-w-[105px] rounded-2xl border border-gray-200 bg-gray-100 hover:bg-red-50 hover:border-red-200 hover:text-red-600 text-gray-700 font-bold text-sm transition-all active:scale-95 shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <X className="w-4 h-4 stroke-[2.5]" />
            <span>Ignora</span>
          </button>

          {/* Tasto Verde Gigante Riprendi */}
          <button
            type="button"
            onClick={handleAccept}
            className="flex-1 py-4 px-6 rounded-2xl bg-[#00a651] hover:bg-[#008f45] text-white font-bold text-base shadow-lg shadow-[#00a651]/25 hover:shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <RotateCcw className="w-5 h-5 stroke-[2.5]" />
            <span>Riprendi</span>
          </button>
        </div>
      </div>
    </div>
  );
}
