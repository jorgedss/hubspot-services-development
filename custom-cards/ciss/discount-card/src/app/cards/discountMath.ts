// Matemática pura do card de desconto.
//
// Não importe React nem `@hubspot/ui-extensions` aqui: é por não ter essas
// dependências que `automation/verificacao/verificar-valores.js` consegue rodar
// este módulo direto no node, sem bundler nem portal.

// `original` é o bruto ORIGINAL imutável (vem do snapshot `*_original` no CRM)
// e nunca é reatribuído com um líquido; `current` é o líquido vigente, que
// pré-preenche o input; `new` é o que o vendedor digitou (null = não editado,
// distinguindo-o de "0 intencional"). O valor efetivo é sempre `new ?? current`.
export interface FieldValue {
  original: number;
  current: number;
  new: number | null;
}

export interface ContractLine {
  id: string;
  nome_do_sistema: string;
  label: string;
  glt: FieldValue;
  locacao: FieldValue;
  licenca: FieldValue;
  treinamentoValorUnitario: FieldValue;
  treinamentoHoras: FieldValue;
  treinamentoTotalBruto: number;
  tipoContrato: string | null;
  desenvolvimentoValorUnitario: FieldValue;
  desenvolvimentoHoras: FieldValue;
  desenvolvimentoTotalBruto: number;
  consultoriaValorUnitario: FieldValue;
  consultoriaHoras: FieldValue;
  consultoriaTotalBruto: number;
}

// Campos "flat" (valor único) - sempre `FieldValue` (new: number).
export type FlatField = 'glt' | 'locacao' | 'licenca';

// Valor efetivo de um campo: o digitado quando houver, senão o vigente.
export const effective = (field: FieldValue): number =>
  field.new ?? field.current;

// Um campo conta como editado quando foi tocado (não é null) e difere do valor
// vigente. `novo === vigente` é no-op - reabrir o card com um desconto já
// aplicado não conta como edição nova.
export const isEdited = (field: FieldValue): boolean =>
  field.new !== null && field.new !== field.current;

// Os três predicados abaixo decidem quais sistemas aparecem em cada tabela.
//
// Eles olham SÓ o que veio da GroupContracts (`original`, `current`,
// `totalBruto`), nunca o valor efetivo nem `rateHoursBruto`. Trocar por um
// predicado sobre o efetivo faz a linha sumir no instante em que a Qtd Horas é
// zerada, levando a edição para fora da tela sem tirá-la do state. Ver CLAUDE.md,
// "A system only shows up in the category where it has a value".
export const hasFlatValue = (line: ContractLine, field: FlatField): boolean =>
  line[field].original > 0 || line[field].current > 0;

// Não recebe `hours` de propósito: hora sem valor não é categoria com valor, e
// a GroupContracts já condiciona o acúmulo das horas ao valor vigente ser
// positivo, então `horas` é zero sempre que o valor é zero.
export const hasRateHoursValue = (
  unit: FieldValue,
  totalBruto: number,
): boolean => totalBruto > 0 || unit.original > 0 || unit.current > 0;

// Um sistema entra no "Totalizador por Sistema" quando tem valor em qualquer
// categoria. `locacao` conta apesar de não ter acordeão nenhum: ela compõe a
// dimensão Mensalidade (`calcMensalidadeTotal`) e entra em `THRESHOLD_FIELDS`,
// então um sistema com só valor de locação tem linha no totalizador.
export const hasAnyValue = (line: ContractLine): boolean =>
  hasFlatValue(line, 'glt') ||
  hasFlatValue(line, 'locacao') ||
  hasFlatValue(line, 'licenca') ||
  hasRateHoursValue(
    line.treinamentoValorUnitario,
    line.treinamentoTotalBruto,
  ) ||
  hasRateHoursValue(
    line.desenvolvimentoValorUnitario,
    line.desenvolvimentoTotalBruto,
  ) ||
  hasRateHoursValue(line.consultoriaValorUnitario, line.consultoriaTotalBruto);

export const calcDiscountPercent = (
  original: number,
  newValue: number,
): number | null => {
  if (original <= 0 || newValue <= 0 || newValue >= original) return null;
  return ((original - newValue) / original) * 100;
};

// Alias nomeado de `effective`, à parte porque a semântica é outra: mudar horas
// nunca é desconto, mas muda o ESCOPO da categoria.
export const effectiveHours = (hours: FieldValue): number =>
  hours.new ?? hours.current;

// Bruto de uma categoria hora x valor, na base de horas EFETIVA.
//
// Sem edição de horas devolve o `totalBruto` da GroupContracts sem recalcular,
// para não introduzir ruído de ponto flutuante em fluxo que hoje funciona. Com
// edição rebaseia para "valor/h original x horas novas", que é o mesmo snapshot
// que os dois caminhos de escrita gravam quando `hoursEdited`.
//
// `unit.original === 0` é categoria com valor no CRM e zero horas: sem taxa
// derivável não há desconto possível, então o bruto fica no `totalBruto` e o
// líquido o acompanha, dando percentual nulo em vez de um falso 100%.
export const rateHoursBruto = (
  unit: FieldValue,
  hours: FieldValue,
  totalBruto: number,
): number =>
  unit.original === 0
    ? totalBruto
    : isEdited(hours)
      ? unit.original * effectiveHours(hours)
      : totalBruto;

// Líquido na MESMA base de horas do bruto acima: é o que preserva "quantidade de
// horas nunca é desconto", porque o H comum se cancela na razão.
export const rateHoursLiquido = (
  unit: FieldValue,
  hours: FieldValue,
  totalBruto: number,
): number =>
  unit.original === 0 ? totalBruto : effective(unit) * effectiveHours(hours);

// Os dois retornos nulos saem das guardas de `calcDiscountPercent`: edição só de
// horas dá `bruto === liquido`, e "over" dá `liquido > bruto`.
export const calcRateHoursPercent = (
  unit: FieldValue,
  hours: FieldValue,
  totalBruto: number,
): number | null =>
  calcDiscountPercent(
    rateHoursBruto(unit, hours, totalBruto),
    rateHoursLiquido(unit, hours, totalBruto),
  );

export const calcTotalDiscountPercent = (line: ContractLine): number | null => {
  const originalTotal =
    line.glt.original +
    line.locacao.original +
    line.licenca.original +
    rateHoursBruto(
      line.treinamentoValorUnitario,
      line.treinamentoHoras,
      line.treinamentoTotalBruto,
    ) +
    rateHoursBruto(
      line.desenvolvimentoValorUnitario,
      line.desenvolvimentoHoras,
      line.desenvolvimentoTotalBruto,
    ) +
    rateHoursBruto(
      line.consultoriaValorUnitario,
      line.consultoriaHoras,
      line.consultoriaTotalBruto,
    );

  const newTotal =
    effective(line.glt) +
    effective(line.locacao) +
    effective(line.licenca) +
    rateHoursLiquido(
      line.treinamentoValorUnitario,
      line.treinamentoHoras,
      line.treinamentoTotalBruto,
    ) +
    rateHoursLiquido(
      line.desenvolvimentoValorUnitario,
      line.desenvolvimentoHoras,
      line.desenvolvimentoTotalBruto,
    ) +
    rateHoursLiquido(
      line.consultoriaValorUnitario,
      line.consultoriaHoras,
      line.consultoriaTotalBruto,
    );

  return calcDiscountPercent(originalTotal, newTotal);
};

const THRESHOLD_FIELDS: FlatField[] = ['glt', 'locacao', 'licenca'];

export const hasAnyFieldOverThreshold = (
  line: ContractLine,
  threshold: number,
): boolean => {
  const fieldOver = THRESHOLD_FIELDS.some((f) => {
    const pct = calcDiscountPercent(line[f].original, effective(line[f]));
    return pct !== null && pct > threshold;
  });
  if (fieldOver) return true;

  const treinPct = calcRateHoursPercent(
    line.treinamentoValorUnitario,
    line.treinamentoHoras,
    line.treinamentoTotalBruto,
  );
  if (treinPct !== null && treinPct > threshold) return true;

  const devPct = calcRateHoursPercent(
    line.desenvolvimentoValorUnitario,
    line.desenvolvimentoHoras,
    line.desenvolvimentoTotalBruto,
  );
  if (devPct !== null && devPct > threshold) return true;

  const conPct = calcRateHoursPercent(
    line.consultoriaValorUnitario,
    line.consultoriaHoras,
    line.consultoriaTotalBruto,
  );
  if (conPct !== null && conPct > threshold) return true;

  return false;
};

// Licença é dimensão própria do totalizador, não entra em "Serviços": somá-la
// ali diluiria o % de serviços com um valor que não é serviço prestado.
export const calcLicencaTotal = (line: ContractLine) => ({
  bruto: line.licenca.original,
  liquido: effective(line.licenca),
});

export const calcServicosTotal = (line: ContractLine) => {
  const bruto =
    rateHoursBruto(
      line.treinamentoValorUnitario,
      line.treinamentoHoras,
      line.treinamentoTotalBruto,
    ) +
    rateHoursBruto(
      line.desenvolvimentoValorUnitario,
      line.desenvolvimentoHoras,
      line.desenvolvimentoTotalBruto,
    ) +
    rateHoursBruto(
      line.consultoriaValorUnitario,
      line.consultoriaHoras,
      line.consultoriaTotalBruto,
    );

  const liquido =
    rateHoursLiquido(
      line.treinamentoValorUnitario,
      line.treinamentoHoras,
      line.treinamentoTotalBruto,
    ) +
    rateHoursLiquido(
      line.desenvolvimentoValorUnitario,
      line.desenvolvimentoHoras,
      line.desenvolvimentoTotalBruto,
    ) +
    rateHoursLiquido(
      line.consultoriaValorUnitario,
      line.consultoriaHoras,
      line.consultoriaTotalBruto,
    );

  return { bruto, liquido };
};

export const calcMensalidadeTotal = (line: ContractLine) => {
  const bruto = line.glt.original + line.locacao.original;
  const liquido = effective(line.glt) + effective(line.locacao);
  return { bruto, liquido };
};

// Projeto é o total do sistema. O conjunto de parcelas não depende de como as
// três dimensões acima são agrupadas, então "% Proj." e o roteamento de
// aprovação também não.
export const calcProjetoTotal = (line: ContractLine) => {
  const licenca = calcLicencaTotal(line);
  const servicos = calcServicosTotal(line);
  const mensalidade = calcMensalidadeTotal(line);
  return {
    bruto: licenca.bruto + servicos.bruto + mensalidade.bruto,
    liquido: licenca.liquido + servicos.liquido + mensalidade.liquido,
  };
};

// Config das três categorias hora x valor. Mora aqui, e não no card, porque o
// texto de `resumo_descontos_aplicados` usa os MESMOS rótulos das abas: um
// título que divirja faz o aprovador procurar no card uma categoria que só
// existe no resumo.
export type RateHoursUnitField =
  | 'desenvolvimentoValorUnitario'
  | 'consultoriaValorUnitario'
  | 'treinamentoValorUnitario';
export type RateHoursHoursField =
  | 'desenvolvimentoHoras'
  | 'consultoriaHoras'
  | 'treinamentoHoras';
export type RateHoursTotalBrutoKey =
  | 'desenvolvimentoTotalBruto'
  | 'consultoriaTotalBruto'
  | 'treinamentoTotalBruto';

export interface RateHoursConfig {
  title: string;
  unitField: RateHoursUnitField;
  hoursField: RateHoursHoursField;
  totalBrutoKey: RateHoursTotalBrutoKey;
}

export const RATE_HOURS_CATEGORIES: RateHoursConfig[] = [
  {
    title: 'Horas Técnicas/Treinamentos',
    unitField: 'treinamentoValorUnitario',
    hoursField: 'treinamentoHoras',
    totalBrutoKey: 'treinamentoTotalBruto',
  },
  {
    title: 'Desenvolvimento / DBA',
    unitField: 'desenvolvimentoValorUnitario',
    hoursField: 'desenvolvimentoHoras',
    totalBrutoKey: 'desenvolvimentoTotalBruto',
  },
  {
    title: 'Consultoria Contábil/Fiscal',
    unitField: 'consultoriaValorUnitario',
    hoursField: 'consultoriaHoras',
    totalBrutoKey: 'consultoriaTotalBruto',
  },
];
