const axios = require("axios");

// ---------------------------------------------------------------------------
// Grupo Iter - BU Caracol - evento add-to-cart (SIG).
//
// Contexto: action de custom code dentro de um workflow cujo trigger é um
// webhook. A chave de inscriçao do workflow é o e-mail. O evento preenche o
// CONTATO inscrito no workflow com as informações do add-to-cart, aplicando as
// conversões de tipo. A propriedade data_do_ultimo_add_to_cart (datetime)
// recebe o instante da execução do script, em timestamp em milissegundos (UTC).
//
// O contato inscrito no workflow já fornece o record id em event.object.objectId
// e é atualizado via PATCH na API v3 de contacts. A brand da marca (Caracol) é
// gravada no contato via APPEND da constante ACTIVE.businessUnits.Caracol, sem
// sobrescrever BUs já existentes.
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

// As datas "data e hora" do payload vêm em horário local do cliente
// (America/Sao_Paulo, offset fixo -03:00, sem horário de verão desde 2019) e
// são convertidas para timestamp UTC na função toDateTimeMs. As datas "só data"
// são normalizadas para YYYY-MM-DD sem deslocamento de fuso.

// cf_data_hora_visita (datetime) traz data e hora da visita e é gravada como
// timestamp ms pela função toVisitDateTimeMs (horário de Brasília sem fuso).

// Mapeamento (payload -> propriedade do contato na HubSpot) com a conversão de
// tipo correspondente. Campos que no payload são strings numéricas/bool são
// convertidos antes de gravar.
const FIELD_MAP = [
  { from: "traffic_medium", to: "utm_medium", type: "text" },
  { from: "traffic_source", to: "utm_source", type: "text" },
  { from: "email", to: "email", type: "text" },
  { from: "name", to: "firstname", type: "text" },
  { from: "cf_sobrenome", to: "lastname", type: "text" },
  { from: "cf_data_de_nascimento", to: "date_of_birth", type: "dateISO" },
  { from: "cf_telefone_contato", to: "phone", type: "phone" },
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
  { from: "cf_lingua", to: "idioma_cloned", type: "idioma" },
  { from: "cf_localizador", to: "cf_localizador", type: "text" },
  { from: "cf_produto", to: "cf_produto", type: "text" },
  { from: "cf_order_payment_amount", to: "cf_valor_pedido", type: "number" },
  { from: "cf_category", to: "cf_category", type: "text" },
  { from: "cf_quantity", to: "quantidade_de_bilhetes", type: "number" },
  { from: "cf_categoria", to: "cf_categoria", type: "text" },
  { from: "cf_nome_produto", to: "cf_nome_produto", type: "text" },
  { from: "cf_data_hora_visita", to: "cf_data_hora_visita", type: "visitDateTime" },
];

const FALSE_WORDS = new Set(["false", "0", "nao", "não"]);

const toBoolean = (valor) => {
  if (typeof valor === "boolean") return valor;
  if (valor == null || valor === "") return null;
  const normalizedValue = String(valor).trim().toLowerCase();
  if (FALSE_WORDS.has(normalizedValue)) return false;
  return true;
};

// Aceite (SIM/NàƒO, Sim/Nao) vira checkbox. Sem valor, não grava nada.
const toAckBoolean = (valor) => {
  if (valor == null || valor === "") return null;
  return toBoolean(valor);
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
        `[caracolAddToCart] telefone sem país reconhecido, gravado como recebido | país=${country} | recebido=${originalValue}`,
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
    `[caracolAddToCart] telefone normalizado | país=${country} | recebido=${originalValue} | enviado=${normalizedPhone}`,
  );
  return normalizedPhone;
};

const padNumber = (number) => String(number).padStart(2, "0");

// Extrai mês, dia e ano de uma data "DD/MM/YYYY" ou "MM/DD/YYYY", conforme o
// formato explicitado em dateFormat. Retorna null quando a data é ilegível ou
// os componentes são inválidos.
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

// Converte uma data local (só dia) para a string YYYY-MM-DD, sem deslocar o dia
// por fuso: usa os componentes numéricos do payload diretamente.
const toDateString = (raw, dateFormat) => {
  const components = parseDateComponents(raw, dateFormat);
  if (!components) return null;
  const { month, day, year } = components;
  return `${year}-${padNumber(month)}-${padNumber(day)}`;
};

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

// Combina uma data com um horário "HH:mm:ss" (ambos em horário local do
// cliente) e devolve timestamp em milissegundos (UTC), o formato que a HubSpot
// aceita para propriedades "date and time". Sem horário (ou horário ilegível),
// fixa 12:00 de Brasília, evitando mudança de dia na exibição. Retorna null se
// a data estiver ausente/ilegível.
const toDateTimeMs = (rawDate, rawTime, dateFormat) => {
  const components = parseDateComponents(rawDate, dateFormat);
  if (!components) return null;
  const { month, day, year } = components;

  const timeMatch = /^\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(
    String(rawTime || ""),
  );
  const hour = timeMatch ? Number(timeMatch[1]) : 12;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;
  const second = timeMatch && timeMatch[3] ? Number(timeMatch[3]) : 0;

  if (hour > 23 || minute > 59 || second > 59) return null;

  // Date.UTC recebe os componentes já tratados como local do cliente; o offset
  // fixo -03:00 é somado para cima para obter o instante UTC equivalente.
  return Date.UTC(year, month - 1, day, hour, minute, second) + 3 * 60 * 60 * 1000;
};

// cf_data_hora_visita (datetime, contato). Aceita YYYY-MM-DD ou
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

// Aplica a conversão de tipo para um campo simples (não-datetime).
const convert = (field, valor, payload) => {
  if (field.type === "phone") {
    return toPhone(valor, payload.country);
  }
  if (field.type === "idioma") {
    valor = payload.cf_language || payload.cf_lingua;
  }
  switch (field.type) {
    case "checkbox":
      return toBoolean(valor);
    case "ackcheckbox":
      return toAckBoolean(valor);
    case "number":
      return toNumber(valor);
    case "date":
      return toDateString(valor, field.dateFormat);
    case "dateISO":
      return toDateISOString(valor);
    case "idioma":
      return toIdioma(valor);
    case "visitDateTime":
      return toVisitDateTimeMs(valor);
    default:
      return valor == null || valor === "" ? null : String(valor);
  }
};

// Conversão específica para datetime, que precisa do campo de horário e do
// formato de data.
const convertDateTime = (field, dateVal, timeVal) =>
  toDateTimeMs(dateVal, timeVal, field.dateFormat);

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
        erro: "",
        propriedades_gravadas: 0,
        ...payload,
      },
    });

  // As propriedades recebidas do webhook são expostas como input fields do
  // workflow e chegam em event.inputFields.
  const payload = event.inputFields || {};

  // O contato inscrito no workflow já está resolvido; o record id vem direto do
  // evento, sem necessidade de busca por e-mail.
  const contactId = String(event.object?.objectId || "");

  if (!contactId) {
    throw new Error("Record id do contato ausente no evento (event.object.objectId).");
  }

  console.log(`[caracolAddToCart] processando contato ${contactId}`);

  const hubspotClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${ACTIVE.hubspotToken}`,
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
        : convert(field, payload[field.from], payload);
    if (converted != null) properties[field.to] = converted;
  }
  if (!Object.keys(properties).length) {
    throw new Error("Nenhuma propriedade a mapear no payload.");
  }

  properties["payload"] = JSON.stringify(payload, null, 2);

  // Data do último add-to-cart: instante da execução do script, em ms UTC.
  properties["data_do_ultimo_add_to_cart"] = Date.now();

  try {
    // Lê a BU atual do contato e faz append da brand da marca.
    const currentBusinessUnits = await withStep("lerContatoBU", () =>
      getContactBusinessUnits(contactId, hubspotClient),
    );
    properties["hs_all_assigned_business_unit_ids"] = mergeBusinessUnitIds(
      currentBusinessUnits,
      ACTIVE.businessUnits.Caracol,
    );

    await withStep("atualizarContato", () =>
      hubspotClient.patch(`/crm/v3/objects/contacts/${contactId}`, {
        properties,
      }),
    );

    console.log(
      `[caracolAddToCart] contato ${contactId} atualizado com ${Object.keys(properties).length} propriedades`,
    );

    return respond({
      status: "atualizado",
      contact_id: contactId,
      propriedades_gravadas: Object.keys(properties).length,
    });
  } catch (error) {
    // Grava etapa, status e resposta da API na própria mensagem do erro, para a
    // falha da action no histórico do workflow já mostrar a causa. O erro
    // original é relançado (mantém status e response) para o HubSpot aplicar
    // as novas tentativas em 429 e 5xx.
    error.message = buildErrorMessage(error);
    console.error("[caracolAddToCart] error:", error.message);
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
