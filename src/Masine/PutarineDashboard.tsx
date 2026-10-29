import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Plus,
  Pencil,
  Trash2,
  X,
  Truck,
  Wallet,
  Banknote,
  Tag,
  Loader2,
  AlertCircle,
  CheckCircle2,
  MapPin,
  Calendar,
  User,
  FileText,
  Lock,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { useSession } from '../lib/auth-client';
import styles from './PutarineDashboard.module.css';

const API = '/api';
const PAGE_SIZE = 25;

interface VehicleItem {
  id: string;
  name: string;
  type: string;
  regNumber?: string | null;
  brandModel?: string | null;
  enpTagNumber?: string | null;
  enpTagBalance?: number | null;
}

interface TollEntry {
  id: string;
  date: string;
  createdAt?: string;
  createdById?: string;
  isToday?: boolean;
  canEdit?: boolean;
  machineId: string;
  machine: VehicleItem;
  workerId: string;
  worker: { id: string; name: string; userId?: string | null };
  amount: number;
  paymentMethod: 'ENP_TAG' | 'GOTOVINA' | 'KARTICA';
  tagNumber?: string | null;
  entryStation?: string | null;
  exitStation?: string | null;
  routeRelation?: string | null;
  receiptNumber?: string | null;
  notes?: string | null;
  createdBy?: { id: string; name: string; role: string };
}

interface TollTopUp {
  id: string;
  date: string;
  machineId: string;
  machine: VehicleItem;
  tagNumber?: string | null;
  amount: number;
  paymentReference?: string | null;
  notes?: string | null;
  createdBy?: { id: string; name: string };
}

interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const PutarineDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const userRole = currentUser?.role || 'OPERATER';
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(userRole);

  // Filteri i paginacija
  const [activeTab, setActiveTab] = useState<'entries' | 'topups'>('entries');
  const [filterMachineId, setFilterMachineId] = useState('');
  const [filterWorkerId, setFilterWorkerId] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [entriesPage, setEntriesPage] = useState(1);
  const [topUpsPage, setTopUpsPage] = useState(1);

  // Reset na prvu stranicu prilikom promene bilo kog filtera
  useEffect(() => {
    setEntriesPage(1);
    setTopUpsPage(1);
  }, [filterMachineId, filterWorkerId, filterPaymentMethod, dateFrom, dateTo]);

  // Toast obaveštenje
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Dohvatanje radnika za padajuću listu
  const { data: workersData } = useQuery({
    queryKey: ['workers-lite'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/workers`, { credentials: 'include' });
      return res.json();
    },
  });
  const workers: Array<{ id: string; name: string; userId?: string | null }> =
    workersData?.workers || [];

  // Dohvatanje putarina, dopuna, vozila i statistike (25 po stranici)
  const { data: tollsData, isLoading } = useQuery({
    queryKey: [
      'tolls',
      filterMachineId,
      filterWorkerId,
      filterPaymentMethod,
      dateFrom,
      dateTo,
      entriesPage,
      topUpsPage,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('entriesPage', String(entriesPage));
      params.append('topUpsPage', String(topUpsPage));
      params.append('limit', String(PAGE_SIZE));
      if (filterMachineId) params.append('machineId', filterMachineId);
      if (isManager && filterWorkerId) params.append('workerId', filterWorkerId);
      if (filterPaymentMethod) params.append('paymentMethod', filterPaymentMethod);
      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);

      const res = await fetch(`${API}/tolls?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju putarina.');
      return res.json();
    },
  });

  const entries: TollEntry[] = tollsData?.entries || [];
  const topUps: TollTopUp[] = tollsData?.topUps || [];
  const vehicles: VehicleItem[] = tollsData?.vehicles || [];
  const taggedVehicles: VehicleItem[] = tollsData?.taggedVehicles || [];
  const currentWorkerFromServer: { id: string; name: string } | null =
    tollsData?.currentWorker || null;

  const stats = tollsData?.stats || {
    totalCostPeriod: 0,
    enpCostPeriod: 0,
    cashCardCostPeriod: 0,
    totalEntriesCount: 0,
    totalTopUpsCount: 0,
    totalTopUpsPeriod: 0,
    totalTagBalance: 0,
  };

  const entriesPagination: PaginationMeta = tollsData?.entriesPagination || {
    total: stats.totalEntriesCount || entries.length,
    page: entriesPage,
    limit: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil((stats.totalEntriesCount || entries.length) / PAGE_SIZE)),
  };

  const topUpsPagination: PaginationMeta = tollsData?.topUpsPagination || {
    total: stats.totalTopUpsCount || topUps.length,
    page: topUpsPage,
    limit: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil((stats.totalTopUpsCount || topUps.length) / PAGE_SIZE)),
  };

  // Provera da li je datum jednak današnjem kalendarskom danu
  const isSameCalendarDay = (dStr?: string | Date) => {
    if (!dStr) return false;
    const d = new Date(dStr);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };

  // Radnik može menjati/brisati svoj unos samo do kraja dana u kojem je unet;
  // Direktor i Rukovodilac mogu menjati/brisati uvek.
  const canModifyEntry = (entry: TollEntry) => {
    if (isManager) return true;
    if (entry.canEdit !== undefined) return Boolean(entry.canEdit);
    return isSameCalendarDay(entry.date) && (!entry.createdAt || isSameCalendarDay(entry.createdAt));
  };

  // Sortiramo vozila tako da KAMION i vozila sa ENP tagom budu na vrhu liste
  const sortedVehicles = [...vehicles].sort((a, b) => {
    const aPriority = a.type === 'KAMION' || a.enpTagNumber ? 0 : 1;
    const bPriority = b.type === 'KAMION' || b.enpTagNumber ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.name.localeCompare(b.name);
  });

  // Opcije za CustomSelect komponente
  const vehicleFilterOptions: CustomSelectOption[] = useMemo(() => [
    { value: '', label: 'Sva vozila / kamioni' },
    ...sortedVehicles.map((v) => ({
      value: v.id,
      label: v.name,
      subLabel: v.regNumber ? `Reg: ${v.regNumber} • ${v.type}` : v.brandModel || v.type,
      badge: v.enpTagNumber ? `TAG: ${v.enpTagNumber}` : undefined,
      badgeType: (v.enpTagNumber ? 'success' : 'default') as any,
    })),
  ], [sortedVehicles]);

  const workerFilterOptions: CustomSelectOption[] = useMemo(() => [
    { value: '', label: 'Svi vozači / radnici' },
    ...workers.map((w: any) => ({
      value: w.id,
      label: w.name,
      subLabel: w.type || w.role || 'Radnik',
    })),
  ], [workers]);

  const paymentMethodFilterOptions: CustomSelectOption[] = [
    { value: '', label: 'Svi načini plaćanja' },
    { value: 'ENP_TAG', label: 'ENP TAG (Uređaj)', badge: 'TAG', badgeType: 'success' },
    { value: 'GOTOVINA', label: 'Gotovina na rampi', badge: 'GOTOVINA', badgeType: 'warning' },
    { value: 'KARTICA', label: 'Platna kartica', badge: 'KARTICA', badgeType: 'default' },
  ];

  const modalVehicleOptions: CustomSelectOption[] = useMemo(() => [
    ...sortedVehicles.map((v) => ({
      value: v.id,
      label: v.name,
      subLabel: `${v.regNumber ? `Reg: ${v.regNumber} • ` : ''}${v.type}`,
      badge: v.enpTagNumber ? `TAG: ${v.enpTagNumber}` : undefined,
      badgeType: (v.enpTagNumber ? 'success' : 'default') as any,
    })),
  ], [sortedVehicles]);

  const modalWorkerOptions: CustomSelectOption[] = useMemo(() => [
    ...workers.map((w: any) => ({
      value: w.id,
      label: w.name,
      subLabel: w.type || w.role || 'Radnik',
    })),
  ], [workers]);

  const modalPaymentMethodOptions: CustomSelectOption[] = [
    { value: 'ENP_TAG', label: 'ENP Tag (Elektronska naplata)', badge: 'TAG', badgeType: 'success' },
    { value: 'GOTOVINA', label: 'Gotovina na rampi', badge: 'GOTOVINA', badgeType: 'warning' },
    { value: 'KARTICA', label: 'Platna kartica', badge: 'KARTICA', badgeType: 'default' },
  ];

  // ==========================================
  // MODAL 1: UNOS / IZMENA PUTARINE
  // ==========================================
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TollEntry | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  const [entryError, setEntryError] = useState('');

  const formatLocalDateInput = (dStr?: string | Date) => {
    const d = dStr ? new Date(dStr) : new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const todayStr = formatLocalDateInput();
  const [entryForm, setEntryForm] = useState({
    date: todayStr,
    machineId: '',
    workerId: '',
    amount: '',
    paymentMethod: 'ENP_TAG' as 'ENP_TAG' | 'GOTOVINA' | 'KARTICA',
    tagNumber: '',
    routeRelation: '',
    notes: '',
  });

  // Pomoćna funkcija za pronalazak ulogovanog radnika
  const findCurrentUsersWorkerId = () => {
    if (currentWorkerFromServer?.id) return currentWorkerFromServer.id;
    if (!currentUser || workers.length === 0) return '';
    const byId = workers.find((w) => w.userId === currentUser.id);
    if (byId) return byId.id;
    const byName = workers.find(
      (w) => w.name.toLowerCase() === (currentUser.name || '').trim().toLowerCase()
    );
    return byName ? byName.id : '';
  };

  const openNewEntryModal = (preselectedMachineId?: string) => {
    setEditingEntry(null);
    setEntryError('');
    const defaultMachine =
      preselectedMachineId ||
      sortedVehicles.find((v) => v.type === 'KAMION')?.id ||
      sortedVehicles[0]?.id ||
      '';
    const veh = vehicles.find((v) => v.id === defaultMachine);
    setEntryForm({
      date: formatLocalDateInput(),
      machineId: defaultMachine,
      workerId: findCurrentUsersWorkerId(),
      amount: '',
      paymentMethod: 'ENP_TAG',
      tagNumber: veh?.enpTagNumber || '',
      routeRelation: '',
      notes: '',
    });
    setEntryModalOpen(true);
  };

  const openEditEntryModal = (entry: TollEntry) => {
    setEditingEntry(entry);
    setEntryError('');
    setEntryForm({
      date: entry.date ? formatLocalDateInput(entry.date) : todayStr,
      machineId: entry.machineId,
      workerId: entry.workerId,
      amount: String(entry.amount),
      paymentMethod: entry.paymentMethod || 'ENP_TAG',
      tagNumber: entry.tagNumber || entry.machine?.enpTagNumber || '',
      routeRelation: entry.routeRelation || '',
      notes: entry.notes || '',
    });
    setEntryModalOpen(true);
  };

  // Kada se promeni vozilo u formi, automatski popuni ENP tag tog vozila
  const handleEntryVehicleChange = (newMachineId: string) => {
    const veh = vehicles.find((v) => v.id === newMachineId);
    setEntryForm((prev) => ({
      ...prev,
      machineId: newMachineId,
      tagNumber: veh?.enpTagNumber || prev.tagNumber,
    }));
  };

  const handleSaveEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntryError('');

    if (!entryForm.machineId || (isManager && !entryForm.workerId) || !entryForm.amount || Number(entryForm.amount) <= 0) {
      setEntryError('Vozilo, vozač i iznos u RSD (veći od 0) su obavezni.');
      return;
    }

    setEntryLoading(true);
    try {
      const url = editingEntry ? `${API}/tolls/${editingEntry.id}` : `${API}/tolls`;
      const method = editingEntry ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          date: entryForm.date,
          machineId: entryForm.machineId,
          workerId: entryForm.workerId || undefined,
          amount: Number(entryForm.amount),
          paymentMethod: entryForm.paymentMethod,
          tagNumber: entryForm.tagNumber.trim() || null,
          routeRelation: entryForm.routeRelation.trim() || null,
          notes: entryForm.notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri čuvanju putarine.');

      queryClient.invalidateQueries({ queryKey: ['tolls'] });
      queryClient.invalidateQueries({ queryKey: ['machines'] });
      queryClient.invalidateQueries({ queryKey: ['machines-lite'] });

      setEntryModalOpen(false);
      showToast(editingEntry ? 'Putarina je uspešno izmenjena.' : 'Putarina je uspešno evidentirana.');
    } catch (err: any) {
      setEntryError(err.message || 'Greška na serveru.');
    } finally {
      setEntryLoading(false);
    }
  };

  const handleDeleteEntry = async (entry: TollEntry) => {
    if (
      !window.confirm(
        `Da li ste sigurni da želite da obrišete putarinu za vozilo "${entry.machine?.name}" (${entry.amount.toLocaleString('sr-RS')} RSD)?`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`${API}/tolls/${entry.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri brisanju.');

      queryClient.invalidateQueries({ queryKey: ['tolls'] });
      queryClient.invalidateQueries({ queryKey: ['machines'] });
      showToast('Putarina je obrisana.');
    } catch (err: any) {
      showToast(err.message || 'Greška pri brisanju.', 'error');
    }
  };

  // ==========================================
  // MODAL 2: DOPUNA ENP TAGA (ZA RUKOVODIOCA I DIREKTORA)
  // ==========================================
  const [topUpModalOpen, setTopUpModalOpen] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpError, setTopUpError] = useState('');
  const [topUpForm, setTopUpForm] = useState({
    date: todayStr,
    machineId: '',
    tagNumber: '',
    amount: '',
    paymentReference: '',
    notes: '',
  });

  const openTopUpModal = (preselectedMachine?: VehicleItem) => {
    setTopUpError('');
    const target =
      preselectedMachine ||
      sortedVehicles.find((v) => v.type === 'KAMION') ||
      sortedVehicles[0];
    setTopUpForm({
      date: todayStr,
      machineId: target?.id || '',
      tagNumber: target?.enpTagNumber || '',
      amount: '',
      paymentReference: '',
      notes: '',
    });
    setTopUpModalOpen(true);
  };

  const handleSaveTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopUpError('');

    if (!topUpForm.machineId || !topUpForm.amount || Number(topUpForm.amount) <= 0) {
      setTopUpError('Izaberite vozilo i unesite iznos dopune u RSD.');
      return;
    }

    setTopUpLoading(true);
    try {
      const res = await fetch(`${API}/tolls/top-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          date: topUpForm.date,
          machineId: topUpForm.machineId,
          tagNumber: topUpForm.tagNumber.trim() || null,
          amount: Number(topUpForm.amount),
          paymentReference: topUpForm.paymentReference.trim() || null,
          notes: topUpForm.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri dopuni ENP taga.');

      queryClient.invalidateQueries({ queryKey: ['tolls'] });
      queryClient.invalidateQueries({ queryKey: ['machines'] });
      setTopUpModalOpen(false);
      showToast(`ENP tag je uspešno dopunjen za ${Number(topUpForm.amount).toLocaleString('sr-RS')} RSD!`);
    } catch (err: any) {
      setTopUpError(err.message || 'Greška na serveru.');
    } finally {
      setTopUpLoading(false);
    }
  };

  const handleDeleteTopUp = async (topUp: TollTopUp) => {
    if (
      !window.confirm(
        `Obrisati dopunu ENP taga za "${topUp.machine?.name}" od ${topUp.amount.toLocaleString('sr-RS')} RSD?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${API}/tolls/top-up/${topUp.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Greška pri brisanju dopune.');
      queryClient.invalidateQueries({ queryKey: ['tolls'] });
      queryClient.invalidateQueries({ queryKey: ['machines'] });
      showToast('Dopuna ENP taga je obrisana.');
    } catch (err: any) {
      showToast(err.message || 'Greška pri brisanju.', 'error');
    }
  };

  // ==========================================
  // MODAL 3: PODEŠAVANJE ENP TAGA NA VOZILU
  // ==========================================
  const [tagConfigModalOpen, setTagConfigModalOpen] = useState(false);
  const [tagConfigLoading, setTagConfigLoading] = useState(false);
  const [tagConfigError, setTagConfigError] = useState('');
  const [tagConfigForm, setTagConfigForm] = useState({
    machineId: '',
    enpTagNumber: '',
    enpTagBalance: '',
  });

  const openTagConfigModal = (veh?: VehicleItem) => {
    setTagConfigError('');
    const target = veh || sortedVehicles.find((v) => v.type === 'KAMION') || sortedVehicles[0];
    setTagConfigForm({
      machineId: target?.id || '',
      enpTagNumber: target?.enpTagNumber || '',
      enpTagBalance:
        target?.enpTagBalance !== undefined && target?.enpTagBalance !== null
          ? String(target.enpTagBalance)
          : '0',
    });
    setTagConfigModalOpen(true);
  };

  useEffect(() => {
    if (tagConfigModalOpen && tagConfigForm.machineId) {
      const v = vehicles.find((m) => m.id === tagConfigForm.machineId);
      if (v) {
        setTagConfigForm((prev) => ({
          ...prev,
          enpTagNumber: v.enpTagNumber || '',
          enpTagBalance:
            v.enpTagBalance !== undefined && v.enpTagBalance !== null
              ? String(v.enpTagBalance)
              : '0',
        }));
      }
    }
  }, [tagConfigForm.machineId]);

  const handleSaveTagConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setTagConfigError('');
    if (!tagConfigForm.machineId) {
      setTagConfigError('Izaberite vozilo.');
      return;
    }

    setTagConfigLoading(true);
    try {
      const res = await fetch(`${API}/tolls/vehicle-tag/${tagConfigForm.machineId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          enpTagNumber: tagConfigForm.enpTagNumber.trim() || null,
          enpTagBalance: Number(tagConfigForm.enpTagBalance || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri čuvanju ENP taga.');

      queryClient.invalidateQueries({ queryKey: ['tolls'] });
      queryClient.invalidateQueries({ queryKey: ['machines'] });
      setTagConfigModalOpen(false);
      showToast('Podaci o ENP tagu vozila su sačuvani.');
    } catch (err: any) {
      setTagConfigError(err.message || 'Greška na serveru.');
    } finally {
      setTagConfigLoading(false);
    }
  };

  return (
    <AppLayout pageTitle="Putarine & ENP Tagovi">
      <div className={styles.container}>
        {toast && (
          <div
            className={`${styles.toast} ${
              toast.type === 'success' ? styles.toastSuccess : styles.toastError
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{toast.text}</span>
          </div>
        )}

        {/* ZAGLAVLJE I GLAVNE AKCIJE */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <span className={styles.titleIcon}>
                <CreditCard size={25} />
              </span>
              <span>Putarine & ENP Tagovi</span>
            </h2>
            <p className={styles.subtitle}>
              Evidencija putarina i praćenje ENP tagova za kamione i prevozna sredstva
            </p>
          </div>

          <div className={styles.actionBtns}>
            {isManager && (
              <>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => openTagConfigModal()}
                  title="Dodeli ili izmeni broj ENP taga i stanje na vozilu"
                >
                  <Tag size={16} className={styles.tagIcon} />
                  <span>Podesi ENP Tag</span>
                </button>

                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => openTopUpModal()}
                  title="Evidentiraj uplatu / dopunu kredita na ENP tag"
                >
                  <Wallet size={16} className={styles.walletIcon} />
                  <span>Dopuni ENP Tag</span>
                </button>
              </>
            )}

            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => openNewEntryModal()}
            >
              <Plus size={18} />
              <span>Unesi Putarinu</span>
            </button>
          </div>
        </div>

        {/* KPI KARTICE */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconBlue}`}>
              <Truck size={22} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.totalCostPeriod.toLocaleString('sr-RS')}
                <span className={styles.statUnit}>RSD</span>
              </div>
              <div className={styles.statLabel}>
                Ukupno Putarine ({stats.totalEntriesCount} prolaza)
              </div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconPurple}`}>
              <CreditCard size={22} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.enpCostPeriod.toLocaleString('sr-RS')}
                <span className={styles.statUnit}>RSD</span>
              </div>
              <div className={styles.statLabel}>Plaćeno preko ENP Tagova</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconAmber}`}>
              <Banknote size={22} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.cashCardCostPeriod.toLocaleString('sr-RS')}
                <span className={styles.statUnit}>RSD</span>
              </div>
              <div className={styles.statLabel}>Gotovina / Kartica na rampi</div>
            </div>
          </div>

          {isManager && (
            <div className={styles.statCard}>
              <div className={`${styles.statIcon} ${styles.iconGreen}`}>
                <Wallet size={22} />
              </div>
              <div className={styles.statContent}>
                <div className={styles.statValue}>
                  {stats.totalTagBalance.toLocaleString('sr-RS')}
                  <span className={styles.statUnit}>RSD</span>
                </div>
                <div className={styles.statLabel}>Preostalo stanje na ENP tagovima</div>
              </div>
            </div>
          )}
        </div>

        {/* PREGLED KAMIONA I ENP TAGOVA */}
        {taggedVehicles.length > 0 && (
          <div className={styles.tagsSection}>
            <div className={styles.tagsSectionHeader}>
              <div className={styles.tagsSectionTitle}>
                <Tag size={18} className={styles.tagIcon} />
                <span>Kamioni i prevozna sredstva — Stanje ENP Tagova</span>
              </div>
            </div>

            <div className={styles.tagsGrid}>
              {taggedVehicles.map((veh) => {
                const bal = Number(veh.enpTagBalance || 0);
                const balClass =
                  bal <= 0
                    ? styles.balanceEmpty
                    : bal < 2000
                    ? styles.balanceLow
                    : styles.balanceOk;

                return (
                  <div key={veh.id} className={styles.tagCard}>
                    <div className={styles.tagCardTop}>
                      <div className={styles.truckInfo}>
                        <div className={styles.truckName}>{veh.name}</div>
                        <div className={styles.truckReg}>
                          {veh.regNumber ? `Reg: ${veh.regNumber}` : veh.type}
                          {veh.brandModel ? ` • ${veh.brandModel}` : ''}
                        </div>
                      </div>

                      {veh.enpTagNumber ? (
                        <span className={styles.tagBadge}>
                          <Tag size={12} />
                          <span>{veh.enpTagNumber}</span>
                        </span>
                      ) : (
                        <span className={styles.tagBadgeMissing}>Nema br. taga</span>
                      )}
                    </div>

                    <div className={styles.tagCardBottom}>
                      <div>
                        <div className={styles.balanceLabel}>Stanje na tagu:</div>
                        <div className={`${styles.balanceValue} ${balClass}`}>
                          {bal.toLocaleString('sr-RS')} RSD
                        </div>
                      </div>

                      <div className={styles.tagQuickActions}>
                        <button
                          type="button"
                          className={styles.miniBtn}
                          onClick={() => openNewEntryModal(veh.id)}
                          title="Unesi putarinu za ovo vozilo"
                        >
                          <Plus size={12} />
                          <span>Putarina</span>
                        </button>

                        {isManager && (
                          <>
                            <button
                              type="button"
                              className={`${styles.miniBtn} ${styles.miniBtnPrimary}`}
                              onClick={() => openTopUpModal(veh)}
                              title="Dopuni kredit na ENP tagu ovog vozila"
                            >
                              <Wallet size={12} />
                              <span>Dopuni</span>
                            </button>
                            <button
                              type="button"
                              className={styles.miniBtn}
                              onClick={() => openTagConfigModal(veh)}
                              title="Izmeni broj ENP taga ili stanje"
                            >
                              <Pencil size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* FILTERI I TABOVI */}
        <div className={styles.filterCard}>
          <div className={styles.tabsRow}>
            <div className={styles.tabButtons}>
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'entries' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('entries')}
              >
                {isManager
                  ? `Dnevnik putarina (${entriesPagination.total})`
                  : `Moje evidentirane putarine (${entriesPagination.total})`}
              </button>
              {isManager && (
                <button
                  type="button"
                  className={`${styles.tabBtn} ${activeTab === 'topups' ? styles.tabBtnActive : ''}`}
                  onClick={() => setActiveTab('topups')}
                >
                  Istorija dopuna ENP tagova ({topUpsPagination.total})
                </button>
              )}
            </div>
          </div>

          <div className={styles.filtersRow}>
            <div className={styles.filterGroup}>
              <CustomSelect
                value={filterMachineId}
                onChange={(val) => setFilterMachineId(val)}
                options={vehicleFilterOptions}
                placeholder="Sva vozila / kamioni"
                searchable
              />
            </div>

            {isManager && activeTab === 'entries' && (
              <div className={styles.filterGroup}>
                <CustomSelect
                  value={filterWorkerId}
                  onChange={(val) => setFilterWorkerId(val)}
                  options={workerFilterOptions}
                  placeholder="Svi vozači / radnici"
                  searchable
                />
              </div>
            )}

            {activeTab === 'entries' && (
              <div className={styles.filterGroup}>
                <CustomSelect
                  value={filterPaymentMethod}
                  onChange={(val) => setFilterPaymentMethod(val)}
                  options={paymentMethodFilterOptions}
                  placeholder="Svi načini plaćanja"
                />
              </div>
            )}

            <div className={styles.dateRangeGroup}>
              <div className={styles.dateField}>
                <span className={styles.dateLabel}>Od:</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className={styles.dateField}>
                <span className={styles.dateLabel}>Do:</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            {(filterMachineId || filterWorkerId || filterPaymentMethod || dateFrom || dateTo) && (
              <button
                type="button"
                className={styles.btnClearFilters}
                onClick={() => {
                  setFilterMachineId('');
                  setFilterWorkerId('');
                  setFilterPaymentMethod('');
                  setDateFrom('');
                  setDateTo('');
                }}
              >
                Poništi filtere
              </button>
            )}
          </div>
        </div>

        {/* TABELA / KARTICE UNOSA PUTARINA ILI DOPUNA */}
        <div className={styles.tableCard}>
          {isLoading ? (
            <div className={styles.emptyState}>
              <Loader2 size={28} className="spin" />
              <span>Učitavanje podataka o putarinama...</span>
            </div>
          ) : activeTab === 'entries' ? (
            entries.length === 0 ? (
              <div className={styles.emptyState}>
                <CreditCard size={36} />
                <strong>Nema evidentiranih putarina za izabrani filter</strong>
                <span>Kliknite na „Unesi Putarinu" da zabeležite prolaz ili plaćanje putarine.</span>
              </div>
            ) : (
              <>
                {/* Desktop/Tablet Table (>= 768px) */}
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Datum</th>
                        <th>Vozilo / Kamion</th>
                        <th>Vozač</th>
                        <th>Iznos (RSD)</th>
                        <th>Način plaćanja / Tag</th>
                        <th>Relacija / Napomena</th>
                        <th style={{ textAlign: 'right' }}>Akcije</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((entry) => {
                        const editable = canModifyEntry(entry);
                        return (
                          <tr key={entry.id}>
                            <td>
                              <strong>{new Date(entry.date).toLocaleDateString('sr-RS')}</strong>
                            </td>
                            <td>
                              <div style={{ fontWeight: 700 }}>{entry.machine?.name}</div>
                              {entry.machine?.regNumber && (
                                <div className={styles.tableSubtext}>
                                  {entry.machine.regNumber}
                                </div>
                              )}
                            </td>
                            <td>{entry.worker?.name || '—'}</td>
                            <td>
                              <span className={styles.amountBadge}>
                                {Number(entry.amount).toLocaleString('sr-RS')} RSD
                              </span>
                            </td>
                            <td>
                              <span
                                className={`${styles.methodPill} ${
                                  entry.paymentMethod === 'ENP_TAG'
                                    ? styles.methodENP
                                    : entry.paymentMethod === 'GOTOVINA'
                                    ? styles.methodCash
                                    : styles.methodCard
                                }`}
                              >
                                {entry.paymentMethod === 'ENP_TAG'
                                  ? 'ENP Tag'
                                  : entry.paymentMethod === 'GOTOVINA'
                                  ? 'Gotovina'
                                  : 'Kartica'}
                              </span>
                              {entry.tagNumber && (
                                <div className={styles.tagSubtext}>
                                  Tag: {entry.tagNumber}
                                </div>
                              )}
                            </td>
                            <td>
                              {entry.routeRelation && (
                                <div className={styles.routeRelationBox}>
                                  <MapPin size={13} className={styles.routeIcon} />
                                  <span>{entry.routeRelation}</span>
                                </div>
                              )}
                              {entry.notes && (
                                <div className={styles.tableNotes}>{entry.notes}</div>
                              )}
                              {!entry.routeRelation && !entry.notes && '—'}
                            </td>
                            <td>
                              <div className={styles.rowActions}>
                                {editable ? (
                                  <>
                                    <button
                                      type="button"
                                      className={styles.iconBtn}
                                      onClick={() => openEditEntryModal(entry)}
                                      title="Izmeni putarinu"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                    <button
                                      type="button"
                                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                                      onClick={() => handleDeleteEntry(entry)}
                                      title="Obriši putarinu"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </>
                                ) : (
                                  <span
                                    className={styles.lockedBadge}
                                    title="Rok za izmenu i brisanje je istekao (radnik može menjati samo do kraja dana unosa)"
                                  >
                                    <Lock size={12} />
                                    <span>Zaključano</span>
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card List (< 768px) */}
                <div className={styles.mobileCardList}>
                  {entries.map((entry) => {
                    const editable = canModifyEntry(entry);
                    return (
                      <div key={entry.id} className={styles.mobileEntryCard}>
                        <div className={styles.mobileCardHeader}>
                          <div className={styles.mobileCardDate}>
                            <Calendar size={13} />
                            <span>{new Date(entry.date).toLocaleDateString('sr-RS')}</span>
                          </div>
                          <div className={styles.mobileCardHeaderRight}>
                            <span
                              className={`${styles.methodPill} ${
                                entry.paymentMethod === 'ENP_TAG'
                                  ? styles.methodENP
                                  : entry.paymentMethod === 'GOTOVINA'
                                  ? styles.methodCash
                                  : styles.methodCard
                              }`}
                            >
                              {entry.paymentMethod === 'ENP_TAG'
                                ? 'ENP Tag'
                                : entry.paymentMethod === 'GOTOVINA'
                                ? 'Gotovina'
                                : 'Kartica'}
                            </span>
                            <span className={styles.amountBadge}>
                              {Number(entry.amount).toLocaleString('sr-RS')} RSD
                            </span>
                          </div>
                        </div>

                        <div className={styles.mobileCardBody}>
                          <div className={styles.mobileVehicleRow}>
                            <Truck size={15} className={styles.mobileRowIcon} />
                            <div className={styles.mobileVehicleName}>
                              <span>{entry.machine?.name}</span>
                              {entry.machine?.regNumber && (
                                <span className={styles.mobileRegBadge}>{entry.machine.regNumber}</span>
                              )}
                            </div>
                          </div>

                          <div className={styles.mobileMetaRow}>
                            <div className={styles.mobileMetaItem}>
                              <User size={13} className={styles.mobileRowIcon} />
                              <span>{entry.worker?.name || '—'}</span>
                            </div>
                            {entry.tagNumber && (
                              <div className={styles.mobileMetaItem}>
                                <Tag size={13} className={styles.mobileRowIcon} />
                                <span>Tag: {entry.tagNumber}</span>
                              </div>
                            )}
                          </div>

                          {entry.routeRelation && (
                            <div className={styles.mobileRouteRow}>
                              <MapPin size={13} className={styles.routeIcon} />
                              <span>{entry.routeRelation}</span>
                            </div>
                          )}

                          {entry.notes && (
                            <div className={styles.mobileNotes}>
                              {entry.notes}
                            </div>
                          )}
                        </div>

                        <div className={styles.mobileCardFooter}>
                          <div className={styles.rowActions}>
                            {editable ? (
                              <>
                                <button
                                  type="button"
                                  className={styles.iconBtn}
                                  onClick={() => openEditEntryModal(entry)}
                                  title="Izmeni putarinu"
                                >
                                  <Pencil size={13} />
                                  <span>Izmeni</span>
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                                  onClick={() => handleDeleteEntry(entry)}
                                  title="Obriši putarinu"
                                >
                                  <Trash2 size={13} />
                                  <span>Obriši</span>
                                </button>
                              </>
                            ) : (
                              <span
                                className={styles.lockedBadge}
                                title="Rok za izmenu i brisanje je istekao (dozvoljeno samo do kraja dana unosa)"
                              >
                                <Lock size={12} />
                                <span>Zaključano</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Paginacija za Dnevnik putarina (25 po stranici sa direktnim unosom) */}
                {entriesPagination.total > 0 && (
                  <div style={{ marginTop: '1.25rem' }}>
                    <TablePagination
                      currentPage={entriesPagination.page}
                      totalPages={entriesPagination.totalPages}
                      totalItems={entriesPagination.total}
                      pageSize={PAGE_SIZE}
                      onPageChange={(p) => setEntriesPage(p)}
                      itemName="putarina"
                    />
                  </div>
                )}
              </>
            )
          ) : topUps.length === 0 ? (
            <div className={styles.emptyState}>
              <Wallet size={36} />
              <strong>Nema evidentiranih dopuna ENP tagova</strong>
              <span>Kliknite na „Dopuni ENP Tag" kada uplatite sredstva za kamion.</span>
            </div>
          ) : (
            <>
              {/* Desktop/Tablet Table (>= 768px) */}
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Datum dopune</th>
                      <th>Vozilo / Kamion</th>
                      <th>Broj ENP Taga</th>
                      <th>Uplaćeni iznos (RSD)</th>
                      <th>Referenca / Broj računa</th>
                      <th>Napomena</th>
                      <th style={{ textAlign: 'right' }}>Akcije</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topUps.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <strong>{new Date(t.date).toLocaleDateString('sr-RS')}</strong>
                        </td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{t.machine?.name}</div>
                          {t.machine?.regNumber && (
                            <div className={styles.tableSubtext}>
                              {t.machine.regNumber}
                            </div>
                          )}
                        </td>
                        <td>{t.tagNumber || t.machine?.enpTagNumber || '—'}</td>
                        <td>
                          <span className={styles.topUpAmountBadge}>
                            +{Number(t.amount).toLocaleString('sr-RS')} RSD
                          </span>
                        </td>
                        <td>{t.paymentReference || '—'}</td>
                        <td>{t.notes || '—'}</td>
                        <td>
                          <div className={styles.rowActions}>
                            <button
                              type="button"
                              className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                              onClick={() => handleDeleteTopUp(t)}
                              title="Obriši dopunu"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List (< 768px) */}
              <div className={styles.mobileCardList}>
                {topUps.map((t) => (
                  <div key={t.id} className={styles.mobileEntryCard}>
                    <div className={styles.mobileCardHeader}>
                      <div className={styles.mobileCardDate}>
                        <Calendar size={13} />
                        <span>{new Date(t.date).toLocaleDateString('sr-RS')}</span>
                      </div>
                      <span className={styles.topUpAmountBadge}>
                        +{Number(t.amount).toLocaleString('sr-RS')} RSD
                      </span>
                    </div>

                    <div className={styles.mobileCardBody}>
                      <div className={styles.mobileVehicleRow}>
                        <Truck size={15} className={styles.mobileRowIcon} />
                        <div className={styles.mobileVehicleName}>
                          <span>{t.machine?.name}</span>
                          {t.machine?.regNumber && (
                            <span className={styles.mobileRegBadge}>{t.machine.regNumber}</span>
                          )}
                        </div>
                      </div>

                      <div className={styles.mobileMetaRow}>
                        <div className={styles.mobileMetaItem}>
                          <Tag size={13} className={styles.mobileRowIcon} />
                          <span>Tag: {t.tagNumber || t.machine?.enpTagNumber || '—'}</span>
                        </div>
                        {t.paymentReference && (
                          <div className={styles.mobileMetaItem}>
                            <FileText size={13} className={styles.mobileRowIcon} />
                            <span>Ref: {t.paymentReference}</span>
                          </div>
                        )}
                      </div>

                      {t.notes && (
                        <div className={styles.mobileNotes}>
                          {t.notes}
                        </div>
                      )}
                    </div>

                    {isManager && (
                      <div className={styles.mobileCardFooter}>
                        <div className={styles.rowActions}>
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            onClick={() => handleDeleteTopUp(t)}
                            title="Obriši dopunu"
                          >
                            <Trash2 size={13} />
                            <span>Obriši</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Paginacija za Istoriju dopuna ENP tagova (25 po stranici sa direktnim unosom) */}
              {topUpsPagination.total > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <TablePagination
                    currentPage={topUpsPagination.page}
                    totalPages={topUpsPagination.totalPages}
                    totalItems={topUpsPagination.total}
                    pageSize={PAGE_SIZE}
                    onPageChange={(p) => setTopUpsPage(p)}
                    itemName="dopuna tagova"
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* ============================================================ */}
        {/* MODAL 1: UNOS / IZMENA PUTARINE                              */}
        {/* ============================================================ */}
        {entryModalOpen && (
          <div className={styles.modalBackdrop} onClick={() => setEntryModalOpen(false)}>
            <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>{editingEntry ? 'Izmeni Putarinu' : 'Unesi Putarinu'}</h3>
                <button
                  type="button"
                  className={styles.modalCloseBtn}
                  onClick={() => setEntryModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveEntry}>
                <div className={styles.modalBody}>
                  {entryError && (
                    <div className={styles.modalError}>
                      {entryError}
                    </div>
                  )}

                  <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                      <label>Vozilo / Kamion *</label>
                      <CustomSelect
                        value={entryForm.machineId}
                        onChange={(val) => handleEntryVehicleChange(val)}
                        options={modalVehicleOptions}
                        placeholder="Izaberite vozilo..."
                        searchable
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Vozač / Radnik *</label>
                      {isManager ? (
                        <CustomSelect
                          value={entryForm.workerId}
                          onChange={(val) => setEntryForm({ ...entryForm, workerId: val })}
                          options={modalWorkerOptions}
                          placeholder="Izaberite vozača..."
                          searchable
                        />
                      ) : (
                        <input
                          type="text"
                          className={styles.formInput}
                          value={
                            currentWorkerFromServer?.name ||
                            currentUser?.name ||
                            'Ulogovani radnik'
                          }
                          disabled
                        />
                      )}
                    </div>
                  </div>

                  <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                      <label>Datum {!isManager && '(današnji dan)'} *</label>
                      <input
                        type="date"
                        className={styles.formInput}
                        value={entryForm.date}
                        onChange={(e) => setEntryForm({ ...entryForm, date: e.target.value })}
                        disabled={!isManager}
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Iznos putarine (RSD) *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        placeholder="npr. 1420"
                        className={styles.formInput}
                        value={entryForm.amount}
                        onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                      <label>Način plaćanja</label>
                      <CustomSelect
                        value={entryForm.paymentMethod}
                        onChange={(val) =>
                          setEntryForm({
                            ...entryForm,
                            paymentMethod: val as 'ENP_TAG' | 'GOTOVINA' | 'KARTICA',
                          })
                        }
                        options={modalPaymentMethodOptions}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Broj ENP taga (opciono)</label>
                      <input
                        type="text"
                        placeholder="npr. ENP-104288"
                        className={styles.formInput}
                        value={entryForm.tagNumber}
                        onChange={(e) => setEntryForm({ ...entryForm, tagNumber: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Relacija / Deonica (opciono)</label>
                    <input
                      type="text"
                      placeholder="npr. Novi Sad - Beograd"
                      className={styles.formInput}
                      value={entryForm.routeRelation}
                      onChange={(e) => setEntryForm({ ...entryForm, routeRelation: e.target.value })}
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Napomena (opciono)</label>
                    <textarea
                      rows={2}
                      placeholder="Dodatna napomena o prevozu..."
                      className={styles.formTextarea}
                      value={entryForm.notes}
                      onChange={(e) => setEntryForm({ ...entryForm, notes: e.target.value })}
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setEntryModalOpen(false)}
                  >
                    Otkaži
                  </button>
                  <button type="submit" className={styles.btnPrimary} disabled={entryLoading}>
                    {entryLoading
                      ? 'Čuvanje...'
                      : editingEntry
                      ? 'Sačuvaj izmene'
                      : 'Evidentiraj putarinu'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 2: DOPUNA ENP TAGA                                     */}
        {/* ============================================================ */}
        {topUpModalOpen && (
          <div className={styles.modalBackdrop} onClick={() => setTopUpModalOpen(false)}>
            <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Dopuni ENP Tag</h3>
                <button
                  type="button"
                  className={styles.modalCloseBtn}
                  onClick={() => setTopUpModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveTopUp}>
                <div className={styles.modalBody}>
                  {topUpError && (
                    <div className={styles.modalError}>
                      {topUpError}
                    </div>
                  )}

                  <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                      <label>Vozilo / Kamion *</label>
                      <CustomSelect
                        value={topUpForm.machineId}
                        onChange={(val) => {
                          const v = vehicles.find((m) => m.id === val);
                          setTopUpForm({
                            ...topUpForm,
                            machineId: val,
                            tagNumber: v?.enpTagNumber || topUpForm.tagNumber,
                          });
                        }}
                        options={modalVehicleOptions}
                        placeholder="Izaberite vozilo..."
                        searchable
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Datum dopune *</label>
                      <input
                        type="date"
                        className={styles.formInput}
                        value={topUpForm.date}
                        onChange={(e) => setTopUpForm({ ...topUpForm, date: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                      <label>Iznos dopune (RSD) *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        placeholder="npr. 20000"
                        className={styles.formInput}
                        value={topUpForm.amount}
                        onChange={(e) => setTopUpForm({ ...topUpForm, amount: e.target.value })}
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Broj ENP Taga</label>
                      <input
                        type="text"
                        placeholder="npr. ENP-104288"
                        className={styles.formInput}
                        value={topUpForm.tagNumber}
                        onChange={(e) => setTopUpForm({ ...topUpForm, tagNumber: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Broj računa / uplatnice (opciono)</label>
                    <input
                      type="text"
                      placeholder="npr. Faktura 2026-041"
                      className={styles.formInput}
                      value={topUpForm.paymentReference}
                      onChange={(e) =>
                        setTopUpForm({ ...topUpForm, paymentReference: e.target.value })
                      }
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Napomena (opciono)</label>
                    <textarea
                      rows={2}
                      className={styles.formTextarea}
                      value={topUpForm.notes}
                      onChange={(e) => setTopUpForm({ ...topUpForm, notes: e.target.value })}
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setTopUpModalOpen(false)}
                  >
                    Otkaži
                  </button>
                  <button type="submit" className={styles.btnPrimary} disabled={topUpLoading}>
                    {topUpLoading ? 'Čuvanje...' : 'Evidentiraj dopunu'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 3: PODEŠAVANJE BROJA ENP TAGA I STANJA NA VOZILU       */}
        {/* ============================================================ */}
        {tagConfigModalOpen && (
          <div className={styles.modalBackdrop} onClick={() => setTagConfigModalOpen(false)}>
            <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Podesi ENP Tag na vozilu</h3>
                <button
                  type="button"
                  className={styles.modalCloseBtn}
                  onClick={() => setTagConfigModalOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveTagConfig}>
                <div className={styles.modalBody}>
                  {tagConfigError && (
                    <div className={styles.modalError}>
                      {tagConfigError}
                    </div>
                  )}

                  <div className={styles.formGroup}>
                    <label>Vozilo / Mašina *</label>
                    <CustomSelect
                      value={tagConfigForm.machineId}
                      onChange={(val) =>
                        setTagConfigForm({ ...tagConfigForm, machineId: val })
                      }
                      options={modalVehicleOptions}
                      placeholder="Izaberite vozilo..."
                      searchable
                    />
                  </div>

                  <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                      <label>Broj ENP Taga</label>
                      <input
                        type="text"
                        placeholder="npr. ENP-104288"
                        className={styles.formInput}
                        value={tagConfigForm.enpTagNumber}
                        onChange={(e) =>
                          setTagConfigForm({ ...tagConfigForm, enpTagNumber: e.target.value })
                        }
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Trenutno stanje kredita (RSD)</label>
                      <input
                        type="number"
                        step="1"
                        className={styles.formInput}
                        value={tagConfigForm.enpTagBalance}
                        onChange={(e) =>
                          setTagConfigForm({ ...tagConfigForm, enpTagBalance: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setTagConfigModalOpen(false)}
                  >
                    Otkaži
                  </button>
                  <button type="submit" className={styles.btnPrimary} disabled={tagConfigLoading}>
                    {tagConfigLoading ? 'Čuvanje...' : 'Sačuvaj ENP Tag'}
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

export default PutarineDashboard;

