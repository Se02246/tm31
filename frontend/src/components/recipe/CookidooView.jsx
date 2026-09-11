import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../../socket';
import { Loader2 } from 'lucide-react';
import RecipeRunner from './RecipeRunner';

/**
 * CookidooView - Vista Cookidoo pulita a tutto schermo (100% dell'area display).
 * I controlli di navigazione (Indietro, Avanti, Home, Ricarica) sono alloggiati
 * nella pillola verticale della sidebar principale tra Ricette e Impostazioni.
 */
export default function CookidooView() {
  const [isLoading, setIsLoading] = useState(true);
  const [recipeActive, setRecipeActive] = useState(false);
  const [zoomFactor, setZoomFactor] = useState(() => {
    try {
      const saved = localStorage.getItem('cookidoo_zoom');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 0.3 && parsed <= 2.0) return parsed;
      }
    } catch (e) {}
    return 0.70;
  });

  const webviewRef = useRef(null);
  const iframeRef = useRef(null);

  // Rileva se in esecuzione sotto Electron
  const isElectron = typeof window !== 'undefined' && (
    Boolean(window.process?.versions?.electron) || 
    navigator.userAgent.toLowerCase().includes('electron')
  );

  // Lettura iniziale e ascolto eventi cambio zoom
  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data?.settings?.cookidooZoom) {
          const z = parseFloat(data.settings.cookidooZoom);
          if (!isNaN(z) && z >= 0.3 && z <= 2.0) {
            setZoomFactor(z);
          }
        }
      })
      .catch(() => {});

    const handleZoomEvent = (e) => {
      const newZoom = e.detail?.zoom;
      if (typeof newZoom === 'number' && !isNaN(newZoom)) {
        setZoomFactor(newZoom);
      }
    };

    const handleSettingsUpdated = (data) => {
      if (data?.settings?.cookidooZoom) {
        const z = parseFloat(data.settings.cookidooZoom);
        if (!isNaN(z) && z >= 0.3 && z <= 2.0) {
          setZoomFactor(z);
        }
      }
    };

    window.addEventListener('COOKIDOO_ZOOM_CHANGED', handleZoomEvent);
    socket.on('SETTINGS_UPDATED', handleSettingsUpdated);

    return () => {
      window.removeEventListener('COOKIDOO_ZOOM_CHANGED', handleZoomEvent);
      socket.off('SETTINGS_UPDATED', handleSettingsUpdated);
    };
  }, []);

  // Applicazione immediata zoom su webview se attiva
  useEffect(() => {
    if (isElectron && webviewRef.current && typeof webviewRef.current.setZoomFactor === 'function') {
      try {
        webviewRef.current.setZoomFactor(zoomFactor);
      } catch (e) {}
    }
  }, [zoomFactor, isElectron]);

  useEffect(() => {
    // 1. Lettura stato iniziale ricetta
    fetch('/api/recipe/state')
      .then((res) => res.json())
      .then((data) => {
        if (data?.hasRecipe) {
          setRecipeActive(true);
        }
      })
      .catch(() => {});

    // 2. Ascolto aggiornamenti stato ricetta
    const handleRecipeState = (state) => {
      if (state?.hasRecipe) {
        setRecipeActive(true);
      } else {
        setRecipeActive(false);
      }
    };

    socket.on('RECIPE_STATE', handleRecipeState);

    return () => {
      socket.off('RECIPE_STATE', handleRecipeState);
    };
  }, []);

  // Gestione timeout loader iniziale
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 2200);

    return () => clearTimeout(timer);
  }, []);

  // Percorso assoluto per preload script di Electron (<webview preload="file://...">)
  const preloadPath = React.useMemo(() => {
    try {
      if (typeof window !== 'undefined' && window.require) {
        const path = window.require('path');
        return 'file:///' + path.resolve('cookidoo-injector.js').replace(/\\/g, '/');
      }
    } catch (e) {}
    return undefined;
  }, []);

  // Gestione navigazione ricevuta dalla pillola verticale della sidebar
  const handleGoBack = () => {
    if (isElectron && webviewRef.current?.canGoBack?.()) {
      webviewRef.current.goBack();
    } else if (iframeRef.current?.contentWindow) {
      try { iframeRef.current.contentWindow.history.back(); } catch (e) {}
    }
  };

  const handleGoForward = () => {
    if (isElectron && webviewRef.current?.canGoForward?.()) {
      webviewRef.current.goForward();
    } else if (iframeRef.current?.contentWindow) {
      try { iframeRef.current.contentWindow.history.forward(); } catch (e) {}
    }
  };

  const handleReload = () => {
    setIsLoading(true);
    if (isElectron && webviewRef.current) {
      webviewRef.current.reload();
    } else if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
    setTimeout(() => setIsLoading(false), 1800);
  };

  const handleGoHome = () => {
    setIsLoading(true);
    const cookidooUrl = 'https://cookidoo.it';
    if (isElectron && webviewRef.current) {
      webviewRef.current.loadURL(cookidooUrl);
    } else if (iframeRef.current) {
      iframeRef.current.src = cookidooUrl;
    }
    setTimeout(() => setIsLoading(false), 1800);
  };

  // Ascolto eventi di navigazione dalla pillola della sidebar
  useEffect(() => {
    const handleNavEvent = (e) => {
      const action = e.detail?.action;
      if (action === 'back') handleGoBack();
      else if (action === 'forward') handleGoForward();
      else if (action === 'home') handleGoHome();
      else if (action === 'reload') handleReload();
    };

    window.addEventListener('COOKIDOO_NAV', handleNavEvent);
    return () => window.removeEventListener('COOKIDOO_NAV', handleNavEvent);
  }, [isElectron]);

  // Gestione evento eliminazione dati e cookie Cookidoo
  useEffect(() => {
    const handleClearData = () => {
      console.log('🧹 [COOKIDOO VIEW] Ricevuto evento pulizia dati. Ricarico Cookidoo...');
      setIsLoading(true);
      if (isElectron && webviewRef.current) {
        try {
          webviewRef.current.clearHistory?.();
          webviewRef.current.loadURL('https://cookidoo.it');
        } catch (e) {}
      } else if (iframeRef.current) {
        try {
          iframeRef.current.src = 'https://cookidoo.it';
        } catch (e) {}
      }
      setTimeout(() => setIsLoading(false), 2000);
    };

    window.addEventListener('COOKIDOO_CLEAR_DATA', handleClearData);
    socket.on('COOKIDOO_DATA_CLEARED', handleClearData);

    return () => {
      window.removeEventListener('COOKIDOO_CLEAR_DATA', handleClearData);
      socket.off('COOKIDOO_DATA_CLEARED', handleClearData);
    };
  }, [isElectron]);

  // Configurazione webview ed iniezione script Cookidoo
  useEffect(() => {
    const webview = webviewRef.current;

    const injectCookidooScript = async () => {
      try {
        const res = await fetch('/cookidoo-injector.js');
        if (res.ok) {
          const scriptCode = await res.text();
          webview?.executeJavaScript?.(scriptCode)?.catch?.(() => {});
        }
      } catch (err) {
        console.warn('[TM31] Iniezione script fallita:', err);
      }
    };

    const applyZoom = () => {
      try {
        if (webview && typeof webview.setZoomFactor === 'function') {
          webview.setZoomFactor(zoomFactor);
        }
      } catch (e) {}
    };

    const handlePageReady = () => {
      applyZoom();
      injectCookidooScript();
    };

    const handleNewWindow = (e) => {
      if (e?.url) {
        e.preventDefault();
        webview?.loadURL(e.url);
      }
    };

    if (webview) {
      webview.addEventListener('dom-ready', handlePageReady);
      webview.addEventListener('did-finish-load', handlePageReady);
      webview.addEventListener('did-navigate', handlePageReady);
      webview.addEventListener('did-navigate-in-page', handlePageReady);
      webview.addEventListener('new-window', handleNewWindow);
    }

    return () => {
      if (webview) {
        webview.removeEventListener('dom-ready', handlePageReady);
        webview.removeEventListener('did-finish-load', handlePageReady);
        webview.removeEventListener('did-navigate', handlePageReady);
        webview.removeEventListener('did-navigate-in-page', handlePageReady);
        webview.removeEventListener('new-window', handleNewWindow);
      }
    };
  }, [isElectron]);

  return (
    <div className="flex-1 flex flex-col h-full bg-white select-none relative overflow-hidden">

      {/* =====================================================================
          CONTENITORE COOKIDOO (100% dell'area a tutto schermo, zero barre in alto)
          Sessione persistente 'persist:cookidoo' per ricordare cookie e login
          Zoom diminuito del 30% (fattore 0.70) per proporzioni ideali su 800x480
          ===================================================================== */}
      <div className="flex-1 relative w-full h-full bg-white overflow-hidden">

        {/* Loader animato durante il caricamento iniziale */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white text-gray-800 select-none">
            <Loader2 className="w-8 h-8 animate-spin text-tm-accent mb-2" />
            <span className="text-xs font-bold text-gray-500">
              Caricamento in corso...
            </span>
          </div>
        )}

        {/* Modalità Electron (webview con zoom configurabile) o Browser/Kiosk (iframe ridimensionato) */}
        {isElectron ? (
          <webview
            ref={webviewRef}
            src="https://cookidoo.it"
            partition="persist:cookidoo"
            preload={preloadPath}
            className="w-full h-full border-0"
            allowpopups="true"
            webpreferences={`contextIsolation=no, nodeIntegration=no, zoomFactor=${zoomFactor}`}
          />
        ) : (
          <div className="w-full h-full overflow-hidden relative">
            <iframe
              ref={iframeRef}
              src="https://cookidoo.it"
              title="Cookidoo"
              className="border-0"
              style={{
                width: `${Math.round(10000 / zoomFactor) / 100}%`,
                height: `${Math.round(10000 / zoomFactor) / 100}%`,
                transform: `scale(${zoomFactor})`,
                transformOrigin: 'top left'
              }}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
              onLoad={() => setIsLoading(false)}
            />
          </div>
        )}

      </div>

      {/* =====================================================================
          OVERLAY COTTURA GUIDATA: RECIPERUNNER
          Mostra la UI chiara con cerchi e pillole quando uno step è attivo
          ===================================================================== */}
      {recipeActive && (
        <div className="absolute inset-0 z-50 flex flex-col bg-white animate-in fade-in duration-200">
          <RecipeRunner />
        </div>
      )}

    </div>
  );
}
