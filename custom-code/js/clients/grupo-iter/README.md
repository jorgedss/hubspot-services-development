# Grupo Iter - Custom Code SIG

Scripts de custom code (Node.js) para as integrações SIG do Grupo Iter, organizados por
unidade de negócio (BU). Cada script é uma action de custom code em um workflow cujo
trigger é um webhook; a chave de inscrição é o e-mail.

Token de autenticação: cada portal (produção ou sandbox) expõe a secret com o nome
`HUBSPOT_TOKEN_INTEGRACAO_SIG` (produção) ou `HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG`
(sandbox). O script lê o valor via `process.env` e nunca o recebe hardcoded.

> Campos de data do SIG chegam em formato `DD-MM-YYYY` (hífen). Campos de valores
> checkbox/aceite usam as regras documentadas em cada script.

## Estrutura

```
custom-code/js/clients/grupo-iter/
├── caracol/
│   ├── formSubmit.js          # evento form-submit
│   ├── compraSiteSucesso.js   # evento compra-site-sucesso
│   └── addToCart.js           # evento add-to-cart
├── bondinho/
│   ├── compraSiteSucesso.js          # evento compra-site-sucesso
│   ├── compraSiteSucessoSocio.js     # evento compra-site-sucesso-socio
│   ├── compraSiteNegadaAntifraude.js # evento compra-site-negada-antifraude
│   ├── compraSiteNegadaCartao.js     # evento compra-site-negada-cartao
│   └── carrinhoAbandonado.js         # evento carrinho-abandonado
└── README.md
```

---

## Bondinho

Brand da unidade de negócio: `hs_all_assigned_business_unit_ids = 4554145`.

Pipeline e estágios do deal: `Venda de Bilhete` (927835212). Estágio `Venda realizada`
(1422040488) no evento de sucesso, e `Perdido` (1422054714) com `motivo_de_perda =
Pagamento recusado` no evento de antifraude.

| Evento | Script | Conta | Endpoint / link de cadastro |
|---|---|---|---|
| compra-site-sucesso | `bondinho/compraSiteSucesso.js` | sandbox | `https://api.hubapi.com/automation/v4/webhook-triggers/52050136/WTrSqX5` |
| compra-site-negada-antifraude | `bondinho/compraSiteNegadaAntifraude.js` | sandbox | `https://api.hubapi.com/automation/v4/webhook-triggers/52050136/rNsPgTD` |
| compra-site-negada-cartao | `bondinho/compraSiteNegadaCartao.js` | sandbox | `https://api.hubapi.com/automation/v4/webhook-triggers/52050136/LjoHHQQ` |
| compra-site-sucesso-socio | `bondinho/compraSiteSucessoSocio.js` | sandbox | `https://api.hubapi.com/automation/v4/webhook-triggers/52050136/JxoIurd` |
| carrinho-abandonado | `bondinho/carrinhoAbandonado.js` | sandbox | `https://api.hubapi.com/automation/v4/webhook-triggers/52050136/X8dakrW` |

---

## Caracol

Brand da unidade de negócio: `hs_all_assigned_business_unit_ids = 4554143`.

| Evento | Script | Conta | Endpoint / link de cadastro |
|---|---|---|---|
| add-to-cart | `caracol/addToCart.js` | sandbox | `https://api.hubapi.com/automation/v4/webhook-triggers/52050136/wZRkIhE` |
| form-submit | `caracol/formSubmit.js` | sandbox | _(a preencher após cadastro)_ |
| compra-site-sucesso | `caracol/compraSiteSucesso.js` | _(a definir)_ | _(a preencher após cadastro)_ |
