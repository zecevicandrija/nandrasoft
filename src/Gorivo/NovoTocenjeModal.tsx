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
  const [fuelSource, setFuelSource] = useState<'CISTERNA' | 'PUMPA' | 'KANISTER'>('CISTERNA');
  const [fuelType, setFuelType] = useState('EURODIZEL');
  const [liters, setLiters] = useState<string>('');
  const [pricePerLiter, setPricePerLiter] = useState<string>('');
  const [receiptNumber, setReceiptNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(todayStr);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Automatski selektuj radnika ako je povezan sa prijavljenim nalogom
  useEffect(() => {
    if (isOpen && workers.length > 0) {
      const currentUserName = (session as any)?.user?.name?.toLowerCase() || '';
      const firstName = currentUserName.split(' ')[0] || '';
      const matched = workers.find(
        (w) =>
          w.userId === currentUserId ||
          (firstName && w.name.toLowerCase().includes(firstName))
      );
      if (matched && !workerId) {
        setWorkerId(matched.id);
      }
    }
  }, [isOpen, workers, currentUserId, session]);

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

  // Live pre-check upozorenja
  const parsedLiters = Number(liters) || 0;
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

    if (!machineId) {
      setError('Morate izabrati radnu mašinu.');
      return;
    }

    let effectiveWorkerId = workerId;
    if (!effectiveWorkerId && !isManager) {
      const currentUserName = (session as any)?.user?.name?.toLowerCase() || '';
      const firstName = currentUserName.split(' ')[0] || '';
      const matched = workers.find(
        (w) =>
          w.userId === currentUserId ||
          (firstName && w.name.toLowerCase().includes(firstName))
      );
      if (matched) {
        effectiveWorkerId = matched.id;
      }
    }

    if (isManager && !effectiveWorkerId) {
      setError('Morate izabrati radnika (točioca).');
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

    setLoading(true);

    try {
      // Kombinujemo izabrani datum sa tačnim trenutnim satima, minutima i sekundama u lokalnom vremenu
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
        fuelType,
        liters: parsedLiters,
        receiptNumber: receiptNumber || null,
        notes: notes || null,
        date: entryDateTime.toISOString(),
      };

      if (pricePerLiter && isManager) {
        payload.pricePerLiter = Number(pricePerLiter);
      }

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

      // Uspešno sačuvano
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

          {/* Izvor točenja (3 velika dugmeta) */}
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
                  <span className={styles.sourceBtnSub}>
                    {isManager ? `Dostupno: ${tankCurrentLiters} L` : 'Dvorišni tank gazdinstva'}
                  </span>
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

          <div className={styles.formGrid}>
            {/* Mašina */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                Radna mašina / Traktor <span className={styles.required}>*</span>
              </label>
              <select
                className={styles.formSelect}
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                required
              >
                <option value="">-- Izaberite mašinu --</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.brandModel ? `(${m.brandModel})` : ''} — [Rezervoar: {m.tankCapacityLiters || 200}L]
                  </option>
                ))}
              </select>
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
                <select
                  className={styles.formSelect}
                  value={workerId}
                  onChange={(e) => setWorkerId(e.target.value)}
                  required
                >
                  <option value="">-- Izaberite radnika --</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Tip goriva / fluida */}
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Vrsta energenta / maziva</label>
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

          {/* Ako je točeno na pumpi ili korisnik ima menadžersku ulogu */}
          {(fuelSource === 'PUMPA' || isManager) && (
            <div className={styles.financialSection}>
              <div className={styles.sectionTitle}>
                <Receipt size={16} />
                <span>Podaci o računu i ceni (Pumpe i uprava)</span>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Broj računa / otpremnice</label>
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
                    <span className={styles.fieldHint}>
                      {fuelSource === 'CISTERNA'
                        ? 'Automatski se uzima prosečna nabavna cena cisterne ako ostavite prazno'
                        : 'Unesite cenu sa računa benzinske pumpe'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

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
