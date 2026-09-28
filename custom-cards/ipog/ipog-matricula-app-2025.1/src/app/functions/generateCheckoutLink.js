const axios = require("axios");
const hubspot = require("@hubspot/api-client");

exports.main = async (context = {}) => {
  console.log("Generate Checkout Link - Context:", context);
  const { parameters } = context;
  const {
    dealId,
    enrollmentId,
    paymentType,
    typeOfInterest,
    levelOfInterest,
    studentStartModule,
    studentStartDate,
    numberOfInstallments,
  } = parameters;

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

  if (!enrollmentId) {
    return {
      status: "ERROR",
      origin: "SISTEMA",
      message: "ID da matrícula é obrigatório.",
    };
  }

  const formatDate = (date) => {
    if (!date) return null;

    if (date.formattedDate) {
      const { year, month, date: day } = date;
      return `${year}-${String(month + 1).padStart(2, "0")}-${String(
        day,
      ).padStart(2, "0")}`;
    }

    const parsedDate = new Date(parseInt(date));
    const year = parsedDate.getFullYear();
    const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
    const day = String(parsedDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const payload = {
    id_hubspot: String(dealId),
    matricula: enrollmentId,
    formaPagamento: paymentType,
  };

  if (typeOfInterest == "EAD" && levelOfInterest == "Pós-graduação") {
    const formattedDate = formatDate(studentStartDate);
    Object.assign(payload, { data_de_inicio: formattedDate });
  } else if (studentStartModule) {
    Object.assign(payload, { modulo_de_inicio_do_aluno: studentStartModule });
  }

  if (paymentType == "PARCELADO") {
    Object.assign(payload, { quantidadeParcelas: +numberOfInstallments });
  }

  console.log("Body para gerar link de checkout: ", payload);

  // --- Chamada ao Checkout IPOG ---
  let checkoutLink;
  try {
    const checkoutUrl = `${process.env.CHECKOUT_BASE_URL}/api/checkout/criar`;
    console.log(`Gerando link de checkout para matrícula ${enrollmentId}...`);

    const checkoutResponse = await axios({
      method: "POST",
      url: checkoutUrl,
      data: payload,
      headers: { "Content-Type": "application/json" },
    });

    console.log("Resposta do checkout:", checkoutResponse.data);

    if (!checkoutResponse.data?.link_checkout) {
      return {
        status: "ERROR",
        origin: "CHECKOUT_IPOG",
        message: "Link de checkout não foi retornado pela API.",
      };
    }

    checkoutLink = checkoutResponse.data.link_checkout;
  } catch (error) {
    console.error("Erro na API de checkout:", error.message);
    if (error.response) console.error("Detalhes:", error.response.data);
    return {
      status: "ERROR",
      origin: "CHECKOUT_IPOG",
      message:
        error.response?.data?.message ||
        error.message ||
        "Erro ao gerar link de checkout.",
    };
  }

  // --- Atualização do Deal no HubSpot ---
  try {
    console.log(`Atualizando deal ${dealId} com link de checkout...`);
    const hubspotClient = new hubspot.Client({ accessToken: apiKey });

    await hubspotClient.crm.deals.basicApi.update(dealId, {
      properties: {
        link_de_checkout: checkoutLink,
        modulo_de_inicio_do_aluno: studentStartModule,
      },
    });

    console.log("Deal atualizado com sucesso!");
  } catch (error) {
    console.error("Erro ao atualizar deal no HubSpot:", error.message);
    return {
      status: "ERROR",
      origin: "HUBSPOT",
      message:
        error.response?.body?.message ||
        error.message ||
        "Erro ao atualizar deal no HubSpot.",
    };
  }

  return {
    status: "SUCCESS",
    response: { checkoutLink },
  };
};
