const fs = require('fs');
const path = require('path');
const { getDimmingSettings } = require('../config/settingsManager');

class BacklightManager {
    constructor() {
        this.backlightPath = this._detectBacklight();
        this.maxBrightness = this._getMaxBrightness();
        this.isDimmed = false;
        console.log(`💡 [BACKLIGHT] Inizializzato. Path hardware: ${this.backlightPath || 'MOCK/Non rilevato'}`);
    }

    _detectBacklight() {
        const candidates = [
            '/sys/class/backlight/rpi_backlight',
            '/sys/class/backlight/10-0045',
            '/sys/class/backlight/backlight'
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) return p;
        }
        if (fs.existsSync('/sys/class/backlight')) {
            try {
                const files = fs.readdirSync('/sys/class/backlight');
                if (files.length > 0) {
                    return path.join('/sys/class/backlight', files[0]);
                }
            } catch (e) {}
        }
        return null;
    }

    _getMaxBrightness() {
        if (!this.backlightPath) return 255;
        try {
            const maxPath = path.join(this.backlightPath, 'max_brightness');
            if (fs.existsSync(maxPath)) {
                return parseInt(fs.readFileSync(maxPath, 'utf-8').trim(), 10) || 255;
            }
        } catch (e) {}
        return 255;
    }

    setDimmed(dimmed, percentage = null) {
        this.isDimmed = Boolean(dimmed);
        const configDim = getDimmingSettings();
        const pct = (typeof percentage === 'number' && percentage >= 5 && percentage <= 90)
            ? percentage
            : (configDim?.dimPercentage || 15);

        if (this.backlightPath) {
            try {
                // Attenua la luminosità hardware alla percentuale specificata del massimo
                const targetValue = this.isDimmed 
                    ? Math.max(5, Math.round(this.maxBrightness * (pct / 100))) 
                    : this.maxBrightness;
                const brightnessFile = path.join(this.backlightPath, 'brightness');
                fs.writeFileSync(brightnessFile, String(targetValue), 'utf-8');
                console.log(`💡 [BACKLIGHT] Luminosità hardware impostata a: ${targetValue}/${this.maxBrightness} (${this.isDimmed ? pct + '%' : '100%'})`);
            } catch (err) {
                console.warn(`💡 [BACKLIGHT] Impossibile scrivere su brightness: ${err.message}`);
            }
        } else {
            console.log(`💡 [BACKLIGHT] Modalità simulata: Schermo ${this.isDimmed ? `ATTENUATO (${pct}%)` : 'ATTIVO (100%)'}`);
        }
        return { 
            isDimmed: this.isDimmed, 
            maxBrightness: this.maxBrightness,
            dimPercentage: pct,
            enabled: configDim?.enabled !== false,
            timeoutSeconds: configDim?.timeoutSeconds || 300
        };
    }

    getStatus() {
        const configDim = getDimmingSettings();
        return {
            isDimmed: this.isDimmed,
            hasHardwareBacklight: Boolean(this.backlightPath),
            maxBrightness: this.maxBrightness,
            dimPercentage: configDim?.dimPercentage || 15,
            enabled: configDim?.enabled !== false,
            timeoutSeconds: configDim?.timeoutSeconds || 300
        };
    }
}

const backlightManager = new BacklightManager();
module.exports = backlightManager;
