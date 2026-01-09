#!/usr/bin/env node
/**
 * 🧪 Test Runner Principal
 * Executa todos os testes em Node.js
 * 
 * Uso:
 *   node tests/run-all.js              # Todos os testes
 *   node tests/run-all.js --unit       # Apenas testes unitários
 *   node tests/run-all.js --integration # Apenas testes de integração
 *   node tests/run-all.js --verbose    # Com logs detalhados
 * 
 * @version 1.0.0
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ============================================
// CONFIGURAÇÃO
// ============================================

const TESTS_DIR = __dirname;
const UNIT_TESTS = [
  'unit/event-bus.test.js',
  'unit/scheduler.test.js'
];

const INTEGRATION_TESTS = [
  'integration/smoke-test.js'
];

// Parse args
const args = process.argv.slice(2);
const flags = {
  unit: args.includes('--unit'),
  integration: args.includes('--integration'),
  verbose: args.includes('--verbose'),
  all: !args.includes('--unit') && !args.includes('--integration')
};

if (flags.verbose) {
  process.env.VERBOSE = '1';
}

// ============================================
// FUNÇÕES
// ============================================

function printHeader() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          🧪 WhatsHybrid Test Suite v1.0.0                 ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Ambiente: Node.js (sem dependência de browser)          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');
}

function printSectionHeader(title) {
  console.log('');
  console.log('┌' + '─'.repeat(58) + '┐');
  console.log('│ ' + title.padEnd(56) + ' │');
  console.log('└' + '─'.repeat(58) + '┘');
}

async function runTest(testPath) {
  const fullPath = path.join(TESTS_DIR, testPath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`  ⚠️  Arquivo não encontrado: ${testPath}`);
    return { success: false, error: 'File not found' };
  }

  return new Promise((resolve) => {
    const child = spawn('node', [fullPath], {
      cwd: TESTS_DIR,
      env: { ...process.env },
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        exitCode: code
      });
    });

    child.on('error', (error) => {
      resolve({
        success: false,
        error: error.message
      });
    });
  });
}

async function runTestSuite(name, tests) {
  printSectionHeader(name);
  
  const results = {
    total: tests.length,
    passed: 0,
    failed: 0,
    errors: []
  };

  for (const test of tests) {
    console.log(`\n📄 Executando: ${test}`);
    console.log('-'.repeat(60));
    
    const result = await runTest(test);
    
    if (result.success) {
      results.passed++;
    } else {
      results.failed++;
      results.errors.push({ test, ...result });
    }
  }

  return results;
}

// ============================================
// MAIN
// ============================================

async function main() {
  printHeader();

  const startTime = Date.now();
  const allResults = [];

  // Testes Unitários
  if (flags.unit || flags.all) {
    const unitResults = await runTestSuite('📦 TESTES UNITÁRIOS', UNIT_TESTS);
    allResults.push({ name: 'Unit', ...unitResults });
  }

  // Testes de Integração
  if (flags.integration || flags.all) {
    const integrationResults = await runTestSuite('🔗 TESTES DE INTEGRAÇÃO', INTEGRATION_TESTS);
    allResults.push({ name: 'Integration', ...integrationResults });
  }

  // Resumo Final
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    📊 RESUMO FINAL                        ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const result of allResults) {
    totalPassed += result.passed;
    totalFailed += result.failed;
    
    const status = result.failed === 0 ? '✅' : '❌';
    const line = `║  ${status} ${result.name.padEnd(15)} ${result.passed} passed, ${result.failed} failed`;
    console.log(line.padEnd(59) + '║');
  }
  
  console.log('╠══════════════════════════════════════════════════════════╣');
  
  const totalTests = totalPassed + totalFailed;
  const successRate = totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0;
  
  console.log(`║  Total: ${totalPassed}/${totalTests} (${successRate}%)`.padEnd(59) + '║');
  console.log(`║  Tempo: ${totalTime}s`.padEnd(59) + '║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  if (totalFailed > 0) {
    console.log('\n❌ Alguns testes falharam!\n');
    process.exit(1);
  } else {
    console.log('\n🎉 Todos os testes passaram!\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('\n💥 Erro fatal:', err.message);
  process.exit(1);
});
