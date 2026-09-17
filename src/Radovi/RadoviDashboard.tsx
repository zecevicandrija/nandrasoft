import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Tractor,
  Layers,
  Clock,
  AlertTriangle,
  Plus,
  FileSpreadsheet,
  Printer,
  Search,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  KeyRound,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import AppLayout from '../components/Layout/AppLayout';
import { useSession } from '../lib/auth-client';
import styles from './Radovi.module.css';

const API = 'http://localhost:5000/api';

type PeriodType = 'danas' | 'nedelja' | 'mesec' | 'sve' | 'custom';

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const RadoviDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(currentUser?.role || '');
  const isOperator = currentUser?.role === 'OPERATER';

  // Pomoćna funkcija: da li je datum jednak današnjem kalendarskom danu
  const isSameCalendarDay = (date1: string | Date) => {
    if (!date1) return false;
    const d1 = new Date(date1);
    const d2 = new Date();
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  };

  // Filter stanja
  const [period, setPeriod] = useState<PeriodType>('sve');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedParcel, setSelectedParcel] = useState('');
  const [selectedMachine, setSelectedMachine] = useState('');
  const [selectedWorker, setSelectedWorker] = useState('');
  const [selectedWorkType, setSelectedWorkType] = useState('');
  const [search, setSearch] = useState('');

  // Paginacija
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Reset na stranu 1 pri svakoj promeni filtera ili veličine strane
  useEffect(() => {
    setPage(1);
  }, [period, dateFrom, dateTo, selectedParcel, selectedMachine, selectedWorker, selectedWorkType, search, pageSize]);

  // Helper za prikaz paginacionih brojeva sa elipsom (...)
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

  // Modali i toast
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingWork, setEditingWork] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // 1. STATISTIKA RADOVA
  const { data: statsData } = useQuery({
    queryKey: ['field-work-stats'],
    queryFn: async () => {
      const res = await fetch(`${API}/field-work/stats`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška');
      return res.json();
    },
  });

  // 2. ŠIFARNICI ZA FILTERE
  const { data: parcelsData } = useQuery({
    queryKey: ['parcels-lite'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/parcels`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: machinesData } = useQuery({
    queryKey: ['machines-lite'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/machines`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: workersData } = useQuery({
    queryKey: ['workers-lite'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/workers`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: workTypesData } = useQuery({
    queryKey: ['work-types-lite'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/work-types`, { credentials: 'include' });
      return res.json();
    },
  });

  // Računanje datuma na osnovu izabranog brzog perioda
  const getDateRange = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    if (period === 'danas') {
      return { from: todayStr, to: todayStr };
    }
    if (period === 'nedelja') {
      const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - dayOfWeek);
      const startStr = startOfWeek.toISOString().slice(0, 10);
      return { from: startStr, to: todayStr };
    }
    if (period === 'mesec') {
      const startOfMonth = `${yyyy}-${mm}-01`;
      return { from: startOfMonth, to: todayStr };
    }
    if (period === 'custom') {
      return { from: dateFrom, to: dateTo };
    }
    return { from: '', to: '' };
  };

  const currentRange = getDateRange();

  // 3. GLAVNA TABELA RADOVA (Serverska paginacija i keširanje)
  const { data: worksData, isLoading } = useQuery({
    queryKey: [
      'field-works',
      page,
      pageSize,
      currentRange.from,
      currentRange.to,
      selectedParcel,
      selectedMachine,
      selectedWorker,
      selectedWorkType,
      search,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(pageSize));
      if (currentRange.from) params.append('dateFrom', currentRange.from);
      if (currentRange.to) params.append('dateTo', currentRange.to);
      if (selectedParcel) params.append('parcelId', selectedParcel);
      if (selectedMachine) params.append('machineId', selectedMachine);
      if (selectedWorker) params.append('workerId', selectedWorker);
      if (selectedWorkType) params.append('workTypeId', selectedWorkType);
      if (search) params.append('search', search);

      const res = await fetch(`${API}/field-work?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju radova');
      return res.json();
    },
  });

  // MUTACIJA ZA BRISANJE / STORNO
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/field-work/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Greška');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['field-works'] });
      queryClient.invalidateQueries({ queryKey: ['field-work-stats'] });
      showToast(data.message || 'Zapis uspešno ažuriran.', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // MUTACIJA ZA IZMENU
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetch(`${API}/field-work/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Greška');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['field-works'] });
      queryClient.invalidateQueries({ queryKey: ['field-work-stats'] });
      setEditModalOpen(false);
      showToast(data.message || 'Rad uspešno izmenjen.', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  const handleOpenEdit = (work: any) => {
    setEditingWork(work);
    setEditForm({
      date: work.date ? new Date(work.date).toISOString().slice(0, 10) : '',
      shift: work.shift,
      parcelId: work.parcelId,
      machineId: work.machineId,
      workerId: work.workerId,
      workTypeId: work.workTypeId,
      areaDoneHa: work.areaDoneHa,
      startTime: work.startTime || '',
      endTime: work.endTime || '',
      notes: work.notes || '',
    });
    setEditModalOpen(true);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWork) return;

    updateMutation.mutate({
      id: editingWork.id,
      data: {
        ...editForm,
        areaDoneHa: Number(editForm.areaDoneHa),
      },
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Da li ste sigurni da želite da stornirate ovaj rad na parceli "${name}"?`)) {
      deleteMutation.mutate(id);
    }
  };

  // EXCEL DOWNLOAD (Izvozi SVE unose koji odgovaraju izabranom filteru perioda, parcele, itd.)
  const handleExportExcel = () => {
    const params = new URLSearchParams();
    if (currentRange.from) params.append('dateFrom', currentRange.from);
    if (currentRange.to) params.append('dateTo', currentRange.to);
    if (selectedParcel) params.append('parcelId', selectedParcel);
    if (selectedMachine) params.append('machineId', selectedMachine);
    if (selectedWorker) params.append('workerId', selectedWorker);
    if (selectedWorkType) params.append('workTypeId', selectedWorkType);
    if (search) params.append('search', search);

    window.open(`${API}/field-work/export/excel?${params.toString()}`, '_blank');
  };

  // PDF DOWNLOAD (Dohvata sve zapise koji odgovaraju filteru, sa zbirnim redom na dnu)
  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);
      const params = new URLSearchParams();
      if (currentRange.from) params.append('dateFrom', currentRange.from);
      if (currentRange.to) params.append('dateTo', currentRange.to);
      if (selectedParcel) params.append('parcelId', selectedParcel);
      if (selectedMachine) params.append('machineId', selectedMachine);
      if (selectedWorker) params.append('workerId', selectedWorker);
      if (selectedWorkType) params.append('workTypeId', selectedWorkType);
      if (search) params.append('search', search);
      params.append('limit', '5000'); // preuzima sve unose bez sečenja na trenutnu stranu

      const res = await fetch(`${API}/field-work?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri preuzimanju podataka za PDF izveštaj.');
      const data = await res.json();
      const works = data.works || [];

      if (works.length === 0) {
        showToast('Nema podataka za štampu prema izabranim filterima.', 'error');
        return;
      }

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      // Naslov
      doc.setFontSize(14);
      doc.setTextColor(22, 101, 52); // Tamno zelena
      doc.text('NANDRA — Zvanični Dnevnik Radova na Njivi', 14, 15);

      let periodLabel = 'Svi unosi';
      if (period === 'danas') periodLabel = `Danas (${new Date().toLocaleDateString('sr-RS')})`;
      else if (period === 'nedelja') periodLabel = 'Ova nedelja';
      else if (period === 'mesec') periodLabel = 'Ovaj mesec';
      else if (period === 'custom') periodLabel = `Od ${dateFrom} do ${dateTo}`;

      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Filter: ${periodLabel} | Generisano: ${new Date().toLocaleDateString('sr-RS')} | Ukupno: ${works.length} poslova`,
        14,
        21
      );

      let totalHa = 0;
      let totalHours = 0;

      const tableData = works.map((w: any, idx: number) => {
        totalHa += w.areaDoneHa || 0;
        totalHours += w.workHours || 0;

        return [
          idx + 1,
          new Date(w.date).toLocaleDateString('sr-RS'),
          w.shift === 'PRVA' ? '1. Smena' : w.shift === 'DRUGA' ? '2. Smena' : 'Noćna',
          `[${w.parcel?.code}] ${w.parcel?.name}`,
          `${w.areaDoneHa} ha`,
          w.worker?.name,
          w.machine?.name,
          w.workType?.name,
          w.startTime && w.endTime ? `${w.startTime} - ${w.endTime}` : '-',
          `${w.workHours || 0} rh`,
          w.notes || '-',
        ];
      });

      autoTable(doc, {
        head: [
          [
            'RB',
            'Datum',
            'Smena',
            'Parcela',
            'Urađeno',
            'Radnik',
            'Mašina',
            'Operacija',
            'Vreme',
            'Sati',
            'Napomena',
          ],
        ],
        body: tableData,
        foot: [
          [
            'UKUPNO',
            '',
            '',
            '',
            `${Math.round(totalHa * 100) / 100} ha`,
            '',
            '',
            '',
            '',
            `${Math.round(totalHours * 10) / 10} rh`,
            '',
          ],
        ],
        startY: 25,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
        footStyles: { fillColor: [22, 101, 52], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
      });

      doc.save(`nandra_dnevnik_radova_${new Date().toISOString().slice(0, 10)}.pdf`);
      showToast('PDF izveštaj uspešno generisan!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Greška pri generisanju PDF-a.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const worksList = worksData?.works || [];
  const totalWorks = worksData?.total || 0;
  const totalPages = worksData?.totalPages || 1;
  const todayStats = statsData?.today || { areaDoneHa: 0, workHours: 0, count: 0, unassignedWarnings: 0 };
  const weekStats = statsData?.week || { areaDoneHa: 0, workHours: 0, count: 0, unassignedWarnings: 0 };
  const monthStats = statsData?.month || { areaDoneHa: 0, count: 0, unassignedWarnings: 0 };

  // Dinamičko računanje nezaduženih mašina za trenutno izabrani period
  let currentPeriodUnassigned = 0;
  let periodLabelText = 'danas';
  let periodParam = 'danas';

  if (period === 'danas') {
    currentPeriodUnassigned = todayStats.unassignedWarnings || 0;
    periodLabelText = 'danas';
    periodParam = 'danas';
  } else if (period === 'nedelja') {
    currentPeriodUnassigned = weekStats.unassignedWarnings || 0;
    periodLabelText = 'ove nedelje';
    periodParam = 'nedelja';
  } else if (period === 'mesec') {
    currentPeriodUnassigned = monthStats.unassignedWarnings || 0;
    periodLabelText = 'ovog meseca';
    periodParam = 'mesec';
  } else {
    // 'sve' ili 'custom'
    currentPeriodUnassigned = statsData?.unassignedWarningsTotal || 0;
    periodLabelText = 'u izabranom periodu';
    periodParam = 'sve';
  }

  return (
    <AppLayout pageTitle="Operativa na Njivi">
      <div className={styles.container}>
        {/* Toast Notifikacija */}
        {toast && (
          <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{toast.message}</span>
          </div>
        )}

        {/* Zaglavlje i Brze Akcije */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <Tractor size={26} color="#16a34a" />
              Dnevnik Radova na Njivi
            </h2>
            <div className={styles.subtitle}>
              Evidencija obrade zemljišta, utrošenih sati, angažovane mehanizacije i radnika
            </div>
          </div>

          <div className={styles.actionBtns}>
            <Link to="/masine/zaduzenje" className={styles.btnSecondary} title="Zaduživanje i razduživanje mašina">
              <KeyRound size={16} color="#d97706" />
              <span>Zaduženja Mašina</span>
            </Link>

            <button onClick={handleExportExcel} className={styles.btnSecondary} title="Preuzmi u Excel formatu">
              <FileSpreadsheet size={16} color="#16a34a" />
              <span>Excel</span>
            </button>

            <button
              onClick={handleExportPdf}
              className={styles.btnSecondary}
              title="Odštampaj ili preuzmi PDF"
              disabled={isExportingPdf}
            >
              {isExportingPdf ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Printer size={16} color="#2563eb" />
              )}
              <span>{isExportingPdf ? 'Generisanje...' : 'PDF'}</span>
            </button>

            <Link to="/radovi/novi" className={styles.btnPrimary} title="Unos novog rada sa njive">
              <Plus size={18} />
              <span>Novi Unos Rada</span>
            </Link>
          </div>
        </div>

        {/* KPI Kartice */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconArea}`}>
              <Layers size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>
                {todayStats.areaDoneHa}
                <span className={styles.statUnit}>ha</span>
              </div>
              <div className={styles.statLabel}>Urađeno Danas ({todayStats.count} poslova)</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconHours}`}>
              <Clock size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>
                {todayStats.workHours}
                <span className={styles.statUnit}>rh</span>
              </div>
              <div className={styles.statLabel}>Radnih Sati Danas</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconTractor}`}>
              <Tractor size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>
                {weekStats.areaDoneHa}
                <span className={styles.statUnit}>ha</span>
              </div>
              <div className={styles.statLabel}>Ove Nedelje ({weekStats.workHours} rh)</div>
            </div>
          </div>

          {isManager && (
            <Link
              to={`/masine/neusklađenosti?period=${periodParam}`}
              className={styles.statCard}
              style={{ textDecoration: 'none', cursor: 'pointer' }}
              title="Kliknite za detaljan pregled radova bez jutarnjeg zaduženja"
            >
              <div className={`${styles.statIcon} ${styles.iconWarning}`}>
                <AlertTriangle size={22} />
              </div>
              <div className={styles.statInfo}>
                <div className={styles.statValue}>
                  {currentPeriodUnassigned}
                </div>
                <div className={styles.statLabel}>
                  Radovi bez zaduženja ({period === 'danas' ? 'Danas' : period === 'nedelja' ? 'Ove nedelje' : period === 'mesec' ? 'Ovog meseca' : 'Svi unosi'})
                </div>
              </div>
            </Link>
          )}
        </div>

        {/* Upozorenje rukovodiocu ako u izabranom periodu postoje radovi bez zaduženja */}
        {isManager && currentPeriodUnassigned > 0 && (
          <div className={styles.warningNotice}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <span>
                Pažnja: Evidentirano je{' '}
                <strong>{currentPeriodUnassigned}</strong>{' '}
                {currentPeriodUnassigned === 1 ? 'unos rada' : currentPeriodUnassigned < 5 ? 'unosa rada' : 'unosa rada'}{' '}
                gde traktor nije imao zvanično jutarnje zaduženje u sistemu ({periodLabelText}). Radovi su prihvaćeni radi kontinuiteta proizvodnje.
              </span>
            </div>
            <Link to={`/masine/neusklađenosti?period=${periodParam}`} className={styles.btnWarningAction}>
              Pogledaj problem
            </Link>
          </div>
        )}

        {/* Filter Traka */}
        <div className={styles.filterBar}>
          <div className={styles.filterPeriodRow}>
            <div className={styles.periodButtons}>
              <button
                className={`${styles.periodBtn} ${period === 'danas' ? styles.periodBtnActive : ''}`}
                onClick={() => setPeriod('danas')}
              >
                Danas
              </button>
              <button
                className={`${styles.periodBtn} ${period === 'nedelja' ? styles.periodBtnActive : ''}`}
                onClick={() => setPeriod('nedelja')}
              >
                Ova Nedelja
              </button>
              <button
                className={`${styles.periodBtn} ${period === 'mesec' ? styles.periodBtnActive : ''}`}
                onClick={() => setPeriod('mesec')}
              >
                Ovaj Mesec
              </button>
              <button
                className={`${styles.periodBtn} ${period === 'sve' ? styles.periodBtnActive : ''}`}
                onClick={() => setPeriod('sve')}
              >
                Svi Unosi
              </button>
              <button
                className={`${styles.periodBtn} ${period === 'custom' ? styles.periodBtnActive : ''}`}
                onClick={() => setPeriod('custom')}
              >
                Prilagođen Raspon
              </button>
            </div>

            {period === 'custom' && (
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
            )}
          </div>

          <div className={styles.filterControlsRow}>
            <div className={styles.searchBox}>
              <Search size={16} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Pretraži unose i napomene..."
                className={styles.searchInput}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              className={styles.selectInput}
              value={selectedParcel}
              onChange={(e) => setSelectedParcel(e.target.value)}
            >
              <option value="">Sve parcele</option>
              {parcelsData?.parcels?.map((p: any) => (
                <option key={p.id} value={p.id}>
                  [{p.code}] {p.name}
                </option>
              ))}
            </select>

            <select
              className={styles.selectInput}
              value={selectedMachine}
              onChange={(e) => setSelectedMachine(e.target.value)}
            >
              <option value="">Sve mašine</option>
              {machinesData?.machines?.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            {!isOperator && (
              <select
                className={styles.selectInput}
                value={selectedWorker}
                onChange={(e) => setSelectedWorker(e.target.value)}
              >
                <option value="">Svi radnici</option>
                {workersData?.workers?.map((w: any) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}

            <select
              className={styles.selectInput}
              value={selectedWorkType}
              onChange={(e) => setSelectedWorkType(e.target.value)}
            >
              <option value="">Sve operacije</option>
              {workTypesData?.workTypes?.map((wt: any) => (
                <option key={wt.id} value={wt.id}>
                  {wt.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabela Radova */}
        <div className={styles.tableCard}>
          <div className={styles.tableHeaderBar}>
            <span className={styles.tableTitle}>Evidentirani Poslovi</span>
            <span className={styles.tableCountBadge}>
              Ukupno: {totalWorks} | Strana {page} od {totalPages}
            </span>
          </div>

          <div className={styles.tableWrapper}>
            {isLoading ? (
              <div className={styles.emptyState}>
                <Loader2 size={32} className="spin" />
                <div className={styles.emptyStateTitle}>Učitavanje radova...</div>
              </div>
            ) : worksList.length === 0 ? (
              <div className={styles.emptyState}>
                <Tractor size={40} color="var(--text-muted)" />
                <div className={styles.emptyStateTitle}>Nema evidentiranih radova</div>
                <div className={styles.emptyStateDesc}>
                  Nijedan posao ne odgovara izabranim filterima. Kliknite na "Novi Unos Rada" da zabeležite posao.
                </div>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Smena</th>
                    <th>Parcela</th>
                    <th>Urađeno</th>
                    <th>Radnik / Mašina</th>
                    <th>Radna Operacija</th>
                    <th>Vreme Rada</th>
                    <th>Status</th>
                    <th>Napomena</th>
                    {(isManager || isOperator) && <th style={{ textAlign: 'right' }}>Akcije</th>}
                  </tr>
                </thead>
                <tbody>
                  {worksList.map((work: any) => {
                    const dateFormatted = new Date(work.date).toLocaleDateString('sr-RS');
                    return (
                      <tr key={work.id}>
                        <td>
                          <strong>{dateFormatted}</strong>
                        </td>
                        <td>
                          <span className={`${styles.shiftBadge} ${styles[`shift${work.shift}`]}`}>
                            {work.shift === 'PRVA' ? '1. Smena' : work.shift === 'DRUGA' ? '2. Smena' : 'Noćna'}
                          </span>
                        </td>
                        <td>
                          <div>
                            <strong>{work.parcel?.name}</strong>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              Šifra: {work.parcel?.code} ({work.parcel?.areaHa} ha)
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={styles.areaHighlight}>{work.areaDoneHa} ha</span>
                        </td>
                        <td>
                          <div className={styles.workerCell}>
                            <span className={styles.workerName}>{work.worker?.name}</span>
                            <span className={styles.machineName}>{work.machine?.name}</span>
                          </div>
                        </td>
                        <td>
                          <strong>{work.workType?.name}</strong>
                        </td>
                        <td>
                          {work.startTime && work.endTime ? (
                            <div>
                              <span>
                                {work.startTime} - {work.endTime}
                              </span>
                              <div className={styles.hoursHighlight}>({work.workHours} rh)</div>
                            </div>
                          ) : (
                            <span>{work.workHours ? `${work.workHours} rh` : '-'}</span>
                          )}
                        </td>
                        <td>
                          <span className={`${styles.statusBadge} ${styles[`status${work.status}`]}`}>
                            {work.status === 'ZAVRSENO'
                              ? 'Završeno'
                              : work.status === 'U_TOKU'
                                ? 'U toku'
                                : 'Storno'}
                          </span>
                        </td>
                        <td style={{ maxWidth: 200, color: 'var(--text-secondary)' }}>
                          {work.notes || '-'}
                        </td>
                        {(isManager || isOperator) && (
                          <td>
                            <div className={styles.rowActions} style={{ justifyContent: 'flex-end' }}>
                              {isManager || (isOperator && isSameCalendarDay(work.date)) ? (
                                <button
                                  className={styles.btnIcon}
                                  title="Izmeni unos rada"
                                  onClick={() => handleOpenEdit(work)}
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
                                  title="Istekao rok za izmenu (dozvoljeno samo na dan unosa)"
                                >
                                  Zaključano
                                </span>
                              ) : null}

                              {isManager && (
                                <button
                                  className={`${styles.btnIcon} ${styles.btnDelete}`}
                                  title="Storniraj rad"
                                  onClick={() => handleDelete(work.id, work.parcel?.name || '')}
                                >
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Serverska Paginacija */}
          {totalWorks > 0 && (
            <div className={styles.paginationBar}>
              <div className={styles.paginationInfo}>
                Prikazano <strong>{(page - 1) * pageSize + 1}</strong> do{' '}
                <strong>{Math.min(page * pageSize, totalWorks)}</strong> od ukupno{' '}
                <strong>{totalWorks}</strong> {totalWorks === 1 ? 'posla' : 'poslova'}
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
                          className={`${styles.paginationPageBtn} ${pNum === page ? styles.paginationPageBtnActive : ''}`}
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

        {/* Modal za izmenu unosa */}
        {editModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setEditModalOpen(false)}>
            <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>Izmena Zapisa o Radu</h3>
                <button className={styles.modalCloseBtn} onClick={() => setEditModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveEdit}>
                <div className={styles.modalBody}>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>
                        Datum rada {isOperator && '(fiksiran na dan unosa)'}
                      </label>
                      <input
                        type="date"
                        className={styles.selectInput}
                        value={editForm.date}
                        onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                        disabled={isOperator}
                        required
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Smena</label>
                      <select
                        className={styles.selectInput}
                        value={editForm.shift}
                        onChange={(e) => setEditForm({ ...editForm, shift: e.target.value })}
                      >
                        <option value="PRVA">1. Smena</option>
                        <option value="DRUGA">2. Smena</option>
                        <option value="TRECA">3. Noćna</option>
                      </select>
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Parcela</label>
                      <select
                        className={styles.selectInput}
                        value={editForm.parcelId}
                        onChange={(e) => setEditForm({ ...editForm, parcelId: e.target.value })}
                        required
                      >
                        {parcelsData?.parcels?.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            [{p.code}] {p.name} ({p.areaHa} ha)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Urađena površina (ha)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        className={styles.selectInput}
                        value={editForm.areaDoneHa}
                        onChange={(e) => setEditForm({ ...editForm, areaDoneHa: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Mašina / Traktor</label>
                      <select
                        className={styles.selectInput}
                        value={editForm.machineId}
                        onChange={(e) => setEditForm({ ...editForm, machineId: e.target.value })}
                        required
                      >
                        {machinesData?.machines?.map((m: any) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>
                        Radnik {isOperator && '(automatski vezan nalog)'}
                      </label>
                      <select
                        className={styles.selectInput}
                        value={editForm.workerId}
                        onChange={(e) => setEditForm({ ...editForm, workerId: e.target.value })}
                        disabled={isOperator}
                        required
                      >
                        {workersData?.workers?.map((w: any) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Radna operacija</label>
                    <select
                      className={styles.selectInput}
                      value={editForm.workTypeId}
                      onChange={(e) => setEditForm({ ...editForm, workTypeId: e.target.value })}
                      required
                    >
                      {workTypesData?.workTypes?.map((wt: any) => (
                        <option key={wt.id} value={wt.id}>
                          {wt.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Početak rada (HH:MM)</label>
                      <input
                        type="time"
                        className={styles.selectInput}
                        value={editForm.startTime}
                        onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Kraj rada (HH:MM)</label>
                      <input
                        type="time"
                        className={styles.selectInput}
                        value={editForm.endTime}
                        onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Napomena</label>
                    <textarea
                      rows={3}
                      className={styles.selectInput}
                      value={editForm.notes}
                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                      placeholder="Uneti zapažanja, uslove na njivi ili specifičnosti..."
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setEditModalOpen(false)}
                  >
                    Otkaži
                  </button>
                  <button
                    type="submit"
                    className={styles.btnPrimary}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? 'Čuvanje...' : 'Sačuvaj Izmene'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default RadoviDashboard;
