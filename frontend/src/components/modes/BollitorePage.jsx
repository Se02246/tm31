import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import bollitoreIcon from '../../assets/modes/bollitore.svg';
import { Bell } from 'lucide-react';

export const BollitorePage = () => {
    const [fsmState, setFsmState] = useState('IDLE');
    const [currentTemp, setCurrentTemp] = useState(20);
    const [isHoldingStart, setIsHoldingStart] = useState(false);
    const [boilingElapsed, setBoilingElapsed] = useState(0);

    const hasReached100 = useRef(false);
    const boilingIntervalRef = useRef(null);
    const boilingStartTimeRef = useRef(null);
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

    // Avvio del bollitore (richiede pressione di 1,3 secondi)
    const handleStartBoiling = () => {
        if (isCooking || isAlarm) return;
        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }
        hasReached100.current = false;
        boilingStartTimeRef.current = null;
        setBoilingElapsed(0);
        if (boilingIntervalRef.current) {
            clearInterval(boilingIntervalRef.current);
            boilingIntervalRef.current = null;
        }

        // Imposta velocità 0.5, temperatura 120 e avvia la cottura
        socket.emit('CMD', { type: 'SET_SPEED', value: 0.5 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 120 });
        socket.emit('CMD', { type: 'SET_TIME', value: 3600 }); // Timeout massimo di sicurezza nel backend
        socket.emit('CMD', { type: 'PLAY' });
    };

    // Monitoraggio 100°C: timer in background di 3 minuti (180s) prima di suonare (nessun timer mostrato a schermo)
    useEffect(() => {
        if (isCooking && currentTemp >= 100 && !hasReached100.current) {
            hasReached100.current = true;
            boilingStartTimeRef.current = Date.now();
            setBoilingElapsed(0);

            // Imposta 180s (3 minuti) nel backend in sottofondo
            socket.emit('CMD', { type: 'SET_TIME', value: 180 });

            // Avanzamento continuo e sincronizzato dei 180 secondi per completare l'anello
            if (boilingIntervalRef.current) clearInterval(boilingIntervalRef.current);
            boilingIntervalRef.current = setInterval(() => {
                if (!boilingStartTimeRef.current) return;
                const elapsed = (Date.now() - boilingStartTimeRef.current) / 1000;
                if (elapsed >= 180) {
                    setBoilingElapsed(180);
                    clearInterval(boilingIntervalRef.current);
                    boilingIntervalRef.current = null;
                    socket.emit('CMD', { type: 'TIME_UP' });
                } else {
                    setBoilingElapsed(elapsed);
                }
            }, 250);
        }

        if (!isCooking && !isAlarm) {
            hasReached100.current = false;
            boilingStartTimeRef.current = null;
            setBoilingElapsed(0);
            if (boilingIntervalRef.current) {
                clearInterval(boilingIntervalRef.current);
                boilingIntervalRef.current = null;
            }
        }
    }, [isCooking, currentTemp, isAlarm]);

    // Arresto cottura immediato con un solo tocco
    const handleStopCooking = () => {
        if (boilingIntervalRef.current) {
            clearInterval(boilingIntervalRef.current);
            boilingIntervalRef.current = null;
        }
        hasReached100.current = false;
        boilingStartTimeRef.current = null;
        setBoilingElapsed(0);

        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'STOP' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
    };

    // Pressione touch / mouse tasto Avvia (1,3 secondi)
    const handleStartPointerDown = () => {
        if (isCooking || isAlarm) return;
        setIsHoldingStart(true);
        if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        holdStartTimeoutRef.current = setTimeout(() => {
            handleStartBoiling();
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
        hasReached100.current = false;
        boilingStartTimeRef.current = null;
        setBoilingElapsed(0);
        if (boilingIntervalRef.current) {
            clearInterval(boilingIntervalRef.current);
            boilingIntervalRef.current = null;
        }
    };

    // Ascolto eventi tasto fisico dalla manopola
    useEffect(() => {
        const onPhysicalTap = () => {
            if (isAlarm) {
                handleAckAlarm();
            } else if (isCooking) {
                // Durante la cottura un singolo tocco arresta immediatamente
                handleStopCooking();
            }
            // A riposo un tocco singolo NON avvia nulla: bisogna tenere premuto 1.3s
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
                handleStartBoiling();
            }
        };

        window.addEventListener('bollitore-physical-tap', onPhysicalTap);
        window.addEventListener('bollitore-physical-start-press', onPhysicalStartPress);
        window.addEventListener('bollitore-physical-start-release', onPhysicalStartRelease);
        window.addEventListener('bollitore-physical-start-complete', onPhysicalStartComplete);

        return () => {
            window.removeEventListener('bollitore-physical-tap', onPhysicalTap);
            window.removeEventListener('bollitore-physical-start-press', onPhysicalStartPress);
            window.removeEventListener('bollitore-physical-start-release', onPhysicalStartRelease);
            window.removeEventListener('bollitore-physical-start-complete', onPhysicalStartComplete);
            if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
            if (boilingIntervalRef.current) clearInterval(boilingIntervalRef.current);
        };
    }, [isCooking, isAlarm]);

    // Progresso anello: esattamente 260 "stadi o tacche" totali
    // - 80 stadi per la temperatura: da 20°C (temperatura ambiente) a 100°C (100 - 20 = 80 tacche)
    // - 180 stadi per il timer di 3 minuti di ebollizione (180 secondi = 180 tacche)
    // Totale = 80 + 180 = 260 stadi. Quando raggiunge 260 il cerchio si chiude al 100% e suona l'allarme.
    // Progresso anello decrescente (stile TM6): esattamente 260 stadi totali
    // - A riposo: anello pieno al 100%
    // - In riscaldamento ed ebollizione: decresce progressivamente da 100% a 0%
    // - All'allarme: anello svuotato (0%)
    const TOTAL_STAGES = 260;
    let currentStages = 0;
    if (isCooking) {
        if (!hasReached100.current) {
            // Fase 1: Riscaldamento (da 20°C a 100°C -> 80 stadi)
            const tempStages = Math.max(0, Math.min(80, currentTemp - 20));
            currentStages = tempStages;
        } else {
            // Fase 2: Ebollizione a 100°C per 3 minuti (80 stadi base + 180 stadi timer)
            const timerStages = Math.max(0, Math.min(180, boilingElapsed));
            currentStages = 80 + timerStages;
        }
    }

    const progressPercent = isCooking
        ? Math.max(0, Math.min(100, ((TOTAL_STAGES - currentStages) / TOTAL_STAGES) * 100))
        : (isAlarm ? 0 : 100);
    const circumference = 552.92;
    const strokeDashoffset = circumference - (circumference * progressPercent) / 100;

    return (
        <div className="w-full h-full bg-white grid grid-cols-2 items-center select-none relative overflow-hidden px-8">
            {/* Colonna Sinistra: Anello con Icona Vettoriale all'interno e Tasto Stop/Disattiva */}
            <div className="flex flex-col items-center justify-center">
                {/* Quadrante Circolare del Bollitore */}
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
                        {/* Arco attivo verde: lampeggia di verde durante il funzionamento */}
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

                    {/* Contenuto interno all'anello: Icona Vettoriale (oppure campanella animata quando suona) */}
                    {isAlarm ? (
                        /* Campanella animata all'interno dell'anello quando suona */
                        <div className="flex flex-col items-center justify-center animate-in zoom-in duration-300 z-10">
                            <Bell className="w-14 h-14 text-tm-accent animate-bounce" />
                            <span className="text-[10px] font-bold text-tm-accent uppercase tracking-widest mt-2">
                                Acqua Pronta
                            </span>
                        </div>
                    ) : (
                        /* Icona Vettoriale del Bollitore posizionata all'interno dell'anello */
                        <div className="w-32 h-32 flex items-center justify-center drop-shadow-sm z-10 pointer-events-none">
                            <img 
                                src={bollitoreIcon} 
                                alt="Bollitore" 
                                className="w-full h-full object-contain" 
                            />
                        </div>
                    )}
                </div>

                {/* Sezione Inferiore sotto l'anello: Tasto Stop (singolo tocco) o Disattiva */}
                <div className="h-14 flex items-center justify-center mt-4">
                    {isCooking && (
                        /* Tasto Stop: compare SOLO durante la cottura, basta un click per fermare */
                        <button
                            onClick={handleStopCooking}
                            className="px-12 py-3 min-w-[170px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 shadow-md select-none bg-red-600 hover:bg-red-700 active:scale-95 text-white cursor-pointer animate-in fade-in"
                        >
                            Stop
                        </button>
                    )}

                    {isAlarm && (
                        /* Tasto Disattiva: compare quando suona la campanella */
                        <button
                            onClick={handleAckAlarm}
                            className="px-12 py-3 min-w-[170px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 shadow-md bg-tm-accent text-white hover:bg-emerald-800 active:scale-95 cursor-pointer animate-in fade-in"
                        >
                            Disattiva
                        </button>
                    )}
                </div>
            </div>

            {/* Colonna Destra: Descrizione e Pulsante Avvia (singolo click su touch) */}
            <div className="flex flex-col items-center justify-center text-center px-6 max-w-sm mx-auto">
                <h2 className="text-2xl font-bold text-tm-text tracking-tight mb-4">
                    Modalità Bollitore
                </h2>

                {/* Box Istruzioni */}
                <div className="bg-gray-50/90 rounded-2xl p-5 border border-gray-100 text-gray-600 text-sm leading-relaxed shadow-2xs">
                    Inserisci l'acqua nel boccale, chiudi il coperchio e clicca il pulsante per avviare il bollitore.
                </div>

                {/* Pulsante Avvia Bollitore: richiede tenuta di 1,3s con animazione, un tocco singolo non avvia nulla */}
                <button
                    onPointerDown={handleStartPointerDown}
                    onPointerUp={handleStartPointerUp}
                    onPointerLeave={handleStartPointerUp}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    disabled={isCooking || isAlarm}
                    className={`relative mt-6 px-12 py-3.5 min-w-[200px] rounded-full font-bold text-base tracking-wide transition-all duration-200 shadow-sm overflow-hidden select-none ${
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
                        {isCooking ? 'Bollitore in funzione' : isAlarm ? 'Bollitore terminato' : 'Avvia bollitore'}
                    </span>
                </button>
            </div>
        </div>
    );
};
