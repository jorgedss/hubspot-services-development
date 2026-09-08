# Workflow "Desconto - Decisão do aprovador"

Contrato da ação de código personalizado que decide descontos pendentes de um negócio.

## O que esta pasta é

`customCode.js` é a **fonte de verdade versionada** do código que roda dentro da ação de código personalizado do workflow, no portal.

`hsproject.json` tem `srcDir: "src"`, então nada desta pasta sobe com `hs project upload`.
A HubSpot não versiona código de custom code action: o arquivo aqui e a ação lá são duas cópias que precisam ser mantidas iguais à mão.

**Regra de sincronização:** alterou o `.js`, cole na ação. Alterou na ação, traga para cá no mesmo PR.
Um PR que muda o comportamento da aprovação de desconto sem tocar neste arquivo está incompleto.

## Por que não é um app function

`config.endpoint` em app function exige **Content Hub Enterprise**, que este portal não tem, e a função nasceria pública e sem autenticação.
Um componente `workflow-action` do projeto exige `actionUrl`, uma URL HTTPS externa, ou seja infraestrutura fora da HubSpot.
Com isso o custom code é o único lugar onde esta matemática pode rodar hoje.
Histórico da decisão em `docs/refatoracao-aprovacao-para-workflow.md`, seção 8 e seção 10.

Se algum dia houver Content Hub Enterprise ou um backend Nexforce onde hospedar, vale reabrir: nos dois casos o código volta a ser deployado a partir do repositório e revisável em PR.

## Pré-requisitos do portal

| Item | Detalhe |
|---|---|
| Tier | Ação de código personalizado exige **Data Hub Professional ou Enterprise** |
| Propriedade `proposta_aprovada` | Negócio, enumeração de valor único, dois valores, **sem valor padrão**. No portal os valores internos são `Sim` e `Não` |
| Propriedade `observacoes` | Negócio, texto de várias linhas. Carrega o motivo da reprovação |
| Propriedade `change_deal_stage_discount` | Negócio, caixa de seleção única, `true` aprovado e `false` reprovado. **Tem que existir antes de subir o código**: vai no mesmo PATCH do histórico, e nome inexistente devolve 400 e derruba a decisão inteira |
| Segredo | `DISCOUNT_APP_TOKEN` |

O PATCH final **limpa `observacoes`** junto com `proposta_aprovada`.
Se essa propriedade passar a ser usada para qualquer outra finalidade no negócio, o conteúdo será apagado a cada decisão de desconto.

Caixa e acento do valor interno não importam para o código: `normalizarDecisao` reduz o valor a `sim` ou `nao` antes de qualquer comparação, no inputField e no histórico da propriedade.
Qualquer outro valor sai como `erro`, nunca como reprovação.
Isso é o que impede uma terceira opção adicionada à enumeração de virar reprovação silenciosa.

Enumeração e não caixa de seleção porque uma caixa em branco e uma marcada como falsa renderizam igual na tela: o aprovador não teria como reprovar de um jeito distinguível de "não mexi".

### O segredo

`DISCOUNT_APP_TOKEN` é um private app token com exatamente estes scopes:

`crm.objects.deals.read`, `crm.objects.deals.write`, `crm.objects.line_items.read`, `crm.objects.line_items.write`, `crm.objects.contacts.read`, `crm.objects.owners.read`

Recomendado criar um private app **dedicado** em Configurações → Integrações → Private Apps, em vez de reaproveitar o token do app `discount-card`.
Dois motivos: um vazamento pelo workflow não compromete o app, e rotacionar o token não derruba os quatro cards.

Risco a registrar de qualquer forma: quem pode editar o workflow pode escrever código que imprime o segredo, então este token de escrita no CRM passa a ser acessível ao papel de editor de workflow.
Nunca cole o valor em arquivo do repositório, commit, comentário ou chat.

## Gatilho

Critérios de inscrição, propriedade do negócio:

- `Proposta aprovada` **é conhecido**

Ative **"Reinscrever negócios quando eles atenderem novamente aos critérios de acionamento"**.
Sem isso um segundo ciclo de desconto no mesmo deal nunca dispara.
É seguro: uma inscrição sem pendente sai como `ignorado` e não escreve em line item nenhum.

A reinscrição depende de a propriedade **voltar a ficar vazia**, porque um deal que continua com `Sim` gravado nunca deixa de atender ao critério e por isso nunca reinscreve.
Por isso os caminhos `aprovado`, `reprovado` e `ignorado` todos limpam `proposta_aprovada` e `observacoes`.
Só o ramo `erro` deixa a propriedade preenchida, de propósito, e nele o rearme é manual: corrija a causa e limpe a propriedade.

Não use `pending_discounts` "é conhecido" como filtro extra.
Tanto `ApplyDiscounts` quanto este código gravam a string `"[]"` quando não há pendente, e `"[]"` é um valor conhecido: o filtro fica permanentemente verdadeiro depois do primeiro ciclo e não barra nada.
A guarda de idempotência do código cobre esse caso.

## `inputFields`

Configurar em "Propriedades a incluir no código".

| Nome do campo | Propriedade do negócio |
|---|---|
| `proposta_aprovada` | `Proposta aprovada` |
| `observacoes` | `Observações` |

Os nomes dos campos têm que ser **exatamente** esses: o código lê `inputs.proposta_aprovada` e `inputs.observacoes`.
Um nome diferente na ação chega como `undefined`, a decisão sai vazia e a execução termina em `erro` por divergência.

`dealId` não é `inputField`: vem de `event.object.objectId`.
`pending_discounts` e `discounts_history` também não: um `inputField` congela o valor do momento da inscrição, e o que precisa ser aplicado é o array vigente no deal. O código lê os dois frescos, junto do pipeline e do autor, num único GET.

Todo valor de `inputFields` chega como **string**.

## `outputFields`

Declarar exatamente estes oito. Campo de saída ausente quebra a ramificação seguinte, e por isso todo caminho do código chama `callback` com os oito preenchidos.

| Nome | Tipo |
|---|---|
| `status` | String |
| `itens_atualizados` | Número |
| `sistemas_processados` | Número |
| `pendentes_restantes` | Número |
| `novo_amount` | String |
| `aprovador` | String |
| `motivo` | String |
| `erro` | String |

`motivo` sai como campo de saída porque o PATCH do código limpa `observacoes` antes de o ramo de reprovação rodar.
A notificação de reprovação tem que usar o campo de saída, não a propriedade, senão chega sem motivo.
Ele vem vazio quando o aprovador reprova sem escrever nada, o que é permitido.

## Valores de `status` e o que o workflow faz com cada um

| status | Quando | Ramo do workflow |
|---|---|---|
| `aprovado` | Desconto aplicado nos line items | **Ramificar por pipeline e mover o estágio para "aprovação aprovada"**, coluna própria na tabela: não é o estágio de proposta do ramo `reprovado`. Opcional: notificar o proprietário do negócio com `aprovador` e `novo_amount` |
| `reprovado` | Reprovação registrada no histórico, com ou sem motivo | Ramificar por pipeline e mover o estágio de volta para proposta. Depois, notificar com o campo de saída `motivo` |
| `ignorado` | Não havia nada em `pending_discounts`. Limpa `proposta_aprovada` e `observacoes` para rearmar o gatilho, e não toca em line item, histórico ou pendente | Nada. Termine o ramo |
| `erro` | Autor não identificado, autor sem owner no portal, autor não é aprovador do pipeline, decisão divergente da propriedade, valor de decisão fora do par esperado, ou falha de API | **Criar tarefa para operações** com o campo de saída `erro` |

Motivo vazio na reprovação **não** é erro.
A validação que o card fazia foi removida por decisão de processo: o aprovador pode reprovar sem justificar, e o histórico registra a entrada com `motivo` vazio.

O ramo `erro` não é opcional: é o que substitui o `Alert` vermelho que o aprovador via no card.
Sem ele a migração troca um erro visível por um erro silencioso.

Neste ramo o deal fica com `proposta_aprovada` ainda preenchida, porque o código só limpa em caso de sucesso.
Isso é proposital: o estado errado fica visível no registro, e corrigir a causa mais reinscrever manualmente resolve.

## Estágio de destino por pipeline

Os dois ramos movem o negócio, e para lugares **diferentes**: `aprovado` vai para o estágio "Aprovação aprovada" e `reprovado` volta para proposta.

Um ID de estágio pertence a um pipeline só, então cada ramo precisa de seis IDs, um por pipeline. Não há como um ID servir Franquia - SMB e Franquia - Enterprise ao mesmo tempo.

O código **nunca** mexe em `dealstage`, e a suíte tem asserção para garantir.
Quem move é um segundo workflow, documentado na seção "O workflow que move o estágio" abaixo.
A tabela existe para configurar as ramificações dele.

| Pipeline | ID do pipeline | Entrada: aprovação pendente | Saída `aprovado`: aprovação aprovada | Saída `reprovado`: proposta |
|---|---|---|---|---|
| Franquia - SMB | `872876959` | `1347751842` | `1378708513` | `1308807605` |
| Franquia - Enterprise | `873229378` | `1347750931` | `1386751304` | `1308810852` |
| PDV e Geral - SMB | `872876956` | `1347751841` | `1386753195` | `1308807580` |
| PDV e Geral - Enterprise | `872876957` | `1347655299` | `1386747212` | `1308807587` |
| Expansão - Franquia | `907963396` | `1385332128` | `1385331521` | **FALTANDO** |
| Expansão - PDV e Geral | `911415619` | `1385331244` | `1385331246` | **FALTANDO** |

A coluna `aprovado` veio de Ops em 21/08/2026, lida da lista de estágios do portal, onde o rótulo de cada um é "Aprovação Aprovada (Pipeline ...)".

Atenção em Expansão - PDV e Geral: a entrada é `1385331244` e a saída é `1385331246`, dois números vizinhos. São estágios diferentes, criados juntos. Trocar um pelo outro devolve o negócio para "aprovação pendente" em vez de tirá-lo de lá, e nada no workflow acusa isso.

Na interface do workflow o estágio é escolhido pelo nome, não pelo ID. Use a tabela só para conferir que escolheu o certo.
Os IDs vinham do `PROPOSAL_STAGES` de `ReviewDiscount.js`, removido em 31/07/2026: sem esta tabela a informação desaparece.

A coluna de entrada é o `APPROVAL_STAGES` de `src/app/functions/ApplyDiscounts.js` e de `locacao-equipamentos-card/src/app/functions/aplicarDesconto.js`, repetida aqui para conferência: é o estágio de onde o negócio precisa sair.

Falta só a coluna `reprovado` das duas pipelines de Expansão, lacuna que antecede esta refatoração: o reject nelas emite um aviso no log e deixa o negócio parado no estágio de aprovação.
O ramo `aprovado` está completo, os seis pipelines.

**Sem a ação no ramo `aprovado` o negócio fica parado em "Aprovação pendente" mesmo com o desconto aplicado.**
Esse ramo nunca existiu: aprovar gravava os line items e ninguém tirava o negócio de lá.

## Os workflows que movem o estágio

O movimento de `dealstage` **não** é deste workflow: o código nunca escreve essa propriedade, e a suíte tem asserção fixando isso.
Decisão de 21/08/2026: manter a divisão, para que Ops mude roteamento de estágio na interface sem tocar em código.

### Inscrição por ação, não por gatilho

Os workflows de estágio **não têm critério de inscrição**. Quem os inscreve é este, na última etapa, com a ação nativa "Inscrever em outro workflow", ramificando pelo campo de saída `status`:

```
[ação de código]
   └─ ramificar por `status`
        ├─ aprovado  -> inscrever em "Desconto - Estágio aprovado"
        ├─ reprovado -> inscrever em "Desconto - Estágio reprovado"
        ├─ ignorado  -> fim do ramo
        └─ erro      -> tarefa para operações com o campo `erro`
```

Cada um dos dois workflows de estágio só ramifica por pipeline e move para a coluna correspondente da tabela acima.

Três razões para ser assim, e não por gatilho de propriedade:

1. **Ordem garantida.** A inscrição acontece depois da ação de código, na mesma execução. Não existe corrida com o PATCH final.
2. **Sem dependência de propriedade apagada.** O PATCH final limpa `proposta_aprovada` e `observacoes`. Qualquer critério que leia as duas é uma aposta em quem roda primeiro.
3. **A ramificação lê `change_deal_stage_discount`, não `proposta_aprovada`.** Quando a ação de inscrição roda, `proposta_aprovada` e `observacoes` já foram limpas no PATCH final. A propriedade durável é gravada no mesmo PATCH, `true` para aprovado e `false` para reprovado, e **nunca** é limpa. É o que permite um workflow de estágio só, com ramificação interna por valor, em vez de dois workflows de destino.

Alternativa equivalente, se preferir sem propriedade: ramificar aqui pelo campo de saída `status` e ter dois workflows de estágio, um por decisão. O campo `status` não sai deste workflow, então essa ramificação tem que ficar aqui.

### Ao montar, três armadilhas

**Zere os critérios de inscrição dos workflows de estágio.** Se sobrar gatilho por propriedade junto com a inscrição por ação, os dois caminhos coexistem e a intermitência volta pela porta velha.

**Deixe a reinscrição ligada nos dois.** Não está confirmado se inscrição por ação respeita o bloqueio de "já esteve inscrito"; ligar não custa nada e elimina a dúvida.

**Não ramifique por `proposta_aprovada` nem por `observacoes` no workflow de estágio.** As duas estão vazias quando ele roda. Foi essa leitura de campo vazio, somada ao critério `Observações é conhecido`, que produziu o "às vezes move, às vezes não".

**Se um dia a decisão repetir sem mudança de valor**, dois ciclos aprovados seguidos gravam `true` duas vezes. Com inscrição por ação isso é irrelevante, porque não há critério a reavaliar. Se o desenho voltar para gatilho por propriedade, valor repetido não reinscreve e o segundo ciclo morre calado.

**Expansão precisa entrar.** As duas pipelines de Expansão nunca estiveram nos critérios do workflow antigo, e é por isso que nelas o estágio nunca mudou. Na ramificação por pipeline, inclua as seis. Falta só o estágio de proposta das duas de Expansão, na coluna `reprovado`.

### O que havia antes, e por que quebrava

Os critérios do workflow antigo eram:

```
Deal stage é um de: Aprovação pendente (as quatro, sem Expansão)
E   Proposta Aprovada? é conhecido
E   Observações é conhecido
```

O terceiro critério explica um comportamento que parecia mágico: **o estágio só mudava quando o aprovador preenchia Observações.** Aprovar sem escrever nada não inscrevia o negócio, e ninguém movia. Reprovar costumava funcionar porque quem reprova escreve o motivo. E `Observações` é opcional por decisão de processo, inclusive na reprovação, então nunca poderia ser critério de inscrição.

Uma segunda causa, com sintoma idêntico e que sobrevive à remoção do critério: **reinscrição na HubSpot é por propriedade.** Se a lista de propriedades que reinscrevem tiver `Observações` e não tiver `Proposta Aprovada?`, mudar só a decisão nunca reinscreve. Vale registrar porque é o tipo de configuração que ninguém revisa, e a inscrição por ação torna o problema inalcançável.

Se algum dia o desenho voltar para gatilho por propriedade, o critério é `Deal stage é um de [os seis estágios de aprovação]` e `Proposta Aprovada? é conhecido`, nunca por valor: `é conhecido` cobre `Sim` e `Não`, com e sem observação, e não depende de o valor interno estar escrito como o filtro guardou.

## Entradas de equipamento

`pending_discounts` tem dois donos.
O `discount-card` grava as entradas de **sistema**, sem campo `tipo`, e o `ciss-apps/locacao-equipamentos-card` grava as de **equipamento**, com `tipo: "equipamentos"`.
As duas convivem no mesmo array e a decisão do aprovador vale para as duas ao mesmo tempo: continua sendo uma decisão por negócio.

Existe **uma** entrada de equipamento por negócio, porque a aprovação é do conjunto, não de cada equipamento.
Ela agrega o conjunto no topo e carrega os alvos por item de linha em `itens`:

```json
{
  "tipo": "equipamentos",
  "nomeDoSistema": "67",
  "label": "Equipamentos - 67",
  "percentualDesconto": 22.5,
  "brutoTotal": 1900,
  "liquidoTotal": 1472.5,
  "itens": [
    {
      "lineItemId": "123456",
      "label": "Nome do equipamento",
      "percentualDesconto": 50,
      "quantidade": 1,
      "treinamento": { "unitarioOriginal": 0, "unitarioNovo": 0 },
      "locacao": { "unitarioOriginal": 300, "unitarioNovo": 150 }
    }
  ]
}
```

Isso faz **uma** linha no histórico para todo o conjunto, em vez de uma por equipamento, e o `pending.map` que monta `discounts_history` não precisou mudar: os campos que ele lê já estão no topo da entrada.
`sistemas_processados` também passa a contar 1, e não N.

Os `itens` não podem ser descartados em favor dos totais.
A escrita é por line item, e redistribuir um total agregado exigiria uma alocação que ninguém digitou.
Agrega para decidir, preserva para aplicar.

`applyAllPendingSystems` separa os dois grupos antes do laço.
Uma entrada de equipamento que caia no laço de sistemas **não** dá erro: ela não tem `categorias`, nenhum alvo é montado, nenhum line item recebe plano, e o equipamento fica sem desconto em silêncio.
Iterar a entrada em vez de `entry.itens` no laço de equipamentos falha do mesmo jeito, sem erro e sem escrita.
São as duas falhas mais fáceis de introduzir aqui, e as duas estão cobertas na verificação.

O ramo de equipamento não usa `buildAllocation`: cada item de `itens` já traz o alvo absoluto.
As sete propriedades que ele grava são as mesmas de `locacao-equipamentos-card/src/app/functions/aplicarDesconto.js`, que é por onde passa um desconto de equipamento **dentro** da alçada.
Um acima da alçada passa por aqui. Os dois têm que gravar o mesmo valor: mudou um, mude o outro.

Line item que saiu do negócio entre o envio e a decisão é descartado com aviso no log.
Não é zelo: um id que não existe mais devolve 400 no `batch/update` e derruba a chamada inteira, levando junto o desconto de todos os sistemas.

O ramo **não** grava `price` e **não** recalcula o `amount` a partir dos equipamentos, porque o card de equipamentos nunca gravou nenhum dos dois: o `amount` é mantido por automação externa ao card.
O PATCH do passo 7 continua escrevendo `amount` num negócio aprovado, calculado como `Σ price × quantity` com o `price` armazenado dos equipamentos.
Quem escrever por último entre esse PATCH e a automação externa vence. Vale conferir isso no portal.

O `sistemas_processados` do `outputFields` conta **entradas**, sistemas e equipamentos juntos, não só sistemas.

## Autorização

Não existe usuário corrente num workflow, então o código identifica quem decidiu pelo **histórico da propriedade**: `propertiesWithHistory=proposta_aprovada`, entrada mais recente com valor preenchido, campo `updatedByUserId`.
Esse id é resolvido para email por `GET /crm/v3/owners/{userId}?idProperty=userId`, e o email é conferido contra a lista de aprovadores exatamente como o card fazia: contato com `aprovador_de_desconto = true` cujo `aprovador_pipelines` contém o pipeline do deal.

Ou seja: a autorização continua no servidor, e as duas propriedades de contato continuam valendo.

Consequência intencional: `updatedByUserId` é campo **opcional** no modelo da HubSpot e não vem em edição por API, integração ou outro workflow.
Se `proposta_aprovada` for alterada por qualquer via que não seja uma pessoa na interface do CRM, a execução falha com "autor não identificado".
Isso é o desenho, não um bug.

## Limites que o código respeita

| Limite | Valor | Como o código lida |
|---|---|---|
| Execução da ação | 20 s | 7 idas e voltas sequenciais no pior caso, menos de 3 s típicos. `timeout` do axios em 18000, acima de qualquer chamada real e abaixo do teto da ação |
| Memória | 128 MB | Uma leitura de line items em memória, em blocos de 100 |
| Saída string | 65.000 caracteres | O maior campo é `erro`, sempre uma linha |
| Retry automático | Até 3 dias em 429, 5XX ou exceção lançada | O `catch` chama `callback` e **nunca** faz `throw`. Um `throw` aqui liga o retry |

A reaplicação, se ela acontecer por retry ou reinscrição, é idempotente por construção: o desconto é sempre calculado contra o snapshot imutável `*_original`, nunca contra o valor líquido vigente.

## Ordem obrigatória dos passos no código

1. **Lê o estado do deal, autor incluído, antes de qualquer escrita.** O PATCH final limpa `proposta_aprovada`, e essa limpeza também entra no histórico da propriedade: ler depois pegaria a limpeza como se fosse a decisão.
2. Confere que o autor foi identificado e que o `inputField` bate com o valor vigente da propriedade.
3. Resolve o autor para email e confere que é aprovador do pipeline.
4. Guarda de idempotência: pendente vazio sai como `ignorado`.
5. Se aprovado, aplica todos os sistemas em um único `batch/update`.
6. PATCH único com `pending_discounts`, `discounts_history`, `amount`, e a limpeza de `resumo_descontos_aplicados`, `proposta_aprovada` e `observacoes`.

O PATCH é único de propósito: com dois, existe uma janela em que o `amount` já está descontado e `pending_discounts` ainda está cheio.

Limpar `proposta_aprovada` e `observacoes` é o que permite um segundo ciclo de desconto no mesmo deal.
Sem isso o deal fica marcado como aprovado para sempre e o gatilho nunca dispara de novo.

## Verificação

```bash
node automation/desconto-decisao/verificar.js
```

Sem dependências, sem `npm install`, sem portal: o `axios` do código sob teste é substituído por um CRM falso.
120 asserções cobrindo o que quebra em silêncio: dois sistemas com horas editadas concentrando no próprio item, desconto sobre o snapshot imutável num segundo ciclo, item Locação(C) descontando `valor_locacao` e não `valor_glt`, `amount` como soma de `price × quantity`, escala de percentual, prepend do histórico, reprovação com e sem motivo, e os oito caminhos que não escrevem no CRM, sete de erro mais a idempotência.

O script foi validado por mutação: onze alterações deliberadas no `customCode.js` (acumulador fora do laço, desconto sobre o líquido, snapshot reescrito, classificação C ignorada, `amount` sem `quantity`, histórico sem ignorar entradas vazias, percentual como fração, `throw` no `catch`, autorização removida, idempotência removida, reprovação aplicando desconto) e as onze foram detectadas.
As asserções de equipamento foram validadas do mesmo jeito, em sete mutações, todas detectadas: ramo de equipamento removido (13 asserções caem), laço iterando a entrada em vez de `entry.itens` (18), só o primeiro item do conjunto aplicado (4), guarda de id fora do negócio removida (2), total gravado sem multiplicar pela quantidade (2), e snapshot sobrescrito com o líquido (1).

Rode antes de colar o código na ação, e de novo depois de qualquer alteração.

**Isto não substitui a fase 5 do plano de execução.**
O CRM falso não valida nomes de propriedade e não conhece o comportamento real de `batch/update`.
O que ele prova é a lógica de laço e de decisão.

Ele também **não** resolve propriedade calculada, e era nessa lacuna que morava o bug de centavos de agosto de 2026.
Os valores gravados são verificados em `automation/verificacao/verificar-valores.js`, que modela `valor_*_calculado = base × quantity` e roda as duas rotas de escrita comparando uma com a outra.
Rode os dois scripts.

## Cuidado ao mexer no código

O alvo digitado é distribuído em centavos entre os line items por `buildAllocation`, e esse bloco é **byte-idêntico** ao de `src/app/functions/ApplyDiscounts.js`, com a constante `DECIMAIS_VALOR = 6`.
Não é enfeite: gravar o valor base com 2 decimais devolve o desvio de centavos que operações reportou, porque o CRM remultiplica a base pela `quantity`.
A consolidação de horas (todas as horas da categoria num item acumulador, os demais zerados) mora dentro dessa mesma função, e o acumulador é resolvido **por sistema**, porque `buildAllocation` recebe só os itens de um sistema por chamada.
Compartilhar a alocação entre sistemas faz o segundo sistema concentrar as horas no line item do primeiro.
É a falha mais fácil de introduzir e a mais difícil de notar, porque só aparece em deal com dois sistemas pendentes que tenham horas editadas na mesma categoria.

`FIELDS`, `FIELDS_LOCACAO_C`, `RATE_HOURS_FIELDS` e `CLASSIFICACAO_LOCACAO` existem em três lugares: aqui, em `src/app/functions/ApplyDiscounts.js` e em `src/app/functions/GroupContracts.js`.
Mudou uma, mude as três.
O bloco `buildAllocation` e as constantes de formatação existem em dois: aqui e em `ApplyDiscounts.js`.
