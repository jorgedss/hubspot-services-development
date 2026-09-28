const axios = require("axios");

exports.main = async (context = {}) => {
  const { postalCode } = context.parameters;

  // Validate postal code
  if (!postalCode || postalCode.length !== 8) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "CEP inválido. Deve conter 8 dígitos.",
    };
  }

  try {
    const response = await axios.get(
      `https://viacep.com.br/ws/${postalCode}/json/`
    );

    if (response.data.erro) {
      return {
        status: "ERROR",
        origin: "VIACEP",
        message: "CEP não encontrado.",
      };
    }

    const addressData = response.data;
    return {
      status: "SUCCESS",
      response: {
        street: addressData.logradouro || "",
        neighborhood: addressData.bairro || "",
        city: addressData.localidade || "",
        state: addressData.uf || "",
        ibgeCode: addressData.ibge || "",
        complement: addressData.complemento || "",
      },
    };
  } catch (error) {
    console.error("Error fetching postal code:", error);

    return {
      status: "ERROR",
      origin: "VIACEP",
      message: "Erro ao buscar CEP. Tente novamente.",
    };
  }
};
