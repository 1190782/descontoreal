Faz o reconhecimento da loja $ARGUMENTS e implementa o scraper.

1. Lê docs/PLANO.md, secção "Recolha diária".
2. Investiga o site: robots.txt, sitemaps, JSON-LD nas páginas de produto, pedidos de rede das listagens, paginação, e como distinguir artigos vendidos pela loja dos de terceiros.
3. Documenta tudo em docs/stores/$ARGUMENTS.md antes de escrever código.
4. Guarda exemplos reais de listagem e de produto em packages/scrapers/fixtures/$ARGUMENTS/.
5. Implementa packages/scrapers/src/stores/$ARGUMENTS.ts com a interface StoreScraper e testes sobre as fixtures.
6. Reduz as fixtures ao que o parser lê, porque o repositório é público (nunca páginas inteiras nem descrições): acrescenta as regras da loja a `TRIM_RULES` em packages/scrapers/scripts/trim-fixtures.ts, corre `pnpm --filter @descontoreal/scrapers exec tsx scripts/trim-fixtures.ts $ARGUMENTS fixtures/$ARGUMENTS/<ficheiro>` e junta a loja a `FIXTURE_STORES` em packages/scrapers/test/stores/trim-fixtures.test.ts.
7. Corre `pnpm scrape --store $ARGUMENTS --dry-run --limit 50` e mostra-me 10 artigos extraídos para eu comparar com o site.
