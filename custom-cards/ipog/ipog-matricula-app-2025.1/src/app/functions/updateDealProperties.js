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
    console.error("Error updating line items: ", error.message);
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

function formatDate(date) {
  if (!date) return "";

  if (date.includes("-")) {
    return date;
  }
  const [day, month, year] = date.split("/");

  let monthStr = month.toString();
  let dayStr = day.toString();

  if (monthStr.length < 2) monthStr = "0" + monthStr;
  if (dayStr.length < 2) dayStr = "0" + dayStr;

  return [year, monthStr, dayStr].join("-");
}

exports.main = async (context = {}) => {
  console.log("Update Deal Properties - Context:", context);

  const { parameters } = context;
  const {
    dealId,
    financialPlan,
    selectedCondition,
    lineItem,
    selectedCategory,
    unitId,
    courseId,
    className,
    allDiscounts,
    unitName,
    unit,
    interest,
    modality,
    courseName,
    baseEnrollmentDate,
    diamondsOrcados,
  } = parameters;

  if (!dealId) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Deal ID is required",
    };
  }

  if (!selectedCondition) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Selected condition is required",
    };
  }

  if (!financialPlan) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Financial plan data is required",
    };
  }
  if (!process.env.HUBSPOT_API_KEY) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "Credentials for Hubspot not found.",
    };
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

    const propertyResponse = await axios.get(
      "https://api.hubapi.com/crm/v3/properties/deals/categorias_aprovadas",
      { headers: { Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}` } },
    );
    const categoriaMap = Object.fromEntries(
      (propertyResponse.data.options || []).map(({ value, label }) => [value, label]),
    );
    const categoriaLabel = selectedCategory
      .split(";")
      .map((cat) => categoriaMap[cat] || cat)
      .join(", ") || selectedCategory;

    let lineItemId = null;
    if (lineItemData.total > 0) {
      const lineItemIds = [
        ...(lineItemData?.results || []).map((item) => item.id),
      ].join(";");

      let frequencia, parcelas;

      if (selectedCondition.qtdeParcelas > 0) {
        frequencia = "monthly";
        parcelas = "P" + selectedCondition.qtdeParcelas + "M";
      }

      const lineItems = await searchLineItems(
        lineItemIds.split(";"),
        process.env.HUBSPOT_API_KEY,
      );

      const financialPlanItemId = lineItems.results.find((item) =>
        item.properties.name.startsWith("Plano financeiro"),
      ).id;
      console.log("Financial plan item ID:", financialPlanItemId);

      const registerItemId = lineItems.results.find((item) =>
        item.properties.name.startsWith("Matrícula"),
      ).id;
      console.log("Register item ID:", registerItemId);

      const financialPlanLineItemPayload = {
        id: financialPlanItemId,
        properties: {
          name: `Plano financeiro - ${
            selectedCondition.qtdeParcelas > 0
              ? selectedCondition.qtdeParcelas + "x"
              : selectedCondition.qtdeParcelas
          } - ${parameters.course} (${parameters.class})`,
          description: categoriaLabel,
          price: selectedCondition.valorParcela,
          recurringbillingfrequency: frequencia,
          discount: lineItem.discount,
          hs_discount_percentage: "",
          hs_recurring_billing_period: parcelas,
          quantity: 1,
        },
      };

      const registerLineItemPayload = {
        id: registerItemId,
        properties: {
          name: `Matrícula - ${parameters.course}`,
          price: selectedCondition.valorMatricula,
          quantity: 1,
        },
      };

      const updateLineItemsPayload = {
        inputs: [financialPlanLineItemPayload, registerLineItemPayload],
      };
      console.log(
        "Updating line item with payload:",
        updateLineItemsPayload.inputs,
      );

      const lineItemUpdated = await updateLineItems(
        updateLineItemsPayload,
        process.env.HUBSPOT_API_KEY,
      );
      console.log("Line item updated successfully:", lineItemUpdated);
    } else if (lineItem) {
      console.log("Creating Line Item:", lineItem);
      let frequencia, parcelas;

      if (selectedCondition.qtdeParcelas > 0) {
        frequencia = "monthly";
        parcelas = "P" + selectedCondition.qtdeParcelas + "M";
      }

      const financialPlanLineItemPayload = {
        properties: {
          name: `Plano financeiro - ${
            selectedCondition.qtdeParcelas > 0
              ? selectedCondition.qtdeParcelas + "x"
              : selectedCondition.qtdeParcelas
          } - ${parameters.course}`,
          description: categoriaLabel,
          price: selectedCondition.valorParcela,
          recurringbillingfrequency: frequencia,
          discount: lineItem.discount,
          hs_discount_percentage: "",
          hs_recurring_billing_period: parcelas,
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
          name: `Matrícula - ${parameters.course}`,
          price: selectedCondition.valorMatricula,
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
      console.log("Line item created successfully:", lineItemCreated);
    }

    const discountCodes = allDiscounts
      .map((discount) => discount.code)
      .filter(Boolean)
      .join(";");

    const properties = {
      tipopagamento: financialPlan.tipoPagamento,
      prazo_de_cobranca:
        selectedCondition.qtdeParcelas?.toString() == 1
          ? "À vista"
          : selectedCondition.qtdeParcelas?.toString() || "",
      valor_da_parcela: selectedCondition.valorParcela?.toString() || "",
      valormatricula: selectedCondition.valorMatricula,
      valoracrescimo: selectedCondition.valorAcrescimo,
      categoriacondicao: selectedCategory,
      desconto_aprovado: lineItem.discount,
      codigocondicao: selectedCondition.codigoCondicao,
      turmacodigo: financialPlan.turmaCodigo,
      codigodesconto: discountCodes || "",
      diamantes_orcados: diamondsOrcados || "",
      unidade_id: unitId,
      curso_id_crm: courseId,
      curso_id: courseId,
      turma: className,
      turmaidentificador: className,
      unidade_nome: unitName,
      unidade: unit,
      nivel_de_interesse: interest,
      tipo_de_ensino_slug: modality,
      curso_nome: courseName,
      databasegeracaoparcela: formatDate(baseEnrollmentDate),
    };

    console.log("Updating deal with properties:", properties);

    const response = await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: properties,
    });

    console.log("Deal updated successfully:", response);

    return {
      status: "SUCCESS",
      response: { dealId, lineItemId, updatedProperties: properties },
    };
  } catch (error) {
    console.error("Error processing update:", error);

    const errorMessage =
      error.response?.body?.message ||
      error.response?.data?.message ||
      error.message ||
      "Erro ao atualizar deal.";

    console.error("Error details:", errorMessage);
    return { status: "ERROR", origin: "HUBSPOT", message: errorMessage };
  }
};
