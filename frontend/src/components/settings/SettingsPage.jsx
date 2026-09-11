import React, { useState, useEffect } from 'react';
import { socket } from '../../socket';
import { 
  Cpu, 
  Check, 
  Keyboard, 
  AlertCircle, 
  Info, 
  RefreshCw, 
  Key, 
  CheckCircle2, 
  Sliders,
  Monitor,
  Server,
  Activity,
  Wifi,
  Sparkles,
  Zap,
  Terminal,
  Layers,
  ChevronRight,
  ArrowLeft,
  BookOpen,
  Scale,
  Moon,
  Sun,
  ShieldCheck,
  ShieldAlert,
  CloudDownload,
  Power,
  Volume2
} from 'lucide-react';
import VirtualKeyboard from '../common/VirtualKeyboard';
import WifiSettings from './WifiSettings';
import CookidooSettings from './CookidooSettings';
import ScaleCalibration from './ScaleCalibration';
import UpdateModal from './UpdateModal';
import PowerModal from './PowerModal';

const formatUptime = (seconds) => {
  if (typeof seconds !== 'number' || isNaN(seconds)) return 'N/D';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

const MODEL_PRESETS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-1.5-flash',
  'gemini-1.5-pro'
];

export default function SettingsPage({ onOpenCookidoo }) {
  // Voce selezionata: null (menu principale) | 'wifi' | 'cookidoo' | 'ai' | 'diag'
  const [selectedSection, setSelectedSection] = useState(null);
  const [wifiStatus, setWifiStatus] = useState(null);
  const [cookidooStatus, setCookidooStatus] = useState(null);
  const [interlockStatus, setInterlockStatus] = useState(null);
  const [secretTaps, setSecretTaps] = useState(0);
  
  const [modelName, setModelName] = useState('gemini-2.5-flash');
  const [hasApiKey, setHasApiKey] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [testStatus, setTestStatus] = useState(null); // null, 'testing', 'success', 'error'
  const [testResult, setTestResult] = useState(null);

  // Aggiornamenti OTA & Versione Git
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [versionInfo, setVersionInfo] = useState(null);
  const [updateCheck, setUpdateCheck] = useState(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  // Modale Spegnimento & Riavvio
  const [isPowerModalOpen, setIsPowerModalOpen] = useState(false);

  // Informazioni di sistema realmente rilevate
  const [systemInfo, setSystemInfo] = useState(null);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [clientViewport, setClientViewport] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 0,
    h: typeof window !== 'undefined' ? window.innerHeight : 0,
    screenW: typeof window !== 'undefined' && window.screen ? window.screen.width : 0,
    screenH: typeof window !== 'undefined' && window.screen ? window.screen.height : 0,
    touchPoints: typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0
  });

  // Stato attenuazione luminosità display
  const [dimmingSettings, setDimmingSettings] = useState({
    enabled: true,
    dimPercentage: 15,
    timeoutSeconds: 300
  });

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Salvataggio impostazioni di attenuazione luminosità
  const saveDimmingSettings = async (partial) => {
    const updated = { ...dimmingSettings, ...partial };
    setDimmingSettings(updated);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dimming: updated })
      });
      if (res.ok) {
        showToast('Impostazioni luminosità salvate');
      } else {
        showToast('Errore nel salvataggio impostazioni');
      }
    } catch (e) {
      showToast('Errore di connessione');
    }
  };

  // Test e controllo hardware Buzzer Piezoelettrico PWM (GPIO 18)
  const handleTestBuzzer = async (action = 'beep') => {
    try {
      await fetch('/api/system/buzzer/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, frequency: 2500, duration: action === 'timer_done' ? null : 150 })
      });
      showToast(action === 'timer_done' ? 'Buzzer: Avviato jingle fine cottura TM31' : 'Buzzer: Bip inviato (2500Hz)');
    } catch (e) {
      showToast('Errore test buzzer');
    }
  };

  const handleStopBuzzer = async () => {
    try {
      await fetch('/api/system/buzzer/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      showToast('Buzzer silenziato');
    } catch (e) {
      showToast('Errore stop buzzer');
    }
  };

  // Caricamento impostazioni e metriche reali dal server
  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        if (data?.settings?.geminiModel) {
          setModelName(data.settings.geminiModel);
        }
        if (data?.settings?.dimming) {
          setDimmingSettings(data.settings.dimming);
        }
        if (typeof data?.hasApiKey === 'boolean') {
          setHasApiKey(data.hasApiKey);
        }
        if (data?.systemInfo) {
          setSystemInfo(data.systemInfo);
        }
      }
    } catch (err) {
      console.warn('Errore fetch /api/settings:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchWifiStatus = async () => {
    try {
      const res = await fetch('/api/wifi/status');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setWifiStatus(data);
        }
      }
    } catch (err) {}
  };

  const fetchCookidooStatus = async () => {
    // 1. Prova prima via Electron IPC se disponibile
    if (typeof window !== 'undefined' && window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        if (ipcRenderer) {
          const res = await ipcRenderer.invoke('cookidoo:get-status');
          if (res?.success && res.hasAuthCookie) {
            setCookidooStatus(prev => ({ ...prev, isLoggedIn: true, cookieCount: res.cookieCount }));
          }
        }
      } catch (e) {}
    }

    // 2. Chiedi al server lo stato registrato
    try {
      const res = await fetch('/api/cookidoo/status');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setCookidooStatus(prev => ({ ...prev, ...data }));
        }
      }
    } catch (err) {}
  };

  const fetchInterlockStatus = async () => {
    try {
      const res = await fetch('/api/system/interlock');
      if (res.ok) {
        const data = await res.json();
        setInterlockStatus(data);
      }
    } catch (err) {}
  };

  const toggleSimulateObstacle = async () => {
    try {
      const nextVal = !interlockStatus?.simulateObstacle;
      await fetch('/api/system/interlock/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulateObstacle: nextVal })
      });
      showToast(nextVal ? 'Simulazione: Ostacolo coperchio inserito' : 'Simulazione: Coperchio libero');
    } catch (e) {}
  };

  const toggleSimulateBowlMissing = async () => {
    try {
      const nextVal = !interlockStatus?.simulateBowlMissing;
      await fetch('/api/system/interlock/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ simulateBowlMissing: nextVal })
      });
      showToast(nextVal ? 'Simulazione: Boccale rimosso' : 'Simulazione: Boccale presente');
    } catch (e) {}
  };

  useEffect(() => {
    fetchSettings();
    fetchWifiStatus();
    fetchCookidooStatus();
    fetchInterlockStatus();

    const handleResize = () => {
      setClientViewport({
        w: window.innerWidth,
        h: window.innerHeight,
        screenW: window.screen ? window.screen.width : 0,
        screenH: window.screen ? window.screen.height : 0,
        touchPoints: navigator.maxTouchPoints || 0
      });
    };
    window.addEventListener('resize', handleResize);

    const handleConnect = () => setIsSocketConnected(true);
    const handleDisconnect = () => setIsSocketConnected(false);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    const handleSettingsUpdated = (data) => {
      if (data?.settings?.geminiModel) {
        setModelName(data.settings.geminiModel);
      }
      if (data?.settings?.dimming) {
        setDimmingSettings(data.settings.dimming);
      }
      if (typeof data?.hasApiKey === 'boolean') {
        setHasApiKey(data.hasApiKey);
      }
      if (data?.systemInfo) {
        setSystemInfo(data.systemInfo);
      }
    };

    const handleState = (stateData) => {
      if (stateData?.value) {
        setSystemInfo((prev) => (prev ? { ...prev, fsmState: stateData.value } : null));
      }
    };

    const handleCookidooStatus = (st) => {
      if (st) setCookidooStatus(st);
    };

    const handleCookidooCleared = () => {
      setCookidooStatus({ isLoggedIn: false, userName: null, cookieCount: 0 });
    };

    const handleInterlockState = (data) => {
      setInterlockStatus(data);
    };

    socket.on('SETTINGS_UPDATED', handleSettingsUpdated);
    socket.on('state', handleState);
    socket.on('COOKIDOO_STATUS_UPDATED', handleCookidooStatus);
    socket.on('COOKIDOO_DATA_CLEARED', handleCookidooCleared);
    socket.on('INTERLOCK_STATE', handleInterlockState);

    fetchVersionInfo();
    const intervalId = setInterval(fetchSettings, 10000);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('SETTINGS_UPDATED', handleSettingsUpdated);
      socket.off('state', handleState);
      socket.off('COOKIDOO_STATUS_UPDATED', handleCookidooStatus);
      socket.off('COOKIDOO_DATA_CLEARED', handleCookidooCleared);
      socket.off('INTERLOCK_STATE', handleInterlockState);
      clearInterval(intervalId);
    };
  }, []);

  const fetchVersionInfo = async () => {
    try {
      const res = await fetch('/api/system/version');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setVersionInfo(data);
        }
      }
    } catch (err) {}
  };

  const checkOtaUpdates = async () => {
    setIsCheckingUpdate(true);
    try {
      const res = await fetch('/api/system/update/check');
      if (res.ok) {
        const data = await res.json();
        setUpdateCheck(data);
        if (data.updateAvailable) {
          showToast('Nuovo aggiornamento disponibile su GitHub!');
        } else if (data.success) {
          showToast('Il sistema è aggiornato all\'ultima versione.');
        }
      }
    } catch (err) {
      showToast('Errore verifica aggiornamenti');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleSaveModel = async (newModel) => {
    if (!newModel || typeof newModel !== 'string' || newModel.trim().length === 0) {
      showToast('Nome modello non valido');
      return;
    }

    const trimmed = newModel.trim();
    setIsLoading(true);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiModel: trimmed })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setModelName(trimmed);
        showToast(`Modello salvato: ${trimmed}`);
        fetchSettings();
      } else {
        showToast(data.error || 'Errore durante il salvataggio');
      }
    } catch (err) {
      showToast('Errore di connessione al server');
    } finally {
      setIsLoading(false);
      setIsKeyboardOpen(false);
    }
  };

  const handleTestModel = async () => {
    setTestStatus('testing');
    setTestResult(null);
    try {
      const sample = "Cuocere per 3 minuti a 100°C velocità 1 antiorario";
      const res = await fetch('/api/recipe/parse-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sample, autoLoad: false })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestStatus('success');
        setTestResult(data.step);
        showToast('Test completato con successo!');
      } else {
        setTestStatus('error');
        setTestResult({ error: data.error || 'Risposta non valida' });
        showToast(data.error || 'Errore durante il test');
      }
    } catch (err) {
      setTestStatus('error');
      setTestResult({ error: err.message });
      showToast('Errore chiamata test');
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full bg-[#f8fafc] text-gray-800 select-none overflow-hidden px-5 py-3 relative">
      
      {/* Toast Notifica Flottante */}
      {toastMessage && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-gray-900/90 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg border border-gray-700 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-[#00a651]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {!selectedSection ? (
        <div className="flex-1 min-h-0 flex flex-col h-full overflow-hidden">
          {/* Intestazione Sezione con Secret Tap per sbloccare il menu tecnico */}
          <div 
            onClick={() => {
              setSecretTaps(prev => {
                const next = prev + 1;
                if (next >= 5) {
                  setSelectedSection('scale_calib');
                  showToast('🔧 Menu Tecnico Sbloccato: Calibrazione Bilancia HX711');
                  return 0;
                }
                return next;
              });
            }}
            className="flex items-center gap-3 pb-3 mb-2 border-b border-gray-200/80 shrink-0 cursor-pointer select-none"
          >
            <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center text-[#00a651] shrink-0">
              <Sliders className="w-5 h-5 stroke-[2.2]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 tracking-tight leading-none">
                Impostazioni
              </h2>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Seleziona una voce per gestire o configurare il dispositivo
              </p>
            </div>
          </div>

          {/* Lista Voci Impostazioni - Con Supporto Scorrimento Touch per 800x480 */}
          <div className="flex-1 min-h-0 overflow-y-auto pr-1.5 pb-6 flex flex-col gap-2.5 max-w-2xl mx-auto w-full touch-pan-y overscroll-contain">
            {/* Voce 1: Rete Wi-Fi */}
            <div
              onClick={() => {
                setSelectedSection('wifi');
                fetchWifiStatus();
              }}
              className="bg-white hover:bg-gray-50/80 active:scale-[0.99] border border-gray-200/80 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center text-[#00a651] shrink-0 group-hover:scale-105 transition-transform">
                  <Wifi className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 group-hover:text-[#00a651] transition-colors">
                      Rete Wi-Fi
                    </span>
                    {wifiStatus?.connected ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00a651] animate-pulse" />
                        {wifiStatus.ssid}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">
                        Non connesso
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Scansione reti wireless, connessione e inserimento password
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-gray-50 group-hover:bg-green-50 flex items-center justify-center text-gray-400 group-hover:text-[#00a651] transition-colors shrink-0 ml-2">
                <ChevronRight className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>

            {/* Voce 2: App Cookidoo */}
            <div
              onClick={() => {
                setSelectedSection('cookidoo');
                fetchCookidooStatus();
              }}
              className="bg-white hover:bg-gray-50/80 active:scale-[0.99] border border-gray-200/80 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#00a651] shrink-0 group-hover:scale-105 transition-transform">
                  <BookOpen className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 group-hover:text-[#00a651] transition-colors">
                      App Cookidoo
                    </span>
                    {cookidooStatus?.isLoggedIn ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#00a651] animate-pulse" />
                        {cookidooStatus.userName || 'Accesso Eseguito'}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">
                        Non connesso
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Stato account, sincronizzazione preferiti ed eliminazione cookie
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-gray-50 group-hover:bg-emerald-50 flex items-center justify-center text-gray-400 group-hover:text-[#00a651] transition-colors shrink-0 ml-2">
                <ChevronRight className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>

            {/* Voce 3: Modello IA */}
            <div
              onClick={() => setSelectedSection('ai')}
              className="bg-white hover:bg-gray-50/80 active:scale-[0.99] border border-gray-200/80 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0 group-hover:scale-105 transition-transform">
                  <Sparkles className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                      Modello IA (Gemini)
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-blue-50 text-blue-700 border border-blue-200">
                      {modelName}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Configurazione motore Gemini per ricette guidate, API Key e test
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-gray-50 group-hover:bg-blue-50 flex items-center justify-center text-gray-400 group-hover:text-blue-600 transition-colors shrink-0 ml-2">
                <ChevronRight className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>

            {/* Voce 4: Schermo & Luminosità */}
            <div
              onClick={() => setSelectedSection('display')}
              className="bg-white hover:bg-gray-50/80 active:scale-[0.99] border border-gray-200/80 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0 group-hover:scale-105 transition-transform">
                  <Sun className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 group-hover:text-amber-600 transition-colors">
                      Schermo & Luminosità
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      dimmingSettings.enabled
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-gray-100 text-gray-500 border-gray-200'
                    }`}>
                      {dimmingSettings.enabled 
                        ? `${dimmingSettings.dimPercentage}% • ${dimmingSettings.timeoutSeconds >= 60 ? `${Math.round(dimmingSettings.timeoutSeconds / 60)} min` : `${dimmingSettings.timeoutSeconds}s`}`
                        : 'Disattivata'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Attenuazione automatica, percentuale luminosità (5-50%) e tempo inattività
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-gray-50 group-hover:bg-amber-50 flex items-center justify-center text-gray-400 group-hover:text-amber-600 transition-colors shrink-0 ml-2">
                <ChevronRight className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>

            {/* Voce 5: Diagnostica Hardware */}
            <div
              onClick={() => setSelectedSection('diag')}
              className="bg-white hover:bg-gray-50/80 active:scale-[0.99] border border-gray-200/80 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0 group-hover:scale-105 transition-transform">
                  <Activity className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 group-hover:text-purple-600 transition-colors">
                      Diagnostica Hardware
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      systemInfo?.serialConnected 
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}>
                      {systemInfo?.serialConnected ? 'Seriale OK' : 'Seriale Offline'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Seriale TM31, FSM, memoria RAM, protezione burn-in display (5 min) e uptime
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-gray-50 group-hover:bg-purple-50 flex items-center justify-center text-gray-400 group-hover:text-purple-600 transition-colors shrink-0 ml-2">
                <ChevronRight className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>

            {/* Voce 5: Aggiornamenti di Sistema (OTA) */}
            <div
              onClick={() => {
                setSelectedSection('ota');
                fetchVersionInfo();
              }}
              className="bg-white hover:bg-gray-50/80 active:scale-[0.99] border border-gray-200/80 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 shrink-0 group-hover:scale-105 transition-transform">
                  <CloudDownload className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 group-hover:text-teal-600 transition-colors">
                      Aggiornamenti di Sistema
                    </span>
                    {versionInfo?.commit ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono bg-teal-50 text-teal-700 border border-teal-200">
                        {versionInfo.commit}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200">
                        OTA GitHub
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Verifica modifiche da GitHub, ricompilazione Vite e riavvio PM2
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-gray-50 group-hover:bg-teal-50 flex items-center justify-center text-gray-400 group-hover:text-teal-600 transition-colors shrink-0 ml-2">
                <ChevronRight className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>

            {/* Voce 6: Calibrazione Bilancia (HX711) - Menu Tecnico */}
            <div
              onClick={() => setSelectedSection('scale_calib')}
              className="bg-white hover:bg-gray-50/80 active:scale-[0.99] border border-gray-200/80 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200/90 flex items-center justify-center text-amber-600 shrink-0 group-hover:scale-105 transition-transform shadow-2xs">
                  <Scale className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 group-hover:text-amber-600 transition-colors">
                      Calibrazione Bilancia (HX711)
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      Servizio Tecnico
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Taratura celle di carico e ricalcolo fattore di conversione con peso noto
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-gray-50 group-hover:bg-amber-50 flex items-center justify-center text-gray-400 group-hover:text-amber-600 transition-colors shrink-0 ml-2">
                <ChevronRight className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>

            {/* Voce 7: Spegnimento & Riavvio */}
            <div
              onClick={() => setIsPowerModalOpen(true)}
              className="bg-white hover:bg-rose-50/40 active:scale-[0.99] border border-gray-200/80 hover:border-rose-200 rounded-2xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-2xs group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-500 shrink-0 group-hover:scale-105 transition-transform">
                  <Power className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900 group-hover:text-rose-600 transition-colors">
                      Spegnimento e Riavvio
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                      Alimentazione
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    Arresto sicuro del motore, sblocco coperchio e spegnimento del Bimby
                  </p>
                </div>
              </div>
              <div className="w-8 h-8 rounded-full bg-gray-50 group-hover:bg-rose-50 flex items-center justify-center text-gray-400 group-hover:text-rose-600 transition-colors shrink-0 ml-2">
                <ChevronRight className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col h-full">
          {/* Header Voce di Dettaglio con Tasto Indietro (senza barra 'Impostazioni Bimby TM31' e senza slicer) */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-200/80 shrink-0">
            <button
              onClick={() => {
                setSelectedSection(null);
                fetchWifiStatus();
                fetchCookidooStatus();
              }}
              className="flex items-center gap-2 px-3 py-1.5 -ml-1 rounded-xl bg-white hover:bg-gray-50 active:scale-95 border border-gray-200/90 text-gray-700 text-xs font-bold transition-all shadow-2xs cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4 text-gray-600 stroke-[2.2]" />
              <span>Indietro</span>
            </button>

            <div className="flex items-center gap-2">
              {selectedSection === 'wifi' && (
                <>
                  <div className="w-6 h-6 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center text-[#00a651]">
                    <Wifi className="w-3.5 h-3.5 stroke-[2.2]" />
                  </div>
                  <span className="text-xs font-bold text-gray-900">Rete Wi-Fi</span>
                </>
              )}
              {selectedSection === 'cookidoo' && (
                <>
                  <div className="w-6 h-6 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-[#00a651]">
                    <BookOpen className="w-3.5 h-3.5 stroke-[2.2]" />
                  </div>
                  <span className="text-xs font-bold text-gray-900">App Cookidoo</span>
                </>
              )}
              {selectedSection === 'ai' && (
                <>
                  <div className="w-6 h-6 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600">
                    <Sparkles className="w-3.5 h-3.5 stroke-[2.2]" />
                  </div>
                  <span className="text-xs font-bold text-gray-900">Modello IA (Gemini)</span>
                </>
              )}
              {selectedSection === 'display' && (
                <>
                  <div className="w-6 h-6 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
                    <Sun className="w-3.5 h-3.5 stroke-[2.2]" />
                  </div>
                  <span className="text-xs font-bold text-gray-900">Schermo & Luminosità</span>
                </>
              )}
              {selectedSection === 'diag' && (
                <>
                  <div className="w-6 h-6 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600">
                    <Activity className="w-3.5 h-3.5 stroke-[2.2]" />
                  </div>
                  <span className="text-xs font-bold text-gray-900">Diagnostica Hardware</span>
                </>
              )}
              {selectedSection === 'scale_calib' && (
                <>
                  <div className="w-6 h-6 rounded-lg bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
                    <Scale className="w-3.5 h-3.5 stroke-[2.2]" />
                  </div>
                  <span className="text-xs font-bold text-gray-900">Calibrazione Bilancia (HX711)</span>
                </>
              )}
              {selectedSection === 'ota' && (
                <>
                  <div className="w-6 h-6 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600">
                    <CloudDownload className="w-3.5 h-3.5 stroke-[2.2]" />
                  </div>
                  <span className="text-xs font-bold text-gray-900">Aggiornamenti di Sistema (OTA)</span>
                </>
              )}
            </div>
          </div>

          {/* 1. SEZIONE RETE WI-FI */}
          {selectedSection === 'wifi' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <WifiSettings />
            </div>
          )}

          {/* 2. SEZIONE APP COOKIDOO */}
          {selectedSection === 'cookidoo' && (
            <div className="flex-1 overflow-hidden flex flex-col">
              <CookidooSettings onOpenCookidoo={onOpenCookidoo} />
            </div>
          )}

          {/* 2. SCHEDA MODELLO AI & CLOUD */}
          {selectedSection === 'ai' && (
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          
          <div className="grid grid-cols-12 gap-3.5">
            {/* Box Configurazione Modello */}
            <div className="col-span-7 bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#00a651]" />
                  <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                    Modello Google Gemini
                  </span>
                </div>
                <span className="text-[10px] font-semibold bg-green-50 text-[#00a651] px-2.5 py-0.5 rounded-full border border-green-100">
                  Attivo
                </span>
              </div>

              {/* Campo Modello con apertura tastiera */}
              <div 
                onClick={() => setIsKeyboardOpen(true)}
                className="group flex items-center justify-between bg-gray-50 hover:bg-gray-100/80 active:bg-gray-200/60 border border-gray-200 rounded-xl px-3.5 py-2.5 cursor-pointer transition-all shadow-inner"
              >
                <div className="flex items-center gap-2.5 overflow-hidden">
                  <Keyboard className="w-5 h-5 text-gray-400 group-hover:text-[#00a651] transition-colors shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
                      Tocca per modificare
                    </span>
                    <span className="text-sm font-mono font-bold text-gray-900 tracking-wide truncate">
                      {modelName}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 bg-white px-3 py-1 rounded-lg border border-gray-200 text-xs font-bold text-gray-700 shadow-2xs">
                  <span>Modifica</span>
                </div>
              </div>

              {/* Preset Rapidi */}
              <div className="flex flex-col gap-1.5 pt-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Preset Consigliati:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {MODEL_PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => handleSaveModel(p)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all border cursor-pointer ${
                        modelName === p
                          ? 'bg-[#00a651] text-white border-[#008f45] shadow-2xs'
                          : 'bg-gray-50 hover:bg-gray-100 text-gray-600 border-gray-200'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Box API Key & Test */}
            <div className="col-span-5 flex flex-col gap-3">
              
              {/* Stato Chiave API */}
              <div className="bg-white rounded-2xl p-3.5 border border-gray-200/80 shadow-2xs flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Key className="w-4 h-4 text-gray-400" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      GEMINI_API_KEY
                    </span>
                    <span className="text-xs font-bold text-gray-800">
                      {hasApiKey ? 'Configurata nel server (.env)' : 'Non configurata'}
                    </span>
                  </div>
                </div>

                <span className={`w-2.5 h-2.5 rounded-full ${hasApiKey ? 'bg-[#00a651] animate-pulse' : 'bg-red-500'}`} />
              </div>

              {/* Test Live */}
              <div className="bg-white rounded-2xl p-3.5 border border-gray-200/80 shadow-2xs flex flex-col gap-2.5 flex-1 justify-between">
                <div>
                  <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-500" />
                    Verifica Connessione AI
                  </span>
                  <p className="text-[11px] text-gray-500 mt-1 leading-snug">
                    Invia un testo di prova a Gemini per verificare la risposta del modello.
                  </p>
                </div>

                <button
                  onClick={handleTestModel}
                  disabled={testStatus === 'testing'}
                  className="w-full py-2 rounded-xl bg-gray-100 hover:bg-[#00a651] hover:text-white active:scale-95 text-gray-700 text-xs font-bold transition-all flex items-center justify-center gap-2 border border-gray-200 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testStatus === 'testing' ? 'animate-spin' : ''}`} />
                  <span>{testStatus === 'testing' ? 'Test in corso...' : 'Esegui Test'}</span>
                </button>
              </div>

            </div>
          </div>

          {/* Risultato Test Modello */}
          {testResult && (
            <div className={`p-3 rounded-2xl text-xs font-mono border ${testStatus === 'success' ? 'bg-green-50/70 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {testStatus === 'success' ? (
                <div>
                  <div className="font-bold mb-1 flex items-center gap-1 text-[#00a651]">
                    <CheckCircle2 className="w-4 h-4" /> Risposta valida ricevuta da {modelName}:
                  </div>
                  <div className="text-[11px] text-gray-700">
                    Azione: <strong className="text-gray-900">{testResult.actionType}</strong> • Tempo: <strong>{testResult.time}s</strong> • Temp: <strong>{testResult.temp}°C</strong> • Vel: <strong>{testResult.speed}</strong> • Antiorario: <strong>{String(testResult.direction)}</strong>
                  </div>
                </div>
              ) : (
                <div>
                  <strong>Errore Test: </strong>
                  <span>{testResult.error}</span>
                </div>
              )}
            </div>
          )}

        </div>
      )}

          {/* 3. SCHEDA DIAGNOSTICA HARDWARE */}
          {selectedSection === 'diag' && (
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          
          <div className="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-[#00a651]" />
                <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                  Metriche Realtime Sistema & Hardware
                </span>
              </div>
              <button
                onClick={fetchSettings}
                className="px-3 py-1 rounded-xl bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-600 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-2xs transition-all"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin text-[#00a651]' : ''}`} />
                <span>Ricarica</span>
              </button>
            </div>

            {/* Griglia Metriche 2 Colonne */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              
              <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                <span className="text-gray-500 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${systemInfo?.serialConnected ? 'bg-[#00a651]' : 'bg-amber-500'}`} />
                  Seriale Bimby TM31:
                </span>
                <span className={`font-bold font-mono ${systemInfo?.serialConnected ? 'text-[#00a651]' : 'text-amber-600'}`}>
                  {systemInfo ? (systemInfo.serialConnected ? 'Connessa (UART)' : 'Non connessa') : '...'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                <span className="text-gray-500">Modalità Operativa:</span>
                <span className="font-bold text-gray-800 font-mono">
                  {systemInfo?.hardwareMode ? systemInfo.hardwareMode.toUpperCase() : 'N/D'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                <span className="text-gray-500">Stato FSM Macchina:</span>
                <span className="font-bold text-[#00a651] font-mono">
                  {systemInfo?.fsmState ? String(systemInfo.fsmState).toUpperCase() : 'N/D'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                <span className="text-gray-500 flex items-center gap-1">
                  <Monitor className="w-3.5 h-3.5 text-gray-400" />
                  Risoluzione Display:
                </span>
                <span className="font-bold text-gray-800 font-mono">
                  {clientViewport.w} × {clientViewport.h} px (Touch: {clientViewport.touchPoints})
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                <span className="text-gray-500 flex items-center gap-1">
                  <Wifi className="w-3.5 h-3.5 text-gray-400" />
                  WebSocket Realtime:
                </span>
                <span className={`font-bold font-mono ${isSocketConnected ? 'text-[#00a651]' : 'text-red-500'}`}>
                  {isSocketConnected ? 'Connesso' : 'Disconnesso'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
                <span className="text-gray-500">Memoria RAM Server:</span>
                <span className="font-bold text-gray-800 font-mono">
                  {systemInfo?.heapUsedMb || 'N/D'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5">
                <span className="text-gray-500">Uptime Processo:</span>
                <span className="font-bold text-gray-800 font-mono">
                  {formatUptime(systemInfo?.uptimeSeconds)}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5">
                <span className="text-gray-500">Piattaforma & Node:</span>
                <span className="font-bold text-gray-800 font-mono">
                  {systemInfo ? `${systemInfo.nodeVersion} • ${systemInfo.platform}` : 'N/D'}
                </span>
              </div>

            </div>

            {/* Sezione Interlock di Sicurezza & Microinterruttori */}
            <div className="pt-2.5 border-t border-gray-100 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#00a651]" />
                  <span className="text-xs font-bold text-gray-800">
                    Microinterruttori di Sicurezza (Interlock)
                  </span>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  interlockStatus?.bowlPresent && interlockStatus?.lidLocked
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                  {interlockStatus?.bowlPresent && interlockStatus?.lidLocked ? 'Circuito Chiuso (Pronto)' : 'Aperto'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-200/70">
                  <span className="text-gray-600">Micro Boccale:</span>
                  <span className={`font-bold font-mono text-[11px] ${interlockStatus?.bowlPresent ? 'text-[#00a651]' : 'text-red-500'}`}>
                    {interlockStatus?.bowlPresent ? 'Inserito (OK)' : 'Assente'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-xl bg-gray-50 border border-gray-200/70">
                  <span className="text-gray-600">Micro Coperchio:</span>
                  <span className={`font-bold font-mono text-[11px] ${interlockStatus?.lidLocked ? 'text-[#00a651]' : 'text-amber-600'}`}>
                    {interlockStatus?.lidLocked ? 'Bloccato (OK)' : 'Aperto'}
                  </span>
                </div>
              </div>

              {/* Tasti di simulazione ostacoli (per sviluppo e verifica) */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={toggleSimulateObstacle}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 ${
                    interlockStatus?.simulateObstacle
                      ? 'bg-red-500 text-white border-red-600'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{interlockStatus?.simulateObstacle ? 'Ostacolo Coperchio ATTIVO' : 'Test Ostacolo Coperchio'}</span>
                </button>

                <button
                  onClick={toggleSimulateBowlMissing}
                  className={`flex-1 py-1.5 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 ${
                    interlockStatus?.simulateBowlMissing
                      ? 'bg-red-500 text-white border-red-600'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>{interlockStatus?.simulateBowlMissing ? 'Boccale Assente ATTIVO' : 'Test Boccale Assente'}</span>
                </button>
              </div>
            </div>

            {/* Protezione Burn-in Schermo (Attenuazione Display) */}
            <div className="pt-2.5 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-indigo-500" />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-800">
                    Protezione Burn-in Schermo:{' '}
                    <span className={dimmingSettings.enabled ? 'text-[#00a651]' : 'text-gray-500'}>
                      {dimmingSettings.enabled 
                        ? `Attiva (${dimmingSettings.dimPercentage}% dopo ${dimmingSettings.timeoutSeconds >= 60 ? `${Math.round(dimmingSettings.timeoutSeconds / 60)} min` : `${dimmingSettings.timeoutSeconds}s`})`
                        : 'Disattivata'}
                    </span>
                  </span>
                  <span className="text-[11px] text-gray-500">
                    {dimmingSettings.enabled 
                      ? `Attenua automaticamente il display al ${dimmingSettings.dimPercentage}% per salvaguardare il touchscreen`
                      : 'Attenuazione automatica disattivata nelle impostazioni'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedSection('display')}
                  className="px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 active:scale-95 border border-gray-200 text-gray-700 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5 stroke-[2.2]" />
                  <span>Configura</span>
                </button>
                <button
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('trigger-screen-dim'));
                  }}
                  className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 active:scale-95 border border-indigo-200 text-indigo-800 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                >
                  <Moon className="w-3.5 h-3.5 stroke-[2.2]" />
                  <span>Test Attenuazione</span>
                </button>
              </div>
            </div>

            {/* Speaker Piezoelettrico PWM (GPIO 18 / TM31) */}
            <div className="pt-2.5 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-amber-500" />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-800">
                    Speaker Piezoelettrico: <span className="text-[#00a651]">Hardware PWM (GPIO 18)</span>
                  </span>
                  <span className="text-[11px] text-gray-500">
                    Onda quadra a 2500 Hz per avvisi, click manopola e allarme fine cottura TM31
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleTestBuzzer('beep')}
                  className="px-3 py-1.5 rounded-xl bg-gray-50 hover:bg-gray-100 active:scale-95 border border-gray-200 text-gray-700 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5 stroke-[2.2]" />
                  <span>Test Bip</span>
                </button>
                <button
                  onClick={() => handleTestBuzzer('timer_done')}
                  className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 active:scale-95 border border-amber-200 text-amber-800 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                >
                  <Volume2 className="w-3.5 h-3.5 stroke-[2.2]" />
                  <span>Test Allarme TM31</span>
                </button>
                <button
                  onClick={handleStopBuzzer}
                  className="px-2.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 active:scale-95 border border-rose-200 text-rose-700 text-xs font-bold transition-all shadow-2xs cursor-pointer"
                >
                  Stop
                </button>
              </div>
            </div>

            {/* Pulsante rapido verso Calibrazione Bilancia */}
            <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">
                Hai sostituito o calibrato le celle di carico?
              </span>
              <button
                onClick={() => setSelectedSection('scale_calib')}
                className="px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 active:scale-95 border border-amber-200 text-amber-800 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
              >
                <Scale className="w-3.5 h-3.5 stroke-[2.2]" />
                <span>Calibra Bilancia HX711</span>
              </button>
            </div>
          </div>

        </div>
      )}

      {/* SEZIONE LUMINOSITÀ & ATTENUAZIONE SCHERMO */}
      {selectedSection === 'display' && (
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          {/* Card 1: Attivazione Automatica */}
          <div className="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  dimmingSettings.enabled 
                    ? 'bg-amber-50 border border-amber-200 text-amber-600' 
                    : 'bg-gray-100 border border-gray-200 text-gray-400'
                }`}>
                  <Sun className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-gray-900">
                    Attenuazione Automatica Luminosità
                  </span>
                  <span className="text-xs text-gray-500">
                    Riduce la luminosità in caso di inattività per evitare burn-in e affaticamento visivo
                  </span>
                </div>
              </div>

              <button
                onClick={() => saveDimmingSettings({ enabled: !dimmingSettings.enabled })}
                className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-2 cursor-pointer shadow-2xs active:scale-95 ${
                  dimmingSettings.enabled
                    ? 'bg-[#00a651] text-white hover:bg-[#009146]'
                    : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${dimmingSettings.enabled ? 'bg-white animate-pulse' : 'bg-gray-400'}`} />
                <span>{dimmingSettings.enabled ? 'ATTIVATA' : 'DISATTIVATA'}</span>
              </button>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed">
              Quando l'attenuazione è attiva, il display si scurisce gradualmente dopo il tempo di attesa configurato.
              <strong className="text-gray-700"> Basta toccare lo schermo, ruotare la manopola o premere il tasto per riattivare istantaneamente il 100% della luminosità</strong>, senza perdere o bloccare alcun comando.
            </p>
          </div>

          {/* Card 2: Percentuale di Luminosità Attenuata */}
          <div className={`bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col gap-3 transition-opacity ${
            !dimmingSettings.enabled ? 'opacity-50 pointer-events-none' : 'opacity-100'
          }`}>
            <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Moon className="w-4 h-4 text-indigo-500" />
                <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                  Percentuale di Luminosità Attenuata
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 font-bold font-mono text-sm">
                <span>{dimmingSettings.dimPercentage}%</span>
                <span className="text-[10px] text-indigo-500 font-normal">luminosità</span>
              </div>
            </div>

            {/* Barra Visuale di Anteprima Luminosità */}
            <div className="relative h-9 rounded-xl overflow-hidden bg-gray-950 border border-gray-800 flex items-center px-4 justify-between">
              <div 
                className="absolute inset-y-0 left-0 bg-linear-to-r from-amber-600 via-amber-400 to-amber-300 transition-all duration-300 opacity-80"
                style={{ width: `${Math.max(5, dimmingSettings.dimPercentage)}%` }}
              />
              <span className="relative z-10 text-[11px] font-bold text-white drop-shadow-sm flex items-center gap-1.5">
                <Sun className="w-3.5 h-3.5" />
                Anteprima Luminosità Display
              </span>
              <span className="relative z-10 text-[11px] font-mono font-bold text-white drop-shadow-sm">
                {dimmingSettings.dimPercentage}%
              </span>
            </div>

            {/* Preset Percentuale & Stepper */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                {[
                  { val: 5, label: '5%' },
                  { val: 10, label: '10%' },
                  { val: 15, label: '15% ⭐' },
                  { val: 25, label: '25%' },
                  { val: 35, label: '35%' },
                  { val: 50, label: '50%' }
                ].map((preset) => (
                  <button
                    key={preset.val}
                    onClick={() => saveDimmingSettings({ dimPercentage: preset.val })}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-2xs ${
                      dimmingSettings.dimPercentage === preset.val
                        ? 'bg-[#00a651] text-white border border-[#009146]'
                        : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Stepper - / + */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => saveDimmingSettings({ dimPercentage: Math.max(5, dimmingSettings.dimPercentage - 5) })}
                  disabled={dimmingSettings.dimPercentage <= 5}
                  className="w-9 h-9 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-30 border border-gray-200 text-gray-700 font-bold text-base flex items-center justify-center cursor-pointer active:scale-95 transition-all"
                >
                  -
                </button>
                <button
                  onClick={() => saveDimmingSettings({ dimPercentage: Math.min(80, dimmingSettings.dimPercentage + 5) })}
                  disabled={dimmingSettings.dimPercentage >= 80}
                  className="w-9 h-9 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-30 border border-gray-200 text-gray-700 font-bold text-base flex items-center justify-center cursor-pointer active:scale-95 transition-all"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Card 3: Tempo di Inattività (Timeout) */}
          <div className={`bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col gap-3 transition-opacity ${
            !dimmingSettings.enabled ? 'opacity-50 pointer-events-none' : 'opacity-100'
          }`}>
            <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                  Tempo di Inattività Prima dell'Attenuazione
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold font-mono text-sm">
                <span>
                  {dimmingSettings.timeoutSeconds >= 60 
                    ? `${Math.floor(dimmingSettings.timeoutSeconds / 60)}m ${dimmingSettings.timeoutSeconds % 60 ? `${dimmingSettings.timeoutSeconds % 60}s` : ''}` 
                    : `${dimmingSettings.timeoutSeconds}s`}
                </span>
              </div>
            </div>

            <p className="text-xs text-gray-500">
              Seleziona dopo quanti secondi o minuti dall'ultima interazione (tocco o rotella) la luminosità deve abbassarsi.
            </p>

            {/* Preset Tempo Inattività & Stepper */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                {[
                  { sec: 30, label: '30 sec ⚡' },
                  { sec: 60, label: '1 min' },
                  { sec: 120, label: '2 min' },
                  { sec: 300, label: '5 min ⭐' },
                  { sec: 600, label: '10 min' },
                  { sec: 900, label: '15 min' }
                ].map((preset) => (
                  <button
                    key={preset.sec}
                    onClick={() => saveDimmingSettings({ timeoutSeconds: preset.sec })}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95 shadow-2xs ${
                      dimmingSettings.timeoutSeconds === preset.sec
                        ? 'bg-[#00a651] text-white border border-[#009146]'
                        : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              {/* Stepper Tempo */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => saveDimmingSettings({ timeoutSeconds: Math.max(15, dimmingSettings.timeoutSeconds - 30) })}
                  disabled={dimmingSettings.timeoutSeconds <= 15}
                  className="px-2.5 h-9 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-30 border border-gray-200 text-gray-700 font-bold text-xs flex items-center justify-center cursor-pointer active:scale-95 transition-all"
                >
                  -30s
                </button>
                <button
                  onClick={() => saveDimmingSettings({ timeoutSeconds: Math.min(3600, dimmingSettings.timeoutSeconds + 30) })}
                  disabled={dimmingSettings.timeoutSeconds >= 3600}
                  className="px-2.5 h-9 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-30 border border-gray-200 text-gray-700 font-bold text-xs flex items-center justify-center cursor-pointer active:scale-95 transition-all"
                >
                  +30s
                </button>
              </div>
            </div>
          </div>

          {/* Card 4: Prova dal Vivo (Test Immediato) */}
          <div className="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="text-xs font-bold text-gray-800">
                Test Immediato Effetto Attenuazione
              </span>
              <span className="text-[11px] text-gray-500">
                Attiva subito l'attenuazione al {dimmingSettings.dimPercentage}%. Tocca un punto qualsiasi dello schermo per risvegliarlo.
              </span>
            </div>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('trigger-screen-dim'))}
              className="px-4 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 active:scale-95 border border-indigo-200 text-indigo-800 text-xs font-bold flex items-center gap-2 shrink-0 transition-all shadow-2xs cursor-pointer"
            >
              <Moon className="w-4 h-4 stroke-[2.2]" />
              <span>Prova Attenuazione</span>
            </button>
          </div>

        </div>
      )}

      {/* 5. SEZIONE CALIBRAZIONE BILANCIA (PAGINA SERVIZIO TECNICO) */}
      {selectedSection === 'scale_calib' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <ScaleCalibration onBack={() => setSelectedSection(null)} />
        </div>
      )}

      {/* 6. SEZIONE AGGIORNAMENTI DI SISTEMA (OTA) */}
      {selectedSection === 'ota' && (
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-3">
          {/* Card Stato Versione */}
          <div className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-2xs flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600">
                  <CloudDownload className="w-5 h-5 stroke-[2.2]" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-gray-900">Versione Software Bimby TM31</h4>
                  <p className="text-xs text-gray-500">Stato repository Git e build frontend</p>
                </div>
              </div>

              <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-teal-50 text-teal-700 border border-teal-200">
                Branch: {versionInfo?.branch || 'main'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-[11px] text-gray-400 block mb-0.5">Commit Locale:</span>
                <span className="font-mono font-bold text-gray-800">{versionInfo?.commit || 'N/D'}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-[11px] text-gray-400 block mb-0.5">Data Rilascio:</span>
                <span className="font-bold text-gray-800">{versionInfo?.date || 'N/D'}</span>
              </div>
              <div className="col-span-2 p-2.5 rounded-xl bg-gray-50 border border-gray-100">
                <span className="text-[11px] text-gray-400 block mb-0.5">Ultima Modifica:</span>
                <span className="text-gray-700 font-medium truncate block">{versionInfo?.message || 'Nessuna descrizione commit'}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
              <button
                onClick={checkOtaUpdates}
                disabled={isCheckingUpdate}
                className="px-3 py-2 rounded-xl bg-white hover:bg-gray-50 active:scale-95 border border-gray-200 text-gray-700 text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                <span>{isCheckingUpdate ? 'Controllo in corso...' : 'Verifica GitHub'}</span>
              </button>

              <button
                onClick={() => setIsUpdateModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 active:scale-95 text-white text-xs font-bold flex items-center gap-2 transition-all shadow-md cursor-pointer"
              >
                <CloudDownload className="w-4 h-4" />
                <span>Verifica e Aggiorna</span>
              </button>
            </div>
          </div>
        </div>
      )}

        </div>
      )}

      {/* Modale a Schermo Intero per Aggiornamento OTA */}
      <UpdateModal
        isOpen={isUpdateModalOpen}
        onClose={() => {
          setIsUpdateModalOpen(false);
          fetchVersionInfo();
        }}
        initialVersionInfo={versionInfo}
      />

      {/* Modale di Spegnimento e Riavvio in Sicurezza */}
      <PowerModal
        isOpen={isPowerModalOpen}
        onClose={() => setIsPowerModalOpen(false)}
        isCooking={systemInfo?.fsmState === 'cooking'}
      />

      {/* Tastiera Virtuale Touch per digitazione nome modello */}
      <VirtualKeyboard
        isOpen={isKeyboardOpen}
        title="Modello Google Gemini"
        initialValue={modelName}
        placeholder="es. gemini-2.5-flash"
        actionLabel="Salva"
        onSave={handleSaveModel}
        onClose={() => setIsKeyboardOpen(false)}
      />

    </div>
  );
}
