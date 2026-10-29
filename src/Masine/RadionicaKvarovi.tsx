import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Wrench,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Tractor,
  Plus,
  Search,
  Calendar,
  User,
  MapPin,
  ClipboardList,
  AlertCircle,
  X,
  History,
  RefreshCw,
  RotateCcw,
  Pencil,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { useSession } from '../lib/auth-client';
import styles from './RadionicaKvarovi.module.css';

const API = '/api';
const PAGE_SIZE = 25;

type TabType = 'kvarovi' | 'nalozi' | 'istorijat';

const LUBRICANT_OPTIONS = [
  'BEZ MAZIVA / NIJE POTREBNO',
  'HIDROL-46 (Hidraulično ulje)',
  'TOTAL DYNATRANS MPV (Transmisija i hidraulika)',
  'MOTORNO 15W-40 (Motorno ulje)',
  'HIPENOL 90 (Menjačko ulje)',
  'LITIJUMSKA MAST EP-2 (Ležajevi i zglobovi)',
  'OSTALO',
];

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const RadionicaKvarovi: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const userRole = currentUser?.role || 'MEHANICAR';
  const isManagerOrDirector = ['RUKOVODILAC', 'DIREKTOR'].includes(userRole);

  const [activeTab, setActiveTab] = useState<TabType>('kvarovi');
  const [toast, setToast] = useState<Toast | null>(null);

  // Stats State
  const [stats, setStats] = useState({
    brokenIssues: 0,
    inRepairIssues: 0,
    waitingPartsIssues: 0,
    repairedIssues: 0,
    totalActiveIssues: 0,
    freeMachines: 0,
    brokenMachines: 0,
    serviceMachines: 0,
    remontOrders: 0,
  });

  // Master Data
  const [machines, setMachines] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);

  // ==========================================
  // TAB 1: Kvarovi sa terena (Paginacija 25)
  // ==========================================
  const [issues, setIssues] = useState<any[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [issueStatusFilter, setIssueStatusFilter] = useState('AKTIVNI');
  const [issuePriorityFilter, setIssuePriorityFilter] = useState('');
  const [issueMachineFilter, setIssueMachineFilter] = useState('');
  const [issueSearch, setIssueSearch] = useState('');
  const [debouncedIssueSearch, setDebouncedIssueSearch] = useState('');
  const [issuesPage, setIssuesPage] = useState(1);
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [issuesTotalPages, setIssuesTotalPages] = useState(1);

  // ==========================================
  // TAB 2: Nalozi za remont (Paginacija 25)
  // ==========================================
  const [remontOrders, setRemontOrders] = useState<any[]>([]);
  const [loadingRemontOrders, setLoadingRemontOrders] = useState(false);
  const [remontMachineFilter, setRemontMachineFilter] = useState('');
  const [remontWorkerFilter, setRemontWorkerFilter] = useState('');
  const [remontSearch, setRemontSearch] = useState('');
  const [debouncedRemontSearch, setDebouncedRemontSearch] = useState('');
  const [remontPage, setRemontPage] = useState(1);
  const [remontTotal, setRemontTotal] = useState(0);
  const [remontTotalPages, setRemontTotalPages] = useState(1);

  // ==========================================
  // TAB 3: Servisna knjižica (Paginacija 25)
  // ==========================================
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyMachineFilter, setHistoryMachineFilter] = useState('');
  const [historyDateFrom, setHistoryDateFrom] = useState('');
  const [historyDateTo, setHistoryDateTo] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [debouncedHistorySearch, setDebouncedHistorySearch] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);

  // Resolve Modal State
  const [selectedIssueToResolve, setSelectedIssueToResolve] = useState<any | null>(null);
  const [resolveRepairNotes, setResolveRepairNotes] = useState('');
  const [resolvePartsReplaced, setResolvePartsReplaced] = useState('');
  const [resolveLubricantType, setResolveLubricantType] = useState(LUBRICANT_OPTIONS[1]);
  const [resolveLubricantLiters, setResolveLubricantLiters] = useState<string | number>('');
  const [resolvePartsCost, setResolvePartsCost] = useState<string | number>('');
  const [resolveLaborCost, setResolveLaborCost] = useState<string | number>('');
  const [submittingResolve, setSubmittingResolve] = useState(false);
  const [isEditingCompletedReport, setIsEditingCompletedReport] = useState(false);

  // New Remont Order Modal State (Manager / Director)
  const [isRemontModalOpen, setIsRemontModalOpen] = useState(false);
  const [remontMachineId, setRemontMachineId] = useState('');
  const [remontWorkerId, setRemontWorkerId] = useState('');
  const [remontServiceType, setRemontServiceType] = useState('REDOVAN_SERVIS');
  const [remontPriority, setRemontPriority] = useState('VISOKA');
  const [remontDate, setRemontDate] = useState(new Date().toISOString().split('T')[0]);
  const [remontInstructions, setRemontInstructions] = useState('');
  const [submittingRemont, setSubmittingRemont] = useState(false);

  // New Defect / Service Modal State (Mehaničar / Rukovodilac)
  const [isNewIssueModalOpen, setIsNewIssueModalOpen] = useState(false);
  const [newIssueMachineId, setNewIssueMachineId] = useState('');
  const [newIssueServiceType, setNewIssueServiceType] = useState('KVAR_NJIVA');
  const [newIssuePriority, setNewIssuePriority] = useState('VISOKA');
  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [newIssueDesc, setNewIssueDesc] = useState('');
  const [submittingNewIssue, setSubmittingNewIssue] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Debounce za pretrage (300ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedIssueSearch(issueSearch), 300);
    return () => clearTimeout(t);
  }, [issueSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedRemontSearch(remontSearch), 300);
    return () => clearTimeout(t);
  }, [remontSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedHistorySearch(historySearch), 300);
    return () => clearTimeout(t);
  }, [historySearch]);

  // Učitaj statistiku
  const fetchStats = async () => {
    try {
      const res = await fetch(`${API}/maintenance/stats`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju statistike radionice:', err);
    }
  };

  // Učitaj šifarnike mašina i radnika
  const fetchMasterData = async () => {
    try {
      const [mRes, wRes] = await Promise.all([
        fetch(`${API}/master/machines`, { credentials: 'include' }),
        fetch(`${API}/master/workers`, { credentials: 'include' }),
      ]);
      if (mRes.ok) {
        const data = await mRes.json();
        setMachines(data.machines || []);
      }
      if (wRes.ok) {
        const data = await wRes.json();
        setWorkers(data.workers || []);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju šifarnika:', err);
    }
  };

  // ==========================================
  // FETCH TAB 1: KVAROVI (Server-side 25 po strani)
  // ==========================================
  const fetchIssues = async (page = issuesPage, isSilent = false) => {
    if (!isSilent && issues.length === 0) setLoadingIssues(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(PAGE_SIZE));
      if (issueStatusFilter) params.append('status', issueStatusFilter);
      if (issuePriorityFilter) params.append('priority', issuePriorityFilter);
      if (issueMachineFilter) params.append('machineId', issueMachineFilter);
      if (debouncedIssueSearch.trim()) params.append('search', debouncedIssueSearch.trim());

      const res = await fetch(`${API}/maintenance/issues?${params.toString()}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setIssues(data.issues || []);
        setIssuesTotal(data.total ?? (data.issues?.length || 0));
        setIssuesTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju kvarova:', err);
    } finally {
      setLoadingIssues(false);
    }
  };

  // ==========================================
  // FETCH TAB 2: REMONT NALOZI (Server-side 25 po strani)
  // ==========================================
  const fetchRemontOrders = async (page = remontPage, isSilent = false) => {
    if (!isSilent && remontOrders.length === 0) setLoadingRemontOrders(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(PAGE_SIZE));
      if (remontMachineFilter) params.append('machineId', remontMachineFilter);
      if (remontWorkerFilter) params.append('workerId', remontWorkerFilter);
      if (debouncedRemontSearch.trim()) params.append('search', debouncedRemontSearch.trim());

      const res = await fetch(`${API}/maintenance/remont-orders?${params.toString()}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setRemontOrders(data.orders || []);
        setRemontTotal(data.total ?? (data.orders?.length || 0));
        setRemontTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju naloga za remont:', err);
    } finally {
      setLoadingRemontOrders(false);
    }
  };

  // ==========================================
  // FETCH TAB 3: SERVISNA KNJIŽICA (Server-side 25 po strani)
  // ==========================================
  const fetchHistory = async (page = historyPage, isSilent = false) => {
    if (!isSilent && historyItems.length === 0) setLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      params.append('page', String(page));
      params.append('limit', String(PAGE_SIZE));
      if (historyMachineFilter) params.append('machineId', historyMachineFilter);
      if (historyDateFrom) params.append('dateFrom', historyDateFrom);
      if (historyDateTo) params.append('dateTo', historyDateTo);
      if (debouncedHistorySearch.trim()) params.append('search', debouncedHistorySearch.trim());

      const res = await fetch(`${API}/maintenance/history?${params.toString()}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryItems(data.history || []);
        setHistoryTotal(data.total ?? (data.history?.length || 0));
        setHistoryTotalPages(data.totalPages || 1);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju servisne knjižice:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Inicijalno učitavanje
  useEffect(() => {
    fetchStats();
    fetchMasterData();

    const orderIdParam = searchParams.get('orderId');
    const machineIdParam = searchParams.get('machineId');

    if (orderIdParam) {
      setActiveTab('nalozi');
    } else if (machineIdParam) {
      setIssueMachineFilter(machineIdParam);
    }
  }, [searchParams]);

  // Tab 1: Reagovanje na filtere i pretragu -> reset na stranu 1
  useEffect(() => {
    if (activeTab === 'kvarovi') {
      setIssuesPage(1);
      fetchIssues(1, true);
    }
  }, [issueStatusFilter, issuePriorityFilter, issueMachineFilter, debouncedIssueSearch]);

  // Tab 2: Reagovanje na filtere i pretragu -> reset na stranu 1
  useEffect(() => {
    if (activeTab === 'nalozi') {
      setRemontPage(1);
      fetchRemontOrders(1, true);
    }
  }, [remontMachineFilter, remontWorkerFilter, debouncedRemontSearch]);

  // Tab 3: Reagovanje na filtere i pretragu -> reset na stranu 1
  useEffect(() => {
    if (activeTab === 'istorijat') {
      setHistoryPage(1);
      fetchHistory(1, true);
    }
  }, [historyMachineFilter, historyDateFrom, historyDateTo, debouncedHistorySearch]);

  // Promena taba
  useEffect(() => {
    if (activeTab === 'kvarovi') {
      fetchIssues(issuesPage, true);
    } else if (activeTab === 'nalozi') {
      fetchRemontOrders(remontPage, true);
    } else if (activeTab === 'istorijat') {
      fetchHistory(historyPage, true);
    }
  }, [activeTab]);

  // Paginacija hendleri
  const handleIssuesPageChange = (newPage: number) => {
    setIssuesPage(newPage);
    fetchIssues(newPage);
    window.scrollTo({ top: 380, behavior: 'smooth' });
  };

  const handleRemontPageChange = (newPage: number) => {
    setRemontPage(newPage);
    fetchRemontOrders(newPage);
    window.scrollTo({ top: 380, behavior: 'smooth' });
  };

  const handleHistoryPageChange = (newPage: number) => {
    setHistoryPage(newPage);
    fetchHistory(newPage);
    window.scrollTo({ top: 380, behavior: 'smooth' });
  };

  // Promena statusa kvara (Preuzmi u rad / Čeka delove)
  const handleUpdateStatus = async (issueId: string, newStatus: string) => {
    try {
      const res = await fetch(`${API}/maintenance/issues/${issueId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        showToast(`Status uspešno promenjen na: ${newStatus}`);
        fetchStats();
        fetchIssues(issuesPage, true);
        if (activeTab === 'nalozi') fetchRemontOrders(remontPage, true);
      } else {
        const data = await res.json();
        showToast(data.error || 'Greška pri promeni statusa.', 'error');
      }
    } catch (err) {
      showToast('Greška na serveru.', 'error');
    }
  };

  // Pomoćna funkcija: proverava da li je nalog završen DANAS
  const isFinishedToday = (order: any) => {
    if (order.status !== 'ZAVRSEN') return false;
    const dateVal = order.maintenance?.repairedAt || order.updatedAt || order.orderDate;
    if (!dateVal) return false;
    const d = new Date(dateVal);
    const now = new Date();
    return (
      now.getFullYear() === d.getFullYear() &&
      now.getMonth() === d.getMonth() &&
      now.getDate() === d.getDate()
    );
  };

  // Otvaranje modala za završetak popravke
  const handleOpenResolveModal = (issue: any) => {
    setSelectedIssueToResolve(issue);
    setResolveRepairNotes('');
    setResolvePartsReplaced('');
    setResolveLubricantType(LUBRICANT_OPTIONS[1]);
    setResolveLubricantLiters('');
    setResolvePartsCost('');
    setResolveLaborCost('');
    setIsEditingCompletedReport(false);
  };

  // Otvaranje modala za izmenu postojećeg izveštaja
  const handleOpenEditResolveModal = (order: any) => {
    const issue = order.maintenance || order;
    setSelectedIssueToResolve(issue);
    setResolveRepairNotes(issue.repairNotes || '');
    setResolvePartsReplaced(issue.partsReplaced || '');
    setResolveLubricantType(issue.lubricantType || LUBRICANT_OPTIONS[0]);
    setResolveLubricantLiters(
      issue.lubricantLiters !== null && issue.lubricantLiters !== undefined
        ? String(issue.lubricantLiters)
        : ''
    );
    setResolvePartsCost(
      issue.partsCost !== null && issue.partsCost !== undefined ? String(issue.partsCost) : ''
    );
    setResolveLaborCost(
      issue.laborCost !== null && issue.laborCost !== undefined ? String(issue.laborCost) : ''
    );
    setIsEditingCompletedReport(true);
  };

  // Poništavanje završetka popravke
  const handleReopenRemont = async (order: any) => {
    const issueId = order.maintenance?.id || order.id;
    if (!issueId) return;

    if (
      !window.confirm(
        `Da li ste sigurni da želite da poništite završetak remonta za mašinu "${order.machine?.name}" i vratite nalog u rad? Mašina će se vratiti u status SERVIS.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`${API}/maintenance/issues/${issueId}/reopen`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || 'Nalog je uspešno vraćen u rad!');
        fetchStats();
        fetchIssues(issuesPage, true);
        fetchRemontOrders(remontPage, true);
        fetchHistory(historyPage, true);
      } else {
        showToast(data.error || 'Greška pri vraćanju naloga u rad.', 'error');
      }
    } catch (err) {
      showToast('Greška na serveru.', 'error');
    }
  };

  // Slanje završetka ili izmene popravke
  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIssueToResolve) return;

    if (!resolveRepairNotes.trim()) {
      showToast('Opis popravke je obavezan.', 'error');
      return;
    }

    const reportedMs = selectedIssueToResolve.dateReported
      ? new Date(selectedIssueToResolve.dateReported).getTime()
      : Date.now();
    const autoDowntimeHours = Math.max(0, Math.round(((Date.now() - reportedMs) / (1000 * 60 * 60)) * 10) / 10);

    setSubmittingResolve(true);
    try {
      const method = isEditingCompletedReport ? 'PUT' : 'POST';
      const res = await fetch(`${API}/maintenance/issues/${selectedIssueToResolve.id}/resolve`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          repairNotes: resolveRepairNotes,
          partsReplaced: resolvePartsReplaced || null,
          lubricantType: resolveLubricantType.startsWith('BEZ MAZIVA') ? null : resolveLubricantType,
          lubricantLiters: resolveLubricantLiters ? Number(resolveLubricantLiters) : null,
          partsCost: resolvePartsCost ? Number(resolvePartsCost) : 0,
          laborCost: resolveLaborCost ? Number(resolveLaborCost) : 0,
          downtimeHours: autoDowntimeHours,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        showToast(
          data.message ||
            (isEditingCompletedReport
              ? 'Izveštaj o servisu je uspešno ažuriran!'
              : 'Popravka uspešno evidentirana!')
        );
        setSelectedIssueToResolve(null);
        setIsEditingCompletedReport(false);
        fetchStats();
        fetchIssues(issuesPage, true);
        if (activeTab === 'nalozi') fetchRemontOrders(remontPage, true);
        if (activeTab === 'istorijat') fetchHistory(historyPage, true);
      } else {
        const data = await res.json();
        showToast(data.error || 'Greška pri obradi popravke.', 'error');
      }
    } catch (err) {
      showToast('Greška na serveru.', 'error');
    } finally {
      setSubmittingResolve(false);
    }
  };

  // Slanje novog radnog naloga za remont (Rukovodilac / Direktor)
  const handleCreateRemontOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remontMachineId || !remontWorkerId || !remontInstructions.trim()) {
      showToast('Popunite sva obavezna polja.', 'error');
      return;
    }

    setSubmittingRemont(true);
    try {
      const res = await fetch(`${API}/maintenance/remont-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          machineId: remontMachineId,
          workerId: remontWorkerId,
          orderDate: remontDate,
          priority: remontPriority,
          serviceType: remontServiceType,
          instructions: remontInstructions,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        showToast(data.message || 'Radni nalog za remont uspešno izdat!');
        setIsRemontModalOpen(false);
        setRemontInstructions('');
        fetchStats();
        fetchRemontOrders(1, true);
        fetchIssues(1, true);
      } else {
        const data = await res.json();
        showToast(data.error || 'Greška pri izdavanju radnog naloga.', 'error');
      }
    } catch (err) {
      showToast('Greška na serveru.', 'error');
    } finally {
      setSubmittingRemont(false);
    }
  };

  // Slanje direktne prijave kvara / servisa
  const handleCreateNewIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIssueMachineId || !newIssueTitle.trim()) {
      showToast('Izaberite mašinu i unesite naslov problema.', 'error');
      return;
    }

    setSubmittingNewIssue(true);
    try {
      const res = await fetch(`${API}/maintenance/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          machineId: newIssueMachineId,
          serviceType: newIssueServiceType,
          priority: newIssuePriority,
          title: newIssueTitle,
          description: newIssueDesc || null,
          isMachineStopped: true,
        }),
      });

      if (res.ok) {
        showToast('Kvar/servis je uspešno evidentiran.');
        setIsNewIssueModalOpen(false);
        setNewIssueTitle('');
        setNewIssueDesc('');
        fetchStats();
        fetchIssues(1, true);
      } else {
        const data = await res.json();
        showToast(data.error || 'Greška pri prijavi kvara.', 'error');
      }
    } catch (err) {
      showToast('Greška na serveru.', 'error');
    } finally {
      setSubmittingNewIssue(false);
    }
  };

  // Formatiranje datuma
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleDateString('sr-RS', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ==========================================
  // CustomSelect Opcije
  // ==========================================
  const machineFilterOptions: CustomSelectOption[] = useMemo(() => [
    { value: '', label: 'Sve mašine (kompletna mehanizacija)' },
    ...machines.map((m) => {
      let bType: 'default' | 'danger' | 'warning' | 'success' = 'default';
      if (m.status === 'U_KVARU') bType = 'danger';
      else if (m.status === 'SERVIS') bType = 'warning';
      else if (m.status === 'SLOBODNA') bType = 'success';

      return {
        value: m.id,
        label: m.name,
        subLabel: m.brandModel ? `${m.brandModel} • ${m.type}` : m.type,
        badge: m.status,
        badgeType: bType,
      };
    }),
  ], [machines]);

  const modalMachineOptions: CustomSelectOption[] = useMemo(() => [
    ...machines.map((m) => {
      let bType: 'default' | 'danger' | 'warning' | 'success' = 'default';
      if (m.status === 'U_KVARU') bType = 'danger';
      else if (m.status === 'SERVIS') bType = 'warning';
      else if (m.status === 'SLOBODNA') bType = 'success';

      return {
        value: m.id,
        label: m.name,
        subLabel: `${m.brandModel || m.type} • Trenutno: ${m.status}`,
        badge: m.status,
        badgeType: bType,
      };
    }),
  ], [machines]);

  const workerFilterOptions: CustomSelectOption[] = useMemo(() => [
    { value: '', label: 'Svi radnici i serviseri' },
    ...workers.map((w) => ({
      value: w.id,
      label: w.name,
      subLabel: w.type || w.role || 'Radnik',
    })),
  ], [workers]);

  const modalWorkerOptions: CustomSelectOption[] = useMemo(() => [
    ...workers.map((w) => ({
      value: w.id,
      label: w.name,
      subLabel: w.type || w.role || 'Radnik / Mehaničar',
    })),
  ], [workers]);

  const issueStatusOptions: CustomSelectOption[] = [
    { value: 'AKTIVNI', label: 'Svi aktivni kvarovi', badge: 'AKTIVNO', badgeType: 'warning' },
    { value: 'OTVOREN', label: 'Prijavljeni (Otvoreni)', badge: 'OTVOREN', badgeType: 'danger' },
    { value: 'U_RADU', label: 'U radu (Mehaničar radi)', badge: 'U RADU', badgeType: 'warning' },
    { value: 'CEKA_DELOVE', label: 'Čeka rezervne delove', badge: 'ČEKA DELOVE', badgeType: 'warning' },
    { value: 'POPRAVLJENO', label: 'Popravljeno (Arhiva)', badge: 'POPRAVLJENO', badgeType: 'success' },
    { value: 'SVE', label: 'Svi statusi (uključujući završene)' },
  ];

  const priorityOptions: CustomSelectOption[] = [
    { value: '', label: 'Svi prioriteti' },
    { value: 'KRITICNA', label: 'Kritičan prioritet', badge: 'KRITIČNO', badgeType: 'danger' },
    { value: 'VISOKA', label: 'Visok prioritet', badge: 'VISOK', badgeType: 'warning' },
    { value: 'SREDNJA', label: 'Srednji prioritet', badge: 'SREDNJI', badgeType: 'default' },
    { value: 'NISKA', label: 'Nizak prioritet', badge: 'NIZAK', badgeType: 'default' },
  ];

  const modalPriorityOptions: CustomSelectOption[] = [
    { value: 'KRITICNA', label: 'Kritičan prioritet', badge: 'KRITIČNO', badgeType: 'danger' },
    { value: 'VISOKA', label: 'Visok prioritet', badge: 'VISOK', badgeType: 'warning' },
    { value: 'SREDNJA', label: 'Srednji prioritet', badge: 'SREDNJI', badgeType: 'default' },
    { value: 'NISKA', label: 'Nizak prioritet', badge: 'NIZAK', badgeType: 'default' },
  ];

  const serviceTypeOptions: CustomSelectOption[] = [
    { value: 'REDOVAN_SERVIS', label: 'Redovan servis (zamena ulja/filtera)', badge: 'REDOVAN' },
    { value: 'GENERALNI_REMONT', label: 'Generalni remont mehanizacije', badge: 'REMONT' },
    { value: 'KVAR_NJIVA', label: 'Vanredni kvar sa terena/njive', badge: 'KVAR', badgeType: 'danger' },
  ];

  const lubricantSelectOptions: CustomSelectOption[] = LUBRICANT_OPTIONS.map((opt) => ({
    value: opt,
    label: opt,
    badge: opt.startsWith('BEZ') ? 'BEZ MAZIVA' : 'ULJE / MAST',
    badgeType: opt.startsWith('BEZ') ? 'default' : 'success',
  }));

  // Pomoćna provera aktivnih filtera za Reset dugmad
  const hasActiveIssueFilters =
    issueStatusFilter !== 'AKTIVNI' ||
    Boolean(issuePriorityFilter) ||
    Boolean(issueMachineFilter) ||
    Boolean(issueSearch);

  const hasActiveRemontFilters =
    Boolean(remontMachineFilter) ||
    Boolean(remontWorkerFilter) ||
    Boolean(remontSearch);

  const hasActiveHistoryFilters =
    Boolean(historyMachineFilter) ||
    Boolean(historyDateFrom) ||
    Boolean(historyDateTo) ||
    Boolean(historySearch);

  return (
    <AppLayout pageTitle="Radionica & Održavanje Mašina">
      <div className={styles.container}>
        {/* Header Bar */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <span className={styles.titleIcon}>
                <Wrench size={26} />
              </span>
              Servisna Radionica & Kvarovi
            </h2>
            <p className={styles.subtitle}>
              Evidencija kvarova, servisni nalozi za remont i digitalna servisna knjižica mehanizacije.
            </p>
          </div>

          <div className={styles.headerActions}>
            <button
              onClick={() => {
                fetchStats();
                if (activeTab === 'kvarovi') fetchIssues(issuesPage, true);
                if (activeTab === 'nalozi') fetchRemontOrders(remontPage, true);
                if (activeTab === 'istorijat') fetchHistory(historyPage, true);
              }}
              className={styles.btnSecondary}
              title="Osveži podatke u radionici"
            >
              <RefreshCw size={17} />
              <span>Osveži</span>
            </button>

            <button
              onClick={() => setIsNewIssueModalOpen(true)}
              className={styles.btnSecondary}
              title="Direktna prijava kvara ili servisa"
            >
              <AlertTriangle size={18} style={{ color: '#ea580c' }} />
              <span>Prijavi kvar</span>
            </button>

            {isManagerOrDirector && (
              <button
                onClick={() => setIsRemontModalOpen(true)}
                className={styles.btnPrimary}
                title="Izdavanje novog radnog naloga za remont"
              >
                <Plus size={18} />
                <span>Novi nalog za remont</span>
              </button>
            )}
          </div>
        </div>

        {/* Dashboard Stats Grid (KPI Cards) */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconBroken}`}>
              <AlertTriangle size={24} />
            </div>
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{stats.brokenIssues}</span>
              <span className={styles.statLabel}>U Kvaru (Čeka Prijem)</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconInRepair}`}>
              <Wrench size={24} />
            </div>
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{stats.inRepairIssues}</span>
              <span className={styles.statLabel}>U Radu (Popravka)</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconWaitingParts}`}>
              <Clock size={24} />
            </div>
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{stats.waitingPartsIssues}</span>
              <span className={styles.statLabel}>Čeka Delove</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconFree}`}>
              <CheckCircle2 size={24} />
            </div>
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{stats.freeMachines}</span>
              <span className={styles.statLabel}>Slobodne Mašine</span>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconRemont}`}>
              <ClipboardList size={24} />
            </div>
            <div className={styles.statInfo}>
              <span className={styles.statValue}>{stats.remontOrders}</span>
              <span className={styles.statLabel}>Nalozi za Remont</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className={styles.tabsContainer}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'kvarovi' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('kvarovi')}
          >
            <AlertTriangle size={18} />
            <span>Kvarovi sa terena</span>
            <span className={`${styles.tabCount} ${styles.countRed}`}>
              {stats.totalActiveIssues}
            </span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'nalozi' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('nalozi')}
          >
            <ClipboardList size={18} />
            <span>Nalozi za remont</span>
            <span className={`${styles.tabCount} ${styles.countBlue}`}>
              {stats.remontOrders}
            </span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'istorijat' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('istorijat')}
          >
            <History size={18} />
            <span>Servisna knjižica & Istorijat</span>
            <span className={`${styles.tabCount} ${styles.countGray}`}>
              {stats.repairedIssues}
            </span>
          </button>
        </div>

        {/* ============================================================ */}
        {/* TAB 1: KVAROVI SA TERENA                                     */}
        {/* ============================================================ */}
        {activeTab === 'kvarovi' && (
          <>
            {/* Filter Bar sa CustomSelect */}
            <div className={styles.filterBar}>
              <div className={styles.searchInputWrapper}>
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Pretraži kvarove, mašine, opis..."
                  value={issueSearch}
                  onChange={(e) => setIssueSearch(e.target.value)}
                />
                {issueSearch && (
                  <button
                    type="button"
                    className={styles.searchClearBtn}
                    onClick={() => setIssueSearch('')}
                    title="Obriši pretragu"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className={styles.filterSelectWrapper}>
                <CustomSelect
                  value={issueStatusFilter}
                  onChange={(val) => setIssueStatusFilter(val)}
                  options={issueStatusOptions}
                  placeholder="Izaberite status..."
                />
              </div>

              <div className={styles.filterSelectWrapper}>
                <CustomSelect
                  value={issuePriorityFilter}
                  onChange={(val) => setIssuePriorityFilter(val)}
                  options={priorityOptions}
                  placeholder="Svi prioriteti"
                />
              </div>

              <div className={styles.filterSelectWrapper}>
                <CustomSelect
                  value={issueMachineFilter}
                  onChange={(val) => setIssueMachineFilter(val)}
                  options={machineFilterOptions}
                  placeholder="Sve mašine"
                  searchable
                />
              </div>

              {hasActiveIssueFilters && (
                <button
                  type="button"
                  className={styles.filterResetBtn}
                  onClick={() => {
                    setIssueStatusFilter('AKTIVNI');
                    setIssuePriorityFilter('');
                    setIssueMachineFilter('');
                    setIssueSearch('');
                  }}
                  title="Poništi sve filtere"
                >
                  <RotateCcw size={14} />
                  <span>Poništi</span>
                </button>
              )}
            </div>

            {/* Lista Kvarova */}
            {loadingIssues ? (
              <div className={styles.emptyState}>
                <RefreshCw size={26} className="animate-spin" style={{ color: '#0284c7' }} />
                <p>Učitavanje prijavljenih kvarova (stranica {issuesPage})...</p>
              </div>
            ) : issues.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>
                  <CheckCircle2 size={32} />
                </div>
                <h4>Nema prijavljenih kvarova za izabrane filtere</h4>
                <p>Sva mehanizacija je u ispravnom stanju i spremna za rad na terenu.</p>
              </div>
            ) : (
              <div className={styles.cardsGrid}>
                {issues.map((issue) => {
                  const isCritical = issue.priority === 'KRITICNA';
                  const isHigh = issue.priority === 'VISOKA';
                  const isMedium = issue.priority === 'SREDNJA';

                  return (
                    <div
                      key={issue.id}
                      className={`${styles.issueCard} ${
                        isCritical
                          ? styles.cardBorderCritical
                          : isHigh
                          ? styles.cardBorderHigh
                          : isMedium
                          ? styles.cardBorderMedium
                          : styles.cardBorderLow
                      }`}
                    >
                      <div className={styles.cardHeader}>
                        <div className={styles.machineInfo}>
                          <div className={styles.machineIcon}>
                            <Tractor size={22} />
                          </div>
                          <div>
                            <div className={styles.machineName}>{issue.machine?.name}</div>
                            <div className={styles.machineMeta}>
                              <span className={styles.machineMetaTag}>
                                {issue.machine?.brandModel || issue.machine?.type}
                              </span>
                              {issue.machine?.regNumber && (
                                <span>• Reg: {issue.machine.regNumber}</span>
                              )}
                              <span>• {issue.machine?.currentHours || 0} radnih sati</span>
                            </div>
                          </div>
                        </div>

                        <div className={styles.badgesGroup}>
                          {/* Priority Badge */}
                          <span
                            className={`${styles.badge} ${
                              isCritical
                                ? styles.badgePriorityCritical
                                : isHigh
                                ? styles.badgePriorityHigh
                                : isMedium
                                ? styles.badgePriorityMedium
                                : styles.badgePriorityLow
                            }`}
                          >
                            {issue.priority}
                          </span>

                          {/* Status Badge */}
                          <span
                            className={`${styles.badge} ${
                              issue.status === 'OTVOREN'
                                ? styles.badgeStatusOtvoren
                                : issue.status === 'U_RADU'
                                ? styles.badgeStatusURadu
                                : issue.status === 'CEKA_DELOVE'
                                ? styles.badgeStatusCekaDelove
                                : styles.badgeStatusPopravljeno
                            }`}
                          >
                            {issue.status === 'OTVOREN' && '🔴 Otvoren'}
                            {issue.status === 'U_RADU' && '🟡 U radu'}
                            {issue.status === 'CEKA_DELOVE' && '🟠 Čeka delove'}
                            {issue.status === 'POPRAVLJENO' && '🟢 Popravljeno'}
                          </span>
                        </div>
                      </div>

                      <div className={styles.cardBody}>
                        <div className={styles.issueTitle}>{issue.title}</div>
                        {issue.description && (
                          <div className={styles.issueDesc}>{issue.description}</div>
                        )}

                        <div className={styles.reporterDetails}>
                          <div className={styles.reporterItem}>
                            <User size={14} />
                            <span>Prijavio: {issue.reportedBy?.name || 'Radnik na razduživanju'}</span>
                          </div>
                          <div className={styles.reporterItem}>
                            <Calendar size={14} />
                            <span>Datum prijave: {formatDate(issue.dateReported)}</span>
                          </div>
                          {issue.parcel && (
                            <div className={styles.reporterItem}>
                              <MapPin size={14} />
                              <span>Parcela: [{issue.parcel.code}] {issue.parcel.name}</span>
                            </div>
                          )}
                          {issue.workOrder && (
                            <div className={styles.reporterItem}>
                              <ClipboardList size={14} />
                              <span>Nalog: {issue.workOrder.orderNumber}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer sa Akcijama */}
                      <div className={styles.cardFooter}>
                        <div>
                          {issue.mechanic && (
                            <div className={styles.mechanicWorking}>
                              <Wrench size={14} />
                              <span>Dodeljeni mehaničar: {issue.mechanic.name}</span>
                            </div>
                          )}
                        </div>

                        <div className={styles.actionButtons}>
                          {issue.status === 'OTVOREN' && (
                            <>
                              <button
                                className={styles.btnActionTake}
                                onClick={() => handleUpdateStatus(issue.id, 'U_RADU')}
                              >
                                <Wrench size={14} />
                                <span>Započni popravku</span>
                              </button>
                              <button
                                className={styles.btnActionWait}
                                onClick={() => handleUpdateStatus(issue.id, 'CEKA_DELOVE')}
                              >
                                <Clock size={14} />
                                <span>Stavi na čekanje</span>
                              </button>
                            </>
                          )}

                          {issue.status === 'U_RADU' && (
                            <>
                              <button
                                className={styles.btnActionWait}
                                onClick={() => handleUpdateStatus(issue.id, 'CEKA_DELOVE')}
                              >
                                <Clock size={14} />
                                <span>Stavi na čekanje</span>
                              </button>
                              <button
                                className={styles.btnActionResolve}
                                onClick={() => handleOpenResolveModal(issue)}
                              >
                                <CheckCircle2 size={14} />
                                <span>Završi popravku i oslobodi mašinu</span>
                              </button>
                            </>
                          )}

                          {issue.status === 'CEKA_DELOVE' && (
                            <>
                              <button
                                className={styles.btnActionTake}
                                onClick={() => handleUpdateStatus(issue.id, 'U_RADU')}
                              >
                                <Wrench size={14} />
                                <span>Nastavi rad</span>
                              </button>
                              <button
                                className={styles.btnActionResolve}
                                onClick={() => handleOpenResolveModal(issue)}
                              >
                                <CheckCircle2 size={14} />
                                <span>Završi popravku i oslobodi mašinu</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Paginacija za Tab 1 (25 po strani) */}
            {issuesTotal > 0 && (
              <div className={styles.paginationWrapper}>
                <TablePagination
                  currentPage={issuesPage}
                  totalPages={issuesTotalPages}
                  totalItems={issuesTotal}
                  pageSize={PAGE_SIZE}
                  onPageChange={handleIssuesPageChange}
                  itemName="kvarova"
                />
              </div>
            )}
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 2: NALOZI ZA REMONT                                      */}
        {/* ============================================================ */}
        {activeTab === 'nalozi' && (
          <>
            {/* Filter Bar sa CustomSelect */}
            <div className={styles.filterBar}>
              <div className={styles.searchInputWrapper}>
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Pretraži naloge, instrukcije, broj..."
                  value={remontSearch}
                  onChange={(e) => setRemontSearch(e.target.value)}
                />
                {remontSearch && (
                  <button
                    type="button"
                    className={styles.searchClearBtn}
                    onClick={() => setRemontSearch('')}
                    title="Obriši pretragu"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className={styles.filterSelectWrapper}>
                <CustomSelect
                  value={remontMachineFilter}
                  onChange={(val) => setRemontMachineFilter(val)}
                  options={machineFilterOptions}
                  placeholder="Sve mašine"
                  searchable
                />
              </div>

              <div className={styles.filterSelectWrapper}>
                <CustomSelect
                  value={remontWorkerFilter}
                  onChange={(val) => setRemontWorkerFilter(val)}
                  options={workerFilterOptions}
                  placeholder="Svi serviseri"
                  searchable
                />
              </div>

              {hasActiveRemontFilters && (
                <button
                  type="button"
                  className={styles.filterResetBtn}
                  onClick={() => {
                    setRemontMachineFilter('');
                    setRemontWorkerFilter('');
                    setRemontSearch('');
                  }}
                  title="Poništi filtere"
                >
                  <RotateCcw size={14} />
                  <span>Poništi</span>
                </button>
              )}
            </div>

            {loadingRemontOrders ? (
              <div className={styles.emptyState}>
                <RefreshCw size={26} className="animate-spin" style={{ color: '#0284c7' }} />
                <p>Učitavanje servisnih radnih naloga (stranica {remontPage})...</p>
              </div>
            ) : remontOrders.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>
                  <ClipboardList size={32} />
                </div>
                <h4>Nema otvorenih naloga za remont</h4>
                <p>
                  Trenutno nema aktivnih naloga niti naloga završenih danas. Prethodni završeni servisi nalaze se u
                  Tabu 3: Servisna knjižica.
                </p>
              </div>
            ) : (
              <div className={styles.cardsGrid}>
                {remontOrders.map((order) => {
                  const isDone = order.status === 'ZAVRSEN';
                  const isTodayDone = isFinishedToday(order);

                  return (
                    <div
                      key={order.id}
                      className={`${styles.issueCard} ${
                        isDone ? '' : styles.cardBorderHigh
                      }`}
                    >
                      <div className={styles.cardHeader}>
                        <div className={styles.machineInfo}>
                          <div className={styles.machineIcon}>
                            <Wrench size={22} />
                          </div>
                          <div>
                            <div className={styles.machineName}>
                              {order.orderNumber} — {order.machine?.name}
                            </div>
                            <div className={styles.machineMeta}>
                              <span>
                                Dodeljeno: <strong>{order.worker?.name || 'Nije dodeljeno'}</strong>
                              </span>
                              <span>• Datum: {formatDate(order.orderDate)}</span>
                              <span>• Prioritet: {order.priority}</span>
                            </div>
                          </div>
                        </div>

                        <div className={styles.badgesGroup}>
                          <span
                            className={`${styles.badge} ${
                              isDone
                                ? styles.badgeStatusPopravljeno
                                : order.maintenance?.status === 'CEKA_DELOVE'
                                ? styles.badgeStatusCekaDelove
                                : order.status === 'U_TOKU' || order.maintenance?.status === 'U_RADU'
                                ? styles.badgeStatusURadu
                                : styles.badgeStatusOtvoren
                            }`}
                          >
                            {isDone
                              ? isTodayDone
                                ? 'ZAVRŠEN DANAS (DO 23:59h)'
                                : 'ZAVRŠEN'
                              : order.maintenance?.status === 'CEKA_DELOVE'
                              ? 'ČEKA DELOVE'
                              : order.status === 'U_TOKU' || order.maintenance?.status === 'U_RADU'
                              ? 'U RADU'
                              : order.status}
                          </span>
                        </div>
                      </div>

                      <div className={styles.cardBody}>
                        <div className={styles.issueTitle}>Instrukcije rukovodioca:</div>
                        <div className={styles.issueDesc}>
                          {order.instructions || 'Redovan periodični servis i kontrola ispravnosti.'}
                        </div>

                        <div className={styles.reporterDetails}>
                          <div className={styles.reporterItem}>
                            <User size={14} />
                            <span>Izdao nalog: {order.issuedBy?.name || 'Rukovodilac'}</span>
                          </div>
                          {order.maintenance && (
                            <div className={styles.reporterItem}>
                              <AlertCircle size={14} />
                              <span>
                                Status servisa:{' '}
                                {order.maintenance.status === 'CEKA_DELOVE'
                                  ? 'Čeka rezervne delove'
                                  : order.maintenance.status === 'U_RADU'
                                  ? 'U radu na servisu'
                                  : order.maintenance.status === 'POPRAVLJENO'
                                  ? 'Završen servis'
                                  : 'Dodeljen nalog'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={styles.cardFooter}>
                        <div className={styles.mechanicWorking}>
                          <User size={14} />
                          <span>Mehaničar: {order.worker?.name || '-'}</span>
                        </div>

                        <div className={styles.actionButtons}>
                          {!isDone && (
                            <>
                              {(!order.maintenance || order.maintenance.status === 'OTVOREN') && (
                                <>
                                  <button
                                    className={styles.btnActionTake}
                                    onClick={() =>
                                      order.maintenance &&
                                      handleUpdateStatus(order.maintenance.id, 'U_RADU')
                                    }
                                  >
                                    <Wrench size={14} />
                                    <span>Započni remont</span>
                                  </button>
                                  <button
                                    className={styles.btnActionWait}
                                    onClick={() =>
                                      order.maintenance &&
                                      handleUpdateStatus(order.maintenance.id, 'CEKA_DELOVE')
                                    }
                                  >
                                    <Clock size={14} />
                                    <span>Stavi na čekanje</span>
                                  </button>
                                  <button
                                    className={styles.btnActionResolve}
                                    onClick={() => handleOpenResolveModal(order.maintenance || order)}
                                  >
                                    <CheckCircle2 size={14} />
                                    <span>Završi remont i oslobodi mašinu</span>
                                  </button>
                                </>
                              )}

                              {order.maintenance?.status === 'U_RADU' && (
                                <>
                                  <button
                                    className={styles.btnActionWait}
                                    onClick={() =>
                                      handleUpdateStatus(order.maintenance.id, 'CEKA_DELOVE')
                                    }
                                  >
                                    <Clock size={14} />
                                    <span>Stavi na čekanje</span>
                                  </button>
                                  <button
                                    className={styles.btnActionResolve}
                                    onClick={() => handleOpenResolveModal(order.maintenance)}
                                  >
                                    <CheckCircle2 size={14} />
                                    <span>Završi remont i oslobodi mašinu</span>
                                  </button>
                                </>
                              )}

                              {order.maintenance?.status === 'CEKA_DELOVE' && (
                                <>
                                  <button
                                    className={styles.btnActionTake}
                                    onClick={() =>
                                      handleUpdateStatus(order.maintenance.id, 'U_RADU')
                                    }
                                  >
                                    <Wrench size={14} />
                                    <span>Nastavi rad</span>
                                  </button>
                                  <button
                                    className={styles.btnActionResolve}
                                    onClick={() => handleOpenResolveModal(order.maintenance)}
                                  >
                                    <CheckCircle2 size={14} />
                                    <span>Završi remont i oslobodi mašinu</span>
                                  </button>
                                </>
                              )}
                            </>
                          )}

                          {isDone && isTodayDone && (
                            <>
                              <button
                                type="button"
                                className={styles.btnActionWait}
                                onClick={() => handleReopenRemont(order)}
                                title="Poništi završetak i vrati mašinu u status SERVIS"
                              >
                                <RotateCcw size={14} />
                                <span>Vrati u rad (Poništi)</span>
                              </button>
                              <button
                                type="button"
                                className={styles.btnActionTake}
                                onClick={() => handleOpenEditResolveModal(order)}
                                title="Izmeni izveštaj o popravci, utrošeno ulje ili troškove delova"
                              >
                                <Pencil size={14} />
                                <span>Izmeni izveštaj</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Paginacija za Tab 2 (25 po strani) */}
            {remontTotal > 0 && (
              <div className={styles.paginationWrapper}>
                <TablePagination
                  currentPage={remontPage}
                  totalPages={remontTotalPages}
                  totalItems={remontTotal}
                  pageSize={PAGE_SIZE}
                  onPageChange={handleRemontPageChange}
                  itemName="naloga za remont"
                />
              </div>
            )}
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 3: SERVISNA KNJIŽICA & ISTORIJAT                         */}
        {/* ============================================================ */}
        {activeTab === 'istorijat' && (
          <>
            <div className={styles.filterBar}>
              <div className={styles.searchInputWrapper}>
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Pretraži istorijat radova, delove, ulje..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                />
                {historySearch && (
                  <button
                    type="button"
                    className={styles.searchClearBtn}
                    onClick={() => setHistorySearch('')}
                    title="Obriši pretragu"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className={styles.filterSelectWrapper}>
                <CustomSelect
                  value={historyMachineFilter}
                  onChange={(val) => setHistoryMachineFilter(val)}
                  options={machineFilterOptions}
                  placeholder="Sva mehanizacija"
                  searchable
                />
              </div>

              <div className={styles.filterDateGroup}>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={historyDateFrom}
                  onChange={(e) => setHistoryDateFrom(e.target.value)}
                  title="Od datuma"
                />
                <span className={styles.dateSeparator}>do</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={historyDateTo}
                  onChange={(e) => setHistoryDateTo(e.target.value)}
                  title="Do datuma"
                />
              </div>

              {hasActiveHistoryFilters && (
                <button
                  type="button"
                  className={styles.filterResetBtn}
                  onClick={() => {
                    setHistoryMachineFilter('');
                    setHistoryDateFrom('');
                    setHistoryDateTo('');
                    setHistorySearch('');
                  }}
                  title="Poništi filtere"
                >
                  <RotateCcw size={14} />
                  <span>Poništi</span>
                </button>
              )}
            </div>

            {loadingHistory ? (
              <div className={styles.emptyState}>
                <RefreshCw size={26} className="animate-spin" style={{ color: '#0284c7' }} />
                <p>Učitavanje servisne knjižice (stranica {historyPage})...</p>
              </div>
            ) : historyItems.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>
                  <History size={32} />
                </div>
                <h4>Nema zabeleženih popravki u servisnoj knjižici</h4>
                <p>Istorijat se automatski puni svakim završetkom servisa ili popravke kvara.</p>
              </div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className={styles.historyTableContainer}>
                  <table className={styles.historyTable}>
                    <thead>
                      <tr>
                        <th>Datum Popravke</th>
                        <th>Mašina</th>
                        <th>Mehaničar</th>
                        <th>Opis Radova</th>
                        <th>Zamenjeni Delovi</th>
                        <th>Mazivo & Količina</th>
                        <th>Trošak (RSD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyItems.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div className={styles.historyDateCell}>
                              <strong>{formatDate(item.repairedAt || item.updatedAt)}</strong>
                              <span className={styles.historyDowntime}>
                                Zastoj: {item.downtimeHours || 0} h
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className={styles.historyMachineCell}>
                              <strong>{item.machine?.name}</strong>
                              <span>{item.machine?.brandModel || item.machine?.type}</span>
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {item.mechanic?.name || item.reportedBy?.name || '-'}
                            </div>
                          </td>
                          <td>
                            <div className={styles.historyWorkCell}>
                              <strong>{item.title}</strong>
                              {item.repairNotes && (
                                <div className={styles.historyWorkNotes}>
                                  {item.repairNotes}
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontSize: '0.86rem' }}>
                              {item.partsReplaced || 'Bez novih delova'}
                            </div>
                          </td>
                          <td>
                            {item.lubricantType ? (
                              <div className={styles.historyLubricantTag}>
                                <span>{item.lubricantType}</span>
                                {item.lubricantLiters && (
                                  <strong>• {item.lubricantLiters} L</strong>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>-</span>
                            )}
                          </td>
                          <td>
                            <div className={styles.historyCostCell}>
                              {item.totalCost && item.totalCost > 0 ? (
                                <>
                                  <strong>{item.totalCost.toLocaleString('sr-RS')} RSD</strong>
                                  <div className={styles.historyCostParts}>
                                    Delovi: {(item.partsCost || 0).toLocaleString('sr-RS')} RSD
                                  </div>
                                </>
                              ) : (
                                <span style={{ color: 'var(--text-muted)' }}>0 RSD</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Cards List (< 768px) */}
                <div className={styles.historyMobileList}>
                  {historyItems.map((item) => (
                    <div key={item.id} className={styles.historyCard}>
                      <div className={styles.historyCardHeader}>
                        <div className={styles.machineInfo}>
                          <div className={styles.machineIcon}>
                            <Tractor size={20} />
                          </div>
                          <div>
                            <div className={styles.machineName}>{item.machine?.name}</div>
                            <div className={styles.machineMeta}>
                              <span>{item.machine?.brandModel || item.machine?.type}</span>
                            </div>
                          </div>
                        </div>
                        <div className={styles.historyDateBadge}>
                          <Calendar size={13} />
                          <span>{formatDate(item.repairedAt || item.updatedAt)}</span>
                        </div>
                      </div>

                      <div className={styles.historyCardBody}>
                        <div className={styles.historyTitle}>{item.title}</div>
                        {item.repairNotes && (
                          <div className={styles.historyNotes}>{item.repairNotes}</div>
                        )}

                        <div className={styles.historyDetailsGrid}>
                          <div className={styles.historyDetailItem}>
                            <span className={styles.historyDetailLabel}>Mehaničar:</span>
                            <span className={styles.historyDetailVal}>
                              <User size={13} />
                              {item.mechanic?.name || item.reportedBy?.name || '-'}
                            </span>
                          </div>

                          {item.downtimeHours ? (
                            <div className={styles.historyDetailItem}>
                              <span className={styles.historyDetailLabel}>Zastoj mašine:</span>
                              <span className={styles.historyDetailVal}>
                                <Clock size={13} />
                                {item.downtimeHours} h
                              </span>
                            </div>
                          ) : null}

                          <div className={styles.historyDetailItem}>
                            <span className={styles.historyDetailLabel}>Zamenjeni delovi:</span>
                            <span className={styles.historyDetailVal}>
                              {item.partsReplaced || 'Bez novih delova'}
                            </span>
                          </div>

                          {item.lubricantType && (
                            <div className={styles.historyDetailItem}>
                              <span className={styles.historyDetailLabel}>Utrošeno mazivo:</span>
                              <span className={styles.historyDetailVal}>
                                {item.lubricantType}
                                {item.lubricantLiters && (
                                  <strong style={{ color: '#059669', marginLeft: '0.35rem' }}>
                                    ({item.lubricantLiters} L)
                                  </strong>
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={styles.historyCardFooter}>
                        <span className={styles.historyCostLabel}>Ukupan trošak:</span>
                        <div className={styles.historyCostAmount}>
                          <strong>
                            {item.totalCost && item.totalCost > 0
                              ? `${item.totalCost.toLocaleString('sr-RS')} RSD`
                              : '0 RSD'}
                          </strong>
                          {item.partsCost && item.partsCost > 0 ? (
                            <span className={styles.historyPartsSub}>
                              (delovi: {item.partsCost.toLocaleString('sr-RS')} RSD)
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Paginacija za Tab 3 (25 po strani) */}
            {historyTotal > 0 && (
              <div className={styles.paginationWrapper}>
                <TablePagination
                  currentPage={historyPage}
                  totalPages={historyTotalPages}
                  totalItems={historyTotal}
                  pageSize={PAGE_SIZE}
                  onPageChange={handleHistoryPageChange}
                  itemName="servisa u knjižici"
                />
              </div>
            )}
          </>
        )}

        {/* ============================================================ */}
        {/* MODAL: ZAVRŠETAK POPRAVKE & OSLOBAĐANJE MAŠINE               */}
        {/* ============================================================ */}
        {selectedIssueToResolve && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalCard}>
              <div className={styles.modalHeader}>
                <h3>
                  {isEditingCompletedReport ? (
                    <>
                      <Pencil size={22} style={{ color: '#0284c7' }} />
                      <span>Izmeni izveštaj o popravci</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={22} style={{ color: '#10b981' }} />
                      <span>Evidentiraj popravku i oslobodi mašinu</span>
                    </>
                  )}
                </h3>
                <button
                  className={styles.modalCloseBtn}
                  onClick={() => setSelectedIssueToResolve(null)}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleResolveSubmit}>
                <div className={styles.modalBody}>
                  <div className={styles.resolveSummaryBox}>
                    <div className={styles.resolveSummaryMachine}>
                      🚜 {selectedIssueToResolve.machine?.name}
                    </div>
                    <div className={styles.resolveSummaryIssue}>
                      Kvar / Radni nalog: {selectedIssueToResolve.title}
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Opis izvedene popravke / servisa *</label>
                    <textarea
                      rows={3}
                      placeholder="Npr. Zamenjeno crevo hidraulike, zategnut pogonski kaiš..."
                      value={resolveRepairNotes}
                      onChange={(e) => setResolveRepairNotes(e.target.value)}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Zamenjeni rezervni delovi</label>
                    <input
                      type="text"
                      placeholder="Npr. Crevo hidraulike 1/2 cola, 2x šelne, ležaj 6205..."
                      value={resolvePartsReplaced}
                      onChange={(e) => setResolvePartsReplaced(e.target.value)}
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>Utrošeno ulje / mazivo</label>
                      <CustomSelect
                        value={resolveLubricantType}
                        onChange={(val) => setResolveLubricantType(val)}
                        options={lubricantSelectOptions}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Količina maziva (L)</label>
                      <input
                        type="number"
                        step="0.5"
                        placeholder="Npr. 15"
                        value={resolveLubricantLiters}
                        onChange={(e) => setResolveLubricantLiters(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>Cena zamenjenih delova (RSD)</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={resolvePartsCost}
                        onChange={(e) => setResolvePartsCost(e.target.value)}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Cena spoljne usluge / rada (RSD)</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={resolveLaborCost}
                        onChange={(e) => setResolveLaborCost(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnModalCancel}
                    onClick={() => setSelectedIssueToResolve(null)}
                  >
                    Odustani
                  </button>

                  <button
                    type="submit"
                    className={styles.btnModalSubmit}
                    disabled={submittingResolve}
                  >
                    <CheckCircle2 size={18} />
                    <span>
                      {submittingResolve
                        ? 'Snimanje...'
                        : isEditingCompletedReport
                        ? 'Sačuvaj izmene izveštaja'
                        : 'Završi popravku i oslobodi mašinu'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL: NOVI NALOG ZA REMONT (Rukovodilac & Direktor)         */}
        {/* ============================================================ */}
        {isRemontModalOpen && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalCard}>
              <div className={styles.modalHeader}>
                <h3>
                  <Plus size={22} style={{ color: '#0284c7' }} />
                  Izdavanje radnog naloga za remont
                </h3>
                <button
                  className={styles.modalCloseBtn}
                  onClick={() => setIsRemontModalOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleCreateRemontOrder}>
                <div className={styles.modalBody}>
                  <div className={styles.formGroup}>
                    <label>Mašina ili priključak za remont *</label>
                    <CustomSelect
                      value={remontMachineId}
                      onChange={(val) => setRemontMachineId(val)}
                      options={modalMachineOptions}
                      placeholder="Izaberite mašinu za remont..."
                      searchable
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Dodeljeni mehaničar / serviser *</label>
                    <CustomSelect
                      value={remontWorkerId}
                      onChange={(val) => setRemontWorkerId(val)}
                      options={modalWorkerOptions}
                      placeholder="Izaberite mehaničara..."
                      searchable
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>Tip servisa *</label>
                      <CustomSelect
                        value={remontServiceType}
                        onChange={(val) => setRemontServiceType(val)}
                        options={serviceTypeOptions}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Prioritet *</label>
                      <CustomSelect
                        value={remontPriority}
                        onChange={(val) => setRemontPriority(val)}
                        options={modalPriorityOptions}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Datum planiranog početka *</label>
                    <input
                      type="date"
                      value={remontDate}
                      onChange={(e) => setRemontDate(e.target.value)}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Uputstvo i specifikacija posla za mehaničara *</label>
                    <textarea
                      rows={3}
                      placeholder="Npr. Generalni remont ulagača semena, zamena ulja u menjaču i provera zaptivača..."
                      value={remontInstructions}
                      onChange={(e) => setRemontInstructions(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnModalCancel}
                    onClick={() => setIsRemontModalOpen(false)}
                  >
                    Odustani
                  </button>

                  <button
                    type="submit"
                    className={styles.btnModalSubmit}
                    disabled={submittingRemont}
                  >
                    <ClipboardList size={18} />
                    <span>{submittingRemont ? 'Izdavanje...' : 'Izdaj radni nalog'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL: DIREKTNA PRIJAVA KVARA                                */}
        {/* ============================================================ */}
        {isNewIssueModalOpen && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalCard}>
              <div className={styles.modalHeader}>
                <h3>
                  <AlertTriangle size={22} style={{ color: '#dc2626' }} />
                  Prijava kvara ili slanje u radionicu
                </h3>
                <button
                  className={styles.modalCloseBtn}
                  onClick={() => setIsNewIssueModalOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleCreateNewIssue}>
                <div className={styles.modalBody}>
                  <div className={styles.formGroup}>
                    <label>Mašina *</label>
                    <CustomSelect
                      value={newIssueMachineId}
                      onChange={(val) => setNewIssueMachineId(val)}
                      options={modalMachineOptions}
                      placeholder="Izaberite mašinu sa problemom..."
                      searchable
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>Tip servisa *</label>
                      <CustomSelect
                        value={newIssueServiceType}
                        onChange={(val) => setNewIssueServiceType(val)}
                        options={serviceTypeOptions}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Prioritet *</label>
                      <CustomSelect
                        value={newIssuePriority}
                        onChange={(val) => setNewIssuePriority(val)}
                        options={modalPriorityOptions}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Kratak naslov kvara *</label>
                    <input
                      type="text"
                      placeholder="Npr. Curi hidraulika na levom točku"
                      value={newIssueTitle}
                      onChange={(e) => setNewIssueTitle(e.target.value)}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Detaljan opis problema</label>
                    <textarea
                      rows={3}
                      placeholder="Opišite simptome, oštećenje ili zapažanja..."
                      value={newIssueDesc}
                      onChange={(e) => setNewIssueDesc(e.target.value)}
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnModalCancel}
                    onClick={() => setIsNewIssueModalOpen(false)}
                  >
                    Odustani
                  </button>

                  <button
                    type="submit"
                    className={styles.btnModalSubmit}
                    disabled={submittingNewIssue}
                  >
                    <AlertTriangle size={18} />
                    <span>{submittingNewIssue ? 'Prijavljivanje...' : 'Evidentiraj kvar'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Floating Toast Notifikacija */}
        {toast && (
          <div
            className={`${styles.toast} ${
              toast.type === 'error' ? styles.toastError : styles.toastSuccess
            }`}
          >
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default RadionicaKvarovi;
