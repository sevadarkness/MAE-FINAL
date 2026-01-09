// ===== STRICT MODE AND ERROR HANDLING =====
'use strict';
// ===== FUSION: Load Group Extractor v6 background module =====
try {
  importScripts('background/extractor-v6.js');
  console.log('[Fusion] Loaded extractor-v6 background module');
} catch (e) {
  console.warn('[Fusion] Failed to load extractor-v6 background module', e);
}

// ===== LOAD: Modular background handlers =====
try {
  importScripts('background/message-handler.js', 'background/campaign-handler.js', 'background/ai-handlers.js');
  console.log('[WHL Background] ✅ Modular handlers loaded');
} catch (e) {
  console.warn('[WHL Background] Failed to load modular handlers', e);
}


// Verify Chrome APIs are available
if (typeof chrome === 'undefined' || !chrome.runtime) {
    console.error('[WHL Background] Chrome APIs not available');
}

// Global error handler
self.addEventListener('error', (event) => {
    console.error('[WHL Background] Global error:', event.error);
});

// Unhandled promise rejection handler
self.addEventListener('unhandledrejection', (event) => {
    console.error('[WHL Background] Unhandled promise rejection:', event.reason);
});

// ===== BUG FIX 2: Side Panel Behavior =====
// Set panel behavior to open on action click (clicking extension icon)
// This must be done BEFORE any tabs are opened to ensure it works consistently
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .then(() => console.log('[WHL Background] ✅ Side panel set to open on action click'))
  .catch(e => console.warn('[WHL Background] setPanelBehavior failed:', e));

// ===== CORREÇÃO 5.3: BROADCAST DE MENSAGENS RECOVER =====
// Message handlers consolidated into single listener below (see line ~194)

// NOTE:
// - `substituirVariaveis` e `NetSniffer` foram extraídos para `background/message-handler.js`
// - Worker/Campaign/Recover handlers foram extraídos para `background/campaign-handler.js`

// ===== CONSOLIDATED MESSAGE LISTENER =====
// Single message listener to handle all actions and avoid race conditions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    // Handler map for better organization and maintainability
    const handlers = {
      // Data export/clear actions
      exportData: handleExportData,
      clearData: handleClearData,
      
      // Worker management actions
      CHECK_IF_WORKER: handleCheckIfWorker,
      WORKER_READY: handleWorkerReady,
      WORKER_STATUS: handleWorkerStatus,
      WORKER_ERROR: handleWorkerError,
      
      // Campaign management actions
      START_CAMPAIGN_WORKER: handleStartCampaign,
      START_SCHEDULED_CAMPAIGN: handleStartScheduledCampaign,
      PAUSE_CAMPAIGN: handlePauseCampaign,
      RESUME_CAMPAIGN: handleResumeCampaign,
      STOP_CAMPAIGN: handleStopCampaign,
      GET_CAMPAIGN_STATUS: handleGetCampaignStatus,

      // UI routing (Top Panel -> Side Panel)
      WHL_OPEN_SIDE_PANEL_VIEW: handleOpenSidePanelView,
      WHL_SET_SIDE_PANEL_ENABLED: handleSetSidePanelEnabled,
      
      // Open side panel (from popup)
      openSidePanel: handleOpenSidePanel,

      // ChatBackup: download blobs/ZIPs generated in the content script
      download: handleDownload,

      // CRM: Abrir chat na mesma aba
      WHL_OPEN_CHAT: handleOpenChat,
      
      // Onboarding: Highlight de botões no Top Panel
      WHL_ONBOARDING_HIGHLIGHT: handleOnboardingHighlight,
      
      // Recover module: broadcast and sync
      WHL_RECOVER_NEW_MESSAGE: handleRecoverNewMessage,
      WHL_SYNC_RECOVER_HISTORY: handleSyncRecoverHistory,
      
      // AI System: Memory and Confidence handlers
      MEMORY_PUSH: handleMemoryPush,
      MEMORY_QUERY: handleMemoryQuery,
      GET_CONFIDENCE: handleGetConfidence,
      UPDATE_CONFIDENCE: handleUpdateConfidence,
      TOGGLE_COPILOT: handleToggleCopilot,
      FEW_SHOT_PUSH: handleFewShotPush,
      FEW_SHOT_SYNC: handleFewShotSync,
      
      // Team System: Enviar mensagem para telefone
      WHL_SEND_TEXT_TO_PHONE: handleSendTextToPhone,
      
      // Abrir popup/aba (Training, etc)
      WHL_OPEN_POPUP_TAB: handleOpenPopupTab,
      
      // Sync training data
      SYNC_TRAINING_DATA: handleSyncTrainingData,
      
      // ═══════════════════════════════════════════════════════════════════
      // 🔥 FETCH_PROXY: Permite que content scripts façam chamadas de API
      // contornando restrições de CORS/mixed-content
      // ═══════════════════════════════════════════════════════════════════
      FETCH_PROXY: handleFetchProxy,
      
      // Aliases para compatibilidade
      fetchProxy: handleFetchProxy,
      API_REQUEST: handleFetchProxy,
      AI_COMPLETION: handleAICompletion
    };
    
    // Verificar também por message.type (além de message.action)
    const handler = handlers[message.action] || handlers[message.type];
    
    if (handler) {
      // All handlers return true for async operations
      handler(message, sender, sendResponse);
      return true;
    }
    
    // Unknown action - don't block
    return false;
  } catch (error) {
    console.error('[WHL Background] Erro no listener:', error);
    try {
      sendResponse?.({ success: false, error: error.message });
    } catch (_) {}
    return false;
  }
});

// ===== MESSAGE HANDLERS =====

async function handleExportData(message, sender, sendResponse) {
  chrome.tabs.query({active:true,currentWindow:true},async tabs=>{
    if(!tabs[0]){
      sendResponse({success:false, error:'No active tab found'});
      return;
    }
    try{
      const res = await chrome.scripting.executeScript({
        target:{tabId:tabs[0].id},
        function:()=>({
          numbers: Array.from(window.HarvesterStore?._phones?.keys()||[]),
          valid: Array.from(window.HarvesterStore?._valid||[]),
          meta: window.HarvesterStore?._meta||{}
        })
      });
      sendResponse({success:true, data: res[0].result});
    }catch(e){
      sendResponse({success:false, error:e.message});
    }
  });
}

async function handleClearData(message, sender, sendResponse) {
  chrome.tabs.query({active:true,currentWindow:true},async tabs=>{
    if(!tabs[0]){
      sendResponse({success:false, error:'No active tab found'});
      return;
    }
    try{
      await chrome.scripting.executeScript({
        target:{tabId:tabs[0].id},
        function:()=>{
          if(window.HarvesterStore){
            window.HarvesterStore._phones.clear();
            window.HarvesterStore._valid.clear();
            window.HarvesterStore._meta = {};
            localStorage.removeItem('wa_extracted_numbers');
          }
        }
      });
      sendResponse({success:true});
    }catch(e){
      sendResponse({success:false, error:e.message});
    }
  });
}

// ===== ABRIR CHAT NA MESMA ABA =====
async function handleOpenChat(message, sender, sendResponse) {
  const phone = String(message.phone || '').replace(/\D/g, '');
  if (!phone) {
    sendResponse({ success: false, error: 'Telefone não informado' });
    return;
  }

  try {
    // Encontrar aba do WhatsApp Web
    const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
    
    if (tabs.length === 0) {
      // Não há aba do WhatsApp aberta, abrir nova
      await chrome.tabs.create({ url: `https://web.whatsapp.com/send?phone=${phone}` });
      sendResponse({ success: true, method: 'new_tab' });
      return;
    }

    const waTab = tabs[0];

    // Focar na aba do WhatsApp
    await chrome.tabs.update(waTab.id, { active: true });
    await chrome.windows.update(waTab.windowId, { focused: true });

    // Enviar mensagem para o content script abrir o chat
    chrome.tabs.sendMessage(waTab.id, {
      type: 'WHL_OPEN_CHAT',
      phone: phone
    }, response => {
      if (chrome.runtime.lastError) {
        console.warn('[WHL Background] Erro ao enviar msg para content:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, method: 'content_script', response });
      }
    });

  } catch (err) {
    console.error('[WHL Background] Erro ao abrir chat:', err);
    sendResponse({ success: false, error: err.message });
  }
}

// ===== UI ROUTING: OPEN SIDE PANEL + SET ACTIVE VIEW =====
async function handleOpenSidePanelView(message, sender, sendResponse) {
  console.log('[WHL Background] ▶️ handleOpenSidePanelView called with view:', message.view);
  try {
    const view = String(message.view || 'principal');
    console.log('[WHL Background] Processing view:', view);

    // Try to open the side panel for the current WhatsApp tab/window
    const tabId = sender?.tab?.id ?? message.tabId;
    const windowId = sender?.tab?.windowId;

    // Persist view + tab association so the Side Panel can talk to the right tab
    await chrome.storage.local.set({
      whl_active_view: view,
      whl_active_tabId: (typeof tabId === 'number') ? tabId : null,
      whl_active_windowId: (typeof windowId === 'number') ? windowId : null
    });
    console.log('[WHL Background] ✅ Saved to storage: whl_active_view =', view);

    // BUG FIX 2: Always try to open the side panel with proper error handling
    if (chrome.sidePanel && chrome.sidePanel.open) {
      let openSuccess = false;
      
      // Try 1: Open with specific tabId if available
      if (typeof tabId === 'number') {
        try {
          await chrome.sidePanel.open({ tabId });
          openSuccess = true;
          console.log('[WHL Background] Side panel opened for tab:', tabId);
        } catch (e1) {
          console.warn('[WHL Background] Failed to open side panel with tabId:', e1.message);
        }
      }
      
      // Try 2: Open with windowId if tabId failed
      if (!openSuccess && typeof windowId === 'number') {
        try {
          await chrome.sidePanel.open({ windowId });
          openSuccess = true;
          console.log('[WHL Background] Side panel opened for window:', windowId);
        } catch (e2) {
          console.warn('[WHL Background] Failed to open side panel with windowId:', e2.message);
        }
      }
      
      // Try 3: Query active tab and try again
      if (!openSuccess) {
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs?.[0]?.id != null) {
            await chrome.sidePanel.open({ tabId: tabs[0].id });
            openSuccess = true;
            console.log('[WHL Background] Side panel opened for queried tab:', tabs[0].id);
          }
        } catch (e3) {
          console.warn('[WHL Background] Failed to open side panel with queried tab:', e3.message);
        }
      }
      
      if (!openSuccess) {
        console.error('[WHL Background] All attempts to open side panel failed');
        sendResponse({ success: false, error: 'Failed to open side panel after multiple attempts' });
        return;
      }
    } else {
      console.warn('[WHL Background] chrome.sidePanel.open is not available');
    }

    // Também enviar mensagem direta para o sidepanel (se estiver aberto)
    try {
      chrome.runtime.sendMessage({ action: 'WHL_CHANGE_VIEW', view })
        .catch(() => {}); // Ignore if no receiver
    } catch(e) {}
    
    sendResponse({ success: true, view });
  } catch (e) {
    console.error('[WHL Background] Error in handleOpenSidePanelView:', e);
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}

// Enable/disable Side Panel for the current tab (used to keep Top Panel + Side Panel in sync)
async function handleSetSidePanelEnabled(message, sender, sendResponse) {
  try {
    const enabled = !!message.enabled;
    const tabId = sender?.tab?.id ?? message.tabId;

    if (chrome.sidePanel && chrome.sidePanel.setOptions && typeof tabId === 'number') {
      const opts = { tabId, enabled };
      if (enabled) opts.path = 'sidepanel.html';
      await chrome.sidePanel.setOptions(opts);
    }

    sendResponse({ success: true, enabled });
  } catch (e) {
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}

// ===== ONBOARDING HIGHLIGHT HANDLER =====
// Retransmite mensagem do sidepanel para o content script no WhatsApp Web
async function handleOnboardingHighlight(message, sender, sendResponse) {
  try {
    // Encontrar a aba do WhatsApp Web
    const tabs = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
    
    if (tabs.length === 0) {
      console.log('[WHL Background] Nenhuma aba do WhatsApp encontrada para highlight');
      sendResponse({ success: false, error: 'No WhatsApp tab found' });
      return;
    }
    
    // Enviar para a primeira aba do WhatsApp encontrada
    const whatsappTab = tabs[0];
    
    await chrome.tabs.sendMessage(whatsappTab.id, {
      action: 'WHL_ONBOARDING_HIGHLIGHT',
      buttonIndex: message.buttonIndex,
      show: message.show
    });
    
    console.log('[WHL Background] Onboarding highlight enviado para tab:', whatsappTab.id);
    sendResponse({ success: true });
  } catch (e) {
    console.log('[WHL Background] Erro ao enviar highlight:', e);
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}


// ===== OPEN SIDE PANEL HANDLER (from popup) =====
async function handleOpenSidePanel(message, sender, sendResponse) {
  try {
    const tabId = message.tabId || sender?.tab?.id;
    if (chrome.sidePanel && chrome.sidePanel.open && tabId) {
      await chrome.sidePanel.open({ tabId });
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'sidePanel.open indisponível' });
    }
  } catch (e) {
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}


// ===== ChatBackup: Downloads =====
// The ChatBackup content script generates Blob URLs (including ZIPs) and asks the
// service worker to download them via chrome.downloads.
function sanitizeDownloadFilename(name) {
  const safe = String(name || 'download')
    // Windows forbidden characters + control chars
    .replace(/[\u0000-\u001F\u007F<>:"/\\|?*]+/g, '_')
    // Avoid trailing dots/spaces (Windows)
    .replace(/[\.\s]+$/g, '')
    // Keep it reasonable
    .slice(0, 180);
  return safe || 'download';
}

async function handleDownload(message, _sender, sendResponse) {
  try {
    const url = message?.url;
    const fileName = sanitizeDownloadFilename(message?.fileName);

    if (!url || typeof url !== 'string') {
      sendResponse({ success: false, error: 'URL inválida para download' });
      return;
    }

    chrome.downloads.download(
      {
        url,
        filename: fileName,
        saveAs: false
      },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err || !downloadId) {
          sendResponse({ success: false, error: err?.message || 'Falha ao iniciar download' });
        } else {
          sendResponse({ success: true, downloadId });
        }
      }
    );
  } catch (e) {
    sendResponse({ success: false, error: e?.message || String(e) });
  }
}


// ===== BUG FIX 3: Side Panel Tab Management =====
// Disable side panel when user navigates away from WhatsApp Web
// Enable it when user returns to WhatsApp Web

// Helper function to check if URL is WhatsApp Web
// Note: WhatsApp Web only uses web.whatsapp.com (no regional subdomains)
// If WhatsApp introduces regional domains in the future, update this function
function isWhatsAppWebURL(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    // Check for exact match - WhatsApp Web doesn't use subdomains
    return urlObj.hostname === 'web.whatsapp.com' && urlObj.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Listen for tab activation (user switches to different tab)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    
    // BUG FIX 2: Set popup dynamically based on tab URL
    if (isWhatsAppWebURL(tab.url)) {
      // On WhatsApp: no popup, clicking icon opens side panel
      await chrome.action.setPopup({ popup: '' });
    } else {
      // On other tabs: show popup
      await chrome.action.setPopup({ popup: 'popup/popup.html' });
    }
    
    if (chrome.sidePanel && chrome.sidePanel.setOptions) {
      if (isWhatsAppWebURL(tab.url)) {
        // Enable side panel for WhatsApp Web tabs
        await chrome.sidePanel.setOptions({
          tabId: activeInfo.tabId,
          enabled: true,
          path: 'sidepanel.html'
        });
        console.log('[WHL Background] Side panel enabled for WhatsApp tab:', activeInfo.tabId);
      } else {
        // Disable side panel for non-WhatsApp tabs
        await chrome.sidePanel.setOptions({
          tabId: activeInfo.tabId,
          enabled: false
        });
        console.log('[WHL Background] Side panel disabled for non-WhatsApp tab:', activeInfo.tabId);
      }
    }
  } catch (e) {
    console.warn('[WHL Background] Error in onActivated listener:', e);
  }
});

// Listen for tab URL updates (user navigates within the same tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when URL changes
  if (changeInfo.url) {
    try {
      // BUG FIX 2: Set popup dynamically based on URL change
      if (isWhatsAppWebURL(changeInfo.url)) {
        // On WhatsApp: no popup, clicking icon opens side panel
        await chrome.action.setPopup({ popup: '' });
      } else {
        // On other tabs: show popup
        await chrome.action.setPopup({ popup: 'popup/popup.html' });
      }
      
      if (chrome.sidePanel && chrome.sidePanel.setOptions) {
        if (isWhatsAppWebURL(changeInfo.url)) {
          // Enable side panel for WhatsApp Web
          await chrome.sidePanel.setOptions({
            tabId: tabId,
            enabled: true,
            path: 'sidepanel.html'
          });
          console.log('[WHL Background] Side panel enabled after navigation to WhatsApp:', tabId);
        } else {
          // Disable side panel when leaving WhatsApp Web
          await chrome.sidePanel.setOptions({
            tabId: tabId,
            enabled: false
          });
          console.log('[WHL Background] Side panel disabled after navigation away from WhatsApp:', tabId);
        }
      }
    } catch (e) {
      console.warn('[WHL Background] Error in onUpdated listener:', e);
    }
  }
});

// NOTE:
// - Alarm handler (chrome.alarms.onAlarm) foi movido para `background/campaign-handler.js`

// NOTE:
// - Alarm handler (chrome.alarms.onAlarm) foi movido para `background/campaign-handler.js`
// - AI handlers foram movidos para `background/ai-handlers.js`

