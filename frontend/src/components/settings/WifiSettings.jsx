import React, { useState, useEffect, useRef } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { 
  Wifi, 
  WifiOff, 
  Lock, 
  RefreshCw, 
  Check, 
  AlertCircle, 
  Eye, 
  EyeOff, 
  X, 
  CheckCircle2, 
  ChevronRight, 
  Loader2,
  Signal,
  SignalLow,
  SignalMedium
} from 'lucide-react';

/**
 * Componente icona intensità segnale Wi-Fi in stile Vorwerk
 */
function SignalIcon({ quality = 50, isLocked = false }) {
  let icon = <SignalMedium className="w-5 h-5 text-[#00a651]" />;
  if (quality >= 70) {
    icon = <Signal className="w-5 h-5 text-[#00a651]" />;
  } else if (quality >= 40) {
    icon = <SignalMedium className="w-5 h-5 text-emerald-600" />;
  } else if (quality >= 20) {
    icon = <SignalLow className="w-5 h-5 text-amber-500" />;
  } else {
    icon = <SignalLow className="w-5 h-5 text-red-500" />;
  }

  return (
    <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gray-50 border border-gray-200/80 shrink-0">
      {icon}
      {isLocked && (
        <span className="absolute -bottom-1 -right-1 bg-white border border-gray-200 rounded-full p-0.5 text-gray-500 shadow-2xs">
          <Lock className="w-2.5 h-2.5" />
        </span>
      )}
    </div>
  );
}

export default function WifiSettings() {
  const [networks, setNetworks] = useState([]);
  const [currentConnection, setCurrentConnection] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMockMode, setIsMockMode] = useState(false);
  
  // Modale di connessione
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [keyboardLayout, setKeyboardLayout] = useState('default');
  
  // Feedback messaggi (toast)
  const [feedback, setFeedback] = useState(null);

  const keyboardRef = useRef(null);

  const showToast = (type, message) => {
    setFeedback({ type, message });
    setTimeout(() => setFeedback(null), 4000);
  };

  // 1. Scansione reti Wi-Fi
  const fetchNetworks = async (isManual = false) => {
    setIsScanning(true);
    try {
      const res = await fetch('/api/wifi/scan');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.networks)) {
          setNetworks(data.networks);
          setIsMockMode(Boolean(data.isMock));
          if (isManual) {
            showToast('success', `${data.networks.length} reti rilevate ${data.isMock ? '(Simulatore)' : ''}`);
          }
        }
      } else {
        const err = await res.json().catch(() => ({}));
        showToast('error', err.error || 'Errore durante la scansione');
      }
    } catch (err) {
      console.warn('Errore scansione Wi-Fi:', err);
      showToast('error', 'Impossibile comunicare con il server Wi-Fi');
    } finally {
      setIsScanning(false);
    }
  };

  // 2. Lettura stato attuale connessione
  const fetchCurrentStatus = async () => {
    try {
      const res = await fetch('/api/wifi/status');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setCurrentConnection(data);
          if (data.isMock !== undefined) {
            setIsMockMode(Boolean(data.isMock));
          }
        }
      }
    } catch (err) {}
  };

  useEffect(() => {
    fetchCurrentStatus();
    fetchNetworks();
  }, []);

  // Apertura modale di connessione
  const handleSelectNetwork = (net) => {
    if (net.isCurrent) {
      return;
    }

    setSelectedNetwork(net);
    setPassword('');
    setShowPassword(false);
    setKeyboardLayout('default');

    // Se la rete è aperta (senza password), connetti direttamente
    if (!net.isLocked) {
      handleConnect(net, '');
    }
  };

  // Invio richiesta di connessione
  const handleConnect = async (netToConnect = selectedNetwork, pwd = password) => {
    if (!netToConnect) return;

    setIsConnecting(true);
    try {
      const res = await fetch('/api/wifi/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ssid: netToConnect.ssid,
          password: pwd
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('success', `Connesso con successo a ${netToConnect.ssid}!`);
        setSelectedNetwork(null);
        setPassword('');
        fetchCurrentStatus();
        fetchNetworks();
      } else {
        showToast('error', data.error || 'Password errata o connessione fallita');
      }
    } catch (err) {
      showToast('error', 'Errore di connessione al server');
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnessione
  const handleDisconnect = async () => {
    try {
      const res = await fetch('/api/wifi/disconnect', { method: 'POST' });
      if (res.ok) {
        showToast('success', 'Rete Wi-Fi disconnessa');
        fetchCurrentStatus();
        fetchNetworks();
      }
    } catch (err) {
      showToast('error', 'Errore durante la disconnessione');
    }
  };

  // Gestione tastiera virtuale react-simple-keyboard
  const handleKeyboardChange = (input) => {
    setPassword(input);
  };

  const handleKeyPress = (button) => {
    if (button === '{shift}' || button === '{lock}') {
      setKeyboardLayout(keyboardLayout === 'default' ? 'shift' : 'default');
    } else if (button === '{enter}') {
      handleConnect();
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#f8fafc] text-gray-800 select-none overflow-hidden relative">
      
      {/* Toast notifica */}
      {feedback && (
        <div className={`absolute top-2 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full shadow-lg border flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-top-2 duration-200 ${
          feedback.type === 'success' 
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
            : 'bg-red-50 text-red-800 border-red-200'
        }`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-[#00a651]" /> : <AlertCircle className="w-4 h-4 text-red-500" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Card Stato Connessione Corrente & Tasto Aggiorna */}
      <div className="bg-white rounded-2xl p-3 border border-gray-200/80 shadow-xs flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center text-[#00a651] shrink-0">
            <Wifi className="w-5 h-5 stroke-[2.2]" />
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Stato Connessione
              </span>
              {isMockMode ? (
                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  Simulatore
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Hardware Reale
                </span>
              )}
            </div>
            {currentConnection?.connected ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#00a651] animate-pulse shrink-0" />
                <span className="text-sm font-bold text-gray-900 truncate">
                  {currentConnection.ssid}
                </span>
                <span className="text-xs text-gray-500 font-medium shrink-0">
                  ({currentConnection.quality}%)
                </span>
              </div>
            ) : (
              <span className="text-sm font-bold text-gray-500 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                Non connesso
              </span>
            )}
          </div>
        </div>

        {/* Pulsanti Rapidi */}
        <div className="flex items-center gap-2 shrink-0">
          {currentConnection?.connected && (
            <button
              onClick={handleDisconnect}
              className="px-3 py-1.5 rounded-xl border border-gray-200 hover:border-red-200 hover:bg-red-50 text-gray-600 hover:text-red-600 text-xs font-semibold transition-all cursor-pointer shadow-2xs"
            >
              Disconnetti
            </button>
          )}

          <button
            onClick={() => fetchNetworks(true)}
            disabled={isScanning}
            className="px-4 py-2 rounded-xl bg-[#00a651] hover:bg-[#008f45] active:scale-95 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-xs flex items-center gap-2 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Scansione...' : 'Aggiorna Reti'}</span>
          </button>
        </div>
      </div>

      {/* Banner informativo se in modalità simulatore */}
      {isMockMode && (
        <div className="bg-amber-50/90 border border-amber-200/80 rounded-xl px-3 py-2 mb-2 flex items-center gap-2 text-[11px] text-amber-800 shrink-0">
          <span className="text-xs shrink-0">ℹ️</span>
          <span className="leading-tight font-medium">
            <strong>Modalità Simulatore:</strong> In Docker su PC le reti sono simulate per testare interfaccia e tastiera touch. Sul <strong>Raspberry Pi 4 fisico</strong> verranno scansionate le reti Wi-Fi reali via chip <code className="bg-amber-100 px-1 py-0.2 rounded text-[10px] font-mono">wlan0</code>.
          </span>
        </div>
      )}

      {/* Lista Reti Wi-Fi Trovate */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-2 select-none">
        
        {isScanning && networks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2.5 bg-white rounded-2xl border border-gray-200/80">
            <Loader2 className="w-7 h-7 animate-spin text-[#00a651]" />
            <span className="text-xs font-bold text-gray-600">Ricerca reti Wi-Fi nelle vicinanze...</span>
          </div>
        ) : networks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2 text-center p-4 bg-white rounded-2xl border border-gray-200/80">
            <WifiOff className="w-8 h-8 text-gray-300" />
            <span className="text-xs font-bold text-gray-700">Nessuna rete Wi-Fi rilevata</span>
            <p className="text-[11px] text-gray-500 max-w-sm">
              Tocca "Aggiorna Reti" per ripetere la scansione o verifica la scheda Wi-Fi.
            </p>
          </div>
        ) : (
          networks.map((net) => {
            const isCurrent = Boolean(net.isCurrent);

            return (
              <div
                key={net.ssid}
                onClick={() => handleSelectNetwork(net)}
                className={`min-h-[58px] px-4 py-2.5 rounded-2xl border transition-all flex items-center justify-between cursor-pointer active:scale-[0.99] ${
                  isCurrent
                    ? 'bg-green-50/70 border-green-300 shadow-2xs'
                    : 'bg-white hover:bg-gray-50/80 border-gray-200/80 hover:border-gray-300 shadow-2xs'
                }`}
              >
                {/* Dati Rete */}
                <div className="flex items-center gap-3 min-w-0">
                  <SignalIcon quality={net.quality} isLocked={net.isLocked} />

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900 truncate tracking-tight">
                        {net.ssid}
                      </span>
                      {isCurrent && (
                        <span className="px-2 py-0.5 rounded-full bg-[#00a651] text-white text-[10px] font-extrabold tracking-wide uppercase">
                          Connessa
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5">
                      <span>Segnale: <strong className="text-gray-700">{net.quality}%</strong></span>
                      <span>•</span>
                      <span>{net.isLocked ? (net.security || 'WPA2/WPA3') : 'Rete Aperta'}</span>
                    </div>
                  </div>
                </div>

                {/* Pulsante Azione a Destra */}
                <div className="flex items-center gap-2 shrink-0">
                  {isCurrent ? (
                    <div className="w-7 h-7 rounded-full bg-[#00a651] text-white flex items-center justify-center">
                      <Check className="w-4 h-4 stroke-[2.8]" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-xs font-bold text-gray-600 bg-gray-100/90 hover:bg-[#00a651] hover:text-white px-3.5 py-1.5 rounded-xl border border-gray-200/90 transition-all">
                      <span>Connetti</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}

      </div>

      {/* =====================================================================
          MODALE DI CONNESSIONE WI-FI CON TASTIERA VIRTUALE TOUCH SCREEN
          ===================================================================== */}
      {selectedNetwork && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl border border-gray-100 shadow-2xl max-w-lg w-full flex flex-col p-5 text-gray-900 animate-in zoom-in-95 duration-150">
            
            {/* Header Modale */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center text-[#00a651]">
                  <Lock className="w-4.5 h-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 leading-tight">
                    Connetti a "{selectedNetwork.ssid}"
                  </h3>
                  <span className="text-[11px] text-gray-500">
                    Inserisci la chiave di sicurezza Wi-Fi
                  </span>
                </div>
              </div>

              <button
                onClick={() => setSelectedNetwork(null)}
                disabled={isConnecting}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Input Password con mostra/nascondi e pulisci */}
            <div className="flex flex-col gap-1 mb-2.5">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Password di Rete
              </label>
              
              <div className="relative flex items-center bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 shadow-inner">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tocca i tasti sottostanti per digitare..."
                  className="bg-transparent border-0 text-gray-900 font-mono text-sm flex-1 outline-none pr-16 placeholder:text-gray-400"
                  readOnly
                />

                <div className="absolute right-2 flex items-center gap-1">
                  {password.length > 0 && (
                    <button
                      onClick={() => {
                        setPassword('');
                        if (keyboardRef.current) keyboardRef.current.clearInput();
                      }}
                      className="p-1 rounded-md text-gray-400 hover:text-gray-600"
                      title="Pulisci testo"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 rounded-md text-gray-400 hover:text-gray-600"
                    title={showPassword ? 'Nascondi' : 'Mostra'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4 text-[#00a651]" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Tastiera Virtuale Touch Screen in stile Vorwerk (tasti chiari, alto contrasto) */}
            <div className="bg-gray-100/90 p-2 rounded-2xl border border-gray-200 mb-3 select-none">
              <style>{`
                .wifi-keyboard-light.hg-theme-default {
                  background-color: transparent !important;
                  padding: 0 !important;
                }
                .wifi-keyboard-light .hg-button {
                  height: 38px !important;
                  background: #ffffff !important;
                  color: #1e293b !important;
                  border: 1px solid #cbd5e1 !important;
                  border-radius: 8px !important;
                  box-shadow: 0 1px 2px rgba(0,0,0,0.06) !important;
                  font-size: 14px !important;
                  font-weight: 600 !important;
                  font-family: 'Inter', system-ui, sans-serif !important;
                }
                .wifi-keyboard-light .hg-button:active {
                  background: #00a651 !important;
                  color: #ffffff !important;
                  border-color: #008f45 !important;
                  transform: scale(0.96);
                }
                .wifi-keyboard-light .hg-button-enter {
                  background: #00a651 !important;
                  color: #ffffff !important;
                  border-color: #008f45 !important;
                  font-weight: 700 !important;
                }
                .wifi-keyboard-light .hg-button-bksp {
                  background: #f1f5f9 !important;
                  color: #475569 !important;
                }
                .wifi-keyboard-light .hg-button-shift {
                  background: #f1f5f9 !important;
                  color: #475569 !important;
                }
              `}</style>

              <Keyboard
                keyboardRef={(r) => (keyboardRef.current = r)}
                theme="hg-theme-default wifi-keyboard-light"
                layoutName={keyboardLayout}
                layout={{
                  default: [
                    '1 2 3 4 5 6 7 8 9 0 {bksp}',
                    'q w e r t y u i o p',
                    'a s d f g h j k l',
                    '{shift} z x c v b n m @ . -',
                    '{space}'
                  ],
                  shift: [
                    '! " # $ % & \' ( ) = {bksp}',
                    'Q W E R T Y U I O P',
                    'A S D F G H J K L',
                    '{shift} Z X C V B N M _ / ?',
                    '{space}'
                  ]
                }}
                display={{
                  '{bksp}': '⌫',
                  '{enter}': 'Connetti ➔',
                  '{shift}': '⇧',
                  '{space}': 'Spazio'
                }}
                onChange={handleKeyboardChange}
                onKeyPress={handleKeyPress}
              />
            </div>

            {/* Pulsanti Azione Modale */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={() => setSelectedNetwork(null)}
                disabled={isConnecting}
                className="px-5 py-2.5 rounded-full border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-bold text-xs active:scale-95 transition-all cursor-pointer shadow-2xs"
              >
                Annulla
              </button>

              <button
                onClick={() => handleConnect()}
                disabled={isConnecting}
                className="px-6 py-2.5 rounded-full bg-[#00a651] hover:bg-[#008f45] active:scale-95 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-2 shadow-md transition-all cursor-pointer"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Connessione in corso...</span>
                  </>
                ) : (
                  <>
                    <Wifi className="w-4 h-4" />
                    <span>Connetti</span>
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
