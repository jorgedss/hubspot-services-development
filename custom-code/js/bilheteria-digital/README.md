# Bilheteria Digital

Contexto resumido do cliente para quem for trabalhar nos scripts desta pasta.

## Cliente

Bilheteria Digital é uma plataforma de venda de ingressos. Os produtores de eventos são clientes da plataforma e são gerenciados no **painel próprio** da Bilheteria Digital (sistema interno deles, fora do HubSpot).

O HubSpot é usado pelo time comercial. O negócio (deal) concentra os dados cadastrais do produtor, e um workflow envia esses dados ao painel para criar o produtor lá.

## Integração com o painel

| Item | Valor |
| --- | --- |
| Endpoint | `POST https://ms.bilheteriadigital.net/hubspot-integration/v1/producers` |
| Autenticação | header `x-api-key` com o secret `BD_SERVICE_KEY` |
| Token HubSpot | secret `BD_HUBSPOT_TOKEN` (private app, leitura de deals) |
| Retorno esperado | `produtor_id` no corpo da resposta |
| Erro | mensagem em `error` ou `message` no corpo da resposta |

A API de produtores é mantida pela Bilheteria Digital. Mudança de contrato (campos novos, renomeados ou obrigatórios) depende deles.

## Scripts

### `painel/createProducerOnPainel.js`

Custom code de **ação de workflow baseado em negócio**.

Fluxo:

1. Lê os dados do produtor dos `inputFields` do workflow.
2. Busca o `hubspot_owner_id` do deal via API do HubSpot e envia como `comercial_id`.
3. Envia `hubspot_id` = ID do deal, para o painel guardar a referência.
4. Normaliza o telefone com `onlyDigits` (remove não dígitos e o prefixo `55`).
5. Remove do corpo os campos `undefined` e faz o POST.
6. Devolve os output fields: `hs_execution_state`, `producerId`, `comercialId`, `error`, `errorStatus`, `errorCode`, `errorMessage`.

Erros da API (`{ "error": <código>, "message": "<texto>" }`). O script prioriza a `message` da API e usa a descrição abaixo quando ela não vem:

| HTTP | Código | Significado |
| --- | --- | --- |
| 401 | 1001 | x-api-key ausente ou inválida |
| 400 | 1002 | corpo ausente ou JSON malformado |
| 400 | 1003 | campo obrigatório ausente ou em formato inválido |
| 404 | 2002 | comercial_id não encontrado |
| 404 | 2004 | cidade/estado não cadastrados |
| 404 | 2005 | praca_id não existe ou está inativo |
| 500 | 9001 | falha inesperada |

Timeout ou falha de rede: `errorStatus` e `errorCode` saem `null`.

Mapeamento de campos (input do workflow para o corpo da API):

| Input do workflow | Campo na API |
| --- | --- |
| `tipo_de_produtor` | `tipo_produtor` |
| `cpf` | `cpf_produtor` |
| `cnpj` | `cnpj_produtor` |
| `nome_do_produtor` | `nome_produtor` |
| `nome_fantasia` | `nome_fantasia_produtor` |
| `inscricao_estadual` | `inscricao_estadual_produtor` |
| `contribuinte_import` | `contribuinte` |
| `numero_de_telefone` | `telefone` |
| `estado`, `cidade`, `email`, `estado_civil`, `profissao`, `cep`, `logradouro`, `numero`, `complemento`, `bairro`, `razao_social`, `praca_id`, `hubspot_owner_id` | mesmo nome |
| (owner do deal, via API) | `comercial_id` |
| (ID do deal) | `hubspot_id` |

## Pontos de atenção no script atual

Levantados na leitura do código em 2026-10-02, ainda não corrigidos:

- **Prefixo 55 no telefone:** `onlyDigits` remove `55` do início sempre. Um número sem código de país com DDD 55 (região de Santa Maria, RS) perde o DDD.
- **Falha em `getOwnerId` fica fora do `try`:** o erro sobe sem os output fields de erro, e o workflow não recebe `errorMessage`.
- **Owner duplicado:** o owner chega duas vezes, como `hubspot_owner_id` (input) e `comercial_id` (buscado na API). Falta confirmar com o cliente qual dos dois o painel usa.
- **Log com dados pessoais:** `console.log(bodyFiltered)` grava CPF, e-mail e telefone nos logs do workflow.

