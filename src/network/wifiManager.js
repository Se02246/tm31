const wifi = require('node-wifi');

// Inizializza node-wifi con interfaccia di default (null = auto-rilevamento)
try {
  wifi.init({ iface: null });
  console.log('📶 [WIFI] Modulo node-wifi inizializzato');
} catch (err) {
  console.warn('⚠️ [WIFI] Inizializzazione node-wifi fallita:', err.message);
}

// Stato connessione simulata in ambiente di sviluppo/mock
let mockCurrentSsid = 'Bimby-Home-WiFi';

// Reti mock di fallback per sviluppo, simulatore e Docker senza accesso wireless diretto
const MOCK_NETWORKS = [
  { ssid: 'Bimby-Home-WiFi', signal_level: -45, quality: 95, security: 'WPA2-PSK', isLocked: true },
  { ssid: 'Vodafone-Fibra-Casa', signal_level: -58, quality: 82, security: 'WPA3-Personal', isLocked: true },
  { ssid: 'Fastweb-Casa-5G', signal_level: -65, quality: 70, security: 'WPA2-PSK', isLocked: true },
  { ssid: 'TIM-Hub-Ospiti', signal_level: -75, quality: 50, security: 'Open', isLocked: false },
  { ssid: 'IliadBox-2.4G', signal_level: -82, quality: 35, security: 'WPA2-PSK', isLocked: true }
];

/**
 * Calcola la percentuale di qualità del segnale (0-100) da dBm o quality
 */
function calculateSignalQuality(network) {
  if (typeof network.quality === 'number' && !isNaN(network.quality) && network.quality > 0) {
    return Math.min(100, Math.max(0, Math.round(network.quality)));
  }
  if (typeof network.signal_level === 'number' && !isNaN(network.signal_level)) {
    // Converti dBm (es. -30 dBm eccellente, -90 dBm debole) in percentuale 0-100
    const dBm = network.signal_level;
    if (dBm >= -50) return 100;
    if (dBm <= -100) return 0;
    return Math.round(2 * (dBm + 100));
  }
  return 50;
}

/**
 * Normalizza il campo security per capire se la rete richiede password
 */
function isNetworkLocked(security) {
  if (!security) return false;
  const s = String(security).toLowerCase();
  if (s.includes('open') || s.includes('none') || s === '' || s.includes('aperta')) {
    return false;
  }
  return true;
}

/**
 * Scansiona le reti Wi-Fi vicine, rimuove duplicati e ordina per potenza di segnale
 * @returns {Promise<Array>} Lista di reti Wi-Fi ordinate
 */
async function scanNetworks() {
  try {
    const rawNetworks = await wifi.scan();
    const current = await getCurrentConnection();

    if (Array.isArray(rawNetworks) && rawNetworks.length > 0) {
      // Mappa per filtrare duplicati tenendo il segnale più forte
      const networkMap = new Map();

      rawNetworks.forEach((net) => {
        const rawSsid = (net.ssid || '').trim();
        // Ignora reti nascoste con SSID vuoto
        if (!rawSsid) return;

        const quality = calculateSignalQuality(net);
        const isLocked = isNetworkLocked(net.security);
        const isCurrent = current?.connected && (current.ssid === rawSsid);

        const existing = networkMap.get(rawSsid);
        if (!existing || quality > existing.quality) {
          networkMap.set(rawSsid, {
            ssid: rawSsid,
            bssid: net.bssid || net.mac || '',
            channel: net.channel || null,
            frequency: net.frequency || null,
            signal_level: net.signal_level || null,
            quality: quality,
            security: net.security || 'WPA2',
            isLocked: isLocked,
            isCurrent: isCurrent,
            isMock: false
          });
        }
      });

      // Converti in array e ordina: prima la rete attualmente connessa, poi per segnale decrescente
      const sorted = Array.from(networkMap.values()).sort((a, b) => {
        if (a.isCurrent && !b.isCurrent) return -1;
        if (!a.isCurrent && b.isCurrent) return 1;
        return b.quality - a.quality;
      });

      console.log(`📶 [WIFI] Scansione reale completata: ${sorted.length} reti rilevate`);
      return sorted;
    }
  } catch (err) {
    console.warn('⚠️ [WIFI] Scansione reale non disponibile (ambiente mock/docker/kiosk):', err.message);
  }

  // Fallback mock per Docker o PC senza wireless card
  console.log('📶 [WIFI] Restituzione elenco reti mock per simulatore/sviluppo');
  return MOCK_NETWORKS.map((net) => ({
    ...net,
    isCurrent: net.ssid === mockCurrentSsid,
    isMock: true
  })).sort((a, b) => {
    if (a.isCurrent && !b.isCurrent) return -1;
    if (!a.isCurrent && b.isCurrent) return 1;
    return b.quality - a.quality;
  });
}

/**
 * Ottiene le informazioni sulla connessione Wi-Fi corrente
 * @returns {Promise<Object>} Stato della connessione
 */
async function getCurrentConnection() {
  try {
    const connections = await wifi.getCurrentConnections();
    if (Array.isArray(connections) && connections.length > 0) {
      const active = connections[0];
      // Risolvi possibili discrepanze di parsing su Windows/Linux
      let ssid = (active.ssid || '').trim();
      if ((!ssid || ssid.toLowerCase() === 'connessa') && active.bssid && isNaN(active.bssid)) {
        ssid = active.bssid.trim();
      }

      if (ssid && ssid.toLowerCase() !== 'connessa') {
        return {
          connected: true,
          ssid: ssid,
          bssid: active.bssid || '',
          quality: calculateSignalQuality(active),
          security: active.security || 'WPA2',
          isLocked: isNetworkLocked(active.security),
          isMock: false
        };
      }
    }
  } catch (err) {
    // Non critico
  }

  // Se in ambiente mock
  if (mockCurrentSsid) {
    return {
      connected: true,
      ssid: mockCurrentSsid,
      bssid: '00:11:22:33:44:55',
      quality: 95,
      security: 'WPA2-PSK',
      isLocked: true,
      isMock: true
    };
  }

  return {
    connected: false,
    ssid: null,
    quality: 0,
    security: null,
    isLocked: false
  };
}

/**
 * Tenta la connessione a una rete Wi-Fi tramite SSID e password
 * @param {string} ssid - Nome della rete
 * @param {string} password - Password della rete
 * @returns {Promise<Object>} Esito della connessione
 */
async function connectToNetwork(ssid, password) {
  if (!ssid || typeof ssid !== 'string' || ssid.trim().length === 0) {
    throw new Error('SSID di rete non valido');
  }

  const cleanSsid = ssid.trim();
  const cleanPassword = password ? String(password).trim() : '';

  console.log(`📶 [WIFI] Tentativo di connessione a "${cleanSsid}"...`);

  try {
    await wifi.connect({ ssid: cleanSsid, password: cleanPassword });
    console.log(`✅ [WIFI] Connessione a "${cleanSsid}" riuscita`);
    mockCurrentSsid = cleanSsid;
    return {
      success: true,
      message: `Connesso a ${cleanSsid}`,
      ssid: cleanSsid
    };
  } catch (err) {
    console.warn(`⚠️ [WIFI] Connessione hardware fallita (${err.message}). Controllo fallback mock...`);

    // In ambiente Docker/mock/simulatore, simula connessione riuscita se la password rispetta le regole minime
    if (process.env.HARDWARE_MODE === 'mock' || !process.env.RASPBERRY) {
      if (cleanPassword && cleanPassword.length < 8) {
        throw new Error('Password non valida: deve contenere almeno 8 caratteri');
      }
      mockCurrentSsid = cleanSsid;
      console.log(`✅ [WIFI MOCK] Connessione simulata a "${cleanSsid}" riuscita`);
      return {
        success: true,
        message: `Connesso a ${cleanSsid} (Modalità Simulatore)`,
        ssid: cleanSsid,
        isMock: true
      };
    }

    throw new Error(err.message || 'Impossibile connettersi alla rete Wi-Fi');
  }
}

/**
 * Disconnette la rete Wi-Fi corrente
 */
async function disconnectNetwork() {
  try {
    await wifi.disconnect();
  } catch (e) {}
  mockCurrentSsid = null;
  return { success: true, message: 'Wi-Fi disconnesso' };
}

module.exports = {
  scanNetworks,
  getCurrentConnection,
  connectToNetwork,
  disconnectNetwork
};
