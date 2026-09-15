const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - atualização de contato via webhook (SIG).
//
// Contexto: action de custom code dentro de um workflow cujo trigger é um
// webhook. A chave de inscri��o do workflow é o e-mail. O payload é o corpo do
// evento recebido pelo webhook (formato SIG) e este script mapeia cada campo
// para a propriedade do contato na HubSpot, aplicando as convers�es de tipo.
//
// O contato é localizado pelo e-mail e atualizado via PATCH na API v3 de
// contacts. O token de autentica��o vem da secret
// `HUBSPOT_TOKEN_INTEGRACAO_SIG`, nunca hardcoded.
// ---------------------------------------------------------------------------

// As datas "data e hora" do payload vêm em horário local do cliente
// (America/Sao_Paulo, offset fixo -03:00, sem horário de verão desde 2019) e
// são convertidas para timestamp UTC na função toDateTimeMs. As datas "só data"
// são normalizadas para YYYY-MM-DD sem deslocamento de fuso.

// Mapeamento (payload -> propriedade do contato na HubSpot) com a conversão de
// tipo correspondente. Campos que no payload são strings numéricas/bool são
// convertidos antes de gravar.
const FIELD_MAP = [
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "cf_sobrenome", to: "lastname", type: "text" },
  { from: "cf_data_de_nascimento", to: "data_de_nascimento", type: "date" },
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
  { from: "cf_data_visita", to: "cf_data_visita", type: "datetime", timeField: "cf_hora_visita" },
  { from: "available_for_mailing", to: "available_for_mailing", type: "checkbox" },
  { from: "cf_aceite_whatsapp", to: "cf_aceite_whatsapp", type: "ackcheckbox" },
  { from: "cf_aceite_regras", to: "cf_aceite_regras", type: "ackcheckbox" },
  { from: "cf_data_compra", to: "data_do_envio", type: "date" },
  { from: "cf_visita_esperada", to: "data_e_hora_da_visita_esperada", type: "datetime", timeField: "cf_hora_visita_selecionada" },
  { from: "cf_lingua", to: "cf_language", type: "text" },
  { from: "cf_localizador", to: "cf_localizador", type: "text" },
  { from: "cf_produto", to: "cf_produto", type: "text" },
  { from: "cf_order_payment_amount", to: "cf_valor_pedido", type: "number" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_categoria", to: "cf_categoria", type: "text" },
  { from: "cf_nome_produto", to: "cf_nome_produto", type: "text" },
];

const FALSE_WORDS = new Set(["false", "0", "nao", "não"]);

const toBoolean = (valor) => {
  if (typeof valor === "boolean") return valor;
  if (valor == null || valor === "") return null;
  const normalizedValue = String(valor).trim().toLowerCase();
  if (FALSE_WORDS.has(normalizedValue)) return false;
  return true;
};

// Aceite (SIM/NÃO, Sim/Nao) vira checkbox. Sem valor, não grava nada.
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

// Converte uma data local (só dia) para a string YYYY-MM-DD, sem deslocar o dia
// por fuso: usa os componentes numéricos do payload diretamente.
const toDateString = (raw) => {
  const dateMatch = /^\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(String(raw));
  if (!dateMatch) return null;
  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
};

// Combina uma data "MM/DD/YYYY" com um horário "HH:mm:ss" (ambos em horário
// local do cliente) e devolve timestamp em milissegundos (UTC), o formato que a
// HubSpot aceita para propriedades "date and time". Retorna null se a data
// estiver ausente/ilegível.
const toDateTimeMs = (rawDate, rawTime) => {
  const dateMatch = /^\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(String(rawDate || ""));
  if (!dateMatch) return null;
  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const timeMatch = /^\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(
    String(rawTime || "00:00:00"),
  );
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const second = timeMatch && timeMatch[3] ? Number(timeMatch[3]) : 0;

  if (hour > 23 || minute > 59 || second > 59) return null;

  // Date.UTC recebe os componentes já tratados como local do cliente; o offset
  // fixo -03:00 é somado para cima para obter o instante UTC equivalente.
  return Date.UTC(year, month - 1, day, hour, minute, second) + 3 * 60 * 60 * 1000;
};

// Aplica a conversão de tipo para um campo simples (não-datetime).
const convert = (field, valor) => {
  switch (field.type) {
    case "checkbox":
      return toBoolean(valor);
    case "ackcheckbox":
      return toAckBoolean(valor);
    case "number":
      return toNumber(valor);
    case "date":
      return toDateString(valor);
    default:
      return valor == null || valor === "" ? null : String(valor);
  }
};

// Conversão específica para datetime, que precisa do campo de horário.
const convertDateTime = (field, dateVal, timeVal) =>
  toDateTimeMs(dateVal, timeVal);

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

  // O corpo do webhook pode chegar em event.body (raw) ou como campos diretos.
  const payload = event.body ? safeParse(event.body, event) : event;

  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) {
    return respond({ erro: "Campo email ausente ou vazio no payload do webhook." });
  }

  console.log(`[atualizarContatoSIG] processando contato ${email}`);

  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${process.env.HUBSPOT_TOKEN_INTEGRACAO_SIG}`,
      "Content-Type": "application/json",
    },
    timeout: 18000,
  });

  // Monta o objeto de propriedades a gravar, aplicando as conversões de tipo e
  // ignorando campos vazios (não gravar null evita sobrescrever valor já
  // existente no contato).
  const properties = {};
  for (const field of FIELD_MAP) {
    const converted =
      field.type === "datetime"
        ? convertDateTime(field, payload[field.from], payload[field.timeField])
        : convert(field, payload[field.from]);
    if (converted != null) properties[field.to] = converted;
  }

  if (!Object.keys(properties).length) {
    return respond({ erro: "Nenhuma propriedade a mapear no payload." });
  }

  try {
    // Localiza o contato pelo e-mail (chave de inscrição do workflow).
    const searchResponse = await withStep("localizarContato", () =>
      hubspotClient.post("/crm/v3/objects/contacts/search", {
        filterGroups: [
          { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
        ],
        properties: ["email"],
        limit: 1,
      }),
    );

    const contact = (searchResponse.data.results || [])[0];
    if (!contact) {
      return respond({
        status: "nao_encontrado",
        erro: `Contato ${email} não encontrado no portal.`,
      });
    }

    const contactId = contact.id;

    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties,
      }),
    );

    console.log(
      `[atualizarContatoSIG] contato ${contactId} atualizado com ${Object.keys(properties).length} propriedades`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      propriedades_gravadas: Object.keys(properties).length,
    });
  } catch (error) {
    const message = buildErrorMessage(error);
    console.error("[atualizarContatoSIG] error:", message);
    return respond({ erro: message });
  }
};

// --- helpers ---------------------------------------------------------------

const safeParse = (raw, fallback) => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (err) {
    console.error("[atualizarContatoSIG] invalid JSON:", err.message);
    return fallback;
  }
};

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
