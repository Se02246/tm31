const EventEmitter = require('events');

class BimbySerialReal extends EventEmitter {
    constructor() {
        super();
        this.isConnected = false;
        this.port = null;
        this.portPath = process.env.BIMBY_SERIAL_PORT || '/dev/serial0';
        this.baudRate = parseInt(process.env.BIMBY_BAUD_RATE, 10) || 9600;
        this.motorSpeed = 0;
        this.heaterActive = false;
        this._rxBuffer = Buffer.alloc(0);
        console.log(`[REAL: Serial] Driver Bimby TM31 inizializzato (Porta: ${this.portPath}, Baud: ${this.baudRate})`);
    }

    async connect() {
        return new Promise((resolve) => {
            let SerialPort;
            try {
                // Caricamento dinamico per non fallire in ambienti senza serialport installato
                SerialPort = require('serialport').SerialPort;
            } catch (err) {
                console.warn('[REAL: Serial] Modulo "serialport" non installato o non supportato su questo sistema:', err.message);
                return resolve(false);
            }

            try {
                this.port = new SerialPort({
                    path: this.portPath,
                    baudRate: this.baudRate,
                    autoOpen: false
                });

                this.port.open((err) => {
                    if (err) {
                        console.error(`[REAL: Serial] Impossibile aprire la porta seriale ${this.portPath}:`, err.message);
                        this.isConnected = false;
                        return resolve(false);
                    }

                    this.isConnected = true;
                    console.log(`✅ [REAL: Serial] Connesso con successo alla scheda di potenza su ${this.portPath}`);

                    this.port.on('data', (chunk) => {
                        this._handleData(chunk);
                    });

                    this.port.on('close', () => {
                        console.warn('[REAL: Serial] Connessione seriale chiusa.');
                        this.isConnected = false;
                    });

                    this.port.on('error', (portErr) => {
                        console.error('[REAL: Serial] Errore porta seriale:', portErr.message);
                    });

                    resolve(true);
                });
            } catch (openErr) {
                console.error('[REAL: Serial] Errore apertura porta seriale:', openErr.message);
                this.isConnected = false;
                resolve(false);
            }
        });
    }

    async write(data) {
        if (!this.isConnected || !this.port) {
            return false;
        }

        let bufferToSend;
        let hexClean = '';

        if (Buffer.isBuffer(data)) {
            bufferToSend = data;
            hexClean = Array.from(data).map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
        } else if (typeof data === 'string') {
            hexClean = data.trim().replace(/\s+/g, ' ');
            const parts = hexClean.split(' ');
            const rawBytes = parts.map(p => parseInt(p, 16));
            bufferToSend = Buffer.from(rawBytes);
        } else {
            return false;
        }

        return new Promise((resolve) => {
            this.port.write(bufferToSend, (err) => {
                if (err) {
                    console.error('[REAL: Serial] Errore scrittura sul bus:', err.message);
                    return resolve(false);
                }

                this.emit('tx', {
                    hexClean,
                    rawBytes: Array.from(bufferToSend),
                    hexBytes: Array.from(bufferToSend).map(b => '0x' + b.toString(16).toUpperCase().padStart(2, '0')),
                    count: bufferToSend.length
                });

                resolve(true);
            });
        });
    }

    async sendCommand(hexString) {
        return this.write(hexString);
    }

    /**
     * Gestisce i flussi di byte in ingresso dalla porta seriale,
     * accumulandoli fino al terminatore 0x0D ('\r').
     */
    _handleData(chunk) {
        if (!chunk || chunk.length === 0) return;
        this._rxBuffer = Buffer.concat([this._rxBuffer, chunk]);

        let crIndex;
        // 0x0D è il terminatore del pacchetto Vorwerk TM31
        while ((crIndex = this._rxBuffer.indexOf(0x0D)) !== -1) {
            // Estrae il frame completo includendo il terminatore 0x0D
            const completeFrameBytes = this._rxBuffer.slice(0, crIndex + 1);
            this._rxBuffer = this._rxBuffer.slice(crIndex + 1);

            this._processRxFrame(completeFrameBytes);
        }
    }

    /**
     * Esegue il parsing del frame completo ed estrae la temperatura NTC
     */
    _processRxFrame(buffer) {
        const hexParts = [];
        for (let i = 0; i < buffer.length; i++) {
            hexParts.push(buffer[i].toString(16).toUpperCase().padStart(2, '0'));
        }
        const hexString = hexParts.join(' ');

        this.emit('rx_frame', hexString);
        this.emit('data', hexString);

        // Protocollo Vorwerk TM31: Frame risposta inizia con 0x52 0x50, byte 2 è la temp NTC
        if (buffer.length >= 3 && buffer[0] === 0x52 && buffer[1] === 0x50) {
            const realTemp = buffer[2];
            this.emit('temperature', realTemp);
        }
    }
}

module.exports = new BimbySerialReal();
