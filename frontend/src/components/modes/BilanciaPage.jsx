import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import bilanciaIcon from '../../assets/modes/bilancia.svg';

export const BilanciaPage = () => {
    const [weight, setWeight] = useState(0);
    const [isTaring, setIsTaring] = useState(false);
    const [isHolding, setIsHolding] = useState(false);

    const pollingRef = useRef(null);
    const holdTimeoutRef = useRef(null);

    // Esegui la tara
    const handleTare = () => {
        if (isTaring) return;
        setIsHolding(false);
        setIsTaring(true);
        socket.emit('SCALE_TARE');

        // Fallback locale immediato
        setTimeout(() => {
            setWeight(0);
            setIsTaring(false);
        }, 800);
    };

    // Gestione socket e lettura continua
    useEffect(() => {
        const handleWeightUpdate = (data) => {
            const rawWeight = typeof data.weight === 'number' ? data.weight : parseFloat(data.weight) || 0;
            const rounded = Math.round(rawWeight);
            setWeight(rounded);
        };

        socket.on('SCALE_WEIGHT', handleWeightUpdate);

        // Polling iniziale e periodico ogni 400ms per aggiornamenti costanti
        socket.emit('SCALE_READ');
        pollingRef.current = setInterval(() => {
            socket.emit('SCALE_READ');
        }, 400);

        // Ascolto eventi tasto fisico (Enter / Spazio con pressione di 1.3 secondi)
        const onPhysicalPressStart = () => {
            setIsHolding(true);
        };

        const onPhysicalPressEnd = () => {
            setIsHolding(false);
        };

        const onPhysicalTare = () => {
            handleTare();
        };

        window.addEventListener('scale-physical-press-start', onPhysicalPressStart);
        window.addEventListener('scale-physical-press-end', onPhysicalPressEnd);
        window.addEventListener('scale-physical-tare', onPhysicalTare);

        return () => {
            socket.off('SCALE_WEIGHT', handleWeightUpdate);
            if (pollingRef.current) clearInterval(pollingRef.current);
            window.removeEventListener('scale-physical-press-start', onPhysicalPressStart);
            window.removeEventListener('scale-physical-press-end', onPhysicalPressEnd);
            window.removeEventListener('scale-physical-tare', onPhysicalTare);
            if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
        };
    }, [isTaring]);

    // Supporto pressione prolungata (1.3s) anche sul tasto a schermo
    const handlePointerDown = () => {
        if (isTaring) return;
        setIsHolding(true);
        if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = setTimeout(() => {
            handleTare();
        }, 1300);
    };

    const handlePointerUp = () => {
        setIsHolding(false);
        if (holdTimeoutRef.current) {
            clearTimeout(holdTimeoutRef.current);
            holdTimeoutRef.current = null;
        }
    };

    // Percentuale sul massimo (3000g) per l'anello grafico
    const maxCapacity = 3000;
    const progressPercent = Math.min(100, Math.max(0, (weight / maxCapacity) * 100));
    // Circonferenza per r=88: 2 * Math.PI * 88 ~= 552.92
    const circumference = 552.92;
    const strokeDashoffset = circumference - (circumference * progressPercent) / 100;

    return (
        <div className="w-full h-full bg-white grid grid-cols-2 items-center select-none relative overflow-hidden px-8">
            {/* Colonna Sinistra: Anello del Peso centrato sull'asse verticale */}
            <div className="flex flex-col items-center justify-center">
                {/* Quadrante Circolare del Peso */}
                <div className="relative w-56 h-56 flex items-center justify-center">
                    {/* Anello di progressione SVG */}
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
                        {/* Arco attivo verde */}
                        <circle
                            cx="100"
                            cy="100"
                            r="88"
                            fill="none"
                            stroke="#00a651"
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeDashoffset}
                            className="transition-all duration-300 ease-out"
                        />
                    </svg>

                    {/* Valore del peso perfettamente centrato nel quadrante */}
                    <div className="flex items-baseline justify-center z-10">
                        <span className={`text-6xl font-light tracking-tight tabular-nums transition-transform duration-150 ${isTaring ? 'scale-90 opacity-40' : 'scale-100 text-tm-text'}`}>
                            {weight}
                        </span>
                        <span className="text-2xl font-bold text-gray-400 ml-1.5">g</span>
                    </div>
                </div>
            </div>

            {/* Colonna Destra: Icona Vettoriale Bilancia Gigante + Pulsante Tara */}
            <div className="flex flex-col items-center justify-center">
                {/* Icona Vettoriale della Bilancia (Gigante) */}
                <div className="w-40 h-40 flex items-center justify-center drop-shadow-sm">
                    <img 
                        src={bilanciaIcon} 
                        alt="Bilancia" 
                        className="w-full h-full object-contain pointer-events-none" 
                    />
                </div>

                {/* Pulsante Tara posizionato sotto l'icona */}
                <button
                    onClick={handleTare}
                    onPointerDown={handlePointerDown}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                    disabled={isTaring}
                    className={`relative mt-5 px-14 py-3.5 min-w-[170px] rounded-full font-bold text-base tracking-wide transition-all duration-200 shadow-sm overflow-hidden select-none ${
                        isTaring
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-tm-accent text-white active:scale-95'
                    }`}
                >
                    {/* Barra di riempimento animata di 1.3s (pressione fisica o touch) */}
                    <div 
                        className={`absolute inset-0 bg-emerald-800 transition-all ${
                            isHolding ? 'duration-[1300ms] ease-linear w-full' : 'duration-150 ease-out w-0'
                        }`} 
                    />
                    <span className="relative z-10 pointer-events-none">
                        {isTaring ? 'Azzeramento...' : 'Tara'}
                    </span>
                </button>
            </div>
        </div>
    );
};
