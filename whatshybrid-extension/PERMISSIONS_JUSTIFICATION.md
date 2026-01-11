# 📋 Justificativa de Permissões - WhatsHybrid Pro

Este documento explica o uso de cada permissão solicitada pela extensão WhatsHybrid Pro, conforme exigido para publicação na Chrome Web Store.

---

## ✅ Permissões Obrigatórias

### `storage`
**Uso:** Armazenar configurações do usuário, dados do CRM, histórico de mensagens recuperadas, exemplos de treinamento da IA.
**Justificativa:** Essencial para persistir dados entre sessões sem depender de servidor externo.

### `alarms`
**Uso:** Agendar tarefas recorrentes como backup automático, sincronização de dados, lembretes de tarefas.
**Justificativa:** Permite funcionalidades de agendamento sem manter a extensão ativa constantemente.

### `notifications`
**Uso:** Alertar o usuário sobre mensagens recuperadas, lembretes de tarefas, status de campanhas.
**Justificativa:** Feedback visual importante para ações assíncronas.

### `sidePanel`
**Uso:** Exibir painel lateral com CRM, analytics, tarefas e configurações.
**Justificativa:** Interface principal da extensão para gerenciamento sem interferir no WhatsApp Web.

### `tabs`
**Uso:** Abrir popups (CRM, Treinamento IA) em novas abas, detectar tab do WhatsApp Web.
**Justificativa:** Necessário para funcionalidades que requerem janelas separadas.

### `scripting`
**Uso:** Injetar scripts no WhatsApp Web para funcionalidades de automação e recuperação.
**Justificativa:** Core da extensão - interação com a página do WhatsApp.

---

## 🔄 Permissões Opcionais

As seguintes permissões são solicitadas apenas quando o usuário precisa de funcionalidades específicas:

### `downloads`
**Uso:** Baixar histórico de conversas, exportar dados do CRM, salvar backups.
**Quando solicitada:** Ao usar funcionalidades de exportação/download.

### `clipboardWrite`
**Uso:** Copiar números de telefone, mensagens, dados para a área de transferência.
**Quando solicitada:** Ao usar botão "Copiar" em qualquer parte da interface.

### `clipboardRead`
**Uso:** Colar números de telefone de listas externas para campanhas.
**Quando solicitada:** Ao usar funcionalidade de importação via clipboard.

---

## 🔒 Permissões NÃO Utilizadas

A extensão **não** solicita as seguintes permissões sensíveis:

- ❌ `webRequest` / `webRequestBlocking` - Não interceptamos tráfego de rede
- ❌ `history` - Não acessamos histórico de navegação
- ❌ `bookmarks` - Não acessamos favoritos
- ❌ `geolocation` - Não acessamos localização
- ❌ `cookies` - Não acessamos cookies de outros sites
- ❌ `management` - Não gerenciamos outras extensões

---

## 🌐 Host Permissions

### `https://web.whatsapp.com/*`
**Uso:** Única URL onde a extensão opera.
**Justificativa:** A extensão é exclusiva para WhatsApp Web e não acessa nenhum outro site.

---

## 📊 Dados Coletados

A extensão coleta e armazena localmente:

1. **Mensagens recuperadas** - Armazenadas no dispositivo do usuário
2. **Contatos do CRM** - Dados inseridos manualmente pelo usuário
3. **Exemplos de treinamento** - Criados pelo usuário para personalizar a IA
4. **Métricas de uso** - Armazenadas localmente. Opcionalmente enviadas ao backend para análise agregada **apenas se o usuário consentir explicitamente** (números de telefone são anonimizados antes do envio)

**Nenhum dado é enviado para servidores externos sem consentimento explícito do usuário.**

### Telemetria (Opcional, Requer Consentimento)

Se o usuário optar por habilitar telemetria:
- **Dados enviados**: Métricas agregadas de uso (total de mensagens, horários de pico, tempos de resposta)
- **Dados PII anonimizados**: Números de telefone são hash antes do envio (não reversível)
- **Controle total**: Usuário pode desabilitar a qualquer momento via `AnalyticsModule.setTelemetryConsent(false)`
- **Padrão**: Telemetria DESABILITADA por padrão (opt-in, não opt-out)

---

## 🔐 Segurança

- Todas as chaves de API são armazenadas localmente via `chrome.storage.local`
- Comunicação com backend (quando configurado) usa HTTPS
- Dados sensíveis não são logados no console
- Sistema de permissões opcionais minimiza acesso desnecessário

---

## 📝 Contato

Para dúvidas sobre permissões ou privacidade:
- Email: sevaland10@gmail.com
- Documentação: [Link para documentação]

---

*Última atualização: Janeiro 2026*
*Versão da extensão: 7.9.12*
