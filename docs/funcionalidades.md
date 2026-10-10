# Funcionalidades

## Cliente (WhatsApp)

- Responde duvidas e apresenta servicos/promocoes (preco so quando perguntado).
- **Agenda**, **cancela**, **remarca** e **confirma presenca** — sempre validado no backend.
- Entende datas passadas (marca como "JA PASSOU"; nao trata como ativo) e usa *remarcar* em vez de criar um novo.
- Audio: transcreve notas de voz (STT) quando habilitado.
- Pode pedir para falar com um **atendente humano** (intent "transferir") — o agente pausa e o dono e avisado.

## Admin / Barbeiro (operador)

- Identificados por telefone (`ADMIN_PHONE` / telefone do profissional) ou vinculo manual na ficha da conversa (aba Conversas).
- **Ver agenda:** admin ve tudo; barbeiro ve so os agendamentos dele do dia.
- **Criar agendamento de cliente:** nome + telefone (pede sempre) + servico + data/hora. Para o barbeiro, o agendamento e sempre dele. Pode criar quantos quiser.
- **Marcar como feito:** admin em qualquer; barbeiro so nos dele (somente passados).

## Folga dos barbeiros

- Cada barbeiro informa pelo **WhatsApp** o **dia da semana de folga** (ou que **nao vai folgar** naquela semana).
- Todo **domingo** (loja fechada) a partir de `FOLGA_ASK_HOUR`, o bot pergunta aos barbeiros **ativos com telefone**; enquanto nao responderem, **cobra 1x por dia** (`FOLGA_REMIND_HOUR`) ate o proximo domingo.
- O barbeiro pode **mudar a qualquer momento**; mensagens contendo "folga" sao interpretadas por um **parser deterministico** (sem IA).
- **Unicidade:** dois barbeiros ativos nao podem efetivar o **mesmo dia** na mesma semana — se o dia estiver ocupado, o bot **lista os dias livres** (`1..6`). Domingo (`0`) nunca e folga valida.
- **Bloqueio no agendamento:** o backend nao agenda/remarca com um barbeiro no dia de folga dele (`professional_folga`) e **oferece cobertura** (outro profissional que atende ou sem preferencia). Ver [agendamento-e-atendimento-humano.md](agendamento-e-atendimento-humano.md).
- O agente **informa** o cliente quando relevante e a aba **Profissionais** do painel exibe a folga efetiva (**somente leitura**; edicao pelo WhatsApp).

## Atendimento humano (pausa)

- Ao enviar uma mensagem pelo painel, o agente **pausa** naquela conversa.
- Ele **retoma sozinho** quando o cliente volta a falar apos `HUMAN_PAUSE_MINUTES` (0 = nunca retoma) ou pelo botao "Voltar para o agente de IA".
- **Novo:** com a IA pausada, o atendente pode **agendar e remarcar** o corte direto na **ficha do cliente** no painel (aba Conversas). Ver [agendamento-e-atendimento-humano.md](agendamento-e-atendimento-humano.md).

## Lembretes e confirmacao

- `REMINDER_MINUTES_BEFORE` minutos antes (padrao 120 = 2h), o cliente recebe um lembrete com **SIM / CANCELAR**.
- Se o cliente **confirmar**, admin e barbeiro sao avisados.
- Se **cancelar**, cai no fluxo de cancelamento (admin + barbeiro avisados).

## Contatos

- Todo cliente que manda mensagem tem **nome + telefone real** salvos (quando o WhatsApp entrega).
- **Exportar CSV** (aba Conversas) gera `contatos.csv` (`Nome,Telefone,JID`) para importar na agenda do celular.

## Painel web (`http://localhost:3081`)

Abas: **WhatsApp** (QR/status) - **Agendamentos** (status + marcar feito) - **Profissionais** (cadastro + telefone privado) - **Conversas** (inbox estilo WhatsApp, envio em massa, exportar contatos) - **Agente** - **Catalogo** - **Config**.

- O painel **lembra a aba ativa** ao recarregar.
- A lista de conversas e **compacta**: filtros em **menu expansivel** (recolhido por padrao; o botao mostra o filtro ativo), itens com avatar reduzido e badge inline.
- Na aba Conversas, cada coluna (lista, chat, ficha) tem **rolagem independente** e a pagina fica fixa.
- O telefone do profissional e **privado**: nunca aparece no agente/cliente/CSV.
- Pode ser protegido com `PANEL_TOKEN`.

## Status do agendamento

`confirmado` - `cancelado` - `feito` — com identificacao de **passado** no painel e no agente.
