// Texto de `resumo_descontos_aplicados` para os sistemas que requerem
// aprovação.
//
// Mora fora do `.tsx` de propósito, sem React e sem `@hubspot/ui-extensions`:
// é o que deixa `automation/verificacao/verificar-valores.js` importar este
// módulo direto no node e travar o texto gravado, do mesmo jeito que já faz com
// `discountMath.ts`.
//
// O texto espelha a TABELA DE DESCONTOS PENDENTES do aprovador
// (`DiscountApproval.tsx`), não o "Totalizador por Sistema": o resumo é lido
// por quem decide, e quem decide precisa das horas e do detalhe por categoria
// de serviço. As quatro dimensões (Licença, Mensalidade, Serviços, Projeto)
// continuam sendo a agregação, com o detalhe abaixo de cada uma.
//
// Todo valor sai de `discountMath.ts`, nunca de um cálculo local: bruto e
// líquido têm que ser o mesmo par que o caminho de escrita grava, senão o
// resumo descreve um estado que o CRM nunca teve.
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
  effectiveHours,
  hasFlatValue,
  hasRateHoursValue,
  rateHoursBruto,
  rateHoursLiquido,
} from './discountMath.ts';
import type { ContractLine, FieldValue } from './discountMath.ts';

// Formata moeda no padrão brasileiro com separador de milhar (R$ 10.000,00).
export const formatResumoCurrency = (value: number): string => {
  const [intPart, decPart] = value.toFixed(2).split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${withThousands},${decPart}`;
};

const formatResumoPercent = (value: number | null): string =>
  value === null ? '—' : `${value.toFixed(2).replace('.', ',')}%`;

// Horas podem vir fracionadas do CRM. Inteiro sai sem casas decimais para não
// poluir a linha com ",00" em toda hora cheia.
const formatHorasValor = (value: number): string =>
  Number.isInteger(value)
    ? `${value}h`
    : `${value.toFixed(2).replace('.', ',')}h`;

// Mudar a quantidade de horas nunca é desconto, é mudança de escopo: as duas
// pontas aparecem sem percentual nenhum entre elas.
const formatHoras = (hours: FieldValue): string => {
  const efetivas = effectiveHours(hours);
  return efetivas === hours.original
    ? formatHorasValor(efetivas)
    : `${formatHorasValor(hours.original)} → ${formatHorasValor(efetivas)}`;
};

const formatValores = (bruto: number, liquido: number): string =>
  `${formatResumoCurrency(bruto)} → ${formatResumoCurrency(liquido)} (${formatResumoPercent(
    calcDiscountPercent(bruto, liquido),
  )})`;

// Três níveis de indentação, cada um com a sua largura de rótulo. A largura é
// por nível porque os rótulos são de tamanhos muito diferentes: uma largura só
// alinharia um nível e desalinharia os outros dois.
const NIVEL = {
  dimensao: { indent: 2, largura: 13 },
  detalhe: { indent: 4, largura: 19 },
  subdetalhe: { indent: 6, largura: 11 },
} as const;

type Nivel = keyof typeof NIVEL;

// `padEnd` não corta o excesso, então um rótulo maior que a largura fica sem
// separador nenhum. O espaço explícito cobre esse caso.
const linha = (nivel: Nivel, rotulo: string, valor: string): string => {
  const { indent, largura } = NIVEL[nivel];
  const label = `${rotulo}:`;
  const preenchido =
    label.length >= largura ? `${label} ` : label.padEnd(largura);
  return `${' '.repeat(indent)}${preenchido}${valor}`;
};

const linhaValores = (
  nivel: Nivel,
  rotulo: string,
  bruto: number,
  liquido: number,
): string => linha(nivel, rotulo, formatValores(bruto, liquido));

// Uma dimensão sem valor nenhum não vira linha: é a mesma regra das tabelas do
// card, onde um sistema só aparece na categoria em que tem valor. Sem ela todo
// sistema carregaria "Licença: R$ 0,00 → R$ 0,00 (—)".
const linhaDimensao = (
  rotulo: string,
  totais: { bruto: number; liquido: number },
): string[] =>
  totais.bruto === 0 && totais.liquido === 0
    ? []
    : [linhaValores('dimensao', rotulo, totais.bruto, totais.liquido)];

// Mensalidade é a soma de `glt` e `locacao` (`calcMensalidadeTotal`), que a
// tabela de pendentes mostra em colunas separadas. O detalhe só vem quando as
// duas têm valor: com uma só, a sub-linha repetiria a linha de cima.
const detalheMensalidade = (line: ContractLine): string[] => {
  const temGlt = hasFlatValue(line, 'glt');
  const temLocacao = hasFlatValue(line, 'locacao');
  if (!temGlt || !temLocacao) return [];
  return [
    linhaValores(
      'detalhe',
      'Mensalidade (GLT)',
      line.glt.original,
      effective(line.glt),
    ),
    linhaValores(
      'detalhe',
      'Locação',
      line.locacao.original,
      effective(line.locacao),
    ),
  ];
};

// O detalhe de serviços é o motivo deste arquivo existir: "Serviços" agrega
// treinamento, desenvolvimento/DBA e consultoria, e um desconto de 60% em uma
// delas some dentro de um agregado a 16%.
const detalheServicos = (line: ContractLine): string[] =>
  RATE_HOURS_CATEGORIES.flatMap(
    ({ title, unitField, hoursField, totalBrutoKey }) => {
      const unit = line[unitField];
      const hours = line[hoursField];
      const totalBrutoCrm = line[totalBrutoKey];
      if (!hasRateHoursValue(unit, totalBrutoCrm)) return [];

      const bruto = rateHoursBruto(unit, hours, totalBrutoCrm);
      const liquido = rateHoursLiquido(unit, hours, totalBrutoCrm);

      // `unit.original === 0` é categoria com valor no CRM e nenhuma taxa
      // derivável (ver `rateHoursBruto`). Imprimir "R$ 0,00/h → R$ 0,00/h"
      // ali seria inventar uma taxa que não existe.
      const linhaValorHora =
        unit.original === 0
          ? []
          : [
              linha(
                'subdetalhe',
                'Valor/h',
                `${formatResumoCurrency(unit.original)} → ${formatResumoCurrency(
                  effective(unit),
                )} (${formatResumoPercent(
                  calcDiscountPercent(unit.original, effective(unit)),
                )})`,
              ),
            ];

      return [
        linha('detalhe', title, formatHoras(hours)),
        ...linhaValorHora,
        linha(
          'subdetalhe',
          'Total',
          `${formatResumoCurrency(bruto)} → ${formatResumoCurrency(
            liquido,
          )} (${formatResumoPercent(
            calcRateHoursPercent(unit, hours, totalBrutoCrm),
          )})`,
        ),
      ];
    },
  );

const blocoSistema = (line: ContractLine): string => {
  const licenca = calcLicencaTotal(line);
  const servicos = calcServicosTotal(line);
  const mensalidade = calcMensalidadeTotal(line);
  const projeto = calcProjetoTotal(line);

  return [
    line.label,
    // O mesmo número que vai para `pending_discounts.percentualDesconto`, para
    // o histórico e para a coluna "% Total" do aprovador: é ele que decide a
    // alçada, e faltava no resumo.
    linha(
      'dimensao',
      '% Total',
      formatResumoPercent(calcTotalDiscountPercent(line)),
    ),
    ...linhaDimensao('Licença', licenca),
    ...linhaDimensao('Mensalidade', mensalidade),
    ...detalheMensalidade(line),
    ...linhaDimensao('Serviços', servicos),
    ...detalheServicos(line),
    // Projeto é o total do sistema e sai sempre, mesmo zerado: é a linha que o
    // aprovador procura primeiro.
    linhaValores('dimensao', 'Projeto', projeto.bruto, projeto.liquido),
    '  Status: Requer Aprovação',
  ].join('\n');
};

// Horas do TOTAL GERAL somam a base EFETIVA de cada sistema, a mesma que
// compõe o bruto e o líquido acima.
const blocoTotalGeral = (pendingLines: ContractLine[]): string => {
  const somar = (
    fn: (line: ContractLine) => { bruto: number; liquido: number },
  ) =>
    pendingLines.reduce(
      (acc, line) => {
        const { bruto, liquido } = fn(line);
        return { bruto: acc.bruto + bruto, liquido: acc.liquido + liquido };
      },
      { bruto: 0, liquido: 0 },
    );

  const licenca = somar(calcLicencaTotal);
  const servicos = somar(calcServicosTotal);
  const mensalidade = somar(calcMensalidadeTotal);
  const projeto = {
    bruto: licenca.bruto + servicos.bruto + mensalidade.bruto,
    liquido: licenca.liquido + servicos.liquido + mensalidade.liquido,
  };

  const detalhe = RATE_HOURS_CATEGORIES.flatMap(
    ({ title, unitField, hoursField, totalBrutoKey }) => {
      const linhasComValor = pendingLines.filter((line) =>
        hasRateHoursValue(line[unitField], line[totalBrutoKey]),
      );
      if (!linhasComValor.length) return [];

      const horas = linhasComValor.reduce(
        (acc, line) => acc + effectiveHours(line[hoursField]),
        0,
      );
      const bruto = linhasComValor.reduce(
        (acc, line) =>
          acc +
          rateHoursBruto(
            line[unitField],
            line[hoursField],
            line[totalBrutoKey],
          ),
        0,
      );
      const liquido = linhasComValor.reduce(
        (acc, line) =>
          acc +
          rateHoursLiquido(
            line[unitField],
            line[hoursField],
            line[totalBrutoKey],
          ),
        0,
      );

      return [
        linha('detalhe', title, formatHorasValor(horas)),
        linha('subdetalhe', 'Total', formatValores(bruto, liquido)),
      ];
    },
  );

  return [
    'TOTAL GERAL',
    ...linhaDimensao('Licença', licenca),
    ...linhaDimensao('Mensalidade', mensalidade),
    ...linhaDimensao('Serviços', servicos),
    ...detalhe,
    linhaValores('dimensao', 'Projeto', projeto.bruto, projeto.liquido),
  ].join('\n');
};

export const buildPendingResumo = (pendingLines: ContractLine[]): string =>
  [...pendingLines.map(blocoSistema), blocoTotalGeral(pendingLines)].join(
    '\n\n',
  );
