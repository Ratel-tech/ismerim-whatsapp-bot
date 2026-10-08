# Design — Folga dos barbeiros (por semana)

- **Data:** 2026-10-08
- **Status:** aprovado (aguardando plano de implementação)
- **Autor:** brainstorming (usuário + agente)

## 1. Objetivo

Permitir que cada barbeiro informe, semanalmente, o **dia da semana de folga** (ou que **não vai folgar** naquela semana), garantindo que **dois barbeiros não folguem no mesmo dia**. O agente passa a **informar os clientes** sobre a folga (contextualmente) e o backend **bloqueia** agendamentos com um barbeiro no dia de folga dele, oferecendo cobertura de outro profissional.

## 2. Requisitos

1. Todo **domingo** (loja fechada) o bot pergunta a cada barbeiro ativo, por WhatsApp, qual será o dia de folga da semana.
2. O barbeiro responde pelo WhatsApp e pode **mudar a qualquer momento**.
3. O barbeiro pode responder **"não vou folgar nesta semana"** (vale só para a semana corrente).
4. **Sem folga duplicada:** dois barbeiros ativos não podem efetivar o mesmo dia de folga na mesma semana.
5. O agente **informa** o cliente quando relevante e, no dia de folga do barbeiro, **não agenda** com ele — oferece outro que atende (cobertura).
6. Se o barbeiro não responder, **mantém a decisão anterior** e o bot **cobra 1x por dia** até o próximo domingo.
7. A folga efetiva aparece no painel (somente leitura; edição pelo WhatsApp).

## 3. Modelo de dados

Estender `Profissional` (`src/profissionais.ts`) com campos **opcionais** (migração aditiva em `store.ts`):

```ts
interface Profissional {
  // ...campos atuais...
  /** Preferência recorrente: 1=segunda ... 6=sabado. null = nunca definiu. */
  folgaDia?: number | null;
  /** Decisao da semana corrente. dia=null significa "nao vou folgar nesta semana". */
  folgaSemana?: { semanaId: string; dia: number | null } | null;
}
```

- `semanaId`: identificador da semana (ISO week, ex.: `2026-W41`), calculado em `America/Sao_Paulo`.
- Domingo (`0`) nunca é folga válida (loja fechada); dias válidos: `1..6`.

### Controle de cobrança semanal

No `store`, um mapa por `profissionalId` com o estado da rotina semanal (não exposto no DTO):

```ts
folgaControle: Record<number, {
  semanaId: string;
  askedAt: string | null;     // quando a pergunta da semana foi enviada
  remindedAt: string | null;  // ultima cobranca diaria
  answeredAt: string | null;  // quando o barbeiro respondeu nesta semana
}>
```

- Um barbeiro está "pendente" na semana se `!answeredAt` (e `askedAt` da semana corrente).
- "Perguntar 1x por semana" e "cobrar 1x por dia" sao derivados deste estado.

### Folga efetiva

```
folgaEfetiva(prof, semanaAtual):
  if prof.folgaSemana?.semanaId === semanaAtual: return prof.folgaSemana.dia  // pode ser null
  return prof.folgaDia ?? null
```

- Se o barbeiro **não responder** esta semana, `folgaSemana` ainda é o da semana passada → cai no `folgaDia` (mantém a atual).
- Responder um dia `D` → grava `folgaDia = D` **e** `folgaSemana = { semanaId, dia: D }`.
- Responder "não vou folgar" → grava apenas `folgaSemana = { semanaId, dia: null }` (mantém `folgaDia` para a próxima semana).

## 4. Regras de negócio

### 4.1 Unicidade
Ao definir o dia `D` para o barbeiro na semana corrente, se algum **outro barbeiro ativo** tem folga efetiva `== D` na mesma semana, a resposta é recusada e o bot **lista os dias livres** (`1..6` menos os efetivos dos outros). O barbeiro pode então escolher outro dia ou "não folgar".

### 4.2 Bloqueio no agendamento
- `validateAndCreateBooking` e `validateAndRescheduleBooking` (`src/bookings.ts`): se o profissional informado estiver de folga efetiva no dia do agendamento → retorna `{ ok: false, code: 'professional_folga', userMessage: '...' }`.
- Sem profissional informado (cliente sem preferência) → permitido normalmente.
- **Cobertura:** a mensagem oferece os profissionais que atendem naquele dia; o cliente pode agendar com outro ou sem preferência. Não há reatribuição automática.

## 5. Fluxo do barbeiro (determinístico, sem IA)

### 5.1 Gatilho semanal
- Um verificador roda no mesmo `setInterval` já existente (`src/index.ts`), com estado persistido no `store`.
- No dia configurado (`FOLGA_ASK_WEEKDAY`, padrão domingo) a partir de `FOLGA_ASK_HOUR`, envia a pergunta a cada barbeiro **ativo com telefone** e marca a semana como "perguntada".
- Enquanto o barbeiro **não responder** nesta semana, reenvia **1x por dia** a partir de `FOLGA_REMIND_HOUR` até o próximo domingo.

### 5.2 Mensagens
- Pergunta: lista os dias livres e instrui ("Responda só o dia, ex.: *quarta*, ou *não vou folgar*").
- Estado de cobrança por barbeiro/semana: `{ semanaId, askedAt, remindedAt, answeredAt }` (persistido).

### 5.3 Parser (sem IA)
`parseFolgaAnswer(texto): { tipo: 'dia', dia: number } | { tipo: 'sem_folga' } | { tipo: 'invalido' }`.

- Dias: `segunda/sábado` e variações, abreviações (`seg`, `ter`, `qua`, `qui`, `sex`, `sab`) e números `2..6`.
- Sem folga: `não vou folgar`, `nao folgo`, `folgo`, `sem folga`, `nenhum`, `-`.
- Ambíguo/inválido → pergunta de novo.
- Aplicável tanto à resposta da cobrança quanto ao comando espontâneo.

### 5.4 Comando a qualquer momento
Texto do barbeiro contendo "folga" (ou correspondência exata) é interpretado pelo parser e aplicado na hora (mesmas regras). Não depende do LLM.

## 6. Agente (cliente)

- `buildSystemPrompt` (`src/prompt.ts`) passa a incluir, por profissional, o **dia de folga efetivo** (ex.: `- JUAN (10:00 às 20:00) — folga: quarta`).
- Regra nova no prompt: se o cliente quiser o barbeiro no dia de folga dele, **informar e oferecer** outro profissional que atende; nunca agendar com o barbeiro de folga naquele dia.
- O backend continua sendo a fonte da verdade (bloqueio em 4.2).

## 7. Configuração (`.env`)

| Variavel | Padrao | Descricao |
|---|---|---|
| `FOLGA_ASK_ENABLED` | `true` | Liga/desliga a rotina semanal |
| `FOLGA_ASK_WEEKDAY` | `0` | Dia da pergunta (0=domingo) |
| `FOLGA_ASK_HOUR` | `9` | Hora da pergunta |
| `FOLGA_REMIND_HOUR` | `9` | Hora da cobranca diaria (sem resposta) |

Adicionar ao `.env.example` e a `config.ts`.

## 8. Painel

- Aba **Profissionais**: exibir a folga efetiva de cada um (somente leitura).
- DTO publico (`ProfissionalPublic`) ganha `folgaDia` (recorrente) e `folgaSemanaDia` (efetivo da semana) — **sem telefone**.

## 9. Notificacoes

- Quando um barbeiro define/muda a folga, avisar o **admin** (opcional; se `ADMIN_PHONE` configurado). Mesmo padrao de notificacao do backend.

## 10. Casos-limite

- **Sem dias livres** (mais barbeiros ativos que dias `1..6`): informa que nao ha dias livres e sugere "nao folgar".
- **Barbeiro sem telefone:** nao recebe a pergunta (registra aviso no log).
- **"Nao vou folgar":** nao bloqueia nada e vale so para a semana atual.
- **Mudanca de dia:** revalida unicidade; se o novo dia estiver ocupado, recusa e lista os livres.
- **Fuso:** semana/dia calculados em `America/Sao_Paulo`.

## 11. Testes

- `tests/folga.test.ts` (novo):
  - Parser: dias, abreviacoes, numeros, "nao folgar", invalidos.
  - Folga efetiva: recorrente vs. semana atual; "nao folgar" so nesta semana; nao-resposta mantem a anterior.
  - Unicidade: recusa dia ocupado e lista os livres.
  - Agendador: `semanaId` correto no fuso; "perguntar uma vez por semana"; "cobrar 1x por dia".
- `tests/bookings.test.ts` / `tests/atendimento.test.ts`: bloqueio `professional_folga` no criar e no remarcar; cobertura nao afeta quando nao ha profissional.
- `tests/prompt*.test.ts`: prompt inclui a folga efetiva.
- `tests/http.test.ts`: DTO de profissionais expõe `folgaDia`/`folgaSemanaDia` sem telefone.

## 12. Fora de escopo (YAGNI)

- Reatribuicao automatica de agendamentos existentes quando um barbeiro define folga.
- Edicao da folga pelo painel (somente leitura) — edicao e pelo WhatsApp.
- Broadcast em massa aos clientes sobre folgas.
- Folga em dias especificos de data (apenas dia da semana).

## 13. Riscos

- **Barbeiro nao responde e mantem folga antiga:** comporta-se como esperado (mantem), mas pode conflitar com a realidade; mitigado pela cobranca diaria.
- **Muitos barbeiros (>6 ativos):** impossivel folga unica; tratado no caso-limite.
- **Telefone do barbeiro ausente:** sem cobranca; avisa no log.
