import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Phone,
  Tractor,
  CheckCircle2,
  ShieldAlert,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { useSession } from '../lib/auth-client';
import styles from './Neuskladjenosti.module.css';

const API = 'http://localhost:5000/api';

type PeriodType = 'danas' | 'nedelja' | 'mesec' | 'sve';

const NeuskladjenostiMasina: React.FC = () => {
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(currentUser?.role || '');

  const [searchParams, setSearchParams] = useSearchParams();
  const urlPeriod = searchParams.get('period') as PeriodType | null;

  const [period, setPeriod] = useState<PeriodType>(
    urlPeriod && ['danas', 'nedelja', 'mesec', 'sve'].includes(urlPeriod) ? urlPeriod : 'danas'
  );

  useEffect(() => {
    if (urlPeriod && ['danas', 'nedelja', 'mesec', 'sve'].includes(urlPeriod)) {
      setPeriod(urlPeriod);
    }
  }, [urlPeriod]);

  const handleSelectPeriod = (p: PeriodType) => {
    setPeriod(p);
    setSearchParams({ period: p });
  };

  // Izračunaj datume za odabrani period
  const getDateRange = (p: PeriodType) => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (p === 'danas') {
      return { dateFrom: todayStr, dateTo: todayStr };
    }
    if (p === 'nedelja') {
      const startOfWeek = new Date(now);
      const day = startOfWeek.getDay();
      const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
      startOfWeek.setDate(diff);
      return {
        dateFrom: startOfWeek.toISOString().split('T')[0],
        dateTo: todayStr,
      };
    }
    if (p === 'mesec') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        dateFrom: startOfMonth.toISOString().split('T')[0],
        dateTo: todayStr,
      };
    }
    return { dateFrom: '2024-01-01', dateTo: todayStr };
  };

  const { dateFrom, dateTo } = getDateRange(period);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['unassigned-warnings', period, dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(
        `${API}/field-work/unassigned-warnings?dateFrom=${dateFrom}&dateTo=${dateTo}`,
        {
          credentials: 'include',
        }
      );
      if (!res.ok) {
        throw new Error('Neuspešno dohvatanje podataka o neusklađenostima.');
      }
      return res.json();
    },
    enabled: isManager,
  });

  const unassignedList = data?.items || [];
  const count = data?.count ?? unassignedList.length;

  return (
    <AppLayout pageTitle="Neusklađenosti Zaduženja Mašina">
      <div className={styles.container}>
        {/* Header & Back Action */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <ShieldAlert size={26} color="#d97706" />
              Kontrola Jutarnjeg Zaduženja Mašina
            </h2>
            <div className={styles.subtitle}>
              Evidencija radova gde je mašina korišćena na njivi bez prethodnog zvaničnog zaduženja
            </div>
          </div>
          <Link to="/radovi" className={styles.btnBack}>
            <ArrowLeft size={16} />
            Nazad na Dnevnik Rada
          </Link>
        </div>

        {/* Access check for non-managers */}
        {!isManager && (
          <div className={styles.infoNotice} style={{ borderColor: '#dc2626', backgroundColor: 'rgba(239, 68, 68, 0.08)' }}>
            <AlertTriangle size={20} color="#dc2626" />
            <div>
              <strong style={{ color: '#dc2626' }}>Pristup odbijen:</strong> Samo Direktor i Rukovodilac imaju ovlašćenje da pregledaju operativne neusklađenosti mehanizacije.
            </div>
          </div>
        )}

        {isManager && (
          <>
            {/* Informaciona tabla sa objašnjenjem procedure */}
            <div className={styles.infoNotice}>
              <AlertTriangle size={20} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Zašto se pojavljuju ova upozorenja?</strong>
                <br />
                Kada radnik / operater na njivi unese urađen posao, sistem proverava da li je ta mašina tog jutra prošla kroz formalnu proceduru zaduženja.
                <br />
                Kako poljoprivredni radovi ne bi stali usled zaboravnosti, radnik može uneti posao, ali se ovde beleži izuzetak kako biste mogli <strong>lično da opomenete radnika</strong> ili naknadno evidentirate početno stanje u modulu mašina.
              </div>
            </div>

            {/* Filter po vremenskom periodu */}
            <div className={styles.filterBar}>
              <div className={styles.periodButtons}>
                <button
                  className={`${styles.periodBtn} ${period === 'danas' ? styles.periodBtnActive : ''}`}
                  onClick={() => handleSelectPeriod('danas')}
                >
                  Danas
                </button>
                <button
                  className={`${styles.periodBtn} ${period === 'nedelja' ? styles.periodBtnActive : ''}`}
                  onClick={() => handleSelectPeriod('nedelja')}
                >
                  Ova Nedelja
                </button>
                <button
                  className={`${styles.periodBtn} ${period === 'mesec' ? styles.periodBtnActive : ''}`}
                  onClick={() => handleSelectPeriod('mesec')}
                >
                  Ovaj Mesec
                </button>
                <button
                  className={`${styles.periodBtn} ${period === 'sve' ? styles.periodBtnActive : ''}`}
                  onClick={() => handleSelectPeriod('sve')}
                >
                  Sve Neusklađenosti
                </button>
              </div>

              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Period: <strong>{new Date(dateFrom).toLocaleDateString('sr-RS')}</strong> —{' '}
                <strong>{new Date(dateTo).toLocaleDateString('sr-RS')}</strong>
              </div>
            </div>

            {/* Tabela neusklađenosti */}
            <div className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <div className={styles.tableTitle}>
                  Prijavljeni radovi bez formalnog zaduženja
                </div>
                {count > 0 && (
                  <span className={styles.tableCountBadge}>
                    {count} {count === 1 ? 'upozorenje' : count < 5 ? 'upozorenja' : 'upozorenja'}
                  </span>
                )}
              </div>

              {isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem', gap: '0.75rem', color: 'var(--text-muted)' }}>
                  <Loader2 size={24} className="animate-spin" />
                  <span>Učitavanje podataka...</span>
                </div>
              ) : isError ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#dc2626' }}>
                  Greška pri učitavanju podataka sa servera.
                </div>
              ) : unassignedList.length === 0 ? (
                <div className={styles.emptyState}>
                  <CheckCircle2 size={54} color="#16a34a" />
                  <div className={styles.emptyStateTitle}>Sve mašine su uredno zadužene!</div>
                  <div className={styles.emptyStateDesc}>
                    Nema zabeleženih radova na njivi gde mašina nije imala uredno jutarnje zaduženje u izabranom periodu.
                  </div>
                </div>
              ) : (
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Datum & Vreme</th>
                        <th>Radnik (Operater)</th>
                        <th>Mašina</th>
                        <th>Parcela & Operacija</th>
                        <th>Obim Rada</th>
                        <th>Uneo u sistem</th>
                        <th>Status</th>
                        <th>Akcija</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unassignedList.map((work: any) => {
                        const dateFormatted = new Date(work.date).toLocaleDateString('sr-RS');
                        const phone = work.worker?.phone;

                        return (
                          <tr key={work.id}>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                <strong>{dateFormatted}</strong>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {work.shift === 'PRVA' ? '1. Smena' : work.shift === 'DRUGA' ? '2. Smena' : 'Noćna'}
                                  {work.startTime && work.endTime && ` (${work.startTime} - ${work.endTime})`}
                                </span>
                              </div>
                            </td>
                            <td>
                              <div className={styles.workerCell}>
                                <span className={styles.workerName}>{work.worker?.name || 'Nepoznat radnik'}</span>
                                {phone ? (
                                  <a href={`tel:${phone}`} className={styles.workerPhone} title="Pozovi radnika">
                                    <Phone size={12} />
                                    {phone}
                                  </a>
                                ) : (
                                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Bez telefona</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className={styles.machineCell}>
                                <span className={styles.machineName}>
                                  <Tractor size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />
                                  {work.machine?.name || 'Nepoznata mašina'}
                                </span>
                                <span className={styles.machineSub}>
                                  {work.machine?.brandModel || work.machine?.type}
                                  {work.machine?.regNumber && ` • Reg: ${work.machine.regNumber}`}
                                </span>
                              </div>
                            </td>
                            <td>
                              <div>
                                <strong>{work.parcel?.name}</strong>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
                                  {work.parcel?.code} • {work.workType?.name}
                                </span>
                              </div>
                            </td>
                            <td>
                              <div>
                                <strong style={{ color: '#16a34a' }}>{work.areaDoneHa} ha</strong>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {work.workHours ? `${work.workHours} rh` : '-'}
                                </div>
                              </div>
                            </td>
                            <td>
                              <div style={{ fontSize: '0.78rem' }}>
                                <div>{work.createdBy?.name || 'Korisnik'}</div>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  {work.createdBy?.role}
                                </span>
                              </div>
                            </td>
                            <td>
                              <span className={styles.statusUnassigned}>
                                <AlertTriangle size={12} />
                                Bez Zaduženja
                              </span>
                            </td>
                            <td>
                              {(() => {
                                const dateOnly = work.date ? new Date(work.date).toISOString().split('T')[0] : '';
                                const directUrl = `/masine/zaduzenje?direct=true&machineId=${encodeURIComponent(work.machineId)}&workerId=${encodeURIComponent(work.workerId)}&parcelId=${encodeURIComponent(work.parcelId || '')}&date=${encodeURIComponent(dateOnly)}&workHours=${encodeURIComponent(work.workHours || '')}`;
                                return (
                                  <Link
                                    to={directUrl}
                                    className={styles.btnActionAssign}
                                    title="Direktno zaduži i razduži mašinu u jednom koraku (reši neusklađenost)"
                                  >
                                    Zaduži mašinu
                                    <ExternalLink size={12} />
                                  </Link>
                                );
                              })()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default NeuskladjenostiMasina;
