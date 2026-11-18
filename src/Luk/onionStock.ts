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

export function suggestPallets(packageCount: number, unitWeightKg: number, packageType: string) {
  if (!Number.isSafeInteger(packageCount) || packageCount <= 0) return '';
  if (packageType === 'BOKS_PALETA') return String(packageCount);
  if (!packageType.startsWith('DZAK_') && packageType !== 'DZAMBO_VRECA') return '';
  return String(Math.ceil(packageCount * unitWeightKg / 1000));
}

export function suggestPacking(qualityKg: number, unitWeightKg: number, packageType: string) {
  const count = Math.floor(qualityKg / unitWeightKg);
  return {
    packageCount: Number.isSafeInteger(count) && count > 0 ? String(count) : '',
    palletsCount: suggestPallets(count, unitWeightKg, packageType),
  };
}
