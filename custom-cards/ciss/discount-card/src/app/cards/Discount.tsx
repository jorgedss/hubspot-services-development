import {
  hubspot,
  useExtensionContext,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  NumberInput,
  Button,
  Flex,
  Text,
  LoadingSpinner,
  Alert,
  StatusTag,
  Accordion,
  logger,
} from '@hubspot/ui-extensions';
import { useState, useEffect } from 'react';
import {
  RATE_HOURS_CATEGORIES,
  calcDiscountPercent,
  calcLicencaTotal,
  calcMensalidadeTotal,
  calcProjetoTotal,
  calcRateHoursPercent,
  calcServicosTotal,
  calcTotalDiscountPercent,
  effective,
  hasAnyFieldOverThreshold,
  hasAnyValue,
  hasFlatValue,
  hasRateHoursValue,
  isEdited,
  rateHoursBruto,
  rateHoursLiquido,
} from './discountMath.ts';
import type {
  ContractLine,
  FieldValue,
  FlatField,
  RateHoursConfig,
} from './discountMath.ts';
import { buildPendingResumo } from './discountResumo.ts';

hubspot.extend<'crm.record.tab'>(({ actions }) => (
  <CrmExtension actions={actions} />
));

type Field =
  | FlatField
  | 'treinamentoValorUnitario'
  | 'treinamentoHoras'
  | 'desenvolvimentoValorUnitario'
  | 'desenvolvimentoHoras'
  | 'consultoriaValorUnitario'
  | 'consultoriaHoras';

interface GroupedValues {
  label: string;
  glt: number;
  gltLiquido: number;
  locacao: number;
  locacaoLiquido: number;
  licenca: number;
  licencaLiquido: number;
  treinamentoValorUnitario: number;
  treinamentoValorUnitarioLiquido: number;
  treinamentoHoras: number;
  treinamentoTotalBruto: number;
  tipoContrato: string | null;
  desenvolvimentoValorUnitario: number;
  desenvolvimentoValorUnitarioLiquido: number;
  desenvolvimentoHoras: number;
  desenvolvimentoTotalBruto: number;
  consultoriaValorUnitario: number;
  consultoriaValorUnitarioLiquido: number;
  consultoriaHoras: number;
  consultoriaTotalBruto: number;
}

type GroupedData = Record<string, GroupedValues>;

interface DraftCategoria {
  original: number;
  novo: number;
}

interface DraftRateHoursCategoria {
  valorUnitarioOriginal: number;
  valorUnitarioNovo: number;
  horasOriginal: number;
  horasNovo: number;
}

interface DraftEntry {
  nomeDoSistema: string;
  label: string;
  percentualDesconto: number;
  categorias: {
    glt: DraftCategoria;
    locacao: DraftCategoria;
    licenca: DraftCategoria;
    treinamento: DraftRateHoursCategoria;
    desenvolvimento: DraftRateHoursCategoria;
    consultoria: DraftRateHoursCategoria;
  };
}

// O `?? original` cobre uma resposta sem os pares `*Liquido` (versão anterior
// da serverless function): sem desconto aplicado, vigente === original.
const parseField = (original: number, liquido?: number): FieldValue => ({
  original,
  current: liquido ?? original,
  new: null,
});

// Horas não têm bruto original: a quantidade vigente é a própria referência,
// já que mudar horas nunca é desconto.
const parseHours = (horas: number): FieldValue => ({
  original: horas,
  current: horas,
  new: null,
});

const lineParser = (data: GroupedData): ContractLine[] =>
  Object.entries(data).map(([nome_do_sistema, values], index) => ({
    id: String(index + 1),
    nome_do_sistema,
    label: values.label,
    glt: parseField(values.glt, values.gltLiquido),
    locacao: parseField(values.locacao, values.locacaoLiquido),
    licenca: parseField(values.licenca, values.licencaLiquido),
    treinamentoValorUnitario: parseField(
      values.treinamentoValorUnitario,
      values.treinamentoValorUnitarioLiquido,
    ),
    treinamentoHoras: parseHours(values.treinamentoHoras),
    treinamentoTotalBruto: values.treinamentoTotalBruto,
    tipoContrato: values.tipoContrato ?? null,
    desenvolvimentoValorUnitario: parseField(
      values.desenvolvimentoValorUnitario,
      values.desenvolvimentoValorUnitarioLiquido,
    ),
    desenvolvimentoHoras: parseHours(values.desenvolvimentoHoras),
    desenvolvimentoTotalBruto: values.desenvolvimentoTotalBruto,
    consultoriaValorUnitario: parseField(
      values.consultoriaValorUnitario,
      values.consultoriaValorUnitarioLiquido,
    ),
    consultoriaHoras: parseHours(values.consultoriaHoras),
    consultoriaTotalBruto: values.consultoriaTotalBruto,
  }));

const hasNewValue = (line: ContractLine): boolean =>
  isEdited(line.glt) ||
  isEdited(line.locacao) ||
  isEdited(line.licenca) ||
  isEdited(line.treinamentoValorUnitario) ||
  isEdited(line.treinamentoHoras) ||
  isEdited(line.desenvolvimentoValorUnitario) ||
  isEdited(line.desenvolvimentoHoras) ||
  isEdited(line.consultoriaValorUnitario) ||
  isEdited(line.consultoriaHoras);

const formatPercent = (value: number | null): string => {
  if (value === null) return '—';
  return `${value.toFixed(2).replace('.', ',')}%`;
};

const formatCurrency = (value: number): string =>
  value === 0 ? '—' : `R$ ${value.toFixed(2).replace('.', ',')}`;

interface CategoryConfig {
  field: FlatField;
  title: string;
  netColumnTitle?: string;
}

const CATEGORIES: CategoryConfig[] = [
  { field: 'licenca', title: 'Licença', netColumnTitle: 'Valor Licença Líquido' },
  { field: 'glt', title: 'Mensalidade' },
];

interface CategoryTableProps {
  config: CategoryConfig;
  lines: ContractLine[];
  onChangeValue: (id: string, field: Field, value: number) => void;
}

// Substitui a tabela, e não o acordeão: um conjunto de acordeões que varia por
// negociação não deixa distinguir dado ausente de falha de carga.
const EmptyCategory = ({ title }: { title: string }) => (
  <Text format={{ italic: true }} variant="microcopy">
    Nenhum sistema desta negociação tem valor em {title}.
  </Text>
);

const CategoryTable = ({
  config,
  lines,
  onChangeValue,
}: CategoryTableProps) => {
  const { field, title, netColumnTitle } = config;

  // O rodapé Total sai do MESMO array das linhas exibidas. Somar conjuntos
  // diferentes daria um total que as linhas visíveis não reproduzem.
  const visibleLines = lines.filter((line) => hasFlatValue(line, field));

  if (!visibleLines.length) return <EmptyCategory title={title} />;

  const total = visibleLines.reduce(
    (acc, line) => ({
      original: acc.original + line[field].original,
      novo: acc.novo + effective(line[field]),
    }),
    { original: 0, novo: 0 },
  );

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeader>Sistema</TableHeader>
          <TableHeader width="min">Valor Bruto</TableHeader>
          <TableHeader width="min">{netColumnTitle ?? 'Valor Líquido'}</TableHeader>
          <TableHeader width="min">% Desc.</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {visibleLines.map((line) => (
          <TableRow key={line.id}>
            <TableCell>
              <Text>{line.label}</Text>
            </TableCell>
            <TableCell>
              <Text>{formatCurrency(line[field].original)}</Text>
            </TableCell>
            <TableCell>
              <NumberInput
                name={`${field}-new-${line.id}`}
                value={effective(line[field])}
                min={0}
                // Sem teto: o valor manual pode ultrapassar o bruto ("over") e
                // ainda assim vale como preço do item. Só o piso 0 é imposto.
                label=""
                onChange={(val) => onChangeValue(line.id, field, val)}
              />
            </TableCell>
            <TableCell>
              <Text>
                {formatPercent(
                  calcDiscountPercent(
                    line[field].original,
                    effective(line[field]),
                  ),
                )}
              </Text>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>

      <TableRow>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>Total</Text>
        </TableCell>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>
            {formatCurrency(total.original)}
          </Text>
        </TableCell>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>
            {formatCurrency(total.novo)}
          </Text>
        </TableCell>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>
            {formatPercent(calcDiscountPercent(total.original, total.novo))}
          </Text>
        </TableCell>
      </TableRow>
    </Table>
  );
};

interface RateHoursTableProps {
  config: RateHoursConfig;
  lines: ContractLine[];
  onChangeValue: (id: string, field: Field, value: number) => void;
}

const RateHoursTable = ({
  config,
  lines,
  onChangeValue,
}: RateHoursTableProps) => {
  const { title, unitField, hoursField, totalBrutoKey } = config;
  // Bruto e líquido na mesma base de horas efetiva, que é também o par que o
  // caminho de escrita vai gravar.
  const computeTotalBruto = (line: ContractLine): number =>
    rateHoursBruto(line[unitField], line[hoursField], line[totalBrutoKey]);

  const computeTotalLiquido = (line: ContractLine): number =>
    rateHoursLiquido(line[unitField], line[hoursField], line[totalBrutoKey]);

  // Visibilidade pelo que veio do CRM, nunca pelo par efetivo acima: zerar a Qtd
  // Horas leva os dois a zero e faria a linha sumir com a edição dentro.
  const visibleLines = lines.filter((line) =>
    hasRateHoursValue(line[unitField], line[totalBrutoKey]),
  );

  if (!visibleLines.length) return <EmptyCategory title={title} />;

  const totals = visibleLines.reduce(
    (acc, line) => ({
      unitOriginal: acc.unitOriginal + line[unitField].original,
      totalBruto: acc.totalBruto + computeTotalBruto(line),
      totalLiquido: acc.totalLiquido + computeTotalLiquido(line),
    }),
    { unitOriginal: 0, totalBruto: 0, totalLiquido: 0 },
  );

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeader>Sistema</TableHeader>
          <TableHeader width="min">Valor/h Padrão</TableHeader>
          <TableHeader width="min">Valor/h Novo</TableHeader>
          <TableHeader width="min">Qtd Horas</TableHeader>
          <TableHeader width="min">Total Bruto</TableHeader>
          <TableHeader width="min">Total Líquido</TableHeader>
          <TableHeader width="min">% Desc.</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {visibleLines.map((line) => {
          const totalLiquido = computeTotalLiquido(line);
          return (
            <TableRow key={line.id}>
              <TableCell>
                <Text>{line.label}</Text>
              </TableCell>
              <TableCell>
                <Text>{formatCurrency(line[unitField].original)}</Text>
              </TableCell>
              <TableCell>
                <NumberInput
                  name={`${unitField}-new-${line.id}`}
                  value={effective(line[unitField])}
                  min={0}
                  // Sem teto: o valor/h manual pode ultrapassar o original
                  // ("over") e ainda assim vale. Só o piso 0 é imposto.
                  label=""
                  onChange={(val) => onChangeValue(line.id, unitField, val)}
                />
              </TableCell>
              <TableCell>
                <NumberInput
                  name={`${hoursField}-new-${line.id}`}
                  value={effective(line[hoursField])}
                  min={0}
                  label=""
                  onChange={(val) => onChangeValue(line.id, hoursField, val)}
                />
              </TableCell>
              <TableCell>
                <Text>{formatCurrency(computeTotalBruto(line))}</Text>
              </TableCell>
              <TableCell>
                <Text>{formatCurrency(totalLiquido)}</Text>
              </TableCell>
              <TableCell>
                <Text>
                  {formatPercent(
                    calcRateHoursPercent(
                      line[unitField],
                      line[hoursField],
                      line[totalBrutoKey],
                    ),
                  )}
                </Text>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>

      <TableRow>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>Total</Text>
        </TableCell>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>—</Text>
        </TableCell>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>—</Text>
        </TableCell>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>—</Text>
        </TableCell>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>
            {formatCurrency(totals.totalBruto)}
          </Text>
        </TableCell>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>
            {formatCurrency(totals.totalLiquido)}
          </Text>
        </TableCell>
        <TableCell>
          <Text format={{ fontWeight: 'bold' }}>
            {formatPercent(
              calcDiscountPercent(totals.totalBruto, totals.totalLiquido),
            )}
          </Text>
        </TableCell>
      </TableRow>
    </Table>
  );
};

// `*Original` é sempre o bruto ORIGINAL imutável e `*New` o valor efetivo
// (digitado ou vigente), então o que as functions recebem já é o desconto
// acumulado, nunca um passo relativo ao líquido anterior.
const buildLinePayload = (line: ContractLine) => ({
  nome_do_sistema: line.nome_do_sistema,
  gltOriginal: line.glt.original,
  gltNew: effective(line.glt),
  locacaoOriginal: line.locacao.original,
  locacaoNew: effective(line.locacao),
  licencaOriginal: line.licenca.original,
  licencaNew: effective(line.licenca),
  treinamentoValorUnitarioOriginal: line.treinamentoValorUnitario.original,
  treinamentoValorUnitarioNew: effective(line.treinamentoValorUnitario),
  treinamentoHorasOriginal: line.treinamentoHoras.original,
  treinamentoHorasNew: effective(line.treinamentoHoras),
  desenvolvimentoValorUnitarioOriginal:
    line.desenvolvimentoValorUnitario.original,
  desenvolvimentoValorUnitarioNew: effective(line.desenvolvimentoValorUnitario),
  desenvolvimentoHorasOriginal: line.desenvolvimentoHoras.original,
  desenvolvimentoHorasNew: effective(line.desenvolvimentoHoras),
  consultoriaValorUnitarioOriginal: line.consultoriaValorUnitario.original,
  consultoriaValorUnitarioNew: effective(line.consultoriaValorUnitario),
  consultoriaHorasOriginal: line.consultoriaHoras.original,
  consultoriaHorasNew: effective(line.consultoriaHoras),
  // Bruto da GroupContracts, que `rateHoursBruto` devolve quando as horas não
  // foram editadas e quando não há taxa derivável (`valor/h` original zero).
  // Sem ele a aba do aprovador teria que reconstruir o bruto por
  // `valor/h × horas` e mostraria zero justo nesse caso.
  treinamentoTotalBruto: line.treinamentoTotalBruto,
  desenvolvimentoTotalBruto: line.desenvolvimentoTotalBruto,
  consultoriaTotalBruto: line.consultoriaTotalBruto,
});

// Sobrepõe um valor de rascunho sobre um FieldValue: se o `novo` do rascunho
// difere do `current` vigente, restaura-o como edição; caso contrário, deixa
// `new = null` (não editado). Isto garante que campos não editados dentro de
// um sistema que tem outras edições não apareçam como editados.
const applyDraftValue = (
  field: FieldValue,
  draftNovo: number | undefined,
): FieldValue => {
  if (draftNovo === undefined || draftNovo === field.current) {
    return { ...field, new: null };
  }
  return { ...field, new: draftNovo };
};

// Sobrepõe as edições salvas no rascunho sobre as linhas parseadas dos line
// items ao vivo. Sistemas no rascunho que não existam mais nos line items são
// ignorados (rascunho obsoleto após re-lançamento).
const overlayDraft = (
  lines: ContractLine[],
  draftEntries: DraftEntry[],
): ContractLine[] => {
  const draftMap = new Map(draftEntries.map((d) => [d.nomeDoSistema, d]));
  return lines.map((line) => {
    const d = draftMap.get(line.nome_do_sistema);
    if (!d) return line;
    const c = d.categorias;
    return {
      ...line,
      glt: applyDraftValue(line.glt, c.glt?.novo),
      locacao: applyDraftValue(line.locacao, c.locacao?.novo),
      licenca: applyDraftValue(line.licenca, c.licenca?.novo),
      treinamentoValorUnitario: applyDraftValue(
        line.treinamentoValorUnitario,
        c.treinamento?.valorUnitarioNovo,
      ),
      treinamentoHoras: applyDraftValue(
        line.treinamentoHoras,
        c.treinamento?.horasNovo,
      ),
      desenvolvimentoValorUnitario: applyDraftValue(
        line.desenvolvimentoValorUnitario,
        c.desenvolvimento?.valorUnitarioNovo,
      ),
      desenvolvimentoHoras: applyDraftValue(
        line.desenvolvimentoHoras,
        c.desenvolvimento?.horasNovo,
      ),
      consultoriaValorUnitario: applyDraftValue(
        line.consultoriaValorUnitario,
        c.consultoria?.valorUnitarioNovo,
      ),
      consultoriaHoras: applyDraftValue(
        line.consultoriaHoras,
        c.consultoria?.horasNovo,
      ),
    };
  });
};

const formatDraftDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
};

interface CrmExtensionProps {
  actions: { reloadPage: () => void };
}

const DEFAULT_THRESHOLD = 10;

interface Approver {
  ownerId: string;
  name: string;
}

// Item de linha sem "tipo de contrato" preenchido: bloqueia o avanço.
interface MissingTipoContrato {
  id: string;
  nome: string;
  sistema: string | null;
}

const CrmExtension = ({ actions }: CrmExtensionProps) => {
  const { crm } = useExtensionContext<'crm.record.tab'>();

  const [lines, setLines] = useState<ContractLine[]>([]);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [approver, setApprover] = useState<Approver | null | undefined>(
    undefined,
  );
  const [dealName, setDealName] = useState<string>('');
  const [missingTipoContrato, setMissingTipoContrato] = useState<
    MissingTipoContrato[]
  >([]);
  const [excluidos, setExcluidos] = useState(0);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dealId = String(crm.objectId);

  useEffect(() => {
    const loadData = async () => {
      try {
        const result = await hubspot.serverless('groupContracts', {
          parameters: { dealId },
        });

        if (!result.body.success) {
          logger.error(
            `[groupContracts] erro retornado pela função: ${JSON.stringify(result.body.error)}`,
          );
          setError(result.body.error ?? 'Erro desconhecido');
          return;
        }

        const parsed = lineParser(result.body.data);
        const draft = result.body.draft;
        if (draft?.entries?.length) {
          setLines(overlayDraft(parsed, draft.entries));
          setDraftSavedAt(draft.savedAt ?? null);
        } else {
          setLines(parsed);
          setDraftSavedAt(null);
        }
        if (typeof result.body.alcada === 'number') {
          setThreshold(result.body.alcada);
        }
        setApprover(result.body.approver ?? null);
        setDealName(result.body.dealName ?? dealId);
        setMissingTipoContrato(result.body.missingTipoContrato ?? []);
        setExcluidos(result.body.excluidos ?? 0);
      } catch (err) {
        logger.error(
          `[groupContracts] exceção capturada: ${JSON.stringify(err)}`,
        );
        setError(err instanceof Error ? err.message : 'Erro desconhecido');
      } finally {
        setLoading(false);
      }
    };

    loadData();
    // `dealId` é derivado de crm.objectId e é estável enquanto o card está
    // montado: declarar a dependência silencia o aviso sem refazer o fetch.
  }, [dealId]);

  const setNewValue = (id: string, field: Field, value: number) => {
    // Um input limpo chega não-finito (NaN/undefined em runtime) e volta o campo
    // a null = "não editado", restaurando o valor vigente. `min={0}` + este
    // guard impedem negativos (E1).
    const newValue: number | null = !Number.isFinite(value)
      ? null
      : Math.max(0, value);

    setLines((prev) =>
      prev.map((line) =>
        line.id === id
          ? ({
              ...line,
              [field]: { ...line[field], new: newValue },
            } as ContractLine)
          : line,
      ),
    );
  };

  const lineRequiresApproval = (line: ContractLine): boolean => {
    const pct = calcTotalDiscountPercent(line);
    return (
      (pct !== null && pct > threshold) ||
      hasAnyFieldOverThreshold(line, threshold)
    );
  };

  const hasAnyNewValue = lines.some(hasNewValue);

  // Sistema não editado continua no totalizador: ele é a visão completa da
  // negociação, não a lista de edições. Só sai quem não tem valor em coluna
  // nenhuma.
  const linesWithValue = lines.filter(hasAnyValue);

  // Bloqueia o avanço enquanto houver line item sem "tipo de contrato".
  const hasMissingTipoContrato = missingTipoContrato.length > 0;

  const hasPendingLines = lines.some(
    (line) => hasNewValue(line) && lineRequiresApproval(line),
  );
  const missingApprover = approver === null && hasPendingLines;

  const executeDiscount = async () => {
    // Guarda redundante ao `disabled` do botão: nunca avança com item pendente.
    if (hasMissingTipoContrato) return;

    const payload = lines
      .filter((line) => !lineRequiresApproval(line))
      .map(buildLinePayload);

    const pendingLines = lines.filter(
      (line) => hasNewValue(line) && lineRequiresApproval(line),
    );

    const pendingPayload = pendingLines.map((line) => ({
      ...buildLinePayload(line),
      label: line.label,
      percentualDesconto: calcTotalDiscountPercent(line),
    }));

    const resumo = pendingLines.length ? buildPendingResumo(pendingLines) : '';

    setApplying(true);
    setError(null);

    try {
      const result = await hubspot.serverless('applyDiscounts', {
        parameters: {
          dealId,
          dealName,
          discounts: payload,
          pending: pendingPayload,
          resumo,
        },
      });

      if (!result.body.success) {
        logger.error(
          `[applyDiscounts] erro retornado pela função: ${JSON.stringify(result.body.error)}`,
        );
        setError(result.body.error ?? 'Erro ao aplicar desconto');
      } else {
        actions.reloadPage();
      }
    } catch (err) {
      logger.error(
        `[applyDiscounts] exceção capturada: ${JSON.stringify(err)}`,
      );
      setError(err instanceof Error ? err.message : 'Erro ao aplicar desconto');
    } finally {
      setApplying(false);
    }
  };

  const saveDraft = async () => {
    const draftLines = lines.filter(hasNewValue);
    if (!draftLines.length) return;

    const draftPayload = draftLines.map((line) => ({
      ...buildLinePayload(line),
      label: line.label,
      percentualDesconto: calcTotalDiscountPercent(line),
    }));

    setSaving(true);
    setError(null);

    try {
      const result = await hubspot.serverless('applyDiscounts', {
        parameters: {
          dealId,
          mode: 'draft',
          pending: draftPayload,
        },
      });

      if (!result.body.success) {
        logger.error(
          `[saveDraft] erro retornado pela função: ${JSON.stringify(result.body.error)}`,
        );
        setError(result.body.error ?? 'Erro ao salvar rascunho');
      } else {
        setDraftSavedAt(result.body.savedAt ?? null);
      }
    } catch (err) {
      logger.error(`[saveDraft] exceção capturada: ${JSON.stringify(err)}`);
      setError(err instanceof Error ? err.message : 'Erro ao salvar rascunho');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Flex direction="column" align="center" justify="center">
        <LoadingSpinner label="Carregando itens de linha..." />
      </Flex>
    );
  }

  // Deal com itens de linha, todos de sistemas que pertencem a outro card:
  // dizer "não possui itens de linha" seria falso e manda o vendedor procurar
  // um problema que não existe.
  if (!lines.length && excluidos > 0) {
    return (
      <Alert title="Nada a descontar neste card" variant="info">
        <Text>
          Os itens de linha deste deal são de sistemas cujo desconto é aplicado
          em outro card (Locação de Equipamentos).
        </Text>
      </Alert>
    );
  }

  if (!lines.length) {
    return (
      <Alert title="Nenhum item encontrado" variant="info">
        <Text>Este deal não possui itens de linha associados.</Text>
      </Alert>
    );
  }

  if (!linesWithValue.length) {
    return (
      <Alert title="Nenhum valor a descontar" variant="info">
        <Text>
          Os itens de linha deste deal não têm valor preenchido em nenhuma das
          categorias de desconto.
        </Text>
      </Alert>
    );
  }

  return (
    <Flex direction="column" gap="medium">
      {error && (
        <Alert title="Erro ao aplicar desconto" variant="error">
          <Text>{error}</Text>
        </Alert>
      )}

      {draftSavedAt && (
        <Alert title="Rascunho salvo" variant="info">
          <Text>
            Existem valores de rascunho salvos em{' '}
            {formatDraftDate(draftSavedAt)}.
          </Text>
        </Alert>
      )}

      {hasMissingTipoContrato && (
        <Alert title="Tipo de contrato pendente" variant="error">
          <Text>
            Os itens de linha abaixo estão sem o campo &quot;Tipo de
            contrato&quot; preenchido. Preencha-o em todos eles (na página de
            itens de linha) antes de executar o desconto — sem esse campo os
            valores da negociação não são puxados corretamente:
          </Text>
          <Flex direction="column" gap="extra-small">
            {missingTipoContrato.map((item) => (
              <Text key={item.id}>
                • {item.nome}
                {item.sistema ? ` (Sistema: ${item.sistema})` : ''}
              </Text>
            ))}
          </Flex>
        </Alert>
      )}

      {missingApprover && (
        <Alert title="Aprovador não cadastrado" variant="warning">
          <Text>
            Nenhum usuário aprovador está cadastrado para este pipeline na
            propriedade &quot;Discount Approvers&quot;. Descontos que
            ultrapassarem a alçada não podem ser submetidos para aprovação.
          </Text>
        </Alert>
      )}

      {CATEGORIES.map((cat) => (
        <Accordion key={cat.field} title={cat.title} defaultOpen={false}>
          <CategoryTable
            config={cat}
            lines={lines}
            onChangeValue={setNewValue}
          />
        </Accordion>
      ))}

      {RATE_HOURS_CATEGORIES.map((cat) => (
        <Accordion key={cat.unitField} title={cat.title} defaultOpen={false}>
          <RateHoursTable
            config={cat}
            lines={lines}
            onChangeValue={setNewValue}
          />
        </Accordion>
      ))}

      <Accordion title="Totalizador por Sistema" defaultOpen={true}>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeader>Sistema</TableHeader>
              <TableHeader width="min">Lic. Bruto</TableHeader>
              <TableHeader width="min">Lic. Líquido</TableHeader>
              <TableHeader width="min">% Lic.</TableHeader>
              <TableHeader width="min">Serv. Bruto</TableHeader>
              <TableHeader width="min">Serv. Líquido</TableHeader>
              <TableHeader width="min">% Serv.</TableHeader>
              <TableHeader width="min">Mens. Bruto</TableHeader>
              <TableHeader width="min">Mens. Líquido</TableHeader>
              <TableHeader width="min">% Mens.</TableHeader>
              <TableHeader width="min">Proj. Bruto</TableHeader>
              <TableHeader width="min">Proj. Líquido</TableHeader>
              <TableHeader width="min">% Proj.</TableHeader>
              <TableHeader width="min">Status</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {linesWithValue.map((line) => {
              const licenca = calcLicencaTotal(line);
              const servicos = calcServicosTotal(line);
              const mensalidade = calcMensalidadeTotal(line);
              const projeto = calcProjetoTotal(line);
              const projPct = calcDiscountPercent(
                projeto.bruto,
                projeto.liquido,
              );
              const isPending =
                (projPct !== null && projPct > threshold) ||
                hasAnyFieldOverThreshold(line, threshold);

              return (
                <TableRow key={line.id}>
                  <TableCell>
                    <Text>{line.label}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(licenca.bruto)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(licenca.liquido)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>
                      {formatPercent(
                        calcDiscountPercent(licenca.bruto, licenca.liquido),
                      )}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(servicos.bruto)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(servicos.liquido)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>
                      {formatPercent(
                        calcDiscountPercent(servicos.bruto, servicos.liquido),
                      )}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(mensalidade.bruto)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>{formatCurrency(mensalidade.liquido)}</Text>
                  </TableCell>
                  <TableCell>
                    <Text>
                      {formatPercent(
                        calcDiscountPercent(
                          mensalidade.bruto,
                          mensalidade.liquido,
                        ),
                      )}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text format={{ fontWeight: 'bold' }}>
                      {formatCurrency(projeto.bruto)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text format={{ fontWeight: 'bold' }}>
                      {formatCurrency(projeto.liquido)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text format={{ fontWeight: 'bold' }}>
                      {formatPercent(projPct)}
                    </Text>
                  </TableCell>
                  <TableCell>
                    {/* Sem desconto aplicado (nenhuma edição) o sistema é
                        aprovado por padrão — só exibição, nada é persistido.
                        A ordem importa: linha editada com % nulo (ex.: só
                        horas alteradas) continua exibindo "—". */}
                    {!hasNewValue(line) ? (
                      <StatusTag variant="success">Aprovado</StatusTag>
                    ) : projPct === null ? (
                      <Text>—</Text>
                    ) : isPending ? (
                      <StatusTag variant="warning">Requer Aprovação</StatusTag>
                    ) : (
                      <StatusTag variant="success">Aprovado</StatusTag>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {(() => {
            const totalLicBruto = linesWithValue.reduce(
              (acc, l) => acc + calcLicencaTotal(l).bruto,
              0,
            );
            const totalLicLiquido = linesWithValue.reduce(
              (acc, l) => acc + calcLicencaTotal(l).liquido,
              0,
            );
            const totalServBruto = linesWithValue.reduce(
              (acc, l) => acc + calcServicosTotal(l).bruto,
              0,
            );
            const totalServLiquido = linesWithValue.reduce(
              (acc, l) => acc + calcServicosTotal(l).liquido,
              0,
            );
            const totalMensBruto = linesWithValue.reduce(
              (acc, l) => acc + calcMensalidadeTotal(l).bruto,
              0,
            );
            const totalMensLiquido = linesWithValue.reduce(
              (acc, l) => acc + calcMensalidadeTotal(l).liquido,
              0,
            );
            const totalProjBruto =
              totalLicBruto + totalServBruto + totalMensBruto;
            const totalProjLiquido =
              totalLicLiquido + totalServLiquido + totalMensLiquido;
            return (
              <TableRow>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>Total Geral</Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatCurrency(totalLicBruto)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatCurrency(totalLicLiquido)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatPercent(
                      calcDiscountPercent(totalLicBruto, totalLicLiquido),
                    )}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatCurrency(totalServBruto)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatCurrency(totalServLiquido)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatPercent(
                      calcDiscountPercent(totalServBruto, totalServLiquido),
                    )}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatCurrency(totalMensBruto)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatCurrency(totalMensLiquido)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatPercent(
                      calcDiscountPercent(totalMensBruto, totalMensLiquido),
                    )}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatCurrency(totalProjBruto)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatCurrency(totalProjLiquido)}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>
                    {formatPercent(
                      calcDiscountPercent(totalProjBruto, totalProjLiquido),
                    )}
                  </Text>
                </TableCell>
                <TableCell>
                  <Text format={{ fontWeight: 'bold' }}>—</Text>
                </TableCell>
              </TableRow>
            );
          })()}
        </Table>
      </Accordion>

      <Flex direction="row" justify="end" gap="small">
        <Button
          onClick={saveDraft}
          variant="secondary"
          disabled={saving || applying || !hasAnyNewValue}
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
        <Button
          onClick={executeDiscount}
          variant="primary"
          disabled={
            applying ||
            saving ||
            !hasAnyNewValue ||
            missingApprover ||
            hasMissingTipoContrato
          }
        >
          Executar Desconto
        </Button>
      </Flex>
    </Flex>
  );
};
