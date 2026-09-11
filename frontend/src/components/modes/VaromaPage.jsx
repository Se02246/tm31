import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import varomaIcon from '../../assets/modes/varoma.svg';
import { Bell } from 'lucide-react';

export const VaromaPage = () => {
    const [fsmState, setFsmState] = useState('IDLE');
    const [targetTime, setTargetTime] = useState(1200); // Default 20 minuti (1200s)
    const [remainingTime, setRemainingTime] = useState(1200);
    const [currentTemp, setCurrentTemp] = useState(20);
    const [isHoldingStart, setIsHoldingStart] = useState(false);

    const targetTimeRef = useRef(1200);
    targetTimeRef.current = targetTime;
    const initialTimeRef = useRef(1200);
    const hasReached100 = useRef(false);
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
                    // Durante il riscaldamento il timer scelto non scorre; scorre solo a riscaldamento ultimato (100°C)
                    if (hasReached100.current && ['LOCKING', 'STARTING_MOTOR', 'COOKING', 'STOPPING_MOTOR_NORMAL', 'STOPPING_MOTOR_ALARM', 'ALARM'].includes(data.value?.toUpperCase())) {
                        setRemainingTime(data.context.targetTime);
                    }
                }
                if (typeof data.context.currentTemp === 'number') {
                    setCurrentTemp(Math.round(data.context.currentTemp));
                }
            }
        };

        socket.on('state', handleState);
        return () => {
            socket.off('state', handleState);
        };
    }, []);

    // Monitoraggio 100°C: a riscaldamento ultimato parte il conto alla rovescia del timer scelto
    useEffect(() => {
        if (isCooking && currentTemp >= 100 && !hasReached100.current) {
            hasReached100.current = true;
            const timeToCook = targetTimeRef.current || 1200;
            setRemainingTime(timeToCook);
            socket.emit('CMD', { type: 'SET_TIME', value: timeToCook });
        }

        if (!isCooking && !isAlarm) {
            hasReached100.current = false;
        }
    }, [isCooking, currentTemp, isAlarm]);

    // Avvio cottura a vapore Varoma (velocità 1 antioraria, temperatura 120°C Varoma)
    const handleStartVaroma = () => {
        if (isCooking || isAlarm) return;
        const timeToStart = targetTimeRef.current || targetTime || 1200;
        if (timeToStart <= 0) return;

        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }

        hasReached100.current = false;
        initialTimeRef.current = timeToStart;
        setRemainingTime(timeToStart);

        // Parametri Varoma: rotazione antioraria, velocità 1, temperatura 120°C (Varoma)
        // Timeout iniziale di 3600s per permettere al boccale di scaldarsi fino a 100°C;
        // il timer specifico impostato dall'utente partirà solo quando il riscaldamento è terminato.
        socket.emit('CMD', { type: 'SET_DIRECTION', value: true }); // rotazione antioraria
        socket.emit('CMD', { type: 'SET_SPEED', value: 1 });        // velocità 1 per circolare vapore
        socket.emit('CMD', { type: 'SET_TEMP', value: 120 });       // temperatura Varoma (120°C)
        socket.emit('CMD', { type: 'SET_TIME', value: 3600 });
        socket.emit('CMD', { type: 'PLAY' });
    };

    // Arresto cottura immediato
    const handleStopVaroma = () => {
        hasReached100.current = false;
        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'STOP' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
        setRemainingTime(targetTimeRef.current || 1200);
    };

    // Pressione touch sul tasto Avvia (1,3s)
    const handleStartPointerDown = () => {
        if (isCooking || isAlarm) return;
        setIsHoldingStart(true);
        if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        holdStartTimeoutRef.current = setTimeout(() => {
            handleStartVaroma();
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
        hasReached100.current = false;
        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'ACK_ALARM' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
        setRemainingTime(targetTimeRef.current || 1200);
    };

    // Modifica del tempo con manopola o touch (+/- delta)
    const adjustTime = (deltaMinutes) => {
        if (isCooking) return;
        setTargetTime((prev) => {
            const next = Math.max(60, Math.min(7200, prev + deltaMinutes * 60)); // Min 1 min, Max 120 min
            targetTimeRef.current = next;
            setRemainingTime(next);
            return next;
        });
    };

    // Ascolto eventi fisici della manopola TM31
    useEffect(() => {
        const onPhysicalTap = () => {
            if (isAlarm) {
                handleAckAlarm();
            } else if (isCooking) {
                handleStopVaroma();
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
                handleStartVaroma();
            }
        };

        const onKnobTurn = (e) => {
            if (!isCooking && !isAlarm) {
                const dir = e.detail?.direction || 0;
                if (dir !== 0) {
                    adjustTime(dir); // 1 minuto a scatto
                }
            }
        };

        window.addEventListener('varoma-physical-tap', onPhysicalTap);
        window.addEventListener('varoma-physical-start-press', onPhysicalStartPress);
        window.addEventListener('varoma-physical-start-release', onPhysicalStartRelease);
        window.addEventListener('varoma-physical-start-complete', onPhysicalStartComplete);
        window.addEventListener('varoma-knob-turn', onKnobTurn);

        return () => {
            window.removeEventListener('varoma-physical-tap', onPhysicalTap);
            window.removeEventListener('varoma-physical-start-press', onPhysicalStartPress);
            window.removeEventListener('varoma-physical-start-release', onPhysicalStartRelease);
            window.removeEventListener('varoma-physical-start-complete', onPhysicalStartComplete);
            window.removeEventListener('varoma-knob-turn', onKnobTurn);
            if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        };
    }, [isCooking, isAlarm]);

    // Formattazione tempo
    const formatTime = (totalSec) => {
        const m = Math.floor(totalSec / 60);
        const s = totalSec % 60;
        if (m >= 60) {
            const h = Math.floor(m / 60);
            const remM = m % 60;
            return `${h}h ${remM.toString().padStart(2, '0')}m`;
        }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    // Progresso anello decrescente (stile TM6): 80 tacche riscaldamento + targetTime tacche timer
    // - A riposo: anello pieno al 100%
    // - In cottura a vapore: decresce progressivamente da 100% a 0%
    // - In allarme: anello svuotato (0%)
    const TOTAL_STAGES = 80 + (targetTime || 1200);
    let currentStages = 0;
    if (isCooking) {
        if (!hasReached100.current) {
            // Fase 1: Riscaldamento (da 20°C a 100°C -> 80 stadi)
            currentStages = Math.max(0, Math.min(80, currentTemp - 20));
        } else {
            // Fase 2: Cottura a vapore (80 stadi riscaldamento + secondi trascorsi del timer)
            const elapsedTimer = Math.max(0, Math.min(targetTime, targetTime - remainingTime));
            currentStages = 80 + elapsedTimer;
        }
    }

    const progressPercent = isCooking
        ? Math.max(0, Math.min(100, ((TOTAL_STAGES - currentStages) / TOTAL_STAGES) * 100))
        : (isAlarm ? 0 : 100);
    const circumference = 552.92;
    const strokeDashoffset = circumference - (circumference * progressPercent) / 100;

    return (
        <div className="w-full h-full bg-white grid grid-cols-2 items-center select-none relative overflow-hidden px-8">
            {/* Colonna Sinistra: Anello con Timer (a riposo) o Icona Varoma (in cottura) e Tasto Stop/Disattiva */}
            <div className="flex flex-col items-center justify-center">
                {/* Quadrante Circolare */}
                <div 
                    onWheel={(e) => {
                        if (!isCooking && !isAlarm) {
                            adjustTime(e.deltaY < 0 ? 1 : -1);
                        }
                    }}
                    className="relative w-56 h-56 flex items-center justify-center"
                >
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
                            stroke={isCooking ? '#10b981' : '#00a651'}
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
                        <div className="flex flex-col items-center justify-center animate-in zoom-in duration-300 z-10">
                            <Bell className="w-14 h-14 text-tm-accent animate-bounce" />
                            <span className="text-[10px] font-bold text-tm-accent uppercase tracking-widest mt-2">
                                Cottura Terminata
                            </span>
                        </div>
                    ) : isCooking ? (
                        /* Durante la cottura: compare l'icona del Varoma con la pillola/tasto grigio sotto */
                        <div className="flex flex-col items-center justify-center z-10 pointer-events-none animate-in zoom-in duration-300">
                            <div className="w-24 h-24 flex items-center justify-center drop-shadow-sm">
                                <img 
                                    src={varomaIcon} 
                                    alt="Varoma" 
                                    className="w-full h-full object-contain" 
                                />
                            </div>
                            {/* Tasto / Pillola grigia sotto all'icona */}
                            <div className="flex items-center gap-1.5 text-xs font-bold text-gray-700 bg-gray-100 px-3.5 py-1 rounded-full border border-gray-200 shadow-2xs mt-1">
                                {!hasReached100.current ? (
                                    <span className="tracking-wide text-gray-600">Riscaldamento</span>
                                ) : (
                                    <span className="tabular-nums tracking-tight text-gray-800 font-semibold">{formatTime(remainingTime)}</span>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* A riposo: il timer si trova DENTRO all'anello, nessuna icona finché la cottura non inizia */
                        <div 
                            onClick={() => adjustTime(1)}
                            className="flex flex-col items-center justify-center z-10 cursor-pointer select-none active:scale-98 transition-transform"
                        >
                            <div className="text-5xl font-light tracking-tight tabular-nums text-tm-text">
                                {formatTime(targetTime)}
                            </div>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-2">
                                Tempo
                            </span>
                        </div>
                    )}
                </div>

                {/* Sezione Inferiore sotto l'anello: Tasto Stop (singolo tocco) o Disattiva */}
                <div className="h-14 flex items-center justify-center mt-4">
                    {isCooking && (
                        <button
                            onClick={handleStopVaroma}
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

            {/* Colonna Destra: Titolo "Modalità Varoma", Box Istruzioni e Tasto Avvia */}
            <div className="flex flex-col items-center justify-center text-center px-6 max-w-sm mx-auto">
                <h2 className="text-2xl font-bold text-tm-text tracking-tight mb-2">
                    Modalità Varoma
                </h2>

                {/* Box Istruzioni */}
                <div className="bg-gray-50/90 rounded-2xl p-3.5 border border-gray-100 text-gray-600 text-xs leading-relaxed shadow-2xs text-center max-w-[280px]">
                    Versa almeno <strong>500g di acqua</strong> nel boccale, posiziona il recipiente Varoma con gli alimenti sopra il coperchio e chiudi con il coperchio Varoma.
                </div>

                {/* Pulsante Avvia Cottura con tenuta 1,3s */}
                <button
                    onPointerDown={handleStartPointerDown}
                    onPointerUp={handleStartPointerUp}
                    onPointerLeave={handleStartPointerUp}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    disabled={isCooking || isAlarm}
                    className={`relative mt-4 px-12 py-3.5 min-w-[200px] rounded-full font-bold text-base tracking-wide transition-all duration-200 shadow-sm overflow-hidden select-none ${
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
                        {isCooking ? (!hasReached100.current ? 'Riscaldamento' : 'Cottura in corso') : isAlarm ? 'Cottura terminata' : 'Avvia Varoma'}
                    </span>
                </button>
            </div>
        </div>
    );
};
