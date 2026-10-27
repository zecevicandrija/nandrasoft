import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X, MapPin, Loader2, AlertCircle } from 'lucide-react';

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
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2500,
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 20px 40px rgba(15, 23, 42, 0.25)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <MapPin size={19} color="#16a34a" />
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
              {isEditing ? `Izmeni parcelu [${parcelToEdit?.code}]` : 'Dodaj novu parcelu'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.25rem',
              borderRadius: '6px',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div
            style={{
              margin: '0.85rem 1.25rem 0',
              padding: '0.65rem 0.85rem',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              color: '#b91c1c',
              fontSize: '0.84rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ padding: '1.15rem 1.25rem' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.85rem',
              marginBottom: '0.85rem',
            }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '0.35rem',
                }}
              >
                Šifra parcele *
              </label>
              <input
                type="text"
                placeholder="npr. P-01"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '0.35rem',
                }}
              >
                Površina (ha) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="npr. 12.5"
                value={areaHa}
                onChange={(e) => setAreaHa(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '0.85rem' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#334155',
                marginBottom: '0.35rem',
              }}
            >
              Naziv parcele / Njive *
            </label>
            <input
              type="text"
              placeholder="npr. Potes Lug"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '0.85rem',
              marginBottom: '0.85rem',
            }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '0.35rem',
                }}
              >
                Lokacija / KO
              </label>
              <input
                type="text"
                placeholder="npr. KO Bački Petrovac"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '0.35rem',
                }}
              >
                Trenutna kultura
              </label>
              <input
                type="text"
                placeholder="npr. Luk žuti"
                value={currentCrop}
                onChange={(e) => setCurrentCrop(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '1.15rem' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.8rem',
                fontWeight: 600,
                color: '#334155',
                marginBottom: '0.35rem',
              }}
            >
              Napomena (opciono)
            </label>
            <textarea
              rows={2}
              placeholder="Dodatni opis parcele..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.88rem',
                boxSizing: 'border-box',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.6rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid #e2e8f0',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: '0.5rem 0.95rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Otkaži
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '0.5rem 1.1rem',
                borderRadius: '8px',
                border: 'none',
                background: '#16a34a',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
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
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
      <button
        type="button"
        onClick={onAddClick}
        title="Brzo dodaj novu parcelu"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.22rem',
          padding: '0.18rem 0.5rem',
          fontSize: '0.72rem',
          fontWeight: 700,
          color: '#15803d',
          background: '#dcfce7',
          border: '1px solid #86efac',
          borderRadius: '6px',
          cursor: 'pointer',
          lineHeight: 1.2,
        }}
      >
        <Plus size={12} />
        <span>Dodaj parcelu</span>
      </button>

      {selectedParcel && (
        <button
          type="button"
          onClick={() => onEditClick(selectedParcel)}
          title={`Izmeni parcelu [${selectedParcel.code}] ${selectedParcel.name}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.22rem',
            padding: '0.18rem 0.5rem',
            fontSize: '0.72rem',
            fontWeight: 700,
            color: '#0369a1',
            background: '#e0f2fe',
            border: '1px solid #7dd3fc',
            borderRadius: '6px',
            cursor: 'pointer',
            lineHeight: 1.2,
          }}
        >
          <Pencil size={11} />
          <span>Izmeni parcelu</span>
        </button>
      )}
    </span>
  );
};

