const http = require('http');
const { io } = require('../frontend/node_modules/socket.io-client');

function doRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: method,
            headers: { 'Content-Type': 'application/json' }
        };
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
    console.log('🧪 === TEST MODALITÀ MOCK E ASSENZA FALSI ERRORI INTERLOCK ===\n');

    const socket = io('http://localhost:3001');
    let latestState = null;
    let interlockAlertReceived = false;

    socket.on('state', s => latestState = s);
    socket.on('INTERLOCK_ALERT', a => {
        interlockAlertReceived = true;
        console.log('   ⚠️ Ricevuto INTERLOCK_ALERT:', a);
    });

    await sleep(500);

    // 1. Reset iniziale
    socket.emit('CMD', { type: 'RESET' });
    await sleep(300);

    // 2. Attiva attenuazione schermo
    console.log('1️⃣ Attivazione attenuazione schermo...');
    socket.emit('SET_SCREEN_DIMMED', { dimmed: true });
    await sleep(500);

    // 3. Risveglia lo schermo
    console.log('2️⃣ Risveglio schermo...');
    socket.emit('SET_SCREEN_DIMMED', { dimmed: false });
    await sleep(500);

    if (interlockAlertReceived) {
        throw new Error('❌ INTERLOCK_ALERT è scattato durante il ciclo di attenuazione schermo!');
    }
    console.log('   ✅ Nessun falso errore interlock durante l\'attenuazione o il risveglio.');

    // 4. Avvio normale in modalità mock (senza simulazione ostacolo)
    console.log('\n3️⃣ Avvio normale in modalità mock (SET_TIME, SET_SPEED, PLAY)...');
    socket.emit('CMD', { type: 'SET_TIME', value: 10 });
    socket.emit('CMD', { type: 'SET_SPEED', value: 2 });
    socket.emit('CMD', { type: 'PLAY' });

    // Attendi transizione a locking -> starting_motor -> cooking
    for (let i = 0; i < 20; i++) {
        await sleep(200);
        if (latestState?.value === 'cooking') break;
    }

    if (latestState?.value !== 'cooking') {
        throw new Error(`❌ Macchina non è entrata in cooking (Stato attuale: ${latestState?.value}, Errore: ${latestState?.context?.errorCode})`);
    }
    console.log('   ✅ Macchina passata regolarmente in stato "cooking" senza blocchi o falsi allarmi.');

    // 5. Attenuazione mentre la macchina sta cucinando
    console.log('\n4️⃣ Attenuazione display DURANTE la cottura...');
    socket.emit('SET_SCREEN_DIMMED', { dimmed: true });
    await sleep(600);
    socket.emit('SET_SCREEN_DIMMED', { dimmed: false });
    await sleep(600);

    if (interlockAlertReceived) {
        throw new Error('❌ INTERLOCK_ALERT è scattato durante la cottura con schermo attenuato!');
    }
    if (latestState?.value !== 'cooking') {
        throw new Error(`❌ La cottura si è interrotta inaspettatamente (Stato: ${latestState?.value})`);
    }
    console.log('   ✅ Display attenuato e risvegliato durante la cottura senza alcun errore!');

    // 6. Stop pulito
    socket.emit('CMD', { type: 'STOP' });
    await sleep(2500);
    socket.emit('CMD', { type: 'RESET' });
    await sleep(300);

    socket.disconnect();
    console.log('\n🎉 TUTTI I TEST HANNO CONFERMATO L\'ASSENZA DI FALSI ERRORI INTERLOCK!');
}

runTest().catch(e => {
    console.error('❌ Test fallito:', e);
    process.exit(1);
});
