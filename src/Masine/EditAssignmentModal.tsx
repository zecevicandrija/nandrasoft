import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import MachineUsageAction from '../components/MachineUsageAction';
import { formatSrDate } from './assignmentHelpers';
import styles from './MasineZaduzenje.module.css';

interface EditAssignmentModalProps {
  assignment: any;
  isSaving: boolean;
  onClose: () => void;
  onOpenMachineUsage: (assignmentId: string) => void;
  onNotify: (message: string, type: 'success' | 'error') => void;
  onSubmit: (id: string, payload: Record<string, any>) => void;
}

const EditAssignmentModal: React.FC<EditAssignmentModalProps> = ({
  assignment,
  isSaving,
  onClose,
  onOpenMachineUsage,
  onNotify,
  onSubmit,
}) => {
  const [editForm, setEditForm] = useState<Record<string, any>>(() => ({
    startHours: assignment.startHours,
    endHours: assignment.endHours !== null && assignment.endHours !== undefined ? assignment.endHours : '',
    startFuelLiters:
      assignment.startFuelLiters !== null && assignment.startFuelLiters !== undefined
        ? assignment.startFuelLiters
        : '',
    endFuelLiters:
      assignment.endFuelLiters !== null && assignment.endFuelLiters !== undefined
        ? assignment.endFuelLiters
        : '',
    isOperational: assignment.isOperational ?? true,
    assignNotes: assignment.assignNotes || '',
    returnNotes: assignment.returnNotes || '',
  }));

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();

    const startH = Number(editForm.startHours);
    if (isNaN(startH) || startH < 0) {
      onNotify('Početni radni sati moraju biti pozitivan broj.', 'error');
      return;
    }

    const maxTank = assignment.machine?.tankCapacityLiters;
    const startLiters =
      editForm.startFuelLiters !== '' && editForm.startFuelLiters !== null
        ? Number(editForm.startFuelLiters)
        : null;
    const endLiters =
      editForm.endFuelLiters !== '' && editForm.endFuelLiters !== null
        ? Number(editForm.endFuelLiters)
        : null;

    if (maxTank && startLiters !== null && startLiters > maxTank) {
      onNotify(`Početno gorivo (${startLiters} L) ne može biti veće od kapaciteta rezervoara (${maxTank} L).`, 'error');
      return;
    }

    if (maxTank && endLiters !== null && endLiters > maxTank) {
      onNotify(`Krajnje gorivo (${endLiters} L) ne može biti veće od kapaciteta rezervoara (${maxTank} L).`, 'error');
      return;
    }

    const payload: Record<string, any> = {
      startHours: startH,
      startFuelLiters: startLiters,
      assignNotes: editForm.assignNotes || null,
    };

    if (assignment.status !== 'ZADUZENA') {
      if (editForm.endHours !== '' && editForm.endHours !== null && editForm.endHours !== undefined) {
        const endH = Number(editForm.endHours);
        if (isNaN(endH) || endH < startH) {
          onNotify(`Krajnji radni sati (${endH} rh) ne mogu biti manji od početnih (${startH} rh).`, 'error');
          return;
        }
        payload.endHours = endH;
      }
      payload.endFuelLiters = endLiters;
      payload.isOperational = Boolean(editForm.isOperational);
      payload.returnNotes = editForm.returnNotes || null;
    }

    onSubmit(assignment.id, payload);
  };

  const tankCap = assignment.machine?.tankCapacityLiters || 200;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Izmena Zaduženja: {assignment.machine?.name}</h3>
          <button type="button" className={styles.modalCloseBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <MachineUsageAction
          inset
          disabled={Boolean(assignment.voidedAt)}
          onClick={() => onOpenMachineUsage(assignment.id)}
        />

        <form onSubmit={handleSaveEdit}>
          <div className={styles.modalBody}>
            <div
              style={{
                backgroundColor: 'var(--bg-secondary)',
                padding: '0.85rem 1rem',
                borderRadius: 10,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.85rem',
              }}
            >
              <span>
                Radnik: <strong>{assignment.worker?.name}</strong>
              </span>
              <span>
                Datum: <strong>{formatSrDate(assignment.assignedAt)}</strong>
              </span>
            </div>

            <div className={styles.twoColRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Početni radni sati (rh)</label>
                <div className={styles.inputWrapper}>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className={`${styles.inputField} ${styles.inputWithBadge}`}
                    value={editForm.startHours}
                    onChange={(e) => setEditForm({ ...editForm, startHours: e.target.value })}
                    required
                  />
                  <span className={styles.inputBadge}>rh</span>
                </div>
              </div>

              {assignment.status !== 'ZADUZENA' && (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Krajnji radni sati (rh)</label>
                  <div className={styles.inputWrapper}>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      className={`${styles.inputField} ${styles.inputWithBadge}`}
                      value={editForm.endHours}
                      onChange={(e) => setEditForm({ ...editForm, endHours: e.target.value })}
                    />
                    <span className={styles.inputBadge}>rh</span>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.formGroup}>
              <div className={styles.labelRow}>
                <label className={styles.formLabel} style={{ margin: 0 }}>
                  Gorivo na polasku (L)
                </label>
                <span className={styles.capacityHint}>Maks: {tankCap} L</span>
              </div>
              <div className={styles.inputWrapper}>
                <input
                  type="number"
                  step="1"
                  min="0"
                  max={tankCap}
                  className={`${styles.inputField} ${styles.inputWithBadge}`}
                  value={editForm.startFuelLiters}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val !== '' && Number(val) > tankCap) {
                      setEditForm({ ...editForm, startFuelLiters: tankCap });
                      return;
                    }
                    setEditForm({ ...editForm, startFuelLiters: val });
                  }}
                  placeholder={`npr. ${tankCap}`}
                />
                <span className={styles.inputBadge}>Litara</span>
              </div>
            </div>

            {assignment.status !== 'ZADUZENA' && (
              <>
                <div className={styles.formGroup}>
                  <div className={styles.labelRow}>
                    <label className={styles.formLabel} style={{ margin: 0 }}>
                      Gorivo na povratku (L)
                    </label>
                    <span className={styles.capacityHint}>Maks: {tankCap} L</span>
                  </div>
                  <div className={styles.inputWrapper}>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max={tankCap}
                      className={`${styles.inputField} ${styles.inputWithBadge}`}
                      value={editForm.endFuelLiters}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val !== '' && Number(val) > tankCap) {
                          setEditForm({ ...editForm, endFuelLiters: tankCap });
                          return;
                        }
                        setEditForm({ ...editForm, endFuelLiters: val });
                      }}
                      placeholder={`npr. ${Math.round(tankCap * 0.75)}`}
                    />
                    <span className={styles.inputBadge}>Litara</span>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Stanje ispravnosti mašine</label>
                  <div className={styles.toggleBtnGroup}>
                    <button
                      type="button"
                      className={`${styles.toggleBtn} ${editForm.isOperational ? styles.toggleBtnActiveSuccess : ''}`}
                      onClick={() => setEditForm({ ...editForm, isOperational: true })}
                    >
                      <CheckCircle2 size={16} />
                      Ispravna
                    </button>
                    <button
                      type="button"
                      className={`${styles.toggleBtn} ${!editForm.isOperational ? styles.toggleBtnActiveDanger : ''}`}
                      onClick={() => setEditForm({ ...editForm, isOperational: false })}
                    >
                      <AlertCircle size={16} />
                      Prijavljen kvar
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Napomena pri preuzimanju</label>
              <input
                type="text"
                className={styles.inputField}
                value={editForm.assignNotes}
                onChange={(e) => setEditForm({ ...editForm, assignNotes: e.target.value })}
                placeholder="Opciona napomena preuzimanja"
              />
            </div>

            {assignment.status !== 'ZADUZENA' && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  {editForm.isOperational ? 'Napomena pri povratku' : 'Opis kvara / problema'}
                </label>
                <textarea
                  rows={2}
                  className={styles.inputField}
                  value={editForm.returnNotes}
                  onChange={(e) => setEditForm({ ...editForm, returnNotes: e.target.value })}
                  placeholder={editForm.isOperational ? 'Opciona napomena' : 'Opišite kvar...'}
                />
              </div>
            )}
          </div>

          <div className={styles.modalFooter}>
            <button
              type="button"
              className={styles.fuelBtn}
              style={{ padding: '0.6rem 1rem' }}
              onClick={onClose}
            >
              Otkaži
            </button>
            <button
              type="submit"
              className={styles.btnCheckin}
              style={{ width: 'auto', padding: '0.65rem 1.5rem', backgroundColor: '#16a34a' }}
              disabled={isSaving}
            >
              {isSaving ? 'Čuvanje...' : 'Sačuvaj Izmene'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default React.memo(EditAssignmentModal);
