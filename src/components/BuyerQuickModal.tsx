import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X, Building2, Loader2, AlertCircle } from 'lucide-react';
import styles from './ParcelQuickModal.module.css';

export interface BuyerItem {
  id: string;
  name: string;
  type?: string;
  pib?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
}

interface BuyerQuickModalProps {
  isOpen: boolean;
  onClose: () => void;
  buyerToEdit?: BuyerItem | null;
  onSaved: (savedBuyer: BuyerItem, mode: 'create' | 'edit') => void;
}

const API = '/api/onion';

export const BuyerQuickModal: React.FC<BuyerQuickModalProps> = ({
  isOpen,
  onClose,
  buyerToEdit,
  onSaved,
}) => {
  const queryClient = useQueryClient();
  const isEditing = !!buyerToEdit;

  const [name, setName] = useState('');
  const [pib, setPib] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setError('');
      if (buyerToEdit) {
        setName(buyerToEdit.name || '');
        setPib(buyerToEdit.pib || '');
        setPhone(buyerToEdit.phone || '');
        setEmail(buyerToEdit.email || '');
        setAddress(buyerToEdit.address || '');
        setNotes(buyerToEdit.notes || '');
      } else {
        setName('');
        setPib('');
        setPhone('');
        setEmail('');
        setAddress('');
        setNotes('');
      }
    }
  }, [isOpen, buyerToEdit]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Naziv kupca / partnera je obavezan.');
      return;
    }

    setLoading(true);
    try {
      const url = isEditing
        ? `${API}/buyers/${buyerToEdit!.id}`
        : `${API}/buyers`;
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          type: 'KUPAC',
          pib: pib.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri čuvanju kupca.');
      }

      // Osveži sve relevantne keševe u aplikaciji
      queryClient.invalidateQueries({ queryKey: ['onion-lookup'] });
      queryClient.invalidateQueries({ queryKey: ['onion-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['onion-shipment'] });
      queryClient.invalidateQueries({ queryKey: ['onion-traceability'] });
      queryClient.invalidateQueries({ queryKey: ['partners'] });
      queryClient.invalidateQueries({ queryKey: ['master-stats'] });

      const savedObj = data.buyer || data.partner;
      onSaved(savedObj, isEditing ? 'edit' : 'create');
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
            <Building2 size={19} color="#0284c7" />
            <h3 className={styles.modalTitleText}>
              {isEditing ? `Izmeni kupca [${buyerToEdit?.name}]` : 'Dodaj novog kupca'}
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

        {/* Form */}
        <form onSubmit={handleSubmit} className={styles.modalForm}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Naziv kupca / firme *</label>
            <input
              type="text"
              required
              placeholder="npr. Delhaize Serbia / Maxi d.o.o."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.formInput}
              autoFocus
            />
          </div>

          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>PIB kupca (opciono)</label>
              <input
                type="text"
                placeholder="npr. 100001234"
                value={pib}
                onChange={(e) => setPib(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Kontakt telefon</label>
              <input
                type="text"
                placeholder="npr. 064/123-4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Email adresa</label>
              <input
                type="email"
                placeholder="npr. nabavka@maxi.rs"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Adresa / Istovarno mesto</label>
              <input
                type="text"
                placeholder="npr. DC Stara Pazova"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={styles.formInput}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel}>Napomena (opciono)</label>
            <textarea
              rows={2}
              placeholder="Uputstvo za isporuku, kontakt osoba, tražene ambalaže..."
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
              style={{ backgroundColor: '#0284c7' }}
            >
              {loading && <Loader2 size={15} className="spin" />}
              <span>{loading ? 'Čuvanje...' : isEditing ? 'Sačuvaj izmene' : 'Dodaj kupca'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface BuyerQuickActionsProps {
  selectedBuyer?: BuyerItem | null;
  onAddClick: () => void;
  onEditClick: (buyer: BuyerItem) => void;
}

export const BuyerQuickActions: React.FC<BuyerQuickActionsProps> = ({
  selectedBuyer,
  onAddClick,
  onEditClick,
}) => {
  return (
    <div className={styles.quickActionsContainer}>
      <button
        type="button"
        onClick={onAddClick}
        title="Brzo dodaj novog kupca"
        className={styles.actionBtnAdd}
        style={{
          color: '#0284c7',
          backgroundColor: '#e0f2fe',
          borderColor: '#7dd3fc',
        }}
      >
        <Plus size={12} strokeWidth={2.5} />
        <span>Dodaj kupca</span>
      </button>

      {selectedBuyer && (
        <button
          type="button"
          onClick={() => onEditClick(selectedBuyer)}
          title={`Izmeni podatke kupca ${selectedBuyer.name}`}
          className={styles.actionBtnEdit}
        >
          <Pencil size={11} strokeWidth={2.5} />
          <span>Izmeni</span>
        </button>
      )}
    </div>
  );
};

export default BuyerQuickModal;

