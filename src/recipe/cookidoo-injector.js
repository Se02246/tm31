/**
 * =========================================================================
 * Cookidoo TM31 "Cuciniamo" Injector Script
 * =========================================================================
 * Compatibile con:
 * - Electron Preload Script (<webview preload="...">)
 * - Tampermonkey / Violentmonkey / Greasemonkey (Chromium Kiosk Raspberry Pi)
 * - Browser Extension Content Script
 *
 * Funzionalità:
 * 1. Inietta il pulsante flottante verde Vorwerk "Cuciniamo" in basso a destra.
 * 2. Rileva e seleziona i passaggi di preparazione di Cookidoo (sia da lista che da modale).
 * 3. Invia il testo estratto a http://localhost:3001/api/recipe/parse-step (o :3000)
 *    con { text: "...", autoLoad: true }.
 * 4. Mostra feedback visivo immediato ("Analisi...", "Ricevuto! ✓").
 */

// ==UserScript==
// @name         Cookidoo TM31 "Cuciniamo" Injector
// @namespace    http://localhost:3001/
// @version      1.1
// @description  Estrae lo step di Cookidoo e lo trasmette al Bimby TM31
// @author       Bimby Smart TM31
// @match        https://cookidoo.it/*
// @match        https://*.cookidoo.it/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // Se già inizializzato, riassicura subito la presenza della UI e ritorna
  if (window.__TM31_INJECTOR_INITIALIZED__) {
    window.__TM31_ENSURE_UI__?.();
    return;
  }
  window.__TM31_INJECTOR_INITIALIZED__ = true;

  console.log('🧑‍🍳 [TM31] Inizializzazione Cookidoo Injector...');

  const ENDPOINTS = [
    'http://localhost:3001/api/recipe/parse-step',
    'http://localhost:3000/api/recipe/parse-step'
  ];

  /**
   * Selettori CSS usati da Cookidoo per i passaggi di ricetta
   */
  const STEP_SELECTORS = [
    // Selettori card e step attivi
    '.core-preparation-step--active',
    '.preparation-step.active',
    '[data-qa="preparation-step-active"]',
    
    // Modale o viewer a tutto schermo
    '.recipe-step__instruction',
    '.step-by-step-dialog__step-description',
    '[class*="step-description"]',
    '[class*="StepViewer_instruction"]',

    // Elementi lista passaggi
    'li[id^="preparation-step-"]',
    '[data-qa="preparation-step"]',
    '.core-preparation-steps li',
    '.preparation-step',
    'ol.recipe-steps li',
    '.step-item'
  ];

  /**
   * Trova l'istruzione del passaggio corrente visibile nella pagina Cookidoo
   */
  function extractCurrentStepText() {
    // 1. Se l'utente ha selezionato del testo manualmente con il tocco
    const selectedText = window.getSelection ? window.getSelection().toString().trim() : '';
    if (selectedText.length > 5) {
      console.log('🧑‍🍳 [TM31] Utilizzo testo selezionato manualmente dall\'utente.');
      return selectedText;
    }

    // 2. Cerca tra gli step attivi o visibili
    for (const selector of STEP_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      if (elements && elements.length > 0) {
        // Se c'è un elemento attivo esplicito
        if (selector.includes('active')) {
          const text = elements[0].innerText.trim();
          if (text) return text;
        }

        // Altrimenti trova l'elemento più vicino al centro dello schermo (viewport)
        let bestElem = null;
        let minDistanceToCenter = Infinity;
        const viewportCenterY = window.innerHeight / 2;

        elements.forEach((elem) => {
          const rect = elem.getBoundingClientRect();
          // Solo elementi attualmente visibili a schermo
          if (rect.bottom > 60 && rect.top < window.innerHeight - 60) {
            const elemCenterY = rect.top + rect.height / 2;
            const distance = Math.abs(elemCenterY - viewportCenterY);
            if (distance < minDistanceToCenter) {
              minDistanceToCenter = distance;
              bestElem = elem;
            }
          }
        });

        if (bestElem) {
          const cleanText = bestElem.innerText.replace(/^\d+[\.\s]*/, '').trim();
          if (cleanText.length > 5) {
            return cleanText;
          }
        }

        // Fallback sul primo elemento valido
        const fallbackText = elements[0].innerText.replace(/^\d+[\.\s]*/, '').trim();
        if (fallbackText.length > 5) return fallbackText;
      }
    }

    // 3. Fallback generale: cerca elementi con testo tipico di ricetta
    const paragraphs = document.querySelectorAll('p, li');
    for (const p of paragraphs) {
      const text = p.innerText.trim();
      if (text.match(/(min|sec|gradi|°C|vel|velocit|antiorario|lame|ruotare|cuocere|tritare)/i) && text.length > 10) {
        return text;
      }
    }

    return null;
  }

  /**
   * Estrae il titolo della ricetta corrente
   */
  function extractRecipeTitle() {
    const el = document.querySelector('h1.recipe-title, h1[data-qa="recipe-title"], .recipe-card__title, h1');
    return el ? el.innerText.trim() : 'Ricetta Cookidoo';
  }

  /**
   * Estrae i metadati della ricetta (tempo preparazione, tempo totale, porzioni, difficoltà)
   */
  function extractRecipeInfo() {
    const info = {
      prepTime: null,
      totalTime: null,
      portions: null,
      difficulty: null
    };

    // 1. Selettori con attributi data-qa o ID diretti
    const prepEl = document.querySelector('[data-qa="recipe-prep-time"], #recipe-card-prep-time');
    if (prepEl) info.prepTime = prepEl.innerText.trim();

    const totalEl = document.querySelector('[data-qa="recipe-total-time"], #recipe-card-total-time');
    if (totalEl) info.totalTime = totalEl.innerText.trim();

    const yieldEl = document.querySelector('[data-qa="recipe-yield"], #recipe-card-portions, [data-qa="recipe-portions"]');
    if (yieldEl) info.portions = yieldEl.innerText.trim();

    const diffEl = document.querySelector('[data-qa="recipe-difficulty"], #recipe-card-difficulty');
    if (diffEl) info.difficulty = diffEl.innerText.trim();

    // 2. Scansione elementi badge/dettagli Cookidoo per etichette tipiche
    const badges = document.querySelectorAll('core-feature-badge, .recipe-card__details-item, [class*="feature-badge"], [class*="detail"]');
    badges.forEach((b) => {
      const txt = b.innerText.toLowerCase();
      if ((txt.includes('prep') || txt.includes('attiva')) && !info.prepTime) {
        info.prepTime = b.innerText.replace(/tempo di preparazione|preparazione|tempo attivo/gi, '').trim();
      } else if ((txt.includes('tot') || txt.includes('tempo')) && !info.totalTime && !txt.includes('prep')) {
        info.totalTime = b.innerText.replace(/tempo totale|totale/gi, '').trim();
      } else if ((txt.includes('porzion') || txt.includes('dosi') || txt.includes('persone')) && !info.portions) {
        info.portions = b.innerText.replace(/porzioni|porzione|persone/gi, '').trim();
      } else if (txt.includes('difficolt') && !info.difficulty) {
        info.difficulty = b.innerText.replace(/difficoltà/gi, '').trim();
      }
    });

    return info;
  }

  /**
   * Estrae la lista completa degli ingredienti con supporto per le note, varianti e immagini
   */
  function extractIngredients() {
    const ingredients = [];
    const selectors = [
      'recipe-ingredient',
      '#ingredients li',
      'core-recipe-ingredients li',
      '[data-qa="recipe-ingredient"]',
      '.recipe-ingredient',
      '.core-recipe-ingredients li',
      '[class*="ingredient-item"]'
    ];

    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items && items.length > 0) {
        items.forEach((item) => {
          // Estrai immagine ingrediente (src o srcset)
          const imgEl = item.querySelector('img.recipe-ingredient__image, img[class*="ingredient"], img');
          let imageUrl = null;
          if (imgEl) {
            imageUrl = imgEl.getAttribute('src') || imgEl.src;
            if (!imageUrl || imageUrl.startsWith('data:')) {
              const srcset = imgEl.getAttribute('srcset');
              if (srcset) {
                imageUrl = srcset.split(',')[0].trim().split(' ')[0];
              }
            }
          }

          const nameEl = item.querySelector('.recipe-ingredient__name, [class*="name"]');
          const descEl = item.querySelector('.recipe-ingredient__description, [class*="desc"]');

          let raw = nameEl ? nameEl.innerText.replace(/\s+/g, ' ').trim() : item.innerText.replace(/\s+/g, ' ').trim();
          let note = descEl ? descEl.innerText.replace(/\s+/g, ' ').trim() : null;

          if (raw.length > 1) {
            if (!note) {
              // Rileva note tra parentesi es. "(a pezzi)", "(facoltativo)", "(o burro)"
              const parenMatch = raw.match(/\(([^)]+)\)/);
              if (parenMatch) {
                note = parenMatch[1].trim();
              } else {
                // Rileva note separate da virgola (es. "50 g parmigiano, a pezzetti")
                const parts = raw.split(',');
                if (parts.length > 1 && parts[1].trim().length > 2) {
                  note = parts.slice(1).join(',').trim();
                }
              }
            }

            ingredients.push({
              text: raw,
              note: note,
              imageUrl: imageUrl
            });
          }
        });
        if (ingredients.length > 0) break;
      }
    }

    return ingredients;
  }

  /**
   * Estrae articoli utili e accessori (es. teglia, carta da forno, spatola)
   * ESCLUSIVAMENTE dalla sezione dedicata "Articoli utili" presente nella pagina.
   */
  function extractAccessories() {
    const items = [];
    
    // 1. Cerca per intestazione specifica "Articoli utili"
    const headings = document.querySelectorAll('h2, h3, h4, h5, .core-feature-title, [class*="title"]');
    for (const h of headings) {
      const text = h.innerText.toLowerCase();
      if (text.includes('articoli utili') || text.includes('utensili utili')) {
        const container = h.closest('section, div, core-recipe-accessories') || h.parentElement;
        if (container) {
          const liElements = container.querySelectorAll('li, p, [class*="item"]');
          liElements.forEach(el => {
            const raw = el.innerText.trim();
            if (raw && raw.length > 2 && !raw.toLowerCase().includes('articoli utili') && !items.includes(raw)) {
              items.push(raw);
            }
          });
          if (items.length > 0) return items;
        }
      }
    }

    // 2. Selettori standard Cookidoo
    const selectors = [
      '#accessories li',
      'core-recipe-accessories li',
      '[data-qa="recipe-accessories"] li',
      '.recipe-accessories li'
    ];
    for (const sel of selectors) {
      const elems = document.querySelectorAll(sel);
      if (elems && elems.length > 0) {
        elems.forEach((el) => {
          const text = el.innerText.trim();
          if (text && !items.includes(text)) {
            items.push(text);
          }
        });
        if (items.length > 0) return items;
      }
    }

    return items;
  }

  /**
   * Estrae consigli e suggerimenti dal fondo della pagina ricetta.
   * Restituisce null se non sono presenti consigli.
   */
  function extractTips() {
    const el = document.querySelector('#hints-and-tricks, core-recipe-hints, [data-qa="hints-and-tricks"], .hints-and-tricks, [class*="hints"]');
    if (el) {
      const text = el.innerText.replace(/consigli e varianti|consigli|suggerimenti|varianti/gi, '').trim();
      if (text.length > 5) return text;
    }

    const headings = document.querySelectorAll('h2, h3, h4, h5');
    for (const h of headings) {
      const lower = h.innerText.toLowerCase();
      if (lower.includes('consigli') || lower.includes('varianti')) {
        const container = h.closest('section, div') || h.parentElement;
        if (container) {
          const p = container.querySelector('p, div.content, [class*="description"]');
          if (p) {
            const text = p.innerText.trim();
            if (text.length > 5) return text;
          }
        }
      }
    }

    return null;
  }

  /**
   * Estrae la nota personale dell'utente dalla pagina ricetta Cookidoo.
   * Se non presente o se contiene il placeholder predefinito Cookidoo, restituisce null.
   */
  function extractPersonalNotes() {
    const noteSelectors = [
      '[data-qa="recipe-notes"]',
      '.user-note',
      '#user-note',
      '.recipe-note',
      '[class*="personal-note"]',
      '[class*="user-note"]',
      'core-recipe-notes'
    ];

    let noteText = null;
    for (const sel of noteSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        noteText = el.innerText.trim();
        if (noteText) break;
      }
    }

    if (!noteText) {
      const headings = document.querySelectorAll('h2, h3, h4, h5');
      for (const h of headings) {
        if (h.innerText.toLowerCase().includes('note personal') || h.innerText.toLowerCase().includes('la mia nota')) {
          const container = h.closest('section, div') || h.parentElement;
          if (container) {
            const content = container.querySelector('p, textarea, .content, div');
            if (content) {
              noteText = content.innerText.trim();
              if (noteText) break;
            }
          }
        }
      }
    }

    if (noteText) {
      // Ignora CATEGORICAMENTE il placeholder predefinito di Cookidoo
      if (
        noteText.includes("Questa nota è visibile solo all'utente") ||
        noteText.includes("Aggiungi qui le tue modifiche") ||
        noteText.includes("variazioni o promemoria") ||
        noteText.includes("Questa nota e visibile solo")
      ) {
        return null;
      }
      if (noteText.length > 2) return noteText;
    }

    return null;
  }

  /**
   * Estrae tutti i passaggi di preparazione nell'ordine corretto
   */
  function extractAllSteps() {
    const steps = [];
    const selectors = [
      'li[id^="preparation-step-"]',
      '[data-qa="preparation-step"]',
      '.core-preparation-steps li',
      '#preparation-steps li',
      'ol.recipe-steps li',
      '.step-item'
    ];

    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items && items.length > 0) {
        items.forEach((el) => {
          // Rimuove numeri iniziali es. "1.", "2)", "3 "
          const text = el.innerText.replace(/^\d+[\.\s\)]*/, '').trim();
          if (text.length > 5 && !steps.includes(text)) {
            steps.push(text);
          }
        });
        if (steps.length > 0) break;
      }
    }

    // Selettore fallback se non è stata trovata la lista
    if (steps.length === 0) {
      const current = extractCurrentStepText();
      if (current) steps.push(current);
    }

    return steps;
  }

  /**
   * Assembla l'intero pacchetto ricetta pronto per l'invio
   */
  function extractFullRecipe() {
    const urlParts = (window.location.pathname || '').split('/').filter(Boolean);
    const id = urlParts[urlParts.length - 1] || `recipe-${Date.now()}`;

    return {
      id,
      title: extractRecipeTitle(),
      info: extractRecipeInfo(),
      ingredients: extractIngredients(),
      accessories: extractAccessories(),
      tips: extractTips(),
      personalNotes: extractPersonalNotes(),
      steps: extractAllSteps()
    };
  }

  /**
   * Estrae il contenuto HTML/testuale pulito della pagina per Gemini.
   * Rimuove script, stili, video e icone per ottimizzare i token,
   * preservando l'intera struttura della ricetta, le immagini degli ingredienti e i metadati JSON-LD.
   */
  function extractCleanHtmlForAi() {
    let jsonLd = '';
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      const jsonList = [];
      scripts.forEach(s => {
        const txt = s.innerText.trim();
        if (txt) jsonList.push(txt);
      });
      if (jsonList.length > 0) {
        jsonLd = jsonList.join('\n---\n');
      }
    } catch (e) {}

    // Pre-estrazione ingredienti con immagini dal DOM attivo
    let domIngredientsJson = '[]';
    try {
      const extracted = extractIngredients();
      if (extracted && extracted.length > 0) {
        domIngredientsJson = JSON.stringify(extracted, null, 2);
      }
    } catch (e) {}

    const accessories = extractAccessories();
    const tips = extractTips();
    const personalNotes = extractPersonalNotes();
    const recipeInfo = extractRecipeInfo();

    const rootEl = document.querySelector('recipe-details, .page-content, main, article, body') || document.body;
    const clone = rootEl.cloneNode(true);

    // Rimuove elementi non necessari per l'analisi testuale
    clone.querySelectorAll('script, style, link, svg, video, noscript, iframe, header, footer, nav, .page-header, core-nav, #tm31-cuciniamo-btn, #tm31-hijacked-btn, #tm31-virtual-keyboard').forEach(el => el.remove());
    // Rimuove immagini estranee/pubblicitarie, preservando unicamente le immagini degli ingredienti
    clone.querySelectorAll('img:not(.recipe-ingredient__image):not([class*="ingredient"]):not([src*="ingredient"])').forEach(el => el.remove());

    const cleanHtml = clone.innerHTML.replace(/\s+/g, ' ').trim();

    return `URL: ${window.location.href}\nTITOLO PAGINA: ${document.title}
\n=== SEZIONI VERBATIM RILEVATE DAL DOM COOKIDOO ===
- DIFFICOLTÀ: ${recipeInfo.difficulty ? recipeInfo.difficulty : 'Non specificata'}
- ARTICOLI UTILI / ACCESSORI: ${JSON.stringify(accessories)}
- CONSIGLI E VARIANTI: ${tips ? JSON.stringify(tips) : 'null'}
- NOTA PERSONALE UTENTE: ${personalNotes ? JSON.stringify(personalNotes) : 'null'}
\n=== INGREDIENTI RILEVATI CON IMMAGINI DAL DOM ===\n${domIngredientsJson}
\n=== METADATI SCHEMA.ORG (JSON-LD) ===\n${jsonLd}
\n=== CONTENUTO HTML DELLA RICETTA ===\n${cleanHtml}`;
  }

  /**
   * Invia l'HTML pulito al backend per l'analisi diretta completa con Gemini
   */
  async function sendHtmlToTm31(payload) {
    const ENDPOINTS = [
      'http://localhost:3001/api/recipe/parse-html',
      'http://localhost:3000/api/recipe/parse-html'
    ];

    let lastError = null;
    for (const url of ENDPOINTS) {
      try {
        console.log(`🤖 [TM31] Invio HTML completo a Gemini (${payload.html.length} caratteri) a ${url}...`);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          const data = await response.json();
          console.log('✅ [TM31] Ricetta analizzata con successo da Gemini:', data);
          return { success: true, data };
        } else {
          const errData = await response.json().catch(() => ({}));
          lastError = errData.error || `HTTP ${response.status}`;
        }
      } catch (err) {
        lastError = err.message || 'Errore di connessione';
      }
    }

    return { success: false, error: lastError };
  }

  /**
   * Invia la ricetta estratta manualmente (fallback) al backend locale TM31
   */
  async function sendFullRecipeToTm31(recipeData) {
    const ENDPOINTS = [
      'http://localhost:3001/api/recipe/load-full',
      'http://localhost:3000/api/recipe/load-full'
    ];

    let lastError = null;
    for (const url of ENDPOINTS) {
      try {
        console.log(`📡 [TM31] Invio ricetta (${recipeData.steps.length} step) a ${url}...`);
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(recipeData)
        });

        if (response.ok) {
          const data = await response.json();
          console.log('✅ [TM31] Ricetta caricata con successo dal server Bimby:', data);
          return { success: true, data };
        } else {
          const errData = await response.json().catch(() => ({}));
          lastError = errData.error || `HTTP ${response.status}`;
        }
      } catch (err) {
        lastError = err.message || 'Errore di connessione';
      }
    }

    return { success: false, error: lastError };
  }

  /**
   * Rimuove qualsiasi FAB fluttuante residuo (il vecchio pulsante verde in basso a destra)
   */
  function removeLegacyFab() {
    const fab = document.getElementById('tm31-cuciniamo-btn');
    if (fab) fab.remove();
  }

  /**
   * Salva la ricetta su Cookidoo Cloud nel planner "Oggi cucino" / "La mia settimana"
   * @param {HTMLElement} originalBtn - Il pulsante nativo di Cookidoo
   */
  async function saveToCookidooCloud(originalBtn) {
    try {
      console.log('☁️ [TM31] Sincronizzazione ricetta con Cookidoo Cloud (Oggi cucino)...');

      // 1. Innesca il click nativo sull'elemento originale se presente nel DOM
      if (originalBtn && typeof originalBtn.click === 'function') {
        originalBtn.click();
      }

      // 2. Chiamata diretta all'endpoint transclude Cookidoo per garantire l'aggiunta a "Oggi cucino"
      const recipeMatch = (window.location.pathname || '').match(/(r\d+)/);
      if (recipeMatch) {
        const recipeId = recipeMatch[1];
        const langMatch = (window.location.pathname || '').match(/\/(it-IT|de-DE|fr-FR|en-US|es-ES)\//);
        const lang = langMatch ? langMatch[1] : 'it-IT';
        const transcludeUrl = `/planning/${lang}/transclude/manage-cook-today/${recipeId}`;
        
        await fetch(transcludeUrl, {
          method: 'GET',
          credentials: 'include',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'text/html,application/xhtml+xml,application/xml'
          }
        }).catch(() => {});
      }
    } catch (err) {
      console.warn('⚠️ [TM31] Errore salvataggio Cookidoo Cloud (proseguo comunque con TM31):', err);
    }
  }

  /**
   * Controlla se la pagina corrente è una pagina ricetta (radice: https://cookidoo.it/recipes/recipe)
   */
  function isRecipePage() {
    try {
      const href = (window.location.href || '').toLowerCase();
      const pathname = (window.location.pathname || '').toLowerCase();
      return href.includes('cookidoo.it/recipes/recipe') ||
             pathname.startsWith('/recipes/recipe') ||
             href.includes('/recipes/recipe');
    } catch (e) {
      return false;
    }
  }

  /**
   * Integra e sostituisce la funzione del pulsante nativo "Oggi cucino" di Cookidoo.
   * Utilizza la tecnica del cloneNode per disconnettere i listener e collegare la cottura guidata TM31,
   * salvando contemporaneamente la ricetta su Cookidoo Cloud.
   */
  function ensureCookTodayIntegration() {
    removeLegacyFab();

    if (typeof document === 'undefined' || !document.body) return;
    if (!isRecipePage()) return;

    // Selettori usati da Vorwerk Cookidoo per il pulsante primario d'azione nella scheda ricetta
    const nativeBtnSelectors = [
      '.recipe-card__footer .recipe-card__action-button--primary',
      '.recipe-card__footer button',
      '.recipe-card__footer a',
      '.recipe-card__action-button--primary',
      'button[data-qa*="cook-today"]',
      '[href*="manage-cook-today"] button',
      '[href*="manage-cook-today"]'
    ];

    let originalBtn = null;
    for (const sel of nativeBtnSelectors) {
      const el = document.querySelector(sel);
      if (el && !el.id?.includes('tm31-hijacked-btn')) {
        originalBtn = el;
        break;
      }
    }

    if (!originalBtn) return;
    if (originalBtn.dataset.tm31Hijacked === 'true') return;

    console.log('🧑‍🍳 [TM31] Tasto nativo Cookidoo rilevato:', originalBtn.innerText.trim());

    // Verifica se è il vero tasto "Oggi cucino" o un link tipo "Registrati"
    const btnTextLower = (originalBtn.innerText || '').toLowerCase();
    const isCookTodayBtn = btnTextLower.includes('oggi cucino') || 
                           btnTextLower.includes('cucina oggi') ||
                           originalBtn.getAttribute('href')?.includes('manage-cook-today');

    // 1. Clona l'elemento HTML nativo per rimuovere tutti i listener Vorwerk in memoria
    const clone = originalBtn.cloneNode(true);
    clone.id = 'tm31-hijacked-btn';
    clone.dataset.tm31Hijacked = 'true';
    clone.removeAttribute('href');
    clone.setAttribute('type', 'button');
    clone.style.setProperty('cursor', 'pointer', 'important');
    clone.style.setProperty('user-select', 'none', 'important');
    clone.style.setProperty('webkit-user-select', 'none', 'important');
    clone.style.setProperty('touch-action', 'manipulation', 'important');

    // Se l'utente non è loggato e il tasto originale diceva "Registrati" / "Accedi",
    // impostiamo il testo a "Cuciniamo" per consentirgli di cucinare subito
    if (!isCookTodayBtn && (btnTextLower.includes('registrati') || btnTextLower.includes('accedi') || btnTextLower.includes('prova'))) {
      const span = clone.querySelector('span') || clone;
      span.innerText = 'Cuciniamo';
    }

    // 2. Nascondi l'originale mantenendolo nel DOM per permettere il salvataggio cloud
    originalBtn.style.setProperty('display', 'none', 'important');
    originalBtn.dataset.tm31Hijacked = 'true';

    // 3. Inserisci il clone pulito nella stessa esatta posizione del tasto originale
    originalBtn.parentNode.insertBefore(clone, originalBtn);

    // 4. Collega la nostra funzione combinata: Salvataggio Cloud + Avvio Ricetta Guidata TM31
    clone.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const labelEl = clone.querySelector('span') || clone;
      const originalLabel = labelEl.innerText;

      // Feedback visivo immediato sul pulsante
      clone.style.setProperty('pointer-events', 'none', 'important');
      clone.style.setProperty('opacity', '0.85', 'important');
      labelEl.innerText = 'Caricamento...';

      // A. Salva nel cloud Cookidoo ("Oggi cucino" / "La mia settimana")
      if (isCookTodayBtn) {
        saveToCookidooCloud(originalBtn);
      }

      // B. Estrai e invia l'HTML pulito a Gemini / backend TM31
      try {
        const htmlPayload = {
          html: extractCleanHtmlForAi(),
          url: window.location.href
        };

        console.log('🤖 [TM31] Invio ricetta a Gemini per avvio guidato sul display...');
        const aiResult = await sendHtmlToTm31(htmlPayload);

        if (aiResult.success) {
          labelEl.innerText = 'Iniziato sul Bimby! ✓';
          setTimeout(() => {
            clone.style.setProperty('pointer-events', 'auto', 'important');
            clone.style.setProperty('opacity', '1', 'important');
            labelEl.innerText = originalLabel;
          }, 2500);
          return;
        }

        // Fallback locale manuale
        console.warn('⚠️ [TM31] Fallback su parser locale per la ricetta...');
        const recipeData = extractFullRecipe();
        if (recipeData && recipeData.steps && recipeData.steps.length > 0) {
          const manualResult = await sendFullRecipeToTm31(recipeData);
          if (manualResult.success) {
            labelEl.innerText = 'Iniziato sul Bimby! ✓';
            setTimeout(() => {
              clone.style.setProperty('pointer-events', 'auto', 'important');
              clone.style.setProperty('opacity', '1', 'important');
              labelEl.innerText = originalLabel;
            }, 2500);
            return;
          }
        }

        labelEl.innerText = 'Errore caricamento!';
        setTimeout(() => {
          clone.style.setProperty('pointer-events', 'auto', 'important');
          clone.style.setProperty('opacity', '1', 'important');
          labelEl.innerText = originalLabel;
        }, 2500);

      } catch (err) {
        console.error('❌ [TM31] Errore avvio ricetta guidata:', err);
        labelEl.innerText = 'Errore!';
        setTimeout(() => {
          clone.style.setProperty('pointer-events', 'auto', 'important');
          clone.style.setProperty('opacity', '1', 'important');
          labelEl.innerText = originalLabel;
        }, 2500);
      }
    });
  }

  /**
   * =========================================================================
   * Tastiera Virtuale Touch Screen TM31 per Ricerca e Campi Input
   * =========================================================================
   */
  function setupVirtualKeyboard() {
    if (typeof document === 'undefined' || !document.body) return;
    if (document.getElementById('tm31-virtual-keyboard')) return;

    let activeInput = null;
    let isShift = false;
    let isSymbols = false;

    // Layout tastiera ottimizzati per touchscreen 800x480
    const LAYOUT_NORMAL = [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'],
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '\''],
      ['⇧', 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '-'],
      ['?123', 'Spazio', 'Cerca 🔍', '✕']
    ];

    const LAYOUT_SHIFT = [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'],
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', '"'],
      ['⇧', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ';', ':', '_'],
      ['?123', 'Spazio', 'Cerca 🔍', '✕']
    ];

    const LAYOUT_SYMBOLS = [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '⌫'],
      ['!', '@', '#', '$', '%', '&', '*', '(', ')', '/'],
      ['+', '=', '_', ':', ';', '"', '<', '>', '?', '\''],
      ['ABC', 'è', 'é', 'à', 'ò', 'ù', 'ì', '€', '.', '-'],
      ['ABC', 'Spazio', 'Cerca 🔍', '✕']
    ];

    // Crea contenitore tastiera
    const kbContainer = document.createElement('div');
    kbContainer.id = 'tm31-virtual-keyboard';
    
    Object.assign(kbContainer.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      right: '0',
      width: '100%',
      backgroundColor: '#f1f5f9',
      borderTop: '2px solid #00a651',
      boxShadow: '0 -6px 24px rgba(0, 0, 0, 0.25)',
      zIndex: '2147483646',
      padding: '6px 8px 8px 8px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      boxSizing: 'border-box',
      transform: 'translateY(100%)',
      transition: 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      userSelect: 'none',
      webkitUserSelect: 'none',
      touchAction: 'manipulation'
    });

    // Barra superiore con hint e pulsante nascondi
    const topBar = document.createElement('div');
    Object.assign(topBar.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 4px 3px 4px',
      fontSize: '11px',
      color: '#64748b',
      fontWeight: '600'
    });
    topBar.innerHTML = `
      <span id="tm31-kb-hint">Tastiera Bimby TM31</span>
      <div style="display: flex; gap: 8px;">
        <span id="tm31-kb-clear" style="cursor: pointer; color: #ef4444; padding: 2px 6px; border-radius: 4px; background: #fee2e2;">Pulisci</span>
        <span id="tm31-kb-hide" style="cursor: pointer; color: #475569; padding: 2px 6px; border-radius: 4px; background: #e2e8f0;">Nascondi ✕</span>
      </div>
    `;
    kbContainer.appendChild(topBar);

    // Contenitore tasti
    const keysContainer = document.createElement('div');
    keysContainer.id = 'tm31-kb-keys';
    keysContainer.style.display = 'flex';
    keysContainer.style.flexDirection = 'column';
    keysContainer.style.gap = '4px';
    kbContainer.appendChild(keysContainer);

    document.body.appendChild(kbContainer);

    // Inserimento testo compatibile con React e SPA
    function insertText(char) {
      if (!activeInput) return;
      activeInput.focus();

      const success = document.execCommand && document.execCommand('insertText', false, char);
      if (!success) {
        const start = activeInput.selectionStart ?? (activeInput.value ? activeInput.value.length : 0);
        const end = activeInput.selectionEnd ?? (activeInput.value ? activeInput.value.length : 0);
        const val = activeInput.value || '';
        const nextVal = val.slice(0, start) + char + val.slice(end);

        const valueSetter = Object.getOwnPropertyDescriptor(activeInput, 'value')?.set;
        const prototype = Object.getPrototypeOf(activeInput);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
          prototypeValueSetter.call(activeInput, nextVal);
        } else if (valueSetter) {
          valueSetter.call(activeInput, nextVal);
        } else {
          activeInput.value = nextVal;
        }

        const newPos = start + char.length;
        try { activeInput.setSelectionRange(newPos, newPos); } catch (e) {}
      }

      activeInput.dispatchEvent(new Event('input', { bubbles: true }));
      activeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function deleteText() {
      if (!activeInput) return;
      activeInput.focus();

      const success = document.execCommand && document.execCommand('delete', false, null);
      if (!success) {
        const start = activeInput.selectionStart ?? (activeInput.value ? activeInput.value.length : 0);
        const end = activeInput.selectionEnd ?? (activeInput.value ? activeInput.value.length : 0);
        const val = activeInput.value || '';

        let nextVal = val;
        let newPos = start;

        if (start === end && start > 0) {
          nextVal = val.slice(0, start - 1) + val.slice(end);
          newPos = start - 1;
        } else if (start !== end) {
          nextVal = val.slice(0, start) + val.slice(end);
          newPos = start;
        }

        const valueSetter = Object.getOwnPropertyDescriptor(activeInput, 'value')?.set;
        const prototype = Object.getPrototypeOf(activeInput);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
          prototypeValueSetter.call(activeInput, nextVal);
        } else if (valueSetter) {
          valueSetter.call(activeInput, nextVal);
        } else {
          activeInput.value = nextVal;
        }

        try { activeInput.setSelectionRange(newPos, newPos); } catch (e) {}
      }

      activeInput.dispatchEvent(new Event('input', { bubbles: true }));
      activeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function submitSearch() {
      if (!activeInput) return;
      
      activeInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      activeInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      activeInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

      const form = activeInput.closest('form');
      if (form) {
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"], [data-qa="search-button"]');
        if (submitBtn) {
          submitBtn.click();
        } else if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }

      hideKeyboard();
    }

    function renderKeys() {
      keysContainer.innerHTML = '';
      const currentLayout = isSymbols ? LAYOUT_SYMBOLS : (isShift ? LAYOUT_SHIFT : LAYOUT_NORMAL);

      currentLayout.forEach((rowKeys) => {
        const rowDiv = document.createElement('div');
        rowDiv.style.display = 'flex';
        rowDiv.style.gap = '4px';
        rowDiv.style.justifyContent = 'center';

        rowKeys.forEach((key) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.innerText = key;

          Object.assign(btn.style, {
            flex: key === 'Spazio' ? '4.5' : (key === 'Cerca 🔍' ? '2.5' : (key === '⌫' || key === '⇧' || key === '?123' || key === 'ABC' ? '1.5' : '1')),
            height: '34px',
            fontSize: key.length > 1 && key !== '⌫' && key !== '⇧' ? '13px' : '15px',
            fontWeight: key === 'Cerca 🔍' ? '700' : '600',
            fontFamily: 'Inter, system-ui, sans-serif',
            backgroundColor: key === 'Cerca 🔍' ? '#00a651' : (key === '⇧' && isShift ? '#cbd5e1' : (['⌫', '⇧', '?123', 'ABC', '✕'].includes(key) ? '#e2e8f0' : '#ffffff')),
            color: key === 'Cerca 🔍' ? '#ffffff' : '#1e293b',
            border: '1px solid ' + (key === 'Cerca 🔍' ? '#008a43' : '#cbd5e1'),
            borderRadius: '6px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            outline: 'none',
            touchAction: 'manipulation'
          });

          btn.addEventListener('mousedown', (e) => e.preventDefault());
          btn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (key === '⌫') {
              deleteText();
            } else if (key === '⇧') {
              isShift = !isShift;
              renderKeys();
            } else if (key === '?123') {
              isSymbols = true;
              renderKeys();
            } else if (key === 'ABC') {
              isSymbols = false;
              renderKeys();
            } else if (key === 'Spazio') {
              insertText(' ');
            } else if (key === 'Cerca 🔍') {
              submitSearch();
            } else if (key === '✕') {
              hideKeyboard();
            } else {
              insertText(key);
              if (isShift) {
                isShift = false;
                renderKeys();
              }
            }
          });

          rowDiv.appendChild(btn);
        });

        keysContainer.appendChild(rowDiv);
      });
    }

    renderKeys();

    function showKeyboard(target) {
      activeInput = target || activeInput;
      kbContainer.style.transform = 'translateY(0)';

      const hint = document.getElementById('tm31-kb-hint');
      if (hint && activeInput) {
        hint.innerText = activeInput.placeholder ? `Ricerca: "${activeInput.placeholder}"` : 'Tastiera Bimby TM31';
      }

      setTimeout(() => {
        try { activeInput?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      }, 150);
    }

    function hideKeyboard() {
      kbContainer.style.transform = 'translateY(100%)';
    }

    document.getElementById('tm31-kb-clear')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (activeInput) {
        activeInput.value = '';
        activeInput.dispatchEvent(new Event('input', { bubbles: true }));
        activeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    document.getElementById('tm31-kb-hide')?.addEventListener('click', (e) => {
      e.preventDefault();
      hideKeyboard();
      activeInput?.blur?.();
    });

    function isTextInput(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'textarea') return true;
      if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        return ['text', 'search', 'password', 'email', 'tel', 'url', 'number'].includes(type);
      }
      return Boolean(el.isContentEditable);
    }

    document.addEventListener('focusin', (e) => {
      if (isTextInput(e.target)) {
        showKeyboard(e.target);
      }
    }, true);

    document.addEventListener('click', (e) => {
      if (isTextInput(e.target)) {
        showKeyboard(e.target);
      } else if (!kbContainer.contains(e.target)) {
        hideKeyboard();
      }
    }, true);

    console.log('⌨️ [TM31] Tastiera virtuale touch inizializzata.');
  }

  /**
   * =========================================================================
   * Motore di Scorrimento Touch e Drag-to-Scroll per Kiosk e Simulatore
   * =========================================================================
   * Permette lo scorrimento naturale sia con tocco fisico che con mouse:
   * 1. Scorrimento verticale fluido dell'intera pagina Cookidoo
   * 2. Scorrimento orizzontale e verticale dei caroselli e liste di ricette
   * 3. Inerzia cinetica (momentum scrolling) al rilascio del tocco/trascinamento
   * 4. Disattivazione del drag nativo delle immagini HTML5 che blocca lo swipe
   * 5. Protezione dei clic: i tap/click brevi aprono le ricette, i drag scorrono
   * 6. Ignora i campi input e la tastiera virtuale
   */
  function setupTouchDragScroll() {
    if (typeof document === 'undefined' || !document.body) return;
    if (window.__TM31_TOUCH_SCROLL_INSTALLED__) return;
    window.__TM31_TOUCH_SCROLL_INSTALLED__ = true;

    console.log('👆 [TM31] Inizializzazione motore touch e drag-to-scroll per Cookidoo...');

    // 1. Inietta stili CSS per sbloccare lo scorrimento e impedire il drag delle immagini
    let styleEl = document.getElementById('tm31-touch-scroll-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'tm31-touch-scroll-styles';
      styleEl.textContent = `
        html, body {
          touch-action: pan-x pan-y pinch-zoom !important;
          -webkit-overflow-scrolling: touch !important;
        }
        .core-carousel, [class*="carousel"], [class*="slider"], .core-tile-list,
        [data-qa*="carousel"], core-carousel, core-slider, .horizontal-scroll-container,
        .recipe-card-list--horizontal {
          overflow-x: auto !important;
          scroll-behavior: auto !important;
          -webkit-overflow-scrolling: touch !important;
          touch-action: pan-x pan-y !important;
          scrollbar-width: none !important;
        }
        .core-carousel::-webkit-scrollbar, [class*="carousel"]::-webkit-scrollbar,
        core-carousel::-webkit-scrollbar {
          display: none !important;
        }
        img, a, .recipe-card, [class*="recipe-card"], core-tile {
          -webkit-user-drag: none !important;
          user-select: none !important;
          -webkit-user-select: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(styleEl);
    }

    // Disabilita il drag nativo HTML5 che blocca lo scorrimento delle immagini ricetta
    window.addEventListener('dragstart', (e) => {
      e.preventDefault();
      return false;
    }, { capture: true, passive: false });

    let isDown = false;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let targetContainer = null;
    let scrollDirection = null; // 'horizontal' | 'vertical'
    let lastMoveTime = 0;
    let velocityX = 0;
    let velocityY = 0;
    let momentumAnimId = null;

    function stopMomentum() {
      if (momentumAnimId) {
        cancelAnimationFrame(momentumAnimId);
        momentumAnimId = null;
      }
    }

    function isInteractive(el) {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'option') return true;
      if (el.isContentEditable) return true;
      if (el.closest('#tm31-virtual-keyboard')) return true;
      return false;
    }

    function findScrollable(el, isHorizontal) {
      let curr = el;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        const s = window.getComputedStyle(curr);
        if (isHorizontal) {
          if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && curr.scrollWidth > curr.clientWidth + 4) {
            return curr;
          }
          if (curr.tagName && (
            curr.tagName.toLowerCase() === 'core-carousel' ||
            curr.tagName.toLowerCase() === 'core-slider' ||
            curr.classList.contains('core-carousel') ||
            curr.classList.contains('core-carousel__slider') ||
            curr.classList.contains('core-carousel__track') ||
            curr.classList.contains('core-tile-list') ||
            curr.getAttribute('data-qa')?.includes('carousel')
          )) {
            if (curr.scrollWidth > curr.clientWidth + 2) {
              return curr;
            }
          }
        } else {
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && curr.scrollHeight > curr.clientHeight + 4) {
            return curr;
          }
        }
        curr = curr.parentElement;
      }
      return isHorizontal ? null : (document.scrollingElement || document.documentElement || document.body || window);
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (isInteractive(e.target)) return;

      stopMomentum();

      isDown = true;
      isDragging = false;
      scrollDirection = null;
      startX = e.clientX;
      startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
      lastMoveTime = performance.now();
      velocityX = 0;
      velocityY = 0;
      targetContainer = null;
    }

    function onPointerMove(e) {
      if (!isDown) return;

      const currentX = e.clientX;
      const currentY = e.clientY;
      const dx = currentX - lastX;
      const dy = currentY - lastY;
      const totalDist = Math.hypot(currentX - startX, currentY - startY);

      if (!isDragging) {
        if (totalDist >= 6) {
          isDragging = true;
          if (Math.abs(currentX - startX) > Math.abs(currentY - startY)) {
            scrollDirection = 'horizontal';
            targetContainer = findScrollable(e.target, true);
            if (!targetContainer) {
              scrollDirection = 'vertical';
              targetContainer = findScrollable(e.target, false);
            }
          } else {
            scrollDirection = 'vertical';
            targetContainer = findScrollable(e.target, false);
          }
        } else {
          return;
        }
      }

      const now = performance.now();
      const dt = Math.max(1, now - lastMoveTime);
      lastMoveTime = now;

      velocityX = 0.6 * velocityX + 0.4 * (dx / dt);
      velocityY = 0.6 * velocityY + 0.4 * (dy / dt);

      lastX = currentX;
      lastY = currentY;

      if (targetContainer) {
        if (scrollDirection === 'horizontal') {
          targetContainer.scrollLeft -= dx;
        } else {
          if (targetContainer === window || targetContainer === document.documentElement || targetContainer === document.body || targetContainer === document.scrollingElement) {
            window.scrollBy(0, -dy);
          } else {
            targetContainer.scrollTop -= dy;
          }
        }
      } else {
        window.scrollBy(-dx, -dy);
      }

      if (window.getSelection) {
        window.getSelection().removeAllRanges();
      }
    }

    function onPointerUp(e) {
      if (!isDown) return;
      isDown = false;

      if (isDragging) {
        const suppressClick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          ev.stopImmediatePropagation();
          window.removeEventListener('click', suppressClick, true);
        };
        window.addEventListener('click', suppressClick, true);
        setTimeout(() => window.removeEventListener('click', suppressClick, true), 120);

        const initialVx = velocityX;
        const initialVy = velocityY;
        const container = targetContainer;
        const dir = scrollDirection;

        if (Math.abs(initialVx) > 0.12 || Math.abs(initialVy) > 0.12) {
          let curVx = initialVx * 16;
          let curVy = initialVy * 16;
          const friction = 0.93;

          function step() {
            curVx *= friction;
            curVy *= friction;

            if (Math.abs(curVx) < 0.3 && Math.abs(curVy) < 0.3) {
              stopMomentum();
              return;
            }

            if (container) {
              if (dir === 'horizontal') {
                container.scrollLeft -= curVx;
              } else {
                if (container === window || container === document.documentElement || container === document.body || container === document.scrollingElement) {
                  window.scrollBy(0, -curVy);
                } else {
                  container.scrollTop -= curVy;
                }
              }
            } else {
              window.scrollBy(-curVx, -curVy);
            }

            momentumAnimId = requestAnimationFrame(step);
          }

          momentumAnimId = requestAnimationFrame(step);
        }

        isDragging = false;
      }
    }

    window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
    window.addEventListener('pointercancel', onPointerUp, { capture: true, passive: true });

    console.log('✅ [TM31] Motore touch e drag-to-scroll attivo su Cookidoo.');
  }

  let observerInitialized = false;
  function ensureObserver() {
    if (observerInitialized) return;
    const target = (typeof document !== 'undefined') && (document.documentElement || document.body);
    if (target) {
      try {
        const observer = new MutationObserver(() => {
          ensureAllUI();
        });
        observer.observe(target, { childList: true, subtree: true });
        observerInitialized = true;
      } catch (e) {
        console.warn('[TM31] MutationObserver error:', e);
      }
    }
  }

  let lastReportedAuth = null;
  let lastReportTime = 0;

  function detectAndReportAuthStatus() {
    const now = Date.now();
    if (now - lastReportTime < 2500) return;
    lastReportTime = now;

    try {
      const profileSelectors = [
        '[data-qa="user-profile"]',
        '[data-qa="profile-button"]',
        '[href*="/profile"]',
        '[href*="/logout"]',
        '.navigation-profile',
        '.core-nav-bar__profile',
        'core-nav-bar-profile',
        '[class*="profile-avatar"]',
        '[class*="user-profile"]'
      ];

      const loginSelectors = [
        '[data-qa="login-button"]',
        '[data-qa="nav-login"]',
        'a[href*="/login"]',
        'a[href*="profile/login"]',
        'button[data-qa*="login"]'
      ];

      let profileEl = null;
      for (const sel of profileSelectors) {
        const found = document.querySelector(sel);
        if (found) {
          profileEl = found;
          break;
        }
      }

      let loginEl = null;
      for (const sel of loginSelectors) {
        const found = document.querySelector(sel);
        if (found) {
          loginEl = found;
          break;
        }
      }

      let userName = null;
      if (profileEl) {
        const nameEl = profileEl.querySelector('.navigation-profile__name, [data-qa="user-profile-name"], span, p') || profileEl;
        const txt = nameEl.innerText ? nameEl.innerText.trim() : '';
        if (txt && !txt.toLowerCase().includes('accedi') && !txt.toLowerCase().includes('login') && txt.length < 40) {
          userName = txt;
        }
      }

      let hasAuthStorage = false;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = (localStorage.key(i) || '').toLowerCase();
          if (k.includes('auth') || k.includes('token') || k.includes('user') || k.includes('profile')) {
            hasAuthStorage = true;
            break;
          }
        }
      } catch (e) {}

      const isLoggedIn = Boolean(profileEl || (hasAuthStorage && !loginEl));
      const authKey = `${isLoggedIn}_${userName}`;

      if (authKey !== lastReportedAuth) {
        lastReportedAuth = authKey;
        const endpoints = [
          'http://localhost:3001/api/cookidoo/auth-status',
          'http://localhost:3000/api/cookidoo/auth-status'
        ];

        endpoints.forEach((ep) => {
          fetch(ep, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              loggedIn: isLoggedIn,
              userName: userName,
              url: window.location.href
            })
          }).catch(() => {});
        });
      }
    } catch (e) {}
  }

  function ensureAllUI() {
    ensureObserver();
    if (typeof document === 'undefined' || !document.body) {
      return;
    }
    ensureCookTodayIntegration();
    setupVirtualKeyboard();
    setupTouchDragScroll();
    detectAndReportAuthStatus();
  }

  window.__TM31_ENSURE_UI__ = ensureAllUI;

  // 1. Inietta all'avvio o quando il DOM è pronto
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ensureAllUI);
    } else {
      ensureAllUI();
    }
  }

  // 2. Intercetta cambi di URL dell'SPA Cookidoo (History API pushState e replaceState)
  try {
    const originalPushState = history.pushState;
    history.pushState = function () {
      originalPushState.apply(this, arguments);
      ensureAllUI();
      setTimeout(ensureAllUI, 80);
      setTimeout(ensureAllUI, 300);
      setTimeout(ensureAllUI, 800);
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function () {
      originalReplaceState.apply(this, arguments);
      ensureAllUI();
      setTimeout(ensureAllUI, 80);
      setTimeout(ensureAllUI, 300);
      setTimeout(ensureAllUI, 800);
    };

    window.addEventListener('popstate', () => {
      ensureAllUI();
      setTimeout(ensureAllUI, 80);
      setTimeout(ensureAllUI, 300);
    });
  } catch (e) {}

  // 3. Polling periodico di sicurezza
  setInterval(ensureAllUI, 500);

})();



