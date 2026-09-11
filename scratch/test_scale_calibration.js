const assert = require('assert');
const scale = require('../src/hardware/mock/scaleMock');
const { getScaleCalibration, saveSettings } = require('../src/config/settingsManager');

console.log('🧪 =========================================================');
console.log('🧪 INIZIO TEST CALIBRAZIONE BILANCIA (HX711)');
console.log('🧪 =========================================================\n');

// 1. Reset iniziale
console.log('1️⃣ Test Reset Calibrazione di Fabbrica:');
const resetStatus = scale.resetCalibration();
assert.strictEqual(resetStatus.calibrationFactor, 420.0, 'Fattore di fabbrica deve essere 420.0');
console.log('   ✅ Fattore di calibrazione di fabbrica impostato a 420.0 ticks/g.\n');

// 2. Lettura stato iniziale
console.log('2️⃣ Test Lettura Stato Calibrazione:');
const status = scale.getCalibrationStatus();
assert.strictEqual(status.success, true);
assert.strictEqual(typeof status.currentRaw, 'number');
assert.strictEqual(typeof status.currentWeight, 'number');
console.log(`   ✅ Stato iniziale: Raw=${status.currentRaw}, Offset=${status.zeroOffset}, Fattore=${status.calibrationFactor}\n`);

// 3. Fase 1: Calibrazione Zero a vuoto
console.log('3️⃣ Test Fase 1: Registrazione Zero a Vuoto:');
const zeroRes = scale.calibrateZero();
assert.strictEqual(zeroRes.success, true);
assert.ok(zeroRes.zeroOffset > 8000000, 'zeroOffset deve essere nell\'intorno di 8388608 (24-bit)');
console.log(`   ✅ Zero a vuoto registrato: ${zeroRes.zeroOffset}\n`);

// 4. Simulazione deformazione cella di carico (sensore starato)
console.log('4️⃣ Test Simulazione Sensore Starato (es. cella con risposta alterata):');
// Supponiamo che il sensore reale per 1000g generi un delta di 425600 ticks (cioè 425.6 ticks/g invece di 420.0)
scale.setWeight(1000);
// Forziamo un delta alterato:
scale.currentRaw = scale.zeroOffset + 425600;

// Prima della ricalibrazione, con fattore 420.0 la lettura sarebbe imprecisa: 425600 / 420.0 = 1013.3 g (+1.3% di errore)
const uncalibratedWeight = Math.round((425600 / 420.0) * 10) / 10;
console.log(`   ⚠️ Con sensore starato e vecchio fattore: peso letto = ${uncalibratedWeight} g (Errore di +13.3 g!)`);

// 5. Fase 2: Ricalcolo Fattore con Peso Noto (Bottiglia da 1000g)
console.log('\n5️⃣ Test Fase 2: Ricalcolo con Peso Campione Noto (1000g):');
// Nel mock, facciamo sì che getRawValue restituisca il valore con il delta alterato
scale.physicalWeight = 1000;
scale.currentRaw = scale.zeroOffset + 425600;

// Eseguiamo la calibrazione con peso noto
const calibRes = scale.calibrateWithWeight(1000);
assert.strictEqual(calibRes.success, true);
assert.strictEqual(calibRes.knownWeightGrams, 1000);
console.log(`   ✅ Vecchio Fattore : ${calibRes.oldFactor} ticks/g`);
console.log(`   ✅ Nuovo Fattore   : ${calibRes.newFactor} ticks/g`);

// 6. Verifica peso corretto dopo la calibrazione
console.log('\n6️⃣ Verifica Peso Rilevato dopo la Calibrazione:');
scale.read().then(calibratedWeight => {
    console.log(`   🎯 Peso letto dopo calibrazione: ${calibratedWeight} g`);
    assert.strictEqual(calibratedWeight, 1000.0, 'Il peso deve risultare esattamente 1000.0 g!');
    console.log('   ✅ Il peso è calibrato con precisione assoluta a 1000.0 g!\n');

    // 7. Verifica persistenza su settings.json
    console.log('7️⃣ Verifica Persistenza su settings.json:');
    const savedCalib = getScaleCalibration();
    assert.strictEqual(savedCalib.calibrationFactor, calibRes.newFactor);
    assert.strictEqual(savedCalib.zeroOffset, calibRes.zeroOffset);
    console.log(`   ✅ Parametri salvati su settings.json: Fattore=${savedCalib.calibrationFactor}, Offset=${savedCalib.zeroOffset}\n`);

    // Ripristino per lasciare lo stato pulito
    scale.resetCalibration();
    console.log('🎉 =========================================================');
    console.log('🎉 TUTTI I TEST UNITARI CALIBRAZIONE BILANCIA SUPERATI CON SUCCESSO!');
    console.log('🎉 =========================================================');
}).catch(err => {
    console.error('❌ Errore test:', err);
    process.exit(1);
});
