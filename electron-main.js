const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Abilita supporto touchscreen, scrolling fluido e tastiera virtuale nativa in Chromium
app.commandLine.appendSwitch('enable-virtual-keyboard');
app.commandLine.appendSwitch('touch-events', 'enabled');
app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('enable-features', 'TouchEvents,VirtualKeyboard');

/**
 * Rimuove le intestazioni restrittive CSP e X-Frame-Options su una determinata sessione
 * per consentire a Cookidoo e al portale login Vorwerk di caricarsi direttamente
 */
function setupSessionSecurity(targetSession) {
  if (!targetSession || !targetSession.webRequest) return;
  targetSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    delete responseHeaders['content-security-policy'];
    delete responseHeaders['Content-Security-Policy'];
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['X-Frame-Options'];
    callback({ cancel: false, responseHeaders });
  });
}

let activeCookidooWebContents = null;
let currentCookidooZoom = 0.70;
try {
  const { getCookidooZoom } = require('./src/config/settingsManager');
  currentCookidooZoom = getCookidooZoom();
} catch (e) {}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 480,
    useContentSize: true, // 800x480 pixel effettivi del display Bimby TM31
    resizable: true,
    autoHideMenuBar: true,
    title: 'Bimby TM31 Smart - Simulatore Display Kiosk (800x480)',
    webPreferences: {
      webviewTag: true,
      contextIsolation: false,
      nodeIntegration: true,
      webSecurity: false // Permette comunicazioni e embedding cross-origin per simulazione
    }
  });

  // Pulisci la cache per garantire il caricamento dell'ultima versione compilata
  win.webContents.session.clearCache().catch(() => {});

  win.loadURL('http://localhost:3001');

  // Diagnostica avanzata per webview e messaggi console
  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (message.includes('[SERIAL TX]') || message.includes('► BYTES') || message.includes('► HEX') || message.includes('► COMANDO') || message.includes('=====')) {
      console.log(message);
    } else {
      console.log(`[RENDERER CONSOLE] ${message}`);
    }
  });

  win.webContents.on('did-attach-webview', (event, webContents) => {
    console.log('🌐 [WEBVIEW ATTACHED] Webview Cookidoo agganciata');
    activeCookidooWebContents = webContents;

    // Applicazione livello di zoom configurato
    const applyBrowserZoom = () => {
      try {
        webContents.setZoomFactor(currentCookidooZoom);
        console.log(`🔍 [BROWSER ZOOM] Impostato zoom browser a ${Math.round(currentCookidooZoom * 100)}% (${currentCookidooZoom})`);
      } catch (e) {}
    };

    // Assicura l'iniezione dello script injector con il motore touch/drag-to-scroll
    const injectorPath = path.join(__dirname, 'cookidoo-injector.js');
    const injectScript = () => {
      try {
        if (fs.existsSync(injectorPath)) {
          const code = fs.readFileSync(injectorPath, 'utf8');
          webContents.executeJavaScript(code).catch(() => {});
        }
      } catch (e) {}
    };

    applyBrowserZoom();
    webContents.on('did-finish-load', () => {
      applyBrowserZoom();
      injectScript();
    });
    webContents.on('did-navigate', () => {
      applyBrowserZoom();
      injectScript();
    });
    webContents.on('did-navigate-in-page', () => {
      applyBrowserZoom();
      injectScript();
    });
    webContents.on('dom-ready', () => {
      applyBrowserZoom();
      injectScript();
    });

    webContents.on('console-message', (e, level, message, line, sourceId) => {
      console.log(`[WEBVIEW CONSOLE] ${message}`);
    });
    webContents.on('preload-error', (e, preloadPath, error) => {
      console.error(`❌ [WEBVIEW PRELOAD ERROR] ${preloadPath}:`, error);
    });
    webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL) => {
      console.warn(`⚠️ [WEBVIEW FAIL LOAD] ${errorDescription} (${validatedURL})`);
    });
  });


  // Auto-retry in caso il server Docker sia ancora in avvio
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.log(`[SIMULATORE] Server non ancora pronto (${errorDescription}). Riprovo tra 1 secondo...`);
    setTimeout(() => {
      win.loadURL('http://localhost:3001');
    }, 1500);
  });

  win.on('closed', () => {
    app.quit();
  });
}

app.whenReady().then(() => {
  // 1. Configura la sessione predefinita
  setupSessionSecurity(session.defaultSession);
  
  // 2. Configura la sessione persistente dedicata a Cookidoo (mantiene login e cookie)
  const cookidooSession = session.fromPartition('persist:cookidoo');
  setupSessionSecurity(cookidooSession);

  // 3. Applica a qualsiasi altra sessione creata dinamicamente
  app.on('session-created', (ses) => {
    setupSessionSecurity(ses);
  });

  // Gestione IPC: lettura cookie e stato di autenticazione Cookidoo
  ipcMain.handle('cookidoo:get-status', async () => {
    try {
      const cookidooSession = session.fromPartition('persist:cookidoo');
      const cookies = await cookidooSession.cookies.get({ domain: 'cookidoo.it' });
      const hasAuthCookie = cookies.some(c => {
        const n = c.name.toLowerCase();
        return n.includes('auth') || n.includes('token') || n.includes('user') || n.includes('session') || n.includes('jwt');
      });
      return {
        success: true,
        isElectron: true,
        cookieCount: cookies.length,
        hasAuthCookie,
        cookies: cookies.map(c => ({ name: c.name, domain: c.domain }))
      };
    } catch (err) {
      console.warn('⚠️ [COOKIDOO IPC] Errore lettura cookie:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Gestione IPC: eliminazione completa di cookie, cache e sessione Cookidoo
  ipcMain.handle('cookidoo:clear-data', async () => {
    try {
      const cookidooSession = session.fromPartition('persist:cookidoo');
      await cookidooSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'caches', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
      });
      await cookidooSession.clearCache();
      await cookidooSession.cookies.flushStore().catch(() => {});

      // Pulisci anche la sessione standard
      await session.defaultSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'caches', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
      }).catch(() => {});
      await session.defaultSession.clearCache().catch(() => {});

      console.log('🧹 [COOKIDOO IPC] Tutti i dati salvati e i cookie di Cookidoo sono stati eliminati!');
      return { success: true, message: 'Dati e cookie eliminati con successo' };
    } catch (err) {
      console.error('❌ [COOKIDOO IPC] Errore pulizia dati:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Gestione IPC: impostazione dinamica dello zoom di Cookidoo
  ipcMain.handle('cookidoo:set-zoom', (event, zoom) => {
    try {
      const z = parseFloat(zoom);
      if (!isNaN(z) && z >= 0.3 && z <= 2.0) {
        currentCookidooZoom = Math.round(z * 100) / 100;
        if (activeCookidooWebContents) {
          activeCookidooWebContents.setZoomFactor(currentCookidooZoom);
          console.log(`🔍 [BROWSER ZOOM IPC] Impostato zoom a ${Math.round(currentCookidooZoom * 100)}%`);
        }
      }
      return { success: true, zoom: currentCookidooZoom };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Salva permanentemente su disco i cookie e lo stato della sessione
  app.on('before-quit', () => {
    try {
      cookidooSession.cookies.flushStore().catch(() => {});
      session.defaultSession.cookies.flushStore().catch(() => {});
    } catch (e) {}
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

