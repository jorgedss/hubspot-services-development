/**
 * Verificação offline dos VALORES gravados pelo desconto.
 *
 *   node automation/verificacao/verificar-valores.js
 *
 * O que ele trava, quando rodar e por que existe: ./README.md.
 *
 * Roda o código REAL de produção, na ordem em que o usuário final o exercita:
 *
 *   GroupContracts.main      (card abre)
 *   -> discountMath.ts       (prévia, importado de verdade)
 *   -> ApplyDiscounts.main   (Executar Desconto)
 *   -> customCode.main       (aprovador seta proposta_aprovada = sim)
 *   -> GroupContracts.main   (card reabre: totalizador)
 *
 * Sem dependências de npm: o `axios` que o código sob teste importa é
 * substituído por um CRM falso. Precisa de node >= 22.18 (ou >= 23) para
 * importar o `discountMath.ts` sem bundler.
 */
const Module = require("module");
const path = require("path");

const RAIZ = path.resolve(__dirname, "../..");
const PIPELINE = "872876959"; // Franquia - SMB, alçada 10%
const DEAL_ID = "31415926535";
const SISTEMA = "sisA";

// ---------------------------------------------------------------------------
// CRM falso
// ---------------------------------------------------------------------------

// valor_*_calculado = valor base × quantity, resolvido pelo CRM. É o que o card
// lê como "Valor Bruto"/"Líquido", e o que o caminho de escrita não pode desviar.
const CALCULADAS = {
  valor_mensalidade_calculado: "valor_glt",
  valor_locacao_calculado: "valor_locacao",
  valor_licenca_calculado: "valor_licenca",
  valor_treinamento_calculado: "valor_treinamento",
  valor_horas_desenvolvimento_calculado: "valor_horas_desenvolvimento",
  valor_horas_contabeis_calculado: "valor_horas_consultoria",
};

// Props de valor: as que o modo `truncar2` prende a 2 decimais, para simular um
// portal que recuse mais casas (o plano B da correção).
const ehPropDeValor = (nome) =>
  nome === "price" || nome.startsWith("valor_") || nome.startsWith("horas_");

// Schema de line_items do portal falso: toda propriedade que o app lê ou grava.
// `opts.semSchema` remove nomes daqui, e é o que reproduz uma propriedade que
// nunca foi criada no portal.
const SCHEMA_LINE_ITEMS = [
  "name",
  "nome_do_sistema",
  "quantity",
  "price",
  "tipo_de_contrato",
  "classificacao_do_contrato",
  "valor_glt",
  "valor_locacao",
  "valor_licenca",
  "valor_treinamento",
  "horas_treinamento",
  "valor_horas_desenvolvimento",
  "horas_desenvolvimento",
  "valor_horas_consultoria",
  "horas_consultoria",
  ...Object.keys(CALCULADAS),
  "valor_mensalidade_original",
  "valor_locacao_original",
  "valor_licenca_original",
  "valor_treinamento_original",
  "valor_horas_desenvolvimento_original",
  "valor_horas_consultoria_original",
  "glt_descontado",
  "valor_glt_descontado",
  "locacao_descontado",
  "valor_locacao_descontado",
  "licenca_descontado",
  "valor_licenca_descontado",
];

/**
 * @param opts.omitirVazias  A API devolve a prop pedida sem valor como ausente
 *                           em vez de null. As duas formas acontecem (ver o
 *                           comentário de `isBlank` em GroupContracts.js), e a
 *                           diferença decide se o snapshot das categorias
 *                           hora×valor chega a ser gravado.
 * @param opts.truncar2      O portal arredonda todo valor gravado a 2 decimais.
 * @param opts.semSchema     Nomes de propriedades que NÃO existem no schema do
 *                           portal. O `batch/read` as ignora em silêncio (é
 *                           assim que a v3 responde a uma prop desconhecida) e
 *                           o `batch/update` recusa a chamada inteira com 400
 *                           se alguma for gravada.
 */
const criarCrm = (lineItems, opts = {}) => {
  const deal = {
    pipeline: PIPELINE,
    dealname: "Deal de verificação",
    amount: "0",
    pending_discounts: "",
    discounts_history: "",
    discount_draft: "",
    resumo_descontos_aplicados: "",
    proposta_aprovada: "",
    observacoes: "",
  };
  const historicoAprovacao = [];
  const itens = new Map(lineItems.map((i) => [i.id, { ...i.properties }]));
  const escritas = [];
  const foraDoSchema = new Set(opts.semSchema || []);
  const schema = SCHEMA_LINE_ITEMS.filter((n) => !foraDoSchema.has(n));

  const PEDIDAS = new Set();

  const lerItem = (id) => {
    const guardadas = itens.get(id);
    const props = {};
    const qty = parseFloat(guardadas.quantity) || 1;

    for (const [k, v] of Object.entries(guardadas)) props[k] = v;
    for (const [calc, base] of Object.entries(CALCULADAS)) {
      const v = guardadas[base];
      if (v == null || String(v).trim() === "") continue;
      props[calc] = String(parseFloat(v) * qty);
    }

    for (const nome of PEDIDAS) {
      if (!(nome in props)) props[nome] = null;
    }
    // A v3 ignora em silêncio a prop pedida que não existe no schema: ela
    // simplesmente não vem na resposta.
    for (const nome of foraDoSchema) delete props[nome];
    for (const k of Object.keys(props)) {
      const vazia = props[k] == null || String(props[k]).trim() === "";
      if (vazia && opts.omitirVazias) delete props[k];
    }
    return { id, properties: props };
  };

  const cliente = {
    get: async (url) => {
      if (url.includes("/associations/line_items")) {
        return { data: { results: [...itens.keys()].map((id) => ({ id })) } };
      }
      if (url === "/crm/v3/properties/line_items") {
        return { data: { results: schema.map((name) => ({ name })) } };
      }
      if (url.includes("/crm/v3/properties/line_items/nome_do_sistema")) {
        return {
          data: { options: [{ value: SISTEMA, label: "Sistema A" }] },
        };
      }
      if (/\/crm\/v3\/owners\/\d+/.test(url)) {
        return {
          data: {
            email: "ana@exemplo.test",
            firstName: "Ana",
            lastName: "Lima",
          },
        };
      }
      if (url.includes("/crm/v3/owners")) {
        return { data: { results: [{ id: "9001" }] } };
      }
      if (url.includes(`/crm/v3/objects/deals/${DEAL_ID}`)) {
        return {
          data: {
            properties: { ...deal },
            propertiesWithHistory: { proposta_aprovada: historicoAprovacao },
          },
        };
      }
      throw new Error(`GET não esperado: ${url}`);
    },
    post: async (url, body) => {
      if (url.includes("batch/read")) {
        for (const nome of body.properties || []) PEDIDAS.add(nome);
        return { data: { results: body.inputs.map((i) => lerItem(i.id)) } };
      }
      if (url.includes("batch/update")) {
        for (const input of body.inputs) {
          const desconhecida = Object.keys(input.properties).find((k) =>
            foraDoSchema.has(k),
          );
          if (desconhecida) {
            const err = new Error(
              `Property "${desconhecida}" does not exist`,
            );
            err.response = { status: 400 };
            throw err;
          }
          escritas.push(input);
          const guardadas = itens.get(input.id);
          for (const [k, v] of Object.entries(input.properties)) {
            guardadas[k] =
              opts.truncar2 && ehPropDeValor(k)
                ? String(Math.round(parseFloat(v) * 100) / 100)
                : String(v);
          }
        }
        return { data: {} };
      }
      if (url.includes("contacts/search")) {
        return {
          data: {
            results: [
              {
                id: "c1",
                properties: {
                  email: "ana@exemplo.test",
                  aprovador_pipelines: PIPELINE,
                  firstname: "Ana",
                  lastname: "Lima",
                },
              },
            ],
          },
        };
      }
      throw new Error(`POST não esperado: ${url}`);
    },
    patch: async (url, body) => {
      Object.assign(deal, body.properties);
      return { data: {} };
    },
  };

  return {
    cliente,
    deal,
    itens,
    escritas,
    decidir: (valor) => {
      deal.proposta_aprovada = valor;
      historicoAprovacao.unshift({
        value: valor,
        sourceType: "CRM_UI",
        updatedByUserId: 777,
      });
    },
  };
};

// axios falso: `create` devolve o cliente do CRM; `post` cobre o webhook de
// aprovação, que ApplyDiscounts dispara pelo axios do módulo.
const clienteAtual = { ref: null };
const axiosFalso = {
  create: () => clienteAtual.ref,
  post: async () => ({ data: {} }),
};
const loadOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === "axios") return axiosFalso;
  return loadOriginal.call(this, pedido, ...resto);
};

const groupContracts = require(
  path.join(RAIZ, "src/app/functions/GroupContracts.js"),
);
const applyDiscounts = require(
  path.join(RAIZ, "src/app/functions/ApplyDiscounts.js"),
);
const workflow = require(
  path.join(RAIZ, "automation/desconto-decisao/customCode.js"),
);

// ---------------------------------------------------------------------------
// Sessão: o card e as duas rotas de escrita sobre um mesmo CRM
// ---------------------------------------------------------------------------

const silenciar = async (fn) => {
  const [l, e, w] = [console.log, console.error, console.warn];
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.log = l;
    console.error = e;
    console.warn = w;
  }
};

const criarSessao = async (M, lineItems, opts = {}) => {
  const crm = criarCrm(lineItems, opts);
  clienteAtual.ref = crm.cliente;

  const parseField = (original, liquido) => ({
    original,
    current: liquido ?? original,
    new: null,
  });
  const parseHours = (h) => ({ original: h, current: h, new: null });

  // Espelha `lineParser` de Discount.tsx.
  const montarLinha = (d) => ({
    id: "1",
    nome_do_sistema: SISTEMA,
    label: d.label,
    glt: parseField(d.glt, d.gltLiquido),
    locacao: parseField(d.locacao, d.locacaoLiquido),
    licenca: parseField(d.licenca, d.licencaLiquido),
    treinamentoValorUnitario: parseField(
      d.treinamentoValorUnitario,
      d.treinamentoValorUnitarioLiquido,
    ),
    treinamentoHoras: parseHours(d.treinamentoHoras),
    treinamentoTotalBruto: d.treinamentoTotalBruto,
    tipoContrato: d.tipoContrato ?? null,
    desenvolvimentoValorUnitario: parseField(
      d.desenvolvimentoValorUnitario,
      d.desenvolvimentoValorUnitarioLiquido,
    ),
    desenvolvimentoHoras: parseHours(d.desenvolvimentoHoras),
    desenvolvimentoTotalBruto: d.desenvolvimentoTotalBruto,
    consultoriaValorUnitario: parseField(
      d.consultoriaValorUnitario,
      d.consultoriaValorUnitarioLiquido,
    ),
    consultoriaHoras: parseHours(d.consultoriaHoras),
    consultoriaTotalBruto: d.consultoriaTotalBruto,
  });

  // Espelha `buildLinePayload` de Discount.tsx.
  const montarPayload = (linha) => ({
    nome_do_sistema: linha.nome_do_sistema,
    gltOriginal: linha.glt.original,
    gltNew: M.effective(linha.glt),
    locacaoOriginal: linha.locacao.original,
    locacaoNew: M.effective(linha.locacao),
    licencaOriginal: linha.licenca.original,
    licencaNew: M.effective(linha.licenca),
    treinamentoValorUnitarioOriginal: linha.treinamentoValorUnitario.original,
    treinamentoValorUnitarioNew: M.effective(linha.treinamentoValorUnitario),
    treinamentoHorasOriginal: linha.treinamentoHoras.original,
    treinamentoHorasNew: M.effective(linha.treinamentoHoras),
    desenvolvimentoValorUnitarioOriginal:
      linha.desenvolvimentoValorUnitario.original,
    desenvolvimentoValorUnitarioNew: M.effective(
      linha.desenvolvimentoValorUnitario,
    ),
    desenvolvimentoHorasOriginal: linha.desenvolvimentoHoras.original,
    desenvolvimentoHorasNew: M.effective(linha.desenvolvimentoHoras),
    consultoriaValorUnitarioOriginal: linha.consultoriaValorUnitario.original,
    consultoriaValorUnitarioNew: M.effective(linha.consultoriaValorUnitario),
    consultoriaHorasOriginal: linha.consultoriaHoras.original,
    consultoriaHorasNew: M.effective(linha.consultoriaHoras),
    treinamentoTotalBruto: linha.treinamentoTotalBruto,
    desenvolvimentoTotalBruto: linha.desenvolvimentoTotalBruto,
    consultoriaTotalBruto: linha.consultoriaTotalBruto,
    label: linha.label,
    percentualDesconto: M.calcTotalDiscountPercent(linha),
  });

  // As quatro dimensões do "Totalizador por Sistema".
  const totais = (linha) => ({
    licenca: M.calcLicencaTotal(linha),
    servicos: M.calcServicosTotal(linha),
    mensalidade: M.calcMensalidadeTotal(linha),
    projeto: M.calcProjetoTotal(linha),
  });

  const abrirCard = async () => {
    const res = await silenciar(() =>
      groupContracts.main({ parameters: { dealId: DEAL_ID } }),
    );
    const dados = res.body.data[SISTEMA];
    return { linha: montarLinha(dados), alcada: res.body.alcada };
  };

  return {
    crm,
    abrirCard,
    totais,
    montarPayload,
    /**
     * Um ciclo completo: abre o card, aplica as edições, submete pela rota
     * pedida e reabre o card. Devolve o par (prévia, depois) de totais.
     */
    aplicar: async (edicoes, rota = "aprovacao") => {
      const { linha, alcada } = await abrirCard();
      for (const [campo, valor] of Object.entries(edicoes)) {
        linha[campo] = { ...linha[campo], new: valor };
      }

      const previa = totais(linha);
      const payload = montarPayload(linha);
      const pct = M.calcTotalDiscountPercent(linha);
      const requerAprovacao =
        (pct !== null && pct > alcada) ||
        M.hasAnyFieldOverThreshold(linha, alcada);

      await submeter(payload, rota);

      const { linha: linhaDepois } = await abrirCard();
      return {
        previa,
        depois: totais(linhaDepois),
        payload,
        requerAprovacao,
        linhaDepois,
      };
    },
    /** Reenvia um payload já montado, para testar idempotência do write path. */
    reenviar: async (payload, rota = "aprovacao") => {
      await submeter(payload, rota);
      const { linha } = await abrirCard();
      return { depois: totais(linha), linhaDepois: linha };
    },
  };

  async function submeter(payload, rota) {
    if (rota === "auto") {
      await silenciar(() =>
        applyDiscounts.main({
          parameters: {
            dealId: DEAL_ID,
            dealName: "Deal de verificação",
            discounts: [payload],
            pending: [],
            resumo: "",
          },
        }),
      );
      return;
    }

    await silenciar(() =>
      applyDiscounts.main({
        parameters: {
          dealId: DEAL_ID,
          dealName: "Deal de verificação",
          discounts: [],
          pending: [payload],
          resumo: "resumo",
        },
      }),
    );
    crm.decidir("sim");
    await silenciar(() =>
      workflow.main(
        {
          object: { objectId: DEAL_ID },
          inputFields: { proposta_aprovada: "sim", observacoes: "" },
        },
        () => {},
      ),
    );
  }
};

// ---------------------------------------------------------------------------
// Asserções
// ---------------------------------------------------------------------------

let falhas = 0;
let passes = 0;

const eq = (rotulo, obtido, esperado) => {
  if (String(obtido) === String(esperado)) {
    passes += 1;
    return;
  }
  falhas += 1;
  console.log(
    `  x ${rotulo}\n      obtido:   ${obtido}\n      esperado: ${esperado}`,
  );
};

// Para o texto do resumo: comparar o bloco inteiro travaria o espaçamento, e
// o que precisa ficar travado é o que o aprovador lê.
const contem = (rotulo, texto, trecho) => {
  if (texto.includes(trecho)) {
    passes += 1;
    return;
  }
  falhas += 1;
  console.log(`  x ${rotulo}\n      não encontrado: ${trecho}\n${texto}`);
};

const naoContem = (rotulo, texto, trecho) => {
  if (!texto.includes(trecho)) {
    passes += 1;
    return;
  }
  falhas += 1;
  console.log(`  x ${rotulo}\n      não devia conter: ${trecho}\n${texto}`);
};

const secao = (titulo) => console.log(`\n== ${titulo}`);
const cent = (n) => Math.round(n * 100);
const reais = (n) => `R$ ${n.toFixed(2).replace(".", ",")}`;

// A invariante, nas quatro dimensões do totalizador: o par (bruto, líquido) que
// o card exibia ANTES de submeter é o par que ele exibe DEPOIS de aplicado.
const conferirInvariante = (nome, previa, depois) => {
  for (const dim of ["licenca", "servicos", "mensalidade", "projeto"]) {
    eq(
      `${nome}: ${dim} líquido (${reais(previa[dim].liquido)})`,
      cent(depois[dim].liquido),
      cent(previa[dim].liquido),
    );
    eq(
      `${nome}: ${dim} bruto (${reais(previa[dim].bruto)})`,
      cent(depois[dim].bruto),
      cent(previa[dim].bruto),
    );
  }
};

// ---------------------------------------------------------------------------
// Fábricas de line item
// ---------------------------------------------------------------------------

const item = (id, qty, props) => ({
  id,
  properties: {
    nome_do_sistema: SISTEMA,
    name: `Item ${id}`,
    tipo_de_contrato: "venda",
    quantity: String(qty),
    price: "0",
    ...props,
  },
});

// ---------------------------------------------------------------------------

const main = async () => {
  let M;
  let R;
  try {
    M = await import(path.join(RAIZ, "src/app/cards/discountMath.ts"));
    R = await import(path.join(RAIZ, "src/app/cards/discountResumo.ts"));
  } catch (err) {
    console.error(
      "Não foi possível importar discountMath.ts. Precisa de node >= 22.18 " +
        "(remoção de tipos nativa). Detalhe: " +
        err.message,
    );
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  secao("Caso do relato: R$ 1.400,00 e R$ 13.500,00 (2 itens, quantity 1 e 5)");
  // Mensalidade bruta = 50×1 + 350×5 = 1800; Licença = 500×1 + 3100×5 = 16000.
  // Era aqui que saíam R$ 1.399,99 e R$ 13.500,03.
  const RELATO = () => [
    item("LI-1", 1, { valor_glt: "50", valor_licenca: "500" }),
    item("LI-2", 5, { valor_glt: "350", valor_licenca: "3100" }),
  ];
  const EDICAO_RELATO = { glt: 1400, licenca: 13500 };

  for (const rota of ["aprovacao", "auto"]) {
    const s = await criarSessao(M, RELATO());
    const r = await s.aplicar(EDICAO_RELATO, rota);
    conferirInvariante(`rota ${rota}`, r.previa, r.depois);
    eq(`rota ${rota}: mensalidade`, cent(r.depois.mensalidade.liquido), 140000);
    eq(`rota ${rota}: licença`, cent(r.depois.licenca.liquido), 1350000);
    // O deal é só estas duas categorias: amount = 1400 + 13500.
    eq(`rota ${rota}: amount do deal`, s.crm.deal.amount, "14900.00");
  }
  {
    // O card manda os dois sistemas para aprovação, então a rota "auto" acima é
    // um teste do write path, não do roteamento. Este confere o roteamento.
    const s = await criarSessao(M, RELATO());
    const r = await s.aplicar(EDICAO_RELATO, "aprovacao");
    eq("roteamento: 22% e 15% exigem aprovação", r.requerAprovacao, true);
  }

  // -------------------------------------------------------------------------
  secao("Item único com quantity 3: alvo inalcançável com a base em 2 decimais");
  // 1400 ÷ 3 = 466,666667. Com a base presa a 2 decimais os valores possíveis
  // andam de 3 em 3 centavos (1399,98 ou 1400,01), nunca 1400,00.
  {
    const s = await criarSessao(M, [item("U-1", 3, { valor_glt: "600" })]);
    const r = await s.aplicar({ glt: 1400 }, "aprovacao");
    conferirInvariante("quantity 3", r.previa, r.depois);
    eq("quantity 3: mensalidade", cent(r.depois.mensalidade.liquido), 140000);
    eq("quantity 3: base gravada", s.crm.itens.get("U-1").valor_glt, "466.666667");
  }

  // -------------------------------------------------------------------------
  secao("Cinco itens iguais com quantity 4 e alvo com centavos");
  {
    const itens = [1, 2, 3, 4, 5].map((n) =>
      item(`M-${n}`, 4, { valor_licenca: "199.9" }),
    );
    const s = await criarSessao(M, itens);
    const r = await s.aplicar({ licenca: 3333.33 }, "aprovacao");
    conferirInvariante("5 itens", r.previa, r.depois);
    eq("5 itens: licença", cent(r.depois.licenca.liquido), 333333);
  }

  // -------------------------------------------------------------------------
  secao("Hora×valor: desconto de valor/h, horas intactas");
  // bruto = 500×1 + 3100×5 = 16000 em 30h -> valor/h 533,3333.
  // valor/h novo 450 -> líquido 450 × 30 = 13500.
  const HORAS = () => [
    item("H-1", 1, { valor_treinamento: "500", horas_treinamento: "10" }),
    item("H-2", 5, { valor_treinamento: "3100", horas_treinamento: "20" }),
  ];
  {
    const s = await criarSessao(M, HORAS());
    const r = await s.aplicar({ treinamentoValorUnitario: 450 }, "aprovacao");
    conferirInvariante("valor/h", r.previa, r.depois);
    eq("valor/h: serviços", cent(r.depois.servicos.liquido), 1350000);
    eq("valor/h: horas preservadas", s.crm.itens.get("H-1").horas_treinamento, "10");
  }

  // -------------------------------------------------------------------------
  secao("Hora×valor: consolidação de horas no acumulador (quantity 7)");
  // O acumulador é o primeiro item da categoria e tem quantity 7, então o alvo
  // é dividido por 7 na escala BASE: 10800 ÷ 7 = 1542,857143.
  {
    const s = await criarSessao(M, [
      item("A-1", 7, { valor_treinamento: "500", horas_treinamento: "10" }),
      item("A-2", 5, { valor_treinamento: "3100", horas_treinamento: "20" }),
    ]);
    const r = await s.aplicar(
      { treinamentoValorUnitario: 450, treinamentoHoras: 24 },
      "aprovacao",
    );
    conferirInvariante("consolidação", r.previa, r.depois);
    eq("consolidação: serviços", cent(r.depois.servicos.liquido), 1080000);
    eq("consolidação: acumulador concentra as horas", s.crm.itens.get("A-1").horas_treinamento, "24");
    eq("consolidação: o outro item zera", s.crm.itens.get("A-2").valor_treinamento, "0");
    eq("consolidação: base do acumulador", s.crm.itens.get("A-1").valor_treinamento, "1542.857143");
  }

  // -------------------------------------------------------------------------
  secao("Zerar as horas zera valor e horas da categoria");
  {
    const s = await criarSessao(M, HORAS());
    const r = await s.aplicar({ treinamentoHoras: 0 }, "aprovacao");
    eq("horas 0: serviços bruto", cent(r.depois.servicos.bruto), 0);
    eq("horas 0: serviços líquido", cent(r.depois.servicos.liquido), 0);
    eq("horas 0: H-1 valor", s.crm.itens.get("H-1").valor_treinamento, "0");
    eq("horas 0: H-2 valor", s.crm.itens.get("H-2").valor_treinamento, "0");
  }

  // -------------------------------------------------------------------------
  secao("Item Locação(C): a Mensalidade mora em valor_locacao");
  {
    const s = await criarSessao(M, [
      item("C-1", 3, {
        classificacao_do_contrato: "C",
        valor_locacao: "600",
        valor_glt: "100",
      }),
    ]);
    const r = await s.aplicar({ glt: 1400 }, "aprovacao");
    const p = s.crm.itens.get("C-1");
    conferirInvariante("locação C", r.previa, r.depois);
    eq("locação C: alvo cai em valor_locacao", p.valor_locacao, "466.666667");
    eq("locação C: valor_glt intocado", p.valor_glt, "100");
    eq("locação C: satélite da família locacao", p.locacao_descontado, "22.2222");
    eq("locação C: snapshot da família locacao", p.valor_locacao_original, "600");
  }

  // -------------------------------------------------------------------------
  secao("Segundo ciclo: desconta contra o snapshot, não contra o líquido");
  {
    const s = await criarSessao(M, RELATO());
    const primeiro = await s.aplicar({ glt: 1500 }, "aprovacao");
    conferirInvariante("ciclo 1", primeiro.previa, primeiro.depois);

    const segundo = await s.aplicar({ glt: 1200 }, "aprovacao");
    conferirInvariante("ciclo 2", segundo.previa, segundo.depois);
    eq("ciclo 2: mensalidade", cent(segundo.depois.mensalidade.liquido), 120000);
    // O bruto continua sendo o original, não o líquido do ciclo 1.
    eq("ciclo 2: bruto imutável", cent(segundo.depois.mensalidade.bruto), 180000);
    // Percentual do ITEM contra o snapshot do ITEM. O sistema levou 33,3333% de
    // desconto, mas LI-1 tem bruto de R$ 50,00 e líquido de R$ 33,33, que é
    // 33,34% exatos: um centavo sobre uma base de R$ 50,00 vale 0,02 ponto
    // percentual. É a propriedade sendo honesta sobre o item, e o preço dessa
    // honestidade é o percentual do item poder não bater com o do card em bases
    // pequenas. Ver a nota em CLAUDE.md.
    eq(
      "ciclo 2: percentual do item contra o snapshot do item",
      s.crm.itens.get("LI-1").glt_descontado,
      "33.34",
    );
  }

  // -------------------------------------------------------------------------
  secao("Idempotência: reenviar o mesmo payload não muda nada");
  {
    const s = await criarSessao(M, RELATO());
    const r = await s.aplicar(EDICAO_RELATO, "aprovacao");
    const antes = JSON.stringify([...s.crm.itens.entries()]);
    const novamente = await s.reenviar(r.payload, "aprovacao");
    eq(
      "reenvio: line items idênticos",
      JSON.stringify([...s.crm.itens.entries()]),
      antes,
    );
    eq(
      "reenvio: mensalidade",
      cent(novamente.depois.mensalidade.liquido),
      140000,
    );
  }

  // -------------------------------------------------------------------------
  secao('"Over": valor acima do bruto grava o preço e não registra desconto');
  {
    const s = await criarSessao(M, RELATO());
    await s.aplicar({ glt: 2000 }, "auto");
    const p = s.crm.itens.get("LI-1");
    // quantity 1: a base É a calculada, então o alvo em centavos cai em 2
    // decimais e nada além disso é gravado. Casas extras só aparecem quando a
    // quantity obriga.
    eq("over: valor gravado", p.valor_glt, "55.56");
    eq("over: sem percentual de desconto", p.glt_descontado, undefined);
    eq("over: sem valor descontado", p.valor_glt_descontado, undefined);
  }

  // -------------------------------------------------------------------------
  secao("As duas rotas gravam exatamente as mesmas propriedades");
  // O guarda contra as duas cópias da matemática divergirem: um deal abaixo da
  // alçada passa por ApplyDiscounts e um aprovado passa pelo customCode.
  {
    const cenarios = [
      ["relato", RELATO(), EDICAO_RELATO],
      ["hora×valor", HORAS(), { treinamentoValorUnitario: 450 }],
      ["consolidação", HORAS(), { treinamentoValorUnitario: 450, treinamentoHoras: 24 }],
      ["quantity 3", [item("U-1", 3, { valor_glt: "600" })], { glt: 1400 }],
    ];
    for (const [nome, itens, edicao] of cenarios) {
      const auto = await criarSessao(M, itens.map((i) => ({ ...i, properties: { ...i.properties } })));
      await auto.aplicar(edicao, "auto");
      const aprov = await criarSessao(M, itens.map((i) => ({ ...i, properties: { ...i.properties } })));
      await aprov.aplicar(edicao, "aprovacao");
      eq(
        `concordância (${nome})`,
        JSON.stringify([...auto.crm.itens.entries()]),
        JSON.stringify([...aprov.crm.itens.entries()]),
      );
    }
  }

  // -------------------------------------------------------------------------
  secao("Resposta da API que OMITE prop vazia: líquido e bruto continuam exatos");
  // As duas formas de resposta acontecem. Enquanto o snapshot era decidido por
  // `snapshotProp in item.properties`, a forma que omite a prop vazia nunca
  // criava o snapshot e o BRUTO colapsava para o líquido no ciclo seguinte.
  // Decidir pelo schema (`propsGravaveis`) tira a gravação das mãos do formato
  // da resposta: as duas formas passam a gravar a mesma coisa.
  {
    const s = await criarSessao(M, HORAS(), { omitirVazias: true });
    const r = await s.aplicar({ treinamentoValorUnitario: 450 }, "aprovacao");
    eq("prop omitida: serviços líquido", cent(r.depois.servicos.liquido), 1350000);
    eq("prop omitida: serviços bruto", cent(r.depois.servicos.bruto), 1600000);
    eq(
      "prop omitida: snapshot hora×valor é gravado assim mesmo",
      s.crm.itens.get("H-1").valor_treinamento_original,
      "500",
    );
  }

  // -------------------------------------------------------------------------
  secao("Consultoria: o bruto não pode seguir o valor/h aplicado");
  // Relato de operações (agosto/2026): aplicar um valor/h novo em Consultoria
  // Contábil/Fiscal fazia o "Total Bruto" descer junto com o líquido, e sem
  // bruto diferente do líquido não há percentual nenhum a calcular. Treinamento
  // e Desenvolvimento, mesma matemática, seguravam o bruto.
  //
  // A categoria é a mesma dos irmãos em código; o que muda é o snapshot chegar
  // ou não ao portal. Os três casos abaixo separam as duas causas possíveis:
  // a prop existe e a resposta a omite quando vazia, ou a prop não existe.
  const CONSULTORIA = () => [
    item("C-1", 1, { valor_horas_consultoria: "500", horas_consultoria: "10" }),
    item("C-2", 5, { valor_horas_consultoria: "3100", horas_consultoria: "20" }),
  ];
  // Bruto = 500×1 + 3100×5 = 16000 em 30h (valor/h 533,33). A 450/h: 13500,
  // 15,625% de desconto.
  const EDICAO_CONSULTORIA = { consultoriaValorUnitario: 450 };

  {
    const s = await criarSessao(M, CONSULTORIA());
    const r = await s.aplicar(EDICAO_CONSULTORIA, "aprovacao");
    conferirInvariante("consultoria", r.previa, r.depois);
    eq("consultoria: líquido", cent(r.depois.servicos.liquido), 1350000);
    eq("consultoria: bruto preservado", cent(r.depois.servicos.bruto), 1600000);
    eq(
      "consultoria: horas preservadas",
      s.crm.itens.get("C-1").horas_consultoria,
      "10",
    );
    eq(
      "consultoria: snapshot gravado",
      s.crm.itens.get("C-1").valor_horas_consultoria_original,
      "500",
    );
  }

  {
    // Prop existe, resposta omite a vazia. É o caso que o card tem que
    // atravessar sozinho: o snapshot precisa ser gravado na primeira aplicação.
    const s = await criarSessao(M, CONSULTORIA(), { omitirVazias: true });
    const r = await s.aplicar(EDICAO_CONSULTORIA, "aprovacao");
    eq("consultoria (prop omitida): líquido", cent(r.depois.servicos.liquido), 1350000);
    eq(
      "consultoria (prop omitida): bruto preservado",
      cent(r.depois.servicos.bruto),
      1600000,
    );
    eq(
      "consultoria (prop omitida): percentual continua calculável",
      M.calcTotalDiscountPercent(r.linhaDepois) > 0,
      true,
    );
  }

  {
    // Prop fora do schema: não há onde guardar o bruto, então ele colapsa e
    // nenhuma mudança de código resolve: só criar a propriedade no portal.
    // O que o código TEM que garantir aqui é não derrubar a gravação inteira
    // mandando uma prop desconhecida (o batch/update falharia com 400).
    const s = await criarSessao(M, CONSULTORIA(), {
      semSchema: ["valor_horas_consultoria_original"],
    });
    const r = await s.aplicar(EDICAO_CONSULTORIA, "aprovacao");
    eq(
      "consultoria (prop inexistente): líquido é gravado assim mesmo",
      cent(r.depois.servicos.liquido),
      1350000,
    );
    eq(
      "consultoria (prop inexistente): bruto colapsa, e só o portal resolve",
      cent(r.depois.servicos.bruto),
      1350000,
    );
  }

  // -------------------------------------------------------------------------
  secao("Canário: por que a base precisa de mais de 2 decimais");
  // A correção tem duas partes, e este caso prova que as duas são necessárias.
  //
  // A alocação por centavos faz o alvo de CADA ITEM ser centavo inteiro, mas o
  // que vai para a prop é `alvo_do_item ÷ quantity`: com alvo 1361,11 e quantity
  // 5 dá 272,222, que não cabe em 2 casas. Truncado a 272,22, a calculada volta
  // 1361,10 e o centavo se perde. Ou seja: alocação sem precisão NÃO resolve nem
  // o caso multi-item.
  //
  // Se algum dia as props de valor passarem a recusar 6 casas, a alocação
  // precisará virar restrita (o alvo de cada item, em centavos, sendo múltiplo da
  // quantity dele), e o alvo digitado só será alcançável quando
  // `mdc(quantity_i)` dividir os centavos do total. Enquanto o portal aceitar 6
  // casas, este canário é o alarme: baixar DECIMAIS_VALOR para 2 faz estas
  // asserções falharem com os desvios exatos que operações reportou.
  {
    const multi = await criarSessao(M, RELATO(), { truncar2: true });
    const rm = await multi.aplicar(EDICAO_RELATO, "aprovacao");
    eq(
      "truncado, multi-item: mensalidade desvia 1 centavo",
      cent(rm.depois.mensalidade.liquido),
      139999,
    );
    eq(
      "truncado, multi-item: licença desvia 2 centavos",
      cent(rm.depois.licenca.liquido),
      1349998,
    );

    const unico = await criarSessao(M, [item("U-1", 3, { valor_glt: "600" })], {
      truncar2: true,
    });
    const ru = await unico.aplicar({ glt: 1400 }, "aprovacao");
    eq(
      "truncado, item único quantity 3: desvia 1 centavo",
      cent(ru.depois.mensalidade.liquido),
      140001,
    );
  }

  // -------------------------------------------------------------------------
  secao("Sistema só aparece na categoria em que tem valor");
  // A GroupContracts cria o bucket do sistema com as 24 chaves em zero no
  // primeiro line item dele e nunca poda categoria vazia, então quem decide o
  // que aparece é o predicado do card.
  {
    const s = await criarSessao(M, [item("V-1", 1, { valor_licenca: "500" })]);
    const { linha } = await s.abrirCard();
    eq("só licença: licença visível", M.hasFlatValue(linha, "licenca"), true);
    eq("só licença: mensalidade oculta", M.hasFlatValue(linha, "glt"), false);
    eq(
      "só licença: treinamento oculto",
      M.hasRateHoursValue(
        linha.treinamentoValorUnitario,
        linha.treinamentoTotalBruto,
      ),
      false,
    );
    eq("só licença: sistema no totalizador", M.hasAnyValue(linha), true);
  }
  {
    // Item de linha sem valor em nenhuma das seis categorias: fora de todas as
    // tabelas, inclusive do totalizador.
    const s = await criarSessao(M, [item("Z-1", 1, {})]);
    const { linha } = await s.abrirCard();
    eq("sem valor algum: fora do totalizador", M.hasAnyValue(linha), false);
    eq("sem valor algum: licença oculta", M.hasFlatValue(linha, "licenca"), false);
  }
  {
    // O modo de falha que o predicado evita: se a visibilidade saísse do par
    // efetivo (`rateHoursBruto`/`rateHoursLiquido`), zerar a Qtd Horas levaria
    // os dois a zero e a linha sumiria no meio da edição, com a edição presa no
    // state e submetida sem o vendedor poder vê-la nem desfazê-la. Zerar as
    // horas é ação suportada: o apply grava valor 0 e horas 0.
    const s = await criarSessao(M, HORAS());
    const { linha } = await s.abrirCard();
    linha.treinamentoHoras = { ...linha.treinamentoHoras, new: 0 };
    eq(
      "zerar as horas não esconde a linha",
      M.hasRateHoursValue(
        linha.treinamentoValorUnitario,
        linha.treinamentoTotalBruto,
      ),
      true,
    );
    eq(
      "zerar as horas: par efetivo vai a zero (o que NÃO pode reger a visibilidade)",
      M.rateHoursBruto(
        linha.treinamentoValorUnitario,
        linha.treinamentoHoras,
        linha.treinamentoTotalBruto,
      ),
      0,
    );
  }

  // -------------------------------------------------------------------------
  secao("Sistema de outro card não entra no agrupamento");
  // Equipamentos ("67") pertence ao app locacao-equipamentos-card. O filtro é
  // por ITEM e roda antes de agrupar, senão as duas telas editariam o mesmo
  // line item, cada uma cega para o que a outra gravou.
  const lerCard = () =>
    silenciar(() => groupContracts.main({ parameters: { dealId: DEAL_ID } }));
  {
    // A sessão registra o CRM falso que `groupContracts` vai consultar.
    await criarSessao(M, [
      item("A-1", 1, { valor_licenca: "500" }),
      item("E-1", 1, { nome_do_sistema: "67", valor_locacao: "900" }),
    ]);
    const res = await lerCard();
    eq("sistema 67 fora do agrupamento", res.body.data["67"], undefined);
    eq("sistema elegível permanece", Boolean(res.body.data[SISTEMA]), true);
    eq("contagem de excluídos", res.body.excluidos, 1);
    eq(
      "o item excluído não some do bruto do sistema elegível",
      cent(res.body.data[SISTEMA].licenca),
      50000,
    );
  }
  {
    // Item excluído SEM tipo_de_contrato: fora da vista e fora do bloqueio.
    // Mantê-lo no alerta desabilitaria "Executar Desconto" por um item que
    // este card não mostra, sem ninguém poder corrigir o campo que falta.
    await criarSessao(M, [
      item("A-2", 1, { valor_licenca: "500" }),
      item("E-2", 1, {
        nome_do_sistema: "67",
        tipo_de_contrato: "",
        valor_locacao: "900",
      }),
    ]);
    const res = await lerCard();
    eq(
      "item excluído não bloqueia por tipo_de_contrato",
      res.body.missingTipoContrato.length,
      0,
    );
  }
  {
    // Deal inteiro de Equipamentos: nada a agrupar, mas `excluidos > 0` é o que
    // faz o card dizer "nada a descontar neste card" em vez de "este deal não
    // possui itens de linha", que seria falso.
    await criarSessao(M, [
      item("E-3", 1, { nome_do_sistema: "67", valor_locacao: "900" }),
    ]);
    const res = await lerCard();
    eq(
      "deal só de Equipamentos: nenhum sistema",
      Object.keys(res.body.data).length,
      0,
    );
    eq("deal só de Equipamentos: excluidos > 0", res.body.excluidos, 1);
  }

  // -------------------------------------------------------------------------
  secao("Resumo pendente: horas e detalhe por categoria de serviço");
  // O texto de `resumo_descontos_aplicados` é o que o aprovador lê antes de
  // decidir. Ele espelha a tabela de descontos pendentes, então precisa das
  // horas e do detalhe por categoria: um desconto de 50% só em consultoria
  // desaparece dentro de um "Serviços" agregado.
  {
    const s = await criarSessao(M, [
      item("R-1", 1, {
        valor_licenca: "10000",
        valor_glt: "1000",
        valor_treinamento: "6000",
        horas_treinamento: "20",
        valor_horas_consultoria: "8000",
        horas_consultoria: "20",
      }),
    ]);
    const { linha } = await s.abrirCard();
    // Valor/h de consultoria de 400 para 200, e o escopo de 20h para 30h.
    linha.consultoriaValorUnitario = {
      ...linha.consultoriaValorUnitario,
      new: 200,
    };
    linha.consultoriaHoras = { ...linha.consultoriaHoras, new: 30 };
    const texto = R.buildPendingResumo([linha]);

    contem("resumo: % Total do sistema", texto, "% Total:");
    contem(
      "resumo: categoria de serviço com as horas efetivas",
      texto,
      "Consultoria Contábil/Fiscal: 20h → 30h",
    );
    contem(
      "resumo: valor/h da categoria descontada",
      texto,
      "Valor/h:   R$ 400,00 → R$ 200,00 (50,00%)",
    );
    contem(
      "resumo: total da categoria na base de horas efetiva",
      texto,
      "Total:     R$ 12.000,00 → R$ 6.000,00 (50,00%)",
    );
    contem(
      "resumo: categoria sem desconto mantém as horas visíveis",
      texto,
      "Horas Técnicas/Treinamentos: 20h",
    );
    contem("resumo: dimensão Serviços continua agregando", texto, "Serviços:");
    contem("resumo: TOTAL GERAL", texto, "TOTAL GERAL");
    contem("resumo: status", texto, "Status: Requer Aprovação");
    // Locação sem valor não vira sub-linha de Mensalidade: com uma só das
    // duas, o detalhe repetiria a linha de cima.
    naoContem("resumo: sem detalhe de Mensalidade", texto, "Mensalidade (GLT)");
    // Desenvolvimento/DBA não tem valor neste item: sem valor, sem linha.
    naoContem("resumo: categoria sem valor não aparece", texto, "Desenvolvimento / DBA");
  }
  {
    // Sistema sem licença nenhuma: a dimensão zerada não vira linha, como nas
    // tabelas do card.
    const s = await criarSessao(M, [
      item("R-2", 1, { valor_glt: "1000", valor_locacao: "500" }),
    ]);
    const { linha } = await s.abrirCard();
    linha.glt = { ...linha.glt, new: 700 };
    const texto = R.buildPendingResumo([linha]);
    naoContem("resumo: dimensão zerada omitida", texto, "Licença:");
    contem(
      "resumo: Mensalidade detalhada quando GLT e Locação têm valor",
      texto,
      "Mensalidade (GLT): R$ 1.000,00 → R$ 700,00 (30,00%)",
    );
    contem("resumo: sub-linha de Locação", texto, "Locação:           R$ 500,00 → R$ 500,00 (—)");
  }

  // -------------------------------------------------------------------------
  secao("Resumo: o bloco de equipamentos é preservado e vai por último");
  // `resumo_descontos_aplicados` é um texto só, com dois donos. Este app
  // reescreve a parte dos sistemas e recola o bloco do outro card. O bloco vai
  // do marcador de abertura até o fim do texto: não há marcador de fechamento.
  {
    const s = await criarSessao(M, [item("B-1", 1, { valor_licenca: "10000" })]);
    s.crm.deal.resumo_descontos_aplicados = [
      "SISTEMA ANTIGO",
      "  Licença:     R$ 1,00 → R$ 1,00 (—)",
      "",
      "=== EQUIPAMENTOS ===",
      "Balança Toledo",
      "  Qtd.:        3",
      "  Total:       R$ 4.000,00 → R$ 3.500,00 (12,50%)",
    ].join("\n");
    const { linha } = await s.abrirCard();
    linha.licenca = { ...linha.licenca, new: 8000 };
    await silenciar(() =>
      applyDiscounts.main({
        parameters: {
          dealId: DEAL_ID,
          dealName: "Deal de verificação",
          discounts: [],
          pending: [s.montarPayload(linha)],
          resumo: R.buildPendingResumo([linha]),
        },
      }),
    );
    const texto = s.crm.deal.resumo_descontos_aplicados;
    contem("resumo mesclado: sistemas reescritos", texto, "TOTAL GERAL");
    naoContem("resumo mesclado: sistema antigo sai", texto, "SISTEMA ANTIGO");
    contem("resumo mesclado: bloco de equipamentos preservado", texto, "Balança Toledo");
    eq(
      "resumo mesclado: equipamentos vão por último",
      texto.indexOf("=== EQUIPAMENTOS ===") > texto.indexOf("TOTAL GERAL"),
      true,
    );
  }
  {
    // Resumo gravado antes da remoção do marcador de fechamento: o bloco
    // continua sendo preservado, e o marcador some do texto.
    const s = await criarSessao(M, [item("B-2", 1, { valor_licenca: "10000" })]);
    s.crm.deal.resumo_descontos_aplicados = [
      "=== EQUIPAMENTOS ===",
      "Balança Toledo",
      "  Total:       R$ 4.000,00 → R$ 3.500,00 (12,50%)",
      "=== FIM EQUIPAMENTOS ===",
    ].join("\n");
    const { linha } = await s.abrirCard();
    linha.licenca = { ...linha.licenca, new: 8000 };
    await silenciar(() =>
      applyDiscounts.main({
        parameters: {
          dealId: DEAL_ID,
          dealName: "Deal de verificação",
          discounts: [],
          pending: [s.montarPayload(linha)],
          resumo: R.buildPendingResumo([linha]),
        },
      }),
    );
    const texto = s.crm.deal.resumo_descontos_aplicados;
    contem("resumo legado: bloco preservado", texto, "Balança Toledo");
    naoContem("resumo legado: marcador de fim removido", texto, "=== FIM EQUIPAMENTOS ===");
  }

  console.log(
    `\n${falhas ? "FALHOU" : "OK"}: ${passes} asserções passaram, ${falhas} falharam`,
  );
  process.exit(falhas ? 1 : 0);
};

main().catch((err) => {
  console.error("Erro na própria verificação:", err);
  process.exit(1);
});
