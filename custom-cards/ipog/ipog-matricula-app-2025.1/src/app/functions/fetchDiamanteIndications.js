const axios = require("axios");

exports.main = async (context = {}) => {
  console.log("Fetch Diamante Indications - Context:", context);

  const { parameters } = context;
  const { contactId, dealNivelInteresse } = parameters;

  if (!contactId) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Contact ID is required",
    };
  }

  if (!dealNivelInteresse) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Deal nivel_de_interesse is required for filtering",
    };
  }

  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Credentials for Hubspot not found.",
    };
  }

  const diamanteObjId = process.env.DIAMANTE_OBJ_ID;
  if (!diamanteObjId) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "DIAMANTE_OBJ_ID environment variable not configured.",
    };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  try {
    // Step 1: Fetch associations between Contact and Diamante via v4 API
    const associationsUrl = `https://api.hubapi.com/crm/v4/objects/contacts/${contactId}/associations/${diamanteObjId}`;
    console.log("Fetching associations from:", associationsUrl);

    const associationsResponse = await axios({
      method: "GET",
      url: associationsUrl,
      headers,
    });

    console.log("Associations response:", associationsResponse.data);

    if (
      !associationsResponse.data.results ||
      associationsResponse.data.results.length === 0
    ) {
      return {
        status: "SUCCESS",
        response: [],
      };
    }

    const diamanteIds = associationsResponse.data.results.map(
      (r) => r.toObjectId,
    );
    console.log("Diamante IDs found:", diamanteIds);

    // Step 2: Search Diamante objects with filters via v3 API
    const searchUrl = `https://api.hubapi.com/crm/v3/objects/${diamanteObjId}/search`;
    const searchPayload = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hs_object_id",
              operator: "IN",
              values: diamanteIds,
            },
            {
              propertyName: "nivel_educacional",
              operator: "EQ",
              value: dealNivelInteresse,
            },
            {
              propertyName: "indicacao_ativa",
              operator: "EQ",
              value: "Indicação convertida",
            },
          ],
        },
      ],
      properties: [
        "nome_do_indicado",
        "nivel_educacional",
        "indicacao_ativa",
        "data_de_expiracao",
      ],
      limit: diamanteIds.length,
    };

    console.log("Search payload:", JSON.stringify(searchPayload, null, 2));

    const searchResponse = await axios({
      method: "POST",
      url: searchUrl,
      headers,
      data: searchPayload,
    });

    console.log("Search response:", searchResponse.data);

    const results = (searchResponse.data.results || []).map((record) => ({
      id: record.id,
      nome_do_indicado: record.properties.nome_do_indicado || "",
      nivel_educacional: record.properties.nivel_educacional || "",
      indicacao_ativa: record.properties.indicacao_ativa || "",
      data_de_expiracao: record.properties.data_de_expiracao || "",
    }));

    return {
      status: "SUCCESS",
      response: results,
    };
  } catch (error) {
    console.error("Error fetching diamante indications:", error.message);
    if (error.response) {
      console.error("Error details:", error.response.data);
    }

    const errorMessage =
      error.response?.data?.message ||
      error.message ||
      "Erro ao buscar indicações diamante.";

    return { status: "ERROR", origin: "HUBSPOT", message: errorMessage };
  }
};
