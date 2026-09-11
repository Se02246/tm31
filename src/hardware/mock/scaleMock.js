const { getScaleCalibration, saveSettings } = require('../../config/settingsManager');

class ScaleMock {
    constructor() {
        const calib = getScaleCalibration();
        this.calibrationFactor = calib.calibrationFactor || 420.0;
        this.zeroOffset = calib.zeroOffset || 8388608;
        this.lastCalibratedAt = calib.lastCalibratedAt || null;
        this.knownWeightGrams = calib.knownWeightGrams || 1000;
        
        this.isTared = false;
        // Peso fisico virtuale sul piatto (in grammi)
        this.physicalWeight = 0;
        // Valore grezzo ADC a 24-bit
        this.currentRaw = this.zeroOffset;
        
        console.log(`[MOCK: Scale] Inizializzato (Bilancia HX711, Fattore: ${this.calibrationFactor} ticks/g, Zero: ${this.zeroOffset})`);
    }

    /**
     * Calcola e ritorna il valore grezzo ADC simulato (con leggero rumore se c'è peso)
     */
    getRawValue() {
        // Simula il valore a 24-bit dell'ADC HX711: R = ZeroOffset + (Peso * Fattore)
        const idealRaw = this.zeroOffset + Math.round(this.physicalWeight * this.calibrationFactor);
        // Piccolo rumore realistico di jitter (±1 tick)
        const jitter = Math.floor(Math.random() * 3) - 1;
        this.currentRaw = idealRaw + jitter;
        return this.currentRaw;
    }

    /**
     * Lettura del peso in grammi basata sul valore grezzo e sul fattore di calibrazione
     */
    async read() {
        const raw = this.getRawValue();
        const delta = raw - this.zeroOffset;
        const calculatedGrams = delta / this.calibrationFactor;
        // Se il delta è microscopico o negativo causa rumore, ritorna 0
        const rounded = Math.max(0, Math.round(calculatedGrams * 10) / 10);
        return rounded;
    }

    /**
     * Esegue la tara (azzeramento temporaneo durante la normale pesatura)
     */
    async tare() {
        console.log('[MOCK: Scale] Taratura in corso...');
        return new Promise(resolve => {
            setTimeout(() => {
                this.zeroOffset = this.getRawValue();
                this.physicalWeight = 0;
                this.isTared = true;
                console.log(`[MOCK: Scale] Taratura completata. Nuovo zeroOffset: ${this.zeroOffset}`);
                resolve();
            }, 800);
        });
    }

    /**
     * Procedura di Calibrazione - Fase 1: Registra lo Zero a vuoto
     */
    calibrateZero() {
        this.physicalWeight = 0;
        this.zeroOffset = 8388608 + (Math.floor(Math.random() * 200) - 100);
        this.currentRaw = this.zeroOffset;
        this.isTared = true;

        saveSettings({
            scaleCalibration: {
                calibrationFactor: this.calibrationFactor,
                zeroOffset: this.zeroOffset,
                knownWeightGrams: this.knownWeightGrams,
                lastCalibratedAt: this.lastCalibratedAt
            }
        });

        console.log(`⚖️ [SCALE CALIBRATION] Zero a vuoto acquisito: ${this.zeroOffset}`);
        return {
            success: true,
            zeroOffset: this.zeroOffset,
            rawValue: this.currentRaw
        };
    }

    /**
     * Procedura di Calibrazione - Fase 2: Ricalcola il fattore di calibrazione con peso noto
     * @param {number} knownWeightGrams es. 1000 per 1 kg
     */
    calibrateWithWeight(knownWeightGrams = 1000) {
        const weight = parseFloat(knownWeightGrams);
        if (isNaN(weight) || weight <= 0) {
            throw new Error('Peso campione non valido. Inserire un peso positivo (es. 1000g).');
        }

        this.knownWeightGrams = weight;
        // Nel mock, se il peso virtuale non era impostato, lo impostiamo al peso campione
        if (this.physicalWeight <= 0) {
            this.physicalWeight = weight;
        }

        const rawWithWeight = this.getRawValue();
        const delta = rawWithWeight - this.zeroOffset;

        if (delta <= 0) {
            throw new Error('Nessuna variazione di peso rilevata sul piatto. Assicurati di aver appoggiato il peso noto prima di calibrare.');
        }

        // Calcolo del nuovo fattore di conversione: ticks per grammo
        const newFactor = Math.round((delta / weight) * 1000) / 1000;
        const oldFactor = this.calibrationFactor;
        this.calibrationFactor = newFactor;
        this.lastCalibratedAt = new Date().toISOString();

        // Salvataggio permanente nel backend (settings.json)
        saveSettings({
            scaleCalibration: {
                calibrationFactor: this.calibrationFactor,
                zeroOffset: this.zeroOffset,
                knownWeightGrams: this.knownWeightGrams,
                lastCalibratedAt: this.lastCalibratedAt
            }
        });

        console.log(`⚖️ [SCALE CALIBRATION] Calibrazione completata!`);
        console.log(`   ► Peso Noto           : ${weight} g`);
        console.log(`   ► Delta ADC           : ${delta} ticks`);
        console.log(`   ► Vecchio Fattore     : ${oldFactor} ticks/g`);
        console.log(`   ► Nuovo Fattore       : ${newFactor} ticks/g`);

        return {
            success: true,
            oldFactor,
            newFactor,
            delta,
            zeroOffset: this.zeroOffset,
            rawWithWeight,
            knownWeightGrams: weight,
            lastCalibratedAt: this.lastCalibratedAt
        };
    }

    /**
     * Ripristina la calibrazione di fabbrica
     */
    resetCalibration() {
        this.calibrationFactor = 420.0;
        this.zeroOffset = 8388608;
        this.lastCalibratedAt = null;
        this.knownWeightGrams = 1000;
        this.physicalWeight = 0;

        saveSettings({
            scaleCalibration: {
                calibrationFactor: 420.0,
                zeroOffset: 8388608,
                knownWeightGrams: 1000,
                lastCalibratedAt: null
            }
        });

        console.log(`⚖️ [SCALE CALIBRATION] Ripristinata calibrazione di fabbrica (420.0 ticks/g).`);
        return this.getCalibrationStatus();
    }

    /**
     * Restituisce lo stato corrente di calibrazione e diagnostica
     */
    getCalibrationStatus() {
        const raw = this.getRawValue();
        const delta = raw - this.zeroOffset;
        const weight = Math.max(0, Math.round((delta / this.calibrationFactor) * 10) / 10);

        return {
            success: true,
            calibrationFactor: this.calibrationFactor,
            zeroOffset: this.zeroOffset,
            knownWeightGrams: this.knownWeightGrams,
            lastCalibratedAt: this.lastCalibratedAt,
            currentWeight: weight,
            currentRaw: raw,
            deltaRaw: delta,
            isTared: this.isTared
        };
    }

    // Helper per simulazione e test locali
    addWeight(grams) {
        this.physicalWeight = Math.max(0, parseFloat((this.physicalWeight + grams).toFixed(1)));
        console.log(`[MOCK: Scale] (Test) Aggiunti ${grams} g. Peso fisico virtuale: ${this.physicalWeight} g`);
    }

    setWeight(grams) {
        this.physicalWeight = Math.max(0, parseFloat(grams.toFixed(1)));
        console.log(`[MOCK: Scale] (Test) Impostato peso fisico virtuale a: ${this.physicalWeight} g`);
    }
}

module.exports = new ScaleMock();
