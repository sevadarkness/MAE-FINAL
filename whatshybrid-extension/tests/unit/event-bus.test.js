/**
 * 🧪 Testes Unitários - EventBus Central
 * Roda 100% em Node.js
 */

require('../setup');
const { TestRunner, assert, resetMocks } = require('../setup');

// ============================================
// MOCK DO EVENTBUS
// ============================================

class EventBusMock {
  constructor() {
    this.listeners = new Map();
    this.onceListeners = new Map();
    this.history = [];
    this.moduleStatus = new Map();
    this.selectorStatus = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return () => this.off(event, callback);
  }

  once(event, callback) {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, []);
    }
    this.onceListeners.get(event).push(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const listeners = this.listeners.get(event);
      const index = listeners.indexOf(callback);
      if (index > -1) listeners.splice(index, 1);
    }
  }

  emit(event, data = {}) {
    this.history.push({ event, data, timestamp: Date.now() });

    // Listeners normais
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }

    // Listeners once
    if (this.onceListeners.has(event)) {
      const listeners = this.onceListeners.get(event);
      this.onceListeners.delete(event);
      listeners.forEach(cb => cb(data));
    }

    // Wildcard
    if (this.listeners.has('*')) {
      this.listeners.get('*').forEach(cb => cb({ event, data }));
    }

    return true;
  }

  registerModule(name, status = 'loaded') {
    this.moduleStatus.set(name, { status, loadedAt: Date.now(), errors: 0 });
    this.emit('system:module_loaded', { module: name, status });
  }

  registerSelectorStatus(name, status) {
    this.selectorStatus.set(name, { status, checkedAt: Date.now() });
  }

  getHistory(filter = null) {
    if (!filter) return [...this.history];
    return this.history.filter(e => e.event.includes(filter));
  }

  clearHistory() {
    this.history = [];
  }
}

// ============================================
// TESTES
// ============================================

const runner = new TestRunner('EventBus Central - Testes Unitários');

// Test: Registrar e emitir evento
runner.test('Registra listener e recebe evento', () => {
  const bus = new EventBusMock();
  let received = null;

  bus.on('test:event', (data) => {
    received = data;
  });

  bus.emit('test:event', { value: 42 });

  assert.notNull(received, 'Deve receber dados');
  assert.equal(received.value, 42, 'Valor deve ser 42');
});

// Test: Múltiplos listeners
runner.test('Múltiplos listeners recebem mesmo evento', () => {
  const bus = new EventBusMock();
  let count = 0;

  bus.on('multi', () => count++);
  bus.on('multi', () => count++);
  bus.on('multi', () => count++);

  bus.emit('multi');

  assert.equal(count, 3, 'Todos os 3 listeners devem ser chamados');
});

// Test: Remover listener
runner.test('Remove listener corretamente', () => {
  const bus = new EventBusMock();
  let count = 0;

  const unsubscribe = bus.on('remove:test', () => count++);

  bus.emit('remove:test');
  assert.equal(count, 1, 'Primeiro emit deve incrementar');

  unsubscribe();
  bus.emit('remove:test');
  assert.equal(count, 1, 'Após remover, não deve incrementar');
});

// Test: Listener once
runner.test('Listener once executa apenas uma vez', () => {
  const bus = new EventBusMock();
  let count = 0;

  bus.once('once:event', () => count++);

  bus.emit('once:event');
  bus.emit('once:event');
  bus.emit('once:event');

  assert.equal(count, 1, 'Deve executar apenas uma vez');
});

// Test: Wildcard listener
runner.test('Wildcard listener recebe todos os eventos', () => {
  const bus = new EventBusMock();
  let events = [];

  bus.on('*', ({ event }) => events.push(event));

  bus.emit('event:a');
  bus.emit('event:b');
  bus.emit('event:c');

  assert.equal(events.length, 3, 'Deve receber 3 eventos');
  assert.includes(events, 'event:a', 'Deve incluir event:a');
  assert.includes(events, 'event:b', 'Deve incluir event:b');
});

// Test: Histórico de eventos
runner.test('Histórico registra todos os eventos', () => {
  const bus = new EventBusMock();

  bus.emit('hist:1', { n: 1 });
  bus.emit('hist:2', { n: 2 });
  bus.emit('hist:3', { n: 3 });

  const history = bus.getHistory();
  assert.equal(history.length, 3, 'Histórico deve ter 3 entradas');

  const filtered = bus.getHistory('hist:1');
  assert.equal(filtered.length, 1, 'Filtro deve retornar 1 entrada');
});

// Test: Limpar histórico
runner.test('Limpa histórico corretamente', () => {
  const bus = new EventBusMock();

  bus.emit('a');
  bus.emit('b');
  assert.equal(bus.getHistory().length, 2, 'Deve ter 2 entradas');

  bus.clearHistory();
  assert.equal(bus.getHistory().length, 0, 'Deve estar vazio após limpar');
});

// Test: Registro de módulo
runner.test('Registra status de módulo', () => {
  const bus = new EventBusMock();
  let moduleEvent = null;

  bus.on('system:module_loaded', (data) => {
    moduleEvent = data;
  });

  bus.registerModule('TestModule', 'loaded');

  assert.notNull(moduleEvent, 'Evento de módulo deve ser emitido');
  assert.equal(moduleEvent.module, 'TestModule', 'Nome do módulo deve corresponder');
  assert.true(bus.moduleStatus.has('TestModule'), 'Status deve ser registrado');
});

// Test: Registro de seletor
runner.test('Registra status de seletor', () => {
  const bus = new EventBusMock();

  bus.registerSelectorStatus('MESSAGE_INPUT', 'working');
  bus.registerSelectorStatus('SEND_BUTTON', 'broken');

  assert.true(bus.selectorStatus.has('MESSAGE_INPUT'), 'Seletor 1 deve estar registrado');
  assert.true(bus.selectorStatus.has('SEND_BUTTON'), 'Seletor 2 deve estar registrado');
  assert.equal(bus.selectorStatus.get('MESSAGE_INPUT').status, 'working', 'Status deve ser working');
  assert.equal(bus.selectorStatus.get('SEND_BUTTON').status, 'broken', 'Status deve ser broken');
});

// Test: Dados passados corretamente
runner.test('Dados são passados corretamente para listeners', () => {
  const bus = new EventBusMock();
  let receivedData = null;

  bus.on('data:test', (data) => {
    receivedData = data;
  });

  const testData = {
    id: 123,
    name: 'Test',
    nested: { a: 1, b: 2 },
    array: [1, 2, 3]
  };

  bus.emit('data:test', testData);

  assert.deepEqual(receivedData, testData, 'Dados devem ser idênticos');
});

// Test: Evento sem listeners não causa erro
runner.test('Evento sem listeners não causa erro', () => {
  const bus = new EventBusMock();
  
  // Não deve lançar exceção
  const result = bus.emit('no:listener', { test: true });
  
  assert.true(result, 'Emit deve retornar true mesmo sem listeners');
});

// Test: Off com callback inexistente
runner.test('Off com callback inexistente não causa erro', () => {
  const bus = new EventBusMock();
  
  bus.on('some:event', () => {});
  
  // Não deve lançar exceção
  bus.off('some:event', () => {}); // Callback diferente
  bus.off('nonexistent:event', () => {}); // Evento inexistente
});

// ============================================
// EXECUTAR
// ============================================

async function main() {
  const results = await runner.run();
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
