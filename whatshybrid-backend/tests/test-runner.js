/**
 * 🧪 WhatsHybrid - Test Runner
 * Sistema de testes automatizados em massa
 * 
 * @version 7.9.13
 */

const { EventEmitter } = require('events');

/**
 * Resultado de um teste
 */
class TestResult {
  constructor(name, suite) {
    this.name = name;
    this.suite = suite;
    this.status = 'pending'; // pending, passed, failed, skipped
    this.duration = 0;
    this.error = null;
    this.logs = [];
  }

  pass(duration) {
    this.status = 'passed';
    this.duration = duration;
    return this;
  }

  fail(error, duration) {
    this.status = 'failed';
    this.error = error;
    this.duration = duration;
    return this;
  }

  skip(reason) {
    this.status = 'skipped';
    this.error = reason;
    return this;
  }

  log(message) {
    this.logs.push({ timestamp: Date.now(), message });
  }

  toJSON() {
    return {
      name: this.name,
      suite: this.suite,
      status: this.status,
      duration: this.duration,
      error: this.error?.message || this.error,
      logs: this.logs
    };
  }
}

/**
 * Suite de testes
 */
class TestSuite {
  constructor(name, options = {}) {
    this.name = name;
    this.tests = [];
    this.beforeAll = null;
    this.afterAll = null;
    this.beforeEach = null;
    this.afterEach = null;
    this.timeout = options.timeout || 5000;
    this.skip = options.skip || false;
  }

  /**
   * Adiciona um teste
   */
  test(name, fn, options = {}) {
    this.tests.push({
      name,
      fn,
      timeout: options.timeout || this.timeout,
      skip: options.skip || false,
      only: options.only || false
    });
    return this;
  }

  /**
   * Alias para test
   */
  it(name, fn, options) {
    return this.test(name, fn, options);
  }

  /**
   * Hook antes de todos os testes
   */
  setBeforeAll(fn) {
    this.beforeAll = fn;
    return this;
  }

  /**
   * Hook após todos os testes
   */
  setAfterAll(fn) {
    this.afterAll = fn;
    return this;
  }

  /**
   * Hook antes de cada teste
   */
  setBeforeEach(fn) {
    this.beforeEach = fn;
    return this;
  }

  /**
   * Hook após cada teste
   */
  setAfterEach(fn) {
    this.afterEach = fn;
    return this;
  }
}

/**
 * Assertions
 */
const assert = {
  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected ${expected}, got ${actual}`);
    }
  },

  notEqual(actual, expected, message) {
    if (actual === expected) {
      throw new Error(message || `Expected not ${expected}`);
    }
  },

  deepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(message || `Deep equal failed: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
    }
  },

  ok(value, message) {
    if (!value) {
      throw new Error(message || `Expected truthy value, got ${value}`);
    }
  },

  notOk(value, message) {
    if (value) {
      throw new Error(message || `Expected falsy value, got ${value}`);
    }
  },

  throws(fn, expectedError, message) {
    let thrown = false;
    try {
      fn();
    } catch (e) {
      thrown = true;
      if (expectedError && !e.message.includes(expectedError)) {
        throw new Error(message || `Expected error containing "${expectedError}", got "${e.message}"`);
      }
    }
    if (!thrown) {
      throw new Error(message || 'Expected function to throw');
    }
  },

  async rejects(promise, expectedError, message) {
    try {
      await promise;
      throw new Error(message || 'Expected promise to reject');
    } catch (e) {
      if (e.message === 'Expected promise to reject') throw e;
      if (expectedError && !e.message.includes(expectedError)) {
        throw new Error(message || `Expected error containing "${expectedError}", got "${e.message}"`);
      }
    }
  },

  isType(value, type, message) {
    const actualType = typeof value;
    if (actualType !== type) {
      throw new Error(message || `Expected type ${type}, got ${actualType}`);
    }
  },

  isArray(value, message) {
    if (!Array.isArray(value)) {
      throw new Error(message || `Expected array, got ${typeof value}`);
    }
  },

  includes(array, item, message) {
    if (!array.includes(item)) {
      throw new Error(message || `Expected array to include ${item}`);
    }
  },

  hasProperty(obj, prop, message) {
    if (!(prop in obj)) {
      throw new Error(message || `Expected object to have property "${prop}"`);
    }
  },

  greaterThan(actual, expected, message) {
    if (actual <= expected) {
      throw new Error(message || `Expected ${actual} > ${expected}`);
    }
  },

  lessThan(actual, expected, message) {
    if (actual >= expected) {
      throw new Error(message || `Expected ${actual} < ${expected}`);
    }
  },

  matches(value, regex, message) {
    if (!regex.test(value)) {
      throw new Error(message || `Expected ${value} to match ${regex}`);
    }
  }
};

/**
 * Test Runner principal
 */
class TestRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.suites = [];
    this.results = [];
    this.running = false;
    this.options = {
      parallel: options.parallel || false,
      maxConcurrency: options.maxConcurrency || 5,
      stopOnFailure: options.stopOnFailure || false,
      timeout: options.timeout || 5000,
      reporter: options.reporter || 'console'
    };
  }

  /**
   * Adiciona uma suite
   */
  addSuite(suite) {
    this.suites.push(suite);
    return this;
  }

  /**
   * Cria e adiciona uma suite
   */
  describe(name, setupFn, options = {}) {
    const suite = new TestSuite(name, options);
    
    // Expor helpers para a função de setup
    const helpers = {
      test: (n, fn, opts) => suite.test(n, fn, opts),
      it: (n, fn, opts) => suite.test(n, fn, opts),
      beforeAll: (fn) => suite.setBeforeAll(fn),
      afterAll: (fn) => suite.setAfterAll(fn),
      beforeEach: (fn) => suite.setBeforeEach(fn),
      afterEach: (fn) => suite.setAfterEach(fn)
    };

    setupFn(helpers);
    this.addSuite(suite);
    return this;
  }

  /**
   * Executa um teste individual
   */
  async runTest(test, suite) {
    const result = new TestResult(test.name, suite.name);

    if (test.skip || suite.skip) {
      return result.skip('Skipped');
    }

    const startTime = Date.now();

    try {
      // BeforeEach
      if (suite.beforeEach) {
        await Promise.race([
          suite.beforeEach(),
          this._timeout(test.timeout, 'beforeEach timeout')
        ]);
      }

      // Executar teste
      await Promise.race([
        test.fn(assert, result),
        this._timeout(test.timeout, 'Test timeout')
      ]);

      // AfterEach
      if (suite.afterEach) {
        await Promise.race([
          suite.afterEach(),
          this._timeout(test.timeout, 'afterEach timeout')
        ]);
      }

      return result.pass(Date.now() - startTime);

    } catch (error) {
      // AfterEach mesmo em erro
      if (suite.afterEach) {
        try { await suite.afterEach(); } catch (_) {}
      }

      return result.fail(error, Date.now() - startTime);
    }
  }

  /**
   * Executa uma suite
   */
  async runSuite(suite) {
    const results = [];

    this.emit('suite:start', suite);

    try {
      // BeforeAll
      if (suite.beforeAll) {
        await suite.beforeAll();
      }

      // Filtrar testes "only"
      let testsToRun = suite.tests;
      const onlyTests = testsToRun.filter(t => t.only);
      if (onlyTests.length > 0) {
        testsToRun = onlyTests;
      }

      // Executar testes
      for (const test of testsToRun) {
        this.emit('test:start', test, suite);
        
        const result = await this.runTest(test, suite);
        results.push(result);
        
        this.emit('test:end', result);

        if (result.status === 'failed' && this.options.stopOnFailure) {
          break;
        }
      }

      // AfterAll
      if (suite.afterAll) {
        await suite.afterAll();
      }

    } catch (error) {
      console.error(`[TestRunner] Suite error: ${suite.name}`, error);
    }

    this.emit('suite:end', suite, results);
    return results;
  }

  /**
   * Executa todas as suites
   */
  async run() {
    if (this.running) {
      throw new Error('Tests already running');
    }

    this.running = true;
    this.results = [];
    const startTime = Date.now();

    this.emit('run:start');

    try {
      if (this.options.parallel) {
        // Execução paralela
        const promises = this.suites.map(suite => this.runSuite(suite));
        const suiteResults = await Promise.all(promises);
        this.results = suiteResults.flat();
      } else {
        // Execução sequencial
        for (const suite of this.suites) {
          const suiteResults = await this.runSuite(suite);
          this.results.push(...suiteResults);

          if (this.options.stopOnFailure && suiteResults.some(r => r.status === 'failed')) {
            break;
          }
        }
      }
    } finally {
      this.running = false;
    }

    const summary = this.getSummary();
    summary.duration = Date.now() - startTime;

    this.emit('run:end', summary);
    
    return summary;
  }

  /**
   * Timeout helper
   */
  _timeout(ms, message) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  /**
   * Obtém resumo dos resultados
   */
  getSummary() {
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const skipped = this.results.filter(r => r.status === 'skipped').length;

    return {
      total: this.results.length,
      passed,
      failed,
      skipped,
      passRate: this.results.length > 0 
        ? ((passed / this.results.length) * 100).toFixed(1) + '%'
        : '0%',
      success: failed === 0,
      results: this.results.map(r => r.toJSON())
    };
  }

  /**
   * Reporter de console
   */
  useConsoleReporter() {
    this.on('suite:start', (suite) => {
      console.log(`\n📦 Suite: ${suite.name}`);
    });

    this.on('test:end', (result) => {
      const icon = result.status === 'passed' ? '✅' :
                   result.status === 'failed' ? '❌' : '⏭️';
      const duration = result.duration ? ` (${result.duration}ms)` : '';
      console.log(`  ${icon} ${result.name}${duration}`);
      
      if (result.status === 'failed' && result.error) {
        console.log(`     ⚠️ ${result.error.message || result.error}`);
      }
    });

    this.on('run:end', (summary) => {
      console.log('\n' + '═'.repeat(50));
      console.log(`📊 Resultados: ${summary.passed}/${summary.total} passed (${summary.passRate})`);
      console.log(`   ✅ Passed: ${summary.passed}`);
      console.log(`   ❌ Failed: ${summary.failed}`);
      console.log(`   ⏭️ Skipped: ${summary.skipped}`);
      console.log(`   ⏱️ Duration: ${summary.duration}ms`);
      console.log('═'.repeat(50));
    });

    return this;
  }

  /**
   * Reporter JSON
   */
  useJSONReporter(outputPath) {
    this.on('run:end', (summary) => {
      const fs = require('fs');
      const output = {
        timestamp: new Date().toISOString(),
        ...summary
      };
      fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
      console.log(`[TestRunner] Results saved to ${outputPath}`);
    });

    return this;
  }
}

// Factory para criar runner configurado
function createTestRunner(options = {}) {
  const runner = new TestRunner(options);
  runner.useConsoleReporter();
  return runner;
}

module.exports = {
  TestRunner,
  TestSuite,
  TestResult,
  assert,
  createTestRunner
};
