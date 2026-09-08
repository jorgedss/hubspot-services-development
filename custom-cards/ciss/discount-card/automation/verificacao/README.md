# Verificação offline dos valores do desconto

```
node automation/verificacao/verificar-valores.js
```

Sem dependências de npm.
Precisa de node >= 22.18 (ou >= 23), porque importa `src/app/cards/discountMath.ts` direto, sem bundler.

## O que ele trava

> Para cada sistema e cada categoria, a soma de `valor_*_calculado` dos line items depois do apply é exatamente o líquido que o vendedor digitou no card, em centavos, nas duas rotas de escrita e em qualquer número de ciclos.

Roda o código real de produção na ordem em que o usuário final o exercita, nas duas rotas: `GroupContracts.main` → `discountMath.ts` → `ApplyDiscounts.main` → `customCode.main` → `GroupContracts.main`.

## Por que existe

O CRM falso do `../desconto-decisao/verificar.js` não modela propriedade calculada, e é uma lacuna que ele declara no próprio cabeçalho.
Era exatamente ali que o bug de centavos morava: o desconto era gravado como razão sobre o valor base de cada item, arredondado a 2 decimais, e o CRM recompunha `valor_*_calculado = base × quantity`, multiplicando o erro de meio centavo de cada item pela `quantity` dele.
R$ 1.400,00 digitado voltava R$ 1.399,99 no totalizador; R$ 13.500,00 voltava R$ 13.500,03.
Reportado por operações em agosto de 2026.
O CRM falso daqui resolve as calculadas, então o desvio aparece em vez de passar.

Rode depois de qualquer alteração em `ApplyDiscounts.js`, em `customCode.js` ou na matemática do card, e antes de colar o `customCode.js` na ação do workflow.

## Os dois casos que merecem atenção

**Concordância entre as rotas.**
A matemática de escrita é duplicada entre `ApplyDiscounts.js` e `customCode.js`, porque a ação de custom code do workflow não consegue importar arquivo do app.
O caso "As duas rotas gravam exatamente as mesmas propriedades" compara as duas saídas item por item.
É o guarda contra as cópias divergirem em silêncio: um deal abaixo da alçada passa por uma, um deal aprovado passa pela outra.

**Canário da precisão.**
`DECIMAIS_VALOR = 6` nas duas cópias não é enfeite.
Baixar para 2 faz a seção "Canário: por que a base precisa de mais de 2 decimais" falhar com os desvios exatos que operações reportou.
Se algum dia as props de valor do portal passarem a recusar 6 casas, a alocação precisa virar restrita, com o alvo de cada item em centavos sendo múltiplo da `quantity` dele, e aí o alvo digitado só é alcançável quando `mdc(quantity_i)` divide os centavos do total.

## O snapshot hora×valor é decidido pelo schema, não pela resposta

O snapshot das categorias hora×valor (`valor_treinamento_original`, `valor_horas_desenvolvimento_original`, `valor_horas_consultoria_original`) é o único lugar onde mora o "Valor h/ Padrão".
Sem ele gravado, `resolveBrutoOriginal` em `GroupContracts.js` cai no valor vigente, o "Total Bruto" do ciclo seguinte fica igual ao líquido e não sobra percentual nenhum para exibir.

Até agosto de 2026 a gravação era decidida por `rf.snapshotProp in item.properties`, que testa presença de **valor**, não de schema.
A v3 tanto devolve a prop pedida sem valor como `null` quanto a omite da resposta, e na forma que omite o snapshot nunca era criado.
Agora a decisão é `propsGravaveis.has(rf.snapshotProp)`, com `propsGravaveis` vindo de `GET /crm/v3/properties/line_items`, uma chamada por execução em cada rota de escrita.

O que cada caso da seção "Consultoria" trava:

- portal normal: bruto preservado depois do apply, snapshot gravado em escala base;
- `omitirVazias: true`: mesmo resultado, que é a correção em si;
- `semSchema: ["valor_horas_consultoria_original"]`: o bruto colapsa e **nada** no código evita isso, mas o `batch/update` não pode ir abaixo com uma prop desconhecida.
  Forçar a gravação faz o portal falso devolver 400 e o líquido nem chega a ser aplicado, que é o motivo de o gate existir.

Uma prop de snapshot ausente do schema vira `console.warn` com o nome dela nas duas rotas (`avisarSnapshotsAusentes`).
É tarefa de portal, não de código: criar a propriedade em line_items.
