const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU Caracol - evento form-submit (SIG).
//
// Contexto: action de custom code dentro de um workflow cujo trigger Ã© um
// webhook. A chave de inscriÃ§ao do workflow Ã© o e-mail. O evento cria/atualiza
// o CONTATO inscrito no workflow, aplicando as conversÃµes de tipo.
//
// O contato inscrito no workflow jÃ¡ fornece o record id em event.object.objectId
// e Ã© atualizado via PATCH na API v3 de contacts. Cada unidade de negÃ³cio tem
// uma brand: a propriedade hs_all_assigned_business_unit_ids recebe o id da BU
// Caracol (4554143). O token vem da secret HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG,
// nunca hardcoded.
// ---------------------------------------------------------------------------

const BUSINESS_UNIT_ID = "4554143";

// As datas "data e hora" do payload vÃªm em horÃ¡rio local do cliente
// (America/Sao_Paulo, offset fixo -03:00, sem horÃ¡rio de verÃ£o desde 2019) e
// sÃ£o convertidas para timestamp UTC na funÃ§Ã£o toDateTimeMs. As datas "sÃ³ data"
// sÃ£o normalizadas para YYYY-MM-DD sem deslocamento de fuso.

// Mapeamento (payload -> propriedade do contato na HubSpot) com a conversÃ£o de
// tipo correspondente. Campos que no payload sÃ£o strings numÃ©ricas/bool sÃ£o
// convertidos antes de gravar.
const FIELD_MAP = [
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "cf_sobrenome", to: "lastname", type: "text" },
  { from: "cf_data_de_nascimento", to: "data_de_nascimento", type: "date", dateFormat: "MM/DD/YYYY" },
  { from: "cf_telefone_contato", to: "phone", type: "text" },
  { from: "cf_cpf_passaporte", to: "cpf", type: "text" },
  { from: "country", to: "country", type: "text" },
  { from: "cf_estrangeiro", to: "cf_estrangeiro", type: "checkbox" },
  { from: "cf_cep", to: "zip", type: "text" },
  { from: "city", to: "city", type: "text" },
  { from: "state", to: "state", type: "text" },
  { from: "cf_endereco", to: "cf_endereco", type: "text" },
  { from: "cf_numero", to: "cf_numero", type: "text" },
  { from: "cf_complemento", to: "cf_complemento", type: "text" },
  { from: "cf_nome_bilhete", to: "cf_nome_bilhete", type: "text" },
  { from: "cf_tipo_bilhete", to: "cf_tipo_bilhete", type: "text" },
  { from: "cf_data_visita", to: "cf_data_visita", type: "datetime", timeField: "cf_hora_visita", dateFormat: "MM/DD/YYYY" },
  { from: "available_for_mailing", to: "available_for_mailing", type: "checkbox" },
  { from: "cf_aceite_whatsapp", to: "cf_aceite_whatsapp", type: "ackcheckbox" },
  { from: "cf_aceite_regras", to: "cf_aceite_regras", type: "ackcheckbox" },
  { from: "cf_data_compra", to: "data_do_envio", type: "date", dateFormat: "DD/MM/YYYY" },
  { from: "cf_visita_esperada", to: "data_e_hora_da_visita_esperada", type: "datetime", timeField: "cf_hora_visita_selecionada", dateFormat: "DD/MM/YYYY" },
  { from: "cf_lingua", to: "cf_language", type: "text" },
  { from: "cf_localizador", to: "cf_localizador", type: "text" },
  { from: "cf_produto", to: "cf_produto", type: "text" },
  { from: "cf_order_payment_amount", to: "cf_valor_pedido", type: "number" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_categoria", to: "cf_categoria", type: "text" },
  { from: "cf_nome_produto", to: "cf_nome_produto", type: "text" },
];

const FALSE_WORDS = new Set(["false", "0", "nao", "nÃ£o"]);

const toBoolean = (valor) => {
  if (typeof valor === "boolean") return valor;
  if (valor == null || valor === "") return null;
  const normalizedValue = String(valor).trim().toLowerCase();
  if (FALSE_WORDS.has(normalizedValue)) return false;
  return true;
};

// Aceite (SIM/NÃƒO, Sim/Nao) vira checkbox. Sem valor, nÃ£o grava nada.
const toAckBoolean = (valor) => {
  if (valor == null || valor === "") return null;
  return toBoolean(valor);
};

const toNumber = (valor) => {
  if (valor == null || valor === "") return null;
  const numericValue = Number(String(valor).replace(",", "."));
  return Number.isFinite(numericValue) ? numericValue : null;
};

const padNumber = (number) => String(number).padStart(2, "0");

// Extrai mÃªs, dia e ano de uma data "DD/MM/YYYY" ou "MM/DD/YYYY", conforme o
// formato explicitado em dateFormat. Retorna null quando a data Ã© ilegÃ­vel ou
// os componentes sÃ£o invÃ¡lidos.
const parseDateComponents = (raw, dateFormat) => {
  const dateMatch = /^\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(String(raw || ""));
  if (!dateMatch) return null;

  const first = Number(dateMatch[1]);
  const second = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);

  const month = dateFormat === "DD/MM/YYYY" ? second : first;
  const day = dateFormat === "DD/MM/YYYY" ? first : second;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day, year };
};

// Converte uma data local (sÃ³ dia) para a string YYYY-MM-DD, sem deslocar o dia
// por fuso: usa os componentes numÃ©ricos do payload diretamente.
const toDateString = (raw, dateFormat) => {
  const components = parseDateComponents(raw, dateFormat);
  if (!components) return null;
  const { month, day, year } = components;
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
};

// Combina uma data com um horÃ¡rio "HH:mm:ss" (ambos em horÃ¡rio local do
// cliente) e devolve timestamp em milissegundos (UTC), o formato que a HubSpot
// aceita para propriedades "date and time". Retorna null se a data estiver
// ausente/ilegÃ­vel.
const toDateTimeMs = (rawDate, rawTime, dateFormat) => {
  const components = parseDateComponents(rawDate, dateFormat);
  if (!components) return null;
  const { month, day, year } = components;

  const timeMatch = /^\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(
    String(rawTime || "00:00:00"),
  );
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const second = timeMatch && timeMatch[3] ? Number(timeMatch[3]) : 0;

  if (hour > 23 || minute > 59 || second > 59) return null;

  // Date.UTC recebe os componentes jÃ¡ tratados como local do cliente; o offset
  // fixo -03:00 Ã© somado para cima para obter o instante UTC equivalente.
  return Date.UTC(year, month - 1, day, hour, minute, second) + 3 * 60 * 60 * 1000;
};

// Aplica a conversÃ£o de tipo para um campo simples (nÃ£o-datetime).
const convert = (field, valor) => {
  switch (field.type) {
    case "checkbox":
      return toBoolean(valor);
    case "ackcheckbox":
      return toAckBoolean(valor);
    case "number":
      return toNumber(valor);
    case "date":
      return toDateString(valor, field.dateFormat);
    default:
      return valor == null || valor === "" ? null : String(valor);
  }
};

// ConversÃ£o especÃ­fica para datetime, que precisa do campo de horÃ¡rio e do
// formato de data.
const convertDateTime = (field, dateVal, timeVal) =>
  toDateTimeMs(dateVal, timeVal, field.dateFormat);

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

  // As propriedades recebidas do webhook sÃ£o expostas como input fields do
  // workflow e chegam em event.inputFields.
  const payload = event.inputFields || {};

  // O contato inscrito no workflow jÃ¡ estÃ¡ resolvido; o record id vem direto do
  // evento, sem necessidade de busca por e-mail.
  const contactId = String(event.object?.objectId || "");

  if (!contactId) {
    throw new Error("Record id do contato ausente no evento (event.object.objectId).");
  }

  console.log(`[caracolFormSubmit] processando contato ${contactId}`);

  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN_SANDBOX_INTEGRACAO_SIG}`,
      "Content-Type": "application/json",
    },
    timeout: 18000,
  });

  // Monta o objeto de propriedades a gravar, aplicando as conversÃµes de tipo e
  // ignorando campos vazios (nÃ£o gravar null evita sobrescrever valor jÃ¡
  // existente no contato).
  const properties = {};
  for (const field of FIELD_MAP) {
    const converted =
      field.type === "datetime"
        ? convertDateTime(field, payload[field.from], payload[field.timeField])
        : convert(field, payload[field.from]);
    if (converted != null) properties[field.to] = converted;
  }
  properties["hs_all_assigned_business_unit_ids"] = BUSINESS_UNIT_ID;

  if (!Object.keys(properties).length) {
    throw new Error("Nenhuma propriedade a mapear no payload.");
  }

  try {
    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties,
      }),
    );

    console.log(
      `[caracolFormSubmit] contato ${contactId} atualizado com ${Object.keys(properties).length} propriedades`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      propriedades_gravadas: Object.keys(properties).length,
    });
  } catch (error) {
    console.error("[caracolFormSubmit] error:", buildErrorMessage(error));
    throw error;
  }
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
