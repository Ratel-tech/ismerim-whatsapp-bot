# Agendamento e atendimento humano

Este documento descreve o ciclo completo de um agendamento, os dois caminhos de entrada (agente de IA e painel/atendimento humano) e as regras de validacao.

## Regras de validacao (sempre no backend)

Toda criacao/remarcacao passa por `src/bookings.ts` (via `createBookingFromAgent` ou `atendimento.ts`):

1. Servico existe no catalogo (`config/catalog.json`).
2. Data real e **futura**.
3. Horario no formato `HH:MM` e **dentro do expediente** do dia da semana.
4. **Vaga livre** (`store.findBooking`).
5. Profissional (opcional) resolvido por nome entre os **ativos**.
6. Profissional (opcional) **nao esta de folga** no dia do agendamento (`professional_folga`). Ver [funcionalidades.md](funcionalidades.md#folga-dos-barbeiros).

Falhas retornam uma `userMessage` amigavel. No painel, essa mensagem aparece embaixo do formulario; para o cliente, e a resposta enviada pelo agente.

### Folga do profissional (`professional_folga`)

Quando o profissional informado esta de folga efetiva no dia do agendamento, tanto `validateAndCreateBooking` quanto `validateAndRescheduleBooking` recusam com `code: 'professional_folga'`. A mensagem **oferece cobertura**: o agente lista os profissionais que atendem naquele dia e o cliente pode agendar com outro ou **sem preferencia** (nunca ha reatribuicao automatica). Sem profissional informado, a validacao e permitida normalmente.

## Caminho 1 — Agente de IA (cliente)

```
Cliente -> Agent.onBookingConfirmed
        -> createBookingFromAgent -> validateAndCreateBooking
        -> store.addBooking
        -> notifier: ADMIN (buildNotification) + profissional (notifyProfessionalForBooking)
```

- Cancelar: `cancelBookingCliente` mantem o registro como `cancelado` e libera a vaga.
- Remarcar: `validateAndRescheduleBooking` revalida o novo horario e preserva (ou troca) o profissional.
- Confirmar presenca: `confirmBookingCliente` (resposta ao lembrete).

## Caminho 2 — Painel / atendimento humano

Quando o atendente assume a conversa, a IA e pausada e o acordo feito por WhatsApp nao entrava no sistema. Agora o atendente registra pela **ficha do cliente**.

### Onde clicar

1. Painel `http://localhost:3081` -> aba **Conversas**.
2. Clique na conversa do cliente.
3. No painel da direita (ficha do cliente), va ate a secao **Agendamentos**.
4. **Remarcar:** clique em **Remarcar** ao lado de um agendamento ativo; o formulario preenche com os dados atuais e o botao vira **Salvar remarcacao**.
5. **Agendar:** preencha Servico, Data, Hora e (opcional) Profissional e clique em **Agendar**.

Observacoes:
- So agendamentos `confirmado` (nao `feito`/`cancelado`) mostram o botao Remarcar.
- Erros de validacao (horario ocupado, fora do expediente) aparecem abaixo do formulario.
- Ao salvar, as mesmas notificacoes do fluxo do cliente sao disparadas: **ADMIN** e **profissional**. O cliente **nao** recebe mensagem automatica.

### Backend

`src/atendimento.ts`:

- `criarAgendamentoAtendimento(deps, input)` — cria usando `createBookingFromAgent` e notifica ADMIN + profissional.
- `remarcarAgendamentoAtendimento(deps, input)` — busca o agendamento por id, revalida com `validateAndRescheduleBooking` e notifica ADMIN + profissional com o horario anterior.

`src/index.ts` liga esses servicos as rotas HTTP:

- `POST /api/conversations/:jid/bookings`
- `PUT /api/bookings/:id/reschedule`

Detalhes das rotas em [api-painel.md](api-painel.md).

## Estados de um agendamento

| Estado | Significado |
|---|---|
| `confirmado` | Ativo (ocupa vaga) |
| `cancelado` | Cancelado (historico; vaga liberada) |
| `feito` | Realizado (marcado pelo operador em horario passado) |

## Notificacoes

| Evento | ADMIN | Profissional | Cliente |
|---|---|---|---|
| Criacao (agente) | sim | sim | confirmacao |
| Criacao (painel) | sim | sim | nao |
| Remarcacao (agente) | sim | sim | confirmacao |
| Remarcacao (painel) | sim | sim | nao |
| Cancelamento | sim | sim | sim |
| Lembrete (N min antes) | - | - | sim |
| Presenca confirmada | sim | sim | sim |
