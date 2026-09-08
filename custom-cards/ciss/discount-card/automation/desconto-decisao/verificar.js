/**
 * Verificação offline de `customCode.js`.
 *
 *   node automation/desconto-decisao/verificar.js
 *
 * Sem dependências: o `axios` que o código sob teste importa é substituído por
 * um CRM falso via `Module._load`, então não precisa de `npm install` e roda em
 * qualquer máquina com node.
 *
 * Não substitui os testes de ponta a ponta da fase 5 do plano de execução:
 * o CRM falso não valida nomes de propriedade nem escala de percentual. O que
 * este script prova é a lógica de laço e de decisão, que é onde a refatoração
 * para "todos os sistemas de uma vez" pode quebrar em silêncio.
 *
 * O CRM falso daqui também NÃO resolve propriedade calculada
 * (`valor_*_calculado = base × quantity`), e era nessa lacuna que morava o bug
 * de centavos de agosto de 2026. Os VALORES gravados são verificados em
 * `automation/verificacao/verificar-valores.js`, que modela as calculadas e
 * roda as duas rotas de escrita. Rode os dois.
 *
 * Rode antes de colar o código na ação do workflow, e de novo depois de
 * qualquer alteração em `customCode.js`.
 */
const Module = require("module");
const path = require("path");

// ---------------------------------------------------------------------------
// CRM falso
// ---------------------------------------------------------------------------

const clienteAtual = { ref: null };

const axiosFalso = { create: () => clienteAtual.ref };

const loadOriginal = Module._load;
Module._load = function (pedido, ...resto) {
  if (pedido === "axios") return axiosFalso;
  return loadOriginal.call(this, pedido, ...resto);
};

const CAMINHO_CODIGO = path.join(__dirname, "customCode.js");

const carregarCodigo = () => {
  delete require.cache[require.resolve(CAMINHO_CODIGO)];
  return require(CAMINHO_CODIGO);
};

const PIPELINE = "872876959";

// Toda propriedade de line_items que o código grava. O `batch/update` real
// recusa a chamada inteira com 400 se receber um nome fora daqui.
const SCHEMA_LINE_ITEMS = [
  "price",
  "valor_glt",
  "valor_locacao",
  "valor_licenca",
  "valor_treinamento",
  "horas_treinamento",
  "valor_horas_desenvolvimento",
  "horas_desenvolvimento",
  "valor_horas_consultoria",
  "horas_consultoria",
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
  // Gravadas só pelo ramo de equipamentos.
  "valor_treinamento_descontado",
];

const montarCliente = ({
  lineItems,
  pending,
  historico,
  history = [],
  aprovadorPipelines = PIPELINE,
  owner = { email: "ana@exemplo.test", firstName: "Ana", lastName: "Lima" },
  ownerStatus = 200,
  propsDoPortal = SCHEMA_LINE_ITEMS,
}) => {
  const estado = { patch: null, updates: [], chamadas: [] };

  const cliente = {
    get: async (url) => {
      estado.chamadas.push(`GET ${url}`);
      if (url.includes("/associations/line_items")) {
        return { data: { results: lineItems.map((i) => ({ id: i.id })) } };
      }
      // Schema de line_items: `customCode.js` decide por ele se grava o
      // snapshot das categorias hora×valor. Um portal que responde a lista
      // vazia é um portal sem a propriedade, e aí o snapshot não é gravado.
      if (url === "/crm/v3/properties/line_items") {
        return {
          data: {
            results: propsDoPortal.map((p) =>
              typeof p === "string" ? { name: p } : p,
            ),
          },
        };
      }
      if (url.includes("/crm/v3/owners/")) {
        if (ownerStatus === 404) {
          const erro = new Error("not found");
          erro.response = { status: 404 };
          throw erro;
        }
        return { data: owner };
      }
      return {
        data: {
          properties: {
            pipeline: PIPELINE,
            pending_discounts: JSON.stringify(pending),
            discounts_history: JSON.stringify(history),
          },
          propertiesWithHistory: { proposta_aprovada: historico },
        },
      };
    },
    post: async (url, body) => {
      estado.chamadas.push(`POST ${url}`);
      if (url.includes("batch/read")) {
        const ids = body.inputs.map((i) => i.id);
        return {
          data: { results: lineItems.filter((i) => ids.includes(i.id)) },
        };
      }
      if (url.includes("batch/update")) {
        estado.updates.push(...body.inputs);
        return { data: {} };
      }
      if (url.includes("contacts/search")) {
        return {
          data: {
            results: aprovadorPipelines
              ? [{ properties: { aprovador_pipelines: aprovadorPipelines } }]
              : [],
          },
        };
      }
      throw new Error(`POST não esperado: ${url}`);
    },
    patch: async (url, body) => {
      estado.chamadas.push(`PATCH ${url}`);
      estado.patch = body.properties;
      return { data: {} };
    },
  };

  return { cliente, estado };
};

const executar = async (cenario, inputFields) => {
  const { cliente, estado } = montarCliente(cenario);
  clienteAtual.ref = cliente;
  const codigo = carregarCodigo();
  let saida = null;
  await codigo.main(
    { object: { objectId: 31415926535 }, inputFields },
    (r) => {
      saida = r;
    },
  );
  return { out: saida?.outputFields || {}, estado };
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
  console.log(`  x ${rotulo}\n      obtido:   ${obtido}\n      esperado: ${esperado}`);
};

const secao = (titulo) => console.log(`\n== ${titulo}`);

// Silencia os console.log do código sob teste: o que importa é o resultado.
const logOriginal = console.log;
const silenciar = (fn) => async (...args) => {
  console.log = () => {};
  try {
    return await fn(...args);
  } finally {
    console.log = logOriginal;
  }
};
const rodar = silenciar(executar);

const H = {
  sim: [{ value: "sim", sourceType: "CRM_UI", updatedByUserId: 777 }],
  nao: [{ value: "nao", sourceType: "CRM_UI", updatedByUserId: 777 }],
  // Segundo ciclo: a entrada mais recente é a limpeza feita pela execução
  // anterior, e tem que ser ignorada.
  simDepoisDeLimpeza: [
    { value: "", sourceType: "CRM_UI", updatedByUserId: 777 },
    { value: "sim", sourceType: "CRM_UI", updatedByUserId: 777 },
    { value: "nao", sourceType: "CRM_UI", updatedByUserId: 555 },
  ],
  soLimpeza: [{ value: "", sourceType: "CRM_UI", updatedByUserId: 777 }],
  // Grafia real dos valores internos no portal, com caixa e acento.
  Sim: [{ value: "Sim", sourceType: "CRM_UI", updatedByUserId: 777 }],
  Nao: [{ value: "Não", sourceType: "CRM_UI", updatedByUserId: 777 }],
  talvez: [{ value: "talvez", sourceType: "CRM_UI", updatedByUserId: 777 }],
  porApi: [{ value: "sim", sourceType: "INTEGRATION" }], // sem updatedByUserId
};

const main = async () => {
  // -------------------------------------------------------------------------
  secao(
    "Cenário 7: dois sistemas com horas editadas, cada um no próprio acumulador",
  );
  // É o teste do `accumulator` recriado dentro do laço de sistemas. Declarado
  // fora, sisB herdaria o item de sisA e concentraria horas no item errado.
  {
    const lineItems = [
      itemTreinamento("A1", "sisA", 500, 10),
      itemTreinamento("A2", "sisA", 400, 8),
      itemTreinamento("B1", "sisB", 300, 6),
      itemTreinamento("B2", "sisB", 200, 4),
      // Sistema sem nada pendente: tem que ficar intocado e ainda assim contar
      // no amount.
      {
        id: "C1",
        properties: {
          nome_do_sistema: "sisC",
          quantity: "2",
          price: "50",
          valor_glt: "50",
        },
      },
    ];
    const pending = [
      pendenteHoras("sisA", 50, 50, 18, 12), // só horas mudam
      pendenteHoras("sisB", 50, 40, 10, 5), // horas e valor/h mudam
    ];

    const { out, estado } = await rodar(
      { lineItems, pending, historico: H.simDepoisDeLimpeza },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const por = Object.fromEntries(
      estado.updates.map((u) => [u.id, u.properties]),
    );

    eq("A1 concentra as horas de sisA", por.A1?.horas_treinamento, "12");
    eq("A2 zerado", por.A2?.horas_treinamento, "0");
    eq("B1 concentra as horas de sisB", por.B1?.horas_treinamento, "5");
    eq("B2 zerado", por.B2?.horas_treinamento, "0");
    eq("A1 valor = 50/h x 12h", por.A1?.valor_treinamento, "600");
    eq("B1 valor = 40/h x 5h", por.B1?.valor_treinamento, "200");
    eq("sisC intocado", por.C1, undefined);
    eq("status", out.status, "aprovado");
    eq("itens atualizados", out.itens_atualizados, 4);
    eq("sistemas processados", out.sistemas_processados, 2);
  }

  // -------------------------------------------------------------------------
  secao(
    "Cenário 7b: snapshot hora×valor é gravado quando a prop existe no portal",
  );
  // O "Valor h/ Padrão" do card mora no snapshot. Se ele não for gravado, o
  // Total Bruto do ciclo seguinte cai no valor já descontado e fica igual ao
  // líquido. Quem decide a gravação é o SCHEMA, não a resposta do batch/read:
  // a prop vazia tanto volta `null` quanto some da resposta.
  {
    const itemConsultoria = (id, valor, horas) => ({
      id,
      properties: {
        nome_do_sistema: "sisA",
        quantity: "1",
        price: String(valor),
        valor_horas_consultoria: String(valor),
        horas_consultoria: String(horas),
      },
    });
    const pending = [
      {
        nomeDoSistema: "sisA",
        label: "sisA",
        percentualDesconto: 10,
        categorias: {
          consultoria: {
            valorUnitarioOriginal: 50,
            valorUnitarioNovo: 45,
            horasOriginal: 10,
            horasNovo: 10,
          },
        },
      },
    ];

    const comProp = await rodar(
      { lineItems: [itemConsultoria("K1", 500, 10)], pending, historico: H.simDepoisDeLimpeza },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const k1 = comProp.estado.updates.find((u) => u.id === "K1")?.properties;
    eq("consultoria: valor = 45/h x 10h", k1?.valor_horas_consultoria, "450");
    eq(
      "consultoria: snapshot do bruto gravado",
      k1?.valor_horas_consultoria_original,
      "500",
    );

    // Mesmo cenário num portal sem a propriedade: o desconto ainda é gravado,
    // o snapshot não, e nada de prop desconhecida sai na chamada.
    const semProp = await rodar(
      {
        lineItems: [itemConsultoria("K1", 500, 10)],
        pending,
        historico: H.simDepoisDeLimpeza,
        propsDoPortal: SCHEMA_LINE_ITEMS.filter(
          (n) => n !== "valor_horas_consultoria_original",
        ),
      },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const k1sem = semProp.estado.updates.find((u) => u.id === "K1")?.properties;
    eq("sem a prop: valor continua sendo gravado", k1sem?.valor_horas_consultoria, "450");
    eq(
      "sem a prop: snapshot não é gravado",
      "valor_horas_consultoria_original" in (k1sem || {}),
      false,
    );
    eq("sem a prop: status", semProp.out.status, "aprovado");

    // Prop recriada como CALCULADA: existe no schema, mas gravar nela devolve
    // 400 e leva junto o desconto de todos os itens da chamada. A família tem
    // irmãs `valor_*_calculado`, então é um erro plausível de quem recria.
    const calculada = await rodar(
      {
        lineItems: [itemConsultoria("K1", 500, 10)],
        pending,
        historico: H.simDepoisDeLimpeza,
        propsDoPortal: [
          ...SCHEMA_LINE_ITEMS.filter(
            (n) => n !== "valor_horas_consultoria_original",
          ),
          { name: "valor_horas_consultoria_original", calculated: true },
        ],
      },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const k1calc = calculada.estado.updates.find((u) => u.id === "K1")
      ?.properties;
    eq(
      "prop calculada: snapshot não é gravado",
      "valor_horas_consultoria_original" in (k1calc || {}),
      false,
    );
    eq("prop calculada: desconto continua sendo aplicado", k1calc?.valor_horas_consultoria, "450");
  }

  // -------------------------------------------------------------------------
  secao("Cenário 8: amount = soma de price x quantity, sem releitura");
  {
    const lineItems = [
      // glt 1000 com 30% de desconto: price 700, quantity 3 => 2100
      {
        id: "F1",
        properties: {
          nome_do_sistema: "sisA",
          quantity: "3",
          price: "1000",
          valor_glt: "1000",
        },
      },
      // item de outro sistema, não descontado: price 50 x quantity 2 => 100
      {
        id: "F2",
        properties: {
          nome_do_sistema: "sisZ",
          quantity: "2",
          price: "50",
          valor_glt: "50",
        },
      },
    ];
    const pending = [
      {
        nomeDoSistema: "sisA",
        label: "A",
        percentualDesconto: 30,
        // Escala do CARD (bruto calculado = base x quantity): o item tem
        // valor_glt 1000 e quantity 3, então o bruto do sistema é 3000. O alvo
        // 2100 é 30% de desconto e cai em valor_glt 700 na escala BASE.
        categorias: { glt: { original: 3000, novo: 2100 } },
      },
    ];

    const { out, estado } = await rodar(
      { lineItems, pending, historico: H.sim },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const por = Object.fromEntries(
      estado.updates.map((u) => [u.id, u.properties]),
    );

    eq("valor_glt descontado", por.F1?.valor_glt, "700");
    eq("percentual em escala de PERCENTUAL (30, não 0.3)", por.F1?.glt_descontado, 30);
    eq("valor descontado", por.F1?.valor_glt_descontado, "300");
    eq("snapshot gravado na primeira aplicação", por.F1?.valor_mensalidade_original, "1000");
    eq("price unitário", por.F1?.price, "700");
    eq("amount = 700x3 + 50x2", estado.patch?.amount, "2200.00");
    eq("status", out.status, "aprovado");
    // Uma leitura de ids, uma de propriedades, um update, um PATCH.
    eq(
      "não relê line items para o amount",
      estado.chamadas.filter((c) => c.includes("batch/read")).length,
      1,
    );
    eq(
      "um PATCH só no deal",
      estado.chamadas.filter((c) => c.startsWith("PATCH")).length,
      1,
    );
  }

  // -------------------------------------------------------------------------
  secao("Cenário 10: segundo ciclo desconta sobre o snapshot, não sobre o líquido");
  {
    // Item já descontado uma vez: valor vigente 700, snapshot original 1000.
    // Um novo desconto de 40% tem que dar 600, contra o snapshot, e não 420,
    // que seria 40% sobre o líquido anterior.
    const lineItems = [
      {
        id: "S1",
        properties: {
          nome_do_sistema: "sisA",
          quantity: "1",
          price: "700",
          valor_glt: "700",
          valor_mensalidade_original: "1000",
        },
      },
    ];
    const pending = [
      {
        nomeDoSistema: "sisA",
        label: "A",
        percentualDesconto: 40,
        categorias: { glt: { original: 1000, novo: 600 } },
      },
    ];

    const { estado } = await rodar(
      { lineItems, pending, historico: H.sim },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const p = estado.updates[0]?.properties;

    eq("desconto acumulado contra o snapshot", p?.valor_glt, "600");
    eq("percentual acumulado", p?.glt_descontado, 40);
    eq("snapshot NÃO é reescrito", p?.valor_mensalidade_original, undefined);
  }

  // -------------------------------------------------------------------------
  secao("Cenário 6: item Locação(C) desconta valor_locacao, não valor_glt");
  {
    const lineItems = [
      {
        id: "C9",
        properties: {
          nome_do_sistema: "sisA",
          quantity: "1",
          price: "1200",
          classificacao_do_contrato: "C",
          valor_locacao: "1000",
          valor_glt: "200",
        },
      },
    ];
    const pending = [
      {
        nomeDoSistema: "sisA",
        label: "A",
        percentualDesconto: 10,
        categorias: { glt: { original: 1000, novo: 900 } },
      },
    ];

    const { estado } = await rodar(
      { lineItems, pending, historico: H.sim },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const p = estado.updates[0]?.properties;

    eq("Mensalidade cai em valor_locacao", p?.valor_locacao, "900");
    eq("satélite da família locacao", p?.locacao_descontado, 10);
    eq("snapshot da família locacao", p?.valor_locacao_original, "1000");
    eq("valor_glt intocado", p?.valor_glt, undefined);
    eq("glt_descontado intocado", p?.glt_descontado, undefined);
    eq("valor_glt entra no price como pass-through", p?.price, "1100");
  }

  // -------------------------------------------------------------------------
  secao("Histórico e limpeza de propriedades");
  {
    const lineItems = [
      {
        id: "H1",
        properties: {
          nome_do_sistema: "sisA",
          quantity: "1",
          price: "100",
          valor_glt: "100",
        },
      },
    ];
    const pending = [
      {
        nomeDoSistema: "sisA",
        label: "Sistema A",
        percentualDesconto: 12.5,
        categorias: { glt: { original: 100, novo: 90 } },
      },
    ];

    const { estado } = await rodar(
      {
        lineItems,
        pending,
        historico: H.sim,
        history: [{ nomeDoSistema: "antigo", status: "aprovado" }],
      },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const hist = JSON.parse(estado.patch?.discounts_history || "[]");

    eq("pending zerado", estado.patch?.pending_discounts, "[]");
    eq("resumo limpo", estado.patch?.resumo_descontos_aplicados, "");
    eq("proposta_aprovada limpa", estado.patch?.proposta_aprovada, "");
    eq("observacoes limpa", estado.patch?.observacoes, "");
    eq("entrada nova no topo", hist[0]?.nomeDoSistema, "sisA");
    eq("percentual copiado do pending, não recalculado", hist[0]?.percentualDesconto, 12.5);
    eq("responsável resolvido pelo owner", hist[0]?.responsavel, "Ana Lima");
    eq("entrada antiga preservada", hist[1]?.nomeDoSistema, "antigo");
    eq("sem motivo na aprovação", hist[0]?.motivo, undefined);
  }

  // -------------------------------------------------------------------------
  secao("Reprovação não toca em line item");
  {
    const lineItems = [
      {
        id: "R1",
        properties: {
          nome_do_sistema: "sisA",
          quantity: "1",
          price: "100",
          valor_glt: "100",
        },
      },
    ];
    const pending = [
      {
        nomeDoSistema: "sisA",
        label: "A",
        percentualDesconto: 30,
        categorias: { glt: { original: 100, novo: 70 } },
      },
    ];

    const { out, estado } = await rodar(
      { lineItems, pending, historico: H.nao },
      { proposta_aprovada: "nao", observacoes: "  desconto acima do teto  " },
    );
    const hist = JSON.parse(estado.patch?.discounts_history || "[]");

    eq("status", out.status, "reprovado");
    eq("nenhum line item alterado", estado.updates.length, 0);
    eq("amount não é gravado", estado.patch?.amount, undefined);
    eq("motivo no histórico, com trim", hist[0]?.motivo, "desconto acima do teto");
    eq("status no histórico", hist[0]?.status, "reprovado");
    eq("motivo no outputField para o workflow notificar", out.motivo, "desconto acima do teto");
    eq("dealstage NUNCA é tocado pelo código", estado.patch?.dealstage, undefined);

    // Motivo vazio é permitido, por decisão de processo: a validação que o card
    // fazia foi removida de propósito. Reprova, grava o histórico com motivo
    // vazio, e não escreve em line item nenhum.
    const semMotivo = await rodar(
      { lineItems, pending, historico: H.nao },
      { proposta_aprovada: "nao", observacoes: "   " },
    );
    const histSemMotivo = JSON.parse(
      semMotivo.estado.patch?.discounts_history || "[]",
    );

    eq("sem motivo: status", semMotivo.out.status, "reprovado");
    eq("sem motivo: nenhum line item alterado", semMotivo.estado.updates.length, 0);
    eq("sem motivo: motivo vazio no histórico", histSemMotivo[0]?.motivo, "");
    eq("sem motivo: outputField motivo vazio", semMotivo.out.motivo, "");
  }

  // -------------------------------------------------------------------------
  secao("Caminhos de erro: nenhum deles escreve no CRM");
  {
    const lineItems = [
      {
        id: "E1",
        properties: {
          nome_do_sistema: "sisA",
          quantity: "1",
          price: "100",
          valor_glt: "100",
        },
      },
    ];
    const pending = [
      {
        nomeDoSistema: "sisA",
        label: "A",
        percentualDesconto: 30,
        categorias: { glt: { original: 100, novo: 70 } },
      },
    ];

    // "decisão inválida" é barrada por validação de domínio, em
    // DECISOES_VALIDAS, antes de qualquer chamada de API. Antes de agosto de
    // 2026 quem barrava era só o check de divergência, e um terceiro valor na
    // enumeração cairia calado no caminho de reprovação. O caso abaixo usa o
    // mesmo valor na propriedade e no inputField de propósito: assim ele passa
    // pela divergência e só a validação pode reprovar.
    const casos = [
      ["decisão inválida", { proposta_aprovada: "talvez", observacoes: "" }, { historico: H.talvez }, "erro"],
      ["autor por API, sem updatedByUserId", { proposta_aprovada: "sim", observacoes: "" }, { historico: H.porApi }, "erro"],
      ["histórico só com a limpeza anterior", { proposta_aprovada: "sim", observacoes: "" }, { historico: H.soLimpeza }, "erro"],
      ["decisão divergente da propriedade", { proposta_aprovada: "sim", observacoes: "" }, { historico: H.nao }, "erro"],
      ["usuário sem owner no portal", { proposta_aprovada: "sim", observacoes: "" }, { historico: H.sim, ownerStatus: 404 }, "erro"],
      ["não é aprovador deste pipeline", { proposta_aprovada: "sim", observacoes: "" }, { historico: H.sim, aprovadorPipelines: "999" }, "erro"],
      ["contato não está na lista", { proposta_aprovada: "sim", observacoes: "" }, { historico: H.sim, aprovadorPipelines: null }, "erro"],
    ];

    for (const [nome, inputs, extra, esperado] of casos) {
      const { out, estado } = await rodar(
        { lineItems, pending, ...extra },
        inputs,
      );
      eq(`${nome}: status`, out.status, esperado);
      eq(`${nome}: nada gravado`, estado.patch === null && estado.updates.length === 0, true);
      eq(`${nome}: oito outputFields`, Object.keys(out).length, 8);
    }
  }

  // -------------------------------------------------------------------------
  secao("Sem pendente: idempotente, mas limpa a decisão para rearmar o gatilho");
  {
    // O gatilho é "Proposta aprovada é conhecido" com reinscrição. Um deal que
    // fica com "Sim" gravado nunca deixa de atender ao critério, logo nunca
    // reinscreve, e o próximo ciclo de desconto do mesmo deal não dispara.
    // Antes de agosto de 2026 este caminho não escrevia nada e era esse o
    // efeito: o segundo pedido de aprovação do deal morria em silêncio.
    const lineItems = [
      {
        id: "1",
        properties: {
          nome_do_sistema: "SIS",
          quantity: "1",
          price: "1000",
          valor_glt: "100",
          valor_glt_original: "100",
        },
      },
    ];

    const { out, estado } = await rodar(
      { lineItems, pending: [], historico: H.Sim },
      { proposta_aprovada: "Sim", observacoes: "texto que sobrou" },
    );

    eq("status", out.status, "ignorado");
    eq("nenhum line item tocado", estado.updates.length, 0);
    eq("proposta_aprovada limpa", estado.patch?.proposta_aprovada, "");
    eq("observacoes limpa", estado.patch?.observacoes, "");
    eq(
      "nada além da limpeza é gravado",
      Object.keys(estado.patch || {}).join(","),
      "proposta_aprovada,observacoes",
    );
    eq("histórico intocado", estado.patch?.discounts_history, undefined);
    eq("pending_discounts intocado", estado.patch?.pending_discounts, undefined);
  }

  // -------------------------------------------------------------------------
  secao("Grafia dos valores internos: caixa e acento não mudam a decisão");
  {
    // Os valores internos da propriedade no portal são "Sim" e "Não". Antes de
    // agosto de 2026 o código comparava com os literais "sim" e "nao": aprovar
    // funcionava por causa do toLowerCase, mas "não" nunca casava com "nao" e a
    // reprovação perdia o motivo, no histórico e no outputField que a
    // notificação usa. Sem exceção, sem erro, motivo vazio.
    const lineItems = [
      {
        id: "1",
        properties: {
          nome_do_sistema: "SIS",
          quantity: "1",
          price: "1000",
          valor_glt: "100",
          valor_glt_original: "100",
        },
      },
    ];
    const pending = [
      {
        nomeDoSistema: "SIS",
        label: "Sistema X",
        percentualDesconto: 30,
        categorias: { glt: { original: 100, novo: 70 } },
      },
    ];

    const aprovado = await rodar(
      { lineItems, pending, historico: H.Sim },
      { proposta_aprovada: "Sim", observacoes: "" },
    );
    eq('"Sim": status', aprovado.out.status, "aprovado");
    eq('"Sim": line item escrito', aprovado.estado.updates.length, 1);

    const reprovado = await rodar(
      { lineItems, pending, historico: H.Nao },
      { proposta_aprovada: "Não", observacoes: "desconto acima do teto" },
    );
    const hist = JSON.parse(
      reprovado.estado.patch?.discounts_history || "[]",
    );
    eq('"Não": status', reprovado.out.status, "reprovado");
    eq('"Não": nenhum line item escrito', reprovado.estado.updates.length, 0);
    eq('"Não": motivo no histórico', hist[0]?.motivo, "desconto acima do teto");
    eq(
      '"Não": motivo no outputField',
      reprovado.out.motivo,
      "desconto acima do teto",
    );
  }

  // -------------------------------------------------------------------------
  secao("change_deal_stage_discount: decisão em campo durável");
  {
    // A ramificação do workflow que move o estágio roda depois do PATCH que
    // limpa `proposta_aprovada` e `observacoes`. Ela lê esta propriedade, que
    // nunca é limpa, e é por isso que ela existe. Se ela sair do PATCH, aquele
    // workflow volta a ramificar por campo vazio.
    const lineItems = [
      {
        id: "1",
        properties: {
          nome_do_sistema: "SIS",
          quantity: "1",
          price: "1000",
          valor_glt: "100",
          valor_glt_original: "100",
        },
      },
    ];
    const pending = [
      {
        nomeDoSistema: "SIS",
        label: "Sistema X",
        percentualDesconto: 30,
        categorias: { glt: { original: 100, novo: 70 } },
      },
    ];

    const aprovado = await rodar(
      { lineItems, pending, historico: H.Sim },
      { proposta_aprovada: "Sim", observacoes: "" },
    );
    eq("aprovado grava true", aprovado.estado.patch?.change_deal_stage_discount, "true");
    eq("aprovado limpa proposta_aprovada no mesmo PATCH", aprovado.estado.patch?.proposta_aprovada, "");

    const reprovado = await rodar(
      { lineItems, pending, historico: H.Nao },
      { proposta_aprovada: "Não", observacoes: "caro" },
    );
    eq("reprovado grava false", reprovado.estado.patch?.change_deal_stage_discount, "false");

    // Sem decisão não há o que registrar: escrever aqui faria o workflow de
    // estágio mover um negócio que ninguém decidiu.
    const ignorado = await rodar(
      { lineItems, pending: [], historico: H.Sim },
      { proposta_aprovada: "Sim", observacoes: "" },
    );
    eq(
      "ignorado não grava a propriedade",
      ignorado.estado.patch?.change_deal_stage_discount,
      undefined,
    );

    const erro = await rodar(
      { lineItems, pending, historico: H.porApi },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    eq("erro não grava a propriedade", erro.estado.patch, null);
  }

  // -------------------------------------------------------------------------
  secao("Falha de API vira status erro, sem exceção vazando");
  {
    // Um `throw` daqui ligaria o retry de três dias da HubSpot.
    const { cliente, estado } = montarCliente({
      lineItems: [],
      pending: [],
      historico: H.sim,
    });
    cliente.post = async (url) => {
      if (url.includes("contacts/search")) {
        const erro = new Error("Request failed with status code 500");
        erro.response = { status: 500, data: { message: "boom" } };
        throw erro;
      }
      throw new Error("inesperado");
    };
    clienteAtual.ref = cliente;
    const codigo = carregarCodigo();
    let saida = null;
    console.log = () => {};
    const erroOriginal = console.error;
    console.error = () => {};
    try {
      await codigo.main(
        { object: { objectId: 1 }, inputFields: { proposta_aprovada: "sim", observacoes: "" } },
        (r) => {
          saida = r;
        },
      );
    } finally {
      console.log = logOriginal;
      console.error = erroOriginal;
    }
    const out = saida?.outputFields || {};
    eq("status", out.status, "erro");
    eq("erro traz o step e o detalhe", /fetchIsApprover/.test(out.erro) && /boom/.test(out.erro), true);
    eq("nada gravado", estado.patch === null, true);
  }

  // -------------------------------------------------------------------------
  secao("Equipamentos: entradas do locacao-equipamentos-card no mesmo pendente");
  // O ramo existe porque `pending_discounts` tem dois donos. Uma entrada de
  // equipamento que vaze para o laço de sistemas não quebra com erro: ela cai
  // em `categorias` vazio, não gera alvo nenhum e o equipamento fica SEM
  // desconto, em silêncio. É isso que estas asserções pegam.
  {
    const lineItems = [itemEquipamento("E1", { price: "1800" })];
    const pending = [
      pendenteEquipamentos(
        [itemDeEquipamento("E1", 3, 100, 80, 500, 450, 12.5)],
        { pct: 12.5, bruto: 1800, liquido: 1590 },
      ),
    ];

    const { out, estado } = await rodar(
      { lineItems, pending, historico: H.sim },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const por = Object.fromEntries(
      estado.updates.map((u) => [u.id, u.properties]),
    );

    eq("status", out.status, "aprovado");
    eq("E1 recebeu update", Boolean(por.E1), true);
    eq("quantidade em horas_treinamento", por.E1?.horas_treinamento, "3");
    eq("bruto unitário de treinamento", por.E1?.valor_treinamento_original, "100");
    eq("líquido unitário de treinamento", por.E1?.valor_treinamento_descontado, "80");
    eq("total de treinamento = 3 x 80", por.E1?.valor_treinamento, "240");
    eq("bruto unitário de locação", por.E1?.valor_locacao_original, "500");
    eq("líquido unitário de locação", por.E1?.valor_locacao_descontado, "450");
    eq("total de locação = 3 x 450", por.E1?.valor_locacao, "1350");
    // O card de equipamentos nunca gravou price, e a aprovação não muda isso:
    // o amount do deal é mantido por automação externa ao card.
    eq("price não é tocado", por.E1?.price, undefined);
    // A aprovação é do conjunto: uma linha no histórico, com o rótulo do
    // sistema e o percentual agregado, igual a um sistema.
    const hist = JSON.parse(estado.patch.discounts_history);
    eq("uma linha de histórico, não uma por equipamento", hist.length, 1);
    eq("rótulo do sistema no histórico", hist[0].label, "Equipamentos - 67");
    eq("percentual agregado no histórico", hist[0].percentualDesconto, 12.5);
    eq("nomeDoSistema preservado", hist[0].nomeDoSistema, "67");
  }

  // -------------------------------------------------------------------------
  secao("Equipamentos: conjunto agregado escreve item a item");
  // O ponto da agregação: UMA entrada, UMA linha de histórico, UM percentual
  // para o aprovador, mas N escritas, uma por line item, com o alvo de cada um.
  // Colapsar os itens em totais tornaria a entrada inaplicável, porque
  // redistribuir o total exigiria uma alocação que ninguém digitou.
  {
    const lineItems = [
      itemEquipamento("E1", { price: "300" }),
      itemEquipamento("E2", { price: "700" }),
      itemEquipamento("E3", { price: "500" }),
    ];
    const pending = [
      pendenteEquipamentos(
        [
          itemDeEquipamento("E1", 1, 0, 0, 300, 150, 50), // metade
          itemDeEquipamento("E2", 2, 100, 90, 250, 250, 4), // só treinamento
          itemDeEquipamento("E3", 1, 0, 0, 500, 500, 0), // sem desconto
        ],
        { pct: 22.5, bruto: 1900, liquido: 1472.5 },
      ),
    ];

    const { out, estado } = await rodar(
      { lineItems, pending, historico: H.sim },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const por = Object.fromEntries(
      estado.updates.map((u) => [u.id, u.properties]),
    );

    eq("três line items escritos", out.itens_atualizados, 3);
    eq("E1 leva o alvo dele", por.E1?.valor_locacao, "150");
    eq("E2 leva o alvo dele", por.E2?.valor_treinamento, "180");
    eq("E2 locação intocada no valor", por.E2?.valor_locacao, "500");
    eq("E3 gravado sem desconto", por.E3?.valor_locacao, "500");

    // O agregado é da decisão, não da escrita: ele não vira valor em item nenhum.
    const gravouOAgregado = Object.values(por).some(
      (p) => p.valor_locacao === "1472.5" || p.valor_treinamento === "1472.5",
    );
    eq("o total agregado nunca é gravado num item", gravouOAgregado, false);

    const hist = JSON.parse(estado.patch.discounts_history);
    eq("uma linha de histórico para os três", hist.length, 1);
    eq("percentual do conjunto", hist[0].percentualDesconto, 22.5);
    eq("uma entrada processada, não três", out.sistemas_processados, 1);
  }

  // -------------------------------------------------------------------------
  secao("Equipamentos: o percentual agregado NUNCA vira desconto aplicado");
  // A pergunta que isso responde: se A tem 50% e B tem 20%, e o conjunto fecha
  // em 30%, a aprovação aplica 30% nos dois? Não. O agregado é o número da
  // DECISÃO. O que é aplicado é o alvo absoluto de cada item, exatamente o que
  // o vendedor propôs. Achatar tudo no agregado daria desconto a mais em B e a
  // menos em A, mudando o que foi negociado depois de aprovado.
  {
    const lineItems = [
      itemEquipamento("A", { price: "500" }),
      itemEquipamento("B", { price: "1000" }),
    ];
    const pending = [
      pendenteEquipamentos(
        [
          itemDeEquipamento("A", 1, 0, 0, 500, 250, 50), // 500 -> 250, 50%
          itemDeEquipamento("B", 1, 0, 0, 1000, 800, 20), // 1000 -> 800, 20%
        ],
        { pct: 30, bruto: 1500, liquido: 1050 }, // conjunto: 30%
      ),
    ];

    const { estado } = await rodar(
      { lineItems, pending, historico: H.sim },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const por = Object.fromEntries(
      estado.updates.map((u) => [u.id, u.properties]),
    );

    eq("A recebe o proposto, 250", por.A?.valor_locacao, "250");
    eq("B recebe o proposto, 800", por.B?.valor_locacao, "800");
    eq("A guarda o bruto dele", por.A?.valor_locacao_original, "500");
    eq("B guarda o bruto dele", por.B?.valor_locacao_original, "1000");
    eq("A registra o desconto dele", por.A?.valor_locacao_descontado, "250");
    eq("B registra o desconto dele", por.B?.valor_locacao_descontado, "800");

    // Os valores que apareceriam se alguém aplicasse os 30% do conjunto em cada
    // item: 500 x 0,7 = 350 e 1000 x 0,7 = 700. Nenhum dos dois pode existir.
    eq("A não vira 350 (30% achatado)", por.A?.valor_locacao === "350", false);
    eq("B não vira 700 (30% achatado)", por.B?.valor_locacao === "700", false);

    const somaAplicada =
      parseFloat(por.A?.valor_locacao) + parseFloat(por.B?.valor_locacao);
    eq("a soma fecha nos 1050 do conjunto", somaAplicada, 1050);

    const hist = JSON.parse(estado.patch.discounts_history);
    eq("os 30% vivem só no histórico", hist[0].percentualDesconto, 30);
    eq("uma linha de histórico", hist.length, 1);
  }

  // -------------------------------------------------------------------------
  secao("Equipamentos: deal misto decide sistema e equipamento de uma vez");
  {
    const lineItems = [
      {
        id: "S1",
        properties: {
          nome_do_sistema: "sisA",
          quantity: "1",
          price: "100",
          valor_glt: "100",
        },
      },
      itemEquipamento("E1", { price: "500" }),
    ];
    const pending = [
      {
        nomeDoSistema: "sisA",
        label: "sisA",
        percentualDesconto: 20,
        categorias: { glt: { original: 100, novo: 80 } },
      },
      pendenteEquipamentos([itemDeEquipamento("E1", 1, 0, 0, 500, 400, 20)], {
        pct: 20,
        bruto: 500,
        liquido: 400,
      }),
    ];

    const { out, estado } = await rodar(
      { lineItems, pending, historico: H.sim },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const por = Object.fromEntries(
      estado.updates.map((u) => [u.id, u.properties]),
    );

    eq("status", out.status, "aprovado");
    eq("dois line items atualizados", out.itens_atualizados, 2);
    eq("sistema descontado", por.S1?.valor_glt, "80");
    eq("equipamento descontado", por.E1?.valor_locacao, "400");
    // Uma decisão só: as duas entradas saem do pendente juntas.
    eq("pendente zerado", estado.patch.pending_discounts, "[]");
    eq("duas entradas no histórico", JSON.parse(estado.patch.discounts_history).length, 2);
  }

  // -------------------------------------------------------------------------
  secao("Equipamentos: line item que saiu do deal não derruba o batch");
  // Um id fora do deal faz o batch/update devolver 400, e com ele cai o
  // desconto de TODOS os sistemas da mesma chamada. Descartar é obrigatório.
  {
    const lineItems = [
      {
        id: "S1",
        properties: {
          nome_do_sistema: "sisA",
          quantity: "1",
          price: "100",
          valor_glt: "100",
        },
      },
    ];
    const pending = [
      {
        nomeDoSistema: "sisA",
        label: "sisA",
        percentualDesconto: 20,
        categorias: { glt: { original: 100, novo: 80 } },
      },
      pendenteEquipamentos(
        [itemDeEquipamento("E_REMOVIDO", 1, 0, 0, 500, 400, 20)],
        { pct: 20, bruto: 500, liquido: 400 },
      ),
    ];

    const { estado } = await rodar(
      { lineItems, pending, historico: H.sim },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const ids = estado.updates.map((u) => u.id);

    eq("só o sistema foi atualizado", ids.join(","), "S1");
    eq("nenhum update com id fantasma", ids.includes("E_REMOVIDO"), false);
  }

  // -------------------------------------------------------------------------
  secao("Equipamentos: reprovação não escreve, e reaplicar grava o mesmo valor");
  {
    const pending = [
      pendenteEquipamentos([itemDeEquipamento("E1", 2, 50, 25, 100, 90, 30)], {
        pct: 30,
        bruto: 300,
        liquido: 230,
      }),
    ];

    const reprovado = await rodar(
      { lineItems: [itemEquipamento("E1")], pending, historico: H.nao },
      { proposta_aprovada: "nao", observacoes: "caro demais" },
    );
    eq("status", reprovado.out.status, "reprovado");
    eq("nenhum line item escrito", reprovado.estado.updates.length, 0);
    eq("motivo no campo de saída", reprovado.out.motivo, "caro demais");

    // Idempotência: o alvo é absoluto no payload, nunca uma razão sobre o
    // valor vigente. Segunda passada com o CRM já descontado grava igual.
    const primeira = await rodar(
      { lineItems: [itemEquipamento("E1")], pending, historico: H.sim },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    const segunda = await rodar(
      {
        lineItems: [
          itemEquipamento("E1", { valorTreinamento: "50", valorLocacao: "180", horas: "2" }),
        ],
        pending,
        historico: H.sim,
      },
      { proposta_aprovada: "sim", observacoes: "" },
    );
    // `?.` de propósito: sem o ramo de equipamentos não há update nenhum, e a
    // verificação tem que reportar isso como asserção falhada, não estourar.
    eq(
      "segunda aplicação grava o mesmo",
      JSON.stringify(segunda.estado.updates[0]?.properties),
      JSON.stringify(primeira.estado.updates[0]?.properties),
    );
    eq("um update na primeira aplicação", primeira.estado.updates.length, 1);
    eq("treinamento = 2 x 25", primeira.estado.updates[0]?.properties.valor_treinamento, "50");
    eq("locação = 2 x 90", primeira.estado.updates[0]?.properties.valor_locacao, "180");
  }

  console.log(
    `\n${falhas ? "FALHOU" : "OK"}: ${passes} asserções passaram, ${falhas} falharam`,
  );
  process.exit(falhas ? 1 : 0);
};

// ---------------------------------------------------------------------------
// Fábricas de dados
// ---------------------------------------------------------------------------

function itemTreinamento(id, sistema, valor, horas) {
  return {
    id,
    properties: {
      nome_do_sistema: sistema,
      quantity: "1",
      price: String(valor),
      valor_treinamento: String(valor),
      horas_treinamento: String(horas),
    },
  };
}

function pendenteHoras(sistema, unitOriginal, unitNovo, horasOriginal, horasNovo) {
  return {
    nomeDoSistema: sistema,
    label: sistema,
    percentualDesconto: 0,
    categorias: {
      treinamento: {
        valorUnitarioOriginal: unitOriginal,
        valorUnitarioNovo: unitNovo,
        horasOriginal,
        horasNovo,
      },
    },
  };
}

function itemEquipamento(
  id,
  { valorTreinamento = "0", valorLocacao = "0", horas = "0", price = "0", quantity = "1" } = {},
) {
  return {
    id,
    properties: {
      nome_do_sistema: "67",
      quantity,
      price,
      valor_treinamento: valorTreinamento,
      valor_locacao: valorLocacao,
      horas_treinamento: horas,
    },
  };
}

// Um item DENTRO da entrada agregada.
function itemDeEquipamento(lineItemId, quantidade, trOrig, trNovo, locOrig, locNovo, pct) {
  return {
    lineItemId,
    label: `equip-${lineItemId}`,
    percentualDesconto: pct ?? 0,
    quantidade,
    treinamento: { unitarioOriginal: trOrig, unitarioNovo: trNovo },
    locacao: { unitarioOriginal: locOrig, unitarioNovo: locNovo },
  };
}

// UMA entrada para o conjunto. `label` e `percentualDesconto` no topo são o que
// o aprovador vê e o que o histórico registra.
function pendenteEquipamentos(itens, { label = "Equipamentos - 67", pct = 0, bruto = 0, liquido = 0 } = {}) {
  return {
    tipo: "equipamentos",
    nomeDoSistema: "67",
    label,
    percentualDesconto: pct,
    brutoTotal: bruto,
    liquidoTotal: liquido,
    itens,
  };
}

main().catch((err) => {
  console.error("Erro na própria verificação:", err);
  process.exit(1);
});
