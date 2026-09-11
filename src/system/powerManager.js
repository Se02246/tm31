const { spawn } = require('child_process');
const { stopSpigaMode } = require('../modes/spigaRunner');
const EventEmitter = require('events');

class PowerManager extends EventEmitter {
    constructor() {
        super();
        this.isProcessing = false;
        this.currentStage = 'idle'; // 'idle' | 'stopping_motor' | 'blade_inertia' | 'unlocking_lid' | 'executing'
    }

    /**
     * Esegue la sequenza di sicurezza completa prima di spegnere o riavviare:
     * 1. Arresto immediato lame e resistenze (52 50 00 00 00 0D + RESET FSM)
     * 2. Attesa inerzia meccanica lame (2 secondi)
     * 3. Sblocco servomotore coperchio (braccia aperte a 0° per non intrappolare il boccale)
     * 4. Esecuzione comando OS (shutdown / reboot / pm2 restart)
     * 
     * @param {Object} options
     * @param {'shutdown' | 'reboot' | 'restart_app'} options.action
     * @param {Object} options.io - Istanza Socket.IO
     * @param {Object} options.bimbyService - Actor XState
     * @param {Object} options.bimbySerial - Driver Seriale TM31
     * @param {Object} options.servo - Driver Servomotore MG996R
     */
    async executePowerAction({ action = 'shutdown', io, bimbyService, bimbySerial, servo }) {
        if (this.isProcessing) {
            const err = new Error('Una procedura di alimentazione/spegnimento è già in corso.');
            err.code = 'POWER_ACTION_ALREADY_IN_PROGRESS';
            throw err;
        }

        this.isProcessing = true;
        console.log(`\n================================================================`);
        console.log(`🔌 [POWER MANAGER] Avvio procedura di sicurezza: ${action.toUpperCase()}`);
        console.log(`================================================================`);

        const emitProgress = (stage, progress, message) => {
            this.currentStage = stage;
            const payload = { stage, progress, message, action };
            this.emit('progress', payload);
            if (io) {
                io.emit('POWER_PROGRESS', payload);
            }
            console.log(`   ► [${progress}%] ${message}`);
        };

        try {
            // -------------------------------------------------------------
            // FASE 1: Arresto immediato del motore e delle resistenze
            // -------------------------------------------------------------
            emitProgress('stopping_motor', 25, 'Arresto immediato lame e resistenze di riscaldamento...');
            
            if (bimbyService && typeof bimbyService.send === 'function') {
                bimbyService.send({ type: 'RESET' });
            }

            if (bimbySerial && typeof bimbySerial.sendCommand === 'function') {
                await bimbySerial.sendCommand('52 50 00 00 00 0D');
            }

            if (typeof stopSpigaMode === 'function') {
                stopSpigaMode(bimbySerial);
            }

            // -------------------------------------------------------------
            // FASE 2: Attesa arresto inerzia meccanica delle lame
            // -------------------------------------------------------------
            emitProgress('blade_inertia', 50, 'Attesa arresto inerzia meccanica lame (2 secondi)...');
            await new Promise((resolve) => setTimeout(resolve, 2000));

            // -------------------------------------------------------------
            // FASE 3: Sblocco servomotore braccia del coperchio (0°)
            // -------------------------------------------------------------
            emitProgress('unlocking_lid', 75, 'Sblocco delle braccia del coperchio (apertura servomotore a 0°)...');
            if (servo && typeof servo.unlock === 'function') {
                await servo.unlock();
                // Breve pausa per completamento corsa meccanica dell'MG996R
                await new Promise((resolve) => setTimeout(resolve, 500));
            }

            // -------------------------------------------------------------
            // FASE 4: Notifica finale ed esecuzione del comando OS
            // -------------------------------------------------------------
            let finalMsg = '';
            if (action === 'shutdown') {
                finalMsg = 'Dispositivo spento in sicurezza. È ora possibile staccare l\'alimentazione.';
            } else if (action === 'reboot') {
                finalMsg = 'Riavvio del sistema in corso...';
            } else {
                finalMsg = 'Riavvio dell\'applicazione in corso...';
            }

            emitProgress('executing', 100, finalMsg);

            // Pausa per consentire a Socket.IO di recapitare l'ultimo pacchetto alla GUI
            await new Promise((resolve) => setTimeout(resolve, 1200));

            console.log(`🔌 [POWER MANAGER] Esecuzione comando operativo: ${action}`);

            const isLinux = process.platform === 'linux';
            const isMock = Boolean(process.env.MOCK === 'true' || require('../config').isMock);

            if (isLinux && !isMock) {
                try {
                    let cmd = 'sudo';
                    let args = ['shutdown', '-h', 'now'];

                    if (action === 'shutdown') {
                        cmd = 'sudo';
                        args = ['shutdown', '-h', 'now'];
                    } else if (action === 'reboot') {
                        cmd = 'sudo';
                        args = ['reboot'];
                    } else if (action === 'restart_app') {
                        cmd = 'pm2';
                        args = ['restart', 'all'];
                    }

                    const proc = spawn(cmd, args, { stdio: 'ignore', detached: true });
                    proc.on('error', (procErr) => {
                        console.warn(`[POWER MANAGER] Comando '${cmd}' non eseguibile o non trovato:`, procErr.message);
                    });
                    proc.unref();
                } catch (procErr) {
                    console.warn(`[POWER MANAGER] Errore esecuzione comando OS:`, procErr.message);
                }
            } else {
                console.log(`💡 [POWER MANAGER] (Modalità Sviluppo/Mock) Comando '${action}' completato in sicurezza senza spegnere il sistema.`);
            }

            this.isProcessing = false;
            return { success: true, action, message: finalMsg };

        } catch (err) {
            this.isProcessing = false;
            console.error('❌ [POWER MANAGER] Errore durante la procedura di alimentazione:', err);
            const errPayload = { stage: 'error', progress: 0, error: err.message, action };
            if (io) io.emit('POWER_PROGRESS', errPayload);
            throw err;
        }
    }

    getStatus() {
        return {
            isProcessing: this.isProcessing,
            currentStage: this.currentStage
        };
    }
}

module.exports = new PowerManager();
