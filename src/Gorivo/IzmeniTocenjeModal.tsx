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
  fuelType: string;
  liters: number;
  pricePerLiter?: number;
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

export const IzmeniTocenjeModal: React.FC<IzmeniTocenjeModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  entry,
  machines,
  isManager,
}) => {
  const [liters, setLiters] = useState('');
  const [fuelSource, setFuelSource] = useState<'CISTERNA' | 'PUMPA' | 'KANISTER'>('CISTERNA');
  const [fuelType, setFuelType] = useState('EURODIZEL');
  const [pricePerLiter, setPricePerLiter] = useState('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (entry) {
      setLiters(String(entry.liters || ''));
      setFuelSource(entry.fuelSource || 'CISTERNA');
      setFuelType(entry.fuelType || 'EURODIZEL');
      setPricePerLiter(entry.pricePerLiter ? String(entry.pricePerLiter) : '');
      setReceiptNumber(entry.receiptNumber || '');
      setNotes(entry.notes || '');
      setError('');
    }
  }, [entry, isOpen]);

  if (!isOpen || !entry) return null;

  const currentMachine = machines.find((m) => m.id === entry.machine?.id) || entry.machine;
  const parsedLiters = Number(liters) || 0;

  // Brzi tasteri
  const addLiters = (amount: number) => {
    const current = Number(liters) || 0;
    setLiters(String(current + amount));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!parsedLiters || parsedLiters <= 0) {
      setError('Količina goriva mora biti veća od 0 litara.');
      return;
    }

    const machineCap = currentMachine?.tankCapacityLiters || 250;
    if (parsedLiters > machineCap) {
      setError(`Količina (${parsedLiters} L) premašuje maksimalni rezervoar mašine "${currentMachine?.name || 'mašine'}" (${machineCap} L). Nije dozvoljeno točenje preko maksimalnog kapaciteta.`);
      return;
    }

    setLoading(true);

    try {
      const payload: any = {
        liters: parsedLiters,
        fuelSource,
        fuelType,
        notes: notes || null,
        receiptNumber: receiptNumber || null,
      };

      if (isManager && pricePerLiter) {
        payload.pricePerLiter = Number(pricePerLiter);
      }

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

          {/* Izvor točenja */}
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
                  <span className={styles.sourceBtnSub}>NIS / MOL / Knez</span>
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

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Vrsta energenta</label>
            <select
              className={styles.formSelect}
              value={fuelType}
              onChange={(e) => setFuelType(e.target.value)}
            >
              {FLUID_TYPES.map((ft) => (
                <option key={ft.value} value={ft.value}>
                  {ft.label}
                </option>
              ))}
            </select>
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

          {/* Račun i cena */}
          {(fuelSource === 'PUMPA' || isManager) && (
            <div className={styles.financialSection}>
              <div className={styles.sectionTitle}>
                <Receipt size={16} />
                <span>Podaci o računu</span>
              </div>
              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Broj računa</label>
                  <input
                    type="text"
                    placeholder="npr. FIS-2026/0412"
                    className={styles.formInput}
                    value={receiptNumber}
                    onChange={(e) => setReceiptNumber(e.target.value)}
                  />
                </div>
                {isManager && (
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Cena po litru (RSD)</label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      placeholder="npr. 185.00"
                      className={styles.formInput}
                      value={pricePerLiter}
                      onChange={(e) => setPricePerLiter(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

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
              disabled={loading}
            >
              Odustani
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={loading}
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
