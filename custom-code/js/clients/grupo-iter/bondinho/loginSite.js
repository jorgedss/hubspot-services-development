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
// Este evento não atualiza a business unit do contato. O token vem da secret
// HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG, nunca hardcoded.
// ---------------------------------------------------------------------------

const CONTACT_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "mobile_phone", to: "phone", type: "text" },
];

const convertField = (field, payload) => {
  const valor = payload[field.from];
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
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG}`,
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
