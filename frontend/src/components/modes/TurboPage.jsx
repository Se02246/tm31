import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import turboIcon from '../../assets/modes/turbo.svg';
import { Bell, AlertTriangle, Square } from 'lucide-react';

export const TurboPage = () => {
    const [fsmState, setFsmState] = useState('IDLE');
    const [currentTemp, setCurrentTemp] = useState(20);
    const [isHoldingStart, setIsHoldingStart] = useState(false);
    const [thermalError, setThermalError] = useState(false);

    const holdStartTimeoutRef = useRef(null);

    const isCooking = ['LOCKING', 'STARTING_MOTOR', 'COOKING'].includes(fsmState);
    const isAlarm = fsmState === 'ALARM';
    const isThermalLocked = currentTemp > 80; // Sicurezza Turbo: boccale > 80°C inibisce Turbo

    // Ascolto stato globale FSM e temperatura dal socket
    useEffect(() => {
        const handleState = (data) => {
            if (data && data.value) {
                const state = data.value.toUpperCase();
                setFsmState(state);
            }
            if (data && data.context && typeof data.context.currentTemp === 'number') {
                setCurrentTemp(data.context.currentTemp);
                if (data.context.currentTemp <= 80) {
                    setThermalError(false);
                }
            }
        };

        socket.on('state', handleState);
        return () => {
            socket.off('state', handleState);
        };
    }, []);

    // Avvio modalità Turbo sempre continua (Velocità 10, Temp 0°C, Timer 0 = continuo)
    const handleStartTurbo = () => {
        if (isCooking || isAlarm) return;
        if (isThermalLocked) {
            setThermalError(true);
            return;
        }

        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }

        setThermalError(false);

        // Imposta parametri TM31: rotazione oraria, nessun riscaldamento, velocità 10, tempo 0 (continuo)
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 10 });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'PLAY' });
    };

    // Pressione touch sul tasto Avvia (richiede tenuta di 1,3s)
    const handleStartPointerDown = () => {
        if (isCooking || isAlarm || isThermalLocked) return;
        setIsHoldingStart(true);
        if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        holdStartTimeoutRef.current = setTimeout(() => {
            handleStartTurbo();
        }, 1300);
    };

    const handleStartPointerUp = () => {
        setIsHoldingStart(false);
        if (holdStartTimeoutRef.current) {
            clearTimeout(holdStartTimeoutRef.current);
            holdStartTimeoutRef.current = null;
        }
    };

    // Arresto Turbo immediato con un solo click
    const handleStopTurbo = () => {
        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'STOP' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
    };

    // Silenzia e disattiva allarme
    const handleAckAlarm = () => {
        socket.emit('CMD', { type: 'RESET' });
        socket.emit('CMD', { type: 'ACK_ALARM' });
        socket.emit('CMD', { type: 'SET_TIME', value: 0 });
        socket.emit('CMD', { type: 'SET_SPEED', value: 0 });
        socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
        socket.emit('CMD', { type: 'SET_DIRECTION', value: false });
    };

    // Ascolto eventi fisici della manopola TM31
    useEffect(() => {
        const onPhysicalClick = () => {
            if (isAlarm) {
                handleAckAlarm();
            } else if (isCooking) {
                // Durante il Turbo un solo click sulla manopola arresta immediatamente le lame
                handleStopTurbo();
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
                handleStartTurbo();
            }
        };

        window.addEventListener('turbo-physical-click', onPhysicalClick);
        window.addEventListener('turbo-physical-start-press', onPhysicalStartPress);
        window.addEventListener('turbo-physical-start-release', onPhysicalStartRelease);
        window.addEventListener('turbo-physical-start-complete', onPhysicalStartComplete);

        return () => {
            window.removeEventListener('turbo-physical-click', onPhysicalClick);
            window.removeEventListener('turbo-physical-start-press', onPhysicalStartPress);
            window.removeEventListener('turbo-physical-start-release', onPhysicalStartRelease);
            window.removeEventListener('turbo-physical-start-complete', onPhysicalStartComplete);
            if (holdStartTimeoutRef.current) clearTimeout(holdStartTimeoutRef.current);
        };
    }, [isCooking, isAlarm, isThermalLocked]);

    // Circonferenza anello (r=88 -> 2 * PI * 88 = 552.92)
    const circumference = 552.92;

    return (
        <div className="w-full h-full bg-white flex items-center justify-between select-none relative overflow-hidden px-6">
            {/* Colonna Sinistra: Quadrante Circolare Turbo e Tasto Stop/Disattiva */}
            <div className="flex-1 flex flex-col items-center justify-center pr-2">
                <div className="relative w-56 h-56 flex items-center justify-center">
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
                            stroke={isCooking ? '#10b981' : '#00a651'}
                            strokeWidth={isCooking ? '9' : '8'}
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={0}
                            className={`transition-all duration-300 ease-out ${
                                isCooking ? 'animate-pulse drop-shadow-[0_0_10px_rgba(16,185,129,0.7)]' : ''
                            }`}
                        />
                    </svg>

                    {/* Contenuto Quadrante */}
                    {isAlarm ? (
                        <div className="flex flex-col items-center justify-center animate-in zoom-in duration-300 z-10">
                            <Bell className="w-14 h-14 text-tm-accent animate-bounce" />
                            <span className="text-[11px] font-bold text-tm-accent uppercase tracking-widest mt-2">
                                Turbo Terminato
                            </span>
                        </div>
                    ) : (
                        /* Sia a riposo che in moto: icona Turbo fissa (non rotante), pulita, senza testi o pillole */
                        <div className="flex flex-col items-center justify-center z-10 pointer-events-none">
                            <div className="w-28 h-28 flex items-center justify-center drop-shadow-sm">
                                <img 
                                    src={turboIcon} 
                                    alt="Turbo" 
                                    className="w-full h-full object-contain" 
                                />
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
                            onClick={handleStopTurbo}
                            className="px-12 py-2.5 min-w-[170px] rounded-full font-bold text-sm tracking-wide transition-all duration-200 shadow-md select-none bg-red-600 hover:bg-red-700 active:scale-95 text-white cursor-pointer animate-in fade-in flex items-center justify-center gap-2"
                        >
                            <Square className="w-4 h-4 fill-white" />
                            <span>Stop</span>
                        </button>
                    ) : (
                        <div className="h-[46px]" />
                    )}
                </div>
            </div>

            {/* Colonna Destra: Titolo, Box informativo, Warning Termico e Tasto Avvia */}
            <div className="w-[280px] flex flex-col items-center justify-center text-center pl-2">
                <h2 className="text-xl font-bold text-tm-text tracking-tight mb-2.5">
                    Modalità Turbo
                </h2>

                {/* Box Istruzioni */}
                <div className="bg-gray-50/90 rounded-2xl p-3 border border-gray-100 text-gray-600 text-xs leading-relaxed shadow-2xs text-center max-w-[250px]">
                    Inserisci gli ingredienti nel boccale e chiudi il coperchio con il misurino. Tieni premuto per avviare il Turbo alla massima potenza in continuo. Clicca una volta per fermare le lame in qualsiasi momento.
                </div>

                {/* Avviso Blocco Termico di Sicurezza se > 80°C */}
                {(isThermalLocked || thermalError) && (
                    <div className="mt-2.5 flex items-start gap-2 bg-amber-50/95 border border-amber-200 text-amber-900 p-2.5 rounded-xl text-[11px] font-semibold text-left max-w-[250px] shadow-2xs animate-in zoom-in-95 duration-200">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                            <span className="font-bold block">Boccale caldo ({Math.floor(currentTemp)}°C &gt; 80°C)</span>
                            <span className="text-amber-700 text-[10px] leading-tight block mt-0.5">
                                La modalità Turbo è bloccata sopra gli 80°C per evitare schizzi o fuoriuscite di vapore caldo.
                            </span>
                        </div>
                    </div>
                )}

                {/* Pulsante Avvia Turbo con tenuta 1.3s */}
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
                        <span className="relative z-10 pointer-events-none flex items-center justify-center">
                            {isCooking ? (
                                <span>Turbo in corso...</span>
                            ) : isAlarm ? (
                                <span>Turbo terminato</span>
                            ) : isThermalLocked ? (
                                <span>Boccale caldo (&gt;80°C)</span>
                            ) : (
                                <span>Avvia Turbo</span>
                            )}
                        </span>
                    </button>
                </div>
            </div>
        </div>
    );
};
