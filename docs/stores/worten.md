# Worten (worten.pt)

**Estado: bloqueada ao nosso bot desde 27/10/2026. Não recolher.** Na base de dados fica com `stores.active = false`.

## O que encontrámos

Reconhecimento feito a 27/10/2026 com o User-Agent `DescontoRealBot/1.0 (+https://descontoreal.pt/bot)`, um pedido de cada vez.

- **robots.txt** (`User-agent: *`): permite `/produtos/` e os sitemaps (`/_/sitemap/`). Proíbe `/search`, `/api`, `/cliente`, `/carrinho`, a paginação `?page=`, `per_page` e várias ordenações (`sort_by=…`). O GPTBot e o CCBot estão proibidos em `/produtos/`.
- **Sitemaps**: o índice `https://www.worten.pt/_/sitemap/sitemap_index_wortenpt.xml` tem 1267 ficheiros com até 25 000 URLs cada, cerca de 30 milhões no total e a maioria do marketplace.
  - Catálogo próprio: `/produtos/<slug>-<id de 7 dígitos>`, por exemplo `/produtos/maquina-de-lavar-roupa-aeg-l6fbk847p-8-kg-1400-rpm-branco-7496352`.
  - Marketplace: `/produtos/<slug>-mrkean-<EAN>`.
  - Os `lastmod` são todos de fevereiro de 2026, por isso não indicam mudanças de preço. Os sitemaps não trazem preços.
- **Bloqueio**: todas as páginas HTML (início, categorias e produtos) respondem **403 com o desafio gerido do Cloudflare**: "Just a moment…", "Enable JavaScript and cookies to continue", `cType: 'managed'`. Só o `robots.txt` e os sitemaps respondem 200.
- Mesmo sem o bloqueio, o `robots.txt` proíbe a paginação das listagens e o `/api`. A recolha teria de ser feita página de produto a página de produto, e ao ritmo do plano (2 a 5 s por pedido) isso não cobre o catálogo num dia.

## Decisão

Não contornar: nada de User-Agent de browser, browser automatizado para passar o desafio ou proxies (CLAUDE.md, "Pergunta antes de"). A loja fica inativa até haver uma via autorizada.

## Vias legítimas

1. **Programa de afiliados na Awin.** O perfil "Worten PT" tem o ID 99897 e a comissão vai até 4,5%, segundo a [página do programa](https://www.worten.pt/programa-afiliados) e o [perfil na Awin](https://ui.awin.com/merchant-profile/99897). Quando o site estiver público, candidatar-nos e pedir o feed de produtos. É a fonte n.º 1 do plano: legal, estável, com EAN e preço.
2. **Pedir autorização à Worten** para o DescontoRealBot. O Cloudflare permite que a loja autorize um bot por User-Agent e IP. O modelo do email está abaixo.
3. **Cloudflare Verified Bots.** Exige um bot público com tráfego relevante, por isso só faz sentido mais tarde.

## Modelo de pedido

> **Assunto:** Pedido de acesso para o DescontoRealBot
>
> Olá,
>
> Sou o responsável pelo DescontoReal (descontoreal.pt), um site gratuito que guarda o histórico de preços de eletrónica e eletrodomésticos nas lojas portuguesas e mostra como cada desconto anunciado se compara com a evolução do preço.
>
> O nosso robô identifica-se como `DescontoRealBot/1.0 (+https://descontoreal.pt/bot)`. Respeita o robots.txt, faz um pedido de cada vez com 2 a 5 segundos de intervalo e corre uma vez por dia, de madrugada. Neste momento o vosso site bloqueia-o, e não o vamos contornar.
>
> Aceitariam autorizá-lo? Em alternativa, podemos usar um feed de produtos, por exemplo através do vosso programa de afiliados. Guardamos só factos (preço, nome, EAN e especificações), não copiamos descrições e as imagens ligam sempre para a vossa página.
>
> Obrigado,
> [o teu nome]
