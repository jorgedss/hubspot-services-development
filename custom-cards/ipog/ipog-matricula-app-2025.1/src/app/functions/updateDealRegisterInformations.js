const axios = require("axios");

// Só existe para comparar. O formato gravado nunca é reescrito, porque o cpf do
// Negócio é enviado com máscara para a MuleSoft em incluirPessoa e em
// matricularPessoaIpog, e mudar o formato mudaria o que a MuleSoft recebe.
function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

async function fetchDealCpf(id, token) {
  const url = `https://api.hubapi.com/crm/v3/objects/deals/${id}?properties=cpf`;
  const response = await axios({
    method: "GET",
    url,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return response.data?.properties?.cpf || "";
}

async function updateDealBy(id, payload, token) {
  const url = `https://api.hubapi.com/crm/v3/objects/deals/${id}`;
  try {
    const response = await axios({
      method: "PATCH",
      url,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      data: { properties: payload },
    });
    console.log("response:", response);

    return response.data;
  } catch (error) {
    console.log("Error updating deal:", error);

    const statusCode =
      error.response?.statusCode || error.code || error.statusCode;
    const apiErrorMessage =
      error.response?.body?.message ||
      error.body?.message ||
      error.message ||
      "Erro desconhecido";

    console.log(
      "Error details - Status:",
      statusCode,
      "Message:",
      apiErrorMessage,
    );

    let userMessage = "Erro ao salvar dados no Deal.";

    if (statusCode === 401 || statusCode === 403) {
      userMessage = "Erro de autenticação com HubSpot.";
    } else if (statusCode === 404) {
      userMessage = "Deal não encontrado.";
    } else if (statusCode === 429) {
      userMessage = "Limite de requisições excedido. Tente novamente.";
    } else if (statusCode >= 500) {
      userMessage = "Erro no servidor HubSpot. Tente novamente.";
    }

    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message: userMessage,
      error: apiErrorMessage,
    };
  }
}

exports.main = async (context = {}) => {
  console.log("Update Deal Register Informations - Context:", context);

  const { parameters } = context;
  const dealId = context.propertiesToSend?.hs_object_id || parameters?.dealId;

  if (!dealId) {
    console.log("Deal ID is required");
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Deal ID é obrigatório.",
    };
  }

  if (!process.env.HUBSPOT_API_KEY) {
    console.log("HubSpot API key not found");
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Credenciais do HubSpot não encontradas.",
    };
  }

  const {
    nome_completo,
    e_mail,
    cpf,
    numero_de_telefone,
    data_de_nascimento,
    cep,
    rua,
    numero,
    complemento,
    bairro,
    city,
    sigla_estado,
  } = parameters || {};

  const properties = {};
  try {
    if (nome_completo !== undefined) properties.nome_completo = nome_completo;
    if (e_mail !== undefined) properties.e_mail = e_mail;
    if (cpf !== undefined) {
      properties.cpf = cpf;

      // A flag garante o cadastro de um cpf específico no SEI. Trocar o cpf
      // significa que o aluno cadastrado não é mais o aluno do Negócio, então a
      // flag cai e o consultor precisa cadastrar de novo.
      try {
        const currentCpf = await fetchDealCpf(
          dealId,
          process.env.HUBSPOT_API_KEY,
        );

        if (normalizeCpf(cpf) !== normalizeCpf(currentCpf)) {
          properties.aluno_cadastrado_status = "false";
          console.log(
            "CPF alterado no Negócio, invalidando aluno_cadastrado_status.",
          );
        }
      } catch (error) {
        // Uma falha de leitura não pode derrubar o salvamento, então a flag
        // fica como está e o bloqueio de generateEnrollment segue valendo.
        console.log("Erro ao ler o cpf atual do Negócio:", error.message);
      }
    }
    if (numero_de_telefone !== undefined)
      properties.numero_de_telefone = numero_de_telefone;
    if (data_de_nascimento !== undefined)
      properties.data_de_nascimento = +data_de_nascimento;
    if (cep !== undefined) properties.cep = cep;
    if (rua !== undefined) properties.rua = rua;
    if (numero !== undefined) properties.numero = numero;
    if (complemento !== undefined) properties.complemento = complemento;
    if (bairro !== undefined) properties.bairro = bairro;
    if (city !== undefined) properties.city = city;
    if (sigla_estado !== undefined) properties.sigla_estado = sigla_estado;

    console.log("Updating deal with properties:", properties);

    const response = await updateDealBy(
      dealId,
      properties,
      process.env.HUBSPOT_API_KEY,
    );
    console.log("Deal updated response: ", response);

    // updateDealBy captura o erro e devolve o envelope de ERROR, então sem este
    // repasse um PATCH recusado pelo HubSpot chegaria ao card como sucesso e o
    // consultor veria "Rascunho salvo" sem nada ter sido gravado.
    if (response?.status === "ERROR") {
      return response;
    }

    return {
      status: "SUCCESS",
      dealId: dealId,
      updatedProperties: response,
    };
  } catch (error) {
    console.log("Error:", error);
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: error.message,
    };
  }
};
