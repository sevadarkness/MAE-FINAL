/**
 * 📎 Media Sender - Envio de Mídia Corrigido (CORRIGIDO)
 *
 * Envia imagens, áudios e arquivos via DOM (sem APIs internas).
 *
 * @version 2.0.0 - CORRIGIDO
 */

(function() {
  'use strict';

  if (window.__MEDIA_SENDER_FIXED__) return;
  window.__MEDIA_SENDER_FIXED__ = true;

  const DEBUG = localStorage.getItem('whl_debug') === 'true';
  function log(...args) { if (DEBUG) console.log('[MediaSender]', ...args); }

  // ============================================
  // SELETORES ATUALIZADOS 2024/2025
  // ============================================

  const SELECTORS = {
    // Botão de anexar
    ATTACH_BUTTON: [
      'footer button[aria-label*="Anexar"]',
      'footer button[title*="Anexar"]',
      '[data-testid="attach-clip"]',
      '[data-testid="clip"]',
      'footer span[data-icon="attach-menu-plus"]',
      'footer span[data-icon="clip"]',
      'footer span[data-icon="attach"]',
      '[aria-label="Anexar"]',
      'button[aria-label*="Attach"]'
    ],

    // Input de arquivo
    FILE_INPUT: [
      'input[type="file"][accept*="image/*,video/mp4"]',
      'input[type="file"][accept*="image"]',
      'input[accept*="image"]',
      'input[type="file"]'
    ],

    // Input de documento
    DOCUMENT_INPUT: [
      'input[type="file"][accept*="application"]',
      'input[type="file"][accept="*"]',
      'input[accept*="pdf"]'
    ],

    // Campo de legenda (preview de mídia)
    CAPTION_BOX: [
      '[data-testid="media-caption-input-container"] div[contenteditable="true"]',
      'div[aria-label*="legenda"][contenteditable="true"]',
      'div[aria-label*="Legenda"][contenteditable="true"]',
      'div[aria-label*="Adicionar"][contenteditable="true"]',
      'div[aria-label*="caption"][contenteditable="true"]'
    ],

    // Botão enviar no preview
    SEND_PREVIEW: [
      '[data-testid="send"]',
      'div[role="dialog"] span[data-icon="send"]',
      'div[role="dialog"] button[aria-label*="Enviar"]',
      'span[data-icon="send"]',
      '[aria-label="Enviar"]'
    ],

    // Menu de anexar
    ATTACH_MENU: [
      '[data-testid="attach-menu"]',
      'ul[role="menu"]',
      'div[role="menu"]'
    ],

    // Opções do menu
    MENU_IMAGE: [
      'li[data-testid="mi-attach-media"]',
      'li button[aria-label*="Fotos"]',
      'li button[aria-label*="foto"]',
      'div[aria-label*="Fotos e vídeos"]',
      'input[accept="image/*,video/mp4,video/3gpp,video/quicktime"]'
    ],

    MENU_DOCUMENT: [
      'li[data-testid="mi-attach-document"]',
      'li button[aria-label*="Documento"]',
      'div[aria-label*="Documento"]'
    ]
  };

  // ============================================
  // HELPERS
  // ============================================

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function findElement(selectorList) {
    for (const sel of selectorList) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth) return el;
      } catch (e) {}
    }
    return null;
  }

  function findAllElements(selectorList) {
    const results = [];
    for (const sel of selectorList) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el && !results.includes(el)) {
            results.push(el);
          }
        }
      } catch (e) {}
    }
    return results;
  }

  // ============================================
  // ENVIO DE IMAGEM
  // ============================================

  async function sendImage(imageData, caption = '', useTypingEffect = false) {
    log('📸 Iniciando envio de imagem...');

    try {
      // 1. Converter base64 para Blob/File
      let file;
      if (typeof imageData === 'string' && imageData.startsWith('data:')) {
        const response = await fetch(imageData);
        const blob = await response.blob();
        file = new File([blob], 'image.jpg', { type: blob.type || 'image/jpeg' });
      } else if (imageData instanceof Blob) {
        file = new File([imageData], 'image.jpg', { type: imageData.type || 'image/jpeg' });
      } else if (imageData instanceof File) {
        file = imageData;
      } else {
        throw new Error('Formato de imagem inválido');
      }

      log('Arquivo criado:', file.name, file.size, 'bytes');

      // 2. Clicar no botão de anexar
      const attachBtn = findElement(SELECTORS.ATTACH_BUTTON);
      if (!attachBtn) {
        throw new Error('Botão de anexar não encontrado');
      }

      const actualBtn = attachBtn.closest('button') || attachBtn;
      actualBtn.click();
      log('Botão anexar clicado');
      await sleep(500);

      // 3. Encontrar input de imagem
      let imageInput = findElement(SELECTORS.FILE_INPUT);
      
      // Se não encontrou, tentar pelo menu
      if (!imageInput) {
        const menuOption = findElement(SELECTORS.MENU_IMAGE);
        if (menuOption) {
          if (menuOption.tagName === 'INPUT') {
            imageInput = menuOption;
          } else {
            menuOption.click();
            await sleep(300);
            imageInput = findElement(SELECTORS.FILE_INPUT);
          }
        }
      }

      if (!imageInput) {
        throw new Error('Input de imagem não encontrado');
      }

      // 4. Injetar arquivo
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      imageInput.files = dataTransfer.files;
      imageInput.dispatchEvent(new Event('change', { bubbles: true }));

      log('Arquivo anexado, aguardando preview...');
      await sleep(1500);

      // 5. Adicionar legenda se houver
      let captionApplied = false;
      if (caption && caption.trim()) {
        const captionBox = await waitForElement(SELECTORS.CAPTION_BOX, 5000);

        if (captionBox) {
          captionBox.focus();
          await sleep(100);

          // Limpar
          try {
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
          } catch (_) {
            captionBox.textContent = '';
          }

          await sleep(50);

          // Inserir legenda
          if (useTypingEffect) {
            for (const char of caption) {
              if (char === '\n') {
                captionBox.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter',
                  shiftKey: true,
                  bubbles: true
                }));
              } else {
                document.execCommand('insertText', false, char);
              }
              await sleep(20);
            }
          } else {
            const lines = caption.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (i > 0) {
                captionBox.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter',
                  shiftKey: true,
                  bubbles: true
                }));
                await sleep(30);
              }
              if (lines[i]) {
                document.execCommand('insertText', false, lines[i]);
              }
            }
          }

          captionBox.dispatchEvent(new InputEvent('input', { bubbles: true }));
          captionApplied = true;
          log('Legenda adicionada');
          await sleep(200);
        }
      }

      // 6. Clicar no botão enviar do preview
      const sendBtn = await waitForElement(SELECTORS.SEND_PREVIEW, 3000);
      if (!sendBtn) {
        throw new Error('Botão enviar não encontrado no preview');
      }

      const actualSendBtn = sendBtn.closest('button') || sendBtn.parentElement || sendBtn;
      actualSendBtn.click();
      log('Botão enviar clicado');
      await sleep(500);

      log('✅ Imagem enviada com sucesso');
      return { ok: true, captionApplied };

    } catch (error) {
      console.error('[MediaSender] Erro ao enviar imagem:', error);
      return { ok: false, error: error.message };
    }
  }

  // ============================================
  // ENVIO DE DOCUMENTO/ARQUIVO
  // ============================================

  async function sendDocument(fileData, filename = 'document.pdf') {
    log('📄 Iniciando envio de documento...');

    try {
      // 1. Converter para File
      let file;
      if (typeof fileData === 'string' && fileData.startsWith('data:')) {
        const response = await fetch(fileData);
        const blob = await response.blob();
        file = new File([blob], filename, { type: blob.type });
      } else if (fileData instanceof Blob) {
        file = new File([fileData], filename, { type: fileData.type });
      } else if (fileData instanceof File) {
        file = fileData;
      } else {
        throw new Error('Formato de arquivo inválido');
      }

      log('Arquivo criado:', file.name, file.size, 'bytes');

      // 2. Clicar no botão de anexar
      const attachBtn = findElement(SELECTORS.ATTACH_BUTTON);
      if (!attachBtn) {
        throw new Error('Botão de anexar não encontrado');
      }

      const actualBtn = attachBtn.closest('button') || attachBtn;
      actualBtn.click();
      await sleep(500);

      // 3. Tentar encontrar opção de documento
      let docInput = null;
      const menuDoc = findElement(SELECTORS.MENU_DOCUMENT);
      
      if (menuDoc) {
        menuDoc.click();
        await sleep(300);
      }

      // Encontrar input
      docInput = findElement(SELECTORS.DOCUMENT_INPUT) || findElement(SELECTORS.FILE_INPUT);

      if (!docInput) {
        throw new Error('Input de documento não encontrado');
      }

      // 4. Injetar arquivo
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      docInput.files = dataTransfer.files;
      docInput.dispatchEvent(new Event('change', { bubbles: true }));

      log('Documento anexado, aguardando preview...');
      await sleep(1500);

      // 5. Clicar no botão enviar
      const sendBtn = await waitForElement(SELECTORS.SEND_PREVIEW, 3000);
      if (!sendBtn) {
        throw new Error('Botão enviar não encontrado');
      }

      const actualSendBtn = sendBtn.closest('button') || sendBtn.parentElement || sendBtn;
      actualSendBtn.click();
      await sleep(500);

      log('✅ Documento enviado com sucesso');
      return { ok: true };

    } catch (error) {
      console.error('[MediaSender] Erro ao enviar documento:', error);
      return { ok: false, error: error.message };
    }
  }

  // ============================================
  // ENVIO DE ÁUDIO (MÉTODO ALTERNATIVO)
  // ============================================

  async function sendAudio(audioData, filename = 'audio.mp3') {
    log('🎵 Iniciando envio de áudio...');

    // Nota: O WhatsApp Web é muito restritivo com envio de áudio programático.
    // O método mais confiável é enviar como documento.
    
    try {
      // Converter para File
      let file;
      if (typeof audioData === 'string' && audioData.startsWith('data:')) {
        const response = await fetch(audioData);
        const blob = await response.blob();
        file = new File([blob], filename, { type: 'audio/mpeg' });
      } else if (audioData instanceof Blob) {
        file = new File([audioData], filename, { type: 'audio/mpeg' });
      } else if (audioData instanceof File) {
        file = audioData;
      } else {
        throw new Error('Formato de áudio inválido');
      }

      // Enviar como documento (método mais confiável)
      const result = await sendDocument(file, filename);

      if (result.ok) {
        log('✅ Áudio enviado como documento');
      }

      return result;

    } catch (error) {
      console.error('[MediaSender] Erro ao enviar áudio:', error);
      return { ok: false, error: error.message };
    }
  }

  // ============================================
  // HELPER: AGUARDAR ELEMENTO
  // ============================================

  async function waitForElement(selectorList, timeout = 5000) {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      const el = findElement(selectorList);
      if (el) return el;
      await sleep(200);
    }
    
    return null;
  }

  // ============================================
  // DOWNLOAD DE MÍDIA (Método do projeto funcional)
  // ============================================

  async function downloadMedia(messageElement) {
    log('📥 Iniciando download de mídia...');

    try {
      // Encontrar botão de download na mensagem
      const downloadBtn = messageElement.querySelector('[data-testid="media-download"]') ||
                          messageElement.querySelector('span[data-icon="download"]') ||
                          messageElement.querySelector('button[aria-label*="Download"]');

      if (downloadBtn) {
        downloadBtn.click();
        await sleep(500);
        log('✅ Download iniciado via botão');
        return { ok: true, method: 'button' };
      }

      // Tentar abrir menu de contexto
      const mediaEl = messageElement.querySelector('img, video');
      if (mediaEl) {
        mediaEl.click();
        await sleep(300);

        // Procurar opção de download no menu
        const menuItem = document.querySelector('[data-testid="mi-download"]') ||
                         document.querySelector('li[aria-label*="Download"]');

        if (menuItem) {
          menuItem.click();
          await sleep(500);
          log('✅ Download iniciado via menu');
          return { ok: true, method: 'menu' };
        }
      }

      // Fallback: tentar extrair URL da imagem
      const imgEl = messageElement.querySelector('img[src*="blob:"], img[src*="http"]');
      if (imgEl && imgEl.src) {
        log('✅ URL da mídia encontrada:', imgEl.src.slice(0, 50));
        return { ok: true, url: imgEl.src, method: 'url' };
      }

      throw new Error('Não foi possível iniciar o download');

    } catch (error) {
      console.error('[MediaSender] Erro ao fazer download:', error);
      return { ok: false, error: error.message };
    }
  }

  // ============================================
  // MÉTODO PARA BUSCAR MENSAGEM ANTERIOR (Download)
  // ============================================

  async function downloadPreviousMedia() {
    log('📥 Buscando mídia da mensagem anterior...');

    try {
      // Encontrar container de mensagens
      const msgContainer = document.querySelector('[data-testid="conversation-panel-messages"]') ||
                           document.querySelector('#main div[role="application"]');

      if (!msgContainer) {
        throw new Error('Container de mensagens não encontrado');
      }

      // Buscar última mensagem com mídia
      const mediaMessages = msgContainer.querySelectorAll('[data-testid="msg-container"]');
      
      for (let i = mediaMessages.length - 1; i >= 0; i--) {
        const msg = mediaMessages[i];
        const hasMedia = msg.querySelector('img[src*="blob:"], video, [data-testid="media-state"]');

        if (hasMedia) {
          log('Mídia encontrada na mensagem', i);
          return await downloadMedia(msg);
        }
      }

      throw new Error('Nenhuma mensagem com mídia encontrada');

    } catch (error) {
      console.error('[MediaSender] Erro:', error);
      return { ok: false, error: error.message };
    }
  }

  // ============================================
  // EXPOR API GLOBAL
  // ============================================

  window.MediaSenderFixed = {
    sendImage,
    sendDocument,
    sendAudio,
    downloadMedia,
    downloadPreviousMedia,
    findElement,
    waitForElement
  };

  log('Módulo Media Sender carregado');
})();
