#!/usr/bin/env bash
# ==============================================================================
# TM31 RETROFIT - SCRIPT DI AGGIORNAMENTO SOFTWARE OTA (OVER-THE-AIR)
# ==============================================================================
# Questo script automatizza l'intero processo di aggiornamento dal repository GitHub:
# 1. Fetch e confronto commit remoto per verificare nuovi aggiornamenti
# 2. Pull e allineamento codice sorgente (git reset --hard / pull)
# 3. Aggiornamento dipendenze Node.js backend (npm install)
# 4. Compilazione del frontend React con Vite (npm run build -> public/)
# 5. Riavvio del demone applicativo tramite PM2
#
# Emette tag strutturati per il backend Node.js:
#   [OTA_STEP:...] -> Notifica avanzamento step
#   [OTA_LOG]      -> Dettaglio log riga per riga
#   [OTA_UP_TO_DATE] -> Sistema già aggiornato
#   [OTA_SUCCESS]  -> Aggiornamento completato
#   [OTA_ERROR]    -> Errore durante l'operazione
# ==============================================================================

set -e

# Configurazione parametri (con fallback da variabili d'ambiente)
PM2_PROCESS_NAME="${PM2_PROCESS_NAME:-all}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
FORCE_UPDATE="${FORCE_UPDATE:-false}"

# Directory del progetto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "[OTA_STEP:INIT] Inizializzazione aggiornamento OTA per Bimby TM31..."
echo "[OTA_LOG] Directory di lavoro: $PROJECT_ROOT"
echo "[OTA_LOG] Branch target: $TARGET_BRANCH"
echo "[OTA_LOG] Processo PM2: $PM2_PROCESS_NAME"

# Gestione trap per cattura errori imprevisti
trap 'echo "[OTA_ERROR] Errore critico durante l'\''esecuzione dello script alla riga $LINENO."; exit 1' ERR

# ------------------------------------------------------------------------------
# FASE 1: Verifica disponibilità aggiornamenti (Git Fetch)
# ------------------------------------------------------------------------------
echo "[OTA_STEP:CHECK] Verifica nuovi commit su origin/$TARGET_BRANCH..."
git fetch origin "$TARGET_BRANCH" --quiet || {
    echo "[OTA_ERROR] Impossibile contattare il repository remoto (Verificare connessione internet / Wi-Fi)."
    exit 1
}

LOCAL_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
REMOTE_COMMIT=$(git rev-parse "origin/$TARGET_BRANCH" 2>/dev/null || echo "unknown")

echo "[OTA_LOG] Commit locale : $LOCAL_COMMIT"
echo "[OTA_LOG] Commit remoto : $REMOTE_COMMIT"

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ] && [ "$FORCE_UPDATE" != "true" ] && [ "$1" != "--force" ]; then
    echo "[OTA_UP_TO_DATE] Il sistema è già all'ultima versione disponibile ($LOCAL_COMMIT)."
    echo "[OTA_SUCCESS] Nessun aggiornamento necessario."
    exit 0
fi

# ------------------------------------------------------------------------------
# FASE 2: Allineamento codice sorgente (Git Pull / Reset)
# ------------------------------------------------------------------------------
echo "[OTA_STEP:PULL] Download aggiornamenti in corso da origin/$TARGET_BRANCH..."
# Utilizziamo reset hard per evitare conflitti con eventuali file autogenerati o modifiche locali temporanee
git reset --hard "origin/$TARGET_BRANCH"
NEW_LOCAL_COMMIT=$(git rev-parse --short HEAD)
echo "[OTA_LOG] Codice allineato con successo al commit: $NEW_LOCAL_COMMIT"
git log -1 --pretty=format:"[OTA_LOG] Ultimo commit: %h - %s (%cr)"
echo ""

# ------------------------------------------------------------------------------
# FASE 3: Aggiornamento dipendenze Backend (npm install)
# ------------------------------------------------------------------------------
echo "[OTA_STEP:NPM_ROOT] Aggiornamento delle dipendenze Node.js (backend)..."
npm install --no-audit --no-fund --loglevel=error
echo "[OTA_LOG] Dipendenze backend aggiornate con successo."

# ------------------------------------------------------------------------------
# FASE 4: Compilazione Frontend React con Vite
# ------------------------------------------------------------------------------
echo "[OTA_STEP:BUILD_FRONTEND] Compilazione bundle frontend React (Vite)..."
cd "$PROJECT_ROOT/frontend"

if [ -f "package.json" ]; then
    echo "[OTA_LOG] Installazione dipendenze frontend..."
    npm install --no-audit --no-fund --loglevel=error

    echo "[OTA_LOG] Esecuzione build di produzione..."
    npm run build
    echo "[OTA_LOG] Frontend compilato con successo e copiato in public/."
else
    echo "[OTA_ERROR] File frontend/package.json non trovato!"
    exit 1
fi

cd "$PROJECT_ROOT"

# ------------------------------------------------------------------------------
# FASE 5: Riavvio del Demone Applicativo (PM2)
# ------------------------------------------------------------------------------
echo "[OTA_STEP:RESTART] Preparazione riavvio del servizio Node.js..."
echo "[OTA_LOG] I dati sono stati aggiornati. Il backend verrà riavviato tra pochi istanti."
echo "[OTA_SUCCESS] Aggiornamento completato con successo. Riavvio in corso..."

# Pausa di sicurezza di 2 secondi per permettere a Socket.IO di inviare gli ultimi messaggi al frontend
sleep 2

if command -v pm2 &> /dev/null; then
    echo "[OTA_LOG] Esecuzione: pm2 restart $PM2_PROCESS_NAME"
    pm2 restart "$PM2_PROCESS_NAME" || pm2 restart all || true
else
    echo "[OTA_LOG] PM2 non rilevato nel PATH di sistema. Riavviare manualmente il server Node.js."
fi

exit 0
