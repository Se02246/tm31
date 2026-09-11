import React from 'react';
import { ShieldAlert, AlertTriangle, RefreshCw, XCircle } from 'lucide-react';

export default function SafetyInterlockModal({ isOpen, errorData, onReset }) {
  if (!isOpen) return null;

  const code = errorData?.code || 'INTERLOCK_ERROR';
  const message = errorData?.message;

  let title = 'Errore di Sicurezza Interlock';
  let description = 'Verifica che il boccale sia posizionato correttamente e che il coperchio sia allineato.';
  let badgeText = 'Interlock Aperto';

  if (code === 'LID_NOT_LOCKED') {
    title = 'Ostacolo Coperchio / Chiusura Fallita';
    description = 'Il coperchio del boccale non è serrato correttamente oppure un ostacolo blocca le braccia. Le braccia sono state riaperte automaticamente in sicurezza per evitare sforzi al servomotore. Rimuovi eventuali ostacoli, riallinea il coperchio e riprova.';
    badgeText = 'Microswitch Coperchio Non Premuto';
  } else if (code === 'BOWL_NOT_PRESENT') {
    title = 'Boccale Non Rilevato';
    description = 'Il boccale in acciaio non risulta alloggiato nella base del Bimby TM31. Inserisci saldamente il boccale nella sua sede prima di avviare la lavorazione.';
    badgeText = 'Microswitch Boccale Aperto';
  } else if (code === 'INTERLOCK_TRIPPED') {
    title = 'Arresto di Emergenza Interlock!';
    description = 'I microinterruttori di sicurezza hanno rilevato l\'apertura del coperchio o lo spostamento del boccale durante la rotazione delle lame! Il motore è stato arrestato all\'istante.';
    badgeText = 'Interruzione Circuito in Corsa';
  } else if (message) {
    description = message;
  }

  return (
    <div 
      className="fixed inset-0 z-[9950] flex items-center justify-center bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-200 p-4"
      onClick={(e) => e.stopPropagation()}
    >
      <div 
        className="bg-white rounded-3xl p-6 shadow-2xl border border-red-200 max-w-md w-full text-center animate-in zoom-in-95 duration-200 flex flex-col items-center"
      >
        {/* Icona di allerta sicurezza */}
        <div className="w-14 h-14 rounded-full bg-red-50 border-2 border-red-200 text-red-600 flex items-center justify-center mb-3.5 animate-bounce">
          <ShieldAlert className="w-8 h-8 stroke-[2.2]" />
        </div>

        {/* Badge tipologia errore */}
        <span className="px-3 py-1 rounded-full text-[11px] font-bold tracking-wide uppercase bg-red-100/80 text-red-800 border border-red-200 mb-2">
          {badgeText}
        </span>

        {/* Titolo */}
        <h3 className="text-lg font-bold text-gray-900 tracking-tight mb-2">
          {title}
        </h3>

        {/* Descrizione guidata */}
        <p className="text-xs text-gray-600 leading-relaxed mb-6 px-2 text-center">
          {description}
        </p>

        {/* Pulsante di ripristino/sblocco */}
        <button
          onClick={onReset}
          className="w-full py-3 px-6 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
        >
          <RefreshCw className="w-4 h-4 stroke-[2.2]" />
          <span>Sblocca e Ripristina Macchina</span>
        </button>
      </div>
    </div>
  );
}
