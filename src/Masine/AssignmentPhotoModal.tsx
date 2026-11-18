import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  FileText,
  Fuel,
  MapPin,
  Tractor,
  User,
  X,
} from 'lucide-react';
import {
  formatSrDateTime,
  getAssignmentHoursDiff,
  getAssignmentStatusMeta,
  isValidPhotoUrl,
} from './assignmentHelpers';
import styles from './MasineZaduzenje.module.css';

interface AssignmentPhotoModalProps {
  assignment: any;
  onClose: () => void;
}

const AssignmentPhotoModal: React.FC<AssignmentPhotoModalProps> = ({ assignment, onClose }) => {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [assignment?.id, assignment?.photoUrl]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const photoUrl = isValidPhotoUrl(assignment?.photoUrl) ? assignment.photoUrl : null;
  const statusMeta = getAssignmentStatusMeta(assignment);
  const badgeClass =
    statusMeta.badgeType === 'active'
      ? styles.statusBadgeActive
      : statusMeta.badgeType === 'returned'
        ? styles.statusBadgeReturned
        : styles.statusBadgeBroken;

  const hasStartHours = assignment.startHours !== null && assignment.startHours !== undefined && assignment.startHours !== '';
  const hasEndHours = assignment.endHours !== null && assignment.endHours !== undefined && assignment.endHours !== '';
  const hoursDiff = getAssignmentHoursDiff(assignment);

  const hasStartLiters = assignment.startFuelLiters !== null && assignment.startFuelLiters !== undefined;
  const hasEndLiters = assignment.endFuelLiters !== null && assignment.endFuelLiters !== undefined;
  const fuelUsed =
    hasStartLiters && hasEndLiters && Number(assignment.startFuelLiters) >= Number(assignment.endFuelLiters)
      ? Math.round((Number(assignment.startFuelLiters) - Number(assignment.endFuelLiters)) * 10) / 10
      : null;

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="assignment-photo-title">
      <div className={`${styles.modalBox} ${styles.photoModalBox}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div>
            <h3 id="assignment-photo-title" className={styles.modalTitle}>
              Fotografija i detalji zaduženja
            </h3>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              {assignment.machine?.name}
              {assignment.machine?.brandModel ? ` • ${assignment.machine.brandModel}` : ''}
              {assignment.machine?.regNumber ? ` (${assignment.machine.regNumber})` : ''}
            </div>
          </div>
          <button type="button" className={styles.modalCloseBtn} onClick={onClose} aria-label="Zatvori pregled">
            <X size={20} />
          </button>
        </div>

        <div className={styles.modalBody}>
          {photoUrl && (
            <div className={styles.photoPreviewFrame}>
              {imageError ? (
                <div className={styles.photoErrorBox} role="alert">
                  <AlertCircle size={20} />
                  <span>Fotografija nije mogla biti učitana.</span>
                </div>
              ) : (
                <img
                  src={photoUrl}
                  alt={`Fotografija za zaduženje mašine ${assignment.machine?.name || ''}`}
                  className={styles.photoPreviewImg}
                  onError={() => setImageError(true)}
                />
              )}
              <a
                href={photoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.photoExternalLink}
              >
                <ExternalLink size={14} />
                <span>Otvori originalnu fotografiju</span>
              </a>
            </div>
          )}

          <div className={styles.photoDetailGrid}>
            <div className={styles.photoDetailItem}>
              <span className={styles.photoDetailLabel}>
                <Tractor size={13} /> Mašina
              </span>
              <span className={styles.photoDetailValue}>{assignment.machine?.name || '—'}</span>
            </div>

            <div className={styles.photoDetailItem}>
              <span className={styles.photoDetailLabel}>
                <User size={13} /> Radnik
              </span>
              <span className={styles.photoDetailValue}>{assignment.worker?.name || '—'}</span>
            </div>

            <div className={styles.photoDetailItem}>
              <span className={styles.photoDetailLabel}>Status</span>
              <div>
                <span className={`${styles.statusBadge} ${badgeClass}`}>{statusMeta.label}</span>
              </div>
            </div>

            <div className={styles.photoDetailItem}>
              <span className={styles.photoDetailLabel}>
                <Clock size={13} /> Zaduženo
              </span>
              <span className={styles.photoDetailValue}>{formatSrDateTime(assignment.assignedAt)}</span>
            </div>

            <div className={styles.photoDetailItem}>
              <span className={styles.photoDetailLabel}>
                <Clock size={13} /> Razduženo
              </span>
              <span className={styles.photoDetailValue}>
                {assignment.returnedAt ? formatSrDateTime(assignment.returnedAt) : 'Još uvek u toku'}
              </span>
            </div>

            <div className={styles.photoDetailItem}>
              <span className={styles.photoDetailLabel}>Radni sati</span>
              <span className={styles.photoDetailValue}>
                {hasStartHours ? `${assignment.startHours} rh` : '—'}
                {hasEndHours ? ` → ${assignment.endHours} rh` : ''}
                {hoursDiff !== null && (
                  <span className={styles.hoursDiffBadge}>(+{hoursDiff} rh)</span>
                )}
              </span>
            </div>

            <div className={styles.photoDetailItem}>
              <span className={styles.photoDetailLabel}>
                <Fuel size={13} /> Stanje goriva
              </span>
              <span className={styles.photoDetailValue}>
                {hasStartLiters ? (
                  <>
                    {assignment.startFuelLiters} L{hasEndLiters ? ` → ${assignment.endFuelLiters} L` : ''}
                    {fuelUsed !== null && <span className={styles.fuelDiffBadge}>(-{fuelUsed} L)</span>}
                  </>
                ) : hasEndLiters ? (
                  `${assignment.endFuelLiters} L`
                ) : assignment.startFuelLevel !== null && assignment.startFuelLevel !== undefined ? (
                  `${assignment.startFuelLevel}%${assignment.endFuelLevel !== null && assignment.endFuelLevel !== undefined ? ` → ${assignment.endFuelLevel}%` : ''}`
                ) : (
                  '—'
                )}
              </span>
            </div>

            {assignment.parcel?.name && (
              <div className={styles.photoDetailItem}>
                <span className={styles.photoDetailLabel}>
                  <MapPin size={13} /> Parcela
                </span>
                <span className={styles.photoDetailValue}>
                  {assignment.parcel.code ? `[${assignment.parcel.code}] ` : ''}
                  {assignment.parcel.name}
                </span>
              </div>
            )}

            {assignment.createdBy?.name && (
              <div className={styles.photoDetailItem}>
                <span className={styles.photoDetailLabel}>Evidentirao</span>
                <span className={styles.photoDetailValue}>{assignment.createdBy.name}</span>
              </div>
            )}
          </div>

          {assignment.assignNotes && (
            <div className={styles.photoNotesCard}>
              <div className={styles.photoDetailLabel}>
                <FileText size={13} /> Napomena pri preuzimanju
              </div>
              <p>{assignment.assignNotes}</p>
            </div>
          )}

          {assignment.returnNotes && (
            <div className={styles.photoNotesCard}>
              <div className={styles.photoDetailLabel}>
                <FileText size={13} /> {assignment.isOperational === false ? 'Opis kvara / problema' : 'Napomena pri povratku'}
              </div>
              <p>{assignment.returnNotes}</p>
            </div>
          )}

          {assignment.voidedAt && assignment.correctionReason && (
            <div className={styles.photoNotesCard}>
              <div className={styles.photoDetailLabel}>
                <AlertCircle size={13} /> Razlog poništenja
              </div>
              <p>{assignment.correctionReason}</p>
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button type="button" className={styles.btnSecondary} onClick={onClose}>
            Zatvori
          </button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(AssignmentPhotoModal);
