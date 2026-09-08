const axios = require("axios");

const fetchDealProperties = async (dealId, hubspotClient) => {
  const { data } = await hubspotClient.get(`/crm/v3/objects/deals/${dealId}`, {
    params: {
      properties: "pending_discounts,discounts_history",
    },
  });
  return data.properties;
};

const fetchSistemaLabels = async (hubspotClient) => {
  const { data } = await hubspotClient.get(
    "/crm/v3/properties/line_items/nome_do_sistema",
  );
  return (data.options || []).reduce((acc, option) => {
    acc[String(option.value)] = option.label;
    return acc;
  }, {});
};

const fetchDealPipeline = async (dealId, hubspotClient) => {
  const { data } = await hubspotClient.get(`/crm/v3/objects/deals/${dealId}`, {
    params: { properties: "pipeline" },
  });
  return data.properties.pipeline;
};

const fetchIsApprover = async (userEmail, pipelineId, hubspotClient) => {
  if (!userEmail) return false;
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
              {
                propertyName: "email",
                operator: "EQ",
                value: userEmail,
              },
            ],
          },
        ],
        properties: ["email", "aprovador_pipelines"],
        limit: 1,
      },
    );

    const contact = (data.results || [])[0];
    if (!contact) return false;

    const pipelines = (contact.properties.aprovador_pipelines || "")
      .split(",")
      .map((s) => s.trim());

    return pipelines.includes(String(pipelineId));
  } catch (err) {
    console.error(
      "[fetchDiscountApproval] erro ao verificar aprovador:",
      err.message,
    );
    return false;
  }
};

// Alçada (limite de desconto %) por pipeline. Pipelines não mapeados usam
// DEFAULT_THRESHOLD. Mantenha sincronizado com GroupContracts.js.
// TODO: confirmar os percentuais reais de cada pipeline com a área de negócio.
const DEFAULT_THRESHOLD = 10;
const PIPELINE_THRESHOLDS = {
  872876959: 10, // Franquia - SMB
  873229378: 10, // Franquia - Enterprise
  907963396: 10, // Expansão - Franquia
  872876956: 15, // PDV e Geral - SMB
  872876957: 15, // PDV e Geral - Enterprise
  911415619: 20, // Expansão - PDV e Geral
};

const resolveAlcada = (pipelineId) =>
  PIPELINE_THRESHOLDS[String(pipelineId)] ?? DEFAULT_THRESHOLD;

const safeParse = (raw, fallback) => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    console.error("[fetchDiscountApproval] JSON inválido:", err.message);
    return fallback;
  }
};

const enrichLabels = (entries, labels) =>
  entries.map((entry) => ({
    ...entry,
    label:
      entry.label || labels[String(entry.nomeDoSistema)] || entry.nomeDoSistema,
  }));

exports.main = async (context) => {
  const { dealId, userEmail } = context.parameters;

  console.log(
    "[fetchDiscountApproval] dealId:",
    dealId,
    "| userEmail:",
    userEmail,
  );

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

  try {
    const properties = await fetchDealProperties(dealId, hubspotClient);

    const pendingRaw = safeParse(properties.pending_discounts, []);
    const historyRaw = safeParse(properties.discounts_history, []);

    const [labels, pipelineId] = await Promise.all([
      fetchSistemaLabels(hubspotClient),
      fetchDealPipeline(dealId, hubspotClient),
    ]);

    // Alçada resolvida a partir do pipeline do deal (lookup síncrono).
    const alcada = resolveAlcada(pipelineId);

    const isApprover = await fetchIsApprover(
      userEmail,
      pipelineId,
      hubspotClient,
    );

    console.log(
      "[fetchDiscountApproval] isApprover:",
      isApprover,
      "| alcada:",
      alcada,
    );

    const pending = enrichLabels(pendingRaw, labels);
    const history = enrichLabels(historyRaw, labels);

    console.log(
      `[fetchDiscountApproval] pendentes: ${pending.length} | histórico: ${history.length}`,
    );

    return {
      statusCode: 200,
      body: { success: true, pending, history, isApprover, alcada },
    };
  } catch (error) {
    const detail = error?.response?.data || error.message;
    console.error("[fetchDiscountApproval] erro:", JSON.stringify(detail));
    return {
      statusCode: 500,
      body: {
        success: false,
        error: typeof detail === "string" ? detail : JSON.stringify(detail),
      },
    };
  }
};
