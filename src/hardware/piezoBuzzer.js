const config = require('../config');

class PiezoBuzzer {
    constructor(pin = 18) {
        this.pin = parseInt(process.env.BUZZER_PIN, 10) || pin;
        this.isMock = Boolean(config.isMock);
        this.gpio = null;
        this.isPlaying = false;
        this.currentFrequency = 0;
        this.activeMode = null; // 'tone' | 'timer_done' | 'beep' | null
        this.sequenceTimeout = null;
        this.toneTimeout = null;

        this._initHardware();
    }

    _initHardware() {
        if (!this.isMock) {
            try {
                const { Gpio } = require('pigpio');
                this.gpio = new Gpio(this.pin, { mode: Gpio.OUTPUT });
                // Assicura che sia spento all'avvio
                this.gpio.hardwarePwm(0, 0);
                console.log(`🔊 [BUZZER] Inizializzato driver hardware pigpio su GPIO ${this.pin} (Hardware PWM0)`);
            } catch (err) {
                console.warn(`🔊 [BUZZER] Libreria 'pigpio' non disponibile o ambiente non-Pi (${err.message}). Fallback su MOCK.`);
                this.isMock = true;
                this.gpio = null;
            }
        } else {
            console.log(`🔊 [BUZZER] Modalità MOCK attiva su GPIO ${this.pin} (Sviluppo Locale)`);
        }
    }

    /**
     * Riproduce un'onda quadra alla frequenza specificata
     * @param {number} frequency Frequenza in Hertz (es. 2500)
     * @param {number} [duration] Durata in millisecondi (opzionale)
     */
    playTone(frequency, duration = null) {
        if (!frequency || frequency <= 0) {
            this.stop();
            return;
        }

        this.currentFrequency = Math.round(frequency);
        this.isPlaying = true;

        if (this.gpio && !this.isMock) {
            try {
                // hardwarePwm(frequency, dutyCycle): dutyCycle da 0 a 1000000 (500000 = 50% square wave)
                this.gpio.hardwarePwm(this.currentFrequency, 500000);
            } catch (err) {
                console.error(`🔊 [BUZZER] Errore hardwarePwm su GPIO ${this.pin}:`, err.message);
            }
        } else {
            console.log(`🎵 [BUZZER] Beep a ${this.currentFrequency}Hz${duration ? ` (${duration}ms)` : ''}`);
        }

        if (this.toneTimeout) {
            clearTimeout(this.toneTimeout);
            this.toneTimeout = null;
        }

        if (typeof duration === 'number' && duration > 0) {
            this.toneTimeout = setTimeout(() => {
                this.toneTimeout = null;
                // Spegni il tono solo se non è stata avviata un'altra sequenza nel frattempo
                if (this.activeMode === 'tone' || this.activeMode === 'beep') {
                    this._silencePin();
                    this.isPlaying = false;
                    this.activeMode = null;
                }
            }, duration);
        }
    }

    /**
     * Silenzia immediatamente il pin PWM
     */
    _silencePin() {
        this.currentFrequency = 0;
        if (this.gpio && !this.isMock) {
            try {
                this.gpio.hardwarePwm(0, 0);
            } catch (err) {
                console.error(`🔊 [BUZZER] Errore spegnimento PWM:`, err.message);
            }
        }
    }

    /**
     * Silenzia e interrompe qualsiasi tono o sequenza attiva
     */
    stop() {
        if (this.sequenceTimeout) {
            clearTimeout(this.sequenceTimeout);
            this.sequenceTimeout = null;
        }
        if (this.toneTimeout) {
            clearTimeout(this.toneTimeout);
            this.toneTimeout = null;
        }

        this._silencePin();
        const wasPlaying = this.isPlaying;
        this.isPlaying = false;
        this.activeMode = null;

        if (wasPlaying) {
            console.log('🔇 [BUZZER] Buzzer silenziato.');
        }
    }

    /**
     * Singolo beep rapido (es. feedback tocco o rotella)
     * @param {number} [frequency=2500] 
     * @param {number} [duration=100] 
     */
    beep(frequency = 2500, duration = 100) {
        this.activeMode = 'beep';
        this.playTone(frequency, duration);
    }

    /**
     * Riproduce il classico jingle del Bimby TM31 a fine timer:
     * Serie di 3 beep acuti a 2500 Hz (200ms ON, 100ms OFF) seguiti da 1000ms di silenzio,
     * ripetuti ciclicamente finché non viene chiamato stop().
     */
    playTimerDone() {
        this.stop(); // Ferma eventuali toni pendenti
        this.isPlaying = true;
        this.activeMode = 'timer_done';

        console.log('🔔 [BUZZER] Avvio jingle fine cottura TM31 (ciclo continuo)...');

        const BEEP_FREQ = 2500;
        const BEEP_DURATION = 200; // ms di suono
        const PAUSE_SHORT = 100;   // ms tra un beep e l'altro
        const PAUSE_LONG = 1000;   // ms di pausa alla fine dei 3 beep prima del ciclo successivo

        const runCycle = () => {
            if (!this.isPlaying || this.activeMode !== 'timer_done') return;

            // Beep 1
            this.playTone(BEEP_FREQ, BEEP_DURATION);

            this.sequenceTimeout = setTimeout(() => {
                if (!this.isPlaying || this.activeMode !== 'timer_done') return;
                this._silencePin();

                // Beep 2
                this.sequenceTimeout = setTimeout(() => {
                    if (!this.isPlaying || this.activeMode !== 'timer_done') return;
                    this.playTone(BEEP_FREQ, BEEP_DURATION);

                    this.sequenceTimeout = setTimeout(() => {
                        if (!this.isPlaying || this.activeMode !== 'timer_done') return;
                        this._silencePin();

                        // Beep 3
                        this.sequenceTimeout = setTimeout(() => {
                            if (!this.isPlaying || this.activeMode !== 'timer_done') return;
                            this.playTone(BEEP_FREQ, BEEP_DURATION);

                            this.sequenceTimeout = setTimeout(() => {
                                if (!this.isPlaying || this.activeMode !== 'timer_done') return;
                                this._silencePin();

                                // Pausa lunga prima del prossimo ciclo di 3 beep
                                this.sequenceTimeout = setTimeout(() => {
                                    if (this.isPlaying && this.activeMode === 'timer_done') {
                                        runCycle();
                                    }
                                }, PAUSE_LONG);

                            }, BEEP_DURATION);
                        }, PAUSE_SHORT);

                    }, BEEP_DURATION);
                }, PAUSE_SHORT);

            }, BEEP_DURATION);
        };

        runCycle();
    }

    /**
     * Restituisce lo stato attuale del modulo buzzer
     */
    getStatus() {
        return {
            isPlaying: this.isPlaying,
            activeMode: this.activeMode,
            currentFrequency: this.currentFrequency,
            pin: this.pin,
            isMock: this.isMock
        };
    }
}

const piezoBuzzer = new PiezoBuzzer();
module.exports = piezoBuzzer;
