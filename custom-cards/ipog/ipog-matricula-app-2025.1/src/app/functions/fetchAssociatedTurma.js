const axios = require("axios");

exports.main = async (context = {}) => {
  console.log("Fetch Associated Turma - Context:", context);
  const { parameters } = context;
  const { dealId, classObjectId } = parameters;

  const apiKey = process.env.HUBSPOT_API_KEY;

  if (!apiKey) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "HUBSPOT_API_KEY não configurada.",
    };
  }

  if (!dealId) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "dealId é obrigatório.",
    };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  try {
    console.log(`Buscando associação de turma para deal ${dealId}...`);
    const associationUrl = `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/${classObjectId}`;

    const associationResponse = await axios({
      method: "GET",
      url: associationUrl,
      headers,
    });

    console.log("Resposta da associação:", associationResponse.data);

    if (
      !associationResponse.data.results ||
      associationResponse.data.results.length === 0
    ) {
      return {
        status: "ERROR",
        origin: "HUBSPOT",
        message: "Nenhuma turma associada a este negócio.",
      };
    }

    const turmaId = associationResponse.data.results[0].toObjectId;
    console.log(`Turma associada encontrada: ${turmaId}`);

    const turmaUrl = `https://api.hubapi.com/crm/v3/objects/${classObjectId}/${turmaId}`;

    const turmaResponse = await axios({
      method: "GET",
      url: turmaUrl,
      headers,
      params: {
        properties:
          "unidadeensino,id_da_turma,id_do_curso,nome_da_turma,unidade_name,unidade,modalidade_da_turma,nivel_de_interesse,nome_do_curso,data_de_inauguracao,databasegeracaoparcelas",
      },
    });

    console.log("Dados da turma:", turmaResponse.data);

    return {
      status: "SUCCESS",
      response: {
        toObjectId: turmaResponse.data.id,
        properties: turmaResponse.data.properties,
      },
    };
  } catch (error) {
    console.error("Erro ao buscar turma associada:", error.message);

    if (error.response) {
      console.error("Detalhes do erro:", error.response.data);
    }

    const errorMessage =
      error.response?.data?.message ||
      error.message ||
      "Erro desconhecido ao buscar turma.";

    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message: `Erro ao buscar turma: ${errorMessage}`,
    };
  }
};
