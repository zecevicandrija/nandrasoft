import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  History,
  Search,
  RotateCw,
  Loader2,
  FileEdit,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import styles from './AuditLog.module.css';

const API = 'http://localhost:5000/api';

const AuditLogDashboard: React.FC = () => {

  // Filteri
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Paginacija
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Reset na stranu 1 pri promeni filtera
  useEffect(() => {
    setPage(1);
  }, [search, action, dateFrom, dateTo, pageSize]);

  const getPageNumbers = (current: number, total: number) => {
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [];
    if (current <= 4) {
      pages.push(1, 2, 3, 4, 5, '...', total);
    } else if (current >= total - 3) {
      pages.push(1, '...', total - 4, total - 3, total - 2, total - 1, total);
    } else {
      pages.push(1, '...', current - 1, current, current + 1, '...', total);
    }
    return pages;
  };

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

            <select
              className={styles.selectInput}
              value={action}
              onChange={(e) => setAction(e.target.value)}
            >
              <option value="">Sve akcije</option>
              <option value="IZMENA">Samo Izmene (UPDATE)</option>
              <option value="STORNO">Samo Storniranja (STORNO)</option>
              <option value="BRISANJE">Samo Brisanja (DELETE)</option>
            </select>

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
          {totalLogs > 0 && (
            <div className={styles.paginationBar}>
              <div className={styles.paginationInfo}>
                Prikazano <strong>{(page - 1) * pageSize + 1}</strong> do{' '}
                <strong>{Math.min(page * pageSize, totalLogs)}</strong> od ukupno{' '}
                <strong>{totalLogs}</strong> zabeleženih aktivnosti
              </div>

              <div className={styles.paginationControls}>
                <div className={styles.pageSizeWrapper}>
                  <span>Po strani:</span>
                  <select
                    className={styles.pageSizeSelect}
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>

                <div className={styles.paginationButtons}>
                  <button
                    className={styles.paginationBtn}
                    onClick={() => setPage(1)}
                    disabled={page <= 1}
                    title="Prva strana"
                  >
                    <ChevronsLeft size={16} />
                  </button>
                  <button
                    className={styles.paginationBtn}
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page <= 1}
                    title="Prethodna strana"
                  >
                    <ChevronLeft size={16} />
                    <span>Prethodna</span>
                  </button>

                  <div className={styles.pageNumbers}>
                    {getPageNumbers(page, totalPages).map((pNum, idx) =>
                      pNum === '...' ? (
                        <span key={`dots-${idx}`} className={styles.paginationEllipsis}>
                          ...
                        </span>
                      ) : (
                        <button
                          key={pNum}
                          className={`${styles.paginationPageBtn} ${
                            pNum === page ? styles.paginationPageBtnActive : ''
                          }`}
                          onClick={() => setPage(Number(pNum))}
                        >
                          {pNum}
                        </button>
                      )
                    )}
                  </div>

                  <button
                    className={styles.paginationBtn}
                    onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                    disabled={page >= totalPages}
                    title="Sledeća strana"
                  >
                    <span>Sledeća</span>
                    <ChevronRight size={16} />
                  </button>
                  <button
                    className={styles.paginationBtn}
                    onClick={() => setPage(totalPages)}
                    disabled={page >= totalPages}
                    title="Poslednja strana"
                  >
                    <ChevronsRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default AuditLogDashboard;
