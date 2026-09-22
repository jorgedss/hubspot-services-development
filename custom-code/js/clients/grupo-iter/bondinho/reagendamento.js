const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU Bondinho - evento reagendamento (SIG).
//
// Contexto: action de custom code em um workflow cujo trigger é webhook. O
// evento apenas atualiza o DEAL inscrito no workflow (event.object.objectId é o
// id do deal) e o CONTATO associado (resolvido pelo e-mail), com as informações
// do reagendamento. Não move o estágio do deal.
//
// O contato é resolvido pelo e-mail via API search, e o deal vem pronto em
// event.object.objectId.
//
// Cada unidade de negócio tem uma brand: a propriedade
// hs_all_assigned_business_unit_ids recebe o id da BU Bondinho (4554145) tanto
// no contato quanto no deal.
//
// Regras de conversão específicas deste evento:
//   - cf_data_visita (contato, datetime) combina cf_date_visit_expected +
//     cf_hora_visita (horário local BR, UTC-3).
//   - data_da_visita (deal, date) usa apenas cf_date_visit_expected.
//   - cf_data_visita_anterior: DD-MM-YYYY -> YYYY-MM-DD.
//   - cf_bilhetes: string com os IDs, gravada como recebida.
//
// O token vem da secret HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG, nunca hardcoded.
// ---------------------------------------------------------------------------

const BUSINESS_UNIT_ID = "4554145";

const CONTACT_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_date_visit_expected", to: "cf_data_visita", type: "datetime", timeField: "cf_hora_visita" },
  { from: "cf_data_visita_anterior", to: "cf_data_visita_anterior", type: "date" },
  { from: "cf_product", to: "cf_produto", type: "text" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_bilhetes", to: "cf_bilhetes", type: "text" },
];

const DEAL_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email_do_contato_principal", type: "text" },
  { from: "name", to: "dealname", type: "text", fallbackFrom: "cf_id_pedido" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_date_visit_expected", to: "data_da_visita", type: "date" },
  { from: "cf_data_visita_anterior", to: "cf_data_visita_anterior", type: "date" },
  { from: "cf_product", to: "cf_produto", type: "text" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_bilhetes", to: "cf_bilhetes", type: "text" },
];

const toNumber = (valor) => {
  if (valor == null || valor === "") return null;
  const numericValue = Number(String(valor).replace(",", "."));
  return Number.isFinite(numericValue) ? numericValue : null;
};

const padNumber = (number) => String(number).padStart(2, "0");

// DD-MM-YYYY -> YYYY-MM-DD.
const toDateString = (raw) => {
  const match = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})/.exec(String(raw || ""));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
};

// Combina uma data DD-MM-YYYY com um horário "HH:mm" (horário local BR, UTC-3)
// e devolve timestamp em ms (UTC), para a propriedade datetime do contato.
const toDateTimeMs = (rawDate, rawTime) => {
  const match = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})/.exec(String(rawDate || ""));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const timeMatch = /^\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(String(rawTime || ""));
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const second = timeMatch && timeMatch[3] ? Number(timeMatch[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;

  return Date.UTC(year, month - 1, day, hour, minute, second) + 3 * 60 * 60 * 1000;
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
    case "datetime":
      return toDateTimeMs(valor, payload[field.timeField]);
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

  // No reagendamento, o objeto inscrito no workflow é o DEAL, não o contato.
  const dealId = String(event.object?.objectId || "");
  if (!dealId) {
    throw new Error("Record id do deal ausente no evento (event.object.objectId).");
  }

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Campo email ausente ou vazio no payload. Não é possível resolver o contato.");
  }

  console.log(
    `[bondinhoReagendamento] deal ${dealId} | email ${email}`,
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
    const contactId = await withStep("resolverContato", () =>
      findContactByEmail(email, hubspotClient),
    );

    if (!contactId) {
      throw new Error(`Contato ${email} não encontrado no portal.`);
    }

    await withStep("atualizarDeal", () =>
      hubspotClient.patch(`/crm/v3/objects/deals/${dealId}`, {
        properties: dealProperties,
      }),
    );

    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties: contactProperties,
      }),
    );

    await withStep("associarContatoDeal", () =>
      associateContactDeal(contactId, dealId, hubspotClient),
    );

    console.log(
      `[bondinhoReagendamento] deal ${dealId} e contato ${contactId} atualizados`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      deal_id: dealId,
    });
  } catch (error) {
    console.error("[bondinhoReagendamento] error:", buildErrorMessage(error));
    throw error;
  }
};

// --- helpers de HubSpot -----------------------------------------------------

const findContactByEmail = async (email, hubspotClient) => {
  const { data } = await hubspotClient.post("/crm/v3/objects/contacts/search", {
    filterGroups: [
      { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
    ],
    properties: ["email"],
    limit: 1,
  });
  const contact = (data.results || [])[0];
  return contact ? contact.id : null;
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
