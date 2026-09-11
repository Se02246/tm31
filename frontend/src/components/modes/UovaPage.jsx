import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import { Bell } from 'lucide-react';

const EGG_SETTINGS = [
    {
        id: 'coque',
        name: 'Alla coque',
        time: 11 * 60, // 11 minuti (660s)
        temp: 120,     // Varoma
        speed: 1,      // Velocità 1
        levelFraction: 1 / 5, // 20%
        description: 'Uova molto cremose (tuorlo liquido).'
    },
    {
        id: 'barzotte',
        name: 'Barzotte',
        time: 12 * 60, // 12 minuti (720s)
        temp: 120,     // Varoma
        speed: 1,      // Velocità 1
        levelFraction: 2 / 5, // 40%
        description: 'Uova cremose (albume sodo).'
    },
    {
        id: 'medie',
        name: 'Medie',
        time: 13 * 60, // 13 minuti (780s)
        temp: 120,     // Varoma
        speed: 1,      // Velocità 1
        levelFraction: 3 / 5, // 60%
        description: 'Uova morbide.'
    },
    {
        id: 'sode',
        name: 'Sode',
        time: 14 * 60, // 14 minuti (840s)
        temp: 120,     // Varoma
        speed: 1,      // Velocità 1
        levelFraction: 4 / 5, // 80%
        description: 'Uova sode.'
    },
    {
        id: 'ben_sode',
        name: 'Ben sode',
        time: 15 * 60, // 15 minuti (900s)
        temp: 120,     // Varoma
        speed: 1,      // Velocità 1
        levelFraction: 5 / 5, // 100%
        description: 'Uova molto sode.'
    }
];

export const UovaPage = () => {
    const [fsmState, setFsmState] = useState('IDLE');
    const [currentTemp, setCurrentTemp] = useState(20);
    const [selectedIndex, setSelectedIndex] = useState(2); // Default "Medie" (3/5)
    const [isHoldingStart, setIsHoldingStart] = useState(false);
    const [boilingElapsed, setBoilingElapsed] = useState(0);

    const selectedIndexRef = useRef(2);
    selectedIndexRef.current = selectedIndex;
    const hasReached100 = useRef(false);
    const boilingIntervalRef = useRef(null);
    const boilingStartTimeRef = useRef(null);
    const holdStartTimeoutRef = useRef(null);

    const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmState);
    const isAlarm = fsmState === 'ALARM';

    const currentSetting = EGG_SETTINGS[selectedIndex];

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

    // Avvio cottura uova (richiede tenuta prolungata di 1,3s)
    const handleStartCooking = () => {
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

        // Imposta velocità 1, rotazione antioraria (reverse), temperatura Varoma (120°C)
        // Usa timeout di sicurezza 3600 nel backend per riscaldamento; il timer specifico parte a 100°C
        socket.emit('CMD', { type: 'SET_DIRECTION', value: true }); // rotazione al contrario
        socket.emit('CMD', { type: 'SET_SPEED', value: 1 });        // velocità 1
        socket.emit('CMD', { type: 'SET_TEMP', value: 120 });       // temperatura Varoma
        socket.emit('CMD', { type: 'SET_TIME', value: 3600 });
        socket.emit('CMD', { type: 'PLAY' });
    };

    // Monitoraggio 100°C: timer in background per i minuti della cottura selezionata
    useEffect(() => {
        if (isCooking && currentTemp >= 100 && !hasReached100.current) {
            hasReached100.current = true;
            boilingStartTimeRef.current = Date.now();
            setBoilingElapsed(0);

            const settingTime = EGG_SETTINGS[selectedIndexRef.current]?.time || 780;
            // Imposta il timer dei minuti esatti nel backend in sottofondo
            socket.emit('CMD', { type: 'SET_TIME', value: settingTime });

            // Avanzamento continuo e sincronizzato dei secondi per completare l'anello
            if (boilingIntervalRef.current) clearInterval(boilingIntervalRef.current);
            boilingIntervalRef.current = setInterval(() => {
                if (!boilingStartTimeRef.current) return;
                const elapsed = (Date.now() - boilingStartTimeRef.current) / 1000;
                if (elapsed >= settingTime) {
                    setBoilingElapsed(settingTime);
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

    // Arresto immediato con un solo tocco
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
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
    };

    // Pressione touch sul tasto Avvia (1,3s)
    const handleStartPointerDown = () => {
        if (isCooking || isAlarm) return;
        setIsHoldingStart(true);
        if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        holdStartTimeoutRef.current = setTimeout(() => {
            handleStartCooking();
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
        hasReached100.current = false;
        boilingStartTimeRef.current = null;
        setBoilingElapsed(0);
        if (boilingIntervalRef.current) {
            clearInterval(boilingIntervalRef.current);
            boilingIntervalRef.current = null;
        }
    };

    // Ascolto eventi fisici della manopola TM31
    useEffect(() => {
        const onPhysicalTap = () => {
            if (isAlarm) {
                handleAckAlarm();
            } else if (isCooking) {
                handleStopCooking();
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
                handleStartCooking();
            }
        };

        const onKnobTurn = (e) => {
            if (!isCooking && !isAlarm) {
                const dir = e.detail?.direction || 0;
                if (dir !== 0) {
                    setSelectedIndex(prev => Math.max(0, Math.min(EGG_SETTINGS.length - 1, prev + dir)));
                }
            }
        };

        window.addEventListener('uova-physical-tap', onPhysicalTap);
        window.addEventListener('uova-physical-start-press', onPhysicalStartPress);
        window.addEventListener('uova-physical-start-release', onPhysicalStartRelease);
        window.addEventListener('uova-physical-start-complete', onPhysicalStartComplete);
        window.addEventListener('uova-knob-turn', onKnobTurn);

        return () => {
            window.removeEventListener('uova-physical-tap', onPhysicalTap);
            window.removeEventListener('uova-physical-start-press', onPhysicalStartPress);
            window.removeEventListener('uova-physical-start-release', onPhysicalStartRelease);
            window.removeEventListener('uova-physical-start-complete', onPhysicalStartComplete);
            window.removeEventListener('uova-knob-turn', onKnobTurn);
            if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
            if (boilingIntervalRef.current) clearInterval(boilingIntervalRef.current);
        };
    }, [isCooking, isAlarm]);

    // Calcolo circonferenza anello (r=88 -> 552.92)
    const circumference = 552.92;

    // Progresso anello decrescente (stile TM6):
    // - A riposo: mostra la lunghezza proporzionale al livello selezionato (1/5, 2/5, 3/5, 4/5, 5/5)
    // - In cottura: parte da 100% e decresce progressivamente durante riscaldamento ed ebollizione
    // - In allarme: anello svuotato (0%)
    let activePercent = currentSetting.levelFraction * 100;
    if (isCooking) {
        const totalStages = 80 + currentSetting.time;
        let currentStages = 0;
        if (!hasReached100.current) {
            // Fase 1: Riscaldamento (da 20°C a 100°C -> 80 stadi)
            currentStages = Math.max(0, Math.min(80, currentTemp - 20));
        } else {
            // Fase 2: Ebollizione a 100°C per la durata della consistenza scelta
            currentStages = 80 + Math.max(0, Math.min(currentSetting.time, boilingElapsed));
        }
        activePercent = Math.max(0, Math.min(100, ((totalStages - currentStages) / totalStages) * 100));
    } else if (isAlarm) {
        activePercent = 0;
    }

    const strokeDashoffset = circumference - (circumference * activePercent) / 100;

    return (
        <div className="w-full h-full bg-white grid grid-cols-2 items-center select-none relative overflow-hidden px-8">
            {/* Colonna Sinistra: Un solo anello pulito con il nome della cottura all'interno e Tasto Stop/Disattiva */}
            <div className="flex flex-col items-center justify-center">
                {/* Quadrante Circolare */}
                <div 
                    onClick={() => !isCooking && !isAlarm && setSelectedIndex(prev => (prev + 1) % EGG_SETTINGS.length)}
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
                        {/* Arco attivo verde: da 1/5 a 5/5 in selezione, pulsante durante la cottura */}
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

                    {/* Contenuto interno all'anello: SOLO il nome della cottura (pulito, nessun timer/temperatura/velocità) */}
                    {isAlarm ? (
                        <div className="flex flex-col items-center justify-center animate-in zoom-in duration-300 z-10">
                            <Bell className="w-14 h-14 text-tm-accent animate-bounce" />
                            <span className="text-[10px] font-bold text-tm-accent uppercase tracking-widest mt-2">
                                Uova Pronte
                            </span>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center z-10 text-center px-4 pointer-events-none">
                            <span className="text-3xl font-light tracking-tight text-tm-text leading-tight capitalize">
                                {currentSetting.name}
                            </span>
                        </div>
                    )}
                </div>

                {/* Sezione Inferiore sotto l'anello: Tasto Stop (singolo tocco) o Disattiva */}
                <div className="h-14 flex items-center justify-center mt-4">
                    {isCooking && (
                        <button
                            onClick={handleStopCooking}
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

            {/* Colonna Destra: Titolo "Modalità Cuoci Uova", Box Spiegazione e Pulsante Avvia con tenuta 1,3s */}
            <div className="flex flex-col items-center justify-center text-center px-6 max-w-sm mx-auto">
                <h2 className="text-2xl font-bold text-tm-text tracking-tight mb-3">
                    Modalità Cuoci Uova
                </h2>

                {/* Box Spiegazione Istruzioni */}
                <div className="bg-gray-50/90 rounded-2xl p-4 border border-gray-100 text-gray-600 text-xs leading-relaxed shadow-2xs text-center max-w-[280px]">
                    <p className="mb-2">
                        Inserisci il <strong>cestello</strong> nel boccale e ricopri le uova di acqua fredda fino a coprirle. Chiudi il coperchio con il misurino.
                    </p>
                    <div className="pt-2 border-t border-gray-200/60 font-medium text-emerald-800 text-[11px]">
                        <strong>{currentSetting.name}</strong>: {currentSetting.description}
                    </div>
                </div>

                {/* Pulsante Avvia Cottura: tenuta prolungata 1,3s */}
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
                        {isCooking ? 'Cottura in corso...' : isAlarm ? 'Cottura terminata' : 'Avvia cottura'}
                    </span>
                </button>
            </div>
        </div>
    );
};
