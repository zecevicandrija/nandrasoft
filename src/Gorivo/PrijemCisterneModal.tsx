import SubmissionRecovery from '../components/SubmissionRecovery';
import { useDurableSubmission } from '../lib/useDurableSubmission';
import React, { useRef, useState } from 'react';
import {
  X,
  Truck,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import CustomSelect from '../components/CustomSelect/CustomSelect';
import styles from './GorivoDashboard.module.css';

interface Partner {
  id: string;
  name: string;
  type: string;
}

interface PrijemCisterneModalProps {
  userId?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  partners: Partner[];
  currentTankLiters: number;
  tankCapacity: number;
}

const API = '/api';

export const PrijemCisterneModal: React.FC<PrijemCisterneModalProps> = ({
  userId,
  isOpen,
  onClose,
  onSuccess,
  partners,
  currentTankLiters,
  tankCapacity,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const [supplierId, setSupplierId] = useState('');
  const [customSupplierName, setCustomSupplierName] = useState('');
  const [fuelType, setFuelType] = useState('EURODIZEL');
  const [liters, setLiters] = useState<string>('5000');
  const [pricePerLiter, setPricePerLiter] = useState<string>('185.00');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(todayStr);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const supplyDraft = useDurableSubmission('fuel-supply', userId, {}, () => {});
  const supplyDraftSending = useRef(false);

  if (!isOpen) return null;

  const parsedLiters = Number(liters) || 0;
  const parsedPrice = Number(pricePerLiter) || 0;
  const calculatedTotalCost = Math.round(parsedLiters * parsedPrice);

  const freeSpaceInTank = Math.max(0, tankCapacity - currentTankLiters);
  const willExceedTank = parsedLiters > freeSpaceInTank;

  const handleSubmit = async (e?: React.FormEvent, replay = false) => {
    e?.preventDefault();
    if (supplyDraftSending.current || replay !== Boolean(supplyDraft.pending)) return;
    setError('');

    if (!replay && (!parsedLiters || parsedLiters <= 0)) {
      setError('Količina goriva mora biti veća od 0 litara.');
      return;
    }
    if (!replay && (!parsedPrice || parsedPrice <= 0)) {
      setError('Cena po litru mora biti veća od 0 dinara.');
      return;
    }

    supplyDraftSending.current = true;
    setLoading(true);

    try {
      const selectedPartner = partners.find((p) => p.id === supplierId);
      const supplierName = selectedPartner ? selectedPartner.name : customSupplierName || 'Dobavljač goriva';

      const payload = supplyDraft.pending?.payload ?? {
        liters: parsedLiters,
        pricePerLiter: parsedPrice,
        fuelType,
        supplierId: supplierId || null,
        supplierName,
        receiptNumber: receiptNumber || null,
        notes: notes || null,
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
      };
      await supplyDraft.request(`${API}/fuel/supplies`, payload);
      supplyDraft.clear();
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Greška pri prijemu cisterne:', err);
      setError(err.message || 'Greška na serveru pri unosu cisterne.');
    } finally {
      supplyDraftSending.current = false;
      setLoading(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <div className={`${styles.modalTitleIcon} ${styles.supplyIcon}`}>
              <Truck size={20} />
            </div>
            <div>
              <h3>Prijem goriva u cisternu</h3>
              <p>Evidentiranje isporuke cisterne i povećanje zaliha</p>
            </div>
          </div>
          <button className={styles.modalCloseBtn} onClick={onClose} title="Zatvori">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.modalForm}>
                <SubmissionRecovery pending={!!supplyDraft.pending} busy={loading} error={supplyDraft.storageError}
                  onRetry={() => void handleSubmit(undefined, true)} />
          {error && (
            <div className={styles.errorBanner}>
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          )}

          {willExceedTank && (
            <div className={styles.warningBanner}>
              <AlertTriangle size={18} />
              <div>
                <strong>Upozorenje na kapacitet cisterne:</strong>
                <div>
                  U cisterni je trenutno {currentTankLiters} L (slobodno: {freeSpaceInTank} L od {tankCapacity} L).
                  Unosom {parsedLiters} L novo stanje će biti {(currentTankLiters + parsedLiters).toLocaleString()} L.
                </div>
              </div>
            </div>
          )}

          <div className={styles.tankStatusBrief}>
            <div className={styles.briefItem}>
              <span>Kapacitet cisterne:</span>
              <strong>{tankCapacity.toLocaleString()} L</strong>
            </div>
            <div className={styles.briefItem}>
              <span>Trenutno stanje:</span>
              <strong>{currentTankLiters.toLocaleString()} L</strong>
            </div>
            <div className={styles.briefItem}>
              <span>Slobodan prostor:</span>
              <strong className={styles.freeSpaceText}>{freeSpaceInTank.toLocaleString()} L</strong>
            </div>
          </div>

          <div className={styles.formGrid}>
            {/* Dobavljač iz šifarnika */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Dobavljač (Partner)</label>
              <CustomSelect
                value={supplierId}
                onChange={(val) => setSupplierId(val)}
                options={[
                  { value: '', label: '-- Izaberite dobavljača ili unesite naziv --' },
                  ...partners.map((p) => ({
                    value: p.id,
                    label: p.name,
                    subLabel: p.type ? `Tip: ${p.type}` : undefined,
                  })),
                ]}
                placeholder="-- Izaberite dobavljača --"
                searchable
              />
            </div>

            {/* Alternativni naziv ako nije u šifarniku */}
            {!supplierId && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Naziv dobavljača</label>
                <input
                  type="text"
                  placeholder="npr. NIS Petrol / Knez Petrol / MOL..."
                  className={styles.formInput}
                  value={customSupplierName}
                  onChange={(e) => setCustomSupplierName(e.target.value)}
                />
              </div>
            )}

            {/* Broj otpremnice / fakture */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Broj otpremnice / fakture</label>
              <input
                type="text"
                placeholder="npr. OTP-2026/0894"
                className={styles.formInput}
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
              />
            </div>

            {/* Datum prijema */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Datum prijema</label>
              <input
                type="date"
                className={styles.formInput}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            {/* Vrsta goriva */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Vrsta goriva</label>
              <CustomSelect
                value={fuelType}
                onChange={(val) => setFuelType(val)}
                options={[
                  { value: 'EURODIZEL', label: '[123] Eurodizel (Standardni)' },
                  { value: 'EURODIZEL ADITIVNI', label: '[122] Eurodizel Aditivni' },
                ]}
                placeholder="Izaberite vrstu goriva"
                searchable={false}
              />
            </div>
          </div>

          {/* Količina i cena po litru */}
          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Količina dovezenog goriva (Litri) <span className={styles.required}>*</span>
              </label>
              <div className={styles.amountInputRow}>
                <input
                  type="number"
                  step="any"
                  min="0.1"
                  placeholder="npr. 5000"
                  className={`${styles.formInput} ${styles.largeInput}`}
                  value={liters}
                  onChange={(e) => setLiters(e.target.value)}
                  required
                />
                <span className={styles.inputUnitBadge}>L</span>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Nabavna cena po litru (RSD bez PDV) <span className={styles.required}>*</span>
              </label>
              <div className={styles.amountInputRow}>
                <input
                  type="number"
                  step="any"
                  min="0.01"
                  placeholder="npr. 185.00"
                  className={`${styles.formInput} ${styles.largeInput}`}
                  value={pricePerLiter}
                  onChange={(e) => setPricePerLiter(e.target.value)}
                  required
                />
                <span className={styles.inputUnitBadge}>RSD</span>
              </div>
            </div>
          </div>

          {/* Kartica kalkulacije ukupnog iznosa */}
          <div className={styles.totalCalculationBox}>
            <div className={styles.calcRow}>
              <span>Kalkulacija prijema:</span>
              <span>{parsedLiters.toLocaleString()} L × {parsedPrice.toFixed(2)} RSD/L</span>
            </div>
            <div className={styles.calcTotalRow}>
              <span>Ukupna vrednost fakture:</span>
              <strong>{calculatedTotalCost.toLocaleString()} RSD</strong>
            </div>
          </div>

          {/* Napomena */}
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Napomena (vozač cisterne, broj plombe...)</label>
            <input
              type="text"
              placeholder="npr. Isporuka u 08:30h, vozač Miloš, plomba br. 44102"
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
              className={`${styles.submitBtn} ${styles.submitSupplyBtn}`}
              disabled={loading || !!supplyDraft.pending}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className={styles.spinner} />
                  <span>Evidentiranje prijema...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>Potvrdi prijem cisterne ({parsedLiters.toLocaleString()} L)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
