import React, { useState, useEffect, useMemo } from 'react';
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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { applyUnicodeFont } from '../lib/pdfFont';
import AppLayout from '../components/Layout/AppLayout';
import { ParcelQuickModal, ParcelQuickActions, type ParcelItem } from '../components/ParcelQuickModal';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
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

  // Brzo dodavanje / izmena parcele
  const [parcelQuickModalOpen, setParcelQuickModalOpen] = useState(false);
  const [parcelToEdit, setParcelToEdit] = useState<ParcelItem | null>(null);
  const [parcelQuickTarget, setParcelQuickTarget] = useState<'edit-work' | 'filter'>('edit-work');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

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

  // 1. STATISTIKA RADOVA (Dinamički se osvežava sa promenom izabranog perioda)
  const { data: statsData } = useQuery({
    queryKey: ['field-work-stats', period, currentRange.from, currentRange.to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (period) params.append('period', period);
      if (currentRange.from) params.append('dateFrom', currentRange.from);
      if (currentRange.to) params.append('dateTo', currentRange.to);

      const res = await fetch(`${API}/field-work/stats?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju statistike radova');
      return res.json();
    },
  });

  // 2. ŠIFARNICI ZA FILTERE I MODALE
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

  // 3. OPOCIJE ZA ELEGANTNE CUSTOMSELECT KOMPONENTE
  const parcelFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (parcelsData?.parcels || []).map((p: any) => ({
      value: p.id,
      label: `[${p.code}] ${p.name}`,
      subLabel: `${p.areaHa} ha${p.currentCrop ? ` • ${p.currentCrop}` : ''}`,
    }));
    return [{ value: '', label: 'Sve parcele', subLabel: 'Prikaz svih parcela' }, ...list];
  }, [parcelsData?.parcels]);

  const machineFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (machinesData?.machines || []).map((m: any) => ({
      value: m.id,
      label: m.name,
      subLabel: [m.type, m.brandModel].filter(Boolean).join(' • ') || undefined,
    }));
    return [{ value: '', label: 'Sve mašine', subLabel: 'Prikaz svih mašina i traktora' }, ...list];
  }, [machinesData?.machines]);

  const workerFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (workersData?.workers || []).map((w: any) => ({
      value: w.id,
      label: w.name,
      subLabel: w.type || w.role || undefined,
    }));
    return [{ value: '', label: 'Svi radnici', subLabel: 'Prikaz radova svih radnika' }, ...list];
  }, [workersData?.workers]);

  const workTypeFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (workTypesData?.workTypes || []).map((wt: any) => ({
      value: wt.id,
      label: wt.name,
      subLabel: wt.category || undefined,
    }));
    return [{ value: '', label: 'Sve operacije', subLabel: 'Prikaz svih radnih operacija' }, ...list];
  }, [workTypesData?.workTypes]);

  // Opcije za Edit Modal
  const parcelEditOptions: CustomSelectOption[] = useMemo(() => {
    return (parcelsData?.parcels || []).map((p: any) => ({
      value: p.id,
      label: `[${p.code}] ${p.name}`,
      subLabel: `${p.areaHa} ha${p.currentCrop ? ` • ${p.currentCrop}` : ''}`,
    }));
  }, [parcelsData?.parcels]);

  const machineEditOptions: CustomSelectOption[] = useMemo(() => {
    return (machinesData?.machines || [])
      .filter((m: any) => m.type !== 'PRIKLJUCAK' || m.id === editForm.machineId)
      .map((m: any) => ({
        value: m.id,
        label: m.name,
        subLabel: [m.type, m.brandModel].filter(Boolean).join(' • ') || undefined,
      }));
  }, [machinesData?.machines, editForm.machineId]);

  const workerEditOptions: CustomSelectOption[] = useMemo(() => {
    return (workersData?.workers || []).map((w: any) => ({
      value: w.id,
      label: w.name,
      subLabel: w.type || w.role || undefined,
    }));
  }, [workersData?.workers]);

  const attachmentEditOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (machinesData?.machines || [])
      .filter((m: any) => m.type === 'PRIKLJUCAK' || m.id === editForm.attachmentId)
      .map((m: any) => ({
        value: m.id,
        label: m.name,
        subLabel: m.brandModel || 'Priključno oruđe',
      }));
    return [
      { value: '', label: '— Bez priključka —', subLabel: 'Samostalan rad mašine bez oruđa' },
      ...list,
    ];
  }, [machinesData?.machines, editForm.attachmentId]);

  const workTypeEditOptions: CustomSelectOption[] = useMemo(() => {
    return (workTypesData?.workTypes || []).map((wt: any) => ({
      value: wt.id,
      label: wt.name,
      subLabel: wt.category || undefined,
    }));
  }, [workTypesData?.workTypes]);

  const shiftEditOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'PRVA', label: '1. Smena (Jutarnja)' },
      { value: 'DRUGA', label: '2. Smena (Popodnevna)' },
      { value: 'TRECA', label: '3. Smena (Noćna)' },
    ],
    []
  );

  // 4. GLAVNA TABELA RADOVA (Serverska paginacija i keširanje)
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
      attachmentId: work.attachmentId || '',
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

    if (!editForm.parcelId || !editForm.machineId || !editForm.workerId || !editForm.workTypeId) {
      showToast('Molimo izaberite sva obavezna polja (parcela, mašina, radnik, operacija).', 'error');
      return;
    }

    updateMutation.mutate({
      id: editingWork.id,
      data: {
        ...editForm,
        areaDoneHa: Number(editForm.areaDoneHa),
        attachmentId: editForm.attachmentId || null,
      },
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Da li ste sigurni da želite da stornirate ovaj rad na parceli "${name}"?`)) {
      deleteMutation.mutate(id);
    }
  };

  // EXCEL DOWNLOAD
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

  // PDF DOWNLOAD
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
      params.append('limit', '5000');

      const res = await fetch(`${API}/field-work?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri preuzimanju podataka za PDF izveštaj.');
      const data = await res.json();
      const works = data.works || [];

      if (works.length === 0) {
        showToast('Nema podataka za štampu prema izabranim filterima.', 'error');
        return;
      }

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const hasUnicodeFont = await applyUnicodeFont(doc);
      const fontName = hasUnicodeFont ? 'Roboto' : 'helvetica';

      doc.setFont(fontName, 'bold');
      doc.setFontSize(14);
      doc.setTextColor(22, 101, 52);
      doc.text('NANDRA — Zvanični Dnevnik Radova na Njivi', 14, 15);

      let periodLabel = 'Svi unosi';
      if (period === 'danas') periodLabel = `Danas (${new Date().toLocaleDateString('sr-RS')})`;
      else if (period === 'nedelja') periodLabel = 'Ova nedelja';
      else if (period === 'mesec') periodLabel = 'Ovaj mesec';
      else if (period === 'custom') periodLabel = `Od ${dateFrom} do ${dateTo}`;

      doc.setFont(fontName, 'normal');
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
          `${w.workHours || 0} h`,
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
            `${Math.round(totalHours * 10) / 10} h`,
            '',
          ],
        ],
        startY: 25,
        styles: { font: fontName, fontStyle: 'normal', fontSize: 8, cellPadding: 2 },
        headStyles: { font: fontName, fontStyle: 'bold', fillColor: [30, 41, 59], textColor: [255, 255, 255] },
        footStyles: { font: fontName, fontStyle: 'bold', fillColor: [22, 101, 52], textColor: [255, 255, 255] },
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

  // Dinamička statistika za trenutno izabrani period (Danas / Ova Nedelja / Ovaj Mesec / Prilagođen raspon)
  const currentStats = statsData?.current || {
    areaDoneHa: period === 'danas' ? (statsData?.today?.areaDoneHa || 0) : period === 'nedelja' ? (statsData?.week?.areaDoneHa || 0) : period === 'mesec' ? (statsData?.month?.areaDoneHa || 0) : 0,
    workHours: period === 'danas' ? (statsData?.today?.workHours || 0) : period === 'nedelja' ? (statsData?.week?.workHours || 0) : 0,
    count: period === 'danas' ? (statsData?.today?.count || 0) : period === 'nedelja' ? (statsData?.week?.count || 0) : period === 'mesec' ? (statsData?.month?.count || 0) : 0,
    unassignedWarnings: period === 'danas' ? (statsData?.today?.unassignedWarnings || 0) : period === 'nedelja' ? (statsData?.week?.unassignedWarnings || 0) : period === 'mesec' ? (statsData?.month?.unassignedWarnings || 0) : (statsData?.unassignedWarningsTotal || 0),
  };

  // Dinamički labeli za KPI kartice na osnovu izabranog perioda
  const getPeriodLabelText = () => {
    if (period === 'danas') return 'Danas';
    if (period === 'nedelja') return 'Ova Nedelja';
    if (period === 'mesec') return 'Ovaj Mesec';
    if (period === 'custom') {
      if (dateFrom && dateTo) return `${dateFrom} — ${dateTo}`;
      if (dateFrom) return `Od ${dateFrom}`;
      if (dateTo) return `Do ${dateTo}`;
      return 'Prilagođen Raspon';
    }
    return 'Svi Unosi';
  };

  const periodLabelText = getPeriodLabelText();

  let periodParam = 'danas';
  if (period === 'nedelja') periodParam = 'nedelja';
  else if (period === 'mesec') periodParam = 'mesec';
  else if (period === 'custom' || period === 'sve') periodParam = 'sve';

  const currentPeriodUnassigned = currentStats.unassignedWarnings || 0;

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
          </div>

          <div className={styles.actionBtns}>
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

            {isManager && (
              <button
                type="button"
                onClick={() => {
                  setParcelQuickTarget('filter');
                  setParcelToEdit(null);
                  setParcelQuickModalOpen(true);
                }}
                className={styles.btnSecondary}
                title="Dodaj novu parcelu u šifarnik"
              >
                <Plus size={16} color="#16a34a" />
                <span>Dodaj Parcelu</span>
              </button>
            )}

            <Link to="/radovi/novi" className={styles.btnPrimary} title="Unos novog rada sa njive">
              <Plus size={18} />
              <span>Novi Unos Rada</span>
            </Link>
          </div>
        </div>

        {/* KPI Kartice — Sinhronizovane sa izabranim periodom (Danas, Ova Nedelja, Ovaj Mesec, itd.) */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconArea}`}>
              <Layers size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>
                {currentStats.areaDoneHa}
                <span className={styles.statUnit}>ha</span>
              </div>
              <div className={styles.statLabel}>Urađeno ({periodLabelText})</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconHours}`}>
              <Clock size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>
                {currentStats.workHours}
                <span className={styles.statUnit}>h</span>
              </div>
              <div className={styles.statLabel}>Radnih Sati ({periodLabelText})</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconTractor}`}>
              <Tractor size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>
                {currentStats.count}
                <span className={styles.statUnit}>poslova</span>
              </div>
              <div className={styles.statLabel}>Evidentirano ({periodLabelText})</div>
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
                  Bez zaduženja ({periodLabelText})
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
                gde traktor nije imao zvanično jutarnje zaduženje u sistemu ({periodLabelText.toLowerCase()}). Radovi su prihvaćeni radi kontinuiteta proizvodnje.
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
            <div className={styles.filterControlColumn}>
              <div className={styles.columnHeaderBar}>
                <span className={styles.filterFieldLabel}>Pretraga</span>
              </div>
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
            </div>

            <div className={styles.filterControlColumn}>
              <div className={styles.columnHeaderBar}>
                <span className={styles.filterFieldLabel}>Parcela</span>
                {isManager && (
                  <div className={styles.parcelHeaderActions}>
                    <button
                      type="button"
                      onClick={() => {
                        setParcelQuickTarget('filter');
                        setParcelToEdit(null);
                        setParcelQuickModalOpen(true);
                      }}
                      className={styles.miniParcelAddBtn}
                      title="Brzo dodaj novu parcelu"
                    >
                      <Plus size={11} strokeWidth={2.5} />
                      <span>Dodaj</span>
                    </button>
                    {selectedParcel && (
                      <button
                        type="button"
                        onClick={() => {
                          const found = parcelsData?.parcels?.find((p: any) => p.id === selectedParcel);
                          if (found) {
                            setParcelQuickTarget('filter');
                            setParcelToEdit(found);
                            setParcelQuickModalOpen(true);
                          }
                        }}
                        className={styles.miniParcelEditBtn}
                        title="Izmeni selektovanu parcelu"
                      >
                        <Pencil size={11} strokeWidth={2.5} />
                        <span>Izmeni</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <CustomSelect
                value={selectedParcel}
                onChange={(val) => setSelectedParcel(val)}
                options={parcelFilterOptions}
                placeholder="Sve parcele"
                searchable
              />
            </div>

            <div className={styles.filterControlColumn}>
              <div className={styles.columnHeaderBar}>
                <span className={styles.filterFieldLabel}>Mašina / Traktor</span>
              </div>
              <CustomSelect
                value={selectedMachine}
                onChange={(val) => setSelectedMachine(val)}
                options={machineFilterOptions}
                placeholder="Sve mašine"
                searchable
              />
            </div>

            {!isOperator && (
              <div className={styles.filterControlColumn}>
                <div className={styles.columnHeaderBar}>
                  <span className={styles.filterFieldLabel}>Radnik</span>
                </div>
                <CustomSelect
                  value={selectedWorker}
                  onChange={(val) => setSelectedWorker(val)}
                  options={workerFilterOptions}
                  placeholder="Svi radnici"
                  searchable
                />
              </div>
            )}

            <div className={styles.filterControlColumn}>
              <div className={styles.columnHeaderBar}>
                <span className={styles.filterFieldLabel}>Radna operacija</span>
              </div>
              <CustomSelect
                value={selectedWorkType}
                onChange={(val) => setSelectedWorkType(val)}
                options={workTypeFilterOptions}
                placeholder="Sve operacije"
                searchable
              />
            </div>
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
                            <span className={styles.machineName}>
                              {work.machine?.name}
                              {work.attachment && (
                                <span style={{ color: '#0284c7', fontWeight: 600, fontSize: '0.74rem', display: 'block', marginTop: '1px' }}>
                                  + {work.attachment.name}
                                </span>
                              )}
                            </span>
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
                              <div className={styles.hoursHighlight}>({work.workHours}h)</div>
                            </div>
                          ) : (
                            <span>{work.workHours ? `${work.workHours} h` : '-'}</span>
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

        {/* Modal za izmenu unosa sa elegantnim CustomSelect komponentama */}
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
                      <CustomSelect
                        value={editForm.shift}
                        onChange={(val) => setEditForm({ ...editForm, shift: val })}
                        options={shiftEditOptions}
                        searchable={false}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <label className={styles.formLabel} style={{ marginBottom: 0 }}>Parcela</label>
                        {isManager && (
                          <ParcelQuickActions
                            selectedParcel={parcelsData?.parcels?.find((p: any) => p.id === editForm.parcelId) || null}
                            onAddClick={() => {
                              setParcelQuickTarget('edit-work');
                              setParcelToEdit(null);
                              setParcelQuickModalOpen(true);
                            }}
                            onEditClick={(parcel) => {
                              setParcelQuickTarget('edit-work');
                              setParcelToEdit(parcel);
                              setParcelQuickModalOpen(true);
                            }}
                          />
                        )}
                      </div>
                      <CustomSelect
                        value={editForm.parcelId}
                        onChange={(val) => setEditForm({ ...editForm, parcelId: val })}
                        options={parcelEditOptions}
                        placeholder="— Izaberite parcelu —"
                        searchable
                      />
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
                      <CustomSelect
                        value={editForm.machineId}
                        onChange={(val) => setEditForm({ ...editForm, machineId: val })}
                        options={machineEditOptions}
                        placeholder="— Izaberite mašinu —"
                        searchable
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>
                        Radnik {isOperator && '(automatski vezan nalog)'}
                      </label>
                      <CustomSelect
                        value={editForm.workerId}
                        onChange={(val) => setEditForm({ ...editForm, workerId: val })}
                        options={workerEditOptions}
                        placeholder="— Izaberite radnika —"
                        disabled={isOperator}
                        searchable
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Priključak / Oruđe (opciono)</label>
                    <CustomSelect
                      value={editForm.attachmentId || ''}
                      onChange={(val) => setEditForm({ ...editForm, attachmentId: val })}
                      options={attachmentEditOptions}
                      placeholder="— Bez priključka —"
                      searchable
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Radna operacija</label>
                    <CustomSelect
                      value={editForm.workTypeId}
                      onChange={(val) => setEditForm({ ...editForm, workTypeId: val })}
                      options={workTypeEditOptions}
                      placeholder="— Izaberite radnu operaciju —"
                      searchable
                    />
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

        {/* Brzi modal za dodavanje / izmenu parcele */}
        <ParcelQuickModal
          isOpen={parcelQuickModalOpen}
          onClose={() => setParcelQuickModalOpen(false)}
          parcelToEdit={parcelToEdit}
          onSaved={(savedParcel, mode) => {
            if (parcelQuickTarget === 'edit-work') {
              setEditForm((prev) => ({ ...prev, parcelId: savedParcel.id }));
            } else {
              setSelectedParcel(savedParcel.id);
            }
            showToast(
              mode === 'edit'
                ? `Parcela [${savedParcel.code}] ${savedParcel.name} je izmenjena.`
                : `Nova parcela [${savedParcel.code}] ${savedParcel.name} je dodata.`,
              'success'
            );
          }}
        />
      </div>
    </AppLayout>
  );
};

export default RadoviDashboard;
