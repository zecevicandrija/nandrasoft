import { useDurableSubmission } from '../lib/useDurableSubmission';
import SubmissionRecovery from '../components/SubmissionRecovery';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import {
  Tractor,
  KeyRound,
  CheckCircle2,
  Clock,
  Fuel,
  User,
  FileText,
  Plus,
  Loader2,
  X,
  AlertCircle,
  Wrench,
  ShieldCheck,
  Zap,
  ArrowLeft,
  Pencil,
  Search,
  RotateCcw,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { useSession } from '../lib/auth-client';
import styles from './MasineZaduzenje.module.css';

const API = 'http://localhost:5000/api';

type TabType = 'active' | 'checkout' | 'history' | 'direct';
type HistoryPeriodType = 'danas' | 'nedelja' | 'mesec' | 'sve' | 'custom';

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const MasineZaduzenje: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [toast, setToast] = useState<Toast | null>(null);

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

  // Form states za novo zaduženje (Checkout)
  const [checkoutMachineId, setCheckoutMachineId] = useState('');
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

  // Edit Modal states (izmena zaduženja)
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<Record<string, any>>({});

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Uloga korisnika
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(currentUser?.role || '');
  const isOperator = currentUser?.role === 'OPERATER';

  const checkinDraft = useDurableSubmission('checkin', currentUser?.id,
    { selectedAssignment, checkinEndHours, checkinFuelLiters, checkinOperational, checkinNotes },
    (draft) => {
      setSelectedAssignment(draft.selectedAssignment); setCheckinEndHours(draft.checkinEndHours);
      setCheckinFuelLiters(draft.checkinFuelLiters); setCheckinOperational(draft.checkinOperational);
      setCheckinNotes(draft.checkinNotes); if (draft.selectedAssignment) setCheckinModalOpen(true);
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

  const getHistoryDateRange = () => {
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
  };

  const historyRange = getHistoryDateRange();

  // 1. STATISTIKA ZADUŽENJA
  const { data: statsData } = useQuery({
    queryKey: ['assignments-stats'],
    queryFn: async () => {
      const res = await fetch(`${API}/assignments/stats`, { credentials: 'include' });
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 2. AKTIVNA ZADUŽENJA (Paginacija 25 po strani)
  const { data: activeData, isLoading: loadingActive } = useQuery({
    queryKey: ['assignments-active', activePage],
    queryFn: async () => {
      const res = await fetch(`${API}/assignments/active?page=${activePage}&limit=25`, { credentials: 'include' });
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 3. SVA ZADUŽENJA (ISTORIJAT SA FILTERIMA I PAGINACIJOM)
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
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', String(historyPage));
      params.append('limit', '25');
      if (historyMachineId) params.append('machineId', historyMachineId);
      if (historyWorkerId) params.append('workerId', historyWorkerId);
      if (historyStatus) params.append('status', historyStatus);
      if (historyRange.from) params.append('dateFrom', historyRange.from);
      if (historyRange.to) params.append('dateTo', historyRange.to);

      const res = await fetch(`${API}/assignments?${params.toString()}`, { credentials: 'include' });
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // 4. ŠIFARNICI
  const { data: machinesData } = useQuery({
    queryKey: ['machines-all'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/machines`, { credentials: 'include' });
      return res.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: workersData } = useQuery({
    queryKey: ['workers-all'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/workers`, { credentials: 'include' });
      return res.json();
    },
  });

  // Slobodne mašine za zaduženje
  const freeMachines = machinesData?.machines?.filter((m: any) => m.status === 'SLOBODNA') || [];

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
  }, [workersData]);

  const allMachineOptions: CustomSelectOption[] = useMemo(() => {
    return (machinesData?.machines || []).map((m: any) => ({
      value: m.id,
      label: m.name,
      sublabel: `${m.brandModel || m.type || ''} • Stanje: ${m.currentHours ?? 0} rh`,
    }));
  }, [machinesData]);

  const historyMachineFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list = (machinesData?.machines || []).map((m: any) => ({
      value: m.id,
      label: m.name,
      sublabel: `${m.brandModel || m.type || ''}`,
    }));
    return [{ value: '', label: 'Sve mašine' }, ...list];
  }, [machinesData]);

  const historyWorkerFilterOptions: CustomSelectOption[] = useMemo(() => {
    const list = (workersData?.workers || []).map((w: any) => ({
      value: w.id,
      label: w.name,
      sublabel: w.type || 'RADNIK',
    }));
    return [{ value: '', label: 'Svi radnici' }, ...list];
  }, [workersData]);

  const historyStatusFilterOptions: CustomSelectOption[] = [
    { value: '', label: 'Svi statusi' },
    { value: 'ZADUZENA', label: 'Zadužena (Na njivi)' },
    { value: 'RAZDUZENA', label: 'Razdužena (Završeno)' },
    { value: 'POKVARENA', label: 'Prijavljen kvar' },
  ];

  // Prilikom izbora mašine, automatski preuzmi njene trenutne radne sate i kapacitet goriva
  const handleSelectMachine = (machineId: string) => {
    setCheckoutMachineId(machineId);
    const m = machinesData?.machines?.find((item: any) => item.id === machineId);
    if (m) {
      setCheckoutStartHours(m.currentHours || 0);
      setCheckoutFuelLiters(
        m.currentFuelLiters !== undefined && m.currentFuelLiters !== null && m.currentFuelLiters > 0
          ? m.currentFuelLiters
          : m.tankCapacityLiters || ''
      );
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
      queryClient.invalidateQueries({ queryKey: ['assignments-active'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-stats'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-history'] });
      queryClient.invalidateQueries({ queryKey: ['machines-all'] });

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
      queryClient.invalidateQueries({ queryKey: ['assignments-active'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-stats'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-history'] });
      queryClient.invalidateQueries({ queryKey: ['machines-all'] });

      setCheckinModalOpen(false);
      setSelectedAssignment(null);
      showToast(data.message || 'Mašina uspešno razdužena.', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  const handleOpenCheckin = (assignment: any) => {
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
    setCheckinModalOpen(true);
  };

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

    const selectedM = machinesData?.machines?.find((item: any) => item.id === checkoutMachineId);
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
      assignNotes: checkoutNotes || null,
    });
  };

  const handleCheckinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignment) return;

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
      isOperational: checkinOperational,
      returnNotes: checkinNotes || null,
    });
  };

  // MUTACIJA I HANDLERI ZA IZMENU ZADUŽENJA (EDIT)
  const handleOpenEdit = (assignment: any) => {
    setEditingAssignment(assignment);
    setEditForm({
      startHours: assignment.startHours,
      endHours: assignment.endHours !== null && assignment.endHours !== undefined ? assignment.endHours : '',
      startFuelLiters:
        assignment.startFuelLiters !== null && assignment.startFuelLiters !== undefined
          ? assignment.startFuelLiters
          : '',
      endFuelLiters:
        assignment.endFuelLiters !== null && assignment.endFuelLiters !== undefined
          ? assignment.endFuelLiters
          : '',
      isOperational: assignment.isOperational ?? true,
      assignNotes: assignment.assignNotes || '',
      returnNotes: assignment.returnNotes || '',
    });
    setEditModalOpen(true);
  };

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
      queryClient.invalidateQueries({ queryKey: ['assignments-active'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-stats'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-history'] });
      queryClient.invalidateQueries({ queryKey: ['machines-all'] });
      setEditModalOpen(false);
      setEditingAssignment(null);
      showToast(data.message || 'Zaduženje uspešno izmenjeno.', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAssignment) return;

    const startH = Number(editForm.startHours);
    if (isNaN(startH) || startH < 0) {
      showToast('Početni radni sati moraju biti pozitivan broj.', 'error');
      return;
    }

    const maxTank = editingAssignment.machine?.tankCapacityLiters;
    const startLiters =
      editForm.startFuelLiters !== '' && editForm.startFuelLiters !== null
        ? Number(editForm.startFuelLiters)
        : null;
    const endLiters =
      editForm.endFuelLiters !== '' && editForm.endFuelLiters !== null
        ? Number(editForm.endFuelLiters)
        : null;

    if (maxTank && startLiters !== null && startLiters > maxTank) {
      showToast(
        `Početno gorivo (${startLiters} L) ne može biti veće od kapaciteta rezervoara (${maxTank} L).`,
        'error'
      );
      return;
    }

    if (maxTank && endLiters !== null && endLiters > maxTank) {
      showToast(
        `Krajnje gorivo (${endLiters} L) ne može biti veće od kapaciteta rezervoara (${maxTank} L).`,
        'error'
      );
      return;
    }

    const payload: any = {
      startHours: startH,
      startFuelLiters: startLiters,
      assignNotes: editForm.assignNotes || null,
    };

    if (editingAssignment.status !== 'ZADUZENA') {
      if (editForm.endHours !== '' && editForm.endHours !== null && editForm.endHours !== undefined) {
        const endH = Number(editForm.endHours);
        if (isNaN(endH) || endH < startH) {
          showToast(`Krajnji radni sati (${endH} rh) ne mogu biti manji od početnih (${startH} rh).`, 'error');
          return;
        }
        payload.endHours = endH;
      }
      payload.endFuelLiters = endLiters;
      payload.isOperational = Boolean(editForm.isOperational);
      payload.returnNotes = editForm.returnNotes || null;
    }

    updateAssignmentMutation.mutate({
      id: editingAssignment.id,
      data: payload,
    });
  };

  // Učitavanje i automatsko popunjavanje direktnog zaduženja iz URL parametara
  useEffect(() => {
    if (isDirectParam && isManager) {
      setActiveTab('direct');
      if (paramMachineId) setDirectMachineId(paramMachineId);
      if (paramWorkerId) setDirectWorkerId(paramWorkerId);
      if (paramDate) setDirectDate(paramDate);

      const m = machinesData?.machines?.find((item: any) => item.id === paramMachineId);
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
  }, [isDirectParam, isManager, paramMachineId, paramWorkerId, paramDate, paramWorkHours, machinesData]);

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
    setDirectMachineId(id);
    const m = machinesData?.machines?.find((item: any) => item.id === id);
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
      queryClient.invalidateQueries({ queryKey: ['assignments-active'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-stats'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-history'] });
      queryClient.invalidateQueries({ queryKey: ['machines-all'] });
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

    const selectedDirectM = machinesData?.machines?.find((m: any) => m.id === directMachineId);
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
      isOperational: directOperational,
      notes: directNotes,
    });
  };

  const activeAssignments = activeData?.assignments || [];
  const activeTotal = activeData?.total || 0;
  const activeTotalPages = activeData?.totalPages || 1;

  const rawHistoryList = historyData?.assignments || [];
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
            <span className={styles.tabBadge}>{historyTotal}</span>
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
          <div>
            {loadingActive ? (
              <div style={{ textAlign: 'center', padding: '3rem' }}>
                <Loader2 size={32} className="spin" />
              </div>
            ) : activeAssignments.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '3.5rem',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: 16,
                  border: '1px solid var(--border-color)',
                }}
              >
                <Tractor size={42} color="var(--text-muted)" style={{ margin: '0 auto 0.75rem' }} />
                <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Nema aktivno zaduženih mašina</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '0.4rem' }}>
                  Sve mašine su trenutno parkirane u dvorištu firme. Kliknite na "Novo Zaduženje" da preuzmete traktor.
                </p>
                <button
                  onClick={() => setActiveTab('checkout')}
                  className={styles.btnCheckoutSubmit}
                  style={{ maxWidth: 220, margin: '1rem auto 0' }}
                >
                  <Plus size={16} />
                  <span>Zaduži Mašinu</span>
                </button>
              </div>
            ) : (
              <>
                <div className={styles.activeGrid}>
                  {activeAssignments.map((a: any) => {
                    const assignedTime = new Date(a.assignedAt).toLocaleTimeString('sr-RS', {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const assignedDate = new Date(a.assignedAt).toLocaleDateString('sr-RS');

                    return (
                      <div key={a.id} className={styles.checkoutCard}>
                        <div className={styles.checkoutHeader}>
                          <div>
                            <div className={styles.machineName}>
                              <Tractor size={18} color="#d97706" />
                              <span>{a.machine?.name}</span>
                            </div>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {a.machine?.brandModel}
                            </span>
                          </div>
                          {a.machine?.regNumber && (
                            <span className={styles.regBadge}>{a.machine?.regNumber}</span>
                          )}
                        </div>

                        <div className={styles.checkoutDetails}>
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>
                              <User size={14} /> Radnik:
                            </span>
                            <span className={styles.detailValue}>{a.worker?.name}</span>
                          </div>

                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>
                              <Clock size={14} /> Zaduženo:
                            </span>
                            <span className={styles.detailValue}>
                              {assignedDate} u {assignedTime}
                            </span>
                          </div>

                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>
                              <Tractor size={14} /> Početni sati:
                            </span>
                            <span className={`${styles.detailValue} ${styles.hoursBadge}`}>
                              {a.startHours} rh
                            </span>
                          </div>

                          {(a.startFuelLiters !== null && a.startFuelLiters !== undefined) ? (
                            <div className={styles.detailRow}>
                              <span className={styles.detailLabel}>
                                <Fuel size={14} /> Gorivo na polasku:
                              </span>
                              <span className={`${styles.detailValue} ${styles.fuelBadge}`}>
                                {a.startFuelLiters} L
                              </span>
                            </div>
                          ) : a.startFuelLevel !== null && (
                            <div className={styles.detailRow}>
                              <span className={styles.detailLabel}>
                                <Fuel size={14} /> Gorivo na polasku:
                              </span>
                              <span className={`${styles.detailValue} ${styles.fuelBadge}`}>
                                {a.startFuelLevel}%
                              </span>
                            </div>
                          )}

                          {a.assignNotes && (
                            <div className={styles.detailRow} style={{ marginTop: '0.2rem' }}>
                              <span className={styles.detailLabel}>
                                <FileText size={14} /> Napomena:
                              </span>
                              <span className={styles.notesValue}>
                                {a.assignNotes}
                              </span>
                            </div>
                          )}
                        </div>

                        <button
                          className={styles.btnCheckin}
                          onClick={() => handleOpenCheckin(a)}
                          title="Razduži mašinu i upiši radne sate"
                        >
                          <CheckCircle2 size={16} />
                          <span>Razduži Mašinu (Kraj Smene)</span>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {activeTotal > 0 && (
                  <div style={{ marginTop: '1.25rem' }}>
                    <TablePagination
                      currentPage={activePage}
                      totalPages={activeTotalPages}
                      onPageChange={(p) => setActivePage(p)}
                      totalItems={activeTotal}
                      pageSize={25}
                    />
                  </div>
                )}
              </>
            )}
          </div>
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
                const selectedM = machinesData?.machines?.find((m: any) => m.id === checkoutMachineId);
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
                const selectedDirectM = machinesData?.machines?.find((m: any) => m.id === directMachineId);
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
          <div>
            {/* Brzi Periodi i Filteri */}
            <div className={styles.historyFilterCard}>
              <div className={styles.periodButtonsRow}>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${historyPeriod === 'danas' ? styles.periodBtnActive : ''}`}
                  onClick={() => setHistoryPeriod('danas')}
                >
                  Danas
                </button>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${historyPeriod === 'nedelja' ? styles.periodBtnActive : ''}`}
                  onClick={() => setHistoryPeriod('nedelja')}
                >
                  Ova Nedelja
                </button>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${historyPeriod === 'mesec' ? styles.periodBtnActive : ''}`}
                  onClick={() => setHistoryPeriod('mesec')}
                >
                  Ovaj Mesec
                </button>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${historyPeriod === 'sve' ? styles.periodBtnActive : ''}`}
                  onClick={() => setHistoryPeriod('sve')}
                >
                  Svi Unosi
                </button>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${historyPeriod === 'custom' ? styles.periodBtnActive : ''}`}
                  onClick={() => setHistoryPeriod('custom')}
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
                    onChange={(e) => setHistoryDateFrom(e.target.value)}
                  />
                  <span>Do:</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={historyDateTo}
                    onChange={(e) => setHistoryDateTo(e.target.value)}
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
                      onChange={(e) => setHistorySearch(e.target.value)}
                    />
                  </div>
                </div>

                <div className={styles.filterControlCol}>
                  <span className={styles.filterFieldLabel}>Mašina</span>
                  <CustomSelect
                    value={historyMachineId}
                    onChange={(val) => setHistoryMachineId(val)}
                    options={historyMachineFilterOptions}
                    placeholder="Sve mašine"
                    searchable
                  />
                </div>

                {!isOperator && (
                  <div className={styles.filterControlCol}>
                    <span className={styles.filterFieldLabel}>Radnik</span>
                    <CustomSelect
                      value={historyWorkerId}
                      onChange={(val) => setHistoryWorkerId(val)}
                      options={historyWorkerFilterOptions}
                      placeholder="Svi radnici"
                      searchable
                    />
                  </div>
                )}

                <div className={styles.filterControlCol}>
                  <span className={styles.filterFieldLabel}>Status</span>
                  <CustomSelect
                    value={historyStatus}
                    onChange={(val) => setHistoryStatus(val)}
                    options={historyStatusFilterOptions}
                    placeholder="Svi statusi"
                    searchable={false}
                  />
                </div>

                <div className={styles.filterControlCol}>
                  <button
                    type="button"
                    className={styles.btnResetFilters}
                    onClick={() => {
                      setHistoryPeriod('sve');
                      setHistoryDateFrom('');
                      setHistoryDateTo('');
                      setHistoryMachineId('');
                      setHistoryWorkerId('');
                      setHistoryStatus('');
                      setHistorySearch('');
                    }}
                    title="Poništi sve filtere"
                  >
                    <RotateCcw size={15} />
                    <span>Reset</span>
                  </button>
                </div>
              </div>
            </div>

            <div className={styles.tableCard}>
              {loadingHistory ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                  <Loader2 size={32} className="spin" />
                </div>
              ) : historyList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  Nema zabeleženih zaduženja u istorijatu.
                </div>
              ) : (
                <>
                  {/* Desktop View: Full Table */}
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
                          {historyList.map((a: any) => {
                            const dateStr = new Date(a.assignedAt).toLocaleDateString('sr-RS');
                            const hasEndHours = a.endHours !== null && a.endHours !== undefined && a.endHours !== '';
                            const hasStartHours = a.startHours !== null && a.startHours !== undefined && a.startHours !== '';
                            const hoursDiff =
                              hasEndHours && hasStartHours
                                ? Math.round((Number(a.endHours) - Number(a.startHours)) * 10) / 10
                                : null;

                            return (
                              <tr key={a.id}>
                                <td>
                                  <strong>{dateStr}</strong>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                    {new Date(a.assignedAt).toLocaleTimeString('sr-RS', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })}
                                  </div>
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
                                <td>
                                  {a.startFuelLiters !== null && a.startFuelLiters !== undefined ? (
                                    <span>
                                      {a.startFuelLiters} L {a.endFuelLiters !== null && a.endFuelLiters !== undefined ? `→ ${a.endFuelLiters} L` : ''}
                                      {a.endFuelLiters !== null && a.endFuelLiters !== undefined && Number(a.startFuelLiters) >= Number(a.endFuelLiters) ? (
                                        <span style={{ fontSize: '0.75rem', color: '#16a34a', marginLeft: '5px', fontWeight: 600 }}>
                                          (-{Math.round((Number(a.startFuelLiters) - Number(a.endFuelLiters)) * 10) / 10} L)
                                        </span>
                                      ) : null}
                                    </span>
                                  ) : a.endFuelLiters !== null && a.endFuelLiters !== undefined ? (
                                    <span>
                                      {a.endFuelLiters} L
                                    </span>
                                  ) : a.startFuelLevel !== null && a.startFuelLevel !== undefined ? (
                                    <span>
                                      {a.startFuelLevel}% {a.endFuelLevel !== null ? `→ ${a.endFuelLevel}%` : ''}
                                    </span>
                                  ) : (
                                    '-'
                                  )}
                                </td>
                                <td>
                                  <span
                                    className={`${styles.statusBadge} ${
                                      a.status === 'ZADUZENA'
                                        ? styles.statusBadgeActive
                                        : a.status === 'RAZDUZENA'
                                          ? styles.statusBadgeReturned
                                          : styles.statusBadgeBroken
                                    }`}
                                  >
                                    {a.status === 'ZADUZENA'
                                      ? 'Zadužena'
                                      : a.status === 'RAZDUZENA'
                                        ? 'Razdužena'
                                        : 'Pokvarena'}
                                  </span>
                                </td>
                                <td style={{ maxWidth: 220, color: 'var(--text-secondary)' }}>
                                  {a.returnNotes || a.assignNotes || '-'}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                  <div className={styles.rowActions} style={{ justifyContent: 'flex-end' }}>
                                    {isManager || (isOperator && isSameCalendarDay(a.assignedAt)) ? (
                                      <button
                                        className={styles.btnIcon}
                                        title="Izmeni unos zaduženja"
                                        onClick={() => handleOpenEdit(a)}
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
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Mobile View: Responsive Cards */}
                  <div className={styles.mobileCardsView}>
                    {historyList.map((a: any) => {
                      const dateStr = new Date(a.assignedAt).toLocaleDateString('sr-RS');
                      const timeStr = new Date(a.assignedAt).toLocaleTimeString('sr-RS', {
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      const hasEndHours = a.endHours !== null && a.endHours !== undefined && a.endHours !== '';
                      const hasStartHours = a.startHours !== null && a.startHours !== undefined && a.startHours !== '';
                      const hoursDiff =
                        hasEndHours && hasStartHours
                          ? Math.round((Number(a.endHours) - Number(a.startHours)) * 10) / 10
                          : null;

                      const canEdit = isManager || (isOperator && isSameCalendarDay(a.assignedAt));

                      return (
                        <div key={a.id} className={styles.historyCard}>
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
                            <span
                              className={`${styles.statusBadge} ${
                                a.status === 'ZADUZENA'
                                  ? styles.statusBadgeActive
                                  : a.status === 'RAZDUZENA'
                                    ? styles.statusBadgeReturned
                                    : styles.statusBadgeBroken
                              }`}
                            >
                              {a.status === 'ZADUZENA'
                                ? 'Zadužena'
                                : a.status === 'RAZDUZENA'
                                  ? 'Razdužena'
                                  : 'Pokvarena'}
                            </span>
                          </div>

                          <div className={styles.historyCardStats}>
                            <div className={styles.historyStatBox}>
                              <span className={styles.historyStatLabel}>Radni sati</span>
                              <div className={styles.historyStatValue}>
                                {hasStartHours ? `${a.startHours} rh` : '-'}
                                {hasEndHours ? ` → ${a.endHours} rh` : ''}
                                {hoursDiff !== null && (
                                  <span className={styles.hoursDiffBadge}>+{hoursDiff} rh</span>
                                )}
                              </div>
                            </div>

                            <div className={styles.historyStatBox}>
                              <span className={styles.historyStatLabel}>Gorivo</span>
                              <div className={styles.historyStatValue}>
                                {a.startFuelLiters !== null && a.startFuelLiters !== undefined ? (
                                  <span>
                                    {a.startFuelLiters} L {a.endFuelLiters !== null && a.endFuelLiters !== undefined ? `→ ${a.endFuelLiters} L` : ''}
                                    {a.endFuelLiters !== null && a.endFuelLiters !== undefined && Number(a.startFuelLiters) >= Number(a.endFuelLiters) ? (
                                      <span className={styles.fuelDiffBadge}>
                                        (-{Math.round((Number(a.startFuelLiters) - Number(a.endFuelLiters)) * 10) / 10} L)
                                      </span>
                                    ) : null}
                                  </span>
                                ) : a.endFuelLiters !== null && a.endFuelLiters !== undefined ? (
                                  <span>{a.endFuelLiters} L</span>
                                ) : (
                                  '-'
                                )}
                              </div>
                            </div>
                          </div>

                          {(a.returnNotes || a.assignNotes) && (
                            <div className={styles.historyCardNotes}>
                              <FileText size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                              <span>{a.returnNotes || a.assignNotes}</span>
                            </div>
                          )}

                          {canEdit && (
                            <div className={styles.historyCardFooter}>
                              <button
                                type="button"
                                className={styles.btnEditMobile}
                                onClick={() => handleOpenEdit(a)}
                              >
                                <Pencil size={14} />
                                <span>Izmeni unos zaduženja</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Paginacija za Istorijat Zaduženja (25 po strani sa direktnim unosom) */}
                  {historyTotal > 0 && (
                    <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)' }}>
                      <TablePagination
                        currentPage={historyPage}
                        totalPages={historyTotalPages}
                        onPageChange={(p) => setHistoryPage(p)}
                        totalItems={historyTotal}
                        pageSize={25}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
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
                    disabled={checkinMutation.isPending}
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
          <div className={styles.modalOverlay} onClick={() => setEditModalOpen(false)}>
            <div className={styles.modalBox} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>
                  Izmena Zaduženja: {editingAssignment.machine?.name}
                </h3>
                <button className={styles.modalCloseBtn} onClick={() => setEditModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveEdit}>
                <div className={styles.modalBody}>
                  {/* Info radnik i datum */}
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
                      Radnik: <strong>{editingAssignment.worker?.name}</strong>
                    </span>
                    <span>
                      Datum: <strong>{new Date(editingAssignment.assignedAt).toLocaleDateString('sr-RS')}</strong>
                    </span>
                  </div>

                  {/* Početni i Krajnji radni sati */}
                  <div className={styles.twoColRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Početni radni sati (rh)</label>
                      <div className={styles.inputWrapper}>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          className={`${styles.inputField} ${styles.inputWithBadge}`}
                          value={editForm.startHours}
                          onChange={(e) => setEditForm({ ...editForm, startHours: e.target.value })}
                          required
                        />
                        <span className={styles.inputBadge}>rh</span>
                      </div>
                    </div>

                    {editingAssignment.status !== 'ZADUZENA' && (
                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>Krajnji radni sati (rh)</label>
                        <div className={styles.inputWrapper}>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            className={`${styles.inputField} ${styles.inputWithBadge}`}
                            value={editForm.endHours}
                            onChange={(e) => setEditForm({ ...editForm, endHours: e.target.value })}
                          />
                          <span className={styles.inputBadge}>rh</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Gorivo na polasku (litara) */}
                  {(() => {
                    const tankCap = editingAssignment.machine?.tankCapacityLiters || 200;
                    return (
                      <div className={styles.formGroup}>
                        <div className={styles.labelRow}>
                          <label className={styles.formLabel} style={{ margin: 0 }}>
                            Gorivo na polasku (L)
                          </label>
                          <span className={styles.capacityHint}>
                            Maks: {tankCap} L
                          </span>
                        </div>
                        <div className={styles.inputWrapper}>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            max={tankCap}
                            className={`${styles.inputField} ${styles.inputWithBadge}`}
                            value={editForm.startFuelLiters}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val !== '' && Number(val) > tankCap) {
                                setEditForm({ ...editForm, startFuelLiters: tankCap });
                                return;
                              }
                              setEditForm({ ...editForm, startFuelLiters: val });
                            }}
                            placeholder={`npr. ${tankCap}`}
                          />
                          <span className={styles.inputBadge}>
                            Litara
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Gorivo na povratku (ako je razdužena) */}
                  {editingAssignment.status !== 'ZADUZENA' && (() => {
                    const tankCap = editingAssignment.machine?.tankCapacityLiters || 200;
                    return (
                      <div className={styles.formGroup}>
                        <div className={styles.labelRow}>
                          <label className={styles.formLabel} style={{ margin: 0 }}>
                            Gorivo na povratku (L)
                          </label>
                          <span className={styles.capacityHint}>
                            Maks: {tankCap} L
                          </span>
                        </div>
                        <div className={styles.inputWrapper}>
                          <input
                            type="number"
                            step="1"
                            min="0"
                            max={tankCap}
                            className={`${styles.inputField} ${styles.inputWithBadge}`}
                            value={editForm.endFuelLiters}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val !== '' && Number(val) > tankCap) {
                                setEditForm({ ...editForm, endFuelLiters: tankCap });
                                return;
                              }
                              setEditForm({ ...editForm, endFuelLiters: val });
                            }}
                            placeholder={`npr. ${Math.round(tankCap * 0.75)}`}
                          />
                          <span className={styles.inputBadge}>
                            Litara
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Ispravnost mašine (ako je razdužena) */}
                  {editingAssignment.status !== 'ZADUZENA' && (
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Stanje ispravnosti mašine</label>
                      <div className={styles.toggleBtnGroup}>
                        <button
                          type="button"
                          className={`${styles.toggleBtn} ${editForm.isOperational ? styles.toggleBtnActiveSuccess : ''}`}
                          onClick={() => setEditForm({ ...editForm, isOperational: true })}
                        >
                          <CheckCircle2 size={16} />
                          Ispravna
                        </button>
                        <button
                          type="button"
                          className={`${styles.toggleBtn} ${!editForm.isOperational ? styles.toggleBtnActiveDanger : ''}`}
                          onClick={() => setEditForm({ ...editForm, isOperational: false })}
                        >
                          <AlertCircle size={16} />
                          Prijavljen kvar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Napomena pri preuzimanju */}
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Napomena pri preuzimanju</label>
                    <input
                      type="text"
                      className={styles.inputField}
                      value={editForm.assignNotes}
                      onChange={(e) => setEditForm({ ...editForm, assignNotes: e.target.value })}
                      placeholder="Opciona napomena preuzimanja"
                    />
                  </div>

                  {/* Napomena / opis kvara pri povratku */}
                  {editingAssignment.status !== 'ZADUZENA' && (
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>
                        {editForm.isOperational ? 'Napomena pri povratku' : 'Opis kvara / problema'}
                      </label>
                      <textarea
                        rows={2}
                        className={styles.inputField}
                        value={editForm.returnNotes}
                        onChange={(e) => setEditForm({ ...editForm, returnNotes: e.target.value })}
                        placeholder={editForm.isOperational ? 'Opciona napomena' : 'Opišite kvar...'}
                      />
                    </div>
                  )}
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.fuelBtn}
                    style={{ padding: '0.6rem 1rem' }}
                    onClick={() => setEditModalOpen(false)}
                  >
                    Otkaži
                  </button>
                  <button
                    type="submit"
                    className={styles.btnCheckin}
                    style={{ width: 'auto', padding: '0.65rem 1.5rem', backgroundColor: '#16a34a' }}
                    disabled={updateAssignmentMutation.isPending}
                  >
                    {updateAssignmentMutation.isPending ? 'Čuvanje...' : 'Sačuvaj Izmene'}
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

export default MasineZaduzenje;
