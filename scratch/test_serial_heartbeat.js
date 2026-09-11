const { createActor } = require('xstate');
const { bimbyMachine } = require('../src/fsm/machine');
const bimbySerialMock = require('../src/hardware/mock/bimbySerialMock');
const { startHeartbeat, stopHeartbeat, toHex, getSpeedHex } = require('../src/hardware/serialHeartbeat');
const realSerial = require('../src/hardware/real/bimbySerial');

async function runTests() {
    console.log('==============================================');
    console.log('🧪 TEST SUITE: BIMBY TM31 SERIAL HEARTBEAT & NTC');
    console.log('==============================================\n');

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
    // TEST 1: Helper functions toHex and getSpeedHex
    // ----------------------------------------------------
    console.log('--- TEST 1: Helper hex formatting ---');
    assert('toHex(0) === "00"', toHex(0) === '00');
    assert('toHex(37) === "25"', toHex(37) === '25');
    assert('toHex(100) === "64"', toHex(100) === '64');
    assert('getSpeedHex(0) === "00"', getSpeedHex(0) === '00');
    assert('getSpeedHex(0.5) === "01"', getSpeedHex(0.5) === '01');
    assert('getSpeedHex(1) === "02"', getSpeedHex(1) === '02');
    assert('getSpeedHex(4) === "05"', getSpeedHex(4) === '05');

    // ----------------------------------------------------
    // TEST 2: Buffer Accumulator & NTC Frame Parser (Mock)
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Buffer Accumulator (Fragmented Chunks in Mock) ---');
    let receivedTemps = [];
    bimbySerialMock.on('temperature', (temp) => {
        receivedTemps.push(temp);
    });

    let receivedFrames = [];
    bimbySerialMock.on('rx_frame', (f) => {
        receivedFrames.push(f);
    });

    // Feed fragmented packet: "52 50 46" + " 03 00 0D" (0x46 = 70°C)
    bimbySerialMock._handleIncomingData('52 50 46');
    assert('Buffer holds partial chunk, no frame yet', receivedFrames.length === 0);
    bimbySerialMock._handleIncomingData(' 03 00 0D');
    assert('Frame completed after 0D arrived', receivedFrames.length === 1);
    assert('Temperature 70°C parsed correctly', receivedTemps.length === 1 && receivedTemps[0] === 70);

    // Feed multiple chunks including newline noise
    bimbySerialMock._handleIncomingData('52 50 64 00 00 0D'); // 0x64 = 100°C
    assert('Full packet parsed: 100°C', receivedTemps[1] === 100);

    // ----------------------------------------------------
    // TEST 3: Buffer Accumulator in real/bimbySerial
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Buffer Accumulator & Parsing (real/bimbySerial parser) ---');
    let realTemps = [];
    realSerial.on('temperature', (t) => realTemps.push(t));

    // Simulate raw chunks with byte buffers
    // 0x52 0x50 0x32 (50°C) + 0x00 0x00 0x0D (\r)
    realSerial._handleData(Buffer.from([0x52, 0x50, 0x32]));
    assert('Real driver holds incomplete chunk', realTemps.length === 0);
    realSerial._handleData(Buffer.from([0x00, 0x00, 0x0D]));
    assert('Real driver completed chunk on 0x0D', realTemps.length === 1);
    assert('Real driver parsed 50°C (0x32 = 50)', realTemps[0] === 50);

    // ----------------------------------------------------
    // TEST 4: XState Integration & UPDATE_REAL_TEMP
    // ----------------------------------------------------
    console.log('\n--- TEST 4: XState UPDATE_REAL_TEMP in various states ---');
    const actor = createActor(bimbyMachine);
    actor.start();

    assert('Initial actor currentTemp is 20', actor.getSnapshot().context.currentTemp === 20);

    // Send UPDATE_REAL_TEMP in idle
    actor.send({ type: 'UPDATE_REAL_TEMP', value: 45 });
    assert('Actor currentTemp updated to 45 in idle', actor.getSnapshot().context.currentTemp === 45);

    // Connect serialMock temperature event to actor
    const tempSub = (temp) => {
        actor.send({ type: 'UPDATE_REAL_TEMP', value: temp });
    };
    bimbySerialMock.on('temperature', tempSub);

    // Feed 85°C frame
    bimbySerialMock._handleIncomingData('52 50 55 00 00 0D'); // 0x55 = 85°C
    assert('Actor currentTemp updated to 85°C via serial event', actor.getSnapshot().context.currentTemp === 85);

    // ----------------------------------------------------
    // TEST 5: Heartbeat TX Loop Standby & Active
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Heartbeat TX Loop (250ms cadence) ---');
    let sentPackets = [];
    bimbySerialMock.on('tx', (tx) => {
        const hex = typeof tx === 'string' ? tx : (tx?.hexClean || '');
        sentPackets.push(hex);
    });

    if (!bimbySerialMock.isConnected) {
        await bimbySerialMock.connect();
    }

    // Start heartbeat with short interval for test (50ms)
    startHeartbeat(actor, bimbySerialMock, 50);

    // In idle state, should send standby packets
    await new Promise((r) => setTimeout(r, 160));
    assert('Heartbeat sent at least 2 standby packets', sentPackets.length >= 2);
    const lastStandby = sentPackets[sentPackets.length - 1];
    assert(`Standby packet format is "52 50 00 00 00 0D" (got ${lastStandby})`, lastStandby === '52 50 00 00 00 0D');

    // Simulate cooking state
    actor.send({ type: 'SET_TEMP', value: 90 });
    actor.send({ type: 'SET_SPEED', value: 3 });
    actor.send({ type: 'SET_TIME', value: 60 });
    actor.send({ type: 'PLAY' }); // locking -> starting_motor -> cooking

    // Wait for locking transition (servo movement 300ms + interlock pause 250ms)
    await new Promise((r) => setTimeout(r, 700));
    sentPackets = [];

    await new Promise((r) => setTimeout(r, 120));
    const lastActive = sentPackets[sentPackets.length - 1];
    // 90°C = 0x5A, Vel 3 = 0x04, Dir = 0x00
    console.log('  -> Active state packet sent:', lastActive);
    assert('Active packet sent during cooking', lastActive && lastActive.startsWith('52 50 5A 04 00'));

    // Stop cooking
    actor.send({ type: 'STOP' });
    await new Promise((r) => setTimeout(r, 2200)); // wait inertia delay (2s)
    sentPackets = [];
    await new Promise((r) => setTimeout(r, 120));
    const lastStopped = sentPackets[sentPackets.length - 1];
    assert(`Standby packet resumed after stop (got ${lastStopped})`, lastStopped === '52 50 00 00 00 0D');

    stopHeartbeat();
    actor.stop();

    console.log('\n==============================================');
    console.log(`📊 RESULTS: Passed: ${passed}, Failed: ${failed}`);
    console.log('==============================================');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests().catch((err) => {
    console.error('💥 Unhandled error in tests:', err);
    process.exit(1);
});
