import type { LabelCode, LabelTone, WarningCode } from "./types";

/** Label names as users read them (docs/PLANO.md, "Rótulos de desconto"). */
export const LABEL_NAMES: Readonly<Record<LabelCode, string>> = {
  historico_insuficiente: "Histórico insuficiente",
  minimo_historico: "Mínimo histórico",
  desconto_real: "Desconto real",
  subiu_antes_de_descer: "Subiu antes de descer",
  desconto_pequeno: "Desconto pequeno",
  sem_desconto_real: "Sem desconto real",
  bom_preco: "Bom preço",
  acima_do_habitual: "Acima do habitual",
  preco_habitual: "Preço habitual",
};

/** Colour family of each label: green for good moments, amber for caution, neutral otherwise. */
export const LABEL_TONES: Readonly<Record<LabelCode, LabelTone>> = {
  historico_insuficiente: "neutral",
  minimo_historico: "positive",
  desconto_real: "positive",
  subiu_antes_de_descer: "caution",
  desconto_pequeno: "caution",
  sem_desconto_real: "caution",
  bom_preco: "positive",
  acima_do_habitual: "caution",
  preco_habitual: "neutral",
};

/** Warning names, for filters and the methodology page. */
export const WARNING_NAMES: Readonly<Record<WarningCode, string>> = {
  desconto_anunciado_exagerado: "Desconto anunciado exagerado",
  mais_barato_noutra_loja: "Mais barato noutra loja",
  esgotado: "Esgotado",
};

export function isLabelCode(value: string): value is LabelCode {
  return Object.hasOwn(LABEL_NAMES, value);
}
