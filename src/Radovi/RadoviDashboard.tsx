import { sameBelgradeDay } from '../lib/workDay';
import MachineUsageModal from '../components/MachineUsageModal';
import { MaterialSummary } from '../components/WorkMaterialsEditor';
import { materialSummary } from '../lib/workMaterials';
import { masterQueryKeys } from '../lib/masterQueryKeys';
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Tractor,
  Layers,
  Clock,
  AlertTriangle,
  Plus,
  FileSpreadsheet,
  Printer,
  Image as ImageIcon,
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
import { applyUnicodeFont } from '../lib/pdfFont';
import AppLayout from '../components/Layout/AppLayout';
import { ParcelQuickModal, type ParcelItem } from '../components/ParcelQuickModal';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import { useSession } from '../lib/auth-client';
import {
  EditWorkModal,
  type EditWorkSubmitPayload,
  type FieldWorkItem,
  type MachineOption,
  type WorkerOption,
  type WorkTypeOption,
} from './EditWorkModal';
import styles from './Radovi.module.css';

const API = '/api';

type PeriodType = 'danas' | 'nedelja' | 'mesec' | 'sve' | 'custom';

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const EMPTY_STATS = { areaDoneHa: 0, workHours: 0, count: 0, unassignedWarnings: 0 };
const srDateFormatter = new Intl.DateTimeFormat('sr-RS');

function formatLocalYmd(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface WorkTableRowProps {
  work: FieldWorkItem;
  isManager: boolean;
  isOperator: boolean;
  onEdit: (work: FieldWorkItem) => void;
  onDelete: (id: string, parcelName: string) => void;
  onShowPhoto: (photoUrl: string, notes?: string | null) => void;
}

const WorkTableRow = React.memo<WorkTableRowProps>(({
  work,
  isManager,
  isOperator,
  onEdit,
  onDelete,
  onShowPhoto,
}) => {
  const dateFormatted = srDateFormatter.format(new Date(work.date));
  return (
    <tr>
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
      <td>{work.contractor?.name || '—'}</td>
      <td>
        <span className={styles.areaHighlight}>{work.areaDoneHa} ha</span>
      </td>
      <td>
        <div className={styles.workerCell}>
          <span className={styles.workerName}>{work.worker?.name}</span>
          <span className={styles.machineName}>
            {work.machineAssignments?.length
              ? [...new Set(work.machineAssignments.map((a) => a.machine?.name))].join(', ')
              : work.machine?.name}
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
        <MaterialSummary items={work.materials} />
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
        {work.photoUrl && (
          <button
            type="button"
            className={`${styles.btnSecondary} ${styles.photoButton}`}
            onClick={() => {
              if (work.photoUrl) onShowPhoto(work.photoUrl, work.notes);
            }}
          >
            <ImageIcon size={16} />
            Prikaži sliku
          </button>
        )}
      </td>
      {(isManager || isOperator) && (
        <td>
          <div className={styles.rowActions} style={{ justifyContent: 'flex-end' }}>
            {isManager || (isOperator && sameBelgradeDay(work.date)) ? (
              <button
                className={styles.btnIcon}
                title="Izmeni unos rada"
                onClick={() => onEdit(work)}
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
                onClick={() => onDelete(work.id, work.parcel?.name || '')}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );
});

const RadoviDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const [usageId, setUsageId] = useState<string | null>(null);
  const { data: session } = useSession();
  const currentUser = (session as { user?: { role?: string } } | null)?.user;
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(currentUser?.role || '');
  const isOperator = currentUser?.role === 'OPERATER';

  // Filter stanja
  const [period, setPeriod] = useState<PeriodType>('sve');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedParcel, setSelectedParcel] = useState('');
  const [selectedMachine, setSelectedMachine] = useState('');
  const [selectedWorker, setSelectedWorker] = useState('');
  const [selectedWorkType, setSelectedWorkType] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Paginacija
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Debounce pretrage + reset stranice na 1 kada se pretraga promeni
  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed === debouncedSearch) return;
    const timer = window.setTimeout(() => {
      setDebouncedSearch(trimmed);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, debouncedSearch]);

  const handlePeriodChange = (nextPeriod: PeriodType) => {
    setPeriod(nextPeriod);
    setPage(1);
  };

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
  const [editingWork, setEditingWork] = useState<FieldWorkItem | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [photoWork, setPhotoWork] = useState<{ photoUrl: string; notes?: string | null } | null>(null);
  const [photoLoadError, setPhotoLoadError] = useState(false);
  const photoDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (photoWork) photoDialogRef.current?.showModal();
  }, [photoWork]);

  // Brzo dodavanje / izmena parcele iz filtera
  const [parcelQuickModalOpen, setParcelQuickModalOpen] = useState(false);
  const [parcelToEdit, setParcelToEdit] = useState<ParcelItem | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Računanje datuma na osnovu izabranog brzog perioda
  const currentRange = useMemo(() => {
    const today = new Date();
    const todayStr = formatLocalYmd(today);

    if (period === 'danas') {
      return { from: todayStr, to: todayStr };
    }
    if (period === 'nedelja') {
      const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - dayOfWeek);
      return { from: formatLocalYmd(startOfWeek), to: todayStr };
    }
    if (period === 'mesec') {
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      return { from: `${yyyy}-${mm}-01`, to: todayStr };
    }
    if (period === 'custom') {
      return { from: dateFrom, to: dateTo };
    }
    return { from: '', to: '' };
  }, [period, dateFrom, dateTo]);

  const isCustomRange = period === 'custom' && Boolean(dateFrom || dateTo);

  // 1. STATISTIKA RADOVA (Jedan keširan poziv za ugrađene periode; dodatni samo za custom raspon)
  const { data: statsData } = useQuery({
    queryKey: isCustomRange
      ? ['field-work-stats', 'custom', currentRange.from, currentRange.to]
      : ['field-work-stats', 'presets'],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.append('includeBreakdown', 'false');
      if (isCustomRange) {
        params.append('period', 'custom');
        if (currentRange.from) params.append('dateFrom', currentRange.from);
        if (currentRange.to) params.append('dateTo', currentRange.to);
      } else {
        params.append('period', 'sve');
      }

      const res = await fetch(`${API}/field-work/stats?${params.toString()}`, { credentials: 'include', signal });
      if (!res.ok) throw new Error('Greška pri dohvatanju statistike radova');
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  // 2. ŠIFARNICI ZA FILTERE I MODALE
  const { data: parcelsData } = useQuery({
    queryKey: masterQueryKeys.parcels,
    queryFn: async ({ signal }) => {
      const res = await fetch(`${API}/master/parcels`, { credentials: 'include', signal });
      if (!res.ok) throw new Error('Greška pri dohvatanju parcela');
      return res.json();
    },
  });

  const { data: machinesData } = useQuery({
    queryKey: masterQueryKeys.machines,
    queryFn: async ({ signal }) => {
      const res = await fetch(`${API}/master/machines`, { credentials: 'include', signal });
      if (!res.ok) throw new Error('Greška pri dohvatanju mašina');
      return res.json();
    },
  });

  const { data: workersData } = useQuery({
    queryKey: ['workers-lite'],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${API}/master/workers`, { credentials: 'include', signal });
      if (!res.ok) throw new Error('Greška pri dohvatanju radnika');
      return res.json();
    },
    enabled: Boolean(currentUser) && !isOperator,
  });

  const { data: workTypesData } = useQuery({
    queryKey: ['work-types-lite'],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${API}/master/work-types`, { credentials: 'include', signal });
      if (!res.ok) throw new Error('Greška pri dohvatanju radnih operacija');
      return res.json();
    },
  });

  // 3. OPOCIJE ZA ELEGANTNE CUSTOMSELECT KOMPONENTE
  const parcelFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (parcelsData?.parcels || []).map((p: ParcelItem) => ({
      value: p.id,
      label: `[${p.code}] ${p.name}`,
      subLabel: `${p.areaHa} ha${p.currentCrop ? ` • ${p.currentCrop}` : ''}`,
    }));
    return [{ value: '', label: 'Sve parcele', subLabel: 'Prikaz svih parcela' }, ...list];
  }, [parcelsData?.parcels]);

  const machineFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (machinesData?.machines || []).map((m: MachineOption) => ({
      value: m.id,
      label: m.name,
      subLabel: [m.type, m.brandModel].filter(Boolean).join(' • ') || undefined,
    }));
    return [{ value: '', label: 'Sve mašine', subLabel: 'Prikaz svih mašina i traktora' }, ...list];
  }, [machinesData?.machines]);

  const workerFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (workersData?.workers || []).map((w: WorkerOption) => ({
      value: w.id,
      label: w.name,
      subLabel: w.type || w.role || undefined,
    }));
    return [{ value: '', label: 'Svi radnici', subLabel: 'Prikaz radova svih radnika' }, ...list];
  }, [workersData?.workers]);

  const workTypeFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (workTypesData?.workTypes || []).map((wt: WorkTypeOption) => ({
      value: wt.id,
      label: wt.name,
      subLabel: wt.category || undefined,
    }));
    return [{ value: '', label: 'Sve operacije', subLabel: 'Prikaz svih radnih operacija' }, ...list];
  }, [workTypesData?.workTypes]);

  // 4. GLAVNA TABELA RADOVA (Serverska paginacija i keširanje)
  const { data: worksData, isLoading, isFetching } = useQuery({
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
      debouncedSearch,
    ],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(pageSize));
      if (currentRange.from) params.append('dateFrom', currentRange.from);
      if (currentRange.to) params.append('dateTo', currentRange.to);
      if (selectedParcel) params.append('parcelId', selectedParcel);
      if (selectedMachine) params.append('machineId', selectedMachine);
      if (selectedWorker) params.append('workerId', selectedWorker);
      if (selectedWorkType) params.append('workTypeId', selectedWorkType);
      if (debouncedSearch) params.append('search', debouncedSearch);

      const res = await fetch(`${API}/field-work?${params.toString()}`, { credentials: 'include', signal });
      if (!res.ok) throw new Error('Greška pri dohvatanju radova');
      return res.json();
    },
    placeholderData: keepPreviousData,
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
    onError: (err: Error) => {
      showToast(err.message, 'error');
    },
  });

  // MUTACIJA ZA IZMENU
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: EditWorkSubmitPayload }) => {
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
    onError: (err: Error) => {
      showToast(err.message, 'error');
    },
  });

  const { mutate: deleteWorkMutate } = deleteMutation;

  const handleOpenEdit = useCallback((work: FieldWorkItem) => {
    setEditingWork(work);
    setEditModalOpen(true);
  }, []);

  const handleDelete = useCallback((id: string, name: string) => {
    if (confirm(`Da li ste sigurni da želite da stornirate ovaj rad na parceli "${name}"?`)) {
      deleteWorkMutate(id);
    }
  }, [deleteWorkMutate]);

  const handleShowPhoto = useCallback((photoUrl: string, notes?: string | null) => {
    setPhotoLoadError(false);
    setPhotoWork({ photoUrl, notes });
  }, []);

  // EXCEL DOWNLOAD
  const handleExportExcel = () => {
    const params = new URLSearchParams();
    if (currentRange.from) params.append('dateFrom', currentRange.from);
    if (currentRange.to) params.append('dateTo', currentRange.to);
    if (selectedParcel) params.append('parcelId', selectedParcel);
    if (selectedMachine) params.append('machineId', selectedMachine);
    if (selectedWorker) params.append('workerId', selectedWorker);
    if (selectedWorkType) params.append('workTypeId', selectedWorkType);
    if (search.trim()) params.append('search', search.trim());

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
      if (search.trim()) params.append('search', search.trim());
      params.append('limit', '5000');

      const res = await fetch(`${API}/field-work?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri preuzimanju podataka za PDF izveštaj.');
      const data = await res.json();
      const works = data.works || [];

      if (works.length === 0) {
        showToast('Nema podataka za štampu prema izabranim filterima.', 'error');
        return;
      }

      const [{ jsPDF }, { autoTable }] = await Promise.all([
        import('jspdf'), import('jspdf-autotable'),
      ]);
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

      const tableData = works.map((w: FieldWorkItem, idx: number) => {
        totalHa += w.areaDoneHa || 0;
        totalHours += w.workHours || 0;

        return [
          idx + 1,
          srDateFormatter.format(new Date(w.date)),
          w.shift === 'PRVA' ? '1. Smena' : w.shift === 'DRUGA' ? '2. Smena' : 'Noćna',
          `[${w.parcel?.code}] ${w.parcel?.name}`,
          w.contractor?.name || '—',
          `${w.areaDoneHa} ha`,
          w.worker?.name,
          w.machineAssignments?.length ? w.machineAssignments.map((a) => `${a.machine?.name}: ${a.areaDoneHa ?? 0} ha`).join("; ") : w.machine?.name,
          [w.workType?.name, materialSummary(w.materials)].filter(Boolean).join('\n'),
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
            'Kooperant',
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
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Greška pri generisanju PDF-a.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const worksList = worksData?.works || [];
  const totalWorks = worksData?.total || 0;
  const totalPages = worksData?.totalPages || 1;

  // Dinamička statistika za trenutno izabrani period (čita iz keširanih preseta bez dodatnog zahteva)
  const currentStats = isCustomRange
    ? (statsData?.current ?? EMPTY_STATS)
    : period === 'danas'
      ? (statsData?.today ?? EMPTY_STATS)
      : period === 'nedelja'
        ? (statsData?.week ?? EMPTY_STATS)
        : period === 'mesec'
          ? (statsData?.month ?? EMPTY_STATS)
          : (statsData?.all ?? statsData?.current ?? {
              areaDoneHa: 0,
              workHours: 0,
              count: 0,
              unassignedWarnings: statsData?.unassignedWarningsTotal || 0,
            });

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
                onClick={() => handlePeriodChange('danas')}
              >
                Danas
              </button>
              <button
                className={`${styles.periodBtn} ${period === 'nedelja' ? styles.periodBtnActive : ''}`}
                onClick={() => handlePeriodChange('nedelja')}
              >
                Ova Nedelja
              </button>
              <button
                className={`${styles.periodBtn} ${period === 'mesec' ? styles.periodBtnActive : ''}`}
                onClick={() => handlePeriodChange('mesec')}
              >
                Ovaj Mesec
              </button>
              <button
                className={`${styles.periodBtn} ${period === 'sve' ? styles.periodBtnActive : ''}`}
                onClick={() => handlePeriodChange('sve')}
              >
                Svi Unosi
              </button>
              <button
                className={`${styles.periodBtn} ${period === 'custom' ? styles.periodBtnActive : ''}`}
                onClick={() => handlePeriodChange('custom')}
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
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                />
                <span>Do:</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
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
                          const found = parcelsData?.parcels?.find((p: ParcelItem) => p.id === selectedParcel);
                          if (found) {
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
                onChange={(val) => {
                  setSelectedParcel(val);
                  setPage(1);
                }}
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
                onChange={(val) => {
                  setSelectedMachine(val);
                  setPage(1);
                }}
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
                  onChange={(val) => {
                    setSelectedWorker(val);
                    setPage(1);
                  }}
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
                onChange={(val) => {
                  setSelectedWorkType(val);
                  setPage(1);
                }}
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
              {isFetching && !isLoading && <Loader2 size={13} className="spin" />}
              <span>Ukupno: {totalWorks} | Strana {page} od {totalPages}</span>
            </span>
          </div>

          <div className={`${styles.tableWrapper} ${isFetching && !isLoading ? styles.tableWrapperFetching : ''}`}>
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
                    <th>Kooperant</th>
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
                  {worksList.map((work: FieldWorkItem) => (
                    <WorkTableRow
                      key={work.id}
                      work={work}
                      isManager={isManager}
                      isOperator={isOperator}
                      onEdit={handleOpenEdit}
                      onDelete={handleDelete}
                      onShowPhoto={handleShowPhoto}
                    />
                  ))}
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

        {photoWork && (
          <dialog
            ref={photoDialogRef}
            className={styles.photoDialog}
            aria-labelledby="work-photo-title"
            onCancel={() => setPhotoWork(null)}
            onClose={() => setPhotoWork(null)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setPhotoWork(null);
            }}
          >
            <div className={styles.modalHeader}>
              <h3 id="work-photo-title" className={styles.modalTitle}>Fotografija sa terena</h3>
              <button type="button" className={styles.modalCloseBtn} aria-label="Zatvori pregled slike" onClick={() => setPhotoWork(null)}>
                <X size={20} />
              </button>
            </div>
            <div className={styles.modalBody}>
              {photoLoadError ? (
                <p role="alert">Fotografija nije učitana. Zatvorite pregled i pokušajte ponovo.</p>
              ) : (
                <img className={styles.workPhoto} src={photoWork.photoUrl} alt="Fotografija prijavljena uz rad na njivi" onError={() => setPhotoLoadError(true)} />
              )}
              <div className={styles.photoNotes}>
                <strong>Napomena</strong>
                <p>{photoWork.notes?.trim() || 'Nema napomene uz ovaj rad.'}</p>
              </div>
            </div>
          </dialog>
        )}

        {/* Modal za izmenu unosa izdvojen u zasebnu komponentu da kucanje ne re-renderuje tabelu */}
        {editModalOpen && editingWork && (
          <EditWorkModal
            key={editingWork.id}
            editingWork={editingWork}
            parcels={parcelsData?.parcels || []}
            machines={machinesData?.machines || []}
            workers={workersData?.workers || []}
            workTypes={workTypesData?.workTypes || []}
            isManager={isManager}
            isOperator={isOperator}
            isSaving={updateMutation.isPending}
            onClose={() => setEditModalOpen(false)}
            onOpenMachineUsage={(workId) => {
              setUsageId(workId);
              setEditModalOpen(false);
            }}
            onNotify={showToast}
            onSubmit={(id, data) => updateMutation.mutate({ id, data })}
          />
        )}

        {/* Brzi modal za dodavanje / izmenu parcele iz filtera */}
        <ParcelQuickModal
          isOpen={parcelQuickModalOpen}
          onClose={() => setParcelQuickModalOpen(false)}
          parcelToEdit={parcelToEdit}
          onSaved={(savedParcel, mode) => {
            setSelectedParcel(savedParcel.id);
            setPage(1);
            showToast(
              mode === 'edit'
                ? `Parcela [${savedParcel.code}] ${savedParcel.name} je izmenjena.`
                : `Nova parcela [${savedParcel.code}] ${savedParcel.name} je dodata.`,
              'success'
            );
          }}
        />
      </div>
      {usageId && <MachineUsageModal contextType="work" contextId={usageId} onClose={() => setUsageId(null)} />}
    </AppLayout>
  );
};

export default RadoviDashboard;
