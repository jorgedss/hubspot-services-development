const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU Bondinho - evento cancelamento (SIG).
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
// Cada unidade de negócio tem uma brand. O DEAL recebe a BU Bondinho (4554145)
// como valor único. O CONTATO recebe as BUs vindas do campo `bu` do payload
// (nomes separados por vírgula, mapeados para ids) mescladas com o valor atual,
// sem duplicar.
//
// Campos de cancelamento (deal): cf_motivo_cancelamento, cf_valor_reembolso,
// cf_quantity_cancelada, cf_quantity_restante, cf_valor_restante, cf_bilhetes.
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

const LOSS_REASON = "Cancelamento";


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
  properties["hs_all_assigned_business_unit_ids"] = ACTIVE.businessUnits.Bondinho;
  return properties;
};

// Mapa nome de marca -> id da business unit (vindo do ambiente ativo).
const BU_NAME_TO_ID = ACTIVE.businessUnits;

// Converte a string `bu` do payload (ex.: "Bondinho, Caracol") em uma lista de
// ids: separa por vírgula, remove espaços e entradas vazias, e mapeia cada nome
// para o id correspondente. Nomes desconhecidos são ignorados.
const mapBuNamesToIds = (buString) => {
  return String(buString || "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
    .map((name) => BU_NAME_TO_ID[name])
    .filter((id) => id != null);
};

// Une a lista atual de BUs do contato (string separada por ';') com os novos
// ids, sem duplicar e sem manter entradas vazias.
const mergeBusinessUnitIds = (currentValue, newIds) => {
  const units = new Set(
    String(currentValue || "")
      .split(";")
      .map((unit) => unit.trim())
      .filter((unit) => unit !== ""),
  );
  for (const id of newIds) units.add(id);
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
    `[bondinhoCancelamento] deal ${dealId} | email ${email} | restante ${quantityRestante} | perdido: ${perdeuTodoBilhete}`,
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
    const contactId = await withStep("resolverContato", () =>
      findContactByEmail(email, hubspotClient),
    );

    if (!contactId) {
      throw new Error(`Contato ${email} não encontrado no portal.`);
    }

    const currentBusinessUnits = await withStep("lerContatoBU", () =>
      getContactBusinessUnits(contactId, hubspotClient),
    );
    const newBusinessUnitIds = mapBuNamesToIds(payload.bu);
    if (newBusinessUnitIds.length) {
      contactProperties["hs_all_assigned_business_unit_ids"] = mergeBusinessUnitIds(
        currentBusinessUnits,
        newBusinessUnitIds,
      );
    }

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
