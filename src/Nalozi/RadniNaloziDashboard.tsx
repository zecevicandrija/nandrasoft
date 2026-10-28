import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList,
  Plus,
  Tractor,
  Wrench,
  User,
  MapPin,
  Clock,
  X,
  Play,
  KeyRound,
  Fuel,
  AlertCircle,
  Loader2,
  Pencil,
  Info,
  RotateCcw,
  AlertTriangle,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  Filter,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { ParcelQuickModal, ParcelQuickActions, type ParcelItem } from '../components/ParcelQuickModal';
import { useSession } from '../lib/auth-client';
import styles from './RadniNaloziDashboard.module.css';

interface Worker {
  id: string;
  name: string;
  type?: 'STALNI' | 'SEZONAC';
  user?: {
    id: string;
    email: string;
    role: string;
  } | null;
}

interface Machine {
  id: string;
  name: string;
  type: string;
  status: string;
  tankCapacityLiters?: number;
  currentFuelLiters?: number;
  currentHours?: number;
}

interface Parcel {
  id: string;
  name: string;
  code: string;
  areaHa: number;
  location?: string | null;
  currentCrop?: string | null;
  notes?: string | null;
}

interface WorkType {
  id: string;
  name: string;
  category: string;
}

interface WorkOrder {
  id: string;
  orderNumber: string;
  orderDate: string;
  orderType: 'RAD_NJIVA' | 'REMONT_SERVIS' | 'OSTALO';
  status: 'PLANIRAN' | 'DODELJEN' | 'U_TOKU' | 'ZAVRSEN' | 'OTKAZAN';
  priority: string;
  workerId: string;
  worker: { id: string; name: string };
  machineId?: string;
  machine?: {
    id: string;
    name: string;
    tankCapacityLiters?: number;
    currentFuelLiters?: number;
    currentHours?: number;
  };
  attachmentId?: string;
  attachment?: { id: string; name: string };
  parcelId?: string;
  parcel?: { id: string; name: string; code: string };
  workTypeId?: string;
  workType?: { id: string; name: string };
  plannedAreaHa?: number;
  shift: 'PRVA' | 'DRUGA' | 'TRECA';
  instructions?: string;
  issuedBy?: { id: string; name: string; role: string };
  createdAt?: string;
  updatedAt?: string;
  machineAssignments?: Array<{
    id: string;
    status: string;
    startFuelLiters?: number;
    startHours?: number;
    assignedAt?: string;
  }>;
}

interface PaginationData {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface StatsData {
  totalOrders: number;
  pendingOrders: number;
  inProgressOrders: number;
  completedOrders: number;
}

const API = '/api';

const RadniNaloziDashboard: React.FC = () => {
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const userRole = currentUser?.role || 'OPERATER';
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(userRole);

  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Paginacija & Statistika (25 naloga po stranici)
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<PaginationData>({
    total: 0,
    page: 1,
    limit: 25,
    totalPages: 1,
  });
  const [stats, setStats] = useState<StatsData>({
    totalOrders: 0,
    pendingOrders: 0,
    inProgressOrders: 0,
    completedOrders: 0,
  });

  // Filteri - podrazumevano prikazujemo 'SVE' tako da se odmah vide svi nalozi
  const [datePreset, setDatePreset] = useState<'DANAS' | 'SUTRA' | 'SVE' | 'CUSTOM'>('SVE');
  const [customDate, setCustomDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Šifarnici za modal
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [workTypes, setWorkTypes] = useState<WorkType[]>([]);

  // Modal za novi nalog stanje
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  // Brzo dodavanje / izmena parcele
  const [parcelQuickModalOpen, setParcelQuickModalOpen] = useState(false);
  const [parcelToEdit, setParcelToEdit] = useState<ParcelItem | null>(null);
  const [parcelQuickTarget, setParcelQuickTarget] = useState<'create-order' | 'edit-order'>('create-order');

  // Modal za prihvatanje naloga i zaduživanje mašine stanje
  const [selectedOrderToAccept, setSelectedOrderToAccept] = useState<WorkOrder | null>(null);
  const [acceptFuelLiters, setAcceptFuelLiters] = useState<string | number>('');
  const [acceptHours, setAcceptHours] = useState<string | number>('');
  const [acceptNotes, setAcceptNotes] = useState('');
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  // Form podaci za novi nalog
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const [formData, setFormData] = useState({
    orderDate: tomorrowStr,
    orderType: 'RAD_NJIVA',
    priority: 'NORMALNO',
    workerId: '',
    machineId: '',
    attachmentId: '',
    parcelId: '',
    workTypeId: '',
    plannedAreaHa: '',
    shift: 'PRVA',
    instructions: '',
  });

  // Modal za izmenu radnog naloga
  const [editingOrder, setEditingOrder] = useState<WorkOrder | null>(null);
  const [editFormData, setEditFormData] = useState({
    orderDate: '',
    orderType: 'RAD_NJIVA',
    priority: 'NORMALNO',
    workerId: '',
    machineId: '',
    attachmentId: '',
    parcelId: '',
    workTypeId: '',
    plannedAreaHa: '',
    shift: 'PRVA',
    instructions: '',
    status: 'PLANIRAN',
  });
  const [editModalLoading, setEditModalLoading] = useState(false);
  const [editModalError, setEditModalError] = useState('');

  // Modal za potvrdu otkazivanja radnog naloga
  const [orderToCancel, setOrderToCancel] = useState<WorkOrder | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState('');

  // Modal za ponovno aktiviranje radnog naloga
  const [orderToReactivate, setOrderToReactivate] = useState<WorkOrder | null>(null);
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [reactivateError, setReactivateError] = useState('');

  // Modal za trajno brisanje radnog naloga
  const [orderToDelete, setOrderToDelete] = useState<WorkOrder | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Učitavanje šifarnika
  useEffect(() => {
    const fetchMaster = async () => {
      try {
        const [wRes, mRes, pRes, wtRes] = await Promise.all([
          fetch(`${API}/master/workers`, { credentials: 'include' }),
          fetch(`${API}/master/machines`, { credentials: 'include' }),
          fetch(`${API}/master/parcels`, { credentials: 'include' }),
          fetch(`${API}/master/work-types`, { credentials: 'include' }),
        ]);

        if (wRes.ok) {
          const data = await wRes.json();
          setWorkers(data.workers || []);
        }
        if (mRes.ok) {
          const data = await mRes.json();
          setMachines(data.machines || []);
        }
        if (pRes.ok) {
          const data = await pRes.json();
          setParcels(data.parcels || []);
        }
        if (wtRes.ok) {
          const data = await wtRes.json();
          setWorkTypes(data.workTypes || []);
        }
      } catch (err) {
        console.error('Greška pri učitavanju šifarnika:', err);
      }
    };

    fetchMaster();
  }, []);

  // Učitavanje naloga sa paginacijom
  const fetchOrders = async (targetPage = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(targetPage));
      params.set('limit', '25');

      if (datePreset === 'DANAS') {
        params.set('date', new Date().toISOString().split('T')[0]);
      } else if (datePreset === 'SUTRA') {
        params.set('date', tomorrowStr);
      } else if (datePreset === 'CUSTOM' && customDate) {
        params.set('date', customDate);
      }

      if (statusFilter) {
        params.set('status', statusFilter);
      } else if (!isManager) {
        params.set('status', 'AKTIVNI');
      }
      if (typeFilter) params.set('type', typeFilter);

      const res = await fetch(`${API}/work-orders?${params.toString()}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.workOrders || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
        if (data.stats) {
          setStats(data.stats);
        }
      }
    } catch (err) {
      console.error('Greška pri dohvatanju radnih naloga:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders(page);
  }, [page, datePreset, customDate, statusFilter, typeFilter]);

  useEffect(() => {
    const handleSwMessage = (event: MessageEvent) => {
      if (
        event.data?.type === 'WORK_ORDER_PUSH_RECEIVED' ||
        event.data?.type === 'WORK_ORDER_PUSH_CLICKED'
      ) {
        fetchOrders(page);
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
    };
  }, [page, datePreset, customDate, statusFilter, typeFilter]);

  // Kreiranje naloga
  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');
    setModalLoading(true);

    try {
      const payload: any = {
        ...formData,
        plannedAreaHa: formData.plannedAreaHa ? parseFloat(formData.plannedAreaHa) : null,
        machineId: formData.machineId || null,
        attachmentId: formData.attachmentId || null,
        parcelId: formData.parcelId || null,
        workTypeId: formData.workTypeId || null,
      };

      const res = await fetch(`${API}/work-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Greška pri kreiranju radnog naloga.');
      }

      setIsModalOpen(false);
      // Reset forme
      setFormData({
        orderDate: tomorrowStr,
        orderType: 'RAD_NJIVA',
        priority: 'NORMALNO',
        workerId: '',
        machineId: '',
        attachmentId: '',
        parcelId: '',
        workTypeId: '',
        plannedAreaHa: '',
        shift: 'PRVA',
        instructions: '',
      });

      setPage(1);
      fetchOrders(1);
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  };

  // Otvaranje modala za prihvatanje naloga
  const handleOpenAcceptModal = (order: WorkOrder) => {
    setSelectedOrderToAccept(order);
    setAcceptError('');
    const hasTank =
      order.machine?.tankCapacityLiters !== undefined &&
      order.machine.tankCapacityLiters !== null &&
      order.machine.tankCapacityLiters > 0;
    const cap = hasTank ? (order.machine?.tankCapacityLiters as number) : 0;
    const curFuel =
      hasTank &&
        order.machine?.currentFuelLiters !== undefined &&
        order.machine.currentFuelLiters !== null &&
        order.machine.currentFuelLiters > 0
        ? order.machine.currentFuelLiters
        : cap;
    setAcceptFuelLiters(curFuel);
    setAcceptHours(order.machine?.currentHours || 0);
    setAcceptNotes('');
  };

  // Potvrda prihvatanja naloga i zaduživanja mašine
  const handleConfirmAcceptOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderToAccept) return;
    setAcceptError('');

    const maxTank = selectedOrderToAccept.machine?.tankCapacityLiters;
    const fuelNum = parseFloat(String(acceptFuelLiters));
    if (maxTank && fuelNum > maxTank) {
      setAcceptError(`Količina goriva (${fuelNum} L) ne može biti veća od kapaciteta rezervoara mašine (${maxTank} L).`);
      return;
    }

    setAcceptLoading(true);

    try {
      const res = await fetch(`${API}/work-orders/${selectedOrderToAccept.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startFuelLiters: parseFloat(String(acceptFuelLiters)) || 0,
          startHours: acceptHours !== '' ? parseFloat(String(acceptHours)) : null,
          notes: acceptNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri prihvatanju radnog naloga.');
      }

      setSelectedOrderToAccept(null);
      fetchOrders(page);
    } catch (err: any) {
      setAcceptError(err.message);
    } finally {
      setAcceptLoading(false);
    }
  };

  // Potvrda otkazivanja radnog naloga iz modala
  const handleConfirmCancel = async () => {
    if (!orderToCancel) return;
    setCancelLoading(true);
    setCancelError('');
    try {
      const res = await fetch(`${API}/work-orders/${orderToCancel.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'OTKAZAN' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri otkazivanju radnog naloga.');
      }
      setOrderToCancel(null);
      fetchOrders(page);
    } catch (err: any) {
      setCancelError(err.message || 'Greška pri otkazivanju radnog naloga.');
    } finally {
      setCancelLoading(false);
    }
  };

  // Potvrda ponovnog aktiviranja radnog naloga iz modala
  const handleConfirmReactivate = async () => {
    if (!orderToReactivate) return;
    setReactivateLoading(true);
    setReactivateError('');
    try {
      // Ako nalog ima definisanog radnika, prebacujemo ga u DODELJEN, inače PLANIRAN
      const targetStatus = orderToReactivate.workerId ? 'DODELJEN' : 'PLANIRAN';
      const res = await fetch(`${API}/work-orders/${orderToReactivate.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: targetStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri ponovnom aktiviranju radnog naloga.');
      }
      setOrderToReactivate(null);
      fetchOrders(page);
    } catch (err: any) {
      setReactivateError(err.message || 'Greška pri ponovnom aktiviranju radnog naloga.');
    } finally {
      setReactivateLoading(false);
    }
  };

  // Potvrda trajnog brisanja radnog naloga iz modala
  const handleConfirmDelete = async () => {
    if (!orderToDelete) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      const res = await fetch(`${API}/work-orders/${orderToDelete.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri brisanju radnog naloga.');
      }
      setOrderToDelete(null);
      if (orders.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        fetchOrders(page);
      }
    } catch (err: any) {
      setDeleteError(err.message || 'Greška pri brisanju radnog naloga.');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Filtriranje radnika na osnovu tipa naloga:
  // - RAD_NJIVA: samo operateri / traktoristi (isključeni mehaničari i rukovodioci)
  // - REMONT_SERVIS: samo mehaničari
  // - OSTALO: svi radnici
  const getFilteredWorkers = (type: string) => {
    if (type === 'REMONT_SERVIS') {
      return workers.filter(
        (w) =>
          w.user?.role === 'MEHANICAR' ||
          w.name.toLowerCase().includes('mehaničar') ||
          w.name.toLowerCase().includes('mehanicar')
      );
    }
    if (type === 'RAD_NJIVA') {
      return workers.filter((w) => {
        const role = w.user?.role;
        const isMechanic =
          role === 'MEHANICAR' ||
          w.name.toLowerCase().includes('mehaničar') ||
          w.name.toLowerCase().includes('mehanicar');
        const isManagement = role === 'DIREKTOR' || role === 'RUKOVODILAC';
        return !isMechanic && !isManagement;
      });
    }
    return workers;
  };

  // Za direktore i rukovodioce uvek su otključani svi radni nalozi za izmenu (i završeni i prethodni datumi)
  const canEditOrder = (_order?: WorkOrder) => {
    return isManager;
  };

  const handleOpenEditModal = (order: WorkOrder) => {
    setEditingOrder(order);
    setEditModalError('');
    setEditFormData({
      orderDate: order.orderDate ? new Date(order.orderDate).toISOString().split('T')[0] : '',
      orderType: order.orderType,
      priority: order.priority || 'NORMALNO',
      workerId: order.workerId,
      machineId: order.machineId || '',
      attachmentId: order.attachmentId || '',
      parcelId: order.parcelId || '',
      workTypeId: order.workTypeId || '',
      plannedAreaHa: order.plannedAreaHa ? String(order.plannedAreaHa) : '',
      shift: order.shift || 'PRVA',
      instructions: order.instructions || '',
      status: order.status,
    });
  };

  const handleUpdateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    setEditModalError('');
    setEditModalLoading(true);

    try {
      const payload: any = {
        ...editFormData,
        plannedAreaHa: editFormData.plannedAreaHa ? parseFloat(editFormData.plannedAreaHa) : null,
        machineId: editFormData.machineId || null,
        attachmentId: editFormData.attachmentId || null,
        parcelId: editFormData.parcelId || null,
        workTypeId: editFormData.workTypeId || null,
      };

      const res = await fetch(`${API}/work-orders/${editingOrder.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Greška pri izmeni radnog naloga.');
      }

      setEditingOrder(null);
      fetchOrders(page);
    } catch (err: any) {
      setEditModalError(err.message);
    } finally {
      setEditModalLoading(false);
    }
  };

  // Statistika (koristi precizne brojeve sa servera za izabrani opseg)
  const totalOrders = stats.totalOrders || orders.length;
  const pendingOrders = stats.pendingOrders !== undefined
    ? stats.pendingOrders
    : orders.filter((o) => ['PLANIRAN', 'DODELJEN'].includes(o.status)).length;
  const inProgressOrders = stats.inProgressOrders !== undefined
    ? stats.inProgressOrders
    : orders.filter((o) => o.status === 'U_TOKU').length;
  const completedOrders = stats.completedOrders !== undefined
    ? stats.completedOrders
    : orders.filter((o) => o.status === 'ZAVRSEN').length;

  const renderPagination = () => {
    if (pagination.total === 0) return null;

    const current = pagination.page;
    const totalP = pagination.totalPages;
    const startItem = (current - 1) * pagination.limit + 1;
    const endItem = Math.min(current * pagination.limit, pagination.total);

    const getPageNumbers = () => {
      const pages: (number | string)[] = [];
      if (totalP <= 7) {
        for (let i = 1; i <= totalP; i++) pages.push(i);
      } else {
        pages.push(1);
        if (current > 3) pages.push('ellipsis-start');
        const start = Math.max(2, current - 1);
        const end = Math.min(totalP - 1, current + 1);
        for (let i = start; i <= end; i++) {
          if (!pages.includes(i)) pages.push(i);
        }
        if (current < totalP - 2) pages.push('ellipsis-end');
        if (!pages.includes(totalP)) pages.push(totalP);
      }
      return pages;
    };

    return (
      <div className={styles.paginationBar}>
        <div className={styles.paginationInfo}>
          Prikazano <strong>{startItem} – {endItem}</strong> od ukupno <strong>{pagination.total}</strong> naloga (25 po stranici)
        </div>

        {totalP > 1 && (
          <div className={styles.paginationButtons}>
            <button
              type="button"
              className={styles.paginationBtn}
              onClick={() => setPage(1)}
              disabled={current === 1 || loading}
              title="Prva stranica"
            >
              <ChevronsLeft size={16} />
              <span className={styles.paginationBtnText}>Prva</span>
            </button>
            <button
              type="button"
              className={styles.paginationBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={current === 1 || loading}
              title="Prethodna stranica"
            >
              <ChevronLeft size={16} />
              <span className={styles.paginationBtnText}>Prethodna</span>
            </button>

            <div className={styles.pageNumbers}>
              {getPageNumbers().map((p, idx) => {
                if (typeof p === 'string') {
                  return (
                    <span key={`ellipsis-${idx}`} className={styles.paginationEllipsis}>
                      …
                    </span>
                  );
                }
                const isActive = p === current;
                return (
                  <button
                    key={p}
                    type="button"
                    className={`${styles.paginationPageBtn} ${isActive ? styles.paginationPageBtnActive : ''}`}
                    onClick={() => setPage(p)}
                    disabled={loading}
                  >
                    {p}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className={styles.paginationBtn}
              onClick={() => setPage((p) => Math.min(totalP, p + 1))}
              disabled={current === totalP || loading}
              title="Sledeća stranica"
            >
              <span className={styles.paginationBtnText}>Sledeća</span>
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              className={styles.paginationBtn}
              onClick={() => setPage(totalP)}
              disabled={current === totalP || loading}
              title="Poslednja stranica"
            >
              <span className={styles.paginationBtnText}>Poslednja</span>
              <ChevronsRight size={16} />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <AppLayout pageTitle="Radni Nalozi & Dispečing">
      <div className={styles.container}>
        {/* Header Bar */}
        <div className={styles.headerBar}>
          <div className={styles.titleSection}>
            <h2>
              <span className={styles.titleIconBadge}>
                <ClipboardList size={22} />
              </span>
              Dnevni Radni Nalozi
            </h2>
            <p>
              {isManager
                ? 'Izdavanje naloga traktoristima za rad na njivi i mehaničarima za remont mašina.'
                : 'Pregled zadataka i radnih naloga koji su vam dodeljeni za rad.'}
            </p>
          </div>

          {isManager && (
            <button className={styles.newOrderBtn} onClick={() => setIsModalOpen(true)}>
              <Plus size={18} />
              <span>Izdaj novi nalog</span>
            </button>
          )}
        </div>

        {/* KPI Grid */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiIconTotal}>
              <ClipboardList size={22} />
            </div>
            <div className={styles.kpiInfo}>
              <span className={styles.kpiLabel}>Ukupno naloga</span>
              <span className={styles.kpiValue}>{totalOrders}</span>
            </div>
          </div>

          <div className={styles.kpiCard}>
            <div className={styles.kpiIconPending}>
              <Clock size={22} />
            </div>
            <div className={styles.kpiInfo}>
              <span className={styles.kpiLabel}>Na čekanju</span>
              <span className={styles.kpiValuePending}>{pendingOrders}</span>
            </div>
          </div>

          <div className={styles.kpiCard}>
            <div className={styles.kpiIconInProgress}>
              <Play size={22} />
            </div>
            <div className={styles.kpiInfo}>
              <span className={styles.kpiLabel}>U toku</span>
              <span className={styles.kpiValueInProgress}>{inProgressOrders}</span>
            </div>
          </div>

          {isManager && (
            <div className={styles.kpiCard}>
              <div className={styles.kpiIconCompleted}>
                <CheckCircle2 size={22} />
              </div>
              <div className={styles.kpiInfo}>
                <span className={styles.kpiLabel}>Završeno</span>
                <span className={styles.kpiValueCompleted}>{completedOrders}</span>
              </div>
            </div>
          )}
        </div>

        {/* Filter Bar */}
        <div className={styles.filterCard}>
          <div className={styles.dateFilterButtons}>
            <button
              className={`${styles.dateBtn} ${datePreset === 'DANAS' ? styles.dateBtnActive : ''}`}
              onClick={() => {
                setDatePreset('DANAS');
                setPage(1);
              }}
            >
              Danas
            </button>
            <button
              className={`${styles.dateBtn} ${datePreset === 'SUTRA' ? styles.dateBtnActive : ''}`}
              onClick={() => {
                setDatePreset('SUTRA');
                setPage(1);
              }}
            >
              Sutra (Planirano)
            </button>
            <button
              className={`${styles.dateBtn} ${datePreset === 'SVE' ? styles.dateBtnActive : ''}`}
              onClick={() => {
                setDatePreset('SVE');
                setPage(1);
              }}
            >
              Svi datumi
            </button>
          </div>

          <div className={styles.filterInputs}>
            <div className={styles.inputWrapper}>
              <Calendar size={15} className={styles.inputIcon} />
              <input
                type="date"
                className={styles.dateInput}
                value={customDate}
                onChange={(e) => {
                  setCustomDate(e.target.value);
                  setDatePreset('CUSTOM');
                  setPage(1);
                }}
                title="Izaberi proizvoljan datum"
              />
            </div>

            <div className={styles.inputWrapper}>
              <Filter size={15} className={styles.inputIcon} />
              <select
                className={styles.selectInput}
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Svi tipovi posla</option>
                <option value="RAD_NJIVA">Rad na njivi</option>
                <option value="REMONT_SERVIS">Remont & Servis</option>
                <option value="OSTALO">Ostalo / Magacin</option>
              </select>
            </div>

            <div className={styles.inputWrapper}>
              <Layers size={15} className={styles.inputIcon} />
              <select
                className={styles.selectInput}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                {isManager ? (
                  <>
                    <option value="">Svi statusi</option>
                    <option value="DODELJEN">Dodeljen (Na čekanju)</option>
                    <option value="U_TOKU">U toku</option>
                    <option value="ZAVRSEN">Završen</option>
                    <option value="OTKAZAN">Otkazan</option>
                  </>
                ) : (
                  <>
                    <option value="">Aktivni nalozi (Dodeljeni & U toku)</option>
                    <option value="DODELJEN">Samo Dodeljen (Na čekanju)</option>
                    <option value="U_TOKU">Samo U toku</option>
                    <option value="ZAVRSEN">Završeni nalozi</option>
                    <option value="SVE">Svi nalozi (i završeni)</option>
                  </>
                )}
              </select>
            </div>
          </div>
        </div>

        {/* Orders Grid */}
        {loading ? (
          <div className={styles.emptyState}>
            <Loader2 size={32} className={styles.spinnerIcon} />
            <p>Učitavam radne naloge...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyStateIcon}>
              <ClipboardList size={38} />
            </div>
            <strong>Nema izdatih radnih naloga</strong>
            <p>Za izabrani period i filtere trenutno nema evidentiranih radnih naloga.</p>
            {isManager && (
              <button className={styles.newOrderBtn} onClick={() => setIsModalOpen(true)}>
                <Plus size={18} /> Izdaj novi nalog
              </button>
            )}
          </div>
        ) : (
          <>
            <div className={styles.ordersGrid}>
              {orders.map((order) => {
                const isRemont = order.orderType === 'REMONT_SERVIS';

                return (
                  <div key={order.id} className={styles.orderCard}>
                    {/* Card Header */}
                    <div className={styles.cardHeader}>
                      <div className={styles.headerLeft}>
                        <span className={styles.orderNumberBadge}>{order.orderNumber}</span>
                        <div className={styles.orderDateRow}>
                          <Calendar size={13} className={styles.dateIcon} />
                          <span>
                            {new Date(order.orderDate).toLocaleDateString('sr-RS', {
                              weekday: 'short',
                              day: 'numeric',
                              month: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>

                      <div className={styles.headerBadges}>
                        <div className={styles.statusAndPriority}>
                          {order.priority === 'KRITICNO' && (
                            <span className={styles.priorityBadgeKriticno}>⚡ Kritično</span>
                          )}
                          {order.priority === 'HITNO' && (
                            <span className={styles.priorityBadgeHitno}>⚠️ Hitno</span>
                          )}
                          <span className={`${styles.statusBadge} ${styles[`status${order.status}`]}`}>
                            <span className={styles.statusDot} />
                            {order.status === 'DODELJEN'
                              ? 'Dodeljen'
                              : order.status === 'U_TOKU'
                                ? 'U toku'
                                : order.status === 'ZAVRSEN'
                                  ? 'Završen'
                                  : order.status === 'OTKAZAN'
                                    ? 'Otkazan'
                                    : 'Planiran'}
                          </span>
                        </div>
                        <span className={isRemont ? styles.typeBadgeRemont : styles.typeBadgeNjiva}>
                          {isRemont ? (
                            <>
                              <Wrench size={12} />
                              <span>Remont / Servis</span>
                            </>
                          ) : (
                            <>
                              <Tractor size={12} />
                              <span>Rad na njivi</span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className={styles.orderBody}>
                      <div className={styles.metaRowsList}>
                        <div className={styles.orderRow}>
                          <div className={styles.rowIconWrapper}>
                            <User size={15} />
                          </div>
                          <div className={styles.rowContent}>
                            <span className={styles.rowLabel}>Radnik:</span>
                            <strong className={styles.rowValue}>{order.worker?.name}</strong>
                          </div>
                        </div>

                        {order.machine && (
                          <div className={styles.orderRow}>
                            <div className={styles.rowIconWrapper}>
                              <Tractor size={15} />
                            </div>
                            <div className={styles.rowContent}>
                              <span className={styles.rowLabel}>Mašina:</span>
                              <span className={styles.rowValue}>
                                <strong>{order.machine?.name}</strong>
                                {order.attachment && (
                                  <span className={styles.attachmentText}> + {order.attachment.name}</span>
                                )}
                              </span>
                            </div>
                          </div>
                        )}

                        {order.parcel && (
                          <div className={styles.orderRow}>
                            <div className={styles.rowIconWrapper}>
                              <MapPin size={15} />
                            </div>
                            <div className={styles.rowContent}>
                              <span className={styles.rowLabel}>Parcela:</span>
                              <strong className={styles.rowValue}>{order.parcel?.name}</strong>
                            </div>
                          </div>
                        )}

                        {order.workType && (
                          <div className={styles.orderRow}>
                            <div className={styles.rowIconWrapper}>
                              <Wrench size={15} />
                            </div>
                            <div className={styles.rowContent}>
                              <span className={styles.rowLabel}>Posao:</span>
                              <span className={styles.rowValue}>
                                <strong>{order.workType?.name}</strong>
                                {order.plannedAreaHa && (
                                  <span className={styles.planBadge}>{order.plannedAreaHa} ha</span>
                                )}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {order.machineAssignments &&
                        order.machineAssignments.length > 0 &&
                        order.machineAssignments[0].startFuelLiters !== undefined &&
                        order.machineAssignments[0].startFuelLiters !== null && (
                          <div className={styles.fuelNotice}>
                            <Fuel size={14} className={styles.fuelIcon} />
                            <span>
                              Zaduženo gorivo: <strong>{order.machineAssignments[0].startFuelLiters} L</strong>
                            </span>
                          </div>
                        )}

                      {order.instructions && (
                        <div className={styles.instructionsBox}>
                          <span className={styles.instructionsQuote}>“</span>
                          <span>{order.instructions}</span>
                        </div>
                      )}
                    </div>

                    {/* Card Footer / Akcije */}
                    <div className={styles.orderCardFooter}>
                      {/* Primarna radna akcija */}
                      <div className={styles.primaryActionWrapper}>
                        {!isRemont &&
                          (order.status === 'PLANIRAN' || order.status === 'DODELJEN') && (
                            <button
                              type="button"
                              className={styles.acceptOrderBtn}
                              onClick={() => handleOpenAcceptModal(order)}
                            >
                              <KeyRound size={16} />
                              <span>Prihvati nalog i zaduži</span>
                            </button>
                          )}

                        {!isRemont && order.status === 'U_TOKU' && (
                          <Link
                            to={`/radovi/novi?orderId=${order.id}&parcelId=${order.parcelId || ''}&machineId=${order.machineId || ''
                              }&attachmentId=${order.attachmentId || ''}&workTypeId=${order.workTypeId || ''
                              }&workerId=${order.workerId}`}
                            className={styles.startWorkBtn}
                          >
                            <Play size={16} />
                            <span>Prijavi rad i razduži</span>
                          </Link>
                        )}

                        {isRemont && order.status !== 'ZAVRSEN' && order.status !== 'OTKAZAN' && (
                          <Link
                            to={`/masine-kvarovi?orderId=${order.id}&machineId=${order.machineId || ''}`}
                            className={styles.workshopBtn}
                          >
                            <Wrench size={16} />
                            <span>Otvori u radionici</span>
                          </Link>
                        )}
                      </div>

                      {/* Menadžerske akcije */}
                      {isManager && (
                        <div className={styles.managerActionsWrapper}>
                          {canEditOrder(order) && (
                            <button
                              type="button"
                              className={styles.editBtn}
                              onClick={() => handleOpenEditModal(order)}
                              title="Izmeni radni nalog"
                            >
                              <Pencil size={14} />
                              <span>Izmeni</span>
                            </button>
                          )}

                          {order.status !== 'ZAVRSEN' && order.status !== 'OTKAZAN' && (
                            <button
                              type="button"
                              className={styles.cancelBtn}
                              onClick={() => {
                                setCancelError('');
                                setOrderToCancel(order);
                              }}
                              title="Otkaži nalog"
                            >
                              <X size={14} />
                              <span>Otkaži</span>
                            </button>
                          )}

                          {order.status === 'OTKAZAN' && (
                            <button
                              type="button"
                              className={styles.reactivateBtn}
                              onClick={() => {
                                setReactivateError('');
                                setOrderToReactivate(order);
                              }}
                              title="Ponovo aktiviraj nalog"
                            >
                              <RotateCcw size={14} />
                              <span>Aktiviraj</span>
                            </button>
                          )}

                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={() => {
                              setDeleteError('');
                              setOrderToDelete(order);
                            }}
                            title="Trajno obriši nalog"
                          >
                            <Trash2 size={14} />
                            <span>Obriši</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination Controls */}
            {renderPagination()}
          </>
        )}

        {/* Modal za izdavanje novog naloga */}
        {isModalOpen && (
          <div className={styles.modalBackdrop} onClick={() => setIsModalOpen(false)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Izdaj Novi Radni Nalog</h3>
                <button className={styles.modalCloseBtn} onClick={() => setIsModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>

              {modalError && (
                <div style={{ padding: '0.75rem 1.5rem', background: '#fee2e2', color: '#b91c1c' }}>
                  {modalError}
                </div>
              )}

              <form onSubmit={handleCreateOrder} className={styles.modalForm}>
                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label>Tip naloga *</label>
                    <select
                      className={styles.modalSelect}
                      value={formData.orderType}
                      onChange={(e) => {
                        const newType = e.target.value;
                        const filtered = getFilteredWorkers(newType);
                        const isCurrentValid = filtered.some((w) => w.id === formData.workerId);
                        setFormData({
                          ...formData,
                          orderType: newType,
                          workerId: isCurrentValid ? formData.workerId : '',
                        });
                      }}
                    >
                      <option value="RAD_NJIVA">Rad na njivi</option>
                      <option value="REMONT_SERVIS">Remont & Servis mašine</option>
                      <option value="OSTALO">Ostalo</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Prioritet *</label>
                    <select
                      className={styles.modalSelect}
                      value={formData.priority}
                      onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    >
                      <option value="NORMALNO">Normalno</option>
                      <option value="HITNO">Hitno</option>
                      <option value="KRITICNO">Kritično</option>
                    </select>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label>Datum za kada se planira *</label>
                    <input
                      type="date"
                      className={styles.modalInput}
                      value={formData.orderDate}
                      onChange={(e) => setFormData({ ...formData, orderDate: e.target.value })}
                      required
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Radna smena</label>
                    <select
                      className={styles.modalSelect}
                      value={formData.shift}
                      onChange={(e) => setFormData({ ...formData, shift: e.target.value as any })}
                    >
                      <option value="PRVA">1. Smena (Jutarnja)</option>
                      <option value="DRUGA">2. Smena (Popodnevna)</option>
                      <option value="TRECA">3. Smena (Noćna)</option>
                    </select>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.formGroupFull}>
                    <label>
                      {formData.orderType === 'REMONT_SERVIS'
                        ? 'Dodeljeni mehaničar / serviser *'
                        : formData.orderType === 'RAD_NJIVA'
                          ? 'Dodeljeni operater / traktorista *'
                          : 'Radnik kome se nalog izdaje *'}
                    </label>
                    <select
                      className={styles.modalSelect}
                      value={formData.workerId}
                      onChange={(e) => setFormData({ ...formData, workerId: e.target.value })}
                      required
                    >
                      <option value="">
                        {formData.orderType === 'REMONT_SERVIS'
                          ? 'Izaberi mehaničara iz baze...'
                          : formData.orderType === 'RAD_NJIVA'
                            ? 'Izaberi operatera iz baze...'
                            : 'Izaberi radnika iz baze...'}
                      </option>
                      {getFilteredWorkers(formData.orderType).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} {w.user?.role ? `(${w.user.role})` : w.type === 'SEZONAC' ? '(Sezonac)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label>Glavna mašina / Traktor</label>
                    <select
                      className={styles.modalSelect}
                      value={formData.machineId}
                      onChange={(e) => setFormData({ ...formData, machineId: e.target.value })}
                    >
                      <option value="">Izaberi mašinu...</option>
                      {machines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  {formData.orderType === 'RAD_NJIVA' && (
                    <div className={styles.formGroup}>
                      <label>Priključak (opciono)</label>
                      <select
                        className={styles.modalSelect}
                        value={formData.attachmentId}
                        onChange={(e) => setFormData({ ...formData, attachmentId: e.target.value })}
                      >
                        <option value="">Bez priključka / Samohodna</option>
                        {machines
                          .filter((m) => m.type === 'PRIKLJUCAK')
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>

                {formData.orderType === 'RAD_NJIVA' && (
                  <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <label style={{ marginBottom: 0 }}>Parcela / Njiva</label>
                        {isManager && (
                          <ParcelQuickActions
                            selectedParcel={parcels.find((p) => p.id === formData.parcelId) || null}
                            onAddClick={() => {
                              setParcelQuickTarget('create-order');
                              setParcelToEdit(null);
                              setParcelQuickModalOpen(true);
                            }}
                            onEditClick={(parcel) => {
                              setParcelQuickTarget('create-order');
                              setParcelToEdit(parcel);
                              setParcelQuickModalOpen(true);
                            }}
                          />
                        )}
                      </div>
                      <select
                        className={styles.modalSelect}
                        value={formData.parcelId}
                        onChange={(e) => setFormData({ ...formData, parcelId: e.target.value })}
                      >
                        <option value="">Izaberi parcelu...</option>
                        {parcels.map((p) => (
                          <option key={p.id} value={p.id}>
                            [{p.code}] {p.name} ({p.areaHa} ha)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label>Radna operacija / Posao</label>
                      <select
                        className={styles.modalSelect}
                        value={formData.workTypeId}
                        onChange={(e) => setFormData({ ...formData, workTypeId: e.target.value })}
                      >
                        <option value="">Izaberi posao...</option>
                        {workTypes.map((wt) => (
                          <option key={wt.id} value={wt.id}>
                            {wt.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {formData.orderType === 'RAD_NJIVA' && (
                  <div className={styles.formGrid}>
                    <div className={styles.formGroupFull}>
                      <label>Planirani obim rada (hektara)</label>
                      <input
                        type="number"
                        step="0.1"
                        className={styles.modalInput}
                        placeholder="npr. 12.5"
                        value={formData.plannedAreaHa}
                        onChange={(e) => setFormData({ ...formData, plannedAreaHa: e.target.value })}
                      />
                    </div>
                  </div>
                )}

                <div className={styles.formGroupFull}>
                  <label>
                    {formData.orderType === 'REMONT_SERVIS'
                      ? 'Opis remonta i potrebnih delova/maziva'
                      : 'Uputstvo / Napomena za radnika'}
                  </label>
                  <textarea
                    className={styles.modalTextarea}
                    placeholder={
                      formData.orderType === 'REMONT_SERVIS'
                        ? 'npr. Zameniti ležaj na sečki, ispustiti staro ulje i sipati novo Total Dynatrans MPV ulje.'
                        : 'npr. Počni oranje od kanala, dubina 28-30 cm, obrati pažnju na vlagu zemljišta.'
                    }
                    value={formData.instructions}
                    onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                  />
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.cancelModalBtn}
                    onClick={() => setIsModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.saveBtn} disabled={modalLoading}>
                    {modalLoading ? 'Izdavanje naloga...' : 'Sačuvaj i izdaj nalog'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal za izmenu radnog naloga */}
        {editingOrder && (
          <div className={styles.modalBackdrop} onClick={() => setEditingOrder(null)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>Izmena Radnog Naloga {editingOrder.orderNumber}</h3>
                <button className={styles.modalCloseBtn} onClick={() => setEditingOrder(null)}>
                  <X size={20} />
                </button>
              </div>

              {editModalError && (
                <div style={{ padding: '0.75rem 1.5rem', background: '#fee2e2', color: '#b91c1c' }}>
                  {editModalError}
                </div>
              )}

              <form onSubmit={handleUpdateOrder} className={styles.modalForm}>
                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label>Status naloga *</label>
                    <select
                      className={styles.modalSelect}
                      value={editFormData.status}
                      onChange={(e) => setEditFormData({ ...editFormData, status: e.target.value as any })}
                    >
                      <option value="PLANIRAN">Planiran</option>
                      <option value="DODELJEN">Dodeljen</option>
                      <option value="U_TOKU">U toku</option>
                      <option value="ZAVRSEN">Završen</option>
                      <option value="OTKAZAN">Otkazan</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Prioritet *</label>
                    <select
                      className={styles.modalSelect}
                      value={editFormData.priority}
                      onChange={(e) => setEditFormData({ ...editFormData, priority: e.target.value })}
                    >
                      <option value="NORMALNO">Normalno</option>
                      <option value="HITNO">Hitno</option>
                      <option value="KRITICNO">Kritično</option>
                    </select>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label>Tip naloga *</label>
                    <select
                      className={styles.modalSelect}
                      value={editFormData.orderType}
                      onChange={(e) => {
                        const newType = e.target.value as any;
                        const filtered = getFilteredWorkers(newType);
                        const isCurrentValid = filtered.some((w) => w.id === editFormData.workerId);
                        setEditFormData({
                          ...editFormData,
                          orderType: newType,
                          workerId: isCurrentValid ? editFormData.workerId : '',
                        });
                      }}
                    >
                      <option value="RAD_NJIVA">Rad na njivi</option>
                      <option value="REMONT_SERVIS">Remont & Servis mašine</option>
                      <option value="OSTALO">Ostalo</option>
                    </select>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Datum za kada se planira *</label>
                    <input
                      type="date"
                      className={styles.modalInput}
                      value={editFormData.orderDate}
                      onChange={(e) => setEditFormData({ ...editFormData, orderDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.formGroupFull}>
                    <label>
                      {editFormData.orderType === 'REMONT_SERVIS'
                        ? 'Dodeljeni mehaničar / serviser *'
                        : editFormData.orderType === 'RAD_NJIVA'
                          ? 'Dodeljeni operater / traktorista *'
                          : 'Radnik kome se nalog izdaje *'}
                    </label>
                    <select
                      className={styles.modalSelect}
                      value={editFormData.workerId}
                      onChange={(e) => setEditFormData({ ...editFormData, workerId: e.target.value })}
                      required
                    >
                      <option value="">
                        {editFormData.orderType === 'REMONT_SERVIS'
                          ? 'Izaberi mehaničara iz baze...'
                          : editFormData.orderType === 'RAD_NJIVA'
                            ? 'Izaberi operatera iz baze...'
                            : 'Izaberi radnika iz baze...'}
                      </option>
                      {getFilteredWorkers(editFormData.orderType).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name} {w.user?.role ? `(${w.user.role})` : w.type === 'SEZONAC' ? '(Sezonac)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label>Glavna mašina / Traktor</label>
                    <select
                      className={styles.modalSelect}
                      value={editFormData.machineId}
                      onChange={(e) => setEditFormData({ ...editFormData, machineId: e.target.value })}
                    >
                      <option value="">Bez mašine</option>
                      {machines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  {editFormData.orderType === 'RAD_NJIVA' && (
                    <div className={styles.formGroup}>
                      <label>Priključak (opciono)</label>
                      <select
                        className={styles.modalSelect}
                        value={editFormData.attachmentId}
                        onChange={(e) => setEditFormData({ ...editFormData, attachmentId: e.target.value })}
                      >
                        <option value="">Bez priključka / Samohodna</option>
                        {machines
                          .filter((m) => m.type === 'PRIKLJUCAK' || m.id === editFormData.attachmentId)
                          .map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>

                {editFormData.orderType === 'RAD_NJIVA' && (
                  <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <label style={{ marginBottom: 0 }}>Parcela / Njiva</label>
                        {isManager && (
                          <ParcelQuickActions
                            selectedParcel={parcels.find((p) => p.id === editFormData.parcelId) || null}
                            onAddClick={() => {
                              setParcelQuickTarget('edit-order');
                              setParcelToEdit(null);
                              setParcelQuickModalOpen(true);
                            }}
                            onEditClick={(parcel) => {
                              setParcelQuickTarget('edit-order');
                              setParcelToEdit(parcel);
                              setParcelQuickModalOpen(true);
                            }}
                          />
                        )}
                      </div>
                      <select
                        className={styles.modalSelect}
                        value={editFormData.parcelId}
                        onChange={(e) => setEditFormData({ ...editFormData, parcelId: e.target.value })}
                      >
                        <option value="">Izaberi parcelu...</option>
                        {parcels.map((p) => (
                          <option key={p.id} value={p.id}>
                            [{p.code}] {p.name} ({p.areaHa} ha)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label>Radna operacija / Posao</label>
                      <select
                        className={styles.modalSelect}
                        value={editFormData.workTypeId}
                        onChange={(e) => setEditFormData({ ...editFormData, workTypeId: e.target.value })}
                      >
                        <option value="">Izaberi posao...</option>
                        {workTypes.map((wt) => (
                          <option key={wt.id} value={wt.id}>
                            {wt.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {editFormData.orderType === 'RAD_NJIVA' && (
                  <div className={styles.formGrid}>
                    <div className={styles.formGroup}>
                      <label>Planirani obim rada (hektara)</label>
                      <input
                        type="number"
                        step="0.1"
                        className={styles.modalInput}
                        placeholder="npr. 12.5"
                        value={editFormData.plannedAreaHa}
                        onChange={(e) => setEditFormData({ ...editFormData, plannedAreaHa: e.target.value })}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Radna smena</label>
                      <select
                        className={styles.modalSelect}
                        value={editFormData.shift}
                        onChange={(e) => setEditFormData({ ...editFormData, shift: e.target.value as any })}
                      >
                        <option value="PRVA">1. Smena (Jutarnja)</option>
                        <option value="DRUGA">2. Smena (Popodnevna)</option>
                        <option value="TRECA">3. Smena (Noćna)</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className={styles.formGroupFull}>
                  <label>
                    {editFormData.orderType === 'REMONT_SERVIS'
                      ? 'Opis remonta i potrebnih delova/maziva'
                      : 'Uputstvo / Napomena za radnika'}
                  </label>
                  <textarea
                    className={styles.modalTextarea}
                    placeholder={
                      editFormData.orderType === 'REMONT_SERVIS'
                        ? 'npr. Zameniti ležaj na sečki, ispustiti staro ulje i sipati novo Total Dynatrans MPV ulje.'
                        : 'npr. Počni oranje od kanala, dubina 28-30 cm, obrati pažnju na vlagu zemljišta.'
                    }
                    value={editFormData.instructions}
                    onChange={(e) => setEditFormData({ ...editFormData, instructions: e.target.value })}
                  />
                </div>

                <div className={styles.modalFooter} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => {
                      const toDelete = editingOrder;
                      setEditingOrder(null);
                      setDeleteError('');
                      setOrderToDelete(toDelete);
                    }}
                    title="Obriši ovaj radni nalog"
                  >
                    <Trash2 size={14} />
                    <span>Obriši nalog</span>
                  </button>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button
                      type="button"
                      className={styles.cancelModalBtn}
                      onClick={() => setEditingOrder(null)}
                    >
                      Odustani
                    </button>
                    <button type="submit" className={styles.saveBtn} disabled={editModalLoading}>
                      {editModalLoading ? 'Čuvanje izmena...' : 'Sačuvaj izmene'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal za prihvatanje naloga i zaduživanje mašine */}
        {selectedOrderToAccept && (
          <div className={styles.modalBackdrop} onClick={() => setSelectedOrderToAccept(null)}>
            <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  <KeyRound size={22} color="#0284c7" />
                  Prihvati Nalog & Zaduži Mašinu
                </h3>
                <button
                  className={styles.modalCloseBtn}
                  onClick={() => setSelectedOrderToAccept(null)}
                >
                  <X size={20} />
                </button>
              </div>

              {acceptError && (
                <div
                  style={{
                    padding: '0.75rem 1.25rem',
                    background: '#fee2e2',
                    color: '#b91c1c',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <AlertCircle size={18} />
                  <span>{acceptError}</span>
                </div>
              )}

              <form onSubmit={handleConfirmAcceptOrder} className={styles.modalForm}>
                {selectedOrderToAccept.machine && (
                  <div className={styles.machineSummaryCard}>
                    <div className={styles.machineSummaryTitle}>
                      <Tractor size={18} color="#16a34a" />
                      <span>{selectedOrderToAccept.machine.name}</span>
                    </div>
                    <div className={styles.machineSpecsRow}>
                      <span className={styles.machineSpecItem}>
                        Rezervoar:{' '}
                        <strong>
                          {selectedOrderToAccept.machine.tankCapacityLiters && selectedOrderToAccept.machine.tankCapacityLiters > 0
                            ? `${selectedOrderToAccept.machine.tankCapacityLiters} L`
                            : 'Bez rezervoara (Priključak)'}
                        </strong>
                      </span>
                      <span className={styles.machineSpecItem}>
                        Radni sati na satu:{' '}
                        <strong>{selectedOrderToAccept.machine.currentHours || 0} rh</strong>
                      </span>
                    </div>
                  </div>
                )}

                {Boolean(selectedOrderToAccept.machine?.tankCapacityLiters && selectedOrderToAccept.machine.tankCapacityLiters > 0) ? (
                  <div className={styles.formGroup}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                      <label style={{ margin: 0 }}>Početno stanje goriva u rezervoaru (litara) *</label>
                      <span style={{ color: '#0284c7', fontWeight: 700, fontSize: '0.85rem' }}>
                        Kapacitet: {selectedOrderToAccept.machine?.tankCapacityLiters} L
                      </span>
                    </div>
                    <div className={styles.fuelInputWrap}>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max={selectedOrderToAccept.machine?.tankCapacityLiters || 1000}
                        className={styles.modalInput}
                        placeholder={`npr. ${Math.min(180, selectedOrderToAccept.machine?.tankCapacityLiters || 200)}`}
                        value={acceptFuelLiters}
                        onChange={(e) => {
                          const val = e.target.value;
                          const maxCap = selectedOrderToAccept.machine?.tankCapacityLiters;
                          if (maxCap && val !== '' && Number(val) > maxCap) {
                            setAcceptFuelLiters(maxCap);
                            return;
                          }
                          setAcceptFuelLiters(val);
                        }}
                        style={
                          selectedOrderToAccept.machine?.tankCapacityLiters &&
                            Number(acceptFuelLiters) > selectedOrderToAccept.machine.tankCapacityLiters
                            ? { borderColor: '#ef4444' }
                            : undefined
                        }
                        required
                      />
                      <span className={styles.fuelUnitBadge}>Litara</span>
                    </div>
                    {selectedOrderToAccept.machine?.tankCapacityLiters &&
                      Number(acceptFuelLiters) > selectedOrderToAccept.machine.tankCapacityLiters && (
                        <div style={{ color: '#ef4444', fontSize: '0.82rem', marginTop: '0.3rem', fontWeight: 600 }}>
                          Količina goriva ne može biti veća od kapaciteta rezervoara ({selectedOrderToAccept.machine.tankCapacityLiters} L)!
                        </div>
                      )}
                  </div>
                ) : (
                  <div
                    style={{
                      background: 'rgba(2, 132, 199, 0.08)',
                      border: '1.5px dashed #38bdf8',
                      borderRadius: 10,
                      padding: '0.85rem 1rem',
                      fontSize: '0.86rem',
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.55rem',
                      margin: '0.25rem 0',
                    }}
                  >
                    <Info size={18} color="#0284c7" style={{ flexShrink: 0 }} />
                    <span>
                      Ova mašina nema sopstveni rezervoar goriva (priključno oruđe). Gorivo se ne zadužuje.
                    </span>
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label>Početni radni sati mašine (rh)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    className={styles.modalInput}
                    value={acceptHours}
                    onChange={(e) => setAcceptHours(e.target.value)}
                  />
                </div>

                <div className={styles.formGroup}>
                  <label>Napomena pri preuzimanju mašine (opciono)</label>
                  <textarea
                    className={styles.modalTextarea}
                    placeholder="npr. Provereni nivoi ulja i antifriza, traktor spreman za oranje."
                    value={acceptNotes}
                    onChange={(e) => setAcceptNotes(e.target.value)}
                  />
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.cancelModalBtn}
                    onClick={() => setSelectedOrderToAccept(null)}
                  >
                    Odustani
                  </button>
                  <button
                    type="submit"
                    className={styles.saveBtn}
                    style={{ backgroundColor: '#0284c7' }}
                    disabled={acceptLoading}
                  >
                    {acceptLoading ? (
                      <>
                        <Loader2 size={16} />
                        <span>Zaduživanje...</span>
                      </>
                    ) : (
                      <>
                        <KeyRound size={16} />
                        <span>Zaduži mašinu i prihvati nalog</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal za potvrdu otkazivanja naloga */}
        {orderToCancel && (
          <div className={styles.modalBackdrop} onClick={() => !cancelLoading && setOrderToCancel(null)}>
            <div
              className={styles.modalContent}
              style={{ maxWidth: '480px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <h3 style={{ color: '#b91c1c' }}>
                  <AlertTriangle size={22} color="#dc2626" />
                  <span>Otkazivanje Radnog Naloga</span>
                </h3>
                <button
                  type="button"
                  className={styles.modalCloseBtn}
                  onClick={() => !cancelLoading && setOrderToCancel(null)}
                  disabled={cancelLoading}
                >
                  <X size={20} />
                </button>
              </div>

              <div className={styles.confirmDialogBody}>
                <div className={styles.confirmWarningBox}>
                  <AlertCircle size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                      Da li stvarno želite da otkažete ovaj radni nalog?
                    </div>
                    <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                      Radni nalog će biti prebačen u status <strong>Otkazan</strong>.
                      Ukoliko se predomislite, nalog možete u svakom trenutku ponovo aktivirati.
                    </div>
                  </div>
                </div>

                {orderToCancel.status === 'U_TOKU' && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      background: '#fffbeb',
                      border: '1px solid #fef3c7',
                      borderLeft: '4px solid #f59e0b',
                      padding: '0.85rem 1rem',
                      borderRadius: '8px',
                      color: '#92400e',
                      fontSize: '0.84rem',
                      lineHeight: 1.45,
                    }}
                  >
                    <Info size={20} color="#d97706" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <strong style={{ display: 'block', marginBottom: '0.2rem', color: '#b45309' }}>
                        Napomena: Radnik je već prihvatio ovaj nalog
                      </strong>
                      Otkazivanjem se mašina automatski oslobađa, a radni sati ostaju nepromenjeni. Ako je radnik već radio na parceli, preporučuje se da radnik sam prijavi prekid rada kako bi se evidentirali urađeni sati i gorivo.
                    </div>
                  </div>
                )}

                {cancelError && (
                  <div style={{ padding: '0.75rem 1rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', fontSize: '0.85rem' }}>
                    {cancelError}
                  </div>
                )}

                <div className={styles.orderPreviewBox}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.4rem', fontWeight: 700 }}>
                    <span>Broj naloga:</span>
                    <span style={{ color: '#16a34a' }}>{orderToCancel.orderNumber}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Trenutni status:</span>
                    <span style={{ fontWeight: 600 }}>
                      {orderToCancel.status === 'U_TOKU'
                        ? 'U toku (Mašina zadužena)'
                        : orderToCancel.status === 'DODELJEN'
                          ? 'Dodeljen'
                          : orderToCancel.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Radnik:</span>
                    <span style={{ fontWeight: 600 }}>{orderToCancel.worker?.name || 'Nije dodeljen'}</span>
                  </div>
                  {orderToCancel.parcel && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Parcela:</span>
                      <span>{orderToCancel.parcel.name}</span>
                    </div>
                  )}
                  {orderToCancel.workType && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Operacija:</span>
                      <span>{orderToCancel.workType.name}</span>
                    </div>
                  )}
                  {orderToCancel.machine && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Mašina:</span>
                      <span>{orderToCancel.machine.name}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelModalBtn}
                  onClick={() => setOrderToCancel(null)}
                  disabled={cancelLoading}
                >
                  Odustani
                </button>
                <button
                  type="button"
                  className={styles.confirmCancelBtn}
                  onClick={handleConfirmCancel}
                  disabled={cancelLoading}
                >
                  {cancelLoading ? (
                    <>
                      <Loader2 size={16} className={styles.spinnerIcon} />
                      <span>Otkazivanje...</span>
                    </>
                  ) : (
                    <span>Da, otkaži nalog</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal za potvrdu ponovnog aktiviranja naloga */}
        {orderToReactivate && (
          <div className={styles.modalBackdrop} onClick={() => !reactivateLoading && setOrderToReactivate(null)}>
            <div
              className={styles.modalContent}
              style={{ maxWidth: '480px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <h3 style={{ color: '#15803d' }}>
                  <RotateCcw size={20} color="#16a34a" />
                  <span>Ponovno Aktiviranje Naloga</span>
                </h3>
                <button
                  type="button"
                  className={styles.modalCloseBtn}
                  onClick={() => !reactivateLoading && setOrderToReactivate(null)}
                  disabled={reactivateLoading}
                >
                  <X size={20} />
                </button>
              </div>

              <div className={styles.confirmDialogBody}>
                <div className={styles.confirmInfoBox}>
                  <RotateCcw size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                      Da li želite ponovo da aktivirate ovaj radni nalog?
                    </div>
                    <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                      Radni nalog <strong>{orderToReactivate.orderNumber}</strong> će biti vraćen u status <strong>Dodeljen</strong> i ponovo će se pojaviti radniku na listi zadataka za izvršenje.
                    </div>
                  </div>
                </div>

                {reactivateError && (
                  <div style={{ padding: '0.75rem 1rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', fontSize: '0.85rem' }}>
                    {reactivateError}
                  </div>
                )}

                <div className={styles.orderPreviewBox}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.4rem', fontWeight: 700 }}>
                    <span>Broj naloga:</span>
                    <span style={{ color: '#16a34a' }}>{orderToReactivate.orderNumber}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Radnik:</span>
                    <span style={{ fontWeight: 600 }}>{orderToReactivate.worker?.name || 'Nije dodeljen'}</span>
                  </div>
                  {orderToReactivate.parcel && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Parcela:</span>
                      <span>{orderToReactivate.parcel.name}</span>
                    </div>
                  )}
                  {orderToReactivate.workType && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Operacija:</span>
                      <span>{orderToReactivate.workType.name}</span>
                    </div>
                  )}
                  {orderToReactivate.machine && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Mašina:</span>
                      <span>{orderToReactivate.machine.name}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelModalBtn}
                  onClick={() => setOrderToReactivate(null)}
                  disabled={reactivateLoading}
                >
                  Odustani
                </button>
                <button
                  type="button"
                  className={styles.confirmReactivateBtn}
                  onClick={handleConfirmReactivate}
                  disabled={reactivateLoading}
                >
                  {reactivateLoading ? (
                    <>
                      <Loader2 size={16} className={styles.spinnerIcon} />
                      <span>Aktiviranje...</span>
                    </>
                  ) : (
                    <span>Ponovo aktiviraj nalog</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal za potvrdu trajnog brisanja naloga */}
        {orderToDelete && (
          <div className={styles.modalBackdrop} onClick={() => !deleteLoading && setOrderToDelete(null)}>
            <div
              className={styles.modalContent}
              style={{ maxWidth: '480px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <h3 style={{ color: '#b91c1c' }}>
                  <AlertTriangle size={22} color="#dc2626" />
                  <span>Trajno Brisanje Radnog Naloga</span>
                </h3>
                <button
                  type="button"
                  className={styles.modalCloseBtn}
                  onClick={() => !deleteLoading && setOrderToDelete(null)}
                  disabled={deleteLoading}
                >
                  <X size={20} />
                </button>
              </div>

              <div className={styles.confirmDialogBody}>
                <div className={styles.confirmWarningBox}>
                  <AlertCircle size={22} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                      Da li ste sigurni da želite trajno da obrišete ovaj radni nalog?
                    </div>
                    <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
                      Ova akcija je <strong>nepovratna</strong>. Radni nalog <strong>{orderToDelete.orderNumber}</strong> će biti trajno obrisan iz sistema.
                    </div>
                  </div>
                </div>

                {orderToDelete.status === 'ZAVRSEN' && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      background: 'rgba(2, 132, 199, 0.08)',
                      border: '1px solid #bae6fd',
                      borderLeft: '4px solid #0284c7',
                      padding: '0.85rem 1rem',
                      borderRadius: '8px',
                      color: '#0369a1',
                      fontSize: '0.84rem',
                      lineHeight: 1.45,
                    }}
                  >
                    <Info size={20} color="#0284c7" style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div>
                      <strong style={{ display: 'block', marginBottom: '0.2rem' }}>
                        Završen radni nalog
                      </strong>
                      Uklanjanjem radnog naloga sama evidencija o izvršenom radu na njivi ostaje sačuvana u istorijatu i izveštajima.
                    </div>
                  </div>
                )}

                {deleteError && (
                  <div style={{ padding: '0.75rem 1rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '6px', fontSize: '0.85rem' }}>
                    {deleteError}
                  </div>
                )}

                <div className={styles.orderPreviewBox}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color, #e2e8f0)', paddingBottom: '0.4rem', fontWeight: 700 }}>
                    <span>Broj naloga:</span>
                    <span style={{ color: '#16a34a' }}>{orderToDelete.orderNumber}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
                    <span style={{ fontWeight: 600 }}>{orderToDelete.status}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Radnik:</span>
                    <span style={{ fontWeight: 600 }}>{orderToDelete.worker?.name || 'Nije dodeljen'}</span>
                  </div>
                  {orderToDelete.orderDate && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Datum naloga:</span>
                      <span>{new Date(orderToDelete.orderDate).toLocaleDateString('sr-RS')}</span>
                    </div>
                  )}
                  {orderToDelete.parcel && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Parcela:</span>
                      <span>{orderToDelete.parcel.name}</span>
                    </div>
                  )}
                  {orderToDelete.machine && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Mašina:</span>
                      <span>{orderToDelete.machine.name}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.cancelModalBtn}
                  onClick={() => setOrderToDelete(null)}
                  disabled={deleteLoading}
                >
                  Odustani
                </button>
                <button
                  type="button"
                  className={styles.confirmCancelBtn}
                  onClick={handleConfirmDelete}
                  disabled={deleteLoading}
                >
                  {deleteLoading ? (
                    <>
                      <Loader2 size={16} className={styles.spinnerIcon} />
                      <span>Brisanje...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      <span>Da, trajno obriši</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Brzi modal za dodavanje / izmenu parcele */}
        <ParcelQuickModal
          isOpen={parcelQuickModalOpen}
          onClose={() => setParcelQuickModalOpen(false)}
          parcelToEdit={parcelToEdit}
          onSaved={(savedParcel, mode) => {
            setParcels((prev) => {
              if (mode === 'edit') {
                return prev.map((p) => (p.id === savedParcel.id ? savedParcel : p));
              }
              return [...prev, savedParcel].sort((a, b) => a.code.localeCompare(b.code));
            });
            if (parcelQuickTarget === 'create-order') {
              setFormData((prev) => ({ ...prev, parcelId: savedParcel.id }));
            } else {
              setEditFormData((prev) => ({ ...prev, parcelId: savedParcel.id }));
            }
            if (mode === 'edit') {
              fetchOrders(page);
            }
          }}
        />
      </div>
    </AppLayout>
  );
};

export default RadniNaloziDashboard;
