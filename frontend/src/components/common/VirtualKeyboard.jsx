import React, { useState, useEffect, useRef } from 'react';
import { Delete, CornerDownLeft, X, ArrowUp, Check, Sparkles } from 'lucide-react';

/**
 * VirtualKeyboard - Tastiera virtuale touch-screen completa per Bimby TM31 (800x480)
 * Supporta:
 * - Alfabeto completo (maiuscole/minuscole con Shift e CapsLock)
 * - Numeri e simboli base (?123)
 * - Simboli estesi e punteggiatura (=<)
 * - Tasti di controllo: Backspace, Spazio, Invio/Salva, Pulisci (C), Annulla
 * - Suggerimenti / Quick-Chips contestuali opzionali
 * - Feedback aptico/visivo immediato
 */
export default function VirtualKeyboard({
  isOpen = false,
  title = 'Tastiera Virtuale',
  initialValue = '',
  placeholder = 'Digita qui...',
  actionLabel = 'Salva',
  suggestions = [],
  onSave,
  onClose,
}) {
  const [text, setText] = useState(initialValue || '');
  // Modalità: 'alpha' (lettere), 'numbers' (?123), 'symbols' (=<)
  const [layoutMode, setLayoutMode] = useState('alpha');
  const [isShift, setIsShift] = useState(false);
  const [isCapsLock, setIsCapsLock] = useState(false);

  const inputRef = useRef(null);

  // Sincronizza il valore iniziale quando si apre
  useEffect(() => {
    if (isOpen) {
      setText(initialValue || '');
      setLayoutMode('alpha');
      setIsShift(false);
      setIsCapsLock(false);
    }
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  // Inserisce un carattere nella posizione corrente o alla fine
  const handleKeyPress = (char) => {
    setText((prev) => prev + char);
    // Se era attivo shift normale (non caps lock), disattivalo dopo aver premuto un carattere
    if (isShift && !isCapsLock) {
      setIsShift(false);
    }
  };

  // Cancellazione carattere singolo
  const handleBackspace = () => {
    setText((prev) => prev.slice(0, -1));
  };

  // Cancellazione totale del testo
  const handleClearAll = () => {
    setText('');
  };

  // Alterna Shift / Caps Lock
  const handleShiftToggle = () => {
    if (isCapsLock) {
      setIsCapsLock(false);
      setIsShift(false);
    } else if (isShift) {
      setIsCapsLock(true);
    } else {
      setIsShift(true);
    }
  };

  // Selezione di un suggerimento rapido
  const handleSelectSuggestion = (suggestion) => {
    setText(suggestion);
  };

  const handleAction = () => {
    if (onSave) {
      onSave(text.trim());
    }
  };

  // Lettere QWERTY
  const alphaRows = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  ];

  // Numeri e Simboli Base (?123)
  const numberRows = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '€', '&', '@', '"'],
    ['.', ',', '?', '!', '\'', '_'],
  ];

  // Simboli Estesi (=<)
  const symbolRows = [
    ['[', ']', '{', '}', '#', '%', '^', '*', '+', '='],
    ['_', '\\', '|', '~', '<', '>', '$', '£', '¥', '·'],
    ['°', '§', ';', ':', '`', '«', '»'],
  ];

  const isUppercase = isShift || isCapsLock;

  return (
    <div 
      className="fixed inset-0 z-[9999] flex flex-col justify-end bg-black/60 backdrop-blur-xs select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="bg-[#1f242d] text-white w-full rounded-t-3xl shadow-2xl border-t border-gray-700/60 flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-250 max-h-[460px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Barra Superiore: Titolo, Input interattivo con cursore, Clear e Chiudi */}
        <div className="bg-[#161a22] px-4 py-2 border-b border-gray-800 flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs text-gray-400 font-medium">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-tm-accent"></span>
              {title}
            </span>
            <button 
              onClick={onClose}
              className="p-1 rounded-full hover:bg-gray-800 text-gray-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Campo di testo con cursore lampeggiante */}
          <div className="flex items-center gap-2 bg-[#252b37] border border-gray-700/80 rounded-xl px-3 py-1.5 shadow-inner">
            <div className="flex-1 overflow-x-auto whitespace-nowrap text-base font-mono tracking-wide text-white flex items-center">
              {text.length > 0 ? (
                <span>{text}</span>
              ) : (
                <span className="text-gray-500 font-sans text-sm">{placeholder}</span>
              )}
              <span className="inline-block w-2 h-5 bg-tm-accent ml-0.5 animate-pulse rounded-xs"></span>
            </div>

            {text.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="px-2 py-1 text-xs bg-gray-700/80 hover:bg-gray-600 active:scale-95 text-gray-300 hover:text-white rounded-lg transition-all font-semibold"
                title="Cancella tutto"
              >
                Cancella
              </button>
            )}
          </div>

          {/* Quick suggestions opzionali se presenti */}
          {suggestions && suggestions.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto py-0.5 no-scrollbar">
              <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider flex items-center gap-1 shrink-0">
                <Sparkles className="w-3 h-3 text-tm-accent" /> Suggeriti:
              </span>
              {suggestions.map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSelectSuggestion(item)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all shrink-0 cursor-pointer ${
                    text === item
                      ? 'bg-tm-accent text-white font-bold shadow-xs'
                      : 'bg-gray-800/90 hover:bg-gray-700 text-gray-300 border border-gray-700/50 active:scale-95'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Corpo Tastiera Touch (4 righe calibrata per 800x480) */}
        <div className="p-2 sm:p-2.5 flex flex-col gap-1.5 bg-[#1a1f28]">

          {/* === MODALITA ALFABETICA (ABC) === */}
          {layoutMode === 'alpha' && (
            <>
              {/* Riga 1: Q W E R T Y U I O P */}
              <div className="flex justify-center gap-1.5 w-full">
                {alphaRows[0].map((letter) => {
                  const displayChar = isUppercase ? letter.toUpperCase() : letter;
                  return (
                    <button
                      key={letter}
                      onClick={() => handleKeyPress(displayChar)}
                      className="flex-1 max-w-[70px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-95 text-white font-semibold text-base sm:text-lg flex items-center justify-center shadow-sm border border-gray-700/60 transition-all cursor-pointer"
                    >
                      {displayChar}
                    </button>
                  );
                })}
              </div>

              {/* Riga 2: A S D F G H J K L */}
              <div className="flex justify-center gap-1.5 w-full px-3">
                {alphaRows[1].map((letter) => {
                  const displayChar = isUppercase ? letter.toUpperCase() : letter;
                  return (
                    <button
                      key={letter}
                      onClick={() => handleKeyPress(displayChar)}
                      className="flex-1 max-w-[70px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-95 text-white font-semibold text-base sm:text-lg flex items-center justify-center shadow-sm border border-gray-700/60 transition-all cursor-pointer"
                    >
                      {displayChar}
                    </button>
                  );
                })}
              </div>

              {/* Riga 3: SHIFT, Z X C V B N M, BACKSPACE */}
              <div className="flex justify-center gap-1.5 w-full">
                <button
                  onClick={handleShiftToggle}
                  className={`w-14 sm:w-16 h-10 sm:h-11 rounded-xl flex items-center justify-center transition-all border shadow-sm cursor-pointer ${
                    isCapsLock
                      ? 'bg-tm-accent text-white border-tm-accent shadow-tm-accent/20'
                      : isShift
                      ? 'bg-amber-500 text-white border-amber-500 shadow-amber-500/20'
                      : 'bg-[#252b37] text-gray-300 border-gray-700/80 hover:bg-[#323a4b]'
                  }`}
                  title={isCapsLock ? 'Blocco Maiuscole Attivo' : isShift ? 'Maiuscola' : 'Shift'}
                >
                  <ArrowUp className={`w-5 h-5 stroke-[2.4] ${isCapsLock ? 'fill-current' : ''}`} />
                </button>

                {alphaRows[2].map((letter) => {
                  const displayChar = isUppercase ? letter.toUpperCase() : letter;
                  return (
                    <button
                      key={letter}
                      onClick={() => handleKeyPress(displayChar)}
                      className="flex-1 max-w-[70px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-95 text-white font-semibold text-base sm:text-lg flex items-center justify-center shadow-sm border border-gray-700/60 transition-all cursor-pointer"
                    >
                      {displayChar}
                    </button>
                  );
                })}

                <button
                  onClick={handleBackspace}
                  className="w-14 sm:w-16 h-10 sm:h-11 rounded-xl bg-[#252b37] hover:bg-[#323a4b] active:bg-red-500/20 active:text-red-400 active:scale-95 text-gray-300 border border-gray-700/80 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                  title="Cancella carattere (Backspace)"
                >
                  <Delete className="w-5 h-5 stroke-[2]" />
                </button>
              </div>

              {/* Riga 4: ?123, - , Spazio, . , Salva */}
              <div className="flex justify-center items-center gap-1.5 w-full">
                <button
                  onClick={() => setLayoutMode('numbers')}
                  className="w-16 sm:w-20 h-10 sm:h-11 rounded-xl bg-[#252b37] hover:bg-[#323a4b] active:scale-95 text-gray-300 font-bold text-xs sm:text-sm border border-gray-700/80 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  ?123
                </button>

                <button
                  onClick={() => handleKeyPress('-')}
                  className="w-12 h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:scale-95 text-white font-bold text-base border border-gray-700/60 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  -
                </button>

                {/* Spazio centrale ampio */}
                <button
                  onClick={() => handleKeyPress(' ')}
                  className="flex-1 max-w-[280px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-98 text-gray-300 font-medium text-xs tracking-wider uppercase border border-gray-700/60 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  Spazio
                </button>

                <button
                  onClick={() => handleKeyPress('.')}
                  className="w-12 h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:scale-95 text-white font-bold text-base border border-gray-700/60 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  .
                </button>

                {/* Tasto Azione (Verde Vorwerk) */}
                <button
                  onClick={handleAction}
                  className="px-4 sm:px-6 h-10 sm:h-11 rounded-xl bg-tm-accent hover:bg-tm-accent-hover active:scale-95 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-tm-accent/20 transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>{actionLabel}</span>
                </button>
              </div>
            </>
          )}

          {/* === MODALITA NUMERI E SIMBOLI BASE (?123) === */}
          {layoutMode === 'numbers' && (
            <>
              {/* Riga 1: 1 2 3 4 5 6 7 8 9 0 */}
              <div className="flex justify-center gap-1.5 w-full">
                {numberRows[0].map((num) => (
                  <button
                    key={num}
                    onClick={() => handleKeyPress(num)}
                    className="flex-1 max-w-[70px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-95 text-white font-semibold text-base sm:text-lg flex items-center justify-center shadow-sm border border-gray-700/60 transition-all cursor-pointer"
                  >
                    {num}
                  </button>
                ))}
              </div>

              {/* Riga 2: - / : ; ( ) € & @ " */}
              <div className="flex justify-center gap-1.5 w-full">
                {numberRows[1].map((sym) => (
                  <button
                    key={sym}
                    onClick={() => handleKeyPress(sym)}
                    className="flex-1 max-w-[70px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-95 text-white font-semibold text-base sm:text-lg flex items-center justify-center shadow-sm border border-gray-700/60 transition-all cursor-pointer"
                  >
                    {sym}
                  </button>
                ))}
              </div>

              {/* Riga 3: Switch =<, . , ? ! ' _, BACKSPACE */}
              <div className="flex justify-center gap-1.5 w-full">
                <button
                  onClick={() => setLayoutMode('symbols')}
                  className="w-16 sm:w-20 h-10 sm:h-11 rounded-xl bg-[#252b37] hover:bg-[#323a4b] active:scale-95 text-tm-accent font-bold text-xs sm:text-sm border border-gray-700/80 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  =\&lt;
                </button>

                {numberRows[2].map((sym) => (
                  <button
                    key={sym}
                    onClick={() => handleKeyPress(sym)}
                    className="flex-1 max-w-[70px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-95 text-white font-semibold text-base sm:text-lg flex items-center justify-center shadow-sm border border-gray-700/60 transition-all cursor-pointer"
                  >
                    {sym}
                  </button>
                ))}

                <button
                  onClick={handleBackspace}
                  className="w-14 sm:w-16 h-10 sm:h-11 rounded-xl bg-[#252b37] hover:bg-[#323a4b] active:bg-red-500/20 active:text-red-400 active:scale-95 text-gray-300 border border-gray-700/80 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                  title="Cancella carattere"
                >
                  <Delete className="w-5 h-5 stroke-[2]" />
                </button>
              </div>

              {/* Riga 4: ABC, %, Spazio, #, Salva */}
              <div className="flex justify-center items-center gap-1.5 w-full">
                <button
                  onClick={() => setLayoutMode('alpha')}
                  className="w-16 sm:w-20 h-10 sm:h-11 rounded-xl bg-[#252b37] hover:bg-[#323a4b] active:scale-95 text-gray-300 font-bold text-xs sm:text-sm border border-gray-700/80 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  ABC
                </button>

                <button
                  onClick={() => handleKeyPress('%')}
                  className="w-12 h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:scale-95 text-white font-bold text-base border border-gray-700/60 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  %
                </button>

                <button
                  onClick={() => handleKeyPress(' ')}
                  className="flex-1 max-w-[280px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-98 text-gray-300 font-medium text-xs tracking-wider uppercase border border-gray-700/60 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  Spazio
                </button>

                <button
                  onClick={() => handleKeyPress('#')}
                  className="w-12 h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:scale-95 text-white font-bold text-base border border-gray-700/60 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  #
                </button>

                <button
                  onClick={handleAction}
                  className="px-4 sm:px-6 h-10 sm:h-11 rounded-xl bg-tm-accent hover:bg-tm-accent-hover active:scale-95 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-tm-accent/20 transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>{actionLabel}</span>
                </button>
              </div>
            </>
          )}

          {/* === MODALITA SIMBOLI ESTESI (=<) === */}
          {layoutMode === 'symbols' && (
            <>
              {/* Riga 1: [ ] { } # % ^ * + = */}
              <div className="flex justify-center gap-1.5 w-full">
                {symbolRows[0].map((sym) => (
                  <button
                    key={sym}
                    onClick={() => handleKeyPress(sym)}
                    className="flex-1 max-w-[70px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-95 text-white font-semibold text-base sm:text-lg flex items-center justify-center shadow-sm border border-gray-700/60 transition-all cursor-pointer"
                  >
                    {sym}
                  </button>
                ))}
              </div>

              {/* Riga 2: _ \ | ~ < > $ £ ¥ · */}
              <div className="flex justify-center gap-1.5 w-full">
                {symbolRows[1].map((sym) => (
                  <button
                    key={sym}
                    onClick={() => handleKeyPress(sym)}
                    className="flex-1 max-w-[70px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-95 text-white font-semibold text-base sm:text-lg flex items-center justify-center shadow-sm border border-gray-700/60 transition-all cursor-pointer"
                  >
                    {sym}
                  </button>
                ))}
              </div>

              {/* Riga 3: Switch ?123, ° § ; : ` « », BACKSPACE */}
              <div className="flex justify-center gap-1.5 w-full">
                <button
                  onClick={() => setLayoutMode('numbers')}
                  className="w-16 sm:w-20 h-10 sm:h-11 rounded-xl bg-[#252b37] hover:bg-[#323a4b] active:scale-95 text-gray-300 font-bold text-xs sm:text-sm border border-gray-700/80 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  ?123
                </button>

                {symbolRows[2].map((sym) => (
                  <button
                    key={sym}
                    onClick={() => handleKeyPress(sym)}
                    className="flex-1 max-w-[70px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-95 text-white font-semibold text-base sm:text-lg flex items-center justify-center shadow-sm border border-gray-700/60 transition-all cursor-pointer"
                  >
                    {sym}
                  </button>
                ))}

                <button
                  onClick={handleBackspace}
                  className="w-14 sm:w-16 h-10 sm:h-11 rounded-xl bg-[#252b37] hover:bg-[#323a4b] active:bg-red-500/20 active:text-red-400 active:scale-95 text-gray-300 border border-gray-700/80 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                  title="Cancella carattere"
                >
                  <Delete className="w-5 h-5 stroke-[2]" />
                </button>
              </div>

              {/* Riga 4: ABC, Spazio, Salva */}
              <div className="flex justify-center items-center gap-1.5 w-full">
                <button
                  onClick={() => setLayoutMode('alpha')}
                  className="w-16 sm:w-20 h-10 sm:h-11 rounded-xl bg-[#252b37] hover:bg-[#323a4b] active:scale-95 text-gray-300 font-bold text-xs sm:text-sm border border-gray-700/80 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  ABC
                </button>

                <button
                  onClick={() => handleKeyPress(' ')}
                  className="flex-1 max-w-[380px] h-10 sm:h-11 rounded-xl bg-[#2e3646] hover:bg-[#3b4559] active:bg-[#4a566f] active:scale-98 text-gray-300 font-medium text-xs tracking-wider uppercase border border-gray-700/60 flex items-center justify-center shadow-sm transition-all cursor-pointer"
                >
                  Spazio
                </button>

                <button
                  onClick={handleAction}
                  className="px-4 sm:px-6 h-10 sm:h-11 rounded-xl bg-tm-accent hover:bg-tm-accent-hover active:scale-95 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shadow-md shadow-tm-accent/20 transition-all cursor-pointer"
                >
                  <Check className="w-4 h-4 stroke-[2.5]" />
                  <span>{actionLabel}</span>
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
