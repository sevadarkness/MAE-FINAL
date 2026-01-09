#!/usr/bin/env node
/**
 * 🧪 WhatsHybrid - Executor de Testes
 * Executa todas as suites de teste
 * 
 * Usage: node tests/run-all.js [options]
 * Options:
 *   --parallel     Executa testes em paralelo
 *   --json         Salva resultados em JSON
 *   --verbose      Modo verbose
 *   --suite=NAME   Executa apenas uma suite específica
 */

const { createTestRunner } = require('./test-runner');
const { createAuthTests } = require('./suites/auth.test');
const { createAITests } = require('./suites/ai.test');
const { createMemoryTests } = require('./suites/memory.test');

// Parse arguments
const args = process.argv.slice(2);
const options = {
  parallel: args.includes('--parallel'),
  json: args.includes('--json'),
  verbose: args.includes('--verbose'),
  suite: args.find(a => a.startsWith('--suite='))?.split('=')[1]
};

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║      🧪 WhatsHybrid Test Suite v7.9.13                    ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  const runner = createTestRunner({
    parallel: options.parallel,
    stopOnFailure: false
  });

  // Registrar suites
  const suites = {
    auth: createAuthTests(),
    ai: createAITests(),
    memory: createMemoryTests()
  };

  // Adicionar suites
  if (options.suite) {
    if (suites[options.suite]) {
      runner.addSuite(suites[options.suite]);
    } else {
      console.error(`Suite não encontrada: ${options.suite}`);
      console.log('Suites disponíveis:', Object.keys(suites).join(', '));
      process.exit(1);
    }
  } else {
    for (const suite of Object.values(suites)) {
      runner.addSuite(suite);
    }
  }

  // JSON reporter
  if (options.json) {
    runner.useJSONReporter('./test-results.json');
  }

  // Executar
  try {
    const summary = await runner.run();
    
    // Exit code baseado no resultado
    process.exit(summary.success ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Erro fatal ao executar testes:', error);
    process.exit(1);
  }
}

main();
