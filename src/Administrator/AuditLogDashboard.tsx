import React, { useState, useEffect, useCallback } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  History,
  Search,
  RotateCw,
  Loader2,
  FileEdit,
  Trash2,
  PlusCircle,
  Ban,
  Eye,
  ArrowUpRight,
  X,
  AlertCircle,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { CustomSelect, type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import { TablePagination } from '../components/TablePagination/TablePagination';
import styles from './AuditLog.module.css';
import AuditDetails from './AuditDetails';

const API = '/api';

const DATE_FORMATTER = new Intl.DateTimeFormat('sr-RS');
const TIME_FORMATTER = new Intl.DateTimeFormat('sr-RS', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatAuditDate(isoString: string): string {
  const d = new Date(isoString);
  return `${DATE_FORMATTER.format(d)} ${TIME_FORMATTER.format(d)}`;
}

interface AuditLogItem {
  id: string;
  entityType: string;
  action: string;
  userName: string;
  userRole: string;
  description: string;
  createdAt: string;
  user?: { email?: string } | null;
}

function renderActionIcon(action: string) {
  if (action === 'KREIRANJE') return <PlusCircle size={12} aria-hidden="true" />;
  if (action === 'IZMENA' || action === 'KOREKCIJA') return <FileEdit size={12} aria-hidden="true" />;
  if (action === 'DEAKTIVACIJA') return <Ban size={12} aria-hidden="true" />;
  return <Trash2 size={12} aria-hidden="true" />;
}

const AuditLogRow = React.memo(function AuditLogRow({
  log,
  onOpenDetails,
}: {
  log: AuditLogItem;
  onOpenDetails: (id: string) => void;
}) {
  return (
    <tr>
      <td style={{ whiteSpace: 'nowrap' }}>
        <strong>{formatAuditDate(log.createdAt)}</strong>
      </td>
      <td>
        <div>
          <strong>{log.userName}</strong>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {log.user?.email}
          </div>
          <span className={`${styles.roleBadge} ${styles[`role${log.userRole}`] || ''}`}>
            {log.userRole}
          </span>
        </div>
      </td>
      <td>
        <span className={styles.entityBadge}>
          {log.entityType === 'FieldWork' ? 'Rad na njivi' : log.entityType}
        </span>
      </td>
      <td>
        <span className={`${styles.actionBadge} ${styles[`action${log.action}`] || ''}`}>
          {renderActionIcon(log.action)}
          <span>{log.action}</span>
        </span>
      </td>
      <td>
        <div className={styles.diffBox}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {log.description}
          </span>
          <button
            type="button"
            onClick={() => onOpenDetails(log.id)}
            className={styles.detailsButton}
            aria-haspopup="dialog"
          >
            <Eye size={15} aria-hidden="true" />
            Prikaži detalje
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
});

const ACTION_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Sve akcije' },
  { value: 'KREIRANJE', label: 'Samo kreiranja' },
  { value: 'DEAKTIVACIJA', label: 'Samo deaktivacije' },
  { value: 'IZMENA', label: 'Samo Izmene (UPDATE)' },
  { value: 'KOREKCIJA', label: 'Samo korekcije' },
  { value: 'STORNO', label: 'Samo Storniranja (STORNO)' },
  { value: 'BRISANJE', label: 'Samo Brisanja (DELETE)' },
];

const AuditLogDashboard: React.FC = () => {
  const [detailId, setDetailId] = useState<string | null>(null);
  const { data: storage, isError: storageUnavailable } = useQuery({
    queryKey: ['database-storage-usage'],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    queryFn: async ({ signal }) => {
      const res = await fetch(`${API}/audit-logs/storage`, { credentials: 'include', signal });
      if (!res.ok) throw new Error('Provera zauzeća nije dostupna.');
      return res.json();
    },
  });

  // Filteri
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Paginacija
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Debounce pretrage + reset na stranu 1 u istom ciklusu (bez duplog upita)
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === debouncedSearch) return;
    const timer = setTimeout(() => {
      setDebouncedSearch(trimmed);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  const handleActionChange = (nextAction: string) => {
    setAction(nextAction);
    setPage(1);
  };

  const handleDateFromChange = (nextDateFrom: string) => {
    setDateFrom(nextDateFrom);
    setPage(1);
  };

  const handleDateToChange = (nextDateTo: string) => {
    setDateTo(nextDateTo);
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setAction('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const handleOpenDetails = useCallback((id: string) => {
    setDetailId(id);
  }, []);

  const handleCloseDetails = useCallback(() => {
    setDetailId(null);
  }, []);

  const handleClearSearch = () => {
    setSearch('');
    if (debouncedSearch !== '') {
      setDebouncedSearch('');
      setPage(1);
    }
  };

  // Upit za povlačenje audit logova
  const { data: logsData, isLoading, isFetching, isPlaceholderData, isError, error, refetch } = useQuery({
    queryKey: ['audit-logs', page, pageSize, debouncedSearch, action, dateFrom, dateTo],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(pageSize));
      if (debouncedSearch) params.append('search', debouncedSearch);
      if (action) params.append('action', action);
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);

      const res = await fetch(`${API}/audit-logs?${params.toString()}`, {
        credentials: 'include',
        signal,
      });
      if (!res.ok) {
        throw new Error('Greška pri dohvatanju revizorskog traga.');
      }
      return res.json();
    },
  });

  const logsList: AuditLogItem[] = logsData?.logs || [];
  const totalLogs = logsData?.total || 0;
  const totalPages = logsData?.totalPages || 1;

  return (
    <AppLayout pageTitle="Revizija i Logovi">
      <div className={styles.container}>
        {storageUnavailable && <p role="status">Provera zauzeća baze trenutno nije dostupna.</p>}
        {storage && storage.level !== 'ok' && <div role="alert" style={{ padding: 16, border: '2px solid #d97706', borderRadius: 8, marginBottom: 16 }}>
          <strong>{storage.level === 'critical' ? 'Kritično zauzeće baze' : 'Baza se približava ograničenju prostora'}</strong>
          <p>Popunjeno je {storage.usedPercent}% podešene kvote ({(storage.databaseBytes / 1e9).toFixed(2)} GB od {(storage.quotaBytes / 1e9).toFixed(2)} GB). Potrebno je proveriti rast i raspoloživ prostor kod provajdera.</p>
        </div>}
        {detailId && <AuditDetails id={detailId} onClose={handleCloseDetails} />}
        {/* Header Bar */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <History size={26} color="#d97706" />
              Dnevnik Revizije i Log Izmena
            </h2>
          </div>

          <div className={styles.actionBtns}>
            <button
              onClick={() => refetch()}
              className={styles.btnSecondary}
              title="Osveži zapise"
              disabled={isFetching}
            >
              <RotateCw size={16} className={isFetching ? 'spin' : ''} />
              <span>{isFetching ? 'Osvežavanje...' : 'Osveži'}</span>
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className={styles.filterBar}>
          <div className={styles.filterControlsRow}>
            <div className={styles.searchBox}>
              <Search size={16} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Pretraži po korisniku ili opisu izmene..."
                className={styles.searchInput}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className={styles.clearSearchBtn}
                  onClick={handleClearSearch}
                  aria-label="Obriši pretragu"
                  title="Obriši pretragu"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              )}
            </div>

            <div style={{ minWidth: 230, flex: '1 1 230px' }}>
              <CustomSelect
                value={action}
                onChange={handleActionChange}
                options={ACTION_OPTIONS}
                searchable={false}
                placeholder="Sve akcije"
              />
            </div>

            <div className={styles.dateRangeInputs}>
              <span>Od:</span>
              <input
                type="date"
                className={styles.dateInput}
                value={dateFrom}
                onChange={(e) => handleDateFromChange(e.target.value)}
              />
              <span>Do:</span>
              <input
                type="date"
                className={styles.dateInput}
                value={dateTo}
                onChange={(e) => handleDateToChange(e.target.value)}
              />
            </div>

            {(search || action || dateFrom || dateTo) && (
              <button
                className={styles.btnSecondary}
                onClick={handleResetFilters}
                style={{ justifySelf: 'start' }}
              >
                Poništi filtere
              </button>
            )}
          </div>
        </div>

        {/* Tabela Logova */}
        <div className={styles.tableCard}>
          <div className={styles.tableHeaderBar}>
            <span className={styles.tableTitle}>Zabeležene Aktivnosti</span>
            <span className={styles.tableCountBadge}>
              Ukupno aktivnosti: {totalLogs} | Strana {page} od {totalPages}
            </span>
          </div>

          <div
            className={`${styles.tableWrapper} ${isPlaceholderData ? styles.tableRefreshing : ''}`}
            aria-busy={isFetching}
          >
            {isLoading ? (
              <div className={styles.emptyState}>
                <Loader2 size={32} className="spin" />
                <div className={styles.emptyStateTitle}>Učitavanje revizorskog traga...</div>
              </div>
            ) : isError ? (
              <div className={styles.emptyState} role="alert">
                <AlertCircle size={40} color="#dc2626" />
                <div className={styles.emptyStateTitle}>Greška pri učitavanju</div>
                <div className={styles.emptyStateDesc}>
                  {error instanceof Error ? error.message : 'Revizorski trag trenutno nije dostupan.'}
                </div>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className={styles.btnSecondary}
                  style={{ marginTop: '1rem' }}
                >
                  <RotateCw size={15} />
                  Pokušaj ponovo
                </button>
              </div>
            ) : logsList.length === 0 ? (
              <div className={styles.emptyState}>
                <History size={40} color="var(--text-muted)" />
                <div className={styles.emptyStateTitle}>Nema zabeleženih aktivnosti</div>
                <div className={styles.emptyStateDesc}>
                  Nijedna izmena podataka ne odgovara izabranim kriterijumima pretrage.
                </div>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Vreme Izmene</th>
                    <th>Korisnik & Uloga</th>
                    <th>Modul / Entitet</th>
                    <th>Tip Akcije</th>
                    <th>Opis i Detalji Izmene</th>
                  </tr>
                </thead>
                <tbody>
                  {logsList.map((log) => (
                    <AuditLogRow key={log.id} log={log} onOpenDetails={handleOpenDetails} />
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Serverska Paginacija */}
          <TablePagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalLogs}
            pageSize={pageSize}
            onPageChange={setPage}
            itemName="aktivnosti"
          />
        </div>
      </div>
    </AppLayout>
  );
};

export default AuditLogDashboard;
