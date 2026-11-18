import MachineUsageModal from '../components/MachineUsageModal';
import { PhotoUpload } from '../components/PhotoUpload';
import { masterQueryKeys } from '../lib/masterQueryKeys';
import { useDurableSubmission } from '../lib/useDurableSubmission';
import { refreshMachineFuel } from '../lib/machineFuel';
import SubmissionRecovery from '../components/SubmissionRecovery';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  Tractor,
  KeyRound,
  CheckCircle2,
  Clock,
  User,
  Plus,
  Loader2,
  X,
  AlertCircle,
  Wrench,
  ShieldCheck,
  Zap,
  ArrowLeft,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import { useSession } from '../lib/auth-client';
import ActiveAssignmentsSection from './ActiveAssignmentsSection';
import AssignmentHistorySection, { type HistoryPeriodType } from './AssignmentHistorySection';
import EditAssignmentModal from './EditAssignmentModal';
import AssignmentPhotoModal from './AssignmentPhotoModal';
import styles from './MasineZaduzenje.module.css';

const API = 'http://localhost:5000/api';
const EMPTY_LIST: any[] = [];

type TabType = 'active' | 'checkout' | 'history' | 'direct';

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const HISTORY_STATUS_FILTER_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Svi statusi' },
  { value: 'ZADUZENA', label: 'Zadužena (Na njivi)' },
  { value: 'RAZDUZENA', label: 'Razdužena (Završeno)' },
  { value: 'POKVARENA', label: 'Prijavljen kvar' },
];

async function fetchJson<T = any>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || 'Greška pri učitavanju podataka.');
  }
  return data as T;
}

const MasineZaduzenje: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [usageId, setUsageId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [toast, setToast] = useState<Toast | null>(null);

  // Form states za novo zaduženje (Checkout)
  const [checkoutMachineId, setCheckoutMachineId] = useState('');
  const [checkoutFuelVersion, setCheckoutFuelVersion] = useState<string | undefined>();
  const [directFuelSnapshot, setDirectFuelSnapshot] = useState<{ machineId: string; updatedAt: string } | null>(null);
  const [checkoutWorkerId, setCheckoutWorkerId] = useState('');
  const [checkoutStartHours, setCheckoutStartHours] = useState<number | string>('');
  const [checkoutFuelLiters, setCheckoutFuelLiters] = useState<number | string>('');
  const [checkoutNotes, setCheckoutNotes] = useState('');

  // Checkin Modal states
  const [checkinModalOpen, setCheckinModalOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);
  const [checkinEndHours, setCheckinEndHours] = useState<number | string>('');
  const [checkinFuelLiters, setCheckinFuelLiters] = useState<number | string>('');
  const [checkinOperational, setCheckinOperational] = useState(true);
  const [checkinNotes, setCheckinNotes] = useState('');
  const [checkinPhoto, setCheckinPhoto] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  // Edit & Photo Modal states (izmena zaduženja / pregled fotografije)
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<any | null>(null);
  const [photoModalAssignment, setPhotoModalAssignment] = useState<any | null>(null);

  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Uloga korisnika
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(currentUser?.role || '');
  const isOperator = currentUser?.role === 'OPERATER';

  const checkinDraft = useDurableSubmission('checkin', currentUser?.id,
    { selectedAssignment, checkinEndHours, checkinFuelLiters, checkinOperational, checkinNotes, checkinPhoto },
    (draft) => {
      setSelectedAssignment(draft.selectedAssignment); setCheckinEndHours(draft.checkinEndHours);
      setCheckinFuelLiters(draft.checkinFuelLiters); setCheckinOperational(draft.checkinOperational);
      setCheckinPhoto(draft.checkinPhoto ?? null); setCheckinNotes(draft.checkinNotes); if (draft.selectedAssignment) setCheckinModalOpen(true);
    });

  // Search parametri (za direktno rešavanje neusklađenosti ili brzi završetak dana)
  const [searchParams] = useSearchParams();
  const isDirectParam = searchParams.get('direct') === 'true';
  const isCheckinParam = searchParams.get('checkin') === 'true';
  const paramMachineId = searchParams.get('machineId') || '';
  const paramWorkerId = searchParams.get('workerId') || '';
  const paramDate = searchParams.get('date') || '';
  const paramWorkHours = searchParams.get('workHours') || '';
  const hasTriggeredAutoCheckin = useRef(false);

  // Form states za Direktno Zaduženje (Jedan Korak)
  const [directMachineId, setDirectMachineId] = useState(paramMachineId);
  const [directWorkerId, setDirectWorkerId] = useState(paramWorkerId);
  const [directDate, setDirectDate] = useState(paramDate || new Date().toISOString().split('T')[0]);
  const [directStartHours, setDirectStartHours] = useState<number | string>('');
  const [directEndHours, setDirectEndHours] = useState<number | string>('');
  const [directStartFuelLiters, setDirectStartFuelLiters] = useState<number | string>('');
  const [directEndFuelLiters, setDirectEndFuelLiters] = useState<number | string>('');
  const [directOperational, setDirectOperational] = useState<boolean>(true);
  const [directNotes, setDirectNotes] = useState<string>('Direktno evidentirano zaduženje (rešena neusklađenost)');

  // Paginacija za Aktivna Zaduženja
  const [activePage, setActivePage] = useState(1);

  // Filteri i Paginacija za Istorijat Zaduženja
  const [historyPeriod, setHistoryPeriod] = useState<HistoryPeriodType>('sve');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [historyMachineId, setHistoryMachineId] = useState('');
  const [historyWorkerId, setHistoryWorkerId] = useState('');
  const [historyStatus, setHistoryStatus] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyPeriod, historyDateFrom, historyDateTo, historyMachineId, historyWorkerId, historyStatus, historySearch]);

  const historyRange = useMemo(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    if (historyPeriod === 'danas') {
      return { from: todayStr, to: todayStr };
    }
    if (historyPeriod === 'nedelja') {
      const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - dayOfWeek);
      const startStr = startOfWeek.toISOString().slice(0, 10);
      return { from: startStr, to: todayStr };
    }
    if (historyPeriod === 'mesec') {
      const startOfMonth = `${yyyy}-${mm}-01`;
      return { from: startOfMonth, to: todayStr };
    }
    if (historyPeriod === 'custom') {
      return { from: historyDateFrom, to: historyDateTo };
    }
    return { from: '', to: '' };
  }, [historyPeriod, historyDateFrom, historyDateTo]);

  const needMachinesCatalogue = activeTab !== 'active' || isDirectParam;
  const needWorkersCatalogue = Boolean(currentUser) && !isOperator && needMachinesCatalogue;

  // 1. STATISTIKA ZADUŽENJA
  const { data: statsData } = useQuery({
    queryKey: ['assignments-stats'],
    queryFn: () => fetchJson(`${API}/assignments/stats`),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 2. AKTIVNA ZADUŽENJA (Paginacija 25 po strani)
  const { data: activeData, isLoading: loadingActive } = useQuery({
    queryKey: ['assignments-active', activePage],
    queryFn: () => fetchJson(`${API}/assignments/active?page=${activePage}&limit=25`),
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
  });

  // 3. SVA ZADUŽENJA (ISTORIJAT SA FILTERIMA I PAGINACIJOM — učitava se tek kad je tab otvoren)
  const { data: historyData, isLoading: loadingHistory } = useQuery({
    queryKey: [
      'assignments-history',
      historyPage,
      historyPeriod,
      historyRange.from,
      historyRange.to,
      historyMachineId,
      historyWorkerId,
      historyStatus,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.append('page', String(historyPage));
      params.append('limit', '25');
      if (historyMachineId) params.append('machineId', historyMachineId);
      if (historyWorkerId) params.append('workerId', historyWorkerId);
      if (historyStatus) params.append('status', historyStatus);
      if (historyRange.from) params.append('dateFrom', historyRange.from);
      if (historyRange.to) params.append('dateTo', historyRange.to);

      return fetchJson(`${API}/assignments?${params.toString()}`);
    },
    enabled: activeTab === 'history',
    staleTime: 0,
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
  });

  // 4. ŠIFARNICI (učitavaju se tek kada su potrebni za formu ili filtere)
  const { data: machinesData } = useQuery({
    queryKey: masterQueryKeys.machines,
    queryFn: () => fetchJson(`${API}/master/machines`),
    enabled: needMachinesCatalogue,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: workersData } = useQuery({
    queryKey: ['workers-all'],
    queryFn: () => fetchJson(`${API}/master/workers`),
    enabled: needWorkersCatalogue,
  });

  const machinesList = machinesData?.machines || [];
  const machinesById = useMemo(() => {
    const map = new Map<string, any>();
    for (const m of machinesList) map.set(m.id, m);
    return map;
  }, [machinesList]);

  // Slobodne mašine za zaduženje
  const freeMachines = useMemo(
    () => machinesList.filter((m: any) => m.status === 'SLOBODNA'),
    [machinesList]
  );

  // Opcije za CustomSelect komponente
  const freeMachineOptions: CustomSelectOption[] = useMemo(() => {
    return freeMachines.map((m: any) => ({
      value: m.id,
      label: m.name,
      sublabel: `${m.brandModel || m.type || ''} • Stanje: ${m.currentHours ?? 0} rh • Rezervoar: ${m.tankCapacityLiters || 0} L`,
    }));
  }, [freeMachines]);

  const workerSelectOptions: CustomSelectOption[] = useMemo(() => {
    return (workersData?.workers || []).map((w: any) => ({
      value: w.id,
      label: w.name,
      sublabel: `Tip: ${w.type || 'RADNIK'}${w.phone ? ` • Tel: ${w.phone}` : ''}`,
    }));
  }, [workersData?.workers]);

  const allMachineOptions: CustomSelectOption[] = useMemo(() => {
    return machinesList.map((m: any) => ({
      value: m.id,
      label: m.name,
      sublabel: `${m.brandModel || m.type || ''} • Stanje: ${m.currentHours ?? 0} rh`,
    }));
  }, [machinesList]);

  const historyMachineFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list = machinesList.map((m: any) => ({
      value: m.id,
      label: m.name,
      sublabel: `${m.brandModel || m.type || ''}`,
    }));
    return [{ value: '', label: 'Sve mašine' }, ...list];
  }, [machinesList]);

  const historyWorkerFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list = (workersData?.workers || []).map((w: any) => ({
      value: w.id,
      label: w.name,
      sublabel: w.type || 'RADNIK',
    }));
    return [{ value: '', label: 'Svi radnici' }, ...list];
  }, [workersData?.workers]);

  const historyStatusFilterOptions = HISTORY_STATUS_FILTER_OPTIONS;

  const invalidateAssignmentQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['assignments-active'] });
    queryClient.invalidateQueries({ queryKey: ['assignments-stats'] });
    queryClient.invalidateQueries({ queryKey: ['assignments-history'] });
    queryClient.invalidateQueries({ queryKey: masterQueryKeys.machines });
  }, [queryClient]);

  // Prilikom izbora mašine, automatski preuzmi njene trenutne radne sate i kapacitet goriva
  const handleSelectMachine = (machineId: string) => {
    setCheckoutMachineId(machineId);
    const m = machinesById.get(machineId);
    if (m) {
      setCheckoutFuelVersion(m.updatedAt);
      setCheckoutStartHours(m.currentHours || 0);
      setCheckoutFuelLiters(m.currentFuelLiters ?? '');
    }
  };

  // MUTACIJA: NOVO ZADUŽENJE (CHECKOUT)
  const checkoutMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`${API}/assignments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri zaduživanju.');
      }
      return data;
    },
    onSuccess: (data) => {
      invalidateAssignmentQueries();

      // Reset form
      setCheckoutMachineId('');
      setCheckoutWorkerId('');
      setCheckoutStartHours('');
      setCheckoutFuelLiters('');
      setCheckoutNotes('');

      setActiveTab('active');
      showToast(data.message || 'Mašina je uspešno zadužena.', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // MUTACIJA: RAZDUŽIVANJE MAŠINE (CHECKIN)
  const checkinMutation = useMutation({
    mutationFn: async (payload: any) => {
      const data = await checkinDraft.request(`${API}/assignments/checkin`, payload);
      return data;
    },
    onSuccess: (data) => {
      checkinDraft.clear();
      invalidateAssignmentQueries();

      setCheckinModalOpen(false);
      setSelectedAssignment(null);
      showToast(data.message || 'Mašina uspešno razdužena.', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  const handleOpenCheckin = useCallback((assignment: any) => {
    if (checkinDraft.pending) { setCheckinModalOpen(true); return; }
    checkinDraft.resume();
    if (checkinDraft.hasDraft && selectedAssignment?.id === assignment.id) { setCheckinModalOpen(true); return; }
    setSelectedAssignment(assignment);
    setCheckinEndHours(assignment.startHours);
    setCheckinFuelLiters(
      assignment.endFuelLiters !== null && assignment.endFuelLiters !== undefined
        ? assignment.endFuelLiters
        : assignment.startFuelLiters !== null && assignment.startFuelLiters !== undefined
        ? assignment.startFuelLiters
        : ''
    );
    setCheckinOperational(true);
    setCheckinNotes('');
    setCheckinPhoto(null);
    setCheckinModalOpen(true);
  }, [checkinDraft, selectedAssignment?.id]);

  const handleGoToCheckout = useCallback(() => setActiveTab('checkout'), []);
  const handleOpenUsage = useCallback((assignmentId: string) => setUsageId(assignmentId), []);

  const handleCheckoutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutMachineId) {
      showToast('Molimo izaberite mašinu.', 'error');
      return;
    }

    if (!isOperator && !checkoutWorkerId) {
      showToast('Molimo izaberite radnika koji zadužuje mašinu.', 'error');
      return;
    }

    const selectedM = machinesById.get(checkoutMachineId);
    const maxTank = selectedM?.tankCapacityLiters;
    const fuelVal = Number(checkoutFuelLiters);

    if (maxTank && fuelVal > maxTank) {
      showToast(
        `Količina goriva (${fuelVal} L) ne može biti veća od kapaciteta rezervoara mašine (${maxTank} L)!`,
        'error'
      );
      return;
    }

    checkoutMutation.mutate({
      machineId: checkoutMachineId,
      workerId: isOperator ? null : checkoutWorkerId,
      startHours: Number(checkoutStartHours),
      startFuelLiters: checkoutFuelLiters !== '' ? fuelVal : null,
      expectedMachineUpdatedAt: checkoutFuelVersion,
      assignNotes: checkoutNotes || null,
    });
  };

  const handleCheckinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignment || photoUploading) return;

    const endH = Number(checkinEndHours);
    if (endH < selectedAssignment.startHours) {
      showToast(
        `Krajnji sati (${endH} rh) ne mogu biti manji od početnih (${selectedAssignment.startHours} rh).`,
        'error'
      );
      return;
    }

    const maxTank = selectedAssignment.machine?.tankCapacityLiters;
    const endFuelVal = Number(checkinFuelLiters);

    if (maxTank && endFuelVal > maxTank) {
      showToast(
        `Količina goriva (${endFuelVal} L) ne može biti veća od kapaciteta rezervoara mašine (${maxTank} L)!`,
        'error'
      );
      return;
    }

    checkinMutation.mutate({
      assignmentId: selectedAssignment.id,
      endHours: endH,
      endFuelLiters: checkinFuelLiters !== '' ? endFuelVal : null,
      expectedMachineUpdatedAt: selectedAssignment.machine?.updatedAt,
      isOperational: checkinOperational,
      returnNotes: checkinNotes || null,
      photoUrl: checkinPhoto,
    });
  };

  // MUTACIJA I HANDLERI ZA IZMENU ZADUŽENJA (EDIT) I PREGLED FOTOGRAFIJE
  const handleOpenEdit = useCallback((assignment: any) => {
    setEditingAssignment(assignment);
    setEditModalOpen(true);
  }, []);

  const updateAssignmentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetch(`${API}/assignments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        credentials: 'include',
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Greška pri izmeni zaduženja.');
      }
      return resData;
    },
    onSuccess: (data) => {
      invalidateAssignmentQueries();
      setEditModalOpen(false);
      setEditingAssignment(null);
      showToast(data.message || 'Zaduženje uspešno izmenjeno.', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  const { mutate: updateAssignmentMutate } = updateAssignmentMutation;

  const handleUpdateAssignmentSubmit = useCallback(
    (id: string, payload: Record<string, any>) => {
      updateAssignmentMutate({ id, data: payload });
    },
    [updateAssignmentMutate]
  );

  const handleCloseEditModal = useCallback(() => setEditModalOpen(false), []);
  const handleOpenUsageFromEdit = useCallback((assignmentId: string) => {
    setUsageId(assignmentId);
    setEditModalOpen(false);
  }, []);

  const handleShowPhoto = useCallback((assignment: any) => setPhotoModalAssignment(assignment), []);
  const handleClosePhotoModal = useCallback(() => setPhotoModalAssignment(null), []);

  const handleResetHistoryFilters = useCallback(() => {
    setHistoryPeriod('sve');
    setHistoryDateFrom('');
    setHistoryDateTo('');
    setHistoryMachineId('');
    setHistoryWorkerId('');
    setHistoryStatus('');
    setHistorySearch('');
  }, []);

  // Učitavanje i automatsko popunjavanje direktnog zaduženja iz URL parametara
  useEffect(() => {
    if (isDirectParam && isManager) {
      setActiveTab('direct');
      if (paramMachineId) setDirectMachineId(paramMachineId);
      if (paramWorkerId) setDirectWorkerId(paramWorkerId);
      if (paramDate) setDirectDate(paramDate);

      const m = machinesById.get(paramMachineId);
      if (m) {
        const currentH = Number(m.currentHours) || 0;
        setDirectStartHours(currentH);
        if (paramWorkHours) {
          const wh = parseFloat(paramWorkHours);
          if (!isNaN(wh)) {
            setDirectEndHours(parseFloat((currentH + wh).toFixed(1)));
          } else {
            setDirectEndHours(currentH);
          }
        } else {
          setDirectEndHours(currentH);
        }
      }
    }
  }, [isDirectParam, isManager, paramMachineId, paramWorkerId, paramDate, paramWorkHours, machinesById]);

  // Automatsko otvaranje modala za razduživanje ako je korisnik došao preko 'Razduži Mašinu i završi dan'
  useEffect(() => {
    if (isCheckinParam && !hasTriggeredAutoCheckin.current && !loadingActive) {
      if (activeData?.assignments && activeData.assignments.length > 0) {
        const target = paramMachineId
          ? activeData.assignments.find((a: any) => a.machineId === paramMachineId)
          : activeData.assignments[0];

        if (target) {
          hasTriggeredAutoCheckin.current = true;
          setActiveTab('active');
          handleOpenCheckin(target);
          return;
        }
      }

      if (paramMachineId) {
        hasTriggeredAutoCheckin.current = true;
        showToast('Tražena mašina trenutno nema aktivno zaduženje za razduživanje.', 'error');
      }
    }
  }, [isCheckinParam, paramMachineId, activeData, loadingActive]);

  const handleSelectDirectMachine = (id: string) => {
    if (id !== directMachineId) { setDirectStartFuelLiters(''); setDirectEndFuelLiters(''); }
    const m = machinesById.get(id);
    setDirectFuelSnapshot(m?.updatedAt ? { machineId: id, updatedAt: m.updatedAt } : null);
    setDirectMachineId(id);
    if (m) {
      const currentH = Number(m.currentHours) || 0;
      setDirectStartHours(currentH);
      if (paramWorkHours) {
        const wh = parseFloat(paramWorkHours);
        setDirectEndHours(!isNaN(wh) ? parseFloat((currentH + wh).toFixed(1)) : currentH);
      } else {
        setDirectEndHours(currentH);
      }
    }
  };

  // MUTACIJA: DIREKTNO ZADUŽENJE U JEDNOM KORAKU
  const directMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`${API}/assignments/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri direktnom zaduživanju.');
      }
      return data;
    },
    onSuccess: (data) => {
      invalidateAssignmentQueries();
      queryClient.invalidateQueries({ queryKey: ['unassigned-warnings'] });
      queryClient.invalidateQueries({ queryKey: ['field-work-stats'] });
      showToast(data.message || 'Zaduženje i razduženje uspešno završeno!', 'success');
      navigate('/masine/neusklađenosti');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  const handleDirectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directMachineId || !directWorkerId) {
      showToast('Morate izabrati mašinu i radnika.', 'error');
      return;
    }
    const startH = Number(directStartHours);
    const endH = Number(directEndHours);
    if (isNaN(startH) || isNaN(endH)) {
      showToast('Radni sati moraju biti uneti kao validan broj.', 'error');
      return;
    }
    if (endH < startH) {
      showToast(`Krajnji radni sati (${endH} rh) ne mogu biti manji od početnih (${startH} rh).`, 'error');
      return;
    }

    const selectedDirectM = machinesById.get(directMachineId);
    const maxTank = selectedDirectM?.tankCapacityLiters;
    const startFuelVal = Number(directStartFuelLiters);
    const endFuelVal = Number(directEndFuelLiters);

    if (maxTank && startFuelVal > maxTank) {
      showToast(`Početno gorivo (${startFuelVal} L) ne može biti veće od kapaciteta rezervoara (${maxTank} L).`, 'error');
      return;
    }
    if (maxTank && endFuelVal > maxTank) {
      showToast(`Krajnje gorivo (${endFuelVal} L) ne može biti veće od kapaciteta rezervoara (${maxTank} L).`, 'error');
      return;
    }

    directMutation.mutate({
      machineId: directMachineId,
      workerId: directWorkerId,
      date: directDate,
      startHours: startH,
      endHours: endH,
      startFuelLiters: directStartFuelLiters !== '' ? startFuelVal : null,
      endFuelLiters: directEndFuelLiters !== '' ? endFuelVal : null,
      expectedMachineUpdatedAt: directFuelSnapshot?.machineId === directMachineId ? directFuelSnapshot.updatedAt : undefined,
      isOperational: directOperational,
      notes: directNotes,
    });
  };

  useEffect(() => {
    const machine = machinesById.get(directMachineId);
    if (machine?.updatedAt) setDirectFuelSnapshot((previous) => previous?.machineId === directMachineId
      ? previous : { machineId: directMachineId, updatedAt: machine.updatedAt });
  }, [directMachineId, machinesById]);

  const activeAssignments = activeData?.assignments ?? EMPTY_LIST;
  const activeTotal = activeData?.total || 0;
  const activeTotalPages = activeData?.totalPages || 1;

  const rawHistoryList = historyData?.assignments ?? EMPTY_LIST;
  const historyList = useMemo(() => {
    if (!historySearch.trim()) return rawHistoryList;
    const q = historySearch.toLowerCase();
    return rawHistoryList.filter((a: any) =>
      a.machine?.name?.toLowerCase().includes(q) ||
      a.machine?.brandModel?.toLowerCase().includes(q) ||
      a.worker?.name?.toLowerCase().includes(q) ||
      a.assignNotes?.toLowerCase().includes(q) ||
      a.returnNotes?.toLowerCase().includes(q)
    );
  }, [rawHistoryList, historySearch]);

  const historyTotal = historyData?.total || 0;
  const historyTotalPages = historyData?.totalPages || 1;

  const hoursWorkedLive =
    selectedAssignment && checkinEndHours !== '' && checkinEndHours !== null && checkinEndHours !== undefined
      ? Math.round((Number(checkinEndHours) - Number(selectedAssignment.startHours ?? 0)) * 10) / 10
      : 0;

  return (
    <AppLayout pageTitle="Zaduživanje Mašina">
      <SubmissionRecovery pending={!!checkinDraft.pending} busy={checkinMutation.isPending} error={checkinDraft.storageError}
        onRetry={() => checkinDraft.pending && checkinMutation.mutate(checkinDraft.pending.payload)} />
      <div className={styles.container}>
        {/* Toast */}
        {toast && (
          <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{toast.message}</span>
          </div>
        )}

        {/* Zaglavlje */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <KeyRound size={26} color="#d97706" />
              Zaduživanje i Razduživanje Mehanizacije
            </h2>
          </div>
        </div>

        {/* KPI Kartice */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconActive}`}>
              <Tractor size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{statsData?.activeAssignments ?? 0}</div>
              <div className={styles.statLabel}>Trenutno na Njivi (Zadužene)</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconFree}`}>
              <ShieldCheck size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{statsData?.freeMachines ?? 0}</div>
              <div className={styles.statLabel}>Slobodnih Mašina u Dvorištu</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconBroken}`}>
              <Wrench size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{statsData?.brokenMachines ?? 0}</div>
              <div className={styles.statLabel}>Mašina u Kvaru / Servisu</div>
            </div>
          </div>
        </div>

        {/* Tasteri / Tabovi */}
        <div className={styles.tabsBar}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'active' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('active')}
          >
            <Tractor size={18} />
            <span className={styles.tabBtnText}>Aktivna Zaduženja (Na Njivi)</span>
            <span className={styles.tabBadge}>{activeTotal}</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'checkout' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('checkout')}
          >
            <Plus size={18} />
            <span className={styles.tabBtnText}>Novo Zaduženje</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'history' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <Clock size={18} />
            <span className={styles.tabBtnText}>Dnevnik Zaduženja (Istorijat)</span>
            {historyData?.total !== undefined && <span className={styles.tabBadge}>{historyTotal}</span>}
          </button>

          {isManager && (
            <button
              className={`${styles.tabBtn} ${activeTab === 'direct' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('direct')}
              style={activeTab === 'direct' ? { backgroundColor: '#d97706', borderColor: '#d97706', color: '#ffffff' } : {}}
            >
              <Zap size={18} />
              <span className={styles.tabBtnText}>Direktno Zaduženje (Jedan Korak)</span>
            </button>
          )}
        </div>

        {/* TAB 1: AKTIVNA ZADUŽENJA */}
        {activeTab === 'active' && (
          <ActiveAssignmentsSection
            loading={loadingActive}
            assignments={activeAssignments}
            total={activeTotal}
            page={activePage}
            totalPages={activeTotalPages}
            onPageChange={setActivePage}
            onGoToCheckout={handleGoToCheckout}
            onOpenCheckin={handleOpenCheckin}
            onOpenUsage={handleOpenUsage}
          />
        )}

        {/* TAB 2: NOVO ZADUŽENJE (CHECKOUT FORMA) */}
        {activeTab === 'checkout' && (
          <div className={styles.formCard}>
            <div>
              <h3 className={styles.formTitle}>
                <KeyRound size={20} color="#16a34a" />
                Jutarnje Zaduženje Mašine
              </h3>
              <p className={styles.formSubtitle}>
                Izaberite slobodan traktor ili priključak, radnika i lokaciju rada. Početni sati se automatski
                povlače sa mašine.
              </p>
            </div>

            <form onSubmit={handleCheckoutSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              {checkoutMachineId && <button type="button" className={styles.btnSecondary} onClick={async () => {
                try {
                  const machine = await refreshMachineFuel(checkoutMachineId);
                  setCheckoutFuelVersion(machine.updatedAt);
                  setCheckoutFuelLiters('');
                  showToast(`Poslednje stanje: ${machine.currentFuelLiters ?? 0} L. Ponovo unesite izmereno gorivo.`, 'success');
                } catch (error: any) { showToast(error.message, 'error'); }
              }}>Osveži stanje mašine</button>}
              {/* Izbor mašine (isključivo slobodne mašine) */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Mašina / Traktor (Slobodne jedinice)</span>
                  <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700 }}>
                    {freeMachines.length} slobodno
                  </span>
                </label>
                <CustomSelect
                  value={checkoutMachineId}
                  onChange={(val) => handleSelectMachine(val)}
                  options={freeMachineOptions}
                  placeholder="— Izaberite slobodnu mašinu —"
                  searchable
                />
              </div>

              {/* Početni radni sati */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Početni radni sati (rh)</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Automatski popunjeno
                  </span>
                </label>
                <div className={styles.inputWrapper}>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className={`${styles.inputField} ${styles.inputWithBadge}`}
                    value={checkoutStartHours}
                    onChange={(e) => setCheckoutStartHours(e.target.value)}
                    placeholder="0.0"
                    required
                  />
                  <span className={styles.inputBadge}>rh</span>
                </div>
              </div>

              {/* Radnik koji zadužuje - Za Operatera automatski bedž, za rukovodioce izbor */}
              {isOperator ? (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Radnik koji zadužuje mašinu</label>
                  <div className={styles.operatorBadgeCard}>
                    <div className={styles.operatorBadgeAvatar}>
                      <User size={18} />
                    </div>
                    <div className={styles.operatorBadgeInfo}>
                      <span className={styles.operatorBadgeName}>{currentUser?.name || 'Operater'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Radnik (Traktorista / Vozač)</label>
                  <CustomSelect
                    value={checkoutWorkerId}
                    onChange={(val) => setCheckoutWorkerId(val)}
                    options={workerSelectOptions}
                    placeholder="— Izaberite radnika —"
                    searchable
                  />
                </div>
              )}

              {/* Početno stanje goriva u litrima */}
              {(() => {
                const selectedM = machinesById.get(checkoutMachineId);
                const tankCap = selectedM?.tankCapacityLiters || 200;
                const isOverCap = Boolean(tankCap && Number(checkoutFuelLiters) > tankCap);

                return (
                  <div className={styles.formGroup}>
                    <div className={styles.labelRow}>
                      <label className={styles.formLabel} style={{ margin: 0 }}>
                        Početno stanje goriva u rezervoaru (litara) *
                      </label>
                      {selectedM && (
                        <span className={styles.capacityHint}>
                          Kapacitet: {tankCap} L
                        </span>
                      )}
                    </div>
                    <div className={styles.inputWrapper}>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max={tankCap}
                        className={`${styles.inputField} ${styles.inputWithBadge} ${isOverCap ? styles.inputError : ''}`}
                        value={checkoutFuelLiters}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== '' && Number(val) > tankCap) {
                            setCheckoutFuelLiters(tankCap);
                            return;
                          }
                          setCheckoutFuelLiters(val);
                        }}
                        placeholder={`npr. ${Math.min(180, tankCap)}`}
                        required
                      />
                      <span className={styles.inputBadge}>
                        Litara
                      </span>
                    </div>
                    {isOverCap && (
                      <div className={styles.errorMessage}>
                        <AlertCircle size={14} />
                        <span>Količina goriva ne može biti veća od kapaciteta mašine ({tankCap} L)!</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Napomena */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Napomena pri preuzimanju</label>
                <textarea
                  rows={2}
                  className={styles.inputField}
                  value={checkoutNotes}
                  onChange={(e) => setCheckoutNotes(e.target.value)}
                  placeholder="Npr. zakačena tanjirača, prekontrolisano ulje..."
                  style={{ resize: 'vertical' }}
                />
              </div>

              <button
                type="submit"
                className={styles.btnCheckoutSubmit}
                disabled={checkoutMutation.isPending || !checkoutMachineId || (!isOperator && !checkoutWorkerId)}
              >
                {checkoutMutation.isPending ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    <span>Zaduživanje u toku...</span>
                  </>
                ) : (
                  <>
                    <KeyRound size={18} />
                    <span>Potvrdi Zaduženje Mašine</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* TAB 4: DIREKTNO / RETROAKTIVNO ZADUŽENJE (SAMO DIREKTOR & RUKOVODILAC) */}
        {activeTab === 'direct' && isManager && (
          <div className={styles.formCard} style={{ maxWidth: 680 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h3 className={styles.formTitle}>
                  <Zap size={22} color="#d97706" />
                  Direktno Zaduženje i Razduženje
                </h3>
                <Link to="/masine/neusklađenosti" style={{ fontSize: '0.8rem', color: '#2563eb', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', textDecoration: 'none' }}>
                  <ArrowLeft size={14} />
                  Sve neusklađenosti
                </Link>
              </div>
              <p className={styles.formSubtitle}>
                Ekspresno evidentiranje oba koraka (početak i kraj rada) u jednom unosu. Koristi se kada radnik nije ujutru zadužio traktor a posao je već obavljen na njivi.
              </p>
            </div>

            {isDirectParam && (
              <div className={styles.directNotice}>
                <Zap size={20} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong>Rešavanje neusklađenosti sa njive:</strong>
                  <br />
                  Podaci o radniku, mašini, parceli i radnim satima su automatski povučeni iz unetog rada. Proverite početne i krajnje sate i nivo goriva, pa potvrdite unos.
                </div>
              </div>
            )}

            <form onSubmit={handleDirectSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              {directMachineId && <button type="button" className={styles.btnSecondary} onClick={async () => {
                try {
                  const machine = await refreshMachineFuel(directMachineId);
                  setDirectFuelSnapshot({ machineId: directMachineId, updatedAt: machine.updatedAt });
                  setDirectStartFuelLiters(''); setDirectEndFuelLiters('');
                  showToast(`Poslednje stanje: ${machine.currentFuelLiters ?? 0} L. Ponovo unesite izmereno gorivo.`, 'success');
                } catch (error: any) { showToast(error.message, 'error'); }
              }}>Osveži stanje mašine</button>}
              {/* Izbor radnika */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Radnik (Koji je upravljao mašinom)</span>
                </label>
                <CustomSelect
                  value={directWorkerId}
                  onChange={(val) => setDirectWorkerId(val)}
                  options={workerSelectOptions}
                  placeholder="— Izaberite radnika —"
                  searchable
                />
              </div>

              {/* Izbor mašine */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Mašina / Traktor</span>
                </label>
                <CustomSelect
                  value={directMachineId}
                  onChange={(val) => handleSelectDirectMachine(val)}
                  options={allMachineOptions}
                  placeholder="— Izaberite mašinu —"
                  searchable
                />
              </div>

              {/* Datum rada */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Datum rada</span>
                </label>
                <input
                  type="date"
                  className={styles.inputField}
                  value={directDate}
                  onChange={(e) => setDirectDate(e.target.value)}
                  required
                />
              </div>

              {/* Početni i krajnji sati */}
              <div className={styles.twoColRow}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    <span>Početni radni sati (rh)</span>
                  </label>
                  <div className={styles.inputWrapper}>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      className={`${styles.inputField} ${styles.inputWithBadge}`}
                      value={directStartHours}
                      onChange={(e) => setDirectStartHours(e.target.value)}
                      placeholder="0.0"
                      required
                    />
                    <span className={styles.inputBadge}>rh</span>
                  </div>
                </div>

                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    <span>Krajnji radni sati (rh)</span>
                  </label>
                  <div className={styles.inputWrapper}>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      className={`${styles.inputField} ${styles.inputWithBadge}`}
                      value={directEndHours}
                      onChange={(e) => setDirectEndHours(e.target.value)}
                      placeholder="0.0"
                      required
                    />
                    <span className={styles.inputBadge}>rh</span>
                  </div>
                </div>
              </div>

              {/* Nivoi goriva u litrima */}
              {(() => {
                const selectedDirectM = machinesById.get(directMachineId);
                const tankCap = selectedDirectM?.tankCapacityLiters || 200;

                return (
                  <div className={styles.twoColRow}>
                    <div className={styles.formGroup}>
                      <div className={styles.labelRow}>
                        <label className={styles.formLabel} style={{ margin: 0 }}>
                          Gorivo na početku (L) *
                        </label>
                        {selectedDirectM && (
                          <span className={styles.capacityHint}>
                            Maks: {tankCap} L
                          </span>
                        )}
                      </div>
                      <div className={styles.inputWrapper}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max={tankCap}
                          className={`${styles.inputField} ${styles.inputWithBadge}`}
                          value={directStartFuelLiters}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val !== '' && Number(val) > tankCap) {
                              setDirectStartFuelLiters(tankCap);
                              return;
                            }
                            setDirectStartFuelLiters(val);
                          }}
                          placeholder={`npr. ${tankCap}`}
                          required
                        />
                        <span className={styles.inputBadge}>
                          Litara
                        </span>
                      </div>
                    </div>

                    <div className={styles.formGroup}>
                      <div className={styles.labelRow}>
                        <label className={styles.formLabel} style={{ margin: 0 }}>
                          Gorivo na kraju (L) *
                        </label>
                        {selectedDirectM && (
                          <span className={styles.capacityHint}>
                            Maks: {tankCap} L
                          </span>
                        )}
                      </div>
                      <div className={styles.inputWrapper}>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          max={tankCap}
                          className={`${styles.inputField} ${styles.inputWithBadge}`}
                          value={directEndFuelLiters}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val !== '' && Number(val) > tankCap) {
                              setDirectEndFuelLiters(tankCap);
                              return;
                            }
                            setDirectEndFuelLiters(val);
                          }}
                          placeholder={`npr. ${Math.round(tankCap * 0.75)}`}
                          required
                        />
                        <span className={styles.inputBadge}>
                          Litara
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Ispravnost mašine */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Stanje ispravnosti mašine na kraju</span>
                </label>
                <div className={styles.toggleBtnGroup}>
                  <button
                    type="button"
                    className={`${styles.toggleBtn} ${directOperational ? styles.toggleBtnActiveSuccess : ''}`}
                    onClick={() => setDirectOperational(true)}
                  >
                    <CheckCircle2 size={16} />
                    Ispravna (Parkirana u dvorištu)
                  </button>
                  <button
                    type="button"
                    className={`${styles.toggleBtn} ${!directOperational ? styles.toggleBtnActiveDanger : ''}`}
                    onClick={() => setDirectOperational(false)}
                  >
                    <Wrench size={16} />
                    Prijavljen kvar / servis
                  </button>
                </div>
              </div>

              {/* Napomena */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Napomena / Razlog direktnog zaduženja</span>
                </label>
                <textarea
                  className={styles.textareaField}
                  rows={2}
                  value={directNotes}
                  onChange={(e) => setDirectNotes(e.target.value)}
                  placeholder="Unesite obrazloženje ili detalje..."
                  style={{ resize: 'vertical' }}
                />
              </div>

              <button
                type="submit"
                className={styles.btnCheckoutSubmit}
                style={{ backgroundColor: '#d97706' }}
                disabled={directMutation.isPending || !directMachineId || !directWorkerId}
              >
                {directMutation.isPending ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    <span>Evidentiranje u toku...</span>
                  </>
                ) : (
                  <>
                    <Zap size={18} />
                    <span>Zatvori i evidentiraj zaduženje u jednom koraku</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: ISTORIJAT ZADUŽENJA (DNEVNIK) */}
        {activeTab === 'history' && (
          <AssignmentHistorySection
            loading={loadingHistory}
            historyList={historyList}
            historyTotal={historyTotal}
            historyPage={historyPage}
            historyTotalPages={historyTotalPages}
            historyPeriod={historyPeriod}
            historyDateFrom={historyDateFrom}
            historyDateTo={historyDateTo}
            historyMachineId={historyMachineId}
            historyWorkerId={historyWorkerId}
            historyStatus={historyStatus}
            historySearch={historySearch}
            isManager={isManager}
            isOperator={isOperator}
            machineOptions={historyMachineFilterOptions}
            workerOptions={historyWorkerFilterOptions}
            statusOptions={historyStatusFilterOptions}
            onPeriodChange={setHistoryPeriod}
            onDateFromChange={setHistoryDateFrom}
            onDateToChange={setHistoryDateTo}
            onMachineChange={setHistoryMachineId}
            onWorkerChange={setHistoryWorkerId}
            onStatusChange={setHistoryStatus}
            onSearchChange={setHistorySearch}
            onResetFilters={handleResetHistoryFilters}
            onPageChange={setHistoryPage}
            onOpenEdit={handleOpenEdit}
            onShowPhoto={handleShowPhoto}
          />
        )}

        {/* MODAL ZA RAZDUŽIVANJE MAŠINE (CHECKIN) */}
        {checkinModalOpen && selectedAssignment && (
          <div className={styles.modalOverlay} onClick={() => setCheckinModalOpen(false)}>
            <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>
                  Razduživanje: {selectedAssignment.machine?.name}
                </h3>
                <button className={styles.modalCloseBtn} onClick={() => setCheckinModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleCheckinSubmit}>
                <div className={styles.modalBody}>
                  <SubmissionRecovery pending={!!checkinDraft.pending} busy={checkinMutation.isPending} error={checkinDraft.storageError}
                    onRetry={() => checkinDraft.pending && checkinMutation.mutate(checkinDraft.pending.payload)} />
                  {/* Info o početnom stanju */}
                  <div
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      padding: '0.85rem 1rem',
                      borderRadius: 10,
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                    }}
                  >
                    <span>
                      Radnik: <strong>{selectedAssignment.worker?.name}</strong>
                    </span>
                    <span>
                      Početni sati: <strong>{selectedAssignment.startHours} rh</strong>
                    </span>
                  </div>

                  {/* Krajnji radni sati */}
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      <span>Krajnji radni sati (rh) sa sata mašine</span>
                      {hoursWorkedLive > 0 && (
                        <span style={{ color: '#2563eb', fontWeight: 800 }}>
                          +{hoursWorkedLive} rh urađeno
                        </span>
                      )}
                    </label>
                    <div className={styles.inputWrapper}>
                      <input
                        type="number"
                        step="0.1"
                        min={selectedAssignment.startHours}
                        className={`${styles.inputField} ${styles.inputWithBadge}`}
                        value={checkinEndHours}
                        onChange={(e) => setCheckinEndHours(e.target.value)}
                        placeholder={String(selectedAssignment.startHours)}
                        required
                      />
                      <span className={styles.inputBadge}>rh</span>
                    </div>
                  </div>

                  {/* Nivo goriva na povratku (litara) */}
                  {(() => {
                    const tankCap = selectedAssignment.machine?.tankCapacityLiters || 200;
                    const isOverCap = Boolean(tankCap && Number(checkinFuelLiters) > tankCap);

                    return (
                      <div className={styles.formGroup}>
                        <div className={styles.labelRow}>
                          <label className={styles.formLabel} style={{ margin: 0 }}>
                            Stanje goriva na povratku (litara) *
                          </label>
                          <span className={styles.capacityHint}>
                            Kapacitet: {tankCap} L
                          </span>
                        </div>
                        <div className={styles.inputWrapper}>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            max={tankCap}
                            className={`${styles.inputField} ${styles.inputWithBadge} ${isOverCap ? styles.inputError : ''}`}
                            value={checkinFuelLiters}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val !== '' && Number(val) > tankCap) {
                                setCheckinFuelLiters(tankCap);
                                return;
                              }
                              setCheckinFuelLiters(val);
                            }}
                            placeholder={`npr. ${Math.min(120, tankCap)}`}
                            required
                          />
                          <span className={styles.inputBadge}>
                            Litara
                          </span>
                        </div>
                        {isOverCap && (
                          <div className={styles.errorMessage}>
                            <AlertCircle size={14} />
                            <span>Količina goriva ne može biti veća od kapaciteta mašine ({tankCap} L)!</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Prekidač ispravnosti mašine */}
                  <div
                    className={`${styles.operationalSwitch} ${checkinOperational ? styles.operationalSwitchActive : styles.operationalSwitchBroken
                      }`}
                    onClick={() => setCheckinOperational(!checkinOperational)}
                  >
                    <input
                      type="checkbox"
                      checked={checkinOperational}
                      onChange={(e) => setCheckinOperational(e.target.checked)}
                      style={{ width: 18, height: 18, cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                        {checkinOperational ? 'Mašina je potpuno ispravna' : 'PRIJAVI KVAR / OŠTEĆENJE'}
                      </div>
                    </div>
                  </div>

                  {/* Polje za opis kvara / napomenu */}
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      {checkinOperational ? 'Napomena pri povratku' : 'OPIS KVARA / PROBLEMA (OBAVEZNO)'}
                    </label>
                    <textarea
                      rows={3}
                      className={styles.inputField}
                      value={checkinNotes}
                      onChange={(e) => setCheckinNotes(e.target.value)}
                      placeholder={
                        checkinOperational
                          ? 'Opciono: zapažanja, pritisak u gumama...'
                          : 'Opišite kvar: npr. curi hidraulično crevo, čuje se ležaj...'
                      }
                      required={!checkinOperational}
                    />
                  </div>
                </div>

                <PhotoUpload photoUrl={checkinPhoto} label="Fotografija pri razduženju (opciono)" onChange={setCheckinPhoto} onUploadStateChange={setPhotoUploading} disabled={checkinMutation.isPending} />
                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.fuelBtn}
                    style={{ padding: '0.6rem 1rem' }}
                    onClick={() => setCheckinModalOpen(false)}
                  >
                    Otkaži
                  </button>
                  <button
                    type="submit"
                    className={styles.btnCheckin}
                    style={{ width: 'auto', padding: '0.65rem 1.5rem' }}
                    disabled={checkinMutation.isPending || photoUploading}
                  >
                    {checkinMutation.isPending ? 'Razduživanje...' : 'Potvrdi Razduživanje'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* MODAL ZA IZMENU ZADUŽENJA */}
        {editModalOpen && editingAssignment && (
          <EditAssignmentModal
            key={editingAssignment.id}
            assignment={editingAssignment}
            isSaving={updateAssignmentMutation.isPending}
            onClose={handleCloseEditModal}
            onOpenMachineUsage={handleOpenUsageFromEdit}
            onNotify={showToast}
            onSubmit={handleUpdateAssignmentSubmit}
          />
        )}

        {/* MODAL ZA PREGLED FOTOGRAFIJE I DETALJA UPISA */}
        {photoModalAssignment && (
          <AssignmentPhotoModal
            assignment={photoModalAssignment}
            onClose={handleClosePhotoModal}
          />
        )}
      </div>
      {usageId && <MachineUsageModal contextType="assignment" contextId={usageId} onClose={() => setUsageId(null)} />}
    </AppLayout>
  );
};

export default MasineZaduzenje;
