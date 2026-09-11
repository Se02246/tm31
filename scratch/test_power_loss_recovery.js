const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { RecipeManager } = require('../src/recipe/recipeManager');

const CONFIG_DIR = path.join(__dirname, '../src/config');
const RECOVERY_FILE = path.join(CONFIG_DIR, 'recovery.json');

console.log('🧪 =========================================================');
console.log('🧪 INIZIO TEST POWER LOSS RECOVERY (GESTIONE BLACKOUT)');
console.log('🧪 =========================================================\n');

// Pulizia iniziale se esiste un recovery.json
if (fs.existsSync(RECOVERY_FILE)) {
    fs.unlinkSync(RECOVERY_FILE);
}

// 1. Inizializzazione manager pulito
console.log('1️⃣ Test inizializzazione pulita (senza recovery.json):');
const manager1 = new RecipeManager();
assert.strictEqual(manager1.getPendingRecovery(), null, 'pendingRecovery deve essere null all\'avvio');
console.log('   ✅ pendingRecovery è null come previsto.\n');

// 2. Caricamento ricetta
console.log('2️⃣ Test caricamento ricetta e scrittura su file:');
const sampleRecipe = {
    id: 'test-risotto',
    title: 'Risotto ai Funghi Porcini',
    steps: [
        { instruction: 'Inserire lo scalogno nel boccale', time: 5, speed: 7 },
        { instruction: 'Aggiungere olio e rosolare', time: 180, temp: 100, speed: 1 },
        { instruction: 'Aggiungere riso e tostare', time: 180, temp: 100, speed: 1, direction: true },
        { instruction: 'Aggiungere brodo e cuocere', time: 840, temp: 100, speed: 1, direction: true }
    ]
};

manager1.loadFullRecipe(sampleRecipe);
assert.strictEqual(fs.existsSync(RECOVERY_FILE), true, 'recovery.json deve esistere dopo loadFullRecipe');

let fileContent = JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf-8'));
assert.strictEqual(fileContent.recipe.title, 'Risotto ai Funghi Porcini');
assert.strictEqual(fileContent.currentStepIndex, 0);
assert.strictEqual(fileContent.inPrepScreen, true);
console.log('   ✅ recovery.json creato correttamente con step 0 e inPrepScreen: true.\n');

// 3. Avvio cottura e avanzamento passaggi
console.log('3️⃣ Test startCooking e avanzamento step:');
manager1.startCooking();
fileContent = JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf-8'));
assert.strictEqual(fileContent.inPrepScreen, false, 'inPrepScreen deve essere false');

manager1.nextStep(); // Passo 1 -> Passo 2 (indice 1)
fileContent = JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf-8'));
assert.strictEqual(fileContent.currentStepIndex, 1, 'currentStepIndex deve essere 1');

manager1.nextStep(); // Passo 2 -> Passo 3 (indice 2)
fileContent = JSON.parse(fs.readFileSync(RECOVERY_FILE, 'utf-8'));
assert.strictEqual(fileContent.currentStepIndex, 2, 'currentStepIndex deve essere 2');
console.log(`   ✅ currentStepIndex aggiornato a ${fileContent.currentStepIndex} nel file su disco.\n`);

// 4. Simulazione Blackout / Spegnimento improvviso e riavvio
console.log('4️⃣ Simulazione Blackout & Riavvio (nuova istanza RecipeManager):');
const manager2 = new RecipeManager();
const pending = manager2.getPendingRecovery();
assert.ok(pending, 'pendingRecovery deve essere presente dopo il reboot');
assert.strictEqual(pending.recipe.title, 'Risotto ai Funghi Porcini');
assert.strictEqual(pending.currentStepIndex, 2);
assert.strictEqual(manager2.hasActiveRecipe(), false, 'La ricetta attiva non deve essere attiva finché l\'utente non accetta');
console.log(`   ✅ Rilevato recupero in sospeso: "${pending.recipe.title}" al Passaggio ${pending.currentStepIndex + 1}/${pending.recipe.steps.length}`);

// 5. Test Accettazione del ripristino (RECOVERY_ACCEPT)
console.log('\n5️⃣ Test Accettazione Ripristino (acceptRecovery):');
const acceptedState = manager2.acceptRecovery();
assert.strictEqual(acceptedState.hasRecipe, true);
assert.strictEqual(acceptedState.currentStepIndex, 2);
assert.strictEqual(acceptedState.recipeTitle, 'Risotto ai Funghi Porcini');
assert.strictEqual(manager2.getPendingRecovery(), null, 'pendingRecovery deve essere pulito dopo l\'accettazione');
console.log(`   ✅ Ricetta ripristinata con successo allo step ${acceptedState.currentStepIndex + 1}: "${acceptedState.currentStep.instruction}"`);

// 6. Test Completamento ricetta e cancellazione automatica
console.log('\n6️⃣ Test completamento ricetta e rimozione file:');
manager2.completeRecipe();
assert.strictEqual(fs.existsSync(RECOVERY_FILE), false, 'recovery.json deve essere stato cancellato alla conclusione');
console.log('   ✅ recovery.json eliminato dopo completeRecipe.');

// 7. Test Scarto ripristino (RECOVERY_DISCARD)
console.log('\n7️⃣ Test Scarto Ripristino (discardRecovery):');
// Carichiamo e poi simuliamo reboot
manager1.loadFullRecipe(sampleRecipe);
manager1.nextStep();
assert.strictEqual(fs.existsSync(RECOVERY_FILE), true);

const manager3 = new RecipeManager();
assert.ok(manager3.getPendingRecovery() !== null);
manager3.discardRecovery();

assert.strictEqual(manager3.getPendingRecovery(), null);
assert.strictEqual(fs.existsSync(RECOVERY_FILE), false);
console.log('   ✅ discardRecovery elimina il file e pulisce pendingRecovery.');

console.log('\n🎉 =========================================================');
console.log('🎉 TUTTI I TEST UNITARI POWER LOSS RECOVERY SUPERATI CON SUCCESSO!');
console.log('🎉 =========================================================');
