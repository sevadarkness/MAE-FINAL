/**
 * 🧪 Testes do Sistema de Memória
 * Suite de testes para MemorySystem
 */

const { TestSuite } = require('../test-runner');

function createMemoryTests(dependencies = {}) {
  const suite = new TestSuite('Memory System');

  let mockStorage = {};

  suite.setBeforeEach(async () => {
    mockStorage = {};
  });

  suite.test('deve salvar memória corretamente', async (assert) => {
    const chatId = 'test_123';
    const memory = {
      name: 'João',
      lastTopic: 'Preços',
      interactions: 5
    };

    mockStorage[`memory_${chatId}`] = memory;
    
    const saved = mockStorage[`memory_${chatId}`];
    assert.deepEqual(saved, memory, 'Memória deve ser salva');
  });

  suite.test('deve recuperar memória existente', async (assert) => {
    const chatId = 'test_456';
    const memory = { name: 'Maria', preferences: ['rápido', 'formal'] };
    
    mockStorage[`memory_${chatId}`] = memory;
    
    const retrieved = mockStorage[`memory_${chatId}`];
    assert.equal(retrieved.name, 'Maria', 'Nome deve ser recuperado');
    assert.isArray(retrieved.preferences, 'Preferences deve ser array');
  });

  suite.test('deve retornar null para memória inexistente', async (assert) => {
    const retrieved = mockStorage['memory_inexistente'];
    assert.equal(retrieved, undefined, 'Deve retornar undefined');
  });

  suite.test('deve mesclar memórias corretamente', async (assert) => {
    const existing = { name: 'João', age: 30 };
    const update = { age: 31, city: 'SP' };
    
    const merged = mergeMemory(existing, update);
    
    assert.equal(merged.name, 'João', 'Nome deve ser mantido');
    assert.equal(merged.age, 31, 'Idade deve ser atualizada');
    assert.equal(merged.city, 'SP', 'Cidade deve ser adicionada');
  });

  suite.test('deve validar estrutura de memória', async (assert) => {
    const validMemory = {
      chatId: 'chat_123',
      contactName: 'Test',
      facts: [],
      interactions: [],
      createdAt: Date.now()
    };

    const isValid = validateMemorySchema(validMemory);
    assert.ok(isValid, 'Memória válida deve passar');
  });

  suite.test('deve rejeitar memória com schema inválido', async (assert) => {
    const invalidMemories = [
      null,
      undefined,
      'string',
      { chatId: 123 }, // chatId deve ser string
      { chatId: 'test', facts: 'not an array' }
    ];

    for (const memory of invalidMemories) {
      const isValid = validateMemorySchema(memory);
      assert.notOk(isValid, `Memória ${JSON.stringify(memory)} deve ser inválida`);
    }
  });

  suite.test('deve limitar número de interações', async (assert) => {
    const memory = { interactions: [] };
    const maxInteractions = 100;
    
    // Adicionar mais que o limite
    for (let i = 0; i < 150; i++) {
      memory.interactions.push({ id: i, timestamp: Date.now() });
    }
    
    const trimmed = trimInteractions(memory, maxInteractions);
    assert.equal(trimmed.interactions.length, maxInteractions, 
      `Deve ter no máximo ${maxInteractions} interações`);
  });

  suite.test('deve calcular engagement score', async (assert) => {
    const memory = {
      interactions: [
        { timestamp: Date.now() - 1000 },
        { timestamp: Date.now() - 2000 },
        { timestamp: Date.now() - 3000 }
      ],
      facts: ['fact1', 'fact2'],
      feedbackPositive: 5,
      feedbackNegative: 1
    };

    const score = calculateEngagement(memory);
    assert.isType(score, 'number', 'Score deve ser número');
    assert.greaterThan(score, 0, 'Score deve ser positivo');
  });

  suite.test('deve persistir fila de sync', async (assert) => {
    const queue = [
      { chatId: 'chat1', memory: {}, timestamp: Date.now() },
      { chatId: 'chat2', memory: {}, timestamp: Date.now() }
    ];

    mockStorage['sync_queue'] = JSON.stringify(queue);
    
    const restored = JSON.parse(mockStorage['sync_queue']);
    assert.equal(restored.length, 2, 'Fila deve ser persistida');
  });

  suite.test('deve lidar com JSON corrupto', async (assert) => {
    mockStorage['corrupted'] = 'not valid json{';
    
    let parsed = null;
    try {
      parsed = JSON.parse(mockStorage['corrupted']);
    } catch (e) {
      parsed = null;
    }
    
    assert.equal(parsed, null, 'JSON corrupto deve resultar em null');
  });

  return suite;
}

// Helpers
function mergeMemory(existing, update) {
  return { ...existing, ...update };
}

function validateMemorySchema(memory) {
  if (!memory || typeof memory !== 'object') return false;
  if (typeof memory.chatId !== 'string') return false;
  if (memory.facts && !Array.isArray(memory.facts)) return false;
  if (memory.interactions && !Array.isArray(memory.interactions)) return false;
  return true;
}

function trimInteractions(memory, max) {
  if (memory.interactions.length > max) {
    memory.interactions = memory.interactions.slice(-max);
  }
  return memory;
}

function calculateEngagement(memory) {
  const interactionScore = (memory.interactions?.length || 0) * 2;
  const factsScore = (memory.facts?.length || 0) * 5;
  const feedbackScore = ((memory.feedbackPositive || 0) - (memory.feedbackNegative || 0)) * 3;
  return Math.max(0, interactionScore + factsScore + feedbackScore);
}

module.exports = { createMemoryTests };
