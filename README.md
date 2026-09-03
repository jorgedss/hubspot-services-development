# hubspot-services-development

Repositório centralizado de scripts e componentes HubSpot desenvolvidos pelo time interno. O objetivo é garantir rastreabilidade, revisão de boas práticas e reaproveitamento de código entre clientes.

---

## Estrutura

```
hubspot-services-development/
├── custom-code/
│   ├── js/
│   │   └── clients/
│   │       └── <nome-do-cliente>/
│   ├── python/
│   │   └── clients/
│   │       └── <nome-do-cliente>/
│   └── shared/
│       # Scripts reutilizáveis já utilizados em mais de um cliente.
│       # Consulte esta pasta antes de desenvolver um novo script do zero.
├── custom-cards/
│   └── clients/
│       └── <nome-do-cliente>/
└── README.md
```

### `custom-code/`

Scripts utilizados em **ações de workflow**, **webhooks** e outras automações HubSpot.

- **`js/clients/<nome-do-cliente>/`** — scripts Node.js específicos de um cliente
- **`python/clients/<nome-do-cliente>/`** — scripts Python específicos de um cliente
- **`shared/`** — utilitários genéricos validados e reutilizáveis entre clientes

### `custom-cards/`

Projetos de **UI Extensions** (custom cards) do CRM HubSpot, organizados por cliente.

---

## Como contribuir

> Todo código adicionado a este repositório passa por revisão antes de ser mesclado. Não faça commits diretamente na branch principal.

1. **Verifique `shared/`** antes de criar um novo script — pode já existir algo aproveitável.
2. Adicione o código na pasta correta do cliente (`clients/<nome-do-cliente>/`).
3. Nomeie os arquivos de forma descritiva: `atualizar-stage-contrato.js`, não `script1.js`.
4. Inclua um comentário de cabeçalho no arquivo explicando o que o script faz e em qual contexto é usado.
5. Abra um Pull Request para revisão.

---

## Boas práticas obrigatórias

- **Nunca** armazene credenciais, tokens ou API keys no código. Use secrets do HubSpot ou variáveis de ambiente.
- Sempre envolva chamadas externas em `try/catch` (JS) ou `try/except` (Python).
- Valide os dados de entrada antes de processá-los — não assuma que propriedades do HubSpot sempre terão valor.
- Deixe logs claros nos pontos críticos para facilitar depuração futura.

---

## Dúvidas

Fale com o time de desenvolvimento antes de subir código que envolva integrações externas, manipulação de dados sensíveis ou lógica de negócio complexa.