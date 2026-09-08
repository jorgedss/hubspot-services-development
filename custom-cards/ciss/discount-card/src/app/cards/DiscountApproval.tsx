import {
  hubspot,
  useExtensionContext,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Flex,
  Text,
  LoadingSpinner,
  Alert,
  Divider,
  StatusTag,
  Accordion,
  logger,
} from '@hubspot/ui-extensions';
import { useState, useEffect } from 'react';

// Card somente leitura. A decisão do aprovador é tomada na propriedade
// "Proposta aprovada" do negócio, e executada pelo workflow
// "Desconto - Decisão do aprovador" (código em automation/desconto-decisao/).
hubspot.extend<'crm.record.tab'>(() => <CrmExtension />);

interface Categoria {
  original: number;
  novo: number;
}

// `totalBruto` é o bruto que a GroupContracts leu do CRM, gravado por
// `ApplyDiscounts.buildPendingPayload`. Opcional porque entrada gravada antes
// dele não o tem: ali o fallback é valor/h × horas.
interface RateHoursCategoria {
  valorUnitarioOriginal: number;
  valorUnitarioNovo: number;
  horasOriginal: number;
  horasNovo: number;
  totalBruto?: number;
}

type CategoriaKey = 'glt' | 'locacao' | 'licenca';
type RateHoursKey = 'treinamento' | 'desenvolvimento' | 'consultoria';

type CategoriasFull = Record<CategoriaKey, Categoria> &
  Record<RateHoursKey, RateHoursCategoria>;

interface PendingDiscount {
  nomeDoSistema: string;
  label: string;
  percentualDesconto: number;
  categorias: CategoriasFull;
}

// Entrada gravada pelo ciss-apps/locacao-equipamentos-card no mesmo
// `pending_discounts`. É UMA por negócio, agregando o conjunto de equipamentos,
// porque a aprovação é do conjunto. Os itens vêm dentro: a escrita continua
// sendo por line item, e o aprovador precisa ver o que está aprovando.
//
// Ela não entra na tabela de sistemas mesmo tendo a mesma granularidade. Duas
// colunas de lá mentiriam: "Trein. R$/h" receberia um total e não uma taxa, e
// "Trein. Horas" receberia contagem de equipamentos, porque em equipamento a
// propriedade horas_treinamento guarda quantidade, não horas.
interface ItemEquipamento {
  lineItemId: string;
  label: string;
  percentualDesconto: number | null;
  quantidade: number;
  treinamento: { unitarioOriginal: number; unitarioNovo: number };
  locacao: { unitarioOriginal: number; unitarioNovo: number };
}

interface EquipamentoPendente {
  tipo: 'equipamentos';
  label: string;
  percentualDesconto: number | null;
  brutoTotal: number;
  liquidoTotal: number;
  itens: ItemEquipamento[];
}

const totaisDoItem = (item: ItemEquipamento) => {
  const bruto =
    item.quantidade *
    (item.treinamento.unitarioOriginal + item.locacao.unitarioOriginal);
  const liquido =
    item.quantidade *
    (item.treinamento.unitarioNovo + item.locacao.unitarioNovo);
  return { bruto, liquido };
};

type PendingEntry = PendingDiscount | EquipamentoPendente;

const isEquipamento = (entry: PendingEntry): entry is EquipamentoPendente =>
  (entry as EquipamentoPendente).tipo === 'equipamentos';

interface HistoryEntry {
  nomeDoSistema: string;
  label: string;
  percentualDesconto: number;
  status: 'aprovado' | 'reprovado';
  responsavel: string;
  motivo?: string;
  data: string;
}

const CATEGORIES: { key: CategoriaKey; label: string }[] = [
  { key: 'licenca', label: 'Licença' },
  { key: 'glt', label: 'Mensalidade' },
  { key: 'locacao', label: 'Locação' },
];

// Mesmos rótulos de `RATE_HOURS_CATEGORIES` em `discountMath.ts`, que é o que
// o vendedor vê nas abas e o que sai no `resumo_descontos_aplicados`. Este card
// não importa aquele módulo: ele lê `pending_discounts`, não `ContractLine`.
const RATE_HOURS_CATEGORIES: { key: RateHoursKey; label: string }[] = [
  { key: 'treinamento', label: 'Horas Técnicas/Treinamentos' },
  { key: 'desenvolvimento', label: 'Desenvolvimento / DBA' },
  { key: 'consultoria', label: 'Consultoria Contábil/Fiscal' },
];

const DEFAULT_THRESHOLD = 10;

const formatPercent = (value: number | null): string => {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(2).replace('.', ',')}%`;
};

const formatCurrency = (value: number): string =>
  value === 0 ? '—' : `R$ ${value.toFixed(2).replace('.', ',')}`;

const formatHoras = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',');

// Espelha `calcDiscountPercent` de `discountMath.ts`, inclusive nos nulos:
// edição só de horas dá bruto === líquido, e "over" dá líquido > bruto.
const percentualDesconto = (bruto: number, liquido: number): number | null => {
  if (bruto <= 0 || liquido <= 0 || liquido >= bruto) return null;
  return ((bruto - liquido) / bruto) * 100;
};

// Espelha `rateHoursBruto` / `rateHoursLiquido`: os dois lados na base de horas
// EFETIVA, que é o que preserva "mudar horas nunca é desconto". Recalcular de
// outro jeito aqui faria a aba mostrar um par que o CRM não vai receber.
const totaisRateHours = (categoria?: RateHoursCategoria) => {
  const unitOriginal = categoria?.valorUnitarioOriginal ?? 0;
  const unitNovo = categoria?.valorUnitarioNovo ?? 0;
  const horasOriginal = categoria?.horasOriginal ?? 0;
  const horasNovo = categoria?.horasNovo ?? horasOriginal;
  const totalBruto = categoria?.totalBruto ?? unitOriginal * horasOriginal;
  const horasEditadas = horasNovo !== horasOriginal;

  // `unitOriginal === 0` é categoria com valor no CRM e nenhuma taxa
  // derivável: sem taxa não há desconto possível, então o líquido acompanha o
  // bruto e o percentual sai nulo em vez de um falso 100%.
  const bruto =
    unitOriginal === 0
      ? totalBruto
      : horasEditadas
        ? unitOriginal * horasNovo
        : totalBruto;
  const liquido = unitOriginal === 0 ? totalBruto : unitNovo * horasNovo;

  return {
    unitOriginal,
    unitNovo,
    horasOriginal,
    horasNovo,
    bruto,
    liquido,
    temValor: bruto > 0 || unitOriginal > 0,
  };
};

const totaisServicos = (item: PendingDiscount) =>
  RATE_HOURS_CATEGORIES.reduce(
    (acc, { key }) => {
      const totais = totaisRateHours(item.categorias?.[key]);
      return {
        bruto: acc.bruto + totais.bruto,
        liquido: acc.liquido + totais.liquido,
      };
    },
    { bruto: 0, liquido: 0 },
  );

const CrmExtension = () => {
  const context = useExtensionContext<'crm.record.tab'>();
  const { crm, user } = context;

  const [pending, setPending] = useState<PendingEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isApprover, setIsApprover] = useState(false);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const dealId = String(crm.objectId);
  const userEmail = user?.email ?? null;

  useEffect(() => {
    let active = true;

    const fetchInitial = async () => {
      try {
        const result = await hubspot.serverless('fetchDiscountApproval', {
          parameters: { dealId, userEmail },
        });

        if (!active) return;

        if (!result.body.success) {
          logger.error(
            `[fetchDiscountApproval] erro: ${JSON.stringify(result.body.error)}`,
          );
          setError(result.body.error ?? 'Erro ao carregar dados');
          return;
        }

        setPending(result.body.pending ?? []);
        setHistory(result.body.history ?? []);
        setIsApprover(result.body.isApprover ?? false);
        if (typeof result.body.alcada === 'number') {
          setThreshold(result.body.alcada);
        }
      } catch (err) {
        if (!active) return;
        logger.error(`[fetchDiscountApproval] exceção: ${JSON.stringify(err)}`);
        setError(err instanceof Error ? err.message : 'Erro ao carregar dados');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchInitial();

    return () => {
      active = false;
    };
    // Ambos são primitivos estáveis enquanto o card está montado: declarar as
    // dependências silencia o aviso sem refazer o fetch.
  }, [dealId, userEmail]);

  if (loading) {
    return (
      <Flex direction="column" align="center" justify="center">
        <LoadingSpinner label="Carregando descontos..." />
      </Flex>
    );
  }

  const pendingSistemas = pending.filter(
    (entry): entry is PendingDiscount => !isEquipamento(entry),
  );
  const pendingEquipamentos = pending.filter(isEquipamento);

  // Uma linha por sistema x categoria COM VALOR, na mesma regra das abas do
  // vendedor: categoria sem valor não vira linha. Sem este detalhe um desconto
  // de 60% só em consultoria fica escondido dentro de um "Serviços" a 16%.
  const linhasServicos = pendingSistemas.flatMap((item) =>
    RATE_HOURS_CATEGORIES.map(({ key, label }) => ({
      chave: `${item.nomeDoSistema}-${key}`,
      sistema: item.label,
      categoria: label,
      totais: totaisRateHours(item.categorias?.[key]),
    })).filter(({ totais }) => totais.temValor),
  );

  return (
    <Flex direction="column" gap="medium">
      {error && (
        <Alert title="Erro" variant="error">
          <Text>{error}</Text>
        </Alert>
      )}

      {/* ===== SEÇÃO 1 - PENDENTES ===== */}
      <Text format={{ fontWeight: 'bold' }}>Descontos Pendentes</Text>

      {!!pending.length && (
        <Alert title="Como aprovar ou reprovar" variant="info">
          <Text>
            Esta aba é somente informativa. A decisão é registrada na
            propriedade &quot;Proposta aprovada&quot; do negócio, na barra
            lateral: escolha &quot;Sim, aprovar&quot; ou &quot;Não,
            reprovar&quot; e, na reprovação, descreva o motivo em
            &quot;Observações&quot;. A alçada deste pipeline é de {threshold}%.
          </Text>
        </Alert>
      )}

      {!isApprover && (
        <Text format={{ italic: true }} variant="microcopy">
          Você não é aprovador deste pipeline. Esta visão é somente informativa.
        </Text>
      )}

      {!pending.length && (
        <Alert title="Nenhum desconto pendente" variant="tip">
          <Text>Não há descontos aguardando aprovação neste deal.</Text>
        </Alert>
      )}

      {!!pendingSistemas.length && (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader width="min">Sistema</TableHeader>
              {CATEGORIES.map(({ key, label }) => [
                <TableHeader key={`${key}-orig`} width="min">
                  {label} Orig.
                </TableHeader>,
                <TableHeader key={`${key}-novo`} width="min">
                  {label} Novo
                </TableHeader>,
              ])}
              <TableHeader width="min">Serviços Orig.</TableHeader>
              <TableHeader width="min">Serviços Novo</TableHeader>
              <TableHeader width="min">% Total</TableHeader>
              <TableHeader width="min">Status</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {pendingSistemas.map((item) => (
              <TableRow key={item.nomeDoSistema}>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>{item.label}</Text>
                </TableCell>

                {CATEGORIES.map(({ key }) => {
                  const cat = item.categorias[key];
                  return [
                    <TableCell key={`${key}-orig`}>
                      <Text>{formatCurrency(cat.original)}</Text>
                    </TableCell>,
                    <TableCell key={`${key}-novo`}>
                      <Text>{formatCurrency(cat.novo)}</Text>
                    </TableCell>,
                  ];
                })}
                {/* Serviços é a soma das três categorias hora x valor. O
                    detalhe por categoria fica no acordeão abaixo: com as três
                    abertas em coluna a tabela passaria de vinte colunas. */}
                <TableCell>
                  <Text>{formatCurrency(totaisServicos(item).bruto)}</Text>
                </TableCell>
                <TableCell>
                  <Text>{formatCurrency(totaisServicos(item).liquido)}</Text>
                </TableCell>

                {/* Vem de `pending_discounts`, calculado por Discount.tsx sobre
                    as seis categorias. É o mesmo número que o workflow grava no
                    histórico, então recalcular aqui só criaria divergência. */}
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatPercent(item.percentualDesconto)}
                  </Text>
                </TableCell>

                <TableCell>
                  <StatusTag variant="warning">Pendente</StatusTag>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!!linhasServicos.length && (
        <Accordion title="Detalhe de serviços (horas)" defaultOpen={false}>
          <Text variant="microcopy">
            Bruto e líquido estão na mesma quantidade de horas, a efetiva:
            mudar a quantidade de horas altera o escopo, nunca o percentual de
            desconto.
          </Text>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader width="min">Sistema</TableHeader>
                <TableHeader width="min">Categoria</TableHeader>
                <TableHeader width="min">R$/h Orig.</TableHeader>
                <TableHeader width="min">R$/h Novo</TableHeader>
                <TableHeader width="min">Horas Orig.</TableHeader>
                <TableHeader width="min">Horas Novo</TableHeader>
                <TableHeader width="min">Bruto</TableHeader>
                <TableHeader width="min">Líquido</TableHeader>
                <TableHeader width="min">%</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {linhasServicos.map(({ chave, sistema, categoria, totais }) => (
                <TableRow key={chave}>
                  <TableCell>
                    <Text format={{ fontWeight: 'bold' }}>{sistema}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{categoria}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(totais.unitOriginal)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(totais.unitNovo)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatHoras(totais.horasOriginal)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatHoras(totais.horasNovo)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(totais.bruto)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(totais.liquido)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>
                      {formatPercent(
                        percentualDesconto(totais.bruto, totais.liquido),
                      )}
                    </Text>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Accordion>
      )}

      {!!pendingEquipamentos.length && (
        <Flex direction="column" gap="small">
          <Text format={{ fontWeight: 'bold' }}>Equipamentos</Text>
          <Text variant="microcopy">
            Enviados pela aba &quot;Locação de Equipamentos&quot;. A aprovação é
            do conjunto, por isso uma linha só. A decisão em &quot;Proposta
            aprovada&quot; vale para ela e para os sistemas acima ao mesmo
            tempo: é uma decisão só por negócio.
          </Text>

          <Table>
            <TableHead>
              <TableRow>
                <TableHeader width="min">Sistema</TableHeader>
                <TableHeader width="min">Equipamentos</TableHeader>
                <TableHeader width="min">Bruto</TableHeader>
                <TableHeader width="min">Líquido</TableHeader>
                <TableHeader width="min">% Total</TableHeader>
                <TableHeader width="min">Status</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {pendingEquipamentos.map((grupo, index) => (
                <TableRow key={`${grupo.label}-${index}`}>
                  <TableCell>
                    <Text format={{ fontWeight: 'bold' }}>{grupo.label}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{grupo.itens?.length ?? 0}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(grupo.brutoTotal)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(grupo.liquidoTotal)}</Text>
                  </TableCell>
                  {/* Vem de `pending_discounts`, calculado pelo card de
                      equipamentos sobre o conjunto. Mesmo número que o workflow
                      grava no histórico: recalcular aqui só criaria divergência. */}
                  <TableCell>
                    <Text format={{ fontWeight: 'bold' }}>
                      {formatPercent(grupo.percentualDesconto)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <StatusTag variant="warning">Pendente</StatusTag>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* O detalhe não pode sumir: com o conjunto em 12%, um equipamento a
              90% fica invisível na linha agregada, e aprovar o conjunto aprova
              esse item também. */}
          <Accordion title="Detalhe por equipamento" defaultOpen={false}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader width="min">Equipamento</TableHeader>
                  <TableHeader width="min">Qtd.</TableHeader>
                  <TableHeader width="min">Trein. unit. Orig.</TableHeader>
                  <TableHeader width="min">Trein. unit. Novo</TableHeader>
                  <TableHeader width="min">Locação unit. Orig.</TableHeader>
                  <TableHeader width="min">Locação unit. Novo</TableHeader>
                  <TableHeader width="min">Bruto</TableHeader>
                  <TableHeader width="min">Líquido</TableHeader>
                  <TableHeader width="min">%</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {pendingEquipamentos.flatMap((grupo) =>
                  (grupo.itens ?? []).map((item) => {
                    const { bruto, liquido } = totaisDoItem(item);
                    return (
                      <TableRow key={item.lineItemId}>
                        <TableCell>
                          <Text>{item.label}</Text>
                        </TableCell>
                        <TableCell>
                          <Text>{item.quantidade}</Text>
                        </TableCell>
                        <TableCell>
                          <Text>
                            {formatCurrency(item.treinamento.unitarioOriginal)}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text>
                            {formatCurrency(item.treinamento.unitarioNovo)}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text>
                            {formatCurrency(item.locacao.unitarioOriginal)}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text>
                            {formatCurrency(item.locacao.unitarioNovo)}
                          </Text>
                        </TableCell>
                        <TableCell>
                          <Text>{formatCurrency(bruto)}</Text>
                        </TableCell>
                        <TableCell>
                          <Text>{formatCurrency(liquido)}</Text>
                        </TableCell>
                        <TableCell>
                          <Text>{formatPercent(item.percentualDesconto)}</Text>
                        </TableCell>
                      </TableRow>
                    );
                  }),
                )}
              </TableBody>
            </Table>
          </Accordion>
        </Flex>
      )}

      <Divider />

      {/* ===== SEÇÃO 2 - HISTÓRICO ===== */}
      <Accordion title="Histórico de Decisões" defaultOpen={false}>
        {!history.length ? (
          <Alert title="Sem histórico" variant="info">
            <Text>Nenhuma decisão registrada ainda.</Text>
          </Alert>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader width="min">Sistema</TableHeader>
                <TableHeader width="min">% Desconto</TableHeader>
                <TableHeader width="min">Status</TableHeader>
                <TableHeader width="min">Responsável</TableHeader>
                <TableHeader width="min">Motivo</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((entry, index) => (
                <TableRow key={`${entry.nomeDoSistema}-${index}`}>
                  <TableCell>
                    <Text>{entry.label}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatPercent(entry.percentualDesconto)}</Text>
                  </TableCell>
                  <TableCell>
                    {entry.status === 'aprovado' ? (
                      <StatusTag variant="success">Aprovado</StatusTag>
                    ) : (
                      <StatusTag variant="danger">Reprovado</StatusTag>
                    )}
                  </TableCell>
                  <TableCell>
                    <Text>{entry.responsavel}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{entry.motivo || '—'}</Text>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Accordion>
    </Flex>
  );
};
