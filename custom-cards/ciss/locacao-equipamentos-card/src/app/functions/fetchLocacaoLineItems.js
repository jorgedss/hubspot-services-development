const API_BASE = 'https://api.hubapi.com';

// Sistema cujos itens este card é dono. O mesmo valor está em
// SISTEMAS_EXCLUIDOS de ciss-apps/discount-card/src/app/functions/GroupContracts.js,
// que é o que garante que nenhum line item seja escrito pelos dois caminhos.
const SISTEMA_EQUIPAMENTOS = '67';

// Marcador das entradas de equipamento dentro de pending_discounts, que é uma
// propriedade compartilhada com o discount-card. Cópias em aplicarDesconto.js,
// em discount-card/src/app/functions/ApplyDiscounts.js e em
// discount-card/automation/desconto-decisao/customCode.js. Mudou uma, mude as quatro.
const TIPO_EQUIPAMENTOS = 'equipamentos';

// Alçada (limite de desconto %) por pipeline. Mesmos percentuais do
// discount-card: cópias em GroupContracts.js e FetchDiscountApproval.js de lá.
// Pipeline não mapeado usa DEFAULT_THRESHOLD.
const DEFAULT_THRESHOLD = 10;
const PIPELINE_THRESHOLDS = {
  872876959: 10, // Franquia - SMB
  873229378: 10, // Franquia - Enterprise
  907963396: 10, // Expansão - Franquia
  872876956: 15, // PDV e Geral - SMB
  872876957: 15, // PDV e Geral - Enterprise
  911415619: 20, // Expansão - PDV e Geral
};

const resolveAlcada = (pipelineId) =>
  PIPELINE_THRESHOLDS[String(pipelineId)] ?? DEFAULT_THRESHOLD;

const PROPERTIES = [
  'name',
  'quantity',
  'nome_do_sistema',
  'horas_treinamento',
  'valor_treinamento',
  'valor_locacao',
  'valor_treinamento_original',
  'valor_locacao_original',
  'valor_treinamento_descontado',
  'valor_locacao_descontado',
];

const authHeaders = () => ({
  Authorization: `Bearer ${process.env.PRIVATE_APP_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
});

async function fetchDeal(objectId) {
  const url =
    `${API_BASE}/crm/v3/objects/deals/${objectId}` +
    '?properties=pipeline,dealname,pending_discounts';
  const response = await fetch(url, { method: 'GET', headers: authHeaders() });

  if (!response.ok) {
    throw new Error(`Falha ao buscar o negócio: ${response.status}`);
  }

  const data = await response.json();
  return data.properties || {};
}

async function fetchLineItemsByDeal(objectId) {
  const url =
    `${API_BASE}/crm/v3/objects/deals/${objectId}/associations/line_items`;
  const response = await fetch(url, { method: 'GET', headers: authHeaders() });

  if (!response.ok) {
    throw new Error(`Falha ao buscar line items: ${response.status}`);
  }

  const data = await response.json();
  return data.results || [];
}

async function fetchLineItemBatch(ids) {
  const results = [];
  const batchSize = 56;
  for (let i = 0; i < ids.length; i += batchSize) {
    const chunk = ids.slice(i, i + batchSize).map((id) => ({ id }));
    const url = `${API_BASE}/crm/v3/objects/line_items/batch/read`;
    const response = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ inputs: chunk, properties: PROPERTIES }),
    });

    if (!response.ok) {
      throw new Error(`Falha ao ler line items: ${response.status}`);
    }

    const data = await response.json();
    results.push(...(data.results || []));
  }
  return results;
}

// Rótulo de exibição do sistema, resolvido do portal como GroupContracts.js e
// FetchDiscountApproval.js fazem. O VALOR "67" continua sendo a chave de filtro
// em todo lugar: casar por rótulo quebraria no dia em que Ops renomear a opção.
async function fetchSistemaLabel() {
  const url = `${API_BASE}/crm/v3/properties/line_items/nome_do_sistema`;
  const response = await fetch(url, { method: 'GET', headers: authHeaders() });

  if (!response.ok) {
    throw new Error(`Falha ao ler nome_do_sistema: ${response.status}`);
  }

  const data = await response.json();
  const opcao = (data.options || []).find(
    (o) => String(o.value) === SISTEMA_EQUIPAMENTOS,
  );
  return opcao?.label || '';
}

// Aprovador do pipeline, pelas mesmas duas propriedades de contato que o
// discount-card usa. Serve só para avisar na tela: quem decide é o workflow.
async function fetchAprovador(pipelineId) {
  const url = `${API_BASE}/crm/v3/objects/contacts/search`;
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: 'aprovador_de_desconto',
              operator: 'EQ',
              value: 'true',
            },
          ],
        },
      ],
      properties: ['email', 'aprovador_pipelines', 'firstname', 'lastname'],
      limit: 100,
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao buscar aprovadores: ${response.status}`);
  }

  const data = await response.json();
  const contato = (data.results || []).find((c) => {
    const pipelines = (c.properties.aprovador_pipelines || '')
      .split(',')
      .map((s) => s.trim());
    return pipelines.includes(String(pipelineId));
  });

  if (!contato) return null;

  return {
    email: contato.properties.email,
    nome: [contato.properties.firstname, contato.properties.lastname]
      .filter(Boolean)
      .join(' '),
  };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    console.error('[fetchLocacaoLineItems] JSON inválido:', error.message);
    return fallback;
  }
}

exports.main = async (context) => {
  const { objectId } = context.parameters;

  try {
    const [deal, associations] = await Promise.all([
      fetchDeal(objectId),
      fetchLineItemsByDeal(objectId),
    ]);

    const pipelineId = deal.pipeline;
    const alcada = resolveAlcada(pipelineId);
    const dealName = deal.dealname || '';

    // Entradas de equipamento já em aprovação. O card usa isso para travar um
    // segundo envio antes da decisão, que sobrescreveria o que o aprovador vê.
    const pendentes = safeParse(deal.pending_discounts, []).filter(
      (entry) => entry?.tipo === TIPO_EQUIPAMENTOS,
    );

    if (associations.length === 0) {
      return {
        statusCode: 200,
        body: {
          success: true,
          lineItems: [],
          alcada,
          dealName,
          pipelineId,
          aprovador: null,
          pendentes,
          sistemaLabel: await fetchSistemaLabel().catch(() => ''),
        },
      };
    }

    const ids = associations
      .map((a) => String(a.toObjectId ?? a.id))
      .filter((id) => id && id !== 'undefined' && id !== 'null');

    const [lineItems, aprovador, sistemaLabel] = await Promise.all([
      fetchLineItemBatch(ids),
      fetchAprovador(pipelineId).catch((error) => {
        console.error(
          '[fetchLocacaoLineItems] erro ao buscar aprovador:',
          error.message,
        );
        return null;
      }),
      // Rótulo é enfeite: sem ele o card cai para o texto genérico, não quebra.
      fetchSistemaLabel().catch((error) => {
        console.error(
          '[fetchLocacaoLineItems] erro ao buscar o rótulo do sistema:',
          error.message,
        );
        return '';
      }),
    ]);

    const items = lineItems
      .filter(
        (li) =>
          String(li.properties?.nome_do_sistema) === SISTEMA_EQUIPAMENTOS,
      )
      .map((li) => {
        const quantity = toNumber(li.properties?.horas_treinamento);
        const valorTreinamento = toNumber(li.properties?.valor_treinamento);
        const valorLocacao = toNumber(li.properties?.valor_locacao);
        const valorTreinamentoOriginal = toNumber(
          li.properties?.valor_treinamento_original,
        );
        const valorLocacaoOriginal = toNumber(
          li.properties?.valor_locacao_original,
        );
        const valorTreinamentoDescontado = toNumber(
          li.properties?.valor_treinamento_descontado,
        );
        const valorLocacaoDescontado = toNumber(
          li.properties?.valor_locacao_descontado,
        );

        const brutoTreinamento =
          valorTreinamentoOriginal > 0 ? valorTreinamentoOriginal : valorTreinamento;
        const brutoLocacao =
          valorLocacaoOriginal > 0 ? valorLocacaoOriginal : valorLocacao;

        const liquidoTreinamento =
          valorTreinamentoDescontado > 0
            ? valorTreinamentoDescontado
            : brutoTreinamento;
        const liquidoLocacao =
          valorLocacaoDescontado > 0 ? valorLocacaoDescontado : brutoLocacao;

        return {
          id: li.id,
          nome: li.properties?.name || '',
          quantidade: quantity,
          valorTreinamento: brutoTreinamento,
          valorLocacao: brutoLocacao,
          valorTreinamentoLiquido: liquidoTreinamento,
          valorLocacaoLiquido: liquidoLocacao,
        };
      });

    console.log(
      `[fetchLocacaoLineItems] deal ${objectId} | pipeline ${pipelineId} | ` +
        `alçada ${alcada}% | ${items.length} equipamento(s) | ` +
        `${pendentes.length} pendente(s) | sistema: ${sistemaLabel || SISTEMA_EQUIPAMENTOS} | ` +
        `aprovador: ${aprovador?.email ?? 'nenhum'}`,
    );

    return {
      statusCode: 200,
      body: {
        success: true,
        lineItems: items,
        alcada,
        dealName,
        pipelineId,
        aprovador,
        pendentes,
        sistemaLabel,
      },
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: { success: false, error: error.message },
    };
  }
};
