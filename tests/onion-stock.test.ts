import assert from 'node:assert/strict';
import { test } from 'node:test';
import { remainingLotStock } from '../src/Luk/onionStock.ts';

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
