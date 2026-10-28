import type { CategorySlug } from "@descontoreal/core";
import type { StoreCategory } from "../types";

const CATEGORY_URL = "https://www.radiopopular.pt/categoria/";

function leaves(categorySlug: CategorySlug, storeSlugs: readonly string[]): StoreCategory[] {
  return storeSlugs.map((slug) => ({ key: slug, categorySlug, url: `${CATEGORY_URL}${slug}` }));
}

/**
 * Sub-categories of a mapped leaf that the traversal skips: "Acessórios de Exaustor", "Filtros Exaustores",
 * "Acessórios de Placas"… are filed under the appliance itself (docs/stores/radiopopular.md, "Percurso").
 */
export const EXCLUDED_SUBCATEGORY = /^(acess[oó]rios|filtros)\b/i;

/**
 * Radio Popular menu leaves mapped onto our categories (docs/stores/radiopopular.md, "Categorias").
 * Leaves rather than parents, so that each item gets one of our categories. Accessories, refurbished items
 * and the "Encastre", "RP ENERGY" and "Lazer" copies of other families are left out.
 */
export const RADIOPOPULAR_CATEGORIES: StoreCategory[] = [
  ...leaves("maquinas-de-lavar-roupa", ["maquinas-de-lavar-roupa", "maquinas-de-lavar-roupa-encastre"]),
  ...leaves("maquinas-de-secar-roupa", ["maquinas-de-secar-roupa-1"]),
  ...leaves("maquinas-de-lavar-e-secar-roupa", [
    "maquinas-de-lavar-e-secar-roupa",
    "maquinas-de-lavar-e-secar-roupa-de-encastre",
  ]),
  ...leaves("maquinas-de-lavar-loica", ["maquina-de-lavar-louca", "maquina-de-lavar-louca-encastre"]),
  ...leaves("frigorificos", [
    "combinados",
    "frigorificos-1-porta",
    "combinados-de-encastre",
    "americano",
    "frigorificos-2-portas",
    "frigorificos-de-encastre",
    "frigobar",
  ]),
  ...leaves("arcas-e-congeladores", [
    "arcas-verticais-superior-a-1-60m",
    "arcas-encastre",
    "arcas-horizontais",
    "arcas-verticais-ate-90cm",
    "arcas-verticais-90cm-ate-1-60m",
  ]),
  ...leaves("fornos", ["fornos-1"]),
  ...leaves("placas", ["placas"]),
  ...leaves("exaustores", ["exaustores"]),
  ...leaves("fogoes", ["fogoes-mistos", "fogoes-eletricos", "fogoes-a-gas"]),
  ...leaves("micro-ondas", [
    "micro-ondas-de-encastre-1",
    "micro-ondas-com-grill-1",
    "micro-ondas-sem-grill-1",
  ]),

  ...leaves("televisores", ["tv-4k-uhd", "tv-oled", "tv-smart-tv-2", "tv-standard-2", "tv-transparente"]),
  ...leaves("barras-de-som", ["barras-de-som"]),
  ...leaves("colunas", ["colunas-bluetooth-1", "colunas-4", "alta-potencia"]),
  ...leaves("auscultadores", ["auriculares", "auscultadores-1", "auriculares-desportivos"]),
  // Laser TVs are ultra-short-throw projectors; RP lists them under TVs and under projection.
  ...leaves("projetores", ["video-projetor-2", "tv-laser-1"]),

  ...leaves("portateis", ["portateis-tradicionais-1", "portateis-gaming-3", "portateis-hibridos"]),
  ...leaves("computadores-de-secretaria", ["all-in-one", "desktop-gaming-2", "desktop", "mini-pc"]),
  ...leaves("monitores", [
    "monitores-gaming",
    "monitores-led-18-31",
    "monitores-led-32",
    "monitores-portateis",
  ]),
  ...leaves("tablets", ["tablets-2", "tablets-4g-5g"]),
  ...leaves("impressoras", ["impressoras-e-multifuncoes", "impressoras-fotografia"]),
  ...leaves("armazenamento", [
    "pen-usb-2",
    "cartoes-memoria",
    "discos-hdd-externos",
    "discos-ssd",
    "discos-ssd-externos",
    "discos-hdd",
  ]),

  ...leaves("smartphones", ["smartphones"]),
  ...leaves("smartwatches", ["smartwatches"]),

  ...leaves("aspiradores", [
    "aspirador-vertical",
    "aspirador-com-saco",
    "aspirador-sem-saco",
    "aspirador-mini",
    "aspirador-vertical-wet-dry",
    "aspirador-de-liquidos",
    "aspirador-de-cinzas",
  ]),
  ...leaves("robots-aspiradores", ["aspirador-robot"]),
  ...leaves("maquinas-de-cafe", [
    "maquinas-de-cafe-expresso-1",
    "maquinas-de-cafe-de-capsula-1",
    "maquinas-de-cafe-automaticas-1",
    "maquinas-de-cafe-de-saco-1",
    "maquinas-de-cafe-semi-automaticas",
    "maquinas-de-cafe-de-encastre",
  ]),
  ...leaves("fritadeiras", ["fritadeiras-sem-oleo-air-fryers", "fritadeiras-convencionais"]),
  ...leaves("robots-de-cozinha", ["preparadores-de-alimentos"]),
  ...leaves("pequenos-aparelhos-de-cozinha", [
    "torradeiras",
    "grelhadores",
    "jarros-eletricos",
    "liquidificadoras",
    "varinhas-magicas",
    "batedeiras",
    "picadoras-1",
    "mini-fornos-2",
    "espremedores-de-citrinos",
    "sandwicheiras-1",
    "centrifugadoras",
    "panelas-electricas",
    "maquina-de-pao",
    "slowcooker-1",
    "slow-juicer",
  ]),
  ...leaves("engomar", [
    "ferros-de-engomar-1",
    "ferros-com-caldeira",
    "ferros-vapor-vertical",
    "ferros-de-viagem-1",
    "central-de-engomar-1",
  ]),
  ...leaves("maquinas-de-barbear", [
    "aparadores-2",
    "maquinas-de-cortar-cabelo-e-barba-2",
    "maquinas-de-barbear-2",
  ]),
  ...leaves("cuidado-do-cabelo", [
    "secadores-de-cabelo-6",
    "modeladores-de-cabelo-3",
    "alisadores-de-cabelo-3",
    "conjunto-de-cabelo-3",
  ]),
  ...leaves("escovas-de-dentes-eletricas", ["escovas-dentais-1", "centros-dentais"]),

  ...leaves("ar-condicionado", ["ar-condicionado-fixo", "ar-condicionado-portatil"]),
  ...leaves("aquecedores", [
    "termoventilador-1",
    "aquecedores-eco-emissores",
    "aquecedores-a-oleo",
    "aquecedores-mica",
    "aquecedores-de-pes",
    "aquecedores-convetor",
    "aquecedores-a-gas",
    "toalheiro-eletrico",
    "aquecedores-de-halogeneo",
    "aquecedores-de-casa-de-banho",
    "escalfetas",
  ]),
  ...leaves("desumidificadores", ["desumidificadores"]),
  ...leaves("ventoinhas", [
    "ventoinhas-de-teto",
    "ventoinhas-de-pe",
    "ventoinhas-de-torre",
    "ventoinhas-de-mesa",
    "ventoinhas-bladeless",
    "ventoinhas-de-caixa-e-chao",
    "ventoinhas-nebulizadoras",
  ]),
  ...leaves("esquentadores", [
    "esquentadores-atmosfericos",
    "esquentadores-estanques",
    "esquentadores-ventilados",
  ]),
  // "Bomba de Calor" under water heating holds heat-pump water heaters.
  ...leaves("termoacumuladores", ["termoacumulador", "bomba-de-calor", "termoacumulador-hibrido-1"]),

  ...leaves("consolas", [
    "outras-consolas",
    "consola-nintendo-switch",
    "consola-nintendo-switch-2-2",
    "consola-ps5-1",
  ]),

  ...leaves("camaras", [
    "maquinas-fotograficas-mirrorless",
    "maquinas-fotograficas-instantaneas",
    "maquinas-fotograficas-compactas",
    "maquinas-fotograficas-reflex",
    "maquinas-fotograficas-bridge",
  ]),
  ...leaves("drones", ["drones-2"]),
];
