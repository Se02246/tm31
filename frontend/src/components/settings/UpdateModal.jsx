import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import { 
  Terminal, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  Download, 
  GitBranch, 
  Cpu, 
  Layers, 
  RotateCw,
  Power,
  ChevronRight,
  ShieldCheck
} from 'lucide-react';

const STEPS = [
  { id: 'check', label: '1. Verifica Git', icon: GitBranch },
  { id: 'pull', label: '2. Git Pull', icon: Download },
  { id: 'npm_root', label: '3. Dipendenze', icon: Layers },
  { id: 'build_frontend', label: '4. Build Vite', icon: Cpu },
  { id: 'restart', label: '5. Riavvio PM2', icon: RotateCw }
];

export default function UpdateModal({ isOpen, onClose, initialVersionInfo }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'checking' | 'updating' | 'restarting' | 'success' | 'error' | 'up_to_date'
  const [currentStep, setCurrentStep] = useState(null);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isRebooting, setIsRebooting] = useState(false);
  const [rebootSuccess, setRebootSuccess] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(false);

  const terminalEndRef = useRef(null);
  const wasUpdatingRef = useRef(false);

  // Aggiorna wasUpdatingRef per gestire la disconnessione
  useEffect(() => {
    if (status === 'updating' || status === 'restarting') {
      wasUpdatingRef.current = true;
    }
  }, [status]);

  // Autoscroll del terminale
  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Ascolto eventi Socket.IO e gestione del riavvio/riconnessione
  useEffect(() => {
    const handleOtaStatus = (data) => {
      if (!data) return;
      if (data.status) setStatus(data.status);
      if (data.currentStep) setCurrentStep(data.currentStep);
      if (typeof data.progress === 'number') setProgress(data.progress);
      if (data.error) setErrorMsg(data.error);
    };

    const handleOtaLog = (entry) => {
      if (!entry) return;
      setLogs((prev) => [...prev, entry]);
    };

    // GESTIONE RIAVVIO: se il socket si disconnette mentre stiamo aggiornando/riavviando
    const handleDisconnect = () => {
      if (wasUpdatingRef.current) {
        setIsRebooting(true);
      }
    };

    // Quando il socket si riconnette dopo la caduta di PM2
    const handleConnect = () => {
      if (wasUpdatingRef.current || isRebooting) {
        setRebootSuccess(true);
        // Refresh completo per caricare il nuovo bundle compilato
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    };

    socket.on('OTA_STATUS', handleOtaStatus);
    socket.on('OTA_LOG', handleOtaLog);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);

    // Chiedi lo stato iniziale
    socket.emit('GET_OTA_STATUS', (res) => {
      if (res) {
        handleOtaStatus(res);
        if (Array.isArray(res.recentLogs) && res.recentLogs.length > 0) {
          setLogs(res.recentLogs);
        }
      }
    });

    return () => {
      socket.off('OTA_STATUS', handleOtaStatus);
      socket.off('OTA_LOG', handleOtaLog);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
    };
  }, [isRebooting]);

  if (!isOpen) return null;

  // Avvio effettivo dell'aggiornamento
  const handleStartUpdate = async () => {
    setErrorMsg(null);
    setStatus('updating');
    setProgress(5);
    setLogs([{ text: '🚀 Richiesta di aggiornamento inviata al backend...', type: 'stdout', timestamp: Date.now() }]);

    try {
      const res = await fetch('/api/system/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: forceUpdate, branch: 'main' })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMsg(data.error || 'Errore durante l\'avvio dell\'aggiornamento');
        setStatus('error');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Errore di connessione col server');
      setStatus('error');
    }
  };

  // SCHERMATA BLOCCANTE DI RIAVVIO SISTEMA (quando PM2 arresta e riavvia Node.js)
  if (isRebooting) {
    return (
      <div className="fixed inset-0 z-50 bg-[#0f172a] text-white flex flex-col items-center justify-center p-6 select-none animate-in fade-in duration-300">
        <div className="w-20 h-20 rounded-3xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mb-5 shadow-2xl relative">
          <RotateCw className="w-10 h-10 text-blue-400 animate-spin" />
          <div className="absolute inset-0 rounded-3xl bg-blue-500/20 blur-xl -z-10 animate-pulse" />
        </div>

        {rebootSuccess ? (
          <>
            <h2 className="text-2xl font-bold text-emerald-400 tracking-tight mb-2 flex items-center gap-2">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              Sistema Riavviato con Successo!
            </h2>
            <p className="text-sm text-gray-300 max-w-md text-center">
              Ricaricamento del touchscreen in corso per applicare i nuovi componenti...
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold text-white tracking-tight mb-2">
              Riavvio del sistema in corso...
            </h2>
            <p className="text-sm text-gray-400 max-w-md text-center leading-relaxed">
              Il demone Node.js si sta riavviando per caricare il nuovo codice sorgente. 
              Attendere il ripristino della connessione.
            </p>
            <div className="mt-6 flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-800 border border-slate-700 text-xs font-mono text-gray-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>In attesa di PM2 / Socket.IO</span>
            </div>
          </>
        )}
      </div>
    );
  }

  const isWorking = status === 'updating' || status === 'restarting';

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 select-none animate-in fade-in duration-200">
      <div className="w-full max-w-3xl h-[460px] bg-[#0f172a] border border-slate-700/80 rounded-2xl flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header Modale */}
        <div className="px-4 py-2.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <RefreshCw className={`w-4 h-4 ${isWorking ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-tight leading-none">
                Aggiornamento Software OTA (Over-The-Air)
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Download da GitHub, ricompilazione Vite e riavvio PM2
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {initialVersionInfo?.commit && (
              <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] font-mono text-gray-300">
                Commit: {initialVersionInfo.commit} ({initialVersionInfo.branch})
              </span>
            )}
            {!isWorking && (
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 text-gray-400 hover:text-white flex items-center justify-center transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Step Indicator Visuali */}
        <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-800/80 flex items-center justify-between gap-1 shrink-0 overflow-x-auto">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const stepOrder = ['check', 'pull', 'npm_root', 'build_frontend', 'restart'];
            const currentIdx = stepOrder.indexOf(currentStep);
            const myIdx = stepOrder.indexOf(s.id);

            let stateStyle = 'text-gray-500 bg-slate-800/50 border-slate-800';
            if (status === 'success') {
              stateStyle = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
            } else if (isWorking) {
              if (myIdx < currentIdx) {
                stateStyle = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
              } else if (myIdx === currentIdx) {
                stateStyle = 'text-blue-400 bg-blue-500/20 border-blue-400/50 shadow-sm animate-pulse';
              }
            }

            return (
              <div 
                key={s.id}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-all ${stateStyle}`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Progress Bar */}
        {isWorking && (
          <div className="w-full bg-slate-800 h-1 relative overflow-hidden">
            <div 
              className="bg-gradient-to-r from-blue-500 via-emerald-400 to-teal-400 h-full transition-all duration-300"
              style={{ width: `${Math.max(5, progress)}%` }}
            />
          </div>
        )}

        {/* Console / Terminale Logs in Tempo Reale */}
        <div className="flex-1 bg-[#090d16] p-3 font-mono text-[11px] overflow-y-auto flex flex-col justify-start gap-1 border-b border-slate-800">
          {logs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center gap-2">
              <Terminal className="w-8 h-8 opacity-40" />
              <p>In attesa dell'avvio della procedura...</p>
              <p className="text-[10px] text-gray-600">I log del terminale e l'output di compilazione appariranno qui in streaming.</p>
            </div>
          ) : (
            logs.map((log, i) => {
              let color = 'text-gray-300';
              if (log.type === 'stderr' || log.text.includes('[OTA_ERROR]')) color = 'text-rose-400 font-bold';
              else if (log.text.includes('[OTA_SUCCESS]')) color = 'text-emerald-400 font-bold';
              else if (log.text.includes('[OTA_STEP:')) color = 'text-blue-400 font-semibold';
              else if (log.text.includes('[OTA_UP_TO_DATE]')) color = 'text-amber-300 font-bold';

              return (
                <div key={i} className={`leading-relaxed break-all ${color}`}>
                  <span className="text-gray-600 select-none mr-1.5">›</span>
                  {log.text}
                </div>
              );
            })
          )}
          <div ref={terminalEndRef} />
        </div>

        {/* Footer con Stato e Azioni */}
        <div className="px-4 py-2.5 bg-slate-900/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs">
            {status === 'idle' && (
              <span className="text-gray-400">Pronto per l'aggiornamento</span>
            )}
            {isWorking && (
              <span className="text-blue-400 font-medium flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                Aggiornamento in corso ({progress}%)... Non spegnere il Bimby
              </span>
            )}
            {status === 'up_to_date' && (
              <span className="text-amber-300 font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-amber-300" />
                Il sistema è già aggiornato all'ultima versione
              </span>
            )}
            {status === 'success' && (
              <span className="text-emerald-400 font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Aggiornamento completato con successo
              </span>
            )}
            {status === 'error' && (
              <span className="text-rose-400 font-medium flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                {errorMsg || 'Errore durante l\'aggiornamento'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isWorking && (
              <>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400 mr-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={forceUpdate}
                    onChange={(e) => setForceUpdate(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-800 text-emerald-500 focus:ring-0"
                  />
                  <span>Forza ricompilazione</span>
                </label>

                {status === 'idle' || status === 'error' || status === 'up_to_date' ? (
                  <button
                    onClick={handleStartUpdate}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 active:scale-95 text-white text-xs font-bold shadow-lg transition-all cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>{status === 'error' ? 'Riprova Aggiornamento' : 'Avvia Aggiornamento'}</span>
                  </button>
                ) : (
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    Chiudi
                  </button>
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
