const config = require('../config');
const interlockManager = require('./interlockManager');
const piezoBuzzer = require('./piezoBuzzer');

let scale, servo, bimbySerial;

if (config.isMock) {
    console.log('[HARDWARE FACTORY] Caricamento moduli MOCK (Sviluppo Locale)');
    scale = require('./mock/scaleMock');
    servo = require('./mock/servoMock');
    bimbySerial = require('./mock/bimbySerialMock');
} else {
    console.log('[HARDWARE FACTORY] Caricamento moduli REALI (Raspberry Pi)');
    try {
        bimbySerial = require('./real/bimbySerial');
    } catch (err) {
        console.warn('[HARDWARE FACTORY] Impossibile caricare bimbySerial reale, fallback su mock:', err.message);
        bimbySerial = require('./mock/bimbySerialMock');
    }
    // Scale e servo reali verranno agganciati qui quando disponibili sul Raspberry:
    scale = require('./mock/scaleMock');
    servo = require('./mock/servoMock');
}

module.exports = {
    scale,
    servo,
    bimbySerial,
    interlock: interlockManager,
    piezoBuzzer
};
