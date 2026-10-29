# Operação

O que corre sozinho, os segredos a criar no GitHub e o que fazer quando algo falha.

## O que corre e quando

| Workflow                                        | Quando                                                                                                           | O que faz                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recolha diária (`.github/workflows/scrape.yml`) | Todos os dias às 03:00 UTC (03:00 em Lisboa no inverno, 04:00 no verão) e à mão                                  | Um job por loja (Darty e Radio Popular), em paralelo. A recolha deixa de fazer pedidos aos 320 min e o job tem 5 h 45 min no máximo (ver "Tempo de recolha e execuções parciais"). Grava só as mudanças de preço e regista a execução em `scrape_runs`. Depois das duas lojas, o job "Rótulos e estatísticas" corre `pnpm stats`, que recalcula o `listing_stats` (rótulo, avisos e os números que os justificam) de todos os artigos ativos com preço atual e, no fim, pede ao site que volte a gerar todas as páginas (ver "Site"). Corre mesmo que uma loja falhe ou termine parcial; não corre em simulações |
| CI (`ci.yml`)                                   | Em cada pull request e em cada push para `main`                                                                  | `pnpm lint`, `pnpm typecheck` e `pnpm test`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Deploy do site (`deploy-web.yml`)               | Em cada push para `main` que mude o site (`apps/web`, `packages/core`, `packages/db` ou as dependências) e à mão | `pnpm lint`, `pnpm typecheck` e `pnpm test`, depois o build OpenNext e o deploy no Cloudflare Workers (ver "Site")                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Manter o agendamento ativo (`keepalive.yml`)    | Segundas-feiras às 06:30 UTC e à mão                                                                             | Commit vazio `chore: keepalive` no ramo principal. Sem atividade durante 60 dias, o GitHub desativa os workflows agendados de um repositório público                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

- Os minutos do GitHub Actions só são ilimitados em repositórios públicos. Num privado, os 2 000 minutos por mês do plano gratuito acabam em poucos dias de recolha.
- O GitHub pode atrasar as execuções agendadas nas horas de mais carga, sobretudo à hora certa.
- Se uma execução agendada falhar, o GitHub envia um email a quem alterou o `cron` do ficheiro pela última vez.
- O commit semanal muda o ramo remoto: faz `git pull --rebase` antes de enviar os teus commits. Se protegeres o `main` com regras que impeçam pushes diretos, abre uma exceção para o GitHub Actions, ou este workflow falha.
- Os rótulos contam o histórico em dias de calendário, na hora de Lisboa: um artigo com o primeiro preço a 28 de outubro tem 30 dias de dados a 27 de novembro, a qualquer hora do cálculo.
- O `pnpm stats` substitui o `listing_stats` inteiro numa só transação: um artigo que ficou inativo ou sem preço atual perde a linha, e com ela o rótulo. Se o cálculo falhar a meio, a tabela fica como estava.
- O aviso "Mais barato noutra loja" só cita preços que a outra loja tem à venda: em stock, sem faltas na última recolha completa dessa loja (um artigo que lá apareceu sem preço conta como falta; ver "Artigos que deixam de aparecer") e com o preço lido hoje ou ontem, em dias de calendário de Lisboa. Se a recolha de uma loja falhar um dia, os preços que ela tinha na véspera ainda contam; se falhar dois dias seguidos, deixam de contar até a loja voltar a ser lida.

## Execução manual

Actions → Recolha diária → Run workflow:

- **Loja**: `todas`, `darty` ou `radiopopular`.
- **Limite**: para depois de N artigos. Vazio = sem limite. Com limite, a execução é parcial: não conta para a média de artigos nem marca artigos como desaparecidos.
- **Simulação**: faz os pedidos à loja ao ritmo normal, mas não grava nada nem envia emails, e o job dos rótulos não corre. O resumo e os primeiros artigos ficam no log do job.

## Tempo de recolha e execuções parciais

O GitHub para um job ao fim de 6 horas. No `scrape.yml`, cada loja tem `timeout-minutes: 345` (5 h 45 min) e a recolha corre com `--max-minutes 320`: aos 320 minutos deixa de fazer pedidos, grava o que já leu, regista a execução como parcial e avisa o `ADMIN_EMAIL`. Os minutos que sobram chegam para preparar o job, acabar de gravar e enviar o email antes de o GitHub o parar.

Uma execução parcial (por tempo, com `--limit`, com `--category`, com uma categoria proibida pelo `robots.txt`, ou parada antes do fim por um bloqueio, pela loja em baixo ou por um erro inesperado) fica com `partial = true` em `scrape_runs` e não conta como histórico: fica fora da média das últimas 7 recolhas completas, não passa pela verificação dos 30% a menos e não marca artigos como desaparecidos. Os artigos que ficaram por ler mantêm o último preço gravado até voltarem a ser lidos.

- **Darty, recolha longa.** A listagem JSON da Shopify só tem o preço base, que a Darty mostra como PVPr. O preço de venda vem da página de produto de cada artigo, lida em todas as recolhas: um pedido por artigo, com 2 a 5 s entre pedidos, o que dá várias horas. É a loja que pode chegar aos 320 minutos. Se terminar parcial todos os dias, fica sem a verificação dos 30% a menos e sem a marcação de desaparecidos: vê a coluna `partial` das últimas recolhas (em "Verificar os dados"). O PVPr fica guardado à parte (`price_points.rrp_cents`), só como informação: nunca é o preço de referência nem conta como desconto anunciado.
- **Radio Popular, filtros.** Cada página de categoria traz só 12 artigos no HTML; os seguintes vêm do `/ajax`, que respondeu 429 ao nosso bot e por isso nunca é usado. Para ir além dos 12, a recolha usa os filtros de marca e a ordenação por preço da própria página, que o site gera no servidor. São mais pedidos por categoria, sempre ao mesmo ritmo.

## Artigos que deixam de aparecer

Depois de uma recolha completa (não parcial, não falhada e com todas as categorias lidas até ao fim), cada artigo ativo da loja que não apareceu fica com mais uma falta (`listings.missed_runs`). Um artigo que aparece com preço volta a zero faltas. Um artigo que aparece sem preço (página de produto falhada ou salto de preço por confirmar) acaba a recolha com uma falta, nunca mais: não fica inativo enquanto continuar a aparecer, mas o preço gravado, que não muda, deixa de entrar no aviso "Mais barato noutra loja" das outras lojas. Nesse dia o `listings.last_seen_at` também não muda: guarda a última leitura com preço.

Ao fim de 3 faltas seguidas, o artigo fica inativo (`active = false`) e o preço atual é fechado; no `pnpm stats` seguinte perde o rótulo. Se voltar a aparecer, fica outra vez ativo, com um intervalo de preço novo. Enquanto tem faltas, mantém o último preço e o rótulo, mas esse preço não entra no aviso "Mais barato noutra loja" das outras lojas.

Na Radio Popular o limite é de 7 faltas (`maxMissedRuns` no scraper da loja, em `packages/scrapers/src/stores/`): a recolha lê cerca de 85% dos artigos (ver `docs/stores/radiopopular.md`) e um artigo pode ficar fora das páginas lidas durante um ou dois dias sem ter saído do site. Em qualquer loja, o limite nunca desce abaixo de 2: um artigo que aparece sem preço fica com uma falta.

## Segredos do GitHub

Settings → Secrets and variables → Actions → New repository secret. Os valores nunca vão para o código, e o GitHub esconde-os nos logs.

| Segredo             | De onde vem                                                                                                                                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | Obrigatório. Supabase → o projeto → botão **Connect** → **Session pooler**: é o endereço que funciona em IPv4, o único que os runners do GitHub têm. Troca `[YOUR-PASSWORD]` pela password da base de dados (Project Settings → Database, onde também a podes repor)                |
| `RESEND_API_KEY`    | Resend → **API Keys** → Create API Key, com a permissão "Sending access"                                                                                                                                                                                                            |
| `ADMIN_EMAIL`       | O teu email. Recebe os avisos da recolha: falhada, bloqueada, interrompida pelo limite de tempo ou incompleta                                                                                                                                                                       |
| `EMAIL_FROM`        | Remetente num domínio verificado no Resend (**Domains** → Add Domain, mais os registos DNS que ele pede), por exemplo `DescontoReal <avisos@descontoreal.pt>`. Para testar antes de verificar o domínio, `onboarding@resend.dev` serve, mas só entrega no email da tua conta Resend |
| `SITE_URL`          | O endereço do site, `https://descontoreal.pt`. Com ele, a recolha e o `pnpm stats` pedem ao site que volte a gerar as páginas                                                                                                                                                       |
| `REVALIDATE_SECRET` | Um texto aleatório longo (`openssl rand -hex 32`). O deploy do site copia-o para os segredos do Worker, por isso basta guardá-lo aqui                                                                                                                                               |

Sem `RESEND_API_KEY`, `ADMIN_EMAIL` ou `EMAIL_FROM`, a recolha corre na mesma e o aviso fica só no log do job. Se o Resend recusar o envio, o aviso no log do job traz só o código do erro e o estado HTTP (por exemplo `validation_error, HTTP 403`); a mensagem completa está no painel do Resend, em **Logs**. O passo "Recolher preços" do `scrape.yml` corre com `NODE_ENV=production` porque, sem isso, o SDK do Resend escreve no log o erro completo, que pode mostrar endereços de email, e os logs de um repositório público são públicos. Sem `SITE_URL` e `REVALIDATE_SECRET` não há revalidação de páginas: o site continua a mostrar o que gerou da última vez.

## Migrações da base de dados

Nenhum workflow aplica migrações. Cada migração nova em `packages/db/migrations/` aplica-se à produção a partir da tua máquina, com `pnpm db:migrate` e o `DATABASE_URL` da produção, antes de o código que precisa dela chegar ao `main`: a recolha seguinte já corre com esse código. O comando salta as migrações já aplicadas (tabela `schema_migrations`). Corre-o fora da hora da recolha (03:00 UTC), para não ficar à espera de uma recolha a meio.

## Correr e verificar localmente

Para experimentar sem tocar na produção, usa a base de dados local (PGlite, com os dados em `.cache/pglite`). Num terminal:

```bash
pnpm install
pnpm db:local    # fica a correr e mostra o DATABASE_URL local
```

Noutro terminal (Git Bash), com o `DATABASE_URL` à frente de cada comando, que ganha ao do `.env`:

```bash
LOCAL_DB=postgresql://postgres:postgres@127.0.0.1:54329/postgres
DATABASE_URL=$LOCAL_DB pnpm db:migrate                               # cria as tabelas e carrega as lojas e as categorias
pnpm scrape --store radiopopular --dry-run --limit 50                # simulação: não usa a base de dados e mostra os primeiros artigos
DATABASE_URL=$LOCAL_DB pnpm scrape --store radiopopular --limit 50   # grava na base local (execução parcial)
DATABASE_URL=$LOCAL_DB pnpm stats                                    # recalcula os rótulos e mostra quantos artigos ficaram em cada um
```

**Atenção:** sem o `DATABASE_URL=` à frente, os comandos usam o do `.env`. Com o endereço do Supabase no `.env`, `pnpm scrape` sem `--dry-run` e `pnpm stats` gravam na base de dados de produção. `pnpm scrape --dry-run` nunca abre a base de dados.

### Verificar os dados

Consultas só de leitura. Na produção: Supabase → **SQL Editor** → New query (aí nunca corras `update` nem `delete` à experiência). Na base local: um cliente de Postgres com o endereço local, por exemplo `psql "$LOCAL_DB"`, com o `pnpm db:local` a correr. O PGlite lida melhor com um cliente de cada vez: fecha o cliente antes de outro comando `pnpm`.

Últimas recolhas (o `id` serve para ver os erros):

```sql
select r.id, s.slug as loja, r.status, r.partial as parcial, r.started_at as inicio, r.finished_at as fim,
       r.pages_fetched as paginas, r.listings_seen as artigos, jsonb_array_length(r.errors) as erros
from scrape_runs r
join stores s on s.id = r.store_id
order by r.started_at desc
limit 10;
```

Erros de uma recolha (troca o 123 pelo `id`):

```sql
select e ->> 'url' as url, e ->> 'message' as erro
from scrape_runs r
cross join jsonb_array_elements(r.errors) as e
where r.id = 123;
```

Artigos por loja:

```sql
select s.slug as loja,
       count(*) filter (where l.active) as ativos,
       count(p.id) filter (where l.active) as com_preco,
       max(l.last_seen_at) as ultima_leitura
from listings l
join stores s on s.id = l.store_id
left join price_points p on p.listing_id = l.id and p.valid_to is null
group by s.slug
order by s.slug;
```

Preços novos ou mudados hoje (dia de Lisboa):

```sql
select s.slug as loja, count(*) as precos
from price_points p
join listings l on l.id = p.listing_id
join stores s on s.id = l.store_id
where (p.valid_from at time zone 'Europe/Lisbon')::date = (now() at time zone 'Europe/Lisbon')::date
group by s.slug
order by s.slug;
```

Rótulos por loja:

```sql
select s.slug as loja, ls.label as rotulo, count(*) as artigos
from listing_stats ls
join listings l on l.id = ls.listing_id
join stores s on s.id = l.store_id
group by s.slug, ls.label
order by s.slug, artigos desc;
```

Histórico e rótulo de um artigo (troca a loja e o código da loja), com os preços em cêntimos:

```sql
select p.price_cents as preco, p.reference_price_cents as riscado, p.rrp_cents as pvpr, p.in_stock as stock,
       p.valid_from as desde, p.valid_to as ate, ls.label as rotulo, ls.details ->> 'text' as texto
from listings l
join stores s on s.id = l.store_id
join price_points p on p.listing_id = l.id
left join listing_stats ls on ls.listing_id = l.id
where s.slug = 'radiopopular' and l.store_sku = '1340981'
order by p.valid_from;
```

## Quando uma loja bloqueia ou um scraper parte

Nestes casos, a execução fica em `scrape_runs` com o estado `blocked` ou `failed`, chega um email ao `ADMIN_EMAIL` com o resumo e o job fica vermelho no GitHub. Logo no início, o email traz uma linha "Motivo:" com o erro que parou a recolha. Uma recolha que parou a meio (bloqueio, loja em baixo ou erro inesperado) fica também parcial: os artigos que viu até aí não entram na média de artigos. As outras lojas e os rótulos seguem normalmente.

**A loja bloqueia** (403 ou 429 repetidos, desafio anti-bot, `robots.txt` recusado ou a proibir todas as categorias ou, numa loja que lê os preços nas páginas de produto como a Darty, essas páginas, ou um 429 ou 503 a pedir mais de 2 minutos de espera com `Retry-After`): a recolha dessa loja para nesse dia e o bloqueio não é contornado. Um `Retry-After` mais curto só atrasa os pedidos seguintes. Nunca usar proxies, outro User-Agent, browsers automatizados nem rotação de IPs.

1. Vê no log do job o URL e a resposta.
2. Se for pontual, a recolha do dia seguinte tenta de novo.
3. Experimenta a partir de casa: `pnpm scrape --store <loja> --dry-run --limit 5`. Se também falhar, a loja bloqueia o nosso bot: põe-na com `active: false` em `packages/core/src/stores.ts`, tira-a do `SCRAPERS` (`packages/scrapers/src/stores/registry.ts`) e da lista de lojas do `scrape.yml` (opções e matriz), documenta em `docs/stores/<loja>.md`, como já está feito para a Worten e a Fnac, e contacta a loja ou pede o feed do programa de afiliados. Se em casa funcionar, são os IPs do GitHub: ver o plano B.

**A loja está em baixo** (5 URLs seguidos com erros 5xx ou de rede, já depois das retentativas): a recolha dessa loja para nesse dia e fica `failed` e parcial, com os preços lidos até aí gravados. Se for pontual, a recolha do dia seguinte tenta de novo.

**O scraper parte** (a loja mudou o site): a execução fica `failed` quando não vê nenhum artigo, quando vê menos 30% de artigos do que a média das últimas 7 recolhas completas, ou com um erro inesperado. Os artigos que não apareceram não são marcados como desaparecidos e os preços já gravados ficam como estão.

1. Corre `pnpm scrape --store <loja> --dry-run --limit 50` e compara os artigos com o site.
2. Atualiza as fixtures em `packages/scrapers/fixtures/<loja>/` (só excertos, reduzidos com `scripts/trim-fixtures.ts`: ver a secção "Fixtures" de `docs/stores/<loja>.md`) e o parser em `packages/scrapers/src/stores/<loja>.ts` (ou refaz o reconhecimento com `/nova-loja <loja>`), com os testes a passar.
3. Depois do merge, lança a recolha à mão só para essa loja.

A média usa as últimas 7 recolhas completas que viram artigos, também as que ficaram `failed` nas verificações do fim da recolha (as que pararam a meio são parciais e não contam). Assim, adapta-se quando a loja reduz o catálogo de vez (por exemplo, tira uma categoria): as recolhas seguintes ficam `failed` e mandam email durante alguns dias, no máximo 7, até a média descer para o novo número. Nesses dias nenhum artigo é marcado como desaparecido. Se a descida vier de um scraper partido e não da loja, corrige-o antes disso: quando a média se adaptar, o aviso deixa de aparecer.

**A recolha fica incompleta** (uma página de listagem falhou depois das retentativas, a paginação entrou em ciclo, ou o `robots.txt` proíbe uma categoria): a recolha segue nas outras categorias e grava os preços que leu, mas nesse dia nenhum artigo é marcado como desaparecido, porque os que faltam podem estar nas páginas por ler. A execução fica `success` e o job verde (salvo se vir menos 30% de artigos do que a média: aí fica `failed`, como acima), mas chega um email com o assunto `DescontoReal: recolha incompleta (<loja>)`, que lista as categorias não lidas até ao fim e a página que falhou em cada uma. Se for pontual, não é preciso fazer nada. Se a mesma categoria falhar vários dias seguidos, nenhum artigo da loja chega a ficar inativo: abre o URL no browser e, se a categoria mudou de endereço ou deixou de existir, atualiza o config da loja (`packages/scrapers/src/stores/<loja>.config.ts`).

**O job dos rótulos falha** (`pnpm stats`): o `listing_stats` fica com os valores do dia anterior. Vê o log, corrige e usa "Re-run failed jobs" nessa execução.

## Plano B: correr fora do GitHub

Só para quando as lojas bloqueiam os IPs do GitHub Actions e o mesmo bot funciona a partir de outra rede. Nunca para fugir a um bloqueio explícito de uma loja ao DescontoRealBot: um pedido para pararmos, um `robots.txt` que nos proíbe, ou um bloqueio que também acontece fora do GitHub.

O código é o mesmo; só muda a máquina (um VPS barato ou um computador em casa sempre ligado):

1. Node 24, pnpm (`corepack enable`), `git clone` do repositório e `pnpm install --frozen-lockfile`.
2. Um `.env` na raiz com os mesmos valores dos segredos do GitHub.
3. Um script diário, por exemplo `~/descontoreal-diario.sh`:

   ```sh
   #!/bin/sh
   cd ~/descontoreal || exit 1
   git pull --ff-only && pnpm install --frozen-lockfile || exit 1
   pnpm scrape --store darty &
   pnpm scrape --store radiopopular &
   wait
   pnpm stats
   ```

4. No `crontab -e`: `0 4 * * * $HOME/descontoreal-diario.sh >> $HOME/descontoreal.log 2>&1` (hora local da máquina). O cron arranca com um `PATH` mínimo, por isso acrescenta no script as pastas do `node` e do `pnpm` (`command -v pnpm` mostra onde está). No Windows, usa o Agendador de Tarefas com o mesmo script no Git Bash.
5. Desativa o agendamento no GitHub, para não recolher duas vezes: Actions → Recolha diária → ⋯ → Disable workflow.

## Site

O site (`apps/web`, Next.js) corre no Cloudflare Workers através do OpenNext. O workflow "Deploy do site" faz o build e o deploy em Linux. Nunca faças o build do OpenNext no Windows nem com um `.env` na pasta: o OpenNext põe dentro do Worker todos os ficheiros `.env` que encontra, incluindo o da raiz, que tem os segredos da recolha.

Segredos do GitHub do site, além dos da recolha:

| Segredo                  | De onde vem                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | Cloudflare → My Profile → API Tokens, modelo "Edit Cloudflare Workers" com D1 Edit e Hyperdrive Edit, limitado à conta                  |
| `CLOUDFLARE_ACCOUNT_ID`  | O Account ID da conta (Workers & Pages, coluna da direita)                                                                              |
| `WEB_BUILD_DATABASE_URL` | O Session pooler do Supabase com o papel só de leitura `web_ro`. O build lê a base de dados para gerar a página de início e os sitemaps |

Como as páginas se mantêm atualizadas:

- As páginas de produto, categoria e marca são geradas na primeira visita e guardadas (R2, com uma cópia em cada centro de dados). Não expiram por tempo.
- No fim de cada loja, a recolha pede ao site que volte a gerar as páginas dos produtos cujo preço ou stock mudou (`POST /api/revalidate` com `{ "slugs": [...] }`).
- Depois do `pnpm stats`, pede que volte a gerar todas as páginas (`{ "all": true }`), porque os rótulos e os avisos mudam todos os dias, também nos produtos cujo preço não mudou. Até lá, um produto cujo preço mudou nessa manhã mostra "Rótulo em atualização" em vez de um rótulo calculado com o preço anterior.
- Em ambos os casos a página é gerada de novo na visita seguinte. Uma falha na revalidação fica no log do job e nunca faz falhar a recolha.

Se um deploy correr mal: Cloudflare → Workers & Pages → `descontoreal-web` → Deployments → escolhe a versão anterior → Rollback. Depois corrige o código e faz push; o deploy seguinte substitui a versão reposta.

Para medir o site como um telemóvel: Actions → "Lighthouse" → Run workflow. Mede a página de início, o primeiro produto e a primeira categoria dos sitemaps, três vezes cada, e falha se a mediana ficar abaixo de 90 em desempenho, acessibilidade ou SEO. Sem endereço, usa o segredo `SITE_URL`. Os relatórios ficam nos artefactos da execução durante 14 dias.

Para trabalhar no site localmente, com dados inventados (nunca com a produção):

```bash
pnpm db:local    # num terminal, fica a correr
```

```bash
LOCAL_DB=postgresql://postgres:postgres@127.0.0.1:54329/postgres
DATABASE_URL=$LOCAL_DB pnpm db:migrate
DATABASE_URL=$LOCAL_DB pnpm db:demo     # produtos, listagens e históricos inventados, de marcas inventadas
DATABASE_URL=$LOCAL_DB pnpm stats       # rótulos para esses dados
pnpm dev                                # http://localhost:3000, lê a base local pela ligação "localConnectionString" do wrangler.jsonc
```

O `pnpm db:demo` só escreve numa base de dados local e recusa qualquer outro endereço.

### Administração

A página `/admin/correspondencias` mostra as sugestões de correspondência por rever (aprovar ou rejeitar) e os produtos com mais do que um artigo da mesma loja (separar). Só entra quem tem `app_metadata.role = 'admin'` no Supabase Auth. O pedido do link faz-se em `/entrar`, e o link abre `/auth/confirm`, que só faz entrar no botão "Entrar": alguns serviços de email abrem os links para os analisar, e o link só funciona uma vez. A sessão fica em cookies que o browser só envia para `/admin`; "Sair" termina-a nesse browser.

As decisões correm nas funções da migração `0004_admin_review.sql`, com a sessão de quem está a rever: a base de dados recusa quem não é administrador, e o Worker nunca tem a chave de serviço. Cada decisão volta a gerar as páginas dos produtos que mudaram.

Configuração, uma vez:

1. Aplica a migração 0004 à produção (ver "Migrações da base de dados") antes do push que traz estas páginas. Depois confirma no SQL Editor que o papel do site, `web_ro`, não chega a estas funções (as três colunas têm de dar `false`):

   ```sql
   select pg_has_role('web_ro', 'authenticated', 'member') as em_authenticated,
          pg_has_role('web_ro', 'service_role', 'member') as em_service_role,
          has_function_privilege('web_ro', 'admin_approve_match(bigint)', 'execute') as pode_aprovar;
   ```

2. Supabase → Authentication → URL Configuration → **Site URL**: o endereço do site (por agora o `*.workers.dev`; `https://descontoreal.pt` quando o domínio estiver ativo). O link do email usa-o.
3. Authentication → Emails → **Magic link**: troca a ligação do modelo por `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}">Entrar no DescontoReal</a>`.
4. Authentication → Sign In / Providers: desliga **Allow new users to sign up**. O formulário nunca cria contas, e assim também ninguém as cria pela API.
5. Authentication → Users → Add user → **Create new user**: o teu email, uma password aleatória longa (não volta a ser usada) e **Auto Confirm User** ligado. Depois, no SQL Editor:

   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"role": "admin"}'
   where email = 'o-teu-email@exemplo.pt';

   select email, raw_app_meta_data ->> 'role' as papel from auth.users;
   ```

   O papel entra na sessão seguinte: se já tinhas entrado, sai e entra outra vez.

6. GitHub → Settings → Secrets and variables → Actions → separador **Variables** (não Secrets: são valores públicos):

   | Variável                               | De onde vem                                                                        |
   | -------------------------------------- | ---------------------------------------------------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`             | Supabase → Project Settings → Data API → Project URL (`https://<ref>.supabase.co`) |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → Publishable key (`sb_publishable_…`)      |

   O build do site escreve-as no Worker: depois de as mudar, corre outra vez o workflow "Deploy do site".

Sem SMTP próprio, o Supabase só envia emails para os membros da organização no Supabase, no máximo 2 por hora. Chega para o administrador; o envio pelo Resend fica para a fase 3, com as contas públicas.
