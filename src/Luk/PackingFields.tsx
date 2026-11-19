import React, { useMemo } from 'react';
import { Scale, Package } from 'lucide-react';
import { CustomSelect, type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import { suggestPacking, suggestPallets } from './onionStock';
import styles from './OnionDashboard.module.css';

export const PACKAGE_WEIGHTS: Record<string, number> = {
  DZAK_5KG: 5,
  DZAK_10KG: 10,
  DZAK_25KG: 25,
  DZAMBO_VRECA: 1000,
  BOKS_PALETA: 1100,
  RINFUZ: 1,
  DRUGO: 10,
};

export function formatKgAndTons(kgValue: number | undefined | null): string {
  const kg = Number(kgValue || 0);
  if (Math.abs(kg) >= 1000) {
    const tons = (kg / 1000).toLocaleString('sr-RS', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${kg.toLocaleString('sr-RS', { maximumFractionDigits: 0 })} kg (${tons} t)`;
  }
  return `${kg.toLocaleString('sr-RS', { maximumFractionDigits: 1 })} kg`;
}

export const entryModeOptions = [
  { value: 'both', label: 'Sortiranje i pakovanje' },
  { value: 'sorting', label: 'Samo sortiranje' },
  { value: 'packaging', label: 'Pakovanje ranije sortirane I klase' },
];

const emptySorting = { inputQuantityKg: '', qualityQuantityKg: '', smallQuantityKg: '', wasteQuantityKg: '', plevaKg: '' };
export const sortingFields = [
  ['inputQuantityKg', 'Ulazna masa'], ['qualityQuantityKg', 'I klasa'],
  ['smallQuantityKg', 'II klasa'], ['wasteQuantityKg', 'Otpad'],
  ['plevaKg', 'Pleva'],
] as const;

function preventWheelNumberChange(e: React.WheelEvent<HTMLInputElement>) {
  e.currentTarget.blur();
}


export type EntryMode = 'both' | 'sorting' | 'packaging';
export const newPackingPlan = (date: string, mode: EntryMode = 'both') => ({
  entryMode: mode,
  sortingForm: { ...emptySorting },
  packagingForm: {
    date,
    lotId: '',
    sourceKey: '',
    sourceName: '',
    packageType: 'DZAK_10KG',
    unitWeightKg: '10',
    palletsCount: '',
    packageCount: '',
    palletNumber: '',
    packerCount: '',
    packerNotes: '',
    responsiblePerson: 'Bojan Ćorović',
    notes: '',
  },
});
export type PackingPlan = ReturnType<typeof newPackingPlan> & {
  cancelledAfterReversal?: boolean;
  execution?: { entryId: string; lotId: string; lotNumber: string; plannedLotNumber: string; entryMode: EntryMode; actorName: string; sourceName?: string };
};

export function PackingExecution({ plan }: { plan?: PackingPlan }) {
  const execution = plan?.execution;
  if (!execution || !plan) return null;
  const label = (mode: EntryMode) => entryModeOptions.find(option => option.value === mode)?.label;
  return <div>
    <div>Planirano: {execution.plannedLotNumber} · {plan.packagingForm.sourceName && `${plan.packagingForm.sourceName} · `}{label(plan.entryMode)}</div>
    <div><strong>Izvršeno: {execution.lotNumber} · {execution.sourceName && `${execution.sourceName} · `}{label(execution.entryMode)}</strong></div>
    <div>Potvrdio/la: {execution.actorName}</div>
  </div>;
}

export const packageTypeOptions: CustomSelectOption[] = [
  {
    value: 'DZAK_10KG',
    label: 'Mrežasti džak 10 kg',
    badgeType: 'success' as const,
  },
  {
    value: 'DZAK_5KG',
    label: 'Mrežasti džak 5 kg',
    badgeType: 'warning' as const,
  },
  {
    value: 'DZAK_25KG',
    label: 'Mrežasti džak 25 kg',
  },
  {
    value: 'DZAMBO_VRECA',
    label: 'Džambo vreća',
    subLabel: '1.000 kg po vreći',
  },
  {
    value: 'BOKS_PALETA',
    label: 'Boks paleta 160x120x120',
    subLabel: '1.100 kg po boksu',
  },
  {
    value: 'RINFUZ',
    label: 'Rinfuz',
    subLabel: 'Masa u rasutom stanju',
  },
];

export function packingBalance({ entryMode, sortingForm, packagingForm }: PackingPlan, qualityKg: number) {
  const sortingDifference = Number(sortingForm.inputQuantityKg) - Number(sortingForm.qualityQuantityKg)
    - Number(sortingForm.smallQuantityKg) - Number(sortingForm.wasteQuantityKg) - Number(sortingForm.plevaKg);
  const remainingQuality = (qualityKg || 0)
    + (entryMode === 'packaging' ? 0 : Number(sortingForm.qualityQuantityKg))
    - (entryMode === 'sorting' ? 0 : Number(packagingForm.packageCount) * Number(packagingForm.unitWeightKg));

  return { remainingQuality, sortingDifference };
}

export function PackingFields({ plan, onChange, allSelectableLots }: {
  plan: PackingPlan;
  onChange: React.Dispatch<React.SetStateAction<PackingPlan>>;
  allSelectableLots: any[];
}) {
  const { entryMode, sortingForm, packagingForm } = plan;
  const setEntryMode = (entryMode: EntryMode) => onChange(prev => ({ ...prev, entryMode }));
  const setSortingForm = (sortingForm: PackingPlan['sortingForm']) => onChange(prev => ({ ...prev, sortingForm }));
  const setPackagingForm: React.Dispatch<React.SetStateAction<PackingPlan['packagingForm']>> = update =>
    onChange(prev => ({ ...prev, packagingForm: typeof update === 'function' ? update(prev.packagingForm) : update }));
  const freeQualityForLot = (id: string) => allSelectableLots.find(lot => lot.id === id)?.unpackedQualityKg || 0;
  const selectedPackagingLotObj = allSelectableLots.find(lot => lot.id === packagingForm.lotId);
  const { sortingDifference, remainingQuality } = packingBalance(plan, freeQualityForLot(packagingForm.lotId));
  const sourceKey = packagingForm.sourceKey || '';
  const { sourcesByLot, eligibleLots } = useMemo(() => {
    const sourcesByLot = new Map<string, Map<string, { label: string; kg: number }>>();
    const eligibleLots = allSelectableLots.filter(lot => entryMode === 'packaging' ? lot.unpackedQualityKg > 0 : lot.rawStockKg > 0);
    for (const lot of eligibleLots) {
      const sources = new Map<string, { label: string; kg: number }>();
      for (const row of lot.storageEntries || []) {
        if (row.currentQuantityKg <= 0) continue;
        const key = row.chamberId ? 'id:' + row.chamberId : 'name:' + row.locationOrChamber.trim().toLowerCase();
        sources.set(key, { label: row.locationOrChamber, kg: (sources.get(key)?.kg || 0) + row.currentQuantityKg });
      }
      if (lot.unstoredRawKg > 0) sources.set('unstored', { label: 'Neraspoređeno', kg: lot.unstoredRawKg });
      sourcesByLot.set(lot.id, sources);
    }
    return { sourcesByLot, eligibleLots };
  }, [allSelectableLots, entryMode]);
  const displayedSources = new Map<string, { label: string; kg: number }>();
  for (const [lotId, sources] of sourcesByLot) {
    if (packagingForm.lotId && lotId !== packagingForm.lotId) continue;
    for (const [key, source] of sources) {
      displayedSources.set(key, { ...source, kg: (displayedSources.get(key)?.kg || 0) + source.kg });
    }
  }
  const sourceOptions = [
    { value: '', label: entryMode === 'packaging' ? 'Sve komore' : '— Izaberi izvor sirovine —' },
    ...Array.from(displayedSources, ([value, source]) => ({ value, label: source.label, subLabel: `Sirovina: ${formatKgAndTons(source.kg)}` })),
  ];
  if (sourceKey && !displayedSources.has(sourceKey)) sourceOptions.push({
    value: sourceKey, label: packagingForm.sourceName || 'Izabrana komora', subLabel: 'Nema raspoložive sirovine',
  });
  const lotOptions = [
    { value: '', label: '— Izaberi LOT —' },
    ...eligibleLots.filter(lot => !sourceKey || sourcesByLot.get(lot.id)?.has(sourceKey)).map(lot => ({
      value: lot.id, label: lot.lotNumber, subLabel: [
        lot.parcel?.name, sourceKey && `Na lokaciji: ${formatKgAndTons(sourcesByLot.get(lot.id)?.get(sourceKey)?.kg)}`,
        entryMode === 'packaging' ? `I klasa LOT-a: ${formatKgAndTons(lot.unpackedQualityKg)}` :
          !sourceKey && `Sirovina: ${formatKgAndTons(lot.rawStockKg)}`,
      ].filter(Boolean).join(' · '),
    })),
  ];

  return <>
    <div className={styles.formGroup}>
      <label id="onion-entry-mode-label">Vrsta unosa</label>
      <CustomSelect
        labelledBy="onion-entry-mode-label"
        value={entryMode}
        options={entryModeOptions}
        searchable={false}
        onChange={value => {
          setEntryMode(value as typeof entryMode);
          setPackagingForm(prev => ({
            ...prev, lotId: '', sourceKey: '', sourceName: '',
            ...suggestPacking(value === 'both' ? Number(sortingForm.qualityQuantityKg) : 0,
              Number(prev.unitWeightKg), prev.packageType),
          }));
        }}
      />
    </div>
    <div className={styles.formGrid2}>
      <div className={styles.formGroup}>
        <label id="onion-entry-source-label">{entryMode === 'packaging' ? 'Komora (filter po sirovini)' : 'Komora / izvor sirovine *'}</label>
        <CustomSelect labelledBy="onion-entry-source-label" value={sourceKey} options={sourceOptions}
          onChange={key => setPackagingForm(prev => ({ ...prev, sourceKey: key, sourceName: displayedSources.get(key)?.label || '' }))} />
      </div>
      <div className={styles.formGroup}>
        <label id="onion-entry-lot-label">LOT *</label>
        <CustomSelect
          labelledBy="onion-entry-lot-label"
          value={packagingForm.lotId}
          onChange={lotId => setPackagingForm(prev => {
            const sources = sourcesByLot.get(lotId);
            const key = sourceKey || (entryMode !== 'packaging' && sources?.size === 1 ? [...sources.keys()][0] : '');
            return {
              ...prev, lotId, sourceKey: key, sourceName: key ? sources?.get(key)?.label || prev.sourceName : '',
              ...(entryMode === 'packaging' && suggestPacking(freeQualityForLot(lotId), Number(prev.unitWeightKg), prev.packageType)),
            };
          })}
          options={lotOptions}
          placeholder="Izaberi LOT"
          hideTriggerSubLabel
        />
      </div>
      <div className={styles.formGroup}>
        <label htmlFor="onion-entry-date">Datum *</label>
        <input id="onion-entry-date" type="date" required className={styles.input}
          value={packagingForm.date}
          onChange={e => setPackagingForm({ ...packagingForm, date: e.target.value })} />
      </div>
    </div>

    {selectedPackagingLotObj && (
      <div className={styles.entryBalance}>
        <strong>{selectedPackagingLotObj.parcel?.code} — {selectedPackagingLotObj.parcel?.name} ({selectedPackagingLotObj.cropVariety || 'Žuti luk'})</strong>
        <span>Sirovina na LOT-u: <strong>{formatKgAndTons(selectedPackagingLotObj.rawStockKg)}</strong></span>
        {sourceKey && <span>Sirovina na izabranoj lokaciji: <strong>{formatKgAndTons(displayedSources.get(sourceKey)?.kg)}</strong></span>}
        <span>Slobodna I klasa LOT-a: <strong>{formatKgAndTons(selectedPackagingLotObj.unpackedQualityKg)}</strong></span>
      </div>
    )}

    {entryMode !== 'packaging' && (
      <section className={styles.entrySection}>
        <h3 className={styles.sectionTitle}><Scale size={18} color="#0284c7" />Sortiranje</h3>
        <div className={styles.sortingInputs}>
          {sortingFields.map(([key, label]) => {
            const required = key === 'inputQuantityKg' || key === 'qualityQuantityKg';
            return (
              <div key={key} className={styles.formGroup}>
                <label htmlFor={`onion-${key}`}>{label} (kg){required && ' *'}</label>
                <input id={`onion-${key}`} type="number" className={styles.input} step="any"
                  min={key === 'inputQuantityKg' ? 0.01 : 0} required={required}
                  value={sortingForm[key]} placeholder="0"
                  onWheel={preventWheelNumberChange}
                  onChange={e => {
                    const value = e.target.value;
                    setSortingForm({ ...sortingForm, [key]: value });
                    if (entryMode === 'both' && key === 'qualityQuantityKg') {
                      setPackagingForm(prev => ({
                        ...prev, ...suggestPacking(Number(value), Number(prev.unitWeightKg), prev.packageType),
                      }));
                    }
                  }} />
              </div>
            );
          })}
        </div>
        <div className={styles.entryBalance}>
          <span>Razlika između ulaza i izlaza</span>
          <strong>{sortingDifference.toLocaleString('sr-RS')} kg</strong>
        </div>
      </section>
    )}
    {entryMode !== 'sorting' && (
      <section className={styles.entrySection}>
        <h3 className={styles.sectionTitle}><Package size={18} color="#d97706" />Pakovanje</h3>
        <div className={styles.formGrid2}>
          <div className={styles.formGroup}>
            <label>Tip džaka / pakovanja *</label>
            <CustomSelect
              value={packagingForm.packageType}
              onChange={(t) => {
                const unitW = PACKAGE_WEIGHTS[t] || 10;
                setPackagingForm({
                  ...packagingForm,
                  packageType: t,
                  unitWeightKg: String(unitW),
                  ...suggestPacking(entryMode === 'packaging' ? freeQualityForLot(packagingForm.lotId)
                    : Number(sortingForm.qualityQuantityKg), unitW, t),
                });
              }}
              options={packageTypeOptions}
              searchable={false}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Broj paleta</label>
            <input
              type="number"
              step="1"
              min="1"
              className={styles.input}
              placeholder="npr. 2"
              value={packagingForm.palletsCount}
              onWheel={preventWheelNumberChange}
              onChange={e => setPackagingForm({ ...packagingForm, palletsCount: e.target.value })}
            />
          </div>
        </div>

        <div className={styles.formGrid2}>
          <div className={styles.formGroup}>
            <label>Ukupan broj džakova (kom) *</label>
            <input
              type="number"
              step="1"
              min="1"
              className={styles.input}
              placeholder="npr. 500"
              value={packagingForm.packageCount}
              onWheel={preventWheelNumberChange}
              onChange={e => setPackagingForm({
                ...packagingForm, packageCount: e.target.value,
                palletsCount: suggestPallets(Number(e.target.value), Number(packagingForm.unitWeightKg), packagingForm.packageType),
              })}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label>Oznaka palete / lokacije</label>
            <input
              type="text"
              className={styles.input}
              placeholder="npr. PALETA-01..05"
              value={packagingForm.palletNumber}
              onChange={(e) =>
                setPackagingForm({ ...packagingForm, palletNumber: e.target.value })
              }
            />
          </div>
        </div>

        {/* Pakerica (broj pakera - izmenljivo) i Bojan Ćorović */}
        <div className={styles.formGrid2}>
          <div className={styles.formGroup}>
            <label>Broj pakera (opciono)</label>
            <input
              type="number"
              step="1"
              min="1"
              max="30"
              className={styles.input}
              value={packagingForm.packerCount}
              onWheel={preventWheelNumberChange}
              onChange={(e) =>
                setPackagingForm({ ...packagingForm, packerCount: e.target.value })
              }
            />
          </div>

          <div className={styles.formGroup}>
            <label>Zadužen za ulaz, izlaz i pakovanje *</label>
            <input
              type="text"
              className={styles.input}
              value={packagingForm.responsiblePerson}
              onChange={(e) =>
                setPackagingForm({ ...packagingForm, responsiblePerson: e.target.value })
              }
              required
            />
          </div>
        </div>

        <div className={styles.formGroup}>
          <label>Napomena za pakericu (opciono)</label>
          <input
            type="text"
            className={styles.input}
            placeholder="npr. Druga smena, priprema za Maxi..."
            value={packagingForm.packerNotes}
            onChange={(e) =>
              setPackagingForm({ ...packagingForm, packerNotes: e.target.value })
            }
          />
        </div>

        {Number(packagingForm.packageCount) > 0 && (
          <div className={styles.entryBalance}>
            <span>Bilans pakovanja</span>
            <strong>{packagingForm.packageCount} × {packagingForm.unitWeightKg} kg = {formatKgAndTons(
              Number(packagingForm.packageCount) * Number(packagingForm.unitWeightKg)
            )}</strong>
          </div>
        )}
      </section>
    )}
    <div className={styles.entryBalance}>
      <span>Preostala slobodna I klasa</span>
      <strong>{remainingQuality.toLocaleString('sr-RS')} kg</strong>
    </div>
  </>;
}
