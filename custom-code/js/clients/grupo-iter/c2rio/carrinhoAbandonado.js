const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU C2Rio - evento carrinho-abandonado (SIG).
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
// Cada unidade de negócio tem uma brand: o DEAL recebe a BU C2Rio (4554144)
// como valor único na propriedade hs_all_assigned_business_unit_ids. O contato
// recebe a brand da marca via APPEND (a constante ACTIVE.businessUnits.C2Rio
// é adicionada ao valor atual sem sobrescrever).
//
// Regras de conversão específicas deste evento:
//   - cf_data_de_nascimento: DD/MM/YYYY -> YYYY-MM-DD.
//   - cf_data_pedido (data_do_envio): DD-MM-YYYY -> YYYY-MM-DD.
//   - cf_data_hora_visita (contato e deal, datetime): o SIG envia só a data;
//     grava com hora fixa 12:00 de Brasília (UTC-3), em timestamp ms.
//
// O token vem de ACTIVE.hubspotToken: secret HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG
// em sandbox e HUBSPOT_TOKEN_INTEGRACAO_SIG em produção, nunca hardcoded.
// ---------------------------------------------------------------------------

// Ambiente da execução. Trocar manualmente para "production" no deploy.
const ENV = "sandbox";

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

const LOSS_REASON = "Carrinho abandonado";


const CONTACT_FIELDS = [
  { from: "conversion_identifier", to: "conversion_identifier", type: "text" },
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "cf_data_de_nascimento", to: "date_of_birth", type: "dateISO" },
  { from: "cf_cep", to: "zip", type: "text" },
  { from: "cf_cpf", to: "cpf", type: "text" },
  { from: "city", to: "city", type: "text" },
  { from: "state", to: "state", type: "text" },
  { from: "country", to: "country", type: "text" },
  { from: "cf_data_pedido", to: "data_do_envio", type: "dateVisit" },
  { from: "cf_produto", to: "cf_produto", type: "text" },
  { from: "cf_order_payment_amount", to: "valor_carrinho_abandonado", type: "number" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_lingua", to: "idioma_cloned", type: "idioma" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_data_hora_visita", to: "cf_data_hora_visita", type: "visitDateTime" },
  { from: "cf_nome_do_passeio", to: "cf_nome_do_passeio", type: "text" },
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
  { from: "cf_data_pedido", to: "data_do_envio", type: "dateVisit" },
  { from: "cf_produto", to: "cf_produto", type: "text" },
  { from: "cf_order_payment_amount", to: "amount", type: "number" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_lingua", to: "idioma", type: "idioma" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_data_hora_visita", to: "cf_data_hora_visita", type: "visitDateTime" },
  { from: "cf_nome_do_passeio", to: "cf_nome_do_passeio", type: "text" },
];

const toNumber = (valor) => {
  if (valor == null || valor === "") return null;
  const numericValue = Number(String(valor).replace(",", "."));
  return Number.isFinite(numericValue) ? numericValue : null;
};

const padNumber = (number) => String(number).padStart(2, "0");

// cf_data_de_nascimento: o SIG já envia YYYY-MM-DD, então o valor é repassado
// direto para a HubSpot (formato nativo da propriedade date).
const toDateISOString = (raw) => {
  const match = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(raw || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
};

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

// cf_data_pedido: DD-MM-YYYY -> YYYY-MM-DD.
const toDateVisitString = (raw) => {
  const match = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})/.exec(String(raw || ""));
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
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
    case "dateISO":
      return toDateISOString(valor);
    case "dateVisit":
      return toDateVisitString(valor);
    case "visitDateTime":
      return toVisitDateTimeMs(valor);
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

  const payload = event.inputFields || {};

  const contactId = String(event.object?.objectId || "");
  if (!contactId) {
    throw new Error("Record id do contato ausente no evento (event.object.objectId).");
  }

  console.log(`[c2rioCarrinhoAbandonado] contato ${contactId}`);

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

    // 1. Atualiza o contato.
    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties: contactProperties,
      }),
    );

    // 2. Sempre cria um novo deal na etapa Perdido (sem booking).
    const dealToWrite = {
      ...dealProperties,
      pipeline: ACTIVE.pipeline.id,
      dealstage: ACTIVE.pipeline.stageLost,
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
      `[c2rioCarrinhoAbandonado] contato ${contactId} atualizado; deal ${resolvedDealId} na etapa Perdido`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      deal_id: resolvedDealId,
    });
  } catch (error) {
    console.error("[c2rioCarrinhoAbandonado] error:", buildErrorMessage(error));
    throw error;
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
