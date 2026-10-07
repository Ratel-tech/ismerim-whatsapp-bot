# Documentacao — Ismerim WhatsApp Bot

Indice da documentacao tecnica e operacional do bot de WhatsApp da **Ismerim Barbearia**.

## Comece por aqui

| Documento | Conteudo |
|---|---|
| [Visao geral e funcionalidades](funcionalidades.md) | O que o bot faz para cliente, admin/barbeiro, lembretes e atendimento humano |
| [Arquitetura](arquitetura.md) | Modulos, fluxo de dados, persistencia e decisoes de projeto |
| [Agendamento e atendimento humano](agendamento-e-atendimento-humano.md) | Como agendar/cancelar/remarcar e como o atendente registra pela ficha do cliente |
| [API do painel](api-painel.md) | Todas as rotas HTTP (`/api/*`) e autenticacao |
| [Configuracao](configuracao.md) | Variaveis de ambiente (`.env`), catalogo e agente |
| [Operacao](operacao.md) | Rodar local, Docker, dados, backup e boas praticas |
| [CI/CD](ci-cd.md) | GitHub Actions, runner self-hosted e deploy automatico |
| [Troubleshooting](troubleshooting.md) | Problemas comuns e como resolver |
| [Changelog](changelog.md) | Historico de mudancas relevantes |

## Resumo em uma frase

Bot de WhatsApp (Baileys) que atende clientes com IA (DeepSeek ou outro provedor), conduz agendamentos validados no backend, notifica **admin** e **barbeiros**, e oferece um **painel web** (`http://localhost:3081`) para operar tudo — inclusive registrar/remarcar agendamentos durante o atendimento humano.

## Publico-alvo

- **Operador/atendente:** use [funcionalidades.md](funcionalidades.md) e [operacao.md](operacao.md).
- **Desenvolvedor:** use [arquitetura.md](arquitetura.md), [api-painel.md](api-painel.md) e [ci-cd.md](ci-cd.md).
- **Quem vai instalar/manter:** use [configuracao.md](configuracao.md) e [troubleshooting.md](troubleshooting.md).
