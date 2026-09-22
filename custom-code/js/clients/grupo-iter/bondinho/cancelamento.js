const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU Bondinho - evento cancelamento (SIG).
//
// Contexto: action de custom code em um workflow cujo trigger é webhook. A
// chave de inscrição é o e-mail. O evento atualiza o CONTATO inscrito no
// workflow e faz UPSERT de um DEAL associado (chave única = booking), com uma
// regra de estágio baseada em cf_quantity_restante.
//
// Regra de negócio:
//   - Se cf_quantity_restante <= 0: move o deal para a etapa Perdido
//     (1422054714) e grava motivo_de_perda "Cancelamento".
//   - Se cf_quantity_restante > 0: mantém o deal no estágio atual e atualiza
//     quantidade_de_bilhetes = cf_quantity_restante e amount = cf_valor_restante.
//
// O contato é identificado por event.object.objectId. O deal é resolvido pela
// propriedade `booking` (que recebe o cf_id_pedido). A associação contato->deal
// é feita após gravar os dois registros.
//
// Cada unidade de negócio tem uma brand: a propriedade
// hs_all_assigned_business_unit_ids recebe o id da BU Bondinho (4554145) tanto
// no contato quanto no deal.
//
// Campos de cancelamento (deal): cf_motivo_cancelamento, cf_valor_reembolso,
// cf_quantity_cancelada, cf_quantity_restante, cf_valor_restante, cf_bilhetes.
//
// O token vem da secret HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG, nunca hardcoded.
// ---------------------------------------------------------------------------

const PIPELINE_ID = "927835212";
const STAGE_LOST = "1422054714";
const LOSS_REASON = "Cancelamento";
const BUSINESS_UNIT_ID = "4554145";

const CONTACT_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "mobile_phone", to: "phone", type: "text" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date" },
  { from: "cf_date_visit_expected", to: "cf_data_visita", type: "date" },
  { from: "cf_product", to: "cf_produto", type: "text" },
  { from: "cf_language", to: "cf_language", type: "text" },
  { from: "cf_motivo_cancelamento", to: "cf_motivo_cancelamento", type: "text" },
  { from: "cf_valor_reembolso", to: "cf_valor_reembolso", type: "number" },
  { from: "cf_quantity_cancelada", to: "cf_quantity_cancelada", type: "number" },
  { from: "cf_quantity_restante", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_valor_restante", to: "cf_valor_pedido", type: "number" },
  { from: "cf_bilhetes", to: "cf_bilhetes", type: "text" },
];

const DEAL_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email_do_contato_principal", type: "text" },
  { from: "name", to: "dealname", type: "text", fallbackFrom: "cf_id_pedido" },
  { from: "mobile_phone", to: "phone", type: "text" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date" },
  { from: "cf_date_visit_expected", to: "data_da_visita", type: "date" },
  { from: "cf_product", to: "cf_produto", type: "text" },
  { from: "cf_language", to: "idioma", type: "idioma" },
  { from: "cf_motivo_cancelamento", to: "cf_motivo_cancelamento", type: "text" },
  { from: "cf_valor_reembolso", to: "cf_valor_reembolso", type: "number" },
  { from: "cf_quantity_cancelada", to: "cf_quantity_cancelada", type: "number" },
  { from: "cf_quantity_restante", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_valor_restante", to: "amount", type: "number" },
  { from: "cf_bilhetes", to: "cf_bilhetes", type: "text" },
];

const toNumber = (valor) => {
  if (valor == null || valor === "") return null;
  const numericValue = Number(String(valor).replace(",", "."));
  return Number.isFinite(numericValue) ? numericValue : null;
};

const padNumber = (number) => String(number).padStart(2, "0");

const toDateString = (raw) => {
  const match = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})/.exec(String(raw || ""));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
};

// cf_language -> idioma (dropdown ingles/portugues/espanhol).
const toIdioma = (valor) => {
  if (valor == null || valor === "") return null;
  const normalizedValue = String(valor)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["br", "pt", "pt-br", "ptbr", "portugues", "portuguese"].includes(normalizedValue)) {
    return "portugues";
  }
  if (["en", "en-us", "ingles", "english"].includes(normalizedValue)) {
    return "ingles";
  }
  if (["es", "espanhol", "spanish"].includes(normalizedValue)) {
    return "espanhol";
  }
  return null;
};

const convertField = (field, payload) => {
  let valor = payload[field.from];
  if ((valor == null || valor === "") && field.fallbackFrom) {
    valor = payload[field.fallbackFrom];
  }

  switch (field.type) {
    case "number":
      return toNumber(valor);
    case "date":
      return toDateString(valor);
    case "idioma":
      return toIdioma(valor);
    default:
      return valor == null || valor === "" ? null : String(valor);
  }
};

const buildProperties = (fields, payload) => {
  const properties = {};
  for (const field of fields) {
    const converted = convertField(field, payload);
    if (converted != null) properties[field.to] = converted;
  }
  properties["hs_all_assigned_business_unit_ids"] = BUSINESS_UNIT_ID;
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

  const payload = event.inputFields || {};

  const contactId = String(event.object?.objectId || "");
  if (!contactId) {
    throw new Error("Record id do contato ausente no evento (event.object.objectId).");
  }

  const bookingKey = String(payload.cf_id_pedido || "").trim();
  if (!bookingKey) {
    throw new Error("Campo cf_id_pedido ausente ou vazio no payload. Não é possível resolver o deal.");
  }

  const quantityRestante = toNumber(payload.cf_quantity_restante);
  if (quantityRestante == null) {
    throw new Error("Campo cf_quantity_restante ausente ou inválido no payload.");
  }

  const perdeuTodoBilhete = quantityRestante <= 0;

  console.log(
    `[bondinhoCancelamento] contato ${contactId} | booking ${bookingKey} | restante ${quantityRestante} | perdido: ${perdeuTodoBilhete}`,
  );

  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG}`,
      "Content-Type": "application/json",
    },
    timeout: 18000,
  });

  const contactProperties = buildProperties(CONTACT_FIELDS, payload);
  const dealProperties = buildProperties(DEAL_FIELDS, payload);

  try {
    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties: contactProperties,
      }),
    );

    const dealId = await withStep("resolverDeal", () =>
      findDealByBooking(bookingKey, hubspotClient),
    );

    // Cancelamento pressupõe um deal já existente (criado pela compra).
    if (!dealId) {
      throw new Error(`Deal com booking ${bookingKey} não encontrado. Não é possível cancelar um deal inexistente.`);
    }

    // Define o estágio e o payload de gravação conforme a regra de negócio.
    let dealToWrite;
    if (perdeuTodoBilhete) {
      dealToWrite = {
        ...dealProperties,
        pipeline: PIPELINE_ID,
        dealstage: STAGE_LOST,
        motivo_de_perda: LOSS_REASON,
      };
    } else {
      dealToWrite = {
        ...dealProperties,
        quantidade_de_bilhetes: quantityRestante,
        amount: toNumber(payload.cf_valor_restante),
      };
    }

    await withStep("atualizarDeal", () =>
      hubspotClient.patch(`/crm/v3/objects/deals/${dealId}`, {
        properties: dealToWrite,
      }),
    );

    await withStep("associarContatoDeal", () =>
      associateContactDeal(contactId, dealId, hubspotClient),
    );

    console.log(
      `[bondinhoCancelamento] contato ${contactId} atualizado; deal ${dealId} ${perdeuTodoBilhete ? "na etapa Perdido" : "mantido no estágio"}`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      deal_id: dealId,
    });
  } catch (error) {
    console.error("[bondinhoCancelamento] error:", buildErrorMessage(error));
    throw error;
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
