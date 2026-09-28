const axios = require("axios");

exports.main = async (context = {}) => {
  console.log("Fetch Financial Plan CEU - Context:", context);
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
    const url = `${process.env.MULESOFT_BASE_URL}/matricula/v1/planoFinanceiroTurmaCeu?idTurma=${properties.turma}`;

    const response = await axios(url, { method: "GET", headers });

    response.data.condicoes = response.data?.condicoes.map((cond) => {
      return {
        ...cond,
        valorParcela: parseFloat(
          cond.valorParcela.replace(/\./g, "").replace(",", "."),
        ),
      };
    });
    console.log("Financial Plan Response:", response.data);

    return { status: "SUCCESS", response: response.data };
  } catch (error) {
    console.error("Error getting financial plan: ", error.message);

    const errorMessage =
      error.response?.data?.error || "Erro ao buscar plano financeiro CEU.";

    console.error(errorMessage);
    return { status: "ERROR", origin: "MULESOFT", message: errorMessage };
  }
};
