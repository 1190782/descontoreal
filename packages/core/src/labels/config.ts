/** Thresholds for the discount labels (docs/PLANO.md, "Rótulos de desconto"). Tune them with real data. */
export interface LabelsConfig {
  /** Below this many calendar days of history (LabelNumbers.historyDays): "Histórico insuficiente". */
  minHistoryDays: number;
  /** "Mínimo histórico" needs at least this many calendar days of history. */
  allTimeLowMinHistoryDays: number;
  /** "Desconto real": P ≤ M30 × f and P ≤ Med90 × f. */
  realDiscountFactor: number;
  /** "Subiu antes de descer": Med90 × f ≤ P ≤ Med90 × aboveUsualFactor, P < Máx90, P below the price before S … */
  raisedNearUsualFactor: number;
  /** … and Máx90 ≥ Med90 × f. */
  raisedPeakFactor: number;
  /** "Bom preço": P ≤ Med90 × f. */
  goodPriceFactor: number;
  /** "Acima do habitual": P ≥ Med90 × f. Also the upper bound of P in "Subiu antes de descer". */
  aboveUsualFactor: number;
  /** "Desconto anunciado exagerado": announced % exceeds the real % by more than this many points. */
  exaggeratedDiscountPoints: number;
  /** "Mais barato noutra loja": another store's price ≤ P × f. */
  cheaperElsewhereFactor: number;
}

export const LABELS_CONFIG: LabelsConfig = {
  minHistoryDays: 30,
  allTimeLowMinHistoryDays: 90,
  realDiscountFactor: 0.95,
  raisedNearUsualFactor: 0.97,
  raisedPeakFactor: 1.1,
  goodPriceFactor: 0.95,
  aboveUsualFactor: 1.05,
  exaggeratedDiscountPoints: 5,
  cheaperElsewhereFactor: 0.97,
};
