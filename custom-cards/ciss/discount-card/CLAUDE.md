# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working on HubSpot components

---

## Project: discount-card

### Purpose
Private HubSpot app (platform `2026.03`) that adds two CRM card tabs to **Deal** records for applying percentage discounts on line items, grouped by **system** (`nome_do_sistema`). Discounts under the threshold (`alcada`) apply immediately; discounts over it are routed for approval. The `alcada` is **per-pipeline**, resolved from a hardcoded `PIPELINE_THRESHOLDS` map (fallback `DEFAULT_THRESHOLD = 10` for unmapped pipelines).

The approval **decision** no longer lives in this app. The approver sets the deal property `proposta_aprovada` and a HubSpot workflow applies or rejects everything pending. See "Approval decision" below.

The approval flow is **shared with `ciss-apps/locacao-equipamentos-card`**, which routes equipment discounts over the same `alcada` into the same `pending_discounts`, the same `dealstage`, the same `proposta_aprovada` and the same workflow. One decision per deal covers both. See "Shared approval with the equipment card" below.

### Architecture
```
src/app/
├── cards/
│   ├── Discount.tsx            # "Desconto" tab — sales rep enters/submits discounts
│   ├── DiscountApproval.tsx    # "Aprovação de Descontos" tab: READ-ONLY view of pending + history
│   ├── discountMath.ts         # Pure math + the rate×hours category config. No React: node imports it directly
│   └── discountResumo.ts       # The `resumo_descontos_aplicados` text. No React, for the same reason
└── functions/
    ├── GroupContracts.js        # Loads + groups line items by system, returns threshold/approver
    ├── ApplyDiscounts.js        # Splits auto-approved vs. pending; writes line items / routes for approval
    └── FetchDiscountApproval.js # Reads pending + history off the deal, checks if user is approver

automation/                      # PRODUCTION CODE THAT LIVES OUTSIDE srcDir. Not deployed by `hs project upload`.
├── desconto-decisao/
│   ├── customCode.js            # Runs in the workflow's custom code action. Pasted into the portal by hand
│   ├── README.md                # The action's contract: secret, inputFields, outputFields, trigger, branches
│   └── verificar.js             # Offline verification of the decision logic: `node automation/desconto-decisao/verificar.js`
└── verificacao/
    └── verificar-valores.js     # Offline verification of the VALUES written, across both write paths, with a
                                 # fake CRM that resolves the calculated properties: `node automation/verificacao/verificar-valores.js`
```

**Read this before concluding the approval flow has no code.** `hsproject.json` has `srcDir: "src"`, so `automation/` never ships with `hs project upload`. HubSpot does not version custom code action code: `customCode.js` is the source of truth in this repo and the action in the portal is a hand-pasted copy. Changed the file, paste it into the action; changed the action, bring it back here in the same PR. A PR that changes approval behavior without touching that file is incomplete.

### Business Logic

**Submit flow (`Discount.tsx` → `groupContracts` + `applyDiscounts`)**
1. **GroupContracts** fetches the deal's line items, drops the ones whose system belongs to another card (`SISTEMAS_EXCLUIDOS`, see "Systems owned by another card" below), sums values per `nome_do_sistema`, and returns the `alcada` threshold for the deal's pipeline (via the `PIPELINE_THRESHOLDS` map), the deal name, and the pipeline's approver. The gross ("Valor Bruto") of each category comes from the **calculated** properties `valor_*_calculado` (= base value × `quantity`, resolved by the CRM per emission type), falling back to `base × quantity` when the calculated prop is blank (legacy items have `quantity = 1`, so the fallback equals the base value). Hours are **never** multiplied by quantity, so the derived rate (`total ÷ horas`) is the effective billed rate per hour. Consultoria's gross comes from `valor_horas_contabeis_calculado` (fallback `valor_horas_consultoria × quantity`). Business rule: a `cispoder` system on a `locacao` contract gets `locacao = glt * 1.4`. Business rule (per item): line items with `classificacao_do_contrato = "C"` (Locação, written by the ciss-lancamento-contratos app) hold their monthly fee in `valor_locacao` — it feeds the Mensalidade (`glt`) bucket instead of the `locacao` bucket, and on apply the Mensalidade discount overwrites `valor_locacao` with the locacao-family satellites (`locacao_descontado` / `valor_locacao_descontado` / `valor_locacao_original`); the Locação rate never touches "C" items (see `FIELDS_LOCACAO_C` in ApplyDiscounts and in the workflow's `customCode.js`, `CLASSIFICACAO_LOCACAO` kept in sync across the three copies).
2. The card renders one accordion per category with editable "new value" inputs and a per-system totalizer. Each system's total discount % is compared against the pipeline's `alcada` to decide if it requires approval.
   The "Totalizador por Sistema" groups each system into four dimensions, each with a `Bruto / Líquido / %` column trio: **Licença** (the `licenca` bucket alone), **Serviços** (treinamento + desenvolvimento/DBA + consultoria), **Mensalidade** (`glt` + `locacao`), and **Projeto** (the sum of the other three — the same set of parcels either way, so `% Proj.` and therefore the approval routing are independent of the grouping). `buildPendingResumo` (`discountResumo.ts`) uses those same four dimensions as the aggregation of `resumo_descontos_aplicados`, but the text it emits mirrors the **approver's pending table**, not this one: see "The pending summary text" below. Every one of these tables lists only the systems that have a value in what it shows, see "A system only shows up in the category where it has a value" below.
3. On "Executar Desconto", **ApplyDiscounts** splits lines into:
   - **Auto-approved** (under threshold): overwrites the value properties, writes `*_descontado` / `*_original` snapshot props, recomputes line `price`, and updates the deal `amount`.
   - **Pending** (over threshold): stores `pending_discounts` (JSON) and `resumo_descontos_aplicados` on the deal, moves the deal to the pipeline's approval `dealstage`, and fires the approval webhook to the pipeline approver.

**Approval flow (`DiscountApproval.tsx` → `fetchDiscountApproval`, then the workflow)**
4. **FetchDiscountApproval** reads `pending_discounts` / `discounts_history` off the deal, enriches labels, and returns whether the current user is an approver for the deal's pipeline. The card renders both tables **read-only**: no buttons, no editable inputs. Its `% Total` column shows `pending_discounts.percentualDesconto` as produced by `Discount.tsx` (all six categories), the same number the workflow writes to history, so the card never recomputes it.
   The systems table carries the three flat categories plus **Serviços**, which is the sum of the three rate×hours categories; the per category breakdown (rate, hours, gross, net, %) is the "Detalhe de serviços (horas)" accordion below it. Splitting it that way is not cosmetic: the table used to hold four treinamento columns and none for desenvolvimento/DBA or consultoria, so a discount on either of those was invisible to the approver, and putting all three in columns would take the table past twenty. `totaisRateHours` there mirrors `rateHoursBruto` / `rateHoursLiquido` from `discountMath.ts`, including the `valor/h = 0` case, using the `totalBruto` now stored on each rate×hours category (fallback `valor/h × horas` for entries written before it existed).
5. The approver sets the deal property `proposta_aprovada` (`sim` / `nao`), plus `observacoes` for a rejection reason, and the workflow **Desconto - Decisão do aprovador** does the rest. See "Approval decision" below.

### Approval decision (workflow, not this app)
The decision is **all or nothing per deal**: one property call decides every system in `pending_discounts` at once, and the approver can no longer edit values at approval time. Code: `automation/desconto-decisao/customCode.js`, contract: the `README.md` beside it.

- **Trigger:** `proposta_aprovada` is known, with re-enrollment on. The code clears `proposta_aprovada` and `observacoes` on every non-error path, `ignorado` included, which is what allows a second discount cycle on the same deal: re-enrollment needs the property to go empty again, and a deal left holding `Sim` never stops meeting the criteria, so it never re-enrolls. Only the `erro` path leaves it filled, deliberately, and there the re-arm is manual.
- **Authorization stays server-side.** A workflow has no current user, so the code identifies the decider from `propertiesWithHistory=proposta_aprovada`, taking the most recent entry **with a non-empty value** and its `updatedByUserId`, resolves that id to an email via `GET /crm/v3/owners/{userId}?idProperty=userId`, and checks it against the same approver list the card used. `updatedByUserId` is absent on API/integration edits, so only a human editing in the CRM UI can approve. That is by design.
- **Idempotency:** empty `pending_discounts` exits as `ignorado`, and every discount is computed against the immutable `*_original` snapshot, so a retry or a re-enrollment cannot compound a discount.
- **`dealstage` is never touched by the code.** Moving a rejected deal back to Proposta is a native workflow action, branched per pipeline. Entering approval on submit is still `ApplyDiscounts.APPROVAL_STAGES`.
- **Errors do not throw.** A thrown exception, a 429 or a 5XX would make HubSpot retry the action for up to three days, so every path calls `callback` with all eight `outputFields` and failures come back as `status: "erro"` for the workflow's error branch to open a task.
- Rejecting **without** a reason is allowed, by process decision. The history entry records an empty `motivo`.

### Shared approval with the equipment card
`pending_discounts`, `resumo_descontos_aplicados`, `dealstage`, `proposta_aprovada`, `observacoes` and `discounts_history` have **two writers**: this app and `ciss-apps/locacao-equipamentos-card`.
They are deal properties, and a deal can carry software and equipment discounts at once, so neither app may overwrite the other's content.

**Entries are discriminated by `tipo`.**
A system entry has no `tipo` (the legacy shape, unchanged).
An equipment entry has `tipo: "equipamentos"` and there is exactly **one per deal**, aggregating the whole equipment set, because the approval is of the set: `label`, `percentualDesconto`, `brutoTotal`, `liquidoTotal` at the top, and the per line item targets in `itens`.
Each element of `itens` is `{ lineItemId, label, percentualDesconto, quantidade, treinamento: { unitarioOriginal, unitarioNovo }, locacao: { unitarioOriginal, unitarioNovo } }`.

**Aggregating for the decision, keeping the items for the write, is not a style choice.**
The approval is of the set, so one entry means one row in the approver's tab and, more importantly, **one row in `discounts_history`** instead of one per equipment. `main` builds history with `pending.map`, so the aggregation falls out of the entry shape with no change to that code, and an equipment decision now records exactly like a system's.
But the write stays per line item, so `itens` cannot be dropped: reconstructing per item targets from an aggregate total would need an allocation nobody typed. Applying `buildAllocation` here would silently change the values the rep entered, which is the very bug that block exists to prevent on the system side.
`brutoTotal` and `liquidoTotal` are derivable by summing `itens` and are stored anyway, following the rule that the approval card never recomputes what came from `pending_discounts`.

**`label` carries the portal's option label**, resolved by `fetchLocacaoLineItems.js` from `GET /crm/v3/properties/line_items/nome_do_sistema` (today `"Equipamentos - 67"`), the same lookup `GroupContracts.js` does for systems. An empty `label` still renders correctly, because `enrichLabels` in `FetchDiscountApproval.js` resolves `nomeDoSistema` on read for pending and history alike. The **value** `"67"` stays hardcoded everywhere as the filter key: matching on the label would break the day ops renames the option.

**The equipment row does not go in the systems table**, even though it now has the same granularity. Two of that table's columns would lie: `Trein. R$/h` would show a total instead of a rate, and `Trein. Horas` would show an equipment count, because `horas_treinamento` on an equipment item holds quantity, not hours. It gets a four column table of its own, with the per equipment breakdown in an accordion below. The breakdown is not optional: a set at 12% can hide one equipment at 90%, and approving the set approves that item too.

**Both writers do read-modify-write.**
`ApplyDiscounts` reads the deal in `fetchDealStateForPending`, keeps every entry whose `tipo` is `"equipamentos"`, and appends its own systems in front.
`aplicarDesconto.js` on the other side keeps every entry whose `tipo` is not `"equipamentos"`.
Skipping the read would silently drop the other card's pending discount, and the approver would decide on half the negotiation without knowing the other half existed.

### The pending summary text
`resumo_descontos_aplicados` is what the approver reads before deciding, so it mirrors the **pending discounts tables**, both of them: the systems one here and the equipment one in the other card. Per system it emits `% Total`, then the four dimensions, with `Mensalidade` broken into `glt` and `locacao` when both have a value, and `Serviços` broken into the three rate×hours categories, each with its **hour count** (`20h → 30h` when the scope changed), its rate and its total. A dimension with no value emits no line, the same rule the tables follow.
Before August 2026 it emitted only the four aggregated rows: no hours, no per category detail, no `% Total`, so a 50% discount on consultoria alone reached the approver hidden inside a `Serviços` line at 16%.
Every number comes from `discountMath.ts`, never from a local calculation, and the module has no React import precisely so `automation/verificacao/verificar-valores.js` can assert the emitted text (section "Resumo pendente").

**`resumo_descontos_aplicados` is one text field with two owners.**
The equipment card owns everything from `=== EQUIPAMENTOS ===` to the **end of the text**; this app owns what comes before it.
There is no closing marker: both write paths put the equipment block last (the join in this app's PATCH, `mesclarResumo` in the other), so the suffix is the block. A closing marker would show up mid text for the rep without delimiting anything the opening one does not. Resumos written before August 2026 still carry `=== FIM EQUIPAMENTOS ===`, and both sides strip it on the next write.
`extrairBlocoEquipamentos` preserves that block on every pending write.
The opening marker is a string literal in both apps and has to match exactly.

**The workflow branches on the same discriminator.**
`applyAllPendingSystems` splits `pending` into `sistemas` and `equipamentos` before the loop.
An equipment entry that leaks into the system loop does **not** throw: it has no `categorias`, so `buildTargets` and `buildRateHoursMap` both return `{}`, no line item gets a plan, and the equipment is left with no discount at all, in silence.
The nested loop has the same property: iterating the entry instead of its `itens` writes nothing and reports success.
That is the failure mode the "Equipamentos" section of `automation/desconto-decisao/verificar.js` exists to catch, and it was confirmed by mutation.

**Equipment updates carry an absolute target, so there is no allocation.**
Each element of `itens` is one line item, the payload already holds the unit values, and the seven properties written are byte-for-byte the ones `locacao-equipamentos-card/src/app/functions/aplicarDesconto.js` writes on the under-the-alcada path.
A discount under the `alcada` goes through that file, one over it goes through `buildEquipamentoProperties` in `customCode.js`, and the two must write the same value.
Change one, change the other.
Idempotency is free here: writing an absolute value twice writes the same value, so a workflow retry or a re-enrollment cannot compound anything.

**A line item that left the deal between submit and decision is dropped, by name, with a warning.**
An id that is no longer associated returns 400 on `batch/update` and takes the whole call down with it, including every system in the same batch.

**No line item is ever written by both paths.**
Equipment is `nome_do_sistema = "67"`, which is in this app's `SISTEMAS_EXCLUIDOS`, so this app never reads and never writes those items.
That is what makes the shared property safe despite `valor_locacao_descontado` meaning different things on the two sides: this app stores the **discount amount** there, the equipment card stores the **net unit value**.
The conflict is real for anyone reading the property in a report, and it is **not** fixed.
It is confined to reads because the write paths are disjoint.

**Three things the equipment path deliberately does not do**, all pre-existing behavior kept unchanged when approval was added:
it never writes `price`, it never recomputes the deal `amount` (an automation outside the card maintains it), and it writes `quantidade × unit` into `valor_locacao` and `valor_treinamento`, which are base properties the CRM remultiplies by `quantity`.
The last one is only harmless while equipment line items keep `quantity = 1`.
The `amount` PATCH in step 7 of the workflow still runs on an approved deal and computes `Sigma price x quantity`, using the equipment items' stored `price`: whichever of that PATCH and the external automation writes last, wins.

### Categories & discount math
Two kinds of category, all grouped per system:
- **Flat value** — `glt` (Mensalidade), `locacao`, `licenca`: discount % = `(original - novo) / original`.
- **Rate × hours** — `treinamento`, `desenvolvimento`/DBA, `consultoria`: discount derived from unit-rate reduction and/or hours change against a "total bruto".

Discount rates are stored as **percentages** (`19` means 19%), rounded to 4 decimals. Writing the raw fraction made a 10% discount render as "0,1%" on the Percentage-typed property — effectively zero.

**Immutable gross (`bruto_original`):** the `*_original` snapshot is the reference every discount derives from, and it is both written *and read back*. GroupContracts resolves each category's gross as `snapshot × quantity` when the snapshot exists, falling back to the current gross on the first application; in ApplyDiscounts and in the workflow's `customCode.js` the snapshot is the **weight of the allocation** and the base of the recorded percentage, never the current (already discounted) value. Without this the base drifts: a second discount would be a ratio against the previous net, so the recorded `%` and `valor_*_descontado` would describe only the last step instead of the accumulated discount. The card therefore always shows the original gross in "Valor Bruto" and pre-fills the net input with the current value, so reopening it after a discount shows the discount in force. For the rate×hours categories the immutable reference is the **rate per hour**, not the total — changing the hour count rebases the snapshot to `valor/h original × new hours` (it never receives a net value), keeping the percentage purely rate-driven.

**The snapshot write is gated by the portal schema, not by the response shape.** Both write paths fetch `GET /crm/v3/properties/line_items` once per run and write `valor_*_original` for a rate×hours category only when the property exists there (`propsGravaveis` in `buildAllocation`). The old gate was `snapshotProp in item.properties`, which tests for a **value**: the v3 API returns a requested-but-empty property as `null` on some responses and omits it on others, and on the omitting shape the snapshot was never created at all. Without the snapshot the next `GroupContracts` read falls back to the current gross, so "Total Bruto" lands on the already discounted value, equal to "Total Líquido", and no percentage can be derived. That is the Consultoria report from August 2026, reproduced in `automation/verificacao/verificar-valores.js` (section "Consultoria"). The gate stays because a property missing from the schema would make the whole `batch/update` fail with 400; that case is logged by name (`avisarSnapshotsAusentes`) and only creating the property in the portal fixes it.

**The card mirrors that rebase in its preview.** Every rate×hours surface in `Discount.tsx` takes its gross from `rateHoursBruto` and its net from `rateHoursLiquido` (`src/app/cards/discountMath.ts`), so both sit on the **effective** hour count (`hours.new ?? hours.current`) and the pair on screen is exactly the pair the apply will write. This is what keeps "Total Bruto", "Serv. Líquido", "Proj. Líquido", `resumo_descontos_aplicados` and `pending_discounts.percentualDesconto` agreeing with each other and with the CRM after apply. Do not "fix" a drifting percentage by freezing the net at the old hour count: that was the July 2026 bug, where the totalizer showed R$ 26.070,00 for a state the CRM never held. The business rule "changing hours is never a discount" is preserved structurally instead, because gross and net share the same hour base `H` and `H` cancels out of the ratio. Rate×hours categories with a value but zero hours have no derivable rate (`GroupContracts` returns `valor/h = 0`), so both helpers fall back to the stored gross and the percentage comes out null rather than a phantom 100%.

**Zeroing the hours zeroes both columns.** Setting Qtd Horas to 0 makes the apply write `valor_* = 0` and `horas_* = 0` on every item of the category (the consolidation accumulator with `hoursTarget = 0`), so the category is worth nothing after apply and both "Serv. Bruto" and "Serv. Líquido" have to read 0 in the totalizer, not just the category tab. Operations reported the opposite in August 2026: the tab showed R$ 0,00 while the totalizer held R$ 440,00, because the pre-`discountMath.ts` `calcServicosTotal` took its gross straight from `treinamentoTotalBruto` and its net from `hours.original`, both on the hour count the CRM was about to stop holding. The test that settles it is comparing the pair on screen before apply against the pair `GroupContracts` reads back after apply. The reverse case must keep showing the value: a category that arrives from the CRM with a value and no hours has no derivable rate, nothing was edited, so the apply writes nothing and the deal still bills it.

**A system only shows up in the category where it has a value, and visibility is decided by the CRM, not by the edit.**
`GroupContracts` creates a system's bucket with all 24 keys at zero on its first line item and never prunes an empty category, so the pruning is the card's: `hasFlatValue` / `hasRateHoursValue` / `hasAnyValue` in `discountMath.ts` gate the five category tables and the totalizer.
A category where no system has a value renders a microcopy in place of its table (the accordion stays, so the accordion set does not vary per deal), and a system with no value in any of the six categories has no row at all, not even in the totalizer.
Before this, Datacenter took a row in the Licença table with an empty Valor Bruto and an editable input that the write path would ignore (`original > 0` in ApplyDiscounts), reported by operations in August 2026.
The three predicates read **only** what came from the serverless function (`original`, `current`, `totalBruto`), never the effective value and never `rateHoursBruto` / `rateHoursLiquido`.
That is load-bearing, not stylistic: `setNewValue` only touches `new`, so a predicate over the CRM fields keeps the visible set fixed while the rep types, whereas one over the effective pair would make a rate×hours row vanish the instant Qtd Horas is set to 0 (gross and net both go to zero, see the paragraph above), carrying the edit off the screen but not out of the state, submitted with nobody able to see or undo it.
Zeroing the hours is a supported action, so that row has to stay.
The `|| current > 0` arm covers an item whose `*_original` snapshot is stored as zero while the live value is positive: the deal bills it, so it must be discountable.
`automation/verificacao/verificar-valores.js` has the section that pins all of this, including an assertion that the effective pair goes to zero exactly where the predicate does not.

**Systems owned by another card are not read at all.**
`SISTEMAS_EXCLUIDOS` in `GroupContracts.js` holds the `nome_do_sistema` values whose discount is applied by a different app, today only Equipamentos (`"67"`, owned by `ciss-apps/locacao-equipamentos-card`, same value in its `fetchLocacaoLineItems.js` filter).
The filter is **per item** and runs on `lineItems` before `groupBySistema`, not on the grouped result: a system can have items on both sides of the line, and the card only ever sees data already collapsed per system.
It also runs before `findMissingTipoContrato`, so an excluded item with an empty `tipo_de_contrato` neither shows up in the alert nor disables "Executar Desconto": the field it is missing cannot be reached from this card, so blocking on it would be a dead end.
The write path needs no mirror of this filter (`ApplyDiscounts.js` keys its map off the systems the card submitted, so an item never read is never written), and a stale `discount_draft` entry for an excluded system is ignored by `overlayDraft`.
The response carries `excluidos` (how many items the filter removed) for one reason: with it the card can say "nada a descontar neste card" for a deal made entirely of Equipamentos, instead of "este deal não possui itens de linha associados", which would be false and send the rep looking for a problem that does not exist.
`verificar-valores.js` pins the three cases: the excluded system absent from the grouping, the excluded item absent from the `tipo_de_contrato` block, and the all-excluded deal returning no system with `excluidos > 0`.

**Base vs. calculated scale:** the card displays and edits values in the **calculated** scale (base × quantity), but ApplyDiscounts and the workflow's `customCode.js` always write to the **base** (unit) properties, dividing by the item's `quantity` so the CRM-calculated property lands back on the card's scale. The deal `amount` is recomputed as `Σ price × quantity` (price is unitary since the emission multiplier moved to `quantity` in ciss-lancamento-contratos).

**The typed net is the authority, not the rate. Never re-derive the write from a ratio.**
The value the sales rep typed is distributed across the line items of the category as **whole cents**, proportional to each item's immutable gross, largest remainder taking the leftover cents, and the base property receives `item target ÷ quantity` with `DECIMAIS_VALOR = 6` decimal places.
That is the `buildAllocation` block, byte-identical in `ApplyDiscounts.js` and in `customCode.js`.
It exists because applying the discount **as a ratio** to each item's base and rounding that base to 2 decimals had every item's half-cent error multiplied by its own `quantity` when the CRM recomposed `valor_*_calculado = base × quantity`: R$ 1.400,00 typed came back as R$ 1.399,99 in the totalizer and R$ 13.500,00 as R$ 13.500,03, reported by operations in August 2026.
The drift is `Σ ε_i × quantity_i`, ceiling `0,005 × Σ quantity`, so it grew with the deal instead of staying in cents, and it hit all six categories, both write paths and the deal `amount`.
Two parts, both load-bearing: the allocation alone does not fix even the multi-item case, because `item target ÷ quantity` (R$ 272,222 for a target of R$ 1.361,11 over `quantity` 5) still does not fit in 2 decimals; the 6 decimals alone would leave the per-item errors to accumulate.
Extra decimals only ever reach the CRM when `quantity > 1` forces them: at `quantity = 1` the base **is** the calculated value and the allocated cents already fit in 2 places.
`automation/verificacao/verificar-valores.js` is the canary. Lowering `DECIMAIS_VALOR` to 2 makes it fail with the exact deviations operations reported.

**The discount % is per item, against that item's own snapshot.** Two items of the same system can differ, and on small bases the difference is bigger than a rounding hair: an item whose gross is R$ 50,00 and net R$ 33,33 records `33.34`, while the system as a whole took 33,3333%. One cent over a R$ 50,00 base is worth 0,02 percentage point. That is the property being truthful about the item it lives on (`snapshot × (1 − pct/100)` reproduces the stored value to the cent), and it is the price of the values being exact. The number the approval flow and the alçada reason about is the card's, computed from values, never read back from these props.

**Coupling with `ciss-lancamento-contratos`:** re-launching a SKU that already exists on the deal overwrites its base values with catalog values, which invalidates any discount on it. That app therefore clears the `*_original` snapshots and `*_descontado` satellites of the categories it rewrites (Mensalidade, Licença, Locação, Treinamento) — see `DISCOUNT_STATE_TO_RESET` in its `createContract.js`. Desenvolvimento/DBA and Consultoria are never rewritten there, so their discounts survive a re-launch untouched.

### CRM Properties
| Object     | Property                          | Description                                          |
|------------|-----------------------------------|------------------------------------------------------|
| line_items | `nome_do_sistema`                 | Enum – grouping key / system (read)                  |
| line_items | `tipo_de_contrato`                | Enum – contract type, used for the cispoder rule (read) |
| line_items | `classificacao_do_contrato`       | Enum – contract classification; `"C"` = Locação → Mensalidade reads/discounts `valor_locacao` (read) |
| line_items | `quantity`                        | Emission multiplier / nº of accesses; multiplies base values into the calculated props and the deal `amount` (read) |
| line_items | `valor_mensalidade_calculado` / `valor_locacao_calculado` / `valor_licenca_calculado` / `valor_treinamento_calculado` / `valor_horas_desenvolvimento_calculado` / `valor_horas_contabeis_calculado` | CRM-calculated gross (base × quantity per emission type) — source of the card's "Valor Bruto" (read) |
| line_items | `valor_glt` / `valor_locacao` / `valor_licenca` | Flat category BASE (unit) values (read + overwritten on apply — the calculated props update automatically) |
| line_items | `valor_mensalidade_original` / `valor_locacao_original` / `valor_licenca_original` | Immutable gross snapshot — written once, then **read back** as the base of every discount |
| line_items | `glt_descontado` / `locacao_descontado` / `licenca_descontado` | Accumulated discount % against **that item's** snapshot, in percentage scale (`19` = 19%) (written) |
| line_items | `valor_glt_descontado` / `valor_locacao_descontado` / `valor_licenca_descontado` | Discount amount (written) |
| line_items | `horas_treinamento` / `valor_treinamento` / `valor_treinamento_original` | Treinamento rate×hours: hours + BASE value (read + overwritten on apply) + immutable snapshot (rebased when hours change) |
| line_items | `horas_desenvolvimento` / `valor_horas_desenvolvimento` / `valor_horas_desenvolvimento_original` | Desenvolvimento/DBA rate×hours (same model as treinamento) |
| line_items | `horas_consultoria` / `valor_horas_consultoria` / `valor_horas_consultoria_original` | Consultoria rate×hours (same model as treinamento). The snapshot does not show up in the CISS portal's property list, while the other five do, and the category lost its gross on every apply until August 2026. A rate×hours category whose snapshot property is absent from the writable schema cannot hold a gross, and no code change substitutes for the property existing |
| line_items | `price`                           | Line total, recomputed after discount (written)      |
| deals      | `pipeline` / `dealname` / `amount` | Read; `pipeline` selects the per-pipeline `alcada` from the hardcoded `PIPELINE_THRESHOLDS` map; `amount` rewritten after applying discounts |
| deals      | `pending_discounts`               | JSON of systems awaiting approval, **plus** the equipment card's `tipo: "equipamentos"` entries (read + merged on write) |
| deals      | `discounts_history`               | JSON of approve/reject decisions, systems and equipment alike (read + written) |
| deals      | `resumo_descontos_aplicados`      | Human-readable pending summary text. The `=== EQUIPAMENTOS ===` block belongs to the equipment card and is preserved on write |
| deals      | `proposta_aprovada`               | Enum, two values, **no default**. Internal values in the portal are `Sim` / `Não`; `normalizarDecisao` in the workflow strips case and accents before comparing, and any other value ends as `erro`, never as a rejection. The approver's decision, and the workflow's trigger. Read by the workflow with `propertiesWithHistory` to identify who decided; cleared in its final PATCH so a second cycle can trigger |
| deals      | `observacoes`                     | Multi-line text. Rejection reason, read by the workflow and cleared in the same PATCH. Do not reuse this property for anything else: it is wiped on every decision |
| deals      | `change_deal_stage_discount`      | Single checkbox, `true` approved / `false` rejected, written in the decision workflow's final PATCH and **never cleared**. The stage workflow branches on it, because `proposta_aprovada` and `observacoes` are already empty by the time that branch runs. Must exist in the portal before the code ships: an unknown property name 400s the whole PATCH |
| deals      | `dealstage`                       | Moved to approval stage on submit by ApplyDiscounts; moved back to proposal on reject by a **native workflow action**, never by code |
| contacts   | `aprovador_de_desconto` / `aprovador_pipelines` | Marks approvers and which pipelines they cover (read by the card and by the workflow) |

### Approval routing (hardcoded, portal-specific)
- Approver lookup: `contacts/search` for `aprovador_de_desconto = true`, then match `aprovador_pipelines` (comma-separated) against the deal's pipeline; resolve the contact's email to an owner.
- `GroupContracts.PIPELINE_THRESHOLDS` / `FetchDiscountApproval.PIPELINE_THRESHOLDS` map pipeline ID → discount `alcada` % (fallback `DEFAULT_THRESHOLD = 10`). Keep the two copies in sync.
- `ApplyDiscounts.APPROVAL_STAGES` maps pipeline ID → approval dealstage (entering approval on submit).
- Destination dealstages are **not in code**: `dealstage` is moved by a separate stage workflow, and the decision code never writes it (pinned by an assertion in `verificar.js`). That workflow has **no enrolment trigger**: this one enrols it from its last step with "enrol in another workflow", and it branches on `change_deal_stage_discount`, the durable decision flag, never on `proposta_aprovada`, which is empty by then. Approve and reject go to different stages, approve to "aprovação aprovada" and reject back to proposal; a stage id belongs to exactly one pipeline, so each direction needs six ids. Table and the full rationale, including why the old property-triggered workflow only fired when the approver typed a reason, are in `automation/desconto-decisao/README.md`.
- Approval webhook: `https://api.hubapi.com/automation/v4/webhook-triggers/50818082/nTnNdNW`.

### HubSpot API Calls (serverless functions)
| Function              | Method | Endpoint                                                    |
|-----------------------|--------|-------------------------------------------------------------|
| GroupContracts        | GET    | `/crm/v3/objects/deals/{dealId}` (pipeline, dealname)       |
| GroupContracts        | GET    | `/crm/v3/objects/deals/{dealId}/associations/line_items`    |
| GroupContracts        | GET    | `/crm/v3/properties/line_items/nome_do_sistema`             |
| GroupContracts        | GET    | `/crm/v3/owners`                                            |
| GroupContracts        | POST   | `/crm/v3/objects/contacts/search`                           |
| GroupContracts        | POST   | `/crm/v3/objects/line_items/batch/read`                     |
| ApplyDiscounts        | GET    | `/crm/v3/objects/deals/{dealId}` (pipeline, pending, resumo) |
| ApplyDiscounts        | GET    | `/crm/v3/objects/deals/{dealId}/associations/line_items`    |
| ApplyDiscounts        | GET    | `/crm/v3/properties/line_items` (schema gate for snapshots) |
| ApplyDiscounts        | GET    | `/crm/v3/owners`                                            |
| ApplyDiscounts        | POST   | `/crm/v3/objects/contacts/search`                           |
| ApplyDiscounts        | POST   | `/crm/v3/objects/line_items/batch/read`                     |
| ApplyDiscounts        | POST   | `/crm/v3/objects/line_items/batch/update`                   |
| ApplyDiscounts        | PATCH  | `/crm/v3/objects/deals/{dealId}` (pending/stage/amount)     |
| ApplyDiscounts        | POST   | `/automation/v4/webhook-triggers/...` (approval webhook)    |
| FetchDiscountApproval | GET    | `/crm/v3/objects/deals/{dealId}` (pending/history, pipeline)|
| FetchDiscountApproval | GET    | `/crm/v3/properties/line_items/nome_do_sistema`             |
| FetchDiscountApproval | POST   | `/crm/v3/objects/contacts/search`                           |

Note: `batch/read` and `batch/update` are chunked to the HubSpot 100-input limit; line-item association reads are paginated.

The approval decision is **not** a serverless function of this app. It runs in the workflow's custom code action (`automation/desconto-decisao/customCode.js`), authenticated by its own `DISCOUNT_APP_TOKEN` secret, not by `PRIVATE_APP_ACCESS_TOKEN`:

| Step | Method | Endpoint                                                                             |
|------|--------|--------------------------------------------------------------------------------------|
| 1    | GET    | `/crm/v3/objects/deals/{dealId}` (pipeline, pending/history + `propertiesWithHistory=proposta_aprovada`) |
| 2    | GET    | `/crm/v3/owners/{userId}?idProperty=userId` (decider's id to email)                  |
| 3    | POST   | `/crm/v3/objects/contacts/search` (approver list)                                    |
| 4    | GET    | `/crm/v3/objects/deals/{dealId}/associations/line_items`                              |
| 5    | POST   | `/crm/v3/objects/line_items/batch/read`                                              |
| 6    | POST   | `/crm/v3/objects/line_items/batch/update` (one batch for all pending systems)         |
| 7    | PATCH  | `/crm/v3/objects/deals/{dealId}` (pending/history/amount + clears resumo, `proposta_aprovada`, `observacoes`) |

Seven sequential round trips at worst, against the action's 20 s ceiling. Both the single GET in step 1 and the single PATCH in step 7 are deliberate: two PATCHes would leave a window where `amount` is already discounted while `pending_discounts` is still full.

### Environment Variables
- `PRIVATE_APP_ACCESS_TOKEN`: required by all three serverless functions for every HubSpot API call.
- `DISCOUNT_APP_TOKEN`: **not** an app secret. It is registered on the workflow's custom code action in the portal, and it is the only credential the approval decision uses. Same scopes as this app. Never commit its value.

### Required scopes (app-hsmeta.json)
`oauth`, deals read/write, line_items read/write, contacts read, contacts schema read, owners read.

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
