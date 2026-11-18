import React from 'react';
import { CheckCircle2, Clock, FileText, Fuel, Loader2, Plus, Tractor, User } from 'lucide-react';
import MachineUsageAction from '../components/MachineUsageAction';
import TablePagination from '../components/TablePagination/TablePagination';
import { formatSrDate, formatSrTime } from './assignmentHelpers';
import styles from './MasineZaduzenje.module.css';

interface ActiveAssignmentCardProps {
  assignment: any;
  onOpenCheckin: (assignment: any) => void;
  onOpenUsage: (assignmentId: string) => void;
}

const ActiveAssignmentCard = React.memo<ActiveAssignmentCardProps>(({
  assignment: a,
  onOpenCheckin,
  onOpenUsage,
}) => {
  const assignedTime = formatSrTime(a.assignedAt);
  const assignedDate = formatSrDate(a.assignedAt);

  return (
    <div className={styles.checkoutCard}>
      <div className={styles.checkoutHeader}>
        <div>
          <div className={styles.machineName}>
            <Tractor size={18} color="#d97706" />
            <span>{a.machine?.name}</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {a.machine?.brandModel}
          </span>
        </div>
        {a.machine?.regNumber && (
          <span className={styles.regBadge}>{a.machine.regNumber}</span>
        )}
      </div>

      <div className={styles.checkoutDetails}>
        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>
            <User size={14} /> Radnik:
          </span>
          <span className={styles.detailValue}>{a.worker?.name}</span>
        </div>

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>
            <Clock size={14} /> Zaduženo:
          </span>
          <span className={styles.detailValue}>
            {assignedDate} u {assignedTime}
          </span>
        </div>

        <div className={styles.detailRow}>
          <span className={styles.detailLabel}>
            <Tractor size={14} /> Početni sati:
          </span>
          <span className={`${styles.detailValue} ${styles.hoursBadge}`}>
            {a.startHours} rh
          </span>
        </div>

        {a.startFuelLiters !== null && a.startFuelLiters !== undefined ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>
              <Fuel size={14} /> Gorivo na polasku:
            </span>
            <span className={`${styles.detailValue} ${styles.fuelBadge}`}>
              {a.startFuelLiters} L
            </span>
          </div>
        ) : a.startFuelLevel !== null && a.startFuelLevel !== undefined ? (
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>
              <Fuel size={14} /> Gorivo na polasku:
            </span>
            <span className={`${styles.detailValue} ${styles.fuelBadge}`}>
              {a.startFuelLevel}%
            </span>
          </div>
        ) : null}

        {a.assignNotes && (
          <div className={styles.detailRow} style={{ marginTop: '0.2rem' }}>
            <span className={styles.detailLabel}>
              <FileText size={14} /> Napomena:
            </span>
            <span className={styles.notesValue}>{a.assignNotes}</span>
          </div>
        )}
      </div>

      <MachineUsageAction compact onClick={() => onOpenUsage(a.id)} />
      <button
        type="button"
        className={styles.btnCheckin}
        onClick={() => onOpenCheckin(a)}
        title="Razduži mašinu i upiši radne sate"
      >
        <CheckCircle2 size={16} />
        <span>Razduži Mašinu (Kraj Smene)</span>
      </button>
    </div>
  );
});

interface ActiveAssignmentsSectionProps {
  loading: boolean;
  assignments: any[];
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onGoToCheckout: () => void;
  onOpenCheckin: (assignment: any) => void;
  onOpenUsage: (assignmentId: string) => void;
}

const ActiveAssignmentsSection: React.FC<ActiveAssignmentsSectionProps> = ({
  loading,
  assignments,
  total,
  page,
  totalPages,
  onPageChange,
  onGoToCheckout,
  onOpenCheckin,
  onOpenUsage,
}) => {
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <Loader2 size={32} className="spin" />
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '3.5rem',
          backgroundColor: 'var(--bg-card)',
          borderRadius: 16,
          border: '1px solid var(--border-color)',
        }}
      >
        <Tractor size={42} color="var(--text-muted)" style={{ margin: '0 auto 0.75rem' }} />
        <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Nema aktivno zaduženih mašina</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '0.4rem' }}>
          Sve mašine su trenutno parkirane u dvorištu firme. Kliknite na "Novo Zaduženje" da preuzmete traktor.
        </p>
        <button
          type="button"
          onClick={onGoToCheckout}
          className={styles.btnCheckoutSubmit}
          style={{ maxWidth: 220, margin: '1rem auto 0' }}
        >
          <Plus size={16} />
          <span>Zaduži Mašinu</span>
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.activeGrid}>
        {assignments.map((a) => (
          <ActiveAssignmentCard
            key={a.id}
            assignment={a}
            onOpenCheckin={onOpenCheckin}
            onOpenUsage={onOpenUsage}
          />
        ))}
      </div>

      {total > 0 && (
        <div style={{ marginTop: '1.25rem' }}>
          <TablePagination
            currentPage={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            totalItems={total}
            pageSize={25}
          />
        </div>
      )}
    </div>
  );
};

export default React.memo(ActiveAssignmentsSection);
