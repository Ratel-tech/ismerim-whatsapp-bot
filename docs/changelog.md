# Changelog

Historico de mudancas relevantes. Formato baseado em Keep a Changelog.

## [Nao publicado]

### Adicionado
- **Agendar e remarcar pela ficha do cliente** (atendimento humano) no painel, mesmo com a IA pausada:
  - `POST /api/conversations/:jid/bookings` — cria agendamento para a conversa.
  - `PUT /api/bookings/:id/reschedule` — remarca um agendamento existente.
  - Modulo `src/atendimento.ts` reutiliza as validacoes de `bookings.ts` e dispara as notificacoes de **ADMIN** e **profissional** (mesmo comportamento do fluxo do cliente).
  - Formulario na ficha do cliente (Servico, Data, Hora, Profissional) com os botoes **Agendar** e **Remarcar**.
- Documentacao em `docs/`: indice, funcionalidades, arquitetura, agendamento/atendimento humano, API do painel, configuracao, operacao, CI/CD e troubleshooting.

### Corrigido
- **Rolagem independente no painel de conversas:** a grade `.inbox` nao definia `grid-template-rows`, entao o painel de detalhe crescia alem da altura do container e era cortado por `overflow:hidden`; a pagina rolava apenas alguns pixels e o formulario ficava inalcancavel. Agora `grid-template-rows: minmax(0,1fr)` e `min-height:0` limitam cada coluna, que rola por conta propria.

### Alterado
- **Painel de conversas mais compacto:** filtros em **menu expansivel** (recolhido por padrao, com o filtro ativo indicado no botao), titulo e botoes na mesma linha, itens com avatar reduzido e badge inline. A lista passou a exibir mais conversas por tela.

## Versoes anteriores

Consulte o historico de commits do repositorio (`git log`) para as versoes anteriores (papeis admin/barbeiro, agenda do operador, lembrete de agendamento, confirmacao de presenca, catalogo por duracao, export CSV, fuso America/Sao_Paulo, agrupamento de mensagens, pausa por atendimento humano).
