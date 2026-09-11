const { getSpigaStatus } = require('../modes/spigaRunner');

function toHex(val) {
    return Math.max(0, Math.min(255, Math.round(Number(val) || 0)))
        .toString(16)
        .toUpperCase()
        .padStart(2, '0');
}

function getSpeedHex(val) {
    if (!val || val === 0) return '00';
    if (val === 0.5) return '01';
    return Math.max(0, Math.min(255, Math.round(val + 1)))
        .toString(16)
        .toUpperCase()
        .padStart(2, '0');
}

let heartbeatInterval = null;
let lastSentPacket = null;

/**
 * Avvia il loop di trasmissione ciclico (Heartbeat TX) ogni 250ms
 * per soddisfare il watchdog hardware della scheda di potenza del TM31.
 * 
 * @param {object} bimbyService - Actor XState della macchina Bimby
 * @param {object} bimbySerial - Driver seriale (mock o real)
 * @param {number} intervalMs - Frequenza di polling (default 250ms)
 */
function startHeartbeat(bimbyService, bimbySerial, intervalMs = 250) {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }

    console.log(`💓 [SERIAL HEARTBEAT] Loop TX periodico avviato (Frequenza: ${intervalMs}ms)`);

    heartbeatInterval = setInterval(async () => {
        if (!bimbySerial || !bimbySerial.isConnected) {
            return;
        }

        // Se la modalità Spiga è in corso, lasciamo che spigaRunner gestisca i suoi impulsi precisi
        if (typeof getSpigaStatus === 'function' && getSpigaStatus().isRunning) {
            return;
        }

        const snapshot = bimbyService.getSnapshot();
        const state = snapshot.value;
        const context = snapshot.context;

        let packet = '';

        // Stati in cui il motore/resistenze possono essere attivi
        if (state === 'cooking' || state === 'starting_motor') {
            const tempHex = toHex(context.targetTemp);
            const speedHex = getSpeedHex(context.targetSpeed);
            const dirHex = context.antiClockwise ? '01' : '00';
            packet = `52 50 ${tempHex} ${speedHex} ${dirHex} 0D`;
        } else {
            // In tutti gli altri stati (idle, locking, unlocking_lid, alarm, error, stopping_motor),
            // invia continuamente il pacchetto di standby a velocità 0 e temperatura 0
            packet = '52 50 00 00 00 0D';
        }

        lastSentPacket = packet;

        try {
            await bimbySerial.write(packet);
        } catch (err) {
            console.warn('💓 [SERIAL HEARTBEAT] Errore scrittura seriale:', err.message);
        }
    }, intervalMs);

    return heartbeatInterval;
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        console.log('🛑 [SERIAL HEARTBEAT] Loop TX fermato.');
    }
}

function getLastSentPacket() {
    return lastSentPacket;
}

module.exports = {
    startHeartbeat,
    stopHeartbeat,
    getLastSentPacket,
    toHex,
    getSpeedHex
};
