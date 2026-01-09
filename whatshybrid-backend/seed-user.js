/**
 * Seed Script - Cria usuário padrão se não existir
 * Executado automaticamente na inicialização do servidor
 */

const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

async function seedDefaultUser() {
  // Configurações do usuário padrão
  const email = process.env.DEFAULT_USER_EMAIL || 'sevaland10@gmail.com';
  const password = process.env.DEFAULT_USER_PASSWORD || 'Cristi@no123';
  const name = process.env.DEFAULT_USER_NAME || 'Breno';

  // Conectar ao banco
  const dbPath = process.env.DATABASE_PATH || './data/whatshybrid.db';
  const dbDir = path.dirname(dbPath);
  
  // Criar diretório se não existir
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('[Seed] 📁 Diretório de dados criado:', dbDir);
  }

  const db = new Database(dbPath);

  try {
    // Verificar se tabela users existe
    const tableExists = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='users'
    `).get();

    if (!tableExists) {
      console.log('[Seed] ⚠️ Tabela users não existe ainda. Aguardando inicialização do banco...');
      db.close();
      return;
    }

    // Verificar se usuário já existe
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    
    if (existingUser) {
      console.log('[Seed] ✅ Usuário padrão já existe:', email);
      db.close();
      return;
    }

    // Criar usuário
    console.log('[Seed] 🔧 Criando usuário padrão...');
    
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    const workspaceId = uuidv4();

    // Iniciar transação
    const transaction = db.transaction(() => {
      // Criar workspace primeiro
      db.prepare(`
        INSERT INTO workspaces (id, name, owner_id, credits, created_at, updated_at) 
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(workspaceId, `${name}'s Workspace`, userId, 1000);

      // Criar usuário
      db.prepare(`
        INSERT INTO users (id, email, password, name, role, workspace_id, created_at, updated_at) 
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(userId, email, hashedPassword, name, 'owner', workspaceId);

      // Criar estágios de pipeline padrão
      const stages = [
        { name: 'Lead', color: '#3b82f6', position: 0 },
        { name: 'Qualificado', color: '#8b5cf6', position: 1 },
        { name: 'Proposta', color: '#f59e0b', position: 2 },
        { name: 'Negociação', color: '#ef4444', position: 3 },
        { name: 'Fechado', color: '#10b981', position: 4 }
      ];

      stages.forEach(stage => {
        db.prepare(`
          INSERT INTO pipeline_stages (id, workspace_id, name, color, position) 
          VALUES (?, ?, ?, ?, ?)
        `).run(uuidv4(), workspaceId, stage.name, stage.color, stage.position);
      });

      // Criar labels padrão
      const labels = [
        { name: 'VIP', color: '#fbbf24' },
        { name: 'Novo', color: '#3b82f6' },
        { name: 'Recorrente', color: '#10b981' },
        { name: 'Pendente', color: '#ef4444' }
      ];

      labels.forEach(label => {
        db.prepare(`
          INSERT INTO labels (id, workspace_id, name, color) 
          VALUES (?, ?, ?, ?)
        `).run(uuidv4(), workspaceId, label.name, label.color);
      });
    });

    transaction();

    console.log('[Seed] ✅ Usuário padrão criado com sucesso!');
    console.log('[Seed] 📧 Email:', email);
    console.log('[Seed] 🔑 Senha:', password);
    console.log('[Seed] 👤 Nome:', name);

  } catch (error) {
    console.error('[Seed] ❌ Erro ao criar usuário:', error.message);
  } finally {
    db.close();
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  require('dotenv').config();
  seedDefaultUser().then(() => process.exit(0));
}

module.exports = { seedDefaultUser };
