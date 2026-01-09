/**
 * ============================================
 * DocumentSender v2.0 - Módulo de Envio de Documentos
 * ============================================
 * TESTADO E FUNCIONANDO - Usa WAWebMediaPrep
 */

(function() {
  'use strict';

  const DocumentSender = {
    async send(arquivo, chatJid = null, opcoes = {}) {
      try {
        const ChatCollection = window.require('WAWebChatCollection');
        const MediaPrep = window.require('WAWebMediaPrep');
        const OpaqueData = window.require('WAWebMediaOpaqueData');

        const chats = ChatCollection.ChatCollection?.getModelsArray?.() || [];
        let chat = chatJid 
          ? chats.find(c => c.id?._serialized === chatJid || c.id?.user === chatJid.split('@')[0])
          : chats.find(c => c.active) || chats[0];
        
        if (!chat) {
          return { success: false, error: 'Chat não encontrado' };
        }
        
        let blob;
        let filename = opcoes.filename || 'arquivo';
        
        if (arquivo instanceof File) {
          blob = arquivo;
          filename = arquivo.name || filename;
        } else if (arquivo instanceof Blob) {
          blob = arquivo;
        } else if (typeof arquivo === 'string') {
          const response = await fetch(arquivo);
          blob = await response.blob();
        } else {
          return { success: false, error: 'Formato de arquivo inválido' };
        }
        
        if (blob.size === 0) {
          return { success: false, error: 'Arquivo vazio' };
        }
        
        const mimetype = opcoes.mimetype || blob.type || 'application/octet-stream';
        const mediaBlob = await OpaqueData.createFromData(blob, mimetype);
        
        const mediaPropsPromise = Promise.resolve({
          mediaBlob: mediaBlob,
          mimetype: mimetype,
          type: 'document',
          filename: filename,
          caption: opcoes.caption || '',
          size: blob.size
        });
        
        const mediaPrep = new MediaPrep.MediaPrep('document', mediaPropsPromise);
        await mediaPrep.waitForPrep();
        const result = await MediaPrep.sendMediaMsgToChat(mediaPrep, chat, {});
        
        return { 
          success: result.messageSendResult === 'OK',
          result: result,
          chatJid: chat.id?._serialized,
          filename: filename
        };
        
      } catch (error) {
        console.error('[DocumentSender] Erro:', error);
        return { success: false, error: error.message };
      }
    },

    async sendBase64(base64, filename, mimetype, chatJid, caption = '') {
      const dataUrl = `data:${mimetype};base64,${base64}`;
      return this.send(dataUrl, chatJid, { filename, mimetype, caption });
    },

    async sendArrayBuffer(arrayBuffer, filename, mimetype, chatJid, caption = '') {
      const blob = new Blob([arrayBuffer], { type: mimetype });
      return this.send(blob, chatJid, { filename, mimetype, caption });
    },

    async sendText(texto, filename, chatJid, caption = '') {
      const blob = new Blob([texto], { type: 'text/plain' });
      return this.send(blob, chatJid, { filename, mimetype: 'text/plain', caption });
    },

    isAvailable() {
      try {
        window.require('WAWebChatCollection');
        window.require('WAWebMediaPrep');
        window.require('WAWebMediaOpaqueData');
        return true;
      } catch (e) {
        return false;
      }
    }
  };

  window.DocumentSender = DocumentSender;
  console.log('[DocumentSender] ✅ v2.0 carregado');
})();
