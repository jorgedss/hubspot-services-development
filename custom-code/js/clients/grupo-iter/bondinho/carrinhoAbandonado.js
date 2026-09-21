const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU Bondinho - evento carrinho-abandonado (SIG).
//
// Contexto: action de custom code em um workflow cujo trigger é webhook. A
// chave de inscrição é o e-mail. O evento cria/atualiza o CONTATO inscrito no
// workflow e SEMPRE cria um novo DEAL na etapa Perdido, com motivo de perda
// "Carrinho abandonado".
//
// Não há booking nesse evento: o deal é criado sem chave de deduplicação e
// nunca é atualizado em eventos futuros (cada abandono gera um novo deal).
//
// O contato é identificado por event.object.objectId. O deal é criado no
// pipeline 927835212 (Venda de Bilhete), estágio 1422054714 (Perdido), com
// motivo_de_perda "Carrinho abandonado". A associação contato->deal é feita
// após gravar os dois registros.
//
// Cada unidade de negócio tem uma brand: a propriedade
// hs_all_assigned_business_unit_ids recebe o id da BU Bondinho (4554145) tanto
// no contato quanto no deal.
//
// Regras de conversão específicas deste evento:
//   - cf_data_de_nascimento: DD/MM/YYYY -> YYYY-MM-DD.
//   - cf_data_visita: DD/MM/YY (ou DD/MM/YYYY) -> YYYY-MM-DD.
//
// O token de autenticação vem da secret HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG,
// nunca hardcoded.
// ---------------------------------------------------------------------------

const PIPELINE_ID = "927835212";
const PIPELINE_STAGE_ID = "1422054714";
const LOSS_REASON = "Carrinho abandonado";
const BUSINESS_UNIT_ID = "4554145";

const CONTACT_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "cf_data_de_nascimento", to: "data_de_nascimento", type: "date" },
  { from: "cf_cep", to: "zip", type: "text" },
  { from: "cf_cpf", to: "cpf", type: "text" },
  { from: "city", to: "city", type: "text" },
  { from: "state", to: "state", type: "text" },
  { from: "country", to: "country", type: "text" },
  { from: "cf_data_visita", to: "data_do_envio", type: "dateVisit" },
  { from: "cf_produto", to: "cf_produto", type: "text" },
  { from: "cf_order_payment_amount", to: "valor_carrinho_abandonado", type: "number" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_lingua", to: "cf_language", type: "text" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
];

const DEAL_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email_do_contato_principal", type: "text" },
  { from: "name", to: "dealname", type: "text", fallbackFrom: "email" },
  { from: "cf_data_de_nascimento", to: "data_do_nascimento", type: "date" },
  { from: "cf_cep", to: "cep_zip_code", type: "text" },
  { from: "cf_cpf", to: "cpf", type: "text" },
  { from: "city", to: "cidade", type: "text" },
  { from: "state", to: "state", type: "text" },
  { from: "country", to: "country", type: "text" },
  { from: "cf_data_visita", to: "data_do_envio", type: "dateVisit" },
  { from: "cf_produto", to: "cf_produto", type: "text" },
  { from: "cf_order_payment_amount", to: "amount", type: "number" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_lingua", to: "idioma", type: "idioma" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
];

const toNumber = (valor) => {
  if (valor == null || valor === "") return null;
  const numericValue = Number(String(valor).replace(",", "."));
  return Number.isFinite(numericValue) ? numericValue : null;
};

const padNumber = (number) => String(number).padStart(2, "0");

// cf_data_de_nascimento: DD/MM/YYYY -> YYYY-MM-DD.
const toDateString = (raw) => {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(raw || ""));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
};

// cf_data_visita: DD/MM/YY ou DD/MM/YYYY -> YYYY-MM-DD. Quando o ano vem com
// dois dígitos, assume 2000+ano (ex.: 26 -> 2026).
const toDateVisitString = (raw) => {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(String(raw || ""));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
};

// cf_lingua -> idioma (dropdown ingles/portugues/espanhol). Desconhecido ou
// vazio retorna null (não grava).
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
    case "dateVisit":
      return toDateVisitString(valor);
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
    return respond({ erro: "Record id do contato ausente no evento (event.object.objectId)." });
  }

  console.log(`[bondinhoCarrinhoAbandonado] contato ${contactId}`);

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
    // 1. Atualiza o contato.
    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties: contactProperties,
      }),
    );

    // 2. Sempre cria um novo deal na etapa Perdido (sem booking).
    const dealToWrite = {
      ...dealProperties,
      pipeline: PIPELINE_ID,
      dealstage: PIPELINE_STAGE_ID,
      motivo_de_perda: LOSS_REASON,
    };

    const resolvedDealId = await withStep("criarDeal", () =>
      createDeal(dealToWrite, hubspotClient),
    );

    // 3. Associa contato -> deal.
    await withStep("associarContatoDeal", () =>
      associateContactDeal(contactId, resolvedDealId, hubspotClient),
    );

    console.log(
      `[bondinhoCarrinhoAbandonado] contato ${contactId} atualizado; deal ${resolvedDealId} na etapa Perdido`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      deal_id: resolvedDealId,
    });
  } catch (error) {
    const message = buildErrorMessage(error);
    console.error("[bondinhoCarrinhoAbandonado] error:", message);
    return respond({ erro: message });
  }
};

// --- helpers de HubSpot -----------------------------------------------------

const createDeal = async (properties, hubspotClient) => {
  const { data } = await hubspotClient.post("/crm/v3/objects/deals", {
    properties,
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
