const { io } = require('../frontend/node_modules/socket.io-client');
const http = require('http');

async function getJson(path) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:3001${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
            });
        }).on('error', reject);
    });
}

async function postJson(path, body) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const req = http.request(`http://localhost:3001${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function main() {
    console.log('📡 Test 1: Controllo iniziale /api/recipe/recovery');
    const initial = await getJson('/api/recipe/recovery');
    console.log('   Risposta:', initial);

    console.log('\n📖 Test 2: Caricamento ricetta via /api/recipe/load-full');
    const loadRes = await postJson('/api/recipe/load-full', {
        title: 'Polenta Valsugana al Formaggio',
        steps: [
            { instruction: 'Portare a ebollizione l\'acqua salata', time: 600, temp: 100, speed: 1 },
            { instruction: 'Versare la farina di mais a pioggia', time: 60, speed: 3 },
            { instruction: 'Cuocere la polenta mescolando', time: 2400, temp: 100, speed: 2, direction: true }
        ]
    });
    console.log('   Ricetta caricata:', loadRes.success ? 'SI' : 'NO');

    // Avanziamo al passaggio 2 tramite socket
    const socket1 = io('http://localhost:3001');
    await new Promise((res) => socket1.on('connect', res));
    console.log('\n▶️ Test 3: Avanzamento a Passaggio 2 via Socket.IO');
    socket1.emit('RECIPE_NEXT_STEP');
    await new Promise(r => setTimeout(r, 600));

    // Verifichiamo recovery su server
    const recBeforeRestart = await getJson('/api/recipe/recovery');
    console.log('   Recovery presente prima del riavvio:', recBeforeRestart);
    socket1.disconnect();

    console.log('\n🔄 Simulazione Riavvio Docker (simula il Blackout)...');
    const { execSync } = require('child_process');
    execSync('docker restart tm31-bimby-smart-1');
    await new Promise(r => setTimeout(r, 3000));

    console.log('\n⚡ Test 4: Controllo /api/recipe/recovery dopo il riavvio...');
    const recAfterRestart = await getJson('/api/recipe/recovery');
    console.log('   Recovery dopo reboot:', recAfterRestart);
    if (!recAfterRestart.hasRecovery || recAfterRestart.stepIndex !== 2) {
        throw new Error('Recovery non rilevato correttamente dopo il riavvio!');
    }

    console.log('\n🔌 Test 5: Connessione Socket.IO e ricezione RECOVERY_AVAILABLE');
    const socket2 = io('http://localhost:3001');
    const recoveryPromise = new Promise((resolve) => {
        socket2.on('RECOVERY_AVAILABLE', (data) => {
            console.log('   ⚡ RICEVUTO EVENTO SOCKET RECOVERY_AVAILABLE:', data);
            resolve(data);
        });
    });

    const receivedRecovery = await recoveryPromise;
    if (receivedRecovery.recipeTitle !== 'Polenta Valsugana al Formaggio' || receivedRecovery.stepIndex !== 2) {
        throw new Error('Dati evento RECOVERY_AVAILABLE non corretti!');
    }

    console.log('\n🟢 Test 6: Invio RECOVERY_ACCEPT e ricezione RECIPE_STATE');
    const recipeStatePromise = new Promise((resolve) => {
        socket2.on('RECIPE_STATE', (state) => {
            if (state.hasRecipe && state.currentStepIndex === 1) {
                console.log('   ✅ RICEVUTO RECIPE_STATE CON RICETTA ATTIVA ALLO STEP 2:', state.currentStep.instruction);
                resolve(state);
            }
        });
    });

    socket2.emit('RECOVERY_ACCEPT');
    await recipeStatePromise;

    console.log('\n🛑 Test 7: Reset finale ricetta');
    socket2.emit('RECIPE_RESET');
    await new Promise(r => setTimeout(r, 600));

    const finalRecovery = await getJson('/api/recipe/recovery');
    console.log('   Recovery dopo reset:', finalRecovery);
    if (finalRecovery.hasRecovery) {
        throw new Error('Recovery non deve essere attivo dopo il reset!');
    }

    socket2.disconnect();
    console.log('\n🎉 TUTTI I TEST LIVE DOCKER + SOCKET.IO + POWER LOSS SUPERATI!');
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Errore test:', err);
    process.exit(1);
});
