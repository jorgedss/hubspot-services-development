import React, { useState, useEffect } from "react";
import {
  Flex,
  Box,
  Text,
  Input,
  DateInput,
  Button,
  Divider,
  Alert,
  Accordion,
  Select,
  hubspot,
  Link,
  LoadingButton,
  Modal,
  ModalBody,
  ModalFooter,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
} from "@hubspot/ui-extensions";
import { useCrmProperties } from "@hubspot/ui-extensions/crm";

// Contagens de dígitos exigidas pelos campos mascarados. O gate, a microcopy e a
// mensagem inline do telefone são montados a partir delas, para que a regra e o
// texto que a descreve não possam divergir.
const CPF_DIGITS = 11;
const POSTAL_CODE_DIGITS = 8;

// Telefone brasileiro: DDI fixo, DDD de 2 dígitos e assinante de 8 (fixo) ou 9
// (celular). PHONE_LOCAL_* conta DDD + assinante, sem o DDI, porque é isso que o
// consultor digita. O DDI quem põe é a máscara.
const BRAZIL_DDI = "55";
const PHONE_LOCAL_MIN_DIGITS = 10;
const PHONE_LOCAL_MAX_DIGITS = 11;

// Fonte única dos rótulos da Seção A: o label de cada Input e o nome que a
// microcopy mostra quando o campo está faltando saem daqui, então renomear um
// campo não pode dessincronizar os dois.
const SECTION_A_LABELS = {
  fullName: "Nome Completo",
  email: "E-mail",
  cpf: "CPF",
  phoneNumber: "Número de Telefone",
  birthDate: "Data de Nascimento",
  postalCode: "CEP",
  street: "Rua",
  streetNumber: "Número",
  addressComplement: "Complemento",
  neighborhood: "Bairro",
  city: "Cidade (Endereço)",
  state: "Estado",
  ibgeCityCode: "Código IBGE da Cidade",
  ibgeBirthplaceCode: "Código IBGE da Naturalidade",
};

// O gate e a microcopy dizem a mesma coisa ao consultor, então cada frase existe
// uma vez. O guard pós-clique é inalcançável enquanto o disabled do botão vale,
// mas ele é mantido de propósito, e uma segunda tradução da frase divergiria.
// Só os nomes dos campos, numa frase: o motivo de cada um já aparece embaixo do
// próprio Input, e repeti-lo aqui inflava o bloco sem informação nova. Os
// rótulos que têm regra de tamanho carregam a contagem entre parênteses, para a
// frase bastar sozinha antes de o consultor tocar no campo.
const missingFieldsMessage = (fields) =>
  `Preencha os campos obrigatórios para cadastrar o aluno: ${fields
    .map((field) => field.label)
    .join(", ")}.`;

const MISSING_RESPONSIBLE_USER_MESSAGE =
  "Usuário responsável não preenchido no Negócio. Preencha a propriedade no Negócio para habilitar o cadastro.";

const normalizeDigits = (value) => String(value || "").replace(/\D/g, "");

// Único ponto que decide o que conta como "os dígitos do CPF": o corte em
// CPF_DIGITS vale para a máscara e para a validação, então o campo nunca mostra
// um valor de 11 dígitos e reclama do tamanho de outro.
const cpfDigits = (value) => normalizeDigits(value).slice(0, CPF_DIGITS);

const formatCpf = (value) => {
  const digits = cpfDigits(value);
  const blocks = [
    digits.slice(0, 3),
    digits.slice(3, 6),
    digits.slice(6, 9),
  ].filter(Boolean);
  const checkDigits = digits.slice(9, CPF_DIGITS);
  const masked = blocks.join(".");
  return checkDigits ? `${masked}-${checkDigits}` : masked;
};

// Dígitos verificadores pelo módulo 11, o mesmo cálculo da Receita Federal.
// Pega todo erro de um dígito e toda transposição, com duas exceções medidas:
// resto 0 e resto 10 viram o mesmo verificador 0, e no segundo verificador o
// peso da primeira posição é 11, que é 0 no módulo 11. Por isso todo CPF cujo
// primeiro verificador saiu de resto 0 ou 10 tem um gêmeo que difere só no
// primeiro dígito. É limite da regra oficial, não desta implementação.
// Sequências de dígito único fecham a conta e são rejeitadas à parte.
const isCpfChecksumValid = (value) => {
  const digits = cpfDigits(value);
  if (digits.length !== CPF_DIGITS) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  // Pesos decrescentes a partir de length + 1: 10 a 2 no primeiro verificador,
  // 11 a 2 no segundo, que já inclui o primeiro no cálculo.
  const checkDigit = (length) => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(digits[i]) * (length + 1 - i);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return (
    checkDigit(9) === Number(digits[9]) &&
    checkDigit(10) === Number(digits[10])
  );
};

// Descarta o DDI quando ele já veio no valor, para a máscara reinseri-lo sempre
// na mesma posição e o resultado ser idempotente.
//
// Dois sinais de DDI, e os dois são necessários. Um "+55" literal é explícito, e
// é assim que começa tudo o que sai daqui, então reaplicar a máscara sobre o
// próprio resultado nunca promove o DDI a DDD, nem quando o número está pela
// metade. Só dígitos, sem o "+", o sinal é o comprimento: DDD 55 existe (Santa
// Maria, RS), então "5599999999" é um fixo de lá, não um DDI com 8 dígitos.
const phoneLocalDigits = (value) => {
  const raw = String(value || "");
  const digits = normalizeDigits(raw);
  const hasExplicitDdi = new RegExp(`^\\s*\\+\\s*${BRAZIL_DDI}`).test(raw);
  const withoutDdi =
    digits.startsWith(BRAZIL_DDI) &&
    (hasExplicitDdi || digits.length > PHONE_LOCAL_MAX_DIGITS)
      ? digits.slice(BRAZIL_DDI.length)
      : digits;
  return withoutDdi.slice(0, PHONE_LOCAL_MAX_DIGITS);
};

// +55 (62) 99999-9999. O DDI aparece sozinho no primeiro dígito digitado, e o
// consultor nunca precisa digitá-lo.
//
// Este é também o formato que sai do card, em celular na MuleSoft e na
// propriedade numero_de_telefone, do mesmo jeito que o cpf sai mascarado. Não
// existe versão só de dígitos do telefone em nenhum payload.
const formatPhoneNumber = (value) => {
  const digits = phoneLocalDigits(value);
  if (!digits) return "";

  const areaCode = digits.slice(0, 2);
  const subscriber = digits.slice(2);
  const parts = [`+${BRAZIL_DDI}`];

  // O parêntese só fecha quando já existe dígito depois dele. Fechando no
  // segundo dígito do DDD, o backspace apagaria o ")" e a máscara o devolveria
  // no mesmo lugar, deixando o segundo dígito do DDD impossível de apagar.
  parts.push(subscriber ? `(${areaCode})` : `(${areaCode}`);

  if (subscriber) {
    // Celular tem 9 dígitos e quebra 5-4, fixo tem 8 e quebra 4-4.
    const splitAt = subscriber.length > 8 ? 5 : 4;
    parts.push(
      subscriber.length > splitAt
        ? `${subscriber.slice(0, splitAt)}-${subscriber.slice(splitAt)}`
        : subscriber,
    );
  }

  return parts.join(" ");
};

// Motivo pelo qual um campo obrigatório não passa, ou null quando passa. Fonte
// única: a mensagem embaixo do Input e a lista que explica o botão desabilitado
// saem daqui, então as duas nunca podem discordar. Sem gênero no texto, porque o
// mesmo motivo serve para "Rua" e para "Bairro".
const EMPTY_FIELD_REASON = "campo vazio";

const filledReason = (value) =>
  String(value || "").trim() === "" ? EMPTY_FIELD_REASON : null;

const cpfReason = (value) => {
  const digits = cpfDigits(value);
  if (digits.length === 0) return EMPTY_FIELD_REASON;
  if (digits.length !== CPF_DIGITS) return `precisa de ${CPF_DIGITS} dígitos`;
  if (!isCpfChecksumValid(digits)) return "número inválido, confira os dígitos";
  return null;
};

// Só o mínimo é testado: phoneLocalDigits já corta no máximo, então não existe
// valor no estado com mais dígitos locais do que o permitido.
const phoneReason = (value) => {
  const digits = phoneLocalDigits(value);
  if (digits.length === 0) return EMPTY_FIELD_REASON;
  if (digits.length < PHONE_LOCAL_MIN_DIGITS) {
    return "precisa de DDD e 8 ou 9 dígitos";
  }
  return null;
};

const postalCodeReason = (value) => {
  const digits = normalizeDigits(value);
  if (digits.length === 0) return EMPTY_FIELD_REASON;
  if (digits.length !== POSTAL_CODE_DIGITS) {
    return `precisa de ${POSTAL_CODE_DIGITS} dígitos`;
  }
  return null;
};

const birthDateReason = (value) =>
  value && value.year != null && value.month != null && value.date != null
    ? null
    : EMPTY_FIELD_REASON;

// Embaixo do Input o label já está logo acima, então a mensagem é só o motivo.
const fieldMessage = (reason) =>
  `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`;

// Define the extension to be run within the HubSpot CRM
hubspot.extend(({ context, runServerlessFunction, actions }) => (
  <CheckoutCard
    context={context}
    runServerless={runServerlessFunction}
    actions={actions}
  />
));

// O modal é montado pelo prop `overlay` do LoadingButton, e overlay só fecha
// por actions.closeOverlay(id), que o card injeta como prop closeOverlay.
// reactions.closeModal(id) vale para modal aberto por reactions.openModal e
// neste arranjo não fecha nada. Mesmo padrão dos modais do orcamento-toolkit.
const DISCIPLINAS_MODAL_ID = "consultarDatasInicioModal";

// studentStartDate tem uma forma só: { year, month (base zero), date,
// formattedDate }, ou null. Nunca timestamp. formattedDate é opcional no
// payload do DateInput, e recalculá-lo aqui é o que mantém determinístico o
// ramo `if (x.formattedDate)` dos formatDate de generateEnrollment e
// generateCheckoutLink.
const normalizeDateObject = (dateObject) => {
  if (!dateObject) return null;
  const { year, month, date } = dateObject;
  if (
    typeof year !== "number" ||
    typeof month !== "number" ||
    typeof date !== "number"
  ) {
    return null;
  }
  return {
    year,
    month,
    date,
    formattedDate: `${String(month + 1).padStart(2, "0")}/${String(
      date,
    ).padStart(2, "0")}/${year}`,
  };
};

// Propriedade de data do Deal chega como epoch em milissegundos. A forma final
// sai de normalizeDateObject, para não existirem duas construções do mesmo
// objeto, e os getters UTC evitam que o fuso do consultor mova o dia.
const formatTimestampToDateObject = (timestamp) => {
  if (!timestamp) return null;
  const date = new Date(parseInt(timestamp));
  if (isNaN(date.getTime())) return null;
  return normalizeDateObject({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    date: date.getUTCDate(),
  });
};

const dateObjectToUtcMillis = (dateObject) =>
  dateObject
    ? Date.UTC(dateObject.year, dateObject.month, dateObject.date)
    : null;

// O formattedDate em MM/DD/YYYY é sentinela de ramo, nunca vai para a tela.
const formatDateObjectToBr = (dateObject) => {
  if (!dateObject) return "";
  const day = String(dateObject.date).padStart(2, "0");
  const month = String(dateObject.month + 1).padStart(2, "0");
  return `${day}/${month}/${dateObject.year}`;
};

const isSameDateObject = (a, b) =>
  Boolean(a) &&
  Boolean(b) &&
  a.year === b.year &&
  a.month === b.month &&
  a.date === b.date;

const DisciplinaRow = ({
  disciplina,
  todayUtcMillis,
  selectedDate,
  onSelect,
  closeOverlay,
}) => {
  const startDateObject = formatTimestampToDateObject(
    disciplina.dataInicioTimestamp,
  );
  const hasStarted =
    disciplina.dataInicioTimestamp != null &&
    disciplina.dataInicioTimestamp < todayUtcMillis;
  const isSelectable = Boolean(startDateObject) && !hasStarted;
  const isSelected = isSelectable && isSameDateObject(selectedDate, startDateObject);

  return (
    <TableRow>
      <TableCell>
        {disciplina.nome ||
          disciplina.descricao ||
          disciplina.disciplina ||
          "-"}
      </TableCell>
      <TableCell>{disciplina.cargaHoraria || "-"}</TableCell>
      <TableCell>{disciplina.modalidade || "-"}</TableCell>
      <TableCell>
        {startDateObject
          ? formatDateObjectToBr(startDateObject)
          : disciplina.periodoAula || "Não programado"}
      </TableCell>
      <TableCell>
        {!startDateObject
          ? "Não programado"
          : hasStarted
            ? "Já iniciada"
            : "Disponível"}
      </TableCell>
      <TableCell>
        <Button
          variant={isSelected ? "primary" : "secondary"}
          disabled={!isSelectable}
          onClick={() => {
            onSelect(startDateObject);
            closeOverlay(DISCIPLINAS_MODAL_ID);
          }}
        >
          {isSelected ? "Selecionado" : "Selecionar"}
        </Button>
      </TableCell>
    </TableRow>
  );
};

const DisciplinasModal = ({
  error,
  data,
  classCode,
  classIdentifier,
  todayUtcMillis,
  selectedDate,
  onSelect,
  closeOverlay,
}) => (
  <Modal
    id={DISCIPLINAS_MODAL_ID}
    title="Datas de início das disciplinas"
    width="lg"
  >
    <ModalBody>
      {error ? (
        <Alert title="Erro" variant="danger">
          {error}
        </Alert>
      ) : !data?.disciplinas?.length ? (
        <Text>
          Nenhuma disciplina retornada para esta turma. Informe a data de início
          manualmente no campo "Data de Início do Aluno".
        </Text>
      ) : (
        <Flex direction="column" gap="small">
          <Text variant="microcopy">
            {data.identificadorTurma || classIdentifier} · turma{" "}
            {data.codigoTurma || classCode} · {data.disciplinas.length}{" "}
            disciplina(s)
          </Text>
          <Table bordered>
            <TableHead>
              <TableRow>
                <TableHeader>Disciplina</TableHeader>
                <TableHeader>Carga horária</TableHeader>
                <TableHeader>Modalidade</TableHeader>
                <TableHeader>Início</TableHeader>
                <TableHeader>Situação</TableHeader>
                <TableHeader>Ação</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.disciplinas.map((disciplina, index) => (
                <DisciplinaRow
                  key={`${disciplina.codigo}-${index}`}
                  disciplina={disciplina}
                  todayUtcMillis={todayUtcMillis}
                  selectedDate={selectedDate}
                  onSelect={onSelect}
                  closeOverlay={closeOverlay}
                />
              ))}
            </TableBody>
          </Table>
        </Flex>
      )}
    </ModalBody>
    <ModalFooter>
      <Button
        variant="secondary"
        onClick={() => closeOverlay(DISCIPLINAS_MODAL_ID)}
      >
        Fechar
      </Button>
    </ModalFooter>
  </Modal>
);

const CheckoutCard = ({ context, runServerless, actions }) => {
  const { properties: dealProperties } = useCrmProperties([
    "e_mail",
    "nome_completo",
    "numero_de_telefone",
    "usuarioresponsavel",
    "cpf",
    "permitimatricula4modulo",
    "permitimatriculainadiplente",
    "geracaodeparcelaautomatica",
    "tipo_de_matricula",
    "datamatricula",
    "escolaridade_do_aluno",
    "consultoremail",
    "codigocontrato",
    "codigocondicao",
    "codigoconsultor",
    "codigodesconto",
    "databasegeracaoparcela",
    "turmaidentificador",
    "turmacodigo",
    "id_da_matricula",
    "link_de_checkout",
    "tipopagamento",
    "valoracrescimo",
    "modalidade_de_interesse",
    "nivel_de_interesse",
    "data_de_inicio",
    "prazo_de_cobranca",
    "data_de_nascimento",
    "cep",
    "rua",
    "numero",
    "complemento",
    "bairro",
    "city",
    "sigla_estado",
    "diamantes_orcados",
    "aluno_cadastrado_status"
  ]);

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneError, setPhoneError] = useState(false);
  const [phoneValidationMessage, setPhoneValidationMessage] = useState("");
  const [cpfError, setCpfError] = useState(false);
  const [cpfValidationMessage, setCpfValidationMessage] = useState("");
  const [cpf, setCpf] = useState("");
  const [birthDate, setBirthDate] = useState(undefined);
  const [postalCode, setPostalCode] = useState("");
  const [state, setState] = useState("");
  const [streetNumber, setStreetNumber] = useState("");
  const [addressComplement, setAddressComplement] = useState("");
  const [street, setStreet] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [ibgeCityCode, setIbgeCityCode] = useState("");
  const [ibgeBirthplaceCode, setIbgeBirthplaceCode] = useState("");
  const [loadingPostalCode, setLoadingPostalCode] = useState(false);
  const [loadingRegistration, setLoadingRegistration] = useState(false);
  const [loadingEnrollment, setLoadingEnrollment] = useState(false);
  const [loadingSaveDraft, setLoadingSaveDraft] = useState(false);
  const [loadingRegenerateCheckout, setLoadingRegenerateCheckout] = useState(false);
  const [loadingDisciplinas, setLoadingDisciplinas] = useState(false);
  const [disciplinasData, setDisciplinasData] = useState(null);
  const [disciplinasError, setDisciplinasError] = useState("");
  const [alertMessage, setAlertMessage] = useState(null);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [educationType, setEducationType] = useState("");
  const [registeredCpf, setRegisteredCpf] = useState(null);

  const [studentStartModule, setStudentStartModule] = useState("");
  const [studentStartDate, setStudentStartDate] = useState(null);

  const today = new Date();
  const minDay = String(today.getDate()).padStart(2, "0");
  const minMonth = String(today.getMonth() + 1).padStart(2, "0");
  const minYear = today.getFullYear();
  const minDate = {
    year: minYear,
    month: parseInt(minMonth) - 1,
    date: parseInt(minDay),
  };

  // Meia-noite UTC do dia de hoje no fuso do consultor. Usado para marcar
  // disciplinas já iniciadas, na mesma base local de minDate.
  const todayUtcMillis = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );

  const allowFourthModuleEnrollment =
    dealProperties.permitimatricula4modulo === "true";
  const allowDelinquentEnrollment =
    dealProperties.permitimatriculainadiplente === "true";
  const automaticInstallmentGeneration =
    dealProperties.geracaodeparcelaautomatica === "true";
  const enrollmentType = dealProperties.tipo_de_matricula || "";
  const enrollmentDate = dealProperties.datamatricula || "";
  const studentCpf = dealProperties.cpf || "";
  const consultantEmail = dealProperties.consultoremail || "";
  const contractCode = dealProperties.codigocontrato || "";
  const responsibleUser = String(dealProperties.usuarioresponsavel || "");
  const conditionCode = dealProperties.codigocondicao || "";
  const discountCode = dealProperties.codigodesconto || "";
  const consultantCode = dealProperties.codigoconsultor || "";
  const source = "HUBSPOT";

  // A propriedade é booleancheckbox, mas o único precedente verificado no card é
  // de enumeration/select, então a comparação tolera os dois.
  const isFlagEnabled = (value) => String(value).toLowerCase() === "true";

  // refreshObjectProperties é tipada como () => void, ela não devolve Promise,
  // então o await do handler não garante que a flag já chegou. registeredCpf
  // cobre essa janela, e amarrar ao cpf faz o efeito expirar quando o consultor
  // troca de CPF depois de cadastrar.
  const justRegistered =
    registeredCpf !== null && registeredCpf === normalizeDigits(cpf);
  const isStudentRegistered =
    isFlagEnabled(dealProperties.aluno_cadastrado_status) || justRegistered;

  const classIdentifier = dealProperties.turmaidentificador || "";
  const classCode = dealProperties.turmacodigo || "";
  const enrollmentId = dealProperties.id_da_matricula || "";
  const link = dealProperties.link_de_checkout || "";
  const typeOfInterest = dealProperties.modalidade_de_interesse || "";
  const levelOfInterest = dealProperties.nivel_de_interesse || "";
  const installmentBaseDate = dealProperties.databasegeracaoparcela || "";

  // Único gate da data de início do aluno: campo, validação, regerar de
  // checkout e o mesIngresso de generateEnrollment.
  const isEadPos =
    typeOfInterest === "EAD" && levelOfInterest === "Pós-graduação";

  // A data que a matrícula no SEI de fato usou, lida direto do Deal. O campo
  // pode estar vazio por a data já ter passado, e o regerar de checkout precisa
  // repetir a data original, não a que o consultor escolheria agora.
  const persistedStartDate = formatTimestampToDateObject(
    dealProperties.data_de_inicio,
  );

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

  const fetchAddressByPostalCode = async (postalCodeValue) => {
    if (!postalCodeValue || postalCodeValue.length < POSTAL_CODE_DIGITS) return;

    setLoadingPostalCode(true);
    setAlertMessage(null);

    try {
      const { response } = await runServerless({
        name: "fetchPostalCode",
        parameters: { postalCode: postalCodeValue },
      });
      if (response.status === "SUCCESS" && response.response) {
        const { response: data } = response;
        setStreet(data.street || "");
        setNeighborhood(data.neighborhood || "");
        setCity(data.city || "");
        setIbgeCityCode(data.ibgeCode || "");
        setIbgeBirthplaceCode(data.ibgeCode || "");
        setState(data.state || "");

        setAlertMessage({
          type: "success",
          message: "Endereço preenchido automaticamente!",
        });
      } else {
        setAlertMessage({
          type: "warning",
          message: formatOriginError(response?.origin, response?.message || "CEP não encontrado. Preencha manualmente."),
        });
      }
    } catch (error) {
      setAlertMessage({
        type: "danger",
        message: formatOriginError("SISTEMA", "Erro ao buscar CEP. Tente novamente."),
      });
    } finally {
      setLoadingPostalCode(false);
    }
  };

  const sortDisciplinasByStartDate = (list) =>
    [...list].sort((a, b) => {
      const aMillis = a.dataInicioTimestamp;
      const bMillis = b.dataInicioTimestamp;
      if (aMillis == null && bMillis == null) return 0;
      if (aMillis == null) return 1;
      if (bMillis == null) return -1;
      return aMillis - bMillis;
    });

  // Turma sem código é barrada pelo disabled do botão, não aqui: sem alternar
  // loadingDisciplinas o modal nunca abriria para mostrar o erro.
  const fetchDisciplinas = async () => {
    setLoadingDisciplinas(true);
    setDisciplinasError("");

    try {
      const { response } = await runServerless({
        name: "fetchTurmaDisciplinas",
        parameters: { classCode },
      });

      if (!response) {
        setDisciplinasData(null);
        setDisciplinasError(
          "Tempo de resposta esgotado ao consultar as disciplinas. Tente novamente.",
        );
        return;
      }

      if (response.status === "SUCCESS") {
        const payload = response.response || {};
        setDisciplinasData({
          ...payload,
          disciplinas: sortDisciplinasByStartDate(payload.disciplinas || []),
        });
      } else {
        setDisciplinasData(null);
        setDisciplinasError(
          formatOriginError(
            response?.origin,
            response?.message ||
              "Não foi possível carregar as disciplinas da turma.",
          ),
        );
      }
    } catch (error) {
      console.error("Erro ao buscar disciplinas da turma:", error);
      setDisciplinasData(null);
      setDisciplinasError(
        formatOriginError(
          "SISTEMA",
          "Erro ao buscar disciplinas da turma. Tente novamente.",
        ),
      );
    } finally {
      setLoadingDisciplinas(false);
    }
  };

  useEffect(() => {
    const hasLoadedProperties =
      dealProperties && Object.keys(dealProperties).length > 0;

    if (!initialLoadDone && hasLoadedProperties) {
      // Passa pela máscara: a propriedade do Negócio pode ter vindo sem
      // pontuação, e sem isso o campo abre num formato que ele mesmo não produz.
      if (dealProperties.cpf) setCpf(formatCpf(dealProperties.cpf));
      if (dealProperties.e_mail) setEmail(dealProperties.e_mail);
      if (dealProperties.nome_completo)
        setFullName(dealProperties.nome_completo);
      // Mesma razão do cpf: a propriedade pode ter vindo em E.164 ou sem nada,
      // e o campo precisa abrir no formato que ele mesmo produz.
      if (dealProperties.numero_de_telefone)
        setPhoneNumber(formatPhoneNumber(dealProperties.numero_de_telefone));

      if (dealProperties.data_de_nascimento) {
        const dateObj = formatTimestampToDateObject(
          dealProperties.data_de_nascimento,
        );
        if (dateObj) setBirthDate(dateObj);
      }

      if (dealProperties.cep) setPostalCode(dealProperties.cep);
      if (dealProperties.rua) setStreet(dealProperties.rua);
      if (dealProperties.numero) setStreetNumber(dealProperties.numero);
      if (dealProperties.complemento)
        setAddressComplement(dealProperties.complemento);
      if (dealProperties.bairro) setNeighborhood(dealProperties.bairro);
      if (dealProperties.city) setCity(dealProperties.city);
      if (dealProperties.sigla_estado) setState(dealProperties.sigla_estado);

      // O campo só inicia preenchido quando a data gravada ainda é escolhível.
      // Data no passado abre vazio, para o consultor escolher a próxima
      // disciplina aberta, e a validação obrigatória cobra essa escolha.
      if (dealProperties.data_de_inicio) {
        const startDateObject = formatTimestampToDateObject(
          dealProperties.data_de_inicio,
        );
        if (
          startDateObject &&
          dateObjectToUtcMillis(startDateObject) >= todayUtcMillis
        ) {
          setStudentStartDate(startDateObject);
        }
      }

      setInitialLoadDone(true);
    }
  }, [dealProperties, initialLoadDone]);

  useEffect(() => {
     setEducationType(dealProperties.escolaridade_do_aluno);
  }, [dealProperties.escolaridade_do_aluno]);

  useEffect(() => {
    if (!initialLoadDone) return;

    const cleanedPostalCode = normalizeDigits(postalCode);
    if (cleanedPostalCode.length === POSTAL_CODE_DIGITS) {
      fetchAddressByPostalCode(cleanedPostalCode);
    }
  }, [postalCode, initialLoadDone]);

  const formatBirthDateForDeal = (dateObj) => {
    if (!dateObj) return "";
    try {
      const utcTimestamp = Date.UTC(
        dateObj.year,
        dateObj.month,
        dateObj.date,
        0,
        0,
        0,
        0,
      );
      return utcTimestamp.toString();
    } catch (error) {
      console.error("Erro ao formatar data para Deal:", error);
      return "";
    }
  };

  const prepareFormDataForDeal = () => {
    return {
      nome_completo: fullName,
      e_mail: email,
      cpf: cpf,
      numero_de_telefone: phoneNumber,
      data_de_nascimento: formatBirthDateForDeal(birthDate),
      cep: postalCode,
      rua: street,
      numero: streetNumber,
      complemento: addressComplement,
      bairro: neighborhood,
      city: city,
      sigla_estado: state,
    };
  };

  const handleSaveDraft = async () => {
    setLoadingSaveDraft(true);
    setAlertMessage(null);

    try {
      const formData = prepareFormDataForDeal();

      const { response } = await runServerless({
        name: "updateDealRegisterInformations",
        parameters: {
          dealId: context.crm.objectId,
          ...formData,
        },
      });

      if (response?.status === "SUCCESS") {
        await actions.refreshObjectProperties();
        setAlertMessage({
          type: "success",
          message: "Rascunho salvo.",
        });
      } else {
        setAlertMessage({
          type: "danger",
          message: formatOriginError(response?.origin, response?.message || "Erro ao salvar rascunho."),
        });
      }
    } catch (error) {
      console.error("Erro ao salvar rascunho:", error);
      setAlertMessage({
        type: "danger",
        message: formatOriginError("SISTEMA", "Erro ao salvar rascunho."),
      });
    } finally {
      setLoadingSaveDraft(false);
    }
  };

  const saveToDeal = async () => {
    try {
      const formData = prepareFormDataForDeal();

      const { response } = await runServerless({
        name: "updateDealRegisterInformations",
        parameters: {
          dealId: context.crm.objectId,
          ...formData,
        },
      });

      return response?.status === "SUCCESS";
    } catch (error) {
      console.error("Erro ao salvar no Deal:", error);
      return false;
    }
  };

  // Uma lista só alimenta o disabled do botão e a mensagem que o explica, para
  // os dois nunca discordarem. Os rótulos vêm de SECTION_A_LABELS, a mesma fonte
  // dos labels dos Inputs. Um campo, um motivo, e reason null é o único critério
  // de válido, então o gate e o texto que o explica não podem divergir.
  const requiredFieldChecks = [
    { label: SECTION_A_LABELS.fullName, reason: filledReason(fullName) },
    { label: SECTION_A_LABELS.email, reason: filledReason(email) },
    {
      label: `${SECTION_A_LABELS.cpf} (${CPF_DIGITS} dígitos válidos)`,
      reason: cpfReason(cpf),
    },
    {
      label: `${SECTION_A_LABELS.phoneNumber} (DDD e 8 ou 9 dígitos)`,
      reason: phoneReason(phoneNumber),
    },
    { label: SECTION_A_LABELS.birthDate, reason: birthDateReason(birthDate) },
    { label: SECTION_A_LABELS.postalCode, reason: postalCodeReason(postalCode) },
    { label: SECTION_A_LABELS.street, reason: filledReason(street) },
    { label: SECTION_A_LABELS.streetNumber, reason: filledReason(streetNumber) },
    { label: SECTION_A_LABELS.neighborhood, reason: filledReason(neighborhood) },
    { label: SECTION_A_LABELS.city, reason: filledReason(city) },
    { label: SECTION_A_LABELS.state, reason: filledReason(state) },
    {
      label: SECTION_A_LABELS.ibgeCityCode,
      reason: filledReason(ibgeCityCode),
    },
    {
      label: SECTION_A_LABELS.ibgeBirthplaceCode,
      reason: filledReason(ibgeBirthplaceCode),
    },
  ];

  const invalidRequiredFields = requiredFieldChecks.filter(
    (check) => check.reason !== null,
  );
  const isRegistrationFormValid = invalidRequiredFields.length === 0;
  const hasResponsibleUser = responsibleUser.trim() !== "";

  const handleRegisterStudent = async () => {
    if (invalidRequiredFields.length > 0) {
      setAlertMessage({
        type: "danger",
        message: missingFieldsMessage(invalidRequiredFields),
      });
      return;
    }

    if (!hasResponsibleUser) {
      setAlertMessage({
        type: "danger",
        message: MISSING_RESPONSIBLE_USER_MESSAGE,
      });
      return;
    }

    setLoadingRegistration(true);
    setAlertMessage(null);

    try {
      await saveToDeal();

      const { response } = await runServerless({
        name: "registerStudent",
        parameters: {
          dealId: context.crm.objectId,
          name: fullName,
          email: email,
          phoneNumber: phoneNumber,
          user: responsibleUser,
          cpf,
          birthDate,
          postalCode: normalizeDigits(postalCode),
          state,
          streetNumber,
          addressComplement,
          street,
          neighborhood,
          city,
          ibgeCityCode,
          ibgeBirthplaceCode,
        },
      });

      if (response.status === "SUCCESS") {
        setRegisteredCpf(normalizeDigits(cpf));
        await actions.refreshObjectProperties();
        setAlertMessage({
          type: "success",
          message: "Aluno cadastrado com sucesso!",
        });
      } else {
        setAlertMessage({
          type: "danger",
          message: formatOriginError(response.origin, response.error || response.message || "Erro ao cadastrar aluno."),
        });
      }
    } catch (error) {
      setAlertMessage({
        type: "danger",
        message: "Erro ao processar cadastro. Tente novamente.",
      });
    } finally {
      setLoadingRegistration(false);
    }
  };

  const isEnrollmentFormValid = () => {
    const isStudentStartModuleRequired =
      (typeOfInterest === "Ao Vivo" || typeOfInterest === "Presencial") &&
      levelOfInterest === "Pós-graduação";

    const isStudentStartModuleValid = isStudentStartModuleRequired
      ? studentStartModule !== ""
      : true;

    // normalizeDateObject garante objeto completo ou null, nunca meio-termo,
    // então year presente já prova que existe data escolhida.
    const isStudentStartDateValid = isEadPos
      ? typeof studentStartDate?.year === "number"
      : true;

    return (
      enrollmentType &&
      educationType &&
      studentCpf &&
      consultantEmail &&
      conditionCode &&
      classIdentifier &&
      isStudentStartModuleValid &&
      isStudentStartDateValid
    );
  };

  const handleGenerateEnrollment = async () => {
    setLoadingEnrollment(true);
    setAlertMessage(null);

    try {
      const { response } = await runServerless({
        name: "generateEnrollment",
        parameters: {
          dealId: context.crm.objectId,
          enrollmentType,
          additionalAmount: dealProperties.valoracrescimo,
          studentStartModule,
          studentStartDate,
          typeOfInterest,
          levelOfInterest,
          educationType,
          studentCpf,
          consultantEmail,
          conditionCode,
          discountCodes: discountCode,
          installmentBaseDate,
          classIdentifier,
          automaticInstallmentGeneration
        },
      });
      console.log("Enrollment Response:", response);

      if (!response) {
        setAlertMessage({
          type: "danger",
          message:
            "Tempo de resposta de 15 segundos para gerar matrícula esgotado. Tente novamente.",
        });
        return;
      }
      await actions.refreshObjectProperties();

      if (response?.status === "SUCCESS") {
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const updatedNumberOfInstallments = dealProperties.prazo_de_cobranca;
        if (response.registerNumber) {
          console.log("Generating checkout link...");
          try {
            const checkoutResponse = await runServerless({
              name: "generateCheckoutLink",
              parameters: {
                dealId: context.crm.objectId,
                enrollmentId: response.registerNumber,
                paymentType: dealProperties.tipopagamento,
                typeOfInterest,
                levelOfInterest,
                studentStartModule,
                studentStartDate,
                numberOfInstallments: updatedNumberOfInstallments,
              },
            });

            if (!checkoutResponse.response) {
              setAlertMessage({
                type: "danger",
                message:
                  "Tempo de resposta de 15 segundos para gerar link de checkout esgotado. Tente novamente.",
              });
              return;
            }

            if (checkoutResponse.response?.status === "SUCCESS") {
              await actions.refreshObjectProperties();
              setAlertMessage({
                type: "success",
                message:
                  "Matrícula gerada e link de checkout criado com sucesso!",
              });

              if(dealProperties.diamantes_orcados) {
                await runServerless({
                  name: "updateDiamondStatus",
                  parameters: {
                    diamonds: dealProperties.diamantes_orcados,
                  },
                });
              }
            } else {
              const cr = checkoutResponse.response;
              setAlertMessage({
                type: "success",
                message: `Matrícula gerada! ${formatOriginError(cr?.origin, cr?.message || "Erro ao gerar link de checkout.")}`,
              });
            }
        } catch (checkoutError) {
            console.error("Erro ao gerar link de checkout:", checkoutError);
            setAlertMessage({
              type: "success",
              message: `Matrícula gerada! ${formatOriginError("SISTEMA", "Erro ao gerar link de checkout.")}`,
            });
          }
        } else {
          setAlertMessage({
            type: "success",
            message: "Matrícula gerada com sucesso!",
          });
        }
      } else {
        setAlertMessage({
          type: "danger",
          message: formatOriginError(response?.origin, response?.message || "Erro ao gerar matrícula."),
        });
      }
    } catch (error) {
      console.error("Erro ao gerar matrícula:", error);
      setAlertMessage({
        type: "danger",
        message: formatOriginError("SISTEMA", "Erro ao processar matrícula. Tente novamente."),
      });
    } finally {
      setLoadingEnrollment(false);
    }
  };

  const handleRegenerateCheckoutLink = async () => {
    setAlertMessage(null);

    // A matrícula no SEI já usou uma data, e o link de checkout tem que repetir
    // exatamente essa. A gravada no Deal tem prioridade sobre o campo, que pode
    // ter aberto vazio por a data já ter passado.
    const startDateForCheckout = persistedStartDate || studentStartDate;

    // Deal matriculado antes de data_de_inicio passar a ser gravada no Deal não
    // tem a propriedade preenchida, e sem esta barreira generateCheckoutLink
    // postaria data_de_inicio: null.
    if (isEadPos && typeof startDateForCheckout?.year !== "number") {
      setAlertMessage({
        type: "warning",
        message:
          "Informe a data de início do aluno antes de regerar o link de checkout.",
      });
      return;
    }

    setLoadingRegenerateCheckout(true);

    try {
      const { response } = await runServerless({
        name: "generateCheckoutLink",
        parameters: {
          dealId: context.crm.objectId,
          enrollmentId: enrollmentId,
          paymentType: dealProperties.tipopagamento,
          typeOfInterest,
          levelOfInterest,
          studentStartModule,
          studentStartDate: startDateForCheckout,
          numberOfInstallments: dealProperties.prazo_de_cobranca,
        },
      });

      if (!response) {
        setAlertMessage({
          type: "danger",
          message:
            "Tempo de resposta esgotado. Tente novamente.",
        });
        return;
      }

      if (response?.status === "SUCCESS") {
        await actions.refreshObjectProperties();
        setAlertMessage({
          type: "success",
          message: "Link de checkout gerado com sucesso!",
        });
      } else {
        setAlertMessage({
          type: "danger",
          message: formatOriginError(response?.origin, response?.message || "Erro ao regerar link de checkout."),
        });
      }
    } catch (error) {
      console.error("Erro ao regerar link de checkout:", error);
      setAlertMessage({
        type: "danger",
        message: formatOriginError("SISTEMA", "Erro ao regerar link de checkout. Tente novamente."),
      });
    } finally {
      setLoadingRegenerateCheckout(false);
    }
  };

  // A máscara entra pelo onInput, que é o único evento por tecla do Input: o
  // onChange do @hubspot/ui-extensions só dispara na confirmação do valor, no
  // blur e no submit, e com ele sozinho a pontuação só aparecia ao sair do campo.
  // A documentação do componente recomenda não escrever estado no onInput, então
  // o onChange continua ligado ao mesmo handler: ele é o caminho do submit e
  // reaplica a máscara sobre o valor confirmado. As duas chamadas são seguras
  // porque formatCpf e formatPhoneNumber são idempotentes.
  const handleCpfInput = (value) => setCpf(formatCpf(value));

  const handlePhoneNumberInput = (value) =>
    setPhoneNumber(formatPhoneNumber(value));

  // Validação segue no onBlur: o aviso de CPF inválido só faz sentido sobre um
  // número que o consultor terminou de digitar, senão pisca a cada tecla até o
  // 11o dígito. Escreve estado e devolve o predicado, como validatePhoneNumber.
  // O gate do botão não depende daqui, ele usa requiredFieldChecks.
  const validateCpf = (value) => {
    const reason = cpfReason(value);
    setCpfError(reason !== null);
    setCpfValidationMessage(reason === null ? "" : fieldMessage(reason));
    return reason === null;
  };

  const formatPostalCode = (value) => {
    const cleaned = normalizeDigits(value);
    return cleaned.replace(/^(\d{5})(\d)/, "$1-$2");
  };

  // Mesmo desenho de validateCpf, e no onBlur pela mesma razão: "precisa de DDD
  // e 8 ou 9 dígitos" a cada tecla é ruído até o número estar completo.
  const validatePhoneNumber = (value) => {
    const reason = phoneReason(value);
    setPhoneError(reason !== null);
    setPhoneValidationMessage(reason === null ? "" : fieldMessage(reason));
    return reason === null;
  };

  return (
    <Flex direction="column" gap="medium">
      <Text format={{ fontWeight: "bold" }} variant="microcopy">
        Cartão de Checkout - Gestão de Matrículas
      </Text>

      {alertMessage && (
        <Alert title={alertMessage.message} variant={alertMessage.type}>
          {alertMessage.message}
        </Alert>
      )}

      <Accordion title="Seção A: Cadastro de Aluno" defaultOpen={true}>
        <Flex direction="column" gap="small">
          <Input
            label={SECTION_A_LABELS.fullName}
            name="fullName"
            value={fullName}
            onChange={setFullName}
            required={true}
            placeholder="Digite o nome completo"
          />

          <Flex direction="row" gap="small">
            <Input
              label={SECTION_A_LABELS.email}
              name="email"
              value={email}
              onChange={setEmail}
              required={true}
              placeholder="email@exemplo.com"
            />
            <Input
              label={SECTION_A_LABELS.cpf}
              name="cpf"
              value={cpf}
              onInput={handleCpfInput}
              onChange={handleCpfInput}
              onBlur={(value) => validateCpf(value)}
              placeholder="000.000.000-00"
              required={true}
              error={cpfError}
              validationMessage={cpfValidationMessage}
            />
            <Input
              label={SECTION_A_LABELS.phoneNumber}
              name="phoneNumber"
              value={phoneNumber}
              onInput={handlePhoneNumberInput}
              onChange={handlePhoneNumberInput}
              onBlur={(value) => validatePhoneNumber(value)}
              required={true}
              error={phoneError}
              validationMessage={phoneValidationMessage}
              placeholder="+55 (00) 00000-0000"
            />
            <DateInput
              label={SECTION_A_LABELS.birthDate}
              name="birthDate"
              value={birthDate}
              onChange={(value) => {
                setBirthDate(value);
              }}
              required={true}
            />
          </Flex>

          <Divider />

          <Input
            label={SECTION_A_LABELS.postalCode}
            name="postalCode"
            value={postalCode}
            onChange={(value) => setPostalCode(formatPostalCode(value))}
            placeholder="00000-000"
            required={true}
            description={
              loadingPostalCode
                ? "Buscando endereço..."
                : "Digite o CEP para preencher automaticamente"
            }
          />

          {/* Street and Number - Row */}
          <Flex direction="row" gap="small">
            <Box flex={3}>
              <Input
                label={SECTION_A_LABELS.street}
                name="street"
                value={street}
                onChange={setStreet}
                required={true}
              />
            </Box>
            <Box flex={1}>
              <Input
                label={SECTION_A_LABELS.streetNumber}
                name="streetNumber"
                value={streetNumber}
                onChange={setStreetNumber}
                required={true}
              />
            </Box>
          </Flex>

          <Input
            label={SECTION_A_LABELS.addressComplement}
            name="addressComplement"
            value={addressComplement}
            onChange={setAddressComplement}
          />

          <Flex direction="row" gap="small">
            <Input
              label={SECTION_A_LABELS.neighborhood}
              name="neighborhood"
              value={neighborhood}
              onChange={setNeighborhood}
              required={true}
            />
            <Input
              label={SECTION_A_LABELS.city}
              name="city"
              value={city}
              onChange={setCity}
              required={true}
            />
          </Flex>

          <Input
            label={SECTION_A_LABELS.ibgeCityCode}
            name="ibgeCityCode"
            value={ibgeCityCode}
            onChange={setIbgeCityCode}
            required={true}
          />

          <Divider />

          <Flex direction="row" gap="small">
            <Input
              label={SECTION_A_LABELS.state}
              name="state"
              value={state}
              onChange={setState}
              required={true}
            />
          </Flex>

          <Input
            label={SECTION_A_LABELS.ibgeBirthplaceCode}
            name="ibgeBirthplaceCode"
            value={ibgeBirthplaceCode}
            onChange={setIbgeBirthplaceCode}
            required={true}
          />

          <Divider />

          {initialLoadDone && !loadingPostalCode && !isRegistrationFormValid && (
            <Text variant="microcopy" format={{ fontWeight: "demibold" }}>
              {missingFieldsMessage(invalidRequiredFields)}
            </Text>
          )}

          {initialLoadDone &&
            !loadingPostalCode &&
            isRegistrationFormValid &&
            !hasResponsibleUser && (
              <Text variant="microcopy" format={{ fontWeight: "demibold" }}>
                {MISSING_RESPONSIBLE_USER_MESSAGE}
              </Text>
            )}

          <Flex direction="row" gap="small" justify="between">
            <Button
              type="button"
              variant="secondary"
              onClick={handleSaveDraft}
              disabled={loadingSaveDraft || loadingRegistration}
            >
              {loadingSaveDraft ? "Salvando..." : "Salvar rascunho"}
            </Button>
            <Button
              type="submit"
              variant="primary"
              onClick={handleRegisterStudent}
              disabled={
                loadingRegistration ||
                loadingSaveDraft ||
                !isRegistrationFormValid ||
                !hasResponsibleUser
              }
            >
              {loadingRegistration ? "Cadastrando..." : "Cadastrar Aluno"}
            </Button>
          </Flex>
        </Flex>
      </Accordion>

      <Divider size="medium" />

      <Accordion title="Seção B: Geração de Matrícula" defaultOpen={true}>
        <Flex direction="column" gap="small">
          {enrollmentId && (
            <Box
              border="thin"
              borderColor="success"
              backgroundColor="#f0f9ff"
              borderRadius="medium"
              padding="medium"
            >
              <Flex direction="column" gap="small" align="center">
                <Text format={{ fontWeight: "bold", fontSize: "large" }}>
                  Aluno matriculado!
                </Text>
                <Flex direction="row" gap="extra-small" align="center">
                  <Text format={{ fontWeight: "regular" }}>
                    ID da Matrícula:
                  </Text>
                  <Text
                    format={{
                      fontWeight: "bold",
                      fontSize: "large",
                      fontColor: "#0366d6",
                    }}
                  >
                    {enrollmentId}
                  </Text>
                </Flex>

                {link && (
                  <>
                    <Divider />
                    <Flex direction="row" gap="extra-small" align="baseline">
                      <Text format={{ fontWeight: "regular" }}>
                        Link de Checkout:
                      </Text>
                      <Link
                        name="checkoutLink"
                        color="rgb(0, 145, 174)"
                        href={link}
                      >
                        {link}
                      </Link>
                    </Flex>
                  </>
                )}
              </Flex>
            </Box>
          )}

          {enrollmentId && !link && !loadingEnrollment && (
            <Box
              border="thin"
              borderColor="warning"
              backgroundColor="#fffbeb"
              borderRadius="medium"
              padding="medium"
            >
              <Flex direction="column" gap="small" align="center">
                <Text format={{ fontWeight: "bold" }}>
                  Link de checkout não gerado
                </Text>
                <Text format={{ fontSize: "small" }}>
                  A matrícula foi criada no SEI (ID: {enrollmentId}), mas o link
                  de checkout não foi concluído.
                </Text>
                <Button
                  variant="primary"
                  onClick={handleRegenerateCheckoutLink}
                  disabled={loadingRegenerateCheckout}
                >
                  {loadingRegenerateCheckout
                    ? "Gerando link de checkout..."
                    : "Regerar link de checkout"}
                </Button>
              </Flex>
            </Box>
          )}

          <Text variant="microcopy" format={{ fontWeight: "demibold" }}>
            Dados da Matrícula (Propriedades do Negócio)
          </Text>

          <Flex direction="row" gap="small" justify="between">
            <Text>Permitir Matrícula 4º Módulo:</Text>
            <Text format={{ fontWeight: "bold" }}>
              {allowFourthModuleEnrollment ? "Sim" : "Não"}
            </Text>
          </Flex>

          <Flex direction="row" gap="small" justify="between">
            <Text>Permitir Matrícula Inadimplente:</Text>
            <Text format={{ fontWeight: "bold" }}>
              {allowDelinquentEnrollment ? "Sim" : "Não"}
            </Text>
          </Flex>

          <Flex direction="row" gap="small" justify="between">
            <Text>Geração Automática de Parcelas:</Text>
            <Text format={{ fontWeight: "bold" }}>
              {automaticInstallmentGeneration ? "Sim" : "Não"}
            </Text>
          </Flex>

          <Divider />

          <Flex direction="row" gap="small">
            <Input
              label="Tipo de Matrícula"
              name="enrollmentType"
              value={enrollmentType}
              readOnly={true}
            />
            <DateInput
              label="Data da Matrícula"
              name="enrollmentDate"
              value={formatTimestampToDateObject(enrollmentDate)}
              readOnly={true}
            />
          </Flex>

          {/* Education and Student CPF - Row */}
          <Flex direction="row" gap="small">
            <Select
              label="Escolaridade"
              name="educationType"
              value={educationType}
              onChange={(value) => setEducationType(String(value))}
              readOnly={true}
              options={[
                  { label: "Ensino fundamental", value: "Ensino fundamental" },
                  { label: "Ensino médio", value: "Ensino médio" },
                  { label: "Graduação", value: "Graduação" },
                  { label: "Tecnólogo", value: "Tecnólogo" },
                  { label: "Especialização", value: "Especialização" },
                  { label: "Pós-graduação", value: "Pós-graduação" },
                  { label: "Mestrado", value: "Mestrado" },
                  { label: "Doutorado", value: "Doutorado" },
                  { label: "Graduação teste", value: "GRADUACAO" },
              ]}
            />
            {/* Espelha a propriedade do Negócio, que é o cpf que vai para a
                MuleSoft e o cpf que a flag de cadastro cobre. O campo editável
                da Seção A pode estar à frente do que foi salvo. */}
            <Input label="CPF" name="cpf" value={studentCpf} readOnly={true} />
          </Flex>

          {/* Consultant Email - Full width */}
          <Input
            label="E-mail do Consultor"
            name="consultantEmail"
            value={consultantEmail}
            readOnly={true}
          />

          {/* Contract Code and Responsible User - Row */}
          <Flex direction="row" gap="small">
            <Input
              label="Código do Contrato"
              name="contractCode"
              value={contractCode}
              readOnly={true}
            />
            <Input
              label="Usuário Responsável"
              name="responsibleUser"
              value={responsibleUser}
              readOnly={true}
            />
          </Flex>

          {/* Condition Code and Consultant Code - Row */}
          <Flex direction="row" gap="small">
            <Input
              label="Código da Condição"
              name="conditionCode"
              value={conditionCode}
              readOnly={true}
            />
            <Input
              label="Código do Consultor"
              name="consultantCode"
              value={consultantCode}
              readOnly={true}
            />
          </Flex>

          {/* Source and Installment Base Date - Row */}
          <Flex direction="row" gap="small">
            <Input
              label="Origem"
              name="source"
              value={source}
              readOnly={true}
            />
            <Input
              label="Código da Turma"
              name="classCode"
              value={classCode}
              readOnly={true}
            />
          </Flex>

          {/* Class Identifier and Class Code - Row */}
          <Flex direction="row" gap="small">
            <Input
              label="Identificador da Turma"
              name="classIdentifier"
              value={classIdentifier}
              readOnly={true}
            />

            {isEadPos && (
              <Flex direction="column" gap="extra-small">
                <DateInput
                  label="Data de Início do Aluno"
                  name="studentStartDate"
                  required={true}
                  value={studentStartDate}
                  min={minDate}
                  onChange={(value) =>
                    setStudentStartDate(normalizeDateObject(value))
                  }
                />
                <LoadingButton
                  type="button"
                  variant="secondary"
                  disabled={!classCode}
                  loading={loadingDisciplinas}
                  onClick={fetchDisciplinas}
                  overlayOptions={{ openBehavior: "onLoadingFinish" }}
                  overlay={
                    <DisciplinasModal
                      error={disciplinasError}
                      data={disciplinasData}
                      classCode={classCode}
                      classIdentifier={classIdentifier}
                      todayUtcMillis={todayUtcMillis}
                      selectedDate={studentStartDate}
                      onSelect={setStudentStartDate}
                      closeOverlay={(id) => actions.closeOverlay(id)}
                    />
                  }
                >
                  Consultar datas de início
                </LoadingButton>
                {!classCode && (
                  <Text variant="microcopy">
                    Confirme o plano financeiro para liberar a consulta.
                  </Text>
                )}
              </Flex>
            )}
          </Flex>

          {(typeOfInterest === "Ao Vivo" || typeOfInterest === "Presencial") &&
            levelOfInterest === "Pós-graduação" && (
              <Select
                label="Módulo Inicial do Aluno"
                name="studentStartModule"
                value={studentStartModule}
                onChange={(value) => setStudentStartModule(String(value))}
                options={[
                  { label: "1º módulo", value: "1" },
                  { label: "2º módulo", value: "2" },
                  { label: "3º módulo", value: "3" },
                  { label: "4º módulo", value: "4" },
                ]}
                placeholder="Selecione o módulo inicial"
                required={true}
              />
            )}

          <Divider />

          {initialLoadDone && !isStudentRegistered && (
            <Text variant="microcopy" format={{ fontWeight: "demibold" }}>
              Conclua o cadastro do aluno na Seção A antes de gerar a matrícula.
            </Text>
          )}

          <Button
            type="submit"
            variant="primary"
            onClick={handleGenerateEnrollment}
            disabled={
              loadingEnrollment ||
              !isStudentRegistered ||
              !isEnrollmentFormValid()
            }
          >
            {loadingEnrollment ? "Gerando..." : "Gerar Matrícula"}
          </Button>
        </Flex>
      </Accordion>
    </Flex>
  );
};
