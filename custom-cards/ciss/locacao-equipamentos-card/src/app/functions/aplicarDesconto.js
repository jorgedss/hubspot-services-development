const API_BASE = 'https://api.hubapi.com';

// Marcador das entradas deste card dentro de pending_discounts, propriedade
// compartilhada com o discount-card. Cópias em fetchLocacaoLineItems.js, em
// discount-card/src/app/functions/ApplyDiscounts.js e em
// discount-card/automation/desconto-decisao/customCode.js.
// Mudou uma, mude as quatro.
const TIPO_EQUIPAMENTOS = 'equipamentos';

// nome_do_sistema dos itens deste card. Vai na entrada pendente só para o
// histórico do workflow ter a mesma forma das entradas de sistema.
const SISTEMA_EQUIPAMENTOS = '67';

// Estágio de aprovação por pipeline. Cópia de APPROVAL_STAGES em
// discount-card/src/app/functions/ApplyDiscounts.js: os dois cards mandam o
// deal para o MESMO estágio, senão o segundo envio desfaz o primeiro.
const APPROVAL_STAGES = {
  872876959: '1347751842', // Franquia - SMB
  873229378: '1347750931', // Franquia - Enterprise
  872876956: '1347751841', // PDV e Geral - SMB
  872876957: '1347655299', // PDV e Geral - Enterprise
  907963396: '1385332128', // Expansão - Franquia
  911415619: '1385331244', // Expansão - PDV e Geral
};

const WEBHOOK_APROVACAO =
  'https://api.hubapi.com/automation/v4/webhook-triggers/50818082/nTnNdNW';

// resumo_descontos_aplicados é um texto só para os dois cards. Cada um é dono
// de um pedaço: o discount-card do que está antes do marcador, este card do
// marcador em diante. O marcador é idêntico em ApplyDiscounts.js.
const RESUMO_INICIO = '=== EQUIPAMENTOS ===';
// Marcador de fim das versões anteriores. Não é mais escrito, e só continua
// aqui para ser limpo de um resumo gravado antes desta versão.
const RESUMO_FIM_LEGADO = '=== FIM EQUIPAMENTOS ===';

const authHeaders = () => ({
  Authorization: `Bearer ${process.env.PRIVATE_APP_ACCESS_TOKEN}`,
  'Content-Type': 'application/json',
});

function toNumber(value) {
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    console.error('[aplicarDesconto] JSON inválido:', error.message);
    return fallback;
  }
}

// Troca o bloco de equipamentos do resumo, preservando o texto do discount-card
// que vive antes do marcador. Sem bloco novo, só remove o antigo.
//
// O bloco antigo vai do marcador até o fim do texto: este card sempre escreve
// os equipamentos por último, e o outro recola o que extraiu no fim do PATCH
// dele, então não existe texto de sistema depois do marcador para preservar.
function mesclarResumo(atual, bloco) {
  const texto = String(atual || '');
  const inicio = texto.indexOf(RESUMO_INICIO);

  const semBlocoAntigo =
    inicio !== -1 ? texto.slice(0, inicio).trim() : texto.trim();
  // Resumo gravado antes desta versão pode ter o marcador de fim solto no
  // texto dos sistemas, quando o bloco de equipamentos já tinha sido removido.
  const semLegado = semBlocoAntigo.split(RESUMO_FIM_LEGADO).join('').trim();

  if (!bloco) return semLegado;

  const blocoMarcado = `${RESUMO_INICIO}\n${bloco}`;
  return semLegado ? `${semLegado}\n\n${blocoMarcado}` : blocoMarcado;
}

async function fetchDealState(dealId) {
  const url =
    `${API_BASE}/crm/v3/objects/deals/${dealId}` +
    '?properties=pipeline,pending_discounts,resumo_descontos_aplicados';
  const response = await fetch(url, { method: 'GET', headers: authHeaders() });

  if (!response.ok) {
    throw new Error(`Falha ao ler o negócio ${dealId}: ${response.status}`);
  }

  const data = await response.json();
  const properties = data.properties || {};
  return {
    pipelineId: properties.pipeline,
    pending: safeParse(properties.pending_discounts, []),
    resumoAtual: properties.resumo_descontos_aplicados || '',
  };
}

async function patchDeal(dealId, properties) {
  const url = `${API_BASE}/crm/v3/objects/deals/${dealId}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ properties }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Falha ao gravar no negócio ${dealId}: ${response.status} ${body}`,
    );
  }

  return response.json();
}

// Mesma busca de ApplyDiscounts.fetchApproverForPipeline, incluindo o portão do
// owner: contato sem owner correspondente não recebe a notificação.
async function fetchAprovadorDoPipeline(pipelineId) {
  const buscaUrl = `${API_BASE}/crm/v3/objects/contacts/search`;
  const buscaResponse = await fetch(buscaUrl, {
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

  if (!buscaResponse.ok) {
    throw new Error(`Falha ao buscar aprovadores: ${buscaResponse.status}`);
  }

  const busca = await buscaResponse.json();
  const contato = (busca.results || []).find((c) => {
    const pipelines = (c.properties.aprovador_pipelines || '')
      .split(',')
      .map((s) => s.trim());
    return pipelines.includes(String(pipelineId));
  });

  if (!contato) return null;

  const ownerUrl =
    `${API_BASE}/crm/v3/owners` +
    `?email=${encodeURIComponent(contato.properties.email)}`;
  const ownerResponse = await fetch(ownerUrl, {
    method: 'GET',
    headers: authHeaders(),
  });

  if (!ownerResponse.ok) {
    throw new Error(`Falha ao resolver owner: ${ownerResponse.status}`);
  }

  const owner = ((await ownerResponse.json()).results || [])[0];
  if (!owner) return null;

  return {
    contactId: contato.id,
    email: contato.properties.email,
    nome: [contato.properties.firstname, contato.properties.lastname]
      .filter(Boolean)
      .join(' '),
  };
}

async function dispararWebhook(aprovador, dealName) {
  const response = await fetch(WEBHOOK_APROVACAO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      record_id: aprovador.contactId,
      email: aprovador.email,
      deal_name: dealName,
    }),
  });

  if (!response.ok) {
    throw new Error(`Falha ao disparar o webhook: ${response.status}`);
  }

  console.log(
    `[aplicarDesconto] webhook disparado para ${aprovador.email} ` +
      `(contato: ${aprovador.contactId}) | deal: ${dealName}`,
  );
}

async function patchLineItem(id, quantidade, brutoTreinamento, liquidoTreinamento, brutoLocacao, liquidoLocacao) {
  const totalTreinamento = quantidade * liquidoTreinamento;
  const totalLocacao = quantidade * liquidoLocacao;

  const url = `${API_BASE}/crm/v3/objects/line_items/${id}`;
  const response = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({
      properties: {
        horas_treinamento: String(quantidade),
        valor_treinamento_original: String(brutoTreinamento),
        valor_treinamento_descontado: String(liquidoTreinamento),
        valor_treinamento: String(totalTreinamento),
        valor_locacao_original: String(brutoLocacao),
        valor_locacao_descontado: String(liquidoLocacao),
        valor_locacao: String(totalLocacao),
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Falha ao gravar line item ${id}: ${response.status} ${body}`);
  }

  return response.json();
}

// UMA entrada para todo o conjunto de equipamentos, porque a aprovação é do
// conjunto: uma linha no card do aprovador, uma linha no histórico, do mesmo
// jeito que um sistema. O agregado é o número da decisão.
//
// Os itens viajam DENTRO da entrada e não podem ser descartados. A escrita é
// por item de linha, e redistribuir um total agregado de volta exigiria uma
// alocação inventada, que mudaria os valores que o vendedor digitou.
// Agrupa para decidir, preserva para aplicar.
//
// Cada item carrega alvo absoluto, nunca uma razão: reaplicar por retry ou
// reinscrição do workflow grava o mesmo valor.
const buildPendingEntry = (pendentes, agregado) => {
  const itens = (pendentes || []).map((item) => ({
    lineItemId: String(item.lineItemId),
    label: item.nome || String(item.lineItemId),
    percentualDesconto: item.percentualDesconto ?? null,
    quantidade: toNumber(item.quantidade),
    treinamento: {
      unitarioOriginal: toNumber(item.brutoTreinamento),
      unitarioNovo: toNumber(item.liquidoTreinamento),
    },
    locacao: {
      unitarioOriginal: toNumber(item.brutoLocacao),
      unitarioNovo: toNumber(item.liquidoLocacao),
    },
  }));

  const resumoAgregado = agregado || {};

  return {
    tipo: TIPO_EQUIPAMENTOS,
    nomeDoSistema: SISTEMA_EQUIPAMENTOS,
    // Rótulo do portal ("Equipamentos - 67"), resolvido pelo card. Vazio aqui
    // ainda funciona: o enrichLabels de FetchDiscountApproval.js resolve o
    // valor "67" na leitura, tanto no pendente quanto no histórico.
    label: resumoAgregado.label || '',
    percentualDesconto: resumoAgregado.percentualDesconto ?? null,
    // Deriváveis da soma dos itens, mas gravados mesmo assim: o card de
    // aprovação nunca recalcula o que veio de pending_discounts, senão o número
    // que o aprovador vê diverge do que o histórico registra.
    brutoTotal: toNumber(resumoAgregado.brutoTotal),
    liquidoTotal: toNumber(resumoAgregado.liquidoTotal),
    itens,
  };
};

exports.main = async (context) => {
  const { dealId, dealName, itens, pendentes, agregado, resumo } =
    context.parameters;

  const paraAplicar = Array.isArray(itens) ? itens : [];
  const paraAprovar = Array.isArray(pendentes) ? pendentes : [];

  if (paraAplicar.length === 0 && paraAprovar.length === 0) {
    return {
      statusCode: 400,
      body: { success: false, error: 'Nenhum item para aplicar desconto.' },
    };
  }

  console.log(
    `[aplicarDesconto] deal ${dealId} | ${paraAplicar.length} direto(s) | ` +
      `${paraAprovar.length} para aprovação`,
  );

  // Roteamento para aprovação. Nenhum line item é escrito aqui: os valores só
  // mudam quando o workflow "Desconto - Decisão do aprovador" aplicar.
  if (paraAprovar.length > 0) {
    if (!dealId) {
      return {
        statusCode: 400,
        body: { success: false, error: 'dealId ausente para rotear aprovação.' },
      };
    }

    try {
      const { pipelineId, pending, resumoAtual } = await fetchDealState(dealId);

      // Preserva o que o discount-card colocou lá: um card nunca apaga o
      // pendente do outro. Software primeiro, equipamentos depois.
      const outros = pending.filter(
        (entry) => entry?.tipo !== TIPO_EQUIPAMENTOS,
      );
      const minhaEntrada = buildPendingEntry(paraAprovar, agregado);

      const properties = {
        pending_discounts: JSON.stringify([...outros, minhaEntrada]),
        resumo_descontos_aplicados: mesclarResumo(resumoAtual, resumo || ''),
      };

      const approvalStage = APPROVAL_STAGES[pipelineId];
      if (approvalStage) {
        properties.dealstage = approvalStage;
      } else {
        console.warn(
          `[aplicarDesconto] pipeline ${pipelineId} sem estágio de aprovação ` +
            'mapeado, estágio não alterado',
        );
      }

      await patchDeal(dealId, properties);
      console.log(
        `[aplicarDesconto] 1 entrada de equipamentos com ` +
          `${minhaEntrada.itens.length} item(ns), ${outros.length} entrada(s) ` +
          'de sistema preservada(s)',
      );

      const aprovador = await fetchAprovadorDoPipeline(pipelineId);
      if (aprovador) {
        await dispararWebhook(aprovador, dealName || '');
      } else {
        console.warn(
          `[aplicarDesconto] nenhum aprovador para o pipeline ${pipelineId}, ` +
            'webhook não disparado',
        );
      }
    } catch (error) {
      console.error('[aplicarDesconto] erro ao rotear aprovação:', error.message);
      return {
        statusCode: 500,
        body: { success: false, error: error.message },
      };
    }
  }

  const resultados = [];
  let falhas = 0;

  for (const item of paraAplicar) {
    const {
      lineItemId,
      quantidade,
      brutoTreinamento,
      liquidoTreinamento,
      brutoLocacao,
      liquidoLocacao,
    } = item;

    try {
      await patchLineItem(
        lineItemId,
        toNumber(quantidade),
        toNumber(brutoTreinamento),
        toNumber(liquidoTreinamento),
        toNumber(brutoLocacao),
        toNumber(liquidoLocacao),
      );
      resultados.push({ lineItemId, success: true });
    } catch (error) {
      falhas += 1;
      resultados.push({ lineItemId, success: false, error: error.message });
    }
  }

  return {
    statusCode: falhas === 0 ? 200 : 500,
    body: {
      success: falhas === 0,
      resultados,
      falhas,
      aplicados: paraAplicar.length - falhas,
      pendentes: paraAprovar.length,
    },
  };
};
