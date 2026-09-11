import React, { useState, useEffect } from 'react';
import { socket } from '../../socket';
import { 
  Play, 
  Pause, 
  ChevronRight, 
  ChevronLeft, 
  X, 
  Check, 
  Clock, 
  Users, 
  ChefHat, 
  AlertCircle, 
  ListChecks, 
  FastForward, 
  Sparkles,
  Utensils,
  Bell,
  ShieldAlert
} from 'lucide-react';
import spigaIcon from '../../assets/modes/spiga.svg';

// Icona Varoma ufficiale coerente con la Home
const VaromaSilhouetteIcon = ({ className = "w-7 h-5" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="30 44 80 55" fill="currentColor" className={className}>
    <path d="M 36 82.2 L 104 82.2 C 105.8 82.2, 107 83.5, 107 85.1 C 107 86.7, 105.8 88, 104 88 L 99.8 88 L 93.5 94.5 C 92 96, 90.2 96.5, 88.5 96.5 L 51.5 96.5 C 49.8 96.5, 48 96, 46.5 94.5 L 40.2 88 L 36 88 C 34.2 88, 33 86.7, 33 85.1 C 33 83.5, 34.2 82.2, 36 82.2 Z" />
    <path d="M 70 47.5 C 70.8 48.5, 70 53, 70.5 56 C 71.5 60, 75.3 64, 75 69 C 74.5 73.5, 71.8 76.5, 69.2 76.5 C 68.5 76.5, 68.6 75.5, 69.5 71.5 C 70 67.5, 66 62, 65 57.5 C 64.2 54, 66.5 50, 70 47.5 Z" />
    <path d="M 56 54.2 C 57.2 55.5, 56.5 59.5, 57 62 C 58 65.5, 60.5 68, 60 70.8 C 59.3 73.5, 57.2 75.2, 55.5 75.2 C 54.8 75.2, 55.2 73.5, 55.8 70.5 C 56.2 67, 53.5 63.5, 52.2 60 C 51.5 57, 53.5 55.2, 56 54.2 Z" />
    <path d="M 84 54.2 C 85.2 55.5, 84.5 59.5, 85 62 C 86 65.5, 88.5 68, 88 70.8 C 87.3 73.5, 85.2 75.2, 83.5 75.2 C 82.8 75.2, 83.2 73.5, 83.8 70.5 C 84.2 67, 81.5 63.5, 80.2 60 C 79.5 57, 81.5 55.2, 84 54.2 Z" />
  </svg>
);

/**
 * Formatta i secondi in formato MM:SS
 */
const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export default function RecipeRunner() {
  const [recipeState, setRecipeState] = useState({
    hasRecipe: false,
    recipeId: null,
    recipeTitle: null,
    info: {},
    ingredients: [],
    accessories: [],
    tips: null,
    personalNotes: null,
    inPrepScreen: true,
    currentStepIndex: 0,
    totalSteps: 0,
    currentStep: null,
    isStepRunning: false,
    isStepCompleted: false,
    isPaused: false,
    remainingTime: 0,
    isLastStep: false
  });

  const [fsmState, setFsmState] = useState('IDLE');
  const [machineContext, setMachineContext] = useState({ targetTime: 0, targetTemp: 0, targetSpeed: 0, currentTemp: 20 });
  const [scaleWeight, setScaleWeight] = useState(0);

  // Modali di consultazione e conferma sicurezza
  const [showIngredientsModal, setShowIngredientsModal] = useState(false);
  const [showSkipModal, setShowSkipModal] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showStepConfirmModal, setShowStepConfirmModal] = useState({ open: false, direction: 'next' });

  useEffect(() => {
    // 1. Fetch iniziale dello stato ricetta
    fetch('/api/recipe/state')
      .then((res) => res.json())
      .then((data) => {
        if (data) setRecipeState(data);
      })
      .catch((err) => console.warn('Errore /api/recipe/state:', err));

    // 2. Ascolto socket ricetta e macchina
    const handleRecipeState = (state) => {
      if (state) setRecipeState(state);
    };

    const handleStepCompleted = () => {
      setRecipeState((prev) => ({
        ...prev,
        isStepCompleted: true,
        isStepRunning: false,
        isPaused: false
      }));
    };

    const handleMachineState = (data) => {
      if (data?.value) {
        const val = typeof data.value === 'string' ? data.value.toUpperCase() : String(data.value).toUpperCase();
        setFsmState(val);
      }
      if (data?.context) setMachineContext(data.context);
    };

    const handleScaleWeight = (weight) => {
      setScaleWeight(weight);
    };

    socket.on('RECIPE_STATE', handleRecipeState);
    socket.on('STEP_COMPLETED', handleStepCompleted);
    socket.on('state', handleMachineState);
    socket.on('scale_weight', handleScaleWeight);

    return () => {
      socket.off('RECIPE_STATE', handleRecipeState);
      socket.off('STEP_COMPLETED', handleStepCompleted);
      socket.off('state', handleMachineState);
      socket.off('scale_weight', handleScaleWeight);
    };
  }, []);

  const {
    hasRecipe,
    recipeTitle,
    info = {},
    ingredients = [],
    accessories = [],
    tips,
    personalNotes,
    inPrepScreen,
    currentStepIndex,
    totalSteps,
    currentStep,
    isStepRunning,
    isStepCompleted,
    isRecipeCompleted,
    isPaused,
    remainingTime,
    isLastStep
  } = recipeState;



  const actionType = currentStep?.actionType || 'cook';
  const isWeigh = actionType === 'weigh';
  const isManual = actionType === 'manual';
  const isSpiga = currentStep?.mode === 'spiga';

  const currentFsm = (fsmState || '').toUpperCase();
  const isAlarm = currentFsm === 'ALARM' || currentFsm === 'STOPPING_MOTOR_ALARM';
  const isStepFinished = Boolean(isStepCompleted || isAlarm);
  const isCooking = (['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(currentFsm) || isStepRunning) && !isStepFinished;

  // Handlers socket
  const handleStartCooking = () => {
    socket.emit('CMD', { type: 'STOP' });
    socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
    socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
    socket.emit('CMD', { type: 'SET_TIME', value: 0 });
    socket.emit('RECIPE_START_COOKING');
  };

  const handleStartStep = () => {
    socket.emit('RECIPE_START_STEP');
  };

  const handlePauseStep = () => {
    socket.emit('RECIPE_PAUSE_STEP');
  };

  const handleResumeStep = () => {
    socket.emit('RECIPE_RESUME_STEP');
  };

  // Avanzamento fluido senza modale quando il passaggio è completato o manuale/pesatura
  const handleNextStep = () => {
    socket.emit('CMD', { type: 'ACK_ALARM' });
    socket.emit('CMD', { type: 'STOP' });
    socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
    socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
    socket.emit('CMD', { type: 'SET_TIME', value: 0 });
    socket.emit('RECIPE_NEXT_STEP');
  };

  // Completamento ricetta: completa, resetta e torna direttamente alla home
  const handleFinishRecipe = () => {
    socket.emit('CMD', { type: 'ACK_ALARM' });
    socket.emit('CMD', { type: 'STOP' });
    socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
    socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
    socket.emit('CMD', { type: 'SET_TIME', value: 0 });
    socket.emit('RECIPE_COMPLETE');
    socket.emit('RECIPE_RESET');
    window.dispatchEvent(new CustomEvent('app-go-home'));
  };

  // Uscita definitiva verso la home del sistema Bimby TM31 senza modale di conferma
  const handleReturnHome = () => {
    socket.emit('CMD', { type: 'ACK_ALARM' });
    socket.emit('CMD', { type: 'STOP' });
    socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
    socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
    socket.emit('CMD', { type: 'SET_TIME', value: 0 });
    socket.emit('RECIPE_RESET');
    window.dispatchEvent(new CustomEvent('app-go-home'));
  };

  // Apertura modale di sicurezza se si vuole tornare indietro o interrompere uno step a metà
  const requestStepChange = (direction) => {
    setShowStepConfirmModal({ open: true, direction });
  };

  // Conferma cambio passaggio con rigoroso azzeramento parametri
  const confirmStepChange = () => {
    const dir = showStepConfirmModal.direction;
    setShowStepConfirmModal({ open: false, direction: 'next' });

    socket.emit('CMD', { type: 'ACK_ALARM' });
    socket.emit('CMD', { type: 'STOP' });
    socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
    socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
    socket.emit('CMD', { type: 'SET_TIME', value: 0 });

    if (dir === 'next') {
      socket.emit('RECIPE_NEXT_STEP');
    } else if (dir === 'prev') {
      socket.emit('RECIPE_PREV_STEP');
    }
  };

  const handleConfirmSkip = () => {
    setShowSkipModal(false);
    socket.emit('CMD', { type: 'ACK_ALARM' });
    socket.emit('CMD', { type: 'STOP' });
    socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
    socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
    socket.emit('CMD', { type: 'SET_TIME', value: 0 });
    socket.emit('RECIPE_SKIP_STEP');
  };

  const handleConfirmExit = () => {
    setShowExitModal(false);
    socket.emit('CMD', { type: 'ACK_ALARM' });
    socket.emit('CMD', { type: 'STOP' });
    socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
    socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
    socket.emit('CMD', { type: 'SET_TIME', value: 0 });
    socket.emit('RECIPE_RESET');
  };

  const handleTareScale = () => {
    socket.emit('CMD', { type: 'SCALE_TARE' });
  };

  // Gestione tasto fisico (Enter/Spazio / manopola TM31)
  useEffect(() => {
    const handlePhysicalAction = () => {
      // 1. Se suona l'allarme, silenzia
      if (isAlarm) {
        socket.emit('CMD', { type: 'ACK_ALARM' });
        return;
      }

      // 2. Se è aperto il modale di conferma passaggio, conferma
      if (showStepConfirmModal.open) {
        confirmStepChange();
        return;
      }

      // 3. Se è aperto il modale di skip, conferma
      if (showSkipModal) {
        handleConfirmSkip();
        return;
      }

      // 4. Se è aperto il modale di uscita o ingredienti, sicurezza
      if (showExitModal || showIngredientsModal) {
        return;
      }

      // 5. Se ci troviamo nella schermata iniziale di preparazione, avvia la ricetta
      if (inPrepScreen) {
        handleStartCooking();
        return;
      }

      // 6. Durante uno step completato o manuale/pesatura:
      // Se è l'ultimo step, completa la ricetta! Altrimenti avanza direttamente
      if (isStepFinished || isManual || isWeigh) {
        if (isLastStep) {
          handleFinishRecipe();
        } else {
          handleNextStep();
        }
        return;
      }

      // 7. Se in cottura: pausa/riprendi
      if (isCooking && !isPaused) {
        handlePauseStep();
      } else if (isPaused) {
        handleResumeStep();
      } else {
        handleStartStep();
      }
    };

    window.addEventListener('recipe-physical-action', handlePhysicalAction);
    return () => window.removeEventListener('recipe-physical-action', handlePhysicalAction);
  }, [
    isAlarm,
    isStepFinished,
    showStepConfirmModal, 
    showSkipModal, 
    showExitModal, 
    showIngredientsModal, 
    inPrepScreen, 
    isManual, 
    isWeigh, 
    isLastStep, 
    isCooking, 
    isPaused
  ]);

  if (!hasRecipe) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white text-gray-900 select-none p-6 text-center">
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Nessuna ricetta in esecuzione
        </h2>
        <p className="text-sm text-gray-500 max-w-sm mb-6 leading-relaxed">
          Seleziona una ricetta su Cookidoo e tocca "Cuciniamo" per avviare la preparazione guidata.
        </p>
      </div>
    );
  }

  // =========================================================================
  // SCHERMATA 1: "PREPARAZIONE" (Panoramica ingredienti, immagini, note, difficoltà)
  // =========================================================================
  if (inPrepScreen) {
    const hasRightColumnContent = Boolean(
      (accessories && accessories.length > 0) || 
      (tips && tips.trim().length > 0) || 
      (personalNotes && personalNotes.trim().length > 0)
    );

    return (
      <div className="flex-1 flex flex-col h-full bg-white text-gray-900 select-none overflow-hidden justify-between">
        
        {/* Barra superiore fissa: Titolo, Badge e Tasto "Interrompi" con icona X rossa */}
        <div className="flex items-center justify-between shrink-0 h-12 px-6 border-b border-gray-100 bg-white z-10">
          <div className="flex items-baseline gap-3 overflow-hidden">
            <h2 className="text-base font-bold text-gray-900 tracking-tight truncate max-w-md">
              {recipeTitle || 'Preparazione Ricetta'}
            </h2>
            <span className="px-2.5 py-0.5 rounded-full bg-green-50 text-[#00a651] text-xs font-semibold shrink-0">
              Preparazione
            </span>
          </div>

          {/* Tasto Uscita in alto a destra: icona X rossa + scritta "Interrompi" (senza seconda X) */}
          <button
            onClick={() => setShowExitModal(true)}
            className="px-3.5 py-1.5 rounded-full bg-white hover:bg-gray-50 border border-gray-200 flex items-center gap-1.5 text-gray-700 active:scale-95 transition-all text-xs font-semibold shadow-2xs cursor-pointer"
            title="Interrompi ricetta"
          >
            <X className="w-3.5 h-3.5 text-red-500 stroke-[2.5]" />
            <span>Interrompi</span>
          </button>
        </div>

        {/* Corpo Centrale Scrollabile: tutta la pagina scorre naturalmente senza micro-scroll annidati */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          
          {/* Badge Informativi Ricetta (Tempi, Porzioni, Difficoltà, Passaggi) */}
          <div className="flex items-center gap-3 shrink-0 flex-wrap text-xs font-medium text-gray-600">
            {info.prepTime && (
              <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100 shadow-2xs">
                <Clock className="w-3.5 h-3.5 text-[#00a651]" />
                <span>Prep: <strong>{info.prepTime}</strong></span>
              </div>
            )}
            {info.totalTime && (
              <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100 shadow-2xs">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <span>Totale: <strong>{info.totalTime}</strong></span>
              </div>
            )}
            {info.portions && (
              <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100 shadow-2xs">
                <Users className="w-3.5 h-3.5 text-[#00a651]" />
                <span>Dosi: <strong>{info.portions}</strong></span>
              </div>
            )}
            {info.difficulty && (
              <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100 shadow-2xs">
                <ChefHat className="w-3.5 h-3.5 text-orange-500" />
                <span>Difficoltà: <strong>{info.difficulty}</strong></span>
              </div>
            )}
            <div className="flex items-center gap-1.5 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100 shadow-2xs">
              <ChefHat className="w-3.5 h-3.5 text-[#00a651]" />
              <span>Passaggi: <strong>{totalSteps}</strong></span>
            </div>
          </div>

          {/* Griglia a Colonne Espansa Naturalmente */}
          <div className={`grid ${hasRightColumnContent ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'} gap-4 items-start`}>
            
            {/* Box 1: Ingredienti Espansi con Immagini a Sinistra e Note Grigie */}
            <div className="bg-gray-50/70 rounded-2xl p-4 border border-gray-100 flex flex-col gap-2.5 shadow-2xs">
              <div className="flex items-center justify-between pb-1 border-b border-gray-200/60">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5">
                  <ListChecks className="w-4 h-4 text-[#00a651]" />
                  Ingredienti Necessari ({ingredients.length})
                </span>
              </div>

              {/* Lista ingredienti già espansa completamente */}
              <div className="flex flex-col gap-2 select-text">
                {ingredients && ingredients.length > 0 ? (
                  ingredients.map((ing, idx) => (
                    <div key={idx} className="bg-white p-2.5 rounded-xl border border-gray-100 shadow-2xs flex items-center gap-3">
                      {/* Thumbnail immagine ingrediente */}
                      {ing.imageUrl ? (
                        <img 
                          src={ing.imageUrl} 
                          alt={ing.text}
                          className="w-10 h-10 object-contain rounded-lg bg-white border border-gray-200 p-0.5 shrink-0 shadow-2xs"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center shrink-0 text-gray-400">
                          <Utensils className="w-4 h-4 text-gray-400" />
                        </div>
                      )}

                      {/* Nome e note (in grigio tenue per gerarchia visiva) */}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-gray-900 leading-snug">
                          {ing.text}
                        </div>
                        {ing.note && (
                          <div className="text-[11px] text-gray-500 font-normal mt-0.5 flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-gray-400 inline-block shrink-0" />
                            <span>{ing.note}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-gray-400 italic p-3 text-center bg-white rounded-xl border border-gray-100">
                    Nessuna lista ingredienti specifica estratta. I passaggi sono pronti per l'esecuzione.
                  </div>
                )}
              </div>
            </div>

            {/* Box 2: Articoli Utili, Consigli e Note Personali (renderizzati SOLO se presenti) */}
            {hasRightColumnContent && (
              <div className="flex flex-col gap-4">
                
                {/* Articoli Utili reali (se presenti nella pagina) */}
                {accessories && accessories.length > 0 && (
                  <div className="bg-gray-50/70 rounded-2xl p-4 border border-gray-100 flex flex-col gap-2.5 shadow-2xs">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5 pb-1 border-b border-gray-200/60">
                      <Utensils className="w-4 h-4 text-[#00a651]" />
                      Articoli Utili
                    </span>

                    <div className="flex flex-wrap gap-2 pt-1">
                      {accessories.map((acc, i) => (
                        <span key={i} className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 font-semibold text-gray-700 shadow-2xs flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#00a651]" />
                          {acc}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Consigli & Varianti (renderizzati SOLO se presenti) */}
                {tips && tips.trim().length > 0 && (
                  <div className="bg-gray-50/70 rounded-2xl p-4 border border-gray-100 flex flex-col gap-2.5 shadow-2xs">
                    <span className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-1.5 pb-1 border-b border-gray-200/60">
                      <Sparkles className="w-4 h-4 text-[#00a651]" />
                      Consigli & Varianti
                    </span>

                    <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-2xs">
                      <p className="text-xs text-gray-600 leading-relaxed italic select-text">
                        "{tips}"
                      </p>
                    </div>
                  </div>
                )}

                {/* Note Personali Utente (renderizzate SOLO se presenti e non vuote) */}
                {personalNotes && personalNotes.trim().length > 0 && (
                  <div className="bg-amber-50/70 rounded-2xl p-4 border border-amber-200/80 flex flex-col gap-2.5 shadow-2xs">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1.5 pb-1 border-b border-amber-200/60">
                      <ListChecks className="w-4 h-4 text-amber-600" />
                      Note Personali
                    </span>

                    <div className="bg-white p-3 rounded-xl border border-amber-100 shadow-2xs">
                      <p className="text-xs text-gray-800 leading-relaxed select-text font-medium">
                        {personalNotes}
                      </p>
                    </div>
                  </div>
                )}

              </div>
            )}

          </div>

        </div>

        {/* Barra Inferiore Fissa: Pulsante Gigante Verde "Iniziamo" */}
        <div className="flex items-center justify-end shrink-0 px-6 py-3 border-t border-gray-100 bg-white z-10 shadow-xs">
          <button
            onClick={handleStartCooking}
            className="px-10 py-3 rounded-full bg-[#00a651] hover:bg-[#008f45] active:scale-95 text-white font-bold text-base flex items-center gap-2.5 shadow-md transition-all cursor-pointer"
          >
            <span>Iniziamo</span>
            <ChevronRight className="w-5 h-5 stroke-[2.8]" />
          </button>
        </div>

        {/* Modal di uscita */}
        {showExitModal && (
          <ExitModal onCancel={() => setShowExitModal(false)} onConfirm={handleConfirmExit} />
        )}

      </div>
    );
  }



  // =========================================================================
  // SCHERMATA 2: PASSAGGIO ATTIVO (Layout 2 Colonne: Sinistra Testo Verbatim, Destra Triangolo Anelli)
  // =========================================================================

  if (!currentStep) {
    return null;
  }

  // Calcolo tempo da mostrare
  let displayTime = currentStep.time || 0;
  if (isStepFinished) {
    displayTime = 0;
  } else if (isCooking && machineContext.targetTime > 0) {
    displayTime = machineContext.targetTime;
  } else if (isPaused && remainingTime > 0) {
    displayTime = remainingTime;
  }

  // Circonferenza anelli (r=46, diametro 108px -> C = 2 * PI * 46 ≈ 289.02)
  const ringCircumference = 289.02;
  const totalStepTime = (currentStep.time && currentStep.time > 0) ? currentStep.time : 1;
  const timeProgress = isStepFinished
    ? 0
    : (isCooking || isPaused)
      ? Math.max(0, Math.min(1, displayTime / totalStepTime))
      : 1;
  const timeDashoffset = ringCircumference * (1 - timeProgress);

  return (
    <div className="flex-1 flex flex-col h-full bg-white text-gray-900 select-none overflow-hidden justify-between px-6 py-3">

      {/* 1. Barra Superiore: Titolo, Step corrente e tasto "Interrompi" con icona X rossa */}
      <div className="flex items-center justify-between shrink-0 h-9 border-b border-gray-100 pb-1.5">
        <div className="flex items-baseline gap-3 overflow-hidden">
          <h2 className="text-sm font-bold text-gray-900 tracking-tight truncate max-w-md">
            {recipeTitle || 'Cottura Guidata'}
          </h2>
          <span className="px-2.5 py-0.5 rounded-full bg-green-50 text-[#00a651] text-xs font-bold tracking-wide shrink-0">
            Passaggio {currentStepIndex + 1} di {totalSteps}
          </span>
        </div>

        {/* Tasto Uscita in alto a destra: icona X rossa + scritta "Interrompi" */}
        <button
          onClick={() => setShowExitModal(true)}
          className="px-3.5 py-1.5 rounded-full bg-white hover:bg-gray-50 border border-gray-200 flex items-center gap-1.5 text-gray-700 active:scale-95 transition-all text-xs font-semibold shadow-2xs cursor-pointer"
          title="Interrompi ricetta"
        >
          <X className="w-3.5 h-3.5 text-red-500 stroke-[2.5]" />
          <span>Interrompi</span>
        </button>
      </div>

      {/* 2. Corpo Centrale: 2 Colonne (Sinistra Testo Verbatim + Azioni, Destra Triangolo Anelli) */}
      <div className="flex-1 grid grid-cols-12 gap-5 my-2 items-center overflow-hidden">

        {/* COLONNA SINISTRA (7 col su 12): Testo COPIATO E INCOLLATO esatto + Azioni Rapide */}
        <div className="col-span-7 flex flex-col justify-between h-full pr-2 overflow-hidden">
          
          {/* Box testo verbatim scrollabile */}
          <div className="flex-1 flex flex-col justify-center overflow-y-auto pr-1">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 block">
              Istruzioni del Passaggio
            </span>
            <div className="text-base font-semibold text-gray-900 leading-relaxed select-text pr-2">
              {/* Testo originale copiato e incollato dal sito Cookidoo */}
              {currentStep.originalText || currentStep.instruction}
            </div>
          </div>

          {/* Pillole di supporto: "Ingredienti" e "Salta" */}
          <div className="flex items-center gap-2.5 pt-2 shrink-0">
            {/* Tasto per consultare la lista ingredienti con immagini, articoli utili, consigli e note personali */}
            <button
              onClick={() => setShowIngredientsModal(true)}
              className="px-3.5 py-1.5 rounded-full bg-gray-50 hover:bg-gray-100 border border-gray-200 flex items-center gap-1.5 text-xs font-bold text-gray-700 active:scale-95 transition-all shadow-2xs cursor-pointer"
              title="Visualizza ingredienti, note e consigli"
            >
              <ListChecks className="w-3.5 h-3.5 text-[#00a651]" />
              <span>Ingredienti</span>
            </button>

            {/* Tasto Salta Passaggio con modale di sicurezza */}
            <button
              onClick={() => setShowSkipModal(true)}
              className="px-3.5 py-1.5 rounded-full bg-gray-50 hover:bg-gray-100 border border-gray-200 flex items-center gap-1.5 text-xs font-bold text-gray-500 active:scale-95 transition-all shadow-2xs cursor-pointer"
              title="Salta questo passaggio"
            >
              <FastForward className="w-3.5 h-3.5 text-gray-400" />
              <span>Salta</span>
            </button>
          </div>

        </div>

        {/* COLONNA DESTRA (5 col su 12): 3 ANELLI A VERTICI DI TRIANGOLO */}
        <div className="col-span-5 flex flex-col items-center justify-center h-full">

          {/* CASO NORMALE: 3 ANELLI DISPOSTI A TRIANGOLO */}
          {!isWeigh && !isManual && (
            <div className="flex flex-col items-center justify-center gap-2">
              
              {/* VERTICI SUPERIORI DEL TRIANGOLO: TEMPO (Sinistra) & TEMPERATURA (Destra) */}
              <div className="flex items-center justify-center gap-4">
                
                {/* ANELLO 1: TEMPO */}
                <div className="w-[106px] h-[106px] rounded-full bg-white shadow-xs border border-gray-100 relative flex flex-col items-center justify-center">
                  <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 106 106">
                    <circle cx="53" cy="53" r="46" fill="none" stroke="#f1f5f9" strokeWidth="5.5" />
                    <circle
                      cx="53"
                      cy="53"
                      r="46"
                      fill="none"
                      stroke="#00a651"
                      strokeWidth="5.5"
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={timeDashoffset}
                      className="transition-all duration-300 ease-out"
                    />
                  </svg>
                  <div className="flex flex-col items-center justify-center z-10">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      Tempo
                    </span>
                    <span className="text-xl font-light font-mono text-gray-900 tabular-nums">
                      {formatDuration(displayTime)}
                    </span>
                    <span className="text-[8px] text-gray-400 font-medium">
                      min:sec
                    </span>
                  </div>
                </div>

                {/* ANELLO 2: TEMPERATURA */}
                <div className="w-[106px] h-[106px] rounded-full bg-white shadow-xs border border-gray-100 relative flex flex-col items-center justify-center">
                  <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 106 106">
                    <circle cx="53" cy="53" r="46" fill="none" stroke="#f1f5f9" strokeWidth="5.5" />
                    <circle
                      cx="53"
                      cy="53"
                      r="46"
                      fill="none"
                      stroke={currentStep.temp > 0 ? '#00a651' : '#e2e8f0'}
                      strokeWidth="5.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="flex flex-col items-center justify-center z-10">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      Temp.
                    </span>
                    {currentStep.temp === 120 ? (
                      <div className="flex flex-col items-center">
                        <VaromaSilhouetteIcon className="w-6 h-4 text-gray-900" />
                        <span className="text-xs font-bold text-gray-900 leading-tight">Varoma</span>
                      </div>
                    ) : (
                      <span className="text-xl font-light font-mono text-gray-900">
                        {currentStep.temp > 0 ? `${currentStep.temp}°` : '---'}
                      </span>
                    )}
                    <span className="text-[8px] text-gray-400 font-medium">
                      {currentStep.temp > 0 ? `${Math.floor(machineContext.currentTemp || 20)}°C reale` : 'spenta'}
                    </span>
                  </div>
                </div>

              </div>

              {/* VERTICE INFERIORE DEL TRIANGOLO: VELOCITÀ */}
              {/* Quando il passaggio è concluso (isStepFinished), mostra la consueta CAMPANELLA animata */}
              <div className="w-[106px] h-[106px] rounded-full bg-white shadow-xs border border-gray-100 relative flex flex-col items-center justify-center">
                <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 106 106">
                  <circle cx="53" cy="53" r="46" fill="none" stroke="#f1f5f9" strokeWidth="5.5" />
                  <circle
                    cx="53"
                    cy="53"
                    r="46"
                    fill="none"
                    stroke={isStepFinished ? '#16a34a' : '#00a651'}
                    strokeWidth="5.5"
                    strokeLinecap="round"
                  />
                </svg>

                {isStepFinished ? (
                  <div 
                    onClick={() => {
                      if (isAlarm) {
                        socket.emit('CMD', { type: 'ACK_ALARM' });
                      } else {
                        if (isLastStep) {
                          handleFinishRecipe();
                        } else {
                          handleNextStep();
                        }
                      }
                    }}
                    className="flex flex-col items-center justify-center z-10 animate-gentle-bounce cursor-pointer select-none"
                    title={isAlarm ? "Tocca per silenziare allarme" : (isLastStep ? "Passaggio finito! Tocca per completare ricetta" : "Passaggio finito! Tocca per proseguire")}
                  >
                    <Bell className="w-8 h-8 text-green-500 fill-green-500" />
                    <span className="text-[10px] font-bold text-green-600 mt-0.5 tracking-tight">Finito!</span>
                    <span className="text-[8px] text-gray-400 font-medium">
                      {isAlarm ? 'Tocca per OK' : (isLastStep ? 'Termina ➔' : 'Avanti ➔')}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center z-10">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      Velocità
                    </span>
                    <div className="text-xl font-light text-gray-900 flex items-center justify-center gap-1">
                      {isSpiga ? (
                        <img src={spigaIcon} alt="Spiga" className="w-5 h-5 object-contain" />
                      ) : (
                        <>
                          <span>{currentStep.speed === 0.5 ? '🥄' : currentStep.speed}</span>
                          {currentStep.direction && (
                            <span className="text-[#00a651] text-sm font-bold" title="Antiorario">↺</span>
                          )}
                        </>
                      )}
                    </div>
                    <span className="text-[8px] text-gray-400 font-medium">
                      {isSpiga ? 'Spiga' : (currentStep.direction ? 'antiorario' : 'orario')}
                    </span>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* CASO BILANCIA: ANELLO CENTRALE DEDICATO */}
          {isWeigh && (
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="w-[130px] h-[130px] rounded-full bg-white shadow-xs border border-gray-100 relative flex flex-col items-center justify-center">
                <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 130 130">
                  <circle cx="65" cy="65" r="57" fill="none" stroke="#f1f5f9" strokeWidth="6" />
                  <circle cx="65" cy="65" r="57" fill="none" stroke="#00a651" strokeWidth="6" />
                </svg>
                <div className="flex flex-col items-center justify-center z-10">
                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">
                    Bilancia
                  </span>
                  <span className="text-3xl font-light font-mono text-gray-900 tabular-nums">
                    {scaleWeight}
                  </span>
                  <span className="text-xs text-gray-500 font-medium">grammi</span>
                </div>
              </div>

              <button
                onClick={handleTareScale}
                className="px-5 py-1.5 rounded-full bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 font-bold text-xs shadow-2xs active:scale-95 transition-all cursor-pointer"
              >
                Azzera Tara
              </button>
            </div>
          )}

          {/* CASO AZIONE MANUALE */}
          {isManual && (
            <div className="w-[130px] h-[130px] rounded-full bg-white shadow-xs border border-gray-100 mx-auto flex flex-col items-center justify-center p-3 text-center">
              <Check className="w-8 h-8 text-[#00a651] mb-1 stroke-[2.5]" />
              <span className="text-xs font-bold text-gray-900">Azione Manuale</span>
              <span className="text-[10px] text-gray-400 mt-1 leading-tight">Nessun motore richiesto</span>
            </div>
          )}

        </div>

      </div>

      {/* 3. Controlli Inferiori: Tasti a Pillola Vorwerk (Indietro, Play/Pausa/Riprendi/Avanti fluido) */}
      <div className="flex items-center justify-between gap-4 shrink-0 pt-2 border-t border-gray-100">
        
        {/* Tasto a Pillola: Indietro (richiede conferma per evitare ritorni accidentali) */}
        <button
          onClick={() => requestStepChange('prev')}
          className="px-6 py-2.5 rounded-full flex items-center gap-1.5 font-bold text-xs border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 shadow-2xs active:scale-95 transition-all cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>{currentStepIndex === 0 ? 'Preparazione' : 'Indietro'}</span>
        </button>

        {/* Tasto a Pillola Principale Dinamico */}
        <div className="flex items-center gap-3">
          
          {/* STATO 1: Passaggio completato -> Avanza DIRETTAMENTE o completa ricetta */}
          {isStepFinished ? (
            <button
              onClick={isLastStep ? handleFinishRecipe : handleNextStep}
              className="py-3 px-8 rounded-full bg-[#00a651] hover:bg-[#008f45] active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <span>{isLastStep ? 'Termina Ricetta' : 'Prossimo Passaggio'}</span>
              <ChevronRight className="w-4 h-4 stroke-[2.8]" />
            </button>
          ) : isManual || isWeigh ? (
            /* STATO 2: Manuale o Pesatura -> Fatto, Continua o Termina direttamente */
            <button
              onClick={isLastStep ? handleFinishRecipe : handleNextStep}
              className="py-3 px-8 rounded-full bg-[#00a651] hover:bg-[#008f45] active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <span>{isLastStep ? 'Fatto, Termina Ricetta' : 'Fatto, Continua'}</span>
              <ChevronRight className="w-4 h-4 stroke-[2.8]" />
            </button>
          ) : isCooking && !isPaused ? (
            /* STATO 3: In Cottura -> Tasto PAUSA */
            <button
              onClick={handlePauseStep}
              className="py-3 px-8 rounded-full bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <Pause className="w-4 h-4 fill-current" />
              <span>Pausa</span>
            </button>
          ) : isPaused ? (
            /* STATO 4: In Pausa -> Tasto RIPRENDI */
            <button
              onClick={handleResumeStep}
              className="py-3 px-8 rounded-full bg-[#00a651] hover:bg-[#008f45] active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Riprendi Cottura</span>
            </button>
          ) : (
            /* STATO 5: Idle -> AVVIA COTTURA */
            <button
              onClick={handleStartStep}
              className="py-3 px-8 rounded-full bg-[#00a651] hover:bg-[#008f45] active:scale-95 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Avvia Cottura</span>
            </button>
          )}

        </div>

      </div>

      {/* =====================================================================
          MODALI DI CONFERMA & CONSULTAZIONE
          ===================================================================== */}

      {/* MODALE 1: Consulta Ingredienti (con Immagini, Articoli Utili, Consigli e Note Personali) */}
      {showIngredientsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col p-5 border border-gray-100">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <ListChecks className="w-5 h-5 text-[#00a651]" />
                <h3 className="text-base font-bold text-gray-900">Lista Ingredienti & Note</h3>
              </div>
              <button
                onClick={() => setShowIngredientsModal(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 select-text">
              {/* Ingredienti */}
              <div className="space-y-2">
                {ingredients && ingredients.length > 0 ? (
                  ingredients.map((ing, i) => (
                    <div key={i} className="p-2.5 rounded-xl bg-gray-50 border border-gray-100 text-xs flex items-center gap-3">
                      {ing.imageUrl ? (
                        <img 
                          src={ing.imageUrl} 
                          alt={ing.text}
                          className="w-9 h-9 object-contain rounded-lg bg-white border border-gray-200 p-0.5 shrink-0 shadow-2xs"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center shrink-0 text-gray-400">
                          <Utensils className="w-4 h-4 text-gray-400" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 leading-snug">{ing.text}</div>
                        {ing.note && (
                          <div className="text-[11px] text-gray-500 font-normal mt-0.5 flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-gray-400 inline-block shrink-0" />
                            <span>{ing.note}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-gray-500 italic text-center py-2">
                    Nessun ingrediente archiviato per questa ricetta.
                  </p>
                )}
              </div>

              {/* Articoli Utili reali (se presenti) */}
              {accessories && accessories.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block mb-1.5 flex items-center gap-1">
                    <Utensils className="w-3 h-3 text-[#00a651]" />
                    Articoli Utili
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {accessories.map((acc, idx) => (
                      <span key={idx} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 font-medium text-gray-700">
                        {acc}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Consigli & Suggerimenti dello chef (se presenti) */}
              {tips && tips.trim().length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="text-[10px] font-bold text-[#00a651] uppercase tracking-widest block mb-1.5 flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-[#00a651]" />
                    Consigli & Varianti
                  </span>
                  <p className="text-xs text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100 leading-relaxed italic">
                    "{tips}"
                  </p>
                </div>
              )}

              {/* Note Personali dell'utente (se presenti) */}
              {personalNotes && personalNotes.trim().length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <span className="text-[10px] font-bold text-amber-700 uppercase tracking-widest block mb-1.5 flex items-center gap-1">
                    <ListChecks className="w-3 h-3 text-amber-600" />
                    Note Personali
                  </span>
                  <p className="text-xs text-gray-800 bg-amber-50/70 p-2.5 rounded-xl border border-amber-200/60 leading-relaxed font-medium">
                    {personalNotes}
                  </p>
                </div>
              )}

            </div>

            <div className="pt-3 border-t border-gray-100 shrink-0 flex justify-end">
              <button
                onClick={() => setShowIngredientsModal(false)}
                className="px-6 py-2 rounded-full bg-[#00a651] text-white font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
              >
                Ho Capito
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE 2: Conferma Salto Passaggio con Azzeramento Sicurezza */}
      {showSkipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-xl max-w-sm w-full p-5 border border-gray-100 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-500 mx-auto flex items-center justify-center mb-3">
              <FastForward className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-1.5">
              Vuoi saltare questo passaggio?
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-5">
              Il Bimby arresterà il motore, resetterà tutti i parametri operativi e passerà al passaggio successivo.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setShowSkipModal(false)}
                className="px-5 py-2.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-bold text-xs active:scale-95 transition-all cursor-pointer"
              >
                Annulla
              </button>
              <button
                onClick={handleConfirmSkip}
                className="px-6 py-2.5 rounded-full bg-[#00a651] hover:bg-[#008f45] text-white font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
              >
                Salta Passaggio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE 3: Conferma Cambio Passaggio (utilizzato SOLO quando si torna indietro a metà cottura) */}
      {showStepConfirmModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl shadow-xl max-w-sm w-full p-5 border border-gray-100 text-center">
            <div className="w-12 h-12 rounded-full bg-green-50 text-[#00a651] mx-auto flex items-center justify-center mb-3">
              <ShieldAlert className="w-6 h-6 stroke-[2.2]" />
            </div>
            <h3 className="text-base font-bold text-gray-900 mb-1.5">
              {showStepConfirmModal.direction === 'next' 
                ? 'Passare al passaggio successivo?' 
                : 'Tornare al passaggio precedente?'}
            </h3>
            <p className="text-xs text-gray-500 leading-relaxed mb-5">
              Per sicurezza, la rotazione delle lame e il riscaldamento verranno arrestati e tutti i parametri (velocità, temperatura, timer) verranno azzerati prima del passaggio.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setShowStepConfirmModal({ open: false, direction: 'next' })}
                className="px-5 py-2.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-bold text-xs active:scale-95 transition-all cursor-pointer"
              >
                Annulla
              </button>
              <button
                onClick={confirmStepChange}
                className="px-6 py-2.5 rounded-full bg-[#00a651] hover:bg-[#008f45] text-white font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
              >
                Conferma
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODALE 4: Conferma Interruzione Ricetta */}
      {showExitModal && (
        <ExitModal onCancel={() => setShowExitModal(false)} onConfirm={handleConfirmExit} />
      )}

    </div>
  );
}

/**
 * Modale di conferma interruzione condiviso
 */
function ExitModal({ onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl shadow-xl max-w-sm w-full p-5 border border-gray-100 text-center">
        <div className="w-12 h-12 rounded-full bg-red-50 text-red-500 mx-auto flex items-center justify-center mb-3">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-gray-900 mb-1.5">
          Vuoi interrompere la ricetta?
        </h3>
        <p className="text-xs text-gray-500 leading-relaxed mb-5">
          La preparazione guidata verrà interrotta e tornerai al ricettario Cookidoo. Tutti i parametri correnti verranno azzerati per sicurezza.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-bold text-xs active:scale-95 transition-all cursor-pointer"
          >
            Continua Ricetta
          </button>
          <button
            onClick={onConfirm}
            className="px-6 py-2.5 rounded-full bg-red-500 hover:bg-red-600 text-white font-bold text-xs shadow-xs active:scale-95 transition-all cursor-pointer"
          >
            Interrompi Ricetta
          </button>
        </div>
      </div>
    </div>
  );
}
