import type { CategorySlug } from "@descontoreal/core";
import type { StoreCategory } from "../types";

export const DARTY_BASE_URL = "https://darty.pt";
/** Shopify's largest page for products.json. */
export const DARTY_PAGE_SIZE = 250;

/** A Darty (Shopify) collection mapped onto one of our categories. */
export interface DartyCategory extends StoreCategory {
  /** Handle in https://darty.pt/collections/<handle>. */
  collection: string;
  /** Shopify product types kept from the collection, tested in lowercase and without accents. */
  productTypes: RegExp;
}

function category(
  key: string,
  categorySlug: CategorySlug,
  collection: string,
  productTypes: RegExp,
): DartyCategory {
  const url = `${DARTY_BASE_URL}/collections/${collection}/products.json?limit=${DARTY_PAGE_SIZE}`;
  return { key, categorySlug, url, collection, productTypes };
}

const LAPTOPS = /^(portateis|macbooks?|chromebooks?)\b/;
const DESKTOPS = /^(computadores|desktops?|pcs?|pc torre|all[- ]in[- ]one|imacs?|mac (mini|studio|pro))\b/;
const MONITORS = /^monitores\b/;
const SMALL_KITCHEN =
  /^(torradeiras|tostadeiras|sanduicheiras|liquidificadoras|espremedores|jarros eletricos|chaleiras eletricas|grelhadores|mini-fornos|batedeiras|varinhas|picadoras|processadores de alimentos|maquinas de (crepes|waffles|pipocas|gelados|pao|cozinhar)|fondues|iogurteiras|panelas eletricas|balancas de cozinha)\b/;

/**
 * Collections crawled every day, highest value first: a run that reaches --max-minutes leaves out the end of
 * this list. Each in-stock item costs one product-page request a day, about 4 s (docs/stores/darty.md,
 * "Volume e tempo de recolha"). Product types as seen in the full count of 28/10/2026.
 */
export const DARTY_CATEGORIES: readonly DartyCategory[] = [
  category("televisores", "televisores", "tvs", /^(televisores|tv)$/),
  category(
    "maquinas-de-lavar-roupa",
    "maquinas-de-lavar-roupa",
    "maquinas-de-lavar-roupa",
    /^maquinas de lavar roupa( de encastre)?$/,
  ),
  category(
    "maquinas-de-lavar-loica",
    "maquinas-de-lavar-loica",
    "maquinas-de-lavar-loica",
    /^maquinas de (lavar )?loica\b/,
  ),
  category("frigorificos", "frigorificos", "frigorificos", /^frigorificos?\b/),
  category("portateis", "portateis", "portateis", LAPTOPS),
  category("portateis-gaming", "portateis", "portateis-gaming", LAPTOPS),
  category("smartphones", "smartphones", "smartphones", /^smartphones?$/),
  category("tablets", "tablets", "tablets-e-readers", /^(tablets?|ipads?)$/),
  category("monitores", "monitores", "monitores", MONITORS),
  category("monitores-gaming", "monitores", "monitores-gaming", MONITORS),
  category(
    "robots-aspiradores",
    "robots-aspiradores",
    "aspiradores-robot",
    /^robots? (de limpeza|aspiradores?)\b/,
  ),
  category("maquinas-de-cafe", "maquinas-de-cafe", "maquinas-de-cafe", /^maquinas de cafe\b/),

  category(
    "maquinas-de-secar-roupa",
    "maquinas-de-secar-roupa",
    "maquinas-de-secar-roupa",
    /^maquinas de secar roupa\b/,
  ),
  category(
    "maquinas-de-lavar-e-secar-roupa",
    "maquinas-de-lavar-e-secar-roupa",
    "maquinas-de-lavar-e-secar-roupa",
    /^maquinas de lavar e secar roupa\b/,
  ),
  category("arcas-e-congeladores", "arcas-e-congeladores", "arcas", /^(arcas|congeladores)\b/),
  category("fornos", "fornos", "fornos", /^fornos?\b/),
  category("placas", "placas", "placas-de-encastre", /^placas?\b/),
  category("exaustores", "exaustores", "exaustores", /^exaustores?\b/),
  category("fogoes", "fogoes", "fogoes", /^fogoes\b(?!.*portat)/),
  category("micro-ondas", "micro-ondas", "micro-ondas", /^micro-ondas\b/),
  category("ar-condicionado", "ar-condicionado", "ar-condicionado", /^ar condicionado\b/),
  category("esquentadores", "esquentadores", "esquentadores", /^esquentadores\b/),
  category("termoacumuladores", "termoacumuladores", "termoacumuladores", /^termoacumuladores\b/),

  category("consolas", "consolas", "consolas", /^consolas?\b/),
  category("fritadeiras", "fritadeiras", "airfryers", /^fritadeiras\b/),
  category("aspiradores", "aspiradores", "aspiracao-limpeza", /^(aspiradores|mini aspiradores)\b/),
  category("barras-de-som", "barras-de-som", "soundbars", /^soundbars?$/),
  category("auscultadores", "auscultadores", "auscultadores-e-auriculares", /^(auriculares|auscultadores)\b/),
  category(
    "smartwatches",
    "smartwatches",
    "smartwatches",
    /^(smartwatches?|pulseiras desportivas|relogios desportivos)$/,
  ),
  category("colunas", "colunas", "colunas-de-som", /^(colunas|boombox|partybox)\b/),
  // Darty's type is "Videoprojectores".
  category("projetores", "projetores", "projetores-video", /^(video)?projec?tores?\b/),
  category("computadores-de-secretaria", "computadores-de-secretaria", "desktops", DESKTOPS),
  category("computadores-de-secretaria-gaming", "computadores-de-secretaria", "desktops-gaming", DESKTOPS),
  category("camaras", "camaras", "maquinas-fotograficas", /^(maquinas|camaras)\b/),
  category("drones", "drones", "drones", /^drones?$/),
  category("impressoras", "impressoras", "impressoras", /^impressoras\b/),
  category("robots-de-cozinha", "robots-de-cozinha", "robots-de-cozinha", /^robots de cozinha\b/),
  category(
    "cuidado-do-cabelo",
    "cuidado-do-cabelo",
    "cuidados-cabelo",
    /^(secadores|alisadores|modeladores|onduladores|escovas (de cabelo|secadoras|alisadoras|modeladoras))\b/,
  ),
  category(
    "maquinas-de-barbear",
    "maquinas-de-barbear",
    "aparadores-e-depiladoras",
    /^(maquinas de barbear|multigroomers?|aparadores)\b/,
  ),
  category(
    "maquinas-de-barbear-cortar-cabelo",
    "maquinas-de-barbear",
    "maquinas-de-cortar-cabelo",
    /^maquinas de cortar cabelo\b/,
  ),
  category(
    "aquecedores",
    "aquecedores",
    "aquecimento",
    /^(aquecedores|termoventiladores|convectores|emissores termicos|salamandras|radiadores|paineis radiantes)\b/,
  ),
  category("desumidificadores", "desumidificadores", "desumidificadores", /^desumidificadores\b/),
  category("ventoinhas", "ventoinhas", "ventilacao", /^(ventoinhas|torres? de ventilacao|colunas de ar)\b/),
];

/**
 * INACTIVE: mapped but not crawled, so that the daily run fits in its time (521 in-stock items of lower
 * value on 28/10/2026, about 38 min a day). Move an entry to DARTY_CATEGORIES to crawl it again.
 */
export const DARTY_INACTIVE_CATEGORIES: readonly DartyCategory[] = [
  category("pequenos-aparelhos-de-cozinha", "pequenos-aparelhos-de-cozinha", "pequeno-almoco", SMALL_KITCHEN),
  category(
    "pequenos-aparelhos-de-cozinha-confecao",
    "pequenos-aparelhos-de-cozinha",
    "confecao-e-preparacao-alimentos",
    SMALL_KITCHEN,
  ),
  category("armazenamento", "armazenamento", "armazenamento", /^(discos rigidos|ssd|pens usb|cartoes)\b/),
  category("engomar", "engomar", "tratamento-de-roupa", /^(ferros|centros de engomar|engomadores)\b/),
  category(
    "escovas-de-dentes-eletricas",
    "escovas-de-dentes-eletricas",
    "escovas-de-dentes-eletricas",
    /^(escovas de dentes eletricas|centros de higiene oral)\b/,
  ),
];
