type LotStock = {
  rawStockKg: number;
  sortedQualityKg: number;
  sortedSmallKg: number;
  packagings: { totalWeightKg: number; availableWeightKg: number }[];
};

export function remainingLotStock(lot: LotStock) {
  const packedEverKg = lot.packagings.reduce((sum, item) => sum + item.totalWeightKg, 0);
  const rawKg = Math.max(0, lot.rawStockKg);
  const unpackedQualityKg = Math.max(0, lot.sortedQualityKg - packedEverKg);
  const smallKg = Math.max(0, lot.sortedSmallKg);
  const packagedKg = lot.packagings.reduce((sum, item) => sum + Math.max(0, item.availableWeightKg), 0);
  return { rawKg, unpackedQualityKg, smallKg, packagedKg,
    totalKg: rawKg + unpackedQualityKg + smallKg + packagedKg };
}
