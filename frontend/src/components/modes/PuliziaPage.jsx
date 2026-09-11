import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import puliziaIcon from '../../assets/modes/pulizia.svg';
import { Bell, RotateCcw, Sparkles } from 'lucide-react';

const CLEAN_SETTINGS = [
    {
        id: 'leggera',
        name: 'Leggera',
        time: 10 * 60, // 10 minuti (600s)
        temp: 55,      // 55°C
        baseSpeed: 3,  // Velocità 3
        levelFraction: 1 / 3, // 33.3%
        description: '10 min · 55°C · Vel 3 (con scatti a 9)',
        detail: 'Ideale per residui leggeri o dopo impasti semplici e risciacqui rapidi.'
    },
    {
        id: 'media',
        name: 'Media',
        time: 15 * 60, // 15 minuti (900s)
        temp: 70,      // 70°C
        baseSpeed: 4,  // Velocità 4
        levelFraction: 2 / 3, // 66.6%
        description: '15 min · 70°C · Vel 4 (con scatti a 9)',
        detail: 'Pulizia standard per salse, creme, uova, formaggi o residui unti.'
    },
    {
        id: 'approfondita',
        name: 'Approfondita',
        time: 23 * 60, // 23 minuti (1380s)
        temp: 85,      // 85°C
        baseSpeed: 5,  // Velocità 5
        levelFraction: 3 / 3, // 100%
        description: '23 min · 85°C · Vel 5 (con scatti a 9)',
        detail: 'Pulizia intensa ad alta temperatura per incrostazioni ostinate, zuccheri o fondi bruciacchiati.'
    }
];

export const PuliziaPage = () => {
    const [fsmState, setFsmState] = useState('IDLE');
    const [currentTemp, setCurrentTemp] = useState(20);
    const [selectedIndex, setSelectedIndex] = useState(1); // Default "Media" (2/3)
    const [remainingTime, setRemainingTime] = useState(15 * 60);
    const [cyclePhase, setCyclePhase] = useState('BASE'); // 'BASE' | 'PAUSE' | 'BURST'
    const [isAntiClockwise, setIsAntiClockwise] = useState(false);
    const [isHoldingStart, setIsHoldingStart] = useState(false);

    const selectedIndexRef = useRef(1);
    selectedIndexRef.current = selectedIndex;

    const remainingTimeRef = useRef(15 * 60);
    remainingTimeRef.current = remainingTime;

    const cycleSecondsRef = useRef(0);
    const directionRef = useRef(false);
    const cycleIntervalRef = useRef(null);
    const holdStartTimeoutRef = useRef(null);

    const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmState);
    const isAlarm = fsmState === 'ALARM';

    const currentSetting = CLEAN_SETTINGS[selectedIndex];

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

    // Formattazione tempo in mm:ss
    const formatTime = (sec) => {
        const s = Math.max(0, Math.floor(sec));
        const m = Math.floor(s / 60);
        const remSec = s % 60;
        return `${String(m).padStart(2, '0')}:${String(remSec).padStart(2, '0')}`;
    };

    // Avvio del programma di pulizia (richiede pressione prolungata di 1,3s)
    const handleStartCleaning = () => {
        if (isCooking || isAlarm) return;
        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }

        const setting = CLEAN_SETTINGS[selectedIndexRef.current];
        const totalDuration = setting.time;
        setRemainingTime(totalDuration);
        remainingTimeRef.current = totalDuration;
        cycleSecondsRef.current = 0;
        directionRef.current = false;
        setIsAntiClockwise(false);
        setCyclePhase('BASE');

        // Impostazione iniziale comandi
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
        socket.emit('CMD', { type: 'SET_SPEED', value: setting.baseSpeed });
        socket.emit('CMD', { type: 'SET_TEMP', value: setting.temp });
        socket.emit('CMD', { type: 'SET_TIME', value: totalDuration });
        socket.emit('CMD', { type: 'PLAY' });
    };

    // Gestione ciclo temporizzato: timer, pausa di 2s prima dello scatto, scatto di 3s a velocità 9 con inversione lama
    useEffect(() => {
        if (isCooking) {
            if (!cycleIntervalRef.current) {
                cycleIntervalRef.current = setInterval(() => {
                    const currentTotal = remainingTimeRef.current;
                    if (currentTotal <= 1) {
                        // Fine programma
                        setRemainingTime(0);
                        remainingTimeRef.current = 0;
                        clearInterval(cycleIntervalRef.current);
                        cycleIntervalRef.current = null;
                        setCyclePhase('BASE');
                        socket.emit('CMD', { type: 'TIME_UP' });
                        return;
                    }

                    const nextTime = currentTotal - 1;
                    setRemainingTime(nextTime);
                    remainingTimeRef.current = nextTime;

                    const secInMinute = (cycleSecondsRef.current + 1) % 60;
                    cycleSecondsRef.current = secInMinute;

                    const activeSetting = CLEAN_SETTINGS[selectedIndexRef.current];

                    // Sequenza al minuto (frequenza: una volta al minuto):
                    // - Secondi 0 - 54: Velocità base (3, 4 o 5)
                    // - Secondi 55 - 56: Pausa 2 secondi prima dello scatto (Velocità 0)
                    // - Secondi 57 - 59: Scatto di 3 secondi a Velocità 9 con inversione lama
                    // - Secondo 0: Ritorno a velocità base
                    if (secInMinute === 55) {
                        // Inizio Pausa di 2 secondi prima dello scatto a 9
                        setCyclePhase('PAUSE');
                        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
                    } else if (secInMinute === 57) {
                        // Inizio Scatto di 3 secondi a Velocità 9 con inversione del verso della lama
                        directionRef.current = !directionRef.current;
                        setIsAntiClockwise(directionRef.current);
                        setCyclePhase('BURST');
                        socket.emit('CMD', { type: 'SET_DIRECTION', value: directionRef.current });
                        socket.emit('CMD', { type: 'SET_SPEED', value: 9 });
                    } else if (secInMinute === 0) {
                        // Fine dello scatto: ritorno alla velocità base del livello attivo
                        setCyclePhase('BASE');
                        socket.emit('CMD', { type: 'SET_SPEED', value: activeSetting.baseSpeed });
                    }
                }, 1000);
            }
        } else {
            if (cycleIntervalRef.current) {
                clearInterval(cycleIntervalRef.current);
                cycleIntervalRef.current = null;
            }
            if (!isAlarm) {
                setCyclePhase('BASE');
                cycleSecondsRef.current = 0;
            }
        }

        return () => {
            if (cycleIntervalRef.current) {
                clearInterval(cycleIntervalRef.current);
                cycleIntervalRef.current = null;
            }
        };
    }, [isCooking, isAlarm]);

    // Arresto immediato con singolo tocco
    const handleStopCleaning = () => {
        if (cycleIntervalRef.current) {
            clearInterval(cycleIntervalRef.current);
            cycleIntervalRef.current = null;
        }
        cycleSecondsRef.current = 0;
        setCyclePhase('BASE');
        setRemainingTime(CLEAN_SETTINGS[selectedIndexRef.current].time);

        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'STOP' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
    };

    // Pressione touch sul tasto Avvia (1,3s)
    const handleStartPointerDown = () => {
        if (isCooking || isAlarm) return;
        setIsHoldingStart(true);
        if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        holdStartTimeoutRef.current = setTimeout(() => {
            handleStartCleaning();
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
        if (cycleIntervalRef.current) {
            clearInterval(cycleIntervalRef.current);
            cycleIntervalRef.current = null;
        }
        cycleSecondsRef.current = 0;
        setCyclePhase('BASE');
        setRemainingTime(CLEAN_SETTINGS[selectedIndexRef.current].time);

        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'ACK_ALARM' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
    };

    // Ascolto eventi fisici della manopola TM31
    useEffect(() => {
        const onPhysicalTap = () => {
            if (isAlarm) {
                handleAckAlarm();
            } else if (isCooking) {
                handleStopCleaning();
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
                handleStartCleaning();
            }
        };

        const onKnobTurn = (e) => {
            if (!isCooking && !isAlarm) {
                const dir = e.detail?.direction || 0;
                if (dir !== 0) {
                    setSelectedIndex(prev => Math.max(0, Math.min(CLEAN_SETTINGS.length - 1, prev + dir)));
                }
            }
        };

        window.addEventListener('pulizia-physical-tap', onPhysicalTap);
        window.addEventListener('pulizia-physical-start-press', onPhysicalStartPress);
        window.addEventListener('pulizia-physical-start-release', onPhysicalStartRelease);
        window.addEventListener('pulizia-physical-start-complete', onPhysicalStartComplete);
        window.addEventListener('pulizia-knob-turn', onKnobTurn);

        return () => {
            window.removeEventListener('pulizia-physical-tap', onPhysicalTap);
            window.removeEventListener('pulizia-physical-start-press', onPhysicalStartPress);
            window.removeEventListener('pulizia-physical-start-release', onPhysicalStartRelease);
            window.removeEventListener('pulizia-physical-start-complete', onPhysicalStartComplete);
            window.removeEventListener('pulizia-knob-turn', onKnobTurn);
            if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
            if (cycleIntervalRef.current) clearInterval(cycleIntervalRef.current);
        };
    }, [isCooking, isAlarm]);

    // Calcolo circonferenza anello (r=88 -> 552.92)
    const circumference = 552.92;

    // Progresso anello decrescente (stile TM6):
    // - A riposo: mostra la lunghezza dell'arco proporzionale al livello selezionato (1/3, 2/3, 3/3)
    // - In cottura: parte da 100% e decresce progressivamente man mano che il tempo scorre
    // - In allarme: anello svuotato (0%)
    let activePercent = currentSetting.levelFraction * 100;
    if (isCooking) {
        const totalDuration = currentSetting.time;
        activePercent = Math.max(0, Math.min(100, (remainingTime / totalDuration) * 100));
    } else if (isAlarm) {
        activePercent = 0;
    }

    const strokeDashoffset = circumference - (circumference * activePercent) / 100;

    return (
        <div className="w-full h-full bg-white grid grid-cols-2 items-center select-none relative overflow-hidden px-8">
            {/* Colonna Sinistra: Quadrante circolare con Livello (a riposo) o Icona Pulizia + Timer (in funzione) e Tasto Stop/Disattiva */}
            <div className="flex flex-col items-center justify-center">
                {/* Quadrante Circolare */}
                <div 
                    onClick={() => !isCooking && !isAlarm && setSelectedIndex(prev => (prev + 1) % CLEAN_SETTINGS.length)}
                    onWheel={(e) => {
                        if (!isCooking && !isAlarm) {
                            const dir = e.deltaY < 0 ? 1 : -1;
                            setSelectedIndex(prev => Math.max(0, Math.min(CLEAN_SETTINGS.length - 1, prev + dir)));
                        }
                    }}
                    className={`relative w-56 h-56 flex items-center justify-center ${
                        !isCooking && !isAlarm ? 'cursor-pointer active:scale-98 transition-transform' : ''
                    }`}
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
                        {/* Arco attivo verde: 1/3, 2/3 o 3/3 in selezione, animato in cottura */}
                        <circle
                            cx="100"
                            cy="100"
                            r="88"
                            fill="none"
                            stroke={isCooking ? (cyclePhase === 'BURST' ? '#06b6d4' : '#10b981') : '#00a651'}
                            strokeWidth={isCooking ? (cyclePhase === 'BURST' ? '10' : '9') : '8'}
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            className={`transition-all duration-300 ease-out ${
                                isCooking ? (cyclePhase === 'BURST' ? 'animate-pulse drop-shadow-[0_0_12px_rgba(6,182,212,0.8)]' : 'drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]') : ''
                            }`}
                        />
                    </svg>

                    {/* Contenuto interno all'anello */}
                    {isAlarm ? (
                        <div className="flex flex-col items-center justify-center animate-in zoom-in duration-300 z-10">
                            <Bell className="w-14 h-14 text-tm-accent animate-bounce" />
                            <span className="text-[10px] font-bold text-tm-accent uppercase tracking-widest mt-2">
                                Pulizia Terminata
                            </span>
                        </div>
                    ) : isCooking ? (
                        <div className="flex flex-col items-center justify-center z-10 pointer-events-none animate-in zoom-in duration-300">
                            <div className="w-20 h-20 flex items-center justify-center drop-shadow-sm mb-1">
                                <img 
                                    src={puliziaIcon} 
                                    alt="Pulizia" 
                                    className="w-full h-full object-contain" 
                                />
                            </div>
                            {/* Pillola stato ciclo e conto alla rovescia */}
                            <div className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full border shadow-2xs transition-all bg-gray-50 border-gray-200">
                                {cyclePhase === 'BURST' ? (
                                    <span className="text-cyan-600 font-extrabold flex items-center gap-1">
                                        <Sparkles className="w-3.5 h-3.5 animate-spin" />
                                        Scatto Vel 9!
                                    </span>
                                ) : cyclePhase === 'PAUSE' ? (
                                    <span className="text-amber-600 font-semibold tracking-wide">
                                        Frenata (2s)
                                    </span>
                                ) : (
                                    <div className="flex items-center gap-1.5 text-gray-700">
                                        <span className="tabular-nums font-semibold tracking-tight">{formatTime(remainingTime)}</span>
                                        <span className="text-[10px] text-gray-400 font-normal">|</span>
                                        <span className="text-[11px] text-emerald-700 font-bold">{currentTemp}°C</span>
                                        {isAntiClockwise && <RotateCcw className="w-3 h-3 text-tm-accent ml-0.5" />}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        /* A riposo: solo il nome dell'intensità selezionata (stile Cuoci Uova) */
                        <div className="flex flex-col items-center justify-center z-10 text-center px-4 pointer-events-none">
                            <span className="text-3xl font-light tracking-tight text-tm-text leading-tight capitalize">
                                {currentSetting.name}
                            </span>
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1.5">
                                Intensità
                            </span>
                        </div>
                    )}
                </div>

                {/* Sezione Inferiore sotto l'anello: Tasto Stop (singolo tocco) o Disattiva */}
                <div className="h-14 flex items-center justify-center mt-4">
                    {isCooking && (
                        <button
                            onClick={handleStopCleaning}
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

            {/* Colonna Destra: Titolo "Modalità Pulizia", Box Istruzioni Ufficiale e Pulsante Avvia con tenuta 1,3s */}
            <div className="flex flex-col items-center justify-center text-center px-6 max-w-sm mx-auto">
                <h2 className="text-2xl font-bold text-tm-text tracking-tight mb-3">
                    Modalità Pulizia
                </h2>

                {/* Box Istruzioni richiesta dall'utente */}
                <div className="bg-gray-50/90 rounded-2xl p-4 border border-gray-100 text-gray-600 text-xs leading-relaxed shadow-2xs text-center max-w-[290px]">
                    <p className="mb-2">
                        Versa <strong>1 litro d'acqua</strong> nel boccale con una goccia di sapone per piatti, dopo aver accuratamente rimosso cibo e accessori dal boccale. Chiudi con coperchio e misurino.
                    </p>
                    <div className="pt-2 border-t border-gray-200/60 font-medium text-emerald-800 text-[11px]">
                        <strong>{currentSetting.name}</strong>: {currentSetting.description}
                    </div>
                </div>

                {/* Pulsante Avvia Pulizia: tenuta prolungata 1,3s */}
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
                        {isCooking ? 'Pulizia in corso...' : isAlarm ? 'Pulizia terminata' : 'Avvia pulizia'}
                    </span>
                </button>
            </div>
        </div>
    );
};
