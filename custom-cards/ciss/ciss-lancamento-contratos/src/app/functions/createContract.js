const axios = require("axios");

const modelsMap = {
  "Proposta Novos Franqueados Dia % - Fase III": [
    "40",
    "41",
    "43",
    "150",
    "151",
    "322",
    "364",
    "365",
    "673",
    "44",
    "366",
    "881",
    "882",
    "883",
    "47",
    "176",
    "194",
    "196",
    "351",
    "352",
    "353",
    "573",
    "590",
    "592",
    "644",
    "709",
    "50",
    "52",
    "597",
    "184",
    "268",
    "824",
  ],
  "Proposta Novos Franqueados Dia % - Fase II": [
    "40",
    "41",
    "42",
    "43",
    "150",
    "151",
    "322",
    "364",
    "365",
    "673",
    "44",
    "366",
    "578",
    "47",
    "176",
    "194",
    "196",
    "351",
    "352",
    "353",
    "573",
    "590",
    "592",
    "644",
    "709",
    "50",
    "52",
    "597",
    "184",
    "268",
    "824",
  ],
  "Supermercado Pequeno Porte Simples": [
    "40",
    "41",
    "42",
    "43",
    "150",
    "364",
    "365",
    "673",
    "961",
    "44",
    "366",
    "578",
    "47",
    "353",
    "590",
    "592",
    "709",
    "904",
    "50",
    "52",
    "597",
    "1026",
    "184",
    "268",
    "824",
    "879",
    "1530",
  ],
  "Supermercado Medio Porte Presumido/Real": [
    "40",
    "41",
    "42",
    "43",
    "150",
    "322",
    "364",
    "365",
    "673",
    "909",
    "961",
    "996",
    "44",
    "366",
    "578",
    "842",
    "47",
    "176",
    "196",
    "351",
    "353",
    "590",
    "592",
    "644",
    "709",
    "904",
    "1091",
    "1099",
    "1253",
    "1313",
    "50",
    "52",
    "158",
    "597",
    "775",
    "1026",
    "1212",
    "184",
    "1029",
    "575",
    "268",
    "598",
    "824",
    "879",
    "965",
    "1530",
  ],
  "Materiais Construção Pequeno Porte Simples": [
    "40",
    "41",
    "43",
    "150",
    "364",
    "365",
    "909",
    "961",
    "44",
    "212",
    "366",
    "578",
    "842",
    "47",
    "286",
    "353",
    "590",
    "592",
    "709",
    "905",
    "1028",
    "1091",
    "50",
    "52",
    "158",
    "597",
    "775",
    "1026",
    "1212",
    "184",
    "248",
    "849",
    "268",
    "824",
    "879",
    "1530",
  ],
  "Materiais Construção Pequeno Porte Presumido/Real": [
    "40",
    "41",
    "43",
    "150",
    "322",
    "364",
    "365",
    "867",
    "909",
    "961",
    "44",
    "212",
    "289",
    "366",
    "578",
    "842",
    "47",
    "286",
    "351",
    "353",
    "590",
    "592",
    "644",
    "709",
    "905",
    "1028",
    "1086",
    "1099",
    "1313",
    "50",
    "52",
    "377",
    "597",
    "775",
    "1026",
    "184",
    "248",
    "849",
    "268",
    "824",
    "879",
    "1530",
  ],
  "Supermercado Grande Porte Lucro Real": [
    "40",
    "41",
    "42",
    "43",
    "150",
    "151",
    "152",
    "322",
    "364",
    "365",
    "588",
    "673",
    "706",
    "867",
    "874",
    "909",
    "961",
    "996",
    "1117",
    "1215",
    "1235",
    "1490",
    "44",
    "212",
    "289",
    "366",
    "578",
    "842",
    "978",
    "1071",
    "47",
    "176",
    "194",
    "196",
    "351",
    "352",
    "353",
    "573",
    "590",
    "592",
    "594",
    "644",
    "709",
    "873",
    "903",
    "904",
    "954",
    "1033",
    "1086",
    "1091",
    "1099",
    "1253",
    "1313",
    "50",
    "52",
    "158",
    "185",
    "198",
    "377",
    "597",
    "775",
    "1026",
    "1212",
    "184",
    "179",
    "216",
    "1029",
    "575",
    "268",
    "589",
    "595",
    "598",
    "824",
    "879",
    "1088",
    "965",
    "980",
    "887",
    "1150",
    "1530",
  ],
  "Materiais Construção Grande Porte Lucro Real": [
    "39",
    "40",
    "41",
    "43",
    "150",
    "151",
    "152",
    "322",
    "364",
    "365",
    "588",
    "706",
    "867",
    "874",
    "909",
    "961",
    "996",
    "1117",
    "1215",
    "1235",
    "1243",
    "1490",
    "44",
    "212",
    "288",
    "289",
    "366",
    "367",
    "578",
    "842",
    "1003",
    "1011",
    "1032",
    "1071",
    "47",
    "176",
    "194",
    "286",
    "351",
    "352",
    "353",
    "590",
    "592",
    "594",
    "644",
    "709",
    "873",
    "903",
    "905",
    "954",
    "1028",
    "1033",
    "1086",
    "1091",
    "1099",
    "1313",
    "50",
    "52",
    "158",
    "185",
    "198",
    "377",
    "597",
    "775",
    "1026",
    "1212",
    "184",
    "179",
    "216",
    "970",
    "248",
    "849",
    "900",
    "1247",
    "1251",
    "268",
    "589",
    "595",
    "598",
    "824",
    "879",
    "1088",
    "965",
    "980",
    "1150",
    "1530",
  ],
  "Supermercado Micro-Empresa Simples": [
    "40",
    "41",
    "42",
    "43",
    "673",
    "961",
    "44",
    "366",
    "578",
    "47",
    "353",
    "590",
    "592",
    "709",
    "904",
    "50",
    "52",
    "597",
    "184",
    "268",
    "824",
    "879",
    "965",
    "1530",
  ],
  "Materiais Construção Micro-Empresa Simples": [
    "40",
    "41",
    "43",
    "961",
    "44",
    "212",
    "366",
    "578",
    "47",
    "286",
    "353",
    "590",
    "592",
    "709",
    "904",
    "905",
    "1028",
    "50",
    "52",
    "597",
    "775",
    "184",
    "268",
    "824",
    "879",
    "965",
    "1530",
  ],
  "Supermercado Pequeno Porte Presumido/Real": [
    "40",
    "41",
    "42",
    "43",
    "322",
    "364",
    "365",
    "673",
    "706",
    "867",
    "909",
    "961",
    "996",
    "44",
    "366",
    "578",
    "842",
    "47",
    "176",
    "196",
    "351",
    "353",
    "590",
    "592",
    "644",
    "709",
    "904",
    "1091",
    "1099",
    "1253",
    "1313",
    "50",
    "52",
    "158",
    "597",
    "1212",
    "184",
    "268",
    "824",
    "879",
    "1530",
  ],
  "Supermercado Pequeno Porte Projeto Starter": [
    "40",
    "41",
    "42",
    "43",
    "150",
    "322",
    "364",
    "365",
    "673",
    "706",
    "867",
    "961",
    "996",
    "44",
    "366",
    "578",
    "842",
    "47",
    "176",
    "196",
    "351",
    "353",
    "573",
    "590",
    "592",
    "644",
    "709",
    "904",
    "1091",
    "1099",
    "1253",
    "1313",
    "50",
    "52",
    "597",
    "1026",
    "184",
    "268",
    "824",
    "1530",
  ],
  "Proposta CISSLive Grupo CRM - Loja Própria": [
    "1083",
    "1126",
    "1127",
    "1181",
    "1182",
    "1183",
    "1184",
    "1236",
    "1277",
    "1158",
    "1159",
    "1160",
    "1161",
    "1162",
    "1163",
    "1164",
    "1165",
    "1166",
    "1167",
    "1168",
    "1169",
    "1170",
    "1171",
    "1263",
    "1299",
    "1462",
    "1573",
    "1172",
    "1173",
    "1174",
    "1175",
    "1176",
    "1283",
    "1322",
    "1177",
    "1178",
    "1179",
    "1180",
    "1284",
    "1185",
    "1186",
    "1187",
    "1188",
    "1278",
    "1397",
    "1461",
    "1496",
    "1520",
    "1189",
    "1190",
    "1191",
    "1250",
    "1328",
    "1192",
    "1193",
    "1194",
    "1195",
    "1495",
    "1197",
    "1198",
    "1199",
    "1532",
    "1202",
    "1289",
    "1290",
    "1200",
    "1201",
    "1337",
    "1206",
    "1232",
    "1203",
    "1204",
    "1216",
    "1217",
    "1281",
    "1295",
  ],
  "Proposta CISSLive Franquia CRM": [
    "1083",
    "1126",
    "1127",
    "1181",
    "1182",
    "1183",
    "1184",
    "1236",
    "1277",
    "1158",
    "1159",
    "1160",
    "1161",
    "1162",
    "1163",
    "1164",
    "1165",
    "1166",
    "1167",
    "1168",
    "1169",
    "1170",
    "1171",
    "1263",
    "1299",
    "1462",
    "1573",
    "1172",
    "1173",
    "1174",
    "1175",
    "1176",
    "1283",
    "1322",
    "1177",
    "1178",
    "1179",
    "1180",
    "1284",
    "1185",
    "1186",
    "1187",
    "1188",
    "1278",
    "1397",
    "1461",
    "1496",
    "1520",
    "1189",
    "1190",
    "1191",
    "1250",
    "1328",
    "1192",
    "1193",
    "1194",
    "1195",
    "1495",
    "1197",
    "1198",
    "1199",
    "1532",
    "1202",
    "1289",
    "1290",
    "1200",
    "1201",
    "1337",
    "1206",
    "1232",
    "1203",
    "1204",
    "1216",
    "1217",
    "1281",
    "1295",
  ],
  "Proposta CISSLive": [
    "1083",
    "1080",
    "1082",
    "1181",
    "1182",
    "1183",
    "1184",
    "1210",
    "1236",
    "1277",
    "1158",
    "1159",
    "1160",
    "1161",
    "1162",
    "1163",
    "1164",
    "1165",
    "1166",
    "1167",
    "1168",
    "1169",
    "1170",
    "1171",
    "1263",
    "1299",
    "1462",
    "1573",
    "1172",
    "1173",
    "1174",
    "1175",
    "1176",
    "1283",
    "1322",
    "1177",
    "1178",
    "1179",
    "1180",
    "1284",
    "1185",
    "1186",
    "1187",
    "1188",
    "1278",
    "1397",
    "1399",
    "1461",
    "1496",
    "1520",
    "1189",
    "1190",
    "1191",
    "1250",
    "1328",
    "1192",
    "1193",
    "1194",
    "1195",
    "1495",
    "1197",
    "1198",
    "1199",
    "1532",
    "1202",
    "1289",
    "1290",
    "1200",
    "1201",
    "1337",
    "1206",
    "1205",
    "1203",
    "1204",
    "1216",
    "1217",
    "1281",
    "1295",
    "1544",
  ],
  "Materiais Construção Médio Porte Lucro Real": [
    "40",
    "41",
    "42",
    "43",
    "150",
    "322",
    "364",
    "365",
    "673",
    "706",
    "867",
    "909",
    "961",
    "996",
    "44",
    "212",
    "289",
    "366",
    "367",
    "578",
    "842",
    "1011",
    "1032",
    "1071",
    "1151",
    "47",
    "194",
    "286",
    "351",
    "353",
    "590",
    "592",
    "607",
    "644",
    "709",
    "905",
    "1028",
    "1086",
    "1091",
    "1099",
    "1313",
    "50",
    "52",
    "158",
    "185",
    "377",
    "597",
    "775",
    "1026",
    "1212",
    "184",
    "970",
    "248",
    "378",
    "849",
    "1247",
    "268",
    "598",
    "824",
    "879",
    "1088",
    "965",
    "1530",
  ],
  "Proposta CISSLive Gestor": [
    "1431",
    "1440",
    "1441",
    "1448",
    "1449",
    "1450",
    "1458",
    "1459",
    "1500",
    "1557",
    "1451",
    "1504",
    "1505",
    "1517",
    "1452",
    "1506",
    "1453",
    "1454",
    "1455",
    "1456",
    "1502",
    "1457",
    "1503",
    "1501",
    "1507",
  ],
  "Proposta CISSLive Integração CISSBox": [
    "1080",
    "1082",
    "1181",
    "1531",
    "1158",
    "1159",
    "1160",
    "1161",
    "1162",
    "1163",
    "1164",
    "1165",
    "1166",
    "1167",
    "1168",
    "1169",
    "1170",
    "1171",
    "1263",
    "1299",
    "1462",
    "1518",
    "1173",
    "1175",
    "1197",
    "1198",
    "1199",
    "1362",
    "1532",
  ],
  "Proposta CISSLive Franquias": [
    "1083",
    "1488",
    "1080",
    "1082",
    "1181",
    "1182",
    "1183",
    "1184",
    "1236",
    "1277",
    "1541",
    "1158",
    "1159",
    "1160",
    "1161",
    "1162",
    "1163",
    "1164",
    "1165",
    "1166",
    "1167",
    "1168",
    "1169",
    "1170",
    "1171",
    "1263",
    "1299",
    "1462",
    "1518",
    "1573",
    "1172",
    "1173",
    "1174",
    "1175",
    "1176",
    "1283",
    "1322",
    "1177",
    "1178",
    "1179",
    "1180",
    "1284",
    "1185",
    "1186",
    "1187",
    "1188",
    "1278",
    "1397",
    "1461",
    "1496",
    "1520",
    "1189",
    "1190",
    "1191",
    "1250",
    "1328",
    "1192",
    "1193",
    "1194",
    "1195",
    "1495",
    "1197",
    "1198",
    "1199",
    "1362",
    "1532",
    "1202",
    "1289",
    "1290",
    "1200",
    "1201",
    "1337",
    "1206",
    "1205",
    "1203",
    "1204",
    "1216",
    "1217",
    "1281",
    "1295",
  ],
};

const contractTypeClassification = {
  // Licença (L)
  AB: "L",
  AC: "L",
  AF: "L",
  AG: "L",
  AL: "L",
  AM: "L",
  AZ: "L",
  D: "L",
  DB: "L",
  BZ: "L",
  CC: "L",
  CP: "L",
  FO: "L",
  H: "L",
  L: "L",
  RM: "L",
  SS: "L",
  TE: "L",
  U: "L",
  // Locação (C)
  AA: "C",
  AD: "C",
  AE: "C",
  AI: "C",
  AN: "C",
  AT: "C",
  BF: "C",
  BX: "C",
  BY: "C",
  C: "C",
  CG: "C",
  CI: "C",
  CL: "C",
  CO: "C",
  DS: "C",
  ET: "C",
  FI: "C",
  FR: "C",
  GE: "C",
  IA: "C",
  LE: "C",
  LY: "C",
  O: "C",
  OX: "C",
  PD: "C",
  PO: "C",
  QW: "C",
  RA: "C",
  RG: "C",
  RT: "C",
  SZ: "C",
  TA: "C",
  TB: "C",
  TC: "C",
  TF: "C",
  TR: "C",
  TS: "C",
  TU: "C",
  UI: "C",
  J: "C",
  // Serviço (S)
  AS: "S",
  FF: "S",
  S: "S",
  // Cancelamento (E)
  V: "E",
  VV: "E",
};

const chunk = (arr, size) =>
  Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );

// Line items are deduplicated by SKU alone; a re-run updates the matching
// item (overwriting tipo_de_contrato and its values) instead of duplicating it.
const makeKey = (sku) => String(sku ?? "").trim();

const searchProductsBySkus = async (skus, apiClient) => {
  const results = {};
  const chunks = chunk(skus, 100);

  for (const chunkSkus of chunks) {
    const { data } = await apiClient.post("/crm/v3/objects/products/search", {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "hs_sku",
              operator: "IN",
              values: chunkSkus,
            },
          ],
        },
      ],
      properties: [
        "name",
        "hs_sku",
        "tipo_emissao",
        "valor_glt",
        "valor_licenca",
        "valor_locacao",
        "valor_treinamento",
        "horas_treinamento",
      ],
      limit: 100,
    });
    (data.results || []).forEach((p) => {
      results[p.properties.hs_sku] = p;
    });
  }

  return results;
};

const createLineItemsBatch = async (inputs, apiClient) => {
  try {
    const chunks = chunk(inputs, 100);
    const results = [];
    for (const chunkItems of chunks) {
      const { data } = await apiClient.post(
        "/crm/v3/objects/line_items/batch/create",
        { inputs: chunkItems },
      );
      results.push(...(data.results || []));
    }
    return results;
  } catch (error) {
    throw new Error(`Falha ao criar itens de linha em lote: ${error.message}`);
  }
};

const updateLineItemsBatch = async (inputs, apiClient) => {
  try {
    const chunks = chunk(inputs, 100);
    const results = [];
    for (const chunkItems of chunks) {
      const { data } = await apiClient.post(
        "/crm/v3/objects/line_items/batch/update",
        { inputs: chunkItems },
      );
      results.push(...(data.results || []));
    }
    return results;
  } catch (error) {
    throw new Error(
      `Falha ao atualizar itens de linha em lote: ${error.message}`,
    );
  }
};

// SKUs (sistema Cissmart) cuja quantity vem de `n_de_acessos` do deal em vez
// da contagem de emissão. A regra escreve APENAS quantity — nunca price/valores.
const ACCESS_QUANTITY_SKUS = new Set(["1006", "791"]);

// SKUs cuja quantity vem de `quantidade_de_acessos_datacenter` do deal,
// independentemente do tipo_emissao do produto. Escreve APENAS quantity.
const DATACENTER_ACCESS_QUANTITY_SKUS = new Set(["1587", "697"]);

// Estado de desconto (app discount-card) zerado ao RE-LANÇAR um item que já
// existe: o re-lançamento reescreve os valores base com os do catálogo, ou
// seja, redefine a linha de base comercial — o desconto anterior deixa de
// valer e precisa ser renegociado sobre o novo valor.
//
// Sem esta limpeza o snapshot `*_original` fica obsoleto e continua sendo a
// referência imutável lida pelo discount-card: com catálogo mais caro o card
// mostra líquido acima do bruto (e descarta o desconto digitado), com catálogo
// mais barato aparece um desconto fantasma que ninguém aplicou.
//
// Só as categorias cujo valor base é reescrito aqui. Desenvolvimento/DBA e
// Consultoria não são tocados pelo lançamento — limpar os snapshots deles
// destruiria o bruto original de um desconto ainda vigente.
const DISCOUNT_STATE_TO_RESET = [
  "valor_mensalidade_original",
  "glt_descontado",
  "valor_glt_descontado",
  "valor_licenca_original",
  "licenca_descontado",
  "valor_licenca_descontado",
  "valor_locacao_original",
  "locacao_descontado",
  "valor_locacao_descontado",
  // Treinamento é categoria hora×valor: só tem snapshot, sem satélites de %.
  "valor_treinamento_original",
];

const clearedDiscountState = () =>
  Object.fromEntries(DISCOUNT_STATE_TO_RESET.map((prop) => [prop, ""]));

const buildLineItem = (product, lanc, dealId, rule, dealProperties) => {
  const p = product.properties;

  const campoQtd = rule[(p.tipo_emissao || "").toUpperCase()];

  if (campoQtd === undefined) {
    console.warn(
      `tipo_emissao desconhecido para SKU ${p.hs_sku}: "${p.tipo_emissao}".`,
    );
  }

  // Contagem de emissão (piso 1). Vira a `quantity` do line item — a
  // multiplicação deixa de ser aplicada aos valores financeiros.
  const emissionCount = campoQtd ? Math.max(Number(lanc[campoQtd]) || 1, 1) : 1;

  const calc = (v) => Number(v || 0);

  const classification =
    contractTypeClassification[lanc.tipo_de_contrato] ?? null;

  let valor_glt = 0;
  let valor_licenca = 0;
  let valor_locacao = 0;
  let valor_treinamento = 0;
  let horas_treinamento = 0;
  let quantity = emissionCount; // por padrão, a emissão define a quantidade

  if (classification === "L") {
    // Licença: valores unitários; a emissão entra via `quantity`
    valor_licenca = calc(p.valor_licenca);
    valor_glt = calc(p.valor_glt);
    horas_treinamento = calc(p.horas_treinamento); // UNITÁRIO — nunca multiplicado
    valor_treinamento = calc(p.valor_treinamento);
  } else if (classification === "C") {
    // Locação: valores unitários; a emissão entra via `quantity`
    valor_locacao = calc(p.valor_locacao);
    horas_treinamento = calc(p.horas_treinamento);
    valor_treinamento = calc(p.valor_treinamento);
  } else if (classification === "S" || classification === "T") {
    // Serviço/Treinamento: valores unitários; a emissão entra via `quantity`
    horas_treinamento = calc(p.horas_treinamento);
    valor_treinamento = calc(p.valor_treinamento);
  } else if (classification === "E") {
    // Cancelamento: values come from deal properties, not from product,
    // and are never multiplied — quantity fica fixa em 1.
    valor_glt = calc(dealProperties.valor_cancelamento_contrato_glt);
    valor_licenca = calc(dealProperties.valor_cancelamento_contrato_licenca);
    valor_locacao = calc(dealProperties.valor_cancelamento_contrato_locacao);
    valor_treinamento = calc(
      dealProperties.valor_cancelamento_contrato_treinamento,
    );
    quantity = 1;
  } else {
    console.warn(
      `Classification not found for tipo_de_contrato "${lanc.tipo_de_contrato}". Falling back to all product values.`,
    );
    valor_glt = calc(p.valor_glt);
    valor_licenca = calc(p.valor_licenca);
    valor_locacao = calc(p.valor_locacao);
    horas_treinamento = calc(p.horas_treinamento);
    valor_treinamento = calc(p.valor_treinamento);
  }

  // n_de_acessos define a quantity dos SKUs de acesso; vazio/0 mantém a regra
  // de emissão, e cancelamento (E) continua fixo em 1.
  const nDeAcessos = Number(dealProperties.n_de_acessos);
  if (
    ACCESS_QUANTITY_SKUS.has(makeKey(p.hs_sku)) &&
    classification !== "E" &&
    Number.isFinite(nDeAcessos) &&
    nDeAcessos > 0
  ) {
    quantity = nDeAcessos;
  }

  // SKUs 1587/697: quantity = quantidade_de_acessos_datacenter do deal,
  // independentemente do tipo_emissao. Vazio/0/não numérico mantém a regra de
  // emissão já calculada, e cancelamento (E) continua fixo em 1.
  if (
    DATACENTER_ACCESS_QUANTITY_SKUS.has(makeKey(p.hs_sku)) &&
    classification !== "E"
  ) {
    const acessosDatacenter = Number(
      dealProperties.quantidade_de_acessos_datacenter,
    );
    if (Number.isFinite(acessosDatacenter) && acessosDatacenter > 0) {
      quantity = acessosDatacenter;
    }
  }

  // price = soma dos valores UNITÁRIOS; a multiplicação acontece via quantity
  const price = valor_glt + valor_licenca + valor_locacao + valor_treinamento;

  return {
    associations: [
      {
        to: { id: dealId },
        types: [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 20 },
        ],
      },
    ],
    properties: {
      hs_sku: p.hs_sku,
      hs_product_id: product.id,
      name: p.name,
      quantity,
      price,
      valor_glt,
      valor_licenca,
      valor_locacao,
      horas_treinamento,
      valor_treinamento,
      tipo_de_contrato: lanc.tipo_de_contrato,
      classificacao_do_contrato: classification,
    },
  };
};

const getAssociatedLineItemIds = async (dealId, apiClient) => {
  const { data } = await apiClient.post(
    "/crm/v4/associations/deals/line_items/batch/read",
    { inputs: [{ id: String(dealId) }] },
  );

  return (data.results?.[0]?.to || []).map((item) =>
    String(item.toObjectId ?? item.id),
  );
};

const getExistingLineItems = async (dealId, apiClient) => {
  const lineItemIds = await getAssociatedLineItemIds(dealId, apiClient);
  if (!lineItemIds.length) return {};

  const existing = {};
  const chunks = chunk(lineItemIds, 100);
  await Promise.all(
    chunks.map(async (chunkIds) => {
      const { data } = await apiClient.post(
        "/crm/v3/objects/line_items/batch/read",
        {
          inputs: chunkIds.map((id) => ({ id })),
          properties: ["hs_sku"],
        },
      );
      (data.results || []).forEach((li) => {
        const sku = li.properties?.hs_sku;
        if (!sku) return;
        existing[makeKey(sku)] = li.id;
      });
    }),
  );

  return existing;
};

const getAllLineItems = async (dealId, apiClient) => {
  const lineItemIds = await getAssociatedLineItemIds(dealId, apiClient);
  if (!lineItemIds.length) return [];

  const lineItems = [];

  const chunks = chunk(lineItemIds, 100);
  await Promise.all(
    chunks.map(async (chunkIds) => {
      const { data: batchData } = await apiClient.post(
        "/crm/v3/objects/line_items/batch/read",
        {
          inputs: chunkIds.map((id) => ({ id })),
          properties: ["price", "quantity"],
        },
      );
      (batchData.results || []).forEach((li) => {
        lineItems.push({
          price: Number(li.properties?.price) || 0,
          quantity: Number(li.properties?.quantity) || 0,
        });
      });
    }),
  );

  return lineItems;
};

const getDealProperties = async (dealId, apiClient) => {
  const { data } = await apiClient.get(`/crm/v3/objects/deals/${dealId}`, {
    params: {
      properties: [
        "valor_cancelamento_contrato_glt",
        "valor_cancelamento_contrato_licenca",
        "valor_cancelamento_contrato_locacao",
        "valor_cancelamento_contrato_treinamento",
        "n_de_acessos",
        "quantidade_de_acessos_datacenter",
      ].join(","),
    },
  });
  return data.properties || {};
};

const updateDealAmount = async (dealId, apiClient) => {
  const lineItems = await getAllLineItems(dealId, apiClient);
  const amount = lineItems.reduce((acc, li) => acc + li.price * li.quantity, 0);
  await apiClient.patch(`/crm/v3/objects/deals/${dealId}`, {
    properties: {
      amount,
      // Limpa o rascunho de desconto: um re-lançamento invalida os valores
      // editados pelo operador (as bases foram reescritas com o catálogo).
      discount_draft: "",
    },
  });
  console.log("Amount do deal atualizado:", amount);
};
exports.main = async (event) => {
  const apiClient = axios.create({
    baseURL: "https://api.hubapi.com",
    headers: {
      Authorization: `Bearer ${process.env.PRIVATE_APP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  const { dealId, lancamentos } = event.parameters;

  if (!lancamentos?.length) {
    return { sucesso: false, erro: "Nenhum lançamento informado." };
  }

  const rule = {
    T: "quantos_televendas",
    F: "quantos_pdvs",
    L: "quantos_cnpjs",
    R: "quantas_retaguardas",
    N: null,
  };

  try {
    const lancamentosComSkus = lancamentos.flatMap((lanc) => {
      const skus = lanc.modelo_de_vendas
        ? (modelsMap[lanc.modelo_de_vendas] || []).map((s) => String(s).trim())
        : (lanc.item_modulo || "")
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean);

      return skus.map((sku) => ({ ...lanc, item_modulo: sku }));
    });

    const allSkus = [...new Set(lancamentosComSkus.map((l) => l.item_modulo))];

    console.log("SKUs únicos a buscar:", allSkus);

    const [productsPerSku, dealProperties, existingLineItems] =
      await Promise.all([
        searchProductsBySkus(allSkus, apiClient),
        getDealProperties(dealId, apiClient),
        getExistingLineItems(dealId, apiClient),
      ]);

    const builtItems = lancamentosComSkus.map((lanc) => {
      const product = productsPerSku[lanc.item_modulo];
      if (!product) {
        throw new Error(
          `Produto não encontrado para o SKU: ${lanc.item_modulo}`,
        );
      }
      return buildLineItem(product, lanc, dealId, rule, dealProperties);
    });

    if (!builtItems.length) {
      return {
        sucesso: false,
        erro: "Nenhum produto encontrado para os SKUs informados.",
      };
    }

    const desiredByKey = new Map();
    for (const item of builtItems) {
      const key = makeKey(item.properties.hs_sku);
      desiredByKey.set(key, item);
    }

    const toCreate = [];
    const toUpdate = [];
    for (const [key, item] of desiredByKey) {
      const existingId = existingLineItems[key];
      if (existingId) {
        // O item volta ao valor de catálogo, então o desconto anterior é
        // descartado junto (ver DISCOUNT_STATE_TO_RESET). Itens fora deste
        // lançamento não são tocados e mantêm o desconto deles.
        const properties = { ...item.properties, ...clearedDiscountState() };
        delete properties.hs_product_id;
        toUpdate.push({ id: existingId, properties });
      } else {
        toCreate.push(item);
      }
    }

    console.log(
      `A criar: ${toCreate.length} | A atualizar: ${toUpdate.length}`,
    );

    const [created, updated] = await Promise.all([
      toCreate.length ? createLineItemsBatch(toCreate, apiClient) : [],
      toUpdate.length ? updateLineItemsBatch(toUpdate, apiClient) : [],
    ]);

    console.log(
      "IDs criados:",
      created.map((i) => i.id),
      "| IDs atualizados:",
      updated.map((i) => i.id),
    );

    await updateDealAmount(dealId, apiClient);

    return {
      sucesso: true,
      itens_criados: created.length,
      itens_atualizados: updated.length,
      itens_processados: created.length + updated.length,
    };
  } catch (error) {
    console.error("ERRO:", error.message);
    console.error("STATUS:", error.response?.status);
    console.error("DATA:", JSON.stringify(error.response?.data));
    return { sucesso: false, erro: error.message };
  }
};
