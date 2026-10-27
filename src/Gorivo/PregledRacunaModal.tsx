import React, { useState, useEffect } from 'react';
import {
  X,
  Receipt,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Fuel,
  User,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import styles from './GorivoDashboard.module.css';

const API = 'http://localhost:5000/api';

interface FuelEntryForReceipt {
  id: string;
  date: string;
  fuelSource: 'CISTERNA' | 'PUMPA' | 'KANISTER';
  gasStation?: string;
  fuelType: string;
  liters: number;
  pricePerLiter?: number | null;
  totalCost?: number | null;
  receiptImageUrl?: string | null;
  notes?: string;
  machine: {
    id: string;
    name: string;
    brandModel?: string;
  };
  worker: {
    id: string;
    name: string;
  };
}

interface PregledRacunaModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: FuelEntryForReceipt | null;
  isManager: boolean;
  onPriceSaved?: () => void;
}

export const PregledRacunaModal: React.FC<PregledRacunaModalProps> = ({
  isOpen,
  onClose,
  entry,
  isManager,
  onPriceSaved,
}) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [totalCostInput, setTotalCostInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (entry && isOpen) {
      setZoom(1);
      setRotation(0);
      setTotalCostInput(entry.totalCost ? String(entry.totalCost) : '');
      setSaveError('');
      setSaveSuccess(false);
    }
  }, [entry, isOpen]);

  if (!isOpen || !entry || !entry.receiptImageUrl) return null;

  const parsedCost = Number(totalCostInput) || 0;
  const calculatedPerLiter =
    parsedCost > 0 && entry.liters > 0
      ? (parsedCost / entry.liters).toFixed(2)
      : null;

  const handleSavePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    setSaveSuccess(false);

    if (!parsedCost || parsedCost <= 0) {
      setSaveError('Unesite ispravan ukupan iznos sa računa (veći od 0 RSD).');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API}/fuel/entries/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          totalCost: parsedCost,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri čuvanju cene sa računa.');
      }

      setSaveSuccess(true);
      if (onPriceSaved) {
        onPriceSaved();
      }
    } catch (err: any) {
      setSaveError(err.message || 'Greška pri čuvanju cene.');
    } finally {
      setSaving(false);
    }
  };

  const d = new Date(entry.date);
  const formattedDate = `${d.toLocaleDateString('sr-RS')} u ${d.toLocaleTimeString('sr-RS', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={`${styles.modalContent} ${styles.receiptViewerModal}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <div className={styles.modalTitleIcon}>
              <Receipt size={20} />
            </div>
            <div>
              <h3>Fiskalni račun točenja goriva</h3>
              <p>
                {entry.machine?.name} • {entry.liters} L ({entry.gasStation || entry.fuelSource})
              </p>
            </div>
          </div>
          <button className={styles.modalCloseBtn} onClick={onClose} title="Zatvori">
            <X size={20} />
          </button>
        </div>

        <div className={styles.receiptViewerBody}>
          {/* Gornja traka sa podacima o točenju */}
          <div className={styles.receiptMetaStrip}>
            <div className={styles.receiptMetaPill}>
              <Calendar size={14} />
              <span>{formattedDate}</span>
            </div>
            <div className={styles.receiptMetaPill}>
              <User size={14} />
              <span>Radnik: <strong>{entry.worker?.name}</strong></span>
            </div>
            <div className={styles.receiptMetaPill}>
              <Fuel size={14} />
              <span>
                Količina: <strong>{entry.liters} L</strong> ({entry.fuelType})
              </span>
            </div>
          </div>

          {/* Kontrole za zumiranje i rotiranje slike */}
          <div className={styles.receiptToolbar}>
            <button
              type="button"
              className={styles.receiptToolBtn}
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
              title="Umanji"
            >
              <ZoomOut size={16} />
              <span>Umanji</span>
            </button>
            <span className={styles.receiptZoomIndicator}>{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className={styles.receiptToolBtn}
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
              title="Uveličaj"
            >
              <ZoomIn size={16} />
              <span>Uveličaj</span>
            </button>
            <button
              type="button"
              className={styles.receiptToolBtn}
              onClick={() => setRotation((r) => (r + 90) % 360)}
              title="Rotiraj za 90°"
            >
              <RotateCw size={16} />
              <span>Rotiraj</span>
            </button>
            <a
              href={entry.receiptImageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.receiptToolBtn}
              style={{ marginLeft: 'auto', textDecoration: 'none' }}
            >
              <ExternalLink size={16} />
              <span>Otvori original</span>
            </a>
          </div>

          {/* Prikaz slike računa sa Bunny CDN-a */}
          <div className={styles.receiptImageViewport}>
            <img
              src={entry.receiptImageUrl}
              alt="Slika fiskalnog računa"
              className={styles.receiptFullImage}
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
              }}
            />
          </div>

          {/* Sekcija za direktan unos/izmenu cene od strane Rukovodioca / Direktora dok gleda račun */}
          {isManager ? (
            <form onSubmit={handleSavePrice} className={styles.receiptManagerPriceForm}>
              <div className={styles.receiptManagerFormHeader}>
                <Receipt size={16} color="#16a34a" />
                <span>
                  {entry.totalCost
                    ? 'Izmena iznosa sa fiskalnog računa (Uprava)'
                    : 'Unesite ukupan iznos sa slike računa (RSD)'}
                </span>
              </div>

              {saveError && (
                <div className={styles.errorBanner} style={{ padding: '0.5rem 0.75rem' }}>
                  <AlertTriangle size={15} />
                  <span>{saveError}</span>
                </div>
              )}

              {saveSuccess && (
                <div className={styles.receiptSavedBanner}>
                  <CheckCircle2 size={16} />
                  <span>Cena sa računa je uspešno sačuvana! ({parsedCost.toLocaleString()} RSD)</span>
                </div>
              )}

              <div className={styles.receiptManagerInputRow}>
                <div className={styles.amountInputRow} style={{ flex: 1 }}>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    placeholder="Ukupan iznos sa računa (npr. 10250)"
                    className={styles.formInput}
                    value={totalCostInput}
                    onChange={(e) => {
                      setTotalCostInput(e.target.value);
                      setSaveSuccess(false);
                    }}
                  />
                  <span className={styles.inputUnitBadge}>RSD</span>
                </div>

                <button
                  type="submit"
                  className={styles.submitBtn}
                  disabled={saving}
                >
                  {saving ? (
                    <>
                      <Loader2 size={16} className={styles.spinner} />
                      <span>Čuvanje...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <span>Sačuvaj cenu</span>
                    </>
                  )}
                </button>
              </div>

              {calculatedPerLiter && (
                <div className={styles.realtimePriceCalc}>
                  Obračun po litru: <strong>{parsedCost.toLocaleString()} RSD</strong> / {entry.liters} L ={' '}
                  <strong>{calculatedPerLiter} RSD/L</strong>
                </div>
              )}
            </form>
          ) : (
            entry.totalCost && (
              <div className={styles.realtimePriceCalc}>
                Evidentirani iznos računa: <strong>{entry.totalCost.toLocaleString()} RSD</strong> (
                {entry.pricePerLiter} RSD/L)
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
};

