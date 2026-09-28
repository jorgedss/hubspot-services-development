const hubspot = require("@hubspot/api-client");
const axios = require("axios");

function formatDate(timestamp) {
  if (!timestamp) {
    return "";
  }

  try {
    if (timestamp.formattedDate) {
      const { year, month, date: day } = timestamp;
      return `${year}-${String(month + 1).padStart(2, "0")}-${String(
        day,
      ).padStart(2, "0")}`;
    }

    const date = new Date(parseInt(timestamp));
    if (isNaN(date.getTime())) {
      console.error("Timestamp inválido:", timestamp);
      return "";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error("Erro ao formatar data:", error);
    return "";
  }
}

// Propriedade de data no HubSpot é epoch UTC à meia-noite, a mesma convenção de
// updateDealRegisterInformations ao gravar data_de_nascimento, e é o que o
// parseInt do card espera na leitura. A entrada é o yyyy-MM-dd que já foi para a
// MuleSoft, então as duas escritas não conseguem divergir.
function toUtcMidnightMillis(formattedDate) {
  if (!formattedDate) {
    return null;
  }

  const millis = Date.parse(`${formattedDate}T00:00:00Z`);
  if (isNaN(millis)) {
    console.error("Data formatada inválida:", formattedDate);
    return null;
  }

  return millis;
}

function extractMulesoftErrorMessage(responseData) {
  if (!responseData) return null;

  if (responseData.mensagem) return responseData.mensagem;

  if (
    Array.isArray(responseData.mensagens) &&
    responseData.mensagens.length > 0
  ) {
    return responseData.mensagens[0];
  }

  return null;
}

function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

// booleancheckbox chega como string, mas a comparação é tolerante porque o
// precedente verificado no card é de enumeration/select e a propriedade pode ser
// recriada com o outro tipo.
function isFlagEnabled(value) {
  return String(value).toLowerCase() === "true";
}

// Segunda camada do bloqueio. O card já desabilita o botão, mas a mesma função
// pode ser chamada por um bundle em cache, então quem decide é o Negócio.
async function validateStudentRegistration(hubspotClient, dealId, studentCpf) {
  let deal;

  try {
    deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
      "aluno_cadastrado_status",
      "cpf",
      "codigocondicao",
      "turmaidentificador",
    ]);
  } catch (error) {
    console.error("Erro ao ler o Negócio antes da matrícula:", error.message);
    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message: "Não foi possível validar o cadastro do aluno no Negócio.",
    };
  }

  const properties = deal?.properties || {};
  console.log("Propriedades lidas para validar o cadastro: ", properties);

  if (!isFlagEnabled(properties.aluno_cadastrado_status)) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message:
        "Cadastro do aluno não concluído. Conclua a Seção A antes de gerar a matrícula.",
    };
  }

  const missing = ["cpf", "codigocondicao", "turmaidentificador"].filter(
    (name) => !properties[name],
  );

  if (missing.length > 0) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: `Propriedades obrigatórias do Negócio não preenchidas: ${missing.join(
        ", ",
      )}.`,
    };
  }

  // A flag responde por um cpf específico, o que está gravado no Negócio. Se o
  // cpf recebido for outro, a flag não cobre esse aluno.
  if (normalizeCpf(studentCpf) !== normalizeCpf(properties.cpf)) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message:
        "O CPF enviado não é o do cadastro concluído no Negócio. Salve o cadastro e cadastre o aluno novamente antes de gerar a matrícula.",
    };
  }

  return null;
}

function extractRegisterNumber(field) {
  if (!field) {
    return "";
  }

  const registerNumber = field.matricula;

  if (registerNumber) {
    return registerNumber;
  }

  return "";
}

exports.main = async (context = {}) => {
  const {
    dealId,
    enrollmentType,
    additionalAmount,
    studentStartModule,
    studentStartDate,
    typeOfInterest,
    levelOfInterest,
    educationType,
    studentCpf,
    consultantEmail,
    conditionCode,
    discountCodes,
    installmentBaseDate,
    classIdentifier,
    automaticInstallmentGeneration,
  } = context.parameters;

  if (!dealId || !studentCpf || !enrollmentType) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Campos obrigatórios faltando.",
    };
  }

  const hubspotClient = new hubspot.Client({
    accessToken: process.env.HUBSPOT_API_KEY,
  });

  // Fora do try porque o caminho de erro também grava data_de_inicio: a
  // matrícula pode ser criada no SEI com a requisição ainda falhando.
  const isEadPos =
    typeOfInterest === "EAD" && levelOfInterest === "Pós-graduação";
  const mesIngresso =
    isEadPos && studentStartDate ? formatDate(studentStartDate) : "";
  const startDateMillis = toUtcMidnightMillis(mesIngresso);
  const registrationError = await validateStudentRegistration(
    hubspotClient,
    dealId,
    studentCpf,
  );

  if (registrationError) {
    console.log("Matrícula recusada: ", registrationError.message);
    return registrationError;
  }

  try {
    const educationMapper = {
      "Ensino fundamental": "ENSINO_FUNDAMENTAL",
      "Ensino médio": "ENSINO_MEDIO",
      Graduação: "GRADUACAO",
      Tecnólogo: "TECNICO",
      Especialização: "ESPECIALIZACAO",
      "Pós-graduação": "POS_GRADUACAO",
      Mestrado: "MESTRADO",
      Doutorado: "DOUTORADO",
    };

    const enrollmentPayload = {
      turmaIdentificador: classIdentifier,
      condicao: +conditionCode,
      consultorEmail: consultantEmail,
      cpf: studentCpf,
      escolaridade: educationMapper[educationType],
      dataBaseGeracaoParcela: formatDate(installmentBaseDate),
      geracaoDeParcelaAutomatica: automaticInstallmentGeneration,
    };

    if (studentStartModule) {
      enrollmentPayload.moduloInicial = +studentStartModule;
    }

    if (discountCodes && discountCodes.trim() !== "") {
      enrollmentPayload.planoDescontoVOs = discountCodes
        .split(";")
        .map((code) => ({ planoDesconto: +code }));
    }

    if (mesIngresso) {
      enrollmentPayload.mesIngresso = mesIngresso;
    }

    if (additionalAmount && +additionalAmount > 0) {
      enrollmentPayload.acrescimo = additionalAmount;
    }

    console.log("Body para criar matrícula: ", enrollmentPayload);

    const username = process.env.MULESOFT_USERNAME;
    const password = process.env.MULESOFT_PASSWORD;
    if (!username || !password) {
      return {
        status: "ERROR",
        origin: "SISTEMA",
        message: "MuleSoft credentials are not set in environment variables.",
      };
    }
    const base64Credentials = Buffer.from(`${username}:${password}`).toString(
      "base64",
    );
    const headers = {
      Authorization: `Basic ${base64Credentials}`,
    };

    const externalApiUrl = `${process.env.MULESOFT_BASE_URL}/matricula/v1/matricularPessoaIpog`;

    const externalResponse = await axios({
      method: "POST",
      url: externalApiUrl,
      data: enrollmentPayload,
      headers,
    });

    const response = externalResponse.data;
    if (
      response.statusCode == "500" ||
      response.status == "INTERNAL_SERVER_ERROR"
    ) {
      console.error("Erro: ", response);
      return {
        status: "ERROR",
        origin: "MULESOFT",
        message:
          extractMulesoftErrorMessage(response) ||
          "Erro ao realizar a matrícula.",
      };
    }

    console.log("Matricula periodo: ", response.matriculaPeriodo);

    const registerNumber = extractRegisterNumber(response.matriculaPeriodo);
    console.log("registerNumber", registerNumber);

    const dealUpdateProperties = {
      id_da_matricula: registerNumber,
      escolaridade_do_aluno: educationType,
    };

    // A guarda herda o gate EAD + Pós que produziu mesIngresso, sem repetir a
    // condição. Mesma data que foi enviada à MuleSoft, em epoch UTC.
    if (startDateMillis) {
      dealUpdateProperties.data_de_inicio = startDateMillis;
    }

    await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: dealUpdateProperties,
    });

    return {
      status: "SUCCESS",
      message: "Matrícula gerada com sucesso!",
      registerNumber: registerNumber,
    };
  } catch (error) {
    const responseData = error.response?.data;
    console.log("Error generating enrollment:", responseData);

    const origin = responseData ? "MULESOFT" : "HUBSPOT";

    const registerNumber = extractRegisterNumber(
      responseData?.matriculaPeriodo || responseData?.data?.matriculaPeriodo,
    );
    if (registerNumber) {
      console.log("Número de matrícula encontrado no erro:", registerNumber);
      const errorPathProperties = { id_da_matricula: registerNumber };
      if (startDateMillis) {
        errorPathProperties.data_de_inicio = startDateMillis;
      }
      await hubspotClient.crm.deals.basicApi.update(dealId, {
        properties: errorPathProperties,
      });
    }

    const errorMessage =
      extractMulesoftErrorMessage(responseData) ||
      error.message ||
      "Erro ao gerar matrícula. Tente novamente.";

    return {
      status: "ERROR",
      origin,
      message: errorMessage,
    };
  }
};
