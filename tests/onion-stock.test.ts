import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remainingLotStock, suggestPacking, suggestPallets } from '../src/Luk/onionStock.ts';

test('two delivered turas leave only raw, unpacked and small onion in the remaining LOT total', () => {
  const result = remainingLotStock({
    rawStockKg: 2000, sortedQualityKg: 19000, sortedSmallKg: 700,
    packagings: [
      { totalWeightKg: 5000, availableWeightKg: 0 },
      { totalWeightKg: 10000, availableWeightKg: 0 },
    ],
  });
  assert.deepEqual(result, { rawKg: 2000, unpackedQualityKg: 4000, smallKg: 700, packagedKg: 0, totalKg: 6700 });
});

test('partially delivered packaging is counted once and already shipped mass stays consumed', () => {
  const result = remainingLotStock({
    rawStockKg: 1000, sortedQualityKg: 4000, sortedSmallKg: 0,
    packagings: [{ totalWeightKg: 4000, availableWeightKg: 1000 }],
  });
  assert.equal(result.unpackedQualityKg, 0);
  assert.equal(result.packagedKg, 1000);
  assert.equal(result.totalKg, 2000);
});

test('an unprocessed LOT and a fully delivered LOT show their actual remaining mass', () => {
  assert.equal(remainingLotStock({ rawStockKg: 5000, sortedQualityKg: 0, sortedSmallKg: 0, packagings: [] }).totalKg, 5000);
  assert.equal(remainingLotStock({ rawStockKg: 0, sortedQualityKg: 5000, sortedSmallKg: 0,
    packagings: [{ totalWeightKg: 5000, availableWeightKg: 0 }] }).totalKg, 0);
});

test('packing suggests whole bags and rounds only a partial pallet up', () => {
  assert.deepEqual(suggestPacking(3000, 10, 'DZAK_10KG'), { packageCount: '300', palletsCount: '3' });
  assert.deepEqual(suggestPacking(3100, 10, 'DZAK_10KG'), { packageCount: '310', palletsCount: '4' });
  assert.deepEqual(suggestPacking(1604, 5, 'DZAK_5KG'), { packageCount: '320', palletsCount: '2' });
  assert.deepEqual(suggestPacking(1009, 10, 'DZAK_10KG'), { packageCount: '100', palletsCount: '1' });
  assert.deepEqual(suggestPacking(4, 5, 'DZAK_5KG'), { packageCount: '', palletsCount: '' });
  assert.equal(suggestPallets(160, 10, 'DZAK_10KG'), '2');
});
