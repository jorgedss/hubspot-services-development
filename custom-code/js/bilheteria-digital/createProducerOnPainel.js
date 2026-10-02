const axios = require("axios");

function onlyDigits(value) {
  return value ? value.replace(/\D/g, "").replace(/^55/, "") : value;
}

async function getOwnerId(accessToken, dealId) {
  const url = `https://api.hubapi.com/crm/v3/objects/deals/${dealId}?properties=hubspot_owner_id`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  try {
    const response = await axios.get(url, { headers });
    const ownerId = response.data.properties.hubspot_owner_id;
    return ownerId;
  } catch (error) {
    console.error("Erro ao obter o ID do proprietário:", error.message);
    throw new Error("Erro ao obter o ID do proprietário: " + error.message);
  }
}

exports.main = async (event, callback) => {
  const {
    tipo_de_produtor,
    cpf,
    cnpj,
    nome_do_produtor,
    estado,
    cidade,
    nome_fantasia,
    inscricao_estadual,
    contribuinte_import,
    email,
    estado_civil,
    profissao,
    numero_de_telefone,
    cep,
    logradouro,
    numero,
    complemento,
    bairro,
    razao_social,
    praca_id,
    hubspot_owner_id
  } = event.inputFields;
  const apiKey = process.env.BD_SERVICE_KEY;
  const accessToken = process.env.BD_HUBSPOT_TOKEN;
  const dealId = event.object.objectId;

  const ownerId = await getOwnerId(accessToken, dealId);

  const url =
    "https://ms.bilheteriadigital.net/hubspot-integration/v1/producers";
  const headers = {
    "x-api-key": apiKey,
  };

  const body = {
    tipo_produtor: tipo_de_produtor,
    cpf_produtor: cpf,
    cnpj_produtor: cnpj,
    comercial_id: ownerId,
    hubspot_id: dealId,
    nome_produtor: nome_do_produtor,
    estado: estado,
    cidade: cidade,
    nome_fantasia_produtor: nome_fantasia,
    inscricao_estadual_produtor: inscricao_estadual,
    contribuinte: contribuinte_import,
    email,
    estado_civil,
    profissao,
    telefone: onlyDigits(numero_de_telefone),
    cep,
    logradouro,
    numero,
    complemento,
    bairro,
    razao_social,
    praca_id,
    hubspot_owner_id
  };

  const bodyFiltered = Object.fromEntries(
    Object.entries(body).filter(([_, value]) => value !== undefined),
  );
  console.log(bodyFiltered);
  try {
    const response = await axios.post(url, bodyFiltered, { headers });
    const producerId = response.data.produtor_id;
    console.log("Produtor criado com sucesso:", response.data);

    return callback({
      outputFields: {
        hs_execution_state: "SUCCESS",
        producerId: producerId,
        comercialId: ownerId,
        error: false,
        errorMessage: "",
      },
    });
  } catch (error) {
    const errorMessage =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message;
    console.error("Erro ao criar produtor no painel:", errorMessage);
    return callback({
      outputFields: {
        hs_execution_state: "ERROR",
        error: true,
        errorMessage: "Erro ao criar produtor no painel: " + errorMessage,
      },
    });
  }
};
