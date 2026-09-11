import React, { useState, useEffect } from 'react';
import { socket } from '../../socket';
import { 
  Scale, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  RotateCcw, 
  ArrowLeft, 
  Info, 
  Sliders, 
  Zap, 
  Check, 
  ShieldCheck,
  Flame
} from 'lucide-react';

const WEIGHT_PRESETS = [500, 1000, 1500, 2000];

export default function ScaleCalibration({ onBack }) {
  const [calibData, setCalibData] = useState({
    calibrationFactor: 420.0,
    zeroOffset: 8388608,
    knownWeightGrams: 1000,
    lastCalibratedAt: null,
    currentWeight: 0,
    currentRaw: 8388608,
    deltaRaw: 0
  });

  const [selectedKnownWeight, setSelectedKnownWeight] = useState(1000);
  const [step, setStep] = useState(1); // 1: Zero a vuoto, 2: Peso noto, 3: Successo
  const [isZeroing, setIsZeroing] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error', text: '' }
  const [calibrationResult, setCalibrationResult] = useState(null);

  // Caricamento iniziale e streaming realtime
  useEffect(() => {
    // 1. Fetch iniziale REST
    fetch('/api/scale/calibration')
      .then(res => res.json())
      .then(data => {
        if (data && data.success) {
          setCalibData(prev => ({ ...prev, ...data }));
          if (data.knownWeightGrams) {
            setSelectedKnownWeight(data.knownWeightGrams);
          }
        }
      })
      .catch(err => console.warn('Errore fetch calibrazione bilancia:', err));

    // 2. Ascolto streaming Socket.IO
    const handleLiveCalibration = (data) => {
      if (data && data.success) {
        setCalibData(prev => ({ ...prev, ...data }));
      }
    };

    const handleCalibrationUpdated = (data) => {
      if (data && data.success) {
        setCalibData(prev => ({ ...prev, ...data }));
      }
    };

    socket.on('SCALE_LIVE_CALIBRATION', handleLiveCalibration);
    socket.on('SCALE_CALIBRATION_UPDATED', handleCalibrationUpdated);

    // Avvia streaming alta frequenza sul backend
    socket.emit('SCALE_START_STREAM');

    return () => {
      socket.emit('SCALE_STOP_STREAM');
      socket.off('SCALE_LIVE_CALIBRATION', handleLiveCalibration);
      socket.off('SCALE_CALIBRATION_UPDATED', handleCalibrationUpdated);
    };
  }, []);

  // Fase 1: Registra lo zero a vuoto
  const handleCalibrateZero = async () => {
    setIsZeroing(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/scale/calibration/zero', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setFeedback({ 
          type: 'success', 
          text: `Zero a vuoto registrato con successo (Offset ADC: ${data.zeroOffset})` 
        });
        setStep(2);
      } else {
        setFeedback({ 
          type: 'error', 
          text: data.error || 'Errore durante la registrazione dello zero.' 
        });
      }
    } catch (err) {
      setFeedback({ type: 'error', text: 'Impossibile comunicare con il server.' });
    } finally {
      setIsZeroing(false);
    }
  };

  // Fase 2: Calcola e salva il nuovo fattore con il peso noto
  const handleCalibrateWeight = async () => {
    setIsCalibrating(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/scale/calibration/weight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knownWeight: selectedKnownWeight })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCalibrationResult(data);
        setFeedback({ 
          type: 'success', 
          text: `Calibrazione completata! Nuovo fattore: ${data.newFactor} ticks/g` 
        });
        setStep(3);
      } else {
        setFeedback({ 
          type: 'error', 
          text: data.error || 'Errore durante il calcolo della calibrazione.' 
        });
      }
    } catch (err) {
      setFeedback({ type: 'error', text: 'Impossibile completare la calibrazione.' });
    } finally {
      setIsCalibrating(false);
    }
  };

  // Ripristino calibrazione di fabbrica
  const handleResetFactory = async () => {
    if (!window.confirm('Vuoi ripristinare il fattore di calibrazione di fabbrica (420.0 ticks/g)?')) return;
    try {
      const res = await fetch('/api/scale/calibration/reset', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setCalibrationResult(null);
        setStep(1);
        setFeedback({ 
          type: 'success', 
          text: 'Fattore di conversione ripristinato ai valori predefiniti (420.0 ticks/g).' 
        });
      }
    } catch (err) {
      setFeedback({ type: 'error', text: 'Errore durante il ripristino di fabbrica.' });
    }
  };

  // Helper di simulazione (permette test rapidi su PC e simulatore)
  const handleSimulateWeight = (grams) => {
    socket.emit('SCALE_SET_WEIGHT', { grams });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white select-none overflow-hidden p-3.5">
      
      {/* Intestazione Barra Superiore */}
      <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2.5">
          {onBack && (
            <button
              onClick={onBack}
              className="p-1.5 rounded-xl bg-gray-100 hover:bg-gray-200 active:scale-95 text-gray-700 transition-all cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 stroke-[2.2]" />
            </button>
          )}
          <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shadow-xs">
            <Scale className="w-4 h-4 stroke-[2.2]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-gray-900 leading-tight">
                Calibrazione Bilancia (HX711)
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100/70 text-amber-800 border border-amber-200">
                Menu Tecnico
              </span>
            </div>
            <p className="text-[11px] text-gray-500 leading-none mt-0.5">
              Taratura celle di carico e calcolo fattore di conversione con peso noto
            </p>
          </div>
        </div>

        {/* Parametri correnti salvati */}
        <div className="flex items-center gap-3 text-right">
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Fattore Attivo
            </span>
            <span className="text-xs font-mono font-bold text-[#00a651]">
              {calibData.calibrationFactor} <span className="text-[10px] font-normal text-gray-400">ticks/g</span>
            </span>
          </div>
          <button
            onClick={handleResetFactory}
            title="Ripristina fattore di fabbrica (420.0)"
            className="px-2.5 py-1 rounded-lg border border-gray-200 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 active:scale-95 transition-all cursor-pointer shadow-2xs"
          >
            Reset Fabbrica
          </button>
        </div>
      </div>

      {/* Griglia a 2 Colonne: Indicatore Realtime (Sinistra) + Procedura Guidata (Destra) */}
      <div className="flex-1 grid grid-cols-12 gap-3 min-h-0 overflow-y-auto">
        
        {/* COLONNA SINISTRA (5/12): Rilevazione Live ADC e Peso */}
        <div className="col-span-5 flex flex-col gap-2.5">
          
          {/* Box Peso in Tempo Reale */}
          <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-xs flex flex-col items-center justify-center relative overflow-hidden">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">
              Peso Rilevato in Tempo Reale
            </span>
            <div className="flex items-baseline gap-1 my-1">
              <span className="text-5xl font-light font-mono tabular-nums text-gray-900 tracking-tight">
                {calibData.currentWeight.toFixed(1)}
              </span>
              <span className="text-xl font-bold text-[#00a651]">g</span>
            </div>

            {/* Valori Grezzi Sensore ADC */}
            <div className="w-full mt-2 pt-2 border-t border-gray-100 grid grid-cols-2 gap-2 text-center">
              <div className="flex flex-col bg-gray-50 rounded-lg p-1.5 border border-gray-100">
                <span className="text-[9px] font-semibold text-gray-400 uppercase">Grezzo ADC (24-bit)</span>
                <span className="text-xs font-mono font-bold text-gray-700">{calibData.currentRaw}</span>
              </div>
              <div className="flex flex-col bg-gray-50 rounded-lg p-1.5 border border-gray-100">
                <span className="text-[9px] font-semibold text-gray-400 uppercase">Delta dallo Zero</span>
                <span className={`text-xs font-mono font-bold ${calibData.deltaRaw > 0 ? 'text-[#00a651]' : 'text-gray-700'}`}>
                  {calibData.deltaRaw > 0 ? `+${calibData.deltaRaw}` : calibData.deltaRaw}
                </span>
              </div>
            </div>
          </div>

          {/* Strumenti di Test Simulatore (utile per collaudo rapido senza hardware) */}
          <div className="bg-gray-50/80 rounded-2xl p-3 border border-gray-200/80 flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
              <Sliders className="w-3 h-3 text-gray-400" />
              Simulazione Peso (Test Rapido):
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => handleSimulateWeight(0)}
                className="py-1.5 px-2 bg-white hover:bg-gray-100 active:scale-95 text-gray-700 rounded-lg text-xs font-bold border border-gray-200 shadow-2xs transition-all cursor-pointer"
              >
                0 g (Vuoto)
              </button>
              <button
                onClick={() => handleSimulateWeight(500)}
                className="py-1.5 px-2 bg-white hover:bg-gray-100 active:scale-95 text-gray-700 rounded-lg text-xs font-bold border border-gray-200 shadow-2xs transition-all cursor-pointer"
              >
                +500 g
              </button>
              <button
                onClick={() => handleSimulateWeight(1000)}
                className="py-1.5 px-2 bg-emerald-50 hover:bg-emerald-100 active:scale-95 text-emerald-800 rounded-lg text-xs font-bold border border-emerald-200 shadow-2xs transition-all cursor-pointer"
              >
                +1 kg (Acqua)
              </button>
            </div>
          </div>

          {/* Feedback Notifiche */}
          {feedback && (
            <div className={`p-2.5 rounded-xl text-xs font-medium border animate-in fade-in flex items-center gap-2 ${
              feedback.type === 'success' 
                ? 'bg-green-50 border-green-200 text-green-900' 
                : 'bg-red-50 border-red-200 text-red-900'
            }`}>
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-[#00a651] shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span className="leading-snug">{feedback.text}</span>
            </div>
          )}

        </div>

        {/* COLONNA DESTRA (7/12): Procedura Guidata di Calibrazione */}
        <div className="col-span-7 flex flex-col gap-2.5">
          
          {/* FASE 1: Zero a Vuoto */}
          <div className={`bg-white rounded-2xl p-3.5 border transition-all shadow-xs ${
            step === 1 ? 'border-amber-400 ring-2 ring-amber-100' : 'border-gray-200/90 opacity-90'
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  step > 1 ? 'bg-[#00a651] text-white' : 'bg-amber-100 text-amber-800'
                }`}>
                  {step > 1 ? '✓' : '1'}
                </span>
                <span className="text-xs font-bold text-gray-900 uppercase tracking-wide">
                  Fase 1: Tara e Zero a Vuoto
                </span>
              </div>
              {step > 1 && (
                <span className="text-[10px] font-bold text-[#00a651] bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                  Completato
                </span>
              )}
            </div>

            <p className="text-[11px] text-gray-500 leading-relaxed mb-2.5">
              Rimuovi qualsiasi oggetto o cibo dal boccale. Assicurati che il Bimby sia in piano e che il boccale sia vuoto e fermo.
            </p>

            <button
              onClick={handleCalibrateZero}
              disabled={isZeroing}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ${
                step === 1 
                  ? 'bg-gray-900 hover:bg-gray-800 active:scale-98 text-white' 
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isZeroing ? 'animate-spin' : ''}`} />
              <span>{isZeroing ? 'Acquisizione zero in corso...' : '1. Registra Zero a Vuoto'}</span>
            </button>
          </div>

          {/* FASE 2: Posizionamento Peso Noto & Ricalcolo Fattore */}
          <div className={`bg-white rounded-2xl p-3.5 border transition-all shadow-xs ${
            step === 2 ? 'border-[#00a651] ring-2 ring-green-100' : 'border-gray-200/90'
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === 3 ? 'bg-[#00a651] text-white' : 'bg-gray-200 text-gray-700'
                }`}>
                  {step === 3 ? '✓' : '2'}
                </span>
                <span className="text-xs font-bold text-gray-900 uppercase tracking-wide">
                  Fase 2: Posizionamento Peso Noto & Calcolo
                </span>
              </div>
              {step === 3 && (
                <span className="text-[10px] font-bold text-[#00a651] bg-green-50 px-2 py-0.5 rounded-full border border-green-100">
                  Calibrato
                </span>
              )}
            </div>

            <p className="text-[11px] text-gray-500 leading-relaxed mb-2">
              Appoggia un peso campione noto nel boccale (es. una bottiglia d'acqua da 1L = 1000g). Seleziona il peso posizionato:
            </p>

            {/* Selettore Peso Noto */}
            <div className="flex items-center gap-1.5 mb-2.5">
              {WEIGHT_PRESETS.map((w) => (
                <button
                  key={w}
                  onClick={() => setSelectedKnownWeight(w)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                    selectedKnownWeight === w
                      ? 'bg-[#00a651] text-white border-[#008f45] shadow-2xs'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                  }`}
                >
                  {w} g {w === 1000 ? '★' : ''}
                </button>
              ))}
            </div>

            <button
              onClick={handleCalibrateWeight}
              disabled={isCalibrating || calibData.deltaRaw <= 50}
              className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer ${
                calibData.deltaRaw > 50 
                  ? 'bg-[#00a651] hover:bg-[#008f45] text-white active:scale-98' 
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
              }`}
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>
                {isCalibrating 
                  ? 'Calcolo in corso...' 
                  : calibData.deltaRaw <= 50 
                    ? 'Appoggia prima il peso sul boccale' 
                    : `2. Calcola & Salva Calibrazione (${selectedKnownWeight}g)`
                }
              </span>
            </button>
          </div>

          {/* FASE 3: Risultato & Verifica */}
          {calibrationResult && (
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-3 animate-in zoom-in-95 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-emerald-900 font-bold text-xs">
                <ShieldCheck className="w-4 h-4 text-[#00a651]" />
                <span>Sensore Ricalibrato Correttamente</span>
              </div>
              <div className="text-[11px] text-emerald-800 grid grid-cols-2 gap-2 mt-0.5">
                <div>Fattore Precedente: <strong className="font-mono">{calibrationResult.oldFactor}</strong></div>
                <div>Nuovo Fattore Salvato: <strong className="font-mono text-[#00a651]">{calibrationResult.newFactor}</strong></div>
              </div>
              <p className="text-[10px] text-emerald-700/90 leading-tight">
                Il nuovo fattore di conversione è stato salvato su disco nel file <code className="bg-emerald-100/80 px-1 py-0.5 rounded">settings.json</code> ed è immediatamente attivo in tutta l'applicazione.
              </p>
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
