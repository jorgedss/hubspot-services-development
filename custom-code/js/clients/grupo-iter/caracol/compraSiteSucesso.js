const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - evento compra-site-sucesso (SIG).
//
// Contexto: action de custom code em um workflow cujo trigger é webhook. A
// chave de inscrição é o e-mail. O evento atualiza o CONTATO inscrito no
// workflow e faz UPSERT de um DEAL associado.
//
// O contato é identificado por event.object.objectId. O deal é resolvido pela
// propriedade `booking` (que recebe o cf_id_pedido); quando não existe, é
// criado no pipeline 927835212, estágio 1422040488. A associação contato->deal
// é feita após resolver/gravar os dois registros.
//
// O token de autenticação vem da secret HUBSPOT_TOKEN_INTEGRACAO_SIG, nunca
// hardcoded.
// ---------------------------------------------------------------------------

const PIPELINE_ID = "927835212";
const PIPELINE_STAGE_ID = "1422040488";

// Mapeamento por destino (contato e deal). Cada entrada aponta a propriedade de
// origem, a propriedade de destino, o tipo de conversão e (para depender de
// fallback) a fonte alternativa.
const CONTACT_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "state", to: "state", type: "text" },
  { from: "city", to: "city", type: "text" },
  { from: "country", to: "country", type: "text" },
  { from: "mobile_phone", to: "phone", type: "text" },
  { from: "cf_valor_pedido", to: "cf_valor_pedido", type: "number" },
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date", dateFormat: "DD-MM-YYYY" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_accept_communication", to: "aceite_receber_comunicacoes_bondinho", type: "checkbox" },
  { from: "cf_date_visit_expected", to: "cf_data_visita", type: "date", dateFormat: "DD-MM-YYYY" },
  { from: "cf_language", to: "cf_language", type: "text" },
  { from: "cf_brand_card", to: "cf_brand_card", type: "text" },
  { from: "cf_product", to: "cf_produto", type: "json" },
];

const DEAL_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email_do_contato_principal", type: "text" },
  { from: "name", to: "dealname", type: "text", fallbackFrom: "cf_id_pedido" },
  { from: "state", to: "state", type: "text" },
  { from: "city", to: "cidade", type: "text" },
  { from: "country", to: "country", type: "text" },
  { from: "mobile_phone", to: "phone", type: "text" },
  { from: "cf_valor_pedido", to: "amount", type: "number" },
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date", dateFormat: "DD-MM-YYYY" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_accept_communication", to: "aceite_receber_comunicacoes_bondinho", type: "checkbox" },
  { from: "cf_date_visit_expected", to: "data_da_visita", type: "date", dateFormat: "DD-MM-YYYY" },
  { from: "cf_language", to: "lingua", type: "text" },
  { from: "cf_brand_card", to: "cf_brand_card", type: "text" },
  { from: "cf_product", to: "cf_produto", type: "json" },
];

const FALSE_WORDS = new Set(["false", "0", "nao", "não"]);

// Converte SIM/NÃO (e variações) em booleano. Valores que indicam negação viram
// false; qualquer outro valor preenchido vira true. Vazio/nulo não é gravado.
const toBoolean = (valor) => {
  if (typeof valor === "boolean") return valor;
  if (valor == null || valor === "") return null;
  const normalizedValue = String(valor).trim().toLowerCase();
  if (FALSE_WORDS.has(normalizedValue)) return false;
  return true;
};

const toNumber = (valor) => {
  if (valor == null || valor === "") return null;
  const numericValue = Number(String(valor).replace(",", "."));
  return Number.isFinite(numericValue) ? numericValue : null;
};

const padNumber = (number) => String(number).padStart(2, "0");

// Extrai dia, mês e ano de uma data no formato DD-MM-YYYY (hífen).
const parseDateComponents = (raw) => {
  const dateMatch = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})/.exec(String(raw || ""));
  if (!dateMatch) return null;
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year };
};

// Converte uma data local DD-MM-YYYY para YYYY-MM-DD.
const toDateString = (raw) => {
  const components = parseDateComponents(raw);
  if (!components) return null;
  const { day, month, year } = components;
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
};

// Serializa um valor estruturado para JSON. Quando o valor já é uma string
// (cenário real: o input field entrega cf_product como string JSON pronta), a
// string é gravada como está; quando é array/objeto, é serializada.
const toJsonString = (valor) => {
  if (valor == null || valor === "") return null;
  if (typeof valor === "string") return valor;
  return JSON.stringify(valor);
};

// Aplica a conversão de tipo para um campo, respeitando fallbackFrom quando o
// valor principal estiver vazio.
const convertField = (field, payload) => {
  let valor = payload[field.from];
  if ((valor == null || valor === "") && field.fallbackFrom) {
    valor = payload[field.fallbackFrom];
  }

  switch (field.type) {
    case "checkbox":
      return toBoolean(valor);
    case "number":
      return toNumber(valor);
    case "date":
      return toDateString(valor);
    case "json":
      return toJsonString(valor);
    default:
      return valor == null || valor === "" ? null : String(valor);
  }
};

// Monta o objeto de propriedades a partir de uma lista de campos, aplicando as
// conversões e ignorando campos vazios.
const buildProperties = (fields, payload) => {
  const properties = {};
  for (const field of fields) {
    const converted = convertField(field, payload);
    if (converted != null) properties[field.to] = converted;
  }
  return properties;
};

exports.main = async (event, callback) => {
  const respond = (payload) =>
    callback({
      outputFields: {
        status: "erro",
        contact_id: "",
        deal_id: "",
        erro: "",
        ...payload,
      },
    });

  // Propriedades do webhook expostas como input fields.
  const payload = event.inputFields || {};

  // O contato inscrito no workflow já está resolvido.
  const contactId = String(event.object?.objectId || "");
  if (!contactId) {
    return respond({ erro: "Record id do contato ausente no evento (event.object.objectId)." });
  }

  const bookingKey = String(payload.cf_id_pedido || "").trim();
  if (!bookingKey) {
    return respond({ erro: "Campo cf_id_pedido ausente ou vazio no payload. Não é possível resolver o deal." });
  }

  console.log(
    `[compraSiteSucesso] contato ${contactId} | booking ${bookingKey}`,
  );

  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN_INTEGRACAO_SIG}`,
      "Content-Type": "application/json",
    },
    timeout: 18000,
  });

  const contactProperties = buildProperties(CONTACT_FIELDS, payload);
  const dealProperties = buildProperties(DEAL_FIELDS, payload);

  try {
    // 1. Atualiza o contato.
    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties: contactProperties,
      }),
    );

    // 2. Resolve o deal pela propriedade booking.
    const dealId = await withStep("resolverDeal", () =>
      findDealByBooking(bookingKey, hubspotClient),
    );

    let resolvedDealId;
    if (dealId) {
      await withStep("atualizarDeal", () =>
        hubspotClient.patch(`/crm/v3/objects/deals/${dealId}`, {
          properties: dealProperties,
        }),
      );
      resolvedDealId = dealId;
    } else {
      resolvedDealId = await withStep("criarDeal", () =>
        createDeal(dealProperties, hubspotClient),
      );
    }

    // 3. Garante a associação contato -> deal.
    await withStep("associarContatoDeal", () =>
      associateContactDeal(contactId, resolvedDealId, hubspotClient),
    );

    console.log(
      `[compraSiteSucesso] contato ${contactId} atualizado; deal ${resolvedDealId}`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      deal_id: resolvedDealId,
    });
  } catch (error) {
    const message = buildErrorMessage(error);
    console.error("[compraSiteSucesso] error:", message);
    return respond({ erro: message });
  }
};

// --- helpers de HubSpot -----------------------------------------------------

const findDealByBooking = async (bookingKey, hubspotClient) => {
  const { data } = await hubspotClient.post("/crm/v3/objects/deals/search", {
    filterGroups: [
      { filters: [{ propertyName: "booking", operator: "EQ", value: bookingKey }] },
    ],
    properties: ["booking"],
    limit: 1,
  });
  const deal = (data.results || [])[0];
  return deal ? deal.id : null;
};

const createDeal = async (properties, hubspotClient) => {
  const { data } = await hubspotClient.post("/crm/v3/objects/deals", {
    properties: {
      pipeline: PIPELINE_ID,
      dealstage: PIPELINE_STAGE_ID,
      ...properties,
    },
  });
  return data.id;
};

const associateContactDeal = async (contactId, dealId, hubspotClient) => {
  await hubspotClient.put(
    `/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`,
  );
};

// --- helpers ---------------------------------------------------------------

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
