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
- A lista de conversas e **compacta** (filtros em linha, itens com avatar reduzido e badge inline).
- Na aba Conversas, cada coluna (lista, chat, ficha) tem **rolagem independente** e a pagina fica fixa.
- O telefone do profissional e **privado**: nunca aparece no agente/cliente/CSV.
- Pode ser protegido com `PANEL_TOKEN`.

## Status do agendamento

`confirmado` - `cancelado` - `feito` — com identificacao de **passado** no painel e no agente.
