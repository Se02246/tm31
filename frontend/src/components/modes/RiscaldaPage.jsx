import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import riscaldaIcon from '../../assets/modes/riscalda.svg';
import { Bell } from 'lucide-react';

const TEMP_OPTIONS = [37, 40, 45, 50, 55, 60];

// Tabella durata mantenimento in base alla temperatura:
// 37°C (più bassa) = 10 minuti (600s) -> 60°C (più alta) = 5 minuti (300s)
const HOLD_TIMES = {
    37: 600, // 10 min
    40: 540, // 9 min
    45: 480, // 8 min
    50: 420, // 7 min
    55: 360, // 6 min
    60: 300  // 5 min
};

export const RiscaldaPage = () => {
    const [fsmState, setFsmState] = useState('IDLE');
    const [targetTemp, setTargetTemp] = useState(50); // Default 50°C
    const [currentTemp, setCurrentTemp] = useState(20);
    const [remainingSeconds, setRemainingSeconds] = useState(null);
    const [isHoldingStart, setIsHoldingStart] = useState(false);
    const [tempReached, setTempReached] = useState(false);

    const targetTempRef = useRef(50);
    targetTempRef.current = targetTemp;
    const tempReachedRef = useRef(false);
    const holdTimerIntervalRef = useRef(null);
    const holdStartTimeoutRef = useRef(null);

    const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmState);
    const isAlarm = fsmState === 'ALARM';

    // Ascolto stato globale FSM e temperatura dal socket
    useEffect(() => {
        const handleState = (data) => {
            if (data && data.value) {
                const state = data.value.toUpperCase();
                setFsmState(state);
            }
            if (data && data.context && typeof data.context.currentTemp === 'number') {
                setCurrentTemp(Math.round(data.context.currentTemp));
            }
        };

        socket.on('state', handleState);
        return () => {
            socket.off('state', handleState);
        };
    }, []);

    // Avvio del riscaldamento alimenti (richiede tenuta di 1,3 secondi)
    const handleStartHeating = () => {
        if (isCooking || isAlarm) return;
        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }

        setTempReached(false);
        tempReachedRef.current = false;
        setRemainingSeconds(null);
        if (holdTimerIntervalRef.current) {
            clearInterval(holdTimerIntervalRef.current);
            holdTimerIntervalRef.current = null;
        }

        const chosenTemp = targetTempRef.current;
        // Motore a velocità 0.5 in senso antiorario (reverse), temperatura scelta
        socket.emit('CMD', { type: 'SET_DIRECTION', value: true }); // rotazione antioraria
        socket.emit('CMD', { type: 'SET_SPEED', value: 0.5 });
        socket.emit('CMD', { type: 'SET_TEMP', value: chosenTemp });
        socket.emit('CMD', { type: 'SET_TIME', value: 3600 }); // Finestra di sicurezza per la fase di salita
        socket.emit('CMD', { type: 'PLAY' });
    };

    // Monitoraggio raggiungimento temperatura impostata
    useEffect(() => {
        if (isCooking && !tempReachedRef.current && currentTemp >= targetTemp) {
            tempReachedRef.current = true;
            setTempReached(true);

            // Calcola durata timer per la temperatura scelta
            const holdSeconds = HOLD_TIMES[targetTemp] || 420;
            setRemainingSeconds(holdSeconds);

            // Imposta il timer preciso nel backend
            socket.emit('CMD', { type: 'SET_TIME', value: holdSeconds });

            // Timer di conto alla rovescia locale sincronizzato
            if (holdTimerIntervalRef.current) clearInterval(holdTimerIntervalRef.current);
            holdTimerIntervalRef.current = setInterval(() => {
                setRemainingSeconds(prev => {
                    if (prev === null || prev <= 1) {
                        clearInterval(holdTimerIntervalRef.current);
                        holdTimerIntervalRef.current = null;
                        socket.emit('CMD', { type: 'TIME_UP' });
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }

        if (!isCooking && !isAlarm) {
            tempReachedRef.current = false;
            setTempReached(false);
            setRemainingSeconds(null);
            if (holdTimerIntervalRef.current) {
                clearInterval(holdTimerIntervalRef.current);
                holdTimerIntervalRef.current = null;
            }
        }
    }, [isCooking, currentTemp, targetTemp, isAlarm]);

    // Arresto riscaldamento con un singolo click
    const handleStopHeating = () => {
        if (holdTimerIntervalRef.current) {
            clearInterval(holdTimerIntervalRef.current);
            holdTimerIntervalRef.current = null;
        }
        tempReachedRef.current = false;
        setTempReached(false);
        setRemainingSeconds(null);

        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'STOP' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
    };

    // Pressione touch sul tasto Avvia (1,3 secondi)
    const handleStartPointerDown = () => {
        if (isCooking || isAlarm) return;
        setIsHoldingStart(true);
        if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        holdStartTimeoutRef.current = setTimeout(() => {
            handleStartHeating();
        }, 1300);
    };

    const handleStartPointerUp = () => {
        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }
    };

    // Silenzia e disattiva allarme
    const handleAckAlarm = () => {
        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'ACK_ALARM' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
        tempReachedRef.current = false;
        setTempReached(false);
        setRemainingSeconds(null);
    };

    // Cambio temperatura (tra 37°C e 60°C)
    const handleStepTemp = (direction) => {
        if (isCooking || isAlarm) return;
        setTargetTemp(prev => {
            const idx = TEMP_OPTIONS.indexOf(prev);
            const currentIdx = idx === -1 ? 3 : idx;
            const newIdx = Math.max(0, Math.min(TEMP_OPTIONS.length - 1, currentIdx + direction));
            return TEMP_OPTIONS[newIdx];
        });
    };

    // Ascolto eventi fisici della manopola TM31
    useEffect(() => {
        const onPhysicalTap = () => {
            if (isAlarm) {
                handleAckAlarm();
            } else if (isCooking) {
                handleStopHeating();
            }
        };

        const onPhysicalStartPress = () => {
            if (!isCooking && !isAlarm) {
                setIsHoldingStart(true);
            }
        };

        const onPhysicalStartRelease = () => {
            setIsHoldingStart(false);
        };

        const onPhysicalStartComplete = () => {
            if (!isCooking && !isAlarm) {
                handleStartHeating();
            }
        };

        const onKnobTurn = (e) => {
            if (!isCooking && !isAlarm) {
                const dir = e.detail?.direction || 0;
                if (dir !== 0) {
                    handleStepTemp(dir);
                }
            }
        };

        window.addEventListener('riscalda-physical-tap', onPhysicalTap);
        window.addEventListener('riscalda-physical-start-press', onPhysicalStartPress);
        window.addEventListener('riscalda-physical-start-release', onPhysicalStartRelease);
        window.addEventListener('riscalda-physical-start-complete', onPhysicalStartComplete);
        window.addEventListener('riscalda-knob-turn', onKnobTurn);

        return () => {
            window.removeEventListener('riscalda-physical-tap', onPhysicalTap);
            window.removeEventListener('riscalda-physical-start-press', onPhysicalStartPress);
            window.removeEventListener('riscalda-physical-start-release', onPhysicalStartRelease);
            window.removeEventListener('riscalda-physical-start-complete', onPhysicalStartComplete);
            window.removeEventListener('riscalda-knob-turn', onKnobTurn);
            if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
            if (holdTimerIntervalRef.current) clearInterval(holdTimerIntervalRef.current);
        };
    }, [isCooking, isAlarm]);

    // Progresso anello decrescente (stile TM6): combinazione di temperatura + timer di mantenimento
    // - A riposo: anello pieno al 100%
    // - In riscaldamento e mantenimento: decresce progressivamente da 100% a 0%
    // - All'allarme: anello svuotato (0%)
    const circumference = 552.92;
    const tempTotalStages = Math.max(1, targetTemp - 20);
    const holdSeconds = HOLD_TIMES[targetTemp] || 420;
    const TOTAL_STAGES = tempTotalStages + holdSeconds;

    let currentStages = 0;
    if (isCooking) {
        if (!tempReached) {
            // Fase 1: Riscaldamento (da 20°C temperatura ambiente fino a targetTemp)
            currentStages = Math.max(0, Math.min(tempTotalStages, currentTemp - 20));
        } else {
            // Fase 2: Timer di riscaldamento/mantenimento (stadi temperatura + secondi trascorsi)
            const elapsed = Math.max(0, Math.min(holdSeconds, holdSeconds - (remainingSeconds ?? holdSeconds)));
            currentStages = tempTotalStages + elapsed;
        }
    }

    const progressPercent = isCooking
        ? Math.max(0, Math.min(100, ((TOTAL_STAGES - currentStages) / TOTAL_STAGES) * 100))
        : (isAlarm ? 0 : 100);
    const strokeDashoffset = circumference - (circumference * progressPercent) / 100;

    // Formattazione minuti e secondi per il timer
    const formatTime = (totalSec) => {
        if (totalSec === null || totalSec === undefined) return '';
        const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const s = (totalSec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    return (
        <div className="w-full h-full bg-white grid grid-cols-2 items-center select-none relative overflow-hidden px-8">
            {/* Colonna Sinistra: Anello con Temperatura o Icona + Pillola e Tasto Stop/Disattiva */}
            <div className="flex flex-col items-center justify-center">
                {/* Quadrante Circolare */}
                <div className="relative w-56 h-56 flex items-center justify-center">
                    {/* Anello SVG */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 200 200">
                        {/* Cerchio di sfondo */}
                        <circle
                            cx="100"
                            cy="100"
                            r="88"
                            fill="none"
                            stroke="#f1f5f9"
                            strokeWidth="8"
                        />
                        {/* Arco attivo verde di avanzamento */}
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

                    {/* Contenuto interno all'anello */}
                    {isAlarm ? (
                        /* Allarme completamento */
                        <div className="flex flex-col items-center justify-center animate-in zoom-in duration-300 z-10">
                            <Bell className="w-14 h-14 text-tm-accent animate-bounce" />
                            <span className="text-[10px] font-bold text-tm-accent uppercase tracking-widest mt-2">
                                Alimenti Pronti
                            </span>
                        </div>
                    ) : isCooking ? (
                        /* In riscaldamento: icona vettoriale con piccola pillola temperatura corrente sotto */
                        <div className="flex flex-col items-center justify-center z-10 pointer-events-none animate-in zoom-in duration-300">
                            <div className="w-28 h-28 flex items-center justify-center drop-shadow-sm">
                                <img 
                                    src={riscaldaIcon} 
                                    alt="Riscalda Alimenti" 
                                    className="w-full h-full object-contain" 
                                />
                            </div>
                            {/* Piccola pillola sotto all'icona con la temperatura corrente */}
                            <div className="flex items-center gap-1.5 text-[11px] font-bold text-tm-accent bg-emerald-50 px-3 py-0.5 rounded-full border border-emerald-200/60 mt-1 shadow-2xs">
                                <span>{currentTemp}°C</span>
                                {tempReached && remainingSeconds !== null && (
                                    <>
                                        <span className="text-gray-300 font-normal">|</span>
                                        <span className="tabular-nums">{formatTime(remainingSeconds)}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* A riposo: temperatura da scegliere al posto dell'icona (regolabile con la manopola fisica) */
                        <div 
                            onClick={() => handleStepTemp(1)}
                            className="flex flex-col items-center justify-center z-10 cursor-pointer active:scale-95 transition-transform"
                        >
                            <div className="flex items-baseline justify-center">
                                <span className="text-5xl font-light tracking-tight tabular-nums text-tm-text">
                                    {targetTemp}
                                </span>
                                <span className="text-2xl font-bold text-gray-400 ml-1">°C</span>
                            </div>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                                Temperatura
                            </span>
                        </div>
                    )}
                </div>

                {/* Sezione Inferiore sotto l'anello: Tasto Stop (singolo tocco) o Disattiva */}
                <div className="h-14 flex items-center justify-center mt-4">
                    {isCooking && (
                        <button
                            onClick={handleStopHeating}
                            className="px-12 py-3 min-w-[170px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 shadow-md select-none bg-red-600 hover:bg-red-700 active:scale-95 text-white cursor-pointer animate-in fade-in"
                        >
                            Stop
                        </button>
                    )}

                    {isAlarm && (
                        <button
                            onClick={handleAckAlarm}
                            className="px-12 py-3 min-w-[170px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 shadow-md bg-tm-accent text-white hover:bg-emerald-800 active:scale-95 cursor-pointer animate-in fade-in"
                        >
                            Disattiva
                        </button>
                    )}
                </div>
            </div>

            {/* Colonna Destra: Descrizione e Pulsante Avvia con tenuta prolungata 1,3s */}
            <div className="flex flex-col items-center justify-center text-center px-6 max-w-sm mx-auto">
                <h2 className="text-2xl font-bold text-tm-text tracking-tight mb-3">
                    Riscalda Alimenti
                </h2>

                {/* Box Istruzioni */}
                <div className="bg-gray-50/90 rounded-2xl p-4 border border-gray-100 text-gray-600 text-xs leading-relaxed shadow-2xs text-center max-w-[280px]">
                    Inserisci la <strong>farfalla</strong> nel boccale per mescolare delicatamente e in modo uniforme gli alimenti. Tieni premuto per avviare il riscaldamento. Clicca una volta per fermare in qualsiasi momento.
                </div>

                {/* Pulsante Avvia: richiede tenuta di 1,3s con animazione */}
                <button
                    onPointerDown={handleStartPointerDown}
                    onPointerUp={handleStartPointerUp}
                    onPointerLeave={handleStartPointerUp}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    disabled={isCooking || isAlarm}
                    className={`relative mt-5 px-12 py-3.5 min-w-[200px] rounded-full font-bold text-base tracking-wide transition-all duration-200 shadow-sm overflow-hidden select-none ${
                        isCooking || isAlarm
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-tm-accent text-white active:scale-98 shadow-md cursor-pointer'
                    }`}
                >
                    {/* Barra di riempimento animata di 1,3 secondi per l'avvio */}
                    <div 
                        className={`absolute inset-0 bg-emerald-800 transition-all ${
                            isHoldingStart ? 'duration-[1300ms] ease-linear w-full' : 'duration-150 ease-out w-0'
                        }`} 
                    />
                    <span className="relative z-10 pointer-events-none">
                        {isCooking ? (
                            'Riscaldamento in corso'
                        ) : isAlarm ? (
                            'Riscaldamento terminato'
                        ) : (
                            'Avvia riscaldamento'
                        )}
                    </span>
                </button>
            </div>
        </div>
    );
};
