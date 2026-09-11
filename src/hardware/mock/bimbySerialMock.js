const EventEmitter = require('events');

class BimbySerialMock extends EventEmitter {
    constructor() {
        super();
        this.isConnected = false;
        this.motorSpeed = 0;
        this.heaterActive = false;
        this.targetTemp = 0;
        this.simulatedNtcTemp = 20.0; // Temperatura fisica iniziale boccale (20°C)
        this._rxBuffer = '';
        console.log('[MOCK: Serial] Inizializzato (Seriale CH340G / UART Bimby)');
    }

    async connect() {
        console.log('[MOCK: Serial] Connessione in corso...');
        return new Promise((resolve) => {
            setTimeout(() => {
                this.isConnected = true;
                console.log('[MOCK: Serial] Connesso alla scheda di potenza.');
                resolve(true);
            }, 500);
        });
    }

    async write(data) {
        if (Buffer.isBuffer(data)) {
            const hexString = Array.from(data).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
            return this.sendCommand(hexString);
        } else if (typeof data === 'string') {
            return this.sendCommand(data);
        }
        return false;
    }

    async sendCommand(hexString) {
        if (!this.isConnected) {
            console.error('[MOCK: Serial] ERRORE: Seriale non connessa.');
            return false;
        }

        const hexClean = (hexString || '').trim().replace(/\s+/g, ' ');
        const parts = hexClean.split(' ');
        const rawBytes = parts.map(p => parseInt(p, 16));
        const hexBytes = rawBytes.map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0'));
        const ascii = rawBytes.map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');

        let description = '';
        if (hexClean === '52 50 00 00 0D' || hexClean === '52 50 00 00 00 0D') {
            this.motorSpeed = 0;
            this.heaterActive = false;
            this.targetTemp = 0;
            description = 'STANDBY / ARRESTO (Lame 0, riscaldamento 0)';
        } else if (hexClean.startsWith('52 50')) {
            if (parts.length >= 5) {
                const tempHex = parts[2];
                const speedHex = parts[3];
                const dirHex = parts.length === 6 ? parts[4] : '00';
                const temp = parseInt(tempHex, 16);
                const speed = parseInt(speedHex, 16);
                const dir = dirHex === '01' ? 'Antiorario' : 'Orario';
                
                this.motorSpeed = speed;
                this.heaterActive = temp > 0;
                this.targetTemp = temp;
                description = `PARAMETRI ATTIVI -> Velocità=${speed}, Temp=${temp}°C, Direzione=${dir}`;
            }
        }

        this.emit('tx', {
            hexClean,
            rawBytes,
            hexBytes,
            ascii,
            description,
            count: rawBytes.length
        });

        // Risposta termica NTC simulata dal microcontrollore del TM31:
        // A ogni interrogazione TX, la scheda di potenza risponde con i dati attuali inclusa la temperatura NTC.
        this._updateSimulatedPhysics();
        const ntcHex = Math.round(this.simulatedNtcTemp).toString(16).toUpperCase().padStart(2, '0');
        const responsePacket = `52 50 ${ntcHex} 00 00 0D`;
        
        // Simula la ricezione con buffer accumulator
        this._handleIncomingData(responsePacket);

        return true;
    }

    /**
     * Simula la fisica termica reale:
     * - Se il riscaldamento è attivo e targetTemp > current, riscalda gradualmente (~1°C ogni ciclo di scambio)
     * - Se inattivo o spento, raffredda lentamente verso i 20°C ambiente
     */
    _updateSimulatedPhysics() {
        if (this.heaterActive && this.targetTemp > 0) {
            if (this.simulatedNtcTemp < this.targetTemp) {
                this.simulatedNtcTemp = Math.min(this.targetTemp, this.simulatedNtcTemp + 0.5);
            } else if (this.simulatedNtcTemp > this.targetTemp) {
                this.simulatedNtcTemp = Math.max(this.targetTemp, this.simulatedNtcTemp - 0.2);
            }
        } else {
            // Raffreddamento naturale verso 20°C
            if (this.simulatedNtcTemp > 20) {
                this.simulatedNtcTemp = Math.max(20, this.simulatedNtcTemp - 0.1);
            }
        }
    }

    /**
     * Accumulatore di buffer RX: gestisce frame frammentati o continui delimitati da 0x0D (\r)
     */
    _handleIncomingData(chunk) {
        if (!chunk) return;
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        this._rxBuffer += text;

        // Cerca il terminatore 0D
        while (this._rxBuffer.includes('0D') || this._rxBuffer.includes('\r')) {
            let delimiterIndex = this._rxBuffer.indexOf('0D');
            let delimLen = 2;
            const rIndex = this._rxBuffer.indexOf('\r');
            if (rIndex !== -1 && (delimiterIndex === -1 || rIndex < delimiterIndex)) {
                delimiterIndex = rIndex;
                delimLen = 1;
            }

            const rawFrame = this._rxBuffer.slice(0, delimiterIndex).trim();
            this._rxBuffer = this._rxBuffer.slice(delimiterIndex + delimLen);

            if (rawFrame.length > 0) {
                const completeFrame = `${rawFrame} 0D`;
                this._processRxFrame(completeFrame);
            }
        }
    }

    /**
     * Effettua il parsing del pacchetto RX completo ed emette gli eventi
     */
    _processRxFrame(frameHex) {
        const cleanFrame = frameHex.trim().replace(/\s+/g, ' ');
        const parts = cleanFrame.split(' ');

        this.emit('rx_frame', cleanFrame);
        this.emit('data', cleanFrame);

        // Se il frame rispetta il protocollo Vorwerk TM31: "52 50 {NTC_TEMP} ..."
        if (parts.length >= 3 && parts[0] === '52' && parts[1] === '50') {
            const rawTempHex = parts[2];
            const realTemp = parseInt(rawTempHex, 16);
            if (!isNaN(realTemp)) {
                this.emit('temperature', realTemp);
            }
        }
    }

    simulateIncomingData(data) {
        if (this.isConnected) {
            this._handleIncomingData(data);
        }
    }
}

module.exports = new BimbySerialMock();
