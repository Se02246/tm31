import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import cbtIcon from '../../assets/modes/cbt.svg';
import { Bell } from 'lucide-react';


export const CbtPage = () => {
    const [fsmState, setFsmState] = useState('IDLE');
    const [targetTemp, setTargetTemp] = useState(60); // Default 60°C (cottura ideale sous-vide)
    const [targetTime, setTargetTime] = useState(3600); // Default 1 ora (3600s)
    const [remainingTime, setRemainingTime] = useState(3600);
    const [currentTemp, setCurrentTemp] = useState(20);
    const [selectedWidget, setSelectedWidget] = useState('TIME'); // 'TIME' o 'TEMP'
    const [isHoldingStart, setIsHoldingStart] = useState(false);
    const [isTempReachedState, setIsTempReachedState] = useState(false);

    const targetTimeRef = useRef(3600);
    targetTimeRef.current = targetTime;
    const targetTempRef = useRef(60);
    targetTempRef.current = targetTemp;
    const initialCookingTimeRef = useRef(3600);
    const tempReached = useRef(false);
    const holdStartTimeoutRef = useRef(null);

    const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmState);
    const isAlarm = fsmState === 'ALARM';

    // Ascolto stato globale FSM e timer dal socket
    useEffect(() => {
        const handleState = (data) => {
            if (data && data.value) {
                const state = data.value.toUpperCase();
                setFsmState(state);
            }
            if (data && data.context) {
                if (typeof data.context.targetTime === 'number') {
                    // Il timer scelto scorre solo a riscaldamento ultimato (quando la temperatura target è stata raggiunta)
                    if (tempReached.current && ['LOCKING', 'STARTING_MOTOR', 'COOKING', 'STOPPING_MOTOR_NORMAL', 'STOPPING_MOTOR_ALARM', 'ALARM'].includes(data.value?.toUpperCase())) {
                        setRemainingTime(data.context.targetTime);
                    }
                }
                if (typeof data.context.currentTemp === 'number') {
                    setCurrentTemp(data.context.currentTemp);
                }
            }
        };

        socket.on('state', handleState);
        return () => {
            socket.off('state', handleState);
        };
    }, []);

    // Monitoraggio temperatura: quando il Bimby arriva a temperatura target, il timer impostato inizia a scorrere
    useEffect(() => {
        if (isCooking && currentTemp >= targetTemp && !tempReached.current) {
            tempReached.current = true;
            setIsTempReachedState(true);
            const timeToCook = targetTimeRef.current || 3600;
            setRemainingTime(timeToCook);
            // Inizia il conto alla rovescia effettivo nel backend
            socket.emit('CMD', { type: 'SET_TIME', value: timeToCook });
        }

        if (!isCooking && !isAlarm) {
            tempReached.current = false;
            setIsTempReachedState(false);
        }
    }, [isCooking, currentTemp, targetTemp, isAlarm]);

    // Avvio cottura CBT: velocità 0.5 in senso antiorario (circolazione delicata che protegge il sacchetto), temperatura e tempo impostati
    const handleStartCbt = () => {
        if (isCooking || isAlarm) return;
        const timeToStart = targetTimeRef.current || targetTime || 3600;
        const tempToStart = targetTempRef.current || targetTemp || 60;
        if (timeToStart <= 0 || tempToStart <= 0) return;

        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }

        tempReached.current = false;
        setIsTempReachedState(false);
        initialCookingTimeRef.current = timeToStart;
        setRemainingTime(timeToStart);

        // Fase iniziale di riscaldamento: imposta temperatura e velocità, con timeout di sicurezza a 3600s
        // Il timer effettivo impostato dall'utente partirà solo quando la temperatura è raggiunta
        socket.emit('CMD', { type: 'SET_DIRECTION', value: true }); // Senso antiorario
        socket.emit('CMD', { type: 'SET_SPEED', value: 0.5 });       // Velocità 0.5
        socket.emit('CMD', { type: 'SET_TEMP', value: tempToStart });
        socket.emit('CMD', { type: 'SET_TIME', value: 3600 });
        socket.emit('CMD', { type: 'PLAY' });
    };

    // Pressione touch sul tasto Avvia (richiede 1,3s)
    const handleStartPointerDown = () => {
        if (isCooking || isAlarm) return;
        setIsHoldingStart(true);
        if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        holdStartTimeoutRef.current = setTimeout(() => {
            handleStartCbt();
        }, 1300);
    };

    const handleStartPointerUp = () => {
        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }
    };

    // Arresto cottura immediato
    const handleStopCbt = () => {
        tempReached.current = false;
        setIsTempReachedState(false);
        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'STOP' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
        setRemainingTime(targetTimeRef.current || 3600);
    };

    // Silenzia e disattiva allarme
    const handleAckAlarm = () => {
        tempReached.current = false;
        setIsTempReachedState(false);
        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'ACK_ALARM' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
        setRemainingTime(targetTimeRef.current || 3600);
    };

    const MAX_CBT_TIME = 48 * 3600; // 172800s (48 ore)
    const MIN_CBT_TIME = 60; // 1 minuto (60s)

    // Modifica del tempo (+ / - fino a 48 ore)
    const adjustTime = (deltaSeconds) => {
        if (isCooking) return;
        setTargetTime((prev) => {
            const next = Math.max(MIN_CBT_TIME, Math.min(MAX_CBT_TIME, prev + deltaSeconds));
            targetTimeRef.current = next;
            setRemainingTime(next);
            return next;
        });
    };

    // Modifica della temperatura: grado per grado da 37°C fino a 80°C
    const adjustTemp = (direction) => {
        if (isCooking) return;
        setTargetTemp((prev) => {
            const next = Math.max(37, Math.min(80, prev + direction));
            targetTempRef.current = next;
            return next;
        });
    };

    // Ascolto manopola fisica ed eventi da App.jsx
    useEffect(() => {
        const onKnobTurn = (e) => {
            if (isCooking) return;
            const dir = e.detail?.direction || 0;
            if (dir === 0) return;

            if (selectedWidget === 'TEMP') {
                adjustTemp(dir);
            } else {
                // Passo tempo: 60s (<10min), 300s (5min), 900s (15min) o 1800s (>12h)
                const step = targetTime >= 43200 ? 1800 : (targetTime >= 3600 ? 900 : (targetTime >= 600 ? 300 : 60));
                adjustTime(dir * step);
            }
        };

        const onPhysicalClick = () => {
            if (isAlarm) {
                handleAckAlarm();
            } else if (isCooking) {
                // Durante la cottura un singolo click interrompe la cottura
                handleStopCbt();
            } else {
                // A riposo un click singolo passa da Temperatura a Tempo e viceversa
                setSelectedWidget((prev) => (prev === 'TIME' ? 'TEMP' : 'TIME'));
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
                handleStartCbt();
            }
        };

        window.addEventListener('cbt-knob-turn', onKnobTurn);
        window.addEventListener('cbt-physical-click', onPhysicalClick);
        window.addEventListener('cbt-physical-start-press', onPhysicalStartPress);
        window.addEventListener('cbt-physical-start-release', onPhysicalStartRelease);
        window.addEventListener('cbt-physical-start-complete', onPhysicalStartComplete);

        return () => {
            window.removeEventListener('cbt-knob-turn', onKnobTurn);
            window.removeEventListener('cbt-physical-click', onPhysicalClick);
            window.removeEventListener('cbt-physical-start-press', onPhysicalStartPress);
            window.removeEventListener('cbt-physical-start-release', onPhysicalStartRelease);
            window.removeEventListener('cbt-physical-start-complete', onPhysicalStartComplete);
            if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        };
    }, [isCooking, isAlarm, selectedWidget, targetTime]);

    // Formattazione tempo in ore, minuti e secondi
    const formatTimeDisplay = (totalSec) => {
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;

        const pad = (n) => String(n).padStart(2, '0');

        if (h > 0) {
            return (
                <div className="flex items-baseline justify-center">
                    <span className="text-3xl font-light tracking-tight tabular-nums text-tm-text">{pad(h)}:{pad(m)}</span>
                    <span className="text-sm font-bold text-gray-400 ml-1">:{pad(s)}</span>
                </div>
            );
        }

        return (
            <div className="flex items-baseline justify-center">
                <span className="text-4xl font-light tracking-tight tabular-nums text-tm-text">{pad(m)}:{pad(s)}</span>
            </div>
        );
    };

    // Calcolo circonferenza anelli (r=74 -> 2 * PI * 74 = 464.95)
    const circumference = 464.95;

    // Progresso tempo decrescente (stile TM6):
    // - A riposo / selezione: cresce linearmente con il timer impostato (da 1 min a 48 ore)
    // - In cottura (preriscaldamento): anello pieno al 100% in attesa
    // - In cottura (in temperatura): decresce progressivamente da 100% a 0% man mano che il tempo scorre
    // - In allarme: anello svuotato (0%)
    const displaySec = isCooking ? remainingTime : targetTime;
    const totalSec = initialCookingTimeRef.current || targetTime || 3600;

    let timeProgress = 100;
    if (isCooking) {
        if (!isTempReachedState) {
            // Fase iniziale di riscaldamento: timer in attesa, anello pieno al 100%
            timeProgress = 100;
        } else {
            // Fase di cottura CBT effettiva: l'anello decresce man mano che il tempo scorre fino a 0%
            timeProgress = Math.max(0, Math.min(100, (remainingTime / totalSec) * 100));
        }
    } else if (isAlarm) {
        timeProgress = 0;
    } else {
        // A riposo / selezione: proporzionale al timer impostato su 48h
        timeProgress = Math.max(1.5, Math.min(100, (targetTime / MAX_CBT_TIME) * 100));
    }

    const timeDashoffset = circumference - (circumference * timeProgress) / 100;

    // Progresso temperatura (37 - 80°C con step TM31)
    const tempProgress = Math.max(15, Math.min(100, ((targetTemp - 37) / (80 - 37)) * 85 + 15));
    const tempDashoffset = circumference - (circumference * tempProgress) / 100;

    return (
        <div className="w-full h-full bg-white flex items-center justify-between select-none relative overflow-hidden px-6">
            {/* Colonna Sinistra: I Due Anelli con sotto il Tasto Stop/Disattiva centrato tra i due */}
            <div className="flex-1 flex flex-col items-center justify-center pr-2">
                {/* Riga dei Due Anelli */}
                <div className="flex items-center justify-center gap-7">
                    {/* 1. Anello del Tempo (Anello di Sinistra) */}
                    <div className="flex flex-col items-center">
                        <div 
                            onClick={() => !isCooking && setSelectedWidget('TIME')}
                            onWheel={(e) => {
                                if (!isCooking) {
                                    const step = targetTime >= 43200 ? 1800 : (targetTime >= 3600 ? 900 : (targetTime >= 600 ? 300 : 60));
                                    adjustTime(e.deltaY < 0 ? step : -step);
                                }
                            }}
                            className={`relative w-[164px] h-[164px] rounded-full flex items-center justify-center transition-all duration-300 bg-white border border-gray-100/80 ${
                                !isCooking ? 'cursor-pointer' : ''
                            } ${
                                !isCooking && selectedWidget === 'TIME'
                                    ? 'scale-105 shadow-[0_0_22px_rgba(0,166,81,0.35)] z-10'
                                    : 'scale-100 shadow-xs'
                            }`}
                        >
                            {/* SVG Progress Ring Tempo */}
                            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 170 170">
                                <circle
                                    cx="85"
                                    cy="85"
                                    r="74"
                                    fill="none"
                                    stroke="#f1f5f9"
                                    strokeWidth="7"
                                />
                                <circle
                                    cx="85"
                                    cy="85"
                                    r="74"
                                    fill="none"
                                    stroke={isCooking || isAlarm ? '#10b981' : '#00a651'}
                                    strokeWidth={isCooking ? '8' : '7'}
                                    strokeLinecap="round"
                                    strokeDasharray={circumference}
                                    strokeDashoffset={timeDashoffset}
                                    className={`transition-all duration-300 ease-out ${
                                        isCooking && isTempReachedState ? 'animate-pulse drop-shadow-[0_0_8px_rgba(16,185,129,0.6)]' : ''
                                    }`}
                                />
                            </svg>

                            {/* Contenuto Quadrante Tempo */}
                            <div className="flex flex-col items-center justify-center z-10">
                                {formatTimeDisplay(displaySec)}
                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                                    Tempo
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* 2. Anello della Temperatura / Icona CBT (Anello di Destra) */}
                    <div className="flex flex-col items-center">
                        <div 
                            onClick={() => !isCooking && setSelectedWidget('TEMP')}
                            onWheel={(e) => {
                                if (!isCooking) adjustTemp(e.deltaY < 0 ? 1 : -1);
                            }}
                            className={`relative w-[164px] h-[164px] rounded-full flex items-center justify-center transition-all duration-300 bg-white border border-gray-100/80 ${
                                !isCooking ? 'cursor-pointer' : ''
                            } ${
                                !isCooking && selectedWidget === 'TEMP'
                                    ? 'scale-105 shadow-[0_0_22px_rgba(0,166,81,0.35)] z-10'
                                    : 'scale-100 shadow-xs'
                            }`}
                        >
                            {/* SVG Progress Ring Temperatura */}
                            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 170 170">
                                <circle
                                    cx="85"
                                    cy="85"
                                    r="74"
                                    fill="none"
                                    stroke="#f1f5f9"
                                    strokeWidth="7"
                                />
                                <circle
                                    cx="85"
                                    cy="85"
                                    r="74"
                                    fill="none"
                                    stroke={isCooking ? '#10b981' : '#00a651'}
                                    strokeWidth={isCooking ? '8' : '7'}
                                    strokeLinecap="round"
                                    strokeDasharray={circumference}
                                    strokeDashoffset={isCooking ? 0 : tempDashoffset}
                                    className={`transition-all duration-300 ease-out ${
                                        isCooking ? 'animate-pulse drop-shadow-[0_0_8px_rgba(16,185,129,0.6)]' : ''
                                    }`}
                                />
                            </svg>

                            {/* Contenuto Quadrante: Temperatura a riposo, Icona CBT durante la cottura */}
                            {isAlarm ? (
                                /* Allarme: campanella rimbalzante */
                                <div className="flex flex-col items-center justify-center animate-in zoom-in duration-300 z-10">
                                    <Bell className="w-10 h-10 text-tm-accent animate-bounce" />
                                    <span className="text-[10px] font-bold text-tm-accent uppercase tracking-widest mt-1">
                                        Terminato
                                    </span>
                                </div>
                            ) : isCooking ? (
                                /* In cottura: icona vettoriale del CBT con temperatura corrente e stato riscaldamento */
                                <div className="flex flex-col items-center justify-center z-10 pointer-events-none animate-in zoom-in duration-300">
                                    <div className="w-16 h-16 flex items-center justify-center drop-shadow-sm">
                                        <img 
                                            src={cbtIcon} 
                                            alt="CBT" 
                                            className="w-full h-full object-contain" 
                                        />
                                    </div>
                                    <div className="flex items-baseline justify-center -mt-0.5">
                                        <span className="text-sm font-bold text-gray-700 tabular-nums">
                                            {Math.floor(currentTemp)}
                                        </span>
                                        <span className="text-[11px] font-bold text-gray-400 ml-0.5">°C</span>
                                    </div>
                                    {!isTempReachedState ? (
                                        <span className="text-[9px] font-bold text-amber-600 uppercase tracking-wider mt-0.5 animate-pulse">
                                            Riscaldamento
                                        </span>
                                    ) : (
                                        <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider mt-0.5">
                                            In temperatura
                                        </span>
                                    )}
                                </div>
                            ) : (
                                /* A riposo: visualizzazione e impostazione della temperatura */
                                <div className="flex flex-col items-center justify-center z-10">
                                    <div className="flex items-baseline justify-center">
                                        <span className="text-4xl font-light tracking-tight tabular-nums text-tm-text">
                                            {targetTemp}
                                        </span>
                                        <span className="text-xl font-bold text-gray-400 ml-0.5">°C</span>
                                    </div>
                                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                                        Temperatura
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Riga inferiore: Tasto Stop o Disattiva centrato esattamente sotto i due anelli */}
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
                            onClick={handleStopCbt}
                            className="px-12 py-2.5 min-w-[170px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 shadow-md select-none bg-red-600 hover:bg-red-700 active:scale-95 text-white cursor-pointer animate-in fade-in"
                        >
                            Stop
                        </button>
                    ) : (
                        <div className="h-[46px]" />
                    )}
                </div>
            </div>

            {/* Colonna Destra: Titolo, Box informativo ristretto e Tasto Avvia disattivabile */}
            <div className="w-[270px] flex flex-col items-center justify-center text-center pl-2">
                <h2 className="text-xl font-bold text-tm-text tracking-tight mb-2.5">
                    Modalità CBT
                </h2>

                {/* Box Istruzioni Ufficiali ristretto */}
                <div className="bg-gray-50/90 rounded-2xl p-3 border border-gray-100 text-gray-600 text-xs leading-relaxed shadow-2xs text-center max-w-[240px]">
                    Inserisci il cestello all'interno del boccale, inserisci il sacchetto sottovuoto contenente l'alimento, versa acqua nel boccale fino a coprire il sacchetto, scegli la temperatura e inserisci il tempo di cottura. Poi clicca il tasto "Avvia".
                </div>

                {/* Pulsante Avvia: a riposo attivo, durante la cottura si disattiva come in Bollitore */}
                <div className="mt-4">
                    <button
                        onPointerDown={handleStartPointerDown}
                        onPointerUp={handleStartPointerUp}
                        onPointerLeave={handleStartPointerUp}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        disabled={isCooking || isAlarm}
                        className={`relative overflow-hidden px-10 py-3 min-w-[170px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 select-none ${
                            isCooking || isAlarm
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
                            {isCooking ? (!isTempReachedState ? 'Riscaldamento' : 'CBT in funzione') : isAlarm ? 'CBT terminata' : 'Avvia'}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};
