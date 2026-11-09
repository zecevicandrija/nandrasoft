import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  Truck,
  Fuel,
  AlertCircle,
  Loader2,
  CheckCircle2,
  ShieldAlert,
  Info,
} from 'lucide-react';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import styles from './MasinaModal.module.css';

export interface MachineStateItem {
  id: string;
  name: string;
  type: string;
  brandModel?: string | null;
  regNumber?: string | null;
  year?: number | null;
  currentHours?: number;
  tankCapacityLiters?: number | null;
  currentFuelLiters?: number | null;
  fuelType?: string | null;
  enpTagNumber?: string | null;
  status: string;
  notes?: string | null;
  isActive?: boolean;
  updatedAt?: string;
  lastRefueledDate?: string | null;
  lastRefueledLiters?: number | null;
  lastRefueledSource?: string | null;
  lastRefueledWorker?: string | null;
}

interface MasinaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  machine?: MachineStateItem | null;
}

const MACHINE_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'TRAKTOR', label: 'Traktor', badge: 'Traktor', badgeType: 'success' },
  { value: 'KOMBAJN', label: 'Kombajn', badge: 'Kombajn', badgeType: 'warning' },
  { value: 'KAMION', label: 'Kamion / Teretno vozilo', badge: 'Kamion', badgeType: 'default' },
  { value: 'PRIKLJUCAK', label: 'Priključak / Sejalica / Prskalica', badge: 'Priključak', badgeType: 'default' },
  { value: 'VILJUSKAR', label: 'Viljuškar', badge: 'Viljuškar', badgeType: 'default' },
  { value: 'OSTALO', label: 'Ostalo / Specijalno vozilo', badge: 'Ostalo', badgeType: 'default' },
];

const MACHINE_STATUS_OPTIONS: CustomSelectOption[] = [
  { value: 'SLOBODNA', label: 'Slobodna (Spremna za rad)', badge: 'Slobodna', badgeType: 'success' },
  { value: 'ZADUZENA', label: 'Zadužena na terenu', badge: 'Zadužena', badgeType: 'warning' },
  { value: 'SERVIS', label: 'Na servisu / Remont', badge: 'Servis', badgeType: 'default' },
  { value: 'U_KVARU', label: 'U kvaru (Neispravna)', badge: 'U kvaru', badgeType: 'danger' },
];

export const MasinaModal: React.FC<MasinaModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  machine,
}) => {
  const isEditing = Boolean(machine?.id);

  // Fetch oil & fuel catalogue from backend (matches "Seme, djubrivo, hemija.XLS" -> "ulja i gorivo")
  const { data: oilFuelData } = useQuery({
    queryKey: ['oil-and-fuel-all'],
    queryFn: async () => {
      const res = await fetch('/api/master/oil-and-fuel?all=true', { credentials: 'include' });
      if (!res.ok) return { products: [] };
      return res.json();
    },
  });

  const fuelTypeOptions = useMemo<CustomSelectOption[]>(() => {
    const defaultOptions: CustomSelectOption[] = [
      { value: 'EURODIZEL', label: '[123] Eurodizel (Osnovno pogonsko)', badge: '[123] Eurodizel', badgeType: 'success' },
      { value: 'EURODIZEL ADITIVNI', label: '[122] Eurodizel Aditivni (Zimski / Premium)', badge: '[122] Aditivni', badgeType: 'default' },
      { value: 'BEZ_GORIVA', label: 'Bez goriva (Priključak bez motora)', badge: 'Bez goriva', badgeType: 'default' },
    ];

    const dbProducts = oilFuelData?.products || [];
    const extraOptions: CustomSelectOption[] = [];

    dbProducts.forEach((p: any) => {
      const isAlreadyIncluded = defaultOptions.some(
        (opt) => opt.value === p.name || (p.code === '123' && opt.value === 'EURODIZEL') || (p.code === '122' && opt.value === 'EURODIZEL ADITIVNI')
      );

      if (!isAlreadyIncluded && (p.category === 'GORIVO' || p.category === 'OSTALO')) {
        extraOptions.push({
          value: p.name,
          label: `[${p.code}] ${p.name}`,
          badge: `[${p.code}]`,
          badgeType: 'default',
        });
      }
    });

    return [...defaultOptions, ...extraOptions, { value: 'OSTALO', label: 'Ostalo gorivo', badge: 'Ostalo', badgeType: 'default' }];
  }, [oilFuelData]);

  // Form states
  const [name, setName] = useState('');
  const [type, setType] = useState('TRAKTOR');
  const [brandModel, setBrandModel] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [year, setYear] = useState<string>('');
  const [status, setStatus] = useState('SLOBODNA');
  const [currentHours, setCurrentHours] = useState<string>('0');
  const [enpTagNumber, setEnpTagNumber] = useState('');
  const [notes, setNotes] = useState('');

  // Fuel specific states
  const [fuelType, setFuelType] = useState('EURODIZEL');
  const [tankCapacityLiters, setTankCapacityLiters] = useState<string>('200');
  const [currentFuelLiters, setCurrentFuelLiters] = useState<string>('0');

  // Safety tracking
  const [initialFuelLiters, setInitialFuelLiters] = useState<number>(0);
  const [confirmFuelChange, setConfirmFuelChange] = useState<boolean>(false);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize form when opening or changing machine
  useEffect(() => {
    if (!isOpen) return;

    if (machine) {
      setName(machine.name || '');
      setType(machine.type || 'TRAKTOR');
      setBrandModel(machine.brandModel || '');
      setRegNumber(machine.regNumber || '');
      setYear(machine.year ? String(machine.year) : '');
      setStatus(machine.status || 'SLOBODNA');
      setCurrentHours(machine.currentHours !== undefined ? String(machine.currentHours) : '0');
      setEnpTagNumber(machine.enpTagNumber || '');
      setNotes(machine.notes || '');

      setFuelType(machine.fuelType || (machine.type === 'PRIKLJUCAK' ? 'BEZ_GORIVA' : 'EURODIZEL'));
      setTankCapacityLiters(machine.tankCapacityLiters !== null && machine.tankCapacityLiters !== undefined ? String(machine.tankCapacityLiters) : '');
      
      const initFuel = machine.currentFuelLiters ?? 0;
      setCurrentFuelLiters(String(initFuel));
      setInitialFuelLiters(initFuel);
      setConfirmFuelChange(false);
    } else {
      // Default new machine values
      setName('');
      setType('TRAKTOR');
      setBrandModel('');
      setRegNumber('');
      setYear(String(new Date().getFullYear()));
      setStatus('SLOBODNA');
      setCurrentHours('0');
      setEnpTagNumber('');
      setNotes('');

      setFuelType('EURODIZEL');
      setTankCapacityLiters('200');
      setCurrentFuelLiters('0');
      setInitialFuelLiters(0);
      setConfirmFuelChange(false);
    }

    setErrorMessage(null);
  }, [isOpen, machine]);

  if (!isOpen) return null;

  // Auto-set defaults when changing machine type
  const handleTypeChange = (newType: string) => {
    setType(newType);
    if (newType === 'PRIKLJUCAK') {
      setFuelType('BEZ_GORIVA');
      setTankCapacityLiters('0');
      setCurrentFuelLiters('0');
    } else if (fuelType === 'BEZ_GORIVA') {
      setFuelType('EURODIZEL');
      if (!tankCapacityLiters || tankCapacityLiters === '0') {
        setTankCapacityLiters('200');
      }
    }
  };

  // Determine if fuel level has been manually altered during edit
  const parsedFuel = currentFuelLiters === '' ? 0 : parseFloat(currentFuelLiters);
  const parsedCapacity = tankCapacityLiters === '' ? 0 : parseFloat(tankCapacityLiters);
  const isFuelChanged = isEditing && !isNaN(parsedFuel) && Math.abs(parsedFuel - initialFuelLiters) > 0.001;
  const isOverCapacity = parsedCapacity > 0 && parsedFuel > parsedCapacity;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage('Naziv mašine je obavezan.');
      return;
    }

    if (isOverCapacity) {
      setErrorMessage(`Trenutno gorivo (${parsedFuel} L) ne može biti veće od kapaciteta rezervoara (${parsedCapacity} L).`);
      return;
    }

    if (isFuelChanged && !confirmFuelChange) {
      setErrorMessage('Morate potvrditi da razumete upozorenje o ručnoj promeni nivoa goriva.');
      return;
    }

    setLoading(true);

    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        type,
        brandModel: brandModel.trim() || null,
        regNumber: regNumber.trim() || null,
        year: year ? parseInt(year, 10) : null,
        status,
        currentHours: currentHours ? parseFloat(currentHours) : 0,
        tankCapacityLiters: tankCapacityLiters !== '' ? parseFloat(tankCapacityLiters) : null,
        currentFuelLiters: currentFuelLiters !== '' ? parseFloat(currentFuelLiters) : 0,
        fuelType: fuelType || 'EURODIZEL',
        enpTagNumber: enpTagNumber.trim() || null,
        notes: notes.trim() || null,
      };

      if (isEditing && machine) {
        payload.expectedMachineUpdatedAt = machine.updatedAt;
      }

      const url = isEditing && machine ? `/api/master/machines/${machine.id}` : '/api/master/machines';
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || `Greška pri čuvanju mašine (${response.status}).`);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Greška pri čuvanju mašine.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>
            <div className={styles.modalIcon}>
              <Truck size={22} />
            </div>
            <div className={styles.modalTitleText}>
              <h3>{isEditing ? `Izmena mašine: ${machine?.name}` : 'Dodavanje nove mašine'}</h3>
              <p>Evidencija specifikacije mašine, kapaciteta rezervoara i pogonskog goriva</p>
            </div>
          </div>
          <button
            type="button"
            className={styles.modalCloseBtn}
            onClick={onClose}
            aria-label="Zatvori modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className={styles.modalForm}>
          {errorMessage && (
            <div className={styles.errorBanner}>
              <AlertCircle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* SECTION 1: Osnovni podaci o mašini */}
          <div className={styles.formSection}>
            <div className={styles.sectionHeader}>
              <Truck size={15} />
              <span>Osnovni podaci</span>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                <span>Naziv mašine <span className={styles.required}>*</span></span>
              </label>
              <input
                type="text"
                className={styles.formInput}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="npr. John Deere 6155M ili Belarus 820"
                required
              />
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Tip mašine</label>
                <CustomSelect
                  value={type}
                  onChange={handleTypeChange}
                  options={MACHINE_TYPE_OPTIONS}
                  searchable={false}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Status</label>
                <CustomSelect
                  value={status}
                  onChange={setStatus}
                  options={MACHINE_STATUS_OPTIONS}
                  searchable={false}
                />
              </div>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Marka i model</label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={brandModel}
                  onChange={(e) => setBrandModel(e.target.value)}
                  placeholder="npr. 6155M ili MTZ 82.1"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Registracija / Inv. broj</label>
                <input
                  type="text"
                  className={styles.formInput}
                  value={regNumber}
                  onChange={(e) => setRegNumber(e.target.value)}
                  placeholder="npr. NS-123-AB"
                />
              </div>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Godina proizvodnje</label>
                <input
                  type="number"
                  className={styles.formInput}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="npr. 2021"
                  min="1950"
                  max="2035"
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Trenutni radni sati (rh)</label>
                <div className={styles.inputWithUnit}>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className={styles.formInput}
                    value={currentHours}
                    onChange={(e) => setCurrentHours(e.target.value)}
                  />
                  <span className={styles.inputUnit}>rh</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 2: Gorivo & Rezervoar (KLJUČNO SA UPOZORENJIMA) */}
          <div className={styles.formSection}>
            <div className={styles.sectionHeader}>
              <Fuel size={15} />
              <span>Gorivo i nivo rezervoara</span>
            </div>

            {/* General informational notice */}
            <div className={styles.fuelWarningBox}>
              <Info size={18} className={styles.fuelWarningIcon} />
              <div>
                <strong>Pravilo evidencije goriva:</strong>
                Redovan unos goriva se obavlja isključivo preko kartice <em>„Dnevnik točenja“</em> (uz fiskalni račun sa pumpe ili točenje iz cisterne).
                Direktno unošenje litara ovde je namenjeno samo za početnu evidenciju ili fizičku kalibraciju rezervoara.
              </div>
            </div>

            <div className={styles.formGrid}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Vrsta pogonskog goriva</label>
                <CustomSelect
                  value={fuelType}
                  onChange={setFuelType}
                  options={fuelTypeOptions}
                  searchable={false}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Kapacitet rezervoara (Max L)</span>
                </label>
                <div className={styles.inputWithUnit}>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    className={styles.formInput}
                    value={tankCapacityLiters}
                    onChange={(e) => setTankCapacityLiters(e.target.value)}
                    placeholder="npr. 250"
                  />
                  <span className={styles.inputUnit}>L</span>
                </div>
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>
                <span>Trenutni nivo goriva u mašini</span>
                {isEditing && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Evidentirano: {initialFuelLiters} L
                  </span>
                )}
              </label>
              <div className={styles.inputWithUnit}>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  className={styles.formInput}
                  value={currentFuelLiters}
                  onChange={(e) => setCurrentFuelLiters(e.target.value)}
                  placeholder="0"
                />
                <span className={styles.inputUnit}>L</span>
              </div>
            </div>

            {/* CRITICAL WARNING WHEN USER DIRECTLY EDITS CURRENT FUEL LEVEL */}
            {isFuelChanged && (
              <div className={styles.fuelChangeAlert}>
                <div className={styles.fuelChangeHeader}>
                  <ShieldAlert size={20} />
                  <span>PAŽNJA: Detektovana je direktna izmena stanja goriva!</span>
                </div>
                <div className={styles.fuelChangeBody}>
                  Menjate nivo goriva sa <strong>{initialFuelLiters} L</strong> na <strong>{parsedFuel} L</strong> bez pratećeg točenja.
                  <br />
                  Ovim se zaobilazi unos računa sa pumpe ili protok cisterne firme. Ova promena će biti trajno upisana u
                  <strong> revizorski dnevnik (Audit Log)</strong> sa Vašim nalogom i tačnim vremenom promene.
                </div>
                <label className={styles.fuelConfirmationRow}>
                  <input
                    type="checkbox"
                    className={styles.confirmCheckbox}
                    checked={confirmFuelChange}
                    onChange={(e) => setConfirmFuelChange(e.target.checked)}
                  />
                  <span className={styles.confirmLabel}>
                    Razumem da ova direktna izmena zaobilazi redovnu evidenciju točenja (račun / cisterna) i potvrđujem ručnu korekciju stanja goriva.
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* SECTION 3: Dodatno (Putarine & Napomena) */}
          <div className={styles.formSection}>
            <div className={styles.sectionHeader}>
              <Info size={15} />
              <span>Dodatne napomene</span>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Broj ENP TAG uređaja (za putarine)</label>
              <input
                type="text"
                className={styles.formInput}
                value={enpTagNumber}
                onChange={(e) => setEnpTagNumber(e.target.value)}
                placeholder="npr. ENP-104288"
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Napomena o mašini</label>
              <textarea
                className={styles.formTextarea}
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Dodatne specifikacije, raspored održavanja, posebna ulja..."
              />
            </div>
          </div>

          {/* Footer */}
          <div className={styles.modalFooter}>
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
              disabled={loading || (isFuelChanged && !confirmFuelChange) || isOverCapacity}
              title={
                isFuelChanged && !confirmFuelChange
                  ? 'Morate označiti potvrdu da biste ručno izmenili nivo goriva'
                  : undefined
              }
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Čuvanje...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={16} />
                  <span>{isEditing ? 'Sačuvaj izmene' : 'Kreiraj mašinu'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
