const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Gestore dei microinterruttori fisici di sicurezza (Interlock) del Bimby TM31:
 * - Microswitch Boccale (Bowl Present Switch) - Default GPIO 24
 * - Microswitch Coperchio / Braccia bloccate (Lid Locked Switch) - Default GPIO 23
 * 
 * Su Raspberry Pi, i microinterruttori sono collegati tra GPIO e GND con pull-up interno.
 * Circuito chiuso (boccale inserito / coperchio serrato) = livello logico LOW (0).
 * In modalità MOCK / Windows / Docker, supporta la simulazione interattiva di guasto/ostacolo.
 */
class InterlockManager extends EventEmitter {
    constructor() {
        super();
        this.gpioLidPin = parseInt(process.env.GPIO_INTERLOCK_LID || '23', 10);
        this.gpioBowlPin = parseInt(process.env.GPIO_INTERLOCK_BOWL || '24', 10);

        this.isLinux = process.platform === 'linux';
        this.isHardwareAvailable = false;

        // Parametri di simulazione (per sviluppo e test)
        this.mockBowlPresent = true;
        this.mockLidLocked = false; // Diventa true solo quando il servo è a 90° e non c'è ostacolo
        this.simulateObstacle = false; // Se true, simula ostacolo/coperchio fuori sede
        this.simulateBowlMissing = false; // Se true, simula boccale rimosso

        this._initHardware();
        console.log(`🔒 [INTERLOCK] Inizializzato (Hardware Pi: ${this.isHardwareAvailable ? 'ATTIVO' : 'SIMULATO/MOCK'})`);
        console.log(`   ► Pin Microswitch Coperchio : GPIO ${this.gpioLidPin}`);
        console.log(`   ► Pin Microswitch Boccale   : GPIO ${this.gpioBowlPin}`);
    }

    _initHardware() {
        if (!this.isLinux || config.isMock) {
            this.isHardwareAvailable = false;
            return;
        }

        try {
            // Verifica se sysfs GPIO è disponibile
            if (fs.existsSync('/sys/class/gpio')) {
                this._exportGpioPin(this.gpioLidPin);
                this._exportGpioPin(this.gpioBowlPin);
                this.isHardwareAvailable = true;
                console.log('🔒 [INTERLOCK] Accesso GPIO sysfs Linux configurato con successo');
            }
        } catch (err) {
            console.warn(`🔒 [INTERLOCK] Impossibile inizializzare GPIO hardware: ${err.message}. Uso modalità mock.`);
            this.isHardwareAvailable = false;
        }
    }

    _exportGpioPin(pin) {
        const pinPath = `/sys/class/gpio/gpio${pin}`;
        if (!fs.existsSync(pinPath)) {
            try {
                fs.writeFileSync('/sys/class/gpio/export', String(pin), 'utf-8');
            } catch (e) {}
        }
        try {
            const dirPath = path.join(pinPath, 'direction');
            if (fs.existsSync(dirPath)) {
                fs.writeFileSync(dirPath, 'in', 'utf-8');
            }
        } catch (e) {}
    }

    _readGpioPin(pin) {
        const valPath = `/sys/class/gpio/gpio${pin}/value`;
        if (fs.existsSync(valPath)) {
            const val = fs.readFileSync(valPath, 'utf-8').trim();
            // Contatto normalmente aperto con pull-up: premuto/chiuso = '0'
            return val === '0';
        }
        return false;
    }

    /**
     * Verifica se il boccale in acciaio è alloggiato nella base
     * @returns {boolean}
     */
    isBowlPresent() {
        if (this.simulateBowlMissing) {
            return false;
        }
        if (this.isHardwareAvailable) {
            try {
                return this._readGpioPin(this.gpioBowlPin);
            } catch (e) {
                return false;
            }
        }
        return this.mockBowlPresent;
    }

    /**
     * Verifica se il coperchio è posizionato e le braccia sono bloccate a finecorsa
     * @returns {boolean}
     */
    isLidLocked() {
        if (this.simulateObstacle) {
            return false;
        }
        if (this.isHardwareAvailable) {
            try {
                return this._readGpioPin(this.gpioLidPin);
            } catch (e) {
                return false;
            }
        }
        return this.mockLidLocked;
    }

    /**
     * Notifica interna chiamata dal servo quando si muove
     * @param {boolean} locked 
     */
    notifyServoLocked(locked) {
        // Se non c'è ostacolo simulato, lo stato del micro riflette la posizione del servo
        this.mockLidLocked = Boolean(locked) && !this.simulateObstacle;
        this.emitStateChange();
    }

    /**
     * Esegue una verifica completa di sicurezza prima di azionare il motore
     * @returns {{ ok: boolean, bowlPresent: boolean, lidLocked: boolean, error?: string }}
     */
    checkSafetyInterlock() {
        const bowl = this.isBowlPresent();
        const lid = this.isLidLocked();

        if (!bowl) {
            return {
                ok: false,
                bowlPresent: false,
                lidLocked: lid,
                error: 'BOWL_NOT_PRESENT'
            };
        }

        if (!lid) {
            return {
                ok: false,
                bowlPresent: true,
                lidLocked: false,
                error: 'LID_NOT_LOCKED'
            };
        }

        return {
            ok: true,
            bowlPresent: true,
            lidLocked: true
        };
    }

    /**
     * Configura i parametri di simulazione per test ed esperimenti
     */
    setSimulationOptions({ simulateObstacle, simulateBowlMissing }) {
        if (typeof simulateObstacle === 'boolean') {
            this.simulateObstacle = simulateObstacle;
            if (simulateObstacle) {
                this.mockLidLocked = false;
            }
            console.log(`🔒 [INTERLOCK] Simulazione ostacolo coperchio: ${this.simulateObstacle ? 'ATTIVA (Ostacolo)' : 'DISATTIVATA'}`);
        }

        if (typeof simulateBowlMissing === 'boolean') {
            this.simulateBowlMissing = simulateBowlMissing;
            console.log(`🔒 [INTERLOCK] Simulazione boccale assente: ${this.simulateBowlMissing ? 'ATTIVA (Boccale Assente)' : 'DISATTIVATA'}`);
        }

        this.emitStateChange();
        return this.getStatus();
    }

    emitStateChange() {
        const status = this.getStatus();
        this.emit('state_change', status);
        if (!status.bowlPresent || !status.lidLocked) {
            this.emit('interlock_lost', status);
        }
    }

    getStatus() {
        return {
            bowlPresent: this.isBowlPresent(),
            lidLocked: this.isLidLocked(),
            isHardwareAvailable: this.isHardwareAvailable,
            simulateObstacle: this.simulateObstacle,
            simulateBowlMissing: this.simulateBowlMissing
        };
    }
}

const interlockManager = new InterlockManager();
module.exports = interlockManager;
