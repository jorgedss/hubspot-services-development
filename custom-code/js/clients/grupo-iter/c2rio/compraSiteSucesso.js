const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU C2Rio - evento compra-site-sucesso (SIG).
//
// Contexto: action de custom code em um workflow cujo trigger é webhook. A
// chave de inscrição é o e-mail. O evento atualiza o CONTATO inscrito no
// workflow e faz UPSERT de um DEAL associado (chave única = booking).
//
// O contato é identificado por event.object.objectId. O deal é resolvido pela
// propriedade `booking` (que recebe o cf_id_pedido); quando não existe, é criado
// no pipeline 927835212 (Venda de Bilhete), estágio 1422040488 (Venda realizada).
// A associação contato->deal é feita após gravar os dois registros.
//
// Cada unidade de negócio tem uma brand: o DEAL recebe a BU C2Rio (4554144)
// como valor único na propriedade hs_all_assigned_business_unit_ids. O contato
// recebe a brand da marca via APPEND (a constante ACTIVE.businessUnits.C2Rio
// é adicionada ao valor atual sem sobrescrever).
//
// Regras de conversão específicas deste evento:
//   - cf_accept_communication: Sim/SIM/1/true -> true; qualquer outro -> false.
//   - cf_lingua: BR -> "portugues"; EN -> "ingles"; ES -> "espanhol" (dropdown
//     "idioma"). Desconhecido não é gravado.
//   - cf_product: array -> JSON string na propriedade cf_produto.
//   - cf_crianca: true/SIM/1/número>0 -> true; false/NAO/0/vazio -> false.
//   - cf_data_pedido e cf_date_visit_expected: DD-MM-YYYY -> YYYY-MM-DD.
//   - cf_data_hora_visita (contato e deal, datetime): o SIG envia só a data;
//     grava com hora fixa 12:00 de Brasília (UTC-3), em timestamp ms.
//
// O token vem da secret HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG, nunca hardcoded.
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
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_accept_communication", to: "aceite_receber_comunicacoes_c2rio", type: "acceptance" },
  { from: "cf_date_visit_expected", to: "cf_data_visita", type: "date" },
  { from: "cf_lingua", to: "idioma_cloned", type: "idioma" },
  { from: "cf_agent", to: "cf_agent", type: "text" },
  { from: "cf_crianca", to: "cf_comprou_crianca", type: "childFlag" },
  { from: "cf_brand_card", to: "cf_brand_card", type: "text" },
  { from: "cf_product", to: "cf_produto", type: "json" },
  { from: "cf_data_hora_visita", to: "cf_data_hora_visita", type: "visitDateTime" },
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
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_accept_communication", to: "aceite_receber_comunicacoes_bondinho", type: "acceptance" },
  { from: "cf_date_visit_expected", to: "data_da_visita", type: "date" },
  { from: "cf_lingua", to: "idioma", type: "idioma" },
  { from: "cf_agent", to: "cf_agent", type: "text" },
  { from: "cf_crianca", to: "cf_crianca", type: "childFlag" },
  { from: "cf_brand_card", to: "cf_brand_card", type: "text" },
  { from: "cf_product", to: "cf_produto", type: "json" },
  { from: "cf_data_hora_visita", to: "cf_data_hora_visita", type: "visitDateTime" },
];

const TRUE_WORDS = new Set(["true", "sim", "s", "y", "yes", "1"]);
const FALSE_WORDS = new Set(["false", "0", "nao", "não"]);

const toAcceptance = (valor) => {
  if (typeof valor === "boolean") return valor;
  if (valor == null || valor === "") return null;
  const normalizedValue = String(valor).trim().toLowerCase();
  if (TRUE_WORDS.has(normalizedValue)) return true;
  return false;
};

// cf_crianca/cf_comprou_crianca: aceita booleano, "SIM"/"1"/número>0 -> true;
// false/"NAO"/0/vazio -> false.
const toChildFlag = (valor) => {
  if (typeof valor === "boolean") return valor;
  if (valor == null || valor === "") return false;
  const numericValue = Number(String(valor).replace(",", "."));
  if (Number.isFinite(numericValue)) return numericValue > 0;
  const normalizedValue = String(valor).trim().toLowerCase();
  return TRUE_WORDS.has(normalizedValue);
};

const toNumber = (valor) => {
  if (valor == null || valor === "") return null;
  const numericValue = Number(String(valor).replace(",", "."));
  return Number.isFinite(numericValue) ? numericValue : null;
};

const toJsonString = (valor) => {
  if (valor == null || valor === "") return null;
  if (typeof valor === "string") return valor;
  return JSON.stringify(valor);
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

// Normaliza telefone para E.164: + código do país + DDD + número.
// O país vem do campo country do payload (sigla de duas letras, ex.: "br").
// Sem país reconhecido, um número sem "+" e com 10 ou 11 dígitos é tratado
// como brasileiro (+55); qualquer outro valor é gravado como chegou. O código do
// país só é removido do início quando o número tem dígitos a mais, para não
// confundir o DDD 55 (RS) com o código do Brasil. No Brasil, um número de 10
// dígitos (DDD + 8) recebe o 9 depois do DDD.
const BRAZIL_PHONE_CODE = "55";

const toPhone = (valor, country) => {
  if (valor == null || valor === "") return null;
  const originalValue = String(valor).trim();
  let digits = originalValue.replace(/\D/g, "");
  let countryCode = getPhoneCode(country);

  if (!countryCode) {
    const hasForeignPrefix = originalValue.startsWith("+");
    if (hasForeignPrefix || (digits.length !== 10 && digits.length !== 11)) {
      console.log(
        `[c2rioCompraSiteSucesso] telefone sem país reconhecido, gravado como recebido | país=${country} | recebido=${originalValue}`,
      );
      return originalValue;
    }
    countryCode = BRAZIL_PHONE_CODE;
  } else if (digits.startsWith(countryCode)) {
    const isBrazil = countryCode === BRAZIL_PHONE_CODE;
    const hasCountryPrefix = isBrazil ? digits.length >= 12 : true;
    if (hasCountryPrefix) digits = digits.slice(countryCode.length);
  }

  if (countryCode === BRAZIL_PHONE_CODE && digits.length === 10) {
    digits = `${digits.slice(0, 2)}9${digits.slice(2)}`;
  }

  const normalizedPhone = `+${countryCode}${digits}`;
  console.log(
    `[c2rioCompraSiteSucesso] telefone normalizado | país=${country} | recebido=${originalValue} | enviado=${normalizedPhone}`,
  );
  return normalizedPhone;
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

// cf_data_hora_visita (datetime, contato e deal). Aceita YYYY-MM-DD ou
// DD-MM-YYYY (hífen ou barra), com horário opcional HH:mm[:ss]. Com fuso
// explícito (Z ou ±HH:mm), usa o instante como veio; sem fuso, o horário é o de
// Brasília (UTC-3). Sem horário, fixa 12:00 de Brasília, evitando mudança de
// dia na exibição. Valor ilegível retorna null (não grava).
const toVisitDateTimeMs = (raw) => {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim();
  if (/[T\s]\d{1,2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const timestamp = Date.parse(text.replace(" ", "T"));
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  const isoDateMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  const brDateMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text);
  if (!isoDateMatch && !brDateMatch) return null;
  const year = Number(isoDateMatch ? isoDateMatch[1] : brDateMatch[3]);
  const month = Number(isoDateMatch ? isoDateMatch[2] : brDateMatch[2]);
  const day = Number(isoDateMatch ? isoDateMatch[3] : brDateMatch[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const timeMatch = /[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  const hour = timeMatch ? Number(timeMatch[1]) : 12;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const second = timeMatch && timeMatch[3] ? Number(timeMatch[3]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return Date.UTC(year, month - 1, day, hour, minute, second) + 3 * 60 * 60 * 1000;
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
    case "number":
      return toNumber(valor);
    case "json":
      return toJsonString(valor);
    case "idioma":
      return toIdioma(valor);
    case "childFlag":
      return toChildFlag(valor);
    case "date":
      return toDateString(valor);
    case "visitDateTime":
      return toVisitDateTimeMs(valor);
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
  properties["hs_all_assigned_business_unit_ids"] = ACTIVE.businessUnits.C2Rio;
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
    `[c2rioCompraSiteSucesso] contato ${contactId} | booking ${bookingKey}`,
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

  try {
    // Lê a BU atual do contato e faz append da brand da marca.
    const currentBusinessUnits = await withStep("lerContatoBU", () =>
      getContactBusinessUnits(contactId, hubspotClient),
    );
    contactProperties["hs_all_assigned_business_unit_ids"] = mergeBusinessUnitIds(
      currentBusinessUnits,
      ACTIVE.businessUnits.C2Rio,
    );

    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties: contactProperties,
      }),
    );

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

    await withStep("associarContatoDeal", () =>
      associateContactDeal(contactId, resolvedDealId, hubspotClient),
    );

    console.log(
      `[c2rioCompraSiteSucesso] contato ${contactId} atualizado; deal ${resolvedDealId}`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      deal_id: resolvedDealId,
    });
  } catch (error) {
    console.error("[c2rioCompraSiteSucesso] error:", buildErrorMessage(error));
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
