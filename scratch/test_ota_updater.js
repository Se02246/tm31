const http = require('http');
const { io: ioClient } = require('../frontend/node_modules/socket.io-client');
const updater = require('../src/system/updater');

const API_BASE = 'http://localhost:3001';

async function runTests() {
    console.log('=====================================================');
    console.log('🧪 TEST SUITE: BIMBY TM31 OTA UPDATER & SOCKET STREAM');
    console.log('=====================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(desc, condition) {
        if (condition) {
            console.log(`  ✅ PASS: ${desc}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${desc}`);
            failed++;
        }
    }

    // ----------------------------------------------------
    // TEST 1: Modulo updater.getVersionInfo()
    // ----------------------------------------------------
    console.log('--- TEST 1: Verifica getVersionInfo() ---');
    const version = updater.getVersionInfo();
    console.log('  -> Version info rilevata:', version);
    assert('Rilevato oggetto version', version && typeof version === 'object');
    assert('Presenza commit hash', typeof version.commit === 'string' && version.commit.length > 0);
    assert('Presenza branch', typeof version.branch === 'string' && version.branch.length > 0);
    assert('Presenza data release', typeof version.date === 'string' && version.date.length > 0);

    // ----------------------------------------------------
    // TEST 2: REST API GET /api/system/version
    // ----------------------------------------------------
    console.log('\n--- TEST 2: REST API GET /api/system/version ---');
    try {
        const res = await fetch(`${API_BASE}/api/system/version`);
        const data = await res.json();
        console.log('  -> Version da REST API:', data);
        assert('Risposta HTTP 200', res.status === 200);
        assert('Risposta contiene success: true', data.success === true);
        assert('Presenza campo commit', typeof data.commit === 'string' && data.commit.length > 0);
    } catch (err) {
        assert(`Chiamata GET /api/system/version fallita: ${err.message}`, false);
    }

    // ----------------------------------------------------
    // TEST 3: REST API GET /api/system/update/check & status
    // ----------------------------------------------------
    console.log('\n--- TEST 3: REST API GET /api/system/update/check & status ---');
    try {
        const checkRes = await fetch(`${API_BASE}/api/system/update/check`);
        const checkData = await checkRes.json();
        assert('GET /api/system/update/check risponde 200', checkRes.status === 200);
        assert('Check data ha flag updateAvailable o error', checkData.updateAvailable !== undefined || checkData.error !== undefined);

        const statusRes = await fetch(`${API_BASE}/api/system/update/status`);
        const statusData = await statusRes.json();
        assert('GET /api/system/update/status risponde 200', statusRes.status === 200);
        assert('Stato updater iniziale idle o definito', statusData.status !== undefined);
    } catch (err) {
        assert(`Verifica endpoint fallita: ${err.message}`, false);
    }

    // ----------------------------------------------------
    // TEST 4: Socket.IO Live Streaming (OTA_STATUS & OTA_LOG)
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Socket.IO Live Streaming degli aggiornamenti ---');
    const socket = ioClient(API_BASE, { reconnection: false, timeout: 5000 });

    await new Promise((resolve) => {
        socket.on('connect', () => {
            console.log('  -> Socket connesso con ID:', socket.id);
            resolve();
        });
    });

    let receivedLogs = [];
    let receivedStatuses = [];

    socket.on('OTA_LOG', (entry) => {
        receivedLogs.push(entry);
    });

    socket.on('OTA_STATUS', (s) => {
        receivedStatuses.push(s);
    });

    // Avvio aggiornamento tramite REST POST /api/system/update
    console.log('  -> Chiamata POST /api/system/update (simulazione/test)...');
    const startRes = await fetch(`${API_BASE}/api/system/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, branch: 'main' })
    });
    const startData = await startRes.json();
    assert('POST /api/system/update ha avviato il processo', startRes.status === 200 && startData.success);

    // TEST 5: Protezione da esecuzioni concorrenti
    console.log('\n--- TEST 5: Protezione concorrenza (secondo avvio simultaneo) ---');
    const secondRes = await fetch(`${API_BASE}/api/system/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
    });
    const secondData = await secondRes.json();
    assert('Seconda richiesta respinta con codice 400', secondRes.status === 400);
    assert('Messaggio di errore aggiornamento già in corso', secondData.error && secondData.error.includes('già in corso'));

    // Attendi completamento streaming log
    console.log('  -> In attesa dei log Socket.IO...');
    await new Promise((resolve) => {
        const interval = setInterval(() => {
            const lastStatus = receivedStatuses[receivedStatuses.length - 1];
            if (lastStatus && (lastStatus.status === 'success' || lastStatus.status === 'error' || lastStatus.status === 'up_to_date' || lastStatus.status === 'restarting')) {
                clearInterval(interval);
                resolve();
            }
        }, 500);
        // Timeout di sicurezza
        setTimeout(() => {
            clearInterval(interval);
            resolve();
        }, 12000);
    });

    assert('Ricevuti log OTA via Socket.IO', receivedLogs.length > 0);
    console.log(`  -> Ricevuti ${receivedLogs.length} messaggi di log e ${receivedStatuses.length} aggiornamenti di stato.`);

    const hasStepLog = receivedLogs.some(l => l.text && (l.text.includes('[OTA_STEP:') || l.text.includes('[OTA]')));
    assert('I log contengono tag di avanzamento step', hasStepLog);

    socket.disconnect();

    console.log('\n=====================================================');
    console.log(`📊 RISULTATI FINALI: Superati: ${passed}, Falliti: ${failed}`);
    console.log('=====================================================');

    if (failed > 0) process.exit(1);
    else process.exit(0);
}

runTests().catch((err) => {
    console.error('💥 Errore imprevisto durante i test:', err);
    process.exit(1);
});
