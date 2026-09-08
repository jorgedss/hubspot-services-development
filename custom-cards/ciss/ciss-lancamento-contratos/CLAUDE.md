# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A HubSpot **developer project** (`hsproject.json`, `platformVersion` 2026.03) defining a single private app that adds a UI Extension card to CRM **deal** records. From a deal, users stage one or more "lançamentos" (contract launches) and execute them to generate HubSpot **line items** priced from product data.

Note on scope: the git repository root is the `hubspot-apps` monorepo, which holds several unrelated app collections (`ciss-apps`, `housi-apps`, `ipog-apps`, `sienge-apps`, `test-account-app`). This directory is one self-contained app. Run all `hs` and lint commands from here, not the repo root.

Domain terms, CRM property names, and user-facing strings are in Brazilian Portuguese; serverless functions return `{ sucesso, erro }`-shaped objects (Portuguese keys) that the card checks via `response.sucesso`.

## Commands

Run from this app directory (where `hsproject.json` lives):

- `hs project dev` — local development against a HubSpot sandbox
- `hs project upload` — build and deploy the project

Lint / format live in `src/app/cards/` and must be run from there:

- `cd src/app/cards && npm run lint` (`lint:fix` to autofix)
- `cd src/app/cards && npm run format` (`format:check` to verify)

There is no test suite. Requires the [HubSpot CLI](https://www.npmjs.com/package/@hubspot/cli) and the `PRIVATE_APP_ACCESS_TOKEN` env var (private-app token with read/write on deals, products, and line items — see scopes in `contract_launch_app-hsmeta.json`).

## Architecture

`src/app/` is one app (`*-hsmeta.json` files declare each component's `uid`/`type` to HubSpot):

- `cards/ContractLaunch.jsx` — the CRM card (React UI Extension), rendered as a tab on deal records.
- `functions/` — three serverless functions invoked from the card via `runServerless({ name, parameters })`.

**Two independent package roots, bundled separately at build time.** `cards/package.json` is ESM (`"type": "module"`) with React + `@hubspot/ui-extensions`; `functions/package.json` is CommonJS with `axios`. Serverless functions are `exports.main = async (event) => …` and read inputs from `event.parameters`. A dependency is only available to the side whose `package.json` declares it (see `functions/README.md`).

### Card flow (ContractLaunch.jsx)

The card keeps a local `staged` array — nothing is written to HubSpot until "Executar lançamento". Two ways to add to the queue:

1. **Manual**: user fills the deal properties (`tipo_de_contrato`, `sistema`, `modulo`, `item_modulo`) and clicks "Adicionar lançamento".
2. **By sales model**: selecting `modelo_de_vendas` on the deal auto-stages an entry via a `useEffect` (SKUs are resolved server-side from the model name).

After each stage, `clearDealProps` wipes the temporary deal properties so the next launch can be entered, then `refreshObjectProperties()` re-reads them. Executing calls `createContract` with the whole `staged` array and reloads the page.

The staging table's "Sistemas" column shows the `sistema` property of each queued lançamento. `deals.sistema` is a checkbox (multi-select) property, so the raw value is a single string with selections separated by `;`; the card splits it and maps each token through the `sistema` label map from `fetchPropertyLabels` before joining for display. `sistema` is captured on the deal for record-keeping only — it never feeds into `createContract`'s pricing/SKU logic.

### Serverless functions

- `fetchPropertyLabels.js` — reads the `deals.tipo_de_contrato` and `deals.sistema` property definitions and returns namespaced `value → label` maps (`{ tipoDeContrato, sistema }`) so the staging table can show human labels for both columns.
- `clearDealProps.js` — PATCHes the deal to blank out the temp fields (`tipo_de_contrato`, `sistema`, `modelo_de_vendas`, `modulo`, `item_modulo`).
- `createContract.js` — the core pipeline (details below).

### createContract pipeline

1. **Expand to SKUs.** Each lançamento becomes a list of SKUs: from `modelsMap[modelo_de_vendas]` (a large hardcoded model → SKU-list table) for model launches, or by splitting `item_modulo` on `;` for manual ones.
2. **Fetch products** by `hs_sku` via the products search API, chunked in batches of 100.
3. **Build a line item per (lançamento, SKU)** with `buildLineItem`, driven by two lookup tables:
   - `rule`: product `tipo_emissao` (`T`/`F`/`L`/`R`/`N`) → which deal quantity field supplies the **multiplier** (`quantos_televendas`, `quantos_pdvs`, `quantos_cnpjs`, `quantas_retaguardas`; `N` = no multiplier).
   - `contractTypeClassification`: `tipo_de_contrato` prefix → classification `L` (Licença), `C` (Locação), `S` (Serviço), or `E` (Cancelamento). The classification decides **which value fields are populated** (`valor_licenca`, `valor_glt`, `valor_locacao`, `valor_treinamento`, `horas_treinamento`). For `E`, values come from the deal's `valor_cancelamento_contrato_*` properties instead of the product; unknown classifications fall back to summing all product values.
   - Line-item `price` = sum of the populated value fields; `quantity` is always `1` (unit counts are folded into `price` via the multiplier).
4. **Create or update.** Existing line items on the deal are read and keyed by `hs_sku` alone (`getExistingLineItems`). Each built item whose SKU already exists is **overwritten** via `line_items/batch/update` (this also refreshes `tipo_de_contrato` and the value fields); the rest are created via `line_items/batch/create` (both chunked at 100, creates associate to the deal with `associationTypeId` 20). Duplicates within a single run collapse by SKU (last wins). This is what prevents the same SKU from being launched twice.
5. **Recompute the deal `amount`** by reading all associated line items and summing `price * quantity`.

**Cross-app coupling with `discount-card`.** Because an update rewrites the base value properties with catalog values, it also **clears the discount state** of the items it rewrites (`DISCOUNT_STATE_TO_RESET`): the `*_original` snapshots plus the `*_descontado` percent/amount satellites for Mensalidade, Licença, Locação and Treinamento. A re-launch redefines the item's commercial baseline, so the previous discount no longer applies and has to be renegotiated on the new value. The `discount-card` app reads those `*_original` snapshots as the immutable gross of every discount, so leaving a stale one behind would make it show a net above the gross (catalog went up) or a phantom discount nobody applied (catalog went down). Desenvolvimento/DBA and Consultoria are deliberately **not** reset — this app never rewrites their value properties, so clearing their snapshots would destroy the original gross of a discount still in force.

When editing pricing/quantity logic, `buildLineItem` (the classification/multiplier branching) and the `rule`/`contractTypeClassification` maps are the things to touch. The `modelsMap` table is data, not logic — SKUs there are HubSpot product SKUs.
