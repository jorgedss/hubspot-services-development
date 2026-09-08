import { useEffect, useState } from 'react';
import {
  Accordion,
  Alert,
  Button,
  Divider,
  EmptyState,
  Flex,
  Heading,
  Input,
  StatusTag,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  hubspot,
  type CrmContext,
  type ExtensionPointApiActions,
} from '@hubspot/ui-extensions';

interface CrmExtensionProps {
  context: CrmContext;
  actions: ExtensionPointApiActions<'crm.record.tab'>;
}

interface LocacaoLineItem {
  id: string;
  nome: string;
  quantidade: number;
  valorTreinamento: number;
  valorLocacao: number;
  valorTreinamentoLiquido: number;
  valorLocacaoLiquido: number;
}

interface Aprovador {
  email: string;
  nome: string;
}

// Entrada de equipamento já gravada em pending_discounts. É UMA por negócio,
// agregando o conjunto, com os itens dentro. O card só a lê para avisar o
// vendedor: quem decide é o workflow "Desconto - Decisão do aprovador".
interface PendenteCrm {
  label: string;
  percentualDesconto: number | null;
  itens: { lineItemId: string; label: string }[];
}

const MOEDA = 'BRL';

// Alçada usada enquanto a função serverless não respondeu. Mesmo
// DEFAULT_THRESHOLD de fetchLocacaoLineItems.js.
const ALCADA_PADRAO = 10;

function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: MOEDA,
  });
}

function formatarPorcentagem(desconto: number): string {
  return `${desconto.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

// Espelha formatResumoCurrency de discount-card/src/app/cards/Discount.tsx: o
// resumo dos dois cards mora na mesma propriedade e é lido lado a lado.
function moedaResumo(valor: number): string {
  const [inteiro, decimal] = valor.toFixed(2).split('.');
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${comMilhar},${decimal}`;
}

function percentualDesconto(bruto: number, liquido: number): number {
  if (bruto === 0) {
    return 0;
  }
  return ((bruto - liquido) / bruto) * 100;
}

function linhaResumo(rotulo: string, bruto: number, liquido: number): string {
  const valores = `${moedaResumo(bruto)} → ${moedaResumo(liquido)} (${formatarPorcentagem(
    percentualDesconto(bruto, liquido),
  )})`;
  return `  ${`${rotulo}:`.padEnd(13)}${valores}`;
}

// Mesmo alinhamento das linhas de valor, para os campos que não são moeda.
function linhaSimples(rotulo: string, valor: string | number): string {
  return `  ${`${rotulo}:`.padEnd(13)}${valor}`;
}

// Segundo nível do bloco, para o unitário que explica a linha de cima. Espelha
// o detalhe por categoria que o discount-card emite dentro de "Serviços".
function linhaDetalhe(rotulo: string, bruto: number, liquido: number): string {
  return `    ${`${rotulo}:`.padEnd(11)}${moedaResumo(bruto)} → ${moedaResumo(
    liquido,
  )} (${formatarPorcentagem(percentualDesconto(bruto, liquido))})`;
}

hubspot.extend<'crm.record.tab'>(({ context, actions }: CrmExtensionProps) => (
  <LocacaoEquipamentos context={context} actions={actions} />
));

const LocacaoEquipamentos = ({ context, actions }: CrmExtensionProps) => {
  const [lineItems, setLineItems] = useState<LocacaoLineItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [descontosTreinamento, setDescontosTreinamento] = useState<
    Record<string, number>
  >({});
  const [descontosLocacao, setDescontosLocacao] = useState<Record<string, number>>(
    {},
  );
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [alcada, setAlcada] = useState(ALCADA_PADRAO);
  const [dealName, setDealName] = useState('');
  const [aprovador, setAprovador] = useState<Aprovador | null>(null);
  const [pendentesCrm, setPendentesCrm] = useState<PendenteCrm[]>([]);
  const [sistemaLabel, setSistemaLabel] = useState('');

  const objectId = context.crm.objectId;

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        const resposta = await hubspot.serverless('fetchLocacaoLineItems', {
          parameters: { objectId },
        });
        if (!ativo) {
          return;
        }
        const body = resposta.body;
        if (body.success) {
          setLineItems(body.lineItems);
          setAlcada(
            typeof body.alcada === 'number' ? body.alcada : ALCADA_PADRAO,
          );
          setDealName(body.dealName ?? '');
          setAprovador(body.aprovador ?? null);
          setPendentesCrm(body.pendentes ?? []);
          setSistemaLabel(body.sistemaLabel ?? '');

          const descontoTreinamentoInicial: Record<string, number> = {};
          const descontoLocacaoInicial: Record<string, number> = {};
          const quantidadeInicial: Record<string, number> = {};
          for (const item of body.lineItems) {
            descontoTreinamentoInicial[item.id] =
              item.valorTreinamento - item.valorTreinamentoLiquido;
            descontoLocacaoInicial[item.id] =
              item.valorLocacao - item.valorLocacaoLiquido;
            quantidadeInicial[item.id] = item.quantidade;
          }
          setDescontosTreinamento(descontoTreinamentoInicial);
          setDescontosLocacao(descontoLocacaoInicial);
          setQuantidades(quantidadeInicial);
        } else {
          setErro(body.error || 'Erro ao carregar os itens de linha.');
        }
      } catch (e) {
        if (ativo) {
          setErro(e instanceof Error ? e.message : 'Erro inesperado.');
        }
      } finally {
        if (ativo) {
          setCarregando(false);
        }
      }
    }

    carregar();

    return () => {
      ativo = false;
    };
  }, [objectId]);

  const valorLiquidoTreinamento = (item: LocacaoLineItem): number => {
    const desconto = descontosTreinamento[item.id] ?? 0;
    const liquido = item.valorTreinamento - desconto;
    return Math.max(0, liquido);
  };

  const valorLiquidoLocacao = (item: LocacaoLineItem): number => {
    const desconto = descontosLocacao[item.id] ?? 0;
    const liquido = item.valorLocacao - desconto;
    return Math.max(0, liquido);
  };

  const quantidadeItem = (item: LocacaoLineItem): number => {
    return quantidades[item.id] ?? item.quantidade;
  };

  const totaisItem = (item: LocacaoLineItem) => {
    const quantidade = quantidadeItem(item);
    const brutoTreinamento = quantidade * item.valorTreinamento;
    const liquidoTreinamento = quantidade * valorLiquidoTreinamento(item);
    const brutoLocacao = quantidade * item.valorLocacao;
    const liquidoLocacao = quantidade * valorLiquidoLocacao(item);

    return {
      quantidade,
      brutoTreinamento,
      liquidoTreinamento,
      brutoLocacao,
      liquidoLocacao,
      brutoTotal: brutoTreinamento + brutoLocacao,
      liquidoTotal: liquidoTreinamento + liquidoLocacao,
    };
  };

  const totaisGerais = lineItems.reduce(
    (acc, item) => {
      const totais = totaisItem(item);
      return {
        brutoTreinamento: acc.brutoTreinamento + totais.brutoTreinamento,
        liquidoTreinamento: acc.liquidoTreinamento + totais.liquidoTreinamento,
        brutoLocacao: acc.brutoLocacao + totais.brutoLocacao,
        liquidoLocacao: acc.liquidoLocacao + totais.liquidoLocacao,
        brutoTotal: acc.brutoTotal + totais.brutoTotal,
        liquidoTotal: acc.liquidoTotal + totais.liquidoTotal,
      };
    },
    {
      brutoTreinamento: 0,
      liquidoTreinamento: 0,
      brutoLocacao: 0,
      liquidoLocacao: 0,
      brutoTotal: 0,
      liquidoTotal: 0,
    },
  );

  // Portão, não filtro. Igual ao hasNewValue de
  // discount-card/src/app/cards/Discount.tsx, ele decide SE o conjunto vai para
  // aprovação, nunca QUAIS linhas dele vão: quem vai é o conjunto inteiro.
  //
  // Existe porque um deal reaberto já vem com desconto aplicado no líquido.
  // Sem ele, abrir a aba de um deal já descontado acima da alçada rotearia para
  // aprovação sem ninguém ter digitado nada.
  const foiEditado = (item: LocacaoLineItem): boolean =>
    valorLiquidoTreinamento(item) !== item.valorTreinamentoLiquido ||
    valorLiquidoLocacao(item) !== item.valorLocacaoLiquido ||
    quantidadeItem(item) !== item.quantidade;

  const itensEditados = lineItems.filter(foiEditado);

  // Roteamento igual ao do discount-card. Equipamentos é um nome_do_sistema só
  // ("67"), então o conjunto aqui é a unidade que lá é um sistema, e as duas
  // perguntas são feitas sobre essa mesma unidade: o percentual agregado do
  // conjunto OU qualquer linha isolada acima da alçada.
  //
  // Perguntar sobre o conjunto e enviar só as linhas editadas misturaria duas
  // granularidades: o roteamento olharia um conjunto de linhas e o aprovador
  // decidiria sobre outro, com um percentual que não explica por que aquilo
  // chegou até ele.
  const percentualGeral = percentualDesconto(
    totaisGerais.brutoTotal,
    totaisGerais.liquidoTotal,
  );
  const algumaLinhaAcimaDaAlcada = lineItems.some((item) => {
    const totais = totaisItem(item);
    return (
      percentualDesconto(totais.brutoTotal, totais.liquidoTotal) > alcada
    );
  });
  const requerAprovacao =
    itensEditados.length > 0 &&
    (percentualGeral > alcada || algumaLinhaAcimaDaAlcada);

  const idsPendentes = new Set(
    pendentesCrm.flatMap((p) =>
      (p.itens || []).map((i) => String(i.lineItemId)),
    ),
  );
  const qtdPendentes = idsPendentes.size;

  // Totais do conjunto entre as linhas editadas. É o número da decisão: a
  // aprovação é do conjunto de equipamentos, não de cada equipamento.
  const agregadoDe = (itens: LocacaoLineItem[]) => {
    const bruto = itens.reduce((acc, i) => acc + totaisItem(i).brutoTotal, 0);
    const liquido = itens.reduce(
      (acc, i) => acc + totaisItem(i).liquidoTotal,
      0,
    );
    return {
      brutoTotal: bruto,
      liquidoTotal: liquido,
      percentualDesconto: percentualDesconto(bruto, liquido),
    };
  };

  // Texto para resumo_descontos_aplicados: um bloco por equipamento, no mesmo
  // formato que o discount-card usa por sistema, e o total do conjunto por
  // último, como o TOTAL GERAL de lá. Os dois textos moram na mesma
  // propriedade e são lidos em sequência, então o formato tem que ser o mesmo.
  //
  // O total continua no texto porque é o número que roteou a aprovação, e o
  // Status vive nele, não em cada equipamento: a decisão é do conjunto, um
  // item não é aprovado sozinho.
  //
  // Qtd. entra em cada bloco porque as linhas de Treinamento e Locação são
  // quantidade × valor unitário. Sem ela o valor não se explica.
  //
  // O bloco é delimitado pelos marcadores no serverless, não aqui: eles são de
  // parsing, não de exibição.
  const montarResumo = (itens: LocacaoLineItem[]): string => {
    const agregado = agregadoDe(itens);

    const blocos = itens.map((item) => {
      const totais = totaisItem(item);
      // Quantidade editada aparece com as duas pontas e sem percentual entre
      // elas, igual às horas do discount-card: mudar quantidade é escopo, não
      // desconto. O que muda de valor é o unitário, na linha abaixo.
      const quantidade =
        totais.quantidade === item.quantidade
          ? String(totais.quantidade)
          : `${item.quantidade} → ${totais.quantidade}`;

      return [
        item.nome || item.id,
        linhaSimples('Qtd.', quantidade),
        linhaResumo(
          'Treinamento',
          totais.brutoTreinamento,
          totais.liquidoTreinamento,
        ),
        // Unitário porque é ele que o aprovador vê na tabela de equipamentos e
        // é ele que o caminho de escrita grava no item de linha. O total do
        // item é quantidade × unitário, e sem o unitário não dá para conferir.
        linhaDetalhe(
          'Unitário',
          item.valorTreinamento,
          valorLiquidoTreinamento(item),
        ),
        linhaResumo('Locação', totais.brutoLocacao, totais.liquidoLocacao),
        linhaDetalhe('Unitário', item.valorLocacao, valorLiquidoLocacao(item)),
        linhaResumo('Total', totais.brutoTotal, totais.liquidoTotal),
      ].join('\n');
    });

    const agregadoTreinamento = itens.reduce(
      (acc, item) => {
        const totais = totaisItem(item);
        return {
          bruto: acc.bruto + totais.brutoTreinamento,
          liquido: acc.liquido + totais.liquidoTreinamento,
        };
      },
      { bruto: 0, liquido: 0 },
    );
    const agregadoLocacao = itens.reduce(
      (acc, item) => {
        const totais = totaisItem(item);
        return {
          bruto: acc.bruto + totais.brutoLocacao,
          liquido: acc.liquido + totais.liquidoLocacao,
        };
      },
      { bruto: 0, liquido: 0 },
    );

    const total = [
      sistemaLabel
        ? `TOTAL EQUIPAMENTOS (${sistemaLabel})`
        : 'TOTAL EQUIPAMENTOS',
      linhaResumo(
        'Treinamento',
        agregadoTreinamento.bruto,
        agregadoTreinamento.liquido,
      ),
      linhaResumo('Locação', agregadoLocacao.bruto, agregadoLocacao.liquido),
      linhaResumo('Total', agregado.brutoTotal, agregado.liquidoTotal),
      linhaSimples('Itens', itens.length),
      '  Status: Requer Aprovação',
    ].join('\n');

    return [...blocos, total].join('\n\n');
  };

  const lancarDesconto = async () => {
    setSalvando(true);
    try {
      const paraPayload = (item: LocacaoLineItem) => {
        const totais = totaisItem(item);
        return {
          lineItemId: item.id,
          nome: item.nome || item.id,
          quantidade: totais.quantidade,
          brutoTreinamento: item.valorTreinamento,
          liquidoTreinamento: valorLiquidoTreinamento(item),
          brutoLocacao: item.valorLocacao,
          liquidoLocacao: valorLiquidoLocacao(item),
          percentualDesconto: percentualDesconto(
            totais.brutoTotal,
            totais.liquidoTotal,
          ),
        };
      };

      // Ou tudo vai para aprovação, ou tudo é gravado direto. Aplicar parte e
      // deixar parte pendente daria ao aprovador uma decisão sobre um estado
      // que o CRM já não tem.
      // O conjunto inteiro nos dois caminhos, como o discount-card manda o
      // sistema inteiro. Linha não editada chega com o líquido vigente, então a
      // escrita nela é o mesmo valor de novo, e o aprovador vê o desconto que o
      // negócio realmente carrega em equipamentos, não só o desta sessão.
      const itens = requerAprovacao ? [] : lineItems.map(paraPayload);
      const pendentes = requerAprovacao ? lineItems.map(paraPayload) : [];
      const resumo = requerAprovacao ? montarResumo(lineItems) : '';
      // Vira UMA entrada em pending_discounts, com os itens dentro.
      const agregado = requerAprovacao
        ? { label: sistemaLabel, ...agregadoDe(lineItems) }
        : null;

      const resposta = await hubspot.serverless('aplicarDesconto', {
        parameters: {
          dealId: String(objectId),
          dealName,
          itens,
          pendentes,
          agregado,
          resumo,
        },
      });
      const body = resposta.body;

      if (body.success) {
        actions.addAlert({
          type: 'success',
          title: requerAprovacao ? 'Enviado para aprovação' : 'Desconto aplicado',
          message: requerAprovacao
            ? `Conjunto de ${pendentes.length} equipamento(s) aguardando a decisão do aprovador.`
            : `${itens.length} item(ns) de linha atualizado(s).`,
        });
        actions.reloadPage();
      } else {
        actions.addAlert({
          type: 'warning',
          title: 'Falha ao processar',
          message:
            body.error ??
            `${body.falhas} item(ns) falharam. Verifique os logs.`,
        });
      }
    } catch (e) {
      actions.addAlert({
        type: 'danger',
        title: 'Erro',
        message: e instanceof Error ? e.message : 'Erro ao lançar desconto.',
      });
    } finally {
      setSalvando(false);
    }
  };

  if (carregando) {
    return (
      <EmptyState title="Carregando itens de linha..." layout="vertical" imageName="components">
        <Text>Buscando equipamentos do negócio.</Text>
      </EmptyState>
    );
  }

  if (erro) {
    return (
      <Alert title="Erro" variant="error">
        {erro}
      </Alert>
    );
  }

  if (lineItems.length === 0) {
    return (
      <EmptyState
        title="Nenhum equipamento encontrado"
        layout="vertical"
        imageName="deals"
      >
        <Text>
          Este negócio não possui itens de linha de{' '}
          {sistemaLabel || 'Equipamentos'}.
        </Text>
      </EmptyState>
    );
  }

  return (
    <Flex direction="column" gap="md">
      <Heading>Locação de Equipamentos</Heading>
      <Text>
        Desconto individual por equipamento, consolidando treinamento e
        locação/mensalidade. A alçada deste pipeline é de{' '}
        {formatarPorcentagem(alcada)}.
      </Text>

      {qtdPendentes > 0 && (
        <Alert title="Já existe desconto aguardando aprovação" variant="warning">
          <Text>
            {qtdPendentes} equipamento(s) deste negócio estão na fila do
            aprovador. Um novo envio substitui o que ele vai ver.
          </Text>
        </Alert>
      )}

      {requerAprovacao && (
        <Alert title="Este desconto precisa de aprovação" variant="info">
          <Text>
            O desconto do conjunto é de {formatarPorcentagem(percentualGeral)},
            acima da alçada de {formatarPorcentagem(alcada)}. Ao confirmar, os{' '}
            {lineItems.length} equipamento(s) deste negócio vão para aprovação
            como um conjunto e os valores só mudam depois da decisão.{' '}
            {aprovador
              ? `Aprovador deste pipeline: ${aprovador.nome || aprovador.email}.`
              : 'Nenhum aprovador cadastrado para este pipeline: o envio grava a pendência, mas ninguém é notificado.'}
          </Text>
        </Alert>
      )}

      <Divider />

      <Table density="condensed">
        <TableHead>
          <TableRow>
            <TableHeader width="min">Equipamento</TableHeader>
            <TableHeader width="min" align="right">Qtd. equip.</TableHeader>
            <TableHeader width="min" align="right">Valor unit. bruto (treinamento)</TableHeader>
            <TableHeader width="min" align="right">Valor unit. líquido (treinamento)</TableHeader>
            <TableHeader width="min" align="right">Total bruto (treinamento)</TableHeader>
            <TableHeader width="min" align="right">Total líquido (treinamento)</TableHeader>
            <TableHeader width="min" align="right">% desconto (treinamento)</TableHeader>
            <TableHeader width="min" align="right">Valor locação unit. bruto</TableHeader>
            <TableHeader width="min" align="right">Valor locação unit. líquido</TableHeader>
            <TableHeader width="min" align="right">Total bruto (locação)</TableHeader>
            <TableHeader width="min" align="right">Total líquido (locação)</TableHeader>
            <TableHeader width="min" align="right">% desconto (locação)</TableHeader>
            <TableHeader width="min">Situação</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {lineItems.map((item) => {
            const liquidoTreinamento = valorLiquidoTreinamento(item);
            const liquidoLocacao = valorLiquidoLocacao(item);
            const {
              quantidade,
              brutoTreinamento: totalBrutoTreinamento,
              liquidoTreinamento: totalLiquidoTreinamento,
              brutoLocacao: totalBrutoLocacao,
              liquidoLocacao: totalLiquidoLocacao,
              brutoTotal,
              liquidoTotal,
            } = totaisItem(item);
            const acimaDaAlcada =
              percentualDesconto(brutoTotal, liquidoTotal) > alcada;

            return (
              <TableRow key={item.id}>
                <TableCell>{item.nome || item.id}</TableCell>
                <TableCell align="right">
                  <Input
                    name={`quantidade-${item.id}`}
                    label="Quantidade"
                    value={String(quantidade)}
                    onChange={(value) => {
                      const parsed = parseFloat(value);
                      const quantidade =
                        Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
                      setQuantidades((prev) => ({
                        ...prev,
                        [item.id]: quantidade,
                      }));
                    }}
                  />
                </TableCell>
                <TableCell align="right">
                  {formatarMoeda(item.valorTreinamento)}
                </TableCell>
                <TableCell align="right">
                  <Input
                    name={`treinamento-${item.id}`}
                    label="Valor treinamento"
                    value={String(liquidoTreinamento)}
                    onChange={(value) => {
                      const parsed = parseFloat(value);
                      const liquido = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
                      setDescontosTreinamento((prev) => ({
                        ...prev,
                        [item.id]: item.valorTreinamento - liquido,
                      }));
                    }}
                  />
                </TableCell>
                <TableCell align="right">
                  {formatarMoeda(totalBrutoTreinamento)}
                </TableCell>
                <TableCell align="right">
                  {formatarMoeda(totalLiquidoTreinamento)}
                </TableCell>
                <TableCell align="right">
                  {formatarPorcentagem(
                    percentualDesconto(totalBrutoTreinamento, totalLiquidoTreinamento),
                  )}
                </TableCell>
                <TableCell align="right">
                  {formatarMoeda(item.valorLocacao)}
                </TableCell>
                <TableCell align="right">
                  <Input
                    name={`locacao-${item.id}`}
                    label="Valor locação"
                    value={String(liquidoLocacao)}
                    onChange={(value) => {
                      const parsed = parseFloat(value);
                      const liquido = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
                      setDescontosLocacao((prev) => ({
                        ...prev,
                        [item.id]: item.valorLocacao - liquido,
                      }));
                    }}
                  />
                </TableCell>
                <TableCell align="right">
                  {formatarMoeda(totalBrutoLocacao)}
                </TableCell>
                <TableCell align="right">
                  {formatarMoeda(totalLiquidoLocacao)}
                </TableCell>
                <TableCell align="right">
                  {formatarPorcentagem(
                    percentualDesconto(totalBrutoLocacao, totalLiquidoLocacao),
                  )}
                </TableCell>
                <TableCell>
                  {idsPendentes.has(item.id) ? (
                    <StatusTag variant="warning">Em aprovação</StatusTag>
                  ) : acimaDaAlcada ? (
                    <StatusTag variant="danger">Acima da alçada</StatusTag>
                  ) : (
                    <StatusTag variant="success">Dentro da alçada</StatusTag>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Accordion title="Totalizador por Equipamento" defaultOpen={true}>
        <Table density="condensed">
          <TableHead>
            <TableRow>
              <TableHeader width="min">Equipamento</TableHeader>
              <TableHeader width="min" align="right">Trein. bruto</TableHeader>
              <TableHeader width="min" align="right">Trein. líquido</TableHeader>
              <TableHeader width="min" align="right">% Trein.</TableHeader>
              <TableHeader width="min" align="right">Loc. bruto</TableHeader>
              <TableHeader width="min" align="right">Loc. líquido</TableHeader>
              <TableHeader width="min" align="right">% Loc.</TableHeader>
              <TableHeader width="min" align="right">Total bruto</TableHeader>
              <TableHeader width="min" align="right">Total líquido</TableHeader>
              <TableHeader width="min" align="right">% Total</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {lineItems.map((item) => {
              const totais = totaisItem(item);

              return (
                <TableRow key={item.id}>
                  <TableCell>{item.nome || item.id}</TableCell>
                  <TableCell align="right">
                    {formatarMoeda(totais.brutoTreinamento)}
                  </TableCell>
                  <TableCell align="right">
                    {formatarMoeda(totais.liquidoTreinamento)}
                  </TableCell>
                  <TableCell align="right">
                    {formatarPorcentagem(
                      percentualDesconto(
                        totais.brutoTreinamento,
                        totais.liquidoTreinamento,
                      ),
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {formatarMoeda(totais.brutoLocacao)}
                  </TableCell>
                  <TableCell align="right">
                    {formatarMoeda(totais.liquidoLocacao)}
                  </TableCell>
                  <TableCell align="right">
                    {formatarPorcentagem(
                      percentualDesconto(
                        totais.brutoLocacao,
                        totais.liquidoLocacao,
                      ),
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Text format={{ fontWeight: 'bold' }}>
                      {formatarMoeda(totais.brutoTotal)}
                    </Text>
                  </TableCell>
                  <TableCell align="right">
                    <Text format={{ fontWeight: 'bold' }}>
                      {formatarMoeda(totais.liquidoTotal)}
                    </Text>
                  </TableCell>
                  <TableCell align="right">
                    <Text format={{ fontWeight: 'bold' }}>
                      {formatarPorcentagem(
                        percentualDesconto(
                          totais.brutoTotal,
                          totais.liquidoTotal,
                        ),
                      )}
                    </Text>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow>
              <TableCell>
                <Text format={{ fontWeight: 'bold' }}>Total Geral</Text>
              </TableCell>
              <TableCell align="right">
                <Text format={{ fontWeight: 'bold' }}>
                  {formatarMoeda(totaisGerais.brutoTreinamento)}
                </Text>
              </TableCell>
              <TableCell align="right">
                <Text format={{ fontWeight: 'bold' }}>
                  {formatarMoeda(totaisGerais.liquidoTreinamento)}
                </Text>
              </TableCell>
              <TableCell align="right">
                <Text format={{ fontWeight: 'bold' }}>
                  {formatarPorcentagem(
                    percentualDesconto(
                      totaisGerais.brutoTreinamento,
                      totaisGerais.liquidoTreinamento,
                    ),
                  )}
                </Text>
              </TableCell>
              <TableCell align="right">
                <Text format={{ fontWeight: 'bold' }}>
                  {formatarMoeda(totaisGerais.brutoLocacao)}
                </Text>
              </TableCell>
              <TableCell align="right">
                <Text format={{ fontWeight: 'bold' }}>
                  {formatarMoeda(totaisGerais.liquidoLocacao)}
                </Text>
              </TableCell>
              <TableCell align="right">
                <Text format={{ fontWeight: 'bold' }}>
                  {formatarPorcentagem(
                    percentualDesconto(
                      totaisGerais.brutoLocacao,
                      totaisGerais.liquidoLocacao,
                    ),
                  )}
                </Text>
              </TableCell>
              <TableCell align="right">
                <Text format={{ fontWeight: 'bold' }}>
                  {formatarMoeda(totaisGerais.brutoTotal)}
                </Text>
              </TableCell>
              <TableCell align="right">
                <Text format={{ fontWeight: 'bold' }}>
                  {formatarMoeda(totaisGerais.liquidoTotal)}
                </Text>
              </TableCell>
              <TableCell align="right">
                <Text format={{ fontWeight: 'bold' }}>
                  {formatarPorcentagem(percentualGeral)}
                </Text>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Accordion>

      <Flex direction="row" justify="end" gap="md">
        <Button
          variant="primary"
          disabled={salvando}
          onClick={lancarDesconto}
        >
          {salvando
            ? 'Enviando...'
            : requerAprovacao
              ? 'Enviar para aprovação'
              : 'Lançar desconto'}
        </Button>
      </Flex>
    </Flex>
  );
};
