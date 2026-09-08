import { useState, useEffect } from "react";
import {
  Button,
  hubspot,
  Flex,
  Alert,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableHeader,
} from "@hubspot/ui-extensions";
import { CrmPropertyList, useCrmProperties } from "@hubspot/ui-extensions/crm";

hubspot.extend(({ context, runServerlessFunction, actions }) => (
  <Extension
    context={context}
    runServerless={runServerlessFunction}
    sendAlert={actions.addAlert}
    reloadPage={actions.reloadPage}
    refreshObjectProperties={actions.refreshObjectProperties}
  />
));

const Extension = ({
  context,
  runServerless,
  sendAlert,
  reloadPage,
  refreshObjectProperties,
}) => {
  const [loading, setLoading] = useState(false);
  const [staged, setStaged] = useState([]);
  const [adding, setAdding] = useState(false);
  const [propertyLabels, setPropertyLabels] = useState({
    tipoDeContrato: {},
    sistema: {},
  });

  useEffect(() => {
    runServerless({ name: "fetchPropertyLabels" })
      .then(({ response }) => {
        console.log("labels carregadas:", response);
        setPropertyLabels(
          response?.labels || { tipoDeContrato: {}, sistema: {} },
        );
      })
      .catch((err) => {
        console.error("erro ao carregar labels:", err);
      });
  }, []);

  const handleAddContract = async () => {
    setAdding(true);
    try {
      setStaged((prev) => [
        ...prev,
        {
          tipo_de_contrato: properties.tipo_de_contrato,
          sistema: properties.sistema,
          modulo: properties.modulo,
          item_modulo: properties.item_modulo,
          quantos_pdvs: properties.quantos_pdvs || "0",
          quantos_cnpjs: properties.quantos_cnpjs || "0",
          quantos_televendas: properties.quantos_televendas || "0",
          quantas_retaguardas: properties.quantas_retaguardas || "0",
        },
      ]);

      const { response } = await runServerless({
        name: "clearDealProps",
        parameters: { dealId: context.crm.objectId },
      });

      if (!response?.sucesso) {
        sendAlert({ message: "Erro ao limpar os campos.", type: "danger" });
        return;
      }

      refreshObjectProperties();
    } finally {
      setAdding(false);
    }
  };

  const { properties } = useCrmProperties([
    "item_modulo",
    "tipo_de_contrato",
    "sistema",
    "modulo",
    "modelo_de_vendas",
    "quantos_pdvs",
    "quantos_cnpjs",
    "quantos_televendas",
    "quantas_retaguardas",
  ]);
  useEffect(() => {
    if (
      !properties?.modelo_de_vendas ||
      properties.modelo_de_vendas === "Sem modelo"
    )
      return;

    const adicionarModelo = async () => {
      setAdding(true);
      try {
        if (!properties.tipo_de_contrato || !properties.sistema) {
          console.error(
            `modelo_de_vendas "${properties.modelo_de_vendas}" selecionado sem tipo_de_contrato ou sistema preenchidos.`,
          );
          sendAlert({
            message:
              "Preencha Tipo de Contrato e Sistema antes de selecionar um modelo.",
            type: "danger",
          });
          await runServerless({
            name: "clearDealProps",
            parameters: { dealId: context.crm.objectId },
          });
          refreshObjectProperties();
          return;
        }

        setStaged((prev) => [
          ...prev,
          {
            tipo_de_contrato: properties.tipo_de_contrato,
            sistema: properties.sistema,
            modulo: properties.modulo,
            modelo_de_vendas: properties.modelo_de_vendas,
            item_modulo: "",
            quantos_pdvs: properties.quantos_pdvs || "0",
            quantos_cnpjs: properties.quantos_cnpjs || "0",
            quantos_televendas: properties.quantos_televendas || "0",
            quantas_retaguardas: properties.quantas_retaguardas || "0",
          },
        ]);

        const { response } = await runServerless({
          name: "clearDealProps",
          parameters: { dealId: context.crm.objectId },
        });

        if (!response?.sucesso) {
          sendAlert({ message: "Erro ao limpar os campos.", type: "danger" });
          return;
        }

        sendAlert({
          message: `Modelo "${properties.modelo_de_vendas}" adicionado à fila.`,
          type: "success",
        });
        refreshObjectProperties();
      } finally {
        setAdding(false);
      }
    };

    adicionarModelo();
  }, [
    properties?.modelo_de_vendas,
    properties?.tipo_de_contrato,
    properties?.sistema,
    properties?.modulo,
    properties?.quantos_pdvs,
    properties?.quantos_cnpjs,
    properties?.quantos_televendas,
    properties?.quantas_retaguardas,
    context.crm.objectId,
    runServerless,
    sendAlert,
    refreshObjectProperties,
  ]);

  const handleExecute = async () => {
    if (!staged.length) {
      sendAlert({
        message: "Adicione ao menos um lançamento antes de executar.",
        type: "danger",
      });
      return;
    }

    setLoading(true);

    try {
      const { response } = await runServerless({
        name: "createContract",
        parameters: {
          dealId: context.crm.objectId,
          lancamentos: staged,
        },
      });

      if (response?.sucesso) {
        sendAlert({
          message: `${response.itens_processados} item(s) de linha processado(s) com sucesso (${response.itens_criados} criado(s), ${response.itens_atualizados} atualizado(s)).`,
          type: "success",
        });
        setStaged([]);
        setTimeout(() => {
          reloadPage();
        }, 2500);
      } else {
        sendAlert({
          message: `Erro ao processar itens: ${response?.erro || "Erro desconhecido."}`,
          type: "danger",
        });
      }
    } catch (err) {
      sendAlert({ message: `Erro inesperado: ${err.message}`, type: "danger" });
    } finally {
      setLoading(false);
    }
  };
  const fieldsFull =
    !!properties?.tipo_de_contrato &&
    !!properties?.sistema &&
    !!properties?.modulo &&
    !!properties?.item_modulo;

  // "sistema" é checkbox multi-select no HubSpot: o valor vem como uma
  // única string com os selecionados separados por ";".
  const formatSistemas = (rawValue) =>
    (rawValue || "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => propertyLabels.sistema?.[s] ?? s)
      .join(", ");

  return (
    <Flex direction="column" gap="md">
      {!fieldsFull && (
        <Alert variant="warning" title="Campos obrigatórios não preenchidos">
          Selecione Tipo de Contrato, Sistema, Módulo e Itens de Módulo antes de
          executar.
        </Alert>
      )}
      <CrmPropertyList
        direction="row"
        properties={[
          "tipo_de_contrato",
          "sistema",
          "modelo_de_vendas",
          "modulo",
          "item_modulo",
        ]}
      />
      <Button
        onClick={handleAddContract}
        variant="secondary"
        disabled={adding || !fieldsFull}
      >
        {adding ? "Adicionando..." : "Adicionar lançamento"}
      </Button>

      {staged.length > 0 && (
        <Table bordered>
          <TableHead>
            <TableRow>
              <TableHeader>Tipo de Contrato</TableHeader>
              <TableHeader>Sistemas</TableHeader>
              <TableHeader>Ações</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {staged.map((item, index) => (
              <TableRow key={index}>
                <TableCell>
                  {propertyLabels.tipoDeContrato?.[item.tipo_de_contrato] ??
                    item.tipo_de_contrato}
                </TableCell>
                <TableCell>{formatSistemas(item.sistema)}</TableCell>
                <TableCell>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setStaged((prev) => prev.filter((_, i) => i !== index))
                    }
                  >
                    Remover
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Button
        onClick={handleExecute}
        variant="primary"
        disabled={loading || adding || !staged.length}
      >
        {loading ? "Executando..." : "Executar lançamento"}
      </Button>
    </Flex>
  );
};
