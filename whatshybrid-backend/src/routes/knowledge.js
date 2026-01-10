/**
 * Knowledge Routes - API para Knowledge Management
 */

const express = require('express');
const router = express.Router();
const { authenticate, apiKeyAuth } = require('../middleware/auth');
const database = require('../utils/database');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/v1/knowledge/sync
 * Sincroniza conhecimento completo
 */
router.post('/sync', authenticate, async (req, res) => {
  try {
    const { action, knowledge } = req.body;
    const workspaceId = req.user.workspace_id || 'default';
    const db = database.getDb();
    
    if (action === 'sync') {
      // Busca conhecimento existente
      const existing = await db.get(`
        SELECT * FROM knowledge_base WHERE workspace_id = ?
      `, [workspaceId]);
      
      if (existing) {
        // Merge inteligente
        const existingData = JSON.parse(existing.data || '{}');
        const mergedData = mergeKnowledge(existingData, knowledge);
        
        await db.run(`
          UPDATE knowledge_base SET
            data = ?,
            version = version + 1,
            updated_at = ?
          WHERE workspace_id = ?
        `, [JSON.stringify(mergedData), Date.now(), workspaceId]);
        
        res.json({
          success: true,
          knowledge: mergedData,
          merged: true
        });
      } else {
        // Cria novo
        await db.run(`
          INSERT INTO knowledge_base (id, workspace_id, data, version, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, ?)
        `, [uuidv4(), workspaceId, JSON.stringify(knowledge), Date.now(), Date.now()]);
        
        res.json({
          success: true,
          knowledge,
          created: true
        });
      }
    } else {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Action inválida'
      });
    }
    
  } catch (error) {
    logger.error('Error syncing knowledge:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * GET /api/v1/knowledge
 * Obtém conhecimento completo
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const workspaceId = req.user.workspace_id || 'default';
    const db = database.getDb();
    
    const knowledge = await db.get(`
      SELECT * FROM knowledge_base WHERE workspace_id = ?
    `, [workspaceId]);
    
    if (!knowledge) {
      return res.json({
        success: true,
        knowledge: null
      });
    }
    
    res.json({
      success: true,
      knowledge: JSON.parse(knowledge.data || '{}'),
      version: knowledge.version,
      updatedAt: knowledge.updated_at
    });
    
  } catch (error) {
    logger.error('Error getting knowledge:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PRODUTOS
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/knowledge/products
 */
router.get('/products', authenticate, async (req, res) => {
  try {
    const { search, category, limit = 50 } = req.query;
    const workspaceId = req.user.workspace_id || 'default';
    const db = database.getDb();
    
    let query = 'SELECT * FROM products WHERE workspace_id = ?';
    const params = [workspaceId];
    
    if (search) {
      query += ' AND (name LIKE ? OR description LIKE ? OR sku LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY name ASC LIMIT ?';
    params.push(parseInt(limit));
    
    const products = await db.all(query, params);
    
    res.json({
      success: true,
      products: products.map(p => ({
        ...p,
        specifications: JSON.parse(p.specifications || '{}'),
        tags: JSON.parse(p.tags || '[]'),
        variants: JSON.parse(p.variants || '[]')
      }))
    });
    
  } catch (error) {
    logger.error('Error listing products:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/knowledge/products
 */
router.post('/products', authenticate, async (req, res) => {
  try {
    const productData = req.body;
    const workspaceId = req.user.workspace_id || 'default';
    const db = database.getDb();
    
    const id = uuidv4();
    
    await db.run(`
      INSERT INTO products (
        id, workspace_id, name, description, short_description, sku,
        category, price, price_original, currency, stock, stock_status,
        specifications, tags, variants, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      workspaceId,
      productData.name,
      productData.description || '',
      productData.shortDescription || '',
      productData.sku || '',
      productData.category || '',
      productData.price || 0,
      productData.priceOriginal || null,
      productData.currency || 'BRL',
      productData.stock ?? null,
      productData.stockStatus || 'available',
      JSON.stringify(productData.specifications || {}),
      JSON.stringify(productData.tags || []),
      JSON.stringify(productData.variants || []),
      productData.isActive !== false ? 1 : 0,
      Date.now(),
      Date.now()
    ]);
    
    res.status(201).json({
      success: true,
      product: { id, ...productData }
    });
    
  } catch (error) {
    logger.error('Error creating product:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// FAQs
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/knowledge/faqs
 */
router.get('/faqs', authenticate, async (req, res) => {
  try {
    const { search, category, limit = 50 } = req.query;
    const workspaceId = req.user.workspace_id || 'default';
    const db = database.getDb();
    
    let query = 'SELECT * FROM faqs WHERE workspace_id = ?';
    const params = [workspaceId];
    
    if (search) {
      query += ' AND (question LIKE ? OR answer LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    query += ' ORDER BY views DESC, created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const faqs = await db.all(query, params);
    
    res.json({
      success: true,
      faqs: faqs.map(f => ({
        ...f,
        keywords: JSON.parse(f.keywords || '[]')
      }))
    });
    
  } catch (error) {
    logger.error('Error listing FAQs:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/knowledge/faqs
 */
router.post('/faqs', authenticate, async (req, res) => {
  try {
    const faqData = req.body;
    const workspaceId = req.user.workspace_id || 'default';
    const db = database.getDb();
    
    const id = uuidv4();
    
    // Auto-extrai keywords
    let keywords = faqData.keywords || [];
    if (keywords.length === 0) {
      keywords = extractKeywords(faqData.question + ' ' + faqData.answer);
    }
    
    await db.run(`
      INSERT INTO faqs (
        id, workspace_id, question, answer, category, keywords,
        views, helpful, not_helpful, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
    `, [
      id,
      workspaceId,
      faqData.question,
      faqData.answer,
      faqData.category || 'general',
      JSON.stringify(keywords),
      faqData.isActive !== false ? 1 : 0,
      Date.now(),
      Date.now()
    ]);
    
    res.status(201).json({
      success: true,
      faq: { id, ...faqData, keywords }
    });
    
  } catch (error) {
    logger.error('Error creating FAQ:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

/**
 * POST /api/v1/knowledge/faqs/search
 * Busca FAQs relevantes para uma query
 */
router.post('/faqs/search', authenticate, async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    const workspaceId = req.user.workspace_id || 'default';
    const db = database.getDb();
    
    // Busca todas as FAQs ativas
    const faqs = await db.all(`
      SELECT * FROM faqs WHERE workspace_id = ? AND is_active = 1
    `, [workspaceId]);
    
    // Ranking por relevância
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);
    
    const scored = faqs.map(faq => {
      let score = 0;
      const keywords = JSON.parse(faq.keywords || '[]');
      
      // Match exato na pergunta
      if (faq.question.toLowerCase().includes(queryLower)) {
        score += 10;
      }
      
      // Match em keywords
      keywords.forEach(kw => {
        if (queryLower.includes(kw.toLowerCase())) {
          score += 5;
        }
      });
      
      // Match parcial
      queryWords.forEach(word => {
        if (word.length > 2) {
          if (faq.question.toLowerCase().includes(word)) score += 2;
          if (faq.answer.toLowerCase().includes(word)) score += 1;
        }
      });
      
      return { ...faq, score, keywords };
    }).filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    
    // SECURITY FIX (RISK-003): Incrementa views com validação de workspace_id
    for (const faq of scored) {
      await db.run('UPDATE faqs SET views = views + 1 WHERE id = ? AND workspace_id = ?', [faq.id, workspaceId]);
    }
    
    res.json({
      success: true,
      faqs: scored
    });
    
  } catch (error) {
    logger.error('Error searching FAQs:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════

function mergeKnowledge(existing, incoming) {
  // Deep merge com preferência para dados mais recentes
  const result = { ...existing };
  
  for (const key in incoming) {
    if (Array.isArray(incoming[key])) {
      // Merge de arrays (produtos, FAQs, etc.)
      result[key] = mergeArrays(existing[key] || [], incoming[key]);
    } else if (typeof incoming[key] === 'object' && incoming[key] !== null) {
      // Merge recursivo de objetos
      result[key] = mergeKnowledge(existing[key] || {}, incoming[key]);
    } else {
      // Valor simples - usa o incoming
      result[key] = incoming[key];
    }
  }
  
  return result;
}

function mergeArrays(existing, incoming) {
  const map = new Map();
  
  // Adiciona existentes
  existing.forEach(item => {
    if (item.id) {
      map.set(item.id, item);
    }
  });
  
  // Sobrescreve/adiciona incoming
  incoming.forEach(item => {
    if (item.id) {
      map.set(item.id, item);
    }
  });
  
  return Array.from(map.values());
}

function extractKeywords(text) {
  const stopWords = ['de', 'da', 'do', 'em', 'para', 'com', 'por', 'uma', 'um', 'os', 'as', 'que', 'é', 'o', 'a', 'e'];
  const words = text.toLowerCase()
    .replace(/[^\w\sáéíóúâêîôûãõç]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.includes(w));
  
  return [...new Set(words)].slice(0, 10);
}

module.exports = router;
