# API do painel

Servidor HTTP em `src/http.ts`, escutando em `http://localhost:3081` (ou `PORT`/`HOST` configurados).

## Autenticacao

- Se `PANEL_TOKEN` estiver definido no `.env`, **toda** rota `/api/*` exige o header `x-panel-token: <token>`.
- Se `PANEL_TOKEN` estiver vazio, o painel fica sem senha (uso local).
- Comparacao do token e feita em tempo constante (`timingSafeEqual`).

## Rotas

### Pagina e status

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/` | Pagina HTML do painel (HTML+JS embutidos) |
| GET | `/api/status` | Status do WhatsApp (conexao, telefone, QR, ultimos agendamentos, adminPhone) |
| POST | `/api/reconnect` | Regenera a sessao/QR |
| POST | `/api/logout` | Desconecta o WhatsApp |
| POST | `/api/pairing-code` | Gera codigo de pareamento (`{ phone }`, apenas digitos com DDI) |

### Conversas

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/conversations?bucket=&refresh=` | Lista conversas classificadas por recencia (`all`,`h24`,`d1_2`,`d2_7`,`old`) |
| GET | `/api/conversations/:jid` | Detalhe: dados do cliente, mensagens e agendamentos |
| PUT | `/api/conversations/:jid/human` | Liga/desliga atendimento humano (`{ on: boolean }`) |
| PUT | `/api/conversations/:jid/papel` | Define papel: `{ tipo: "cliente"\|"admin"\|"profissional", profissionalId? }` |
| PUT | `/api/conversations/:jid/observations` | Adiciona observacao (`{ text }`) |
| PUT | `/api/conversations/:jid/observations/:index` | Edita observacao |
| DELETE | `/api/conversations/:jid/observations/:index` | Remove observacao |
| POST | `/api/send` | Envia mensagem manual (`{ jid, text }`) — pausa o agente na conversa |

### Agendamentos

| Metodo | Rota | Descricao |
|---|---|---|
| PUT | `/api/bookings/:id/feito` | Marca/desmarca como feito (`{ feito: boolean }`) |
| POST | `/api/conversations/:jid/bookings` | **Novo.** Cria agendamento pela ficha (`{ service, date, time, professional? }`) |
| PUT | `/api/bookings/:id/reschedule` | **Novo.** Remarca pela ficha (`{ date, time, professional? }`) |

Respostas:
- `200` com o agendamento (JSON) em sucesso.
- `422` com `{ error }` quando a validacao falha (servico inexistente, fora do expediente, vaga ocupada...).
- `404` em `/reschedule` quando o agendamento nao existe.

### Profissionais

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/profissionais` | Lista (DTO publico, **sem telefone**) |
| POST | `/api/profissionais` | Cria (`{ nome, telefone?, horarioInicio?, horarioFim?, ativo? }`) |
| PUT | `/api/profissionais/:id` | Edita (`telefone: undefined` mantem; `""` remove) |

### Contatos e broadcast

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/contacts.csv` | Exporta contatos (`Nome,Telefone,JID`) |
| GET | `/api/broadcast` | Config + status do envio em massa |
| POST | `/api/broadcast` | Inicia (`{ bucket, text, overrides? }`) |
| POST | `/api/broadcast/stop` | Para o envio |
| PUT | `/api/broadcast/settings` | Salva config (lote, pausas, limite diario) |

### Configuracao

| Metodo | Rota | Descricao |
|---|---|---|
| GET/PUT | `/api/agent-config` | Personalidade/instrucoes do agente (`config/agent.json`) |
| GET/PUT | `/api/catalog` | Catalogo (servicos, promocoes, horarios) |
| PUT | `/api/admin-phone` | Atualiza `ADMIN_PHONE` no `.env` e em memoria |
| GET/PUT | `/api/ai-config` | Provedor/modelo/chave de IA |

## Exemplo: agendar pela ficha

```bash
curl -X POST http://localhost:3081/api/conversations/5511999999999%40s.whatsapp.net/bookings \
  -H "Content-Type: application/json" \
  -H "x-panel-token: SEU_TOKEN" \
  -d '{"service":"Corte","date":"2026-10-20","time":"15:00","professional":"JUAN"}'
```

## Exemplo: remarcar

```bash
curl -X PUT http://localhost:3081/api/bookings/17/reschedule \
  -H "Content-Type: application/json" \
  -H "x-panel-token: SEU_TOKEN" \
  -d '{"date":"2026-10-21","time":"16:00"}'
```
