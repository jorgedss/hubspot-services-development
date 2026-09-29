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
// recebe a brand da marca via APPEND (a constante ACTIVE.businessUnits.Bondinho
// é adicionada ao valor atual sem sobrescrever).
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

// Ambiente da execução. Trocar manualmente para "production" no deploy.
const ENV = "sandbox";

const CONFIG = {
  sandbox: {
    businessUnits: { Bondinho: "4554145", Caracol: "4554143", C2Rio: "4554144" },
    pipeline: { id: "927835212", stageWon: "1422040488", stageLost: "1422054714" },
  },
  production: {
    businessUnits: { Bondinho: "4292163", Caracol: "4275397", C2Rio: "4344366" },
    pipeline: { id: "927835212", stageWon: "1422040488", stageLost: "1422054714" },
  },
};

const ACTIVE = CONFIG[ENV];

const CONTACT_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "state", to: "state", type: "text" },
  { from: "city", to: "city", type: "text" },
  { from: "country", to: "country", type: "text" },
  { from: "mobile_phone", to: "phone", type: "phone" },
  { from: "cf_valor_pedido", to: "cf_valor_pedido", type: "number" },
  { from: "cf_typepayments", to: "cf_typepayments", type: "payments" },
  { from: "cf_status_item", to: "status_item", type: "text" },
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date", dateFormat: "DD-MM-YYYY" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_accept_communication", to: "aceite_receber_comunicacoes_bondinho", type: "acceptance" },
  { from: "cf_date_visit_expected", to: "cf_data_visita", type: "datetime" },
  { from: "cf_lingua", to: "idioma_cloned", type: "idioma" },
  { from: "cf_product", to: "cf_produto", type: "text" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_crianca", to: "cf_comprou_crianca", type: "childFlag" },
  { from: "cf_socio", to: "cf_socio", type: "booleanDropdown" },
  { from: "cf_brand_card", to: "cf_brand_card", type: "text" },
  { from: "cf_data_hora_visita", to: "cf_data_hora_visita", type: "datetimeISO" },
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
  { from: "mobile_phone", to: "phone", type: "phone" },
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
  { from: "cf_data_hora_visita", to: "cf_data_hora_visita", type: "datetimeISO" },
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

const PHONE_COUNTRY_CODES = {
  // Brasil, América Latina e Caribe
  br: "55", ar: "54", bo: "591", cl: "56", co: "57", cr: "506",
  cu: "53", do: "1", ec: "593", sv: "503", gt: "502", ht: "509",
  hn: "504", jm: "1", mx: "52", ni: "505", pa: "507", py: "595",
  pe: "51", pr: "1", uy: "598", ve: "58",
  // Estados Unidos e Canadá
  us: "1", ca: "1",
  // Europa
  al: "355", ad: "376", at: "43", by: "375", be: "32", ba: "387",
  bg: "359", hr: "385", cy: "357", cz: "420", dk: "45", ee: "372",
  fi: "358", fr: "33", de: "49", gr: "30", hu: "36", is: "354",
  ie: "353", it: "39", xk: "383", lv: "371", li: "423", lt: "370",
  lu: "352", mt: "356", md: "373", mc: "377", me: "382", nl: "31",
  mk: "389", no: "47", pl: "48", pt: "351", ro: "40", ru: "7",
  sm: "378", rs: "381", sk: "421", si: "386", es: "34", se: "46",
  ch: "41", tr: "90", ua: "380", gb: "44", va: "39",
};

const getPhoneCode = (countryCode) => {
  const normalizedCountry = String(countryCode || "").trim().toLowerCase();
  if (!normalizedCountry) return null;
  return PHONE_COUNTRY_CODES[normalizedCountry] || null;
};

// Normaliza telefone para E.164. No Brasil, garante DDD + 9 + número.
const toPhone = (valor, country) => {
  if (valor == null || valor === "") return null;
  const originalValue = String(valor).trim();
  const countryCode = getPhoneCode(country);
  if (!countryCode) return originalValue;

  let digits = originalValue.replace(/\D/g, "");
  if (digits.startsWith(countryCode)) digits = digits.slice(countryCode.length);

  if (countryCode === "55" && digits.length === 10) {
    digits = `${digits.slice(0, 2)}9${digits.slice(2)}`;
  }

  const normalizedPhone = `+${countryCode}${digits}`;
  console.log(
    `[bondinhoCompraSiteSucesso] telefone normalizado | país=${country} | recebido=${originalValue} | enviado=${normalizedPhone}`,
  );
  return normalizedPhone;
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

// Data sem horário: usa 12:00 no fuso de São Paulo (UTC-3), evitando mudança
// de dia quando a HubSpot exibe a propriedade datetime.
const toDateTimeIsoMs = (raw) => {
  const timestamp = Date.parse(String(raw || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
};

const toDateTimeMs = (raw) => {
  const components = parseDateComponents(raw);
  if (!components) return null;
  const { day, month, year } = components;
  return Date.UTC(year, month - 1, day, 12, 0, 0) + 3 * 60 * 60 * 1000;
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
  if (normalizedValue === "br") {
    return "portugues";
  }
  if (normalizedValue === "en") {
    return "ingles";
  }
  if (normalizedValue === "es") {
    return "espanhol";
  }
  return null;
};

const convertField = (field, payload) => {
  let valor = payload[field.from];
  if (field.type === "phone") {
    return toPhone(valor, payload.country);
  }
  if (field.type === "idioma") {
    valor = payload.cf_language || payload.cf_lingua;
  }
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
    case "datetime":
      return toDateTimeMs(valor);
    case "datetimeISO":
      return toDateTimeIsoMs(valor);
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
  console.log(
    `[bondinhoCompraSiteSucesso] propriedades do contato antes do PATCH: ${JSON.stringify(properties)}`,
  );
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
  properties["hs_all_assigned_business_unit_ids"] = ACTIVE.businessUnits.Bondinho;
  console.log(
    `[bondinhoCompraSiteSucesso] propriedades do deal antes do PATCH/POST: ${JSON.stringify(properties)}`,
  );
  return properties;
};

// Faz merge da brand da marca no valor atual de BUs do contato (string separada
// por ';'), sem duplicar e sem manter entradas vazias.
const mergeBusinessUnitIds = (currentValue, businessUnitId) => {
  const units = new Set(
    String(currentValue || "")
      .split(";")
      .map((unit) => unit.trim())
      .filter((unit) => unit !== ""),
  );
  units.add(businessUnitId);
  return Array.from(units).join(";");
};

// Lê o valor atual de hs_all_assigned_business_unit_ids do contato.
const getContactBusinessUnits = async (contactId, hubspotClient) => {
  const { data } = await hubspotClient.get(
    `/crm/v3/objects/contacts/${contactId}?properties=hs_all_assigned_business_unit_ids`,
  );
  return data?.properties?.hs_all_assigned_business_unit_ids || "";
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
  contactProperties["payload"] = JSON.stringify(payload, null, 2);
  const dealProperties = buildDealProperties(DEAL_FIELDS, payload);
  console.log(
    `[bondinhoCompraSiteSucesso] payload final contato.phone=${contactProperties.phone} | deal.phone=${dealProperties.phone}`,
  );

  try {
    // Lê a BU atual do contato e faz append da brand da marca.
    const currentBusinessUnits = await withStep("lerContatoBU", () =>
      getContactBusinessUnits(contactId, hubspotClient),
    );
    contactProperties["hs_all_assigned_business_unit_ids"] = mergeBusinessUnitIds(
      currentBusinessUnits,
      ACTIVE.businessUnits.Bondinho,
    );

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
      pipeline: ACTIVE.pipeline.id,
      dealstage: ACTIVE.pipeline.stageWon,
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
