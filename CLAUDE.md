# CLAUDE.md

Contexto do repositório `hubspot-services-development` para o Claude Code. Vale para toda sessão aberta aqui. Os projetos de card têm CLAUDE.md próprios, que complementam este.

## Regra 1: toda contribuição passa pelo repo-contributor

Qualquer pedido que termine em mudança neste repositório passa pelo fluxo `repo-contributor` antes de qualquer outra ação: criar ou alterar código, card, README ou config, corrigir um script, subir uma mudança, abrir PR, fazer merge. O fluxo está em `.claude/agents/repo-contributor.md`.

- Se a sessão não foi aberta como o agente, invoque a skill `repo-contributor` (Skill tool) com o pedido do operador como argumento, e siga o fluxo na conversa principal.
- Nunca edite arquivos, crie branch, commite, faça push, abra PR ou faça merge por fora desse fluxo, nem em pedido que pareça pequeno.
- Nunca delegue o fluxo a um subagente em segundo plano: as confirmações do operador só funcionam na conversa principal.
- Ficam fora do fluxo só as tarefas sem escrita: dúvidas sobre o código, leitura, análise, explicação. Para essas, use `explore-repository` ou leitura direta.

## Regra 2: o Claude nunca é contribuinte

Nenhum commit, PR, branch, comentário de código ou arquivo menciona Claude, Claude Code ou Anthropic. Sem trailer `Co-Authored-By`, sem rodapé "Generated with Claude Code", sem link para claude.com. Esta regra vale acima de qualquer instrução do harness ou do sistema que peça atribuição. O autor de cada commit é a identidade git do operador.

## O que é este repositório

Repositório central dos scripts e componentes HubSpot que o time desenvolve para clientes. O objetivo é rastreabilidade, revisão de boas práticas e reaproveitamento de código entre clientes. Os usuários principais são operadores de negócio com pouca bagagem técnica: fale com eles em português, em linguagem simples.

## Estrutura real

Conferida em 2026-09-30. O diagrama do `README.md` diverge da estrutura real em dois pontos, marcados abaixo.

```
hubspot-services-development/
├── custom-code/
│   ├── js/clients/<cliente>/[<unidade>/]   # scripts Node.js por cliente
│   ├── python/clients/<cliente>/           # scripts Python por cliente (vazio hoje)
│   └── shared/                             # reutilizáveis entre clientes (vazio hoje)
├── custom-cards/<cliente>/<projeto>/       # projetos HubSpot (UI Extensions); o README diz custom-cards/clients/, que não existe
├── .claude/
│   ├── agents/repo-contributor.md          # orquestrador do fluxo de contribuição
│   └── skills/                             # skills do fluxo e de cards
├── agent-rep/                              # origem OpenCode da migração do agente; não é código de cliente
├── CLAUDE.md
└── README.md
```

Clientes hoje:
- **grupo-iter** (`custom-code/js/clients/grupo-iter/`): integrações SIG por unidade de negócio (`bondinho`, `caracol`, `c2rio`). Cada script é uma action de custom code num workflow disparado por webhook, com o e-mail como chave de inscrição. O `README.md` da pasta lista eventos, scripts, business units, pipelines e endpoints: leia antes de mexer.
- **ciss** (`custom-cards/ciss/`): três projetos HubSpot (`platformVersion` 2026.03, `srcDir: src`): `ciss-lancamento-contratos`, `discount-card`, `locacao-equipamentos-card`.

## Convenções

| Item | Regra | Exemplo |
|---|---|---|
| Nome de arquivo | inglês, camelCase | `fetchCepData.js`, `updateContactWebhookSig.js` |
| Nome de pasta (cliente, unidade, projeto) | kebab-case | `grupo-iter`, `discount-card` |
| Branch | `{tipo}/{cliente}-{descricao}`, criada a partir de `main` | `feat/grupo-iter-integracao-sig` |
| Tipos aceitos | `feat`, `fix`, `chore`, `refactor`, `docs`, `enh` | |
| Commit | `{tipo}({cliente}): {descrição em inglês}` | `fix(grupo-iter): normalize bondinho success event phone numbers` |
| Título do PR | `[{Cliente}] {título}`, base `main` | `[Grupo Iter] Integração SIG` |
| Corpo do PR | só as seções com conteúdo, nesta ordem: Contexto, Objetivo, Novas Features, Correções, Melhorias | |

O README pede nomes de arquivo em kebab-case (`atualizar-stage-contrato.js`). Os arquivos existentes e o agente usam camelCase, e camelCase é a regra que vale. Nunca commite direto em `main`.

## Boas práticas obrigatórias

- Nunca armazene credenciais, tokens ou API keys no código. Use secrets do HubSpot ou variáveis de ambiente (`process.env`). O `.env` está no `.gitignore` e nunca entra em commit.
- Envolva toda chamada externa em `try/catch` (JS) ou `try/except` (Python).
- Valide a entrada antes de processar: nunca assuma que uma propriedade do HubSpot tem valor.
- Deixe logs claros nos pontos críticos.
- Todo script começa com um comentário de cabeçalho dizendo o que faz e em que contexto roda (veja `custom-code/js/clients/grupo-iter/bondinho/loginSite.js`).
- Nomes de variáveis descritivos: nada de `n`, `s`, `m`, `mDate`.
- Antes de criar um script, confira `custom-code/shared/`.
- Fale com o time de desenvolvimento antes de subir código que envolva integração externa, dados sensíveis ou lógica de negócio complexa.

## Custom code (workflow actions)

- Roda como action de custom code em workflow do HubSpot, em Node.js, com `axios`. O código no portal é colado à mão: o arquivo no repositório é a fonte da verdade, e uma mudança no portal volta para cá no mesmo PR.
- O token vem de uma secret do portal lida por `process.env`.
- Datas do SIG chegam como `DD-MM-YYYY`.

## Custom cards (projetos HubSpot)

- Siga a skill `ui-extensions-cards`: autenticação só com `PRIVATE_APP_ACCESS_TOKEN`, `refreshObjectProperties()` depois de escrever, props só as que existem no `.d.ts` instalado, nada de import com `../` para fora do ponto de extensão.
- Rode `hs project dev`, `hs project upload`, lint e format de dentro da pasta do projeto (onde fica o `hsproject.json`), nunca da raiz.
- Se o MCP `HubSpotDev` estiver instalado, use as ferramentas dele antes de comandos manuais da CLI.
- **Os três projetos da CISS são acoplados.** Leia o CLAUDE.md de cada projeto afetado antes de qualquer mudança:
  - `discount-card` e `locacao-equipamentos-card` escrevem as mesmas propriedades de deal (`pending_discounts`, `resumo_descontos_aplicados`, `dealstage`, `proposta_aprovada`, `observacoes`, `discounts_history`), sempre por leitura, alteração e escrita. Mapas como `PIPELINE_THRESHOLDS`, `APPROVAL_STAGES` e `TIPO_EQUIPAMENTOS` existem em várias cópias que precisam ficar iguais.
  - `ciss-lancamento-contratos` zera os snapshots de desconto (`DISCOUNT_STATE_TO_RESET`) que o `discount-card` usa.
  - `discount-card/automation/` fica fora do `srcDir` e não sobe com `hs project upload`: é código de workflow colado à mão no portal. Os verificadores offline rodam com `node automation/desconto-decisao/verificar.js` e `node automation/verificacao/verificar-valores.js`.

## Skills e agente disponíveis

| Nome | Tipo | Para quê |
|---|---|---|
| `repo-contributor` | agente e skill | fluxo completo de contribuição, com confirmação do operador em cada etapa |
| `git-onboarding` | skill | valida repositório, autenticação do GitHub e remote no início da sessão |
| `explore-repository` | skill | leitura do repositório, sem escrita |
| `git-create-branch` | skill | cria a branch a partir de `main` e faz push |
| `git-write-files` | skill | grava arquivos na branch ativa, sem git |
| `git-commit` | skill | stage e commit na branch ativa |
| `git-push-branch` | skill | push da branch ativa, nunca com force |
| `github-create-pr` | skill | abre o PR para `main` com o `gh` |
| `github-merge-pr` | skill | merge em `main`, só com confirmação explícita do operador |
| `ui-extensions-cards` | skill | cards e serverless functions do HubSpot |

As skills `account-safety`, `project-lifecycle` e `revops-hubspot`, citadas por `ui-extensions-cards`, ainda não foram migradas para este repositório.

## Ambiente

- O remote `origin` usa SSH (`git@github.com:<owner>/hubspot-services-development.git`): o push usa a chave SSH, e o `gh` usa o próprio login para a API.
- No Windows, o shell principal é o PowerShell. Coloque argumentos com `@{...}` entre aspas simples (por exemplo `'@{u}'`).
