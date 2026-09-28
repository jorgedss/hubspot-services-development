const axios = require("axios");
const hubspot = require("@hubspot/api-client");

async function updateDealBy(dealId, payload) {
  try {
    const hubspotClient = new hubspot.Client({
      accessToken: process.env.HUBSPOT_API_KEY,
    });

    // aluno_cadastrado_status é a única marca no Negócio de que o incluirPessoa
    // rodou de verdade. "Salvar rascunho" grava cpf sem chamar a MuleSoft, então
    // o cpf sozinho não distingue rascunho de cadastro concluído.
    await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: {
        cpf: payload.CPF,
        aluno_cadastrado_status: "true",
      },
    });
    return {
      status: "SUCCESS",
      message: "Deal atualizado com sucesso.",
    };
  } catch (error) {
    console.error(error.message);
    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message:
        "Aluno cadastrado no SEI, mas não foi possível marcar o cadastro no Negócio. Acione o administrador para liberar a geração de matrícula.",
    };
  }
}

async function registerStudentOnSei(studentProperties) {
  const username = process.env.MULESOFT_USERNAME;
  const password = process.env.MULESOFT_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "MuleSoft credentials are not set in environment variables.",
    );
  }
  const base64Credentials = Buffer.from(`${username}:${password}`).toString(
    "base64",
  );
  const headers = {
    Authorization: `Basic ${base64Credentials}`,
  };
  const url = `${process.env.MULESOFT_BASE_URL}/matricula/v1/incluirPessoa`;
  try {
    const student = await axios({
      method: "POST",
      url,
      data: studentProperties,
      headers,
    });

    console.log("Criação de aluno: ", student.data);
    if (student.data?.responseSEI?.statusCode === "200") {
      return {
        status: "SUCCESS",
        message: student.data.responseSEI.mensagem,
      };
    }

    return {
      status: "ERROR",
      origin: "MULESOFT",
      message:
        student.data?.responseSEI?.mensagem ||
        student.data?.message?.mensagem ||
        "Erro ao cadastrar Aluno.",
    };
  } catch (error) {
    console.error(error.message);

    return {
      status: "ERROR",
      origin: "MULESOFT",
      message: "Erro ao cadastrar Aluno.",
    };
  }
}

function formatCep(cep) {
  if (!cep) {
    return "";
  }

  return cep.replace(/(\d{2})(\d{3})(\d{3})/, "$1.$2-$3");
}

function formatBirthDate(dateString) {
  if (!dateString) {
    return "";
  }

  try {
    const parts = dateString.split("/");
    if (parts.length !== 3) {
      console.error("Formato de data inválido:", dateString);
      return "";
    }

    const month = parts[0];
    const day = parts[1];
    const year = parts[2];

    return `${year}-${month}-${day}T`;
  } catch (error) {
    console.error("Erro ao formatar data de nascimento:", error);
    return "";
  }
}

exports.main = async (context = {}) => {
  const {
    dealId,
    name,
    email,
    phoneNumber,
    user,
    cpf,
    birthDate,
    postalCode,
    state,
    streetNumber,
    addressComplement,
    street,
    neighborhood,
    city,
    ibgeCityCode,
    ibgeBirthplaceCode,
  } = context.parameters;

  console.log("Required data for register student: ", {
    dealId,
    name,
    email,
    phoneNumber,
    user,
    cpf,
    birthDate,
    postalCode,
    state,
    streetNumber,
    street,
    neighborhood,
    city,
    ibgeCityCode,
    ibgeBirthplaceCode,
  });

  if (
    !dealId ||
    !email ||
    !phoneNumber ||
    !cpf ||
    !birthDate ||
    !name ||
    !user ||
    !postalCode ||
    !state ||
    !city ||
    !streetNumber ||
    !street ||
    !neighborhood ||
    !ibgeCityCode ||
    !ibgeBirthplaceCode
  ) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Campos obrigatórios faltando.",
    };
  }

  const studentProperties = {
    nome: name,
    email: email,
    CPF: cpf,
    celular: phoneNumber,
    dataNasc: formatBirthDate(birthDate?.formattedDate || birthDate),
    CEP: formatCep(postalCode),
    siglaEstado: state,
    nomeCidade: city,
    endereco: `${street} - ${neighborhood}`,
    numero: streetNumber,
    complemento: addressComplement,
    codigoIBGECidade: ibgeCityCode,
    codigoIBGENaturalidade: ibgeBirthplaceCode,
    nomeNaturalidade: "Brasileiro",
    setor: neighborhood,
    usuarioResponsavel: +user,
  };

  console.log("studentProperties", studentProperties);

  try {
    const studentRegistered = await registerStudentOnSei(studentProperties);

    if (studentRegistered.status === "ERROR") {
      return studentRegistered;
    }

    const updatedDeal = await updateDealBy(dealId, studentProperties);

    if (updatedDeal.status === "ERROR") {
      return updatedDeal;
    }

    return {
      status: "SUCCESS",
      message: "Aluno cadastrado com sucesso!",
    };
  } catch (error) {
    console.error("Error registering student:", error);

    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Erro ao cadastrar aluno. Tente novamente.",
    };
  }
};
