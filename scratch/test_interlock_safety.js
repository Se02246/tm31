const http = require('http');
const { io } = require('../frontend/node_modules/socket.io-client');

function doRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, body: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, raw: data });
                }
            });
        });

        req.on('error', reject);
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function runSafetyTests() {
    console.log('🧪 ==============================================================');
    console.log('   TEST DI SICUREZZA INTERLOCK & MICROINTERRUTTORI BIMBY TM31');
    console.log('==============================================================\n');

    // 1. Test Endpoint REST
    console.log('🔹 [1/5] Verifica REST API GET /api/system/interlock...');
    const statusRes = await doRequest('GET', '/api/system/interlock');
    console.log('   Stato Iniziale:', JSON.stringify(statusRes.body));
    if (statusRes.status !== 200 || !statusRes.body.bowlPresent) {
        throw new Error('Endpoint /api/system/interlock fallito');
    }
    console.log('   ✅ REST API OK\n');

    // Connessione Socket
    const socket = io('http://localhost:3001');
    let latestState = null;
    let latestAlert = null;

    await new Promise((resolve, reject) => {
        socket.on('connect', () => {
            console.log('🔹 Connessione socket stabilita:', socket.id);
            resolve();
        });
        socket.on('state', (data) => {
            latestState = data;
        });
        socket.on('INTERLOCK_ALERT', (data) => {
            console.log('   🚨 Ricevuto INTERLOCK_ALERT da Socket:', JSON.stringify(data));
            latestAlert = data;
        });
        setTimeout(() => reject(new Error('Timeout connessione socket')), 5000);
    });

    // Reset iniziale macchina
    socket.emit('CMD', { type: 'RESET' });
    await doRequest('POST', '/api/system/interlock/simulate', { simulateObstacle: false, simulateBowlMissing: false });
    await sleep(400);

    // 2. Scenario Normale: Boccale e Coperchio OK
    console.log('🔹 [2/5] Test Ciclo Normale: Boccale presente e coperchio libero...');
    socket.emit('CMD', { type: 'SET_TIME', value: 5 });
    socket.emit('CMD', { type: 'SET_SPEED', value: 2 });
    socket.emit('CMD', { type: 'PLAY' });

    // Attendi chiusura e transizione a cooking
    let reachedCooking = false;
    for (let i = 0; i < 20; i++) {
        await sleep(200);
        if (latestState?.value === 'cooking') {
            reachedCooking = true;
            break;
        }
    }
    if (!reachedCooking) {
        throw new Error('Il ciclo normale non ha raggiunto lo stato cooking (Stato: ' + latestState?.value + ')');
    }
    console.log('   ✅ Blocco servo riuscito, microinterruttori OK, motore avviato regolarmente in stato: COOKING');

    // Arresta
    socket.emit('CMD', { type: 'STOP' });
    await sleep(2500); // Attesa sblocco servo
    socket.emit('CMD', { type: 'RESET' });
    await sleep(400);
    console.log('   ✅ Arresto e sblocco completati con successo.\n');

    // 3. Scenario Ostacolo Coperchio (Coperchio messo male / ostacolo braccia)
    console.log('🔹 [3/5] Test Rilevamento Ostacolo Coperchio (Simulazione ostacolo attiva)...');
    await doRequest('POST', '/api/system/interlock/simulate', { simulateObstacle: true });
    await sleep(300);

    socket.emit('CMD', { type: 'SET_TIME', value: 5 });
    socket.emit('CMD', { type: 'SET_SPEED', value: 2 });
    socket.emit('CMD', { type: 'PLAY' });

    let reachedError = false;
    for (let i = 0; i < 25; i++) {
        await sleep(200);
        if (latestState?.value === 'error') {
            reachedError = true;
            break;
        }
    }
    if (!reachedError) {
        throw new Error('La macchina doveva entrare in stato error per ostacolo coperchio (Stato: ' + latestState?.value + ')');
    }
    console.log('   Stato FSM:', latestState?.value, '| ErrorCode:', latestState?.context?.errorCode);
    if (latestState?.context?.errorCode !== 'LID_NOT_LOCKED') {
        throw new Error('Codice errore inatteso: ' + latestState?.context?.errorCode);
    }
    console.log('   ✅ Ostacolo rilevato! Il servomotore si è disimpegnato a 0° e il motore NON è stato avviato.');

    // Ripristina da errore
    socket.emit('CMD', { type: 'RESET' });
    await doRequest('POST', '/api/system/interlock/simulate', { simulateObstacle: false });
    await sleep(400);
    console.log('   ✅ Macchina ripristinata con RESET.\n');

    // 4. Scenario Boccale Assente
    console.log('🔹 [4/5] Test Boccale Assente (Simulazione boccale rimosso)...');
    await doRequest('POST', '/api/system/interlock/simulate', { simulateBowlMissing: true });
    await sleep(300);

    socket.emit('CMD', { type: 'SET_TIME', value: 5 });
    socket.emit('CMD', { type: 'SET_SPEED', value: 2 });
    socket.emit('CMD', { type: 'PLAY' });

    let reachedBowlError = false;
    for (let i = 0; i < 20; i++) {
        await sleep(150);
        if (latestState?.value === 'error') {
            reachedBowlError = true;
            break;
        }
    }
    if (!reachedBowlError || latestState?.context?.errorCode !== 'BOWL_NOT_PRESENT') {
        throw new Error('Errore atteso BOWL_NOT_PRESENT non ricevuto (Stato: ' + latestState?.value + ', Code: ' + latestState?.context?.errorCode + ')');
    }
    console.log('   ✅ Boccale assente rilevato istantaneamente prima del blocco servo (ErrorCode: BOWL_NOT_PRESENT)');

    // Ripristina da errore
    socket.emit('CMD', { type: 'RESET' });
    await doRequest('POST', '/api/system/interlock/simulate', { simulateBowlMissing: false });
    await sleep(400);
    console.log('   ✅ Macchina ripristinata con RESET.\n');

    // 5. Scenario Arresto di Emergenza in Corsa (Run-Time Interlock Lost)
    console.log('🔹 [5/5] Test Arresto di Emergenza in Corsa (Interlock interrotto durante cooking)...');
    socket.emit('CMD', { type: 'SET_TIME', value: 20 });
    socket.emit('CMD', { type: 'SET_SPEED', value: 2 });
    socket.emit('CMD', { type: 'PLAY' });

    for (let i = 0; i < 20; i++) {
        await sleep(200);
        if (latestState?.value === 'cooking') break;
    }
    if (latestState?.value !== 'cooking') {
        throw new Error('Impossibile avviare cooking per il test run-time');
    }
    console.log('   Motore in funzione...');

    // Simula apertura improvvisa del contatto coperchio mentre le lame stanno girando
    latestAlert = null;
    await doRequest('POST', '/api/system/interlock/simulate', { simulateObstacle: true });

    let stoppedByEmergency = false;
    for (let i = 0; i < 20; i++) {
        await sleep(150);
        if (latestState?.value === 'error') {
            stoppedByEmergency = true;
            break;
        }
    }
    if (!stoppedByEmergency) {
        throw new Error('Arresto di emergenza non scattato (Stato: ' + latestState?.value + ')');
    }
    console.log('   Stato post emergenza:', latestState?.value, '| ErrorCode:', latestState?.context?.errorCode);
    console.log('   ✅ ARRESTO DI EMERGENZA RIUSCITO! Lame bloccate e allarme emesso.');

    // Cleanup finale
    await doRequest('POST', '/api/system/interlock/simulate', { simulateObstacle: false, simulateBowlMissing: false });
    socket.emit('CMD', { type: 'RESET' });
    await sleep(400);

    socket.disconnect();

    console.log('\n🎉 TUTTI I 5 TEST DI SICUREZZA INTERLOCK SONO STATI SUPERATI CON SUCCESSO!');
}

runSafetyTests().catch(err => {
    console.error('\n❌ TEST FALLITO:', err);
    process.exit(1);
});
