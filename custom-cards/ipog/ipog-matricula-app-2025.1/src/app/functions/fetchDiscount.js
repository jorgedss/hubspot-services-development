const axios = require("axios");

exports.main = async (context = {}) => {
  console.log("Fetch Discount - Context:", context);
  const { parameters } = context;
  const { categoriadesconto } = parameters;

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
    const url = `${process.env.MULESOFT_BASE_URL}/matricula/v1/planoDesconto?categoria=${categoriadesconto}`;
    console.log("Fetching discount from URL:", url);

    const response = await axios(url, { method: "GET", headers });

    console.log("Discount Response:", response.data);

    return { status: "SUCCESS", response: response.data };
  } catch (error) {
    console.error("Error getting discount: ", error.message);

    const errorMessage =
      error.response?.data?.error || "Erro ao buscar desconto.";

    console.error(errorMessage);
    return { status: "ERROR", origin: "MULESOFT", message: errorMessage };
  }
};
