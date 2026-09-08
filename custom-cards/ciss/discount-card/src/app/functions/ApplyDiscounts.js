const axios = require("axios");

// Os endpoints batch/read e batch/update aceitam no máximo 100 inputs por chamada.
const BATCH_LIMIT = 100;

const chunk = (items, size) => {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

const fetchApproverForPipeline = async (pipelineId, hubspotClient) => {
  const { data } = await hubspotClient.post("/crm/v3/objects/contacts/search", {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "aprovador_de_desconto",
            operator: "EQ",
            value: "true",
          },
        ],
      },
    ],
    properties: ["email", "aprovador_pipelines", "firstname", "lastname"],
    limit: 100,
  });

  const contact = (data.results || []).find((c) => {
    const pipelines = (c.properties.aprovador_pipelines || "")
      .split(",")
      .map((s) => s.trim());
    return pipelines.includes(String(pipelineId));
  });

  if (!contact) return null;

  const ownerRes = await hubspotClient.get("/crm/v3/owners", {
    params: { email: contact.properties.email },
  });
  const owner = (ownerRes.data.results || [])[0];
  if (!owner) return null;

  return {
    ownerId: String(owner.id),
    email: contact.properties.email,
    name: [contact.properties.firstname, contact.properties.lastname]
      .filter(Boolean)
      .join(" "),
    contactId: contact.id,
  };
};

const triggerApprovalWebhook = async (approver, dealName) => {
  const webhookUrl =
    "https://api.hubapi.com/automation/v4/webhook-triggers/50818082/nTnNdNW";
  await axios.post(webhookUrl, {
    record_id: approver.contactId,
    email: approver.email,
    deal_name: dealName,
  });
  console.log(
    `[applyDiscounts] webhook disparado para ${approver.email} (contato: ${approver.contactId}) | deal: ${dealName}`,
  );
};

const APPROVAL_STAGES = {
  872876959: "1347751842", // Franquia - SMB
  873229378: "1347750931", // Franquia - Enterprise
  872876956: "1347751841", // PDV e Geral - SMB
  872876957: "1347655299", // PDV e Geral - Enterprise
  907963396: "1385332128", // Expansão - Franquia
  911415619: "1385331244", // Expansão - PDV e Geral
};

// ---------------------------------------------------------------------------
// Convivência com ciss-apps/locacao-equipamentos-card na MESMA deal.
// `pending_discounts` e `resumo_descontos_aplicados` têm dois donos: este app
// escreve os sistemas, o locacao card escreve os equipamentos. Cada um preserva
// o que é do outro. As constantes existem em quatro arquivos: aqui, em
// automation/desconto-decisao/customCode.js e nos dois app-functions do locacao
// card. Mudou uma, mude as quatro.
// ---------------------------------------------------------------------------
const TIPO_EQUIPAMENTOS = "equipamentos";
const RESUMO_INICIO = "=== EQUIPAMENTOS ===";
// Marcador de fim das versões anteriores. Não é mais escrito, e só continua
// aqui para ser limpo de um resumo gravado antes desta versão.
const RESUMO_FIM_LEGADO = "=== FIM EQUIPAMENTOS ===";

const safeParsePending = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[applyDiscounts] pending_discounts inválido:", err.message);
    return [];
  }
};

// Devolve o bloco de equipamentos do resumo, com o marcador de abertura, ou "".
//
// O bloco vai até o FIM DO TEXTO, e não até um marcador de fechamento: os dois
// caminhos de escrita põem os equipamentos por último (aqui, no join do PATCH;
// no outro card, em `mesclarResumo`), então o sufixo é o bloco. Um marcador de
// fechamento só apareceria para o vendedor no meio do texto sem delimitar nada
// que o de abertura já não delimite.
const extrairBlocoEquipamentos = (texto) => {
  const t = String(texto || "");
  const inicio = t.indexOf(RESUMO_INICIO);
  if (inicio === -1) return "";
  return t
    .slice(inicio)
    .split(RESUMO_FIM_LEGADO)
    .join("")
    .trimEnd();
};

// Categorias hora×valor. O CRM não tem prop de valor/h nem de descontado: o
// valor/h é derivado (valor total ÷ horas) e a prop de valor total é sobrescrita
// no lugar, como nos campos flat.
const RATE_HOURS_FIELDS = [
  {
    fieldName: "desenvolvimento",
    hoursProp: "horas_desenvolvimento",
    valueProp: "valor_horas_desenvolvimento",
    snapshotProp: "valor_horas_desenvolvimento_original",
  },
  {
    fieldName: "consultoria",
    hoursProp: "horas_consultoria",
    valueProp: "valor_horas_consultoria",
    snapshotProp: "valor_horas_consultoria_original",
  },
  {
    fieldName: "treinamento",
    hoursProp: "horas_treinamento",
    valueProp: "valor_treinamento",
    snapshotProp: "valor_treinamento_original",
  },
];

const FIELDS = [
  {
    fieldName: "glt",
    originalValueProp: "valor_glt",
    discountPercentProp: "glt_descontado",
    discountAmountProp: "valor_glt_descontado",
    originalSnapshotProp: "valor_mensalidade_original",
  },
  {
    fieldName: "locacao",
    originalValueProp: "valor_locacao",
    discountPercentProp: "locacao_descontado",
    discountAmountProp: "valor_locacao_descontado",
    originalSnapshotProp: "valor_locacao_original",
  },
  {
    fieldName: "licenca",
    originalValueProp: "valor_licenca",
    discountPercentProp: "licenca_descontado",
    discountAmountProp: "valor_licenca_descontado",
    originalSnapshotProp: "valor_licenca_original",
  },
];

// Em item Locação(C) a mensalidade mora em valor_locacao, por isso
// FIELDS_LOCACAO_C não tem entrada "locacao": a taxa de Locação nunca o atinge.
// Regra no CLAUDE.md. Cópias em GroupContracts.js e em
// automation/desconto-decisao/customCode.js.
const CLASSIFICACAO_LOCACAO = "C";

const FIELDS_LOCACAO_C = [
  {
    fieldName: "glt",
    originalValueProp: "valor_locacao",
    discountPercentProp: "locacao_descontado",
    discountAmountProp: "valor_locacao_descontado",
    originalSnapshotProp: "valor_locacao_original",
  },
  // valor_glt vira pass-through: soma no price, nunca recebe desconto
  // (fieldName inexistente no discountMap cai no caminho "sem desconto").
  {
    fieldName: "glt_passthrough",
    originalValueProp: "valor_glt",
    discountPercentProp: "glt_descontado",
    discountAmountProp: "valor_glt_descontado",
    originalSnapshotProp: "valor_mensalidade_original",
  },
  {
    fieldName: "licenca",
    originalValueProp: "valor_licenca",
    discountPercentProp: "licenca_descontado",
    discountAmountProp: "valor_licenca_descontado",
    originalSnapshotProp: "valor_licenca_original",
  },
];

const resolveFieldsForItem = (item) =>
  item.properties.classificacao_do_contrato === CLASSIFICACAO_LOCACAO
    ? FIELDS_LOCACAO_C
    : FIELDS;

// ---------------------------------------------------------------------------
// Alocação do valor digitado. BLOCO IDÊNTICO em
// src/app/functions/ApplyDiscounts.js e em
// automation/desconto-decisao/customCode.js: um deal abaixo da alçada passa por
// um, um deal aprovado passa pelo outro, e os dois têm que gravar o mesmo valor.
// Altere os dois juntos.
//
// Por que o desconto não é gravado como razão, e por que a base precisa de mais
// de 2 decimais: automation/verificacao/README.md.
// ---------------------------------------------------------------------------
const DECIMAIS_VALOR = 6;

const fmtValor = (n) => String(parseFloat(n.toFixed(DECIMAIS_VALOR)));
const emCentavos = (n) => Math.round(n * 100);
// O amount do deal fecha em centavo inteiro: todo alvo já é centavo inteiro.
const fmtMoeda = (n) => (emCentavos(n) / 100).toFixed(2);

// Maior resto leva os centavos sobrantes, então a soma do retorno é exatamente
// `alvoCent`. Devolve null quando não há peso onde alocar: categoria sem base em
// item nenhum, como o bucket `locacao` sintético da regra cispoder (`glt × 1.4`).
const alocarCentavos = (pesos, alvoCent) => {
  const total = pesos.reduce((acc, p) => acc + p, 0);
  if (!(total > 0)) return null;

  const exatos = pesos.map((p) => (alvoCent * p) / total);
  const alvos = exatos.map(Math.floor);
  let resto = alvoCent - alvos.reduce((acc, v) => acc + v, 0);

  const ordem = exatos
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (const { i } of ordem) {
    if (resto <= 0) break;
    alvos[i] += 1;
    resto -= 1;
  }

  return alvos;
};

// Plano de escrita dos itens de UM sistema:
//
//   flat:  itemId -> { [campo]: { liquidoBase, brutoBase, temSnapshot } }
//   horas: itemId -> { [campo]: { horas, valorBase, snapshotBase } }
//
// `alvos` carrega as duas famílias no mesmo objeto porque as chaves de FIELDS e
// de RATE_HOURS_FIELDS são disjuntas: número = líquido digitado de categoria
// flat, objeto = plano de categoria hora×valor. `snapshotBase === null` = a prop
// de snapshot não existe no SCHEMA do portal e não pode ser gravada, senão o
// batch/update inteiro volta 400.
//
// `propsGravaveis` é o schema de line_items, não as props do item: a v3 tanto
// devolve a prop pedida sem valor como `null` quanto a omite da resposta, e
// decidir por presença no item fazia o snapshot nunca ser criado no portal que
// omite. Sem snapshot, o "Total Bruto" do ciclo seguinte cai no valor já
// descontado (`resolveBrutoOriginal` em GroupContracts.js), fica igual ao
// líquido e não sobra percentual nenhum para exibir, o relato de Consultoria
// de agosto/2026.
const buildAllocation = (itens, alvos, propsGravaveis) => {
  const flat = new Map();
  const horas = new Map();

  const guardar = (mapa, id, campo, plano) => {
    if (!mapa.has(id)) mapa.set(id, {});
    mapa.get(id)[campo] = plano;
  };

  const gruposFlat = new Map();
  const gruposHoras = new Map();

  for (const item of itens) {
    const qty = parseFloat(item.properties.quantity) || 1;

    for (const cfg of resolveFieldsForItem(item)) {
      const alvo = alvos[cfg.fieldName];
      // Sem alvo = categoria não editada. `glt_passthrough` nunca tem alvo.
      if (typeof alvo !== "number") continue;

      // O item participa da categoria quando a prop de VALOR está preenchida, o
      // que mantém item de outra categoria fora da conta.
      const valorAtual = parseFloat(
        item.properties[cfg.originalValueProp] || 0,
      );
      if (!(valorAtual > 0)) continue;

      const snapshot = parseFloat(
        item.properties[cfg.originalSnapshotProp] || 0,
      );
      if (!gruposFlat.has(cfg.fieldName)) {
        gruposFlat.set(cfg.fieldName, { alvo, participantes: [] });
      }
      gruposFlat.get(cfg.fieldName).participantes.push({
        id: item.id,
        qty,
        // Peso da alocação e referência do percentual, em escala BASE: o
        // snapshot quando já gravado, senão o valor vigente (1ª aplicação).
        brutoBase: snapshot || valorAtual,
        temSnapshot: snapshot > 0,
      });
    }

    for (const rf of RATE_HOURS_FIELDS) {
      const plano = alvos[rf.fieldName];
      if (!plano) continue;

      const valorItem = parseFloat(item.properties[rf.valueProp] || 0);
      if (!(valorItem > 0)) continue;

      const temSnapshotProp =
        Boolean(rf.snapshotProp) && propsGravaveis.has(rf.snapshotProp);
      const snapshot = temSnapshotProp
        ? parseFloat(item.properties[rf.snapshotProp] || 0)
        : 0;

      if (!gruposHoras.has(rf.fieldName)) {
        gruposHoras.set(rf.fieldName, { plano, participantes: [] });
      }
      gruposHoras.get(rf.fieldName).participantes.push({
        id: item.id,
        qty,
        horasItem: parseFloat(item.properties[rf.hoursProp] || 0),
        brutoBase: snapshot || valorItem,
        temSnapshotProp,
      });
    }
  }

  for (const [campo, { alvo, participantes }] of gruposFlat) {
    const cents = alocarCentavos(
      participantes.map((p) => p.brutoBase * p.qty),
      emCentavos(alvo),
    );
    if (!cents) continue;
    participantes.forEach((p, i) =>
      guardar(flat, p.id, campo, {
        liquidoBase: cents[i] / 100 / p.qty,
        brutoBase: p.brutoBase,
        temSnapshot: p.temSnapshot,
      }),
    );
  }

  for (const [campo, { plano, participantes }] of gruposHoras) {
    if (plano.hoursEdited) {
      // Consolidação: o primeiro item da categoria (ordem devolvida pela API)
      // recebe TODAS as horas e o valor cheio; os demais vão a zero. O snapshot
      // segue a mudança de escopo (valor/h ORIGINAL × horas novas). Os dois em
      // centavo inteiro, senão o bruto exibido no card passa a desviar.
      const alvoCent = emCentavos(plano.alvoTotal);
      const snapCent = emCentavos(plano.unitOriginal * plano.hoursTarget);
      participantes.forEach((p, i) => {
        const acumulador = i === 0;
        guardar(horas, p.id, campo, {
          horas: acumulador ? plano.hoursTarget : 0,
          valorBase: acumulador ? alvoCent / 100 / p.qty : 0,
          snapshotBase: p.temSnapshotProp
            ? acumulador
              ? snapCent / 100 / p.qty
              : 0
            : null,
        });
      });
      continue;
    }

    // Só desconto de valor/h: cada item mantém suas horas, e o snapshot é
    // idempotente porque nunca recebe um valor líquido.
    const cents = alocarCentavos(
      participantes.map((p) => p.brutoBase * p.qty),
      emCentavos(plano.alvoTotal),
    );
    if (!cents) continue;
    participantes.forEach((p, i) =>
      guardar(horas, p.id, campo, {
        horas: p.horasItem,
        valorBase: cents[i] / 100 / p.qty,
        snapshotBase: p.temSnapshotProp ? p.brutoBase : null,
      }),
    );
  }

  return { flat, horas };
};

// Schema de line_items: os nomes que o portal aceita em um batch/update. Uma
// prop pedida no batch/read e ausente da resposta pode ser vazia ou inexistente,
// e só esta chamada separa as duas.
const fetchLineItemSchema = async (hubspotClient) => {
  const { data } = await hubspotClient.get("/crm/v3/properties/line_items", {
    params: { archived: false },
  });
  // Só o que o portal aceita RECEBER: propriedade arquivada (fora desta
  // resposta), calculada ou de valor somente-leitura devolve 400 e derruba o
  // batch/update inteiro, com ele o desconto de todos os itens da chamada.
  return new Set(
    (data.results || [])
      .filter(
        (p) => !p.calculated && !p.modificationMetadata?.readOnlyValue,
      )
      .map((p) => p.name),
  );
};

// Snapshot que falta no portal = categoria hora×valor sem bruto imutável, e
// nenhuma correção de código devolve isso. Fica no log com o nome da prop para
// virar tarefa de quem administra o portal.
const avisarSnapshotsAusentes = (propsGravaveis, prefixo) => {
  const ausentes = RATE_HOURS_FIELDS.map((f) => f.snapshotProp).filter(
    (nome) => nome && !propsGravaveis.has(nome),
  );
  if (ausentes.length) {
    console.warn(
      `${prefixo} propriedades de snapshot ausentes no portal: ${ausentes.join(", ")}. ` +
        "O Total Bruto dessas categorias vai colapsar para o líquido no próximo ciclo. " +
        "Crie as propriedades em line_items para corrigir.",
    );
  }
};

const withStep = async (step, fn) => {
  try {
    return await fn();
  } catch (err) {
    err.step = step;
    throw err;
  }
};

const buildErrorMessage = (error) => {
  const prefix = error.step ? `[${error.step}] ` : "";
  const detail = error.response?.data;
  const detailStr = detail
    ? " — " + (typeof detail === "string" ? detail : JSON.stringify(detail))
    : "";
  return `${prefix}${error.message}${detailStr}`;
};

const fetchLineItemIds = async (dealId, hubspotClient) => {
  const ids = [];
  let after;
  do {
    const { data } = await hubspotClient.get(
      `/crm/v3/objects/deals/${dealId}/associations/line_items`,
      { params: { limit: 500, after } },
    );
    ids.push(...data.results.map((r) => r.id));
    after = data.paging?.next?.after;
  } while (after);
  return ids;
};

// Lê num GET só o que o caminho de pendente precisa. `pending_discounts` e
// `resumo_descontos_aplicados` são compartilhados com o locacao-equipamentos-card:
// escrever sem ler antes apagaria o pendente de equipamentos que já está lá.
const fetchDealStateForPending = async (dealId, hubspotClient) => {
  const { data } = await hubspotClient.get(`/crm/v3/objects/deals/${dealId}`, {
    params: {
      properties: "pipeline,pending_discounts,resumo_descontos_aplicados",
    },
  });
  return {
    pipelineId: data.properties.pipeline,
    pendingAtual: safeParsePending(data.properties.pending_discounts),
    resumoAtual: data.properties.resumo_descontos_aplicados || "",
  };
};

const fetchLineItemProperties = async (ids, hubspotClient) => {
  const properties = [
    "nome_do_sistema",
    "price",
    "quantity",
    "classificacao_do_contrato",
    ...FIELDS.map((f) => f.originalValueProp),
    ...FIELDS.map((f) => f.originalSnapshotProp),
    ...RATE_HOURS_FIELDS.flatMap((f) => [
      f.hoursProp,
      f.valueProp,
      f.snapshotProp,
    ]),
  ];

  const responses = await Promise.all(
    chunk(ids, BATCH_LIMIT).map((batchIds) =>
      hubspotClient.post("/crm/v3/objects/line_items/batch/read", {
        inputs: batchIds.map((id) => ({ id })),
        properties,
      }),
    ),
  );

  return responses.flatMap((res) => res.data.results);
};

const buildDiscountMap = (discounts) => {
  const map = {};

  for (const line of discounts) {
    map[line.nome_do_sistema] = {};

    const fields = {
      glt: { original: line.gltOriginal, novo: line.gltNew },
      locacao: { original: line.locacaoOriginal, novo: line.locacaoNew },
      licenca: { original: line.licencaOriginal, novo: line.licencaNew },
    };

    for (const [campo, { original, novo }] of Object.entries(fields)) {
      // novo === 0 = "não editado" (convenção do card); exigir novo positivo
      // impede que linha intacta vire 100% de desconto. `novo !== original` é
      // deliberadamente dos dois lados: abaixo do bruto é desconto, acima é
      // "over", que o write path aplica como preço sem gravar desconto.
      if (original > 0 && novo > 0 && novo !== original) {
        map[line.nome_do_sistema][campo] = novo;
      }
    }

    const rateHoursFields = {
      desenvolvimento: {
        unitOriginal: line.desenvolvimentoValorUnitarioOriginal,
        unitNew: line.desenvolvimentoValorUnitarioNew,
        hoursOriginal: line.desenvolvimentoHorasOriginal,
        hoursNew: line.desenvolvimentoHorasNew,
      },
      consultoria: {
        unitOriginal: line.consultoriaValorUnitarioOriginal,
        unitNew: line.consultoriaValorUnitarioNew,
        hoursOriginal: line.consultoriaHorasOriginal,
        hoursNew: line.consultoriaHorasNew,
      },
      treinamento: {
        unitOriginal: line.treinamentoValorUnitarioOriginal,
        unitNew: line.treinamentoValorUnitarioNew,
        hoursOriginal: line.treinamentoHorasOriginal,
        hoursNew: line.treinamentoHorasNew,
      },
    };

    for (const [campo, vals] of Object.entries(rateHoursFields)) {
      // `!==` dos dois lados, como nos campos flat: desconto e "over".
      const hasUnitChange =
        vals.unitOriginal > 0 &&
        vals.unitNew > 0 &&
        vals.unitNew !== vals.unitOriginal;

      // Horas: null/undefined = não editado, `novo === atual` é no-op. Zerar é
      // edição válida, daí o teste contra null e não contra 0.
      const hoursNew = vals.hoursNew;
      const hoursEdited = hoursNew != null && hoursNew !== vals.hoursOriginal;

      if (hasUnitChange || hoursEdited) {
        // `alvoTotal` espelha `rateHoursLiquido` do card: é o líquido que a
        // prévia mostra, e prévia e escrita não podem divergir.
        const effectiveUnit = hasUnitChange ? vals.unitNew : vals.unitOriginal;
        const horasEfetivas = hoursEdited ? hoursNew : vals.hoursOriginal;
        map[line.nome_do_sistema][campo] = {
          alvoTotal: effectiveUnit * horasEfetivas,
          // Referência para rebasear o snapshot quando as horas mudam.
          unitOriginal: vals.unitOriginal,
          hoursEdited,
          hoursTarget: hoursEdited ? hoursNew : null,
        };
      }
    }
  }

  return map;
};

const buildPendingPayload = (pending) =>
  (pending || []).map((line) => ({
    nomeDoSistema: line.nome_do_sistema,
    label: line.label,
    percentualDesconto: line.percentualDesconto,
    categorias: {
      glt: { original: line.gltOriginal, novo: line.gltNew },
      locacao: { original: line.locacaoOriginal, novo: line.locacaoNew },
      licenca: { original: line.licencaOriginal, novo: line.licencaNew },
      // `totalBruto` é o bruto que a GroupContracts leu do CRM. É aditivo:
      // o workflow não o lê (`buildRateHoursMap` monta o alvo por
      // valor/h × horas), e a aba do aprovador o usa para reproduzir
      // `rateHoursBruto` sem recalcular. Entrada gravada antes desta versão
      // não o tem, e lá o fallback é valor/h × horas.
      treinamento: {
        valorUnitarioOriginal: line.treinamentoValorUnitarioOriginal,
        valorUnitarioNovo: line.treinamentoValorUnitarioNew,
        horasOriginal: line.treinamentoHorasOriginal,
        horasNovo: line.treinamentoHorasNew,
        totalBruto: line.treinamentoTotalBruto,
      },
      desenvolvimento: {
        valorUnitarioOriginal: line.desenvolvimentoValorUnitarioOriginal,
        valorUnitarioNovo: line.desenvolvimentoValorUnitarioNew,
        horasOriginal: line.desenvolvimentoHorasOriginal,
        horasNovo: line.desenvolvimentoHorasNew,
        totalBruto: line.desenvolvimentoTotalBruto,
      },
      consultoria: {
        valorUnitarioOriginal: line.consultoriaValorUnitarioOriginal,
        valorUnitarioNovo: line.consultoriaValorUnitarioNew,
        horasOriginal: line.consultoriaHorasOriginal,
        horasNovo: line.consultoriaHorasNew,
        totalBruto: line.consultoriaTotalBruto,
      },
    },
  }));

exports.main = async (context) => {
  const { dealId, dealName, discounts, pending, resumo, mode } = context.parameters;

  console.log("[applyDiscounts] dealId:", dealId);
  console.log(
    "[applyDiscounts] discounts recebidos:",
    JSON.stringify(discounts),
  );
  console.log("[applyDiscounts] pending recebidos:", JSON.stringify(pending));

  if (!dealId) {
    return {
      statusCode: 400,
      body: { success: false, error: "dealId não encontrado nos parâmetros" },
    };
  }

  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${process.env.PRIVATE_APP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  // Rascunho: persiste as edições no discount_draft sem efeitos colaterais
  // (sem dealstage, sem webhook, sem line items, sem amount).
  if (mode === "draft") {
    try {
      if (!pending?.length) {
        return {
          statusCode: 400,
          body: { success: false, error: "Nenhuma linha para salvar no rascunho" },
        };
      }
      const entries = buildPendingPayload(pending);
      const savedAt = new Date().toISOString();
      await hubspotClient.patch(`/crm/v3/objects/deals/${dealId}`, {
        properties: { discount_draft: JSON.stringify({ savedAt, entries }) },
      });
      console.log("[applyDiscounts] rascunho salvo:", savedAt);
      return { statusCode: 200, body: { success: true, savedAt } };
    } catch (error) {
      const message = buildErrorMessage(error);
      console.error("[applyDiscounts] erro ao salvar rascunho:", message);
      return { statusCode: 500, body: { success: false, error: message } };
    }
  }

  const hasDiscounts = discounts?.length > 0;
  const hasPending = pending?.length > 0;

  if (!hasDiscounts && !hasPending) {
    return {
      statusCode: 400,
      body: { success: false, error: "Nenhuma linha para processar" },
    };
  }

  try {
    if (hasPending) {
      const pendingPayload = buildPendingPayload(pending);
      console.log(
        "[applyDiscounts] pending_discounts montado:",
        JSON.stringify(pendingPayload),
      );

      const { pipelineId, pendingAtual, resumoAtual } = await withStep(
        "fetchDealStateForPending",
        () => fetchDealStateForPending(dealId, hubspotClient),
      );
      const approvalStage = APPROVAL_STAGES[pipelineId];
      console.log(
        `[applyDiscounts] pipeline: ${pipelineId} | estágio de aprovação: ${approvalStage ?? "não mapeado"}`,
      );

      // O que o locacao card deixou pendente continua pendente: este submit é
      // dono só das entradas de sistema. Sistemas primeiro, equipamentos depois.
      const equipamentosPendentes = pendingAtual.filter(
        (entry) => entry?.tipo === TIPO_EQUIPAMENTOS,
      );
      if (equipamentosPendentes.length) {
        console.log(
          `[applyDiscounts] ${equipamentosPendentes.length} pendente(s) de equipamento preservado(s)`,
        );
      }

      const properties = {
        pending_discounts: JSON.stringify([
          ...pendingPayload,
          ...equipamentosPendentes,
        ]),
        // Limpa o rascunho: o submit substitui o trabalho em andamento.
        discount_draft: "",
      };

      // O resumo é um texto só: reescreve a parte dos sistemas e recola o bloco
      // de equipamentos, que pertence ao outro card.
      const blocoEquipamentos = extrairBlocoEquipamentos(resumoAtual);
      if (resumo || blocoEquipamentos) {
        properties.resumo_descontos_aplicados = [resumo, blocoEquipamentos]
          .filter(Boolean)
          .join("\n\n");
        console.log(
          "[applyDiscounts] resumo_descontos_aplicados gerado:\n" +
            properties.resumo_descontos_aplicados,
        );
      }

      if (approvalStage) {
        properties.dealstage = approvalStage;
      } else {
        console.warn(
          `[applyDiscounts] pipeline ${pipelineId} sem estágio de aprovação mapeado — estágio não alterado`,
        );
      }

      await withStep("writePendingDiscounts", () =>
        hubspotClient.patch(`/crm/v3/objects/deals/${dealId}`, {
          properties,
        }),
      );

      console.log("[applyDiscounts] pending_discounts gravado com sucesso");

      const approver = await withStep("fetchApproverForPipeline", () =>
        fetchApproverForPipeline(pipelineId, hubspotClient),
      );

      if (approver) {
        await withStep("triggerApprovalWebhook", () =>
          triggerApprovalWebhook(approver, dealName),
        );
      } else {
        console.warn(
          `[applyDiscounts] nenhum aprovador encontrado para o pipeline ${pipelineId} — webhook não disparado`,
        );
      }
    }

    if (!hasDiscounts) {
      return {
        statusCode: 200,
        body: { success: true, updated: 0, pending: pending.length },
      };
    }

    const ids = await withStep("fetchLineItemIds", () =>
      fetchLineItemIds(dealId, hubspotClient),
    );
    console.log("[applyDiscounts] ids encontrados:", JSON.stringify(ids));

    if (!ids.length) {
      return { statusCode: 200, body: { success: true, updated: 0 } };
    }

    const [lineItems, propsGravaveis] = await Promise.all([
      withStep("fetchLineItemProperties", () =>
        fetchLineItemProperties(ids, hubspotClient),
      ),
      withStep("fetchLineItemSchema", () => fetchLineItemSchema(hubspotClient)),
    ]);
    avisarSnapshotsAusentes(propsGravaveis, "[applyDiscounts]");

    console.log(
      "[applyDiscounts] lineItems:",
      JSON.stringify(
        lineItems.map((i) => ({ id: i.id, properties: i.properties })),
      ),
    );

    const discountMap = buildDiscountMap(discounts);
    console.log("[applyDiscounts] discountMap:", JSON.stringify(discountMap));

    // Um sistema por chamada de buildAllocation: o acumulador de horas é
    // resolvido dentro do grupo que ela recebe.
    const itensPorSistema = new Map();
    for (const item of lineItems) {
      const sistema = item.properties.nome_do_sistema;
      if (!discountMap[sistema]) continue;
      if (!itensPorSistema.has(sistema)) itensPorSistema.set(sistema, []);
      itensPorSistema.get(sistema).push(item);
    }

    const alocacao = { flat: new Map(), horas: new Map() };
    for (const [sistema, itens] of itensPorSistema) {
      const parcial = buildAllocation(
        itens,
        discountMap[sistema],
        propsGravaveis,
      );
      for (const [id, plano] of parcial.flat) alocacao.flat.set(id, plano);
      for (const [id, plano] of parcial.horas) alocacao.horas.set(id, plano);
    }

    const updates = [];

    for (const item of lineItems) {
      const rawSistema = item.properties.nome_do_sistema;
      const discount = discountMap[rawSistema];

      console.log(
        `[applyDiscounts] item ${item.id} | sistema: "${rawSistema}" | discount: ${JSON.stringify(discount ?? null)}`,
      );

      if (!discount) {
        console.log(
          `[applyDiscounts] item ${item.id} — sem desconto correspondente, ignorando`,
        );
        continue;
      }

      const properties = {};
      let totalDiscountedValue = 0;
      let hasDiscount = false;

      for (const {
        fieldName,
        originalValueProp,
        discountPercentProp,
        discountAmountProp,
        originalSnapshotProp,
      } of resolveFieldsForItem(item)) {
        const plano = alocacao.flat.get(item.id)?.[fieldName];
        const valorAtual = parseFloat(item.properties[originalValueProp] || 0);

        // Sem plano: categoria não editada, ou item que não é dela. O valor
        // vigente ainda entra no price.
        if (!plano) {
          totalDiscountedValue += valorAtual;
          continue;
        }

        const { liquidoBase, brutoBase, temSnapshot } = plano;
        const discountAmount = brutoBase - liquidoBase;

        console.log(
          `[applyDiscounts] item ${item.id} | campo ${fieldName} | bruto original: ${brutoBase} | atual: ${valorAtual} | alvo do item: ${liquidoBase} | desconto: ${discountAmount}`,
        );

        properties[originalValueProp] = fmtValor(liquidoBase);
        // Desconto negativo = "over": grava o preço, não registra desconto.
        if (discountAmount > 0) {
          // A prop é do tipo Percentage e espera a escala 19 = 19%: gravar a
          // fração faz 10% aparecer como "0,1%".
          properties[discountPercentProp] = parseFloat(
            ((discountAmount / brutoBase) * 100).toFixed(4),
          );
          properties[discountAmountProp] = fmtValor(discountAmount);
        }
        if (!temSnapshot) {
          properties[originalSnapshotProp] = fmtValor(brutoBase);
        }

        totalDiscountedValue += liquidoBase;
        hasDiscount = true;
      }

      for (const rateField of RATE_HOURS_FIELDS) {
        const plano = alocacao.horas.get(item.id)?.[rateField.fieldName];
        if (!plano) continue;

        console.log(
          `[applyDiscounts] item ${item.id} | campo ${rateField.fieldName} | horas: ${plano.horas} | valor base: ${plano.valorBase} | snapshot: ${plano.snapshotBase}`,
        );

        properties[rateField.hoursProp] = fmtValor(plano.horas);
        properties[rateField.valueProp] = fmtValor(plano.valorBase);
        if (plano.snapshotBase !== null) {
          properties[rateField.snapshotProp] = fmtValor(plano.snapshotBase);
        }

        totalDiscountedValue += plano.valorBase;
        hasDiscount = true;
      }

      if (hasDiscount) {
        properties["price"] = fmtValor(totalDiscountedValue);
      }

      console.log(
        `[applyDiscounts] item ${item.id} | properties montadas:`,
        JSON.stringify(properties),
      );

      if (Object.keys(properties).length > 0) {
        updates.push({ id: item.id, properties });
      }
    }

    console.log(
      "[applyDiscounts] updates finais:",
      JSON.stringify(updates, null, 2),
    );

    if (!updates.length) {
      console.log("[applyDiscounts] nenhum item para atualizar");
      return {
        statusCode: 200,
        body: { success: true, updated: 0, pending: pending?.length || 0 },
      };
    }

    await withStep("batchUpdate", () =>
      Promise.all(
        chunk(updates, BATCH_LIMIT).map((batch) =>
          hubspotClient.post("/crm/v3/objects/line_items/batch/update", {
            inputs: batch,
          }),
        ),
      ),
    );

    console.log("[applyDiscounts] line items atualizados:", updates.length);

    // amount = price × quantity: o price é UNITÁRIO desde que o multiplicador
    // de emissão migrou para a quantity (ver ciss-lancamento-contratos).
    const newDealAmount = lineItems.reduce((acc, item) => {
      const quantity = parseFloat(item.properties.quantity) || 1;
      const update = updates.find((u) => u.id === item.id);
      const price = update?.properties?.price ?? item.properties.price;
      return acc + parseFloat(price || 0) * quantity;
    }, 0);

    console.log("[applyDiscounts] novo amount do deal:", newDealAmount);

    await withStep("updateDealAmount", () =>
      hubspotClient.patch(`/crm/v3/objects/deals/${dealId}`, {
        properties: {
          amount: fmtMoeda(newDealAmount),
          // Limpa o rascunho: o submit substitui o trabalho em andamento.
          discount_draft: "",
        },
      }),
    );

    console.log("[applyDiscounts] amount do deal atualizado com sucesso");

    return {
      statusCode: 200,
      body: {
        success: true,
        updated: updates.length,
        pending: pending?.length || 0,
      },
    };
  } catch (error) {
    const message = buildErrorMessage(error);
    console.error("[applyDiscounts] erro:", message);
    return { statusCode: 500, body: { success: false, error: message } };
  }
};
