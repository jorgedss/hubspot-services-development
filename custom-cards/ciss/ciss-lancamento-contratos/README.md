# CISS Lançamento de Contratos

UI Extension para o HubSpot CRM que permite realizar o lançamento de contratos diretamente a partir de um negócio (deal), gerando automaticamente os itens de linha correspondentes com base nos módulos e modelos de venda configurados.

## Funcionalidades

- **Lançamento por módulo**: o usuário preenche as propriedades do negócio (tipo de contrato, sistema, módulo e itens de módulo) e adiciona o lançamento à fila antes de executar.
- **Lançamento por modelo de vendas**: ao selecionar um modelo de vendas no negócio, os SKUs correspondentes são resolvidos automaticamente a partir de um mapa de modelos pré-configurado.
- **Fila de lançamentos**: múltiplos lançamentos podem ser empilhados antes da execução, com visualização em tabela e opção de remoção individual.
- **Criação e atualização de itens de linha**: ao executar, a função serverless busca os produtos pelos SKUs, agrega quantidades (PDVs, televendas, CNPJs, retaguardas) e cria ou atualiza os itens de linha vinculados ao negócio via API do HubSpot.
- **Limpeza automática de campos**: após cada adição à fila, as propriedades temporárias do negócio são limpas, permitindo a inclusão de um novo lançamento.

## Estrutura

```
src/app/
├── cards/
│   └── ContractLaunch.jsx          # UI Extension (CRM card)
└── functions/
    ├── createContract.js           # Cria/atualiza itens de linha no deal
    ├── clearDealProps.js           # Limpa propriedades temporárias do deal
    └── fetchPropertyLabels.js      # Busca os rótulos do campo tipo_de_contrato
```

## Requisitos

- Conta HubSpot ativa com acesso a developer projects.
- [HubSpot CLI](https://www.npmjs.com/package/@hubspot/cli) instalado e configurado.
- Variável de ambiente `PRIVATE_APP_ACCESS_TOKEN` configurada com um token de app privado com permissões de leitura e escrita em negócios, produtos e itens de linha.

## Desenvolvimento local

```bash
hs project dev
```

## Deploy

```bash
hs project upload
```
