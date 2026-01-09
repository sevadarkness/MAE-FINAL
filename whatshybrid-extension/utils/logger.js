/**
 * Logger Centralizado
 * WhatsHybrid v7.9.12
 */
(function() {
  'use strict';

  let DEBUG_ENABLED = false;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('whl_debug', (result) => {
      DEBUG_ENABLED = result.whl_debug === true;
    });
  }

  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
  let currentLevel = DEBUG_ENABLED ? LEVELS.debug : LEVELS.warn;

  const logger = {
    setLevel(level) { currentLevel = LEVELS[level] ?? LEVELS.warn; },
    enableDebug() { DEBUG_ENABLED = true; currentLevel = LEVELS.debug; },
    disableDebug() { DEBUG_ENABLED = false; currentLevel = LEVELS.warn; },
    
    debug(...args) { 
      if (currentLevel <= LEVELS.debug) {
        console.log('%c[WHL:DEBUG]', 'color: #9CA3AF', ...args);
      }
    },
    
    info(...args) { 
      if (currentLevel <= LEVELS.info) {
        console.log('%c[WHL:INFO]', 'color: #3B82F6', ...args);
      }
    },
    
    warn(...args) { 
      if (currentLevel <= LEVELS.warn) {
        console.warn('%c[WHL:WARN]', 'color: #F59E0B', ...args);
      }
    },
    
    error(...args) { 
      if (currentLevel <= LEVELS.error) {
        console.error('%c[WHL:ERROR]', 'color: #EF4444; font-weight: bold', ...args);
      }
    },
    
    critical(...args) { 
      console.error('%c[WHL:CRITICAL]', 'background: #EF4444; color: white; padding: 2px 4px; border-radius: 2px;', ...args); 
    },

    time(label) {
      if (currentLevel <= LEVELS.debug) console.time(`[WHL] ${label}`);
    },

    timeEnd(label) {
      if (currentLevel <= LEVELS.debug) console.timeEnd(`[WHL] ${label}`);
    }
  };

  window.WHLLogger = logger;
})();