---
name: ui-extensions-cards
description: >
  Builds HubSpot app cards (CRM record cards) and their serverless functions on
  the developer platform (platformVersion 2026.03). Covers project structure,
  card-hsmeta and app-function config, wiring a card to a serverless function
  via hubspot.serverless, writing CRM properties from the function with the
  app's own PRIVATE_APP_ACCESS_TOKEN (sole auth mechanism), and the mandatory UI
  refresh after a successful write. Use when building or changing an app card, a
  serverless function called by a card, or any CRM record UI extension.
  Triggers: "cria um card", "custom card", "app card", "card de CRM",
  "serverless pro card", "atualiza propriedade no card", "ui extension",
  "extensão de registro".
---

<!-- Changelog:
- 1.0 (2026-08-28): New developer-domain skill. Incorporates the
  ui-extensions-cards material (v1.8) into hubspot-developer as a dedicated
  skill. Content preserved: PRIVATE_APP_ACCESS_TOKEN auth rule, scope-reinstall
  gotcha, association id (result.id vs toObjectId) gotcha, card/app-function
  config, .d.ts type discipline, no-parent-imports code organization, read-only
  discovery rule, and the end-to-end CEP example. Dependencies re-pointed to the
  existing skills (project-lifecycle, account-safety, revops-hubspot) and
  references/hubspot-cli-reference.md. Rewritten on the multi-account model: the
  agent's own discovery reads use $HUBSPOT_APP_TOKEN_<account_id>; the app
  function's writes always use the app's PRIVATE_APP_ACCESS_TOKEN.
- 1.1 (2026-09-30): migrated to Claude Code (.claude/skills). Removed the
  deploy-reviewer dependency: a production write now requires account-safety
  plus explicit operator confirmation. Skill paths re-pointed from
  .opencode/skills to .claude/skills. Added the repository location rule
  (custom-cards/<client>/<project>/). All technical rules unchanged.
-->

# ui-extensions-cards

## Authentication rule (non-negotiable)

App functions authenticate HubSpot API calls **only with the app's own
Private App token**, exposed as `process.env.PRIVATE_APP_ACCESS_TOKEN`.
No other credential is permitted:

- **Never** use the CLI PAK (`hs` Personal Access Key) to call the CRM
  API from a function.
- **Never** use a per-account `HUBSPOT_APP_TOKEN_<account_id>` (that token
  is for the agent's own CRM REST work, not for app functions).
- **Never** use OAuth access tokens for a `static`/`private` app function.
- **Never** hardcode the token value in code; read it only from
  `process.env.PRIVATE_APP_ACCESS_TOKEN`.

`PRIVATE_APP_ACCESS_TOKEN` is a **reserved keyword managed automatically
by HubSpot**: the platform injects it into the app function's environment
at runtime, with no `secretKeys` entry and no `hs secrets add` required.
Do **not** list it in `secretKeys`; the build rejects reserved names with
"The secret PRIVATE_APP_ACCESS_TOKEN ... is a reserved keyword and cannot
be used." The scopes the token carries are the app's declared scopes
(`requiredScopes` in `app-hsmeta.json`), so those scopes must include the
CRM write scope (`crm.objects.companies.write` etc.).

### Scopes don't auto-update: reinstall the app after changing `requiredScopes`

Adding a scope to `requiredScopes` in `app-hsmeta.json` **does not**
change the token the installed app carries. A `static`/`private` app
keeps the scopes captured at install time, so a write that needs a newly
added scope will fail with a `403` until the app is reinstalled. This is
a hard gotcha, not an edge case.

- Before surgery, check the installed scopes with
  `hs project app-install-status --account <id>`. When the app is stale
  it prints `... is installed ... with outdated scopes. Reinstall the app
  to grant the latest scopes.`
- After changing `requiredScopes` (for example adding
  `crm.objects.line_items.write`), reinstall:
  `hs project install-app --account <id> --force`.
- Re-run `hs project app-install-status --account <id>` and confirm the
  "outdated scopes" warning is gone. The app token may be cached for a
  few minutes after reinstall; a still-warm `403` can need a retry.

### Association IDs come back in `id`, not always `toObjectId`

When a serverless function reads associated records via
`GET /crm/v3/objects/{fromType}/{fromId}/associations/{toType}`, do not
assume the response field name for the target object id. The `results[]`
items carry the target id in `result.id` (the v3 shape), not always a
`toObjectId`. Read the live response first (or write
`a.toObjectId ?? a.id`) instead of hardcoding one field. Mapping
`a.toObjectId` when the API actually returns `id` yields `undefined` ids
upstream and silently empty results, the exact failure mode of "the deal
has line items but the card says it doesn't".

## When to invoke

- Create or edit an app card (CRM record card, `crm.record.tab` /
  `crm.record.sidebar` / `crm.preview`).
- Add or change a serverless function called by a card.
- Wire a card to CRM data: read/write record properties, refresh the record UI.

## When NOT to invoke

- Project create/dev/upload/deploy lifecycle: use `project-lifecycle`.
- CMS themes/modules (not app cards): use `cms-workflow`.
- Account selection and auth before any write: use `account-safety` first.

## Client identity echo (mandatory)

Load the client name and account ID from the active registry row at
invocation. Every confirmation, preview, and write this skill emits MUST
carry `[<alias> | <account_id>]` in the first line. A prompt without the tag
is invalid.

## Workflow

0. **Prerequisites (zero-state guard):** before any read or build, verify
   account, token, and schema exist. If the account is not registered,
   `$HUBSPOT_APP_TOKEN_<account_id>` is absent from `.env`, or the schema
   file is empty, STOP and route through the AGENTS.md onboarding
   (per-account registration via `account-safety`) instead of proceeding.
   Only with account, token, and schema in place do Steps 1-9 run.
1. **Pre-flight account gate (mandatory):** run `account-safety` first.
   Resolve the target account by numeric `account_id`, confirm the tier
   (serverless app functions require Enterprise), and never fall back
   to a default.
2. **Confirm the target is a sandbox** unless the user explicitly
   targets production, then reinstall-verify scopes (Step 3).
3. **Check installed scopes before any write:**
   `hs project app-install-status --account <id>`. If it reports
   "outdated scopes", reinstall
   (`hs project install-app --account <id> --force`) BEFORE building
   the write, so the first `PATCH` does not silently `403`.
4. **Query the portal BEFORE assuming (read-only, token-authorized):**
   the agent resolves the per-account CRM token
   `$HUBSPOT_APP_TOKEN_<account_id>` and issues read-only `GET` calls
   against the live API before making any assumption about data, field
   names, association shapes, or a function's expected return. This
   token is authorized for **reads only**.
5. **Never assume return shapes:** for every endpoint the function will
   call (CRM v3 records, associations, search, properties), hit the
   live API once and read the actual response keys (for example
   `result.id` vs `toObjectId`, the properties schema) instead of
   guessing from memory or docs. Validate every CRM property internal
   name against the live schema (`revops-hubspot`) and confirm the
   card's `objectTypes` and `location` are compatible (see Card config).
6. **Scaffold:** `hs project add --type components/app-cards
   --features card` and `--features app-function` (defer create-step
   details to `project-lifecycle`).
7. **Wire:** card → function via `hubspot.serverless(uid,
   { parameters })`; function → CRM via `PRIVATE_APP_ACCESS_TOKEN`.
8. **Write + refresh:** on success, `actions.refreshObjectProperties()`
   before the success alert.
9. **Ship:** lint + validate, then upload/deploy via `project-lifecycle`
   (production requires `account-safety` plus explicit operator
   confirmation).

### Decision tree

- Card only (no CRM write) → skip Steps 3 and 8; still run Step 4 if it reads properties.
- New scope added → Step 3 reinstall first, always.
- Production write → `account-safety` plus explicit operator confirmation, never inline.

### Read-only discovery rule (non-negotiable)

Before any build or code write, the agent queries the live portal with
`$HUBSPOT_APP_TOKEN_<account_id>` to ground assumptions in real data.
The token has one allowed direction:

- **Allowed:** read-only `GET` calls to the CRM API (records, properties,
  associations, search, schema, account info) to inspect data and confirm
  shapes. The agent may run these without asking, because they change
  nothing.
- **Forbidden without approval:** any create, update, or delete,
  including `POST`, `PATCH`, `PUT`, `DELETE` against CRM, settings, or
  developer endpoints. For these the agent MUST stop and ask the user,
  stating exactly what it intends to change, the endpoint and payload,
  and why, then wait for explicit approval. A write performed without
  this approval is an incident.

This distinction is separate from the app function's own auth rule: the
function still writes with `PRIVATE_APP_ACCESS_TOKEN`, never the agent's
`$HUBSPOT_APP_TOKEN_<account_id>`. The agent token is for discovery
reads and (after explicit approval) nothing else.

## Project structure (2026.03)

In this repository every card project lives in its own folder under
`custom-cards/<client>/<project>/` (for example
`custom-cards/ciss/discount-card/`), with `hsproject.json` at the project
root. The tree below is relative to that project root.

```
src/app/
  app-hsmeta.json          # app config: auth, requiredScopes
  cards/
    <name>.tsx|.jsx        # card React entrypoint
    card-hsmeta.json       # card schema
    package.json           # shared by all cards
    components/            # optional: extracted subcomponents
    hooks/                 # optional: extracted hooks
    utils/                 # optional: helpers shared within this card
  functions/
    <name>.js              # serverless function code
    <function>-hsmeta.json # type: app-function
    package.json
    utils/                 # optional: helpers shared within functions
hsproject.json
```

Scaffold a card and a function with
`hs project add --type components/app-cards --features card` and
`--features app-function` (see `project-lifecycle` for the create step).

## Code organization (structure follows the boundary)

The `cards/` and `functions/` directories are self-contained extension
points: each is built and deployed independently, so every file an
extension imports must live inside its own root directory. The
`no-parent-imports` lint rule enforces this in code; the packaging
enforces it in production.

- **Keep each extension's imports inside its own directory.** An import
  like `import { formatCep } from '../shared/utils'` works under
  `hs project dev` but fails at runtime, because `shared/` is not
  packaged with the card. Relative imports within the same extension
  point are free: `./utils/format`, `./components/AddressForm`, and
  `./hooks/useCep` are all valid because they stay inside `cards/`.

- **Share code across extension points only via npm workspaces.** When
  several cards (or a card plus a settings page) need the same helper
  or component, add a root `package.json` under `src/app/` with
  `workspaces` and publish shared code as scoped packages
  (`packages/utils`, `packages/components`, `packages/types`), then
  import them, for example `import { Section } from "@<project>/components"`.
  Do not reach across with a relative `../` that escapes the extension
  point.

### Card entrypoint as the main function

Treat the file named by the `card-hsmeta.json` `entrypoint` (for example
`/app/cards/MyCard.tsx`) as the card's main: it calls `hubspot.extend()`
and mounts the top-level component, and it stays small. Any card that
grows beyond one screen should be split:

```
src/app/cards/
  MyCard.tsx         # entrypoint: hubspot.extend() + top-level component
  components/
    AddressForm.tsx  # extracted subcomponents imported by MyCard
    ResultTable.tsx
  hooks/
    useCep.ts        # state/effect logic extracted from the component
  utils/
    format.ts        # pure helpers shared within this card
```

- **Extract subcomponents** once a card spans multiple UI blocks: a
  second `Flex`, `Table`, or `EmptyState` block is the signal to move it
  into `components/` and import it, exactly as the React component
  pattern expects. The entrypoint stays a thin wrapper.

- **Extract hooks and utils** when logic (fetch state, formatting)
  outgrows the component body. Helpers reused within one card live in
  `cards/utils/`, never hoisted to a `../shared/` that breaks packaging.

### function code organization

Serverless functions follow the same self-contained rule inside their
own directory. Single-function helpers stay in the same file and
`exports.main` only orchestrates them (see Function code). When several
functions in one app share pure helpers (mapping, validation), put them
in a `functions/utils/` module and import them with a relative path that
stays inside `functions/`.

## Card config (`card-hsmeta.json`)

```json
{
  "uid": "my_card",
  "type": "card",
  "config": {
    "name": "Card title",
    "location": "crm.record.tab",
    "entrypoint": "/app/cards/MyCard.tsx",
    "objectTypes": ["COMPANY"]
  }
}
```

- `uid` must be unique within the project and stable (it identifies the
  card across redeploys).
- `location`: `crm.record.tab` | `crm.record.sidebar` | `crm.preview` |
  `helpdesk.sidebar`. Omit to allow any compatible surface. **Do not
  invent a surface:** each location has its own requirements (for example
  `helpdesk.sidebar` needs a `helpdesk`-compatible object; `crm.preview`
  renders on the preview pane, not a tab). Check the
  `@hubspot/ui-extensions` `ExtensionLocation` union and the live tooling
  before choosing one the platform does not define.
- `objectTypes`: `COMPANY`, `CONTACT`, `DEALS`, `TICKETS`, custom
  `p_objectName`, etc. Not case-sensitive for standard objects.

## Serverless function config (`*-hsmeta.json`)

```json
{
  "uid": "fetchCepData",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/fetchCepData.js",
    "secretKeys": []
  }
}
```

- `secretKeys` stays `[]` for the standard `PRIVATE_APP_ACCESS_TOKEN`
  case: that token is a HubSpot-reserved keyword, injected automatically
  at runtime (do NOT list it, the build rejects reserved names). Only
  list a key here for a genuinely custom secret your function reads via
  `process.env`.
- Function name (`uid`) must use camelCase and be informative;
  data-fetching functions start with `fetch` (for example `fetchCepData`).

## Function code

- Node 18+; asynchronous, use `async`/`await` and `try`/`catch`.
- Signature: `exports.main = async (context) => {}`. Parameters arrive
  via `context.parameters`.
- The function returns `{ statusCode, body }` (or, equivalently, the
  object the card reads from `result.body`).
- Auth for HubSpot API calls: `process.env.PRIVATE_APP_ACCESS_TOKEN` (the
  app's own Private App token). See the Authentication rule above; no
  other credential is allowed.
- Structure the code into single-purpose helper functions; `main` only
  orchestrates them.
- External API calls and CRM writes belong in the function only, never in
  the card.

```js
exports.main = async (context) => {
  const { parameters } = context;
  try {
    const result = await updateRecord(parameters);
    return { statusCode: 200, body: { success: true, result } };
  } catch (error) {
    return { statusCode: 500, body: { success: false, error: error.message } };
  }
};
```

## Calling the function from the card

- Use `hubspot.serverless(functionUid, { parameters })`, never
  `hubspot.fetch` to hit the function endpoint.
- Read the outcome from the returned `result.body`.

```jsx
const result = await hubspot.serverless('fetchCepData', {
  parameters: { cep: value, objectId: context.crm.objectId },
});
const body = result.body;
```

- `context.crm.objectId` is the current record ID (`number`);
  `context.crm.objectTypeId` is the record type.

## Writing CRM properties from the function

- PATCH the record via the CRM API with
  `Authorization: Bearer ${process.env.PRIVATE_APP_ACCESS_TOKEN}`; map
  external data to the portal's property internal names (validate them
  against the live schema first). The `requiredScopes` in
  `app-hsmeta.json` (for example `crm.objects.companies.write`) declare
  intent, but the actual write is authorized by the app token, which
  must itself carry the write scope.
- See `revops-hubspot` for property lookup and CRM write conventions.

## Refresh the record after a successful write (mandatory)

Every card that updates CRM record properties must refresh the record UI
after the write succeeds, so the user does not reload manually. Call
`actions.refreshObjectProperties()` once the operation succeeds (before
or alongside the success alert). It is typed `() => void` on the CRM
host actions.

```jsx
if (body.success) {
  actions.refreshObjectProperties();
  actions.addAlert({ type: 'success', title: 'OK', message: '...' });
}
```

## Type discipline (never invent prop values)

Before using any component, hook, or action, consult the actual
`@hubspot/ui-extensions` type definitions under
`node_modules/@hubspot/ui-extensions/**/*.d.ts`. Cross-check every
enum/union instead of guessing. Key facts (verify against the installed
version):

- Components: only components exported by `@hubspot/ui-extensions` are
  valid; no raw HTML, `window`, `document`, or `hubspot.fetch`-to-relative
  paths.
- `Input` requires `name` and `label`; events are `onInput(value)` (per
  keystroke), `onChange(value)` (committed on blur/submit),
  `onBlur(value)` / `onFocus(value)`.
- `addAlert` args:
  `{ type?: 'info'|'warning'|'success'|'danger'|'tip', message (required), title? }`.
- `Alert` component uses `title` (required) +
  `variant?: 'info'|'warning'|'success'|'error'|'danger'|'tip'`, not `type`.
- `EmptyState` requires `children` (it is not self-closing) and
  `imageName` must be a value from the closed `EmptyStateImageName` enum
  (for example `deals`, `components`, `building`), arbitrary names fail
  typecheck.
- `TableHeader`/`TableCell` accept `align?: 'left'|'center'|'right'` and
  `width?: 'min'|'max'|'auto'|number`; use `width="min"` to size a column
  to its content.

## Component design (only real props, variants, and values)

Every prop, variant, and value written into a card must exist in the
installed `@hubspot/ui-extensions` `.d.ts` for the current version. There
is no such thing as an approximate or invented prop: if a value is not in
the union or enum, the component does not accept it, and typecheck fails.
This applies to **every** component, hook, and action alike (buttons,
alerts, inputs, tables, empty states, navigation, etc.), not only the
specific facts listed above.

- **Source of truth:** the `.d.ts` under
  `node_modules/@hubspot/ui-extensions/**/*.d.ts`, never memory, never
  another UI library, never a doc snippet for a different version.
- **Check before writing:** for each component, open its definition and
  confirm the exact prop name, the exact enum/union value, and required
  vs optional, before writing the line.
- **Style follows the action (buttons and equivalents):** match the style
  prop (`variant`, `kind`, `type`, or equivalent) to what the action does.
  A normal forward action (save, apply, continue) uses the primary/default
  variant; a non-destructive secondary or cancel uses the neutral variant;
  a destructive or irreversible action (delete, remove, overwrite) uses
  the destructive variant so it reads as dangerous before activation. If
  the platform exposes no destructive variant on that component, pair a
  destructive label with the matching `Alert`/confirmation pattern instead
  of restyling manually.
- **Never guess a payload shape either:** the same rule applies to passed
  objects (alert args, table cells), each key and value must match the
  type definition.

## End-to-end example (CEP)

**card-hsmeta.json** (`uid: my_card`, `location: crm.record.sidebar`,
`objectTypes: ["COMPANY"]`, `entrypoint: /app/cards/MyCard.tsx`) →
**app-function hsmeta** (`uid: fetchData`, `type: app-function`,
`secretKeys: []`) → **MyCard.tsx** calls
`hubspot.serverless('fetchData', { parameters: { cep: value, objectId: context.crm.objectId } })`,
reads `result.body`, and on `body.success` calls
`actions.refreshObjectProperties()` then `actions.addAlert(...)`.

## Output

The completed card and function files, card-hsmeta and app-function
hsmeta, plus the lint/validate result and the build/deploy state after
`project-lifecycle` ships it.

## Restrictions

- Never write to a production account without explicit `--account` and
  user confirmation (`account-safety`).
- Never call external APIs or write CRM data from the card component; do
  both in the serverless function.
- Never authenticate with a PAK, a per-account `HUBSPOT_APP_TOKEN_<id>`,
  or OAuth; the function uses only `process.env.PRIVATE_APP_ACCESS_TOKEN`.
- Never hardcode a `PRIVATE_APP_ACCESS_TOKEN` value into the code; read it
  from `process.env`.
- Never invent component props or action names; always against the
  `.d.ts` files.
- Match each component's style to the action class; a destructive action
  uses the destructive variant. No prop, variant, or value is ever applied
  unless it exists in the installed `.d.ts`.
- Never drive CRM reads from a guessed shape; query the live API with
  `$HUBSPOT_APP_TOKEN_<account_id>` first. That token is read-only: any
  create/update/delete requires stopping, explaining exactly
  what/why/where, and explicit user approval.

## References

- `references/hubspot-cli-reference.md` (CLI commands; pending migration, not yet in this repository)
- `.claude/skills/project-lifecycle/SKILL.md` (create/dev/upload/deploy)
- `.claude/skills/account-safety/SKILL.md` (account gate)
- `.claude/skills/revops-hubspot/SKILL.md` (property lookup, CRM write conventions)
- developers.hubspot.com/docs/apps/developer-platform/add-features/
  ui-extensions/extension-points/app-cards/reference (required card structure)
- developers.hubspot.com/docs/apps/developer-platform/add-features/
  ui-extensions/tools/linting/rules/no-parent-imports (extension point boundary)
- developers.hubspot.com/docs/apps/developer-platform/add-features/
  ui-extensions/tools/code-sharing-with-npm-workspaces (shared code via workspaces)
