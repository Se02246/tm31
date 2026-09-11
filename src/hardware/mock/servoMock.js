class ServoMock {
    constructor() {
        this.angle = 0; // 0 gradi = Aperto, 90 gradi = Chiuso
        this.isLocked = false;
        console.log('[MOCK: Servo] Inizializzato (Servomotore MG996R)');
    }

    async setAngle(degrees) {
        if (degrees < 0 || degrees > 180) {
            console.error(`[MOCK: Servo] ERRORE: Angolo non valido (${degrees}°). Deve essere tra 0 e 180.`);
            return false;
        }

        console.log(`[MOCK: Servo] Movimento in corso verso: ${degrees}°...`);
        
        return new Promise(resolve => {
            // Simula il tempo meccanico di rotazione (es. 500ms)
            setTimeout(() => {
                this.angle = degrees;
                this.isLocked = (degrees >= 90); // Supponiamo che 90 gradi attivi il blocco meccanico
                console.log(`[MOCK: Servo] Raggiunto: ${degrees}°. Stato Blocco: ${this.isLocked ? 'CHIUSO' : 'APERTO'}`);
                try {
                    const interlockManager = require('../interlockManager');
                    interlockManager.notifyServoLocked(this.isLocked);
                } catch (e) {}
                resolve(true);
            }, 500);
        });
    }

    async lock() {
        return this.setAngle(90);
    }

    async unlock() {
        return this.setAngle(0);
    }
    
    getAngle() {
        return this.angle;
    }
}

module.exports = new ServoMock();
