const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, 'settings.json');

const DEFAULT_SETTINGS = {
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    cookidooZoom: 0.70,
    scaleCalibration: {
        calibrationFactor: 420.0,
        zeroOffset: 8388608,
        knownWeightGrams: 1000,
        lastCalibratedAt: null
    }
};

let cachedSettings = null;

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            cachedSettings = { 
                ...DEFAULT_SETTINGS, 
                ...parsed,
                scaleCalibration: {
                    ...DEFAULT_SETTINGS.scaleCalibration,
                    ...(parsed?.scaleCalibration || {})
                }
            };
            return cachedSettings;
        }
    } catch (err) {
        console.error('[SETTINGS] Errore nella lettura di settings.json:', err.message);
    }
    cachedSettings = { ...DEFAULT_SETTINGS };
    return cachedSettings;
}

function getSettings() {
    if (!cachedSettings) {
        loadSettings();
    }
    return { ...cachedSettings };
}

function saveSettings(newSettings = {}) {
    try {
        const current = getSettings();
        const updated = {
            ...current,
            ...newSettings
        };

        // Assicura che geminiModel sia valido se fornito
        if (newSettings.geminiModel !== undefined) {
            if (typeof newSettings.geminiModel === 'string' && newSettings.geminiModel.trim().length > 0) {
                updated.geminiModel = newSettings.geminiModel.trim();
            } else {
                updated.geminiModel = DEFAULT_SETTINGS.geminiModel;
            }
        }

        // Assicura che cookidooZoom sia un float valido tra 0.3 e 2.0
        if (newSettings.cookidooZoom !== undefined) {
            const z = parseFloat(newSettings.cookidooZoom);
            if (!isNaN(z) && z >= 0.3 && z <= 2.0) {
                updated.cookidooZoom = Math.round(z * 100) / 100;
            } else {
                updated.cookidooZoom = DEFAULT_SETTINGS.cookidooZoom;
            }
        }

        // Gestione e validazione parametri calibrazione bilancia
        if (newSettings.scaleCalibration && typeof newSettings.scaleCalibration === 'object') {
            const currentCalib = current.scaleCalibration || DEFAULT_SETTINGS.scaleCalibration;
            const factor = parseFloat(newSettings.scaleCalibration.calibrationFactor);
            const offset = parseInt(newSettings.scaleCalibration.zeroOffset, 10);
            const known = parseFloat(newSettings.scaleCalibration.knownWeightGrams);

            updated.scaleCalibration = {
                calibrationFactor: (!isNaN(factor) && factor > 0) ? Math.round(factor * 1000) / 1000 : currentCalib.calibrationFactor,
                zeroOffset: !isNaN(offset) ? offset : currentCalib.zeroOffset,
                knownWeightGrams: (!isNaN(known) && known > 0) ? known : (currentCalib.knownWeightGrams || 1000),
                lastCalibratedAt: newSettings.scaleCalibration.lastCalibratedAt || new Date().toISOString()
            };
        }

        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
        cachedSettings = updated;
        console.log('[SETTINGS] Impostazioni salvate su disco:', updated);
        return { ...cachedSettings };
    } catch (err) {
        console.error('[SETTINGS] Errore nel salvataggio di settings.json:', err.message);
        throw err;
    }
}

function getGeminiModel() {
    return getSettings().geminiModel || 'gemini-2.5-flash';
}

function getCookidooZoom() {
    const s = getSettings();
    return typeof s.cookidooZoom === 'number' ? s.cookidooZoom : DEFAULT_SETTINGS.cookidooZoom;
}

function getScaleCalibration() {
    const s = getSettings();
    return s.scaleCalibration || { ...DEFAULT_SETTINGS.scaleCalibration };
}

module.exports = {
    getSettings,
    saveSettings,
    getGeminiModel,
    getCookidooZoom,
    getScaleCalibration,
    DEFAULT_SETTINGS
};
