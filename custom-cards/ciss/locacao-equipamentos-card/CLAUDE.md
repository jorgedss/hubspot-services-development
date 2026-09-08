# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working on HubSpot components

---

## Project: locacao-equipamentos-card

### Purpose
Private HubSpot app (platform `2026.03`) that adds one CRM card tab to **Deal** records for discounting **equipment** line items, one row per equipment.
Equipment is `nome_do_sistema = "67"`, and this app is its only writer: `ciss-apps/discount-card` keeps that value in its `SISTEMAS_EXCLUIDOS` and never reads or writes those items.

A discount under the pipeline's `alcada` is written straight to the line items.
One over it is routed into the **same approval flow as the discount-card**: same `pending_discounts`, same `dealstage`, same `proposta_aprovada`, same workflow, one decision per deal.
There is no approval tab here. The approver reads the "Aprovação de Descontos" tab that `discount-card` owns, which renders equipment in its own table.

### Architecture
```
src/app/
├── cards/
│   └── LocacaoEquipamentos.tsx   # The only tab: per equipment editing, alcada check, submit
└── functions/
    ├── fetchLocacaoLineItems.js  # Reads equipment items + pipeline, alcada, approver, entries already pending
    └── aplicarDesconto.js        # Writes directly, OR routes to approval (pending, stage, webhook)
```

### Routing rule
The card sends the split, the way `discount-card/src/app/cards/Discount.tsx` does.
Approval is required when there is at least one edit **in this session** and either the **Total Geral** percentage of the equipment set or **any single row** exceeds the pipeline's `alcada`.
That mirrors `lineRequiresApproval` on the other card, where the aggregate is per system: equipment is one `nome_do_sistema`, so the equipment set is the equivalent unit.

**The set is the unit for both questions and for the payload.**
That is the whole of the parallel with the other card, and it is the easy thing to get wrong.
There, `hasNewValue(line)` and `lineRequiresApproval(line)` are both asked about one system, and when both are true the **whole system** goes pending: `buildLinePayload` emits all six categories, edited or not, and a category that did not move arrives at the workflow with `novo === original` and is skipped by the guard in `buildTargets`.
Here the same holds with the equipment set in place of the system: both questions are asked about the set, and the whole set is sent.

**`foiEditado` is a gate, not a filter.**
It decides *whether* the set goes to approval, never *which rows* of it go.
It exists because a reopened deal already carries its discount in the net values, so a percentage over the `alcada` can be there before anyone types anything, and routing on the percentage alone would send an untouched deal to approval on every page load. Same reason `hasNewValue` exists on the other card.

Asking about the set and sending only the edited rows mixes two granularities, and that is what this card did before the mechanism was aligned.
The routing aggregate spans every row, including rows carrying a discount applied in an earlier cycle, so a payload of edited rows only is a different, smaller set.
The approver is then routed by one percentage and shown another, with nothing on screen explaining why the deal reached them.
Sending the set closes it: routing, payload and the number on screen are the same rows.

**Routing is all or nothing for the set.**
Requires approval: the whole set is sent as pending and no line item is written.
Does not require approval: the whole set is written directly, which is the behavior the card always had.
Applying part and leaving part pending would hand the approver a decision about a state the CRM no longer holds.

**One oddity survives, and it is inherited.**
The per row condition can fire while the aggregate sits under the `alcada`: one row at 90% inside a set that closes at 1,88% routes, and the aggregated row shows 1,88%.
That is verbatim `hasAnyFieldOverThreshold` on the other card, where a Licença at 90% routes a system that displays 1,88%.
Dropping the per row condition is the wrong fix: it would let one item at 100% off ride through inside a large set.
The accordion under the aggregated row in `DiscountApproval.tsx` is what makes it visible. The systems table has one of its own since August 2026 ("Detalhe de serviços (horas)"), for the same reason: an aggregate hides the outlier inside it.

### Properties shared with discount-card
`pending_discounts`, `resumo_descontos_aplicados`, `dealstage`, `proposta_aprovada`, `observacoes` and `discounts_history` are deal properties with **two writers**.

- Entries in `pending_discounts` are discriminated by `tipo`. This app writes **one** entry with `tipo: "equipamentos"` per deal, aggregating the whole equipment set, with the per line item targets in `itens`. System entries have no `tipo`.
- Both writers do read-modify-write: `aplicarDesconto.js` keeps every entry whose `tipo` is not `"equipamentos"`, `ApplyDiscounts.js` keeps every entry whose `tipo` is `"equipamentos"`. Writing without reading first drops the other card's pending discount, and the approver decides on half the negotiation.
- `resumo_descontos_aplicados` is one text field: this app owns everything from `=== EQUIPAMENTOS ===` to the end of the text, the other card owns what comes before it. There is no closing marker, because both write paths put the equipment block last. The opening marker is a string literal in both apps and has to match exactly. `RESUMO_FIM_LEGADO` only exists to strip the closing marker resumos written before August 2026 still carry.
- `APPROVAL_STAGES` is a copy of the map in `ApplyDiscounts.js`. Both cards must send the deal to the **same** stage, or the second submit undoes the first.
- `PIPELINE_THRESHOLDS` in `fetchLocacaoLineItems.js` is a copy of the one in `GroupContracts.js` and `FetchDiscountApproval.js`. Same percentages, three files. Changed one, change all three.
- `TIPO_EQUIPAMENTOS` exists in four files: both app-functions here, `ApplyDiscounts.js` and `automation/desconto-decisao/customCode.js` on the other side.

### The `=== EQUIPAMENTOS ===` block format
`montarResumo` in `LocacaoEquipamentos.tsx` writes **one block per equipment**, then a closing `TOTAL EQUIPAMENTOS` block.
This mirrors the systems resumo built by `buildPendingResumo` in `discount-card/src/app/cards/discountResumo.ts`, which writes one block per system and closes with `TOTAL GERAL`.
Both texts live in the same property and are read in sequence, so the shape has to match.

Each equipment block carries `Qtd.`, `Treinamento` and `Locação` with their **unit values** indented under them, and the item `Total`. The unit value is there because it is what the approver sees in the equipment table and what the write path puts on the line item: the block's total is quantity × unit, and without the unit nobody can check it. An edited quantity shows both ends and no percentage between them (`3 → 5`), exactly like the hour counts on the systems side: changing quantity is scope, not discount. The closing block repeats `Treinamento` and `Locação` for the whole set before the `Total`, so the two texts answer the same questions.

```
Balança Toledo Prix 4
  Qtd.:        3
  Treinamento: R$ 3.600,00 → R$ 3.000,00 (16,67%)
  Locação:     R$ 2.400,00 → R$ 1.800,00 (25,00%)
  Total:       R$ 6.000,00 → R$ 4.800,00 (20,00%)

TOTAL EQUIPAMENTOS (Equipamentos - 67)
  Total:       R$ 10.300,00 → R$ 7.330,00 (28,83%)
  Itens:       3
  Status: Requer Aprovação
```

The per equipment values are `quantidade × unitário`, which is why `Qtd.` is in every block: without it the number does not explain itself.
`Status` sits in the total block only, because the decision is on the set and no single item is approved on its own.
The set total stays in the text because it is the number that routed the approval, and it is the same number stored on the pending entry.

`  ${rotulo}:` padded to 13 characters is the alignment contract, shared with `resumoRow` in `Discount.tsx`.
A label longer than 12 characters overflows the padding and the value column collapses onto the label.

### The approval is of the set, the write is per line item
The rep negotiates equipment by equipment, but the approver decides on the whole set: one row in the approval tab, one row in `discounts_history`, exactly like a system.
So `aplicarDesconto.js` writes **one** entry, not N:

```
{ tipo: "equipamentos", nomeDoSistema: "67", label: "Equipamentos - 67",
  percentualDesconto: 22.5, brutoTotal: 1900, liquidoTotal: 1472.5,
  itens: [ { lineItemId, label, percentualDesconto, quantidade,
             treinamento: { unitarioOriginal, unitarioNovo },
             locacao:     { unitarioOriginal, unitarioNovo } } ] }
```

**`itens` cannot be collapsed into the totals.**
The write is per line item, and rebuilding per item targets from an aggregate would need an allocation nobody typed. Aggregate to decide, keep the items to apply.

**`brutoTotal` and `liquidoTotal` are stored even though summing `itens` derives them.** The approval card never recomputes what came from `pending_discounts`: recomputing is how the number the approver saw drifts from the number the history recorded.

**The detail stays reachable in the approver's tab.** A set at 12% can hide one equipment at 90%, and approving the set approves that item too, so `DiscountApproval.tsx` puts the aggregated row in a table and the per equipment breakdown in an accordion under it.

### Display label vs. filter key
`fetchLocacaoLineItems.js` resolves the option label from `GET /crm/v3/properties/line_items/nome_do_sistema`, the same lookup `GroupContracts.js` does. Today it reads `"Equipamentos - 67"`.

The **value** `"67"` stays hardcoded as the filter key here and in `SISTEMAS_EXCLUIDOS`. Matching on the label would break the day ops renames the option.

The label is display only, and it reaches three places `enrichLabels` cannot: this card's own microcopy, the `label` stored on the pending entry, and the `resumo_descontos_aplicados` text, which is plain text on the deal and passes through no enrichment.
The `=== EQUIPAMENTOS ===` marker is **not** display text. It is a parsing delimiter and stays literal in both apps.
The label lookup failing is not fatal: the card falls back to a generic string and nothing breaks.

### The two write paths must agree
A discount under the `alcada` is written by `patchLineItem` in `aplicarDesconto.js`.
One over it is written by `buildEquipamentoProperties` in `discount-card/automation/desconto-decisao/customCode.js`, after approval.
Same seven properties, same two multiplications. Change one, change the other.
The approval path is covered by the "Equipamentos" sections of `discount-card/automation/desconto-decisao/verificar.js`.

The payload carries **absolute targets**, never a ratio, so a workflow retry or a re-enrollment writes the same value instead of compounding the discount.

### Known divergences from discount-card, deliberately not fixed
These are pre-existing and were left untouched when approval was added.
Anyone touching values here should know they exist.

1. **`valor_locacao_descontado` means two different things.** Here it is the **net unit value**; in `discount-card` it is the **discount amount**. Same property, same object type. It never corrupts data, because the two apps write disjoint sets of line items, but any report reading that property is wrong on one of the two sets.
2. **`price` is never written and the deal `amount` is never recomputed here.** An automation outside the card maintains `amount`. Note that step 7 of the approval workflow still PATCHes `amount` on an approved deal, computed as `Σ price × quantity` from the stored equipment `price`: last writer wins between that PATCH and the external automation.
3. **Totals are written into base properties.** `valor_locacao` and `valor_treinamento` receive `quantidade × unitário`, and the CRM remultiplies a base property by the line item's `quantity` into `valor_*_calculado`. This is only harmless while equipment line items keep `quantity = 1`. `discount-card` solves the same problem by dividing by `quantity` and writing 6 decimals, pinned by `automation/verificacao/verificar-valores.js`.
4. **`horas_treinamento` holds the equipment count**, not hours. It is the quantity input on the card.

### CRM Properties
| Object     | Property                          | Description                                          |
|------------|-----------------------------------|------------------------------------------------------|
| line_items | `nome_do_sistema`                 | Enum. Only `"67"` (Equipamentos) is read              |
| line_items | `name`                            | Equipment name, shown on the card and used as each `itens[]` label |
| line_items | `horas_treinamento`               | Equipment count, not hours (read + written)          |
| line_items | `valor_treinamento` / `valor_treinamento_original` / `valor_treinamento_descontado` | Training: total written back, gross unit snapshot, net unit value |
| line_items | `valor_locacao` / `valor_locacao_original` / `valor_locacao_descontado` | Rental: same three roles. See divergence 1 above |
| deals      | `pipeline` / `dealname`           | Read. `pipeline` selects the `alcada` and the approval stage |
| deals      | `pending_discounts`               | Shared with discount-card. Read, merged, written     |
| deals      | `resumo_descontos_aplicados`      | Shared. Only the `=== EQUIPAMENTOS ===` block belongs to this app |
| deals      | `dealstage`                       | Moved to the pipeline's approval stage on submit. Moved back on reject by a native workflow action, never by code here |
| contacts   | `aprovador_de_desconto` / `aprovador_pipelines` | Read, to name the approver on screen and to fire the webhook |

### HubSpot API Calls (serverless functions)
| Function                | Method | Endpoint                                                      |
|-------------------------|--------|----------------------------------------------------------------|
| fetchLocacaoLineItems   | GET    | `/crm/v3/objects/deals/{dealId}` (pipeline, dealname, pending)  |
| fetchLocacaoLineItems   | GET    | `/crm/v3/objects/deals/{dealId}/associations/line_items`        |
| fetchLocacaoLineItems   | POST   | `/crm/v3/objects/line_items/batch/read`                         |
| fetchLocacaoLineItems   | GET    | `/crm/v3/properties/line_items/nome_do_sistema` (display label) |
| fetchLocacaoLineItems   | POST   | `/crm/v3/objects/contacts/search`                               |
| aplicarDesconto         | GET    | `/crm/v3/objects/deals/{dealId}` (pipeline, pending, resumo)    |
| aplicarDesconto         | PATCH  | `/crm/v3/objects/deals/{dealId}` (pending, resumo, dealstage)   |
| aplicarDesconto         | POST   | `/crm/v3/objects/contacts/search`                               |
| aplicarDesconto         | GET    | `/crm/v3/owners` (approver email to owner)                      |
| aplicarDesconto         | POST   | `/automation/v4/webhook-triggers/...` (approval webhook)        |
| aplicarDesconto         | PATCH  | `/crm/v3/objects/line_items/{id}` (one per item, direct path only) |

### Environment Variables
- `PRIVATE_APP_ACCESS_TOKEN`: required by both serverless functions for every HubSpot API call.

### Required scopes (app-hsmeta.json)
`oauth`, line_items read/write, deals read/write, contacts read, owners read.
Deals write, contacts read and owners read were added for the approval flow: uploading this app asks for consent again in the portal.

### Permitted URLs (app-hsmeta.json)
- `https://api.hubapi.com`

---

IMPORTANT: IF THE 'HubSpotDev' MCP SERVER IS INSTALLED USE THE TOOLS BEFORE TRYING TO MANUALLY USE CLI COMMANDS OR BEFORE TRYING TO DO ANYTHING WITH HUBSPOT ASSETS

## HubSpot Project Information
- The project configuration is in the `hsproject.json` file
- A directory is considered a part of the project if it or a directory above it contains a `hsproject.json` file
- The project src directory is defined in the `srcDir` field in the `hsproject.json`
- The project's platform version is defined in `platformVersion` in the `hs project.json`
- The `platformVersion` determines what features the project has access to as well as the shape of the configuration files

## Local Development
### Local Development Server (`hs project dev`)
- Start a local development server with `hs project dev` to view extension changes without refreshing
- The server runs on your local machine and syncs changes to HubSpot in real-time
- When the server is running, UI extensions (cards, settings pages) display a "Developing locally" tag
- Saving changes to JSX files automatically refreshes the page

### Local Proxy Configuration (`local.json`)
- During local development, you can proxy `hubspot.fetch()` requests to a locally running backend
- Create a `local.json` file in the same directory as your app's `*-hsmeta.json` file
- The proxy configuration maps HTTPS URLs to local URLs:
  ```json
  {
    "proxy": {
      "https://example.com": "http://localhost:8080"
    }
  }
  ```
- **Important**: Proxy URLs must be valid HTTPS URLs (the key, not the value)
- Path-based routing is NOT supported (e.g., `"https://example.com/a": "http://localhost:8080"` will not work)
- When a `local.json` file is detected, the CLI confirms the proxy is active
- To disable the proxy, rename the file to `local.json.bak` and restart the dev server

### Request Signing with CLIENT_SECRET
- You can inject the `CLIENT_SECRET` environment variable when starting the local dev server:
  ```shell
  CLIENT_SECRET="abc123" hs project dev
  ```
- This enables request signing during local development for testing secure backend communications

## npm packages
### `@hubspot/ui-extensions`
- In the `@hubspot/ui-extensions` npm package, only the component properties defined by the component are valid.  `style` properties are not valid

### `hubspot.fetch` API
- `hubspot.fetch` is a function provided by `@hubspot/ui-extensions` for making HTTP requests from UI components
- **Critical**: `hubspot.fetch` requires fully qualified domain names (FQDN) with HTTPS - relative paths are NOT supported
- All URLs must be added to the `permittedUrls.fetch` array in the app's `*-hsmeta.json` configuration file
- Example:
  ```json
  "permittedUrls": {
    "fetch": ["https://api.example.com", "https://api.hubapi.com"],
    "iframe": [],
    "img": []
  }
  ```
- Fetch URLs must be valid HTTPS URLs and cannot be `localhost`
- To call a local backend during development, use the `local.json` proxy configuration (see Local Development section)

## Component Information
### General
- Component configuration files must end with `-hsmeta.json`
- The `uid` field in the `-hsmeta.json` files must be unique with the project
- The `type` field in the `-hsmeta.json` files defines the type of the component
- Components can not be in nested subdirectories, only the specified directories in their corresponding component rules.
- Example components can be found in https://github.com/HubSpot/hubspot-project-components. The directories are split up by platform version and follow this format `${platformVersion}/components`. Note the project create tool only supports platform versions >= 2025.2.
- All component subdirectories must be in the project source directory

### app component
- There can only be one `app` component
- `app` component must be in the `app` directory
- If the `config.distribution` field is set to `marketplace`, the only valid `config.auth.type` value is `oauth`

### card
- `card` components must be in the `app/cards` directory
- The global `window` object is not available in the `card` component
- Cannot use `window.fetch`, and instead must use the `hubspot.fetch` function provided by the `@hubspot/ui-extensions` npm package.  Any urls called with the `hubspot.fetch` function must be added to the `config.permittedUrls.fetch` array in the `app` component's hsmeta.json file
- `hubspot.fetch` requires fully qualified HTTPS URLs (e.g., `https://api.example.com/endpoint`) - relative paths like `/api/endpoint` are NOT supported
- Only components exported from the `@hubspot/ui-extensions` npm package can be used in `card` components

#### Available Hooks for Card Components

Prefer hooks over `hubspot.fetch` — use hooks to access CRM data and extension context before falling back to `hubspot.fetch` for external HTTP requests. Hooks must be called at the component level, not inside conditionals or loops. The list below may not be exhaustive — refer to the [hooks documentation](https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/ui-extensions-sdk/hooks.md) as the source of truth for all available hooks and their parameters.

**Universal hooks** (available across all extension points):
- `useExtensionApi` - Access both context and actions from a single hook
- `useExtensionContext` - Access contextual information about the extension environment (portal, user, extension metadata)
- `useExtensionActions` - Access all available actions for the current extension point
- `useCrmSearch` - Search CRM records
- `useDebounce` - Debounce a rapidly-changing value

**CRM-specific hooks** (available in `crm.record.tab`, `crm.record.sidebar`, `crm.preview`, `helpdesk.sidebar` extension points):
- `useCrmProperties` - Fetch properties from the current CRM record
- `useAssociations` - Fetch associated CRM records

#### Available Actions for Card Components

Access actions via the `useExtensionActions` hook or the `actions` parameter from `hubspot.extend()`. The list below may not be exhaustive — refer to the [actions documentation](https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/ui-extensions-sdk/actions.md) as the source of truth for all available actions and their parameters.

**Universal actions** (available across all extension points):
- `addAlert` - Display an alert banner
- `reloadPage` - Reload the current page
- `copyTextToClipboard` - Copy text to clipboard; requires explicit user interaction
- `closeOverlay` - Close an open overlay or modal by its id
- `openIframeModal` - Open a URL in an iframe modal

**CRM-specific actions** (available in `crm.record.tab`, `crm.record.sidebar`, `crm.preview`, `helpdesk.sidebar` extension points):
- `fetchCrmObjectProperties` - Fetch property values from the current CRM record
- `refreshObjectProperties` - Refresh CRM record properties in the UI without a full page reload
- `onCrmPropertiesUpdate` - Subscribe to UI-level changes to CRM properties

#### Context Object

Access context via the `useExtensionContext` hook or the `context` parameter from `hubspot.extend()`. The list below may not be exhaustive — refer to the [context documentation](https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/ui-extensions-sdk/context.md) as the source of truth for all available context fields.

**Universal fields** (available on all extension points):
- `location` - Extension point identifier
- `portal.id` / `portal.timezone` / `portal.dataHostingLocation` - Account info
- `user.id` / `user.email` / `user.firstName` / `user.lastName` / `user.locale` / `user.language` / `user.teams` / `user.permissions` - User info
- `variables` - Project configuration variables

**CRM-specific fields** (available in `crm.record.tab`, `crm.record.sidebar`, `crm.preview`, `helpdesk.sidebar` extension points):
- `crm.objectId` - Current CRM record's ID
- `crm.objectTypeId` - Record type ID
- `extension.appId` / `extension.appName` / `extension.cardTitle` - Extension metadata

#### Logging

Use the `logger` API to send custom log messages. In local development mode, logs go to the browser console only; in production they are sent to HubSpot and viewable via `hs project logs`. The list below may not be exhaustive — refer to the [logging documentation](https://developers.hubspot.com/docs/apps/developer-platform/add-features/ui-extensions/ui-extensions-sdk/logging.md) as the source of truth for all available logging methods.

- `logger.info` - Informational messages
- `logger.debug` - Debug messages
- `logger.warn` - Warning messages
- `logger.error` - Error messages

### app-event
- `app-event` components must be in the `app/app-events` directory

### app-object
- `app-object` components must be in the `app/app-object` directory

### app-function
- `app-function` components must be in the `app/functions` directory
- `app-function` components are not available when `config.distribution` is set to `marketplace` in the `app` component `-hsmeta.son` file

# settings
- There can only be one `settings` component
- `settings` components must be in the `app/settings` directory
- The global `window` object is not available in the `settings` component
- Cannot use `window.fetch`, and instead must use the `hubspot.fetch` function provided by the `@hubspot/ui-extensions` npm package.  Any urls called with the `hubspot.fetch` function must be added to the `config.permittedUrls.fetch` array in the `app` component's `hsmeta.json` file
- `hubspot.fetch` requires fully qualified HTTPS URLs - relative paths are NOT supported
- Only components exported from the `@hubspot/ui-extensions` npm package can be used in `settings` components
- React Components from `@hubspot/ui-extensions/crm` cannot be used in `settings` components

# scim
- There can only be one `scim` component
- `scim` components must be in the `app/scim` directory

# webhooks
- There can only be one `webhooks` component.
- `webhooks` components must be in the `app/webhooks` directory

### workflow-actions
- `workflow-action` components must be in the `app/workflow-actions` directory

## HubSpot CLI commands
- All the commands and subcommands have a `--help` argument that provides details on the command and it's arguments
- The help output is standard yargs output
- The commands for working with projects in HubSpot are subcommands of `hs project`
- Debugging flag that can be added to `hs` commands and subcommands: `--debug`
- Debugging problems with CLI installation: `hs doctor`

### Project Commands
- `hs project create` - Create a new HubSpot project interactively
- `hs project upload` - Upload the project to HubSpot (build is created automatically)
- `hs project deploy` - Deploy a specific build of the project to make it live
- `hs project dev` - Start a local development server for real-time development of UI extensions
- `hs project watch` - Watch for file changes and automatically upload them
- `hs project list` - List all projects in the account
- `hs project download` - Download a project from HubSpot to local
- `hs project open` - Open the current project page in the browser
- `hs project logs` - View logs for deployed projects
- `hs project list-builds` - List all builds for a project
- `hs project validate` - Validate project configuration files
- `hs project migrate` - Migrate a project to a newer platform version
- `hs project migrate-app` - Migrate a legacy app to the projects framework
- `hs project clone-app` - Clone an existing app configuration

### Account Management
- `hs init` - Initial setup of the hubspot configuration file
- `hs account auth` - Authenticate a new account (requires browser interaction)
- `hs account list` - List all configured accounts
- `hs account use` - Switch the default account
- `hs account info` - Display information about an account
- `hs account rename` - Rename an account in the config
- `hs account remove` - Remove an account from the config
- `hs account clean` - Clean up invalid/expired authentication
- `hs account create-override` - Create a project-specific account override
- `hs account remove-override` - Remove a project-specific account override

### CMS Commands
- `hs cms upload <src> <dest>` - Upload files to HubSpot
- `hs cms fetch <src> <dest>` - Download files from HubSpot
- `hs cms watch <src> <dest>` - Watch for changes and automatically upload
- `hs cms list <path>` - List remote files in HubSpot
- `hs cms delete <path>` - Delete files from HubSpot
- `hs cms mv <srcPath> <destPath>` - Move/rename files in HubSpot
- `hs cms function list` - List all serverless functions
- `hs cms function logs <path>` - View logs for a serverless function
- `hs create template <name>` - Create a new template
- `hs create module <name>` - Create a new module
- `hs create function <name>` - Create a new serverless function
- `hs theme preview` - Preview a theme locally at https://hslocal.net:3000/

### Sandbox Management
- `hs sandbox create` - Create a development sandbox account
- `hs sandbox delete` - Delete a sandbox account

### Secrets Management
- `hs secret list` - List secrets for serverless functions
- `hs secret add <name> <value>` - Add a secret
- `hs secret update <name> <value>` - Update a secret
- `hs secret delete <name>` - Delete a secret

### Test Account Management
- `hs test-account create` - Create a configurable test account
- `hs test-account delete` - Delete a test account
- `hs test-account import-data` - Import test data

## General
- Follow existing patterns in the codebase
- Use proper component structure based on component `type` in the `-hsmeta.json` file
- Ensure configuration files follow HubSpot naming conventions
- Always validate that components are placed in correct directories
- When working with UI extensions, remember that `hubspot.fetch` requires HTTPS URLs in `permittedUrls.fetch`
- Use `hs project dev` for iterative development of cards and settings pages
- Use `local.json` to proxy API requests to a local backend during development
