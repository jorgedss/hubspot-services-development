const hubspot = require("@hubspot/api-client");
const axios = require("axios");

async function getLineItemDataBy(dealId, token) {
  const url = `https://api.hubapi.com/crm/v3/objects/line_items/search`;
  const headers = {
    Authorization: `Bearer ${token}`,
  };
  const payload = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "associations.deal",
            operator: "EQ",
            value: dealId,
          },
        ],
      },
    ],
    properties: ["name", "preco_unitario", "frequencia_de_cobranca"],
    limit: 2,
    after: 0,
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
    console.error("Error searching line item: ", error);
    const errorMessage =
      error.response?.data?.message || "Unknown error on Hubspot.";

    console.error(errorMessage);

    throw new Error(errorMessage);
  }
}

async function searchLineItems(lineItemIds, token) {
  const url = `https://api.hubapi.com/crm/v3/objects/line_items/search`;
  const headers = {
    Authorization: `Bearer ${token}`,
  };

  const payload = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: "hs_object_id",
            operator: "IN",
            values: lineItemIds,
          },
        ],
      },
    ],
    properties: ["name"],
    limit: lineItemIds.length,
    after: 0,
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
    console.error("Error searching line items: ", error.message);
    const errorMessage =
      error.response?.data?.message || "Unknown error on Hubspot.";

    console.error(errorMessage);

    throw new Error(errorMessage);
  }
}

async function updateLineItems(payload, token) {
  const url = `https://api.hubapi.com/crm/v3/objects/line_items/batch/update`;
  const headers = {
    Authorization: `Bearer ${token}`,
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
    console.error("Error updating line items: ", error.message);
    const errorMessage =
      error.response?.data?.message || "Unknown error on Hubspot.";

    console.error(errorMessage);

    throw new Error(errorMessage);
  }
}

async function createLineItems(payload, token) {
  const url = `https://api.hubapi.com/crm/v3/objects/line_items/batch/create`;
  const headers = {
    Authorization: `Bearer ${token}`,
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
    console.error("Error creating line item: ", error.message);
    const errorMessage =
      error.response?.data?.message || "Unknown error on Hubspot.";

    console.error(errorMessage);

    throw new Error(errorMessage);
  }
}

exports.main = async (context = {}) => {
  console.log("Update Graduation Deal - Context:", context);

  const { parameters } = context;
  const {
    dealId,
    graduationPlan,
    selectedCondition,
    selectedCategory,
    discountAmount,
    discountType,
    discountValue,
    discountMatriculaValue,
    valorParcela,
    valorMatricula,
    nrParcelasCobranca,
    discountDescription,
    entryMethod,
  } = parameters;

  if (!dealId) {
    return { status: "ERROR", origin: "SISTEMA", message: "Deal ID is required" };
  }

  if (!selectedCondition) {
    return { status: "ERROR", origin: "SISTEMA", message: "Selected condition is required" };
  }

  if (!graduationPlan) {
    return { status: "ERROR", origin: "SISTEMA", message: "Graduation plan data is required" };
  }

  if (!process.env.HUBSPOT_API_KEY) {
    return { status: "ERROR", origin: "SISTEMA", message: "Credentials for Hubspot not found." };
  }

  const hubspotClient = new hubspot.Client({
    accessToken: process.env.HUBSPOT_API_KEY,
  });

  try {
    console.log("Searching line item...");
    const lineItemData = await getLineItemDataBy(
      dealId,
      process.env.HUBSPOT_API_KEY,
    );
    console.log("Line item found: ", lineItemData);

    // Os valores chegam já calculados pelo card, que é a fonte única de
    // verdade. Aqui só há coerção defensiva, para resumo e orçamento não
    // poderem divergir.
    const valorMensalidade = Number(valorParcela) || 0;
    const valorPrimeiraParcela = Number(valorMatricula) || 0;
    const nrParcelas = Number(nrParcelasCobranca) || 1;

    // VA é valor absoluto em reais, PO é percentual. Sem essa ramificação um
    // desconto de R$ 300 seria gravado como 300% em hs_discount_percentage.
    const buildDiscountFields = (valorDesconto) =>
      discountType === "VA"
        ? { discount: Number(valorDesconto) || 0, hs_discount_percentage: "" }
        : { hs_discount_percentage: discountAmount || 0, discount: "" };

    if (lineItemData.total > 0) {
      console.log("Updating existing Line Items");
      const lineItemIds = [
        ...(lineItemData?.results || []).map((item) => item.id),
      ].join(";");

      const lineItems = await searchLineItems(
        lineItemIds.split(";"),
        process.env.HUBSPOT_API_KEY,
      );

      console.log("Found line items:", lineItems);

      const financialPlanItemId = lineItems.results.find((item) =>
        item.properties.name.startsWith("Plano financeiro"),
      )?.id;
      console.log("Financial plan item ID:", financialPlanItemId);

      // O prefixo antigo "Matrícula" segue aceito para não perder os line
      // items já criados no CRM antes da renomeação.
      const registerItemId = lineItems.results.find(
        (item) =>
          item.properties.name.startsWith("Valor da primeira parcela") ||
          item.properties.name.startsWith("Matrícula"),
      )?.id;
      console.log("Register item ID:", registerItemId);

      const financialPlanLineItemPayload = {
        id: financialPlanItemId,
        properties: {
          name: `Plano financeiro - ${graduationPlan.curso}`,
          description: discountDescription,
          price: valorMensalidade,
          recurringbillingfrequency: "monthly",
          ...buildDiscountFields(discountValue),
          hs_recurring_billing_period: `P${nrParcelas}M`,
          quantity: 1,
        },
      };

      const registerLineItemPayload = {
        id: registerItemId,
        properties: {
          name: `Valor da primeira parcela - ${graduationPlan.curso}`,
          price: valorPrimeiraParcela,
          recurringbillingfrequency: undefined,
          ...buildDiscountFields(discountMatriculaValue),
          quantity: 1,
        },
      };

      const updateLineItemsPayload = {
        inputs: [financialPlanLineItemPayload, registerLineItemPayload],
      };

      console.log(
        "Updating line items with payload:",
        updateLineItemsPayload.inputs,
      );

      const lineItemUpdated = await updateLineItems(
        updateLineItemsPayload,
        process.env.HUBSPOT_API_KEY,
      );
      console.log("Line items updated successfully:", lineItemUpdated);
    } else {
      console.log("Creating new Line Items");

      const financialPlanLineItemPayload = {
        properties: {
          name: `Plano financeiro - ${graduationPlan.curso}`,
          description: discountDescription,
          price: valorMensalidade,
          recurringbillingfrequency: "monthly",
          ...buildDiscountFields(discountValue),
          hs_recurring_billing_period: `P${nrParcelas}M`,
          quantity: 1,
        },
        associations: [
          {
            to: { id: dealId },
            types: [
              { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 20 },
            ],
          },
        ],
      };

      const registerLineItemPayload = {
        properties: {
          name: `Valor da primeira parcela - ${graduationPlan.curso}`,
          price: valorPrimeiraParcela,
          ...buildDiscountFields(discountMatriculaValue),
          quantity: 1,
        },
        associations: [
          {
            to: { id: dealId },
            types: [
              { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 20 },
            ],
          },
        ],
      };

      const createLineItemsPayload = {
        inputs: [financialPlanLineItemPayload, registerLineItemPayload],
      };

      console.log("Creating line items...", createLineItemsPayload.inputs);

      const lineItemCreated = await createLineItems(
        createLineItemsPayload,
        process.env.HUBSPOT_API_KEY,
      );
      console.log("Line items created successfully:", lineItemCreated);
    }

    const properties = {
      prazo_de_cobranca: nrParcelas?.toString() || "",
      valor_da_parcela: valorMensalidade?.toString() || "",
      valormatricula: valorPrimeiraParcela?.toString() || "",
      categoriacondicao: selectedCategory,
      desconto_aprovado: discountValue?.toString() || "0",
      turma: graduationPlan.curso || "",
      forma_de_ingresso: entryMethod || "",
    };

    console.log("Updating deal with properties:", properties);

    const response = await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: properties,
    });

    console.log("Deal updated successfully:", response);

    return {
      status: "SUCCESS",
      response: { dealId, updatedProperties: properties },
    };
  } catch (error) {
    console.error("Error processing update:", error);

    const errorMessage =
      error.response?.body?.message ||
      error.response?.data?.message ||
      error.message ||
      "Erro ao atualizar deal de graduação.";

    console.error("Error details:", errorMessage);
    return { status: "ERROR", origin: "HUBSPOT", message: errorMessage };
  }
};
