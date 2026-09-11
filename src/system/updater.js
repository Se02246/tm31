const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class OtaUpdater extends EventEmitter {
    constructor() {
        super();
        this.status = 'idle'; // 'idle' | 'checking' | 'updating' | 'restarting' | 'success' | 'error' | 'up_to_date'
        this.currentStep = null; // null | 'check' | 'pull' | 'npm_root' | 'build_frontend' | 'restart'
        this.progress = 0;
        this.logs = [];
        this.error = null;
        this.isUpdating = false;
        this.childProcess = null;
        this.projectRoot = path.resolve(__dirname, '../../');
        this.scriptPath = path.resolve(__dirname, '../../scripts/ota_update.sh');
    }

    /**
     * Informazioni sulla versione e sull'ultimo commit git
     */
    getVersionInfo() {
        try {
            const commit = execSync('git rev-parse --short HEAD', { cwd: this.projectRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: this.projectRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            const message = execSync('git log -1 --pretty=format:%s', { cwd: this.projectRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            const date = execSync('git log -1 --pretty=format:%cd --date=short', { cwd: this.projectRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

            return {
                commit,
                branch,
                message,
                date,
                isGitRepo: true
            };
        } catch (err) {
            return {
                commit: 'unknown',
                branch: 'main',
                message: 'Repository Git non rilevato o privo di cronologia',
                date: new Date().toISOString().split('T')[0],
                isGitRepo: false
            };
        }
    }

    /**
     * Verifica la presenza di nuovi commit su origin
     */
    async checkForUpdates(targetBranch = 'main') {
        return new Promise((resolve) => {
            try {
                // Fetch leggero
                execSync(`git fetch origin ${targetBranch} --quiet`, { cwd: this.projectRoot, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
                const localCommit = execSync('git rev-parse HEAD', { cwd: this.projectRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
                const remoteCommit = execSync(`git rev-parse origin/${targetBranch}`, { cwd: this.projectRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

                const updateAvailable = localCommit !== remoteCommit;
                resolve({
                    success: true,
                    updateAvailable,
                    localCommit: localCommit.substring(0, 7),
                    remoteCommit: remoteCommit.substring(0, 7),
                    branch: targetBranch
                });
            } catch (err) {
                resolve({
                    success: false,
                    updateAvailable: false,
                    error: 'Impossibile verificare gli aggiornamenti remoti (Offline o errore di rete)'
                });
            }
        });
    }

    /**
     * Aggiunge un log alla cronologia ed emette l'evento socket
     */
    _addLog(text, type = 'stdout', io = null) {
        if (!text) return;
        const cleanText = text.replace(/\r/g, '').trim();
        if (cleanText.length === 0) return;

        const logEntry = {
            text: cleanText,
            type,
            timestamp: Date.now(),
            step: this.currentStep
        };

        this.logs.push(logEntry);
        if (this.logs.length > 500) {
            this.logs.shift();
        }

        this.emit('log', logEntry);
        if (io) {
            io.emit('OTA_LOG', logEntry);
        }
    }

    /**
     * Aggiorna lo stato ed emette notifica a tutti i client
     */
    _updateStatus(status, step = null, progress = null, error = null, io = null) {
        this.status = status;
        if (step !== null) this.currentStep = step;
        if (progress !== null) this.progress = progress;
        if (error !== null) this.error = error;

        const statusPayload = this.getStatus();
        this.emit('status', statusPayload);
        if (io) {
            io.emit('OTA_STATUS', statusPayload);
        }
    }

    /**
     * Avvia il processo di aggiornamento OTA
     * @param {Object} options - { force: boolean, branch: string, pm2Process: string, io: SocketIO }
     */
    async startUpdate({ force = false, branch = 'main', pm2Process = 'all', io = null } = {}) {
        if (this.isUpdating) {
            const err = new Error('Un aggiornamento OTA è già in corso.');
            err.code = 'UPDATE_ALREADY_RUNNING';
            throw err;
        }

        this.isUpdating = true;
        this.logs = [];
        this.error = null;
        this._updateStatus('updating', 'check', 5, null, io);
        this._addLog(`🚀 [OTA] Avvio procedura di aggiornamento (Branch: ${branch}, Force: ${force})`, 'stdout', io);

        // Se siamo su Windows (ambiente di sviluppo locale) e bash non è disponibile,
        // eseguiamo una procedura simulata o controllata per sviluppo e test
        const isWindows = process.platform === 'win32';
        let bashCmd = 'bash';

        if (isWindows) {
            // Verifica se git bash o bash standard è presente
            const gitBashPaths = [
                'C:\\Program Files\\Git\\bin\\bash.exe',
                'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
            ];
            const foundPath = gitBashPaths.find(p => fs.existsSync(p));
            if (foundPath) {
                bashCmd = foundPath;
            } else {
                try {
                    execSync('where bash', { stdio: 'ignore' });
                } catch (e) {
                    bashCmd = null; // Nessun interprete bash trovato
                }
            }
        }

        if (bashCmd && fs.existsSync(this.scriptPath)) {
            this._runRealScript(bashCmd, { force, branch, pm2Process, io });
        } else {
            console.warn('⚠️ [OTA] Interprete Bash o script non disponibile su questa piattaforma. Avvio emulazione OTA controllata per sviluppo.');
            this._runSimulatedUpdate({ force, branch, io });
        }

        return this.getStatus();
    }

    /**
     * Esecuzione dello script bash reale
     */
    _runRealScript(bashCmd, { force, branch, pm2Process, io }) {
        const env = {
            ...process.env,
            PM2_PROCESS_NAME: pm2Process,
            TARGET_BRANCH: branch,
            FORCE_UPDATE: force ? 'true' : 'false'
        };

        const args = [this.scriptPath];
        if (force) args.push('--force');

        this.childProcess = spawn(bashCmd, args, {
            cwd: this.projectRoot,
            env
        });

        const handleData = (chunk, type) => {
            const text = chunk.toString('utf8');
            const lines = text.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                // Parsing dei tag strutturati
                if (trimmed.includes('[OTA_STEP:CHECK]')) {
                    this._updateStatus('updating', 'check', 15, null, io);
                } else if (trimmed.includes('[OTA_STEP:PULL]')) {
                    this._updateStatus('updating', 'pull', 35, null, io);
                } else if (trimmed.includes('[OTA_STEP:NPM_ROOT]')) {
                    this._updateStatus('updating', 'npm_root', 55, null, io);
                } else if (trimmed.includes('[OTA_STEP:BUILD_FRONTEND]')) {
                    this._updateStatus('updating', 'build_frontend', 75, null, io);
                } else if (trimmed.includes('[OTA_STEP:RESTART]')) {
                    this._updateStatus('restarting', 'restart', 95, null, io);
                } else if (trimmed.includes('[OTA_UP_TO_DATE]')) {
                    this._updateStatus('up_to_date', null, 100, null, io);
                } else if (trimmed.includes('[OTA_SUCCESS]')) {
                    if (this.status !== 'up_to_date' && this.status !== 'restarting') {
                        this._updateStatus('success', null, 100, null, io);
                    }
                } else if (trimmed.includes('[OTA_ERROR]')) {
                    this._updateStatus('error', null, null, trimmed, io);
                }

                this._addLog(trimmed, type, io);
            }
        };

        this.childProcess.stdout.on('data', chunk => handleData(chunk, 'stdout'));
        this.childProcess.stderr.on('data', chunk => handleData(chunk, 'stderr'));

        this.childProcess.on('close', (code) => {
            this.isUpdating = false;
            this.childProcess = null;

            if (code === 0) {
                if (this.status === 'restarting') {
                    this._addLog('🔄 [OTA] Il server si sta riavviando via PM2. Connessione in chiusura...', 'stdout', io);
                } else if (this.status !== 'up_to_date') {
                    this._updateStatus('success', null, 100, null, io);
                    this._addLog('✅ [OTA] Aggiornamento terminato con successo!', 'stdout', io);
                }
            } else {
                const errMsg = this.error || `Processo terminato con codice d'errore ${code}`;
                this._updateStatus('error', null, null, errMsg, io);
                this._addLog(`❌ [OTA] Errore: ${errMsg}`, 'stderr', io);
            }
        });

        this.childProcess.on('error', (err) => {
            this.isUpdating = false;
            this.childProcess = null;
            this._updateStatus('error', null, null, err.message, io);
            this._addLog(`❌ [OTA] Errore esecuzione processo: ${err.message}`, 'stderr', io);
        });
    }

    /**
     * Simulazione per ambienti Windows privi di PM2 o durante i test locali
     */
    async _runSimulatedUpdate({ force, branch, io }) {
        const steps = [
            { step: 'check', progress: 20, delay: 600, log: `[OTA_STEP:CHECK] Controllo commit su origin/${branch}...` },
            { step: 'pull', progress: 40, delay: 800, log: `[OTA_STEP:PULL] Download codice sorgente (git pull)...` },
            { step: 'npm_root', progress: 65, delay: 900, log: `[OTA_STEP:NPM_ROOT] Verifica dipendenze backend Node.js...` },
            { step: 'build_frontend', progress: 85, delay: 1100, log: `[OTA_STEP:BUILD_FRONTEND] Compilazione applicazione React (Vite)...` },
            { step: 'restart', progress: 95, delay: 1000, log: `[OTA_STEP:RESTART] Preparazione riavvio del servizio Node.js...` }
        ];

        for (const s of steps) {
            if (!this.isUpdating) break;
            this._updateStatus(s.step === 'restart' ? 'restarting' : 'updating', s.step, s.progress, null, io);
            this._addLog(s.log, 'stdout', io);
            await new Promise(r => setTimeout(r, s.delay));
        }

        if (this.isUpdating) {
            this.isUpdating = false;
            this._updateStatus('success', null, 100, null, io);
            this._addLog('✅ [OTA] Aggiornamento completato con successo (Modalità dimostrativa/sviluppo).', 'stdout', io);
        }
    }

    getStatus() {
        return {
            isUpdating: this.isUpdating,
            status: this.status,
            currentStep: this.currentStep,
            progress: this.progress,
            error: this.error,
            recentLogs: this.logs.slice(-30)
        };
    }
}

module.exports = new OtaUpdater();
