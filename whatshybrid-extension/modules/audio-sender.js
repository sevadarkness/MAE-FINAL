/**
 * ============================================
 * AudioSender v2.0 - Módulo de Envio de Áudio PTT
 * ============================================
 * TESTADO E FUNCIONANDO - Usa WAWebMediaPrep
 */

(function() {
  'use strict';

  const AudioSender = {
    async send(audio, chatJid = null, duration = 5) {
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
        if (audio instanceof Blob) {
          blob = audio;
        } else if (typeof audio === 'string') {
          const response = await fetch(audio);
          blob = await response.blob();
        } else {
          return { success: false, error: 'Formato de áudio inválido' };
        }
        
        if (blob.size === 0) {
          return { success: false, error: 'Arquivo de áudio vazio' };
        }
        
        const mediaBlob = await OpaqueData.createFromData(blob, blob.type);
        
        const mediaPropsPromise = Promise.resolve({
          mediaBlob: mediaBlob,
          mimetype: 'audio/ogg; codecs=opus',
          type: 'ptt',
          duration: duration,
          seconds: duration,
          isPtt: true,
          ptt: true
        });
        
        const mediaPrep = new MediaPrep.MediaPrep('ptt', mediaPropsPromise);
        await mediaPrep.waitForPrep();
        const result = await MediaPrep.sendMediaMsgToChat(mediaPrep, chat, {});
        
        return { 
          success: result.messageSendResult === 'OK',
          result: result,
          chatJid: chat.id?._serialized
        };
        
      } catch (error) {
        console.error('[AudioSender] Erro:', error);
        return { success: false, error: error.message };
      }
    },

    async sendBase64(base64, mimeType, chatJid, duration = 5) {
      const dataUrl = `data:${mimeType};base64,${base64}`;
      return this.send(dataUrl, chatJid, duration);
    },

    async sendArrayBuffer(arrayBuffer, mimeType, chatJid, duration = 5) {
      const blob = new Blob([arrayBuffer], { type: mimeType });
      return this.send(blob, chatJid, duration);
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

  window.AudioSender = AudioSender;
  console.log('[AudioSender] ✅ v2.0 carregado');
})();
