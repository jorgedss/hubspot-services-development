import React, { useEffect, useState } from "react";
import {
  Card,
  Flex,
  Text,
  Select,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  Button,
  Divider,
  Heading,
  Alert,
} from "@hubspot/ui-extensions";
import { hubspot } from "@hubspot/ui-extensions";
import { useCrmProperties, useAssociations } from "@hubspot/ui-extensions/crm";
import {
  createCategoryLabelMap,
  getCategoryLabel,
} from "../categoryOptions";

hubspot.extend(({ context, runServerlessFunction, actions }) => (
  <Extension
    context={context}
    runServerless={runServerlessFunction}
    sendAlert={actions.addAlert}
    actions={actions}
  />
));

const Extension = ({ context, runServerless, sendAlert, actions }) => {
  const { properties } = useCrmProperties([
    "dealname",
    "categoriacondicao",
    "desconto_aprovado",
    "categorias_aprovadas",
    "nivel_de_interesse",
    "modalidade_de_interesse",
    "curso_nome",
    "turma",
    "hubspot_owner_id",
  ]);

  const [portalId] = useState(context.portal.id);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [categoryLabels, setCategoryLabels] = useState({});
  const [classObjectId, setClassObjectId] = useState("2-42181871"); // Default to production

  useEffect(() => {
    if (portalId === 51406295) {
      setClassObjectId("2-61647973"); // Sandbox
      setQuoteTemplateId("567931027464"); // Sandbox
    } else {
      setClassObjectId("2-42181871"); // Production
      setQuoteTemplateId("506883707058"); // Production
    }
  }, [portalId]);

  const { results: associationResults } = useAssociations(
    {
      toObjectType: classObjectId,
      properties: [
        "id_da_turma",
        "id_do_curso",
        "nome_da_turma",
        "nivel_de_interesse",
        "modalidade_da_turma",
        "nome_do_curso",
        "data_de_inauguracao",
      ],
      pageLength: 1,
    },
    {
      propertiesToFormat: "all",
    },
  );

  const [selectedCategory, setSelectedCategory] = useState("");

  useEffect(() => {
    runServerless({ name: "fetchDealPropertyOptions", parameters: {} })
      .then(({ response }) => {
        if (response?.status !== "SUCCESS") return;
        const options = normalizePropertyOptions(response.options);
        setCategoryOptions(options);
        setCategoryLabels(createCategoryLabelMap(options));
      })
      .catch((error) => console.error("Erro ao carregar labels das categorias:", error));
  }, [runServerless]);
  const [graduationPlanData, setGraduationPlanData] = useState(null);
  const [fetchedDiscount, setFetchedDiscount] = useState(null);
  const [selectedDiscount, setSelectedDiscount] = useState(null);
  const [selectedCondition, setSelectedCondition] = useState(null);
  const [entryMethod, setEntryMethod] = useState();
  const [fetchDuration, setFetchDuration] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [manualTurmaData, setManualTurmaData] = useState(null);
  const [quoteTemplateId, setQuoteTemplateId] = useState("<PRODUCTION_TEMPLATE_ID>");

  const turmaAtual = manualTurmaData || associationResults[0];

  const formatOriginError = (origin, message) => {
    const labels = {
      HUBSPOT: "HubSpot",
      MULESOFT: "MuleSoft",
      VIACEP: "ViaCEP",
      CHECKOUT_IPOG: "Checkout IPOG",
      SISTEMA: "Sistema",
    };
    const label = labels[origin] || "Sistema";
    return `[${label}] ${message || "Erro desconhecido."}`;
  };

  const handleRefreshAssociations = async () => {
    setIsRefreshing(true);
    try {
      const { response } = await runServerless({
        name: "fetchAssociatedTurma",
        parameters: {
          dealId: context.crm.objectId,
          classObjectId: classObjectId,
        },
      });

      if (response.status === "SUCCESS") {
        setManualTurmaData(response.response);
        sendAlert({
          type: "success",
          message: "Dados da turma atualizados!",
        });
      } else {
        setManualTurmaData({});
        sendAlert({
          type: "warning",
          message: formatOriginError(response.origin, response.message || "Nenhuma turma associada."),
        });
      }
    } catch (error) {
      console.error("Erro ao atualizar turma:", error);
      sendAlert({
        type: "danger",
        message: formatOriginError("SISTEMA", "Erro ao atualizar turma. Tente novamente."),
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (properties.categoriacondicao) {
      setSelectedCategory(properties.categoriacondicao);
    }
  }, [properties.categoriacondicao]);

  const handleSimulate = async () => {
    const startTime = performance.now();
    setIsLoading(true);
    setFetchDuration(null);
    setGraduationPlanData(null);
    setFetchedDiscount(null);
    setSelectedDiscount(null);
    setSelectedCondition(null);

    if (selectedCategory === "graduacao" && !entryMethod) {
      sendAlert({
        type: "warning",
        message:
          "Por favor, selecione a forma de ingresso para continuar a simulação.",
      });
      setIsLoading(false);
      return;
    }

    try {
      const promises = [
        runServerless({
          name: "fetchFinancialPlanGraduation",
          parameters: {
            idTurma: turmaAtual?.properties?.id_da_turma,
          },
        }),
      ];

      if (selectedCategory) {
        promises.push(
          runServerless({
            name: "fetchDiscount",
            parameters: {
              categoriadesconto: selectedCategory,
            },
          }),
        );
      }

      const responses = await Promise.all(promises);
      const graduationPlanResponse = responses[0];
      const discountResponse = selectedCategory ? responses[1] : null;

      const planResult = graduationPlanResponse.response;
      if (planResult?.status === "ERROR") {
        throw new Error(formatOriginError(planResult.origin, planResult.message));
      }

      setGraduationPlanData(planResult?.response);

      const discountResult = discountResponse?.response;
      if (discountResult?.status === "ERROR") {
        sendAlert({
          type: "warning",
          message: formatOriginError(discountResult.origin, discountResult.message),
        });
      }
      const discounts = discountResult?.status === "SUCCESS" ? discountResult.response : null;
      setFetchedDiscount(discounts);

      if (Array.isArray(discounts) && discounts.length === 1) {
        setSelectedDiscount(discounts[0]);
      } else if (Array.isArray(discounts) && discounts.length > 1) {
        setSelectedDiscount(null);
      }

      const endTime = performance.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      setFetchDuration(duration);
    } catch (error) {
      console.error("Error simulating:", error);
      sendAlert({
        type: "danger",
        message: `Erro na simulação: ${error.message}`,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const parseBRLToNumber = (value) => {
    if (typeof value === "number") return value;
    if (!value) return 0;

    const normalized = String(value).replace(/\./g, "").replace(/,/g, ".");
    return parseFloat(normalized) || 0;
  };

  const getDiscountData = (condition) => {
    const discountItem = selectedDiscount;

    const discountAmount =
      discountItem && discountItem.percdescontoparcela
        ? parseBRLToNumber(discountItem.percdescontoparcela)
        : 0;
    const discountName = discountItem ? discountItem.nomeplanodesconto : "";
    const discountType = discountItem ? discountItem.tipodescontoparcela : "PO";

    const valorTotal = parseBRLToNumber(condition.valorTotalPeriodo);
    const nrParcelas = condition.nrParcelasPeriodo || 1;
    const valorParcela = valorTotal / nrParcelas;
    const valorMatricula = parseBRLToNumber(
      condition.valorMatriculaSistemaPorCredito,
    );

    // Mesmo critério para parcela e matrícula: VA subtrai o valor em reais,
    // PO aplica o percentual sobre a base.
    const applyDiscount = (base) => {
      if (!discountItem) return 0;
      if (discountType === "VA") return Math.min(discountAmount, base);
      return base * (discountAmount / 100);
    };

    const discountValue = applyDiscount(valorParcela);
    const discountMatriculaValue = applyDiscount(valorMatricula);

    return {
      discountAmount,
      discountType,
      discountName,
      discountValue,
      discountMatriculaValue,
      valorParcela,
      valorParcelaFinal: valorParcela - discountValue,
      valorMatricula,
      valorMatriculaFinal: valorMatricula - discountMatriculaValue,
      // A matrícula passa a ser a primeira parcela, então as subsequentes caem
      // de N para N-1. Plano de 1x não reduz.
      nrParcelasCobranca: nrParcelas > 1 ? nrParcelas - 1 : nrParcelas,
    };
  };

  const handleSelectCondition = (condition) => {
    setSelectedCondition(condition);
  };

  const getExpirationDate = () => {
    const date = new Date();
    date.setDate(date.getDate() + 90);
    return date.toISOString().split("T")[0];
  };

  const handleConfirm = async () => {
    if (!selectedCondition) return;

    setIsSaving(true);

    try {
      const {
        discountAmount,
        discountType,
        discountName,
        discountValue,
        discountMatriculaValue,
        valorParcela,
        valorMatricula,
        nrParcelasCobranca,
      } = getDiscountData(selectedCondition);

      const { disciplinas, ...cleanedCondition } = selectedCondition;
      const { condicoesPagamento, ...graduationPlanWithoutConditions } = graduationPlanData;

      const response = await runServerless({
        name: "updateGraduationDeal",
        parameters: {
          dealId: context.crm.objectId,
          graduationPlan: graduationPlanWithoutConditions,
          selectedCondition: cleanedCondition,
          selectedCategory: selectedCategory,
          discountAmount: discountAmount,
          discountType: discountType,
          discountValue: discountValue,
          discountMatriculaValue: discountMatriculaValue,
          valorParcela: valorParcela,
          valorMatricula: valorMatricula,
          nrParcelasCobranca: nrParcelasCobranca,
          entryMethod: entryMethod,
          discountDescription: discountName,
        },
      });

      const result = response.response;
      if (result?.status === "ERROR") {
        throw new Error(formatOriginError(result.origin, result.message));
      }

      await actions.refreshObjectProperties();

      sendAlert({
        type: "success",
        message: "Dados atualizados e Itens de Linha criados com sucesso!",
      });

      try {
        const quoteResult = await runServerless({
          name: "createQuote",
          parameters: {
            dealId: context.crm.objectId,
            dealName: properties.dealname,
            ownerId: properties.hubspot_owner_id,
            expirationDate: getExpirationDate(),
            quoteTemplateId,
          },
        });
        if (quoteResult?.response?.status === "SUCCESS") {
          sendAlert({ type: "success", message: "Proposta criada com sucesso!" });
        } else {
          const qr = quoteResult?.response;
          sendAlert({
            type: "warning",
            message: formatOriginError(
              qr?.origin,
              qr?.message || "Erro ao criar proposta.",
            ),
          });
        }
      } catch (quoteError) {
        console.error("Erro ao criar proposta automaticamente:", quoteError);
        sendAlert({
          type: "warning",
          message: formatOriginError(
            "SISTEMA",
            "Erro ao criar proposta. Tente novamente.",
          ),
        });
      }
    } catch (error) {
      console.error("Error updating deal:", error);
      sendAlert({
        type: "danger",
        message: `Erro ao atualizar deal: ${error.message}`,
      });
    } finally {
      setTimeout(async () => {
            await actions.reloadPage();
      }, 2000);
      setIsSaving(false);
    }
  };

  const entryMethodOptions = {
    Vestibular: "Vestibular",
    ENEM: "ENEM",
    "TranferÇencia Externa": "Tranferência Externa",
    "Portador(a) de Diploma": "Portador(a) de Diploma",
  };

  const discountCategoryValues = new Set(
    properties.categorias_aprovadas
      ? properties.categorias_aprovadas.split(";").filter(Boolean)
      : [],
  );
  const discountCategoryOptions = categoryOptions.filter(({ value }) =>
    discountCategoryValues.has(value),
  );

  discountCategoryOptions.unshift({ label: "Sem desconto", value: "" });

  const formatCurrency = (value) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  return (
    <Card>
      <Flex direction="column" gap="medium">
        {/* Header Info */}
        <Flex direction="row" justify="between" gap="medium" align="end">
          <Flex direction="column" gap="extra-small">
            <Text format={{ fontWeight: "regular" }}>Turma</Text>
            <Text format={{ fontWeight: "demibold" }}>
              {turmaAtual?.properties?.id_da_turma || "N/A"}
            </Text>
          </Flex>

          <Flex direction="column" gap="extra-small">
            <Button
              onClick={handleRefreshAssociations}
              variant="secondary"
              size="small"
              disabled={isRefreshing}
            >
              {isRefreshing ? "Atualizando..." : "🔄 Atualizar dados de turma"}
            </Button>
          </Flex>
        </Flex>

        <Flex direction="row" justify="between" gap="medium">
          <Flex direction="column" gap="small">
            <Select
              label="Categoria do Desconto"
              name="categoriacondicao"
              value={selectedCategory}
              onChange={(value) => setSelectedCategory(String(value))}
              options={discountCategoryOptions}
              placeholder="Selecione a categoria"
            />
          </Flex>
        </Flex>

        {selectedCategory == "graduacao" && (
          <Flex direction="row" justify="between" gap="medium">
            <Flex direction="column" gap="small">
              <Select
                label="Forma de ingresso"
                name="forma_de_ingresso"
                value={entryMethod}
                onChange={(value) => setEntryMethod(String(value))}
                options={Object.entries(entryMethodOptions).map(
                  ([key, label]) => ({
                    label: label,
                    value: key,
                  }),
                )}
                placeholder="Selecione a forma de ingresso"
                required={true}
              />
            </Flex>
          </Flex>
        )}

        {/* Buttons Row */}
        <Flex direction="row" justify="start" gap="small">
          <Button
            onClick={handleSimulate}
            variant="primary"
            disabled={isLoading}
          >
            Simular
          </Button>
        </Flex>

        {/* Discount Selection */}
        {fetchedDiscount &&
          Array.isArray(fetchedDiscount) &&
          fetchedDiscount.length > 1 && (
            <>
              <Divider />
              <Heading>Selecione o Desconto</Heading>
              <Flex direction="column" gap="small">
                {fetchedDiscount.map((discount, index) => (
                  <Card key={index}>
                    <Flex direction="row" justify="between" align="center">
                      <Flex direction="column" gap="extra-small">
                        <Text format={{ fontWeight: "demibold" }}>
                          {discount.nomeplanodesconto}
                        </Text>
                        <Text>
                          Desconto: {discount.percdescontoparcela}
                          {discount.tipodescontoparcela === "VA" ? " R$" : "%"}
                        </Text>
                      </Flex>
                      <Button
                        onClick={() => setSelectedDiscount(discount)}
                        variant={
                          selectedDiscount === discount
                            ? "primary"
                            : "secondary"
                        }
                      >
                        {selectedDiscount === discount
                          ? "Selecionado"
                          : "Selecionar"}
                      </Button>
                    </Flex>
                  </Card>
                ))}
              </Flex>
            </>
          )}

        {/* Loading/Timer */}
        {(isLoading || fetchDuration) && (
          <Flex direction="row" justify="end" gap="small">
            <Text format={{ fontWeight: "regular", fontSize: "small" }}>
              {isLoading
                ? "Buscando opções..."
                : `Tempo de resposta: ${fetchDuration}s`}
            </Text>
          </Flex>
        )}

        {/* Table with all conditions */}
        {graduationPlanData &&
          graduationPlanData.condicoesPagamento &&
          graduationPlanData.condicoesPagamento.length > 0 && (
            <>
              <Divider />
              <Heading>Opções de Parcelamento</Heading>

              <Table bordered>
                <TableHead>
                  <TableRow>
                    <TableHeader>Descrição</TableHeader>
                    <TableHeader>Parcelas</TableHeader>
                    <TableHeader>Valor Parcela</TableHeader>
                    <TableHeader>Categoria Desconto</TableHeader>
                    <TableHeader>Tipo Desconto</TableHeader>
                    <TableHeader>Desconto</TableHeader>
                    <TableHeader>Valor Final</TableHeader>
                    <TableHeader>Ação</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {graduationPlanData.condicoesPagamento.map((condition) => {
                    const {
                      discountAmount,
                      discountValue,
                      discountName,
                      discountType,
                      valorParcela,
                      valorParcelaFinal,
                      nrParcelasCobranca,
                    } = getDiscountData(condition);

                    return (
                      <TableRow key={condition.condicaoPagamento}>
                        <TableCell>{condition.descricao}</TableCell>
                        <TableCell>{nrParcelasCobranca}</TableCell>
                        <TableCell>{formatCurrency(valorParcela)}</TableCell>
                        <TableCell>{getCategoryLabel(selectedCategory, categoryLabels) || "-"}</TableCell>
                        <TableCell>{discountName || "-"}</TableCell>
                        <TableCell>
                          {discountAmount}
                          {discountType === "VA" ? "R$" : "%"} (
                          {formatCurrency(discountValue)})
                        </TableCell>
                        <TableCell>{formatCurrency(valorParcelaFinal)}</TableCell>
                        <TableCell>
                          <Button
                            onClick={() => handleSelectCondition(condition)}
                            variant={
                              selectedCondition === condition
                                ? "primary"
                                : "secondary"
                            }
                          >
                            {selectedCondition === condition
                              ? "Selecionado"
                              : "Selecionar"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}

        {/* Summary Section */}
        {selectedCondition &&
          (() => {
            const {
              discountAmount,
              discountValue,
              discountMatriculaValue,
              discountType,
              valorParcela,
              valorParcelaFinal,
              valorMatricula,
              valorMatriculaFinal,
              nrParcelasCobranca,
            } = getDiscountData(selectedCondition);

            return (
              <>
                <Divider />
                <Heading>Resumo</Heading>

                <Flex direction="column" gap="small">
                  <Flex direction="row" justify="between">
                    <Text>Curso:</Text>
                    <Text format={{ fontWeight: "bold" }}>
                      {graduationPlanData.curso}
                    </Text>
                  </Flex>
                  <Flex direction="row" justify="between">
                    <Text>Matriz Curricular:</Text>
                    <Text format={{ fontWeight: "bold" }}>
                      {graduationPlanData.matrizCurricular}
                    </Text>
                  </Flex>
                  <Flex direction="row" justify="between">
                    <Text>Valor da primeira parcela:</Text>
                    <Text format={{ fontWeight: "bold" }}>
                      {formatCurrency(valorMatricula)}
                    </Text>
                  </Flex>
                  <Flex direction="row" justify="between">
                    <Text>Valor da Parcela:</Text>
                    <Text format={{ fontWeight: "bold" }}>
                      {formatCurrency(valorParcela)}
                    </Text>
                  </Flex>

                  <Flex direction="row" justify="between">
                    <Text>Quantidade de Parcelas:</Text>
                    <Text format={{ fontWeight: "demibold" }}>
                      {nrParcelasCobranca}
                    </Text>
                  </Flex>

                  {discountAmount > 0 ? (
                    <>
                      <Flex direction="row" justify="between">
                        <Text>Status do Desconto:</Text>
                        <Text format={{ fontWeight: "demibold" }}>
                          Aprovado
                        </Text>
                      </Flex>
                      <Flex direction="row" justify="between">
                        <Text>
                          Desconto ({discountAmount}
                          {discountType === "VA" ? "R$" : "%"}) na primeira
                          parcela:
                        </Text>
                        <Text format={{ fontWeight: "bold" }}>
                          - {formatCurrency(discountMatriculaValue)}
                        </Text>
                      </Flex>

                      <Flex direction="row" justify="between">
                        <Text format={{ fontWeight: "bold" }}>
                          Primeira parcela com desconto:
                        </Text>
                        <Text format={{ fontWeight: "bold" }}>
                          {formatCurrency(valorMatriculaFinal)}
                        </Text>
                      </Flex>

                      <Flex direction="row" justify="between">
                        <Text>
                          Desconto ({discountAmount}
                          {discountType === "VA" ? "R$" : "%"}) na parcela:
                        </Text>
                        <Text format={{ fontWeight: "bold" }}>
                          - {formatCurrency(discountValue)}
                        </Text>
                      </Flex>

                      <Flex direction="row" justify="between">
                        <Text format={{ fontWeight: "bold" }}>
                          Parcela com desconto:
                        </Text>
                        <Text format={{ fontWeight: "bold" }}>
                          {formatCurrency(valorParcelaFinal)}
                        </Text>
                      </Flex>
                    </>
                  ) : (
                    <Flex direction="row" justify="between">
                      <Text>
                        Categoria: {getCategoryLabel(selectedCategory, categoryLabels) || "Sem desconto"}
                      </Text>
                    </Flex>
                  )}
                </Flex>

                <Button
                  onClick={handleConfirm}
                  variant="primary"
                  disabled={isSaving}
                >
                  {isSaving ? "Salvando..." : "Confirmar seleção e gerar orçamento"}
                </Button>
              </>
            );
          })()}

        {/* No conditions warning */}
        {graduationPlanData &&
          (!graduationPlanData.condicoesPagamento ||
            graduationPlanData.condicoesPagamento.length === 0) && (
            <Alert title="Nenhuma condição encontrada" variant="warning">
              Não foram encontradas condições de pagamento para esta turma de
              graduação.
            </Alert>
          )}
      </Flex>
    </Card>
  );
};
