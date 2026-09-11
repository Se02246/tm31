const { GoogleGenAI } = require('@google/genai');
const { getGeminiModel } = require('../config/settingsManager');

let ai = null;

/**
 * Fallback euristico tramite espressioni regolari per estrarre parametri macchina TM31
 * anche in assenza di connessione internet o API key Gemini.
 * 
 * @param {string} rawText 
 * @returns {Object}
 */
function parseStepHeuristics(rawText) {
    const text = (rawText || '').trim();
    const lower = text.toLowerCase();

    let actionType = 'manual';
    let time = 0;
    let temp = 0;
    let speed = 0;
    let direction = false;
    let mode = 'none';

    // Rileva modalità speciali
    if (lower.includes('spiga') || lower.includes('impastare') || lower.includes('modalità spiga')) {
        mode = 'spiga';
        actionType = 'mode';
    } else if (lower.includes('turbo')) {
        mode = 'turbo';
        actionType = 'mode';
    } else if (lower.includes('pulizia') || lower.includes('autoclean') || lower.includes('lavare il boccale')) {
        mode = 'pulizia';
        actionType = 'mode';
    }

    // Rileva senso antiorario
    if (lower.includes('antiorario') || lower.includes('senso antiorario') || lower.includes('lame antiorarie') || lower.includes('soft antiorario')) {
        direction = true;
    }

    // Estrae tempo (es. "3 min", "30 sec", "1 h 15 min")
    let timeSeconds = 0;
    const hourMatch = lower.match(/(\d+)\s*(?:ora|ore|h\b)/);
    const minMatch = lower.match(/(\d+)\s*(?:min|minut[io]|m\b)/);
    const secMatch = lower.match(/(\d+)\s*(?:sec|second[io]|s\b)/);

    if (hourMatch) timeSeconds += parseInt(hourMatch[1], 10) * 3600;
    if (minMatch) timeSeconds += parseInt(minMatch[1], 10) * 60;
    if (secMatch) timeSeconds += parseInt(secMatch[1], 10);
    time = timeSeconds;

    // Estrae temperatura
    if (lower.includes('varoma')) {
        temp = 120;
        if (actionType !== 'mode') actionType = 'cook';
    } else {
        const tempMatch = lower.match(/(\d{2,3})\s*°\s*c?/);
        if (tempMatch) {
            const val = parseInt(tempMatch[1], 10);
            if (val >= 37 && val <= 100) {
                temp = val;
                if (actionType !== 'mode') actionType = 'cook';
            } else if (val > 100) {
                temp = 120;
                if (actionType !== 'mode') actionType = 'cook';
            }
        }
    }

    // Estrae velocità
    if (lower.includes('cucchiaio') || lower.includes('vel soft') || lower.includes('velocità soft') || lower.includes('vel. soft')) {
        speed = 0.5;
        if (actionType !== 'mode') actionType = 'cook';
    } else {
        const speedMatch = lower.match(/(?:vel\.?|velocit[aà])\s*(\d+(?:[\.,]\d+)?)/);
        if (speedMatch) {
            const val = parseFloat(speedMatch[1].replace(',', '.'));
            if (!isNaN(val) && val >= 0 && val <= 10) {
                speed = val;
                if (actionType !== 'mode') actionType = 'cook';
            }
        }
    }

    // Se c'è tempo o velocità o temperatura, è una fase di cottura
    if (time > 0 || speed > 0 || temp > 0) {
        if (actionType === 'manual') actionType = 'cook';
    } else if (lower.includes('pesare') || lower.includes('bilancia') || (lower.includes('aggiungere') && lower.match(/\b\d+\s*g\b/))) {
        actionType = 'weigh';
    }

    return {
        actionType,
        originalText: text,
        instruction: text,
        time,
        temp,
        speed,
        direction,
        mode
    };
}

/**
 * Converte il testo in linguaggio naturale di un passaggio di ricetta
 * nei parametri tecnici esatti per il Bimby TM31 tramite Gemini.
 * 
 * @param {string} text - Testo del passaggio (es. "Cuocere per 3 min a 100°C vel 1 antiorario")
 * @returns {Promise<Object>} Oggetto strutturato con actionType, instruction, time, temp, speed, direction, mode
 */
async function parseRecipeStep(text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        throw new Error('Testo del passaggio non fornito o vuoto.');
    }

    const rawText = text.trim();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        console.warn('⚠️ [GEMINI PARSER] GEMINI_API_KEY non presente. Utilizzo parser euristico locale.');
        return parseStepHeuristics(rawText);
    }

    const modelName = getGeminiModel();
    console.log(`🤖 [GEMINI PARSER] Modello configurato per l'elaborazione: "${modelName}"`);

    if (!ai) {
        ai = new GoogleGenAI({ apiKey });
    }

    const prompt = `Analizza questo passaggio di una ricetta per Bimby TM31 ed estrai rigorosamente i parametri operativi macchina in formato JSON.

Testo del passaggio:
"${rawText}"

Regole di conversione per il Bimby TM31:
- actionType: 'cook' (cottura o rotazione lame a qualsiasi velocità), 'weigh' (pesatura ingredienti con bilancia), 'mode' (modalità speciale come spiga, turbo, pulizia), 'manual' (azione manuale dell'utente es. sbucciare, trasferire in una pirofila, servire).
- instruction: sintesi chiara e concisa in italiano di cosa fare (max 10-12 parole).
- time: tempo di lavoro espresso in SECONDI (es. 3 minuti = 180, 5 secondi = 5, 1 ora = 3600). Se non specificato o se è un'azione manuale/pesatura, imposta 0.
- temp: temperatura in gradi Celsius (°C). Valori ammessi nel TM31: 0 (nessun riscaldamento), 37, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, oppure 120 (per Varoma). Se il testo dice 'Varoma', imposta 120. Se non specificata o freddo, imposta 0.
- speed: velocità delle lame (numero tra 0 e 10, con 0.5 per mescolamento delicato/cucchiaio). Se non specificata per una cottura, deduci il valore logico (es. 1 o 2) oppure 0 se non richiesta rotazione.
- direction: booleano (true per rotazione antiorario / senso antiorario / lame antiorarie / soft, false per rotazione oraria normale).
- mode: 'spiga' se viene chiesto di impastare/modalità spiga, 'turbo' per tritare ad altissima velocità/turbo, 'pulizia' se è un passaggio di lavaggio, altrimenti 'none'.`;

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        actionType: { 
                            type: 'STRING', 
                            enum: ['cook', 'weigh', 'mode', 'manual'],
                            description: 'Tipo di azione richiesta per il passaggio'
                        },
                        instruction: { 
                            type: 'STRING',
                            description: 'Istruzione sintetica e chiara in italiano'
                        },
                        time: { 
                            type: 'INTEGER', 
                            description: 'Durata dell operazione in secondi (0 se non applicabile)' 
                        },
                        temp: { 
                            type: 'INTEGER', 
                            description: 'Temperatura target in °C (0 se freddo/nessuna temperatura, 120 per Varoma)' 
                        },
                        speed: { 
                            type: 'NUMBER', 
                            description: 'Velocità di rotazione lame da 0 a 10 (con 0.5 per cucchiaio)' 
                        },
                        direction: { 
                            type: 'BOOLEAN', 
                            description: 'true per rotazione antioraria, false per oraria' 
                        },
                        mode: { 
                            type: 'STRING', 
                            enum: ['spiga', 'turbo', 'pulizia', 'none'],
                            description: 'Modalità speciale Bimby attiva'
                        }
                    },
                    required: ['actionType', 'instruction', 'time', 'temp', 'speed', 'direction', 'mode']
                }
            }
        });

        const parsed = JSON.parse(response.text);
        parsed.originalText = rawText;
        return parsed;
    } catch (err) {
        console.warn('⚠️ [GEMINI PARSER] Errore chiamata Gemini, uso fallback euristico:', err.message);
        return parseStepHeuristics(rawText);
    }
}

/**
 * Converte un array di passaggi testuali in un array di step strutturati per il TM31.
 * Utilizza una singola chiamata batch a Gemini per efficienza e velocità,
 * con fallback istantaneo su parser euristico.
 * 
 * @param {Array<string>} steps - Array di testi dei passaggi
 * @returns {Promise<Array<Object>>} Array di oggetti step completi
 */
async function parseFullRecipeSteps(steps) {
    if (!Array.isArray(steps) || steps.length === 0) {
        return [];
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.log(`ℹ️ [GEMINI PARSER] GEMINI_API_KEY assente: analisi euristica locale di ${steps.length} passaggi.`);
        return steps.map((s, idx) => ({ ...parseStepHeuristics(s), index: idx }));
    }

    const modelName = getGeminiModel();
    console.log(`🤖 [GEMINI PARSER] Analisi batch di ${steps.length} passaggi con modello: "${modelName}"`);

    if (!ai) {
        ai = new GoogleGenAI({ apiKey });
    }

    const stepsPayload = steps.map((text, idx) => ({ index: idx, text }));

    const prompt = `Analizza questa lista di ${steps.length} passaggi sequenziali di una ricetta per Bimby TM31 ed estrai rigorosamente per ciascuno i parametri operativi macchina in formato JSON.

Passaggi da analizzare:
${JSON.stringify(stepsPayload, null, 2)}

Regole per il Bimby TM31:
- actionType: 'cook' (cottura o rotazione lame a qualsiasi velocità), 'weigh' (pesatura ingredienti con bilancia), 'mode' (modalità speciale come spiga, turbo, pulizia), 'manual' (azione manuale es. sbucciare, trasferire, impiattare, preriscaldare il forno).
- instruction: sintesi chiara e concisa in italiano (max 10 parole).
- time: durata in SECONDI (es. 3 min = 180, 5 sec = 5, 0 se manuale o pesatura).
- temp: temperatura in °C (0 se freddo, 37..100, oppure 120 per Varoma).
- speed: velocità da 0 a 10 (0.5 per cucchiaio/soft).
- direction: true per antiorario, false per orario.
- mode: 'spiga' per impastare, 'turbo' per turbo, 'pulizia' per lavaggio, altrimenti 'none'.`;

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'ARRAY',
                    items: {
                        type: 'OBJECT',
                        properties: {
                            index: { type: 'INTEGER' },
                            actionType: { 
                                type: 'STRING', 
                                enum: ['cook', 'weigh', 'mode', 'manual'] 
                            },
                            instruction: { type: 'STRING' },
                            time: { type: 'INTEGER' },
                            temp: { type: 'INTEGER' },
                            speed: { type: 'NUMBER' },
                            direction: { type: 'BOOLEAN' },
                            mode: { 
                                type: 'STRING', 
                                enum: ['spiga', 'turbo', 'pulizia', 'none'] 
                            }
                        },
                        required: ['index', 'actionType', 'instruction', 'time', 'temp', 'speed', 'direction', 'mode']
                    }
                }
            }
        });

        const parsedArray = JSON.parse(response.text);
        
        // Unisci i parametri elaborati con il testo originale verbatim
        const results = steps.map((rawText, idx) => {
            const found = parsedArray.find(item => item.index === idx) || {};
            const heuristic = parseStepHeuristics(rawText);
            return {
                index: idx,
                actionType: found.actionType || heuristic.actionType,
                originalText: rawText,
                instruction: found.instruction || heuristic.instruction,
                time: typeof found.time === 'number' ? found.time : heuristic.time,
                temp: typeof found.temp === 'number' ? found.temp : heuristic.temp,
                speed: typeof found.speed === 'number' ? found.speed : heuristic.speed,
                direction: typeof found.direction === 'boolean' ? found.direction : heuristic.direction,
                mode: found.mode || heuristic.mode
            };
        });

        console.log(`✅ [GEMINI PARSER] Batch completato con successo: ${results.length} step analizzati.`);
        return results;
    } catch (err) {
        console.warn('⚠️ [GEMINI PARSER] Batch Gemini fallito, utilizzo fallback euristico:', err.message);
        return steps.map((s, idx) => ({ ...parseStepHeuristics(s), index: idx }));
    }
}

/**
 * Analizza l'intero contenuto HTML/testuale di una pagina ricetta Cookidoo direttamente con Gemini
 * ed estrae la ricetta completa (titolo, metadati, ingredienti con note, accessori, consigli e tutti i passaggi).
 * 
 * @param {string} htmlContent - Il contenuto HTML/testuale pulito della pagina Cookidoo
 * @returns {Promise<Object>} Oggetto ricetta completo pronto per RecipeManager
 */
async function parseRecipeFromHtml(htmlContent) {
    if (!htmlContent || typeof htmlContent !== 'string' || htmlContent.trim().length === 0) {
        throw new Error('Contenuto HTML non fornito o vuoto.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY non configurata nel file .env del server.');
    }

    const modelName = getGeminiModel();
    console.log(`🤖 [GEMINI PARSER] Analisi completa pagina HTML con modello: "${modelName}"...`);

    if (!ai) {
        ai = new GoogleGenAI({ apiKey });
    }

    const prompt = `Sei l'assistente ufficiale integrato nel Bimby TM31.
Ti viene fornito il contenuto/codice HTML estratto direttamente dalla pagina di una ricetta di Cookidoo (inclusi eventuali metadati JSON-LD Schema.org e testo dei blocchi).

Il tuo compito è analizzare approfonditamente il documento ed estrarre la ricetta completa in formato JSON rigorosamente strutturato.

REGOLE PER IL FORMATO JSON:
1. TITOLO E METADATI:
   - title: titolo ufficiale della ricetta.
   - info:
     - prepTime: tempo di preparazione attiva (es. "30 min", "15 min").
     - totalTime: tempo totale (es. "2 h", "45 min").
     - portions: porzioni/dosi (es. "8 porzioni", "4 persone").
     - difficulty: difficoltà (es. "Facile", "Media", "Avanzata").

2. INGREDIENTI (con supporto per note e immagini):
   - ingredients: array di oggetti per TUTTI gli ingredienti nell'ordine esatto:
     - text: quantità e nome (es. "250 g di farina tipo 0", "1 uovo").
     - note: eventuale nota, variante, sostituzione o istruzione preparatoria (es. "a pezzi (2 cm)", "+ q.b.", "spellata", "a metà", o null se nessuna).
     - imageUrl: URL dell'immagine dell'ingrediente (rilevabile nei metadati o nei blocchi pre-estratti con tag <img> o srcset, oppure null se assente).

3. ARTICOLI UTILI, CONSIGLI E NOTE PERSONALI:
   - accessories: array di articoli utili e accessori menzionati nella sezione "Articoli utili" o "Accessori" (es. "Teglia da forno", "Carta da forno", "Pellicola trasparente", "Spatola", "Farfalla"). ATTENZIONE: NON INVENTARE articoli utili! Estrai ESCLUSIVAMENTE quelli presenti nella sezione apposita della pagina. Se la pagina non ne elenca, restituisci [].
   - tips: consigli e varianti dello chef se presenti nella sezione "Consigli e varianti", altrimenti null se non presenti (NON INVENTARE consigli!).
   - personalNotes: eventuale nota personale scritta dall'utente. ATTENZIONE: Se il testo contiene "Questa nota è visibile solo all'utente" o "Aggiungi qui le tue modifiche, variazioni o promemoria", NON È UNA NOTA ma il placeholder predefinito vuoto di Cookidoo: in tal caso restituisci RIGOROSAMENTE null. Restituisci null anche se non sono presenti note personali.

4. PASSAGGI DI PREPARAZIONE (TUTTI I PASSAGGI SEQUENZIALI):
   - steps: array di TUTTI i passaggi nell'ordine di preparazione. Per CIASCUN passaggio:
     - index: numero sequenziale a partire da 0.
     - originalText: il testo integrale del passaggio COPIATO E INCOLLATO VERBATIM dalla ricetta (non riassumere, preserva il testo identico).
     - instruction: sintesi chiara e concisa in italiano per il display TM31 (max 8-10 parole).
     - actionType: 
         * 'cook' se richiede rotazione lame o riscaldamento (a qualsiasi velocità).
         * 'weigh' se è un passaggio di pesatura con bilancia.
         * 'mode' se è una modalità speciale (spiga, turbo, pulizia).
         * 'manual' se è un'azione manuale (es. preriscaldare il forno, imburrare una teglia, trasferire in frigo).
     - time: durata in SECONDI (es. 3 min = 180, 5 sec = 5, 0 se manuale o pesatura).
     - temp: temperatura in °C (0 se freddo, 37..100, oppure 120 per Varoma).
     - speed: velocità delle lame da 0 a 10 (usa 0.5 per cucchiaio/soft, 0 se manuale).
     - direction: booleano (true per senso antiorario / lame antiorarie / soft, false per senso orario normale).
     - mode: 'spiga' per impasto, 'turbo' per turbo, 'pulizia' per lavaggio, altrimenti 'none'.

Se la pagina visualizzata non contiene i passaggi di preparazione (ad es. se è un banner che richiede registrazione o login a Cookidoo), restituisci l'array "steps" vuoto.`;

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: [
                { text: prompt },
                { text: `CONTENUTO DELLA PAGINA:\n${htmlContent.substring(0, 180000)}` }
            ],
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: 'OBJECT',
                    properties: {
                        title: { type: 'STRING' },
                        info: {
                            type: 'OBJECT',
                            properties: {
                                prepTime: { type: 'STRING' },
                                totalTime: { type: 'STRING' },
                                portions: { type: 'STRING' },
                                difficulty: { type: 'STRING' }
                            },
                            required: ['prepTime', 'totalTime', 'portions', 'difficulty']
                        },
                        ingredients: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    text: { type: 'STRING' },
                                    note: { type: 'STRING', nullable: true },
                                    imageUrl: { type: 'STRING', nullable: true }
                                },
                                required: ['text']
                            }
                        },
                        accessories: {
                            type: 'ARRAY',
                            items: { type: 'STRING' }
                        },
                        tips: { type: 'STRING', nullable: true },
                        personalNotes: { type: 'STRING', nullable: true },
                        steps: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    index: { type: 'INTEGER' },
                                    originalText: { type: 'STRING' },
                                    instruction: { type: 'STRING' },
                                    actionType: { 
                                        type: 'STRING', 
                                        enum: ['cook', 'weigh', 'mode', 'manual'] 
                                    },
                                    time: { type: 'INTEGER' },
                                    temp: { type: 'INTEGER' },
                                    speed: { type: 'NUMBER' },
                                    direction: { type: 'BOOLEAN' },
                                    mode: { 
                                        type: 'STRING', 
                                        enum: ['spiga', 'turbo', 'pulizia', 'none'] 
                                    }
                                },
                                required: ['index', 'originalText', 'instruction', 'actionType', 'time', 'temp', 'speed', 'direction', 'mode']
                            }
                        }
                    },
                    required: ['title', 'info', 'ingredients', 'steps']
                }
            }
        });

        const parsed = JSON.parse(response.text);

        // Sanificazione rigorosa contro placeholder Cookidoo e allucinazioni
        if (parsed.personalNotes) {
            const pLower = parsed.personalNotes.toLowerCase();
            if (
                pLower.includes("questa nota è visibile") ||
                pLower.includes("questa nota e visibile") ||
                pLower.includes("aggiungi qui le tue modifiche") ||
                pLower.includes("variazioni o promemoria") ||
                parsed.personalNotes.trim().length === 0
            ) {
                parsed.personalNotes = null;
            }
        }
        if (parsed.tips && (parsed.tips.trim().length === 0 || parsed.tips.toLowerCase().includes("nessun consiglio"))) {
            parsed.tips = null;
        }
        if (Array.isArray(parsed.accessories)) {
            parsed.accessories = parsed.accessories.filter(a => a && a.trim().length > 1 && !a.toLowerCase().includes("nessun"));
        }

        console.log(`✅ [GEMINI PARSER] Analisi completata per "${parsed.title}": ${parsed.ingredients?.length || 0} ingredienti, ${parsed.steps?.length || 0} passaggi.`);
        return parsed;
    } catch (err) {
        console.error('❌ [GEMINI PARSER] Errore parseRecipeFromHtml:', err);
        throw err;
    }
}

module.exports = {
    parseRecipeStep,
    parseFullRecipeSteps,
    parseStepHeuristics,
    parseRecipeFromHtml
};
