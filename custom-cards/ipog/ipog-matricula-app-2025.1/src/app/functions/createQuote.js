const axios = require("axios");

async function getUserInformationBy(ownerId, headers) {
  try {
    const userUrl = `https://api.hubapi.com/crm/v3/objects/users/${ownerId}?idProperty=hs_internal_user_id&properties=hs_email,hs_given_name,hs_family_name,hs_main_phone,hs_job_title`;
    const userResponse = await axios({
      method: "GET",
      url: userUrl,
      headers,
    });

    console.log("User information response:", userResponse.data);

    return userResponse.data;
  } catch (error) {
    console.error("Erro ao buscar informações do usuário:", error.message);
    if (error.response) console.error("Detalhes:", error.response.data);
    throw new Error(
      error.response?.data?.message || "Erro ao buscar informações do usuário.",
    );
  }
}

exports.main = async (context = {}) => {
  console.log("Create Quote - Context:", context);
  const { parameters } = context;
  const { dealId, dealName, ownerId, expirationDate, quoteTemplateId } =
    parameters;

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

  let contactIds = [];
  try {
    const contactsUrl = `https://api.hubapi.com/crm/v4/objects/deal/${dealId}/associations/contacts`;
    const contactsResponse = await axios({
      method: "GET",
      url: contactsUrl,
      headers,
    });

    console.log("Contacts response:", contactsResponse.data);

    if (
      !contactsResponse.data.results ||
      contactsResponse.data.results.length === 0
    ) {
      return {
        status: "ERROR",
        origin: "HUBSPOT",
        message:
          "Criação de proposta falhou: nenhum contato associado ao negócio.",
      };
    }

    contactIds = contactsResponse.data.results.map((r) => r.toObjectId);
  } catch (error) {
    console.error("Erro ao buscar contatos:", error.message);
    if (error.response) console.error("Detalhes:", error.response.data);
    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message:
        error.response?.data?.message || "Erro ao buscar contatos do negócio.",
    };
  }

  let lineItemIds = [];
  try {
    const lineItemsUrl = `https://api.hubapi.com/crm/v4/objects/deal/${dealId}/associations/line_items`;
    const lineItemsResponse = await axios({
      method: "GET",
      url: lineItemsUrl,
      headers,
    });

    console.log("Line items response:", lineItemsResponse.data);

    if (
      !lineItemsResponse.data.results ||
      lineItemsResponse.data.results.length === 0
    ) {
      return {
        status: "ERROR",
        origin: "HUBSPOT",
        message:
          "Criação de proposta falhou: nenhum item de linha associado ao negócio.",
      };
    }

    lineItemIds = lineItemsResponse.data.results.map((r) => r.toObjectId);
  } catch (error) {
    console.error("Erro ao buscar itens de linha:", error.message);
    if (error.response) console.error("Detalhes:", error.response.data);
    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message:
        error.response?.data?.message ||
        "Erro ao buscar itens de linha do negócio.",
    };
  }

  let ownerInformation;
  try {
    ownerInformation = await getUserInformationBy(ownerId, headers);
  } catch (error) {
    console.error("Erro ao buscar informações do proprietário:", error.message);
    if (error.response) console.error("Detalhes:", error.response.data);
    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message:
        error.response?.data?.message ||
        "Erro ao buscar informações do proprietário.",
    };
  }

  try {
    const quoteUrl = "https://api.hubapi.com/crm/v3/objects/quotes";

    const associations = [
      {
        to: { id: dealId },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 64 },
        ],
      },
      ...contactIds.map((contactId) => ({
        to: { id: contactId },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 69 },
        ],
      })),
      ...lineItemIds.map((lineItemId) => ({
        to: { id: lineItemId },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 67 },
        ],
      })),
    ];

    if (quoteTemplateId) {
      associations.push({
        to: { id: quoteTemplateId },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 286 },
        ],
      });
    }

    const quotePayload = {
      properties: {
        hs_title: dealName || `Proposta - Deal ${dealId}`,
        hubspot_owner_id: ownerId ? Number(ownerId) : "",
        hs_quote_owner_id: ownerId ? Number(ownerId) : "",
        hs_sender_email: ownerInformation.properties.hs_email || "",
        hs_sender_firstname: ownerInformation.properties.hs_given_name || "",
        hs_sender_lastname: ownerInformation.properties.hs_family_name || "",
        hs_sender_phone: ownerInformation.properties.hs_main_phone || "",
        hs_sender_jobtitle: ownerInformation.properties.hs_job_title || "",
        hs_expiration_date: expirationDate,
        hs_status: "APPROVED",
        hs_currency: "BRL",
      },
      associations,
    };

    console.log(
      "Criando quote com payload:",
      JSON.stringify(quotePayload, null, 2),
    );

    const quoteResponse = await axios({
      method: "POST",
      url: quoteUrl,
      headers,
      data: quotePayload,
    });

    console.log("Quote criada:", quoteResponse.data);

    return {
      status: "SUCCESS",
      response: {
        quoteId: quoteResponse.data.id,
      },
    };
  } catch (error) {
    console.error("Erro ao criar quote:", error.message);
    if (error.response) console.error("Detalhes:", error.response.data);
    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message: error.response?.data?.message || "Erro ao criar proposta.",
    };
  }
};
