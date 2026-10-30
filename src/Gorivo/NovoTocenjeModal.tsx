import React, { useState, useEffect } from 'react';
import {
  X,
  Fuel,
  Building2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Receipt,
  FileText,
  ArrowUpToLine,
} from 'lucide-react';
import { useSession } from '../lib/auth-client';
import CustomSelect from '../components/CustomSelect/CustomSelect';
import { SlikaRacunaUpload } from './SlikaRacunaUpload';
import styles from './GorivoDashboard.module.css';

interface Machine {
  id: string;
  name: string;
  type: string;
  brandModel?: string;
  tankCapacityLiters?: number;
  currentFuelLiters?: number;
  currentHours?: number;
}

interface Worker {
  id: string;
  name: string;
  userId?: string;
}

interface NovoTocenjeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  machines: Machine[];
  workers: Worker[];
  tankCurrentLiters: number;
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

export const NovoTocenjeModal: React.FC<NovoTocenjeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  machines,
  workers,
  tankCurrentLiters,
  isManager,
}) => {
  const { data: session } = useSession();
  const currentUserId = (session as any)?.user?.id;

  const todayStr = new Date().toISOString().split('T')[0];

  const [machineId, setMachineId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [fuelSource, setFuelSource] = useState<'CISTERNA' | 'PUMPA' | 'KANISTER'>(isManager ? 'CISTERNA' : 'PUMPA');
  const [gasStation, setGasStation] = useState<'PETROL' | 'EUROPETROL'>('PETROL');
  const [fuelType, setFuelType] = useState('EURODIZEL');
  const [liters, setLiters] = useState<string>('');
  const [totalCost, setTotalCost] = useState<string>('');
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(todayStr);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset pri otvaranju modala
  useEffect(() => {
    if (isOpen) {
      setFuelSource(isManager ? 'CISTERNA' : 'PUMPA');
      setGasStation('PETROL');
      setLiters('');
      setTotalCost('');
      setReceiptImageUrl(null);
      setUploadingReceipt(false);
      setNotes('');
      setDate(new Date().toISOString().split('T')[0]);
      setError('');
    }
  }, [isManager, isOpen]);

  // Automatski selektuj radnika ako je povezan sa prijavljenim nalogom
  useEffect(() => {
    if (isOpen && workers.length > 0) {
      const matched = workers.find((w) => w.userId === currentUserId);
      if (!isManager) {
        setWorkerId(matched?.id || '');
      } else if (matched && !workerId) {
        setWorkerId(matched.id);
      }
    }
  }, [isOpen, workers, currentUserId, isManager, workerId]);

  const selectedMachine = machines.find((m) => m.id === machineId);

  if (!isOpen) return null;

  // Brzi tasteri za dodavanje litara
  const addLiters = (amount: number) => {
    const current = Number(liters) || 0;
    setLiters(String(current + amount));
  };

  const setFullTank = () => {
    if (selectedMachine && selectedMachine.tankCapacityLiters) {
      const cap = selectedMachine.tankCapacityLiters;
      const current = selectedMachine.currentFuelLiters || 0;
      const needed = Math.max(10, Math.round(cap - current));
      setLiters(String(needed));
    }
  };

  // Live pre-check upozorenja i proračun cene po litru
  const parsedLiters = Number(liters) || 0;
  const parsedTotalCost = Number(totalCost) || 0;
  const calculatedPricePerLiter =
    parsedLiters > 0 && parsedTotalCost > 0
      ? Number((parsedTotalCost / parsedLiters).toFixed(2))
      : null;

  const hasReceipt = Boolean(receiptImageUrl && receiptImageUrl.trim().length > 0);
  const isPriceRequiredForWorker = !isManager && fuelSource === 'PUMPA' && !hasReceipt;

  const warnings: string[] = [];

  if (selectedMachine && selectedMachine.tankCapacityLiters && parsedLiters > selectedMachine.tankCapacityLiters) {
    warnings.push(
      `Uneto (${parsedLiters} L) prelazi kapacitet rezervoara mašine (${selectedMachine.tankCapacityLiters} L)!`
    );
  }

  if (fuelSource === 'CISTERNA' && tankCurrentLiters !== undefined && parsedLiters > tankCurrentLiters) {
    warnings.push(
      isManager
        ? `U cisterni firme ima samo ${tankCurrentLiters} L. Nije moguće istočiti ${parsedLiters} L!`
        : `U cisterni firme trenutno nema dovoljno goriva za unetu količinu!`
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (uploadingReceipt) {
      setError('Molimo sačekajte da se završi otpremanje slike računa.');
      return;
    }

    if (!machineId) {
      setError('Morate izabrati radnu mašinu.');
      return;
    }

    let effectiveWorkerId = workerId;
    if (!isManager) {
      effectiveWorkerId = workers.find((w) => w.userId === currentUserId)?.id || '';
      if (!effectiveWorkerId) {
        setError('Nalog nije povezan sa profilom radnika. Obratite se administratoru.');
        return;
      }
    }

    if (isManager && !effectiveWorkerId) {
      setError('Morate izabrati radnika (točioca).');
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

    if (fuelSource === 'CISTERNA' && parsedLiters > tankCurrentLiters) {
      setError(`Nema dovoljno goriva u cisterni firme (stanje: ${tankCurrentLiters} L).`);
      return;
    }

    if (selectedMachine && selectedMachine.tankCapacityLiters && parsedLiters > selectedMachine.tankCapacityLiters) {
      setError(`Količina (${parsedLiters} L) premašuje maksimalni rezervoar mašine "${selectedMachine.name}" (${selectedMachine.tankCapacityLiters} L). Nije dozvoljeno točenje preko maksimalnog kapaciteta.`);
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
      const now = new Date();
      let entryDateTime = now;
      if (date) {
        const [year, month, day] = date.split('-').map(Number);
        entryDateTime = new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
      }

      const payload: any = {
        machineId,
        workerId: effectiveWorkerId || workerId || null,
        fuelSource,
        gasStation: fuelSource === 'PUMPA' ? gasStation : null,
        fuelType,
        liters: parsedLiters,
        totalCost: parsedTotalCost > 0 ? parsedTotalCost : null,
        receiptImageUrl: receiptImageUrl || null,
        receiptNumber: null,
        notes: notes || null,
        date: entryDateTime.toISOString(),
      };

      const res = await fetch(`${API}/fuel/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Neuspešan unos točenja.');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Greška pri unosu točenja:', err);
      setError(err.message || 'Greška na serveru pri evidentiranju točenja.');
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
              <Fuel size={20} />
            </div>
            <div>
              <h3>Novo točenje goriva</h3>
              <p>Evidentiranje sipanja u radnu mašinu ili vozilo</p>
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

          {warnings.length > 0 && (
            <div className={styles.warningBanner}>
              <AlertTriangle size={18} />
              <div>
                <strong>Sistem je prepoznao potencijalnu anomaliju:</strong>
                <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Izvor točenja (3 velika dugmeta) - SAMO ZA DIREKTORA I RUKOVODIOCA */}
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
                    <span className={styles.sourceBtnSub}>Dostupno: {tankCurrentLiters} L</span>
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

          <div className={styles.formGrid}>
            {/* Mašina */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Radna mašina / Traktor <span className={styles.required}>*</span>
              </label>
              <CustomSelect
                value={machineId}
                onChange={(val) => setMachineId(val)}
                options={machines.map((m) => ({
                  value: m.id,
                  label: `${m.name}${m.brandModel ? ` (${m.brandModel})` : ''}`,
                  subLabel: `Rezervoar: ${m.tankCapacityLiters || 200}L • Trenutno: ${m.currentHours || 0} rh`,
                }))}
                placeholder="-- Izaberite mašinu --"
                searchable
              />
              {selectedMachine && (
                <div className={styles.machineQuickInfo}>
                  <span>Kapacitet: <strong>{selectedMachine.tankCapacityLiters || 200} L</strong></span>
                  <span>Trenutni sati: <strong>{selectedMachine.currentHours || 0} rh</strong></span>
                </div>
              )}
            </div>

            {/* Radnik (Točilac) - vidljivo SAMO direktoru i rukovodiocu */}
            {isManager && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Radnik / Točilac <span className={styles.required}>*</span>
                </label>
                <CustomSelect
                  value={workerId}
                  onChange={(val) => setWorkerId(val)}
                  options={workers.map((w) => ({
                    value: w.id,
                    label: w.name,
                  }))}
                  placeholder="-- Izaberite radnika --"
                  searchable
                />
              </div>
            )}

            {/* Tip goriva / fluida */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Vrsta energenta / maziva</label>
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

            {/* Datum točenja */}
            <div className={styles.formGroup}>
              <div className={styles.labelWithAction}>
                <label className={styles.formLabel}>Datum točenja</label>
                <span className={styles.unitNote} style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600 }}>
                  Današnji datum
                </span>
              </div>
              <input
                type="date"
                className={styles.formInput}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          {/* Količina u litrima sa brzim tasterima */}
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
              <span className={styles.inputUnitBadge}>LIT</span>
            </div>

            {/* Brzi tasteri */}
            <div className={styles.quickAmountButtons}>
              <button type="button" onClick={() => addLiters(20)} className={styles.quickBtn}>
                +20L
              </button>
              <button type="button" onClick={() => addLiters(50)} className={styles.quickBtn}>
                +50L
              </button>
              <button type="button" onClick={() => addLiters(100)} className={styles.quickBtn}>
                +100L
              </button>
              <button type="button" onClick={() => addLiters(200)} className={styles.quickBtn}>
                +200L
              </button>
              {selectedMachine && selectedMachine.tankCapacityLiters && (
                <button
                  type="button"
                  onClick={setFullTank}
                  className={`${styles.quickBtn} ${styles.fullTankBtn}`}
                >
                  <ArrowUpToLine size={15} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                  Pun rezervoar ({selectedMachine.tankCapacityLiters}L)
                </button>
              )}
            </div>
          </div>

          {/* Slika računa sa pumpe (za Petrol / Europetrol) */}
          {(!isManager || fuelSource === 'PUMPA') && (
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
                  : fuelSource === 'CISTERNA'
                    ? 'Automatski se uzima prosečna nabavna cena cisterne ako ostavite prazno'
                    : 'Unesite ukupan iznos sa fiskalnog računa (npr. 8.500 RSD)'}
              </span>
            </div>
          </div>

          {/* Napomena */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>
              <FileText size={14} style={{ display: 'inline', marginRight: 4 }} />
              Napomena / Opis (opciono)
            </label>
            <input
              type="text"
              placeholder="npr. Sipano pred polazak na teren..."
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
                  <span>Evidentiranje...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>Potvrdi i evidentiraj točenje</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
