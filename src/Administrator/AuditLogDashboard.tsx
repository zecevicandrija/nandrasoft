import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  History,
  Search,
  RotateCw,
  Loader2,
  FileEdit,
  Trash2,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { CustomSelect, type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import { TablePagination } from '../components/TablePagination/TablePagination';
import styles from './AuditLog.module.css';

const API = 'http://localhost:5000/api';

const ACTION_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Sve akcije' },
  { value: 'IZMENA', label: 'Samo Izmene (UPDATE)' },
  { value: 'STORNO', label: 'Samo Storniranja (STORNO)' },
  { value: 'BRISANJE', label: 'Samo Brisanja (DELETE)' },
];

const AuditLogDashboard: React.FC = () => {

  // Filteri
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Paginacija
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Reset na stranu 1 pri promeni filtera
  useEffect(() => {
    setPage(1);
  }, [search, action, dateFrom, dateTo]);

  // Upit za povlačenje audit logova
  const { data: logsData, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['audit-logs', page, pageSize, search, action, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(pageSize));
      if (search) params.append('search', search);
      if (action) params.append('action', action);
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);

      const res = await fetch(`${API}/audit-logs?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Greška pri dohvatanju revizorskog traga.');
      }
      return res.json();
    },
  });

  const logsList = logsData?.logs || [];
  const totalLogs = logsData?.total || 0;
  const totalPages = logsData?.totalPages || 1;

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return `${d.toLocaleDateString('sr-RS')} ${d.toLocaleTimeString('sr-RS', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })}`;
  };

  return (
    <AppLayout pageTitle="Revizija i Logovi">
      <div className={styles.container}>
        {/* Header Bar */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <History size={26} color="#d97706" />
              Dnevnik Revizije i Log Izmena
            </h2>
            <div className={styles.subtitle}>
              Sveobuhvatna evidencija svih izmena podataka, storniranja i aktivnosti korisnika u sistemu
            </div>
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
            </div>

            <div style={{ minWidth: 230, flex: '1 1 230px' }}>
              <CustomSelect
                value={action}
                onChange={setAction}
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
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <span>Do:</span>
              <input
                type="date"
                className={styles.dateInput}
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            {(search || action || dateFrom || dateTo) && (
              <button
                className={styles.btnSecondary}
                onClick={() => {
                  setSearch('');
                  setAction('');
                  setDateFrom('');
                  setDateTo('');
                }}
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

          <div className={styles.tableWrapper}>
            {isLoading ? (
              <div className={styles.emptyState}>
                <Loader2 size={32} className="spin" />
                <div className={styles.emptyStateTitle}>Učitavanje revizorskog traga...</div>
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
                  {logsList.map((log: any) => (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <strong>{formatDate(log.createdAt)}</strong>
                      </td>
                      <td>
                        <div>
                          <strong>{log.userName}</strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {log.user?.email}
                          </div>
                          <span
                            className={`${styles.roleBadge} ${
                              styles[`role${log.userRole}`] || ''
                            }`}
                          >
                            {log.userRole}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span className={styles.entityBadge}>
                          {log.entityType === 'FieldWork'
                            ? 'Rad na njivi'
                            : log.entityType}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`${styles.actionBadge} ${
                            styles[`action${log.action}`] || ''
                          }`}
                        >
                          {log.action === 'IZMENA' ? (
                            <FileEdit size={12} />
                          ) : (
                            <Trash2 size={12} />
                          )}
                          <span>{log.action}</span>
                        </span>
                      </td>
                      <td>
                        <div className={styles.diffBox}>
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                            {log.description}
                          </span>
                        </div>
                      </td>
                    </tr>
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
