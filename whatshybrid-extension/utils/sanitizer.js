/**
 * RISK-002: Global XSS Prevention Utility
 * Sistema centralizado de sanitização para prevenir XSS
 *
 * @version 1.0.0
 */
(function() {
  'use strict';

  /**
   * Sanitizador global de XSS
   */
  class Sanitizer {
    /**
     * Escapa HTML para prevenir XSS
     * @param {string} str - String a ser escapada
     * @returns {string} - String sanitizada
     */
    static escapeHtml(str) {
      if (str === null || str === undefined) return '';
      if (typeof str !== 'string') str = String(str);

      const htmlEscapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#x27;',
        '/': '&#x2F;'
      };

      return str.replace(/[&<>"'\/]/g, (char) => htmlEscapeMap[char]);
    }

    /**
     * Sanitiza atributos HTML
     * @param {string} attr - Atributo a ser sanitizado
     * @returns {string} - Atributo sanitizado
     */
    static sanitizeAttribute(attr) {
      if (!attr) return '';
      // Remove aspas e caracteres perigosos
      return String(attr).replace(/['"<>]/g, '');
    }

    /**
     * Valida e sanitiza URL para prevenir javascript: e data: URIs
     * @param {string} url - URL a ser validada
     * @returns {string|null} - URL segura ou null se inválida
     */
    static sanitizeUrl(url) {
      if (!url || typeof url !== 'string') return null;

      try {
        const parsed = new URL(url, window.location.origin);

        // Permitir apenas protocolos seguros
        const safeProtocols = ['http:', 'https:', 'blob:', 'data:'];

        if (!safeProtocols.includes(parsed.protocol)) {
          console.warn('[Sanitizer] URL com protocolo não seguro bloqueada:', url);
          return null;
        }

        // Bloquear javascript: e vbscript:
        if (url.trim().toLowerCase().startsWith('javascript:') ||
            url.trim().toLowerCase().startsWith('vbscript:') ||
            url.trim().toLowerCase().startsWith('data:text/html')) {
          console.warn('[Sanitizer] URL potencialmente maliciosa bloqueada:', url);
          return null;
        }

        return url;
      } catch (e) {
        console.warn('[Sanitizer] URL inválida:', url);
        return null;
      }
    }

    /**
     * Sanitiza ID para uso em DOM
     * @param {any} id - ID a ser sanitizado
     * @returns {string|number} - ID seguro
     */
    static sanitizeId(id) {
      // Forçar número ou string segura
      if (typeof id === 'number') return id;

      const parsed = parseInt(id);
      if (!isNaN(parsed)) return parsed;

      // Se não for número, limpar string
      return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    }

    /**
     * Sanitiza JSON parseado para prevenir prototype pollution
     * @param {any} data - Dados parseados
     * @returns {any} - Dados sanitizados
     */
    static sanitizeJson(data) {
      if (data === null || typeof data !== 'object') return data;

      // Detectar e bloquear prototype pollution
      if (data.__proto__ || data.constructor !== Object || data.prototype) {
        throw new Error('Prototype pollution attempt detected');
      }

      // Se for array, sanitizar cada item
      if (Array.isArray(data)) {
        return data.map(item => this.sanitizeJson(item));
      }

      // Se for objeto, criar novo objeto sanitizado
      const sanitized = {};
      for (const key of Object.keys(data)) {
        // Bloquear chaves perigosas
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          continue;
        }
        sanitized[key] = this.sanitizeJson(data[key]);
      }

      return sanitized;
    }

    /**
     * Remove scripts inline de string HTML
     * @param {string} html - HTML a ser sanitizado
     * @returns {string} - HTML sem scripts
     */
    static stripScripts(html) {
      if (!html || typeof html !== 'string') return '';

      // Remover tags script
      let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

      // Remover event handlers inline
      clean = clean.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
      clean = clean.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

      // Remover javascript: em hrefs
      clean = clean.replace(/href\s*=\s*["']?\s*javascript:[^"'\s>]*/gi, 'href="#"');

      return clean;
    }

    /**
     * Cria um elemento de texto seguro no DOM
     * @param {string} text - Texto a ser inserido
     * @returns {Text} - Node de texto seguro
     */
    static createTextNode(text) {
      return document.createTextNode(text || '');
    }

    /**
     * Define atributo de forma segura
     * @param {HTMLElement} element - Elemento DOM
     * @param {string} attr - Nome do atributo
     * @param {string} value - Valor do atributo
     */
    static setAttribute(element, attr, value) {
      if (!element || !attr) return;

      // Atributos permitidos
      const safeAttrs = ['id', 'class', 'data-id', 'title', 'aria-label', 'role', 'tabindex'];

      if (!safeAttrs.includes(attr.toLowerCase())) {
        console.warn('[Sanitizer] Atributo não seguro bloqueado:', attr);
        return;
      }

      element.setAttribute(attr, this.sanitizeAttribute(value));
    }

    /**
     * Define textContent de forma segura
     * @param {HTMLElement} element - Elemento DOM
     * @param {string} text - Texto a ser inserido
     */
    static setTextContent(element, text) {
      if (!element) return;
      element.textContent = text || '';
    }

    /**
     * Valida e sanitiza mensagem do WhatsApp
     * @param {string} message - Mensagem
     * @returns {string} - Mensagem sanitizada
     */
    static sanitizeWhatsAppMessage(message) {
      if (!message || typeof message !== 'string') return '';

      // Remover caracteres de controle perigosos
      let sanitized = message
        .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '') // Control chars
        .replace(/\u200B/g, '') // Zero-width space
        .replace(/\uFEFF/g, ''); // BOM

      // Limitar tamanho
      if (sanitized.length > 65536) {
        sanitized = sanitized.substring(0, 65536);
      }

      return sanitized;
    }

    /**
     * Valida número de telefone
     * @param {string} phone - Número de telefone
     * @returns {string|null} - Número sanitizado ou null
     */
    static sanitizePhone(phone) {
      if (!phone) return null;

      // Remover tudo exceto dígitos e +
      const clean = String(phone).replace(/[^\d+]/g, '');

      // Validar formato básico
      if (clean.length < 10 || clean.length > 15) {
        return null;
      }

      return clean;
    }
  }

  // Exportar para window
  window.Sanitizer = Sanitizer;

  // Adicionar método global de escape HTML para compatibilidade
  if (!window.escapeHtml) {
    window.escapeHtml = (str) => Sanitizer.escapeHtml(str);
  }

  console.log('[Sanitizer] ✅ Sistema global de sanitização XSS inicializado');

})();
