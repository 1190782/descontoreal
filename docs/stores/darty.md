# Darty (darty.pt)

**Estado: ativa.** O preço de cada dia vem da página de produto de cada artigo em stock (decisão do dono, 28/10/2026); a listagem JSON serve para encontrar os artigos (ver "Preços").

Reconhecimento feito a 27/10/2026 com o User-Agent `DescontoRealBot/1.0 (+https://descontoreal.pt/bot)`, um pedido de cada vez, 2 a 5 s entre pedidos: 36 pedidos (35 à darty.pt e 1 ao `robots.txt` do Algolia). Nenhum bloqueio: só o teste de paginação profunda deu erro (HTTP 400, ver "Fontes de dados").

A 28/10/2026, nas mesmas condições e só à darty.pt: 112 pedidos para contar os artigos em stock de todas as coleções mapeadas (só listagens, ver "Volume e tempo de recolha"), 10 para ver o bloco de preço de 8 páginas de produto de categorias diferentes e 23 na simulação `pnpm scrape --store darty --dry-run --limit 20` (2 listagens e 20 páginas de produto, sem erros). Nenhum bloqueio nem erro.

## Plataforma

- Shopify (loja `mediamarkt-v2.myshopify.com`). A Darty é a antiga MediaMarkt Portugal. `www.darty.pt` redireciona para `darty.pt`.
- As páginas de coleção (`/collections/<handle>`) não trazem artigos no HTML: a grelha é montada no browser a partir de um índice Algolia (ver "Fontes de dados").

## robots.txt

- É o da Shopify com acrescentos. Permite `/products/…`, `/collections/…` e os `.json`. Proíbe `sort_by`, filtros combinados, `/cart.js`, `/recommendations/products`, `/checkout`, `/account`, `/services` e `/sf_*`.
- Tem texto dirigido a agentes de IA (UCP/MCP, instalar "skills"). Ignorado: não usamos esses endpoints.
- `sitemap.xml` aponta para 49 ficheiros de produtos (a Shopify põe até 5 000 URLs em cada, ou seja, até ~245 000 produtos, muitos descontinuados), 2 de coleções, páginas, blogues e um `sitemap_agentic_discovery.xml` (não usado).

## Fontes de dados

| Fonte                                                                              | O que tem                                                                                                                                                                                                    | Uso                                                                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/collections/<handle>/products.json?limit=250&page=N`                             | Título, handle, `vendor` (marca), `product_type`, variantes (`sku`, `price`, `compare_at_price`, `available`), imagens. Sem EAN nem metafields                                                               | Listagem diária: que artigos há, com SKU, URL, marca, modelo, imagem, EAN do handle e stock. O preço não é gravado (é o preço base)                  |
| Página de produto (HTML)                                                           | JSON-LD `Product` com `offers.price` (preço de venda), `offers.availability`, `gtin`, `sku`, `brand` e `image`; bloco de preço com o PVPr; especificações em `ul.specs-list`; `window.product` com `barcode` | Todos os dias, para cada artigo em stock: preço de venda, PVPr e stock; os dados do produto quando o artigo é novo ou foram vistos há 7 dias ou mais |
| `/products/<handle>.json` e `.js`                                                  | `barcode` (EAN) e o preço base                                                                                                                                                                               | Não usado: o preço não é o de venda                                                                                                                  |
| `/products.json` (catálogo inteiro)                                                | O mesmo que as coleções                                                                                                                                                                                      | Não serve: a Shopify recusa `page × limit` acima de 25 000 (HTTP 400, "Page \* Limit exceeds the 25000 limit.")                                      |
| Índice Algolia `shopify_production_products` (chave de pesquisa pública na página) | O que as listagens do site mostram, incluindo as campanhas com preço e datas                                                                                                                                 | Não usado: é um serviço de terceiros (`*.algolia.net`)                                                                                               |

### Paginação

- Máximo de 250 artigos por página. A coleção acaba na primeira página com menos de 250; a seguinte vem vazia (`{"products":[]}`).
- Exemplo: TVs (`tvs`) tem 1 373 produtos em 6 páginas (a 6.ª com 123).
- A ordem é a da coleção. Não dá para a mudar: o robots.txt proíbe `sort_by`.
- Uma página cheia pode não ter nenhum artigo em stock: na simulação de 28/10, a 1.ª página das TVs deu 7 artigos e a 2.ª 45. O runner passa à página seguinte enquanto ela existir, mesmo depois de uma página sem artigos.

## Preços

- O `price` da Shopify (listagem, `.json`, `.js` e `window.product`) é o preço base, que a Darty mostra como **PVPr**. O preço de venda vem de campanhas guardadas no metafield `custom.campaigns_detail` (preço, PVPr e datas de cada campanha). A página de produto aplica-as no servidor; as listagens aplicam-nas no browser a partir do Algolia (`headless-catalog.js`, `getActiveCampaignData`: fica o preço mais baixo das campanhas ativas e, sem campanha, o `price`).
- `compare_at_price` é sempre igual a `price`: nenhuma diferença nas 20 619 variantes das 48 coleções mapeadas (contagem de 28/10/2026).
- Em 9 de 9 páginas de produto vistas a 27/10, o preço de venda era mais baixo do que o `price` da listagem:

| Artigo                                      | SKU       | `price` na listagem | Preço na página | Etiqueta          |
| ------------------------------------------- | --------- | ------------------- | --------------- | ----------------- |
| Smart TV Hisense 65" 65E8S                  | T00245587 | 999,99 €            | 849,99 €        | -15% sobre o PVPr |
| Smart TV LG 55" 55QNED8MB6C                 | T00297176 | 619,99 €            | 479,99 €        | -23% sobre o PVPr |
| Smart TV TCL 55" 55C7L                      | T00250460 | 999,99 €            | 799,99 €        | -20% sobre o PVPr |
| Smart TV Samsung 65" 65R85H                 | T00252961 | 2 299,99 €          | 1 299,99 €      | -43% sobre o PVPr |
| Smart TV Samsung 55" 55QN80H                | T00252953 | 1 299,99 €          | 949,99 €        | -27% sobre o PVPr |
| Smart TV LG 32" 32LQ630B                    | 2499590   | 309,99 €            | 229,99 €        | -26% sobre o PVPr |
| Smart TV Hisense 58" 58A6Q                  | T00162680 | 529,99 €            | 459,99 €        | -13% sobre o PVPr |
| Smart TV LG 43" 43LR6000LA (esgotada)       | T00182499 | 299,99 €            | 239,99 €        | -20% sobre o PVPr |
| Máquina de lavar roupa Samsung WW90CGC04DAE | T00100854 | 689,99 €            | 427,99 €        | -38% sobre o PVPr |

### Como recolhemos o preço (decisão de 28/10/2026)

- `pricesFromProductPage: true` em `src/stores/darty.ts`: o runner lê a página de produto de cada artigo em stock em todas as recolhas, pelo mesmo fetcher (um pedido de cada vez, 2 a 5 s entre pedidos). Estas leituras são o trabalho principal da recolha e não contam para o `--max-product-pages`.
- Da página saem o preço de venda, o PVPr e o stock. A mesma página dá os dados do produto (EAN, marca, modelo, imagem, especificações), gravados quando o artigo é novo ou quando foram vistos há 7 dias ou mais (dias de calendário em Lisboa): sem segundo pedido, sem revisita semanal à parte e sem nova leitura para confirmar saltos de preço.
- Se a página falhar, não tiver preço ou mostrar outro SKU, o artigo fica de fora nesse dia, com um erro na execução. O preço base da listagem nunca é gravado.
- Se mais de 30% das páginas de produto de uma recolha não derem preço, a execução fica falhada e chega um email ao administrador: as listagens continuam normais quando só o parser da página de produto parte.

### Página de produto

- **Preço** = `offers.price` do JSON-LD; sem ele, a linha `.scx-price--line-regular` do bloco de preço principal (`.scx-product-info--wrapper .scx-price--container`). Os dois coincidiram nas 11 páginas vistas. O JSON-LD às vezes traz uma terceira casa decimal a zero ("428.990" no frigorífico Hisense RB390N4AWE); o parser aceita-a.
- **PVPr** = `.scx-price--line-pvpr`, com o rótulo "PVPr\*" e a percentagem "-x% sobre o PVPr". É o "Preço de venda recomendado para o produto em questão, definido e indicado pelo fabricante, produtor ou fornecedor", não um preço anterior da Darty. Fica em `rrpCents` (`price_points.rrp_cents`), só como informação: nunca é o preço de referência nem conta como desconto anunciado.
- **Sem campanha**, o bloco mostra só o preço (igual ao preço base) e não há PVPr: Nintendo Switch V2 a 299,99 €, Lenovo Yoga Slim 6 a 999,99 € e Samsung Galaxy Watch Ultra 2 a 749,99 € (28/10). O `rrpCents` fica vazio.
- **Preço riscado: a Darty não mostra nenhum preço anterior seu.** Nas 11 páginas vistas (as 3 das fixtures, de 27/10, e 8 de 28/10, de TVs, smartphones, consolas, portáteis, máquinas de café, robôs aspiradores, auriculares, frigoríficos e smartwatches), o bloco de preço só tem o PVPr e o preço de venda: não há `<s>`, `<del>`, `line-through` nem texto como "preço mais baixo dos últimos 30 dias". O `z_price.css` do tema só define a linha do preço e a do PVPr. O `compare_at_price` da Shopify, que noutros temas aparece riscado, é sempre igual ao preço. Por isso o `referencePriceCents` da Darty fica sempre vazio. Se um dia aparecer um preço riscado que não seja o PVPr, é preciso rever o parser.

### Outras fontes de preço (não usadas)

- **Índice Algolia** que as listagens do site usam: até 1 000 artigos por pedido, com as campanhas. É um serviço de terceiros (`*.algolia.net`, sem robots.txt), com a chave pública da página. Não usado.
- **Feed do programa de afiliados** (fonte n.º 1 do plano). A Darty tem programa na Awin (anunciante 120908, ver `/pages/programa-de-afiliados`) e aceita expressamente comparadores de preços. É a via estável e autorizada, depois de o site ser aprovado, e reduziria a recolha a alguns pedidos por dia.

## Volume e tempo de recolha

Contagem a 28/10/2026 com as listagens de todas as coleções mapeadas (111 páginas, sem páginas de produto): **4 128 artigos em stock**, depois dos filtros de tipo e de outlet e sem os repetidos entre coleções.

- Cada artigo custa um pedido por dia. Medido a 28/10: cerca de 4,3 s por pedido (pausa de 2 a 5 s e ~0,5 s para uma página de ~700 KB).
- **Tudo:** (4 128 artigos + 111 listagens) × 4,3 s ≈ 5 h 04 min. Passa das ~5 h pedidas e não deixa folga para o stock crescer (Black Friday).
- **Ativas (43 coleções, `DARTY_CATEGORIES`):** 3 607 artigos e 98 listagens ≈ 4 h 26 min. Ficam cerca de 54 min de folga até aos 320 min do `--max-minutes` do `scrape.yml`.
- **Inativas (5 coleções, `DARTY_INACTIVE_CATEGORIES`):** 521 artigos de menor valor, ≈ 38 min por dia. Continuam mapeadas; para as voltar a recolher, basta mover a entrada para `DARTY_CATEGORIES` (e confirmar que o tempo chega).
- As coleções ativas estão por ordem de valor. Se uma recolha chegar ao limite de tempo, grava o que leu, conta como parcial, avisa o administrador e as coleções que ficam por ler são as últimas da lista.

"Produtos" conta tudo o que a coleção tem, incluindo descontinuados; "Disponíveis", os produtos com uma variante disponível; "Recolhidos", os artigos em stock que ficam depois dos filtros, sem os já vistos numa coleção anterior da lista.

| #   | Chave (`--category`)                   | Coleção da Darty                | Produtos | Disponíveis | Recolhidos | Listagens |
| --- | -------------------------------------- | ------------------------------- | -------: | ----------: | ---------: | --------: |
| 1   | televisores                            | tvs                             |    1 373 |         245 |        227 |         6 |
| 2   | maquinas-de-lavar-roupa                | maquinas-de-lavar-roupa         |      459 |          88 |         76 |         2 |
| 3   | maquinas-de-lavar-loica                | maquinas-de-lavar-loica         |      443 |          79 |         70 |         2 |
| 4   | frigorificos                           | frigorificos                    |      823 |         134 |        122 |         4 |
| 5   | portateis                              | portateis                       |    1 915 |         142 |        133 |         8 |
| 6   | portateis-gaming                       | portateis-gaming                |      296 |          33 |     0 (\*) |         2 |
| 7   | smartphones                            | smartphones                     |    1 263 |         287 |        287 |         6 |
| 8   | tablets                                | tablets-e-readers               |      695 |         116 |        110 |         3 |
| 9   | monitores                              | monitores                       |      442 |          99 |         99 |         2 |
| 10  | monitores-gaming                       | monitores-gaming                |      196 |          44 |     0 (\*) |         1 |
| 11  | robots-aspiradores                     | aspiradores-robot               |      157 |          44 |         39 |         1 |
| 12  | maquinas-de-cafe                       | maquinas-de-cafe                |      501 |         140 |        118 |         3 |
| 13  | maquinas-de-secar-roupa                | maquinas-de-secar-roupa         |      200 |          24 |         24 |         1 |
| 14  | maquinas-de-lavar-e-secar-roupa        | maquinas-de-lavar-e-secar-roupa |       85 |          11 |         10 |         1 |
| 15  | arcas-e-congeladores                   | arcas                           |      184 |          19 |         19 |         1 |
| 16  | fornos                                 | fornos                          |      493 |          84 |         76 |         2 |
| 17  | placas                                 | placas-de-encastre              |      620 |          92 |         91 |         3 |
| 18  | exaustores                             | exaustores                      |      354 |          40 |         40 |         2 |
| 19  | fogoes                                 | fogoes                          |      233 |          39 |         30 |         1 |
| 20  | micro-ondas                            | micro-ondas                     |      325 |          87 |         82 |         2 |
| 21  | ar-condicionado                        | ar-condicionado                 |      105 |          13 |         12 |         1 |
| 22  | esquentadores                          | esquentadores                   |       79 |          10 |         10 |         1 |
| 23  | termoacumuladores                      | termoacumuladores               |       69 |          33 |         33 |         1 |
| 24  | consolas                               | consolas                        |      166 |          24 |         24 |         1 |
| 25  | fritadeiras                            | airfryers                       |      195 |          40 |         39 |         1 |
| 26  | aspiradores                            | aspiracao-limpeza               |      701 |         238 |        120 |         3 |
| 27  | barras-de-som                          | soundbars                       |      139 |          50 |         46 |         1 |
| 28  | auscultadores                          | auscultadores-e-auriculares     |    1 474 |         627 |        618 |         6 |
| 29  | smartwatches                           | smartwatches                    |    1 727 |         407 |        214 |         7 |
| 30  | colunas                                | colunas-de-som                  |      660 |         181 |        162 |         3 |
| 31  | projetores                             | projetores-video                |      101 |          46 |         45 |         1 |
| 32  | computadores-de-secretaria             | desktops                        |      491 |          42 |         42 |         2 |
| 33  | computadores-de-secretaria-gaming      | desktops-gaming                 |       88 |           8 |     0 (\*) |         1 |
| 34  | camaras                                | maquinas-fotograficas           |      534 |         183 |        181 |         3 |
| 35  | drones                                 | drones                          |      126 |          17 |         15 |         1 |
| 36  | impressoras                            | impressoras                     |      180 |          43 |         41 |         1 |
| 37  | robots-de-cozinha                      | robots-de-cozinha               |      140 |          34 |         16 |         1 |
| 38  | cuidado-do-cabelo                      | cuidados-cabelo                 |      300 |         127 |        107 |         2 |
| 39  | maquinas-de-barbear                    | aparadores-e-depiladoras        |      382 |         135 |         78 |         2 |
| 40  | maquinas-de-barbear-cortar-cabelo      | maquinas-de-cortar-cabelo       |       30 |          17 |         15 |         1 |
| 41  | aquecedores                            | aquecimento                     |      266 |          92 |         80 |         2 |
| 42  | desumidificadores                      | desumidificadores               |       80 |          31 |         31 |         1 |
| 43  | ventoinhas                             | ventilacao                      |      255 |          26 |         25 |         2 |
|     | **Ativas**                             |                                 |          |             |  **3 607** |    **98** |
| —   | pequenos-aparelhos-de-cozinha          | pequeno-almoco                  |      626 |         202 |        187 |         3 |
| —   | pequenos-aparelhos-de-cozinha-confecao | confecao-e-preparacao-alimentos |    1 158 |         289 |        114 |         5 |
| —   | armazenamento                          | armazenamento                   |      504 |         144 |        131 |         3 |
| —   | engomar                                | tratamento-de-roupa             |      241 |          84 |         51 |         1 |
| —   | escovas-de-dentes-eletricas            | escovas-de-dentes-eletricas     |       81 |          39 |         38 |         1 |
|     | **Inativas**                           |                                 |          |             |    **521** |    **13** |

\* Os portáteis, monitores e computadores gaming em stock já aparecem na coleção principal. As três coleções gaming custam 4 listagens por dia e ficam para o caso de a Darty lá pôr artigos que não estejam na principal.

- Escolha: ficaram de fora os pequenos aparelhos de cozinha (torradeiras, jarros elétricos, liquidificadoras, varinhas, grelhadores…), o armazenamento (pens USB, cartões, discos), o engomar e as escovas de dentes elétricas: artigos baratos, com menos interesse para descontos. Os auscultadores (618) são a maior coleção, mas ficam: são dos artigos mais procurados no Black Friday.

## Vendedor

- **Sem marketplace.** Nenhuma das páginas de produto vistas diz "vendido por", o JSON-LD não tem `seller`, o script das listagens não trata vendedores e o `vendor` é a marca. A página DSA (`/pages/dsa`) só refere "prestadores de serviços terceiros" (instalações). `isSoldByStore` devolve `true`.
- Os serviços (instalações, extensões de garantia) são produtos do tipo "Serviços", com `vendor` "FNAC" ou "Darty". Ficam fora pelo filtro de tipo.

## Outlet

- Artigos "Outlet - Grade A/B/C" (e "Outlet Loja Benfica - Grade C") aparecem nas coleções normais, com SKU próprio e um código interno `2200…` no fim do handle: 74 em 3 778 produtos vistos a 27/10. São artigos abertos ou usados, por isso ficam fora.

## Stock

- `available` por variante. As coleções guardam muitos produtos descontinuados como indisponíveis: dos ~22 000 produtos das coleções mapeadas, só ~5 000 estavam disponíveis a 28/10. O site esconde-os por omissão (filtro `inventory_available:true` no Algolia).
- **Só recolhemos artigos disponíveis.** Um artigo que esgote deixa de aparecer e fica inativo ao fim de 3 recolhas completas seguidas sem ele (regra do plano). O `maxMissedRuns` fica no valor por omissão (3): o `products.json` de cada coleção lê-se até ao fim, por isso um artigo disponível aparece sempre, e um artigo que falte esgotou ou saiu da coleção. As recolhas parciais (`--max-minutes`) não contam.
- Na página de produto, `offers.availability` é `InStock` ou `OutOfStock`. É o stock gravado; sem ele, conta o da listagem.

## Variantes

- Os 20 619 produtos das 48 coleções mapeadas (28/10) têm todos uma só variante ("Default Title"): cada SKU é um produto. Se aparecer um com várias, cada variante disponível conta como um artigo, com URL `?variant=<id>`.

## Identificadores

- **SKU**: `variants[].sku`, "T" seguido de 8 dígitos (artigos novos) ou 7 dígitos (código antigo da MediaMarkt). Na página de produto, o `sku` do JSON-LD tem de ser o da listagem; se for outro, o artigo fica de fora nesse dia.
- **EAN**: no fim do handle em 18% dos produtos (32% dos disponíveis), validado com `normalizeGtin` (que recusa os códigos `2200…` do outlet). Está sempre na página de produto (`gtin` do JSON-LD, igual ao `barcode` da Shopify), mesmo quando o handle não o tem.
- **Marca**: `vendor`, com maiúsculas inconsistentes ("Samsung" e "SAMSUNG"; a normalização do core resolve). "Não Indentificado" conta como sem marca.
- **Modelo**: não há `mpn` nem campo de modelo. Sai do título: o primeiro código com pelo menos duas letras e dois dígitos, ignorando medidas e capacidades ("140cm", "9kg", "4K", "256GB") e processadores ("i7-13620H"). Exemplo: "Smart TV LG 55" QNED evo AI Mini-LED UHD 4K 55QNED8MB6C (2026) - 140cm" dá `55QNED8MB6C`. Sem código claro, fica vazio.

## Categorias

Mapeamento em `packages/scrapers/src/stores/darty.config.ts`: uma coleção do menu por entrada, com filtro pelo `product_type`, porque as coleções misturam tipos (a de máquinas de café tem café em grão e acessórios; a de máquinas de lavar roupa tem máquinas de lavar e secar e até um fogão). As chaves e coleções estão na tabela de "Volume e tempo de recolha".

- Tipos confirmados na contagem de 28/10. Projetores: o tipo da Darty é "Videoprojectores" (o filtro anterior deixava 0 de 46). Armazenamento (inativa): os "Discos CD/DVD/Blu-ray" são discos virgens e ficam de fora.
- Ficam de fora: acessórios, consumíveis, serviços, e-readers, anéis inteligentes, caves de vinho, climatizadores, depiladoras e conjuntos placa + forno.

## Fnac

- Plataformas diferentes: a Darty corre em Shopify e a Fnac bloqueia o nosso bot na CDN (`docs/stores/fnac.md`). Não há código a partilhar.
- Do lado da Darty: o "Trabalha Connosco" aponta para `recrutamento.fnacdarty.pt` e os serviços de instalação têm `vendor` "FNAC". Não encontrámos sinais de catálogo ou preços partilhados (sem acesso à Fnac, não dá para comparar).

## Fixtures

Em `packages/scrapers/fixtures/darty/`. São **excertos** das páginas e dos JSON servidos a 27 e 28/10, reduzidos por `packages/scrapers/scripts/trim-fixtures.ts` ao que o parser lê:

- **Páginas de produto:** o JSON-LD, o script do `window.product` (com o `barcode`), o `h1`, os blocos de preço (o principal, o da barra fixa e o do carrinho, que mostra 0 € e o parser não pode ler) e a primeira lista de especificações. Mantêm a estrutura, os atributos e o texto originais (sem atributos `style`). Saíram os outros scripts, os estilos, o menu, o rodapé, as descrições, os textos de campanhas, entrega e instalação, e as imagens. Os campos `description` e `content` dos JSON dos scripts ficam vazios. Cada ficheiro começa por um comentário a dizer que é um excerto.
- **JSON:** os 17, 15 e 10 produtos guardados de cada coleção, só com os campos que o parser lê (título, handle, marca, tipo, variantes com id, título, SKU, disponibilidade, preços e imagem) e a primeira imagem.

| Ficheiro                                    | O que mostra                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `collection-tvs.json`                       | TVs disponíveis, esgotadas e outlet; EAN no fim do handle ou não (27/10)     |
| `collection-maquinas-de-cafe.json`          | Coleção com máquinas de café, café e acessórios (27/10)                      |
| `collection-maquinas-de-lavar-roupa.json`   | Coleção com máquinas de lavar e de lavar e secar roupa (27/10)               |
| `product-hisense-65e8s.json`                | `/products/<handle>.json`, com o `barcode` e o preço base; não usado (27/10) |
| `product-lg-55qned8mb6c.html`               | Preço de campanha com PVPr (27/10)                                           |
| `product-lg-43lr6000la-esgotado.html`       | Esgotada, com preço de campanha (27/10)                                      |
| `product-samsung-ww90cgc04dae.html`         | Máquina de lavar com uma especificação repetida ("Cor") (27/10)              |
| `product-nintendo-switch-sem-campanha.html` | Sem campanha nem PVPr (28/10)                                                |
| `product-hisense-rb390n4awe.html`           | Preço do JSON-LD com três casas decimais ("428.990") (28/10)                 |

Para juntar uma página nova, guarda-a como servida e corre, na raiz do repositório, `pnpm --filter @descontoreal/scrapers exec tsx scripts/trim-fixtures.ts darty fixtures/darty/<ficheiro>`. O script só grava o excerto quando o parser lê o mesmo na página inteira e no excerto. Se o parser passar a ler outra parte da página, acrescenta-a às regras da Darty em `TRIM_RULES` e reduz uma página acabada de guardar: os excertos já não a têm. O teste `test/stores/trim-fixtures.test.ts` falha se uma fixture tiver mais do que as regras guardam.

## Decisões

- Listagem: `products.json` de cada coleção, 250 por página. Só variantes disponíveis, sem outlet nem recondicionados, filtradas por `product_type`. Uma página sem artigos não acaba a coleção: acaba a primeira página com menos de 250 produtos.
- Preço diário (decisão do dono, 28/10/2026): página de produto de cada artigo em stock, todos os dias. Preço = `offers.price` do JSON-LD (ou o bloco de preço); PVPr em `rrpCents`, só como informação; `referencePriceCents` sempre vazio, porque a Darty não mostra nenhum preço anterior seu.
- Dados do produto: da mesma página, para artigos novos e de 7 em 7 dias.
- Volume: 43 coleções ativas, por ordem de valor (≈ 4 h 26 min por dia), e 5 inativas. O `scrape.yml` corre com `--max-minutes 320`.
- Sem `requestHeaders` nem `productPageUrl`: a página de produto é o próprio URL do artigo.
