const { createActor } = require('xstate');
const { bimbyMachine } = require('./fsm/machine');
const { bimbySerial, scale } = require('./hardware/hardwareFactory');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const bimbyService = createActor(bimbyMachine);

let lastState = '';

// Ascoltiamo i cambiamenti della macchina a stati
bimbyService.subscribe((snapshot) => {
    const currentState = snapshot.value.toUpperCase();
    if (lastState !== currentState) {
        console.log(`\n[UI] Stato del sistema: >>> ${currentState} <<<`);
        lastState = currentState;
    }
});

// Funzione ricorsiva per il prompt interattivo
function promptUser() {
    rl.question('\n[Comando] > ', (cmd) => {
        const input = cmd.trim().toLowerCase();
        
        if (input === 'play') {
            console.log('\n[USER] -> Evento PLAY');
            bimbyService.send({ type: 'PLAY' });
        } else if (input === 'stop') {
            console.log('\n[USER] -> Evento STOP');
            bimbyService.send({ type: 'STOP' });
        } else if (input === 'peso') {
            scale.read().then(peso => {
                console.log(`\n[BILANCIA] Peso letto in questo istante: ${peso} g`);
            });
        } else if (input === 'tara') {
            console.log('\n[USER] -> Taratura bilancia in corso...');
            scale.tare().then(() => {
                console.log('[BILANCIA] Taratura completata. 0 g.');
            });
        } else if (input === 'reset') {
            console.log('\n[USER] -> Evento RESET (sblocco emergenza/errore)');
            bimbyService.send({ type: 'RESET' });
        } else if (input.startsWith('speed ')) {
            const val = parseInt(input.split(' ')[1], 10);
            if (!isNaN(val) && val >= 0 && val <= 10) {
                console.log(`\n[USER] -> Imposto VELOCITÀ a ${val}`);
                bimbyService.send({ type: 'SET_SPEED', value: val });
            } else {
                console.log('\nErrore: la velocità deve essere tra 0 e 10.');
            }
        } else if (input.startsWith('temp ')) {
            const val = parseInt(input.split(' ')[1], 10);
            if (!isNaN(val) && val >= 0 && val <= 120) {
                console.log(`\n[USER] -> Imposto TEMPERATURA a ${val}°C`);
                bimbyService.send({ type: 'SET_TEMP', value: val });
            } else {
                console.log('\nErrore: la temperatura deve essere tra 0 e 120.');
            }
        } else if (input === 'exit') {
            console.log('\nUscita dal simulatore...');
            process.exit(0);
        } else if (input !== '') {
            console.log('\nComando non valido.');
        }
        
        // Aspettiamo prima di riproporre il prompt, 
        // così diamo tempo ai log asincroni di XState di stampare a schermo.
        setTimeout(promptUser, 1000);
    });
}

async function startInteractiveSystem() {
    console.log('\n=============================================');
    console.log(' BIMBY TM31 SMART - TERMINALE INTERATTIVO');
    console.log('=============================================');
    console.log('Comandi completi disponibili:');
    console.log(' - play / stop     : Avvia o ferma il sistema');
    console.log(' - speed [0-10]    : Imposta la velocità (es. speed 4)');
    console.log(' - temp [0-120]    : Imposta la temperatura (es. temp 100)');
    console.log(' - peso / tara     : Gestione bilancia HX711');
    console.log(' - reset           : Sblocco stato di errore');
    console.log(' - exit            : Chiudi il terminale\n');
    
    await bimbySerial.connect(); 

    bimbyService.start();
    
    setTimeout(promptUser, 500);
}

startInteractiveSystem();
