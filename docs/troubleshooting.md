# Troubleshooting

## A porta 3081 esta ocupada

Pode haver o container Docker **e** um processo local disputando a porta.

```powershell
Get-NetTCPConnection -LocalPort 3081 -State Listen | Select-Object LocalAddress, OwningProcess
docker ps --filter "name=ismerim-bot"
```

- Se for o container: `docker compose ps` e `docker compose restart`.
- Se houver um `node`/`tsx` local rodando junto, encerre-o (`Stop-Process -Id <pid>`) ou rode em outra porta (`PORT`).
- No Docker, `HOST=0.0.0.0` e obrigatorio para o port mapping.

## O painel nao atualiza/esta com layout antigo

O HTML do painel e embutido na pagina. Se voce reconstruiu a imagem, recarregue com **Ctrl+F5** (hard refresh) — sem isso o navegador pode usar a versao em cache.

## WhatsApp desconectado / pede QR de novo

- A sessao fica em `data/sessions`. Se a pasta foi apagada/movida, e preciso escanear o QR novamente.
- Para reconectar sem sair: **WhatsApp** -> "Gerar novo QR".
- Verifique `data/logs.txt` para erros do Baileys.

## Nao chegam notificacoes de agendamento

- Confirme `ADMIN_PHONE` no `.env` (apenas digitos, com DDI). Sem ele, o backend registra um aviso e nao envia.
- Pode ser salvo pela aba **Config** do painel.
- Se o WhatsApp estiver desconectado no momento, a notificacao fica pendente e e reenviada automaticamente a cada 60s.

## O agendamento foi rejeitado

As mensagens de validacao explicam o motivo (servico inexistente, data passada, fora do expediente, vaga ocupada, profissional nao encontrado). Ajuste o servico/data/hora conforme o catalogo (`config/catalog.json`) e tente de novo.

## Audio nao e transcrito

- Confira `TRANSCRIBE_ENABLED=true` e `TRANSCRIBE_API_KEY` valido.
- Endpoint/modelo devem ser compativeis com `/audio/transcriptions` (OpenAI, Groq etc.).

## O job `deploy` fica "queued" no GitHub Actions

Nao ha runner self-hosted online (ou os labels nao batem). Veja [ci-cd.md](ci-cd.md) para instalar o runner (`self-hosted, Windows`). Enquanto isso, faca o deploy manual.

## Banco corrompido

Um backup automatico e criado como `data/db.json.corrompido-<data>`. Verifique `data/logs.txt`, substitua o `db.json` pelo backup valido (ou por um estado anterior) e reinicie. Migracoes sao aditivas e nao apagam dados.

## Testes mexendo em `data/logs.txt`

Nao deveriam: `tests/setup.ts` redireciona o log para um diretorio temporario. Se isso acontecer, verifique se o setup esta sendo carregado (`vitest.config.ts` -> `setupFiles`).

## Falha no `npm ci` dentro do CI/Docker

O workflow usa Node 22 e o Dockerfile usa Node 24. Rode localmente `npm ci` com uma versao >= 20 para reproduzir. Nao edite `package-lock.json` manualmente.
