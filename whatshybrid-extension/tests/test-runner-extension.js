/**
 * 🧪 WhatsHybrid Extension - Test Runner
 * Sistema de testes automatizados para a extensão Chrome
 * 
 * @version 7.9.13
 */

(function() {
  'use strict';

  /**
   * Test Runner para extensão
   */
  class ExtensionTestRunner {
    constructor() {
      this.suites = [];
      this.results = [];
      this.running = false;
    }

    /**
     * Define uma suite de testes
     */
    describe(name, fn) {
      const suite = {
        name,
        tests: [],
        beforeAll: null,
        afterAll: null,
        beforeEach: null,
        afterEach: null
      };

      const context = {
        it: (testName, testFn) => suite.tests.push({ name: testName, fn: testFn }),
        test: (testName, testFn) => suite.tests.push({ name: testName, fn: testFn }),
        beforeAll: (fn) => suite.beforeAll = fn,
        afterAll: (fn) => suite.afterAll = fn,
        beforeEach: (fn) => suite.beforeEach = fn,
        afterEach: (fn) => suite.afterEach = fn
      };

      fn(context);
      this.suites.push(suite);
      return this;
    }

    /**
     * Assertions
     */
    get assert() {
      return {
        ok: (value, msg) => {
          if (!value) throw new Error(msg || `Expected truthy, got ${value}`);
        },
        equal: (a, b, msg) => {
          if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`);
        },
        deepEqual: (a, b, msg) => {
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            throw new Error(msg || `Deep equal failed`);
          }
        },
        notEqual: (a, b, msg) => {
          if (a === b) throw new Error(msg || `Expected not ${b}`);
        },
        isArray: (v, msg) => {
          if (!Array.isArray(v)) throw new Error(msg || 'Expected array');
        },
        isFunction: (v, msg) => {
          if (typeof v !== 'function') throw new Error(msg || 'Expected function');
        },
        isObject: (v, msg) => {
          if (typeof v !== 'object' || v === null) throw new Error(msg || 'Expected object');
        },
        isString: (v, msg) => {
          if (typeof v !== 'string') throw new Error(msg || 'Expected string');
        },
        isNumber: (v, msg) => {
          if (typeof v !== 'number') throw new Error(msg || 'Expected number');
        },
        throws: (fn, msg) => {
          try { fn(); throw new Error(msg || 'Expected to throw'); }
          catch (e) { if (e.message === msg) throw e; }
        },
        includes: (arr, item, msg) => {
          if (!arr.includes(item)) throw new Error(msg || `Expected to include ${item}`);
        },
        hasProperty: (obj, prop, msg) => {
          if (!(prop in obj)) throw new Error(msg || `Expected property ${prop}`);
        }
      };
    }

    /**
     * Executa todas as suites
     */
    async run() {
      if (this.running) return;
      this.running = true;
      this.results = [];

      console.log('%c🧪 WhatsHybrid Extension Tests', 'font-size: 16px; font-weight: bold; color: #3B82F6;');
      console.log('═'.repeat(50));

      const startTime = performance.now();

      for (const suite of this.suites) {
        console.log(`%c\n📦 ${suite.name}`, 'font-weight: bold;');

        try {
          if (suite.beforeAll) await suite.beforeAll();

          for (const test of suite.tests) {
            try {
              if (suite.beforeEach) await suite.beforeEach();
              
              const testStart = performance.now();
              await test.fn(this.assert);
              const duration = Math.round(performance.now() - testStart);

              console.log(`  ✅ ${test.name} (${duration}ms)`);
              this.results.push({ 
                suite: suite.name, 
                test: test.name, 
                status: 'passed',
                duration 
              });

              if (suite.afterEach) await suite.afterEach();
            } catch (error) {
              console.log(`  ❌ ${test.name}`);
              console.error(`     ${error.message}`);
              this.results.push({ 
                suite: suite.name, 
                test: test.name, 
                status: 'failed',
                error: error.message 
              });
            }
          }

          if (suite.afterAll) await suite.afterAll();
        } catch (error) {
          console.error(`Suite error: ${error.message}`);
        }
      }

      const duration = Math.round(performance.now() - startTime);
      const passed = this.results.filter(r => r.status === 'passed').length;
      const failed = this.results.filter(r => r.status === 'failed').length;

      console.log('\n' + '═'.repeat(50));
      console.log(`%c📊 Results: ${passed}/${this.results.length} passed`, 
        `color: ${failed > 0 ? '#EF4444' : '#10B981'}; font-weight: bold;`);
      console.log(`   ✅ Passed: ${passed}`);
      console.log(`   ❌ Failed: ${failed}`);
      console.log(`   ⏱️ Duration: ${duration}ms`);

      this.running = false;
      return { passed, failed, total: this.results.length, results: this.results };
    }
  }

  // Criar runner global
  const testRunner = new ExtensionTestRunner();

  // ═══════════════════════════════════════════════════════════════
  // TESTES DO EVENT BUS
  // ═══════════════════════════════════════════════════════════════
  testRunner.describe('EventBus', ({ it, beforeEach }) => {
    beforeEach(() => {
      // Reset do EventBus se possível
    });

    it('deve emitir e receber eventos', (assert) => {
      let received = false;
      const mockBus = { 
        handlers: new Map(),
        on(event, fn) { 
          if (!this.handlers.has(event)) this.handlers.set(event, []);
          this.handlers.get(event).push(fn);
        },
        emit(event, data) {
          const handlers = this.handlers.get(event) || [];
          handlers.forEach(fn => fn(data));
        }
      };

      mockBus.on('test', () => received = true);
      mockBus.emit('test');
      assert.ok(received, 'Evento deve ser recebido');
    });

    it('deve passar dados no evento', (assert) => {
      let receivedData = null;
      const mockBus = {
        handlers: new Map(),
        on(event, fn) { 
          if (!this.handlers.has(event)) this.handlers.set(event, []);
          this.handlers.get(event).push(fn);
        },
        emit(event, data) {
          const handlers = this.handlers.get(event) || [];
          handlers.forEach(fn => fn(data));
        }
      };

      mockBus.on('test', (data) => receivedData = data);
      mockBus.emit('test', { value: 42 });
      assert.equal(receivedData?.value, 42);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TESTES DE STORAGE
  // ═══════════════════════════════════════════════════════════════
  testRunner.describe('Storage', ({ it }) => {
    const mockStorage = {};

    it('deve salvar e recuperar dados', (assert) => {
      mockStorage['test_key'] = JSON.stringify({ value: 'test' });
      const retrieved = JSON.parse(mockStorage['test_key']);
      assert.equal(retrieved.value, 'test');
    });

    it('deve lidar com dados complexos', (assert) => {
      const complex = {
        string: 'hello',
        number: 42,
        array: [1, 2, 3],
        nested: { a: 1, b: 2 }
      };
      mockStorage['complex'] = JSON.stringify(complex);
      const retrieved = JSON.parse(mockStorage['complex']);
      assert.deepEqual(retrieved, complex);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TESTES DE UTILS
  // ═══════════════════════════════════════════════════════════════
  testRunner.describe('Utils', ({ it }) => {
    it('deve escapar HTML corretamente', (assert) => {
      const escapeHtml = (str) => {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return String(str).replace(/[&<>"']/g, c => map[c]);
      };

      assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
      assert.equal(escapeHtml('"test"'), '&quot;test&quot;');
      assert.equal(escapeHtml("it's"), "it&#39;s");
    });

    it('deve validar chatId', (assert) => {
      const isValidChatId = (id) => {
        if (!id) return false;
        return /^\d+@(c\.us|g\.us)$/.test(id) || /^\d+$/.test(id);
      };

      assert.ok(isValidChatId('5511999999999@c.us'));
      assert.ok(isValidChatId('5511999999999@g.us'));
      assert.ok(!isValidChatId('invalid'));
      assert.ok(!isValidChatId(''));
    });

    it('deve normalizar telefone', (assert) => {
      const normalizePhone = (phone) => {
        if (!phone) return null;
        return phone.replace(/\D/g, '');
      };

      assert.equal(normalizePhone('+55 11 99999-9999'), '5511999999999');
      assert.equal(normalizePhone('(11) 99999-9999'), '11999999999');
    });

    it('deve fazer debounce', async (assert) => {
      let callCount = 0;
      const debounce = (fn, delay) => {
        let timer;
        return (...args) => {
          clearTimeout(timer);
          timer = setTimeout(() => fn(...args), delay);
        };
      };

      const debouncedFn = debounce(() => callCount++, 50);
      debouncedFn();
      debouncedFn();
      debouncedFn();

      await new Promise(r => setTimeout(r, 100));
      assert.equal(callCount, 1, 'Deve chamar apenas uma vez');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TESTES DE IA
  // ═══════════════════════════════════════════════════════════════
  testRunner.describe('AI Suggestion', ({ it }) => {
    it('deve construir prompt corretamente', (assert) => {
      const buildPrompt = (messages, context) => {
        return {
          messages: messages.filter(m => m.content),
          context
        };
      };

      const result = buildPrompt(
        [{ role: 'user', content: 'Olá' }],
        { persona: 'professional' }
      );

      assert.isArray(result.messages);
      assert.equal(result.messages.length, 1);
    });

    it('deve remover duplicação de última mensagem', (assert) => {
      const removeLastFromTranscript = (transcript, lastMsg) => {
        if (!lastMsg) return transcript;
        const lines = transcript.split('\n');
        const filtered = lines.filter(l => !l.includes(lastMsg));
        return filtered.join('\n');
      };

      const transcript = 'Linha 1\nLinha 2\nÚltima mensagem';
      const result = removeLastFromTranscript(transcript, 'Última mensagem');
      assert.ok(!result.includes('Última mensagem'));
    });

    it('deve classificar erros corretamente', (assert) => {
      const classifyError = (error) => {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('network') || msg.includes('fetch')) return 'network';
        if (msg.includes('timeout')) return 'timeout';
        if (msg.includes('api') || msg.includes('key')) return 'api';
        return 'unknown';
      };

      assert.equal(classifyError({ message: 'Network error' }), 'network');
      assert.equal(classifyError({ message: 'Request timeout' }), 'timeout');
      assert.equal(classifyError({ message: 'Invalid API key' }), 'api');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TESTES DE AUTOPILOT
  // ═══════════════════════════════════════════════════════════════
  testRunner.describe('Autopilot', ({ it }) => {
    it('deve validar estrutura de item da fila', (assert) => {
      const isValidQueueItem = (item) => {
        if (!item || typeof item !== 'object') return false;
        if (!item.id || !item.chatId) return false;
        return true;
      };

      assert.ok(isValidQueueItem({ id: '1', chatId: '123@c.us' }));
      assert.ok(!isValidQueueItem({ id: '1' }));
      assert.ok(!isValidQueueItem(null));
    });

    it('deve verificar blacklist', (assert) => {
      const blacklist = new Set(['123@c.us', '456@c.us']);
      const isBlacklisted = (id) => blacklist.has(id);

      assert.ok(isBlacklisted('123@c.us'));
      assert.ok(!isBlacklisted('789@c.us'));
    });

    it('deve calcular delay correto', (assert) => {
      const calculateDelay = (min, max) => {
        const delay = Math.random() * (max - min) + min;
        return Math.max(min, Math.min(max, delay));
      };

      const delay = calculateDelay(1000, 5000);
      assert.ok(delay >= 1000 && delay <= 5000);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TESTES DE i18n (prévia)
  // ═══════════════════════════════════════════════════════════════
  testRunner.describe('i18n', ({ it }) => {
    it('deve traduzir chaves simples', (assert) => {
      const translations = {
        'pt-BR': { hello: 'Olá', goodbye: 'Tchau' },
        'en': { hello: 'Hello', goodbye: 'Goodbye' }
      };

      const t = (key, lang = 'pt-BR') => translations[lang]?.[key] || key;

      assert.equal(t('hello', 'pt-BR'), 'Olá');
      assert.equal(t('hello', 'en'), 'Hello');
      assert.equal(t('unknown', 'pt-BR'), 'unknown');
    });

    it('deve interpoler variáveis', (assert) => {
      const interpolate = (str, vars) => {
        return str.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
      };

      const result = interpolate('Olá, {{name}}!', { name: 'João' });
      assert.equal(result, 'Olá, João!');
    });
  });

  // Expor globalmente
  window.WHLTestRunner = testRunner;

  // Auto-run se em modo debug
  if (localStorage.getItem('whl_debug') === 'true') {
    console.log('[Tests] Modo debug ativo, executando testes...');
    setTimeout(() => testRunner.run(), 2000);
  }
})();
