const { setup, fromPromise, assign } = require('xstate');
const { servo, bimbySerial, interlock } = require('../hardware/hardwareFactory');

function toHex(val) {
    return val.toString(16).toUpperCase().padStart(2, '0');
}

function getSpeedHex(val) {
    if (val === 0) return '00';
    if (val === 0.5) return '01';
    return (val + 1).toString(16).toUpperCase().padStart(2, '0');
}

let motorStopTime = 0;

const lockServo = fromPromise(async () => {
    console.log('[FSM] Azione: Chiusura coperchio...');

    // 1. Verifica preliminare fisica: boccale inserito nella base
    if (!interlock.isBowlPresent()) {
        console.error('❌ [FSM INTERLOCK] Boccale non rilevato nella sede del Bimby!');
        const err = new Error('Boccale non inserito');
        err.code = 'BOWL_NOT_PRESENT';
        throw err;
    }

    // 2. Movimentazione servomotore braccia di chiusura (90°)
    await servo.lock();

    // 3. Pausa di stabilizzazione meccanica dei microinterruttori (250ms)
    await new Promise(resolve => setTimeout(resolve, 250));

    // 4. Verifica fisica microinterruttore coperchio / braccia bloccate a finecorsa
    const isLidSafe = interlock.isLidLocked();
    if (!isLidSafe) {
        console.error('⚠️ [FSM INTERLOCK] Ostacolo rilevato o coperchio disallineato! Riapertura immediata servo...');
        // Manovra di disimpegno immediata: riapre il servo per non sottoporre l'MG996R a sforzo di stallo
        await servo.unlock();
        const err = new Error('Ostacolo o coperchio non chiuso correttamente');
        err.code = 'LID_NOT_LOCKED';
        throw err;
    }

    console.log('✅ [FSM INTERLOCK] Microinterruttori confermati: Coperchio e Boccale OK. Pronto per avvio lame.');
});

const unlockServo = fromPromise(async () => {
    const elapsed = Date.now() - motorStopTime;
    const remainingWait = Math.max(0, 2000 - elapsed);
    if (remainingWait > 0) {
        console.log(`[FSM] Attesa sicurezza inerzia lame (${remainingWait}ms)...`);
        await new Promise(resolve => setTimeout(resolve, remainingWait));
    }
    console.log('[FSM] Azione: Sblocco coperchio...');
    await servo.unlock();
});

const startMotor = fromPromise(async () => {
    console.log('[FSM] Transizione: Avvio motore (il loop Heartbeat TX trasmette i parametri)...');
});

const stopMotor = fromPromise(async () => {
    console.log('[FSM] Azione: Arresto motore (il loop Heartbeat TX trasmette standby 52 50 00 00 00 0D)...');
    motorStopTime = Date.now();
    console.log('[FSM] Attesa arresto inerzia lame (2 secondi)...');
    await new Promise(resolve => setTimeout(resolve, 2000));
});

const bimbyMachine = setup({
  actors: {
    lockServo,
    unlockServo,
    startMotor,
    stopMotor
  },
  actions: {
    logError: ({ event }) => {
      console.error('[FSM] ERRORE CRITICO RILEVATO:', event.error || event.data || event);
    },
    setInterlockError: assign({
      errorCode: ({ event }) => event.error?.code || event.data?.code || event.code || 'INTERLOCK_ERROR',
      errorMessage: ({ event }) => event.error?.message || event.data?.message || event.message || 'Errore sicurezza microinterruttori coperchio/boccale',
      targetSpeed: 0,
      targetTemp: 0,
      targetTime: 0
    }),
    stopMotorImmediately: () => {
      console.log('[FSM] Fine tempo: Arresto immediato motore e riscaldamento, allarme istantaneo...');
      motorStopTime = Date.now();
      bimbySerial.sendCommand('52 50 00 00 00 0D');
    },
    updateHardware: ({ context }) => {
        console.log(`[FSM] Aggiornamento parametri context: Temp=${context.targetTemp}°C, Vel=${context.targetSpeed}, Dir=${context.antiClockwise ? 'Antiorario' : 'Orario'}`);
    }
  }
}).createMachine({
  id: 'bimby',
  initial: 'idle',
  context: {
    targetSpeed: 0,
    targetTemp: 0,
    targetTime: 0,
    currentTemp: 20, // Temperatura attuale reale NTC
    antiClockwise: false,
    mode: 'normal', // 'normal' | 'spiga'
    errorCode: null,
    errorMessage: null
  },
  on: {
    UPDATE_REAL_TEMP: {
      actions: assign({
        currentTemp: ({ event }) => Number(event.value) || 0
      })
    },
    SET_CURRENT_TEMP: {
      actions: assign({
        currentTemp: ({ event }) => Number(event.value) || 0
      })
    }
  },
  states: {
    idle: {
      on: {
        PLAY: { target: 'locking' },
        START_SPIGA: [
          {
            guard: ({ context }) => (context.currentTemp || 20) <= 50,
            target: 'locking',
            actions: assign({
              mode: 'spiga',
              targetSpeed: 4,
              targetTemp: 0,
              targetTime: ({ event }) => Number(event.time) || 120,
              antiClockwise: false
            })
          },
          {
            actions: ({ context }) => console.warn('[FSM] Impossibile avviare Spiga: temperatura boccale > 50°C (', context.currentTemp, '°C)')
          }
        ],
        RESET: { actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' }) },
        SET_SPEED: { actions: assign({ targetSpeed: ({ event }) => event.value }) },
        SET_TEMP: { actions: assign({ targetTemp: ({ event }) => event.value }) },
        SET_TIME: { actions: assign({ targetTime: ({ event }) => event.value }) },
        SET_CURRENT_TEMP: { actions: assign({ currentTemp: ({ event }) => event.value }) },
        SET_DIRECTION: { actions: assign({ antiClockwise: ({ event }) => Boolean(event.value) }) },
        TOGGLE_DIRECTION: { actions: assign({ antiClockwise: ({ context }) => !context.antiClockwise }) }
      }
    },
    locking: {
      on: {
        STOP: { 
          target: 'stopping_motor_normal', 
          actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' }) 
        },
        RESET: { 
          target: 'stopping_motor_normal', 
          actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' }) 
        }
      },
      invoke: {
        src: 'lockServo',
        onDone: { target: 'starting_motor' },
        onError: { target: 'error', actions: ['logError', 'setInterlockError'] }
      }
    },
    starting_motor: {
      on: {
        STOP: { 
          target: 'stopping_motor_normal', 
          actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' }) 
        },
        RESET: { 
          target: 'stopping_motor_normal', 
          actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' }) 
        },
        INTERLOCK_TRIPPED: {
          target: 'error',
          actions: ['stopMotorImmediately', 'setInterlockError']
        }
      },
      invoke: {
        src: 'startMotor',
        input: ({ context }) => ({
            targetSpeed: context.mode === 'spiga' ? 0 : context.targetSpeed,
            targetTemp: context.mode === 'spiga' ? 0 : context.targetTemp,
            antiClockwise: context.antiClockwise
        }),
        onDone: { target: 'cooking' },
        onError: { target: 'error', actions: 'logError' }
      }
    },
    cooking: {
      on: {
        STOP: { 
          target: 'stopping_motor_normal',
          actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' })
        },
        RESET: { 
          target: 'stopping_motor_normal',
          actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' })
        },
        INTERLOCK_TRIPPED: {
          target: 'error',
          actions: ['stopMotorImmediately', 'setInterlockError']
        },
        TIME_UP: { 
            target: 'alarm',
            actions: [
                assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, mode: 'normal' }),
                'stopMotorImmediately'
            ]
        },
        SET_SPEED: [
          {
            guard: ({ event }) => event.value === 0,
            target: 'stopping_motor_normal',
            actions: [assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' }), 'updateHardware']
          },
          {
            actions: [assign({ targetSpeed: ({ event }) => event.value }), 'updateHardware']
          }
        ],
        SET_TEMP: { actions: [assign({ targetTemp: ({ event }) => event.value }), 'updateHardware'] },
        SET_CURRENT_TEMP: { actions: assign({ currentTemp: ({ event }) => event.value }) },
        SET_TIME: { actions: assign({ targetTime: ({ event }) => event.value }) },
        SET_DIRECTION: { actions: [assign({ antiClockwise: ({ event }) => Boolean(event.value) }), 'updateHardware'] },
        TOGGLE_DIRECTION: { actions: [assign({ antiClockwise: ({ context }) => !context.antiClockwise }), 'updateHardware'] }
      }
    },
    stopping_motor_normal: {
      on: {
        RESET: { actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' }) },
        SET_SPEED: { actions: assign({ targetSpeed: ({ event }) => event.value }) },
        SET_TEMP: { actions: assign({ targetTemp: ({ event }) => event.value }) },
        SET_TIME: { actions: assign({ targetTime: ({ event }) => event.value }) }
      },
      invoke: {
        src: 'stopMotor',
        onDone: { target: 'unlocking_lid' },
        onError: { target: 'error', actions: 'logError' }
      }
    },
    stopping_motor_alarm: {
      always: {
        target: 'alarm',
        actions: [
          assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, mode: 'normal' }),
          'stopMotorImmediately'
        ]
      }
    },
    alarm: {
      on: {
        ACK_ALARM: { 
          target: 'unlocking_lid',
          actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' })
        },
        STOP: { 
          target: 'unlocking_lid',
          actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' })
        },
        RESET: { 
          target: 'unlocking_lid',
          actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' })
        }
      }
    },
    unlocking_lid: {
      on: {
        RESET: { actions: assign({ targetSpeed: 0, targetTemp: 0, targetTime: 0, antiClockwise: false, mode: 'normal' }) },
        SET_SPEED: { actions: assign({ targetSpeed: ({ event }) => event.value }) },
        SET_TEMP: { actions: assign({ targetTemp: ({ event }) => event.value }) },
        SET_TIME: { actions: assign({ targetTime: ({ event }) => event.value }) }
      },
      invoke: {
        src: 'unlockServo',
        onDone: { target: 'idle' },
        onError: { target: 'error', actions: 'logError' }
      }
    },
    error: {
      on: { 
        RESET: { 
          target: 'idle',
          actions: assign({ 
            targetSpeed: 0, 
            targetTemp: 0, 
            targetTime: 0, 
            antiClockwise: false, 
            mode: 'normal',
            errorCode: null,
            errorMessage: null 
          })
        } 
      }
    }
  }
});

module.exports = { bimbyMachine };
