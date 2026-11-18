import React from 'react';
import {
  Clock,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Tractor,
  User,
} from 'lucide-react';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { sameBelgradeDay } from '../lib/workDay';
import {
  formatSrDate,
  formatSrTime,
  getAssignmentHoursDiff,
  getAssignmentStatusMeta,
  isValidPhotoUrl,
  useIsMobile,
} from './assignmentHelpers';
import styles from './MasineZaduzenje.module.css';

export type HistoryPeriodType = 'danas' | 'nedelja' | 'mesec' | 'sve' | 'custom';

function renderFuelSummary(a: any, diffBadgeClass?: string) {
  if (a.startFuelLiters !== null && a.startFuelLiters !== undefined) {
    const hasEnd = a.endFuelLiters !== null && a.endFuelLiters !== undefined;
    const consumed =
      hasEnd && Number(a.startFuelLiters) >= Number(a.endFuelLiters)
        ? Math.round((Number(a.startFuelLiters) - Number(a.endFuelLiters)) * 10) / 10
        : null;

    return (
      <span>
        {a.startFuelLiters} L {hasEnd ? `→ ${a.endFuelLiters} L` : ''}
        {consumed !== null && (
          <span
            className={diffBadgeClass}
            style={diffBadgeClass ? undefined : { fontSize: '0.75rem', color: '#16a34a', marginLeft: '5px', fontWeight: 600 }}
          >
            (-{consumed} L)
          </span>
        )}
      </span>
    );
  }
  if (a.endFuelLiters !== null && a.endFuelLiters !== undefined) {
    return <span>{a.endFuelLiters} L</span>;
  }
  if (a.startFuelLevel !== null && a.startFuelLevel !== undefined) {
    return (
      <span>
        {a.startFuelLevel}% {a.endFuelLevel !== null && a.endFuelLevel !== undefined ? `→ ${a.endFuelLevel}%` : ''}
      </span>
    );
  }
  return '-';
}

function getStatusBadgeClass(badgeType: 'active' | 'returned' | 'broken') {
  if (badgeType === 'active') return styles.statusBadgeActive;
  if (badgeType === 'returned') return styles.statusBadgeReturned;
  return styles.statusBadgeBroken;
}

interface HistoryRowProps {
  assignment: any;
  isManager: boolean;
  isOperator: boolean;
  onEdit: (assignment: any) => void;
  onShowPhoto: (assignment: any) => void;
}

const HistoryTableRow = React.memo<HistoryRowProps>(({
  assignment: a,
  isManager,
  isOperator,
  onEdit,
  onShowPhoto,
}) => {
  const dateStr = formatSrDate(a.assignedAt);
  const timeStr = formatSrTime(a.assignedAt);
  const hasStartHours = a.startHours !== null && a.startHours !== undefined && a.startHours !== '';
  const hasEndHours = a.endHours !== null && a.endHours !== undefined && a.endHours !== '';
  const hoursDiff = getAssignmentHoursDiff(a);
  const statusMeta = getAssignmentStatusMeta(a);
  const hasPhoto = isValidPhotoUrl(a.photoUrl);
  const canEdit = isManager || (isOperator && sameBelgradeDay(a.assignedAt));

  return (
    <tr>
      <td>
        <strong>{dateStr}</strong>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{timeStr}</div>
      </td>
      <td>
        <strong>{a.machine?.name}</strong>
      </td>
      <td>{a.worker?.name}</td>
      <td>{hasStartHours ? `${a.startHours} rh` : '-'}</td>
      <td>{hasEndHours ? `${a.endHours} rh` : '-'}</td>
      <td>
        {hoursDiff !== null ? (
          <strong style={{ color: '#2563eb' }}>+{hoursDiff} rh</strong>
        ) : a.status === 'ZADUZENA' ? (
          <span style={{ color: '#d97706' }}>U toku</span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>-</span>
        )}
      </td>
      <td>{renderFuelSummary(a)}</td>
      <td>
        <span className={`${styles.statusBadge} ${getStatusBadgeClass(statusMeta.badgeType)}`}>
          {statusMeta.label}
        </span>
      </td>
      <td style={{ maxWidth: 240, color: 'var(--text-secondary)' }}>
        <div>{a.returnNotes || a.assignNotes || '-'}</div>
        {hasPhoto && (
          <button
            type="button"
            className={styles.photoPreviewBtn}
            onClick={() => onShowPhoto(a)}
          >
            <ImageIcon size={14} />
            <span>Prikaži fotografiju</span>
          </button>
        )}
      </td>
      <td style={{ textAlign: 'right' }}>
        <div className={styles.rowActions} style={{ justifyContent: 'flex-end' }}>
          {canEdit ? (
            <button
              type="button"
              className={styles.btnIcon}
              title="Izmeni unos zaduženja"
              onClick={() => onEdit(a)}
            >
              <Pencil size={14} />
            </button>
          ) : isOperator ? (
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-muted)',
                fontStyle: 'italic',
              }}
              title="Istekao rok za izmenu (dozvoljeno samo na dan zaduženja)"
            >
              Zaključano
            </span>
          ) : null}
        </div>
      </td>
    </tr>
  );
});

const HistoryMobileCard = React.memo<HistoryRowProps>(({
  assignment: a,
  isManager,
  isOperator,
  onEdit,
  onShowPhoto,
}) => {
  const dateStr = formatSrDate(a.assignedAt);
  const timeStr = formatSrTime(a.assignedAt);
  const hasStartHours = a.startHours !== null && a.startHours !== undefined && a.startHours !== '';
  const hasEndHours = a.endHours !== null && a.endHours !== undefined && a.endHours !== '';
  const hoursDiff = getAssignmentHoursDiff(a);
  const statusMeta = getAssignmentStatusMeta(a);
  const hasPhoto = isValidPhotoUrl(a.photoUrl);
  const canEdit = isManager || (isOperator && sameBelgradeDay(a.assignedAt));

  return (
    <div className={styles.historyCard}>
      <div className={styles.historyCardHeader}>
        <div>
          <div className={styles.historyCardTitle}>
            <Tractor size={18} color="#d97706" />
            <span>{a.machine?.name}</span>
          </div>
          <div className={styles.historyCardSub}>
            <User size={12} /> {a.worker?.name} &bull; <Clock size={12} /> {dateStr} u {timeStr}
          </div>
        </div>
        <span className={`${styles.statusBadge} ${getStatusBadgeClass(statusMeta.badgeType)}`}>
          {statusMeta.label}
        </span>
      </div>

      <div className={styles.historyCardStats}>
        <div className={styles.historyStatBox}>
          <span className={styles.historyStatLabel}>Radni sati</span>
          <div className={styles.historyStatValue}>
            {hasStartHours ? `${a.startHours} rh` : '-'}
            {hasEndHours ? ` → ${a.endHours} rh` : ''}
            {hoursDiff !== null && <span className={styles.hoursDiffBadge}>+{hoursDiff} rh</span>}
          </div>
        </div>

        <div className={styles.historyStatBox}>
          <span className={styles.historyStatLabel}>Gorivo</span>
          <div className={styles.historyStatValue}>{renderFuelSummary(a, styles.fuelDiffBadge)}</div>
        </div>
      </div>

      {(a.returnNotes || a.assignNotes) && (
        <div className={styles.historyCardNotes}>
          <FileText size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>{a.returnNotes || a.assignNotes}</span>
        </div>
      )}

      {(hasPhoto || canEdit) && (
        <div className={styles.historyCardFooter} style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          {hasPhoto && (
            <button
              type="button"
              className={styles.photoPreviewBtn}
              style={{ flex: 1, justifyContent: 'center', minHeight: 38 }}
              onClick={() => onShowPhoto(a)}
            >
              <ImageIcon size={14} />
              <span>Prikaži fotografiju</span>
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className={styles.btnEditMobile}
              style={{ flex: 1 }}
              onClick={() => onEdit(a)}
            >
              <Pencil size={14} />
              <span>Izmeni unos zaduženja</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

interface AssignmentHistorySectionProps {
  loading: boolean;
  historyList: any[];
  historyTotal: number;
  historyPage: number;
  historyTotalPages: number;
  historyPeriod: HistoryPeriodType;
  historyDateFrom: string;
  historyDateTo: string;
  historyMachineId: string;
  historyWorkerId: string;
  historyStatus: string;
  historySearch: string;
  isManager: boolean;
  isOperator: boolean;
  machineOptions: CustomSelectOption[];
  workerOptions: CustomSelectOption[];
  statusOptions: CustomSelectOption[];
  onPeriodChange: (period: HistoryPeriodType) => void;
  onDateFromChange: (val: string) => void;
  onDateToChange: (val: string) => void;
  onMachineChange: (val: string) => void;
  onWorkerChange: (val: string) => void;
  onStatusChange: (val: string) => void;
  onSearchChange: (val: string) => void;
  onResetFilters: () => void;
  onPageChange: (page: number) => void;
  onOpenEdit: (assignment: any) => void;
  onShowPhoto: (assignment: any) => void;
}

const AssignmentHistorySection: React.FC<AssignmentHistorySectionProps> = ({
  loading,
  historyList,
  historyTotal,
  historyPage,
  historyTotalPages,
  historyPeriod,
  historyDateFrom,
  historyDateTo,
  historyMachineId,
  historyWorkerId,
  historyStatus,
  historySearch,
  isManager,
  isOperator,
  machineOptions,
  workerOptions,
  statusOptions,
  onPeriodChange,
  onDateFromChange,
  onDateToChange,
  onMachineChange,
  onWorkerChange,
  onStatusChange,
  onSearchChange,
  onResetFilters,
  onPageChange,
  onOpenEdit,
  onShowPhoto,
}) => {
  const isMobile = useIsMobile('(max-width: 768px)');

  return (
    <div>
      <div className={styles.historyFilterCard}>
        <div className={styles.periodButtonsRow}>
          <button
            type="button"
            className={`${styles.periodBtn} ${historyPeriod === 'danas' ? styles.periodBtnActive : ''}`}
            onClick={() => onPeriodChange('danas')}
          >
            Danas
          </button>
          <button
            type="button"
            className={`${styles.periodBtn} ${historyPeriod === 'nedelja' ? styles.periodBtnActive : ''}`}
            onClick={() => onPeriodChange('nedelja')}
          >
            Ova Nedelja
          </button>
          <button
            type="button"
            className={`${styles.periodBtn} ${historyPeriod === 'mesec' ? styles.periodBtnActive : ''}`}
            onClick={() => onPeriodChange('mesec')}
          >
            Ovaj Mesec
          </button>
          <button
            type="button"
            className={`${styles.periodBtn} ${historyPeriod === 'sve' ? styles.periodBtnActive : ''}`}
            onClick={() => onPeriodChange('sve')}
          >
            Svi Unosi
          </button>
          <button
            type="button"
            className={`${styles.periodBtn} ${historyPeriod === 'custom' ? styles.periodBtnActive : ''}`}
            onClick={() => onPeriodChange('custom')}
          >
            Prilagođen Raspon
          </button>
        </div>

        {historyPeriod === 'custom' && (
          <div className={styles.customDateRangeBox}>
            <span>Od:</span>
            <input
              type="date"
              className={styles.dateInput}
              value={historyDateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
            />
            <span>Do:</span>
            <input
              type="date"
              className={styles.dateInput}
              value={historyDateTo}
              onChange={(e) => onDateToChange(e.target.value)}
            />
          </div>
        )}

        <div className={styles.filterControlsGrid}>
          <div className={styles.filterControlCol}>
            <span className={styles.filterFieldLabel}>Pretraga</span>
            <div className={styles.searchBox}>
              <Search size={16} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Pretraži mašinu, radnika, napomene..."
                className={styles.searchInput}
                value={historySearch}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.filterControlCol}>
            <span className={styles.filterFieldLabel}>Mašina</span>
            <CustomSelect
              value={historyMachineId}
              onChange={onMachineChange}
              options={machineOptions}
              placeholder="Sve mašine"
              searchable
            />
          </div>

          {!isOperator && (
            <div className={styles.filterControlCol}>
              <span className={styles.filterFieldLabel}>Radnik</span>
              <CustomSelect
                value={historyWorkerId}
                onChange={onWorkerChange}
                options={workerOptions}
                placeholder="Svi radnici"
                searchable
              />
            </div>
          )}

          <div className={styles.filterControlCol}>
            <span className={styles.filterFieldLabel}>Status</span>
            <CustomSelect
              value={historyStatus}
              onChange={onStatusChange}
              options={statusOptions}
              placeholder="Svi statusi"
              searchable={false}
            />
          </div>

          <div className={styles.filterControlCol}>
            <button
              type="button"
              className={styles.btnResetFilters}
              onClick={onResetFilters}
              title="Poništi sve filtere"
            >
              <RotateCcw size={15} />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>

      <div className={styles.tableCard}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <Loader2 size={32} className="spin" />
          </div>
        ) : historyList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            Nema zabeleženih zaduženja u istorijatu.
          </div>
        ) : (
          <>
            {isMobile ? (
              <div className={styles.mobileCardsView}>
                {historyList.map((a) => (
                  <HistoryMobileCard
                    key={a.id}
                    assignment={a}
                    isManager={isManager}
                    isOperator={isOperator}
                    onEdit={onOpenEdit}
                    onShowPhoto={onShowPhoto}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.desktopTableView}>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Datum i Vreme</th>
                        <th>Mašina</th>
                        <th>Radnik</th>
                        <th>Početni rh</th>
                        <th>Krajnji rh</th>
                        <th>Napravljeno rh</th>
                        <th>Stanje Goriva</th>
                        <th>Status</th>
                        <th>Beleške</th>
                        <th style={{ textAlign: 'right' }}>Akcije</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyList.map((a) => (
                        <HistoryTableRow
                          key={a.id}
                          assignment={a}
                          isManager={isManager}
                          isOperator={isOperator}
                          onEdit={onOpenEdit}
                          onShowPhoto={onShowPhoto}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {historyTotal > 0 && (
              <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)' }}>
                <TablePagination
                  currentPage={historyPage}
                  totalPages={historyTotalPages}
                  onPageChange={onPageChange}
                  totalItems={historyTotal}
                  pageSize={25}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default React.memo(AssignmentHistorySection);
