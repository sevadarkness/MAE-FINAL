/**
 * 🧪 Test Setup - Ambiente Node.js para testes
 * Cria mocks do ambiente do navegador para rodar testes em Node
 * 
 * @version 1.0.0
 */

// ============================================
// MOCK DO AMBIENTE DO NAVEGADOR
// ============================================

// Mock window
global.window = global;

// Mock document básico
global.document = {
  readyState: 'complete',
  body: {
    appendChild: () => {},
    removeChild: () => {},
    innerHTML: ''
  },
  head: {
    appendChild: () => {}
  },
  createElement: (tag) => ({
    tagName: tag.toUpperCase(),
    style: {},
    classList: {
      add: () => {},
      remove: () => {},
      contains: () => false
    },
    appendChild: () => {},
    removeChild: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    remove: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {}
};

// Mock localStorage
const localStorageData = {};
global.localStorage = {
  getItem: (key) => localStorageData[key] || null,
  setItem: (key, value) => { localStorageData[key] = String(value); },
  removeItem: (key) => { delete localStorageData[key]; },
  clear: () => { Object.keys(localStorageData).forEach(k => delete localStorageData[k]); },
  get length() { return Object.keys(localStorageData).length; },
  key: (i) => Object.keys(localStorageData)[i] || null
};

// Mock sessionStorage
const sessionStorageData = {};
global.sessionStorage = {
  getItem: (key) => sessionStorageData[key] || null,
  setItem: (key, value) => { sessionStorageData[key] = String(value); },
  removeItem: (key) => { delete sessionStorageData[key]; },
  clear: () => { Object.keys(sessionStorageData).forEach(k => delete sessionStorageData[k]); },
  get length() { return Object.keys(sessionStorageData).length; },
  key: (i) => Object.keys(sessionStorageData)[i] || null
};

// Mock console (para capturar logs durante testes)
const originalConsole = { ...console };
global.testLogs = [];
global.console = {
  ...originalConsole,
  log: (...args) => {
    global.testLogs.push({ type: 'log', args });
    if (process.env.VERBOSE) originalConsole.log(...args);
  },
  warn: (...args) => {
    global.testLogs.push({ type: 'warn', args });
    if (process.env.VERBOSE) originalConsole.warn(...args);
  },
  error: (...args) => {
    global.testLogs.push({ type: 'error', args });
    if (process.env.VERBOSE) originalConsole.error(...args);
  },
  info: (...args) => {
    global.testLogs.push({ type: 'info', args });
    if (process.env.VERBOSE) originalConsole.info(...args);
  }
};

// Mock chrome API
global.chrome = {
  storage: {
    local: {
      _data: {},
      get: (keys) => Promise.resolve(
        typeof keys === 'string' 
          ? { [keys]: global.chrome.storage.local._data[keys] }
          : keys.reduce((acc, k) => ({ ...acc, [k]: global.chrome.storage.local._data[k] }), {})
      ),
      set: (data) => {
        Object.assign(global.chrome.storage.local._data, data);
        return Promise.resolve();
      },
      remove: (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete global.chrome.storage.local._data[k]);
        return Promise.resolve();
      },
      clear: () => {
        global.chrome.storage.local._data = {};
        return Promise.resolve();
      }
    },
    sync: {
      _data: {},
      get: (keys) => Promise.resolve(
        typeof keys === 'string' 
          ? { [keys]: global.chrome.storage.sync._data[keys] }
          : keys.reduce((acc, k) => ({ ...acc, [k]: global.chrome.storage.sync._data[k] }), {})
      ),
      set: (data) => {
        Object.assign(global.chrome.storage.sync._data, data);
        return Promise.resolve();
      },
      remove: (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach(k => delete global.chrome.storage.sync._data[k]);
        return Promise.resolve();
      }
    }
  },
  runtime: {
    sendMessage: (message) => Promise.resolve({ success: true, data: message }),
    onMessage: {
      addListener: () => {},
      removeListener: () => {}
    },
    getURL: (path) => `chrome-extension://test-id/${path}`,
    id: 'test-extension-id'
  },
  tabs: {
    query: () => Promise.resolve([{ id: 1, url: 'https://web.whatsapp.com' }]),
    sendMessage: () => Promise.resolve({ success: true }),
    create: () => Promise.resolve({ id: 2 })
  },
  notifications: {
    create: () => Promise.resolve('notification-id')
  }
};

// Mock fetch
global.fetch = async (url, options = {}) => {
  // Simular resposta de API
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: {} }),
    text: async () => 'OK'
  };
};

// Mock setTimeout/setInterval retornando IDs numéricos
let timerId = 0;
const timers = new Map();

global.setTimeout = (fn, delay) => {
  const id = ++timerId;
  timers.set(id, { fn, delay, type: 'timeout' });
  // Executar imediatamente em testes (ou usar jest.useFakeTimers)
  if (process.env.IMMEDIATE_TIMERS) {
    fn();
  }
  return id;
};

global.clearTimeout = (id) => {
  timers.delete(id);
};

global.setInterval = (fn, interval) => {
  const id = ++timerId;
  timers.set(id, { fn, interval, type: 'interval' });
  return id;
};

global.clearInterval = (id) => {
  timers.delete(id);
};

// Mock requestAnimationFrame
global.requestAnimationFrame = (fn) => setTimeout(fn, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// Mock MutationObserver
global.MutationObserver = class MutationObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  disconnect() {}
  takeRecords() { return []; }
};

// Mock speechSynthesis (para TTS)
global.speechSynthesis = {
  speak: () => {},
  cancel: () => {},
  pause: () => {},
  resume: () => {},
  getVoices: () => [],
  speaking: false,
  pending: false,
  paused: false
};

global.SpeechSynthesisUtterance = class SpeechSynthesisUtterance {
  constructor(text) {
    this.text = text;
    this.lang = 'pt-BR';
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
  }
};

// ============================================
// UTILITÁRIOS DE TESTE
// ============================================

class TestRunner {
  constructor(suiteName) {
    this.suiteName = suiteName;
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
    this.skipped = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn, skip: false });
  }

  skip(name, fn) {
    this.tests.push({ name, fn, skip: true });
  }

  async run() {
    console.log = originalConsole.log;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 Suite: ${this.suiteName}`);
    console.log('='.repeat(60));

    for (const test of this.tests) {
      if (test.skip) {
        console.log(`  ⏭️  SKIP: ${test.name}`);
        this.skipped++;
        continue;
      }

      try {
        await test.fn();
        console.log(`  ✅ PASS: ${test.name}`);
        this.passed++;
      } catch (error) {
        console.log(`  ❌ FAIL: ${test.name}`);
        console.log(`     Error: ${error.message}`);
        if (process.env.VERBOSE) {
          console.log(error.stack);
        }
        this.failed++;
      }
    }

    console.log('-'.repeat(60));
    console.log(`📊 Results: ${this.passed} passed, ${this.failed} failed, ${this.skipped} skipped`);
    console.log('='.repeat(60));

    return {
      suite: this.suiteName,
      total: this.tests.length,
      passed: this.passed,
      failed: this.failed,
      skipped: this.skipped
    };
  }
}

// Assertions
const assert = {
  equal(actual, expected, message = '') {
    if (actual !== expected) {
      throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
  },
  
  deepEqual(actual, expected, message = '') {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
  },
  
  true(value, message = '') {
    if (value !== true) {
      throw new Error(`${message}\nExpected: true\nActual: ${value}`);
    }
  },
  
  false(value, message = '') {
    if (value !== false) {
      throw new Error(`${message}\nExpected: false\nActual: ${value}`);
    }
  },
  
  throws(fn, message = '') {
    let threw = false;
    try {
      fn();
    } catch (e) {
      threw = true;
    }
    if (!threw) {
      throw new Error(`${message}\nExpected function to throw`);
    }
  },
  
  async rejects(promise, message = '') {
    let rejected = false;
    try {
      await promise;
    } catch (e) {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`${message}\nExpected promise to reject`);
    }
  },
  
  notNull(value, message = '') {
    if (value === null || value === undefined) {
      throw new Error(`${message}\nExpected non-null value, got: ${value}`);
    }
  },
  
  includes(array, item, message = '') {
    if (!array.includes(item)) {
      throw new Error(`${message}\nExpected array to include: ${item}`);
    }
  },
  
  match(string, regex, message = '') {
    if (!regex.test(string)) {
      throw new Error(`${message}\nExpected "${string}" to match ${regex}`);
    }
  }
};

// Helpers
function createMockMessage(overrides = {}) {
  return {
    id: `msg_${Date.now()}`,
    type: 'chat',
    body: 'Test message',
    from: '5511999999999@c.us',
    to: '5511888888888@c.us',
    timestamp: Date.now(),
    fromMe: false,
    ...overrides
  };
}

function createMockContact(overrides = {}) {
  return {
    id: '5511999999999@c.us',
    name: 'Test Contact',
    phone: '5511999999999',
    pushname: 'Test',
    isGroup: false,
    ...overrides
  };
}

function resetMocks() {
  global.testLogs = [];
  global.chrome.storage.local._data = {};
  global.chrome.storage.sync._data = {};
  localStorage.clear();
  sessionStorage.clear();
  timers.clear();
}

// Exportar para uso em testes
module.exports = {
  TestRunner,
  assert,
  createMockMessage,
  createMockContact,
  resetMocks,
  originalConsole
};
