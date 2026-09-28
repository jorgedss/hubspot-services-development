const axios = require("axios");

exports.main = async () => {
  const token = process.env.HUBSPOT_API_KEY;

  if (!token) {
    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message: "HUBSPOT_API_KEY não configurada.",
    };
  }

  try {
    const response = await axios.get(
      "https://api.hubapi.com/crm/v3/properties/deals/categorias_aprovadas",
      { headers: { Authorization: `Bearer ${token}` } },
    );

    return {
      status: "SUCCESS",
      options: (response.data.options || []).map(({ value, label }) => ({
        value,
        label,
      })),
    };
  } catch (error) {
    console.error("Error getting deal property options:", error.message);
    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message:
        error.response?.data?.message ||
        "Não foi possível carregar as categorias aprovadas.",
    };
  }
};
