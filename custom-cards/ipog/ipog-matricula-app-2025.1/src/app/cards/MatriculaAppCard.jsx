import React, { useEffect, useState } from "react";
import {
  Card,
  Flex,
  Text,
  Select,
  MultiSelect,
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

hubspot.extend(({ context, runServerlessFunction, actions }) => (
  <Extension
    context={context}
    runServerless={runServerlessFunction}
    sendAlert={actions.addAlert}
    actions={actions}
  />
));

const CONFIG = {
  sandbox: {
    portalId: 51406295,
    classObjectId: "2-61647973",
    templates: {
      posPresencial: "557223214116",
      posEad: "567949826727",
      ceu: "567949827712",
    },
  },
  production: {
    classObjectId: "2-42181871",
    templates: {
      posPresencial: "510682133656",
      posEad: "512266346925",
      ceu: "512291762062",
    },
  },
};

const NIVEL_INTERESSE_CEU = "Curso de extensão universitária";

// PIX e cartão à vista seguem as mesmas regras de pagamento à vista.
const isPagamentoAVista = (tipoPagamento) =>
  tipoPagamento === "PIX" || tipoPagamento === "A_VISTA";

const Extension = ({ context, runServerless, sendAlert, actions }) => {
  const { properties } = useCrmProperties([
    "dealname",
    "categoriacondicao",
    "desconto_aprovado",
    "categorias_aprovadas",
    "nivel_de_interesse",
    "modalidade_de_interesse",
    "matriculas_formadas_posgraduacao",
    "matriculas_formadas_graduacao",
    "curso_nome",
    "turma",
    "hubspot_owner_id",
  ]);
  const [portalId] = useState(context.portal.id);
  const [categoryLabels, setCategoryLabels] = useState({});
  const isSandbox = portalId === CONFIG.sandbox.portalId;
  const envConfig = isSandbox ? CONFIG.sandbox : CONFIG.production;
  const classObjectId = envConfig.classObjectId;

  useEffect(() => {
    runServerless({ name: "fetchDealPropertyOptions", parameters: {} })
      .then(({ response }) => {
        if (response?.status !== "SUCCESS") return;
        setCategoryLabels(
          Object.fromEntries(
            response.options.map(({ value, label }) => [value, label]),
          ),
        );
      })
      .catch((error) =>
        console.error("Erro ao carregar labels das categorias:", error),
      );
  }, [runServerless]);

  const { results: contactResults } = useAssociations(
    {
      toObjectType: "0-1",
      properties: ["quantidade_de_indicacoes"],
      pageLength: 10,
    },
    {
      propertiesToFormat: "all",
    },
  );
  // Note: quantidade_de_indicacoes no longer used for diamond discount logic

  const { results: associatedTurmaResult } = useAssociations(
    {
      toObjectType: classObjectId,
      properties: [
        "unidadeensino",
        "id_da_turma",
        "id_do_curso",
        "nome_da_turma",
        "unidade_name",
        "unidade",
        "nivel_de_interesse",
        "modalidade_da_turma",
        "nome_do_curso",
        "data_de_inauguracao",
        "databasegeracaoparcelas",
      ],
      pageLength: 1,
    },
    {
      propertiesToFormat: "all",
    },
  );

  // Extrai o primeiro contato associado, mapeando toObjectId para id
  const associatedContact = contactResults?.[0]
    ? { ...contactResults[0], id: contactResults[0].toObjectId }
    : null;

  const [selectedTipoPagamento, setSelectedTipoPagamento] = useState("");
  const [selectedCategory, setSelectedCategory] = useState([]);
  const [financialPlanData, setFinancialPlanData] = useState(null);
  const [discountsByCategory, setDiscountsByCategory] = useState({});
  const [selectedDiscountsByCategory, setSelectedDiscountsByCategory] = useState({});
  const [selectedCondition, setSelectedCondition] = useState(null);
  const [fetchDuration, setFetchDuration] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [manualTurmaData, setManualTurmaData] = useState(null);
  // isCreatingQuote removed - quote creation tracked via quoteResult response
  const [quoteTemplateId, setQuoteTemplateId] = useState(CONFIG.production.templates.posPresencial); // Default fallback

  // Diamond indications state
  const [diamondIndications, setDiamondIndications] = useState([]);
  const [selectedDiamonds, setSelectedDiamonds] = useState([]);
  const [isLoadingDiamonds, setIsLoadingDiamonds] = useState(false);
  const [diamondLimit, setDiamondLimit] = useState(null);
  const [diamondTier, setDiamondTier] = useState(null); // null | 5 | 10 — required exact count for CEU/Pós
  const [diamondDiscounts, setDiamondDiscounts] = useState([]);

  const turmaAtual = manualTurmaData || associatedTurmaResult[0];

  // Determina se é CEU ou Pós sem matrículas (para regra de limite de diamantes)
  const isCeuOrPosSemMatricula =
    properties.nivel_de_interesse === NIVEL_INTERESSE_CEU ||
    (properties.nivel_de_interesse === "Pós-graduação" &&
      (parseInt(properties.matriculas_formadas_posgraduacao, 10) || 0) === 0);

  // Categoria do desconto de pagamento à vista (Ação Comercial) por nível de interesse:
  // CEU -> acao_comercial_ceu | Pós-graduação (e fallback) -> acao_comercial_pos.
  // A categoria é normalizada de volta para "acao_comercial" ao agrupar, mantendo
  // toda a lógica interna (seleção, validação, cálculo) intacta.
  const avistaCategoria =
    properties.nivel_de_interesse === NIVEL_INTERESSE_CEU
      ? "acao_comercial_ceu"
      : "acao_comercial_pos";

  // Derived: diamantes visíveis na interface (limitados por diamondLimit para CEU/Pós)
  const visibleDiamonds = diamondLimit !== null
    ? diamondIndications.slice(0, diamondLimit)
    : diamondIndications;

  // Toggle diamante selection (cumulative, based on diamondLimit)
  const handleToggleDiamond = (diamond) => {
    setSelectedDiamonds((prev) => {
      const alreadySelected = prev.some((d) => d.id === diamond.id);
      if (alreadySelected) {
        // Block deselection below the required count for CEU/Pós sem matrícula
        if (isCeuOrPosSemMatricula && diamondTier !== null && prev.length <= diamondTier) {
          return prev;
        }
        return prev.filter((d) => d.id !== diamond.id);
      }
      const maxDiamonds = diamondLimit !== null ? diamondLimit : (diamondTier || prev.length + 1);
      if (prev.length >= maxDiamonds) return prev;
      return [...prev, diamond];
    });
  };

  // Tier selection handler for >= 10 diamonds (CEU/Pós sem matrícula)
  const handleSelectDiamondTier = (tier) => {
    setDiamondTier(tier);
    setDiamondLimit(tier);
    setSelectedDiamonds([]);
  };

  // Agrupa descontos por categoria (aluno_diamante is handled separately via diamondIndications)
  const groupDiscountsByCategory = (allDiscounts, selectedCategories, showAcaoComercial, avistaCategoriaAtual) => {
    const grouped = {};

    selectedCategories.forEach(categoria => {
      // Skip acao_comercial - handled separately based on payment type
      if (categoria === "aluno_diamante" || categoria === "acao_comercial") return;

      let descontosCategoria = allDiscounts.filter(d => d.categoria === categoria);
      descontosCategoria.sort((a, b) => parseFloat(a.percdescontoparcela) - parseFloat(b.percdescontoparcela));
      grouped[categoria] = descontosCategoria;
    });

    // Always include acao_comercial when payment type is à vista.
    // A categoria vinda da MuleSoft (acao_comercial_pos / acao_comercial_ceu) é
    // normalizada para "acao_comercial" para manter a lógica interna intacta.
    if (showAcaoComercial) {
      let acaoComercialDiscounts = allDiscounts
        .filter(d => d.categoria === avistaCategoriaAtual)
        .map(d => ({ ...d, categoria: "acao_comercial" }));
      acaoComercialDiscounts.sort((a, b) => parseFloat(a.percdescontoparcela) - parseFloat(b.percdescontoparcela));
      if (acaoComercialDiscounts.length > 0) {
        grouped["acao_comercial"] = acaoComercialDiscounts;
      }
    }

    return grouped;
  };

  // Seleciona desconto para uma categoria
  const handleSelectDiscountForCategory = (categoria, desconto) => {
    setSelectedDiscountsByCategory(prev => {
      // Se já está selecionado, desseleciona
      if (prev[categoria]?.codigoplanodesconto === desconto.codigoplanodesconto) {
        const newState = { ...prev };
        delete newState[categoria];
        return newState;
      }
      // Caso contrário, seleciona
      return {
        ...prev,
        [categoria]: desconto,
      };
    });
  };

  // Helpers for diamond discount display
  const getDiamondDiscountNames = () => {
    return selectedDiamonds.map(
      d => `Indicação Diamante - ${d.nome_do_indicado} (${d.nivel_educacional})`
    );
  };

  const getDiamondDiscountPercent = () => {
    return Math.min(selectedDiamonds.length * 10, 100);
  };

  const getDiamondDiscountLabel = () => {
    const percent = getDiamondDiscountPercent();
    return percent > 0 ? `Aluno diamante (${percent}%)` : null;
  };

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
    const templates = envConfig.templates;

    switch (properties.nivel_de_interesse) {
      case "Pós-graduação":
        if (properties.modalidade_de_interesse === "Presencial" ||
            properties.modalidade_de_interesse === "Ao Vivo" ||
            properties.modalidade_de_interesse === "Remoto ao vivo") {
          setQuoteTemplateId(templates.posPresencial);
        } else {
          setQuoteTemplateId(templates.posEad);
        }
        break;
      case NIVEL_INTERESSE_CEU:
        setQuoteTemplateId(templates.ceu);
        break;
      default:
        setQuoteTemplateId(templates.posPresencial); // Fallback
        break;
    }
  }, [envConfig, properties.nivel_de_interesse, properties.modalidade_de_interesse]);

  useEffect(() => {
    if (properties.categoriacondicao) {
      const categories = properties.categoriacondicao.split(";").filter((cat) => cat !== "" && cat !== "acao_comercial");
      setSelectedCategory(categories);
    }
  }, [properties.categoriacondicao]);

  const handleSimulate = async () => {
    if (!selectedTipoPagamento) {
      sendAlert({
        type: "warning",
        message: "Selecione o Tipo de Pagamento para simular.",
      });
      return;
    }

    const startTime = performance.now();
    setIsLoading(true);
    setFetchDuration(null);
    setFinancialPlanData(null);
    setDiscountsByCategory({});
    setSelectedDiscountsByCategory({});
    setSelectedCondition(null);
    setDiamondIndications([]);
    setSelectedDiamonds([]);
    setDiamondTier(null);

    try {
      const promises =
        properties.nivel_de_interesse === NIVEL_INTERESSE_CEU
          ? [
              runServerless({
                name: "fetchFinancialPlanCeu",
                parameters: {
                  properties: {
                    turma: turmaAtual?.properties?.id_da_turma,
                  },
                },
              }),
            ]
          : [
              runServerless({
                name: "fetchFinancialPlan",
                parameters: {
                  properties: {
                    turma: turmaAtual?.properties?.id_da_turma,
                    unidade_id: turmaAtual?.properties?.unidadeensino,
                    selectedTipoPagamento: selectedTipoPagamento,
                  },
                },
              }),
            ];

      if (selectedCategory.length > 0) {
        selectedCategory.forEach((category) => {
          promises.push(
            runServerless({
              name: "fetchDiscount",
              parameters: {
                categoriadesconto: category,
              },
            }),
          );
        });
      }

      // Always fetch acao_comercial discount (pagamento à vista).
      // Categoria varia por nível de interesse: acao_comercial_pos (Pós) / acao_comercial_ceu (CEU).
      promises.push(
        runServerless({
          name: "fetchDiscount",
          parameters: {
            categoriadesconto: avistaCategoria,
          },
        }),
      );

      // Fetch diamante indications if aluno_diamante is in selected categories
      if (selectedCategory.includes("aluno_diamante") && associatedContact?.id) {
        setIsLoadingDiamonds(true);
        promises.push(
          runServerless({
            name: "fetchDiamanteIndications",
            parameters: {
              contactId: associatedContact.id,
              dealNivelInteresse: properties.nivel_de_interesse,
            },
          }),
        );
      }

      const responses = await Promise.all(promises);
      const financialPlanResponse = responses[0];

      // Total de respostas após plano financeiro: descontos + acao_comercial + opcionalmente diamantes
      const discountResponses = responses.slice(1);

      // Agregar todos os descontos das categorias
      const allDiscounts = [];
      let diamanteResponse = null;

      discountResponses.forEach((resp) => {
        // Detect if this is the diamanteIndications response (has nome_do_indicado)
        if (resp?.response?.response && Array.isArray(resp.response.response) && resp.response.response.length > 0) {
          const first = resp.response.response[0];
          if (first && first.nome_do_indicado !== undefined) {
            diamanteResponse = resp;
            return;
          }
        }

        if (resp?.response?.status === "SUCCESS" && resp.response.response) {
          const discounts = Array.isArray(resp.response.response)
            ? resp.response.response
            : [resp.response.response];
          allDiscounts.push(...discounts);
        } else if (resp?.response?.status === "ERROR") {
          sendAlert({
            type: "warning",
            message: formatOriginError(resp.response.origin, resp.response.message),
          });
        }
      });

      const diamondDiscountsFiltered = allDiscounts.filter(d => d.categoria === "aluno_diamante");
      setDiamondDiscounts(diamondDiscountsFiltered);

      // Process diamante indications
      if (diamanteResponse) {
        if (diamanteResponse.response?.status === "SUCCESS") {
          const indications = diamanteResponse.response.response || [];
          if (isCeuOrPosSemMatricula) {
            // Gate: only load diamonds for CEU/Pós sem matrícula when >= 5
            if (indications.length >= 5) {
              setDiamondIndications(indications);
              if (indications.length >= 10) {
                // Tier 2: user must choose between 5 (50%) or 10 (100%)
                setDiamondLimit(null);
                setDiamondTier(null);
              } else {
                // Tier 1: exactly 5 diamonds required for 50%
                setDiamondLimit(5);
                setDiamondTier(5);
              }
            } else {
              // < 5: do not load diamonds for CEU/Pós sem matrícula
              setDiamondIndications([]);
              setDiamondLimit(null);
              setDiamondTier(null);
            }
          } else {
            // Non-CEU/Pós: no restriction
            setDiamondIndications(indications);
            setDiamondLimit(null);
            setDiamondTier(null);
          }
        } else {
          sendAlert({
            type: "warning",
            message: formatOriginError(diamanteResponse.response.origin, diamanteResponse.response.message),
          });
        }
      }
      setIsLoadingDiamonds(false);

      const planResult = financialPlanResponse.response;
      if (planResult?.status === "ERROR") {
        throw new Error(formatOriginError(planResult.origin, planResult.message));
      }

      const planData = planResult?.response;
      if (!planData?.tipoPagamento) {
        planData["tipoPagamento"] = selectedTipoPagamento;
      }

      // O plano CEU não é recortado por tipo de pagamento no MuleSoft, então o corte
      // para a condição de 1x em pagamento à vista é do frontend.
      if (
        isPagamentoAVista(selectedTipoPagamento) &&
        properties.nivel_de_interesse === NIVEL_INTERESSE_CEU
      ) {
        planData.condicoes = planData.condicoes.filter(
          (condicao) => condicao.qtdeParcelas == "1"
        );
      }

      setFinancialPlanData(planData);

      // Agrupar descontos por categoria (acao_comercial incluída quando à vista)
      if (allDiscounts.length > 0) {
        const grouped = groupDiscountsByCategory(
          allDiscounts,
          selectedCategory,
          isPagamentoAVista(selectedTipoPagamento),
          avistaCategoria,
        );
        setDiscountsByCategory(grouped);
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

  // Calcula descontos cumulativos: diamante primeiro, depois categorias, depois pagamento à vista (acao_comercial)
  const getDiscountData = (originalValue, selectedDiscounts) => {
    let currentValue = originalValue;
    let totalCategoryDiscountValue = 0;
    const discountDetails = [];
    
    // Step 1: Apply diamond discount (cumulative, 10% per selected diamond)
    const diamondPercent = getDiamondDiscountPercent();
    if (diamondPercent > 0) {
      const diamondAmount = currentValue * (diamondPercent / 100);
      currentValue -= diamondAmount;
      totalCategoryDiscountValue += diamondAmount;
      discountDetails.push({
        name: `Indicação Diamante (${selectedDiamonds.length}x)`,
        categoria: "aluno_diamante",
        type: "PO",
        originalValue: diamondPercent + "%",
        appliedValue: diamondAmount,
        code: diamondDiscounts.find((d) => Number(d.percdescontoparcela) == Number(selectedDiamonds.length * 10))?.codigoplanodesconto || null, // Match code based on percent if available
      });
    }

    // Step 2: Obter descontos selecionados (VA primeiro, PO depois), excluindo acao_comercial (tratado como pagamento à vista)
    const selectedArray = Object.values(selectedDiscounts || {}).filter(d => d.categoria !== "acao_comercial");
    const sortedDiscounts = selectedArray.sort((a, b) => {
      if (a.tipodescontoparcela === "VA" && b.tipodescontoparcela !== "VA") return -1;
      if (a.tipodescontoparcela !== "VA" && b.tipodescontoparcela === "VA") return 1;
      return parseFloat(a.percdescontoparcela || 0) - parseFloat(b.percdescontoparcela || 0);
    });

    // Step 3: Apply category discounts multiplicatively
    sortedDiscounts.forEach((discount) => {
      if (discount.tipodescontoparcela === "VA") {
        const discountAmount = Math.min(parseFloat(discount.percdescontoparcela || 0), currentValue);
        currentValue -= discountAmount;
        totalCategoryDiscountValue += discountAmount;
        discountDetails.push({
          name: discount.nomeplanodesconto,
          categoria: discount.categoria,
          type: "VA",
          originalValue: discount.percdescontoparcela,
          appliedValue: discountAmount,
          code: discount.codigoplanodesconto,
        });
      } else {
        const percent = parseFloat(discount.percdescontoparcela || 0) / 100;
        const discountAmount = currentValue * percent;
        currentValue -= discountAmount;
        totalCategoryDiscountValue += discountAmount;
        discountDetails.push({
          name: discount.nomeplanodesconto,
          categoria: discount.categoria,
          type: "PO",
          originalValue: discount.percdescontoparcela + "%",
          appliedValue: discountAmount,
          code: discount.codigoplanodesconto,
        });
      }
    });

    const totalCategoryDiscountPercent = originalValue > 0
      ? ((originalValue - currentValue) / originalValue * 100)
      : 0;

    // Step 4: Apply acao_comercial (pagamento à vista) discount from selected discounts
    const avistaDiscount = selectedDiscounts?.["acao_comercial"];
    let pagamentoAVistaPercent = 0;
    let pagamentoAVistaValue = 0;
    if (avistaDiscount) {
      pagamentoAVistaPercent = parseFloat(avistaDiscount.percdescontoparcela || 0);
      pagamentoAVistaValue = currentValue * (pagamentoAVistaPercent / 100);
      currentValue = currentValue * (1 - pagamentoAVistaPercent / 100);
      discountDetails.push({
        name: avistaDiscount.nomeplanodesconto,
        categoria: "acao_comercial",
        type: "PO",
        originalValue: avistaDiscount.percdescontoparcela + "%",
        appliedValue: pagamentoAVistaValue,
        code: avistaDiscount.codigoplanodesconto,
      });
    }

    const finalValue = currentValue;

    return {
      allDiscounts: discountDetails,
      totalCategoryDiscountValue: pagamentoAVistaValue > 0 ? totalCategoryDiscountValue + pagamentoAVistaValue : totalCategoryDiscountValue,
      totalCategoryDiscountPercent,
      pagamentoAVistaPercent,
      pagamentoAVistaValue,
      finalValue,
      totalDiscountPercent: originalValue > 0
        ? ((originalValue - finalValue) / originalValue * 100).toFixed(2)
        : 0,
    };
  };

  const handleSelectCondition = (condition) => {
    setSelectedCondition(condition);
  };

  const calculateAntecipationValue = (
    totalValue,
    properties,
    selectedCondition,
  ) => {
    let antecipationValue = totalValue;

    if (
      properties.nivel_de_interesse === NIVEL_INTERESSE_CEU &&
      selectedCondition.valorMatricula === 150
    ) {
      antecipationValue = totalValue - 20;
    } else if (
      properties.nivel_de_interesse === NIVEL_INTERESSE_CEU &&
      selectedCondition.valorMatricula === 250
    ) {
      antecipationValue = totalValue - 50;
    } else if (
      properties.nivel_de_interesse === "Pós-graduação" &&
      (properties.modalidade_de_interesse === "Presencial" ||
        properties.modalidade_de_interesse === "Ao Vivo") &&
      !selectedCategory.includes("ex_aluno_4")
    ) {
      antecipationValue = totalValue - 30;
    } else if (
      properties.nivel_de_interesse === "Pós-graduação" &&
      (properties.modalidade_de_interesse === "Presencial" ||
        properties.modalidade_de_interesse === "Ao Vivo") &&
       selectedCategory.includes("ex_aluno_4")
    ) {
      antecipationValue = totalValue - 15;
    } else if (properties.nivel_de_interesse === "Graduação") {
      antecipationValue = totalValue - totalValue * 0.05;
    }
    return antecipationValue < 50 ? totalValue : antecipationValue;
  };

  const getExpirationDate = () => {
    const date = new Date();
    date.setDate(date.getDate() + 90);
    return date.toISOString().split("T")[0];
  };

  const handleConfirm = async () => {
    if (!selectedCondition) return;

    // Validação obrigatória: todas as categorias (exceto aluno_diamante) devem ter desconto selecionado
    const nonDiamondCategories = selectedCategory.filter(cat => cat !== "aluno_diamante");
    const missingCategories = nonDiamondCategories.filter(cat => !selectedDiscountsByCategory[cat]);
    if (missingCategories.length > 0) {
      sendAlert({
        type: "warning",
        message: `Selecione um desconto para: ${missingCategories.map(c => categoryLabels[c] || c).join(", ")}`,
      });
      return;
    }

    // Validate acao_comercial is selected when payment type is PIX or A_VISTA
    const isAVista = isPagamentoAVista(selectedTipoPagamento);
    if (isAVista && !selectedDiscountsByCategory["acao_comercial"]) {
      sendAlert({
        type: "warning",
        message: "Selecione o desconto de pagamento à vista (Ação Comercial).",
      });
      return;
    }

    // Validate exact diamond count for CEU/Pós sem matrícula
    if (isCeuOrPosSemMatricula && selectedCategory.includes("aluno_diamante") && diamondIndications.length >= 5) {
      const requiredCount = diamondTier;
      if (requiredCount === null) {
        sendAlert({
          type: "warning",
          message: "Selecione o tier de desconto (50% ou 100%) antes de confirmar.",
        });
        return;
      }
      if (selectedDiamonds.length !== requiredCount) {
        sendAlert({
          type: "warning",
          message: `Selecione exatamente ${requiredCount} indicações diamante para obter ${requiredCount * 10}% de desconto.`,
        });
        return;
      }
    }

    setIsSaving(true);

    try {
      const discountData = getDiscountData(
        selectedCondition.valorParcela,
        selectedDiscountsByCategory,
      );
      const { allDiscounts, totalCategoryDiscountValue, totalCategoryDiscountPercent, finalValue, pagamentoAVistaPercent, pagamentoAVistaValue } = discountData;
      const discountCodes = allDiscounts.filter(d => d.code).map(d => d.code).join(";");
      const antecipationValue = calculateAntecipationValue(
        finalValue,
        properties,
        selectedCondition,
      );

      // Build diamantes_orcados string: IDs selected, separated by ";"
      const diamondsOrcados = selectedDiamonds.map(d => d.id).join(";");

      const response = await runServerless({
        name: "updateDealProperties",
        parameters: {
          dealId: context.crm.objectId,
          financialPlan: financialPlanData,
          selectedCondition: selectedCondition,
          selectedCategory: selectedCategory.join(";"),
          discountPercent: totalCategoryDiscountPercent,
          discountValue: totalCategoryDiscountValue,
          allDiscounts: allDiscounts,
          antecipationValue: antecipationValue,
          finalValue: finalValue,
          course: properties.curso_nome,
          class: properties.turma,
          unitId: turmaAtual?.properties?.unidadeensino,
          courseId: turmaAtual?.properties?.id_do_curso,
          className: turmaAtual?.properties?.nome_da_turma,
          unitName: turmaAtual?.properties?.unidade_name,
          unit: turmaAtual?.properties?.unidade,
          interest: turmaAtual?.properties?.nivel_de_interesse,
          modality: turmaAtual?.properties?.modalidade_da_turma,
          courseName: turmaAtual?.properties?.nome_do_curso,
          startDate: turmaAtual?.properties?.data_de_inauguracao,
          baseEnrollmentDate: turmaAtual?.properties?.databasegeracaoparcelas,
          diamondsOrcados: diamondsOrcados,
          lineItem: {
            name:
              selectedCondition.descricao ||
              `Parcelamento ${selectedCondition.qtdeParcelas}x`,
            price: selectedCondition.valorParcela,
            recurringbillingfrequency:
              selectedCondition.qtdeParcelas > 1 ? "monthly" : undefined,
            hs_recurring_billing_period:
              selectedCondition.qtdeParcelas > 1
                ? `P${selectedCondition.qtdeParcelas}M`
                : undefined,
            discount: totalCategoryDiscountValue,
          },
        },
      });
      
      const result = response.response;

      if (result?.status === "ERROR") {
        throw new Error(formatOriginError(result.origin, result.message));
      }

      await actions.refreshObjectProperties();

      sendAlert({
        type: "success",
        message: "Dados atualizados e Item de Linha criado com sucesso!",
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
            "Erro ao criar proposta. Tente criar manualmente a partir do deal.",
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

  const paymentTypeOptions =
    properties.nivel_de_interesse === NIVEL_INTERESSE_CEU
      ? [
          { label: "À vista cartão", value: "A_VISTA" },
          { label: "Cartão Parcelado", value: "PARCELADO" },
          { label: "PIX", value: "PIX" },
        ]
      : [
          { label: "PIX", value: "PIX" },
          { label: "À vista cartão", value: "A_VISTA" },
          { label: "Cartão Parcelado", value: "PARCELADO" },
          { label: "Cartão Recorrente", value: "RECORRENTE" },
          { label: "Boleto", value: "BOLETO" },
        ];

  const discountCategoryOptions = properties.categorias_aprovadas
    ? properties.categorias_aprovadas
        .split(";")
        .filter((cat) => cat !== "" && cat !== "acao_comercial")
        .map((cat) => ({
          label: categoryLabels[cat] || cat,
          value: cat,
        }))
    : [];

  const isAVista = isPagamentoAVista(selectedTipoPagamento);

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
            <Text format={{ fontWeight: "regular" }}>Unidade ID</Text>
            <Text format={{ fontWeight: "demibold" }}>
              {turmaAtual?.properties?.unidadeensino || "N/A"}
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
              label="Tipo de Pagamento"
              name="tipopagamento"
              value={selectedTipoPagamento}
          onChange={(value) => {
            const newTipo = String(value);
            setSelectedTipoPagamento(newTipo);
            // Clear acao_comercial selection when switching away from à vista
            const newIsAVista = isPagamentoAVista(newTipo);
            if (!newIsAVista && selectedDiscountsByCategory["acao_comercial"]) {
              setSelectedDiscountsByCategory(prev => {
                const newState = { ...prev };
                delete newState["acao_comercial"];
                return newState;
              });
            }
          }}
              options={paymentTypeOptions}
              placeholder="Selecione o tipo"
            />
          </Flex>

          <Flex direction="column" gap="small">
            <MultiSelect
              label="Categorias do Desconto"
              name="categoriacondicao"
              value={selectedCategory}
              onChange={(value) => setSelectedCategory(value)}
              options={discountCategoryOptions}
              placeholder="Selecione as categorias"
            />
          </Flex>
        </Flex>


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

        {/* Discount Selection by Category (exclui acao_comercial) */}
        {Object.keys(discountsByCategory).filter(c => c !== "acao_comercial").length > 0 && (
          <>
            <Divider />
            <Heading>Selecione os Descontos</Heading>
            {Object.entries(discountsByCategory).filter(([c]) => c !== "acao_comercial").map(([categoria, descontos]) => (
              <Flex key={categoria} direction="column" gap="small">
                <Text format={{ fontWeight: "demibold" }}>
                  {categoryLabels[categoria] || categoria}
                </Text>
                {descontos.length === 0 ? (
                  <Text format={{ fontSize: "small" }}>
                    {categoria === "aluno_diamante" 
                      ? "Nenhum desconto disponível para a quantidade de indicações."
                      : "Nenhum desconto disponível."}
                  </Text>
                ) : (
                  <Flex direction="row" gap="small" wrap="wrap">
                    {descontos.map((desconto) => (
                      <Card key={desconto.codigoplanodesconto}>
                        <Flex direction="column" gap="extra-small">
                          <Text format={{ fontWeight: "demibold" }}>
                            {desconto.tipodescontoparcela === "VA" ? "R$" + desconto.percdescontoparcela : desconto.percdescontoparcela + "%"}
                          </Text>
                          <Text format={{ fontSize: "small" }}>
                            {desconto.nomeplanodesconto}
                          </Text>
                          <Button
                            onClick={() => handleSelectDiscountForCategory(categoria, desconto)}
                            variant={
                              selectedDiscountsByCategory[categoria]?.codigoplanodesconto === desconto.codigoplanodesconto
                                ? "primary"
                                : "secondary"
                            }
                            size="small"
                          >
                            {selectedDiscountsByCategory[categoria]?.codigoplanodesconto === desconto.codigoplanodesconto
                              ? "Selecionado"
                              : "Selecionar"}
                          </Button>
                        </Flex>
                      </Card>
                    ))}
                  </Flex>
                )}
              </Flex>
            ))}
          </>
        )}

        {/* Seção: Ação Comercial (Pagamento à Vista) — aparece automaticamente quando PIX ou A_VISTA */}
        {isAVista && discountsByCategory["acao_comercial"] && (
          <>
            <Divider />
            <Heading>Desconto Pagamento à Vista (Ação Comercial)</Heading>
            {discountsByCategory["acao_comercial"].length === 0 ? (
              <Text format={{ fontSize: "small" }}>
                Nenhum desconto de ação comercial disponível.
              </Text>
            ) : (
              <Flex direction="row" gap="small" wrap="wrap">
                {discountsByCategory["acao_comercial"].map((desconto) => (
                  <Card key={desconto.codigoplanodesconto}>
                    <Flex direction="column" gap="extra-small">
                      <Text format={{ fontWeight: "demibold" }}>
                        {desconto.tipodescontoparcela === "VA" ? "R$" + desconto.percdescontoparcela : desconto.percdescontoparcela + "%"}
                      </Text>
                      <Text format={{ fontSize: "small" }}>
                        {desconto.nomeplanodesconto}
                      </Text>
                      <Button
                        onClick={() => handleSelectDiscountForCategory("acao_comercial", desconto)}
                        variant={
                          selectedDiscountsByCategory["acao_comercial"]?.codigoplanodesconto === desconto.codigoplanodesconto
                            ? "primary"
                            : "secondary"
                        }
                        size="small"
                      >
                        {selectedDiscountsByCategory["acao_comercial"]?.codigoplanodesconto === desconto.codigoplanodesconto
                          ? "Selecionado"
                          : "Selecionar"}
                      </Button>
                    </Flex>
                  </Card>
                ))}
              </Flex>
            )}
          </>
        )}

        {/* Seção: Selecione as Indicações (Diamante) */}
        {selectedCategory.includes("aluno_diamante") && (
          <>
            <Divider />
            <Heading>Selecione as indicações</Heading>
            {isLoadingDiamonds ? (
              <Text format={{ fontSize: "small" }}>Carregando indicações...</Text>
            ) : diamondIndications.length === 0 ? (
              <Text format={{ fontSize: "small" }}>
                Nenhum desconto disponível para a quantidade de indicações.
              </Text>
            ) : isCeuOrPosSemMatricula && diamondIndications.length >= 10 && diamondTier === null ? (
              <>
                <Text format={{ fontSize: "small" }}>
                  Selecione o tier de desconto para visualizar as indicações.
                </Text>
                <Flex direction="row" gap="small" wrap="wrap">
                  <Button
                    onClick={() => handleSelectDiamondTier(5)}
                    variant={diamondTier === 5 ? "primary" : "secondary"}
                    size="small"
                  >
                    50% de desconto (5 indicações)
                  </Button>
                  <Button
                    onClick={() => handleSelectDiamondTier(10)}
                    variant={diamondTier === 10 ? "primary" : "secondary"}
                    size="small"
                  >
                    100% de desconto (10 indicações)
                  </Button>
                </Flex>
              </>
            ) : (
              <>
                {isCeuOrPosSemMatricula && diamondIndications.length >= 10 && diamondTier !== null && (
                  <Flex direction="row" gap="small" wrap="wrap">
                    <Button
                      onClick={() => handleSelectDiamondTier(5)}
                      variant={diamondTier === 5 ? "primary" : "secondary"}
                      size="small"
                    >
                      50% de desconto (5 indicações)
                    </Button>
                    <Button
                      onClick={() => handleSelectDiamondTier(10)}
                      variant={diamondTier === 10 ? "primary" : "secondary"}
                      size="small"
                    >
                      100% de desconto (10 indicações)
                    </Button>
                  </Flex>
                )}
                <Flex direction="row" gap="small" wrap="wrap">
                  {visibleDiamonds.map((diamond) => {
                    const isSelected = selectedDiamonds.some(d => d.id === diamond.id);
                    return (
                      <Card key={diamond.id}>
                        <Flex direction="column" gap="extra-small">
                          <Text format={{ fontWeight: "demibold" }}>
                            {diamond.nome_do_indicado}
                          </Text>
                          <Text format={{ fontSize: "small" }}>
                            {diamond.nivel_educacional}
                          </Text>
                          <Text format={{ fontSize: "small" }}>
                            Status: {diamond.indicacao_ativa}
                          </Text>
                          {diamond.data_de_expiracao && (
                            <Text format={{ fontSize: "small" }}>
                              Validade: {diamond.data_de_expiracao}
                            </Text>
                          )}
                          <Text format={{ fontSize: "small" }}>
                            Desconto: {isSelected ? "10%" : "—"}
                          </Text>
                          <Button
                            onClick={() => handleToggleDiamond(diamond)}
                            variant={isSelected ? "primary" : "secondary"}
                            size="small"
                          >
                            {isSelected ? "Selecionado" : "Selecionar"}
                          </Button>
                        </Flex>
                      </Card>
                    );
                  })}
                </Flex>
                {selectedDiamonds.length > 0 && (
                  <Text format={{ fontSize: "small" }}>
                    {selectedDiamonds.length} indicação(ões) selecionada(s) — {getDiamondDiscountPercent()}% de desconto.
                  </Text>
                )}
              </>
            )}
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
        {financialPlanData &&
          financialPlanData.condicoes &&
          financialPlanData.condicoes.length > 0 && (
            <>
              <Divider />
              <Heading>Opções de Parcelamento</Heading>

              <Table bordered>
                <TableHead>
                  <TableRow>
                    <TableHeader>Parcelas</TableHeader>
                    <TableHeader>Valor da Parcela</TableHeader>
                    <TableHeader>Categorias</TableHeader>
                    <TableHeader>Descontos Aplicados</TableHeader>
                    <TableHeader>Desconto à Vista</TableHeader>
                    <TableHeader>Valor Final</TableHeader>
                    <TableHeader>Ação</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {financialPlanData.condicoes.map((condition) => {
                    const discountData = getDiscountData(condition.valorParcela, selectedDiscountsByCategory);
                    // Build discount names including diamond indications
                    const diamondLabel = getDiamondDiscountLabel();
                    const discountNames = [
                      ...(diamondLabel ? [diamondLabel] : []),
                      ...(discountData.allDiscounts || []).filter(d => d.categoria !== "aluno_diamante").map(d => d.name)
                    ];
                    return (
                    <TableRow key={condition.codigoCondicao}>
                      <TableCell>{condition.qtdeParcelas}</TableCell>
                      <TableCell>
                        {formatCurrency(condition.valorParcela)}
                      </TableCell>
                      <TableCell>
                        {selectedCategory.length > 0
                          ? selectedCategory.map(cat => categoryLabels[cat] || cat).join(", ")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {discountNames.length > 0
                          ? discountNames.join(", ")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {discountData.pagamentoAVistaPercent > 0
                          ? `${discountData.pagamentoAVistaPercent}%`
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(discountData.finalValue)}
                      </TableCell>
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
                  )})}
                </TableBody>
              </Table>
            </>
          )}

        {/* Summary Section */}
        {selectedCondition &&
          (() => {
            const discountData = getDiscountData(selectedCondition.valorParcela, selectedDiscountsByCategory);
            const { allDiscounts, totalCategoryDiscountValue, totalCategoryDiscountPercent, finalValue, pagamentoAVistaPercent, pagamentoAVistaValue } = discountData;
            const antecipationValue = calculateAntecipationValue(
              finalValue,
              properties,
              selectedCondition,
            );

            return (
              <>
                <Divider />
                <Heading>Resumo</Heading>

                <Flex direction="column" gap="small">
                  <Flex direction="row" justify="between">
                    <Text>Valor da matrícula:</Text>
                    <Text format={{ fontWeight: "bold" }}>
                      {formatCurrency(selectedCondition.valorMatricula)}
                    </Text>
                  </Flex>
                  <Flex direction="row" justify="between">
                    <Text>Valor da Parcela:</Text>
                    <Text format={{ fontWeight: "bold" }}>
                      {formatCurrency(selectedCondition.valorParcela)}
                    </Text>
                  </Flex>

                  {selectedTipoPagamento === "PARCELADO" &&
                    properties.nivel_de_interesse !== NIVEL_INTERESSE_CEU && (
                      <Flex direction="row" justify="between">
                        <Text>Valor do Acrescimo:</Text>
                        <Text format={{ fontWeight: "bold" }}>
                          {formatCurrency(selectedCondition.valorAcrescimo)}
                        </Text>
                      </Flex>
                    )}

                  <Flex direction="row" justify="between">
                    <Text>Quantidade de Parcelas:</Text>
                    <Text format={{ fontWeight: "demibold" }}>
                      {selectedCondition.qtdeParcelas === "1"
                        ? "À vista"
                        : selectedCondition.qtdeParcelas}
                    </Text>
                  </Flex>

                  {/* Show diamond discount in summary if selected */}
                  {selectedDiamonds.length > 0 && (
                    <>
                      <Flex direction="row" justify="between">
                        <Text>Desconto Diamante ({getDiamondDiscountPercent()}%):</Text>
                        <Text format={{ fontWeight: "bold" }}>
                          - {formatCurrency(allDiscounts.find(d => d.categoria === "aluno_diamante")?.appliedValue || 0)}
                        </Text>
                      </Flex>
                      {getDiamondDiscountNames().map((name, idx) => (
                        <Flex key={idx} direction="row" justify="between">
                          <Text format={{ fontSize: "small" }}>
                            {name}
                          </Text>
                        </Flex>
                      ))}
                    </>
                  )}

                  {allDiscounts && allDiscounts.filter(d => d.categoria !== "aluno_diamante").length > 0 && (
                    <>
                      <Flex direction="row" justify="between">
                        <Text>Status do Desconto:</Text>
                        <Text format={{ fontWeight: "demibold" }}>
                          Aprovado
                        </Text>
                      </Flex>
                      {allDiscounts.filter(d => d.categoria !== "aluno_diamante").map((discount, index) => (
                        <Flex key={index} direction="row" justify="between">
                          <Text>
                            {discount.name} ({discount.originalValue})
                          </Text>
                          <Text format={{ fontWeight: "bold" }}>
                            - {formatCurrency(discount.appliedValue)}
                          </Text>
                        </Flex>
                      ))}
                    </>
                  )}

                  {pagamentoAVistaPercent > 0 && (
                    <>
                      <Flex direction="row" justify="between">
                        <Text>Tipo de pagamento:</Text>
                        <Text format={{ fontWeight: "demibold" }}>
                          {paymentTypeOptions.find(opt => opt.value === selectedTipoPagamento)?.label || selectedTipoPagamento}
                        </Text>
                      </Flex>
                      <Flex direction="row" justify="between">
                        <Text>
                          Desconto Pagamento à Vista ({pagamentoAVistaPercent}%):
                        </Text>
                        <Text format={{ fontWeight: "bold" }}>
                          - {formatCurrency(pagamentoAVistaValue)}
                        </Text>
                      </Flex>
                    </>
                  )}

                  <Flex direction="row" justify="between">
                    <Text format={{ fontWeight: "bold" }}>
                      Parcela com desconto:
                    </Text>
                    <Text format={{ fontWeight: "bold" }}>
                      {formatCurrency(finalValue)}
                    </Text>
                  </Flex>

                  <Flex direction="row" justify="between">
                    <Text format={{ fontWeight: "bold" }}>
                      Valor da parcela com antecipação:
                    </Text>
                    <Text format={{ fontWeight: "bold" }}>
                      {formatCurrency(antecipationValue)}
                    </Text>
                  </Flex>
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
        {financialPlanData &&
          (!financialPlanData.condicoes ||
            financialPlanData.condicoes.length === 0) && (
            <Alert title="Nenhuma condição encontrada" variant="warning">
              Não foram encontradas condições de pagamento para esta combinação
              de turma, unidade e tipo de pagamento.
            </Alert>
          )}
      </Flex>
    </Card>
  );
};

