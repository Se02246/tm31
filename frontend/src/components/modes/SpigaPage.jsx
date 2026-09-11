import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import spigaIcon from '../../assets/modes/spiga.svg';
import { Bell, AlertTriangle } from 'lucide-react';

export const SpigaPage = () => {
    const [fsmState, setFsmState] = useState('IDLE');
    const [targetTime, setTargetTime] = useState(120); // Default 2 minuti (120 secondi per impasti standard)
    const [remainingTime, setRemainingTime] = useState(120);
    const [currentTemp, setCurrentTemp] = useState(20);
    const [spigaPhase, setSpigaPhase] = useState('IDLE');
    const [isHoldingStart, setIsHoldingStart] = useState(false);
    const [thermalError, setThermalError] = useState(false);

    const targetTimeRef = useRef(120);
    targetTimeRef.current = targetTime;
    const initialCookingTimeRef = useRef(120);
    const holdStartTimeoutRef = useRef(null);

    const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmState);
    const isAlarm = fsmState === 'ALARM';
    const isThermalLocked = currentTemp > 50;

    // Ascolto stato globale FSM, timer e fasi Spiga dal socket
    useEffect(() => {
        const handleState = (data) => {
            if (data && data.value) {
                const state = data.value.toUpperCase();
                setFsmState(state);
            }
            if (data && data.context) {
                if (typeof data.context.targetTime === 'number') {
                    if (['LOCKING', 'STARTING_MOTOR', 'COOKING', 'STOPPING_MOTOR_NORMAL', 'STOPPING_MOTOR_ALARM', 'ALARM'].includes(data.value?.toUpperCase())) {
                        setRemainingTime(data.context.targetTime);
                    }
                }
                if (typeof data.context.currentTemp === 'number') {
                    setCurrentTemp(data.context.currentTemp);
                    if (data.context.currentTemp <= 50) {
                        setThermalError(false);
                    }
                }
            }
            if (data && data.spigaPhase) {
                setSpigaPhase(data.spigaPhase);
            }
        };

        const handleSpigaPhase = (phase) => {
            setSpigaPhase(phase);
        };

        const handleSpigaError = (err) => {
            if (err && err.code === 'TEMP_TOO_HIGH') {
                setThermalError(true);
            }
        };

        socket.on('state', handleState);
        socket.on('spiga_phase', handleSpigaPhase);
        socket.on('SPIGA_ERROR', handleSpigaError);

        return () => {
            socket.off('state', handleState);
            socket.off('spiga_phase', handleSpigaPhase);
            socket.off('SPIGA_ERROR', handleSpigaError);
        };
    }, []);

    // Avvio modalità Spiga
    const handleStartSpiga = () => {
        if (isCooking || isAlarm) return;
        if (isThermalLocked) {
            setThermalError(true);
            return;
        }
        const timeToStart = targetTimeRef.current || targetTime || 120;
        if (timeToStart <= 0) return;

        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }

        initialCookingTimeRef.current = timeToStart;
        setRemainingTime(timeToStart);
        setThermalError(false);

        socket.emit('CMD', { type: 'SET_TIME', value: timeToStart });
        socket.emit('CMD', { type: 'START_SPIGA', time: timeToStart });
    };

    // Pressione touch sul tasto Avvia (tocco o hold)
    const handleStartPointerDown = () => {
        if (isCooking || isAlarm || isThermalLocked) return;
        setIsHoldingStart(true);
        if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        holdStartTimeoutRef.current = setTimeout(() => {
            handleStartSpiga();
        }, 1300);
    };

    const handleStartPointerUp = () => {
        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }
    };

    // Arresto impasto immediato
    const handleStopSpiga = () => {
        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'STOP' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
    };

    // Silenzia e disattiva allarme
    const handleAckAlarm = () => {
        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'ACK_ALARM' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
    };

    // Modifica del tempo tramite manopola o touch (+/- delta) con limite massimo di 1 ora (3600s)
    const adjustTime = (deltaSeconds) => {
        if (isCooking) return;
        setTargetTime((prev) => {
            const next = Math.max(10, Math.min(3600, prev + deltaSeconds)); // Min 10s, Max 1 ora (3600s)
            targetTimeRef.current = next;
            setRemainingTime(next);
            return next;
        });
    };

    // Gestione Eventi Fisici (Manopola Hardware TM31)
    useEffect(() => {
        const onKnobTurn = (e) => {
            if (isCooking || isAlarm) return;
            const direction = e.detail?.delta || 0;
            setTargetTime((prev) => {
                let step = 15;
                if (direction > 0) {
                    if (prev < 60) step = 10;
                    else if (prev < 300) step = 15;
                    else if (prev < 1800) step = 30;
                    else step = 60;
                } else {
                    if (prev <= 60) step = 10;
                    else if (prev <= 300) step = 15;
                    else if (prev <= 1800) step = 30;
                    else step = 60;
                }
                const next = Math.max(10, Math.min(3600, prev + (direction * step)));
                targetTimeRef.current = next;
                setRemainingTime(next);
                return next;
            });
        };

        const onPhysicalClick = () => {
            if (isAlarm) {
                handleAckAlarm();
            } else if (isCooking) {
                handleStopSpiga();
            }
        };

        const onPhysicalStartPress = () => {
            if (!isCooking && !isAlarm && !isThermalLocked) {
                setIsHoldingStart(true);
            }
        };

        const onPhysicalStartRelease = () => {
            setIsHoldingStart(false);
        };

        const onPhysicalStartComplete = () => {
            if (!isCooking && !isAlarm && !isThermalLocked) {
                handleStartSpiga();
            }
        };

        window.addEventListener('spiga-knob-turn', onKnobTurn);
        window.addEventListener('spiga-physical-click', onPhysicalClick);
        window.addEventListener('spiga-physical-start-press', onPhysicalStartPress);
        window.addEventListener('spiga-physical-start-release', onPhysicalStartRelease);
        window.addEventListener('spiga-physical-start-complete', onPhysicalStartComplete);

        return () => {
            window.removeEventListener('spiga-knob-turn', onKnobTurn);
            window.removeEventListener('spiga-physical-click', onPhysicalClick);
            window.removeEventListener('spiga-physical-start-press', onPhysicalStartPress);
            window.removeEventListener('spiga-physical-start-release', onPhysicalStartRelease);
            window.removeEventListener('spiga-physical-start-complete', onPhysicalStartComplete);
            if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        };
    }, [isCooking, isAlarm, isThermalLocked, targetTime]);

    // Formattazione tempo per la pillola del timer (mm:ss o hh:mm:ss)
    const formatTimePill = (totalSec) => {
        const s = Math.max(0, Math.floor(totalSec));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const remSec = s % 60;
        const pad = (n) => String(n).padStart(2, '0');
        if (h > 0) {
            return `${pad(h)}:${pad(m)}:${pad(remSec)}`;
        }
        return `${pad(m)}:${pad(remSec)}`;
    };

    // Circonferenza anello (r=88 -> 2 * PI * 88 = 552.92)
    const circumference = 552.92;
    const MAX_SPIGA_TIME = 3600; // 60 minuti max
    const displaySec = isCooking ? remainingTime : targetTime;
    const totalSec = initialCookingTimeRef.current || targetTime || 120;

    // Progresso tempo decrescente (stile TM6):
    // - A riposo: anello pieno al 100%
    // - In impasto: decresce progressivamente da 100% a 0% man mano che il tempo scorre
    // - In allarme: anello svuotato (0%)
    let timeProgress = 100;
    if (isCooking) {
        timeProgress = Math.max(0, Math.min(100, (remainingTime / totalSec) * 100));
    } else if (isAlarm) {
        timeProgress = 0;
    }

    const strokeDashoffset = circumference - (circumference * timeProgress) / 100;

    return (
        <div className="w-full h-full bg-white flex items-center justify-between select-none relative overflow-hidden px-6">
            {/* Colonna Sinistra: Quadrante Circolare del Timer con Spiga e Tasto Stop/Disattiva */}
            <div className="flex-1 flex flex-col items-center justify-center pr-2">
                <div 
                    className={`relative w-56 h-56 flex items-center justify-center ${!isCooking && !isAlarm ? 'cursor-pointer active:scale-98 transition-transform' : ''}`}
                    onClick={() => { if (!isCooking && !isAlarm) adjustTime(30); }}
                    onWheel={(e) => { if (!isCooking) adjustTime(e.deltaY < 0 ? 30 : -30); }}
                >
                    {/* SVG Progress Ring */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 200 200">
                        <circle
                            cx="100"
                            cy="100"
                            r="88"
                            fill="none"
                            stroke="#f1f5f9"
                            strokeWidth="8"
                        />
                        <circle
                            cx="100"
                            cy="100"
                            r="88"
                            fill="none"
                            stroke={isCooking || isAlarm ? '#10b981' : '#00a651'}
                            strokeWidth={isCooking ? '9' : '8'}
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            className={`transition-all duration-300 ease-out ${
                                isCooking ? 'animate-pulse drop-shadow-[0_0_8px_rgba(16,185,129,0.6)]' : ''
                            }`}
                        />
                    </svg>

                    {/* Contenuto Quadrante */}
                    {isAlarm ? (
                        <div className="flex flex-col items-center justify-center animate-in zoom-in duration-300 z-10">
                            <Bell className="w-14 h-14 text-tm-accent animate-bounce" />
                            <span className="text-[11px] font-bold text-tm-accent uppercase tracking-widest mt-2">
                                Impasto Finito
                            </span>
                        </div>
                    ) : (
                        /* All'interno dell'anello: Vettoriale della Spiga con pillola del timer */
                        <div className="flex flex-col items-center justify-center z-10 pointer-events-none animate-in zoom-in duration-300">
                            {/* Icona Vettoriale Spiga */}
                            <div className="w-20 h-20 flex items-center justify-center drop-shadow-sm mb-1.5">
                                <img 
                                    src={spigaIcon} 
                                    alt="Spiga" 
                                    className="w-full h-full object-contain" 
                                />
                            </div>
                            
                            {/* Pillola con il Timer (al posto delle velocità/pause) */}
                            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full border shadow-2xs transition-all duration-150 bg-gray-50 border-gray-200 text-gray-700">
                                <span className="tabular-nums font-semibold tracking-tight text-xs">
                                    {formatTimePill(displaySec)}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Tasto Stop o Disattiva centrato sotto l'anello */}
                <div className="mt-4 h-[46px] flex items-center justify-center">
                    {isAlarm ? (
                        <button
                            onClick={handleAckAlarm}
                            className="px-12 py-2.5 min-w-[170px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 shadow-md bg-tm-accent text-white hover:bg-emerald-800 active:scale-95 cursor-pointer animate-in fade-in"
                        >
                            Disattiva
                        </button>
                    ) : isCooking ? (
                        <button
                            onClick={handleStopSpiga}
                            className="px-12 py-2.5 min-w-[170px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 shadow-md select-none bg-red-600 hover:bg-red-700 active:scale-95 text-white cursor-pointer animate-in fade-in"
                        >
                            Stop
                        </button>
                    ) : (
                        <div className="h-[46px]" />
                    )}
                </div>
            </div>

            {/* Colonna Destra: Titolo, Box informativo, Warning Blocco Termico e Tasto Avvia */}
            <div className="w-[280px] flex flex-col items-center justify-center text-center pl-2">
                <h2 className="text-xl font-bold text-tm-text tracking-tight mb-2.5">
                    Modalità Spiga
                </h2>

                {/* Box Istruzioni */}
                <div className="bg-gray-50/90 rounded-2xl p-3 border border-gray-100 text-gray-600 text-xs leading-relaxed shadow-2xs text-center max-w-[250px]">
                    Inserisci gli ingredienti nel boccale, chiudi il coperchio con il misurino, imposta il tempo di impasto e avvia. La modalità alternerà spinte orarie e antiorarie con spunto rapido e blocco lame per un impasto perfetto.
                </div>

                {/* Avviso Blocco Termico di Sicurezza se > 50°C */}
                {(isThermalLocked || thermalError) && (
                    <div className="mt-2.5 flex items-start gap-2 bg-amber-50/95 border border-amber-200 text-amber-900 p-2.5 rounded-xl text-[11px] font-semibold text-left max-w-[250px] shadow-2xs animate-in zoom-in-95 duration-200">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold block">Boccale troppo caldo ({Math.floor(currentTemp)}°C &gt; 50°C)</span>
                            <span className="text-amber-700 text-[10px] leading-tight block mt-0.5">
                                Attendi il raffreddamento prima di impastare per proteggere il lievito e prevenire schizzi.
                            </span>
                        </div>
                    </div>
                )}

                {/* Pulsante Avvia */}
                <div className="mt-3.5">
                    <button
                        onPointerDown={handleStartPointerDown}
                        onPointerUp={handleStartPointerUp}
                        onPointerLeave={handleStartPointerUp}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        disabled={isCooking || isAlarm || isThermalLocked}
                        className={`relative overflow-hidden px-10 py-3 min-w-[180px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 select-none ${
                            isCooking || isAlarm || isThermalLocked
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed shadow-none'
                                : 'bg-tm-accent text-white active:scale-98 shadow-md cursor-pointer'
                        }`}
                    >
                        {/* Barra di riempimento verde scuro durante la tenuta prolungata (1,3s) */}
                        <div 
                            className={`absolute inset-0 bg-emerald-900 transition-all ${
                                isHoldingStart ? 'duration-[1300ms] ease-linear w-full' : 'duration-150 ease-out w-0'
                            }`} 
                        />
                        <span className="relative z-10 pointer-events-none">
                            {isCooking 
                                ? 'Impasto in corso' 
                                : isAlarm 
                                    ? 'Impasto terminato' 
                                    : isThermalLocked 
                                        ? 'Boccale caldo (>50°C)' 
                                        : 'Avvia'
                            }
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};
