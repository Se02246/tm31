const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const { createActor } = require('xstate');
const { bimbyMachine } = require('./fsm/machine');
const { bimbySerial, scale, servo, interlock, piezoBuzzer } = require('./hardware/hardwareFactory');
const { startSpigaMode, stopSpigaMode, getSpigaStatus } = require('./modes/spigaRunner');
const { startHeartbeat } = require('./hardware/serialHeartbeat');
const { parseRecipeStep, parseFullRecipeSteps, parseRecipeFromHtml } = require('./recipe/geminiParser');
const { recipeManager } = require('./recipe/recipeManager');
const { getSettings, saveSettings } = require('./config/settingsManager');
const { scanNetworks, getCurrentConnection, connectToNetwork, disconnectNetwork } = require('./network/wifiManager');
const backlightManager = require('./hardware/backlightManager');
const updater = require('./system/updater');
const powerManager = require('./system/powerManager');
const config = require('./config');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));

// Servi i file statici del frontend compilato con no-cache per HTML
app.use(express.static(path.join(__dirname, '../public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Servi lo script injector per Cookidoo (Tampermonkey, Electron preload, estensioni)
app.get('/cookidoo-injector.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.sendFile(path.join(__dirname, 'recipe/cookidoo-injector.js'));
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Sincronizzazione automatica dello stato della ricetta su tutti i client
recipeManager.on('state_change', (recipeState) => {
    io.emit('RECIPE_STATE', recipeState);
});

const bimbyService = createActor(bimbyMachine);
bimbyService.start();

// Inoltro pacchetti seriali TX/RX ai client e aggiornamento temperatura reale NTC
if (bimbySerial && typeof bimbySerial.on === 'function') {
    bimbySerial.on('tx', (txData) => {
        io.emit('SERIAL_TX', txData);
    });

    bimbySerial.on('rx_frame', (frameHex) => {
        io.emit('SERIAL_RX', frameHex);
    });

    bimbySerial.on('temperature', (realTemp) => {
        // Aggiorna la temperatura reale nel context XState
        bimbyService.send({ type: 'UPDATE_REAL_TEMP', value: realTemp });
    });
}

// Avvia il loop Heartbeat TX (polling continuo 250ms) per la scheda di potenza
startHeartbeat(bimbyService, bimbySerial, 250);

// Monitoraggio continuo di sicurezza: arresto istantaneo se l'interlock si apre durante la lavorazione
interlock.on('interlock_lost', (status) => {
    const snapshot = bimbyService.getSnapshot();
    const currentState = snapshot.value;

    if (currentState === 'cooking' || currentState === 'starting_motor') {
        // In modalità mock / sviluppo, scatta l'arresto di emergenza SOLO se è stata richiesta esplicitamente una simulazione
        if (config.isMock && !status.simulateObstacle && !status.simulateBowlMissing) {
            return;
        }

        console.error('🚨 [EMERGENCY STOP] INTERLOCK APERTO DURANTE IL FUNZIONAMENTO! Arresto immediato lame...');
        // Arresto hardware immediato sul bus seriale
        bimbySerial.sendCommand('52 50 00 00 00 0D');
        const code = !status.bowlPresent ? 'BOWL_NOT_PRESENT' : 'LID_NOT_LOCKED';
        const message = !status.bowlPresent 
            ? 'Boccale rimosso o disallineato durante la lavorazione!' 
            : 'Coperchio aperto o sbloccato durante la rotazione delle lame!';
            
        bimbyService.send({
            type: 'INTERLOCK_TRIPPED',
            code,
            message
        });
        io.emit('INTERLOCK_ALERT', {
            type: 'EMERGENCY_STOP',
            code,
            message
        });
    }
});

interlock.on('state_change', (status) => {
    io.emit('INTERLOCK_STATE', status);
});

let previousState = null;
let previousMode = null;

bimbyService.subscribe((snapshot) => {
    const currentState = snapshot.value;
    const currentMode = snapshot.context.mode;

    io.emit('state', {
        value: snapshot.value,
        context: snapshot.context,
        spigaPhase: getSpigaStatus().phase
    });

    if (currentState === 'cooking' && currentMode === 'spiga') {
        if (previousState !== 'cooking' || previousMode !== 'spiga') {
            startSpigaMode(bimbySerial, (phase) => {
                io.emit('spiga_phase', phase);
            });
        }
    } else {
        if (getSpigaStatus().isRunning) {
            stopSpigaMode(bimbySerial);
            io.emit('spiga_phase', 'IDLE');
        }
    }

    // Quando la cottura termina ed entra nello stato ALARM, avvia il buzzer TM31, notifica la ricetta guidata e riattiva lo schermo
    if (currentState === 'alarm' && previousState !== 'alarm') {
        if (backlightManager.getStatus().isDimmed) {
            backlightManager.setDimmed(false);
            io.emit('SCREEN_DIMMED_STATE', backlightManager.getStatus());
        }
        piezoBuzzer.playTimerDone();
        if (recipeManager.hasActiveRecipe()) {
            recipeManager.setStepCompleted(true);
            io.emit('STEP_COMPLETED', {
                currentStepIndex: recipeManager.currentStepIndex,
                step: recipeManager.getCurrentStep()
            });
        }
    } else if (previousState === 'alarm' && currentState !== 'alarm') {
        piezoBuzzer.stop();
    } else if (previousState === 'cooking' && currentState !== 'cooking' && currentState !== 'alarm') {
        // Se la macchina si arresta prima del tempo (es. stop fisico o rotella a zero)
        if (recipeManager.hasActiveRecipe() && recipeManager.isStepRunning) {
            const remaining = snapshot.context.targetTime || 0;
            recipeManager.pauseStep(remaining);
        }
    }

    previousState = currentState;
    previousMode = currentMode;
});


let lastTimeModification = 0;

// Countdown del timer di cottura (1 secondo)
setInterval(() => {
    const snapshot = bimbyService.getSnapshot();
    
    if (snapshot.value === 'cooking') {
        // Timer (aspetta 1 secondo dall'ultima modifica manuale prima di riprendere a scorrere)
        if (snapshot.context.targetTime > 0 && Date.now() - lastTimeModification >= 1000) {
            const nextTime = snapshot.context.targetTime - 1;
            bimbyService.send({ type: 'SET_TIME', value: nextTime });
            if (nextTime === 0) {
                stopSpigaMode(bimbySerial);
                io.emit('spiga_phase', 'IDLE');
                bimbyService.send({ type: 'TIME_UP' });
            }
        }
    }
}, 1000);

io.on('connection', async (socket) => {
    console.log('[SOCKET] Nuovo display connesso:', socket.id);
    
    if (!bimbySerial.isConnected) {
        await bimbySerial.connect();
    }

    socket.emit('state', {
        value: bimbyService.getSnapshot().value,
        context: bimbyService.getSnapshot().context,
        spigaPhase: getSpigaStatus().phase
    });

    // Invia stato attenuazione display iniziale
    socket.emit('SCREEN_DIMMED_STATE', backlightManager.getStatus());

    // Invia stato interlock iniziale
    socket.emit('INTERLOCK_STATE', interlock.getStatus());

    // Invia stato aggiornamento software OTA iniziale
    socket.emit('OTA_STATUS', updater.getStatus());

    // Trigger aggiornamento OTA da socket
    socket.on('START_OTA_UPDATE', async (payload, callback) => {
        try {
            const status = await updater.startUpdate({
                force: Boolean(payload?.force),
                branch: payload?.branch || 'main',
                pm2Process: payload?.pm2Process || 'all',
                io
            });
            if (typeof callback === 'function') callback({ success: true, status });
        } catch (err) {
            if (typeof callback === 'function') callback({ success: false, error: err.message });
        }
    });

    socket.on('GET_OTA_STATUS', (callback) => {
        const status = updater.getStatus();
        if (typeof callback === 'function') callback(status);
        else socket.emit('OTA_STATUS', status);
    });

    // Gestione comando spegnimento/riavvio di sicurezza da socket
    socket.on('SYSTEM_POWER_COMMAND', async (data, callback) => {
        try {
            const action = data?.action || 'shutdown';
            const result = await powerManager.executePowerAction({
                action,
                io,
                bimbyService,
                bimbySerial,
                servo
            });
            if (typeof callback === 'function') callback({ success: true, ...result });
        } catch (err) {
            if (typeof callback === 'function') callback({ success: false, error: err.message });
        }
    });

    // Impostazione attenuazione display da socket
    socket.on('SET_SCREEN_DIMMED', (data) => {
        const dimmed = Boolean(data && (data.dimmed !== undefined ? data.dimmed : data.isDimmed));
        const pct = (data && data.dimPercentage !== undefined) ? Number(data.dimPercentage) : null;
        const status = backlightManager.setDimmed(dimmed, pct);
        io.emit('SCREEN_DIMMED_STATE', status);
    });

    // Richiesta stato attenuazione display
    socket.on('GET_SCREEN_DIMMED', (callback) => {
        const status = backlightManager.getStatus();
        if (typeof callback === 'function') {
            callback(status);
        } else {
            socket.emit('SCREEN_DIMMED_STATE', status);
        }
    });

    // Richiesta e configurazione stato simulazione interlock da socket
    socket.on('GET_INTERLOCK_STATE', (callback) => {
        const status = interlock.getStatus();
        if (typeof callback === 'function') callback(status);
        else socket.emit('INTERLOCK_STATE', status);
    });

    socket.on('SET_INTERLOCK_MOCK', (data) => {
        const updated = interlock.setSimulationOptions(data || {});
        io.emit('INTERLOCK_STATE', updated);
    });

    socket.on('CMD', (payload) => {
        if (payload.type === 'ACK_ALARM' || payload.type === 'STOP' || payload.type === 'RESET') {
            piezoBuzzer.stop();
        }

        if (backlightManager.getStatus().isDimmed) {
            backlightManager.setDimmed(false);
            io.emit('SCREEN_DIMMED_STATE', backlightManager.getStatus());
        }

        if (payload.type === 'SET_TIME' || payload.type === 'RESET' || payload.type === 'STOP') {
            lastTimeModification = Date.now();
        }

        if (payload.type === 'STOP' || payload.type === 'RESET') {
            stopSpigaMode(bimbySerial);
            io.emit('spiga_phase', 'IDLE');
        }

        if (payload.type === 'START_SPIGA') {
            const currentTemp = bimbyService.getSnapshot().context.currentTemp || 20;
            if (currentTemp > 50) {
                console.warn(`[SPIGA] Blocco termico attivo: temperatura ${currentTemp}°C > 50°C`);
                socket.emit('SPIGA_ERROR', { code: 'TEMP_TOO_HIGH', message: 'Temperatura boccale superiore a 50°C' });
                return;
            }
            lastTimeModification = Date.now();
            bimbyService.send({
                type: 'START_SPIGA',
                time: payload.time || 120
            });
            return;
        }

        bimbyService.send(payload);
    });

    // Inoltro eventi hardware rotella encoder (con risveglio schermo)
    socket.on('KNOB_TURN', (data) => {
        if (backlightManager.getStatus().isDimmed) {
            backlightManager.setDimmed(false);
            io.emit('SCREEN_DIMMED_STATE', backlightManager.getStatus());
        }
        io.emit('KNOB_TURN', data);
    });

    // Inoltro eventi tasto fisico / click manopola (con risveglio schermo e spegnimento allarme)
    socket.on('PHYSICAL_BUTTON', (data) => {
        if (bimbyService.getSnapshot().value === 'alarm') {
            piezoBuzzer.stop();
        }
        if (backlightManager.getStatus().isDimmed) {
            backlightManager.setDimmed(false);
            io.emit('SCREEN_DIMMED_STATE', backlightManager.getStatus());
        }
        io.emit('PHYSICAL_BUTTON', data);
    });

    // Test manuale buzzer da socket
    socket.on('BUZZER_TEST', (data) => {
        const action = data?.action || 'beep';
        if (action === 'timer_done') piezoBuzzer.playTimerDone();
        else if (action === 'stop') piezoBuzzer.stop();
        else piezoBuzzer.beep(Number(data?.frequency) || 2500, Number(data?.duration) || 100);
    });

    // Eventi Bilancia (HX711 / Mock)
    socket.on('SCALE_READ', async () => {
        try {
            if (scale) {
                const weight = await scale.read();
                socket.emit('SCALE_WEIGHT', { weight, isTared: scale.isTared });
            }
        } catch (err) {
            console.error('[SOCKET] Errore lettura bilancia:', err);
        }
    });

    socket.on('SCALE_TARE', async () => {
        try {
            if (scale) {
                await scale.tare();
                const weight = await scale.read();
                io.emit('SCALE_WEIGHT', { weight, isTared: true });
            }
        } catch (err) {
            console.error('[SOCKET] Errore tara bilancia:', err);
        }
    });

    socket.on('SCALE_ADD_WEIGHT', async (payload) => {
        try {
            if (scale && typeof scale.addWeight === 'function') {
                const grams = Number(payload?.grams) || 0;
                scale.addWeight(grams);
                const weight = await scale.read();
                io.emit('SCALE_WEIGHT', { weight, isTared: scale.isTared });
            }
        } catch (err) {
            console.error('[SOCKET] Errore addWeight bilancia:', err);
        }
    });

    socket.on('SCALE_SET_WEIGHT', async (payload) => {
        try {
            if (scale && typeof scale.setWeight === 'function') {
                const grams = Number(payload?.grams) || 0;
                scale.setWeight(grams);
                const weight = await scale.read();
                io.emit('SCALE_WEIGHT', { weight, isTared: scale.isTared });
            }
        } catch (err) {
            console.error('[SOCKET] Errore setWeight bilancia:', err);
        }
    });

    // =============================================
    // EVENTI SOCKET CALIBRAZIONE BILANCIA (HX711)
    // =============================================
    
    // Richiesta stato calibrazione corrente
    socket.on('SCALE_GET_CALIBRATION', (callback) => {
        try {
            if (scale && typeof scale.getCalibrationStatus === 'function') {
                const status = scale.getCalibrationStatus();
                if (typeof callback === 'function') callback(status);
                else socket.emit('SCALE_CALIBRATION_STATUS', status);
            }
        } catch (err) {
            console.error('[SOCKET] Errore getCalibrationStatus bilancia:', err);
            if (typeof callback === 'function') callback({ error: err.message });
        }
    });

    // Fase 1: Zero a vuoto per calibrazione
    socket.on('SCALE_CALIBRATE_ZERO', (callback) => {
        try {
            if (scale && typeof scale.calibrateZero === 'function') {
                const res = scale.calibrateZero();
                io.emit('SCALE_CALIBRATION_UPDATED', scale.getCalibrationStatus());
                if (typeof callback === 'function') callback(res);
            }
        } catch (err) {
            console.error('[SOCKET] Errore calibrateZero bilancia:', err);
            if (typeof callback === 'function') callback({ error: err.message });
        }
    });

    // Fase 2: Calibrazione con peso noto
    socket.on('SCALE_CALIBRATE_WEIGHT', (payload, callback) => {
        try {
            if (scale && typeof scale.calibrateWithWeight === 'function') {
                const knownWeight = Number(payload?.knownWeight) || 1000;
                const res = scale.calibrateWithWeight(knownWeight);
                io.emit('SCALE_CALIBRATION_UPDATED', scale.getCalibrationStatus());
                if (typeof callback === 'function') callback(res);
            }
        } catch (err) {
            console.error('[SOCKET] Errore calibrateWithWeight bilancia:', err);
            if (typeof callback === 'function') callback({ error: err.message });
        }
    });

    // Reset calibrazione di fabbrica
    socket.on('SCALE_CALIBRATE_RESET', (callback) => {
        try {
            if (scale && typeof scale.resetCalibration === 'function') {
                const res = scale.resetCalibration();
                io.emit('SCALE_CALIBRATION_UPDATED', res);
                if (typeof callback === 'function') callback(res);
            }
        } catch (err) {
            console.error('[SOCKET] Errore resetCalibration bilancia:', err);
            if (typeof callback === 'function') callback({ error: err.message });
        }
    });

    // Streaming ad alta frequenza durante la pagina di calibrazione (150ms)
    let calibrationStreamInterval = null;
    socket.on('SCALE_START_STREAM', () => {
        if (calibrationStreamInterval) clearInterval(calibrationStreamInterval);
        calibrationStreamInterval = setInterval(() => {
            if (scale && typeof scale.getCalibrationStatus === 'function') {
                socket.emit('SCALE_LIVE_CALIBRATION', scale.getCalibrationStatus());
            }
        }, 150);
    });

    socket.on('SCALE_STOP_STREAM', () => {
        if (calibrationStreamInterval) {
            clearInterval(calibrationStreamInterval);
            calibrationStreamInterval = null;
        }
    });

    socket.on('disconnect', () => {
        if (calibrationStreamInterval) {
            clearInterval(calibrationStreamInterval);
            calibrationStreamInterval = null;
        }
    });

    // =============================================
    // EVENTI SOCKET PER RICETTE GUIDATE
    // =============================================

    // Invia subito lo stato della ricetta al client appena connesso
    socket.emit('RECIPE_STATE', recipeManager.getState());

    // Se c'è un ripristino ricetta in sospeso dopo un blackout/riavvio, notifica subito il client
    const pendingRecovery = recipeManager.getPendingRecovery();
    if (pendingRecovery && pendingRecovery.recipe) {
        socket.emit('RECOVERY_AVAILABLE', {
            recipeTitle: pendingRecovery.recipe.title || 'Ricetta in corso',
            stepIndex: (pendingRecovery.currentStepIndex || 0) + 1,
            currentStepIndex: pendingRecovery.currentStepIndex || 0,
            totalSteps: pendingRecovery.recipe.steps ? pendingRecovery.recipe.steps.length : 0,
            inPrepScreen: Boolean(pendingRecovery.inPrepScreen)
        });
    }

    // Avvio dello step corrente sulla macchina
    socket.on('RECIPE_START_STEP', () => {
        const step = recipeManager.getCurrentStep();
        if (!step) return;

        console.log(`▶️ [RECIPE SOCKET] Avvio step ${recipeManager.currentStepIndex + 1}: "${step.instruction}"`);
        recipeManager.setStepRunning(true);

        if (step.actionType === 'weigh') {
            io.emit('CMD', { type: 'SCALE_TARE' });
            return;
        }

        if (step.mode === 'spiga') {
            const time = step.time || 120;
            bimbyService.send({ type: 'SET_TIME', value: time });
            bimbyService.send({ type: 'START_SPIGA', time });
            return;
        }

        // Normale cottura / rotazione
        lastTimeModification = Date.now();
        bimbyService.send({ type: 'SET_DIRECTION', value: Boolean(step.direction) });
        bimbyService.send({ type: 'SET_TEMP', value: step.temp || 0 });
        bimbyService.send({ type: 'SET_SPEED', value: step.speed || 1 });
        bimbyService.send({ type: 'SET_TIME', value: step.time || 0 });
        bimbyService.send({ type: 'PLAY' });
    });

    // Passaggio allo step successivo con azzeramento di sicurezza
    socket.on('RECIPE_NEXT_STEP', () => {
        bimbyService.send({ type: 'STOP' });
        bimbyService.send({ type: 'SET_SPEED', value: 0 });
        bimbyService.send({ type: 'SET_TEMP', value: 0 });
        bimbyService.send({ type: 'SET_TIME', value: 0 });
        recipeManager.nextStep();
    });

    // Completamento ricetta con azzeramento di sicurezza
    socket.on('RECIPE_COMPLETE', () => {
        bimbyService.send({ type: 'STOP' });
        bimbyService.send({ type: 'SET_SPEED', value: 0 });
        bimbyService.send({ type: 'SET_TEMP', value: 0 });
        bimbyService.send({ type: 'SET_TIME', value: 0 });
        recipeManager.completeRecipe();
    });

    // Salta forzatamente il passaggio corrente con azzeramento di sicurezza
    socket.on('RECIPE_SKIP_STEP', () => {
        bimbyService.send({ type: 'STOP' });
        bimbyService.send({ type: 'SET_SPEED', value: 0 });
        bimbyService.send({ type: 'SET_TEMP', value: 0 });
        bimbyService.send({ type: 'SET_TIME', value: 0 });
        recipeManager.skipStep();
    });

    // Avvio ricetta dalla schermata iniziale di preparazione
    socket.on('RECIPE_START_COOKING', () => {
        bimbyService.send({ type: 'STOP' });
        bimbyService.send({ type: 'SET_SPEED', value: 0 });
        bimbyService.send({ type: 'SET_TEMP', value: 0 });
        bimbyService.send({ type: 'SET_TIME', value: 0 });
        recipeManager.startCooking();
    });

    // Pausa dello step corrente (salva il tempo residuo)
    socket.on('RECIPE_PAUSE_STEP', () => {
        const snapshot = bimbyService.getSnapshot();
        const remaining = snapshot.context.targetTime || 0;
        bimbyService.send({ type: 'STOP' });
        recipeManager.pauseStep(remaining);
    });

    // Ripresa dello step corrente
    socket.on('RECIPE_RESUME_STEP', () => {
        const step = recipeManager.getCurrentStep();
        if (!step) return;

        const timeToRun = recipeManager.remainingTime > 0 ? recipeManager.remainingTime : (step.time || 0);
        console.log(`▶️ [RECIPE SOCKET] Ripresa step ${recipeManager.currentStepIndex + 1} (${timeToRun}s residui)`);
        recipeManager.resumeStep();

        if (step.actionType === 'weigh') {
            return;
        }

        if (step.mode === 'spiga') {
            bimbyService.send({ type: 'SET_TIME', value: timeToRun });
            bimbyService.send({ type: 'START_SPIGA', time: timeToRun });
            return;
        }

        lastTimeModification = Date.now();
        bimbyService.send({ type: 'SET_DIRECTION', value: Boolean(step.direction) });
        bimbyService.send({ type: 'SET_TEMP', value: step.temp || 0 });
        bimbyService.send({ type: 'SET_SPEED', value: step.speed || 1 });
        bimbyService.send({ type: 'SET_TIME', value: timeToRun });
        bimbyService.send({ type: 'PLAY' });
    });

    // Ritorno allo step precedente con azzeramento di sicurezza
    socket.on('RECIPE_PREV_STEP', () => {
        bimbyService.send({ type: 'STOP' });
        bimbyService.send({ type: 'SET_SPEED', value: 0 });
        bimbyService.send({ type: 'SET_TEMP', value: 0 });
        bimbyService.send({ type: 'SET_TIME', value: 0 });
        recipeManager.prevStep();
    });

    // Reset della ricetta attiva con azzeramento totale parametri
    socket.on('RECIPE_RESET', () => {
        bimbyService.send({ type: 'STOP' });
        bimbyService.send({ type: 'SET_SPEED', value: 0 });
        bimbyService.send({ type: 'SET_TEMP', value: 0 });
        bimbyService.send({ type: 'SET_TIME', value: 0 });
        recipeManager.reset();
    });

    // Accetta il ripristino della ricetta post-blackout
    socket.on('RECOVERY_ACCEPT', () => {
        console.log('🔄 [RECOVERY SOCKET] Ricevuto RECOVERY_ACCEPT dal client');
        const state = recipeManager.acceptRecovery();
        if (state) {
            io.emit('RECIPE_STATE', state);
            io.emit('RECOVERY_DISMISSED');
        }
    });

    // Ignora e cancella il ripristino della ricetta post-blackout
    socket.on('RECOVERY_DISCARD', () => {
        console.log('🗑️ [RECOVERY SOCKET] Ricevuto RECOVERY_DISCARD dal client');
        recipeManager.discardRecovery();
        io.emit('RECOVERY_DISMISSED');
    });

    // Richiesta impostazioni correnti
    socket.on('GET_SETTINGS', (callback) => {
        if (typeof callback === 'function') {
            callback({
                success: true,
                settings: getSettings(),
                hasApiKey: Boolean(process.env.GEMINI_API_KEY)
            });
        }
    });

    // Aggiornamento impostazioni
    socket.on('UPDATE_SETTINGS', (data, callback) => {
        try {
            const updated = saveSettings(data);
            io.emit('SETTINGS_UPDATED', {
                settings: updated,
                hasApiKey: Boolean(process.env.GEMINI_API_KEY)
            });
            if (typeof callback === 'function') {
                callback({ success: true, settings: updated });
            }
        } catch (err) {
            if (typeof callback === 'function') {
                callback({ success: false, error: err.message });
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('[SOCKET] Display disconnesso:', socket.id);
    });
});

// =============================================
// REST API RICETTE & GEMINI
// =============================================

// Parsing di uno step testuale tramite Gemini
app.post('/api/recipe/parse-step', async (req, res) => {
    try {
        const { text, autoLoad } = req.body;
        if (!text) {
            return res.status(400).json({ error: 'Campo "text" mancante.' });
        }
        console.log(`🤖 [API] Richiesta parsing step con Gemini: "${text.substring(0, 60)}..."`);
        const parsedStep = await parseRecipeStep(text);
        if (autoLoad) {
            recipeManager.setSingleStep(parsedStep, 'Passaggio Rapido');
        }
        return res.json({ success: true, step: parsedStep });
    } catch (err) {
        console.error('[API] Errore /api/recipe/parse-step:', err);
        return res.status(500).json({ error: err.message || 'Errore durante l\'elaborazione dello step con Gemini.' });
    }
});

// Parsing completo di una ricetta tramite AI a partire direttamente dal codice HTML della pagina Cookidoo
app.post('/api/recipe/parse-html', async (req, res) => {
    try {
        const { html, url } = req.body;
        if (!html || typeof html !== 'string') {
            return res.status(400).json({ error: 'Codice HTML della pagina mancante.' });
        }

        console.log(`🤖 [API] Ricevuta richiesta di parsing diretto HTML con Gemini (${html.length} caratteri)...`);
        const recipeData = await parseRecipeFromHtml(html);

        if (!recipeData.steps || recipeData.steps.length === 0) {
            return res.status(422).json({
                error: 'Nessun passaggio trovato nella pagina. Assicurati che la ricetta sia aperta e visibile, o di aver effettuato l\'accesso a Cookidoo se richiesto.'
            });
        }

        const recipeId = url ? (url.split('/').filter(Boolean).pop() || `recipe-${Date.now()}`) : `recipe-${Date.now()}`;
        const state = recipeManager.loadFullRecipe({
            id: recipeId,
            ...recipeData
        });

        return res.json({ success: true, state });
    } catch (err) {
        console.error('[API] Errore /api/recipe/parse-html:', err);
        return res.status(500).json({ error: err.message || 'Errore durante l\'analisi con Gemini.' });
    }
});

// Caricamento di una ricetta completa multi-step con ingredienti, note e schermata di preparazione
app.post('/api/recipe/load-full', async (req, res) => {
    try {
        const recipeData = req.body;
        if (!recipeData || !Array.isArray(recipeData.steps) || recipeData.steps.length === 0) {
            return res.status(400).json({ error: 'Array di passaggi vuoto o non valido.' });
        }

        console.log(`📖 [API] Caricamento ricetta completa "${recipeData.title}" (${recipeData.steps.length} passaggi)...`);
        
        let structuredSteps = recipeData.steps;
        const areRawStrings = typeof recipeData.steps[0] === 'string';
        if (areRawStrings) {
            structuredSteps = await parseFullRecipeSteps(recipeData.steps);
        }

        const fullRecipePayload = {
            ...recipeData,
            steps: structuredSteps
        };

        const state = recipeManager.loadFullRecipe(fullRecipePayload);
        return res.json({ success: true, state });
    } catch (err) {
        console.error('[API] Errore /api/recipe/load-full:', err);
        return res.status(500).json({ error: err.message || 'Errore durante il caricamento della ricetta.' });
    }
});

// Caricamento di una ricetta completa multi-step (legacy)
app.post('/api/recipe/load', (req, res) => {
    try {
        const recipeData = req.body;
        const state = recipeManager.loadRecipe(recipeData);
        return res.json({ success: true, state });
    } catch (err) {
        console.error('[API] Errore /api/recipe/load:', err);
        return res.status(400).json({ error: err.message || 'Dati ricetta non validi.' });
    }
});

// Lettura dello stato attuale della ricetta
app.get('/api/recipe/state', (req, res) => {
    return res.json(recipeManager.getState());
});

// Reset della ricetta attiva
app.post('/api/recipe/reset', (req, res) => {
    recipeManager.reset();
    return res.json({ success: true });
});

// Verifica se è disponibile una sessione di ripristino post-blackout
app.get('/api/recipe/recovery', (req, res) => {
    const pending = recipeManager.getPendingRecovery();
    if (!pending || !pending.recipe) {
        return res.json({ hasRecovery: false });
    }
    return res.json({
        hasRecovery: true,
        recipeTitle: pending.recipe.title || 'Ricetta in corso',
        stepIndex: (pending.currentStepIndex || 0) + 1,
        currentStepIndex: pending.currentStepIndex || 0,
        totalSteps: pending.recipe.steps ? pending.recipe.steps.length : 0,
        inPrepScreen: Boolean(pending.inPrepScreen)
    });
});

// Accetta il ripristino via REST
app.post('/api/recipe/recovery/accept', (req, res) => {
    const state = recipeManager.acceptRecovery();
    if (state) {
        io.emit('RECIPE_STATE', state);
        io.emit('RECOVERY_DISMISSED');
        return res.json({ success: true, state });
    }
    return res.status(404).json({ error: 'Nessuna sessione di ripristino in sospeso.' });
});

// Scarta e cancella il ripristino via REST
app.post('/api/recipe/recovery/discard', (req, res) => {
    recipeManager.discardRecovery();
    io.emit('RECOVERY_DISMISSED');
    return res.json({ success: true });
});

// =============================================
// REST API CALIBRAZIONE BILANCIA (HX711)
// =============================================

// Lettura stato calibrazione e diagnostica sensore
app.get('/api/scale/calibration', (req, res) => {
    try {
        if (!scale || typeof scale.getCalibrationStatus !== 'function') {
            return res.status(503).json({ error: 'Modulo bilancia non disponibile' });
        }
        return res.json(scale.getCalibrationStatus());
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Fase 1: Registra lo zero a vuoto (offset tare)
app.post('/api/scale/calibration/zero', (req, res) => {
    try {
        if (!scale || typeof scale.calibrateZero !== 'function') {
            return res.status(503).json({ error: 'Modulo bilancia non disponibile' });
        }
        const result = scale.calibrateZero();
        io.emit('SCALE_CALIBRATION_UPDATED', scale.getCalibrationStatus());
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// Fase 2: Calcola e salva il nuovo fattore con peso noto
app.post('/api/scale/calibration/weight', (req, res) => {
    try {
        if (!scale || typeof scale.calibrateWithWeight !== 'function') {
            return res.status(503).json({ error: 'Modulo bilancia non disponibile' });
        }
        const knownWeight = Number(req.body?.knownWeight) || 1000;
        const result = scale.calibrateWithWeight(knownWeight);
        io.emit('SCALE_CALIBRATION_UPDATED', scale.getCalibrationStatus());
        return res.json(result);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
});

// Ripristina la calibrazione di fabbrica
app.post('/api/scale/calibration/reset', (req, res) => {
    try {
        if (!scale || typeof scale.resetCalibration !== 'function') {
            return res.status(503).json({ error: 'Modulo bilancia non disponibile' });
        }
        const result = scale.resetCalibration();
        io.emit('SCALE_CALIBRATION_UPDATED', result);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// =============================================
// REST API IMPOSTAZIONI DI SISTEMA & GEMINI
// =============================================

// Lettura delle impostazioni correnti e diagnostica di sistema reale
app.get('/api/settings', (req, res) => {
    try {
        const settings = getSettings();
        const mem = process.memoryUsage();
        return res.json({
            success: true,
            settings,
            hasApiKey: Boolean(process.env.GEMINI_API_KEY),
            systemInfo: {
                nodeVersion: process.version,
                platform: `${process.platform} (${process.arch})`,
                uptimeSeconds: Math.floor(process.uptime()),
                heapUsedMb: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
                heapTotalMb: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
                serialConnected: Boolean(bimbySerial && bimbySerial.isConnected),
                hardwareMode: config.hardwareMode || 'mock',
                fsmState: (bimbyService && bimbyService.getSnapshot && bimbyService.getSnapshot().value) ? bimbyService.getSnapshot().value : 'IDLE',
                serverPid: process.pid
            }
        });
    } catch (err) {
        console.error('[API] Errore GET /api/settings:', err);
        return res.status(500).json({ error: err.message });
    }
});

// Salvataggio impostazioni di sistema
app.post('/api/settings', (req, res) => {
    try {
        const toUpdate = {};

        if (req.body.geminiModel !== undefined) {
            if (typeof req.body.geminiModel !== 'string' || req.body.geminiModel.trim().length === 0) {
                return res.status(400).json({ error: 'Nome del modello non valido.' });
            }
            toUpdate.geminiModel = req.body.geminiModel.trim();
        }

        if (req.body.cookidooZoom !== undefined) {
            const z = parseFloat(req.body.cookidooZoom);
            if (isNaN(z) || z < 0.3 || z > 2.0) {
                return res.status(400).json({ error: 'Valore di zoom non valido (deve essere tra 30% e 200%).' });
            }
            toUpdate.cookidooZoom = Math.round(z * 100) / 100;
        }

        if (req.body.dimming !== undefined && typeof req.body.dimming === 'object') {
            toUpdate.dimming = req.body.dimming;
        }

        if (Object.keys(toUpdate).length === 0) {
            return res.status(400).json({ error: 'Nessun parametro valido fornito da aggiornare.' });
        }

        const updated = saveSettings(toUpdate);
        io.emit('SETTINGS_UPDATED', {
            settings: updated,
            hasApiKey: Boolean(process.env.GEMINI_API_KEY)
        });

        return res.json({
            success: true,
            settings: updated,
            hasApiKey: Boolean(process.env.GEMINI_API_KEY)
        });
    } catch (err) {
        console.error('[API] Errore POST /api/settings:', err);
        return res.status(500).json({ error: err.message });
    }
});

// =============================================
// REST API WI-FI & RETE (Retrofit TM31)
// =============================================

// Scansione delle reti Wi-Fi disponibili
app.get('/api/wifi/scan', async (req, res) => {
    try {
        const networks = await scanNetworks();
        const isMock = networks.length > 0 ? Boolean(networks[0].isMock) : false;
        return res.json({ success: true, networks, isMock });
    } catch (err) {
        console.error('[API] Errore /api/wifi/scan:', err);
        return res.status(500).json({ success: false, error: err.message || 'Errore scansione Wi-Fi' });
    }
});

// Stato attuale connessione Wi-Fi
app.get('/api/wifi/status', async (req, res) => {
    try {
        const status = await getCurrentConnection();
        return res.json({ success: true, ...status });
    } catch (err) {
        console.error('[API] Errore /api/wifi/status:', err);
        return res.status(500).json({ success: false, error: err.message || 'Errore stato Wi-Fi' });
    }
});

// Connessione a una rete Wi-Fi tramite SSID e password
app.post('/api/wifi/connect', async (req, res) => {
    try {
        const { ssid, password } = req.body;
        if (!ssid || typeof ssid !== 'string' || ssid.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'SSID mancante o non valido.' });
        }
        const result = await connectToNetwork(ssid, password);
        return res.json(result);
    } catch (err) {
        console.error('[API] Errore /api/wifi/connect:', err);
        return res.status(400).json({ success: false, error: err.message || 'Errore durante la connessione.' });
    }
});

// Disconnessione manuale dalla rete Wi-Fi corrente
app.post('/api/wifi/disconnect', async (req, res) => {
    try {
        const result = await disconnectNetwork();
        return res.json(result);
    } catch (err) {
        console.error('[API] Errore /api/wifi/disconnect:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================
// REST API COOKIDOO & GESTIONE SESSIONE / DATI
// =============================================
let cookidooAuthStatus = {
    isLoggedIn: false,
    userName: null,
    lastUpdated: null,
    cookieCount: 0
};

// Lettura stato Cookidoo per frontend
app.get('/api/cookidoo/status', (req, res) => {
    return res.json({
        success: true,
        ...cookidooAuthStatus
    });
});

// Ricezione aggiornamento stato login dall'injector Cookidoo
app.post('/api/cookidoo/auth-status', (req, res) => {
    try {
        const { loggedIn, userName, cookieCount } = req.body || {};
        cookidooAuthStatus = {
            isLoggedIn: Boolean(loggedIn),
            userName: userName || (loggedIn ? 'Utente Cookidoo' : null),
            cookieCount: typeof cookieCount === 'number' ? cookieCount : cookidooAuthStatus.cookieCount,
            lastUpdated: new Date().toISOString()
        };
        io.emit('COOKIDOO_STATUS_UPDATED', cookidooAuthStatus);
        return res.json({ success: true, status: cookidooAuthStatus });
    } catch (err) {
        console.error('[API] Errore /api/cookidoo/auth-status:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Reset dati Cookidoo
app.post('/api/cookidoo/clear-data', (req, res) => {
    try {
        cookidooAuthStatus = {
            isLoggedIn: false,
            userName: null,
            cookieCount: 0,
            lastUpdated: new Date().toISOString()
        };
        io.emit('COOKIDOO_DATA_CLEARED');
        console.log('🧹 [COOKIDOO SERVER] Dati e stato Cookidoo resettati');
        return res.json({ success: true, message: 'Dati Cookidoo resettati sul server' });
    } catch (err) {
        console.error('[API] Errore /api/cookidoo/clear-data:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================
// REST API BACKLIGHT & PROTEZIONE BURN-IN DISPLAY
// =============================================

// Lettura stato luminosità / attenuazione display
app.get('/api/system/screen-dim', (req, res) => {
    return res.json({ success: true, ...backlightManager.getStatus() });
});

// Impostazione manuale attenuazione display (test o trigger)
app.post('/api/system/screen-dim', (req, res) => {
    try {
        const dimmed = Boolean(req.body && (req.body.dimmed !== undefined ? req.body.dimmed : req.body.isDimmed));
        const pct = (req.body && req.body.dimPercentage !== undefined) ? Number(req.body.dimPercentage) : null;
        const status = backlightManager.setDimmed(dimmed, pct);
        io.emit('SCREEN_DIMMED_STATE', status);
        return res.json({ success: true, ...status });
    } catch (err) {
        console.error('[API] Errore /api/system/screen-dim:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================
// REST API BUZZER PIEZOELETTRICO PWM (GPIO 18 / TM31)
// =============================================

// Stato attuale buzzer
app.get('/api/system/buzzer/status', (req, res) => {
    return res.json({ success: true, ...piezoBuzzer.getStatus() });
});

// Test / comando manuale buzzer
app.post('/api/system/buzzer/test', (req, res) => {
    try {
        const { action = 'beep', frequency = 2500, duration = 200 } = req.body || {};
        if (action === 'timer_done') {
            piezoBuzzer.playTimerDone();
        } else if (action === 'stop') {
            piezoBuzzer.stop();
        } else if (action === 'beep') {
            piezoBuzzer.beep(Number(frequency) || 2500, Number(duration) || 100);
        } else if (action === 'tone') {
            piezoBuzzer.playTone(Number(frequency) || 2500, Number(duration) || 500);
        } else {
            return res.status(400).json({ error: 'Azione non valida. Valori ammessi: beep, tone, timer_done, stop' });
        }
        return res.json({ success: true, status: piezoBuzzer.getStatus() });
    } catch (err) {
        console.error('[API] Errore /api/system/buzzer/test:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================
// REST API SICUREZZA INTERLOCK & MICROINTERRUTTORI
// =============================================

// Lettura stato microinterruttori
app.get('/api/system/interlock', (req, res) => {
    return res.json({ success: true, ...interlock.getStatus() });
});

// Simulazione ostacolo o boccale assente (per test e simulatore)
app.post('/api/system/interlock/simulate', (req, res) => {
    try {
        const { simulateObstacle, simulateBowlMissing } = req.body || {};
        const updated = interlock.setSimulationOptions({ simulateObstacle, simulateBowlMissing });
        io.emit('INTERLOCK_STATE', updated);
        return res.json({ success: true, status: updated });
    } catch (err) {
        console.error('[API] Errore /api/system/interlock/simulate:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// =============================================
// REST API AGGIORNAMENTO SOFTWARE OTA (Over-The-Air)
// =============================================

// Info versione attuale e commit Git
app.get('/api/system/version', (req, res) => {
    try {
        const info = updater.getVersionInfo();
        return res.json({ success: true, ...info });
    } catch (err) {
        console.error('[API] Errore GET /api/system/version:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Verifica presenza nuovi aggiornamenti remoti su GitHub
app.get('/api/system/update/check', async (req, res) => {
    try {
        const branch = req.query.branch || 'main';
        const result = await updater.checkForUpdates(branch);
        return res.json(result);
    } catch (err) {
        console.error('[API] Errore GET /api/system/update/check:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Stato attuale e log recenti del processo di aggiornamento
app.get('/api/system/update/status', (req, res) => {
    return res.json({ success: true, ...updater.getStatus() });
});

// Avvia l'aggiornamento OTA (lancia scripts/ota_update.sh con streaming logs)
app.post('/api/system/update', async (req, res) => {
    try {
        const { force, branch, pm2Process } = req.body || {};
        const status = await updater.startUpdate({ force, branch, pm2Process, io });
        return res.json({ success: true, message: 'Aggiornamento OTA avviato', status });
    } catch (err) {
        console.error('[API] Errore POST /api/system/update:', err);
        return res.status(400).json({ success: false, error: err.message });
    }
});

// =============================================
// REST API GESTIONE ALIMENTAZIONE & SPEGNIMENTO SICURO
// =============================================
app.post('/api/system/power', async (req, res) => {
    try {
        const action = req.body?.action || 'shutdown';
        if (!['shutdown', 'reboot', 'restart_app'].includes(action)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Azione non valida. Valori ammessi: shutdown, reboot, restart_app' 
            });
        }
        const result = await powerManager.executePowerAction({
            action,
            io,
            bimbyService,
            bimbySerial,
            servo
        });
        return res.json({ success: true, ...result });
    } catch (err) {
        console.error('[API] Errore POST /api/system/power:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = 3001;
server.listen(PORT, () => {
    console.log(`\n=============================================`);
    console.log(` SERVER BIMBY AVVIATO SU HTTP://LOCALHOST:${PORT}`);
    console.log(`=============================================\n`);
});
