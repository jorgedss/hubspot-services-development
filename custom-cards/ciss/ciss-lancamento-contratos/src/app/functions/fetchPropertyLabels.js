const axios = require("axios");

const buildLabelMap = (options) =>
  (options || []).reduce((acc, option) => {
    acc[option.value] = option.label;
    return acc;
  }, {});

const fetchPropertyOptions = async (propertyName, apiClient) => {
  const { data } = await apiClient.get(
    `/crm/v3/properties/deals/${propertyName}`,
  );
  return buildLabelMap(data.options);
};

exports.main = async (event) => {
  const TOKEN = process.env.PRIVATE_APP_ACCESS_TOKEN;
  const BASE = "https://api.hubapi.com";

  const apiClient = axios.create({
    baseURL: BASE,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  try {
    const [tipoDeContrato, sistema] = await Promise.all([
      fetchPropertyOptions("tipo_de_contrato", apiClient),
      fetchPropertyOptions("sistema", apiClient),
    ]);

    return {
      sucesso: true,
      labels: { tipoDeContrato, sistema },
    };
  } catch (error) {
    console.error("❌ ERRO:", error.message);
    console.error("❌ DATA:", JSON.stringify(error.response?.data));
    return { sucesso: false, erro: error.message };
  }
};
