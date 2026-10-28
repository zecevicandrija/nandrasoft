import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X, MapPin, Loader2, AlertCircle } from 'lucide-react';
import styles from './ParcelQuickModal.module.css';

export interface ParcelItem {
  id: string;
  code: string;
  name: string;
  areaHa: number;
  location?: string | null;
  currentCrop?: string | null;
  notes?: string | null;
}

interface ParcelQuickModalProps {
  isOpen: boolean;
  onClose: () => void;
  parcelToEdit?: ParcelItem | null;
  onSaved: (savedParcel: ParcelItem, mode: 'create' | 'edit') => void;
}

const API = 'http://localhost:5000/api';

export const ParcelQuickModal: React.FC<ParcelQuickModalProps> = ({
  isOpen,
  onClose,
  parcelToEdit,
  onSaved,
}) => {
  const queryClient = useQueryClient();
  const isEditing = !!parcelToEdit;

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [areaHa, setAreaHa] = useState<string>('');
  const [location, setLocation] = useState('');
  const [currentCrop, setCurrentCrop] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setError('');
      if (parcelToEdit) {
        setCode(parcelToEdit.code || '');
        setName(parcelToEdit.name || '');
        setAreaHa(parcelToEdit.areaHa !== undefined ? String(parcelToEdit.areaHa) : '');
        setLocation(parcelToEdit.location || '');
        setCurrentCrop(parcelToEdit.currentCrop || '');
        setNotes(parcelToEdit.notes || '');
      } else {
        setCode('');
        setName('');
        setAreaHa('');
        setLocation('');
        setCurrentCrop('');
        setNotes('');
      }
    }
  }, [isOpen, parcelToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code.trim() || !name.trim() || !areaHa || Number(areaHa) <= 0) {
      setError('Šifra, naziv i površina (ha > 0) su obavezni.');
      return;
    }

    setLoading(true);
    try {
      const url = isEditing
        ? `${API}/master/parcels/${parcelToEdit!.id}`
        : `${API}/master/parcels`;
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          areaHa: Number(areaHa),
          location: location.trim() || null,
          currentCrop: currentCrop.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri čuvanju parcele.');
      }

      // Osveži sve relevantne keševe u aplikaciji
      queryClient.invalidateQueries({ queryKey: ['parcels'] });
      queryClient.invalidateQueries({ queryKey: ['parcels-lite'] });
      queryClient.invalidateQueries({ queryKey: ['master-stats'] });
      queryClient.invalidateQueries({ queryKey: ['field-works'] });

      onSaved(data.parcel, isEditing ? 'edit' : 'create');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Došlo je do greške na serveru.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.modalHeader}>
          <div className={styles.modalHeaderTitle}>
            <MapPin size={19} color="#16a34a" />
            <h3 className={styles.modalTitleText}>
              {isEditing ? `Izmeni parcelu [${parcelToEdit?.code}]` : 'Dodaj novu parcelu'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={styles.modalCloseBtn}
            title="Zatvori"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className={styles.errorBox}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGrid}>
            <div>
              <label className={styles.formLabel}>Šifra parcele *</label>
              <input
                type="text"
                placeholder="npr. P-01"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                className={styles.formInput}
              />
            </div>

            <div>
              <label className={styles.formLabel}>Površina (ha) *</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="npr. 12.5"
                value={areaHa}
                onChange={(e) => setAreaHa(e.target.value)}
                required
                className={styles.formInput}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Naziv parcele / Njive *</label>
            <input
              type="text"
              placeholder="npr. Potes Lug"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={styles.formInput}
            />
          </div>

          <div className={styles.formGrid}>
            <div>
              <label className={styles.formLabel}>Lokacija / KO</label>
              <input
                type="text"
                placeholder="npr. KO Bački Petrovac"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div>
              <label className={styles.formLabel}>Trenutna kultura</label>
              <input
                type="text"
                placeholder="npr. Luk žuti"
                value={currentCrop}
                onChange={(e) => setCurrentCrop(e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Napomena (opciono)</label>
            <textarea
              rows={2}
              placeholder="Dodatni opis parcele..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={styles.formTextarea}
            />
          </div>

          <div className={styles.modalFooter}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className={styles.btnCancel}
            >
              Otkaži
            </button>
            <button
              type="submit"
              disabled={loading}
              className={styles.btnSubmit}
            >
              {loading && <Loader2 size={15} className="spin" />}
              <span>{loading ? 'Čuvanje...' : isEditing ? 'Sačuvaj izmene' : 'Dodaj parcelu'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface ParcelQuickActionsProps {
  selectedParcel?: ParcelItem | null;
  onAddClick: () => void;
  onEditClick: (parcel: ParcelItem) => void;
}

export const ParcelQuickActions: React.FC<ParcelQuickActionsProps> = ({
  selectedParcel,
  onAddClick,
  onEditClick,
}) => {
  return (
    <div className={styles.quickActionsContainer}>
      <button
        type="button"
        onClick={onAddClick}
        title="Brzo dodaj novu parcelu"
        className={styles.actionBtnAdd}
      >
        <Plus size={12} strokeWidth={2.5} />
        <span>Dodaj parcelu</span>
      </button>

      {selectedParcel && (
        <button
          type="button"
          onClick={() => onEditClick(selectedParcel)}
          title={`Izmeni parcelu [${selectedParcel.code}] ${selectedParcel.name}`}
          className={styles.actionBtnEdit}
        >
          <Pencil size={11} strokeWidth={2.5} />
          <span>Izmeni</span>
        </button>
      )}
    </div>
  );
};

export default ParcelQuickModal;
