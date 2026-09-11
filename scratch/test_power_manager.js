const http = require('http');
const { io: ioClient } = require('../frontend/node_modules/socket.io-client');
const powerManager = require('../src/system/powerManager');
const bimbySerial = require('../src/hardware/mock/bimbySerialMock');
const servo = require('../src/hardware/mock/servoMock');

const API_BASE = 'http://localhost:3001';

async function runTests() {
    console.log('=====================================================');
    console.log('🧪 TEST SUITE: BIMBY TM31 POWER MANAGER & SAFETY SHUTDOWN');
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
    // TEST 1: Validazione Endpoint REST POST /api/system/power
    // ----------------------------------------------------
    console.log('--- TEST 1: Validazione payload non valido ---');
    try {
        const res = await fetch(`${API_BASE}/api/system/power`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'invalid_action' })
        });
        const data = await res.json();
        assert('Risposta HTTP 400 per azione non valida', res.status === 400);
        assert('Messaggio di errore appropriato', data.error && data.error.includes('non valida'));
    } catch (err) {
        assert(`Chiamata fallita: ${err.message}`, false);
    }

    // ----------------------------------------------------
    // TEST 2: Sequenza di sicurezza Hardware su modulo powerManager
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Verifica sequenza di sicurezza hardware ---');
    let serialPackets = [];
    let servoActions = [];
    let xstateEvents = [];
    let progressEvents = [];

    const mockBimbySerial = {
        sendCommand: async (cmd) => {
            serialPackets.push(cmd);
        }
    };

    const mockServo = {
        unlock: async () => {
            servoActions.push('unlock');
        }
    };

    const mockBimbyService = {
        send: (ev) => {
            xstateEvents.push(ev);
        }
    };

    powerManager.on('progress', (p) => {
        progressEvents.push(p);
    });

    console.log('  -> Avvio executePowerAction("shutdown")...');
    const result = await powerManager.executePowerAction({
        action: 'shutdown',
        bimbyService: mockBimbyService,
        bimbySerial: mockBimbySerial,
        servo: mockServo
    });

    assert('Funzione completata con success: true', result.success === true);
    assert('Pacchetto seriale arresto lame inviato (52 50 00 00 00 0D)', serialPackets.includes('52 50 00 00 00 0D'));
    assert('Evento RESET inviato a XState', xstateEvents.some(e => e.type === 'RESET'));
    assert('Sblocco coperchio eseguito via servo.unlock()', servoActions.includes('unlock'));
    
    // Verifica sequenza temporale progress
    assert('Fase 1 stopping_motor registrata', progressEvents.some(p => p.stage === 'stopping_motor'));
    assert('Fase 2 blade_inertia registrata (50%)', progressEvents.some(p => p.stage === 'blade_inertia' && p.progress === 50));
    assert('Fase 3 unlocking_lid registrata (75%)', progressEvents.some(p => p.stage === 'unlocking_lid' && p.progress === 75));
    assert('Fase 4 executing registrata (100%)', progressEvents.some(p => p.stage === 'executing' && p.progress === 100));

    // ----------------------------------------------------
    // TEST 3: Chiamata Live via REST API ed eventi Socket.IO
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Test Live REST API & Socket.IO Streaming ---');
    const socket = ioClient(API_BASE, { timeout: 5000 });
    await new Promise((resolve) => socket.on('connect', resolve));

    let liveProgress = [];
    socket.on('POWER_PROGRESS', (data) => {
        liveProgress.push(data);
    });

    console.log('  -> Chiamata POST /api/system/power { action: "restart_app" }...');
    const liveRes = await fetch(`${API_BASE}/api/system/power`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restart_app' })
    });
    const liveData = await liveRes.json();
    assert('POST /api/system/power risponde 200', liveRes.status === 200);
    assert('Risposta indica success: true', liveData.success === true);

    // Attesa ricezione streaming progress
    await new Promise((r) => setTimeout(r, 1500));
    assert('Socket.IO ha ricevuto eventi POWER_PROGRESS', liveProgress.length >= 2);
    console.log(`  -> Ricevuti ${liveProgress.length} aggiornamenti di stato socket live.`);

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
