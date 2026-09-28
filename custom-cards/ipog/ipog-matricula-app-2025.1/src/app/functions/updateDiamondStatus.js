const axios = require("axios");

async function updateDiamondsBy(diamondIds, token, diamondObjId) {
  const url = `https://api.hubapi.com/crm/v3/objects/${diamondObjId}/batch/update`;
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  const diamondsIdArray = diamondIds.split(";").map((id) => id.trim());

  const payload = {
    inputs: diamondsIdArray.map((id) => ({
      id,
      properties: {
        indicacao_ativa: "Convertida em desconto",
      },
    })),
  };

  try {
    const response = await axios({
      method: "POST",
      url,
      headers,
      data: payload,
    });

    return response.data;
  } catch (error) {
    console.error("Error updating diamonds: ", error.message);
    const errorMessage =
      error.response?.data?.message || "Unknown error on Hubspot.";

    console.error(errorMessage);

    throw new Error(errorMessage);
  }
}

exports.main = async (context = {}) => {
  console.log("Update diamond status - Context:", context);

  const { parameters } = context;
  const { diamonds } = parameters;
  console.log("Received diamonds:", diamonds);

  if (!diamonds) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Diamond ids is required",
    };
  }

  if (!process.env.HUBSPOT_API_KEY) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Credentials for Hubspot not found.",
    };
  }

  if (!process.env.DIAMANTE_OBJ_ID) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Diamond object ID not found.",
    };
  }

  console.log("Starting diamond update process...");

  try {
    const diamondsUpdated = await updateDiamondsBy(
      diamonds,
      process.env.HUBSPOT_API_KEY,
      process.env.DIAMANTE_OBJ_ID,
    );
    console.log("Diamonds updated successfully:", diamondsUpdated);
  } catch (error) {
    console.error("Error in updateDiamondsBy function:", error.message);
  }
};
