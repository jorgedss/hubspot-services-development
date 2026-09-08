const axios = require("axios");

// O endpoint batch/read aceita no máximo 100 inputs por chamada.
const BATCH_LIMIT = 100;

const chunk = (items, size) => {
  const result = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

// Considera vazio: null, undefined, string vazia e whitespace. O batch/read
// pode devolver a prop como null (existe, sem valor) ou omiti-la (undefined).
const isBlank = (value) => value == null || String(value).trim() === "";

// Line items sem "tipo de contrato" preenchido bloqueiam o avanço do desconto:
// sem esse campo os valores da negociação não são puxados corretamente. A
// checagem é por ITEM (não por sistema), porque `groupBySistema` colapsa o
// tipo_de_contrato no primeiro item preenchido, mascarando os itens em branco.
const findMissingTipoContrato = (lineItems, labels) =>
  lineItems
    .filter((item) => isBlank(item.properties.tipo_de_contrato))
    .map((item) => {
      const sistemaValue = item.properties.nome_do_sistema;
      const sistemaLabel = sistemaValue
        ? (labels[sistemaValue] ?? sistemaValue)
        : null;
      return {
        id: item.id,
        nome: item.properties.name || sistemaLabel || `Item ${item.id}`,
        sistema: sistemaLabel,
      };
    });

const fetchDealInfo = async (dealId, hubspotClient) => {
  const { data } = await hubspotClient.get(`/crm/v3/objects/deals/${dealId}`, {
    params: { properties: "pipeline,dealname,discount_draft" },
  });
  return {
    pipelineId: data.properties.pipeline,
    dealName: data.properties.dealname || `Deal ${dealId}`,
    discountDraft: data.properties.discount_draft || null,
  };
};

const fetchApproverForPipeline = async (pipelineId, hubspotClient) => {
  try {
    const { data } = await hubspotClient.post(
      "/crm/v3/objects/contacts/search",
      {
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
      },
    );

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
      name: [contact.properties.firstname, contact.properties.lastname]
        .filter(Boolean)
        .join(" "),
      contactId: contact.id,
    };
  } catch (err) {
    console.error("[groupContracts] erro ao buscar aprovador:", err.message);
    return null;
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

const fetchPropertyLabels = async (hubspotClient) => {
  const { data } = await hubspotClient.get(
    "/crm/v3/properties/line_items/nome_do_sistema",
  );
  return data.options.reduce((acc, option) => {
    acc[option.value] = option.label;
    return acc;
  }, {});
};

// Alçada (limite de desconto %) por pipeline. Descontos acima da alçada do
// pipeline exigem aprovação. Pipelines não mapeados usam DEFAULT_THRESHOLD.
// Mantenha sincronizado com FetchDiscountApproval.js.
// TODO: confirmar os percentuais reais de cada pipeline com a área de negócio.
const DEFAULT_THRESHOLD = 10;
const PIPELINE_THRESHOLDS = {
  872876959: 10, // Franquia - SMB
  873229378: 10, // Franquia - Enterprise
  872876956: 15, // PDV e Geral - SMB
  872876957: 15, // PDV e Geral - Enterprise
  907963396: 10, // Expansão - Franquia
  911415619: 20, // Expansão - PDV e Geral
};

const resolveAlcada = (pipelineId) =>
  PIPELINE_THRESHOLDS[String(pipelineId)] ?? DEFAULT_THRESHOLD;

const fetchLineItemProperties = async (ids, hubspotClient) => {
  const properties = [
    "name",
    "nome_do_sistema",
    "quantity",
    "valor_glt",
    "valor_locacao",
    "valor_licenca",
    "valor_treinamento",
    "horas_treinamento",
    "valor_horas_desenvolvimento",
    "horas_desenvolvimento",
    "valor_horas_consultoria",
    "horas_consultoria",
    "tipo_de_contrato",
    "classificacao_do_contrato",
    // Propriedades CALCULADAS (valor base × quantity, resolvidas pelo CRM
    // conforme o tipo de emissão) — fonte do "Valor Bruto" exibido no card.
    "valor_mensalidade_calculado",
    "valor_locacao_calculado",
    "valor_licenca_calculado",
    "valor_treinamento_calculado",
    "valor_horas_desenvolvimento_calculado",
    "valor_horas_contabeis_calculado",
    // Snapshots do bruto ORIGINAL (escala BASE), gravados uma única vez na
    // primeira aplicação — a referência imutável de cada categoria.
    "valor_mensalidade_original",
    "valor_locacao_original",
    "valor_licenca_original",
    "valor_treinamento_original",
    "valor_horas_desenvolvimento_original",
    "valor_horas_consultoria_original",
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

// Sistemas que NÃO pertencem a este card: o desconto deles é aplicado por outro
// app e ler os itens aqui deixaria as duas telas editando o mesmo item de linha,
// cada uma cega para o que a outra gravou. Hoje é só Equipamentos ("67"), que
// pertence ao app locacao-equipamentos-card (o mesmo valor está no filtro de
// fetchLocacaoLineItems.js). O filtro é por ITEM, aplicado antes de agrupar:
// remover o sistema depois do agrupamento não daria como excluir um item cujo
// sistema também tem itens elegíveis.
const SISTEMAS_EXCLUIDOS = new Set(["67"]);

const isSistemaElegivel = (item) =>
  !SISTEMAS_EXCLUIDOS.has(String(item.properties.nome_do_sistema));

// Classificação Locação(C), gravada pelo app ciss-lancamento-contratos
// (classificacao_do_contrato = "C"). Nesses itens a mensalidade mora em
// valor_locacao (valor_glt vem 0 do lançamento). Mantenha em sincronia com
// ApplyDiscounts.js e com automation/desconto-decisao/customCode.js, que roda
// no workflow de aprovação.
const CLASSIFICACAO_LOCACAO = "C";

// Valor bruto de cada categoria: preferir a propriedade CALCULADA (base ×
// quantity, resolvida pelo CRM conforme o tipo de emissão). Fallback: base ×
// quantity — cobre itens sem a calculada preenchida; itens antigos (valores já
// totais) têm quantity = 1, então o fallback devolve o próprio valor base.
// O desconto, por outro lado, é SEMPRE aplicado sobre a prop base (unitária):
// a taxa é uma razão, então base × (1 − taxa) faz a calculada resultar no
// líquido informado no card (ver ApplyDiscounts e o customCode do workflow).
const resolveGross = (calcValue, baseValue, quantity) =>
  isBlank(calcValue)
    ? parseFloat(baseValue || 0) * quantity
    : parseFloat(calcValue);

// Bruto ORIGINAL (imutável) da categoria: o snapshot `*_original` quando já
// gravado, senão o bruto atual — o item ainda não recebeu desconto nenhum, e
// nesse caso o valor corrente É o original. O snapshot está em escala BASE,
// então volta à escala do card multiplicado pela quantity.
// Sem isto o bruto do card vira o líquido da aplicação anterior e todo desconto
// subsequente passa a ser uma razão contra uma base móvel.
const resolveBrutoOriginal = (snapshot, grossAtual, quantity) =>
  isBlank(snapshot) ? grossAtual : parseFloat(snapshot) * quantity;

const groupBySistema = (lineItems, labels) => {
  const grouped = {};

  for (const item of lineItems) {
    const {
      nome_do_sistema,
      quantity,
      valor_glt,
      valor_locacao,
      valor_licenca,
      valor_treinamento,
      horas_treinamento,
      valor_horas_desenvolvimento,
      horas_desenvolvimento,
      valor_horas_consultoria,
      horas_consultoria,
      tipo_de_contrato,
      classificacao_do_contrato,
      valor_mensalidade_calculado,
      valor_locacao_calculado,
      valor_licenca_calculado,
      valor_treinamento_calculado,
      valor_horas_desenvolvimento_calculado,
      valor_horas_contabeis_calculado,
      valor_mensalidade_original,
      valor_locacao_original,
      valor_licenca_original,
      valor_treinamento_original,
      valor_horas_desenvolvimento_original,
      valor_horas_consultoria_original,
    } = item.properties;

    if (!nome_do_sistema) continue;

    const label = labels[nome_do_sistema] ?? nome_do_sistema;

    if (!grouped[nome_do_sistema]) {
      grouped[nome_do_sistema] = {
        label,
        tipoContrato: null,
        // Cada categoria carrega o par (bruto ORIGINAL, líquido VIGENTE): o
        // primeiro é a referência imutável do desconto, o segundo pré-preenche
        // o input do card. Sem desconto aplicado os dois são iguais.
        glt: 0,
        gltLiquido: 0,
        locacao: 0,
        locacaoLiquido: 0,
        licenca: 0,
        licencaLiquido: 0,
        treinamentoValorUnitario: 0,
        treinamentoValorUnitarioLiquido: 0,
        treinamentoHoras: 0,
        treinamentoTotalBruto: 0,
        treinamentoTotalLiquido: 0,
        desenvolvimentoValorUnitario: 0,
        desenvolvimentoValorUnitarioLiquido: 0,
        desenvolvimentoHoras: 0,
        desenvolvimentoTotalBruto: 0,
        desenvolvimentoTotalLiquido: 0,
        consultoriaValorUnitario: 0,
        consultoriaValorUnitarioLiquido: 0,
        consultoriaHoras: 0,
        consultoriaTotalBruto: 0,
        consultoriaTotalLiquido: 0,
      };
    }

    const g = grouped[nome_do_sistema];

    const qty = parseFloat(quantity) || 1;
    const gltGross = resolveGross(valor_mensalidade_calculado, valor_glt, qty);
    const locacaoGross = resolveGross(
      valor_locacao_calculado,
      valor_locacao,
      qty,
    );
    const licencaGross = resolveGross(valor_licenca_calculado, valor_licenca, qty);

    const gltOriginal = resolveBrutoOriginal(
      valor_mensalidade_original,
      gltGross,
      qty,
    );
    const locacaoOriginal = resolveBrutoOriginal(
      valor_locacao_original,
      locacaoGross,
      qty,
    );
    const licencaOriginal = resolveBrutoOriginal(
      valor_licenca_original,
      licencaGross,
      qty,
    );

    // Locação(C): a mensalidade do item mora em valor_locacao — o valor entra
    // no bucket glt (Mensalidade) e sai do bucket locacao, evitando dupla
    // contagem no totalizador (Mens. = glt + locacao) e desconto duplo.
    const isLocacaoC = classificacao_do_contrato === CLASSIFICACAO_LOCACAO;
    g.glt += isLocacaoC ? locacaoOriginal : gltOriginal;
    g.gltLiquido += isLocacaoC ? locacaoGross : gltGross;
    g.locacao += isLocacaoC ? 0 : locacaoOriginal;
    g.locacaoLiquido += isLocacaoC ? 0 : locacaoGross;
    g.licenca += licencaOriginal;
    g.licencaLiquido += licencaGross;

    // A categoria hora×valor vale quando o bruto (calculado/base) está
    // preenchido (não só as horas). As HORAS nunca são multiplicadas por
    // quantity; o valor/h é derivado depois (total ÷ horas) e por isso já
    // embute a multiplicação — é a taxa efetiva cobrada por hora.
    // O gate continua pelo valor VIGENTE: item zerado pela consolidação de
    // horas está fora da categoria e seu snapshot antigo não pode ser somado
    // ao bruto do sistema (viraria dupla contagem).
    const vTrein = resolveGross(
      valor_treinamento_calculado,
      valor_treinamento,
      qty,
    );
    if (vTrein > 0) {
      g.treinamentoTotalBruto += resolveBrutoOriginal(
        valor_treinamento_original,
        vTrein,
        qty,
      );
      g.treinamentoTotalLiquido += vTrein;
      g.treinamentoHoras += parseFloat(horas_treinamento || 0);
    }

    const vDev = resolveGross(
      valor_horas_desenvolvimento_calculado,
      valor_horas_desenvolvimento,
      qty,
    );
    if (vDev > 0) {
      g.desenvolvimentoTotalBruto += resolveBrutoOriginal(
        valor_horas_desenvolvimento_original,
        vDev,
        qty,
      );
      g.desenvolvimentoTotalLiquido += vDev;
      g.desenvolvimentoHoras += parseFloat(horas_desenvolvimento || 0);
    }

    // Consultoria: mesmo modelo de treinamento/dev — valor base em
    // valor_horas_consultoria; a calculada correspondente (confirmada pelo
    // time) é valor_horas_contabeis_calculado.
    const vCons = resolveGross(
      valor_horas_contabeis_calculado,
      valor_horas_consultoria,
      qty,
    );
    if (vCons > 0) {
      g.consultoriaTotalBruto += resolveBrutoOriginal(
        valor_horas_consultoria_original,
        vCons,
        qty,
      );
      g.consultoriaTotalLiquido += vCons;
      g.consultoriaHoras += parseFloat(horas_consultoria || 0);
    }

    if (!g.tipoContrato && tipo_de_contrato) {
      g.tipoContrato = tipo_de_contrato;
    }
  }

  // Valor/h derivado por sistema (não há propriedade de valor unitário no CRM).
  // Deriva o par: o valor/h ORIGINAL (do bruto imutável) e o VIGENTE (do
  // líquido atual). As horas são as mesmas nos dois — mudar a quantidade de
  // horas nunca é desconto, então ela se cancela na razão entre eles.
  for (const values of Object.values(grouped)) {
    const perHour = (total, horas) => (horas > 0 ? total / horas : 0);

    values.treinamentoValorUnitario = perHour(
      values.treinamentoTotalBruto,
      values.treinamentoHoras,
    );
    values.treinamentoValorUnitarioLiquido = perHour(
      values.treinamentoTotalLiquido,
      values.treinamentoHoras,
    );
    values.desenvolvimentoValorUnitario = perHour(
      values.desenvolvimentoTotalBruto,
      values.desenvolvimentoHoras,
    );
    values.desenvolvimentoValorUnitarioLiquido = perHour(
      values.desenvolvimentoTotalLiquido,
      values.desenvolvimentoHoras,
    );
    values.consultoriaValorUnitario = perHour(
      values.consultoriaTotalBruto,
      values.consultoriaHoras,
    );
    values.consultoriaValorUnitarioLiquido = perHour(
      values.consultoriaTotalLiquido,
      values.consultoriaHoras,
    );
  }

  // Regra de negocio: CISPoder em Locacao recebe +40% sobre a mensalidade
  // TODO: Verificar os valores reais dos enums abaixo no HubSpot
  const SISTEMA_CISPODER = "cispoder"; // valor do enum nome_do_sistema para CISPoder
  const TIPO_CONTRATO_LOCACAO = "locacao"; // valor do enum tipo_de_contrato para Locacao
  for (const [sistema, values] of Object.entries(grouped)) {
    if (
      values.tipoContrato === TIPO_CONTRATO_LOCACAO &&
      sistema === SISTEMA_CISPODER
    ) {
      values.locacao = values.glt * 1.4;
      values.locacaoLiquido = values.gltLiquido * 1.4;
    }
  }

  return grouped;
};

exports.main = async (context) => {
  console.log(
    "[groupContracts] Iniciando função com parâmetros:",
    context.parameters,
  );

  const { dealId } = context.parameters;
  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${process.env.PRIVATE_APP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  console.log("dealId recebido:", dealId);

  if (!dealId) {
    return {
      statusCode: 400,
      body: { success: false, error: "dealId não encontrado nos parâmetros" },
    };
  }

  try {
    // Rodada 1 — chamadas independentes em paralelo
    const [{ pipelineId, dealName, discountDraft }, ids] = await Promise.all([
      fetchDealInfo(dealId, hubspotClient),
      fetchLineItemIds(dealId, hubspotClient),
    ]);

    // Alçada resolvida a partir do pipeline do deal (lookup síncrono).
    const alcada = resolveAlcada(pipelineId);

    // Rascunho de desconto salvo pelo operador (JSON no deal). Pode ser null
    // quando não há rascunho, ou ter o formato { savedAt, entries: [...] }.
    let draft = null;
    if (discountDraft) {
      try {
        const parsed = JSON.parse(discountDraft);
        if (Array.isArray(parsed)) {
          draft = { entries: parsed, savedAt: null };
        } else if (parsed && Array.isArray(parsed.entries)) {
          draft = { entries: parsed.entries, savedAt: parsed.savedAt ?? null };
        }
      } catch (err) {
        console.error("[groupContracts] discount_draft JSON inválido:", err.message);
      }
    }

    console.log(
      `[groupContracts] alcada: ${alcada} | pipeline: ${pipelineId} | deal: ${dealName} | ids: ${ids.length}`,
    );

    if (!ids.length) {
      const approver = await fetchApproverForPipeline(
        pipelineId,
        hubspotClient,
      );
      console.log("[groupContracts] aprovador:", JSON.stringify(approver));
      return {
        statusCode: 200,
        body: {
          success: true,
          data: {},
          alcada,
          approver,
          dealName,
          draft,
          missingTipoContrato: [],
          excluidos: 0,
        },
      };
    }
    console.log(`[groupContracts] IDs dos line items: ${ids.join(", ")}`);

    // Rodada 2 — dependem de pipelineId e ids, mas são independentes entre si
    const [approver, lineItems, labels] = await Promise.all([
      fetchApproverForPipeline(pipelineId, hubspotClient),
      fetchLineItemProperties(ids, hubspotClient),
      fetchPropertyLabels(hubspotClient),
    ]);

    console.log("[groupContracts] aprovador:", JSON.stringify(approver));
    console.log(
      "lineItems retornados:",
      JSON.stringify(lineItems.map((i) => i.properties)),
    );
    console.log("labels carregados:", JSON.stringify(labels));

    // Um item excluído sai da vista E da checagem de tipo_de_contrato: mantê-lo
    // no bloqueio desabilitaria "Executar Desconto" por um item que este card
    // não mostra e onde ninguém consegue preencher o campo que falta.
    const lineItemsElegiveis = lineItems.filter(isSistemaElegivel);
    console.log(
      `[groupContracts] itens elegíveis: ${lineItemsElegiveis.length} de ${lineItems.length}` +
        ` (excluídos os sistemas ${[...SISTEMAS_EXCLUIDOS].join(", ")})`,
    );

    const data = groupBySistema(lineItemsElegiveis, labels);
    console.log("data agrupado:", JSON.stringify(data));

    const missingTipoContrato = findMissingTipoContrato(
      lineItemsElegiveis,
      labels,
    );
    console.log(
      `[groupContracts] itens sem tipo_de_contrato: ${missingTipoContrato.length}`,
      JSON.stringify(missingTipoContrato),
    );

    return {
      statusCode: 200,
      body: {
        success: true,
        data,
        alcada,
        approver,
        dealName,
        draft,
        missingTipoContrato,
        // Quantos itens o filtro removeu. Só serve para o card distinguir
        // "deal sem item de linha" de "todos os itens são de outro card".
        excluidos: lineItems.length - lineItemsElegiveis.length,
      },
    };
  } catch (error) {
    console.error(
      "Erro ao processar os line items:",
      error?.response?.data || error.message,
    );

    return {
      statusCode: 500,
      body: { success: false, error: error.message },
    };
  }
};
