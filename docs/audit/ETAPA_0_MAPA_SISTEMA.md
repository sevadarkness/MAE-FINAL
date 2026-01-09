# ETAPA 0 — Mapa do Sistema e Diretrizes

Documento consolidado das ordens de preparação antes de qualquer correção ou refatoração. Todas as ações descritas aqui são obrigatórias e devem ser concluídas na ordem definida.

## Ordens e Prioridades
- **ORDEM 0.7 — Estrutura de Documentação:** criar `/docs/audit`, `/docs/maps`, `/docs/fixes` e arquivos indicados.
- **ORDEM 0.6 — Dead Code:** remover `sidepanel-router.js.bak`; listar módulos não usados.
- **ORDEM 0.4 — Manifest Load Order:** mapear ordem atual e dependências; sugerir ordem correta.
- **ORDEM 0.1 — Mapeamento de Dependências:** gerar `/docs/maps/DEPENDENCY_MAP.md` com imports/exports e grafo dos 15 módulos de IA.
- **ORDEM 0.2 — Event Bus:** auditar usos das 3 versões e documentar emissões/listeners em `/docs/maps/EVENT_BUS_AUDIT.md`.
- **ORDEM 0.3 — Módulos Duplicados:** inventário (quick replies, ai service, smartbot autopilot) em `/docs/maps/DUPLICATE_MODULES.md`.
- **ORDEM 0.5 — Endpoints Backend:** mapear chamadas HTTP da extensão e cobrir lacunas em `/docs/maps/BACKEND_USAGE.md`.

## Restrições (Não Fazer)
- Não deletar módulos (exceto `sidepanel-router.js.bak`).
- Não renomear arquivos.
- Não mesclar módulos duplicados.
- Não alterar `manifest.json`.
- Não modificar rotas do backend.
- Não refatorar código nesta fase.

## Estrutura de Documentação a Criar
```
/docs/
├── audit/
│   ├── ETAPA_0_MAPA_SISTEMA.md (este documento)
│   ├── ETAPA_1_BACKEND.md
│   ├── ETAPA_2_IA_SUGESTAO.md
│   ├── ETAPA_3_AUTOPILOT.md
│   ├── ETAPA_4_TREINAMENTO.md
│   ├── ETAPA_5_UI_UX.md
│   └── ETAPA_6_MODULOS_SATELITE.md
├── maps/
│   ├── DEPENDENCY_MAP.md
│   ├── EVENT_BUS_AUDIT.md
│   ├── DUPLICATE_MODULES.md
│   ├── LOAD_ORDER_ANALYSIS.md
│   ├── BACKEND_USAGE.md
│   └── UNUSED_MODULES.md
└── fixes/
    ├── PRIORITY_1_CRITICAL.md
    ├── PRIORITY_2_HIGH.md
    └── PRIORITY_3_MEDIUM.md
```

## Checklist de Entregáveis (Etapa 0)
- [ ] `/docs/maps/DEPENDENCY_MAP.md`
- [ ] `/docs/maps/EVENT_BUS_AUDIT.md`
- [ ] `/docs/maps/DUPLICATE_MODULES.md`
- [ ] `/docs/maps/LOAD_ORDER_ANALYSIS.md`
- [ ] `/docs/maps/BACKEND_USAGE.md`
- [ ] `/docs/maps/UNUSED_MODULES.md`
- [ ] Estrutura `/docs/` criada
- [ ] Remoção de `sidepanel-router.js.bak`

## Notas Operacionais
- Prioridade de execução: 0.7 → 0.6 → 0.4 → 0.1 → 0.2 → 0.3 → 0.5.
- Nenhuma alteração funcional ou de roteamento deve ser aplicada antes da conclusão desta etapa de mapeamento.
