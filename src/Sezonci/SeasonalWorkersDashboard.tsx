import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Clock,
  Sprout,
  ClipboardList,
  Plus,
  UserPlus,
  FileSpreadsheet,
  FileText,
  Trash2,
  Edit2,
  Search,
  RotateCw,
  X,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Layers,
  MapPin,
  Phone,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { applyUnicodeFont } from '../lib/pdfFont';
import AppLayout from '../components/Layout/AppLayout';
import { TablePagination } from '../components/TablePagination/TablePagination';
import { CustomSelect, type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import styles from './SeasonalWorkers.module.css';

const API = 'http://localhost:5000/api';
const PAGE_SIZE = 25;

const COMMON_JOBS = [
  'Plevljenje luka',
  'Sečenje peruške',
  'Ručno vađenje',
  'Okopavanje',
  'Utovar vreća',
  'Klasiranje i pakovanje',
  'Čišćenje i prebiranje',
];

interface SeasonalWorker {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  groupName: string | null;
  dailyWage: number | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

interface SeasonalWorkLog {
  id: string;
  date: string;
  seasonalWorkerId: string;
  parcelId: string | null;
  jobDescription: string;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  hoursWorked: number;
  dailyWageApplied: number | null;
  supervisorId: string;
  groupName: string | null;
  groupCount: number | null;
  notes: string | null;
  seasonalWorker: SeasonalWorker;
  parcel: {
    id: string;
    code: string;
    name: string;
    currentCrop: string | null;
    areaHa: number;
  } | null;
  supervisor: {
    id: string;
    name: string;
    role: string;
  };
}

const SeasonalWorkersDashboard: React.FC = () => {
  const queryClient = useQueryClient();

  // Tab state
  const [activeTab, setActiveTab] = useState<'dnevnik' | 'analitika' | 'sifarnik'>('dnevnik');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ==========================================
  // TAB 1: Dnevnik rada filteri & paginacija
  // ==========================================
  type PeriodFilterType = 'danas' | 'nedelja' | 'mesec' | 'sve' | 'custom';

  const [logPage, setLogPage] = useState(1);
  const [logSearch, setLogSearch] = useState('');
  const [logWorkerId, setLogWorkerId] = useState('ALL');
  const [logParcelId, setLogParcelId] = useState('ALL');
  const [logGroupName, setLogGroupName] = useState('ALL');
  const [logPeriod, setLogPeriod] = useState<PeriodFilterType>('sve');
  const [logDateFrom, setLogDateFrom] = useState('');
  const [logDateTo, setLogDateTo] = useState('');

  // Reset strane pri promeni filtera dnevnika
  useEffect(() => {
    setLogPage(1);
  }, [logSearch, logWorkerId, logParcelId, logGroupName, logDateFrom, logDateTo]);

  // ==========================================
  // TAB 2: Analitika filteri & paginacija
  // ==========================================
  const AN_PAGE_SIZE = 10;
  type AnSubTabType = 'radnik' | 'dan' | 'parcela' | 'posao' | 'grupa' | 'grid';
  const [anSubTab, setAnSubTab] = useState<AnSubTabType>('radnik');
  const [anWorkerPage, setAnWorkerPage] = useState(1);
  const [anParcelPage, setAnParcelPage] = useState(1);
  const [anDayPage, setAnDayPage] = useState(1);
  const [anJobPage, setAnJobPage] = useState(1);
  const [anGroupPage, setAnGroupPage] = useState(1);

  const [anPeriod, setAnPeriod] = useState<PeriodFilterType>('sve');
  const [anDateFrom, setAnDateFrom] = useState('');
  const [anDateTo, setAnDateTo] = useState('');
  const [anParcelId, setAnParcelId] = useState('ALL');
  const [anWorkerId, setAnWorkerId] = useState('ALL');
  const [anGroupName, setAnGroupName] = useState('ALL');

  useEffect(() => {
    setAnWorkerPage(1);
    setAnParcelPage(1);
    setAnDayPage(1);
    setAnJobPage(1);
    setAnGroupPage(1);
  }, [anDateFrom, anDateTo, anParcelId, anWorkerId, anGroupName]);

  // Pomoćna funkcija za računanje raspona datuma
  const getPeriodDates = (p: PeriodFilterType) => {
    const now = new Date();
    const formatYMD = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (p === 'danas') {
      const today = formatYMD(now);
      return { from: today, to: today };
    } else if (p === 'nedelja') {
      const day = now.getDay();
      const diff = (day === 0 ? -6 : 1) - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diff);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: formatYMD(monday), to: formatYMD(sunday) };
    } else if (p === 'mesec') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: formatYMD(firstDay), to: formatYMD(lastDay) };
    } else if (p === 'sve') {
      return { from: '', to: '' };
    }
    return null;
  };

  const handleLogPeriodChange = (newPeriod: PeriodFilterType) => {
    setLogPeriod(newPeriod);
    setLogPage(1);
    if (newPeriod !== 'custom') {
      const dates = getPeriodDates(newPeriod);
      if (dates) {
        setLogDateFrom(dates.from);
        setLogDateTo(dates.to);
      }
    }
  };

  const handleAnPeriodChange = (newPeriod: PeriodFilterType) => {
    setAnPeriod(newPeriod);
    if (newPeriod !== 'custom') {
      const dates = getPeriodDates(newPeriod);
      if (dates) {
        setAnDateFrom(dates.from);
        setAnDateTo(dates.to);
      }
    }
  };

  // ==========================================
  // TAB 3: Šifarnik filteri & paginacija
  // ==========================================
  const [wPage, setWPage] = useState(1);
  const [wSearch, setWSearch] = useState('');
  const [wFilterGroup, setWFilterGroup] = useState('ALL');
  const [wFilterActive, setWFilterActive] = useState('ALL');

  useEffect(() => {
    setWPage(1);
  }, [wSearch, wFilterGroup, wFilterActive]);

  // ==========================================
  // Modali state
  // ==========================================
  const [workerModalOpen, setWorkerModalOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<SeasonalWorker | null>(null);

  const [wFormName, setWFormName] = useState('');
  const [wFormPhone, setWFormPhone] = useState('');
  const [wFormCity, setWFormCity] = useState('');
  const [wFormGroup, setWFormGroup] = useState('');
  const [wFormDailyWage, setWFormDailyWage] = useState<string>('');
  const [wFormNotes, setWFormNotes] = useState('');
  const [wFormIsActive, setWFormIsActive] = useState(true);

  // Pojedinačni unos rada modal
  const [singleLogModalOpen, setSingleLogModalOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<SeasonalWorkLog | null>(null);
  const [logToDelete, setLogToDelete] = useState<SeasonalWorkLog | null>(null);
  const [sLogWorkerId, setSLogWorkerId] = useState('');
  const [sLogParcelId, setSLogParcelId] = useState('');
  const [sLogJob, setSLogJob] = useState('');
  const [sLogDate, setSLogDate] = useState(new Date().toISOString().split('T')[0]);
  const [sLogStartTime, setSLogStartTime] = useState('07:00');
  const [sLogEndTime, setSLogEndTime] = useState('15:30');
  const [sLogBreak, setSLogBreak] = useState('30');
  const [sLogWage, setSLogWage] = useState('');
  const [sLogNotes, setSLogNotes] = useState('');

  // Grupni unos rada po grupama modal
  const [groupLogModalOpen, setGroupLogModalOpen] = useState(false);
  const [gSelectedWorkerIds, setGSelectedWorkerIds] = useState<string[]>([]);
  const [gQuickGroupSelect, setGQuickGroupSelect] = useState('ALL');
  const [gParcelId, setGParcelId] = useState('');
  const [gJob, setGJob] = useState('');
  const [gDate, setGDate] = useState(new Date().toISOString().split('T')[0]);
  const [gStartTime, setGStartTime] = useState('07:00');
  const [gEndTime, setGEndTime] = useState('15:30');
  const [gBreak, setGBreak] = useState('30');
  const [gUnifiedWage, setGUnifiedWage] = useState('');
  const [gNotes, setGNotes] = useState('');

  // Grupe sezonaca modal
  const [groupManagerModalOpen, setGroupManagerModalOpen] = useState(false);
  const [newGroupNameInput, setNewGroupNameInput] = useState('');
  const [groupToAddTo, setGroupToAddTo] = useState<string>('');
  const [workerToAddToGroup, setWorkerToAddToGroup] = useState<string>('');

  // Stanja za modale potvrde (izbacivanje radnika iz grupe / brisanje grupe)
  const [workerToRemove, setWorkerToRemove] = useState<{
    groupName: string;
    workerId: string;
    workerName: string;
  } | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);

  // ==========================================
  // React Query: Učitavanje podataka
  // ==========================================

  // 1. Svi aktivni radnici (za dropdown menije i grupni unos)
  const { data: allActiveWorkersData } = useQuery({
    queryKey: ['seasonal-all-workers'],
    queryFn: async () => {
      const res = await fetch(`${API}/seasonal/workers?limit=all&isActive=true`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Greška pri dohvatanju radnika.');
      return res.json();
    },
  });
  const allActiveWorkers: SeasonalWorker[] = allActiveWorkersData?.workers || [];
  const groupNamesList: string[] = allActiveWorkersData?.groupNames || [];

  // 2. Parcele iz šifarnika
  const { data: parcelsData } = useQuery({
    queryKey: ['master-parcels'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/parcels`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju parcela.');
      return res.json();
    },
  });
  const parcelsList: any[] = parcelsData?.parcels || [];

  // 3. Dnevnik rada (paginirano)
  const {
    data: logsData,
    isLoading: logsLoading,
  } = useQuery({
    queryKey: [
      'seasonal-logs',
      logPage,
      logSearch,
      logWorkerId,
      logParcelId,
      logGroupName,
      logDateFrom,
      logDateTo,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', String(logPage));
      params.append('limit', String(PAGE_SIZE));
      if (logSearch) params.append('search', logSearch);
      if (logWorkerId && logWorkerId !== 'ALL') params.append('workerId', logWorkerId);
      if (logParcelId && logParcelId !== 'ALL') params.append('parcelId', logParcelId);
      if (logGroupName && logGroupName !== 'ALL') params.append('groupName', logGroupName);
      if (logDateFrom) params.append('dateFrom', logDateFrom);
      if (logDateTo) params.append('dateTo', logDateTo);

      const res = await fetch(`${API}/seasonal/logs?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Greška pri dohvatanju dnevnika.');
      return res.json();
    },
    enabled: activeTab === 'dnevnik',
  });

  const logsList: SeasonalWorkLog[] = logsData?.logs || [];
  const totalLogsCount = logsData?.total || 0;
  const totalLogsPages = logsData?.totalPages || 1;

  // 4. Analitika (Zbir sati)
  const { data: summaryData } = useQuery({
    queryKey: ['seasonal-summary', anDateFrom, anDateTo, anParcelId, anWorkerId, anGroupName],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (anDateFrom) params.append('dateFrom', anDateFrom);
      if (anDateTo) params.append('dateTo', anDateTo);
      if (anParcelId && anParcelId !== 'ALL') params.append('parcelId', anParcelId);
      if (anWorkerId && anWorkerId !== 'ALL') params.append('workerId', anWorkerId);
      if (anGroupName && anGroupName !== 'ALL') params.append('groupName', anGroupName);

      const res = await fetch(`${API}/seasonal/summary?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Greška pri dohvatanju analitike.');
      return res.json();
    },
  });

  // Analitika paginacija - brojevi stavki i stranica
  const workerTotalItems = summaryData?.byWorker?.length || 0;
  const workerTotalPages = Math.max(1, Math.ceil(workerTotalItems / AN_PAGE_SIZE));
  const pagedByWorker = useMemo(() => {
    if (!summaryData?.byWorker) return [];
    const start = (anWorkerPage - 1) * AN_PAGE_SIZE;
    return summaryData.byWorker.slice(start, start + AN_PAGE_SIZE);
  }, [summaryData?.byWorker, anWorkerPage]);

  const parcelTotalItems = summaryData?.byParcel?.length || 0;
  const parcelTotalPages = Math.max(1, Math.ceil(parcelTotalItems / AN_PAGE_SIZE));
  const pagedByParcel = useMemo(() => {
    if (!summaryData?.byParcel) return [];
    const start = (anParcelPage - 1) * AN_PAGE_SIZE;
    return summaryData.byParcel.slice(start, start + AN_PAGE_SIZE);
  }, [summaryData?.byParcel, anParcelPage]);

  const dayTotalItems = summaryData?.byDay?.length || 0;
  const dayTotalPages = Math.max(1, Math.ceil(dayTotalItems / AN_PAGE_SIZE));
  const pagedByDay = useMemo(() => {
    if (!summaryData?.byDay) return [];
    const start = (anDayPage - 1) * AN_PAGE_SIZE;
    return summaryData.byDay.slice(start, start + AN_PAGE_SIZE);
  }, [summaryData?.byDay, anDayPage]);

  const jobTotalItems = summaryData?.byJob?.length || 0;
  const jobTotalPages = Math.max(1, Math.ceil(jobTotalItems / AN_PAGE_SIZE));
  const pagedByJob = useMemo(() => {
    if (!summaryData?.byJob) return [];
    const start = (anJobPage - 1) * AN_PAGE_SIZE;
    return summaryData.byJob.slice(start, start + AN_PAGE_SIZE);
  }, [summaryData?.byJob, anJobPage]);

  const groupTotalItems = summaryData?.byGroup?.length || 0;
  const groupTotalPages = Math.max(1, Math.ceil(groupTotalItems / AN_PAGE_SIZE));
  const pagedByGroup = useMemo(() => {
    if (!summaryData?.byGroup) return [];
    const start = (anGroupPage - 1) * AN_PAGE_SIZE;
    return summaryData.byGroup.slice(start, start + AN_PAGE_SIZE);
  }, [summaryData?.byGroup, anGroupPage]);

  // 5. Šifarnik radnika (paginirano)
  const {
    data: workersData,
    isLoading: workersLoading,
  } = useQuery({
    queryKey: ['seasonal-workers-paged', wPage, wSearch, wFilterGroup, wFilterActive],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', String(wPage));
      params.append('limit', String(PAGE_SIZE));
      if (wSearch) params.append('search', wSearch);
      if (wFilterGroup && wFilterGroup !== 'ALL') params.append('groupName', wFilterGroup);
      if (wFilterActive && wFilterActive !== 'ALL') params.append('isActive', wFilterActive);

      const res = await fetch(`${API}/seasonal/workers?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Greška pri dohvatanju radnika.');
      return res.json();
    },
    enabled: activeTab === 'sifarnik',
  });

  const pagedWorkersList: SeasonalWorker[] = workersData?.workers || [];
  const totalWorkersCount = workersData?.total || 0;
  const totalWorkersPages = workersData?.totalPages || 1;

  // 6. Sve grupe sezonaca
  const { data: groupsData, refetch: refetchGroups } = useQuery({
    queryKey: ['seasonal-groups'],
    queryFn: async () => {
      const res = await fetch(`${API}/seasonal/groups`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju grupa.');
      return res.json();
    },
  });
  const groupsList: { name: string; count: number; workers: SeasonalWorker[] }[] = groupsData?.groups || [];
  const unassignedWorkers: SeasonalWorker[] = groupsData?.unassigned || [];

  // ==========================================
  // Opcije za CustomSelect komponente
  // ==========================================

  const parcelSelectOptions: CustomSelectOption[] = useMemo(() => {
    return [
      { value: 'ALL', label: 'Sve parcele' },
      ...parcelsList.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.code})`,
        subLabel: `${p.currentCrop || 'Bez kulture'} • ${p.areaHa} ha`,
      })),
    ];
  }, [parcelsList]);

  const modalParcelOptions: CustomSelectOption[] = useMemo(() => {
    return [
      { value: '', label: '— Bez parcele (Rad u magacinu / dvorištu) —' },
      ...parcelsList.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.code})`,
        subLabel: `${p.currentCrop || 'Bez kulture'} • ${p.areaHa} ha`,
      })),
    ];
  }, [parcelsList]);

  const workerSelectOptions: CustomSelectOption[] = useMemo(() => {
    return [
      { value: 'ALL', label: 'Svi sezonci' },
      ...allActiveWorkers.map((w) => ({
        value: w.id,
        label: w.name,
        subLabel: `${w.city || 'Bez mesta'} • ${w.groupName || 'Pojedinačno'}`,
      })),
    ];
  }, [allActiveWorkers]);

  const modalWorkerOptions: CustomSelectOption[] = useMemo(() => {
    return allActiveWorkers.map((w) => ({
      value: w.id,
      label: w.name,
      subLabel: `${w.groupName ? `Grupa: ${w.groupName} • ` : ''}${w.dailyWage ? `${w.dailyWage} RSD` : 'Bez dnevnice'}`,
    }));
  }, [allActiveWorkers]);

  const groupFilterOptions: CustomSelectOption[] = useMemo(() => {
    return [
      { value: 'ALL', label: 'Sve grupe' },
      ...groupNamesList.map((g) => ({ value: g, label: g })),
    ];
  }, [groupNamesList]);

  const activeFilterOptions: CustomSelectOption[] = [
    { value: 'ALL', label: 'Svi statusi' },
    { value: 'true', label: 'Samo Aktivni' },
    { value: 'false', label: 'Samo Neaktivni' },
  ];

  // ==========================================
  // Mutacije (CRUD)
  // ==========================================

  // Kreiranje / Ažuriranje Sezonca
  const saveWorkerMutation = useMutation({
    mutationFn: async (payload: any) => {
      const isEdit = !!editingWorker;
      const url = isEdit ? `${API}/seasonal/workers/${editingWorker.id}` : `${API}/seasonal/workers`;
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri čuvanju sezonca.');
      return data;
    },
    onSuccess: (data) => {
      showToast(data.message || 'Sezonac uspešno sačuvan.');
      setWorkerModalOpen(false);
      setEditingWorker(null);
      queryClient.invalidateQueries({ queryKey: ['seasonal-workers-paged'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-all-workers'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // Brisanje / Deaktivacija Sezonca
  const deleteWorkerMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/seasonal/workers/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri brisanju.');
      return data;
    },
    onSuccess: (data) => {
      showToast(data.message);
      queryClient.invalidateQueries({ queryKey: ['seasonal-workers-paged'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-all-workers'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // Pojedinačni unos rada
  const createSingleLogMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`${API}/seasonal/logs`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri unosu rada.');
      return data;
    },
    onSuccess: (data) => {
      showToast(data.message || 'Rad uspešno unet.');
      setSingleLogModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['seasonal-logs'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-summary'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // Izmena pojedinačnog zapisa rada
  const updateSingleLogMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: any }) => {
      const res = await fetch(`${API}/seasonal/logs/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri izmeni zapisa.');
      return data;
    },
    onSuccess: (data) => {
      showToast(data.message || 'Zapis o radu uspešno izmenjen.');
      setSingleLogModalOpen(false);
      setEditingLog(null);
      queryClient.invalidateQueries({ queryKey: ['seasonal-logs'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-summary'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // Grupni unos rada po grupama
  const createGroupLogMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`${API}/seasonal/logs/group`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri grupnom unosu.');
      return data;
    },
    onSuccess: (data) => {
      showToast(data.message || 'Rad grupe uspešno evidentiran.');
      setGroupLogModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['seasonal-logs'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-summary'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // Brisanje zapisa rada
  const deleteLogMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/seasonal/logs/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri brisanju zapisa.');
      return data;
    },
    onSuccess: () => {
      showToast('Zapis o radu uspešno obrisan.');
      queryClient.invalidateQueries({ queryKey: ['seasonal-logs'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-summary'] });
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // Kreiranje nove grupe
  const createGroupMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`${API}/seasonal/groups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, workerIds: [] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri kreiranju grupe.');
      return data;
    },
    onSuccess: (data) => {
      showToast(data.message || 'Grupa uspešno kreirana.');
      setNewGroupNameInput('');
      queryClient.invalidateQueries({ queryKey: ['seasonal-groups'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-all-workers'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-workers-paged'] });
      refetchGroups();
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // Ažuriranje članova grupe
  const updateGroupMembersMutation = useMutation({
    mutationFn: async ({ groupName, workerIds }: { groupName: string; workerIds: string[] }) => {
      const res = await fetch(`${API}/seasonal/groups/${encodeURIComponent(groupName)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri izmeni grupe.');
      return data;
    },
    onSuccess: (data) => {
      showToast(data.message || 'Članovi grupe uspešno ažurirani.');
      queryClient.invalidateQueries({ queryKey: ['seasonal-groups'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-all-workers'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-workers-paged'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-summary'] });
      refetchGroups();
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // Brisanje / raspuštanje grupe
  const deleteGroupMutation = useMutation({
    mutationFn: async (groupName: string) => {
      const res = await fetch(`${API}/seasonal/groups/${encodeURIComponent(groupName)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri brisanju grupe.');
      return data;
    },
    onSuccess: (data) => {
      showToast(data.message || 'Grupa uspešno obrisana.');
      queryClient.invalidateQueries({ queryKey: ['seasonal-groups'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-all-workers'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-workers-paged'] });
      queryClient.invalidateQueries({ queryKey: ['seasonal-summary'] });
      refetchGroups();
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  const handleRemoveWorkerFromGroup = (groupName: string, workerIdToRemove: string) => {
    const currentGroup = groupsList.find((g) => g.name === groupName);
    if (!currentGroup) return;
    const remainingIds = currentGroup.workers.filter((w) => w.id !== workerIdToRemove).map((w) => w.id);
    updateGroupMembersMutation.mutate({ groupName, workerIds: remainingIds });
  };

  const handleAddWorkerToGroup = (groupName: string, workerIdToAdd: string) => {
    if (!workerIdToAdd) return;
    const currentGroup = groupsList.find((g) => g.name === groupName);
    const existingIds = currentGroup ? currentGroup.workers.map((w) => w.id) : [];
    if (!existingIds.includes(workerIdToAdd)) {
      updateGroupMembersMutation.mutate({ groupName, workerIds: [...existingIds, workerIdToAdd] });
    }
    setWorkerToAddToGroup('');
    setGroupToAddTo('');
  };

  const handleDissolveGroup = (groupName: string) => {
    deleteGroupMutation.mutate(groupName);
    setGroupToDelete(null);
  };

  // ==========================================
  // Handleri za modale
  // ==========================================

  const openNewWorkerModal = () => {
    setEditingWorker(null);
    setWFormName('');
    setWFormPhone('');
    setWFormCity('');
    setWFormGroup('');
    setWFormDailyWage('');
    setWFormNotes('');
    setWFormIsActive(true);
    setWorkerModalOpen(true);
  };

  const openEditWorkerModal = (w: SeasonalWorker) => {
    setEditingWorker(w);
    setWFormName(w.name);
    setWFormPhone(w.phone || '');
    setWFormCity(w.city || '');
    setWFormGroup(w.groupName || '');
    setWFormDailyWage(w.dailyWage ? String(w.dailyWage) : '');
    setWFormNotes(w.notes || '');
    setWFormIsActive(w.isActive);
    setWorkerModalOpen(true);
  };

  const handleSaveWorkerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!wFormName.trim()) {
      showToast('Ime i prezime je obavezno.', 'error');
      return;
    }
    saveWorkerMutation.mutate({
      name: wFormName.trim(),
      phone: wFormPhone.trim() || null,
      city: wFormCity.trim() || null,
      groupName: wFormGroup.trim() || null,
      dailyWage: wFormDailyWage ? parseFloat(wFormDailyWage) : null,
      notes: wFormNotes.trim() || null,
      isActive: wFormIsActive,
    });
  };

  const openSingleLogModal = () => {
    setEditingLog(null);
    setSLogWorkerId(allActiveWorkers[0]?.id || '');
    setSLogParcelId('');
    setSLogJob('Plevljenje luka');
    setSLogDate(new Date().toISOString().split('T')[0]);
    setSLogStartTime('07:00');
    setSLogEndTime('15:30');
    setSLogBreak('30');
    setSLogWage(allActiveWorkers[0]?.dailyWage ? String(allActiveWorkers[0].dailyWage) : '');
    setSLogNotes('');
    setSingleLogModalOpen(true);
  };

  const openEditLogModal = (log: SeasonalWorkLog) => {
    setEditingLog(log);
    setSLogWorkerId(log.seasonalWorkerId);
    setSLogParcelId(log.parcelId || '');
    setSLogJob(log.jobDescription || '');
    setSLogDate(log.date ? new Date(log.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    setSLogStartTime(log.startTime || '07:00');
    setSLogEndTime(log.endTime || '15:30');
    setSLogBreak(String(log.breakMinutes ?? 0));
    setSLogWage(log.dailyWageApplied !== null && log.dailyWageApplied !== undefined ? String(log.dailyWageApplied) : '');
    setSLogNotes(log.notes || '');
    setSingleLogModalOpen(true);
  };

  // Kada izabere radnika u single modal-u, predloži njegovu dnevnicu
  const handleSingleWorkerChange = (wId: string) => {
    setSLogWorkerId(wId);
    const worker = allActiveWorkers.find((w) => w.id === wId);
    if (worker?.dailyWage) {
      setSLogWage(String(worker.dailyWage));
    }
  };

  const handleSingleLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sLogWorkerId) {
      showToast('Morate izabrati radnika.', 'error');
      return;
    }
    if (!sLogJob.trim()) {
      showToast('Opis posla je obavezan.', 'error');
      return;
    }

    const payload = {
      seasonalWorkerId: sLogWorkerId,
      parcelId: sLogParcelId || null,
      jobDescription: sLogJob.trim(),
      date: sLogDate,
      startTime: sLogStartTime,
      endTime: sLogEndTime,
      breakMinutes: parseInt(sLogBreak, 10) || 0,
      dailyWageApplied: sLogWage ? parseFloat(sLogWage) : null,
      notes: sLogNotes.trim() || null,
    };

    if (editingLog) {
      updateSingleLogMutation.mutate({ id: editingLog.id, payload });
    } else {
      createSingleLogMutation.mutate(payload);
    }
  };

  const openGroupLogModal = () => {
    setGSelectedWorkerIds([]);
    setGQuickGroupSelect('ALL');
    setGParcelId('');
    setGJob('Plevljenje luka');
    setGDate(new Date().toISOString().split('T')[0]);
    setGStartTime('07:00');
    setGEndTime('15:30');
    setGBreak('30');
    setGUnifiedWage('');
    setGNotes('');
    setGroupLogModalOpen(true);
  };

  // Brzi odabir grupe radnika u grupnom modal-u
  const handleQuickGroupChange = (grp: string) => {
    setGQuickGroupSelect(grp);
    if (grp === 'ALL') {
      setGSelectedWorkerIds(allActiveWorkers.map((w) => w.id));
    } else if (grp === 'NONE') {
      setGSelectedWorkerIds([]);
    } else {
      const ids = allActiveWorkers.filter((w) => w.groupName === grp).map((w) => w.id);
      setGSelectedWorkerIds(ids);
    }
  };

  const toggleWorkerInGroup = (id: string) => {
    setGSelectedWorkerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleGroupLogSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (gSelectedWorkerIds.length === 0) {
      showToast('Morate označiti barem jednog radnika za grupni unos.', 'error');
      return;
    }
    if (!gJob.trim()) {
      showToast('Opis posla je obavezan.', 'error');
      return;
    }

    createGroupLogMutation.mutate({
      workerIds: gSelectedWorkerIds,
      parcelId: gParcelId || null,
      jobDescription: gJob.trim(),
      date: gDate,
      startTime: gStartTime,
      endTime: gEndTime,
      breakMinutes: parseInt(gBreak, 10) || 0,
      dailyWage: gUnifiedWage ? parseFloat(gUnifiedWage) : undefined,
      groupName: gQuickGroupSelect !== 'ALL' && gQuickGroupSelect !== 'NONE' ? gQuickGroupSelect : undefined,
      notes: gNotes.trim() || null,
    });
  };

  // Preuzimanje Excel fajla
  const handleDownloadExcel = async () => {
    try {
      const isAnalitika = activeTab === 'analitika';
      const fDateFrom = isAnalitika ? anDateFrom : logDateFrom;
      const fDateTo = isAnalitika ? anDateTo : logDateTo;
      const fParcelId = isAnalitika ? anParcelId : logParcelId;
      const fWorkerId = isAnalitika ? anWorkerId : logWorkerId;
      const fGroupName = isAnalitika ? anGroupName : logGroupName;

      const params = new URLSearchParams();
      if (fDateFrom) params.append('dateFrom', fDateFrom);
      if (fDateTo) params.append('dateTo', fDateTo);
      if (fParcelId && fParcelId !== 'ALL') params.append('parcelId', fParcelId);
      if (fWorkerId && fWorkerId !== 'ALL') params.append('workerId', fWorkerId);
      if (fGroupName && fGroupName !== 'ALL') params.append('groupName', fGroupName);

      const res = await fetch(`${API}/seasonal/export-excel?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Greška pri generisanju Excel izvoza.');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Evidencija_sezonaca_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      showToast('Excel izveštaj uspešno preuzet.');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  // Preuzimanje PDF fajla za blagajnu
  const handleDownloadPdf = async () => {
    try {
      setIsExportingPdf(true);
      const isAnalitika = activeTab === 'analitika';
      const fDateFrom = isAnalitika ? anDateFrom : logDateFrom;
      const fDateTo = isAnalitika ? anDateTo : logDateTo;
      const fParcelId = isAnalitika ? anParcelId : logParcelId;
      const fWorkerId = isAnalitika ? anWorkerId : logWorkerId;
      const fGroupName = isAnalitika ? anGroupName : logGroupName;

      const params = new URLSearchParams();
      params.append('limit', 'all'); // preuzmi sve filtrirane zapise bez limita za štampu
      if (fDateFrom) params.append('dateFrom', fDateFrom);
      if (fDateTo) params.append('dateTo', fDateTo);
      if (fParcelId && fParcelId !== 'ALL') params.append('parcelId', fParcelId);
      if (fWorkerId && fWorkerId !== 'ALL') params.append('workerId', fWorkerId);
      if (fGroupName && fGroupName !== 'ALL') params.append('groupName', fGroupName);

      const res = await fetch(`${API}/seasonal/logs?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Greška pri dohvatanju podataka za PDF.');
      const data = await res.json();
      const exportLogs: SeasonalWorkLog[] = data.logs || [];

      if (exportLogs.length === 0) {
        showToast('Nema podataka za štampu prema izabranim filterima.', 'error');
        return;
      }

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const hasUnicodeFont = await applyUnicodeFont(doc);
      const fontName = hasUnicodeFont ? 'Roboto' : 'helvetica';

      doc.setFont(fontName, 'bold');
      doc.setFontSize(14);
      doc.setTextColor(22, 101, 52);
      doc.text('NANDRA — EVIDENCIJA RADA SEZONSKIH RADNIKA I BLAGAJNA', 14, 15);

      const periodLabel =
        logDateFrom && logDateTo
          ? `Period: ${logDateFrom} do ${logDateTo}`
          : logDateFrom
            ? `Od datuma: ${logDateFrom}`
            : logDateTo
              ? `Do datuma: ${logDateTo}`
              : `Svi unosi (na dan: ${new Date().toLocaleDateString('sr-RS')})`;

      doc.setFont(fontName, 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Filter: ${periodLabel} | Generisano: ${new Date().toLocaleDateString('sr-RS')} | Ukupno: ${exportLogs.length} zapisa`,
        14,
        21
      );

      let totalHours = 0;
      let totalWage = 0;

      const tableData = exportLogs.map((l, idx) => {
        const h = Number(l.hoursWorked) || 0;
        const w = Number(l.dailyWageApplied) || 0;
        totalHours += h;
        totalWage += w;

        const dateStr = new Date(l.date).toLocaleDateString('sr-RS');
        const parcelStr = l.parcel ? `${l.parcel.name} (${l.parcel.code})` : 'Magacin / Dvorište';
        const timeStr = l.startTime && l.endTime ? `${l.startTime} - ${l.endTime}` : '—';
        const breakStr = l.breakMinutes > 0 ? `${l.breakMinutes} min` : '0';

        return [
          idx + 1,
          dateStr,
          l.seasonalWorker.name,
          l.groupName || l.seasonalWorker.groupName || '—',
          parcelStr,
          l.jobDescription,
          timeStr,
          breakStr,
          `${h.toFixed(2)} h`,
          w > 0 ? `${w.toLocaleString('sr-RS')} RSD` : '—',
          l.supervisor?.name || '—',
          '', // Polje za svojeručni potpis radnika za prijem novca
        ];
      });

      autoTable(doc, {
        head: [
          [
            'RB',
            'Datum',
            'Radnik',
            'Grupa',
            'Parcela',
            'Posao',
            'Vreme',
            'Pauza',
            'Sati',
            'Dnevnica',
            'Nadzor',
            'Potpis Radnika',
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
            '',
            '',
            '',
            `${totalHours.toFixed(2)} h`,
            totalWage > 0 ? `${totalWage.toLocaleString('sr-RS')} RSD` : '—',
            '',
            '',
          ],
        ],
        startY: 25,
        styles: { font: fontName, fontStyle: 'normal', fontSize: 8, cellPadding: 2 },
        headStyles: { font: fontName, fontStyle: 'bold', fillColor: [30, 41, 59], textColor: [255, 255, 255] },
        footStyles: { font: fontName, fontStyle: 'bold', fillColor: [22, 101, 52], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 20, halign: 'center' },
          2: { cellWidth: 35 },
          3: { cellWidth: 25 },
          4: { cellWidth: 30 },
          5: { cellWidth: 35 },
          6: { cellWidth: 22, halign: 'center' },
          7: { cellWidth: 15, halign: 'center' },
          8: { cellWidth: 18, halign: 'right' },
          9: { cellWidth: 24, halign: 'right' },
          10: { cellWidth: 25 },
          11: { cellWidth: 30 },
        },
      });

      doc.save(`nandra_sezonci_blagajna_${new Date().toISOString().slice(0, 10)}.pdf`);
      showToast('PDF izveštaj za blagajnu uspešno generisan!', 'success');
    } catch (err: any) {
      showToast(err.message || 'Greška pri generisanju PDF-a.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Formatiranje datuma
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('sr-RS');
  };

  return (
    <AppLayout pageTitle="Sezonski Radnici">
      <div className={styles.container}>
        {/* Toast Notifikacija */}
        {toastMessage && (
          <div
            style={{
              position: 'fixed',
              top: '1.5rem',
              right: '1.5rem',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              padding: '0.8rem 1.25rem',
              borderRadius: '10px',
              backgroundColor: toastMessage.type === 'success' ? '#16a34a' : '#ef4444',
              color: '#ffffff',
              fontWeight: 600,
              boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
              fontSize: '0.9rem',
            }}
          >
            {toastMessage.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{toastMessage.text}</span>
          </div>
        )}

        {/* Header Bar */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <Users size={26} color="#16a34a" />
              Sezonski Radnici & Dnevna Evidencija
            </h2>
            <div className={styles.subtitle}>
              Evidencija ručnog rada na parcelama, grupni unos rada, zbir sati i blagajnički spisak
            </div>
          </div>

          <div className={styles.headerActions}>
            <button className={styles.btnPrimary} onClick={openSingleLogModal}>
              <Plus size={16} />
              <span>Novi radni dan</span>
            </button>
            <button className={styles.btnGroupAction} onClick={openGroupLogModal}>
              <Users size={16} />
              <span>Grupni unos rada</span>
            </button>
            <button className={styles.btnExcel} onClick={handleDownloadExcel} title="Preuzmi Excel spisak">
              <FileSpreadsheet size={16} />
              <span>Excel blagajna</span>
            </button>
            <button
              className={styles.btnPdf}
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              title="Preuzmi PDF spisak za štampu i potpis"
            >
              <FileText size={16} />
              <span>{isExportingPdf ? 'Generisanje...' : 'PDF blagajna'}</span>
            </button>
          </div>
        </div>

        {/* KPI Kartice */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconGreen}`}>
              <Users size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{allActiveWorkers.length}</div>
              <div className={styles.statLabel}>Aktivnih sezonaca</div>
              <div className={styles.statSubtext}>{groupNamesList.length} formiranih grupa</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconBlue}`}>
              <Clock size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{summaryData?.totals?.totalHours || 0} h</div>
              <div className={styles.statLabel}>Ukupno radnih sati</div>
              <div className={styles.statSubtext}>Efektivno vreme rada</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconAmber}`}>
              <Sprout size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{summaryData?.byParcel?.length || 0}</div>
              <div className={styles.statLabel}>Obrađenih parcela</div>
              <div className={styles.statSubtext}>Lokacije pod ručnim radom</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconPurple}`}>
              <ClipboardList size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{summaryData?.totals?.totalLogs || 0}</div>
              <div className={styles.statLabel}>Evidentiranih unosa</div>
              <div className={styles.statSubtext}>
                {summaryData?.totals?.totalDailyWage
                  ? `${summaryData.totals.totalDailyWage.toLocaleString('sr-RS')} RSD dnevnica`
                  : 'Bez unetih dnevnica'}
              </div>
            </div>
          </div>
        </div>

        {/* Tabovi */}
        <div className={styles.tabsContainer}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'dnevnik' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('dnevnik')}
          >
            <ClipboardList size={18} />
            <span>Dnevnik rada & Unosi</span>
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'analitika' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('analitika')}
          >
            <Clock size={18} />
            <span>Analitika & Zbir sati</span>
          </button>
          <button
            className={`${styles.tabBtn} ${activeTab === 'sifarnik' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('sifarnik')}
          >
            <Users size={18} />
            <span>Šifarnik sezonaca</span>
          </button>
        </div>

        {/* ========================================================= */}
        {/* TAB 1: DNEVNIK RADA & UNOSI                               */}
        {/* ========================================================= */}
        {activeTab === 'dnevnik' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Filter Bar */}
            <div className={styles.filterBar}>
              {/* Brzi period filter (Danas, Ova nedelja, Ovaj mesec, Sve, Prilagođeni raspon) */}
              <div className={styles.periodRow}>
                <div className={styles.periodButtonGroup}>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${logPeriod === 'danas' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleLogPeriodChange('danas')}
                  >
                    Danas
                  </button>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${logPeriod === 'nedelja' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleLogPeriodChange('nedelja')}
                  >
                    Ova nedelja
                  </button>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${logPeriod === 'mesec' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleLogPeriodChange('mesec')}
                  >
                    Ovaj mesec
                  </button>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${logPeriod === 'sve' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleLogPeriodChange('sve')}
                  >
                    Sve
                  </button>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${logPeriod === 'custom' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleLogPeriodChange('custom')}
                  >
                    Prilagođeni raspon
                  </button>
                </div>

                {logPeriod === 'custom' && (
                  <div className={styles.dateRangeInputs}>
                    <span>Od:</span>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={logDateFrom}
                      onChange={(e) => {
                        setLogDateFrom(e.target.value);
                        setLogPeriod('custom');
                      }}
                    />
                    <span>Do:</span>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={logDateTo}
                      onChange={(e) => {
                        setLogDateTo(e.target.value);
                        setLogPeriod('custom');
                      }}
                    />
                  </div>
                )}
              </div>

              <div className={styles.filterControlsRow}>
                <div className={styles.searchBox}>
                  <Search size={16} color="var(--text-muted)" />
                  <input
                    type="text"
                    placeholder="Pretraži po radniku, poslu ili parceli..."
                    className={styles.searchInput}
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                  />
                </div>

                <div style={{ minWidth: 200, flex: '1 1 200px' }}>
                  <CustomSelect
                    value={logWorkerId}
                    onChange={setLogWorkerId}
                    options={workerSelectOptions}
                    searchable={true}
                    placeholder="Svi sezonci"
                  />
                </div>

                <div style={{ minWidth: 200, flex: '1 1 200px' }}>
                  <CustomSelect
                    value={logParcelId}
                    onChange={setLogParcelId}
                    options={parcelSelectOptions}
                    searchable={true}
                    placeholder="Sve parcele"
                  />
                </div>

                <div style={{ minWidth: 180, flex: '1 1 180px' }}>
                  <CustomSelect
                    value={logGroupName}
                    onChange={setLogGroupName}
                    options={groupFilterOptions}
                    searchable={false}
                    placeholder="Sve grupe"
                  />
                </div>

                {(logSearch ||
                  logWorkerId !== 'ALL' ||
                  logParcelId !== 'ALL' ||
                  logGroupName !== 'ALL' ||
                  logPeriod !== 'sve' ||
                  logDateFrom ||
                  logDateTo) && (
                    <button
                      className={styles.btnSecondary}
                      onClick={() => {
                        setLogSearch('');
                        setLogWorkerId('ALL');
                        setLogParcelId('ALL');
                        setLogGroupName('ALL');
                        setLogPeriod('sve');
                        setLogDateFrom('');
                        setLogDateTo('');
                      }}
                    >
                      Poništi filtere
                    </button>
                  )}
              </div>
            </div>

            {/* Tabela Logova */}
            <div className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <span className={styles.tableTitle}>
                  <ClipboardList size={18} color="#16a34a" />
                  Evidentirani Radni Dani
                </span>
                <span className={styles.tableCountBadge}>
                  Ukupno zapisa: {totalLogsCount} | Strana {logPage} od {totalLogsPages}
                </span>
              </div>

              <div className={styles.tableWrapper}>
                {logsLoading ? (
                  <div className={styles.emptyState}>
                    <RotateCw size={32} className="spin" />
                    <div className={styles.emptyStateTitle}>Učitavanje evidencije rada...</div>
                  </div>
                ) : logsList.length === 0 ? (
                  <div className={styles.emptyState}>
                    <ClipboardList size={40} color="var(--text-muted)" />
                    <div className={styles.emptyStateTitle}>Nema pronađenih zapisa</div>
                    <div className={styles.emptyStateDesc}>
                      Nijedan radni dan ne odgovara izabranim filterima ili još uvek niste evidentirali rad.
                    </div>
                  </div>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Datum</th>
                        <th>Sezonski Radnik</th>
                        <th>Grupa</th>
                        <th>Parcela</th>
                        <th>Vrsta Posla</th>
                        <th>Vreme Rada</th>
                        <th>Sati</th>
                        <th>Dnevnica (RSD)</th>
                        <th>Nadzor</th>
                        <th style={{ textAlign: 'right' }}>Akcije</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logsList.map((log) => (
                        <tr key={log.id}>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <strong>{formatDate(log.date)}</strong>
                          </td>
                          <td>
                            <div className={styles.workerCell}>
                              <span className={styles.workerName}>{log.seasonalWorker.name}</span>
                              <span className={styles.workerDetails}>
                                {log.seasonalWorker.city || '—'} • {log.seasonalWorker.phone || '—'}
                              </span>
                            </div>
                          </td>
                          <td>
                            {log.groupName || log.seasonalWorker.groupName ? (
                              <span className={styles.groupBadge}>
                                {log.groupName || log.seasonalWorker.groupName}
                                {log.groupCount ? ` (${log.groupCount})` : ''}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>Pojedinačno</span>
                            )}
                          </td>
                          <td>
                            {log.parcel ? (
                              <span className={styles.parcelBadge}>
                                <Sprout size={12} />
                                <span>{log.parcel.name}</span>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>Magacin / Dvorište</span>
                            )}
                          </td>
                          <td>
                            <span className={styles.jobBadge}>{log.jobDescription}</span>
                          </td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            {log.startTime && log.endTime ? (
                              <span>
                                {log.startTime} – {log.endTime}
                                {log.breakMinutes > 0 && (
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 4 }}>
                                    (-{log.breakMinutes}m)
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            <span className={styles.hoursValue}>{log.hoursWorked} h</span>
                          </td>
                          <td>
                            {log.dailyWageApplied ? (
                              <span className={styles.wageValue}>
                                {log.dailyWageApplied.toLocaleString('sr-RS')}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                              {log.supervisor.name}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div className={styles.actionBtns} style={{ justifyContent: 'flex-end', gap: '0.4rem' }}>
                              <button
                                className={styles.actionBtn}
                                title="Izmeni zapis rada"
                                onClick={() => openEditLogModal(log)}
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                                title="Obriši zapis rada"
                                onClick={() => setLogToDelete(log)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Paginacija */}
              <TablePagination
                currentPage={logPage}
                totalPages={totalLogsPages}
                totalItems={totalLogsCount}
                pageSize={PAGE_SIZE}
                onPageChange={setLogPage}
                itemName="zapisa rada"
              />
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: ANALITIKA & ZBIR SATI                              */}
        {/* ========================================================= */}
        {activeTab === 'analitika' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Filter Bar za analitiku */}
            <div className={styles.filterBar}>
              {/* Brzi period filter (Danas, Ova nedelja, Ovaj mesec, Sve, Prilagođeni raspon) */}
              <div className={styles.periodRow}>
                <div className={styles.periodButtonGroup}>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${anPeriod === 'danas' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleAnPeriodChange('danas')}
                  >
                    Danas
                  </button>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${anPeriod === 'nedelja' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleAnPeriodChange('nedelja')}
                  >
                    Ova nedelja
                  </button>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${anPeriod === 'mesec' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleAnPeriodChange('mesec')}
                  >
                    Ovaj mesec
                  </button>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${anPeriod === 'sve' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleAnPeriodChange('sve')}
                  >
                    Sve
                  </button>
                  <button
                    type="button"
                    className={`${styles.periodBtn} ${anPeriod === 'custom' ? styles.periodBtnActive : ''}`}
                    onClick={() => handleAnPeriodChange('custom')}
                  >
                    Prilagođeni raspon
                  </button>
                </div>

                {anPeriod === 'custom' && (
                  <div className={styles.dateRangeInputs}>
                    <span>Od:</span>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={anDateFrom}
                      onChange={(e) => {
                        setAnDateFrom(e.target.value);
                        setAnPeriod('custom');
                      }}
                    />
                    <span>Do:</span>
                    <input
                      type="date"
                      className={styles.dateInput}
                      value={anDateTo}
                      onChange={(e) => {
                        setAnDateTo(e.target.value);
                        setAnPeriod('custom');
                      }}
                    />
                  </div>
                )}
              </div>

              <div className={styles.filterControlsRow}>
                <div style={{ minWidth: 220, flex: '1 1 220px' }}>
                  <CustomSelect
                    value={anParcelId}
                    onChange={setAnParcelId}
                    options={parcelSelectOptions}
                    searchable={true}
                    placeholder="Sve parcele"
                  />
                </div>

                <div style={{ minWidth: 220, flex: '1 1 220px' }}>
                  <CustomSelect
                    value={anWorkerId}
                    onChange={setAnWorkerId}
                    options={workerSelectOptions}
                    searchable={true}
                    placeholder="Svi sezonci"
                  />
                </div>

                <div style={{ minWidth: 180, flex: '1 1 180px' }}>
                  <CustomSelect
                    value={anGroupName}
                    onChange={setAnGroupName}
                    options={groupFilterOptions}
                    placeholder="Sve grupe"
                  />
                </div>

                {(anDateFrom || anDateTo || anParcelId !== 'ALL' || anWorkerId !== 'ALL' || anGroupName !== 'ALL' || anPeriod !== 'sve') && (
                  <button
                    className={styles.btnSecondary}
                    onClick={() => {
                      setAnPeriod('sve');
                      setAnDateFrom('');
                      setAnDateTo('');
                      setAnParcelId('ALL');
                      setAnWorkerId('ALL');
                      setAnGroupName('ALL');
                    }}
                  >
                    Poništi filtere
                  </button>
                )}

                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                  <button className={styles.btnExcel} onClick={handleDownloadExcel} title="Preuzmi Excel spisak">
                    <FileSpreadsheet size={16} />
                    <span>Excel</span>
                  </button>
                  <button
                    className={styles.btnPdf}
                    onClick={handleDownloadPdf}
                    disabled={isExportingPdf}
                    title="Preuzmi PDF spisak"
                  >
                    <FileText size={16} />
                    <span>{isExportingPdf ? 'PDF...' : 'PDF'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Navigacija kroz analitičke prikaze */}
            <div className={styles.subTabNav}>
              <button
                className={`${styles.subTabBtn} ${anSubTab === 'radnik' ? styles.subTabBtnActive : ''}`}
                onClick={() => setAnSubTab('radnik')}
              >
                <Users size={15} />
                <span>Po radnicima ({workerTotalItems})</span>
              </button>
              <button
                className={`${styles.subTabBtn} ${anSubTab === 'dan' ? styles.subTabBtnActive : ''}`}
                onClick={() => setAnSubTab('dan')}
              >
                <Calendar size={15} />
                <span>Po danima ({dayTotalItems})</span>
              </button>
              <button
                className={`${styles.subTabBtn} ${anSubTab === 'parcela' ? styles.subTabBtnActive : ''}`}
                onClick={() => setAnSubTab('parcela')}
              >
                <Sprout size={15} />
                <span>Po parcelama ({parcelTotalItems})</span>
              </button>
              <button
                className={`${styles.subTabBtn} ${anSubTab === 'posao' ? styles.subTabBtnActive : ''}`}
                onClick={() => setAnSubTab('posao')}
              >
                <Layers size={15} />
                <span>Po vrsti posla ({jobTotalItems})</span>
              </button>
              <button
                className={`${styles.subTabBtn} ${anSubTab === 'grupa' ? styles.subTabBtnActive : ''}`}
                onClick={() => setAnSubTab('grupa')}
              >
                <Users size={15} />
                <span>Po grupama ({groupTotalItems})</span>
              </button>
              <button
                className={`${styles.subTabBtn} ${anSubTab === 'grid' ? styles.subTabBtnActive : ''}`}
                onClick={() => setAnSubTab('grid')}
              >
                <LayoutGrid size={15} />
                <span>Sve kartice (Grid)</span>
              </button>
            </div>

            {/* Prikaz 1: Puna tabela po radnicima sa paginacijom */}
            {anSubTab === 'radnik' && (
              <div className={styles.tableCard}>
                <div className={styles.tableHeaderBar}>
                  <div className={styles.tableTitle}>
                    <Users size={18} color="#16a34a" />
                    <span>Zbir Sati po Radniku</span>
                  </div>
                  <span className={styles.tableCountBadge}>
                    Ukupno: {workerTotalItems} radnika
                  </span>
                </div>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Radnik</th>
                        <th>Grupa</th>
                        <th style={{ textAlign: 'center' }}>Odrađeno dana</th>
                        <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                        <th style={{ textAlign: 'right' }}>Dnevnice (RSD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedByWorker.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                            Nema podataka za izabrani period.
                          </td>
                        </tr>
                      ) : (
                        pagedByWorker.map((w: any) => (
                          <tr key={w.workerId}>
                            <td><strong>{w.name}</strong></td>
                            <td><span className={styles.groupBadge}>{w.groupName}</span></td>
                            <td style={{ textAlign: 'center' }}>{w.totalDays} dana</td>
                            <td style={{ textAlign: 'right' }}><strong>{w.totalHours} h</strong></td>
                            <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                              {w.totalWage > 0 ? w.totalWage.toLocaleString('sr-RS') : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  currentPage={anWorkerPage}
                  totalPages={workerTotalPages}
                  totalItems={workerTotalItems}
                  pageSize={AN_PAGE_SIZE}
                  onPageChange={setAnWorkerPage}
                  itemName="radnika"
                />
              </div>
            )}

            {/* Prikaz 2: Puna tabela po danima sa paginacijom */}
            {anSubTab === 'dan' && (
              <div className={styles.tableCard}>
                <div className={styles.tableHeaderBar}>
                  <div className={styles.tableTitle}>
                    <Calendar size={18} color="#d97706" />
                    <span>Dnevni Presek Angažovanja Sezonaca</span>
                  </div>
                  <span className={styles.tableCountBadge}>
                    Ukupno: {dayTotalItems} dana
                  </span>
                </div>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Datum</th>
                        <th style={{ textAlign: 'center' }}>Broj radnika</th>
                        <th style={{ textAlign: 'center' }}>Ukupno unosa</th>
                        <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                        <th style={{ textAlign: 'right' }}>Dnevni trošak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedByDay.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                            Nema podataka za izabrani period.
                          </td>
                        </tr>
                      ) : (
                        pagedByDay.map((d: any) => (
                          <tr key={d.date}>
                            <td><strong>{formatDate(d.date)}</strong></td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={styles.groupBadge}>{d.workerCount} radnika</span>
                            </td>
                            <td style={{ textAlign: 'center' }}>{d.logsCount}</td>
                            <td style={{ textAlign: 'right' }}><strong>{d.totalHours} h</strong></td>
                            <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                              {d.totalWage > 0 ? `${d.totalWage.toLocaleString('sr-RS')} RSD` : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  currentPage={anDayPage}
                  totalPages={dayTotalPages}
                  totalItems={dayTotalItems}
                  pageSize={AN_PAGE_SIZE}
                  onPageChange={setAnDayPage}
                  itemName="dana"
                />
              </div>
            )}

            {/* Prikaz 3: Puna tabela po parcelama sa paginacijom */}
            {anSubTab === 'parcela' && (
              <div className={styles.tableCard}>
                <div className={styles.tableHeaderBar}>
                  <div className={styles.tableTitle}>
                    <Sprout size={18} color="#0284c7" />
                    <span>Utrošak Ručnog Rada po Parceli</span>
                  </div>
                  <span className={styles.tableCountBadge}>
                    Ukupno: {parcelTotalItems} lokacija
                  </span>
                </div>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Parcela</th>
                        <th>Kultura</th>
                        <th style={{ textAlign: 'center' }}>Broj radnih dana</th>
                        <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                        <th style={{ textAlign: 'right' }}>Trošak dnevnica</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedByParcel.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                            Nema podataka za izabrani period.
                          </td>
                        </tr>
                      ) : (
                        pagedByParcel.map((p: any) => (
                          <tr key={p.parcelId || 'none'}>
                            <td><strong>{p.name}</strong></td>
                            <td><span className={styles.parcelBadge}>{p.crop}</span></td>
                            <td style={{ textAlign: 'center' }}>{p.logsCount} unosa</td>
                            <td style={{ textAlign: 'right' }}><strong>{p.totalHours} h</strong></td>
                            <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                              {p.totalWage > 0 ? `${p.totalWage.toLocaleString('sr-RS')} RSD` : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  currentPage={anParcelPage}
                  totalPages={parcelTotalPages}
                  totalItems={parcelTotalItems}
                  pageSize={AN_PAGE_SIZE}
                  onPageChange={setAnParcelPage}
                  itemName="lokacija"
                />
              </div>
            )}

            {/* Prikaz 4: Puna tabela po vrsti posla sa paginacijom */}
            {anSubTab === 'posao' && (
              <div className={styles.tableCard}>
                <div className={styles.tableHeaderBar}>
                  <div className={styles.tableTitle}>
                    <Layers size={18} color="#9333ea" />
                    <span>Zbir Sati po Vrsti Posla</span>
                  </div>
                  <span className={styles.tableCountBadge}>
                    Ukupno: {jobTotalItems} poslova
                  </span>
                </div>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Vrsta Posla</th>
                        <th style={{ textAlign: 'center' }}>Broj unosa</th>
                        <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                        <th style={{ textAlign: 'right' }}>Trošak dnevnica</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedByJob.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                            Nema podataka za izabrani period.
                          </td>
                        </tr>
                      ) : (
                        pagedByJob.map((j: any) => (
                          <tr key={j.jobDescription}>
                            <td><strong>{j.jobDescription}</strong></td>
                            <td style={{ textAlign: 'center' }}>{j.logsCount} unosa</td>
                            <td style={{ textAlign: 'right' }}><strong>{j.totalHours} h</strong></td>
                            <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                              {j.totalWage > 0 ? `${j.totalWage.toLocaleString('sr-RS')} RSD` : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  currentPage={anJobPage}
                  totalPages={jobTotalPages}
                  totalItems={jobTotalItems}
                  pageSize={AN_PAGE_SIZE}
                  onPageChange={setAnJobPage}
                  itemName="poslova"
                />
              </div>
            )}

            {/* Prikaz 5: Puna tabela po grupama sa paginacijom */}
            {anSubTab === 'grupa' && (
              <div className={styles.tableCard}>
                <div className={styles.tableHeaderBar}>
                  <div className={styles.tableTitle}>
                    <Users size={18} color="#0284c7" />
                    <span>Zbir Sati i Trošak po Grupama</span>
                  </div>
                  <span className={styles.tableCountBadge}>
                    Ukupno: {groupTotalItems} grupa
                  </span>
                </div>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Grupa</th>
                        <th style={{ textAlign: 'center' }}>Broj radnika</th>
                        <th style={{ textAlign: 'center' }}>Broj smena</th>
                        <th style={{ textAlign: 'right' }}>Prosečno h/radnik</th>
                        <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                        <th style={{ textAlign: 'right' }}>Trošak dnevnica</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedByGroup.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                            Nema evidentiranih podataka po grupama za izabrani period.
                          </td>
                        </tr>
                      ) : (
                        pagedByGroup.map((g: any) => (
                          <tr key={g.groupName}>
                            <td>
                              <strong style={{ color: '#0369a1' }}>{g.groupName}</strong>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={styles.groupBadge}>{g.workerCount} radnika</span>
                            </td>
                            <td style={{ textAlign: 'center' }}>{g.logsCount}</td>
                            <td style={{ textAlign: 'right' }}>{g.avgHoursPerWorker} h</td>
                            <td style={{ textAlign: 'right' }}>
                              <strong>{g.totalHours} h</strong>
                            </td>
                            <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                              {g.totalWage > 0 ? `${g.totalWage.toLocaleString('sr-RS')} RSD` : '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <TablePagination
                  currentPage={anGroupPage}
                  totalPages={groupTotalPages}
                  totalItems={groupTotalItems}
                  pageSize={AN_PAGE_SIZE}
                  onPageChange={setAnGroupPage}
                  itemName="grupa"
                />
              </div>
            )}

            {/* Prikaz 6: Sve kartice (Grid) sa paginacijom po kartici */}
            {anSubTab === 'grid' && (
              <div className={styles.analyticsGrid}>
                {/* 1. Zbir po radniku */}
                <div className={styles.analyticsCard}>
                  <div className={styles.analyticsHeader}>
                    <span className={styles.analyticsTitle}>
                      <Users size={16} color="#16a34a" />
                      Zbir Sati po Radniku
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={styles.tableCountBadge}>
                        {workerTotalItems} radnika
                      </span>
                      <button
                        className={styles.cardViewAllBtn}
                        onClick={() => setAnSubTab('radnik')}
                        title="Otvori punu tabelu sa naprednom paginacijom"
                      >
                        Puna tabela &rarr;
                      </button>
                    </div>
                  </div>
                  <div className={styles.tableWrapper}>
                    <table className={styles.analyticsTable}>
                      <thead>
                        <tr>
                          <th>Radnik</th>
                          <th>Grupa</th>
                          <th style={{ textAlign: 'center' }}>Odrađeno dana</th>
                          <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                          <th style={{ textAlign: 'right' }}>Dnevnice (RSD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedByWorker.length === 0 ? (
                          <tr>
                            <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                              Nema podataka za izabrani period.
                            </td>
                          </tr>
                        ) : (
                          pagedByWorker.map((w: any) => (
                            <tr key={w.workerId}>
                              <td><strong>{w.name}</strong></td>
                              <td><span className={styles.groupBadge}>{w.groupName}</span></td>
                              <td style={{ textAlign: 'center' }}>{w.totalDays} dana</td>
                              <td style={{ textAlign: 'right' }}><strong>{w.totalHours} h</strong></td>
                              <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                                {w.totalWage > 0 ? w.totalWage.toLocaleString('sr-RS') : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {workerTotalItems > AN_PAGE_SIZE && (
                    <div className={styles.cardPagination}>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anWorkerPage <= 1}
                        onClick={() => setAnWorkerPage((p) => Math.max(1, p - 1))}
                        title="Prethodna strana"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className={styles.cardPageText}>
                        Strana {anWorkerPage} od {workerTotalPages} ({workerTotalItems} radnika)
                      </span>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anWorkerPage >= workerTotalPages}
                        onClick={() => setAnWorkerPage((p) => Math.min(workerTotalPages, p + 1))}
                        title="Sledeća strana"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Zbir po parceli */}
                <div className={styles.analyticsCard}>
                  <div className={styles.analyticsHeader}>
                    <span className={styles.analyticsTitle}>
                      <Sprout size={16} color="#0284c7" />
                      Utrošak Ručnog Rada po Parceli
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={styles.tableCountBadge}>
                        {parcelTotalItems} lokacija
                      </span>
                      <button
                        className={styles.cardViewAllBtn}
                        onClick={() => setAnSubTab('parcela')}
                        title="Otvori punu tabelu sa naprednom paginacijom"
                      >
                        Puna tabela &rarr;
                      </button>
                    </div>
                  </div>
                  <div className={styles.tableWrapper}>
                    <table className={styles.analyticsTable}>
                      <thead>
                        <tr>
                          <th>Parcela</th>
                          <th>Kultura</th>
                          <th style={{ textAlign: 'center' }}>Broj radnih dana</th>
                          <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                          <th style={{ textAlign: 'right' }}>Trošak dnevnica</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedByParcel.length === 0 ? (
                          <tr>
                            <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                              Nema podataka za izabrani period.
                            </td>
                          </tr>
                        ) : (
                          pagedByParcel.map((p: any) => (
                            <tr key={p.parcelId || 'none'}>
                              <td><strong>{p.name}</strong></td>
                              <td><span className={styles.parcelBadge}>{p.crop}</span></td>
                              <td style={{ textAlign: 'center' }}>{p.logsCount} unosa</td>
                              <td style={{ textAlign: 'right' }}><strong>{p.totalHours} h</strong></td>
                              <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                                {p.totalWage > 0 ? `${p.totalWage.toLocaleString('sr-RS')} RSD` : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {parcelTotalItems > AN_PAGE_SIZE && (
                    <div className={styles.cardPagination}>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anParcelPage <= 1}
                        onClick={() => setAnParcelPage((p) => Math.max(1, p - 1))}
                        title="Prethodna strana"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className={styles.cardPageText}>
                        Strana {anParcelPage} od {parcelTotalPages} ({parcelTotalItems} lokacija)
                      </span>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anParcelPage >= parcelTotalPages}
                        onClick={() => setAnParcelPage((p) => Math.min(parcelTotalPages, p + 1))}
                        title="Sledeća strana"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>

                {/* 3. Zbir po danu */}
                <div className={styles.analyticsCard}>
                  <div className={styles.analyticsHeader}>
                    <span className={styles.analyticsTitle}>
                      <Calendar size={16} color="#d97706" />
                      Dnevni Presek Angažovanja Sezonaca
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={styles.tableCountBadge}>
                        {dayTotalItems} dana
                      </span>
                      <button
                        className={styles.cardViewAllBtn}
                        onClick={() => setAnSubTab('dan')}
                        title="Otvori punu tabelu sa naprednom paginacijom"
                      >
                        Puna tabela &rarr;
                      </button>
                    </div>
                  </div>
                  <div className={styles.tableWrapper}>
                    <table className={styles.analyticsTable}>
                      <thead>
                        <tr>
                          <th>Datum</th>
                          <th style={{ textAlign: 'center' }}>Broj radnika</th>
                          <th style={{ textAlign: 'center' }}>Ukupno unosa</th>
                          <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                          <th style={{ textAlign: 'right' }}>Dnevni trošak</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedByDay.length === 0 ? (
                          <tr>
                            <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                              Nema podataka za izabrani period.
                            </td>
                          </tr>
                        ) : (
                          pagedByDay.map((d: any) => (
                            <tr key={d.date}>
                              <td><strong>{formatDate(d.date)}</strong></td>
                              <td style={{ textAlign: 'center' }}>
                                <span className={styles.groupBadge}>{d.workerCount} radnika</span>
                              </td>
                              <td style={{ textAlign: 'center' }}>{d.logsCount}</td>
                              <td style={{ textAlign: 'right' }}><strong>{d.totalHours} h</strong></td>
                              <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                                {d.totalWage > 0 ? `${d.totalWage.toLocaleString('sr-RS')} RSD` : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {dayTotalItems > AN_PAGE_SIZE && (
                    <div className={styles.cardPagination}>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anDayPage <= 1}
                        onClick={() => setAnDayPage((p) => Math.max(1, p - 1))}
                        title="Prethodna strana"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className={styles.cardPageText}>
                        Strana {anDayPage} od {dayTotalPages} ({dayTotalItems} dana)
                      </span>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anDayPage >= dayTotalPages}
                        onClick={() => setAnDayPage((p) => Math.min(dayTotalPages, p + 1))}
                        title="Sledeća strana"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>

                {/* 4. Zbir po poslu */}
                <div className={styles.analyticsCard}>
                  <div className={styles.analyticsHeader}>
                    <span className={styles.analyticsTitle}>
                      <Layers size={16} color="#9333ea" />
                      Zbir Sati po Vrsti Posla
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={styles.tableCountBadge}>
                        {jobTotalItems} poslova
                      </span>
                      <button
                        className={styles.cardViewAllBtn}
                        onClick={() => setAnSubTab('posao')}
                        title="Otvori punu tabelu sa naprednom paginacijom"
                      >
                        Puna tabela &rarr;
                      </button>
                    </div>
                  </div>
                  <div className={styles.tableWrapper}>
                    <table className={styles.analyticsTable}>
                      <thead>
                        <tr>
                          <th>Vrsta Posla</th>
                          <th style={{ textAlign: 'center' }}>Broj unosa</th>
                          <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                          <th style={{ textAlign: 'right' }}>Trošak dnevnica</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedByJob.length === 0 ? (
                          <tr>
                            <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                              Nema podataka za izabrani period.
                            </td>
                          </tr>
                        ) : (
                          pagedByJob.map((j: any) => (
                            <tr key={j.jobDescription}>
                              <td><strong>{j.jobDescription}</strong></td>
                              <td style={{ textAlign: 'center' }}>{j.logsCount} unosa</td>
                              <td style={{ textAlign: 'right' }}><strong>{j.totalHours} h</strong></td>
                              <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                                {j.totalWage > 0 ? `${j.totalWage.toLocaleString('sr-RS')} RSD` : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {jobTotalItems > AN_PAGE_SIZE && (
                    <div className={styles.cardPagination}>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anJobPage <= 1}
                        onClick={() => setAnJobPage((p) => Math.max(1, p - 1))}
                        title="Prethodna strana"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className={styles.cardPageText}>
                        Strana {anJobPage} od {jobTotalPages} ({jobTotalItems} poslova)
                      </span>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anJobPage >= jobTotalPages}
                        onClick={() => setAnJobPage((p) => Math.min(jobTotalPages, p + 1))}
                        title="Sledeća strana"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>

                {/* 5. Zbir po grupama */}
                <div className={styles.analyticsCard}>
                  <div className={styles.analyticsHeader}>
                    <span className={styles.analyticsTitle}>
                      <Users size={16} color="#0284c7" />
                      Zbir Sati i Trošak po Grupama
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span className={styles.tableCountBadge}>
                        {groupTotalItems} grupa
                      </span>
                      <button
                        className={styles.cardViewAllBtn}
                        onClick={() => setAnSubTab('grupa')}
                        title="Otvori punu tabelu sa naprednom paginacijom"
                      >
                        Puna tabela &rarr;
                      </button>
                    </div>
                  </div>
                  <div className={styles.tableWrapper}>
                    <table className={styles.analyticsTable}>
                      <thead>
                        <tr>
                          <th>Grupa</th>
                          <th style={{ textAlign: 'center' }}>Broj radnika</th>
                          <th style={{ textAlign: 'center' }}>Broj smena</th>
                          <th style={{ textAlign: 'right' }}>Prosečno h/radnik</th>
                          <th style={{ textAlign: 'right' }}>Ukupno sati</th>
                          <th style={{ textAlign: 'right' }}>Trošak dnevnica</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedByGroup.length === 0 ? (
                          <tr>
                            <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                              Nema evidentiranih podataka po grupama za izabrani period.
                            </td>
                          </tr>
                        ) : (
                          pagedByGroup.map((g: any) => (
                            <tr key={g.groupName}>
                              <td>
                                <strong style={{ color: '#0369a1' }}>{g.groupName}</strong>
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <span className={styles.groupBadge}>{g.workerCount} radnika</span>
                              </td>
                              <td style={{ textAlign: 'center' }}>{g.logsCount}</td>
                              <td style={{ textAlign: 'right' }}>{g.avgHoursPerWorker} h</td>
                              <td style={{ textAlign: 'right' }}>
                                <strong>{g.totalHours} h</strong>
                              </td>
                              <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 700 }}>
                                {g.totalWage > 0 ? `${g.totalWage.toLocaleString('sr-RS')} RSD` : '—'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  {groupTotalItems > AN_PAGE_SIZE && (
                    <div className={styles.cardPagination}>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anGroupPage <= 1}
                        onClick={() => setAnGroupPage((p) => Math.max(1, p - 1))}
                        title="Prethodna strana"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className={styles.cardPageText}>
                        Strana {anGroupPage} od {groupTotalPages} ({groupTotalItems} grupa)
                      </span>
                      <button
                        className={styles.cardPageBtn}
                        disabled={anGroupPage >= groupTotalPages}
                        onClick={() => setAnGroupPage((p) => Math.min(groupTotalPages, p + 1))}
                        title="Sledeća strana"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: ŠIFARNIK SEZONACA                                  */}
        {/* ========================================================= */}
        {activeTab === 'sifarnik' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Toolbar */}
            <div className={styles.filterBar}>
              <div className={styles.filterControlsRow}>
                <div className={styles.searchBox}>
                  <Search size={16} color="var(--text-muted)" />
                  <input
                    type="text"
                    placeholder="Pretraži po imenu, gradu, telefonu ili grupi..."
                    className={styles.searchInput}
                    value={wSearch}
                    onChange={(e) => setWSearch(e.target.value)}
                  />
                </div>

                <div style={{ minWidth: 200, flex: '1 1 200px' }}>
                  <CustomSelect
                    value={wFilterGroup}
                    onChange={setWFilterGroup}
                    options={groupFilterOptions}
                    searchable={false}
                    placeholder="Sve grupe"
                  />
                </div>

                <div style={{ minWidth: 180, flex: '1 1 180px' }}>
                  <CustomSelect
                    value={wFilterActive}
                    onChange={setWFilterActive}
                    options={activeFilterOptions}
                    searchable={false}
                    placeholder="Filter statusa"
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.6rem', marginLeft: 'auto' }}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => {
                      refetchGroups();
                      setGroupManagerModalOpen(true);
                    }}
                  >
                    <Users size={16} />
                    <span>Grupe sezonaca ({groupsList.length})</span>
                  </button>
                  <button type="button" className={styles.btnPrimary} onClick={openNewWorkerModal}>
                    <UserPlus size={16} />
                    <span>Novi sezonac</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Tabela Sezonaca */}
            <div className={styles.tableCard}>
              <div className={styles.tableHeaderBar}>
                <span className={styles.tableTitle}>
                  <Users size={18} color="#16a34a" />
                  Registar Sezonskih Radnika
                </span>
                <span className={styles.tableCountBadge}>
                  Ukupno: {totalWorkersCount} | Strana {wPage} od {totalWorkersPages}
                </span>
              </div>

              <div className={styles.tableWrapper}>
                {workersLoading ? (
                  <div className={styles.emptyState}>
                    <RotateCw size={32} className="spin" />
                    <div className={styles.emptyStateTitle}>Učitavanje šifarnika...</div>
                  </div>
                ) : pagedWorkersList.length === 0 ? (
                  <div className={styles.emptyState}>
                    <Users size={40} color="var(--text-muted)" />
                    <div className={styles.emptyStateTitle}>Nema pronađenih radnika</div>
                    <div className={styles.emptyStateDesc}>
                      Kliknite na dugme "+ Novi sezonac" da biste uneli prvog sezonskog radnika u sistem.
                    </div>
                  </div>
                ) : (
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Ime i Prezime</th>
                        <th>Grad / Mesto</th>
                        <th>Telefon</th>
                        <th>Grupa</th>
                        <th>Dnevnica (RSD)</th>
                        <th>Status</th>
                        <th>Registrovan</th>
                        <th style={{ textAlign: 'right' }}>Akcije</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedWorkersList.map((w) => (
                        <tr key={w.id}>
                          <td><strong>{w.name}</strong></td>
                          <td>
                            {w.city ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <MapPin size={13} color="var(--text-muted)" />
                                <span>{w.city}</span>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            {w.phone ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <Phone size={13} color="var(--text-muted)" />
                                <span>{w.phone}</span>
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            {w.groupName ? (
                              <span className={styles.groupBadge}>{w.groupName}</span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>Pojedinačno</span>
                            )}
                          </td>
                          <td>
                            {w.dailyWage ? (
                              <span className={styles.wageValue}>
                                {w.dailyWage.toLocaleString('sr-RS')}
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>
                          <td>
                            <span className={w.isActive ? styles.statusActive : styles.statusInactive}>
                              <span className={styles.statusDot} />
                              {w.isActive ? 'Aktivan' : 'Neaktivan'}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {formatDate(w.createdAt)}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div className={styles.actionBtns} style={{ justifyContent: 'flex-end' }}>
                              <button
                                className={styles.actionBtn}
                                title="Izmeni podatke"
                                onClick={() => openEditWorkerModal(w)}
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                                title={w.isActive ? 'Deaktiviraj radnika' : 'Obriši radnika'}
                                onClick={() => {
                                  if (window.confirm(`Da li ste sigurni da želite da uklonite ili deaktivirate radnika ${w.name}?`)) {
                                    deleteWorkerMutation.mutate(w.id);
                                  }
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Paginacija za Šifarnik */}
              <TablePagination
                currentPage={wPage}
                totalPages={totalWorkersPages}
                totalItems={totalWorkersCount}
                pageSize={PAGE_SIZE}
                onPageChange={setWPage}
                itemName="sezonaca"
              />
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL 1: NOVI / IZMENA SEZONCA                            */}
        {/* ========================================================= */}
        {workerModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setWorkerModalOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitleBox}>
                  <UserPlus size={20} color="#16a34a" />
                  <h3 className={styles.modalTitle}>
                    {editingWorker ? 'Izmena podataka o sezoncu' : 'Novi sezonski radnik'}
                  </h3>
                </div>
                <button
                  className={styles.modalClose}
                  onClick={() => setWorkerModalOpen(false)}
                  type="button"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveWorkerSubmit}>
                <div className={styles.modalBody}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Ime i prezime radnika *</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="npr. Jovan Jovanović"
                      value={wFormName}
                      onChange={(e) => setWFormName(e.target.value)}
                      required
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Broj telefona</label>
                      <input
                        type="text"
                        className={styles.formInput}
                        placeholder="+381 64..."
                        value={wFormPhone}
                        onChange={(e) => setWFormPhone(e.target.value)}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Grad / Mesto</label>
                      <input
                        type="text"
                        className={styles.formInput}
                        placeholder="npr. Senta, Kanjiža..."
                        value={wFormCity}
                        onChange={(e) => setWFormCity(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Grupa (opciono)</label>
                      <input
                        type="text"
                        className={styles.formInput}
                        placeholder="npr. Grupa Agim, Grupa 1..."
                        value={wFormGroup}
                        onChange={(e) => setWFormGroup(e.target.value)}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Dnevnica u RSD (opciono)</label>
                      <input
                        type="number"
                        step="50"
                        min="0"
                        className={styles.formInput}
                        placeholder="npr. 3000"
                        value={wFormDailyWage}
                        onChange={(e) => setWFormDailyWage(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Napomena</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="Dodatna zapažanja, kontakt prevoznika..."
                      value={wFormNotes}
                      onChange={(e) => setWFormNotes(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: 4 }}>
                    <input
                      type="checkbox"
                      id="workerIsActive"
                      checked={wFormIsActive}
                      onChange={(e) => setWFormIsActive(e.target.checked)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <label htmlFor="workerIsActive" style={{ fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                      Radnik je aktivan (dostupan za raspodelu)
                    </label>
                  </div>

                  <div className={styles.modalActions}>
                    <button
                      type="button"
                      className={styles.btnCancel}
                      onClick={() => setWorkerModalOpen(false)}
                    >
                      Otkaži
                    </button>
                    <button
                      type="submit"
                      className={styles.btnSubmit}
                      disabled={saveWorkerMutation.isPending}
                    >
                      {saveWorkerMutation.isPending ? 'Čuvanje...' : 'Sačuvaj'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL 2: POJEDINAČNI UNOS RADA                            */}
        {/* ========================================================= */}
        {singleLogModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setSingleLogModalOpen(false)}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitleBox}>
                  <ClipboardList size={20} color="#16a34a" />
                  <h3 className={styles.modalTitle}>
                    {editingLog ? 'Izmena evidencije rada za sezonca' : 'Evidencija rada za jednog sezonca'}
                  </h3>
                </div>
                <button
                  className={styles.modalClose}
                  onClick={() => setSingleLogModalOpen(false)}
                  type="button"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSingleLogSubmit}>
                <div className={styles.modalBody}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Datum rada *</label>
                    <input
                      type="date"
                      className={styles.formInput}
                      value={sLogDate}
                      onChange={(e) => setSLogDate(e.target.value)}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Sezonski radnik *</label>
                    <CustomSelect
                      value={sLogWorkerId}
                      onChange={handleSingleWorkerChange}
                      options={modalWorkerOptions}
                      searchable={true}
                      placeholder="Izaberite radnika"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Parcela (opciono)</label>
                    <CustomSelect
                      value={sLogParcelId}
                      onChange={setSLogParcelId}
                      options={modalParcelOptions}
                      searchable={true}
                      placeholder="Izaberite parcelu"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Vrsta posla *</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="npr. Plevljenje luka"
                      value={sLogJob}
                      onChange={(e) => setSLogJob(e.target.value)}
                      required
                    />
                    <div className={styles.quickJobPills}>
                      {COMMON_JOBS.map((job) => (
                        <button
                          key={job}
                          type="button"
                          className={`${styles.quickJobPill} ${sLogJob === job ? styles.quickJobPillSelected : ''}`}
                          onClick={() => setSLogJob(job)}
                        >
                          {job}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Početak rada</label>
                      <input
                        type="time"
                        className={styles.formInput}
                        value={sLogStartTime}
                        onChange={(e) => setSLogStartTime(e.target.value)}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Kraj rada</label>
                      <input
                        type="time"
                        className={styles.formInput}
                        value={sLogEndTime}
                        onChange={(e) => setSLogEndTime(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Pauza (minuti)</label>
                      <input
                        type="number"
                        min="0"
                        step="5"
                        className={styles.formInput}
                        value={sLogBreak}
                        onChange={(e) => setSLogBreak(e.target.value)}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Dnevnica za ovaj dan (RSD)</label>
                      <input
                        type="number"
                        step="50"
                        min="0"
                        className={styles.formInput}
                        placeholder="npr. 3000"
                        value={sLogWage}
                        onChange={(e) => setSLogWage(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Napomena</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="Komentar, učinak, specifičnosti parcele..."
                      value={sLogNotes}
                      onChange={(e) => setSLogNotes(e.target.value)}
                    />
                  </div>

                  <div className={styles.modalActions}>
                    <button
                      type="button"
                      className={styles.btnCancel}
                      onClick={() => setSingleLogModalOpen(false)}
                    >
                      Otkaži
                    </button>
                    <button
                      type="submit"
                      className={styles.btnSubmit}
                      disabled={createSingleLogMutation.isPending || updateSingleLogMutation.isPending}
                    >
                      {editingLog
                        ? updateSingleLogMutation.isPending
                          ? 'Čuvanje izmena...'
                          : 'Sačuvaj izmene'
                        : createSingleLogMutation.isPending
                        ? 'Evidentiranje...'
                        : 'Evidentiraj rad'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL 3: GRUPNI UNOS RADA NA NJIVU                        */}
        {/* ========================================================= */}
        {groupLogModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setGroupLogModalOpen(false)}>
            <div className={`${styles.modal} ${styles.modalLarge}`} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitleBox}>
                  <Users size={20} color="#0284c7" />
                  <h3 className={styles.modalTitle}>Grupni unos rada na njivu</h3>
                </div>
                <button
                  className={styles.modalClose}
                  onClick={() => setGroupLogModalOpen(false)}
                  type="button"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleGroupLogSubmit}>
                <div className={styles.modalBody}>
                  {/* Izbor Radnika / Grupe */}
                  <div className={styles.groupSelectionBox}>
                    <div className={styles.groupSelectionHeader}>
                      <span>1. Označite radnike koji su radili:</span>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button
                          type="button"
                          className={styles.quickJobPill}
                          onClick={() => handleQuickGroupChange('ALL')}
                        >
                          Označi sve ({allActiveWorkers.length})
                        </button>
                        <button
                          type="button"
                          className={styles.quickJobPill}
                          onClick={() => handleQuickGroupChange('NONE')}
                        >
                          Poništi odabir
                        </button>
                      </div>
                    </div>

                    {groupNamesList.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                          Brzi odabir grupe:
                        </span>
                        {groupNamesList.map((grp) => (
                          <button
                            key={grp}
                            type="button"
                            className={`${styles.quickJobPill} ${gQuickGroupSelect === grp ? styles.quickJobPillSelected : ''}`}
                            onClick={() => handleQuickGroupChange(grp)}
                          >
                            👥 {grp}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className={styles.workerCheckboxGrid}>
                      {allActiveWorkers.map((w) => {
                        const isChecked = gSelectedWorkerIds.includes(w.id);
                        return (
                          <label
                            key={w.id}
                            className={`${styles.workerCheckboxItem} ${isChecked ? styles.workerCheckboxActive : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleWorkerInGroup(w.id)}
                              style={{ cursor: 'pointer' }}
                            />
                            <div style={{ overflow: 'hidden' }}>
                              <div style={{ fontSize: '0.82rem', fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                {w.name}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                {w.groupName || 'Pojedinačno'}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#16a34a' }}>
                      Izabrano radnika u grupi: {gSelectedWorkerIds.length}
                    </div>
                  </div>

                  {/* 2. Podaci o radu grupe */}
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Datum rada *</label>
                      <input
                        type="date"
                        className={styles.formInput}
                        value={gDate}
                        onChange={(e) => setGDate(e.target.value)}
                        required
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Parcela</label>
                      <CustomSelect
                        value={gParcelId}
                        onChange={setGParcelId}
                        options={modalParcelOptions}
                        searchable={true}
                        placeholder="Izaberite parcelu"
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Vrsta posla za celu grupu *</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="npr. Plevljenje luka"
                      value={gJob}
                      onChange={(e) => setGJob(e.target.value)}
                      required
                    />
                    <div className={styles.quickJobPills}>
                      {COMMON_JOBS.map((job) => (
                        <button
                          key={job}
                          type="button"
                          className={`${styles.quickJobPill} ${gJob === job ? styles.quickJobPillSelected : ''}`}
                          onClick={() => setGJob(job)}
                        >
                          {job}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Početak rada</label>
                      <input
                        type="time"
                        className={styles.formInput}
                        value={gStartTime}
                        onChange={(e) => setGStartTime(e.target.value)}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Kraj rada</label>
                      <input
                        type="time"
                        className={styles.formInput}
                        value={gEndTime}
                        onChange={(e) => setGEndTime(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Pauza (minuti)</label>
                      <input
                        type="number"
                        min="0"
                        step="5"
                        className={styles.formInput}
                        value={gBreak}
                        onChange={(e) => setGBreak(e.target.value)}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Jedinstvena dnevnica za sve (RSD, opciono)</label>
                      <input
                        type="number"
                        step="50"
                        min="0"
                        className={styles.formInput}
                        placeholder="Ostavi prazno za podrazumevanu svakog radnika"
                        value={gUnifiedWage}
                        onChange={(e) => setGUnifiedWage(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Napomena grupe</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="Opciona napomena za ovaj grupni unos..."
                      value={gNotes}
                      onChange={(e) => setGNotes(e.target.value)}
                    />
                  </div>

                  <div className={styles.modalActions}>
                    <button
                      type="button"
                      className={styles.btnCancel}
                      onClick={() => setGroupLogModalOpen(false)}
                    >
                      Otkaži
                    </button>
                    <button
                      type="submit"
                      className={styles.btnGroupAction}
                      disabled={createGroupLogMutation.isPending || gSelectedWorkerIds.length === 0}
                    >
                      {createGroupLogMutation.isPending
                        ? 'Unos rada u toku...'
                        : `Potvrdi unos za ${gSelectedWorkerIds.length} radnika`}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL 4: UPRAVLJANJE GRUPAMA                              */}
        {/* ========================================================= */}
        {groupManagerModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setGroupManagerModalOpen(false)}>
            <div className={styles.modal} style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <div className={styles.modalTitleBox}>
                  <Users size={20} color="#0284c7" />
                  <h3 className={styles.modalTitle}>Upravljanje grupama sezonaca</h3>
                </div>
                <button
                  type="button"
                  className={styles.modalCloseBtn}
                  onClick={() => setGroupManagerModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <div className={styles.modalBody}>
                {/* 1. Kreiranje nove grupe */}
                <div className={styles.newGroupBar}>
                  <input
                    type="text"
                    className={styles.newGroupInput}
                    placeholder="Unesite naziv nove grupe (npr. Grupa Agim, Grupa Kulpin)..."
                    value={newGroupNameInput}
                    onChange={(e) => setNewGroupNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (newGroupNameInput.trim()) {
                          createGroupMutation.mutate(newGroupNameInput.trim());
                        }
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={!newGroupNameInput.trim() || createGroupMutation.isPending}
                    onClick={() => {
                      if (newGroupNameInput.trim()) {
                        createGroupMutation.mutate(newGroupNameInput.trim());
                      }
                    }}
                  >
                    <Plus size={16} />
                    <span>{createGroupMutation.isPending ? 'Kreiranje...' : 'Kreiraj grupu'}</span>
                  </button>
                </div>

                {/* 2. Lista postojećih grupa */}
                <div className={styles.groupsGrid}>
                  {groupsList.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)' }}>
                      <Users size={36} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                      <div style={{ fontWeight: 600 }}>Trenutno nema formiranih grupa.</div>
                      <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
                        Unesite naziv u polje iznad i kliknite na &quot;Kreiraj grupu&quot;.
                      </div>
                    </div>
                  ) : (
                    groupsList.map((grp) => {
                      // Sezonci koji još uvek nisu u ovoj grupi, da bismo mogli da ih dodamo
                      const availableToAdd = allActiveWorkers.filter((w) => w.groupName !== grp.name);

                      return (
                        <div key={grp.name} className={styles.groupCard}>
                          <div className={styles.groupCardHeader}>
                            <div className={styles.groupCardTitle}>
                              <span>👥</span>
                              <span>{grp.name}</span>
                              <span className={styles.groupBadge}>{grp.count} radnika</span>
                            </div>
                            <button
                              type="button"
                              className={styles.actionBtnDanger}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#dc2626',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                              }}
                              onClick={() => setGroupToDelete(grp.name)}
                              title="Obriši ovu grupu"
                            >
                              <Trash2 size={13} />
                              <span>Obriši grupu</span>
                            </button>
                          </div>

                          {/* Članovi grupe */}
                          <div className={styles.groupMembersWrap}>
                            {grp.workers.length === 0 ? (
                              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                                Grupa trenutno nema nijednog člana. Dodajte radnike ispod.
                              </span>
                            ) : (
                              grp.workers.map((m) => (
                                <span key={m.id} className={styles.groupMemberChip}>
                                  <span>{m.name}</span>
                                  {m.city && <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>({m.city})</span>}
                                  <button
                                    type="button"
                                    className={styles.groupMemberRemove}
                                    onClick={() => setWorkerToRemove({ groupName: grp.name, workerId: m.id, workerName: m.name })}
                                    title="Izbaci radnika iz ove grupe"
                                  >
                                    <X size={13} />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>

                          {/* Dodavanje radnika u ovu grupu */}
                          {availableToAdd.length > 0 ? (
                            <div className={styles.addWorkerToGroupRow}>
                              <div style={{ flex: 1, minWidth: 260 }}>
                                <CustomSelect
                                  value={groupToAddTo === grp.name ? workerToAddToGroup : ''}
                                  onChange={(val) => {
                                    setGroupToAddTo(grp.name);
                                    setWorkerToAddToGroup(val);
                                  }}
                                  options={availableToAdd.map((aw) => ({
                                    value: aw.id,
                                    label: aw.name,
                                    subLabel: aw.city ? `Mesto: ${aw.city}` : undefined,
                                    badge: aw.groupName ? `U grupi: ${aw.groupName}` : 'Slobodan (bez grupe)',
                                    badgeType: aw.groupName ? 'warning' : 'success',
                                  }))}
                                  placeholder="+ Izaberi radnika za dodavanje u grupu..."
                                  searchable={true}
                                />
                              </div>
                              <button
                                type="button"
                                className={styles.btnAddWorkerToGroup}
                                disabled={groupToAddTo !== grp.name || !workerToAddToGroup || updateGroupMembersMutation.isPending}
                                onClick={() => handleAddWorkerToGroup(grp.name, workerToAddToGroup)}
                              >
                                <UserPlus size={15} />
                                <span>+ Dodaj u grupu</span>
                              </button>
                            </div>
                          ) : allActiveWorkers.length === 0 ? (
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 4 }}>
                              Nema unetih sezonaca u sistemu.
                            </div>
                          ) : (
                            <div style={{ fontSize: '0.78rem', color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
                              ✓ Svi dostupni radnici su već članovi ove grupe.
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 3. Radnici bez grupe */}
                {unassignedWorkers.length > 0 && (
                  <div className={styles.unassignedSection}>
                    <div className={styles.unassignedTitle}>
                      <span>Radnici bez dodeljene grupe ({unassignedWorkers.length}):</span>
                    </div>
                    <div className={styles.groupMembersWrap}>
                      {unassignedWorkers.map((uw) => (
                        <span
                          key={uw.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '0.2rem 0.5rem',
                            borderRadius: 6,
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border-color)',
                            fontSize: '0.75rem',
                          }}
                        >
                          <strong>{uw.name}</strong>
                          {uw.city && <span style={{ color: 'var(--text-muted)' }}>({uw.city})</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={() => setGroupManagerModalOpen(false)}
                    style={{ marginLeft: 'auto' }}
                  >
                    Završi upravljanje
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL ZA POTVRDU IZBACIVANJA RADNIKA IZ GRUPE             */}
        {/* ========================================================= */}
        {workerToRemove && (
          <div className={styles.confirmModalOverlay} onClick={() => setWorkerToRemove(null)}>
            <div className={styles.confirmModalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.confirmModalIconBox}>
                <AlertCircle size={26} />
              </div>
              <h4 className={styles.confirmModalTitle}>Izbaci radnika iz grupe?</h4>
              <p className={styles.confirmModalDesc}>
                Da li stvarno želite da izbacite radnika <strong>{workerToRemove.workerName}</strong> iz grupe <strong>{workerToRemove.groupName}</strong>?
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                Radnik neće biti obrisan iz sistema, već će postati neraspoređen (&quot;bez grupe&quot;).
              </p>
              <div className={styles.confirmModalActions}>
                <button
                  type="button"
                  className={styles.btnCancel}
                  onClick={() => setWorkerToRemove(null)}
                >
                  Otkaži
                </button>
                <button
                  type="button"
                  className={styles.btnDangerConfirm}
                  disabled={updateGroupMembersMutation.isPending}
                  onClick={() => {
                    handleRemoveWorkerFromGroup(workerToRemove.groupName, workerToRemove.workerId);
                    setWorkerToRemove(null);
                  }}
                >
                  {updateGroupMembersMutation.isPending ? 'Izbacivanje...' : 'Izbaci radnika'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL ZA POTVRDU BRISANJA GRUPE                           */}
        {/* ========================================================= */}
        {groupToDelete && (
          <div className={styles.confirmModalOverlay} onClick={() => setGroupToDelete(null)}>
            <div className={styles.confirmModalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.confirmModalIconBox}>
                <Trash2 size={26} />
              </div>
              <h4 className={styles.confirmModalTitle}>Obriši grupu?</h4>
              <p className={styles.confirmModalDesc}>
                Da li stvarno želite da obrišete grupu <strong>&quot;{groupToDelete}&quot;</strong>?
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                Radnici iz ove grupe neće biti obrisani, već samo prebačeni u status radnika bez dodeljene grupe.
              </p>
              <div className={styles.confirmModalActions}>
                <button
                  type="button"
                  className={styles.btnCancel}
                  onClick={() => setGroupToDelete(null)}
                >
                  Otkaži
                </button>
                <button
                  type="button"
                  className={styles.btnDangerConfirm}
                  disabled={deleteGroupMutation.isPending}
                  onClick={() => {
                    handleDissolveGroup(groupToDelete);
                  }}
                >
                  {deleteGroupMutation.isPending ? 'Brisanje...' : 'Obriši grupu'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* MODAL ZA POTVRDU BRISANJA ZAPISA RADA                     */}
        {/* ========================================================= */}
        {logToDelete && (
          <div className={styles.confirmModalOverlay} onClick={() => setLogToDelete(null)}>
            <div className={styles.confirmModalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.confirmModalIconBox}>
                <Trash2 size={26} />
              </div>
              <h4 className={styles.confirmModalTitle}>Obriši zapis o radu?</h4>
              <p className={styles.confirmModalDesc}>
                Da li ste sigurni da želite da obrišete ovaj zapis o radu za radnika{' '}
                <strong>{logToDelete.seasonalWorker.name}</strong> za dan{' '}
                <strong>{formatDate(logToDelete.date)}</strong>?
              </p>
              <div
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  padding: '0.65rem 0.85rem',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                <div>
                  <strong>Posao:</strong> {logToDelete.jobDescription}
                </div>
                <div>
                  <strong>Parcela:</strong>{' '}
                  {logToDelete.parcel ? `${logToDelete.parcel.name} (${logToDelete.parcel.code})` : 'Bez parcele'}
                </div>
                <div>
                  <strong>Radni sati:</strong> {logToDelete.hoursWorked} h
                  {logToDelete.dailyWageApplied ? ` • Dnevnica: ${logToDelete.dailyWageApplied.toLocaleString('sr-RS')} RSD` : ''}
                </div>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#dc2626', margin: 0 }}>
                ⚠️ Ovaj unos će biti trajno uklonjen iz evidencije i analitike troškova.
              </p>
              <div className={styles.confirmModalActions}>
                <button
                  type="button"
                  className={styles.btnCancel}
                  onClick={() => setLogToDelete(null)}
                >
                  Otkaži
                </button>
                <button
                  type="button"
                  className={styles.btnDangerConfirm}
                  disabled={deleteLogMutation.isPending}
                  onClick={() => {
                    deleteLogMutation.mutate(logToDelete.id);
                    setLogToDelete(null);
                  }}
                >
                  {deleteLogMutation.isPending ? 'Brisanje...' : 'Obriši zapis'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default SeasonalWorkersDashboard;

