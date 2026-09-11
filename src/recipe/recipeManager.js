const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '../config');
const RECOVERY_FILE = path.join(CONFIG_DIR, 'recovery.json');

class RecipeManager extends EventEmitter {
    constructor() {
        super();
        this.currentRecipe = null;
        this.currentStepIndex = 0;
        this.isStepRunning = false;
        this.isStepCompleted = false;
        this.isRecipeCompleted = false;
        this.isPaused = false;
        this.remainingTime = 0;
        this.inPrepScreen = true;
        this.pendingRecovery = null;

        // Controlla al boot se esiste una ricetta salvata da una sessione interrotta
        this._checkRecoveryFile();
    }

    /**
     * Normalizza uno step garantendo che abbia tutti i parametri necessari per il Bimby TM31
     */
    _normalizeStep(rawStep, index) {
        const time = typeof rawStep.time === 'number' 
            ? rawStep.time 
            : (rawStep.params && typeof rawStep.params.time === 'number' ? rawStep.params.time : 0);

        const temp = typeof rawStep.temp === 'number' 
            ? rawStep.temp 
            : (rawStep.params && typeof rawStep.params.temp === 'number' ? rawStep.params.temp : 0);

        const speed = typeof rawStep.speed === 'number' 
            ? rawStep.speed 
            : (rawStep.params && typeof rawStep.params.speed === 'number' ? rawStep.params.speed : 0);

        const direction = typeof rawStep.direction === 'boolean' 
            ? rawStep.direction 
            : (rawStep.params && typeof rawStep.params.direction === 'boolean' ? rawStep.params.direction : false);

        const mode = rawStep.mode 
            || (rawStep.params && rawStep.params.mode) 
            || 'none';

        const actionType = rawStep.actionType || (speed > 0 || temp > 0 ? 'cook' : 'manual');

        const originalText = rawStep.originalText || rawStep.text || rawStep.instruction || '';

        return {
            index,
            instruction: rawStep.instruction || `Passaggio ${index + 1}`,
            actionType,
            time,
            temp,
            speed,
            direction,
            mode,
            originalText
        };
    }

    /**
     * Carica una ricetta completa con schermata di preparazione, ingredienti e note
     * @param {Object} recipeData - { id, title, info, ingredients, accessories, tips, steps }
     */
    loadFullRecipe(recipeData) {
        if (!recipeData || !Array.isArray(recipeData.steps) || recipeData.steps.length === 0) {
            throw new Error('Dati ricetta non validi: array di step mancante o vuoto.');
        }

        const normalizedSteps = recipeData.steps.map((s, idx) => this._normalizeStep(s, idx));

        let personalNotes = recipeData.personalNotes || null;
        if (typeof personalNotes === 'string') {
            const pLower = personalNotes.toLowerCase();
            if (
                pLower.includes("questa nota è visibile") ||
                pLower.includes("questa nota e visibile") ||
                pLower.includes("aggiungi qui le tue modifiche") ||
                pLower.includes("variazioni o promemoria") ||
                personalNotes.trim().length === 0
            ) {
                personalNotes = null;
            }
        }

        let tips = recipeData.tips || null;
        if (typeof tips === 'string' && (tips.trim().length === 0 || tips.toLowerCase().includes("nessun"))) {
            tips = null;
        }

        this.currentRecipe = {
            id: recipeData.id || `recipe-${Date.now()}`,
            title: recipeData.title || 'Ricetta Guidata',
            info: recipeData.info || {},
            ingredients: Array.isArray(recipeData.ingredients) ? recipeData.ingredients : [],
            accessories: Array.isArray(recipeData.accessories) ? recipeData.accessories : [],
            tips: tips,
            personalNotes: personalNotes,
            steps: normalizedSteps
        };

        this.currentStepIndex = 0;
        this.isStepRunning = false;
        this.isStepCompleted = false;
        this.isRecipeCompleted = false;
        this.isPaused = false;
        this.remainingTime = 0;
        // Mostra prima la schermata "Preparazione"
        this.inPrepScreen = true;

        // Salva lo stato su disco per consentire il ripristino in caso di blackout
        this._saveRecoveryFile();

        console.log(`📖 [RECIPE] Caricata ricetta completa "${this.currentRecipe.title}" con ${this.currentRecipe.steps.length} passaggi e ${this.currentRecipe.ingredients.length} ingredienti.`);
        this.emit('state_change', this.getState());
        return this.getState();
    }

    /**
     * Carica una ricetta normale (compatibilità retroattiva)
     */
    loadRecipe(recipeData) {
        return this.loadFullRecipe(recipeData);
    }

    /**
     * Passa dalla schermata "Preparazione" all'inizio del primo passaggio
     */
    startCooking() {
        this.inPrepScreen = false;
        this.currentStepIndex = 0;
        this.isStepRunning = false;
        this.isStepCompleted = false;
        this.isRecipeCompleted = false;
        this.isPaused = false;
        this.remainingTime = 0;
        this._saveRecoveryFile();
        console.log(`🍳 [RECIPE] Inizio cottura ricetta: passaggio 1/${this.currentRecipe?.steps?.length || 1}`);
        this.emit('state_change', this.getState());
        return this.getState();
    }

    /**
     * Ritorna alla schermata "Preparazione"
     */
    goToPrepScreen() {
        this.inPrepScreen = true;
        this.isStepRunning = false;
        this.isPaused = false;
        this._saveRecoveryFile();
        this.emit('state_change', this.getState());
        return this.getState();
    }

    /**
     * Aggiunge o imposta un singolo step rapido
     */
    setSingleStep(stepData, title = 'Passaggio Importato') {
        const step = this._normalizeStep(stepData, 0);
        this.currentRecipe = {
            id: `quick-step-${Date.now()}`,
            title,
            info: {},
            ingredients: [],
            accessories: [],
            tips: null,
            steps: [step]
        };
        this.currentStepIndex = 0;
        this.isStepRunning = false;
        this.isStepCompleted = false;
        this.isPaused = false;
        this.remainingTime = 0;
        this.inPrepScreen = false;

        this._saveRecoveryFile();
        console.log(`📖 [RECIPE] Caricato singolo step "${step.instruction}".`);
        this.emit('state_change', this.getState());
        return this.getState();
    }

    /**
     * Restituisce lo step corrente
     */
    getCurrentStep() {
        if (!this.currentRecipe || !this.currentRecipe.steps[this.currentStepIndex]) {
            return null;
        }
        return this.currentRecipe.steps[this.currentStepIndex];
    }

    /**
     * Avanza al passaggio successivo
     */
    nextStep() {
        if (!this.currentRecipe) return null;

        if (this.currentStepIndex < this.currentRecipe.steps.length - 1) {
            this.currentStepIndex++;
            this.isStepRunning = false;
            this.isStepCompleted = false;
            this.isRecipeCompleted = false;
            this.isPaused = false;
            this.remainingTime = 0;
            this._saveRecoveryFile();
            console.log(`📖 [RECIPE] Avanzamento allo step ${this.currentStepIndex + 1}/${this.currentRecipe.steps.length}`);
            this.emit('state_change', this.getState());
            return this.getCurrentStep();
        }

        console.log(`📖 [RECIPE] Raggiunto e completato l'ultimo passaggio della ricetta.`);
        this.isRecipeCompleted = true;
        this.isStepRunning = false;
        this.isPaused = false;
        this.pendingRecovery = null;
        this._clearRecoveryFile();
        this.emit('state_change', this.getState());
        return this.getCurrentStep();
    }

    /**
     * Salta forzatamente il passaggio corrente
     */
    skipStep() {
        return this.nextStep();
    }

    /**
     * Ritorna al passaggio precedente (o alla schermata Preparazione se al primo step)
     */
    prevStep() {
        if (!this.currentRecipe) return null;

        if (this.currentStepIndex > 0) {
            this.currentStepIndex--;
            this.isStepRunning = false;
            this.isStepCompleted = false;
            this.isPaused = false;
            this.remainingTime = 0;
            this._saveRecoveryFile();
            console.log(`📖 [RECIPE] Ritorno allo step ${this.currentStepIndex + 1}/${this.currentRecipe.steps.length}`);
            this.emit('state_change', this.getState());
            return this.getCurrentStep();
        } else {
            // Se al primo passaggio, torna alla pagina di preparazione
            this.inPrepScreen = true;
            this.isStepRunning = false;
            this.isPaused = false;
            this._saveRecoveryFile();
            this.emit('state_change', this.getState());
            return null;
        }
    }

    /**
     * Mette in pausa lo step corrente conservando il tempo residuo
     */
    pauseStep(remainingSec = 0) {
        this.isPaused = true;
        this.isStepRunning = false;
        this.remainingTime = remainingSec;
        console.log(`⏸️ [RECIPE] Step ${this.currentStepIndex + 1} in pausa. Tempo residuo: ${remainingSec}s`);
        this.emit('state_change', this.getState());
    }

    /**
     * Riprende l'esecuzione dopo la pausa
     */
    resumeStep() {
        this.isPaused = false;
        this.isStepRunning = true;
        console.log(`▶️ [RECIPE] Step ${this.currentStepIndex + 1} ripreso.`);
        this.emit('state_change', this.getState());
    }

    /**
     * Segna lo step corrente come completato (es. timer scaduto)
     */
    setStepCompleted(completed = true) {
        this.isStepCompleted = completed;
        this.isStepRunning = false;
        this.isPaused = false;
        this.remainingTime = 0;
        console.log(`✅ [RECIPE] Step ${this.currentStepIndex + 1} contrassegnato come COMPLETATO.`);
        this.emit('state_change', this.getState());
    }

    /**
     * Segna lo step corrente come avviato in esecuzione
     */
    setStepRunning(running = true) {
        this.isStepRunning = running;
        if (running) {
            this.isStepCompleted = false;
            this.isPaused = false;
        }
        console.log(`⚙️ [RECIPE] Step ${this.currentStepIndex + 1} in esecuzione: ${running}`);
        this.emit('state_change', this.getState());
    }

    /**
     * Azzera e chiude la ricetta attiva
     */
    reset() {
        this.currentRecipe = null;
        this.currentStepIndex = 0;
        this.isStepRunning = false;
        this.isStepCompleted = false;
        this.isRecipeCompleted = false;
        this.isPaused = false;
        this.remainingTime = 0;
        this.inPrepScreen = true;
        this.pendingRecovery = null;
        this._clearRecoveryFile();
        console.log(`🛑 [RECIPE] Ricetta azzerata.`);
        this.emit('state_change', this.getState());
    }

    /**
     * Contrassegna l'intera ricetta come completata (schermata finale di successo)
     */
    completeRecipe() {
        this.isRecipeCompleted = true;
        this.isStepRunning = false;
        this.isPaused = false;
        this.pendingRecovery = null;
        this._clearRecoveryFile();
        console.log(`🎉 [RECIPE] Ricetta contrassegnata come COMPLETATA.`);
        this.emit('state_change', this.getState());
        return this.getState();
    }

    /**
     * Controlla al boot se è presente un file di ripristino da crash o blackout
     */
    _checkRecoveryFile() {
        try {
            if (fs.existsSync(RECOVERY_FILE)) {
                const content = fs.readFileSync(RECOVERY_FILE, 'utf-8');
                const data = JSON.parse(content);
                if (data && data.recipe && Array.isArray(data.recipe.steps) && data.recipe.steps.length > 0) {
                    this.pendingRecovery = {
                        recipe: data.recipe,
                        currentStepIndex: typeof data.currentStepIndex === 'number' ? data.currentStepIndex : 0,
                        inPrepScreen: Boolean(data.inPrepScreen),
                        savedAt: data.savedAt || Date.now()
                    };
                    console.log(`🔄 [RECOVERY] Trovata sessione salvata al boot: "${data.recipe.title}" (Passaggio ${(this.pendingRecovery.currentStepIndex || 0) + 1}/${data.recipe.steps.length})`);
                } else {
                    this._clearRecoveryFile();
                }
            }
        } catch (err) {
            console.error('⚠️ [RECOVERY] Errore lettura file di ripristino:', err.message);
            this.pendingRecovery = null;
        }
    }

    /**
     * Salva lo stato corrente su recovery.json (solo a evento, mai su tick al secondo per salvaguardare la SD)
     */
    _saveRecoveryFile() {
        try {
            if (!this.currentRecipe) return;
            if (!fs.existsSync(CONFIG_DIR)) {
                fs.mkdirSync(CONFIG_DIR, { recursive: true });
            }
            const payload = {
                recipe: this.currentRecipe,
                currentStepIndex: this.currentStepIndex,
                inPrepScreen: this.inPrepScreen,
                savedAt: Date.now()
            };
            fs.writeFileSync(RECOVERY_FILE, JSON.stringify(payload, null, 2), 'utf-8');
            console.log(`💾 [RECOVERY] Stato ricetta salvato su disco: "${this.currentRecipe.title}" - Passaggio ${this.currentStepIndex + 1}`);
        } catch (err) {
            console.error('⚠️ [RECOVERY] Errore scrittura recovery.json:', err.message);
        }
    }

    /**
     * Rimuove il file recovery.json alla fine della ricetta o al reset
     */
    _clearRecoveryFile() {
        try {
            if (fs.existsSync(RECOVERY_FILE)) {
                fs.unlinkSync(RECOVERY_FILE);
                console.log(`🗑️ [RECOVERY] Rimosso file di ripristino.`);
            }
        } catch (err) {
            console.error('⚠️ [RECOVERY] Errore rimozione recovery.json:', err.message);
        }
    }

    /**
     * Restituisce i dettagli del recupero in sospeso se presente
     */
    getPendingRecovery() {
        return this.pendingRecovery ? { ...this.pendingRecovery } : null;
    }

    /**
     * Accetta il recupero: carica la ricetta e posiziona il cursore sul passaggio salvato
     */
    acceptRecovery() {
        if (!this.pendingRecovery) {
            return null;
        }
        const { recipe, currentStepIndex, inPrepScreen } = this.pendingRecovery;
        this.currentRecipe = recipe;
        this.currentStepIndex = typeof currentStepIndex === 'number' ? currentStepIndex : 0;
        this.inPrepScreen = Boolean(inPrepScreen);
        this.isStepRunning = false;
        this.isStepCompleted = false;
        this.isRecipeCompleted = false;
        this.isPaused = false;
        this.remainingTime = 0;
        this.pendingRecovery = null;

        // Mantieni aggiornato il file per proteggere da ulteriori blackout durante la sessione
        this._saveRecoveryFile();

        console.log(`✅ [RECOVERY] Ripristino accettato per "${this.currentRecipe.title}" al passaggio ${this.currentStepIndex + 1}/${this.currentRecipe.steps.length}`);
        this.emit('state_change', this.getState());
        return this.getState();
    }

    /**
     * Rifiuta il recupero: cancella il file e azzera la memoria
     */
    discardRecovery() {
        console.log(`❌ [RECOVERY] Ripristino scartato dall'utente.`);
        this.pendingRecovery = null;
        this._clearRecoveryFile();
        return true;
    }

    hasActiveRecipe() {
        return Boolean(this.currentRecipe && this.currentRecipe.steps.length > 0);
    }

    /**
     * Ritorna lo stato consolidato da inviare via Socket / REST al frontend
     */
    getState() {
        const step = this.getCurrentStep();
        return {
            hasRecipe: Boolean(this.currentRecipe),
            recipeId: this.currentRecipe?.id || null,
            recipeTitle: this.currentRecipe?.title || null,
            info: this.currentRecipe?.info || {},
            ingredients: this.currentRecipe?.ingredients || [],
            accessories: this.currentRecipe?.accessories || [],
            tips: this.currentRecipe?.tips || null,
            personalNotes: this.currentRecipe?.personalNotes || null,
            inPrepScreen: this.inPrepScreen,
            currentStepIndex: this.currentStepIndex,
            totalSteps: this.currentRecipe ? this.currentRecipe.steps.length : 0,
            currentStep: step,
            isStepRunning: this.isStepRunning,
            isStepCompleted: this.isStepCompleted,
            isRecipeCompleted: Boolean(this.isRecipeCompleted),
            isPaused: this.isPaused,
            remainingTime: this.remainingTime,
            isLastStep: this.currentRecipe ? this.currentStepIndex === this.currentRecipe.steps.length - 1 : false
        };
    }
}

const recipeManager = new RecipeManager();

module.exports = {
    RecipeManager,
    recipeManager
};
