#!/usr/bin/env bash
# ==============================================================================
# TM31 RETROFIT - SETUP BOOT VIDEO SPLASH SCREEN (PLYMOUTH ANIMATO A 30 FPS)
# ==============================================================================
# Questo script automatizza l'installazione e la configurazione dello Splash Screen
# per Raspberry Pi 4, convertendo il video bootanimation.mp4 in frame PNG sequenziali
# e applicando il tema Plymouth "bimby-video" con sfondo #0f172a e refresh a 30 FPS.
# ==============================================================================

set -e

# Colori per i log a terminale
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "\n${BLUE}=============================================================${NC}"
echo -e "${BLUE}   TM31 RETROFIT: SETUP PLYMOUTH BOOT VIDEO ANIMATION        ${NC}"
echo -e "${BLUE}=============================================================${NC}\n"

# 0. Verifica permessi di root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ Errore: questo script deve essere eseguito come root o con sudo.${NC}"
    echo -e "   Esegui: ${YELLOW}sudo bash $0${NC}\n"
    exit 1
fi

# Directory di riferimento
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FRAMES_DIR="$PROJECT_ROOT/assets/splash/frames"
THEME_NAME="bimby-video"
THEME_DIR="/usr/share/plymouth/themes/$THEME_NAME"

# Cerca bootanimation.mp4 in assets/splash/ o nella root del progetto
VIDEO_PATH=""
if [ -f "$PROJECT_ROOT/assets/splash/bootanimation.mp4" ]; then
    VIDEO_PATH="$PROJECT_ROOT/assets/splash/bootanimation.mp4"
elif [ -f "$PROJECT_ROOT/bootanimation.mp4" ]; then
    VIDEO_PATH="$PROJECT_ROOT/bootanimation.mp4"
fi

# 1. Installazione dipendenze di sistema necessarie (Plymouth e ffmpeg)
echo -e "${BLUE}📦 [1/5] Verifica dipendenze di sistema (plymouth, plymouth-themes, ffmpeg)...${NC}"
MISSING_PKGS=()

if ! command -v plymouth &>/dev/null; then
    MISSING_PKGS+=("plymouth")
fi
if [ ! -d "/usr/share/plymouth/themes" ]; then
    MISSING_PKGS+=("plymouth-themes")
fi
if ! command -v ffmpeg &>/dev/null; then
    MISSING_PKGS+=("ffmpeg")
fi

if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
    echo -e "   Installazione dei pacchetti mancanti: ${YELLOW}${MISSING_PKGS[*]}${NC}..."
    apt-get update -qq
    apt-get install -y -qq "${MISSING_PKGS[@]}"
    echo -e "${GREEN}   ✅ Pacchetti installati con successo.${NC}"
else
    echo -e "${GREEN}   ✅ Tutte le dipendenze sono già installate.${NC}"
fi

# 2. Gestione Frame PNG (da cartella frames o estratte da bootanimation.mp4)
echo -e "\n${BLUE}🎬 [2/5] Preparazione della sequenza di frame PNG...${NC}"
mkdir -p "$FRAMES_DIR"

# Controlla se esistono già frame nella cartella
FRAME_COUNT=$(find "$FRAMES_DIR" -maxdepth 1 -name "frame_*.png" | wc -l)

if [ "$FRAME_COUNT" -gt 0 ]; then
    echo -e "${GREEN}   ✅ Trovati $FRAME_COUNT frame già presenti in $FRAMES_DIR${NC}"
elif [ -n "$VIDEO_PATH" ] && [ -f "$VIDEO_PATH" ]; then
    echo -e "   Estrazione dei frame da ${YELLOW}$VIDEO_PATH${NC} a 30 FPS..."
    # Estrazione frame a 30 fps con numerazione a 4 cifre (frame_0000.png ... frame_XXXX.png)
    ffmpeg -y -i "$VIDEO_PATH" -vf "fps=30" "$FRAMES_DIR/frame_%04d.png" -loglevel error
    FRAME_COUNT=$(find "$FRAMES_DIR" -maxdepth 1 -name "frame_*.png" | wc -l)
    echo -e "${GREEN}   ✅ Estratti $FRAME_COUNT frame con successo.${NC}"
else
    echo -e "${RED}❌ Errore: non sono stati trovati né frame PNG in $FRAMES_DIR, né il video bootanimation.mp4.${NC}"
    echo -e "   Posiziona il tuo video in ${YELLOW}$PROJECT_ROOT/assets/splash/bootanimation.mp4${NC}"
    echo -e "   oppure posiziona i file frame_0000.png ... in ${YELLOW}$FRAMES_DIR${NC}\n"
    exit 1
fi

# 3. Creazione Cartella e Tema Plymouth
echo -e "\n${BLUE}🎨 [3/5] Creazione del tema Plymouth '$THEME_NAME'...${NC}"
mkdir -p "$THEME_DIR"

echo -e "   Copia di $FRAME_COUNT frame in $THEME_DIR..."
cp "$FRAMES_DIR"/frame_*.png "$THEME_DIR/"

# 3.1 Scrittura del file di configurazione .plymouth
cat <<EOF > "$THEME_DIR/$THEME_NAME.plymouth"
[Plymouth Theme]
Name=Bimby TM31 Video Boot Animation
Description=Animated 30fps video frame sequence for Bimby TM31 Retrofit
ModuleName=script

[script]
ImageDir=$THEME_DIR
ScriptFile=$THEME_DIR/$THEME_NAME.script
EOF

# 3.2 Scrittura dello script Plymouth (bimby-video.script)
# Calcolo indici per ciclo for e 30 fps stabili
cat <<EOF > "$THEME_DIR/$THEME_NAME.script"
# ==============================================================================
# TEMA PLYMOUTH: BIMBY TM31 VIDEO SPRITE (30 FPS)
# ==============================================================================
# Colore sfondo: #0f172a (R: 15/255=0.059, G: 23/255=0.090, B: 42/255=0.165)
Window.SetBackgroundTopColor(0.059, 0.090, 0.165);
Window.SetBackgroundBottomColor(0.059, 0.090, 0.165);

screen_width = Window.GetWidth();
screen_height = Window.GetHeight();

# Numero totale di frame estratti
MAX_FRAMES = $FRAME_COUNT;

# Precaricamento in memoria di tutti i frame
for (i = 0; i < MAX_FRAMES; i++) {
    if (i < 10)
        filename = "frame_000" + i + ".png";
    else if (i < 100)
        filename = "frame_00" + i + ".png";
    else if (i < 1000)
        filename = "frame_0" + i + ".png";
    else
        filename = "frame_" + i + ".png";

    frames[i] = Image(filename);
}

# Creazione e centratura dello Sprite sullo schermo
sprite = Sprite();

if (frames[0]) {
    image_width = frames[0].GetWidth();
    image_height = frames[0].GetHeight();
    sprite_x = (screen_width - image_width) / 2;
    sprite_y = (screen_height - image_height) / 2;
    sprite.SetX(sprite_x);
    sprite.SetY(sprite_y);
    sprite.SetZ(10);
    sprite.SetImage(frames[0]);
}

# ==============================================================================
# LOGICA DI REFRESH ANIMAZIONE (30 FPS)
# ==============================================================================
# Plymouth chiama SetRefreshFunction a circa 50-60 Hz (refresh video).
# Utilizzando FRAME_DIVISOR = 2 otteniamo una perfetta fluidita a 30 FPS.
FRAME_DIVISOR = 2;
tick = 0;

fun refresh_callback() {
    # Avanzamento in loop continuo finche l'ambiente Kiosk non e pronto
    frame_index = Math.Int(tick / FRAME_DIVISOR) % MAX_FRAMES;
    
    if (frames[frame_index]) {
        sprite.SetImage(frames[frame_index]);
    }
    
    tick = tick + 1;
}

Plymouth.SetRefreshFunction(refresh_callback);

# Dissolvenza quando Plymouth riceve il comando di chiusura (quit)
fun quit_callback() {
    sprite.SetOpacity(0);
}
Plymouth.SetQuitFunction(quit_callback);
EOF

echo -e "${GREEN}   ✅ Tema Plymouth generato con successo ($FRAME_COUNT frame precaricati).${NC}"

# 4. Modifica Parametri di Boot del Kernel (/boot/cmdline.txt o /boot/firmware/cmdline.txt)
echo -e "\n${BLUE}⚙️  [4/5] Configurazione parametri di boot silenzioso (cmdline.txt)...${NC}"

CMDLINE_PATH=""
if [ -f "/boot/firmware/cmdline.txt" ]; then
    CMDLINE_PATH="/boot/firmware/cmdline.txt"
elif [ -f "/boot/cmdline.txt" ]; then
    CMDLINE_PATH="/boot/cmdline.txt"
fi

if [ -n "$CMDLINE_PATH" ]; then
    # Backup di sicurezza
    cp "$CMDLINE_PATH" "${CMDLINE_PATH}.bak_$(date +%Y%m%d_%H%M%S)"

    CURRENT_CMDLINE=$(cat "$CMDLINE_PATH" | tr -d '\r\n')
    NEW_CMDLINE="$CURRENT_CMDLINE"

    # Parametri necessari per nascondere i log del kernel ed attivare Plymouth grafico
    PARAMS=(
        "quiet"
        "splash"
        "loglevel=0"
        "logo.nologo"
        "vt.global_cursor_default=0"
        "plymouth.ignore-serial-consoles"
    )

    for param in "${PARAMS[@]}"; do
        if ! echo "$NEW_CMDLINE" | grep -qw "$param"; then
            NEW_CMDLINE="$NEW_CMDLINE $param"
        fi
    done

    # Scrivi su una singola riga (cmdline.txt richiede obbligatoriamente riga singola)
    echo "$NEW_CMDLINE" | sed 's/  */ /g' | tr -d '\r\n' > "$CMDLINE_PATH"
    echo "" >> "$CMDLINE_PATH"
    echo -e "${GREEN}   ✅ Parametri aggiornati in $CMDLINE_PATH${NC}"
else
    echo -e "${YELLOW}   ⚠️  File cmdline.txt non trovato in /boot o /boot/firmware. Salto modifica automatica cmdline.${NC}"
fi

# Disattiva splash rainbow di default di Raspberry Pi per passare subito a Plymouth
CONFIG_PATH=""
if [ -f "/boot/firmware/config.txt" ]; then
    CONFIG_PATH="/boot/firmware/config.txt"
elif [ -f "/boot/config.txt" ]; then
    CONFIG_PATH="/boot/config.txt"
fi

if [ -n "$CONFIG_PATH" ]; then
    if ! grep -q "^disable_splash=1" "$CONFIG_PATH"; then
        echo "disable_splash=1" >> "$CONFIG_PATH"
        echo -e "${GREEN}   ✅ Aggiunto 'disable_splash=1' a $CONFIG_PATH per disattivare l'arcobaleno iniziale.${NC}"
    fi
fi

# 5. Attivazione Tema e Aggiornamento Initramfs
echo -e "\n${BLUE}🚀 [5/5] Applicazione tema predefinito e aggiornamento initramfs...${NC}"

if command -v plymouth-set-default-theme &>/dev/null; then
    plymouth-set-default-theme -R "$THEME_NAME"
    echo -e "${GREEN}   ✅ Tema '$THEME_NAME' impostato come predefinito e initramfs aggiornato.${NC}"
else
    echo -e "${YELLOW}   ⚠️  plymouth-set-default-theme non trovato. Esegui 'update-initramfs -u' manualmente.${NC}"
fi

if command -v update-initramfs &>/dev/null; then
    update-initramfs -u -k all
fi

echo -e "\n${GREEN}=============================================================${NC}"
echo -e "${GREEN}   🎉 SETUP COMPLETATO CON SUCCESSO!                        ${NC}"
echo -e "${GREEN}=============================================================${NC}"
echo -e "Il tuo Raspberry Pi 4 mostrerà l'animazione di avvio '${THEME_NAME}'"
echo -e "a 30 FPS in loop su sfondo #0f172a al prossimo riavvio (${YELLOW}sudo reboot${NC}).\n"
echo -e "💡 Suggerimento: Per testare l'animazione adesso senza riavviare, esegui:"
echo -e "   ${YELLOW}sudo plymouthd --debug; sudo plymouth --show-splash; sleep 6; sudo plymouth --quit${NC}\n"
