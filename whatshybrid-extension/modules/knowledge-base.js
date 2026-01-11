/**
 * 📚 Knowledge Base - Base de Conhecimento para IA
 * WhatsHybrid v7.9.12
 * 
 * Funcionalidades:
 * - Armazenamento de informações do negócio
 * - FAQs (perguntas frequentes)
 * - Produtos e catálogo
 * - Políticas (pagamento, entrega, trocas)
 * - Respostas prontas (canned replies)
 * - Documentos
 * - Tom de voz e personalidade
 * - Geração de prompts para IA
 * - ✨ NOVO: Busca semântica com ranking
 * - ✨ NOVO: Estatísticas de uso por item
 * - ✨ NOVO: Import de FAQs via CSV
 * - ✨ NOVO: Sugestão automática de FAQs
 * 
 * @version 2.0.0
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'whl_knowledge_base';
  const VERSION_HISTORY_KEY = 'whl_knowledge_versions'; // PEND-LOW-004: Version history storage
  const USAGE_STORAGE_KEY = 'whl_knowledge_usage';
  const WHL_DEBUG = (typeof localStorage !== 'undefined' && localStorage.getItem('whl_debug') === 'true');

  // SECURITY FIX P0-037: Prevent Prototype Pollution from storage
  function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object') return {};

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitized = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key) && !dangerousKeys.includes(key)) {
        const value = obj[key];
        // Recursively sanitize nested objects and arrays
        if (Array.isArray(value)) {
          sanitized[key] = value.map(item =>
            (item && typeof item === 'object') ? sanitizeObject(item) : item
          );
        } else if (value && typeof value === 'object') {
          sanitized[key] = sanitizeObject(value);
        } else {
          sanitized[key] = value;
        }
      }
    }

    return sanitized;
  }

  // ═══════════════════════════════════════════════════════════════════
  // STOPWORDS para não influenciar no ranking
  // ═══════════════════════════════════════════════════════════════════
  const STOPWORDS = new Set([
    'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
    'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com', 'sem', 'e', 'ou', 'que',
    'qual', 'quais', 'como', 'quando', 'onde', 'porque', 'porquê', 'mas', 'se', 'é',
    'ser', 'está', 'estar', 'tem', 'ter', 'foi', 'era', 'será', 'muito', 'mais',
    'menos', 'já', 'ainda', 'só', 'também', 'aqui', 'ali', 'lá', 'isso', 'isto',
    'esse', 'este', 'esta', 'essa', 'meu', 'minha', 'seu', 'sua', 'ele', 'ela',
    'eles', 'elas', 'nós', 'vocês', 'voce', 'você', 'ao', 'aos', 'à', 'às'
  ]);

  const defaultKnowledge = {
    business: {
      name: '',
      description: '',
      segment: '',
      hours: 'Segunda a Sexta, 9h às 18h'
    },
    policies: {
      payment: '',
      delivery: '',
      returns: ''
    },
    products: [],  // { id, name, price, stock, description, category, usageCount }
    faq: [],       // { id, question, answer, category, tags, usageCount, lastUsed }
    cannedReplies: [], // { id, triggers: [], reply, category, usageCount }
    documents: [], // { id, name, type, content, uploadedAt }
    tone: {
      style: 'professional', // professional, friendly, formal, casual
      useEmojis: true,
      greeting: 'Olá! Como posso ajudar?',
      closing: 'Estou à disposição para qualquer dúvida!'
    },
    // ✨ Novo: perguntas não respondidas (para sugestão de FAQs)
    unansweredQuestions: [], // { question, count, firstAsked, lastAsked }
    version: '2.0.0',
    lastUpdated: Date.now()
  };

  class KnowledgeBase {
    constructor() {
      this.knowledge = { ...defaultKnowledge };
      this.initialized = false;
    }

    /**
     * Inicializa e carrega conhecimento do storage
     */
    async init() {
      if (this.initialized) return;

      try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
          // SECURITY FIX P0-037: Sanitize to prevent Prototype Pollution
          const parsed = JSON.parse(data[STORAGE_KEY]);
          this.knowledge = sanitizeObject(parsed);
          console.log('[KnowledgeBase] Conhecimento carregado:', this.knowledge);
        } else {
          console.log('[KnowledgeBase] Usando conhecimento padrão');
          await this.save();
        }
        this.initialized = true;
      } catch (error) {
        console.error('[KnowledgeBase] Erro ao inicializar:', error);
        this.knowledge = { ...defaultKnowledge };
      }
    }

    /**
     * Obtém todo o conhecimento
     * @returns {Object} - Conhecimento completo
     */
    getKnowledge() {
      return this.knowledge;
    }

    /**
     * Salva conhecimento no storage
     * @param {Object} knowledge - Conhecimento para salvar
     */
    async saveKnowledge(knowledge) {
      try {
        this.knowledge = {
          ...knowledge,
          lastUpdated: Date.now(),
          version: knowledge.version || this.knowledge.version || '2.0.0'
        };
        
        await chrome.storage.local.set({
          [STORAGE_KEY]: JSON.stringify(this.knowledge)
        });

        console.log('[KnowledgeBase] Conhecimento salvo');

        // Marcar sync pendente (se houver manager)
        try {
          window.KBSyncManager?.markPendingSync?.();
          // Melhor esforço: tentar enviar imediatamente
          window.KBSyncManager?.syncToBackend?.().catch?.(() => {});
        } catch (_) {}

        // Emite evento
        if (window.EventBus) {
          window.EventBus.emit('knowledge-base:updated', this.knowledge);
        }

        return true;
      } catch (error) {
        console.error('[KnowledgeBase] Erro ao salvar:', error);
        return false;
      }
    }

    /**
     * Salva conhecimento atual
     */
    async save() {
      // PEND-LOW-004: Criar snapshot da versão antes de salvar
      await this.createVersionSnapshot('Auto-save');
      return this.saveKnowledge(this.knowledge);
    }

    /**
     * PEND-LOW-004: Cria um snapshot da versão atual
     * @param {string} description - Descrição da mudança
     */
    async createVersionSnapshot(description = 'Manual snapshot') {
      try {
        const snapshot = {
          id: Date.now(),
          timestamp: Date.now(),
          description,
          data: JSON.parse(JSON.stringify(this.knowledge)), // Deep clone
          version: this.knowledge.version || '2.0.0',
          userAgent: navigator.userAgent
        };

        // Carregar histórico existente
        const result = await chrome.storage.local.get([VERSION_HISTORY_KEY]);
        // SECURITY FIX P0-037: Sanitize history array from storage
        let history = result[VERSION_HISTORY_KEY] ? sanitizeObject(result[VERSION_HISTORY_KEY]) : [];
        if (!Array.isArray(history)) history = [];

        // Adicionar nova versão
        history.push(snapshot);

        // Manter apenas últimas 10 versões (evitar uso excessivo de storage)
        if (history.length > 10) {
          history = history.slice(-10);
        }

        // Salvar histórico
        await chrome.storage.local.set({ [VERSION_HISTORY_KEY]: history });
        console.log('[KnowledgeBase] ✅ Snapshot de versão criado:', description);

        return snapshot.id;
      } catch (error) {
        console.error('[KnowledgeBase] ❌ Erro ao criar snapshot:', error);
        return null;
      }
    }

    /**
     * PEND-LOW-004: Obtém histórico de versões
     * @returns {Array} - Lista de versões
     */
    async getVersionHistory() {
      try {
        const result = await chrome.storage.local.get([VERSION_HISTORY_KEY]);
        // SECURITY FIX P0-037: Sanitize history array from storage
        let history = result[VERSION_HISTORY_KEY] ? sanitizeObject(result[VERSION_HISTORY_KEY]) : [];
        if (!Array.isArray(history)) history = [];

        // Retornar apenas metadados (sem os dados completos)
        return history.map(v => ({
          id: v.id,
          timestamp: v.timestamp,
          description: v.description,
          version: v.version,
          date: new Date(v.timestamp).toLocaleString()
        }));
      } catch (error) {
        console.error('[KnowledgeBase] ❌ Erro ao obter histórico:', error);
        return [];
      }
    }

    /**
     * PEND-LOW-004: Restaura uma versão específica
     * @param {number} versionId - ID da versão a restaurar
     * @returns {boolean} - Sucesso
     */
    async restoreVersion(versionId) {
      try {
        const result = await chrome.storage.local.get([VERSION_HISTORY_KEY]);
        // SECURITY FIX P0-037: Sanitize history array from storage
        let history = result[VERSION_HISTORY_KEY] ? sanitizeObject(result[VERSION_HISTORY_KEY]) : [];
        if (!Array.isArray(history)) history = [];

        const version = history.find(v => v.id === versionId);
        if (!version) {
          console.error('[KnowledgeBase] ❌ Versão não encontrada:', versionId);
          return false;
        }

        // Criar snapshot do estado atual antes de restaurar
        await this.createVersionSnapshot(`Backup antes de restaurar versão ${versionId}`);

        // Restaurar dados da versão (sanitize again for safety)
        const sanitizedData = sanitizeObject(version.data);
        await this.saveKnowledge(sanitizedData);

        console.log('[KnowledgeBase] ✅ Versão restaurada:', versionId);

        if (window.NotificationsModule?.toast) {
          window.NotificationsModule.toast('✅ Knowledge Base restaurada para versão anterior', 'success', 2500);
        }

        return true;
      } catch (error) {
        console.error('[KnowledgeBase] ❌ Erro ao restaurar versão:', error);

        if (window.NotificationsModule?.toast) {
          window.NotificationsModule.toast('❌ Erro ao restaurar versão', 'error', 2000);
        }

        return false;
      }
    }

    /**
     * PEND-LOW-004: Limpa histórico de versões
     */
    async clearVersionHistory() {
      try {
        await chrome.storage.local.remove(VERSION_HISTORY_KEY);
        console.log('[KnowledgeBase] ✅ Histórico de versões limpo');
        return true;
      } catch (error) {
        console.error('[KnowledgeBase] ❌ Erro ao limpar histórico:', error);
        return false;
      }
    }

    /**
     * Atualiza informações do negócio
     * @param {Object} business - Dados do negócio
     */
    async updateBusiness(business) {
      this.knowledge.business = { ...this.knowledge.business, ...business };
      return this.save();
    }

    /**
     * Atualiza políticas
     * @param {Object} policies - Políticas
     */
    async updatePolicies(policies) {
      this.knowledge.policies = { ...this.knowledge.policies, ...policies };
      return this.save();
    }

    /**
     * Atualiza tom de voz
     * @param {Object} tone - Tom de voz
     */
    async updateTone(tone) {
      this.knowledge.tone = { ...this.knowledge.tone, ...tone };
      return this.save();
    }

    /**
     * Adiciona produto
     * @param {Object} product - Produto
     */
    async addProduct(product) {
      const newProduct = {
        id: Date.now(),
        ...product
      };
      this.knowledge.products.push(newProduct);
      await this.save();
      return newProduct;
    }

    /**
     * Remove produto
     * @param {number} id - ID do produto
     */
    async removeProduct(id) {
      this.knowledge.products = this.knowledge.products.filter(p => p.id !== id);
      await this.save();
    }

    /**
     * Adiciona FAQ
     * @param {string} question - Pergunta
     * @param {string} answer - Resposta
     * @param {string} category - Categoria
     */
    async addFAQ(question, answer, category = 'Geral') {
      const faq = {
        id: Date.now(),
        question,
        answer,
        category,
        tags: this.extractTags(question + ' ' + answer),
        createdAt: Date.now()
      };
      this.knowledge.faq.push(faq);
      await this.save();
      return faq;
    }

    /**
     * Remove FAQ
     * @param {number} id - ID do FAQ
     */
    async removeFAQ(id) {
      this.knowledge.faq = this.knowledge.faq.filter(f => f.id !== id);
      await this.save();
    }

    /**
     * Adiciona resposta pronta
     * @param {Array} triggers - Palavras-chave que ativam a resposta
     * @param {string} reply - Resposta
     * @param {string} category - Categoria
     */
    async addCannedReply(triggers, reply, category = 'Geral') {
      const cannedReply = {
        id: Date.now(),
        triggers: Array.isArray(triggers) ? triggers : [triggers],
        reply,
        category,
        createdAt: Date.now()
      };
      this.knowledge.cannedReplies.push(cannedReply);
      await this.save();
      return cannedReply;
    }

    /**
     * Remove resposta pronta
     * @param {number} id - ID da resposta
     */
    async removeCannedReply(id) {
      this.knowledge.cannedReplies = this.knowledge.cannedReplies.filter(r => r.id !== id);
      await this.save();
    }

    /**
     * Verifica match com resposta rápida
     * @param {string} message - Mensagem
     * @param {Array} cannedReplies - Respostas rápidas
     * @returns {string|null}
     */
    checkCannedReply(message, cannedReplies = null) {
      const replies = cannedReplies || this.knowledge.cannedReplies || [];
      
      if (!Array.isArray(replies) || replies.length === 0) return null;
      
      const msgLower = (message || '').toLowerCase().trim();
      
      for (const canned of replies) {
        const triggers = Array.isArray(canned.triggers) ? canned.triggers : [canned.trigger];
        
        for (const trigger of triggers) {
          if (trigger && msgLower.includes(trigger.toLowerCase())) {
            return canned.reply || canned.response;
          }
        }
      }
      
      return null;
    }

    /**
     * Busca FAQ com score de similaridade
     * @param {string} message - Mensagem
     * @param {Array} faqs - FAQs
     * @returns {Object|null} - { question, answer, confidence }
     */
    findFAQMatch(message, faqs = null) {
      const faqList = faqs || this.knowledge.faq || [];
      
      if (!Array.isArray(faqList) || faqList.length === 0) return null;
      
      const msgWords = (message || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
      
      if (msgWords.length === 0) return null;
      
      let bestMatch = null;
      let bestScore = 0;
      
      for (const faq of faqList) {
        const questionWords = (faq.question || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
        
        if (questionWords.length === 0) continue;
        
        const matches = questionWords.filter(qw => 
          msgWords.some(mw => mw.includes(qw) || qw.includes(mw))
        );
        
        const score = (matches.length / questionWords.length) * 100;
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = {
            question: faq.question,
            answer: faq.answer,
            confidence: Math.round(score)
          };
        }
      }
      
      return bestMatch;
    }

    /**
     * Busca produto por similaridade
     * @param {string} message - Mensagem
     * @param {Array} products - Produtos
     * @returns {Object|null} - { product, confidence }
     */
    findProductMatch(message, products = null) {
      const productList = products || this.knowledge.products || [];
      
      if (!Array.isArray(productList) || productList.length === 0) return null;
      
      const msgLower = (message || '').toLowerCase();
      const msgWords = msgLower.split(/\s+/).filter(w => w.length > 2);
      
      for (const product of productList) {
        const name = (product.name || '').toLowerCase();
        
        // Match exato do nome
        if (name && msgLower.includes(name)) {
          return { product, confidence: 95 };
        }
      }
      
      // Match parcial por palavras
      let bestMatch = null;
      let bestScore = 0;
      
      for (const product of productList) {
        const nameWords = (product.name || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
        
        if (nameWords.length === 0) continue;
        
        const matches = nameWords.filter(nw => 
          msgWords.some(mw => mw.includes(nw) || nw.includes(mw))
        );
        
        const score = (matches.length / nameWords.length) * 100;
        
        if (score > bestScore && score > 50) {
          bestScore = score;
          bestMatch = { product, confidence: Math.round(score) };
        }
      }
      
      return bestMatch;
    }

    /**
     * Adiciona documento
     * @param {string} name - Nome do documento
     * @param {string} type - Tipo (pdf, txt, md)
     * @param {string} content - Conteúdo
     */
    async addDocument(name, type, content) {
      const doc = {
        id: Date.now(),
        name,
        type,
        content,
        size: content.length,
        uploadedAt: Date.now()
      };
      this.knowledge.documents.push(doc);
      await this.save();
      return doc;
    }

    /**
     * Remove documento
     * @param {number} id - ID do documento
     */
    async removeDocument(id) {
      this.knowledge.documents = this.knowledge.documents.filter(d => d.id !== id);
      await this.save();
    }

    /**
     * Extrai tags de um texto
     * @param {string} text - Texto
     * @returns {Array} - Tags extraídas
     */
    extractTags(text) {
      const words = text.toLowerCase()
        .replace(/[^\wáàâãéèêíïóôõöúçñ\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3);
      
      // Remove duplicatas
      return [...new Set(words)].slice(0, 10);
    }

    /**
     * Constrói prompt de sistema para IA
     * @param {Object} options - Opções { persona, businessContext }
     * @returns {string} - Prompt de sistema
     */
    buildSystemPrompt({ persona = 'professional', businessContext = true } = {}) {
      let prompt = '';

      // Informações do negócio
      if (businessContext && this.knowledge.business.name) {
        prompt += `Você está atendendo pela empresa "${this.knowledge.business.name}".\n`;
        
        if (this.knowledge.business.description) {
          prompt += `Sobre a empresa: ${this.knowledge.business.description}\n`;
        }
        
        if (this.knowledge.business.segment) {
          prompt += `Segmento: ${this.knowledge.business.segment}\n`;
        }
        
        if (this.knowledge.business.hours) {
          prompt += `Horário de atendimento: ${this.knowledge.business.hours}\n`;
        }
        
        prompt += '\n';
      }

      // Tom de voz
      const tone = this.knowledge.tone;
      if (tone.style) {
        const styleMap = {
          professional: 'Mantenha um tom profissional, educado e objetivo.',
          friendly: 'Seja amigável, acolhedor e use um tom descontraído.',
          formal: 'Use um tom formal e respeitoso.',
          casual: 'Seja casual e informal, como um amigo.'
        };
        prompt += `${styleMap[tone.style] || styleMap.professional}\n`;
      }

      if (tone.useEmojis) {
        prompt += 'Você pode usar emojis ocasionalmente para tornar a conversa mais amigável.\n';
      }

      prompt += '\n';

      // Políticas
      if (this.knowledge.policies.payment) {
        prompt += `Política de Pagamento: ${this.knowledge.policies.payment}\n`;
      }
      if (this.knowledge.policies.delivery) {
        prompt += `Política de Entrega: ${this.knowledge.policies.delivery}\n`;
      }
      if (this.knowledge.policies.returns) {
        prompt += `Política de Trocas/Devoluções: ${this.knowledge.policies.returns}\n`;
      }

      if (this.knowledge.policies.payment || this.knowledge.policies.delivery || this.knowledge.policies.returns) {
        prompt += '\n';
      }

      // FAQs
      if (this.knowledge.faq.length > 0) {
        prompt += 'Perguntas Frequentes:\n';
        this.knowledge.faq.slice(0, 10).forEach((faq, i) => {
          prompt += `${i + 1}. ${faq.question}\n   R: ${faq.answer}\n`;
        });
        prompt += '\n';
      }

      // Produtos
      if (this.knowledge.products.length > 0) {
        prompt += 'Produtos disponíveis:\n';
        this.knowledge.products.slice(0, 20).forEach((product, i) => {
          prompt += `${i + 1}. ${product.name}`;
          if (product.price > 0) {
            prompt += ` - R$ ${product.price.toFixed(2)}`;
          }
          if (product.stock !== undefined) {
            prompt += ` (Estoque: ${product.stock})`;
          }
          if (product.description) {
            prompt += ` - ${product.description}`;
          }
          prompt += '\n';
        });
        prompt += '\n';
      }

      // Instruções finais
      prompt += 'Responda de forma clara, útil e contextualizada. Seja conciso mas completo.';

      return prompt;
    }

    /**
     * Exporta conhecimento como JSON
     * @returns {string} - JSON do conhecimento
     */
    exportJSON() {
      return JSON.stringify(this.knowledge, null, 2);
    }

    /**
     * Importa conhecimento de JSON
     * @param {string} json - JSON do conhecimento
     */
    async importJSON(json) {
      try {
        const imported = JSON.parse(json);

        // SECURITY FIX P0-037: Sanitize imported JSON to prevent Prototype Pollution
        const sanitized = sanitizeObject(imported);

        // Valida estrutura básica
        if (!sanitized.business || !sanitized.policies || !sanitized.tone) {
          throw new Error('JSON inválido: estrutura incorreta');
        }

        await this.saveKnowledge(sanitized);
        console.log('[KnowledgeBase] Conhecimento importado');
        return true;
      } catch (error) {
        console.error('[KnowledgeBase] Erro ao importar JSON:', error);
        return false;
      }
    }

    /**
     * Limpa todo o conhecimento
     */
    async clear() {
      this.knowledge = { ...defaultKnowledge };
      await this.save();
      console.log('[KnowledgeBase] Conhecimento limpo');
    }

    /**
     * Obtém estatísticas
     * @returns {Object} - Estatísticas
     */
    getStats() {
      return {
        products: this.knowledge.products.length,
        faqs: this.knowledge.faq.length,
        cannedReplies: this.knowledge.cannedReplies.length,
        documents: this.knowledge.documents.length,
        hasBusinessInfo: !!this.knowledge.business.name,
        hasPolicies: !!(this.knowledge.policies.payment || this.knowledge.policies.delivery || this.knowledge.policies.returns),
        lastUpdated: this.knowledge.lastUpdated,
        // ✨ Novas métricas
        unansweredQuestions: (this.knowledge.unansweredQuestions || []).length,
        topUsedFAQs: (this.knowledge.faq || [])
          .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
          .slice(0, 5)
          .map(f => ({ question: f.question, usageCount: f.usageCount || 0 })),
        topUsedProducts: (this.knowledge.products || [])
          .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
          .slice(0, 5)
          .map(p => ({ name: p.name, usageCount: p.usageCount || 0 }))
      };
    }

    // ═══════════════════════════════════════════════════════════════════
    // ✨ NOVOS MÉTODOS v2.0 - Busca Semântica com Ranking
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Tokeniza texto removendo stopwords
     * @param {string} text - Texto
     * @returns {Array<string>} - Tokens
     */
    tokenize(text) {
      return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove acentos
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
    }

    /**
     * Calcula similaridade entre dois conjuntos de tokens
     * @param {Array<string>} tokens1 
     * @param {Array<string>} tokens2 
     * @returns {number} - Score 0-1
     */
    calculateSimilarity(tokens1, tokens2) {
      if (!tokens1.length || !tokens2.length) return 0;
      
      const set1 = new Set(tokens1);
      const set2 = new Set(tokens2);
      
      // Jaccard similarity
      const intersection = [...set1].filter(x => set2.has(x)).length;
      const union = new Set([...set1, ...set2]).size;
      const jaccardScore = intersection / union;
      
      // Bonus para matches parciais (substring)
      let substringBonus = 0;
      for (const t1 of tokens1) {
        for (const t2 of tokens2) {
          if (t1.includes(t2) || t2.includes(t1)) {
            substringBonus += 0.1;
          }
        }
      }
      
      return Math.min(jaccardScore + substringBonus, 1);
    }

    /**
     * Busca FAQ com ranking avançado
     * @param {string} query - Consulta
     * @param {number} topK - Número máximo de resultados
     * @returns {Array<Object>} - FAQs rankeadas com score
     */
    searchFAQs(query, topK = 5) {
      const queryTokens = this.tokenize(query);
      if (!queryTokens.length) return [];

      const results = this.knowledge.faq.map(faq => {
        const questionTokens = this.tokenize(faq.question);
        const answerTokens = this.tokenize(faq.answer);
        const tagTokens = (faq.tags || []).flatMap(t => this.tokenize(t));

        // Score de diferentes componentes
        const questionScore = this.calculateSimilarity(queryTokens, questionTokens) * 0.5;
        const answerScore = this.calculateSimilarity(queryTokens, answerTokens) * 0.2;
        const tagScore = this.calculateSimilarity(queryTokens, tagTokens) * 0.2;
        
        // Bonus por uso frequente (popularidade)
        const popularityBonus = Math.min((faq.usageCount || 0) / 100, 0.1);
        
        const totalScore = questionScore + answerScore + tagScore + popularityBonus;

        return {
          ...faq,
          score: totalScore,
          confidence: Math.round(totalScore * 100)
        };
      });

      return results
        .filter(r => r.score > 0.1) // threshold mínimo
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    /**
     * Busca produtos com ranking avançado
     * @param {string} query - Consulta
     * @param {number} topK - Número máximo de resultados
     * @returns {Array<Object>} - Produtos rankeados com score
     */
    searchProducts(query, topK = 5) {
      const queryTokens = this.tokenize(query);
      if (!queryTokens.length) return [];

      const results = this.knowledge.products.map(product => {
        const nameTokens = this.tokenize(product.name);
        const descTokens = this.tokenize(product.description);
        const categoryTokens = this.tokenize(product.category);

        const nameScore = this.calculateSimilarity(queryTokens, nameTokens) * 0.6;
        const descScore = this.calculateSimilarity(queryTokens, descTokens) * 0.25;
        const categoryScore = this.calculateSimilarity(queryTokens, categoryTokens) * 0.1;
        const popularityBonus = Math.min((product.usageCount || 0) / 50, 0.05);

        const totalScore = nameScore + descScore + categoryScore + popularityBonus;

        return {
          ...product,
          score: totalScore,
          confidence: Math.round(totalScore * 100)
        };
      });

      return results
        .filter(r => r.score > 0.1)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    /**
     * Registra uso de um FAQ
     * @param {number} faqId - ID do FAQ
     */
    async recordFAQUsage(faqId) {
      const faq = this.knowledge.faq.find(f => f.id === faqId);
      if (faq) {
        faq.usageCount = (faq.usageCount || 0) + 1;
        faq.lastUsed = Date.now();
        await this.save();
        
        if (window.EventBus) {
          window.EventBus.emit('knowledge:faq_used', { faqId, usageCount: faq.usageCount });
        }
      }
    }

    /**
     * Registra uso de um produto
     * @param {number} productId - ID do produto
     */
    async recordProductUsage(productId) {
      const product = this.knowledge.products.find(p => p.id === productId);
      if (product) {
        product.usageCount = (product.usageCount || 0) + 1;
        product.lastUsed = Date.now();
        await this.save();
        
        if (window.EventBus) {
          window.EventBus.emit('knowledge:product_used', { productId, usageCount: product.usageCount });
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ✨ NOVOS MÉTODOS v2.0 - Import de FAQs via CSV
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Importa FAQs de CSV
     * @param {string} csvText - Texto CSV
     * @returns {Array} - FAQs importados
     */
    parseFAQsCSV(csvText) {
      if (!csvText || typeof csvText !== 'string') return [];

      try {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) return [];

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const questionIdx = headers.findIndex(h => h.includes('pergunta') || h.includes('question') || h.includes('q'));
        const answerIdx = headers.findIndex(h => h.includes('resposta') || h.includes('answer') || h.includes('a') || h.includes('r'));
        const categoryIdx = headers.findIndex(h => h.includes('categoria') || h.includes('category') || h.includes('cat'));

        if (questionIdx === -1 || answerIdx === -1) {
          console.warn('[KnowledgeBase] CSV de FAQs precisa ter colunas pergunta e resposta');
          return [];
        }

        const faqs = [];

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Parse respeitando aspas
          const values = this.parseCSVLine(line);
          
          const question = values[questionIdx]?.trim();
          const answer = values[answerIdx]?.trim();
          
          if (question && answer) {
            faqs.push({
              id: Date.now() + i,
              question,
              answer,
              category: categoryIdx >= 0 ? values[categoryIdx]?.trim() || 'Importado' : 'Importado',
              tags: this.extractTags(question + ' ' + answer),
              usageCount: 0,
              createdAt: Date.now()
            });
          }
        }

        console.log('[KnowledgeBase] FAQs importados do CSV:', faqs.length);
        return faqs;
      } catch (error) {
        console.error('[KnowledgeBase] Erro ao parsear CSV de FAQs:', error);
        return [];
      }
    }

    /**
     * Parse de linha CSV respeitando aspas
     * @param {string} line - Linha do CSV
     * @returns {Array<string>} - Valores
     */
    parseCSVLine(line) {
      const result = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      
      result.push(current.trim());
      return result;
    }

    /**
     * Importa FAQs de CSV e adiciona ao conhecimento
     * @param {string} csvText - Texto CSV
     * @returns {Promise<number>} - Número de FAQs importados
     */
    async importFAQsFromCSV(csvText) {
      const faqs = this.parseFAQsCSV(csvText);
      
      if (faqs.length > 0) {
        this.knowledge.faq.push(...faqs);
        await this.save();
        console.log('[KnowledgeBase] FAQs importados do CSV:', faqs.length);
      }
      
      return faqs.length;
    }

    // ═══════════════════════════════════════════════════════════════════
    // ✨ NOVOS MÉTODOS v2.0 - Sugestão de FAQs
    // ═══════════════════════════════════════════════════════════════════

    /**
     * Registra pergunta não respondida
     * @param {string} question - Pergunta
     */
    async recordUnansweredQuestion(question) {
      if (!question || question.length < 10) return;

      if (!this.knowledge.unansweredQuestions) {
        this.knowledge.unansweredQuestions = [];
      }

      // Verifica se pergunta similar já existe
      const tokens = this.tokenize(question);
      const existing = this.knowledge.unansweredQuestions.find(q => {
        const existingTokens = this.tokenize(q.question);
        return this.calculateSimilarity(tokens, existingTokens) > 0.7;
      });

      if (existing) {
        existing.count++;
        existing.lastAsked = Date.now();
      } else {
        this.knowledge.unansweredQuestions.push({
          question,
          count: 1,
          firstAsked: Date.now(),
          lastAsked: Date.now()
        });
      }

      // Limita a 100 perguntas
      if (this.knowledge.unansweredQuestions.length > 100) {
        this.knowledge.unansweredQuestions.sort((a, b) => b.count - a.count);
        this.knowledge.unansweredQuestions = this.knowledge.unansweredQuestions.slice(0, 100);
      }

      await this.save();
      
      if (window.EventBus) {
        window.EventBus.emit('knowledge:unanswered_question', { question });
      }
    }

    /**
     * Obtém sugestões de FAQs a criar
     * @param {number} limit - Limite de sugestões
     * @returns {Array} - Perguntas frequentes não respondidas
     */
    getSuggestedFAQs(limit = 10) {
      return (this.knowledge.unansweredQuestions || [])
        .filter(q => q.count >= 2) // só sugere se perguntado 2+ vezes
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
        .map(q => ({
          question: q.question,
          count: q.count,
          firstAsked: q.firstAsked,
          lastAsked: q.lastAsked
        }));
    }

    /**
     * Remove pergunta não respondida (após criar FAQ)
     * @param {string} question - Pergunta
     */
    async clearUnansweredQuestion(question) {
      if (!this.knowledge.unansweredQuestions) return;

      const tokens = this.tokenize(question);
      this.knowledge.unansweredQuestions = this.knowledge.unansweredQuestions.filter(q => {
        const existingTokens = this.tokenize(q.question);
        return this.calculateSimilarity(tokens, existingTokens) < 0.7;
      });

      await this.save();
    }

    /**
     * Obtém contexto formatado para prompt de IA
     * @param {string} query - Consulta do usuário
     * @returns {Object} - Contexto relevante
     */
    getContextForQuery(query) {
      const relevantFAQs = this.searchFAQs(query, 3);
      const relevantProducts = this.searchProducts(query, 3);

      return {
        faqs: relevantFAQs.map(f => ({
          question: f.question,
          answer: f.answer,
          confidence: f.confidence
        })),
        products: relevantProducts.map(p => ({
          name: p.name,
          price: p.price,
          description: p.description,
          confidence: p.confidence
        })),
        business: this.knowledge.business,
        tone: this.knowledge.tone,
        policies: this.knowledge.policies
      };
    }

    /**
     * Faz parse de CSV de produtos
     * @param {string} csvText - Texto CSV
     * @returns {Array} - Array de produtos { id, name, price, stock, description }
     */
    parseProductsCSV(csvText) {
      if (!csvText || typeof csvText !== 'string') {
        console.warn('[KnowledgeBase] CSV inválido');
        return [];
      }

      try {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) {
          console.warn('[KnowledgeBase] CSV vazio ou sem dados');
          return [];
        }

        // Primeira linha é o cabeçalho
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        // Mapeia índices das colunas
        const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('nome') || h.includes('produto'));
        const priceIdx = headers.findIndex(h => h.includes('price') || h.includes('preco') || h.includes('preço') || h.includes('valor'));
        const stockIdx = headers.findIndex(h => h.includes('stock') || h.includes('estoque') || h.includes('quantidade'));
        const descIdx = headers.findIndex(h => h.includes('desc') || h.includes('description') || h.includes('descricao') || h.includes('descrição'));

        const products = [];

        // Processa cada linha
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const values = line.split(',').map(v => v.trim());
          
          // Cria objeto produto
          const product = {
            id: Date.now() + i,
            name: nameIdx >= 0 ? values[nameIdx] : `Produto ${i}`,
            price: priceIdx >= 0 ? parseFloat(values[priceIdx].replace(/[^\d.,]/g, '').replace(',', '.')) || 0 : 0,
            stock: stockIdx >= 0 ? parseInt(values[stockIdx]) || 0 : 0,
            description: descIdx >= 0 ? values[descIdx] : '',
            category: 'Importado',
            createdAt: Date.now()
          };

          products.push(product);
        }

        if (WHL_DEBUG) console.log('[KnowledgeBase] CSV parseado:', products.length, 'produtos');
        return products;
      } catch (error) {
        console.error('[KnowledgeBase] Erro ao fazer parse do CSV:', error);
        return [];
      }
    }

    /**
     * Importa produtos de CSV e adiciona ao conhecimento
     * @param {string} csvText - Texto CSV
     * @returns {Promise<number>} - Número de produtos importados
     */
    async importProductsFromCSV(csvText) {
      const products = this.parseProductsCSV(csvText);
      
      if (products.length > 0) {
        this.knowledge.products.push(...products);
        await this.save();
        if (WHL_DEBUG) console.log('[KnowledgeBase] Produtos importados do CSV:', products.length);
      }
      
      return products.length;
    }

    /**
     * Constrói contexto limitado por tokens (estimativa: ~4 chars por token)
     * Retorna string pronta para uso em prompt.
     */
    buildContext(knowledgeItems, maxTokens = 8000) {
      const maxChars = Math.max(0, Math.floor(maxTokens * 4));
      let context = '';

      for (const item of knowledgeItems || []) {
        const itemText = typeof item === 'string' ? item : JSON.stringify(item);
        if (!itemText) continue;

        // +1 para newline
        if ((context.length + itemText.length + 1) > maxChars) {
          if (WHL_DEBUG) console.warn('[KnowledgeBase] Contexto truncado por limite de tokens/chars');
          break;
        }

        context += itemText + '\n';
      }

      return context.trim();
    }

    /**
     * Contexto em texto (limitado) para uma query
     */
    getContextTextForQuery(query, maxTokens = 8000) {
      const ctx = this.getContextForQuery(query);
      return this.buildContext([ctx], maxTokens);
    }
  }

  // Exporta globalmente
  window.KnowledgeBase = KnowledgeBase;

  // ============================================
  // Sync Manager (KB -> Backend) + restore (Backend -> KB)
  // ============================================
  const KB_SYNC_PENDING_KEY = 'whl_kb_sync_pending';

  class KnowledgeBaseSyncManager {
    constructor() {
      this._syncInFlight = false;
    }

    async markPendingSync() {
      try {
        await chrome.storage.local.set({ [KB_SYNC_PENDING_KEY]: true });
      } catch (_) {}
    }

    async clearPendingSync() {
      try {
        await chrome.storage.local.set({ [KB_SYNC_PENDING_KEY]: false });
      } catch (_) {}
    }

    async hasPendingSync() {
      try {
        const r = await chrome.storage.local.get([KB_SYNC_PENDING_KEY]);
        return r[KB_SYNC_PENDING_KEY] === true;
      } catch (_) {
        return false;
      }
    }

    async syncToBackend() {
      if (this._syncInFlight) return false;
      if (!window.BackendClient?.isConnected?.()) return false;
      const kb = window.knowledgeBase?.getKnowledge?.();
      if (!kb) return false;

      this._syncInFlight = true;
      try {
        const result = await window.BackendClient.post('/api/v1/knowledge/sync', {
          action: 'sync',
          knowledge: kb
        });
        if (result?.success) {
          await this.clearPendingSync();
          return true;
        }
      } catch (e) {
        await this.markPendingSync();
      } finally {
        this._syncInFlight = false;
      }
      return false;
    }

    async syncFromBackend() {
      if (!window.BackendClient?.isConnected?.()) return false;
      try {
        const result = await window.BackendClient.get('/api/v1/knowledge', {});
        if (result?.success && result.knowledge) {
          await window.knowledgeBase?.saveKnowledge?.(result.knowledge);
          await this.clearPendingSync();
          return true;
        }
      } catch (_) {}
      return false;
    }

    async checkPendingSync() {
      const pending = await this.hasPendingSync();
      if (pending) {
        await this.syncToBackend();
      }
    }
  }

  if (!window.KBSyncManager) {
    window.KBSyncManager = new KnowledgeBaseSyncManager();
  }

  // Cria instância global
  if (!window.knowledgeBase) {
    window.knowledgeBase = new KnowledgeBase();
    window.knowledgeBase.init().then(() => {
      if (WHL_DEBUG) console.log('[KnowledgeBase] ✅ Módulo carregado e inicializado');
    });
  }

  // Tentar sync pendente e pull inicial (melhor esforço)
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      try {
        window.KBSyncManager?.checkPendingSync?.();
        window.KBSyncManager?.syncFromBackend?.();
      } catch (_) {}
    }, 3000);
  });

})();
