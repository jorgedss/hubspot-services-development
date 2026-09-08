const axios = require("axios");

const BATCH_LIMIT = 100;

const chunk = (items, size) => {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

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

const CLASSIFICACAO_LOCACAO = "C";

const FIELDS_LOCACAO_C = [
  {
    fieldName: "glt",
    originalValueProp: "valor_locacao",
    discountPercentProp: "locacao_descontado",
    discountAmountProp: "valor_locacao_descontado",
    originalSnapshotProp: "valor_locacao_original",
  },
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
// Entradas do ciss-apps/locacao-equipamentos-card dentro de pending_discounts.
// A propriedade tem dois donos e as entradas convivem no mesmo array: as de
// sistema não têm `tipo`, as de equipamento têm `tipo: "equipamentos"`.
// A constante existe em quatro arquivos: aqui, em
// src/app/functions/ApplyDiscounts.js e nos dois app-functions do locacao card.
//
// A aprovação de equipamentos é do CONJUNTO, então é UMA entrada por negócio,
// com `label`, `percentualDesconto` e os totais agregados no topo, e a lista
// `itens` dentro. Isso faz uma linha no card do aprovador e uma no histórico,
// igual a um sistema, sem que o `pending.map` do histórico precise saber disso.
// A aplicação continua por item de linha: os alvos estão em `itens` e não podem
// ser reconstruídos a partir do agregado.
// ---------------------------------------------------------------------------
const TIPO_EQUIPAMENTOS = "equipamentos";

// As sete propriedades e as duas multiplicações abaixo são as mesmas de
// locacao-equipamentos-card/src/app/functions/aplicarDesconto.js: um desconto de
// equipamento dentro da alçada passa por lá, um acima passa por aqui, e os dois
// têm que gravar o mesmo valor. Altere os dois juntos.
//
// Não há alocação em centavos porque não há distribuição: cada item da lista já
// traz o alvo absoluto. Isso também é o que torna a reaplicação idempotente,
// em retry ou em reinscrição do workflow.
const buildEquipamentoProperties = (item) => {
  const quantidade = parseFloat(item.quantidade) || 0;
  const brutoTreinamento = parseFloat(item.treinamento?.unitarioOriginal) || 0;
  const liquidoTreinamento = parseFloat(item.treinamento?.unitarioNovo) || 0;
  const brutoLocacao = parseFloat(item.locacao?.unitarioOriginal) || 0;
  const liquidoLocacao = parseFloat(item.locacao?.unitarioNovo) || 0;

  return {
    horas_treinamento: String(quantidade),
    valor_treinamento_original: String(brutoTreinamento),
    valor_treinamento_descontado: String(liquidoTreinamento),
    valor_treinamento: String(quantidade * liquidoTreinamento),
    valor_locacao_original: String(brutoLocacao),
    valor_locacao_descontado: String(liquidoLocacao),
    valor_locacao: String(quantidade * liquidoLocacao),
  };
};

const RATE_HOURS_FIELDS = [
  {
    fieldName: "treinamento",
    hoursProp: "horas_treinamento",
    valueProp: "valor_treinamento",
    snapshotProp: "valor_treinamento_original",
  },
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
];

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
    ? " - " + (typeof detail === "string" ? detail : JSON.stringify(detail))
    : "";
  return `${prefix}${error.message}${detailStr}`;
};

const safeParse = (raw, fallback) => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (err) {
    console.error("[descontoDecisao] invalid JSON:", err.message);
    return fallback;
  }
};

const fetchIsApprover = async (userEmail, pipelineId, hubspotClient) => {
  if (!userEmail) return false;
  const { data } = await hubspotClient.post("/crm/v3/objects/contacts/search", {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "aprovador_de_desconto",
            operator: "EQ",
            value: "true",
          },
          { propertyName: "email", operator: "EQ", value: userEmail },
        ],
      },
    ],
    properties: ["aprovador_pipelines"],
    limit: 1,
  });
  const contact = (data.results || [])[0];
  if (!contact) return false;
  const pipelines = (contact.properties.aprovador_pipelines || "")
    .split(",")
    .map((s) => s.trim());
  return pipelines.includes(String(pipelineId));
};

// Os valores internos de `proposta_aprovada` no portal são "Sim" e "Não", com
// caixa e acento. Nenhuma comparação pode depender dessa grafia: "não" nunca
// casaria com o literal "nao" e a reprovação perderia o motivo em silêncio.
// Normaliza para "sim"/"nao" e é o único lugar que conhece a grafia do portal.
const normalizarDecisao = (valor) =>
  String(valor || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const DECISOES_VALIDAS = ["sim", "nao"];

// Propriedade durável com a decisão, para a ramificação do workflow que move o
// estágio: `true` aprovado, `false` reprovado. Ela existe porque
// `proposta_aprovada` e `observacoes` são limpas no PATCH final, e uma
// ramificação que roda depois disso leria campo vazio.
//
// NUNCA é limpa. É o que garante que o valor esteja lá quando aquela
// ramificação rodar, independente de quanto tempo depois isso aconteça.
//
// A propriedade tem que existir no portal ANTES de subir este código: ela vai
// no mesmo PATCH que grava histórico e `amount`, e nome inexistente devolve 400
// e derruba a chamada inteira, deixando o desconto sem aplicar.
const PROP_MUDAR_ESTAGIO = "change_deal_stage_discount";

const fetchDealState = async (dealId, hubspotClient) => {
  const { data } = await hubspotClient.get(`/crm/v3/objects/deals/${dealId}`, {
    params: {
      properties: "pipeline,pending_discounts,discounts_history",
      propertiesWithHistory: "proposta_aprovada",
    },
  });

  const propertyHistory = data.propertiesWithHistory?.proposta_aprovada || [];
  const latestDecision = propertyHistory.find((entry) => entry.value);

  return {
    pipelineId: data.properties.pipeline,
    pending: safeParse(data.properties.pending_discounts, []),
    history: safeParse(data.properties.discounts_history, []),
    author: latestDecision
      ? {
          value: normalizarDecisao(latestDecision.value),
          userId: latestDecision.updatedByUserId
            ? String(latestDecision.updatedByUserId)
            : null,
          sourceType: latestDecision.sourceType,
        }
      : null,
  };
};

const resolveUserById = async (userId, hubspotClient) => {
  if (!userId) return null;
  try {
    const { data } = await hubspotClient.get(`/crm/v3/owners/${userId}`, {
      params: { idProperty: "userId" },
    });
    return {
      email: data.email,
      name:
        [data.firstName, data.lastName].filter(Boolean).join(" ") || data.email,
    };
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
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

// Alvo de cada categoria flat, lido de `pending_discounts`: o líquido digitado
// no card, na escala do card (bruto calculado, não a base do item).
const buildTargets = (categories) => {
  const targets = {};
  for (const { fieldName } of FIELDS) {
    const category = categories[fieldName];
    if (
      category &&
      category.original > 0 &&
      category.novo > 0 &&
      category.novo !== category.original
    ) {
      targets[fieldName] = category.novo;
    }
  }
  return targets;
};

const buildRateHoursMap = (categories) => {
  const map = {};
  for (const { fieldName } of RATE_HOURS_FIELDS) {
    const category = categories[fieldName];
    if (!category) continue;
    const unitOriginal = parseFloat(category.valorUnitarioOriginal || 0);
    const unitNew = parseFloat(category.valorUnitarioNovo || 0);
    const hoursOriginal = parseFloat(category.horasOriginal || 0);
    const hoursNew =
      category.horasNovo == null ? null : parseFloat(category.horasNovo);
    const hasUnitChange =
      unitOriginal > 0 && unitNew > 0 && unitNew !== unitOriginal;
    const hoursEdited = hoursNew != null && hoursNew !== hoursOriginal;
    if (hasUnitChange || hoursEdited) {
      // `alvoTotal` espelha `rateHoursLiquido` do card: é o líquido que a prévia
      // mostra, e prévia e escrita não podem divergir.
      const effectiveUnit = hasUnitChange ? unitNew : unitOriginal;
      const horasEfetivas = hoursEdited ? hoursNew : hoursOriginal;
      map[fieldName] = {
        alvoTotal: effectiveUnit * horasEfetivas,
        unitOriginal,
        hoursEdited,
        hoursTarget: hoursEdited ? hoursNew : null,
      };
    }
  }
  return map;
};

const applyAllPendingSystems = async (dealId, pending, hubspotClient) => {
  const ids = await withStep("fetchLineItemIds", () =>
    fetchLineItemIds(dealId, hubspotClient),
  );

  if (!ids.length) return { updated: 0, newAmount: null };

  const [lineItems, propsGravaveis] = await Promise.all([
    withStep("fetchLineItemProperties", () =>
      fetchLineItemProperties(ids, hubspotClient),
    ),
    withStep("fetchLineItemSchema", () => fetchLineItemSchema(hubspotClient)),
  ]);
  avisarSnapshotsAusentes(propsGravaveis, "[descontoDecisao]");

  const updates = [];

  // Entrada de equipamento não é sistema: ela não tem `categorias`, não passa
  // por buildAllocation e não pode entrar no laço abaixo, que agruparia line
  // items por nome_do_sistema e escreveria as propriedades erradas.
  const sistemas = pending.filter((e) => e?.tipo !== TIPO_EQUIPAMENTOS);
  const equipamentos = pending.filter((e) => e?.tipo === TIPO_EQUIPAMENTOS);

  for (const system of sistemas) {
    const systemName = system.nomeDoSistema;
    const categories = system.categorias || {};

    const alvos = {
      ...buildTargets(categories),
      ...buildRateHoursMap(categories),
    };
    console.log(
      `[descontoDecisao] ${systemName} | alvos:`,
      JSON.stringify(alvos),
    );

    const itensDoSistema = lineItems.filter(
      (item) => item.properties.nome_do_sistema === systemName,
    );

    // Um sistema por chamada de buildAllocation: o acumulador de horas é
    // resolvido dentro do grupo que ela recebe.
    const alocacao = buildAllocation(itensDoSistema, alvos, propsGravaveis);

    for (const item of itensDoSistema) {
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
        const currentValue = parseFloat(
          item.properties[originalValueProp] || 0,
        );

        // Sem plano: categoria não editada, ou item que não é dela. O valor
        // vigente ainda entra no price.
        if (!plano) {
          totalDiscountedValue += currentValue;
          continue;
        }

        const { liquidoBase, brutoBase, temSnapshot } = plano;
        const discountAmount = brutoBase - liquidoBase;

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
        updates.push({ id: item.id, properties });
      }
    }
  }

  // Equipamentos: a entrada é do conjunto, a escrita é item a item.
  const idsDoDeal = new Set(ids.map(String));
  for (const entry of equipamentos) {
    for (const item of entry.itens || []) {
      const id = String(item.lineItemId || "");
      // Item removido do deal entre o envio e a decisão. Descartar é
      // obrigatório: um id inexistente devolve 400 e derruba o batch inteiro,
      // levando junto o desconto de todos os sistemas da mesma chamada.
      if (!idsDoDeal.has(id)) {
        console.warn(
          `[descontoDecisao] equipamento ${id} não está mais associado ao deal, ignorado`,
        );
        continue;
      }

      const properties = buildEquipamentoProperties(item);
      const existente = updates.find((u) => u.id === id);
      if (existente) {
        Object.assign(existente.properties, properties);
      } else {
        updates.push({ id, properties });
      }
    }
  }

  console.log("[descontoDecisao] updates:", JSON.stringify(updates));

  if (!updates.length) return { updated: 0, newAmount: null };

  await withStep("batchUpdate", () =>
    Promise.all(
      chunk(updates, BATCH_LIMIT).map((batch) =>
        hubspotClient.post("/crm/v3/objects/line_items/batch/update", {
          inputs: batch,
        }),
      ),
    ),
  );

  const newAmount = lineItems.reduce((acc, item) => {
    const quantity = parseFloat(item.properties.quantity) || 1;
    const update = updates.find((u) => u.id === item.id);
    const price = update?.properties?.price ?? item.properties.price;
    return acc + parseFloat(price || 0) * quantity;
  }, 0);

  return { updated: updates.length, newAmount: fmtMoeda(newAmount) };
};

exports.main = async (event, callback) => {
  const dealId = event.object?.objectId;
  const inputs = event.inputFields || {};
  const decision = normalizarDecisao(inputs.proposta_aprovada);
  const reason = String(inputs.observacoes || "").trim();

  const respond = (payload) =>
    callback({
      outputFields: {
        status: "erro",
        itens_atualizados: 0,
        sistemas_processados: 0,
        pendentes_restantes: 0,
        novo_amount: "",
        aprovador: "",
        motivo: "",
        erro: "",
        ...payload,
      },
    });

  console.log(
    `[descontoDecisao] deal: ${dealId} | decision: ${decision} | reason: ${reason ? "filled" : "empty"}`,
  );

  // Valor fora do par esperado sai como erro, não como reprovação. Sem esta
  // guarda o `decision === "sim" ? ... : ...` lá embaixo trata qualquer string
  // desconhecida como reprovação: nada é escrito, o histórico registra
  // "reprovado" e ninguém é avisado de que a propriedade está mal configurada.
  if (!DECISOES_VALIDAS.includes(decision)) {
    return respond({
      erro: `Valor de Proposta aprovada não reconhecido: "${inputs.proposta_aprovada}". Esperado Sim ou Não.`,
    });
  }

  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${process.env.DISCOUNT_APP_TOKEN}`,
      "Content-Type": "application/json",
    },
    timeout: 18000,
  });

  try {
    const { pipelineId, pending, history, author } = await withStep(
      "fetchDealState",
      () => fetchDealState(dealId, hubspotClient),
    );

    if (!author || !author.userId) {
      return respond({
        erro: "Autor da decisão não identificado. A propriedade Proposta aprovada precisa ser editada por uma pessoa, pela interface do CRM.",
      });
    }

    if (author.value !== decision) {
      return respond({
        erro: `Decisão divergente: workflow enviou "${decision}", propriedade está em "${author.value}"`,
      });
    }

    const user = await withStep("resolveUserById", () =>
      resolveUserById(author.userId, hubspotClient),
    );
    if (!user?.email) {
      return respond({
        erro: `Usuário ${author.userId} não tem owner correspondente no portal`,
      });
    }

    const isApprover = await withStep("fetchIsApprover", () =>
      fetchIsApprover(user.email, pipelineId, hubspotClient),
    );

    console.log(
      `[descontoDecisao] author: ${user.email} (${author.sourceType}) | pipeline: ${pipelineId} | isApprover: ${isApprover}`,
    );

    if (!isApprover) {
      return respond({
        erro: `${user.email} não é aprovador do pipeline ${pipelineId}`,
        aprovador: user.name,
      });
    }

    if (!pending.length) {
      // Nada a decidir, mas a propriedade tem que voltar a ficar vazia. O
      // gatilho é "Proposta aprovada é conhecido" com reinscrição: um deal que
      // fica com "Sim" gravado continua atendendo ao critério para sempre e
      // nunca reinscreve, então o PRÓXIMO ciclo de desconto desse deal não
      // dispara, porque gravar "Sim" de novo não é uma mudança de valor.
      // Aqui não há estado errado para deixar visível, ao contrário do ramo de
      // erro: não havia pendente nenhum.
      try {
        await withStep("limparDecisaoSemPendente", () =>
          hubspotClient.patch(`/crm/v3/objects/deals/${dealId}`, {
            properties: { proposta_aprovada: "", observacoes: "" },
          }),
        );
      } catch (erroLimpeza) {
        // Falhar a limpeza não transforma um "nada a fazer" em erro: o status
        // continua `ignorado` e o log diz que a propriedade ficou suja.
        console.error(
          `[descontoDecisao] falha ao limpar proposta_aprovada sem pendente: ${erroLimpeza.message}`,
        );
      }
      return respond({ status: "ignorado", aprovador: user.name });
    }

    let updated = 0;
    let newAmount = "";
    if (decision === "sim") {
      const result = await applyAllPendingSystems(
        dealId,
        pending,
        hubspotClient,
      );
      updated = result.updated;
      newAmount = result.newAmount || "";
      console.log(
        `[descontoDecisao] ${updated} line items updated | amount: ${newAmount}`,
      );
    }

    const now = new Date().toISOString();
    const newEntries = pending.map((p) => ({
      nomeDoSistema: p.nomeDoSistema,
      label: p.label,
      percentualDesconto: p.percentualDesconto ?? null,
      status: decision === "sim" ? "aprovado" : "reprovado",
      responsavel: user.name,
      data: now,
      ...(decision === "nao" ? { motivo: reason } : {}),
    }));

    const dealPatchProperties = {
      pending_discounts: JSON.stringify([]),
      discounts_history: JSON.stringify([...newEntries, ...history]),
      resumo_descontos_aplicados: "",
      proposta_aprovada: "",
      observacoes: "",
      // Mesmo PATCH das limpezas, de propósito: a decisão fica registrada num
      // campo durável no exato instante em que sai dos campos voláteis.
      [PROP_MUDAR_ESTAGIO]: decision === "sim" ? "true" : "false",
    };
    if (newAmount) dealPatchProperties.amount = newAmount;

    await withStep("updateDealProperties", () =>
      hubspotClient.patch(`/crm/v3/objects/deals/${dealId}`, {
        properties: dealPatchProperties,
      }),
    );

    console.log(
      `[descontoDecisao] ${decision} finished for ${pending.length} system(s)`,
    );

    return respond({
      status: decision === "sim" ? "aprovado" : "reprovado",
      itens_atualizados: updated,
      sistemas_processados: pending.length,
      pendentes_restantes: 0,
      novo_amount: newAmount,
      aprovador: user.name,
      motivo: decision === "nao" ? reason : "",
    });
  } catch (error) {
    const message = buildErrorMessage(error);
    console.error("[descontoDecisao] error:", message);
    return respond({ erro: message });
  }
};
