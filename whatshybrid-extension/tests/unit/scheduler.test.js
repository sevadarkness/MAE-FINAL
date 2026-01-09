/**
 * 🧪 Testes Unitários - Scheduler Global
 * Roda 100% em Node.js
 */

require('../setup');
const { TestRunner, assert, resetMocks } = require('../setup');

// ============================================
// MOCK DO SCHEDULER
// ============================================

const PRIORITY = {
  CRITICAL: 1,
  HIGH: 3,
  NORMAL: 5,
  LOW: 7,
  BACKGROUND: 10
};

class SchedulerMock {
  constructor() {
    this.queue = [];
    this.running = new Map();
    this.completed = [];
    this.failed = [];
    this.paused = false;
    this.jobId = 0;
  }

  createJob(options) {
    return {
      id: `job_${++this.jobId}`,
      type: options.type || 'custom',
      priority: options.priority || PRIORITY.NORMAL,
      name: options.name || 'Unnamed Job',
      data: options.data || {},
      handler: options.handler,
      retries: 0,
      maxRetries: options.maxRetries ?? 3,
      status: 'queued',
      createdAt: Date.now()
    };
  }

  enqueue(options) {
    const job = this.createJob(options);
    
    // Inserir ordenado por prioridade
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (job.priority < this.queue[i].priority) {
        this.queue.splice(i, 0, job);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      this.queue.push(job);
    }
    
    return job.id;
  }

  dequeue(jobId) {
    const index = this.queue.findIndex(j => j.id === jobId);
    if (index > -1) {
      return this.queue.splice(index, 1)[0];
    }
    return null;
  }

  async processNext() {
    if (this.paused || this.queue.length === 0) return null;
    
    const job = this.queue.shift();
    job.status = 'running';
    job.startedAt = Date.now();
    this.running.set(job.id, job);

    try {
      job.result = await job.handler(job.data);
      job.status = 'completed';
      job.completedAt = Date.now();
      this.completed.push(job);
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      this.failed.push(job);
    } finally {
      this.running.delete(job.id);
    }

    return job;
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  clear() {
    this.queue = [];
  }

  getStatus() {
    return {
      queued: this.queue.length,
      running: this.running.size,
      completed: this.completed.length,
      failed: this.failed.length,
      paused: this.paused
    };
  }

  getQueueOrder() {
    return this.queue.map(j => ({ id: j.id, priority: j.priority, name: j.name }));
  }
}

// ============================================
// TESTES
// ============================================

const runner = new TestRunner('Scheduler Global - Testes Unitários');

// Test: Enfileirar job
runner.test('Enfileira job corretamente', () => {
  const scheduler = new SchedulerMock();
  
  const jobId = scheduler.enqueue({
    name: 'Test Job',
    handler: async () => 'done'
  });
  
  assert.notNull(jobId, 'ID do job não deve ser nulo');
  assert.equal(scheduler.queue.length, 1, 'Fila deve ter 1 job');
});

// Test: Ordenação por prioridade
runner.test('Ordena jobs por prioridade', () => {
  const scheduler = new SchedulerMock();
  
  scheduler.enqueue({ name: 'Low', priority: PRIORITY.LOW, handler: async () => {} });
  scheduler.enqueue({ name: 'High', priority: PRIORITY.HIGH, handler: async () => {} });
  scheduler.enqueue({ name: 'Critical', priority: PRIORITY.CRITICAL, handler: async () => {} });
  scheduler.enqueue({ name: 'Normal', priority: PRIORITY.NORMAL, handler: async () => {} });
  
  const order = scheduler.getQueueOrder();
  
  assert.equal(order[0].name, 'Critical', 'Primeiro deve ser Critical');
  assert.equal(order[1].name, 'High', 'Segundo deve ser High');
  assert.equal(order[2].name, 'Normal', 'Terceiro deve ser Normal');
  assert.equal(order[3].name, 'Low', 'Quarto deve ser Low');
});

// Test: Processar job
runner.test('Processa job e move para completed', async () => {
  const scheduler = new SchedulerMock();
  
  scheduler.enqueue({
    name: 'Process Test',
    handler: async () => 'success'
  });
  
  const job = await scheduler.processNext();
  
  assert.equal(job.status, 'completed', 'Status deve ser completed');
  assert.equal(job.result, 'success', 'Resultado deve ser success');
  assert.equal(scheduler.completed.length, 1, 'Completed deve ter 1 job');
  assert.equal(scheduler.queue.length, 0, 'Fila deve estar vazia');
});

// Test: Job com erro vai para failed
runner.test('Job com erro vai para failed', async () => {
  const scheduler = new SchedulerMock();
  
  scheduler.enqueue({
    name: 'Fail Test',
    handler: async () => { throw new Error('Test error'); }
  });
  
  const job = await scheduler.processNext();
  
  assert.equal(job.status, 'failed', 'Status deve ser failed');
  assert.equal(job.error, 'Test error', 'Erro deve ser capturado');
  assert.equal(scheduler.failed.length, 1, 'Failed deve ter 1 job');
});

// Test: Pause impede processamento
runner.test('Pause impede processamento', async () => {
  const scheduler = new SchedulerMock();
  
  scheduler.enqueue({ name: 'Paused Test', handler: async () => {} });
  scheduler.pause();
  
  const job = await scheduler.processNext();
  
  assert.equal(job, null, 'Não deve processar quando pausado');
  assert.equal(scheduler.queue.length, 1, 'Job deve permanecer na fila');
});

// Test: Resume permite processamento
runner.test('Resume permite processamento', async () => {
  const scheduler = new SchedulerMock();
  
  scheduler.enqueue({ name: 'Resume Test', handler: async () => 'resumed' });
  scheduler.pause();
  scheduler.resume();
  
  const job = await scheduler.processNext();
  
  assert.notNull(job, 'Deve processar após resume');
  assert.equal(job.result, 'resumed', 'Resultado deve corresponder');
});

// Test: Clear limpa a fila
runner.test('Clear limpa a fila', () => {
  const scheduler = new SchedulerMock();
  
  scheduler.enqueue({ name: 'Job 1', handler: async () => {} });
  scheduler.enqueue({ name: 'Job 2', handler: async () => {} });
  scheduler.enqueue({ name: 'Job 3', handler: async () => {} });
  
  assert.equal(scheduler.queue.length, 3, 'Fila deve ter 3 jobs');
  
  scheduler.clear();
  
  assert.equal(scheduler.queue.length, 0, 'Fila deve estar vazia após clear');
});

// Test: Dequeue remove job específico
runner.test('Dequeue remove job específico', () => {
  const scheduler = new SchedulerMock();
  
  const id1 = scheduler.enqueue({ name: 'Job 1', handler: async () => {} });
  const id2 = scheduler.enqueue({ name: 'Job 2', handler: async () => {} });
  
  const removed = scheduler.dequeue(id1);
  
  assert.notNull(removed, 'Deve retornar job removido');
  assert.equal(removed.name, 'Job 1', 'Nome deve corresponder');
  assert.equal(scheduler.queue.length, 1, 'Fila deve ter 1 job restante');
});

// Test: Dequeue retorna null para ID inexistente
runner.test('Dequeue retorna null para ID inexistente', () => {
  const scheduler = new SchedulerMock();
  
  scheduler.enqueue({ name: 'Job', handler: async () => {} });
  
  const removed = scheduler.dequeue('nonexistent_id');
  
  assert.equal(removed, null, 'Deve retornar null para ID inexistente');
});

// Test: Status retorna informações corretas
runner.test('Status retorna informações corretas', async () => {
  const scheduler = new SchedulerMock();
  
  scheduler.enqueue({ name: 'Job 1', handler: async () => {} });
  scheduler.enqueue({ name: 'Job 2', handler: async () => {} });
  
  await scheduler.processNext();
  
  const status = scheduler.getStatus();
  
  assert.equal(status.queued, 1, 'Queued deve ser 1');
  assert.equal(status.completed, 1, 'Completed deve ser 1');
  assert.equal(status.running, 0, 'Running deve ser 0');
  assert.equal(status.failed, 0, 'Failed deve ser 0');
  assert.false(status.paused, 'Paused deve ser false');
});

// Test: Job recebe dados corretamente
runner.test('Job recebe dados corretamente', async () => {
  const scheduler = new SchedulerMock();
  let receivedData = null;
  
  scheduler.enqueue({
    name: 'Data Test',
    data: { id: 123, message: 'Hello' },
    handler: async (data) => {
      receivedData = data;
      return data;
    }
  });
  
  await scheduler.processNext();
  
  assert.notNull(receivedData, 'Dados devem ser recebidos');
  assert.equal(receivedData.id, 123, 'ID deve corresponder');
  assert.equal(receivedData.message, 'Hello', 'Mensagem deve corresponder');
});

// Test: Múltiplos jobs processados em ordem
runner.test('Múltiplos jobs processados em ordem de prioridade', async () => {
  const scheduler = new SchedulerMock();
  const results = [];
  
  scheduler.enqueue({ 
    name: 'Normal', 
    priority: PRIORITY.NORMAL, 
    handler: async () => { results.push('normal'); } 
  });
  scheduler.enqueue({ 
    name: 'High', 
    priority: PRIORITY.HIGH, 
    handler: async () => { results.push('high'); } 
  });
  scheduler.enqueue({ 
    name: 'Low', 
    priority: PRIORITY.LOW, 
    handler: async () => { results.push('low'); } 
  });
  
  await scheduler.processNext();
  await scheduler.processNext();
  await scheduler.processNext();
  
  assert.deepEqual(results, ['high', 'normal', 'low'], 'Ordem deve ser por prioridade');
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
