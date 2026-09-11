import React, { useState, useEffect, useRef } from 'react';
import { socket } from './socket';
import { RotateCcw, X, Home, BookOpen, Settings, Bell, Check, LayoutGrid, ArrowLeft, ArrowRight, RotateCw, AlertTriangle } from 'lucide-react';
import { MODE_COMPONENTS } from './components/modes';
import SettingsPage from './components/settings/SettingsPage';
import RecipeRunner from './components/recipe/RecipeRunner';
import CookidooView from './components/recipe/CookidooView';
import PowerLossModal from './components/recipe/PowerLossModal';
import SafetyInterlockModal from './components/common/SafetyInterlockModal';

import bilanciaIcon from './assets/modes/bilancia.svg';
import bollitoreIcon from './assets/modes/bollitore.svg';
import turboIcon from './assets/modes/turbo.svg';
import spigaIcon from './assets/modes/spiga.svg';
import puliziaIcon from './assets/modes/pulizia.svg';
import riscaldaIcon from './assets/modes/riscalda.svg';
import cbtIcon from './assets/modes/cbt.svg';
import uovaIcon from './assets/modes/uova.svg';
import varomaIcon from './assets/modes/varoma.svg';

const MODES = [
  { id: 'bilancia', name: 'Bilancia', icon: bilanciaIcon },
  { id: 'bollitore', name: 'Bollitore', icon: bollitoreIcon },
  { id: 'turbo', name: 'Turbo', icon: turboIcon },
  { id: 'spiga', name: 'Spiga', icon: spigaIcon },
  { id: 'varoma', name: 'Varoma', icon: varomaIcon },
  { id: 'pulizia', name: 'Pulizia', icon: puliziaIcon },
  { id: 'riscalda', name: 'Riscalda alimenti', icon: riscaldaIcon },
  { id: 'cbt', name: 'CBT', icon: cbtIcon },
  { id: 'uova', name: 'Cuoci uova', icon: uovaIcon },
];

const BladeIcon = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 12c-3-3-6-3-8-1a5 5 0 0 0 0 7c2 2 5 2 8-1" />
    <path d="M12 12c3 3 6 3 8 1a5 5 0 0 0 0-7c-2-2-5-2-8 1" />
    <path d="M12 12c3-3 3-6 1-8a5 5 0 0 0-7 0c-2 2-2 5 1 8" />
    <path d="M12 12c-3 3-3 6-1 8a5 5 0 0 0 7 0c2-2 2-5-1-8" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const VaromaSilhouetteIcon = ({ className = "w-10 h-7" }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="30 44 80 55" fill="currentColor" className={className}>
    <path d="M 36 82.2 L 104 82.2 C 105.8 82.2, 107 83.5, 107 85.1 C 107 86.7, 105.8 88, 104 88 L 99.8 88 L 93.5 94.5 C 92 96, 90.2 96.5, 88.5 96.5 L 51.5 96.5 C 49.8 96.5, 48 96, 46.5 94.5 L 40.2 88 L 36 88 C 34.2 88, 33 86.7, 33 85.1 C 33 83.5, 34.2 82.2, 36 82.2 Z" />
    <path d="M 70 47.5 C 70.8 48.5, 70 53, 70.5 56 C 71.5 60, 75.3 64, 75 69 C 74.5 73.5, 71.8 76.5, 69.2 76.5 C 68.5 76.5, 68.6 75.5, 69.5 71.5 C 70 67.5, 66 62, 65 57.5 C 64.2 54, 66.5 50, 70 47.5 Z" />
    <path d="M 56 54.2 C 57.2 55.5, 56.5 59.5, 57 62 C 58 65.5, 60.5 68, 60 70.8 C 59.3 73.5, 57.2 75.2, 55.5 75.2 C 54.8 75.2, 55.2 73.5, 55.8 70.5 C 56.2 67, 53.5 63.5, 52.2 60 C 51.5 57, 53.5 55.2, 56 54.2 Z" />
    <path d="M 84 54.2 C 85.2 55.5, 84.5 59.5, 85 62 C 86 65.5, 88.5 68, 88 70.8 C 87.3 73.5, 85.2 75.2, 83.5 75.2 C 82.8 75.2, 83.2 73.5, 83.8 70.5 C 84.2 67, 81.5 63.5, 80.2 60 C 79.5 57, 81.5 55.2, 84 54.2 Z" />
  </svg>
);

const TEMP_STEPS = [0, 37, 50, 60, 70, 80, 90, 100, 120];
const SPEED_STEPS = [0, 0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const INACTIVITY_DIM_TIMEOUT = 5 * 60 * 1000; // 5 minuti di inattività totale (300.000 ms)

const FSM_STATE_LABELS = {
  IDLE: 'A riposo',
  LOCKING: 'Blocco il coperchio',
  STARTING_MOTOR: 'Avvio le lame',
  COOKING: 'Sto lavorando',
  STOPPING_MOTOR_NORMAL: 'Fermo le lame',
  STOPPING_MOTOR_ALARM: 'Timer scaduto',
  ALARM: 'Finito!',
  UNLOCKING_LID: 'Sblocco il coperchio',
  ERROR: 'Errore',
};

const getStatusDotClass = (state) => {
  if (state === 'ERROR') return 'bg-red-500 animate-pulse';
  if (state === 'ALARM') return 'bg-amber-500 animate-pulse';
  if (['LOCKING', 'STARTING_MOTOR', 'COOKING', 'STOPPING_MOTOR_NORMAL', 'STOPPING_MOTOR_ALARM', 'UNLOCKING_LID'].includes(state)) {
    return 'bg-tm-accent animate-pulse';
  }
  return 'bg-gray-300';
};

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);
  const [fsmState, setFsmState] = useState('IDLE');
  const [context, setContext] = useState({ targetSpeed: 0, targetTemp: 0, targetTime: 0, currentTemp: 20, antiClockwise: false });

  // UI States
  const [activeWidget, setActiveWidget] = useState(null);
  const [expandedTimeMode, setExpandedTimeMode] = useState(false);
  const [isPillClosing, setIsPillClosing] = useState(false);
  const [activeTimeSegment, setActiveTimeSegment] = useState('MM');

  // Stato allerta sicurezza interlock
  const [interlockAlert, setInterlockAlert] = useState(null);

  const [isStandby, setIsStandby] = useState(false);
  const [bootStage, setBootStage] = useState(1);

  // Protezione Burn-In / Attenuazione Display (configurabile da impostazioni)
  const [dimmingSettings, setDimmingSettings] = useState({
    enabled: true,
    dimPercentage: 15,
    timeoutSeconds: 300
  });
  const dimmingSettingsRef = useRef(dimmingSettings);
  dimmingSettingsRef.current = dimmingSettings;

  const [isScreenDimmed, setIsScreenDimmed] = useState(false);
  const isScreenDimmedRef = useRef(false);
  isScreenDimmedRef.current = isScreenDimmed;
  const dimInactivityTimer = useRef(null);

  const wakeUpScreen = () => {
    if (isScreenDimmedRef.current) {
      setIsScreenDimmed(false);
      isScreenDimmedRef.current = false;
      socket.emit('SET_SCREEN_DIMMED', { dimmed: false });
    }
    resetDimTimer();
  };

  const resetDimTimer = () => {
    if (dimInactivityTimer.current) {
      clearTimeout(dimInactivityTimer.current);
      dimInactivityTimer.current = null;
    }

    const configDim = dimmingSettingsRef.current;
    if (!configDim || configDim.enabled === false) {
      if (isScreenDimmedRef.current) {
        setIsScreenDimmed(false);
        isScreenDimmedRef.current = false;
        socket.emit('SET_SCREEN_DIMMED', { dimmed: false });
      }
      return;
    }

    const timeoutMs = (configDim.timeoutSeconds || 300) * 1000;

    dimInactivityTimer.current = setTimeout(() => {
      // Non attenuare se la macchina è in allarme
      if (fsmStateRef.current !== 'ALARM') {
        setIsScreenDimmed(true);
        isScreenDimmedRef.current = true;
        socket.emit('SET_SCREEN_DIMMED', { 
          dimmed: true, 
          dimPercentage: configDim.dimPercentage || 15 
        });
      }
    }, timeoutMs);
  };

  useEffect(() => {
    if (dimmingSettings.enabled === false) {
      if (isScreenDimmedRef.current) {
        setIsScreenDimmed(false);
        isScreenDimmedRef.current = false;
        socket.emit('SET_SCREEN_DIMMED', { dimmed: false });
      }
      if (dimInactivityTimer.current) {
        clearTimeout(dimInactivityTimer.current);
        dimInactivityTimer.current = null;
      }
    } else {
      resetDimTimer();
    }
  }, [dimmingSettings]);

  // Tab di navigazione (home, modes, recipes, settings)
  const [activeTab, setActiveTab] = useState('home');
  const [selectedMode, setSelectedMode] = useState(null);
  const [showCookingExitModal, setShowCookingExitModal] = useState(false);
  const [pendingExitTarget, setPendingExitTarget] = useState({ tab: 'modes', mode: null, modeName: null });

  // Stato ricetta guidata attiva
  const [isRecipeActive, setIsRecipeActive] = useState(false);
  const isRecipeActiveRef = useRef(false);
  isRecipeActiveRef.current = isRecipeActive;

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const selectedModeRef = useRef(selectedMode);
  selectedModeRef.current = selectedMode;

  const pendingExitTargetRef = useRef(pendingExitTarget);
  pendingExitTargetRef.current = pendingExitTarget;

  const handleRequestExitMode = (targetTab = 'modes', targetMode = null) => {
    resetInactivityTimer();
    // Se ci troviamo all'interno di una ricetta guidata attiva, la navigazione dalla sidebar è disattivata
    if (activeTabRef.current === 'recipes' && isRecipeActiveRef.current) {
      return;
    }
    // Solo stati di cottura attiva: escludiamo STOPPING_MOTOR_NORMAL, STOPPING_MOTOR_ALARM e UNLOCKING_LID
    // per consentire l'uscita immediata senza modale dopo che la cottura è già stata interrotta
    const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
    if (isCooking && (selectedModeRef.current === 'cbt' || selectedModeRef.current === 'bollitore' || selectedModeRef.current === 'spiga' || selectedModeRef.current === 'turbo' || selectedModeRef.current === 'riscalda' || selectedModeRef.current === 'uova' || selectedModeRef.current === 'varoma' || selectedModeRef.current === 'pulizia')) {
      setPendingExitTarget({ tab: targetTab, mode: targetMode, modeName: null });
      setShowCookingExitModal(true);
      return;
    }
    setActiveTab(targetTab);
    setSelectedMode(targetMode);
  };

  const handleSelectMode = (mode) => {
    resetInactivityTimer();
    const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
    if (isCooking) {
      setPendingExitTarget({ tab: 'modes', mode: mode.id, modeName: mode.name });
      setShowCookingExitModal(true);
      return;
    }

    // Reset automatico di velocità, temperatura e timer ogni volta che si accede a una modalità dalla home
    sendCommand('RESET');
    sendCommand('SET_SPEED', 0);
    sendCommand('SET_TEMP', 0);
    sendCommand('SET_TIME', 0);
    setContext(prev => ({
      ...prev,
      targetSpeed: 0,
      targetTemp: 0,
      targetTime: 0
    }));
    setSelectedMode(mode.id);
  };

  const handleConfirmExitCooking = () => {
    sendCommand('RESET');
    sendCommand('STOP');
    sendCommand('SET_SPEED', 0);
    sendCommand('SET_TEMP', 0);
    sendCommand('SET_TIME', 0);
    setContext(prev => ({
      ...prev,
      targetSpeed: 0,
      targetTemp: 0,
      targetTime: 0
    }));
    setShowCookingExitModal(false);
    const destTab = pendingExitTargetRef.current?.tab || 'modes';
    const destMode = pendingExitTargetRef.current?.mode || null;
    setActiveTab(destTab);
    setSelectedMode(destMode);
  };

  const handleCancelExitCooking = () => {
    setShowCookingExitModal(false);
  };

  // Refs per accedere allo stato più recente negli event listener senza re-binding
  const activeWidgetRef = useRef(activeWidget);
  activeWidgetRef.current = activeWidget;

  const expandedTimeModeRef = useRef(expandedTimeMode);
  expandedTimeModeRef.current = expandedTimeMode;

  const isPillClosingRef = useRef(isPillClosing);
  isPillClosingRef.current = isPillClosing;

  const closeExpandedTime = () => {
      if (!expandedTimeModeRef.current || isPillClosingRef.current) return;
      setIsPillClosing(true);
      setTimeout(() => {
          setExpandedTimeMode(false);
          setIsPillClosing(false);
      }, 280);
  };

  const openExpandedTime = () => {
      setIsPillClosing(false);
      setExpandedTimeMode(true);
      setActiveTimeSegment('MM');
  };

  const activeTimeSegmentRef = useRef(activeTimeSegment);
  activeTimeSegmentRef.current = activeTimeSegment;

  const contextRef = useRef(context);
  contextRef.current = context;

  const fsmStateRef = useRef(fsmState);
  fsmStateRef.current = fsmState;

  const isStandbyRef = useRef(isStandby);
  isStandbyRef.current = isStandby;

  const knobPressStart = useRef(null);
  const hasLongPressed = useRef(false);
  const standbyTimer = useRef(null);
  const pillTimer = useRef(null);
  const inactivityTimer = useRef(null);
  const touchTimer = useRef(null);
  const initialHomeTimeRef = useRef(0);
  const beepInterval = useRef(null);
  const audioCtx = useRef(null);
  const playBeep = () => {
      if (!audioCtx.current) {
          audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.current.state === 'suspended') {
          audioCtx.current.resume();
      }
      const osc = audioCtx.current.createOscillator();
      const gain = audioCtx.current.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, audioCtx.current.currentTime);
      gain.gain.setValueAtTime(0.5, audioCtx.current.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.current.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(audioCtx.current.destination);
      osc.start();
      osc.stop(audioCtx.current.currentTime + 0.3);
  };

  useEffect(() => {
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.on('state', (data) => {
      setFsmState(data.value.toUpperCase());
      setContext(data.context);
    });

    const handleRecipeState = (data) => {
      const hasRecipe = Boolean(data?.hasRecipe);
      setIsRecipeActive(hasRecipe);
      if (hasRecipe) {
        setActiveTab('recipes');
        setSelectedMode(null);
      }
    };
    socket.on('RECIPE_STATE', handleRecipeState);

    const handleSerialTx = (data) => {
      if (data) {
        console.log(`\n=============================================================`);
        console.log(`📡 [SERIAL TX] PACCHETTO INVIATO SUL BUS (${data.count} BYTES):`);
        console.log(`   ► BYTES (DEC) : [${data.rawBytes?.join(', ')}]`);
        console.log(`   ► BYTES (HEX) : [${data.hexBytes?.join(', ')}]`);
        console.log(`   ► HEX STREAM  : "${data.hexClean}"`);
        console.log(`   ► ASCII CHARS : "${data.ascii}"`);
        if (data.description) {
          console.log(`   ► COMANDO     : ${data.description}`);
        }
        console.log(`=============================================================\n`);
      }
    };
    socket.on('SERIAL_TX', handleSerialTx);

    const handleAppGoHome = () => {
      setActiveTab('home');
      setSelectedMode(null);
    };
    window.addEventListener('app-go-home', handleAppGoHome);

    // Sincronizzazione attenuazione schermo da socket
    const handleScreenDimmedState = (data) => {
      const dimmed = Boolean(data && (data.isDimmed !== undefined ? data.isDimmed : data.dimmed));
      setIsScreenDimmed(dimmed);
      isScreenDimmedRef.current = dimmed;
      if (data && (data.dimPercentage !== undefined || data.enabled !== undefined || data.timeoutSeconds !== undefined)) {
        setDimmingSettings(prev => ({
          ...prev,
          enabled: data.enabled !== undefined ? Boolean(data.enabled) : prev.enabled,
          dimPercentage: data.dimPercentage !== undefined ? Number(data.dimPercentage) : prev.dimPercentage,
          timeoutSeconds: data.timeoutSeconds !== undefined ? Number(data.timeoutSeconds) : prev.timeoutSeconds
        }));
      }
    };
    socket.on('SCREEN_DIMMED_STATE', handleScreenDimmedState);

    // Trigger manuale da impostazioni/test
    const handleTriggerScreenDim = () => {
      setIsScreenDimmed(true);
      isScreenDimmedRef.current = true;
      socket.emit('SET_SCREEN_DIMMED', { 
        dimmed: true,
        dimPercentage: dimmingSettingsRef.current?.dimPercentage || 15
      });
    };
    window.addEventListener('trigger-screen-dim', handleTriggerScreenDim);

    // Ricezione allerta immediata interlock (arresto emergenza o blocco)
    const handleInterlockAlert = (data) => {
      if (isScreenDimmedRef.current) {
        wakeUpScreen();
      }
      setInterlockAlert(data);
    };
    socket.on('INTERLOCK_ALERT', handleInterlockAlert);

    // Ricezione eventi hardware rotella encoder da backend
    const handleSocketKnobTurn = (data) => {
      const dir = Number(data?.direction || data?.delta || (data?.step > 0 ? 1 : -1)) || 1;
      handleKnobTurn(dir);
    };
    socket.on('KNOB_TURN', handleSocketKnobTurn);

    // Ricezione eventi hardware tasto fisico / click manopola da backend
    const handleSocketPhysicalButton = (data) => {
      wakeUpScreen();
      resetInactivityTimer();
      if (fsmStateRef.current === 'ALARM') {
        sendCommand('ACK_ALARM');
        setActiveWidget(null);
      } else if (activeTabRef.current === 'home') {
        const sequence = ['TIME', 'TEMP', 'SPEED'];
        const currentIndex = sequence.indexOf(activeWidgetRef.current);
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % sequence.length;
        setActiveWidget(sequence[nextIndex]);
      }
    };
    socket.on('PHYSICAL_BUTTON', handleSocketPhysicalButton);

    fetch('/api/settings')
      .then(r => r.json())
      .then(data => {
        if (data?.settings?.dimming) {
          setDimmingSettings(data.settings.dimming);
        }
      })
      .catch(() => {});

    const handleSettingsUpdated = (data) => {
      if (data?.settings?.dimming) {
        setDimmingSettings(data.settings.dimming);
      }
    };
    socket.on('SETTINGS_UPDATED', handleSettingsUpdated);

    fetch('/api/recipe/state')
      .then(r => r.json())
      .then(data => setIsRecipeActive(Boolean(data?.hasRecipe)))
      .catch(() => {});

    return () => { 
      socket.off('connect');
      socket.off('disconnect');
      socket.off('state');
      socket.off('RECIPE_STATE', handleRecipeState);
      socket.off('SERIAL_TX', handleSerialTx);
      socket.off('SCREEN_DIMMED_STATE', handleScreenDimmedState);
      socket.off('SETTINGS_UPDATED', handleSettingsUpdated);
      socket.off('INTERLOCK_ALERT', handleInterlockAlert);
      socket.off('KNOB_TURN', handleSocketKnobTurn);
      socket.off('PHYSICAL_BUTTON', handleSocketPhysicalButton);
      window.removeEventListener('app-go-home', handleAppGoHome);
      window.removeEventListener('trigger-screen-dim', handleTriggerScreenDim);
    };
  }, []);

  // Gestione Suono Allarme (e risveglio forzato schermo se attenuato)
  useEffect(() => {
      if (fsmState === 'IDLE' && interlockAlert) {
          setInterlockAlert(null);
      }
      if (fsmState === 'ALARM' || fsmState === 'ERROR') {
          if (isScreenDimmedRef.current) {
              wakeUpScreen();
          }
      }
      if (fsmState === 'ALARM') {
          if (!beepInterval.current) {
              playBeep();
              beepInterval.current = setInterval(playBeep, 800);
          }
      } else {
          if (beepInterval.current) {
              clearInterval(beepInterval.current);
              beepInterval.current = null;
          }
      }
  }, [fsmState]);

  // Disattivazione automatica selezione cerchi (10s di inattività reale dell'utente)
  const resetInactivityTimer = () => {
      if (inactivityTimer.current) {
          clearTimeout(inactivityTimer.current);
          inactivityTimer.current = null;
      }
      if (fsmStateRef.current !== 'ALARM' && (activeWidgetRef.current !== null || expandedTimeModeRef.current)) {
          inactivityTimer.current = setTimeout(() => {
              setActiveWidget(null);
              if (expandedTimeModeRef.current) {
                  closeExpandedTime();
              }
              inactivityTimer.current = null;
          }, 10000);
      }
  };

  // Riavvia il timer di inattività ogni volta che un cerchio o la pillola sono selezionati/deselezionati
  useEffect(() => {
      resetInactivityTimer();
      return () => {
          if (inactivityTimer.current) {
              clearTimeout(inactivityTimer.current);
              inactivityTimer.current = null;
          }
      };
  }, [activeWidget, expandedTimeMode]);

  // Reimposta il timer di inattività a qualsiasi tocco / click dell'utente sullo schermo
  // e ripristina la luminosità senza MAI bloccare o consumare i comandi
  useEffect(() => {
      resetDimTimer();

      const handleGlobalPointer = () => {
          if (isScreenDimmedRef.current) {
              wakeUpScreen();
          }
          resetDimTimer();
          resetInactivityTimer();
      };

      // Listener passivi: catturano qualsiasi tocco/rotazione riattivando la luminosità senza interferire con i pulsanti
      window.addEventListener('pointerdown', handleGlobalPointer, { passive: true });
      window.addEventListener('touchstart', handleGlobalPointer, { passive: true });
      window.addEventListener('wheel', handleGlobalPointer, { passive: true });

      return () => {
          window.removeEventListener('pointerdown', handleGlobalPointer);
          window.removeEventListener('touchstart', handleGlobalPointer);
          window.removeEventListener('wheel', handleGlobalPointer);
          if (dimInactivityTimer.current) {
              clearTimeout(dimInactivityTimer.current);
          }
      };
  }, []);

  // Gestione Boot Animation: 4 Fasi fluide
  // 1: Schermo bianco, fade-in di "Bimby TM31" al centro esatto
  // 2: "Bimby TM31" scorre morbidamente a sinistra e compare in dissolvenza "Smart"
  // 3: "Bimby TM31 Smart" rimpicciolisce da 5xl a 2xl e vola all'header in alto a sinistra
  // 4: Lo schermo bianco si dissolve e tutta la UI compare (fade-in)
  useEffect(() => {
      if (bootStage === 1) {
          const t = setTimeout(() => setBootStage(2), 200);
          return () => clearTimeout(t);
      } else if (bootStage === 2) {
          const t = setTimeout(() => setBootStage(3), 650);
          return () => clearTimeout(t);
      } else if (bootStage === 3) {
          const t = setTimeout(() => setBootStage(4), 850);
          return () => clearTimeout(t);
      } else if (bootStage === 4) {
          const t = setTimeout(() => setBootStage(5), 750);
          return () => clearTimeout(t);
      } else if (bootStage === 5) {
          const t = setTimeout(() => setBootStage(0), 600);
          return () => clearTimeout(t);
      }
  }, [bootStage]);

  const sendCommand = (cmd, value = null) => {
    if (cmd === 'PLAY' || cmd === 'STOP' || cmd === 'RESET' || cmd === 'TOGGLE_DIRECTION' || cmd === 'ACK_ALARM') {
        socket.emit('CMD', { type: cmd });
    } else {
        socket.emit('CMD', { type: cmd, value });
    }
  };

  const isCookingState = ['LOCKING', 'STARTING_MOTOR', 'COOKING', 'STOPPING_MOTOR_NORMAL', 'STOPPING_MOTOR_ALARM', 'UNLOCKING_LID'].includes(fsmState);

  const handleKnobTurn = (direction) => {
    if (isScreenDimmedRef.current) {
        wakeUpScreen();
    }
    resetDimTimer();
    resetInactivityTimer();
    if (activeTabRef.current === 'modes' && selectedModeRef.current === 'cbt') {
        window.dispatchEvent(new CustomEvent('cbt-knob-turn', { detail: { direction } }));
        return;
    }
    if (activeTabRef.current === 'modes' && selectedModeRef.current === 'spiga') {
        window.dispatchEvent(new CustomEvent('spiga-knob-turn', { detail: { delta: direction } }));
        return;
    }
    if (activeTabRef.current === 'modes' && selectedModeRef.current === 'turbo') {
        window.dispatchEvent(new CustomEvent('turbo-knob-turn', { detail: { delta: direction } }));
        return;
    }
    if (activeTabRef.current === 'modes' && selectedModeRef.current === 'riscalda') {
        window.dispatchEvent(new CustomEvent('riscalda-knob-turn', { detail: { direction } }));
        return;
    }
    if (activeTabRef.current === 'modes' && selectedModeRef.current === 'uova') {
        window.dispatchEvent(new CustomEvent('uova-knob-turn', { detail: { direction } }));
        return;
    }
    if (activeTabRef.current === 'modes' && selectedModeRef.current === 'varoma') {
        window.dispatchEvent(new CustomEvent('varoma-knob-turn', { detail: { direction } }));
        return;
    }
    if (activeTabRef.current === 'modes' && selectedModeRef.current === 'pulizia') {
        window.dispatchEvent(new CustomEvent('pulizia-knob-turn', { detail: { direction } }));
        return;
    }
    if (activeTabRef.current !== 'home') return;
    const currentExpanded = expandedTimeModeRef.current;
    const currentActive = activeWidgetRef.current;
    const currentSegment = activeTimeSegmentRef.current;
    const currentContext = contextRef.current;
    const currentFsm = fsmStateRef.current;
    const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING', 'STOPPING_MOTOR_NORMAL', 'STOPPING_MOTOR_ALARM', 'UNLOCKING_LID'].includes(currentFsm);

    if (currentExpanded && currentActive === 'TIME') {
        let h = Math.floor(currentContext.targetTime / 3600);
        let m = Math.floor((currentContext.targetTime % 3600) / 60);
        let s = currentContext.targetTime % 60;
        
        if (currentSegment === 'HH') h = Math.max(0, Math.min(48, h + direction));
        if (currentSegment === 'MM') m = Math.max(0, Math.min(59, m + direction));
        if (currentSegment === 'SS') s = Math.max(0, Math.min(59, s + direction));
        
        let newTime = (h * 3600) + (m * 60) + s;
        newTime = Math.min(172800, newTime); 
        sendCommand('SET_TIME', newTime);
        return;
    }

    if (currentActive === 'TIME') {
        let t = currentContext.targetTime;
        let step = 1;
        if (t >= 86400) step = 3600; 
        else if (t >= 10800) step = 1800; 
        else if (t >= 3600) step = 600; 
        else if (t >= 60) step = 15; 
        if (direction === -1) {
            if (t <= 60) step = 1;
            else if (t <= 3600) step = 15;
            else if (t <= 10800) step = 600;
            else if (t <= 86400) step = 1800;
            else step = 3600;
        }
        let newTime = Math.max(0, Math.min(172800, t + (direction * step)));
        sendCommand('SET_TIME', newTime);
    } else if (currentActive === 'TEMP') {
        const current = currentContext.targetTemp || 0;
        let newTemp = 0;
        if (direction > 0) {
            if (current === 0) {
                newTemp = 37;
            } else if (current < 100) {
                newTemp = current + 1;
            } else if (current === 100) {
                newTemp = 120; // Varoma (120°C) subito dopo i 100°C
            } else {
                newTemp = 120;
            }
        } else if (direction < 0) {
            if (current === 120) {
                newTemp = 100; // Scende da Varoma a 100°C
            } else if (current <= 37) {
                newTemp = 0;
            } else {
                newTemp = current - 1;
            }
        }
        sendCommand('SET_TEMP', newTemp);
    } else if (currentActive === 'SPEED') {
        let idx = SPEED_STEPS.indexOf(currentContext.targetSpeed);
        if (idx === -1) idx = 0; 
        idx = Math.max(0, Math.min(SPEED_STEPS.length - 1, idx + direction));
        let s = SPEED_STEPS[idx];
        if (s > 0 && currentFsm === 'IDLE') {
            sendCommand('SET_SPEED', s);
            sendCommand('PLAY');
        } else if (s === 0 && isCooking) {
            sendCommand('SET_SPEED', 0);
            sendCommand('SET_TEMP', 0);
            sendCommand('SET_TIME', 0);
            sendCommand('STOP');
            setContext(prev => ({
                ...prev,
                targetSpeed: 0,
                targetTemp: 0,
                targetTime: 0
            }));
        } else {
            sendCommand('SET_SPEED', s);
            setContext(prev => ({ ...prev, targetSpeed: s }));
        }
    }
  };

  // Keyboard controls - persistenti, nessun re-bind su cambi di stato
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isScreenDimmedRef.current) {
        wakeUpScreen();
      }
      resetDimTimer();

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleKnobTurn(1);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleKnobTurn(-1);
      }
      
      if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) {
              resetInactivityTimer();
              knobPressStart.current = Date.now();
              hasLongPressed.current = false;
              
              if (isStandbyRef.current) {
                  standbyTimer.current = setTimeout(() => {
                      setIsStandby(false);
                      setBootStage(1);
                      hasLongPressed.current = true;
                  }, 5000);
              } else if (activeTabRef.current === 'modes' && selectedModeRef.current === 'bilancia') {
                  // Tasto fisico su schermata Bilancia: tieni premuto 1.3 secondi per tarare
                  window.dispatchEvent(new CustomEvent('scale-physical-press-start'));
                  pillTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      pillTimer.current = null;
                      resetInactivityTimer();
                      window.dispatchEvent(new CustomEvent('scale-physical-tare'));
                  }, 1300);

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              } else if (activeTabRef.current === 'modes' && selectedModeRef.current === 'bollitore') {
                  // Tasto fisico su schermata Bollitore: tieni premuto 1.3s per avviare se a riposo
                  const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
                  if (!isCooking && fsmStateRef.current !== 'ALARM') {
                      window.dispatchEvent(new CustomEvent('bollitore-physical-start-press'));
                      pillTimer.current = setTimeout(() => {
                          hasLongPressed.current = true;
                          pillTimer.current = null;
                          resetInactivityTimer();
                          window.dispatchEvent(new CustomEvent('bollitore-physical-start-complete'));
                      }, 1300);
                  }

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              } else if (activeTabRef.current === 'modes' && selectedModeRef.current === 'cbt') {
                  // Tasto fisico su schermata CBT: tieni premuto 1.3s per avviare se a riposo
                  const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
                  if (!isCooking && fsmStateRef.current !== 'ALARM') {
                      window.dispatchEvent(new CustomEvent('cbt-physical-start-press'));
                      pillTimer.current = setTimeout(() => {
                          hasLongPressed.current = true;
                          pillTimer.current = null;
                          resetInactivityTimer();
                          window.dispatchEvent(new CustomEvent('cbt-physical-start-complete'));
                      }, 1300);
                  }

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              } else if (activeTabRef.current === 'modes' && selectedModeRef.current === 'spiga') {
                  // Tasto fisico su schermata Spiga: tieni premuto 1.3s per avviare se a riposo e non caldo
                  const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
                  if (!isCooking && fsmStateRef.current !== 'ALARM') {
                      window.dispatchEvent(new CustomEvent('spiga-physical-start-press'));
                      pillTimer.current = setTimeout(() => {
                          hasLongPressed.current = true;
                          pillTimer.current = null;
                          resetInactivityTimer();
                          window.dispatchEvent(new CustomEvent('spiga-physical-start-complete'));
                      }, 1300);
                  }

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              } else if (activeTabRef.current === 'modes' && selectedModeRef.current === 'turbo') {
                  // Tasto fisico su schermata Turbo: tieni premuto 1.3s per avviare se a riposo
                  const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
                  if (!isCooking && fsmStateRef.current !== 'ALARM') {
                      window.dispatchEvent(new CustomEvent('turbo-physical-start-press'));
                      pillTimer.current = setTimeout(() => {
                          hasLongPressed.current = true;
                          pillTimer.current = null;
                          resetInactivityTimer();
                          window.dispatchEvent(new CustomEvent('turbo-physical-start-complete'));
                      }, 1300);
                  }

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              } else if (activeTabRef.current === 'modes' && selectedModeRef.current === 'riscalda') {
                  // Tasto fisico su schermata Riscalda: tieni premuto 1.3s per avviare se a riposo
                  const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
                  if (!isCooking && fsmStateRef.current !== 'ALARM') {
                      window.dispatchEvent(new CustomEvent('riscalda-physical-start-press'));
                      pillTimer.current = setTimeout(() => {
                          hasLongPressed.current = true;
                          pillTimer.current = null;
                          resetInactivityTimer();
                          window.dispatchEvent(new CustomEvent('riscalda-physical-start-complete'));
                      }, 1300);
                  }

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              } else if (activeTabRef.current === 'modes' && selectedModeRef.current === 'uova') {
                  // Tasto fisico su schermata Cuoci Uova: tieni premuto 1.3s per avviare se a riposo
                  const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
                  if (!isCooking && fsmStateRef.current !== 'ALARM') {
                      window.dispatchEvent(new CustomEvent('uova-physical-start-press'));
                      pillTimer.current = setTimeout(() => {
                          hasLongPressed.current = true;
                          pillTimer.current = null;
                          resetInactivityTimer();
                          window.dispatchEvent(new CustomEvent('uova-physical-start-complete'));
                      }, 1300);
                  }

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              } else if (activeTabRef.current === 'modes' && selectedModeRef.current === 'varoma') {
                  // Tasto fisico su schermata Varoma: tieni premuto 1.3s per avviare se a riposo
                  const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
                  if (!isCooking && fsmStateRef.current !== 'ALARM') {
                      window.dispatchEvent(new CustomEvent('varoma-physical-start-press'));
                      pillTimer.current = setTimeout(() => {
                          hasLongPressed.current = true;
                          pillTimer.current = null;
                          resetInactivityTimer();
                          window.dispatchEvent(new CustomEvent('varoma-physical-start-complete'));
                      }, 1300);
                  }

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              } else if (activeTabRef.current === 'modes' && selectedModeRef.current === 'pulizia') {
                  // Tasto fisico su schermata Pulizia: tieni premuto 1.3s per avviare se a riposo
                  const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmStateRef.current);
                  if (!isCooking && fsmStateRef.current !== 'ALARM') {
                      window.dispatchEvent(new CustomEvent('pulizia-physical-start-press'));
                      pillTimer.current = setTimeout(() => {
                          hasLongPressed.current = true;
                          pillTimer.current = null;
                          resetInactivityTimer();
                          window.dispatchEvent(new CustomEvent('pulizia-physical-start-complete'));
                      }, 1300);
                  }

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              } else {
                  pillTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      pillTimer.current = null;
                      resetInactivityTimer();

                      const currentExpanded = expandedTimeModeRef.current;
                      const currentActive = activeWidgetRef.current;
                      const currentFsm = fsmStateRef.current;
                      const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING', 'STOPPING_MOTOR_NORMAL', 'STOPPING_MOTOR_ALARM', 'UNLOCKING_LID'].includes(currentFsm);

                      if (currentExpanded) {
                          closeExpandedTime();
                      } else if (currentActive === 'TIME') {
                          openExpandedTime();
                      } else if (currentActive === 'TEMP') {
                          sendCommand('SET_TEMP', 0);
                      } else if (currentActive === 'SPEED') {
                          sendCommand('SET_SPEED', 0);
                          if (isCooking) {
                              sendCommand('STOP');
                          }
                      }
                  }, 1300);

                  standbyTimer.current = setTimeout(() => {
                      hasLongPressed.current = true;
                      standbyTimer.current = null;
                      sendCommand('SET_SPEED', 0);
                      sendCommand('SET_TEMP', 0);
                      sendCommand('SET_TIME', 0);
                      sendCommand('STOP');
                      setIsStandby(true);
                  }, 10000);
              }
          }
      }
    };
    
    const handleKeyUp = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            resetInactivityTimer();
            if (activeTabRef.current === 'modes' && selectedModeRef.current === 'bilancia') {
                window.dispatchEvent(new CustomEvent('scale-physical-press-end'));
            }
            if (activeTabRef.current === 'modes' && selectedModeRef.current === 'bollitore') {
                window.dispatchEvent(new CustomEvent('bollitore-physical-start-release'));
                if (!hasLongPressed.current) {
                    window.dispatchEvent(new CustomEvent('bollitore-physical-tap'));
                }
            }
            if (activeTabRef.current === 'modes' && selectedModeRef.current === 'cbt') {
                window.dispatchEvent(new CustomEvent('cbt-physical-start-release'));
                if (!hasLongPressed.current) {
                    window.dispatchEvent(new CustomEvent('cbt-physical-click'));
                }
            }
            if (activeTabRef.current === 'modes' && selectedModeRef.current === 'spiga') {
                window.dispatchEvent(new CustomEvent('spiga-physical-start-release'));
                if (!hasLongPressed.current) {
                    window.dispatchEvent(new CustomEvent('spiga-physical-click'));
                }
            }
            if (activeTabRef.current === 'modes' && selectedModeRef.current === 'turbo') {
                window.dispatchEvent(new CustomEvent('turbo-physical-start-release'));
                if (!hasLongPressed.current) {
                    window.dispatchEvent(new CustomEvent('turbo-physical-click'));
                }
            }
            if (activeTabRef.current === 'modes' && selectedModeRef.current === 'riscalda') {
                window.dispatchEvent(new CustomEvent('riscalda-physical-start-release'));
                if (!hasLongPressed.current) {
                    window.dispatchEvent(new CustomEvent('riscalda-physical-tap'));
                }
            }
            if (activeTabRef.current === 'modes' && selectedModeRef.current === 'uova') {
                window.dispatchEvent(new CustomEvent('uova-physical-start-release'));
                if (!hasLongPressed.current) {
                    window.dispatchEvent(new CustomEvent('uova-physical-tap'));
                }
            }
            if (activeTabRef.current === 'modes' && selectedModeRef.current === 'varoma') {
                window.dispatchEvent(new CustomEvent('varoma-physical-start-release'));
                if (!hasLongPressed.current) {
                    window.dispatchEvent(new CustomEvent('varoma-physical-tap'));
                }
            }
            if (activeTabRef.current === 'modes' && selectedModeRef.current === 'pulizia') {
                window.dispatchEvent(new CustomEvent('pulizia-physical-start-release'));
                if (!hasLongPressed.current) {
                    window.dispatchEvent(new CustomEvent('pulizia-physical-tap'));
                }
            }
            if (activeTabRef.current === 'recipes') {
                if (!hasLongPressed.current) {
                    window.dispatchEvent(new CustomEvent('recipe-physical-action'));
                }
            }
            if (standbyTimer.current) {
                clearTimeout(standbyTimer.current);
                standbyTimer.current = null;
            }
            if (pillTimer.current) {
                clearTimeout(pillTimer.current);
                pillTimer.current = null;
            }
            if (knobPressStart.current) {
                knobPressStart.current = null;
                
                if (!isStandbyRef.current && !hasLongPressed.current) {
                    const currentFsm = fsmStateRef.current;
                    const currentExpanded = expandedTimeModeRef.current;
                    const currentActive = activeWidgetRef.current;
                    const currentSegment = activeTimeSegmentRef.current;

                    if (currentFsm === 'ALARM') {
                        sendCommand('ACK_ALARM');
                        setActiveWidget(null);
                    } else if (currentExpanded) {
                        const timeSequence = ['HH', 'MM', 'SS'];
                        const nextSegmentIndex = (timeSequence.indexOf(currentSegment) + 1) % timeSequence.length;
                        setActiveTimeSegment(timeSequence[nextSegmentIndex]);
                    } else if (activeTabRef.current === 'home') {
                        const sequence = ['TIME', 'TEMP', 'SPEED'];
                        const currentIndex = sequence.indexOf(currentActive);
                        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % sequence.length;
                        setActiveWidget(sequence[nextIndex]);
                    }
                }
                hasLongPressed.current = false;
            }
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        if (standbyTimer.current) clearTimeout(standbyTimer.current);
        if (pillTimer.current) clearTimeout(pillTimer.current);
    };
  }, []);

  const TimeDisplay = ({ seconds }) => {
    if (seconds >= 3600) {
        const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        return (
            <div className="flex items-baseline gap-0.5">
                <span>{h}</span><span className="text-xl text-gray-400 font-bold tracking-normal">h</span>
                <span className="ml-1.5">{m}</span><span className="text-xl text-gray-400 font-bold tracking-normal">m</span>
            </div>
        );
    }
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return (
        <div className="flex items-baseline gap-0.5">
            <span>{m}</span><span className="text-xl text-gray-400 font-bold tracking-normal">m</span>
            <span className="ml-1.5">{s}</span><span className="text-xl text-gray-400 font-bold tracking-normal">s</span>
        </div>
    );
  };

  const getHH = (s) => Math.floor(s / 3600).toString().padStart(2, '0');
  const getMM = (s) => Math.floor((s % 3600) / 60).toString().padStart(2, '0');
  const getSS = (s) => (s % 60).toString().padStart(2, '0');

  const handlePointerDown = (widget) => {
      resetInactivityTimer();
      touchTimer.current = setTimeout(() => {
          const currentFsm = fsmStateRef.current;
          const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING', 'STOPPING_MOTOR_NORMAL', 'STOPPING_MOTOR_ALARM', 'UNLOCKING_LID'].includes(currentFsm);

          if (widget === 'TIME') {
              openExpandedTime();
          } else if (widget === 'TEMP') {
              sendCommand('SET_TEMP', 0);
          } else if (widget === 'SPEED') {
              sendCommand('SET_SPEED', 0);
              sendCommand('SET_TEMP', 0);
              sendCommand('SET_TIME', 0);
              setContext(prev => ({
                  ...prev,
                  targetSpeed: 0,
                  targetTemp: 0,
                  targetTime: 0
              }));
              if (isCooking) {
                  sendCommand('STOP');
              }
          }
      }, 1300);
  };

  const handlePointerUp = () => {
      resetInactivityTimer();
      if (touchTimer.current) {
          clearTimeout(touchTimer.current);
          touchTimer.current = null;
      }
  };

  const isActivelyCooking = isCookingState && context.targetSpeed > 0 && fsmState !== 'STOPPING_MOTOR_NORMAL' && fsmState !== 'UNLOCKING_LID';
  const isHeating = context.targetSpeed > 0 && context.targetTemp > 0 && context.targetTime > 0 && (context.currentTemp || 20) < context.targetTemp && isActivelyCooking;
  const isTempReached = context.targetSpeed > 0 && context.targetTemp > 0 && (context.currentTemp || 20) >= context.targetTemp && isActivelyCooking;

  // Sincronizzazione durata iniziale per il timer decrescente in Home
  useEffect(() => {
    if (isCookingState) {
      if (!initialHomeTimeRef.current || initialHomeTimeRef.current < context.targetTime) {
        initialHomeTimeRef.current = context.targetTime;
      }
    } else if (fsmState !== 'ALARM') {
      initialHomeTimeRef.current = 0;
    }
  }, [isCookingState, context.targetTime, fsmState]);

  // Calcolo avanzamento dei 3 quadranti Home (r=78 -> circonferenza = 490.09)
  const homeCircumference = 490.09;

  // 1. Timer: decresce progressivamente mentre il timer scorre
  const initialHomeTime = initialHomeTimeRef.current || context.targetTime || 0;
  let homeTimeProgress = 0;
  if (isActivelyCooking) {
    if (initialHomeTime > 0) {
      homeTimeProgress = Math.max(0, Math.min(100, (context.targetTime / initialHomeTime) * 100));
    }
  } else if (fsmState === 'ALARM') {
    homeTimeProgress = 0;
  } else if (!isCookingState && context.targetSpeed === 0) {
    homeTimeProgress = context.targetTime > 0 ? 100 : 0;
  } else {
    homeTimeProgress = 0;
  }
  const homeTimeDashoffset = homeCircumference - (homeCircumference * homeTimeProgress) / 100;

  // 2. Temperatura: rispecchia l'avanzamento termico verso il target impostato.
  // Alla temperatura impostata o superiore l'anello è sempre al completo (100%) e non scende mai sotto il 100%.
  // Quando la velocità viene spenta, l'anello si azzera all'istante senza lag.
  let homeTempProgress = 0;
  const curHomeTemp = context.currentTemp || 20;
  if (context.targetTemp > 0) {
    if (isActivelyCooking) {
      if (curHomeTemp >= context.targetTemp) {
        // Temperatura raggiunta o boccale più caldo: anello sempre al 100% completo (non scende)
        homeTempProgress = 100;
      } else {
        // In cottura mentre il boccale sale verso la temperatura target
        homeTempProgress = Math.max(0, Math.min(100, (curHomeTemp / context.targetTemp) * 100));
      }
    } else if (!isCookingState && context.targetSpeed === 0) {
      // A riposo / selezione: rispecchia la posizione della temperatura target sulla scala 120°C
      homeTempProgress = Math.min(100, (context.targetTemp / 120) * 100);
    } else {
      // Spegnimento velocità / fase di arresto: azzeramento istantaneo senza alcun ritardo
      homeTempProgress = 0;
    }
  }
  const homeTempDashoffset = homeCircumference - (homeCircumference * homeTempProgress) / 100;

  // 3. Velocità: rispecchia la velocità selezionata (da 0 a 10)
  let homeSpeedProgress = 0;
  if (context.targetSpeed > 0) {
    homeSpeedProgress = Math.min(100, (context.targetSpeed / 10) * 100);
  }
  const homeSpeedDashoffset = homeCircumference - (homeCircumference * homeSpeedProgress) / 100;

  const circleClass = (name) => {
    const isAlarm = fsmState === 'ALARM';
    const isActive = activeWidget === name || (isAlarm && (name === 'TIME' || name === 'SPEED'));
    let baseClass = "relative w-[172px] h-[172px] rounded-full flex flex-col items-center justify-center bg-white transition-all duration-300 select-none cursor-pointer border border-gray-100/80 shadow-xs ";
    if (name === 'TEMP') {
        if (isHeating) return baseClass + (isActive ? "scale-105 shadow-[0_0_30px_rgba(250,204,21,0.5)] ring-2 ring-yellow-400/80 z-10" : "scale-100 bg-yellow-50/20");
        if (isTempReached) return baseClass + (isActive ? "scale-105 shadow-[0_0_30px_rgba(239,68,68,0.5)] ring-2 ring-red-500/80 z-10" : "scale-100 bg-red-50/15");
    }
    if (isActive) {
        return baseClass + "scale-105 shadow-md ring-2 ring-tm-accent/40 z-10";
    }
    return baseClass + "scale-100 hover:shadow-sm";
  };

  return (
    <div className="w-screen h-screen overflow-hidden flex bg-tm-bg text-tm-text font-sans relative select-none" onClickCapture={(e) => { if (fsmState === 'ALARM') { e.stopPropagation(); e.preventDefault(); sendCommand('ACK_ALARM'); } }}>
      {isStandby && (<div className="absolute inset-0 bg-black z-[9999]"></div>)}
      {bootStage > 0 && (
          <div className={`absolute inset-0 z-[9000] pointer-events-none transition-opacity duration-600 ease-in-out bg-white ${
              bootStage === 5 ? 'opacity-0' : 'opacity-100'
          }`}>
              <div 
                  className={`absolute flex items-center font-bold text-tm-text tracking-tight transition-all ease-in-out ${
                      bootStage >= 4 
                          ? 'top-[14px] left-[88px] translate-x-0 translate-y-0 text-xl duration-[750ms]' 
                          : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl duration-700'
                  } ${
                      bootStage === 1 ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
                  }`}
              >
                  <span className="whitespace-nowrap">Bimby TM31</span>
                  <span 
                      className={`font-light whitespace-nowrap overflow-hidden transition-all duration-700 ease-in-out ${
                          bootStage >= 3 ? 'max-w-[200px] opacity-100 ml-2.5' : 'max-w-0 opacity-0 ml-0'
                      }`}
                  >
                      Smart
                  </span>
              </div>
          </div>
      )}
      <div className={`relative w-full h-full flex transition-opacity duration-600 ease-out ${bootStage === 0 || bootStage === 5 ? 'opacity-100' : 'opacity-0'}`}>
        <div className={`bg-white flex flex-col items-center shadow-xs z-20 transition-all duration-300 ${
            activeTab === 'recipes' && isRecipeActive
                ? 'w-0 p-0 border-0 opacity-0 overflow-hidden pointer-events-none'
                : 'w-16 border-r border-gray-100 py-4 gap-2.5'
        }`}>
            <div 
                onClick={() => handleRequestExitMode('home', null)}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    activeTab === 'home' 
                        ? 'bg-green-50 text-tm-accent shadow-xs' 
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
                title="Cottura"
            >
                <Home className="w-5 h-5" />
            </div>
            <div 
                onClick={() => handleRequestExitMode('modes', null)}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    activeTab === 'modes' 
                        ? 'bg-green-50 text-tm-accent shadow-xs' 
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
                title="Modalità"
            >
                <LayoutGrid className="w-5 h-5" />
            </div>
            <div 
                onClick={() => handleRequestExitMode('recipes', null)}
                className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    activeTab === 'recipes' 
                        ? 'bg-green-50 text-tm-accent shadow-xs' 
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
                title="Ricette"
            >
                <BookOpen className="w-5 h-5" />
            </div>

            {/* Pillola verticale navigazione Cookidoo: tra Ricette e Impostazioni */}
            {activeTab === 'recipes' && (
                <div className="my-auto flex flex-col items-center bg-white border border-gray-200/90 rounded-full p-1 gap-1.5 shadow-2xs animate-in fade-in zoom-in-95 duration-200">
                    <button
                        onClick={() => window.dispatchEvent(new CustomEvent('COOKIDOO_NAV', { detail: { action: 'back' } }))}
                        className="w-9 h-9 rounded-full bg-white hover:bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-700 active:scale-90 transition-all shadow-2xs cursor-pointer"
                        title="Indietro nella pagina"
                    >
                        <ArrowLeft className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => window.dispatchEvent(new CustomEvent('COOKIDOO_NAV', { detail: { action: 'forward' } }))}
                        className="w-9 h-9 rounded-full bg-white hover:bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-700 active:scale-90 transition-all shadow-2xs cursor-pointer"
                        title="Avanti nella pagina"
                    >
                        <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                        onClick={() => window.dispatchEvent(new CustomEvent('COOKIDOO_NAV', { detail: { action: 'home' } }))}
                        className="w-9 h-9 rounded-full bg-white hover:bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-700 active:scale-90 transition-all shadow-2xs cursor-pointer"
                        title="Home Cookidoo"
                    >
                        <Home className="w-4 h-4 text-tm-accent" />
                    </button>
                    <button
                        onClick={() => window.dispatchEvent(new CustomEvent('COOKIDOO_NAV', { detail: { action: 'reload' } }))}
                        className="w-9 h-9 rounded-full bg-white hover:bg-gray-50 border border-gray-200 flex items-center justify-center text-gray-700 active:scale-90 transition-all shadow-2xs cursor-pointer"
                        title="Ricarica pagina"
                    >
                        <RotateCw className="w-4 h-4 text-gray-500" />
                    </button>
                </div>
            )}

            <div 
                onClick={() => handleRequestExitMode('settings', null)}
                className={`mt-auto w-11 h-11 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    activeTab === 'settings' 
                        ? 'bg-green-50 text-tm-accent shadow-xs' 
                        : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                }`}
                title="Impostazioni"
            >
                <Settings className="w-5 h-5" />
            </div>
        </div>
      <div className="flex-1 flex flex-col relative">
        {context.targetTemp > 0 && context.targetTime === 0 && activeTab === 'home' && (
            <div className="absolute bottom-3.5 left-1/2 -translate-x-1/2 z-40 bg-red-500/10 border border-red-500/30 backdrop-blur-md text-red-600 px-4 py-1.5 rounded-full text-xs font-bold shadow-xs">
                Imposta un timer per avviare la cottura
            </div>
        )}
        {activeTab !== 'recipes' && (
          <div className="h-14 px-6 flex justify-between items-center">
              {activeTab === 'home' && (
                  <h1 className="text-xl font-bold text-tm-text tracking-tight">Bimby TM31 <span className="font-light">Smart</span></h1>
              )}
              {activeTab === 'modes' && (
                  selectedMode ? (
                      <div className="flex items-center gap-3">
                          <button 
                              onClick={() => handleRequestExitMode('modes', null)}
                              className="w-8 h-8 rounded-full bg-white hover:bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-600 transition-all active:scale-95 shadow-xs"
                              title="Torna alle modalità"
                          >
                              <ArrowLeft className="w-4 h-4" />
                          </button>
                          <h1 className="text-xl font-bold text-tm-text tracking-tight">
                              {MODES.find(m => m.id === selectedMode)?.name || 'Modalità'}
                          </h1>
                      </div>
                  ) : (
                      <h1 className="text-xl font-bold text-tm-text tracking-tight">
                          Modalità
                      </h1>
                  )
              )}
              {activeTab === 'settings' && (
                  <h1 className="text-xl font-bold text-tm-text tracking-tight flex items-center gap-2">
                      <span>Impostazioni</span>
                      <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2.5 py-0.5 rounded-full">Bimby TM31</span>
                  </h1>
              )}
              <div className="px-3.5 py-1.5 rounded-full bg-white border border-gray-200 text-gray-600 font-bold flex items-center gap-2 text-xs shadow-xs select-none">
                  <div className={`w-2.5 h-2.5 rounded-full ${getStatusDotClass(fsmState)}`}></div>
                  <span>{context.mode === 'spiga' && ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmState) ? 'Impasto in corso' : (FSM_STATE_LABELS[fsmState] || fsmState)}</span>
              </div>
          </div>
        )}

        {/* Contenuto Pagina Home (Cottura) */}
        {activeTab === 'home' && (
          <>
            <div className="flex-1 flex items-center justify-center gap-6 pb-6">
                {/* Cerchio Tempo */}
                <div 
                    className={circleClass('TIME')} 
                    onClick={() => {
                        if (fsmState === 'ALARM') { sendCommand('ACK_ALARM'); setActiveWidget(null); }
                        else setActiveWidget('TIME');
                    }}
                    onPointerDown={() => handlePointerDown('TIME')}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                >
                    {/* SVG Progress Ring Tempo (decrescente durante la cottura) */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 172 172">
                        <circle
                            cx="86"
                            cy="86"
                            r="78"
                            fill="none"
                            stroke="#f1f5f9"
                            strokeWidth="7"
                        />
                        <circle
                            cx="86"
                            cy="86"
                            r="78"
                            fill="none"
                            stroke={isCookingState ? '#10b981' : '#00a651'}
                            strokeWidth={isCookingState ? '8' : '7'}
                            strokeLinecap="round"
                            strokeDasharray={homeCircumference}
                            strokeDashoffset={homeTimeDashoffset}
                            className="transition-all duration-300 ease-out"
                        />
                    </svg>

                    {fsmState === 'ALARM' ? (
                        <div className="flex flex-col items-center animate-in zoom-in duration-300 z-10">
                            <Bell className="w-12 h-12 text-tm-accent animate-bounce" />
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-2">Timer Scaduto</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center z-10">
                            <div className="text-4xl font-light tabular-nums tracking-tight flex items-baseline leading-none">
                                <TimeDisplay seconds={context.targetTime} />
                            </div>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-4">Tempo</span>
                        </div>
                    )}
                </div>

                {/* Cerchio Temperatura */}
                <div 
                    className={circleClass('TEMP')} 
                    onClick={() => setActiveWidget('TEMP')}
                    onPointerDown={() => handlePointerDown('TEMP')}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                >
                    {/* SVG Progress Ring Temperatura (reale in cottura, impostata a riposo) */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 172 172">
                        <circle
                            cx="86"
                            cy="86"
                            r="78"
                            fill="none"
                            stroke="#f1f5f9"
                            strokeWidth="7"
                        />
                        <circle
                            cx="86"
                            cy="86"
                            r="78"
                            fill="none"
                            stroke={isHeating ? '#f59e0b' : isTempReached ? '#ef4444' : '#00a651'}
                            strokeWidth={isHeating || isTempReached ? '8' : '7'}
                            strokeLinecap="round"
                            strokeDasharray={homeCircumference}
                            strokeDashoffset={homeTempDashoffset}
                            className={`transition-all duration-300 ease-out ${
                                isHeating ? 'animate-pulse drop-shadow-[0_0_8px_rgba(245,158,11,0.6)]' : ''
                            }`}
                        />
                    </svg>

                    {context.targetTemp === 120 ? (
                        <div className="flex flex-col items-center justify-center animate-in fade-in duration-200 z-10">
                            <VaromaSilhouetteIcon className="w-10 h-7 text-tm-text mb-0.5" />
                            <span className="text-lg font-bold tracking-tight text-tm-text leading-tight">
                                Varoma
                            </span>
                            <div className="text-xs font-semibold text-gray-400 leading-none mt-1">
                                {Math.floor(context.currentTemp || 20)}°C
                            </div>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1.5">Temperatura</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center z-10">
                            <div className="text-4xl font-light tracking-tight flex items-baseline leading-none">
                                {context.targetTemp}<span className="text-xl text-gray-400 font-bold ml-0.5">°C</span>
                            </div>
                            <div className="text-xs font-semibold text-gray-400 leading-none mt-1">
                                {Math.floor(context.currentTemp || 20)}°C
                            </div>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1.5">Temperatura</span>
                        </div>
                    )}
                </div>

                {/* Cerchio Velocità */}
                <div 
                    className={circleClass('SPEED')} 
                    onClick={() => {
                        if (fsmState === 'ALARM') { sendCommand('ACK_ALARM'); setActiveWidget(null); }
                        else setActiveWidget('SPEED');
                    }}
                    onPointerDown={() => handlePointerDown('SPEED')}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                >
                    {/* SVG Progress Ring Velocità (rispecchia la velocità selezionata da 0 a 10) */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none" viewBox="0 0 172 172">
                        <circle
                            cx="86"
                            cy="86"
                            r="78"
                            fill="none"
                            stroke="#f1f5f9"
                            strokeWidth="7"
                        />
                        <circle
                            cx="86"
                            cy="86"
                            r="78"
                            fill="none"
                            stroke={isCookingState ? '#10b981' : '#00a651'}
                            strokeWidth={isCookingState ? '8' : '7'}
                            strokeLinecap="round"
                            strokeDasharray={homeCircumference}
                            strokeDashoffset={homeSpeedDashoffset}
                            className="transition-all duration-300 ease-out"
                        />
                    </svg>

                    {fsmState === 'ALARM' ? (
                        <div className="flex flex-col items-center animate-in zoom-in duration-300 z-10">
                            <Check className="w-12 h-12 text-tm-accent" />
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-2">Clicca il tasto</span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center z-10">
                            <div className="text-4xl font-light tracking-tight flex items-center gap-1.5 leading-none">
                                {context.targetSpeed === 0.5 ? <BladeIcon className="w-8 h-8 text-tm-text" /> : context.targetSpeed}
                                {context.antiClockwise && <RotateCcw className="w-5 h-5 text-tm-accent" />}
                            </div>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-4">Velocità</span>
                        </div>
                    )}
                </div>

            </div>

            {/* Pulsante Inverti Rotazione Sempre Visibile in Basso su Home */}
            <div className="absolute bottom-3 right-5">
                <button 
                onClick={() => sendCommand('TOGGLE_DIRECTION')}
                className={`px-3.5 py-2 rounded-full transition-all shadow-md border flex items-center gap-2 font-bold text-xs ${context.antiClockwise ? 'bg-tm-accent text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 active:scale-95'}`}
                >
                    <RotateCcw className="w-4 h-4" />
                    <span>Inverti rotazione</span>
                </button>
            </div>
          </>
        )}

        {/* Contenuto Pagina Modalità */}
        {activeTab === 'modes' && (
            !selectedMode ? (
                <div className="flex-1 flex flex-col justify-center items-center px-6 py-2 select-none overflow-y-auto">
                    <div className="flex flex-col items-center gap-y-4 max-w-2xl mx-auto">
                        {/* Prima riga: 5 modalità */}
                        <div className="flex justify-center items-start gap-x-7">
                            {MODES.slice(0, 5).map((mode) => (
                                <div 
                                    key={mode.id}
                                    onClick={() => handleSelectMode(mode)}
                                    className="flex flex-col items-center cursor-pointer group transition-all w-[92px]"
                                >
                                    <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center transition-all duration-200 group-hover:scale-108 group-active:scale-95 drop-shadow-sm group-hover:drop-shadow-md">
                                        <img 
                                            src={mode.icon} 
                                            alt={mode.name} 
                                            className="w-full h-full object-contain pointer-events-none" 
                                        />
                                    </div>
                                    <span className="text-[11px] font-bold mt-1.5 tracking-tight text-center transition-colors max-w-[92px] leading-tight text-gray-700 group-hover:text-tm-accent">
                                        {mode.name}
                                    </span>
                                </div>
                            ))}
                        </div>
                        {/* Seconda riga: 4 modalità centrate in modo perfettamente simmetrico */}
                        <div className="flex justify-center items-start gap-x-7">
                            {MODES.slice(5, 9).map((mode) => (
                                <div 
                                    key={mode.id}
                                    onClick={() => handleSelectMode(mode)}
                                    className="flex flex-col items-center cursor-pointer group transition-all w-[92px]"
                                >
                                    <div className="w-[72px] h-[72px] rounded-full flex items-center justify-center transition-all duration-200 group-hover:scale-108 group-active:scale-95 drop-shadow-sm group-hover:drop-shadow-md">
                                        <img 
                                            src={mode.icon} 
                                            alt={mode.name} 
                                            className="w-full h-full object-contain pointer-events-none" 
                                        />
                                    </div>
                                    <span className="text-[11px] font-bold mt-1.5 tracking-tight text-center transition-colors max-w-[92px] leading-tight text-gray-700 group-hover:text-tm-accent">
                                        {mode.name}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col bg-white mx-4 mb-3 rounded-2xl border border-gray-100 shadow-xs relative overflow-hidden animate-in fade-in duration-200">
                    {React.createElement(MODE_COMPONENTS[selectedMode] || (() => <div className="w-full h-full bg-white" />))}
                </div>
            )
        )}

        {/* Contenuto Pagina Ricette (Cookidoo & Cottura Guidata) */}
        {activeTab === 'recipes' && (
            <CookidooView />
        )}

        {/* Contenuto Pagina Impostazioni */}
        {activeTab === 'settings' && (
            <SettingsPage onOpenCookidoo={() => handleRequestExitMode('recipes', null)} />
        )}

        {/* Overlay a Pillola (Timer Espanso con animazione di espansione e chiusura) */}
        {expandedTimeMode && (
            <div 
                className={`absolute inset-0 z-50 flex items-center justify-center bg-gray-900/35 backdrop-blur-md ${
                    isPillClosing ? 'animate-backdrop-fade-out pointer-events-none' : 'animate-backdrop-fade'
                }`}
                onClick={closeExpandedTime}
            >
                <div className={`flex flex-col items-center gap-4 ${
                    isPillClosing ? 'animate-pill-shrink' : 'animate-pill-expand'
                }`}>
                    <div className="relative">
                        <button 
                            onClick={(e) => { e.stopPropagation(); closeExpandedTime(); }} 
                            className="absolute -top-3 -right-3 p-2 bg-white rounded-full text-gray-400 hover:text-gray-600 transition-colors shadow-lg z-10 border border-gray-100 hover:scale-105 active:scale-95"
                        >
                            <X className="w-4 h-4" />
                        </button>
                        <div 
                            className="bg-white w-[520px] h-[130px] rounded-[65px] shadow-2xl border border-gray-100 flex items-center justify-center gap-4 px-8 relative text-5xl font-light tabular-nums select-none"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div onClick={() => setActiveTimeSegment('HH')} className={`px-4 py-2 rounded-2xl cursor-pointer transition-all flex items-baseline gap-1.5 ${activeTimeSegment === 'HH' ? 'bg-gray-100 text-tm-accent scale-105 shadow-inner' : 'opacity-60 hover:opacity-100'}`}>
                                {getHH(context.targetTime)}<span className="text-2xl text-gray-400 font-bold">h</span>
                            </div>
                            <span className="text-gray-300 font-bold">:</span>
                            <div onClick={() => setActiveTimeSegment('MM')} className={`px-4 py-2 rounded-2xl cursor-pointer transition-all flex items-baseline gap-1.5 ${activeTimeSegment === 'MM' ? 'bg-gray-100 text-tm-accent scale-105 shadow-inner' : 'opacity-60 hover:opacity-100'}`}>
                                {getMM(context.targetTime)}<span className="text-2xl text-gray-400 font-bold">m</span>
                            </div>
                            <span className="text-gray-300 font-bold">:</span>
                            <div onClick={() => setActiveTimeSegment('SS')} className={`px-4 py-2 rounded-2xl cursor-pointer transition-all flex items-baseline gap-1.5 ${activeTimeSegment === 'SS' ? 'bg-gray-100 text-tm-accent scale-105 shadow-inner' : 'opacity-60 hover:opacity-100'}`}>
                                {getSS(context.targetTime)}<span className="text-2xl text-gray-400 font-bold">s</span>
                            </div>
                        </div>
                    </div>
                    
                    {/* Tasto Azzera Esterno */}
                    <button 
                        onClick={(e) => { e.stopPropagation(); sendCommand('SET_TIME', 0); }} 
                        className={`px-7 py-2 bg-white text-red-500 rounded-full font-bold uppercase text-xs tracking-widest hover:bg-red-50 transition-all shadow-md border border-red-100 hover:scale-105 active:scale-95 ${
                            isPillClosing ? 'opacity-0 scale-90 transition-all duration-200' : 'animate-pop-in'
                        }`}
                    >
                        Azzera Timer
                    </button>
                </div>
            </div>
        )}

      </div>
      </div>

      {/* Modale Conferma Interruzione Cottura (per CBT e Bollitore) */}
      {showCookingExitModal && (
          <div 
              className="absolute inset-0 z-[9500] flex items-center justify-center bg-black/40 backdrop-blur-xs select-none animate-in fade-in duration-200"
              onClick={handleCancelExitCooking}
          >
              <div 
                  className="bg-white rounded-3xl p-6 shadow-2xl border border-gray-100 max-w-sm w-full mx-4 text-center animate-in zoom-in-95 duration-200"
                  onClick={(e) => e.stopPropagation()}
              >
                  <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto mb-3.5">
                      <AlertTriangle className="w-6 h-6 stroke-[2.2]" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-800 tracking-tight mb-2">
                      {pendingExitTarget?.modeName 
                          ? `Vuoi interrompere la cottura per passare alla modalità ${pendingExitTarget.modeName}?`
                          : 'Vuoi interrompere la cottura?'
                      }
                  </h3>
                  <p className="text-xs text-gray-500 mb-6 leading-relaxed">
                      La preparazione in corso verrà interrotta e tutti i parametri verranno azzerati.
                  </p>
                  <div className="flex items-center justify-center gap-4">
                      <button
                          onClick={handleCancelExitCooking}
                          className="px-6 py-2.5 min-w-[100px] rounded-full border border-gray-200 text-gray-700 font-bold text-sm hover:bg-gray-50 active:scale-95 transition-all shadow-2xs cursor-pointer"
                      >
                          No
                      </button>
                      <button
                          onClick={handleConfirmExitCooking}
                          className="px-6 py-2.5 min-w-[100px] rounded-full bg-red-600 hover:bg-red-700 text-white font-bold text-sm active:scale-95 transition-all shadow-md cursor-pointer"
                      >
                          Sì
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* Modale di Ripristino Blackout (Power Loss Recovery) ad altissima priorità */}
      <PowerLossModal 
        onAccept={() => {
          setActiveTab('recipes');
          setSelectedMode(null);
        }} 
      />

      {/* Modale di Allerta di Sicurezza Interlock (Coperchio / Boccale) */}
      <SafetyInterlockModal 
        isOpen={Boolean(
          interlockAlert || 
          (fsmState === 'ERROR' && (context?.errorCode === 'LID_NOT_LOCKED' || context?.errorCode === 'BOWL_NOT_PRESENT' || context?.errorCode === 'INTERLOCK_TRIPPED'))
        )}
        errorData={interlockAlert || {
          code: context?.errorCode,
          message: context?.errorMessage
        }}
        onReset={() => {
          sendCommand('RESET');
          setInterlockAlert(null);
        }}
      />

      {/* Attenuazione Luminosità Display (senza salvaschermo né blocco comandi) */}
      <div 
        aria-hidden="true"
        className="fixed inset-0 z-[9990] bg-black pointer-events-none transition-opacity duration-700 ease-in-out"
        style={{
          opacity: isScreenDimmed ? (1 - ((dimmingSettings?.dimPercentage ?? 15) / 100)) : 0
        }}
      />
    </div>
  );
}

export default App;
