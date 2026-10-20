import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { useSession } from '../lib/auth-client';
import styles from './RadionicaKvarovi.module.css';

const API = 'http://localhost:5000/api';

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

  // Tab 1: Kvarovi
  const [issues, setIssues] = useState<any[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [issueStatusFilter, setIssueStatusFilter] = useState('AKTIVNI');
  const [issuePriorityFilter, setIssuePriorityFilter] = useState('');
  const [issueMachineFilter, setIssueMachineFilter] = useState('');
  const [issueSearch, setIssueSearch] = useState('');

  // Tab 2: Remont Orders
  const [remontOrders, setRemontOrders] = useState<any[]>([]);
  const [loadingRemontOrders, setLoadingRemontOrders] = useState(false);

  // Tab 3: History
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyMachineFilter, setHistoryMachineFilter] = useState('');

  // Resolve Modal State
  const [selectedIssueToResolve, setSelectedIssueToResolve] = useState<any | null>(null);
  const [resolveRepairNotes, setResolveRepairNotes] = useState('');
  const [resolvePartsReplaced, setResolvePartsReplaced] = useState('');
  const [resolveLubricantType, setResolveLubricantType] = useState(LUBRICANT_OPTIONS[1]);
  const [resolveLubricantLiters, setResolveLubricantLiters] = useState<string | number>('');
  const [resolvePartsCost, setResolvePartsCost] = useState<string | number>('');
  const [resolveLaborCost, setResolveLaborCost] = useState<string | number>('');
  const [submittingResolve, setSubmittingResolve] = useState(false);

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

  // Učitaj kvarove (Tab 1)
  const fetchIssues = async (isSilent = false) => {
    if (!isSilent && issues.length === 0) setLoadingIssues(true);
    try {
      const params = new URLSearchParams();
      if (issueStatusFilter) params.append('status', issueStatusFilter);
      if (issuePriorityFilter) params.append('priority', issuePriorityFilter);
      if (issueMachineFilter) params.append('machineId', issueMachineFilter);
      if (issueSearch) params.append('search', issueSearch);

      const res = await fetch(`${API}/maintenance/issues?${params.toString()}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setIssues(data.issues || []);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju kvarova:', err);
    } finally {
      setLoadingIssues(false);
    }
  };

  // Učitaj naloge za remont (Tab 2)
  const fetchRemontOrders = async (isSilent = false) => {
    if (!isSilent && remontOrders.length === 0) setLoadingRemontOrders(true);
    try {
      const res = await fetch(`${API}/maintenance/remont-orders`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setRemontOrders(data.orders || []);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju naloga za remont:', err);
    } finally {
      setLoadingRemontOrders(false);
    }
  };

  // Učitaj istorijat popravki (Tab 3)
  const fetchHistory = async (isSilent = false) => {
    if (!isSilent && historyItems.length === 0) setLoadingHistory(true);
    try {
      const params = new URLSearchParams();
      if (historyMachineFilter) params.append('machineId', historyMachineFilter);

      const res = await fetch(`${API}/maintenance/history?${params.toString()}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setHistoryItems(data.history || []);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju istorijata popravki:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Inicijalno učitavanje i reagovanje na query parametre
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

  useEffect(() => {
    if (activeTab === 'kvarovi') {
      fetchIssues();
    } else if (activeTab === 'nalozi') {
      fetchRemontOrders();
    } else if (activeTab === 'istorijat') {
      fetchHistory();
    }
  }, [
    activeTab,
    issueStatusFilter,
    issuePriorityFilter,
    issueMachineFilter,
    issueSearch,
    historyMachineFilter,
  ]);

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
        fetchIssues();
        if (activeTab === 'nalozi') fetchRemontOrders();
      } else {
        const data = await res.json();
        showToast(data.error || 'Greška pri promeni statusa.', 'error');
      }
    } catch (err) {
      showToast('Greška na serveru.', 'error');
    }
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
  };

  // Slanje završetka popravke
  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedIssueToResolve) return;

    if (!resolveRepairNotes.trim()) {
      showToast('Opis popravke je obavezan.', 'error');
      return;
    }

    // Automatsko izračunavanje zastoja u satima na osnovu vremena prijave i trenutka popravke
    const reportedMs = selectedIssueToResolve.dateReported
      ? new Date(selectedIssueToResolve.dateReported).getTime()
      : Date.now();
    const autoDowntimeHours = Math.max(0, Math.round(((Date.now() - reportedMs) / (1000 * 60 * 60)) * 10) / 10);

    setSubmittingResolve(true);
    try {
      const res = await fetch(`${API}/maintenance/issues/${selectedIssueToResolve.id}/resolve`, {
        method: 'POST',
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
        showToast(data.message || 'Popravka uspešno evidentirana!');
        setSelectedIssueToResolve(null);
        fetchStats();
        fetchIssues();
        if (activeTab === 'nalozi') fetchRemontOrders();
        if (activeTab === 'istorijat') fetchHistory();
      } else {
        const data = await res.json();
        showToast(data.error || 'Greška pri završetku popravke.', 'error');
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
        fetchRemontOrders();
        fetchIssues();
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
        fetchIssues();
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

  // Pomoćna funkcija za formatiranje datuma
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

  return (
    <AppLayout pageTitle="Radionica & Održavanje Mašina">
      <div className={styles.container}>
        {/* Header Bar */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <Wrench size={26} />
              Servisna Radionica & Kvarovi
            </h2>
          </div>

          <div className={styles.headerActions}>
            <button
              onClick={() => {
                fetchStats();
                if (activeTab === 'kvarovi') fetchIssues(true);
                if (activeTab === 'nalozi') fetchRemontOrders(true);
                if (activeTab === 'istorijat') fetchHistory(true);
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
              <AlertTriangle size={18} />
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

        {/* Dashboard Stats Grid */}
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
            <span className={`${styles.tabCount} ${styles.countPurple}`}>
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
            {/* Filter Bar */}
            <div className={styles.filterBar}>
              <div className={styles.searchInputWrapper}>
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Pretraži po nazivu mašine, opisu kvara..."
                  value={issueSearch}
                  onChange={(e) => setIssueSearch(e.target.value)}
                />
              </div>

              <select
                className={styles.filterSelect}
                value={issueStatusFilter}
                onChange={(e) => setIssueStatusFilter(e.target.value)}
              >
                <option value="AKTIVNI">Svi aktivni kvarovi</option>
                <option value="OTVOREN">Prijavljeni (Otvoreni)</option>
                <option value="U_RADU">U radu (Mehaničar radi)</option>
                <option value="CEKA_DELOVE">Čeka rezervne delove</option>
                <option value="SVE">Svi statusi (uključujući završene)</option>
              </select>

              <select
                className={styles.filterSelect}
                value={issuePriorityFilter}
                onChange={(e) => setIssuePriorityFilter(e.target.value)}
              >
                <option value="">Svi prioriteti</option>
                <option value="KRITICNA">🔴 Kritičan</option>
                <option value="VISOKA">🟠 Visok</option>
                <option value="SREDNJA">🟡 Srednji</option>
                <option value="NISKA">🔵 Nizak</option>
              </select>

              <select
                className={styles.filterSelect}
                value={issueMachineFilter}
                onChange={(e) => setIssueMachineFilter(e.target.value)}
              >
                <option value="">Sve mašine</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.type})
                  </option>
                ))}
              </select>
            </div>

            {/* Lista Kvarova */}
            {loadingIssues ? (
              <div className={styles.emptyState}>
                <p>Učitavanje prijavljenih kvarova...</p>
              </div>
            ) : issues.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>
                  <CheckCircle2 size={32} />
                </div>
                <h4>Nema aktivnih kvarova</h4>
                <p>Sva mehanizacija je u ispravnom stanju i spremna za rad na njivi!</p>
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
                              <span>{issue.machine?.brandModel || issue.machine?.type}</span>
                              {issue.machine?.regNumber && (
                                <span>• Reg: {issue.machine.regNumber}</span>
                              )}
                              <span>• {issue.machine?.currentHours || 0} rh</span>
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
                            <span>Datum: {formatDate(issue.dateReported)}</span>
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
                              <span>Radi: {issue.mechanic.name}</span>
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
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 2: NALOZI ZA REMONT                                      */}
        {/* ============================================================ */}
        {activeTab === 'nalozi' && (
          <>
            {loadingRemontOrders ? (
              <div className={styles.emptyState}>
                <p>Učitavanje servisnih radnih naloga...</p>
              </div>
            ) : remontOrders.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>
                  <ClipboardList size={32} />
                </div>
                <h4>Nema otvorenih naloga za remont</h4>
                <p>Rukovodilac trenutno nije izdao nijedan nalog za planski servis ili remont.</p>
              </div>
            ) : (
              <div className={styles.cardsGrid}>
                {remontOrders.map((order) => {
                  const isDone = order.status === 'ZAVRSEN';

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
                              <span>Dodeljeno: <strong>{order.worker?.name}</strong></span>
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
                              ? 'ZAVRŠEN'
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
                            <span>Izdao nalog: {order.issuedBy?.name}</span>
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
                          <span>Mehaničar: {order.worker?.name}</span>
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
                        </div>
                      </div>
                    </div>
                  );
                })}
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
              <select
                className={styles.filterSelect}
                value={historyMachineFilter}
                onChange={(e) => setHistoryMachineFilter(e.target.value)}
              >
                <option value="">Sva mehanizacija (kompletan istorijat)</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.type})
                  </option>
                ))}
              </select>
            </div>

            {loadingHistory ? (
              <div className={styles.emptyState}>
                <p>Učitavanje servisne knjižice...</p>
              </div>
            ) : historyItems.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>
                  <History size={32} />
                </div>
                <h4>Nema zabeleženih završenih popravki</h4>
                <p>Istorijat se automatski puni svakim završetkom servisa ili popravke kvara.</p>
              </div>
            ) : (
              <>
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
                            <strong>{formatDate(item.repairedAt || item.updatedAt)}</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Zastoj: {item.downtimeHours || 0} h
                            </div>
                          </td>
                          <td>
                            <strong>{item.machine?.name}</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {item.machine?.brandModel || item.machine?.type}
                            </div>
                          </td>
                          <td>{item.mechanic?.name || item.reportedBy?.name || '-'}</td>
                          <td>
                            <strong>{item.title}</strong>
                            {item.repairNotes && (
                              <div style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>
                                {item.repairNotes}
                              </div>
                            )}
                          </td>
                          <td>{item.partsReplaced || 'Bez novih delova'}</td>
                          <td>
                            {item.lubricantType ? (
                              <div>
                                <strong>{item.lubricantType}</strong>
                                {item.lubricantLiters && (
                                  <div style={{ color: '#16a34a', fontWeight: 700 }}>
                                    {item.lubricantLiters} Litara
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>-</span>
                            )}
                          </td>
                          <td>
                            {item.totalCost && item.totalCost > 0 ? (
                              <div>
                                <strong>{item.totalCost.toLocaleString('sr-RS')} RSD</strong>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                  Delovi: {item.partsCost || 0} RSD
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: 'var(--text-muted)' }}>0 RSD</span>
                            )}
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
                                  <strong style={{ color: '#16a34a', marginLeft: '0.35rem' }}>
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
                  <CheckCircle2 size={22} style={{ color: '#16a34a' }} />
                  Evidentiraj popravku i oslobodi mašinu
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
                      Kvar: {selectedIssueToResolve.title}
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
                      <select
                        value={resolveLubricantType}
                        onChange={(e) => setResolveLubricantType(e.target.value)}
                      >
                        {LUBRICANT_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
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
                      {submittingResolve ? 'Snimanje...' : 'Završi popravku i oslobodi mašinu'}
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
                  <Plus size={22} style={{ color: '#7c3aed' }} />
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
                    <select
                      value={remontMachineId}
                      onChange={(e) => setRemontMachineId(e.target.value)}
                      required
                    >
                      <option value="">Izaberite mašinu...</option>
                      {machines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} [{m.type}] — trenutno: {m.status}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Dodeljeni mehaničar *</label>
                    <select
                      value={remontWorkerId}
                      onChange={(e) => setRemontWorkerId(e.target.value)}
                      required
                    >
                      <option value="">Izaberite servisera / mehaničara...</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} [{w.type}]
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>Tip servisa *</label>
                      <select
                        value={remontServiceType}
                        onChange={(e) => setRemontServiceType(e.target.value)}
                      >
                        <option value="REDOVAN_SERVIS">Redovan servis (zamena ulja/filtera)</option>
                        <option value="GENERALNI_REMONT">Generalni remont pred sezonu</option>
                        <option value="KVAR_NJIVA">Vanredna popravka</option>
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label>Prioritet *</label>
                      <select
                        value={remontPriority}
                        onChange={(e) => setRemontPriority(e.target.value)}
                      >
                        <option value="KRITICNA">🔴 Kritičan</option>
                        <option value="VISOKA">🟠 Visok</option>
                        <option value="SREDNJA">🟡 Srednji</option>
                        <option value="NISKA">🔵 Nizak</option>
                      </select>
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
                  <AlertTriangle size={22} style={{ color: '#ef4444' }} />
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
                    <select
                      value={newIssueMachineId}
                      onChange={(e) => setNewIssueMachineId(e.target.value)}
                      required
                    >
                      <option value="">Izaberite mašinu...</option>
                      {machines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} [{m.type}] — status: {m.status}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label>Tip servisa *</label>
                      <select
                        value={newIssueServiceType}
                        onChange={(e) => setNewIssueServiceType(e.target.value)}
                      >
                        <option value="KVAR_NJIVA">Vanredni kvar sa njive</option>
                        <option value="REDOVAN_SERVIS">Redovan servis</option>
                        <option value="GENERALNI_REMONT">Generalni remont</option>
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label>Prioritet *</label>
                      <select
                        value={newIssuePriority}
                        onChange={(e) => setNewIssuePriority(e.target.value)}
                      >
                        <option value="KRITICNA">🔴 Kritičan</option>
                        <option value="VISOKA">🟠 Visok</option>
                        <option value="SREDNJA">🟡 Srednji</option>
                        <option value="NISKA">🔵 Nizak</option>
                      </select>
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

        {/* Toast Notifikacija */}
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
