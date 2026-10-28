# Radio Popular (radiopopular.pt)

Reconhecimento a 27/10/2026: 20 pedidos com `DescontoRealBot/1.0`, um de cada vez, 2 a 8 s entre pedidos.
Percurso por filtros e ordenações a 28/10/2026: 41 pedidos, um de cada vez, 2 a 5 s entre pedidos (ver
[Pedidos](#pedidos)).

## Resumo

- **Fonte:** HTML das páginas de categoria (`/categoria/<slug>`), gerado no servidor, com microdata schema.org
  `Product`/`Offer` em cada cartão. Não há JSON-LD de produto (só `Organization`).
- **Codificação:** UTF-8 (`Content-Type: text/html; charset=UTF-8` e `<meta charset="UTF-8">`). Os acentos
  saem certos quando lidos como UTF-8.
- **Percurso:** cada URL de listagem mostra só os 12 primeiros artigos. Os seguintes vêm de `POST /ajax`, que
  responde 429 ao nosso bot e que **nunca** chamamos. Chegamos aos outros com os URLs filtrados e ordenados do
  próprio site (`?pf-filters=…&pf-order=…`), que vêm prontos no HTML do servidor. Ver [Percurso](#percurso).
- **Vendedor:** só a própria Radio Popular. Não há marketplace. `isSoldByStore` devolve sempre `true`.
- **Desativação:** um artigo só fica inativo ao fim de 7 recolhas completas seguidas sem aparecer, e não de 3
  (`maxMissedRuns: 7`). Ver [Artigos que deixam de aparecer](#artigos-que-deixam-de-aparecer).
- **Catálogo nas categorias mapeadas:** cerca de 9 700 artigos. O percurso lê, por estimativa, cerca de 8 300
  (85%) com cerca de 1 250 pedidos de listagem por dia. Só com a 1.ª página de cada categoria eram 148 pedidos e
  1 400 artigos (15%).

## robots.txt e sitemaps

- `robots.txt`: o grupo `User-agent: *` só tem `Allow: /files/sitemaps/` e nenhum `Disallow`, portanto tudo
  é permitido. Sem `Crawl-delay`. (Há também um grupo para `OAI-SearchBot`.) Igual a 28/10.
- Índice: `https://lojae-s3-prd-files.radiopopular.pt/files/sitemaps/sitemap.xml`, com `sitemap-paginas.xml`,
  `sitemap-categorias.xml` (860 URLs `/categoria/<slug>`) e `sitemap-produtos-00.xml`/`-01.xml`
  (`/produto/<slug>`, 20 000 no primeiro, por ordem alfabética até "PC PORTÁTIL LENOVO Y…"). `lastmod` diário.
  Catálogo total: mais de 30 000 artigos, com jogos, acessórios e loja de animais.
- O sitemap de categorias não diz a hierarquia. A árvore vem do menu principal, presente em todas as páginas.

## Categorias

- Menu: `.subcategories-container` → famílias (`li.subcategory.family`) → folhas
  (`li.family a.designation-link`). Algumas folhas têm um 4.º nível que não está no sitemap nem no menu
  (`/categoria/ate-6-kg`, `/categoria/9-kg-2`, vistos nas breadcrumbs). Esse nível aparece no filtro
  "Categorias" das listagens e o percurso usa-o (ver [Percurso](#percurso)).
- A página de uma categoria-mãe lista também os artigos das filhas. Dentro de uma família as folhas não se
  repetem: as contagens do filtro de categorias somam o total da mãe (TV's: 232 + 46 + 40 + 6 + 2 + 1 = 327).
- Há repetições entre famílias. "Encastre" repete os artigos de encastre das outras famílias
  (Máquina de Lavar Louça 161 = Máquinas de Louça › Encastre 161; Frio 253 = combinados, frigoríficos e
  arcas de encastre). "Casa eficiente - RP ENERGY" repete ar condicionado e aquecimento de águas, "Lazer"
  repete auriculares desportivos e fogareiros. O config usa um só caminho para cada artigo.
- Mapeamento em `packages/scrapers/src/stores/radiopopular.config.ts`: 148 folhas da loja para as nossas 43
  categorias-folha (todas têm pelo menos uma). O config usa folhas e não mães, para cada artigo ter uma só
  categoria nossa.
- Ficam de fora: acessórios, consumíveis, recondicionados (Reset), caves de vinho, packs forno + placa,
  lava-loiças e torneiras, gavetas de aquecimento, fogareiros, telemóveis básicos, e-readers, jogos e
  periféricos de gaming, smart home e redes. "Preparadores de Alimentos" vai para robôs de cozinha e
  "Bomba de Calor" (aquecimento de águas) para termoacumuladores. Dentro das folhas mapeadas, o percurso salta
  as subcategorias de acessórios ("Acessórios de Exaustor", "Filtros Exaustores", "Acessórios de Placas",
  "Acessórios de Forno"): `EXCLUDED_SUBCATEGORY` no config.

Contagens do filtro de categorias das páginas de topo (27/10/2026) e o que a 1.ª página de cada folha dava antes
do percurso:

| Categoria nossa                 | Artigos na loja | Lidos (1.ª página) |
| ------------------------------- | --------------: | -----------------: |
| Máquinas de lavar roupa         |             265 |                 24 |
| Máquinas de secar roupa         |             110 |                 12 |
| Máquinas de lavar e secar roupa |             104 |                 24 |
| Máquinas de lavar loiça         |             379 |                 24 |
| Frigoríficos                    |             928 |                 80 |
| Arcas e congeladores            |             175 |                 60 |
| Fornos                          |             398 |                 12 |
| Placas                          |             555 |                 12 |
| Exaustores                      |             666 |                 12 |
| Fogões                          |             259 |                 36 |
| Micro-ondas                     |             227 |                 36 |
| Televisores                     |             325 |                 43 |
| Barras de som                   |              68 |                 12 |
| Colunas                         |             527 |                 36 |
| Auscultadores                   |             524 |                 36 |
| Projetores                      |              33 |                 14 |
| Portáteis                       |             252 |                 36 |
| Computadores de secretária      |              83 |                 44 |
| Monitores                       |             188 |                 45 |
| Tablets                         |             289 |                 24 |
| Impressoras                     |             134 |                 24 |
| Discos e armazenamento          |             117 |                 51 |
| Smartphones                     |             458 |                 12 |
| Smartwatches                    |             363 |                 12 |
| Aspiradores                     |             191 |                 67 |
| Robôs aspiradores               |              41 |                 12 |
| Máquinas de café                |             181 |                 58 |
| Fritadeiras                     |              62 |                 23 |
| Robôs de cozinha                |              51 |                 12 |
| Pequenos aparelhos de cozinha   |             646 |                145 |
| Engomar                         |              79 |                 41 |
| Máquinas de barbear             |             112 |                 36 |
| Secadores e modeladores         |             136 |                 38 |
| Escovas de dentes elétricas     |              41 |                 13 |
| Ar condicionado                 |             203 |                 24 |
| Aquecedores                     |              97 |                 76 |
| Desumidificadores               |              27 |                 12 |
| Ventoinhas                      |              58 |                 49 |
| Esquentadores                   |              25 |                 23 |
| Termoacumuladores               |             167 |                 27 |
| Consolas                        |              28 |                 27 |
| Câmaras fotográficas            |             141 |                 43 |
| Drones                          |               ? |               ≤ 12 |

## Listagem

`https://www.radiopopular.pt/categoria/<slug>`, 1,2 a 1,6 MB de HTML (120 a 160 KB comprimidos). Os cartões
estão em `section.products.grid .viewport > article.product-grid-module` (microdata `Product`,
`itemListElement` de um `OfferCatalog`), no máximo 12 por URL. O contentor `[data-products-total]` tem o total
com os filtros do URL e `data-products-per-page="12"`.

| Campo                 | Origem                                              | Notas                                                                                                          |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `storeSku`            | `meta[itemprop=sku]`                                | Código RP: 7 dígitos (`1340981`) ou `F` + id interno (`F140300`)                                               |
| `title`               | `meta[itemprop=name]`                               | Maiúsculas, "TIPO MARCA MODELO"                                                                                |
| `url`                 | `a[itemprop=url]`, atributo `content`               | Absoluto, `/produto/<slug>`                                                                                    |
| `priceCents`          | `[itemprop=price]`, atributo `content` (`"269.99"`) | `decimalToCents`                                                                                               |
| `referencePriceCents` | `.old-price.strike`                                 | Só o preço riscado ("-X% Direto"); o PVPR fica de fora (ver Preços)                                            |
| `rrpCents`            | `.old-price .no-strike` (rótulo `PVPR*`)            | PVPR do fabricante ("-X% sobre PVPR"), só informação (ver Preços)                                              |
| `inStock`             | `meta[itemprop=availability]`                       | `InStock` e `PreSale` → `true`; `SoldOut` → `false`                                                            |
| `ean`                 | `meta[itemprop=gtin13]`                             | `null` nas marcas próprias (ver EAN)                                                                           |
| `brand`               | `[itemprop=brand] meta[itemprop=name]`              | Nome do fabricante na RP, às vezes abreviado ("FUJI", "SONY COMPUTER ENTRETAIN")                               |
| `model`               | Título, depois da marca                             | Só quando é um código com letras e algarismos: "MÁQUINA LAVAR ROUPA SAMSUNG WW90FG3M05AWEP" → `WW90FG3M05AWEP` |
| `imageUrl`            | `[itemprop=image]`, atributo `content`              | `https://lojae-s3-prd-files.radiopopular.pt/files/static/images/products/<id>_0.jpg`                           |
| `sellerName`          | —                                                   | `null`: a listagem não mostra vendedor                                                                         |

Outros atributos: `data-add-compare` e o nome da imagem usam um id interno diferente do código;
`data-add-compare-level` é o código da categoria (`031003001`); `data-add2cart` só aparece quando se pode
comprar.

## Percurso

### O que o site oferece

- **Scroll infinito bloqueado:** `includes/js/rp.js` (modo Prefixbox, `rp.body.search.index = 3`) faz
  `POST /ajax` com `method=getProducts&page=categoria&where=<slug>&filters=&order=Relevance desc&pageNumber=N&updatedFilters=0&intentId=`
  e recebe JSON com o HTML dos cartões seguintes. A 27/10 o servidor respondeu **429 Too Many Requests** ao
  nosso bot, por GET (pedido 4) e por POST (pedido 6, quase quatro minutos depois), nos primeiros pedidos a esse
  endpoint; as páginas normais responderam 200 antes e depois. Não experimentámos cabeçalhos de browser nem
  cookies, porque isso seria contornar o bloqueio. O scraper nunca chama `/ajax`.
- **Filtros no HTML:** cada listagem traz o formulário de filtros (`aside#filters form.filter-form`, `GET`)
  já preenchido pelo servidor: uma caixa por marca (`input[name=brand]`) e a árvore de categorias
  (`input[name=category]`, valor = caminho "Topo|Família|Folha|Subcategoria"), com a contagem no rótulo
  ("AEG (31)"). Há também disponibilidade, desconto sobre PVPR e características, que não usamos.
- **URLs filtrados e ordenados:** o JavaScript do site (`rp.js`, `updateURL`) põe a escolha no URL:
  `?pf-filters=<expressão>&pf-order=<campo> <sentido>`. Abertos diretamente, estes URLs vêm filtrados e
  ordenados no HTML do servidor, com os cartões e as contagens. As próprias páginas ligam para URLs assim (em
  `/categoria/placas`: `?pf-filters=((brand eq 'Teka') and (category eq 'Grandes Eletrodomésticos|Encastre|Placas|Indução'))`
  e `?pf-order=price asc`).
- **Gramática:** um valor `(campo eq 'valor')`; vários valores do mesmo filtro
  `((brand eq 'A') or (brand eq 'B'))`; filtros diferentes juntos com `and`; tudo entre parênteses. Os
  apóstrofos vêm duplicados nos valores do formulário (`T''nB`, `TV''s`) e vão assim para o URL. Codificação
  como a do `URLSearchParams` do site (`+` nos espaços).
- **Ordens:** relevância (sem `pf-order`), `price asc`, `price desc`, `displayText asc` (A-Z) e
  `displayText desc` (Z-A).
- **Contagens:** `data-products-total` conta os artigos com os filtros do URL. Com um filtro de marca, a lista de
  marcas continua completa e com as contagens de toda a categoria (as escolhidas aparecem primeiro); os outros
  filtros passam a contar só essas marcas. Com um filtro de subcategoria, as subcategorias mantêm as contagens
  completas e os nós acima delas mostram o total filtrado. Valores sem artigos desaparecem da lista.
- **Lacunas:** nem todos os artigos têm marca no filtro (Marshall, por exemplo, não aparece). Nas 24 folhas
  vistas a 28/10 faltava a marca a 12% dos artigos, mas a 86% em ar condicionado fixo, 54% em termoacumuladores e
  30% em colunas Bluetooth. A árvore de categorias cobre todos. Os artigos de exposição contam nos totais e
  ocupam lugares nos cartões (8 dos 12 primeiros em portáteis tradicionais).

### Como o scraper percorre uma categoria

Sem estado: `parseListingPage` calcula o URL seguinte a partir do URL da página e das contagens do seu HTML.
Todos os URLs são a página da categoria do config com `pf-filters` e `pf-order`, por isso nunca saem de
`www.radiopopular.pt`. O runner deduplica por SKU.

1. 1.ª página da categoria (relevância). Até 12 artigos, acaba. De 13 a 24, lê também por preço ascendente e
   descendente, que juntos mostram todos, e acaba.
2. Com mais de 24 artigos, divide-a pelas subcategorias (os nós mais fundos abaixo da folha) quando há pelo
   menos duas e somam 90% dos artigos; senão pelas marcas, quando somam 50%; senão lê-a por preço ascendente,
   A-Z, Z-A e preço descendente.
3. As subcategorias ou marcas vão por ordem alfabética. As de mais de 24 artigos vão sozinhas; as outras juntam-se
   com as vizinhas num só filtro (`or`) até 24 artigos, escolhendo os grupos que pedem menos páginas: até 12
   artigos, uma página; de 13 a 24, preço ascendente e descendente.
4. Uma marca com mais de 24 artigos lê-se por relevância, preço ascendente e preço descendente; com mais de 48,
   também A-Z e Z-A (até 60 artigos).
5. Uma subcategoria com mais de 24 artigos: a sua 1.ª página mostra as marcas que tem. Se as marcas cobrem 50%,
   percorre os grupos de marcas dentro da subcategoria (passos 3 e 4, com os dois filtros) e acaba na
   subcategoria por preço descendente, que volta a mostrar todas as subcategorias. Senão lê-a em 3 ou 5 ordens.
6. Termina sempre: cada página avança (subcategoria ou marca seguinte por ordem alfabética, ou ordem seguinte).
   Se as contagens mudarem entre duas páginas e o grupo atual deixar de existir, continua no primeiro grupo com
   uma subcategoria ou marca posterior.

Exemplo de 28/10, máquinas de lavar roupa (241 artigos, 7 subcategorias): 1.ª página →
`((category eq '…|Máquinas de Lavar Roupa|10-11 Kg'))` (72 artigos) →
`(((brand eq 'AEG') or (brand eq 'Balay') or (brand eq 'Beko') or (brand eq 'Bosch')) and (category eq '…|10-11 Kg'))`
por preço ascendente (24 artigos) → o mesmo por preço descendente → os grupos seguintes de marcas → a
subcategoria 10-11 Kg por preço descendente → `12 Kg` → `7 Kg` → …

### Cobertura e pedidos

Estimativa com as contagens das primeiras páginas de 24 folhas (28/10, 6 036 artigos, 62% do catálogo mapeado).
As subcategorias grandes dividem-se por marca na proporção das marcas da folha; os artigos lidos nas fatias de 3 e
5 ordens vêm de uma simulação.

| Folha                             | Artigos | Com marca no filtro | Divisão            | Pedidos | Artigos lidos |
| --------------------------------- | ------: | ------------------: | ------------------ | ------: | ------------: |
| `exaustores`                      |     666 |                 91% | subcategorias (8)  |      68 |           554 |
| `placas`                          |     556 |                 94% | subcategorias (8)  |      64 |           520 |
| `smartphones`                     |     452 |                 94% | subcategorias (2)  |      34 |           276 |
| `fornos-1`                        |     398 |                 95% | subcategorias (11) |      47 |           378 |
| `combinados`                      |     363 |                 95% | subcategorias (3)  |      39 |           343 |
| `smartwatches`                    |     363 |                 99% | subcategorias (2)  |      26 |           214 |
| `auriculares`                     |     313 |                 91% | subcategorias (2)  |      34 |           280 |
| `colunas-bluetooth-1`             |     277 |                 70% | subcategorias (2)  |      24 |           195 |
| `maquinas-de-lavar-roupa`         |     241 |                 83% | subcategorias (7)  |      28 |           217 |
| `tablets-2`                       |     233 |                 99% | marcas             |      15 |           133 |
| `tv-4k-uhd`                       |     231 |                 96% | subcategorias (5)  |      32 |           222 |
| `maquina-de-lavar-louca`          |     219 |                 84% | marcas             |      19 |           178 |
| `ar-condicionado-fixo`            |     187 |                 14% | subcategorias (10) |      20 |           162 |
| `colunas-4`                       |     178 |                 81% | subcategorias (4)  |      18 |           150 |
| `portateis-tradicionais-1`        |     175 |                 86% | subcategorias (4)  |      22 |           159 |
| `auscultadores-1`                 |     172 |                 84% | subcategorias (2)  |      19 |           136 |
| `maquina-de-lavar-louca-encastre` |     161 |                 91% | subcategorias (2)  |      17 |           152 |
| `fogoes-mistos`                   |     150 |                 76% | marcas             |      13 |            89 |
| `frigorificos-1-porta`            |     145 |                 99% | subcategorias (4)  |      21 |           140 |
| `micro-ondas-de-encastre-1`       |     143 |                 96% | marcas             |      16 |           137 |
| `termoacumulador`                 |     138 |                 46% | subcategorias (4)  |      14 |           108 |
| `torradeiras`                     |     107 |                 93% | subcategorias (3)  |      14 |           104 |
| `monitores-gaming`                |      91 |                 99% | subcategorias (3)  |      15 |            89 |
| `aspirador-vertical`              |      77 |                 95% | marcas             |       8 |            73 |
| **Total**                         |   6 036 |                     |                    |     627 |   5 009 (83%) |

- As outras 124 folhas têm cerca de 3 700 artigos (contagens de 27/10): 52 têm até 12 artigos (um pedido cada)
  e as restantes pedem cerca de uma página por 8 artigos. Dão cerca de 620 pedidos e 3 300 artigos.
- **Total por dia:** cerca de **1 250 pedidos de listagem** (±20%) para cerca de **8 300 dos ~9 700 artigos**
  (85%). Fica abaixo dos 1 500, por isso não há limite por categoria. A folha maior, exaustores, pede cerca
  de 70 páginas. Se for preciso cortar, o primeiro passo é ler as fatias grandes em 3 ordens em vez de 5
  (`WIDE_SIZE` em `radiopopular.ts`).
- **O que fica por ler:** marcas grandes sem subcategorias que as dividam (smartphones: Samsung 116, Apple 94;
  smartwatches: Garmin 124, Apple 106; tablets: Apple 142; fogões mistos: Bertazzoni 64) ficam em cerca de 60
  artigos cada; artigos sem marca no filtro em folhas sem subcategorias (fogões mistos, máquinas de lavar loiça);
  e os poucos artigos que só estão numa subcategoria intermédia (3 em fornos).
- **Tempo:** cerca de 4,3 s por pedido (pausa de 2 a 5 s e cerca de 0,6 s de resposta), ou seja, cerca de
  1 h 30 de listagens. A revisita semanal do runner lê ainda cerca de 1/7 das páginas de produto por dia
  (cerca de 1 200): umas 3 h no total.
- **Verificação a 28/10:** `pnpm scrape --store radiopopular --dry-run --limit 60` fez `robots.txt` e 7
  listagens (1.ª página, subcategoria 10-11 Kg e os grupos de marcas dentro dela), todas 200: 60 artigos, 0
  erros, PVPR em todos os 10 da amostra.

## Preços

- **Preço pago:** `itemprop="price"` (decimal com ponto), igual ao preço mostrado
  (`<div class="price">269<sup>,99</sup>`).
- **PVPR → `rrpCents`:** `<div class="old-price"><p class="old-price__pvpr">PVPR*</p><span class="no-strike">€329</span>…`,
  com o selo "-18% sobre PVPR" (`promotion-pvpr`). Não aparece riscado (classe `no-strike`) e a nota da página
  diz que "O PVPR é o preço de venda recomendado para o produto em questão, definido e indicado pelo
  fabricante, produtor ou fornecedor". Na página de produto: `<div class="mpup"><span class="no-strike">PVPR* €579<sup>,99</sup></span></div>`.
  Decisão do dono a 28/10: vai para `rrpCents`, guardado à parte e só como informação. Nunca é
  `referencePriceCents` nem conta como desconto anunciado. Num artigo de exposição fica `null`.
- **Preço riscado → `referencePriceCents`:** `<div class="old-price strike"><span>€79</span><sup>,99</sup></div>`,
  com o selo "-15% Direto" (`promotion-discount`). Na página de produto é `.mpup.line-discount`. A 27/10 só
  aparecia em jogos em pré-venda (6 cartões).
- **Selos que não mudam o preço a pagar:** "-10% em talão" (desconto em talão para compras seguintes,
  54 cartões), "Folheto", "-10% extra c/código STOCK10" (precisa de código), "Oferta: …",
  "10% extra em Suportes TV*", "Reembolso 75€*". Usamos sempre o preço sem talões, códigos, ofertas nem
  reembolsos.
- A página de produto pode mostrar "Melhor preço últimos 30 dias" (informativo, não lido).
- Os preços são os da loja online; as lojas físicas podem ter outros (termos e condições, secção 5).

## Disponibilidade

- `itemprop="availability"`: `InStock`; `PreSale` (pré-venda com data de lançamento, já encomendável, conta
  como em stock); `SoldOut` ("Temporariamente indisponível", sem botão de carrinho).
- Mensagens de entrega: "Entrega em 3 a 4 dias úteis", "Entrega em 4 semanas",
  "Entrega estimada na data de lançamento: 19 de novembro de 2026", "Levantamento em loja Grátis*".

## Artigos que deixam de aparecer

- `maxMissedRuns: 7` em `src/stores/radiopopular.ts`: um artigo só fica inativo ao fim de 7 recolhas completas
  seguidas sem aparecer. Nas outras lojas são 3 (regra do plano).
- Porquê: o percurso não lê todos os artigos de uma categoria (cerca de 85%, ver
  [Cobertura e pedidos](#cobertura-e-pedidos)). Lê-os por filtros de subcategoria e de marca e por páginas de 12
  ordenadas por preço, nunca pelo `/ajax`. Basta entrar um artigo mais barato num grupo, ou mudarem as contagens dos
  filtros, para um artigo que continua à venda ficar fora das páginas lidas durante um ou dois dias. Com 3 dias,
  esses artigos seriam desativados e reativados sem razão.
- Os artigos esgotados continuam nas listagens (`SoldOut`), por isso deixar de aparecer não quer dizer esgotar: quer
  dizer que o artigo saiu do catálogo ou ficou fora das páginas lidas. Um artigo que saiu mesmo fica inativo ao fim
  de uma semana.

## Artigos de exposição

- Selo `flags-item exhibition` "Artigo de Exposição". Usa o mesmo código, EAN e URL do artigo novo. A página
  explica: "Têm a caixa original aberta ou ligeiramente danificada ou sem embalagem. Incluem os acessórios e
  estes podem ser os originais ou não. Podem ter possíveis imperfeições estéticas." O preço é o da unidade
  de exposição.
- `parseListingPage` ignora estes cartões e `parseProductPage` devolve `priceCents`,
  `referencePriceCents`, `rrpCents` e `inStock` a `null`, para não misturar estes preços com os do artigo novo.

## Códigos com prefixo F

- Exemplos: `F140300`, `F116288` (o código é `F` + id interno). Nos cartões vistos a 27/10 estavam `SoldOut`,
  sem botão de carrinho; a 28/10 vimos vários `InStock` (AEG `F125554`, `F139092`). A página de `F140300` tem
  "Adicionar ao carrinho", "Entrega em 5 a 6 dias úteis", microdata `SoldOut` e poucas características
  (Modelo, Eficiência Energética, Garantia).
- Parecem artigos enviados pelo fornecedor, mas nada indica outro vendedor. Seguimos a microdata
  (`SoldOut` → sem stock).

## EAN

- `gtin13` nos cartões e na página de produto; também em `data-flix-ean` (Flixmedia) e em "EAN" nas
  características.
- As marcas próprias (Electronia, Princesse) usam um código interno: código RP + zeros + dígito de controlo
  (`1339128` → `1339128000005`). O dígito de controlo é válido, mas não é um GTIN da GS1, por isso `ean = null`.
  Eram 26 dos 117 cartões vistos.
- A loja guarda os códigos como números e perde os zeros à esquerda: `197532466562` (Lenovo, 12 dígitos na
  listagem, `0197532466562` na página), `45496337292` (Nintendo, 11 dígitos, é `0045496337292`). O scraper
  repõe os zeros até 13 dígitos quando o código tem 9 a 12 algarismos (não mexe nos de 8, que podem ser
  EAN-8). O runner valida depois com `normalizeGtin`.

## Página de produto

- `/produto/<slug>`, cerca de 1,1 MB. A microdata do produto está num bloco próprio no fim de `<main>`:
  `div[itemscope][itemtype="http://schema.org/Product"]` sem `itemprop`. Os carrosséis de produtos
  semelhantes também têm `article.product-grid-module` com microdata e não contam.
- Características: `#_characteristics ul.group .characteristic-group`, com `li.designation` e `li.value`,
  por grupos (DADOS, PESOS E DIMENSÕES, GESTÃO DE ENERGIA…). DADOS tem Marca, Modelo, Código Produto e EAN;
  o resto vai para `specs`.
- **Modelo:** nas marcas de fora, "Código Produto" é a referência do fabricante (Samsung `WW90FG3M05AWEP`;
  Lenovo `82XJ002FPG`, cujo "Modelo" é "IdeaPad Slim 3 Chrome 14M868"). Nas marcas próprias, Modelo e
  Código Produto são o código RP (Electronia: `1336011`). Regra: o primeiro de Código Produto, Modelo e
  título que seja um só código com letras e algarismos e diferente do código RP; senão `null`.
- **Marca:** "Marca" de DADOS ("Samsung", "Lenovo"); senão a da microdata.
- **Imagem:** `meta[itemprop=image]`.
- **Preços:** os da microdata do produto; preço riscado em `.mpup.line-discount` e PVPR em `.mpup .no-strike`
  (ver Preços).
- Flixmedia: `data-flix-ean`, `data-flix-brand` e `data-flix-mpn` (vazio).

## Vendedor e marketplace

- Nenhum sinal de vendedores terceiros. Não há "Vendido por", "vendedor" nem "marketplace" nas páginas
  vistas (11 listagens, 5 páginas de produto, termos e condições). Os termos aplicam-se "a quaisquer
  transações de natureza comercial realizadas através da loja online da Radio Popular - Electrodomésticos,
  S.A." e não falam de vendedores parceiros.
- Conclusão: a Radio Popular não vende artigos de terceiros (ponto em aberto do plano). `isSoldByStore`
  devolve `true` e `sellerName` fica `null`.

## Pedidos

Reconhecimento, 27/10/2026 (UTC):

|     # | Hora        | Pedido                                                  | Resposta |
| ----: | ----------- | ------------------------------------------------------- | -------- |
|   1–2 | 23:14       | `includes/js/productsGrid.js`, `includes/js/rp.js`      | 200      |
|     3 | 23:19       | `/categoria/maquinas-de-lavar-roupa`                    | 200      |
|     4 | 23:20       | `GET /ajax?method=getProducts&…&pageNumber=2`           | **429**  |
|     5 | 23:22       | `/produto/maquina-lavar-roupa-samsung-ww90fg3m05awep`   | 200      |
|     6 | 23:23       | `POST /ajax` (o mesmo pedido que o site faz)            | **429**  |
|     7 | 23:25       | `/pagina/termos-e-condicoes`                            | 200      |
|  8–16 | 23:25–23:27 | 9 categorias de topo (contagens do filtro)              | 200      |
| 17–19 | 23:31–23:33 | 3 páginas de produto (exposição, código F, pré-venda)   | 200      |
|    20 | 23:35       | `/categoria/maquinas-de-lavar-roupa?pf-order=price+asc` | 200      |

A página de produto `maquina-lavar-roupa-electronia-ems686br` foi lida antes, às 22:45, no reconhecimento
inicial. Com o scraper pronto, `pnpm scrape --store radiopopular --dry-run --limit 50` fez mais 6 pedidos
(`robots.txt` e 5 listagens, todos 200): 50 artigos, 0 erros, nenhuma página de produto.

Percurso por filtros e ordenações, 28/10/2026 (UTC), depois da recolha completa das 09:00–09:12:

|     # | Hora        | Pedido                                                                                  | Resposta |
| ----: | ----------- | --------------------------------------------------------------------------------------- | -------- |
|     1 | 09:24       | `robots.txt` (igual ao de 27/10)                                                        | 200      |
|   2–4 | 09:24       | Máquinas de lavar roupa, marca AEG: relevância, preço ascendente, preço descendente     | 200      |
|  5–24 | 09:27–09:32 | 1.ª página de 20 folhas (contagens de marcas e subcategorias)                           | 200      |
|    25 | 09:37       | Auriculares, três marcas com `or`, uma com apóstrofo (`T''nB`): 9 artigos, como somado  | 200      |
|    26 | 09:37       | Termoacumuladores, duas subcategorias com `or`, preço ascendente: 24 artigos            | 200      |
|    27 | 09:38       | Placas, duas marcas e uma subcategoria, A-Z: 14 artigos                                 | 200      |
| 28–30 | 09:39       | 1.ª página de 3 folhas médias                                                           | 200      |
| 31–32 | 09:58       | Máquinas de lavar roupa: subcategoria 10-11 Kg; marcas AEG a Bosch nela, preço asc.     | 200      |
| 33–40 | 10:06       | `pnpm scrape --store radiopopular --dry-run --limit 60`: `robots.txt` e 7 listagens     | 200      |
|    41 | 10:15       | TV 4K UHD, subcategoria 33-43 Polegadas (caminho com `TV''s`): 32 artigos, como contado | 200      |

## Fixtures

Em `packages/scrapers/fixtures/radiopopular/`. São **excertos** das páginas servidas a 27 e 28/10, reduzidos por
`packages/scrapers/scripts/trim-fixtures.ts` ao que o parser lê: o contentor com `data-products-total`, os filtros
de marca e de categoria (com as contagens), os cartões (microdata, ligação, imagem, preço, PVPR, preço riscado e selo
de exposição), o bloco de microdata do produto, as características e as linhas de preço (`.mpup`). Mantêm a
estrutura, os atributos e o texto originais desses elementos (sem atributos `style`). Saíram os scripts, os
estilos, o menu, o rodapé, as descrições, os selos ("-10% em talão", "Folheto", pré-venda, ofertas, reembolsos,
códigos promocionais; fica só o de exposição), as percentagens de desconto, as mensagens de entrega, as avaliações,
os textos legais e os outros filtros. Cada ficheiro começa por um comentário a dizer que é um excerto.

- `categoria-maquinas-de-lavar-roupa.html`: 1.ª página da categoria, sem filtros (27/10).
- `categoria-maquinas-de-lavar-roupa-10-11-kg.html`: a categoria filtrada pela subcategoria 10-11 Kg (28/10).
- `categoria-maquinas-de-lavar-roupa-10-11-kg-aeg-a-bosch-preco-asc.html`: marcas AEG, Balay, Beko e Bosch
  dentro da subcategoria 10-11 Kg, por preço ascendente (28/10).
- `categoria-maquinas-de-lavar-roupa-marca-aeg-preco-desc.html`: marca AEG por preço descendente (28/10).
- `listagem-variantes.html`: seis cartões de páginas servidas a 27/10, dentro do contentor da listagem: preço
  riscado com pré-venda (GTA VI), pré-venda sem desconto e EAN sem os zeros à esquerda (Nintendo), exposição
  (Lenovo), esgotado com PVPR (TV Samsung), código F esgotado (VOX) e sem PVPR, com UPC de 12 dígitos (iPhone).
- `produto-samsung-ww90fg3m05awep.html`: marca de fora, PVPR, carrossel com outros produtos.
- `produto-electronia-ems686br.html`: marca própria (EAN interno, Modelo igual ao código RP).
- `produto-lenovo-ideapad-exposicao.html`: artigo de exposição, Código Produto diferente do Modelo, UPC.
- `produto-gta-vi-pre-venda.html`: preço riscado e pré-venda.

Para juntar uma página nova, guarda-a como servida e corre, na raiz do repositório,
`pnpm --filter @descontoreal/scrapers exec tsx scripts/trim-fixtures.ts radiopopular fixtures/radiopopular/<ficheiro>`.
O script só grava o excerto quando o parser lê o mesmo na página inteira e no excerto. Se o parser passar a ler
outra parte da página, acrescenta-a às regras da Radio Popular em `TRIM_RULES` e reduz uma página acabada de
guardar: os excertos já não a têm. O teste `test/stores/trim-fixtures.test.ts` falha se uma fixture tiver mais do
que as regras guardam.

## Pontos em aberto para o dono

1. **Paginação:** resolvida a 28/10 com os filtros e as ordenações do site (cerca de 85% do catálogo mapeado).
   Ficam por ler parte das marcas grandes sem subcategorias (cerca de 60 artigos por marca) e parte dos artigos
   sem marca no filtro. Uma melhoria possível é dividir essas marcas por outro filtro (capacidade, cor).
2. **PVPR:** decidido a 28/10: `rrpCents`, só informação.
3. **Artigos de exposição:** ficam de fora. Confirmar.
4. **Acessórios dentro das folhas:** as subcategorias de acessórios de exaustores, placas e fornos ficam de
   fora (cerca de 40 artigos). Confirmar.
