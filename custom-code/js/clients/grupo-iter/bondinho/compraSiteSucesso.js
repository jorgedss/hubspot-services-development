const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU Bondinho - evento compra-site-sucesso (SIG).
//
// Contexto: action de custom code em um workflow cujo trigger é webhook. A
// chave de inscrição é o e-mail. O evento atualiza o CONTATO inscrito no
// workflow e faz UPSERT de um DEAL associado.
//
// O contato é identificado por event.object.objectId. O deal é resolvido pela
// propriedade `booking` (que recebe o cf_id_pedido); quando não existe, é
// criado no pipeline 927835212 (Venda de Bilhete), estágio 1422040488 (Venda
// realizada). A associação contato->deal é feita após resolver/gravar os dois
// registros.
//
// Cada unidade de negócio tem uma brand: o DEAL recebe a BU Bondinho (4554145)
// como valor único na propriedade hs_all_assigned_business_unit_ids. O contato
// não recebe atualização de business unit neste evento.
//
// Regras de conversão específicas deste evento:
//   - cf_typepayments: "3" vira "Cartão"; qualquer outro valor vira "Pix".
//   - cf_accept_communication: Sim/SIM/1/true -> true; qualquer outro -> false.
//   - cf_socio: true/sim/1 -> true; false/não/0 -> false (dropdown true/false).
//   - cf_crianca: > 0 -> true; vazio/0/null -> false (tem criança ou não).
//
// O token de autenticação vem da secret HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG,
// nunca hardcoded.
// ---------------------------------------------------------------------------

const PIPELINE_ID = "927835212";
const PIPELINE_STAGE_ID = "1422040488";
const BUSINESS_UNIT_ID = "4554145";

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
  { from: "cf_typepayments", to: "cf_typepayments", type: "payments" },
  { from: "cf_status_item", to: "status_item", type: "text" },
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date", dateFormat: "DD-MM-YYYY" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_accept_communication", to: "aceite_receber_comunicacoes_bondinho", type: "acceptance" },
  { from: "cf_date_visit_expected", to: "cf_data_visita", type: "date", dateFormat: "DD-MM-YYYY" },
  { from: "cf_lingua", to: "cf_language", type: "text" },
  { from: "cf_product", to: "cf_produto", type: "text" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_crianca", to: "cf_comprou_crianca", type: "childFlag" },
  { from: "cf_socio", to: "cf_socio", type: "booleanDropdown" },
  { from: "cf_brand_card", to: "cf_brand_card", type: "text" },
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
  { from: "cf_typepayments", to: "cf_typepayments", type: "payments" },
  { from: "cf_status_item", to: "status_item", type: "text" },
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date", dateFormat: "DD-MM-YYYY" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_accept_communication", to: "aceite_receber_comunicacoes_bondinho", type: "acceptance" },
  { from: "cf_date_visit_expected", to: "data_da_visita", type: "date", dateFormat: "DD-MM-YYYY" },
  { from: "cf_lingua", to: "idioma", type: "idioma" },
  { from: "cf_product", to: "cf_produto", type: "text" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_crianca", to: "cf_crianca", type: "childFlag" },
  { from: "cf_socio", to: "cf_socio", type: "booleanDropdown" },
  { from: "cf_brand_card", to: "cf_brand_card", type: "text" },
];

const FALSE_WORDS = new Set(["false", "0", "nao", "não"]);
const TRUE_WORDS = new Set(["true", "sim", "s", "y", "yes", "1"]);

// Aceites: trata Sim/SIM/1/true como true; qualquer outro valor preenchido é
// false (a regra do evento é "1 = Sim, demais = Não").
const toAcceptance = (valor) => {
  if (typeof valor === "boolean") return valor;
  if (valor == null || valor === "") return null;
  const normalizedValue = String(valor).trim().toLowerCase();
  if (TRUE_WORDS.has(normalizedValue)) return true;
  return false;
};

// Dropdown true/false (cf_socio): true/sim/1 -> true; false/não/0 -> false.
const toBooleanDropdown = (valor) => {
  if (typeof valor === "boolean") return valor;
  if (valor == null || valor === "") return null;
  const normalizedValue = String(valor).trim().toLowerCase();
  if (TRUE_WORDS.has(normalizedValue)) return true;
  if (FALSE_WORDS.has(normalizedValue)) return false;
  return null;
};

// cf_typepayments: "3" -> "Cartão"; "Cartão"/"Cartao" -> "Cartão"; qualquer
// outro valor (incluindo "Pix") -> "Pix".
const toPayments = (valor) => {
  if (valor == null || valor === "") return null;
  const normalizedValue = String(valor)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (normalizedValue === "3" || normalizedValue === "cartao") return "Cartão";
  return "Pix";
};

// cf_crianca: maior que 0 -> true; vazio/0 -> false (indica se tem criança).
const toChildFlag = (valor) => {
  const numericValue = parseFloat(valor);
  if (Number.isFinite(numericValue) && numericValue > 0) return true;
  if (valor == null || valor === "") return false;
  if (Number.isFinite(numericValue) && numericValue <= 0) return false;
  return false;
};

const toNumber = (valor) => {
  if (valor == null || valor === "") return null;
  const numericValue = Number(String(valor).replace(",", "."));
  return Number.isFinite(numericValue) ? numericValue : null;
};

const padNumber = (number) => String(number).padStart(2, "0");

const parseDateComponents = (raw) => {
  const dateMatch = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})/.exec(String(raw || ""));
  if (!dateMatch) return null;
  const day = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { day, month, year };
};

const toDateString = (raw) => {
  const components = parseDateComponents(raw);
  if (!components) return null;
  const { day, month, year } = components;
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
    case "acceptance":
      return toAcceptance(valor);
    case "booleanDropdown":
      return toBooleanDropdown(valor);
    case "payments":
      return toPayments(valor);
    case "childFlag":
      return toChildFlag(valor);
    case "number":
      return toNumber(valor);
    case "idioma":
      return toIdioma(valor);
    case "date":
      return toDateString(valor);
    default:
      return valor == null || valor === "" ? null : String(valor);
  }
};

// Monta as propriedades do CONTATO sem a business unit: ela é resolvida no
// fluxo principal por append, para que o contato acumule as BUs das marcas.
const buildContactProperties = (fields, payload) => {
  const properties = {};
  for (const field of fields) {
    const converted = convertField(field, payload);
    if (converted != null) properties[field.to] = converted;
  }
  return properties;
};

// Monta as propriedades do DEAL com a business unit da marca como valor único.
const buildDealProperties = (fields, payload) => {
  const properties = {};
  for (const field of fields) {
    const converted = convertField(field, payload);
    if (converted != null) properties[field.to] = converted;
  }
  // A brand da unidade de negócio é obrigatória no deal.
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

  console.log(
    `[bondinhoCompraSiteSucesso] contato ${contactId} | booking ${bookingKey}`,
  );

  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG}`,
      "Content-Type": "application/json",
    },
    timeout: 18000,
  });

  const contactProperties = buildContactProperties(CONTACT_FIELDS, payload);
  const dealProperties = buildDealProperties(DEAL_FIELDS, payload);

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
      `[bondinhoCompraSiteSucesso] contato ${contactId} atualizado; deal ${resolvedDealId}`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      deal_id: resolvedDealId,
    });
  } catch (error) {
    console.error("[bondinhoCompraSiteSucesso] error:", buildErrorMessage(error));
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
