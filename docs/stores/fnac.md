# Fnac (fnac.pt)

**Estado: bloqueada ao nosso bot desde 27/10/2026. Não recolher.** Na base de dados fica com `stores.active = false`.

## O que encontrámos

Reconhecimento feito a 27/10/2026 com o User-Agent `DescontoRealBot/1.0 (+https://descontoreal.pt/bot)`.

- O próprio `https://www.fnac.pt/robots.txt` responde **403**. A resposta vem da cache da CDN da **Akamai** (`Server-Timing: cdn-cache; desc=HIT`, `ak_p`), ou seja, o bloqueio acontece na CDN antes de chegar ao site.
- Como nem o `robots.txt` é servido, não vimos sitemaps, listagens nem páginas de produto. As perguntas do plano sobre o marketplace e sobre se a Fnac partilha catálogo e preços com a Darty ficam sem resposta direta.
- A Darty, do mesmo grupo, corre em Shopify (ver `docs/stores/darty.md`). As duas lojas não partilham a plataforma do site.

## Decisão

Não contornar: nada de User-Agent de browser, browser automatizado ou proxies. A loja fica inativa até haver uma via autorizada.

## Vias legítimas

1. **Programa de afiliados.** Não encontrámos confirmação de um programa da Fnac Portugal na Awin. O [affi.io](https://affi.io/m/fnac) lista um programa "FNAC PT" na TradeDoubler como fechado. A Fnac França e a [Fnac Bélgica](https://ui.awin.com/merchant-profile/12648/commission-groups) estão na Awin, e o programa belga aceita comparadores de preços e dá acesso a um feed de produtos. Próximo passo: procurar "Fnac PT" no diretório de anunciantes da Awin e perguntar à Fnac Portugal quando o site estiver público.
2. **Pedir autorização à Fnac** para o DescontoRealBot, com o mesmo modelo de email da Worten (`docs/stores/worten.md`).
