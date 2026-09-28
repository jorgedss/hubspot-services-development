const axios = require("axios");

// Date.UTC rola valor fora de faixa em vez de recusar: 2026-13-45 sairia como
// 2027-02-14. A volta pelos getters confirma que o dia atravessou intacto, e o
// que não atravessa cai no console.warn de parseDataInicio.
function toUtcMillisStrict(year, month, day) {
  const millis = Date.UTC(year, month - 1, day);
  const date = new Date(millis);

  const survivedRoundTrip =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return survivedRoundTrip ? millis : null;
}

// O formato de dataInicio retornado pelo /academico/v1/ ainda não foi observado
// com valor preenchido. O parser aceita yyyy-MM-dd, dd/MM/yyyy, ISO com hora e
// epoch em milissegundos, e loga o valor bruto quando não reconhece o formato.
// Todo caminho que não produz data cai no mesmo console.warn: no terminal do
// `hs project dev` é onde um formato inesperado tem chance de se anunciar.
function parseDataInicio(value) {
  if (value === null || value === undefined || value === "") return null;

  const raw = String(value).trim();

  // 13 dígitos, não 10: um epoch em segundos passaria por 10 e viraria 1970,
  // uma data plausível o bastante para não disparar o console.warn abaixo.
  if (/^\d{13,}$/.test(raw)) {
    const fromMillis = new Date(Number(raw));
    if (!isNaN(fromMillis.getTime())) {
      return Date.UTC(
        fromMillis.getUTCFullYear(),
        fromMillis.getUTCMonth(),
        fromMillis.getUTCDate(),
      );
    }
  }

  // Data de início é data de calendário. O offset de fuso é descartado de
  // propósito: aplicá-lo poderia deslocar a data em um dia.
  const datePart = raw.split("T")[0].split(" ")[0];

  const isoMatch = datePart.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const millis = toUtcMillisStrict(+isoMatch[1], +isoMatch[2], +isoMatch[3]);
    if (millis !== null) return millis;
  }

  // Sistema pt-BR: dd/MM/yyyy, mesma premissa de updateDealProperties.formatDate.
  const brMatch = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    const millis = toUtcMillisStrict(+brMatch[3], +brMatch[2], +brMatch[1]);
    if (millis !== null) return millis;
  }

  console.warn("dataInicio não reconhecida ou fora de faixa:", value);
  return null;
}

exports.main = async (context = {}) => {
  console.log("Fetch Turma Disciplinas - Context:", context);
  const { parameters } = context;
  const { classCode } = parameters;

  const username = process.env.MULESOFT_USERNAME;
  const password = process.env.MULESOFT_PASSWORD;

  if (!username || !password) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "MuleSoft credentials are not set in environment variables.",
    };
  }

  if (!classCode) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Código da turma é obrigatório.",
    };
  }

  const base64Credentials = Buffer.from(`${username}:${password}`).toString(
    "base64",
  );
  const headers = {
    Authorization: `Basic ${base64Credentials}`,
  };

  try {
    const codigoTurma = encodeURIComponent(String(classCode).trim());
    const url = `${process.env.MULESOFT_BASE_URL}/academico/v1/turmas/${codigoTurma}/disciplinas`;
    console.log("Fetching turma disciplinas from URL:", url);

    const response = await axios(url, { method: "GET", headers });

    console.log("Turma Disciplinas Response:", JSON.stringify(response.data));

    const data = response.data || {};
    const rawDisciplinas = Array.isArray(data.disciplinas)
      ? data.disciplinas
      : [];

    const disciplinas = rawDisciplinas.map((disciplina) => ({
      ...disciplina,
      dataInicioTimestamp: parseDataInicio(disciplina.dataInicio),
    }));

    console.log(
      "dataInicio bruto -> timestamp:",
      disciplinas.map(
        (d) => `${d.codigo}: ${d.dataInicio} -> ${d.dataInicioTimestamp}`,
      ),
    );

    if (
      data.qtdeDisciplinas !== undefined &&
      data.qtdeDisciplinas !== disciplinas.length
    ) {
      console.warn(
        `qtdeDisciplinas (${data.qtdeDisciplinas}) difere de disciplinas.length (${disciplinas.length}) na turma ${classCode}.`,
      );
    }

    return {
      status: "SUCCESS",
      response: {
        codigoTurma: data.codigoTurma,
        identificadorTurma: data.identificadorTurma,
        cargaHorariaTotal: data.cargaHorariaTotal,
        qtdeDisciplinas: data.qtdeDisciplinas,
        disciplinas,
      },
    };
  } catch (error) {
    const httpStatus = error.response?.status;
    console.error("Error getting turma disciplinas: ", httpStatus, error.message);
    console.error("Detalhes:", error.response?.data);

    let errorMessage =
      error.response?.data?.error || "Erro ao buscar disciplinas da turma.";

    if (httpStatus === 401 || httpStatus === 403) {
      errorMessage =
        "Sem autorização na API acadêmica da MuleSoft. Verifique as credenciais e a assinatura da API.";
    } else if (httpStatus === 404) {
      errorMessage = `Turma ${classCode} não encontrada na API acadêmica.`;
    }

    console.error(errorMessage);
    return { status: "ERROR", origin: "MULESOFT", message: errorMessage };
  }
};
