const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU Bondinho - evento login-site (SIG).
//
// Contexto: action de custom code em um workflow cujo trigger é webhook. O
// evento apenas atualiza o CONTATO (resolvido pelo e-mail) com os dados do
// login e grava a data do último login (data do recebimento do evento).
// Não cria nem atualiza deal.
//
// O contato é resolvido pelo e-mail via API search. A propriedade
// data_do_ultimo_login (datetime) recebe o instante do recebimento do evento,
// em timestamp em milissegundos (UTC).
//
// Este evento não atualiza a business unit do contato.
// O token vem de ACTIVE.hubspotToken: secret HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG
// em sandbox e HUBSPOT_TOKEN_INTEGRACAO_SIG em produção, nunca hardcoded.
// ---------------------------------------------------------------------------

// Ambiente da execução. Trocar manualmente para "production" no deploy.
const ENV = "sandbox";

const CONFIG = {
  sandbox: {
    hubspotToken: process.env.HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG,
  },
  production: {
    hubspotToken: process.env.HUBSPOT_TOKEN_INTEGRACAO_SIG,
  },
};

const ACTIVE = CONFIG[ENV];

const CONTACT_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "mobile_phone", to: "phone", type: "phone" },
];

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
        `[bondinhoLoginSite] telefone sem país reconhecido, gravado como recebido | país=${country} | recebido=${originalValue}`,
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
    `[bondinhoLoginSite] telefone normalizado | país=${country} | recebido=${originalValue} | enviado=${normalizedPhone}`,
  );
  return normalizedPhone;
};

const convertField = (field, payload) => {
  const valor = payload[field.from];
  if (field.type === "phone") {
    return toPhone(valor, payload.country);
  }
  return valor == null || valor === "" ? null : String(valor);
};

const buildContactProperties = (fields, payload) => {
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
        erro: "",
        propriedades_gravadas: 0,
        ...payload,
      },
    });

  const payload = event.inputFields || {};

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) {
    throw new Error("Campo email ausente ou vazio no payload. Não é possível resolver o contato.");
  }

  console.log(`[bondinhoLoginSite] email ${email}`);

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

  // Data do último login: instante do recebimento do evento (agora), em ms UTC.
  contactProperties["data_do_ultimo_login"] = Date.now();

  try {
    const contactId = await withStep("resolverContato", () =>
      findContactByEmail(email, hubspotClient),
    );

    if (!contactId) {
      throw new Error(`Contato ${email} não encontrado no portal.`);
    }

    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties: contactProperties,
      }),
    );

    console.log(
      `[bondinhoLoginSite] contato ${contactId} atualizado com ${Object.keys(contactProperties).length} propriedades`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      propriedades_gravadas: Object.keys(contactProperties).length,
    });
  } catch (error) {
    console.error("[bondinhoLoginSite] error:", buildErrorMessage(error));
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
