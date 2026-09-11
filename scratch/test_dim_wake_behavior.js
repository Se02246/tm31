const fs = require('fs');
const path = require('path');
const { io } = require('../frontend/node_modules/socket.io-client');

async function runTests() {
    console.log('🧪 === TEST RISVEGLIO LUMINOSITÀ E NON-BLOCCO COMANDI ===\n');

    // TEST 1: Verifica bundle compilato in public/assets/
    console.log('1️⃣ Verifica assenza salvaschermo/orologio nel bundle frontend compilato...');
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    const match = htmlContent.match(/\/assets\/(index-[^"]+\.js)/);
    if (!match) throw new Error('Nessun tag script index-*.js trovato in public/index.html');
    const activeJsFile = match[1];
    console.log(`   ► Bundle attivo: ${activeJsFile}`);
    const jsContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', activeJsFile), 'utf-8');

    // Non deve contenere la scritta del salvaschermo
    if (jsContent.includes('Bimby TM31 • Risparmio Energetico') || jsContent.includes('Tocca lo schermo o ruota la manopola')) {
        throw new Error('❌ Trovata scritta salvaschermo nel bundle compilato!');
    }
    console.log('   ✅ Nessuna scritta o orologio salvaschermo presente nel bundle compilato');

    // Deve contenere la classe pointer-events-none per non bloccare i tocchi
    if (!jsContent.includes('pointer-events-none')) {
        throw new Error('❌ Mancante pointer-events-none nel bundle!');
    }
    console.log('   ✅ Overlay con pointer-events-none presente (nessun blocco dei tocchi)');

    // TEST 2: Socket.IO - Dim display, then send CMD -> verify auto-wake
    console.log('\n2️⃣ Test Socket.IO: Attenuazione e risveglio automatico via CMD...');
    const socket = io('http://localhost:3001');

    await new Promise((resolve, reject) => {
        socket.on('connect', () => {
            console.log('   📡 Connesso a socket server:', socket.id);
            // Attenua
            socket.emit('SET_SCREEN_DIMMED', { dimmed: true });
        });

        let dimmedConfirmed = false;
        socket.on('SCREEN_DIMMED_STATE', (data) => {
            if (data.isDimmed === true && !dimmedConfirmed) {
                dimmedConfirmed = true;
                console.log('   ✅ Schermo attenuato con successo');
                // Ora invia un comando qualsiasi (es. SET_TEMP)
                console.log('   📤 Invocazione comando CMD { type: "SET_TEMP", value: 37 }...');
                socket.emit('CMD', { type: 'SET_TEMP', value: 37 });
            } else if (dimmedConfirmed && data.isDimmed === false) {
                console.log('   ✅ Schermo riattivato istantaneamente alla ricezione del comando CMD!');
                resolve();
            }
        });

        setTimeout(() => reject(new Error('Timeout test CMD wake')), 5000);
    });

    // TEST 3: Socket.IO - Dim display, then send KNOB_TURN -> verify auto-wake
    console.log('\n3️⃣ Test Socket.IO: Attenuazione e risveglio automatico via KNOB_TURN...');
    await new Promise((resolve, reject) => {
        // Attenua di nuovo
        socket.emit('SET_SCREEN_DIMMED', { dimmed: true });

        let dimmedConfirmed = false;
        const onDimState = (data) => {
            if (data.isDimmed === true && !dimmedConfirmed) {
                dimmedConfirmed = true;
                console.log('   ✅ Schermo attenuato');
                console.log('   📤 Invocazione rotazione rotella KNOB_TURN { direction: 1 }...');
                socket.emit('KNOB_TURN', { direction: 1 });
            } else if (dimmedConfirmed && data.isDimmed === false) {
                console.log('   ✅ Schermo riattivato istantaneamente dalla rotazione della rotella!');
                socket.off('SCREEN_DIMMED_STATE', onDimState);
                resolve();
            }
        };
        socket.on('SCREEN_DIMMED_STATE', onDimState);

        setTimeout(() => reject(new Error('Timeout test KNOB wake')), 5000);
    });

    // TEST 4: Socket.IO - Dim display, then send PHYSICAL_BUTTON -> verify auto-wake
    console.log('\n4️⃣ Test Socket.IO: Attenuazione e risveglio automatico via PHYSICAL_BUTTON...');
    await new Promise((resolve, reject) => {
        // Attenua di nuovo
        socket.emit('SET_SCREEN_DIMMED', { dimmed: true });

        let dimmedConfirmed = false;
        const onDimState = (data) => {
            if (data.isDimmed === true && !dimmedConfirmed) {
                dimmedConfirmed = true;
                console.log('   ✅ Schermo attenuato');
                console.log('   📤 Invocazione click tasto fisico PHYSICAL_BUTTON...');
                socket.emit('PHYSICAL_BUTTON', { action: 'click' });
            } else if (dimmedConfirmed && data.isDimmed === false) {
                console.log('   ✅ Schermo riattivato istantaneamente dal tasto fisico!');
                socket.off('SCREEN_DIMMED_STATE', onDimState);
                resolve();
            }
        };
        socket.on('SCREEN_DIMMED_STATE', onDimState);

        setTimeout(() => reject(new Error('Timeout test BUTTON wake')), 5000);
    });

    // Ripristina stato pulito
    socket.emit('CMD', { type: 'SET_TEMP', value: 0 });
    socket.emit('SET_SCREEN_DIMMED', { dimmed: false });
    socket.disconnect();

    console.log('\n🎉 TUTTI I TEST DI RISVEGLIO LUMINOSITÀ E NON-BLOCCO COMANDI SONO STATI SUPERATI!');
}

runTests().catch((err) => {
    console.error('❌ Test fallito:', err);
    process.exit(1);
});
