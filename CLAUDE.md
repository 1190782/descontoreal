# DescontoReal

Site gratuito que guarda todos os dias os preços de eletrónica e eletrodomésticos
da Worten, Radio Popular, Darty e Fnac, mostra o histórico por loja e classifica descontos.
Plano completo: @docs/PLANO.md (só local, fora do git)

## Stack

- Monorepo pnpm: apps/web (Next.js App Router, TypeScript estrito, Tailwind),
  packages/db (migrações Supabase), packages/core (rótulos e utilitários de preço),
  packages/scrapers (recolha).
- Supabase (Postgres + Auth), Resend, GitHub Actions, Vercel.

## Comandos

- pnpm dev | pnpm test | pnpm lint | pnpm typecheck
- pnpm scrape --store <loja> [--category <cat>] [--dry-run] [--limit N]
- pnpm stats
- pnpm db:migrate | pnpm db:seed

## Estado das lojas

- Ativas: Darty (Shopify, JSON público) e Radio Popular (HTML com microdata).
- Bloqueadas ao nosso bot: Worten (desafio Cloudflare) e Fnac (403 Akamai). Não recolher;
  ver docs/stores/worten.md e docs/stores/fnac.md.

## Regras

- Preços em cêntimos, como inteiros. Nunca vírgula flutuante.
- Datas em UTC na base de dados; cálculos por dia no fuso Europe/Lisbon.
- Gravar só mudanças de preço (docs/PLANO.md, Modelo de dados).
- Só artigos vendidos pela própria loja. Nunca marketplace.
- Texto visível em português de Portugal. Preços com Intl.NumberFormat('pt-PT', EUR).
- Rótulos descrevem números e datas. Nunca usar "falso", "enganoso" ou "fraude".
- Scrapers: um pedido de cada vez por loja, 2 a 5 s entre pedidos,
  User-Agent DescontoRealBot, respeitar robots.txt.
- Antes de um scraper novo: docs/stores/<loja>.md e fixtures (usa /nova-loja).
- Páginas públicas em Server Components, com os dados no HTML inicial.
- Segredos só em variáveis de ambiente. A chave de serviço do Supabase nunca chega ao browser.
- Lógica de negócio em packages/core, sempre com testes unitários.
- Commits pequenos, no formato feat:, fix:, chore:.

## Pergunta antes de

- Mudar o modelo de dados ou as regras dos rótulos.
- Contornar qualquer bloqueio de uma loja (proxies, CAPTCHAs, rotação de IPs). Se um site bloquear, para e reporta.
- Adicionar dependências pesadas ao apps/web.
