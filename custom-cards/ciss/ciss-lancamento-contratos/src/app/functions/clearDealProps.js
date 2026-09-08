const axios = require("axios");

exports.main = async (event) => {
  const TOKEN = process.env.PRIVATE_APP_ACCESS_TOKEN;
  const BASE = "https://api.hubapi.com";
  const { dealId } = event.parameters;

  try {
    await axios.patch(
      `${BASE}/crm/v3/objects/deals/${dealId}`,
      {
        properties: {
          tipo_de_contrato: "",
          sistema: "",
          modelo_de_vendas: "",
          modulo: "",
          item_modulo: "",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    return { sucesso: true };
  } catch (error) {
    console.error("❌ ERRO:", error.message);
    console.error("❌ DATA:", JSON.stringify(error.response?.data));
    return { sucesso: false, erro: error.message };
  }
};
