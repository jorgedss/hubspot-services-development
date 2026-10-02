const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU C2Rio - evento cancelamento total (SIG).
//
// Contexto: action de custom code em um workflow cujo trigger é webhook. O
// objeto inscrito no workflow é o DEAL (event.object.objectId é o id do deal),
// e o CONTATO é resolvido pelo e-mail do payload. O evento atualiza o DEAL
// inscrito e o CONTATO associado (resolvido pelo e-mail), com uma regra de
// estágio baseada em cf_quantity_restante.
//
// Regra de negócio:
//   - Se cf_quantity_restante <= 0: move o deal para a etapa Perdido
//     (1422054714) e grava motivo_de_perda "Cancelamento".
//   - Se cf_quantity_restante > 0: mantém o deal no estágio atual e atualiza
//     quantidade_de_bilhetes = cf_quantity_restante e amount = cf_valor_restante.
//
// O deal é identificado por event.object.objectId. O contato é resolvido pelo
// e-mail via API search. A associação contato->deal é feita após gravar os dois
// registros.
//
// Cada unidade de negócio tem uma brand. O DEAL recebe a BU C2Rio (4344366 em produção)
// como valor único. O CONTATO recebe a brand da marca via APPEND (a constante
// ACTIVE.businessUnits.C2Rio é adicionada ao valor atual sem sobrescrever).
//
// Campos de cancelamento (deal): cf_motivo_cancelamento, cf_valor_reembolso,
// cf_quantity_cancelada, cf_quantity_restante, cf_valor_restante, cf_bilhetes.
//
// O token vem de ACTIVE.hubspotToken: secret HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG
// em sandbox e HUBSPOT_TOKEN_INTEGRACAO_SIG em produção, nunca hardcoded.
// ---------------------------------------------------------------------------

// Ambiente da execução. Este script já roda em produção.
const ENV = "production";

const CONFIG = {
  sandbox: {
    businessUnits: { Bondinho: "4554145", Caracol: "4554143", C2Rio: "4554144" },
    pipeline: { id: "927835212", stageWon: "1422040488", stageLost: "1422054714" },
    hubspotToken: process.env.HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG,
  },
  production: {
    businessUnits: { Bondinho: "4292163", Caracol: "4275397", C2Rio: "4344366" },
    pipeline: { id: "927835212", stageWon: "1422040488", stageLost: "1422054714" },
    hubspotToken: process.env.HUBSPOT_TOKEN_INTEGRACAO_SIG,
  },
};

const ACTIVE = CONFIG[ENV];

const LOSS_REASON = "Cancelamento";


const CONTACT_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "mobile_phone", to: "phone", type: "phone" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date" },
  { from: "cf_date_visit_expected", to: "cf_data_visita", type: "datetime" },
  { from: "cf_product", to: "cf_produto", type: "text" },
  { from: "cf_lingua", to: "idioma", type: "idioma" },
  { from: "cf_motivo_cancelamento", to: "cf_motivo_cancelamento", type: "text" },
  { from: "cf_valor_reembolso", to: "cf_valor_reembolso", type: "number" },
  { from: "cf_quantity_cancelada", to: "cf_quantity_cancelada", type: "number" },
  { from: "cf_quantity_restante", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_valor_restante", to: "cf_valor_pedido", type: "number" },
  { from: "cf_bilhetes", to: "cf_bilhetes", type: "text" },
  { from: "cf_data_hora_visita", to: "cf_data_hora_visita", type: "datetimeISO" },
];

const DEAL_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email_do_contato_principal", type: "text" },
  { from: "cf_id_pedido", to: "dealname", type: "text", fallbackFrom: "name" },
  { from: "mobile_phone", to: "phone", type: "phone" },
  { from: "cf_id_pedido", to: "booking", type: "text" },
  { from: "cf_data_pedido", to: "cf_data_pedido", type: "date" },
  { from: "cf_date_visit_expected", to: "data_da_visita", type: "date" },
  { from: "cf_product", to: "cf_produto", type: "text" },
  { from: "cf_lingua", to: "idioma", type: "idioma" },
  { from: "cf_motivo_cancelamento", to: "cf_motivo_cancelamento", type: "text" },
  { from: "cf_valor_reembolso", to: "cf_valor_reembolso", type: "number" },
  { from: "cf_quantity_cancelada", to: "cf_quantity_cancelada", type: "number" },
  { from: "cf_quantity_restante", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_valor_restante", to: "amount", type: "number" },
  { from: "cf_bilhetes", to: "cf_bilhetes", type: "text" },
  { from: "cf_data_hora_visita", to: "cf_data_hora_visita", type: "datetimeISO" },
];

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
        `[c2rioCancelamentoTotal] telefone sem país reconhecido, gravado como recebido | país=${country} | recebido=${originalValue}`,
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
    `[c2rioCancelamentoTotal] telefone normalizado | país=${country} | recebido=${originalValue} | enviado=${normalizedPhone}`,
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

// Data sem horário: usa 12:00 no fuso de São Paulo (UTC-3).
const toDateTimeMs = (raw) => {
  const match = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})/.exec(String(raw || ""));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Date.UTC(year, month - 1, day, 12, 0, 0) + 3 * 60 * 60 * 1000;
};

const toDateTimeIsoMs = (raw) => {
  const timestamp = Date.parse(String(raw || ""));
  return Number.isFinite(timestamp) ? timestamp : null;
};

// cf_lingua -> idioma (dropdown ingles/portugues/espanhol).
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
    case "number":
      return toNumber(valor);
    case "date":
      return toDateString(valor);
    case "datetime":
      return toDateTimeMs(valor);
    case "datetimeISO":
      return toDateTimeIsoMs(valor);
    case "idioma":
      return toIdioma(valor);
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

  if (!ACTIVE.hubspotToken) {
    throw new Error("Secret HUBSPOT_TOKEN_INTEGRACAO_SIG ausente na action de custom code.");
  }

  const payload = event.inputFields || {};

  // No cancelamento, o objeto inscrito no workflow é o DEAL, não o contato.
  const dealId = String(event.object?.objectId || "");
  if (!dealId) {
    throw new Error("Record id do deal ausente no evento (event.object.objectId).");
  }

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Campo email ausente ou vazio no payload. Não é possível resolver o contato.");
  }

  const quantityRestante = toNumber(payload.cf_quantity_restante);
  if (quantityRestante == null) {
    throw new Error("Campo cf_quantity_restante ausente ou inválido no payload.");
  }

  const perdeuTodoBilhete = quantityRestante <= 0;

  console.log(
    `[c2rioCancelamentoTotal] deal ${dealId} | email ${email} | restante ${quantityRestante} | perdido: ${perdeuTodoBilhete}`,
  );

  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${ACTIVE.hubspotToken}`,
      "Content-Type": "application/json",
    },
    timeout: 18000,
  });

  const contactProperties = buildContactProperties(CONTACT_FIELDS, payload);
  contactProperties["payload"] = JSON.stringify(payload, null, 2);
  contactProperties["cancelado"] = true;
  const dealProperties = buildDealProperties(DEAL_FIELDS, payload);
  dealProperties["cancelado"] = true;

  try {
    const contactId = await withStep("resolverContato", () =>
      findContactByEmail(email, hubspotClient),
    );

    if (!contactId) {
      throw new Error(`Contato ${email} não encontrado no portal.`);
    }

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

    // Define o estágio e o payload de gravação conforme a regra de negócio.
    let dealToWrite;
    if (perdeuTodoBilhete) {
      dealToWrite = {
        ...dealProperties,
        pipeline: ACTIVE.pipeline.id,
        dealstage: ACTIVE.pipeline.stageLost,
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
      `[c2rioCancelamentoTotal] contato ${contactId} atualizado; deal ${dealId} ${perdeuTodoBilhete ? "na etapa Perdido" : "mantido no estágio"}`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      deal_id: dealId,
    });
  } catch (error) {
    // Grava etapa, status e resposta da API na própria mensagem do erro, para a
    // falha da action no histórico do workflow já mostrar a causa. O erro
    // original é relançado (mantém status e response) para o HubSpot aplicar
    // as novas tentativas em 429 e 5xx.
    error.message = buildErrorMessage(error);
    console.error("[c2rioCancelamentoTotal] error:", error.message);
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
