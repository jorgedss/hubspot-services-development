const axios = require("axios");

exports.main = async (context = {}) => {
  console.log("Fetch Financial Plan - Context:", context);
  const { parameters } = context;
  const { properties } = parameters;
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
  try {
    const url = `${process.env.MULESOFT_BASE_URL}/matricula/v1/planoFinanceiroTurma?idTurma=${properties.turma}&idUnidadeEnsino=${properties.unidade_id}&formaPagamento=${properties.selectedTipoPagamento}`;

    const response = await axios(url, { method: "GET", headers });

    console.log("Financial Plan Response:", response.data);

    return { status: "SUCCESS", response: response.data };
  } catch (error) {
    console.error("Error getting financial plan: ", error.message);

    const errorMessage =
      error.response?.data?.error || "Erro ao buscar plano financeiro.";

    console.error(errorMessage);
    return { status: "ERROR", origin: "MULESOFT", message: errorMessage };
  }
};
