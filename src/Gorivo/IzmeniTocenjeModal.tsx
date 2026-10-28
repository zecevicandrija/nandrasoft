import React, { useState, useEffect } from 'react';
import {
  X,
  Pencil,
  Building2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FileText,
  Fuel,
  Receipt,
} from 'lucide-react';
import { SlikaRacunaUpload } from './SlikaRacunaUpload';
import CustomSelect from '../components/CustomSelect/CustomSelect';
import styles from './GorivoDashboard.module.css';

interface Machine {
  id: string;
  name: string;
  tankCapacityLiters?: number;
  currentHours?: number;
}

interface FuelEntry {
  id: string;
  date: string;
  fuelSource: 'CISTERNA' | 'PUMPA' | 'KANISTER';
  gasStation?: 'PETROL' | 'EUROPETROL' | string;
  fuelType: string;
  liters: number;
  pricePerLiter?: number | null;
  totalCost?: number | null;
  receiptImageUrl?: string | null;
  receiptNumber?: string;
  notes?: string;
  machine: {
    id: string;
    name: string;
    tankCapacityLiters?: number;
    currentHours?: number;
  };
}

interface IzmeniTocenjeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  entry: FuelEntry | null;
  machines: Machine[];
  isManager: boolean;
}

const API = 'http://localhost:5000/api';

const FLUID_TYPES = [
  { value: 'EURODIZEL', label: 'Eurodizel (Osnovno pogonsko)', unit: 'L' },
  { value: 'EURODIZEL ADITIVNI', label: 'Eurodizel Aditivni (Zimski)', unit: 'L' },
  { value: 'HIDROL-46', label: 'Hidrol-46 (Hidraulično ulje)', unit: 'L' },
  { value: 'MOTORNO ULJE 10W-40', label: 'Motorno ulje 10W-40', unit: 'L' },
  { value: 'MOTORNO ULJE 15W-40', label: 'Motorno ulje 15W-40', unit: 'L' },
  { value: 'ULJE TOTAL DYNATRANS MPV-TRAKTORI', label: 'Total Dynatrans MPV (Transmisija)', unit: 'L' },
];

export const IzmeniTocenjeModal = ({
  isOpen,
  onClose,
  onSuccess,
  entry,
  machines,
  isManager,
}: IzmeniTocenjeModalProps) => {
  const [liters, setLiters] = useState('');
  const [fuelSource, setFuelSource] = useState<'CISTERNA' | 'PUMPA' | 'KANISTER'>('CISTERNA');
  const [gasStation, setGasStation] = useState<'PETROL' | 'EUROPETROL'>('PETROL');
  const [fuelType, setFuelType] = useState('EURODIZEL');
  const [totalCost, setTotalCost] = useState('');
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (entry) {
      setLiters(String(entry.liters || ''));
      setFuelSource(entry.fuelSource || (isManager ? 'CISTERNA' : 'PUMPA'));
      const stationUpper = entry.gasStation ? entry.gasStation.toUpperCase() : '';
      if (stationUpper === 'PETROL' || stationUpper === 'EUROPETROL') {
        setGasStation(stationUpper);
      } else {
        setGasStation('PETROL');
      }
      setFuelType(entry.fuelType || 'EURODIZEL');
      setTotalCost(entry.totalCost ? String(entry.totalCost) : '');
      setReceiptImageUrl(entry.receiptImageUrl || null);
      setUploadingReceipt(false);
      setNotes(entry.notes || '');
      setError('');
    }
  }, [entry, isOpen, isManager]);

  if (!isOpen || !entry) return null;

  const currentMachine = machines.find((m) => m.id === entry.machine?.id) || entry.machine;
  const parsedLiters = Number(liters) || 0;
  const parsedTotalCost = Number(totalCost) || 0;
  const calculatedPricePerLiter =
    parsedLiters > 0 && parsedTotalCost > 0
      ? Number((parsedTotalCost / parsedLiters).toFixed(2))
      : null;

  const hasReceipt = Boolean(receiptImageUrl && receiptImageUrl.trim().length > 0);
  const isPriceRequiredForWorker = !isManager && fuelSource === 'PUMPA' && !hasReceipt;

  // Brzi tasteri
  const addLiters = (amount: number) => {
    const current = Number(liters) || 0;
    setLiters(String(current + amount));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (uploadingReceipt) {
      setError('Molimo sačekajte da se završi otpremanje slike računa.');
      return;
    }

    if (!isManager && fuelSource !== 'PUMPA') {
      setError('Točenje iz cisterne firme i kanistera dozvoljeno je samo direktoru i rukovodiocu. Radnici mogu sipati isključivo na javnoj Petrol ili Europetrol pumpi.');
      return;
    }

    if (fuelSource === 'PUMPA' && !gasStation) {
      setError('Morate izabrati ovlašćenu benzinsku pumpu (Petrol ili Europetrol).');
      return;
    }

    if (!parsedLiters || parsedLiters <= 0) {
      setError('Količina goriva mora biti veća od 0 litara.');
      return;
    }

    const machineCap = currentMachine?.tankCapacityLiters || 250;
    if (parsedLiters > machineCap) {
      setError(`Količina (${parsedLiters} L) premašuje maksimalni rezervoar mašine "${currentMachine?.name || 'mašine'}" (${machineCap} L). Nije dozvoljeno točenje preko maksimalnog kapaciteta.`);
      return;
    }

    // Pravilo za radnike na Petrol / Europetrol pumpi:
    // Ako je slikao račun -> ne mora da unosi cenu.
    // Ako NIJE slikao račun -> mora da unese cenu!
    if (!isManager && fuelSource === 'PUMPA' && !hasReceipt && parsedTotalCost <= 0) {
      setError('Pošto niste slikali račun sa pumpe (Petrol / Europetrol), obavezno je da unesete ukupan iznos (cenu) računa.');
      return;
    }

    setLoading(true);

    try {
      const payload: any = {
        liters: parsedLiters,
        fuelSource,
        gasStation: fuelSource === 'PUMPA' ? gasStation : null,
        fuelType,
        totalCost: parsedTotalCost > 0 ? parsedTotalCost : null,
        receiptImageUrl: receiptImageUrl || null,
        notes: notes || null,
        receiptNumber: null,
      };

      const res = await fetch(`${API}/fuel/entries/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Neuspešna izmena točenja.');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Greška pri izmeni točenja:', err);
      setError(err.message || 'Greška na serveru pri izmeni točenja.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <div className={styles.modalTitleIcon}>
              <Pencil size={20} />
            </div>
            <div>
              <h3>Izmena točenja goriva</h3>
              <p>Mašina: <strong>{currentMachine?.name || entry.machine?.name}</strong> • Datum: {new Date(entry.date).toLocaleDateString('sr-RS')}</p>
            </div>
          </div>
          <button className={styles.modalCloseBtn} onClick={onClose} title="Zatvori">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          {error && (
            <div className={styles.errorBanner}>
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          )}

          {/* Izvor točenja - SAMO ZA DIREKTORA I RUKOVODIOCA */}
          {isManager && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Izvor točenja goriva</label>
              <div className={styles.sourceSelector}>
                <button
                  type="button"
                  className={`${styles.sourceBtn} ${fuelSource === 'CISTERNA' ? styles.sourceBtnActive : ''}`}
                  onClick={() => setFuelSource('CISTERNA')}
                >
                  <Building2 size={18} />
                  <div className={styles.sourceBtnText}>
                    <span className={styles.sourceBtnTitle}>Cisterna firme</span>
                    <span className={styles.sourceBtnSub}>Dvorišni tank</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`${styles.sourceBtn} ${fuelSource === 'PUMPA' ? styles.sourceBtnActive : ''}`}
                  onClick={() => setFuelSource('PUMPA')}
                >
                  <Fuel size={18} />
                  <div className={styles.sourceBtnText}>
                    <span className={styles.sourceBtnTitle}>Javna pumpa</span>
                    <span className={styles.sourceBtnSub}>Petrol / Europetrol</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`${styles.sourceBtn} ${fuelSource === 'KANISTER' ? styles.sourceBtnActive : ''}`}
                  onClick={() => setFuelSource('KANISTER')}
                >
                  <MapPin size={18} />
                  <div className={styles.sourceBtnText}>
                    <span className={styles.sourceBtnTitle}>Kanister na njivi</span>
                    <span className={styles.sourceBtnSub}>Terensko sipanje</span>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Izbor javne pumpe (Petrol ili Europetrol) - za radnike uvek, za upravu kada izabere PUMPA */}
          {(!isManager || fuelSource === 'PUMPA') && (
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Ovlašćena benzinska pumpa <span className={styles.required}>*</span>
              </label>
              <div className={styles.pumpStationSelector}>
                <button
                  type="button"
                  className={`${styles.pumpStationBtn} ${gasStation === 'PETROL' ? styles.pumpStationBtnActive : ''}`}
                  onClick={() => setGasStation('PETROL')}
                >
                  <Fuel size={22} className={styles.pumpIconPetrol} />
                  <div className={styles.pumpStationInfo}>
                    <span className={styles.pumpStationName}>PETROL</span>
                    <span className={styles.pumpStationDesc}>Petrol benzinska pumpa</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`${styles.pumpStationBtn} ${gasStation === 'EUROPETROL' ? styles.pumpStationBtnActive : ''}`}
                  onClick={() => setGasStation('EUROPETROL')}
                >
                  <Fuel size={22} className={styles.pumpIconEuropetrol} />
                  <div className={styles.pumpStationInfo}>
                    <span className={styles.pumpStationName}>EUROPETROL</span>
                    <span className={styles.pumpStationDesc}>Euro Petrol benzinska pumpa</span>
                  </div>
                </button>
              </div>
            </div>
          )}

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Vrsta energenta</label>
            <CustomSelect
              value={fuelType}
              onChange={(val) => setFuelType(val)}
              options={FLUID_TYPES.map((ft) => ({
                value: ft.value,
                label: ft.label,
              }))}
              placeholder="Izaberite energent"
              searchable={false}
            />
          </div>

          {/* Količina u litrima */}
          <div className={styles.formGroup}>
            <div className={styles.labelWithAction}>
              <label className={styles.formLabel}>
                Količina u litrima <span className={styles.required}>*</span>
              </label>
              <span className={styles.unitNote}>Strogo u litrima (L)</span>
            </div>

            <div className={styles.amountInputRow}>
              <input
                type="number"
                step="any"
                min="0.1"
                placeholder="npr. 120"
                className={`${styles.formInput} ${styles.largeInput}`}
                value={liters}
                onChange={(e) => setLiters(e.target.value)}
                required
              />
              <span className={styles.inputUnitBadge}>L</span>
            </div>

            <div className={styles.quickAmountButtons}>
              <button type="button" onClick={() => addLiters(10)} className={styles.quickBtn}>
                +10L
              </button>
              <button type="button" onClick={() => addLiters(20)} className={styles.quickBtn}>
                +20L
              </button>
              <button type="button" onClick={() => addLiters(50)} className={styles.quickBtn}>
                +50L
              </button>
              <button type="button" onClick={() => addLiters(100)} className={styles.quickBtn}>
                +100L
              </button>
            </div>
          </div>

          {/* Slika računa sa pumpe (za Petrol / Europetrol) */}
          {(!isManager || fuelSource === 'PUMPA' || receiptImageUrl) && (
            <SlikaRacunaUpload
              receiptImageUrl={receiptImageUrl}
              onChange={setReceiptImageUrl}
              onUploadStateChange={setUploadingReceipt}
              isWorkerOnPump={!isManager && fuelSource === 'PUMPA'}
              hasPriceEntered={parsedTotalCost > 0}
            />
          )}

          {/* Iznos računa / Cena (RSD) */}
          <div className={styles.financialSection}>
            <div className={styles.sectionTitle}>
              <Receipt size={16} />
              <span>
                {!isManager
                  ? hasReceipt
                    ? 'Iznos računa / Cena (nije obavezno jer ste slikali račun)'
                    : 'Iznos računa / Cena sa pumpe (obavezno ako niste slikali račun)'
                  : 'Iznos računa / Cena goriva (RSD)'}
              </span>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Ukupan iznos računa / Cena (RSD){' '}
                {isPriceRequiredForWorker && <span className={styles.required}>*</span>}
              </label>
              <div className={styles.amountInputRow}>
                <input
                  type="number"
                  step="any"
                  min="1"
                  placeholder={
                    hasReceipt && !isManager
                      ? 'Opciono — cenu će uneti rukovodilac/direktor sa slike računa'
                      : 'Unesite ukupan iznos sa računa (npr. 10250)'
                  }
                  className={styles.formInput}
                  value={totalCost}
                  onChange={(e) => setTotalCost(e.target.value)}
                  required={isPriceRequiredForWorker}
                />
                <span className={styles.inputUnitBadge}>RSD</span>
              </div>

              {calculatedPricePerLiter !== null && (
                <div className={styles.realtimePriceCalc}>
                  Prosečno: <strong>{calculatedPricePerLiter.toFixed(2)} RSD/L</strong> (
                  {parsedTotalCost.toLocaleString()} RSD / {parsedLiters} L)
                </div>
              )}

              <span className={styles.fieldHint}>
                {!isManager
                  ? hasReceipt
                    ? 'Slikali ste račun — ne morate unositi cenu (rukovodilac/direktor će uneti cenu sa slike računa).'
                    : 'Ako ne slikate račun sa pumpe (Petrol / Europetrol), morate uneti ukupan iznos računa u RSD.'
                  : 'Unesite ukupan iznos sa fiskalnog računa (npr. 8.500 RSD)'}
              </span>
            </div>
          </div>

          {/* Napomena */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              <FileText size={14} style={{ display: 'inline', marginRight: 4 }} />
              Napomena
            </label>
            <input
              type="text"
              placeholder="Razlog izmene ili opis..."
              className={styles.formInput}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={loading || uploadingReceipt}
            >
              Odustani
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={loading || uploadingReceipt}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className={styles.spinner} />
                  <span>Čuvanje izmena...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>Sačuvaj izmene</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
