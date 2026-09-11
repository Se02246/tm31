// Funzione helper per le pause (delay)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let isSpigaRunning = false;
let currentPhase = 'IDLE'; // 'IDLE' | 'ORARIO_SPUNTO' | 'ORARIO' | 'PAUSA' | 'ANTIORARIO_SPUNTO' | 'ANTIORARIO'
let phaseChangeCallback = null;

function setPhase(phase) {
    currentPhase = phase;
    if (typeof phaseChangeCallback === 'function') {
        phaseChangeCallback(phase);
    }
}

async function startSpigaMode(serialPort, onPhaseChange) {
    if (isSpigaRunning) return;
    isSpigaRunning = true;
    phaseChangeCallback = onPhaseChange;

    console.log("🌾 [SPIGA] Modalità Spiga avviata con ciclo autentico TM31...");

    try {
        while (isSpigaRunning) {
            // 1A. SPINTA ORARIA - SPUNTO INIZIALE: 0.4s a Velocità 8, Rotazione Oraria (0x00)
            setPhase('ORARIO_SPUNTO');
            await serialPort.write(Buffer.from([0x52, 0x50, 0x00, 0x08, 0x00, 0x0D]));
            await sleep(400);
            if (!isSpigaRunning) break;

            // 1B. SPINTA ORARIA - IMPASTO: 1.0s a Velocità 4, Rotazione Oraria (0x00)
            setPhase('ORARIO');
            await serialPort.write(Buffer.from([0x52, 0x50, 0x00, 0x04, 0x00, 0x0D]));
            await sleep(1000);
            if (!isSpigaRunning) break;

            // 2. PAUSA CON BLOCCO LAME BRUSCO: 2.0s a Velocità 0 (0x00)
            setPhase('PAUSA');
            await serialPort.write(Buffer.from([0x52, 0x50, 0x00, 0x00, 0x00, 0x0D]));
            await sleep(2000);
            if (!isSpigaRunning) break;

            // 3A. SPINTA ANTIORARIA - SPUNTO INIZIALE: 0.4s a Velocità 8, Rotazione Antioraria (0x01)
            setPhase('ANTIORARIO_SPUNTO');
            await serialPort.write(Buffer.from([0x52, 0x50, 0x00, 0x08, 0x01, 0x0D]));
            await sleep(400);
            if (!isSpigaRunning) break;

            // 3B. SPINTA ANTIORARIA - IMPASTO: 1.0s a Velocità 4, Rotazione Antioraria (0x01)
            setPhase('ANTIORARIO');
            await serialPort.write(Buffer.from([0x52, 0x50, 0x00, 0x04, 0x01, 0x0D]));
            await sleep(1000);
            if (!isSpigaRunning) break;

            // 4. PAUSA CON BLOCCO LAME BRUSCO: 2.0s a Velocità 0 (0x00)
            setPhase('PAUSA');
            await serialPort.write(Buffer.from([0x52, 0x50, 0x00, 0x00, 0x00, 0x0D]));
            await sleep(2000);
        }
    } finally {
        // Stop definitivo di sicurezza alla conclusione o interruzione del ciclo
        if (serialPort && typeof serialPort.write === 'function') {
            await serialPort.write(Buffer.from([0x52, 0x50, 0x00, 0x00, 0x00, 0x0D]));
        }
        setPhase('IDLE');
        isSpigaRunning = false;
        console.log("🛑 [SPIGA] Ciclo Spiga concluso/fermato.");
    }
}

function stopSpigaMode(serialPort) {
    isSpigaRunning = false;
    setPhase('IDLE');
    if (serialPort && typeof serialPort.write === 'function') {
        serialPort.write(Buffer.from([0x52, 0x50, 0x00, 0x00, 0x00, 0x0D]));
    }
    console.log("🛑 [SPIGA] Modalità Spiga fermata.");
}

function getSpigaStatus() {
    return {
        isRunning: isSpigaRunning,
        phase: currentPhase
    };
}

module.exports = {
    startSpigaMode,
    stopSpigaMode,
    getSpigaStatus
};
