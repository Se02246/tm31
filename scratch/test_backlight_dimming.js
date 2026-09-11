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

async function runTests() {
    console.log('🧪 === TEST 1: REST API GET /api/system/screen-dim ===');
    const getStatus1 = await doRequest('GET', '/api/system/screen-dim');
    console.log('Stato iniziale:', JSON.stringify(getStatus1.body));
    if (getStatus1.status !== 200 || getStatus1.body.isDimmed !== false) {
        throw new Error('GET /api/system/screen-dim non valido');
    }
    console.log('✅ GET iniziale OK');

    console.log('\n🧪 === TEST 2: REST API POST /api/system/screen-dim (dimmed: true) ===');
    const postDim = await doRequest('POST', '/api/system/screen-dim', { dimmed: true });
    console.log('Risposta dim:', JSON.stringify(postDim.body));
    if (postDim.status !== 200 || postDim.body.isDimmed !== true) {
        throw new Error('POST /api/system/screen-dim (dimmed: true) fallito');
    }
    console.log('✅ Attenuazione schermo via REST API OK');

    console.log('\n🧪 === TEST 3: REST API POST /api/system/screen-dim (dimmed: false) ===');
    const postWake = await doRequest('POST', '/api/system/screen-dim', { dimmed: false });
    console.log('Risposta wake:', JSON.stringify(postWake.body));
    if (postWake.status !== 200 || postWake.body.isDimmed !== false) {
        throw new Error('POST /api/system/screen-dim (dimmed: false) fallito');
    }
    console.log('✅ Risveglio schermo via REST API OK');

    console.log('\n🧪 === TEST 4: Socket.IO events (SET_SCREEN_DIMMED / SCREEN_DIMMED_STATE) ===');
    await new Promise((resolve, reject) => {
        const socket = io('http://localhost:3001');
        let initialReceived = false;

        socket.on('connect', () => {
            console.log('📡 Socket connesso:', socket.id);
        });

        socket.on('SCREEN_DIMMED_STATE', (data) => {
            console.log('📡 Ricevuto evento SCREEN_DIMMED_STATE:', JSON.stringify(data));
            if (!initialReceived) {
                initialReceived = true;
                // Test emissione SET_SCREEN_DIMMED true
                console.log('📤 Invio SET_SCREEN_DIMMED { dimmed: true }');
                socket.emit('SET_SCREEN_DIMMED', { dimmed: true });
            } else if (data.isDimmed === true) {
                console.log('✅ Schermo attenuato via Socket confermato!');
                console.log('📤 Invio SET_SCREEN_DIMMED { dimmed: false }');
                socket.emit('SET_SCREEN_DIMMED', { dimmed: false });
            } else if (data.isDimmed === false) {
                console.log('✅ Schermo riattivato via Socket confermato!');
                socket.disconnect();
                resolve();
            }
        });

        socket.on('error', (err) => {
            reject(err);
        });

        setTimeout(() => {
            reject(new Error('Timeout test socket'));
        }, 8000);
    });

    console.log('\n🎉 TUTTI I TEST REST E SOCKET DI ATTENUAZIONE/RISVEGLIO SCHERMO SONO PASSATI CON SUCCESSO!');
}

runTests().catch(err => {
    console.error('❌ ERRORE TEST:', err);
    process.exit(1);
});
