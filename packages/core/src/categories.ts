export interface Category {
  slug: string;
  name: string;
  parent: string | null;
  /** Singular noun for product slugs and titles ("máquina de lavar roupa"). Leaf categories only. */
  singular?: string;
}

/** Our own category tree. Each store config maps its categories onto these leaves. */
// prettier-ignore
export const CATEGORIES = [
  { slug: "grandes-eletrodomesticos", name: "Grandes eletrodomésticos", parent: null },
  { slug: "maquinas-de-lavar-roupa", name: "Máquinas de lavar roupa", parent: "grandes-eletrodomesticos", singular: "máquina de lavar roupa" },
  { slug: "maquinas-de-secar-roupa", name: "Máquinas de secar roupa", parent: "grandes-eletrodomesticos", singular: "máquina de secar roupa" },
  { slug: "maquinas-de-lavar-e-secar-roupa", name: "Máquinas de lavar e secar roupa", parent: "grandes-eletrodomesticos", singular: "máquina de lavar e secar roupa" },
  { slug: "maquinas-de-lavar-loica", name: "Máquinas de lavar loiça", parent: "grandes-eletrodomesticos", singular: "máquina de lavar loiça" },
  { slug: "frigorificos", name: "Frigoríficos", parent: "grandes-eletrodomesticos", singular: "frigorífico" },
  { slug: "arcas-e-congeladores", name: "Arcas e congeladores", parent: "grandes-eletrodomesticos", singular: "congelador" },
  { slug: "fornos", name: "Fornos", parent: "grandes-eletrodomesticos", singular: "forno" },
  { slug: "placas", name: "Placas", parent: "grandes-eletrodomesticos", singular: "placa" },
  { slug: "exaustores", name: "Exaustores", parent: "grandes-eletrodomesticos", singular: "exaustor" },
  { slug: "fogoes", name: "Fogões", parent: "grandes-eletrodomesticos", singular: "fogão" },
  { slug: "micro-ondas", name: "Micro-ondas", parent: "grandes-eletrodomesticos", singular: "micro-ondas" },

  { slug: "tv-e-som", name: "TV e som", parent: null },
  { slug: "televisores", name: "Televisores", parent: "tv-e-som", singular: "televisor" },
  { slug: "barras-de-som", name: "Barras de som", parent: "tv-e-som", singular: "barra de som" },
  { slug: "colunas", name: "Colunas", parent: "tv-e-som", singular: "coluna" },
  { slug: "auscultadores", name: "Auscultadores", parent: "tv-e-som", singular: "auscultadores" },
  { slug: "projetores", name: "Projetores", parent: "tv-e-som", singular: "projetor" },

  { slug: "informatica", name: "Informática", parent: null },
  { slug: "portateis", name: "Portáteis", parent: "informatica", singular: "portátil" },
  { slug: "computadores-de-secretaria", name: "Computadores de secretária", parent: "informatica", singular: "computador" },
  { slug: "monitores", name: "Monitores", parent: "informatica", singular: "monitor" },
  { slug: "tablets", name: "Tablets", parent: "informatica", singular: "tablet" },
  { slug: "impressoras", name: "Impressoras", parent: "informatica", singular: "impressora" },
  { slug: "armazenamento", name: "Discos e armazenamento", parent: "informatica", singular: "disco" },

  { slug: "telemoveis-e-wearables", name: "Telemóveis e wearables", parent: null },
  { slug: "smartphones", name: "Smartphones", parent: "telemoveis-e-wearables", singular: "smartphone" },
  { slug: "smartwatches", name: "Smartwatches e pulseiras", parent: "telemoveis-e-wearables", singular: "smartwatch" },

  { slug: "pequenos-eletrodomesticos", name: "Pequenos eletrodomésticos", parent: null },
  { slug: "aspiradores", name: "Aspiradores", parent: "pequenos-eletrodomesticos", singular: "aspirador" },
  { slug: "robots-aspiradores", name: "Robôs aspiradores", parent: "pequenos-eletrodomesticos", singular: "robô aspirador" },
  { slug: "maquinas-de-cafe", name: "Máquinas de café", parent: "pequenos-eletrodomesticos", singular: "máquina de café" },
  { slug: "fritadeiras", name: "Fritadeiras e air fryers", parent: "pequenos-eletrodomesticos", singular: "fritadeira" },
  { slug: "robots-de-cozinha", name: "Robôs de cozinha", parent: "pequenos-eletrodomesticos", singular: "robô de cozinha" },
  { slug: "pequenos-aparelhos-de-cozinha", name: "Pequenos aparelhos de cozinha", parent: "pequenos-eletrodomesticos", singular: "aparelho de cozinha" },
  { slug: "engomar", name: "Ferros e centros de engomar", parent: "pequenos-eletrodomesticos", singular: "ferro de engomar" },
  { slug: "maquinas-de-barbear", name: "Máquinas de barbear e aparadores", parent: "pequenos-eletrodomesticos", singular: "máquina de barbear" },
  { slug: "cuidado-do-cabelo", name: "Secadores e modeladores", parent: "pequenos-eletrodomesticos", singular: "secador" },
  { slug: "escovas-de-dentes-eletricas", name: "Escovas de dentes elétricas", parent: "pequenos-eletrodomesticos", singular: "escova de dentes elétrica" },

  { slug: "climatizacao", name: "Climatização", parent: null },
  { slug: "ar-condicionado", name: "Ar condicionado", parent: "climatizacao", singular: "ar condicionado" },
  { slug: "aquecedores", name: "Aquecedores", parent: "climatizacao", singular: "aquecedor" },
  { slug: "desumidificadores", name: "Desumidificadores", parent: "climatizacao", singular: "desumidificador" },
  { slug: "ventoinhas", name: "Ventoinhas", parent: "climatizacao", singular: "ventoinha" },
  { slug: "esquentadores", name: "Esquentadores", parent: "climatizacao", singular: "esquentador" },
  { slug: "termoacumuladores", name: "Termoacumuladores", parent: "climatizacao", singular: "termoacumulador" },

  { slug: "gaming", name: "Gaming", parent: null },
  { slug: "consolas", name: "Consolas", parent: "gaming", singular: "consola" },

  { slug: "fotografia", name: "Fotografia e vídeo", parent: null },
  { slug: "camaras", name: "Câmaras fotográficas", parent: "fotografia", singular: "câmara fotográfica" },
  { slug: "drones", name: "Drones", parent: "fotografia", singular: "drone" },
] as const satisfies readonly Category[];

export type CategorySlug = (typeof CATEGORIES)[number]["slug"];

export function isCategorySlug(value: string): value is CategorySlug {
  return CATEGORIES.some((category) => category.slug === value);
}

export function getCategory(slug: CategorySlug): Category {
  const category = CATEGORIES.find((candidate) => candidate.slug === slug);
  if (!category) {
    throw new Error(`Unknown category: ${slug}`);
  }
  return category;
}
