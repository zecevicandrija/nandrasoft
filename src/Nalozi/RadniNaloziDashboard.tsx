import { PackingFields, newPackingPlan, type PackingPlan, type PackingSummary } from '../Luk/PackingFields';
import { onionRequest } from '../Luk/onionRequest';
import OtherOrderCompletion from '../components/OtherOrderCompletion';
import MachineUsageModal from '../components/MachineUsageModal';
import MachineUsageAction from '../components/MachineUsageAction';
import { PhotoUpload } from '../components/PhotoUpload';
import WorkMaterialsEditor from '../components/WorkMaterialsEditor';
import { materialPayload, type WorkMaterial, type MaterialOperation } from '../lib/workMaterials';
import { ContractorSelect } from '../components/ContractorSelect';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { operationalQueryOptions, operationalKey } from '../lib/operationalQueries';
import QueryErrorNotice from '../components/QueryErrorNotice';
import { useDurableSubmission } from '../lib/useDurableSubmission';
import SubmissionRecovery from '../components/SubmissionRecovery';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ClipboardList,
  Plus,
  X,
  Clock,
  Play,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  CheckCircle2,
  Filter,
  Layers,
  Trash2,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { ParcelQuickModal, ParcelQuickActions, type ParcelItem } from '../components/ParcelQuickModal';
import OrderDetailsModal from './OrderDetailsModal';
import OrderCard from './OrderCard';
import OrderAcceptModal from './OrderAcceptModal';
import OrderConfirmModals from './OrderConfirmModals';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import { useSession } from '../lib/auth-client';
import styles from './RadniNaloziDashboard.module.css';

interface Worker {
  canReceivePackingOrder?: boolean;
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
  brandModel?: string | null;
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

interface WorkType extends MaterialOperation {
  id: string;
  name: string;
  category: string;
}

export interface WorkOrder {
  materials?: WorkMaterial[];
  id: string;
  orderNumber: string;
  orderDate: string;
  orderType: 'RAD_NJIVA' | 'REMONT_SERVIS' | 'PAKOVANJE' | 'OSTALO';
  packingPlan?: PackingPlan;
  plannedLotNumber?: string | null;
  packingSummary?: PackingSummary | null;
  status: 'PLANIRAN' | 'DODELJEN' | 'U_TOKU' | 'ZAVRSEN' | 'OTKAZAN';
  priority: string;
  workerId: string;
  worker: { id: string; name: string };
  machineId?: string;
  machine?: {
    id: string;
    updatedAt?: string;
    name: string;
    tankCapacityLiters?: number;
    currentFuelLiters?: number;
    currentHours?: number;
  };
  attachmentId?: string;
  attachment?: { id: string; name: string };
  contractorId?: string | null;
  contractor?: { id: string; name: string; code: string } | null;
  parcelId?: string;
  parcel?: { id: string; name: string; code: string };
  workTypeId?: string;
  workType?: { id: string; name: string };
  plannedAreaHa?: number;
  shift: 'PRVA' | 'DRUGA' | 'TRECA';
  instructions?: string;
  photoUrl?: string | null;
  fieldWork?: {
    id?: string;
    photoUrl?: string | null;
    areaDoneHa?: number | null;
    workHours?: number | null;
    status?: string | null;
  };
  maintenanceId?: string | null;
  maintenance?: {
    id: string;
    serviceType?: 'REDOVAN_SERVIS' | 'GENERALNI_REMONT' | 'KVAR_NJIVA' | string;
    priority?: string;
    status?: string;
  } | null;
  issuedBy?: { id: string; name: string; role: string };
  createdAt?: string;
  updatedAt?: string;
  machineAssignments?: Array<{
    id: string;
    status: string;
    startFuelLiters?: number | null;
    endFuelLiters?: number | null;
    voidedAt?: string | null;
    machine?: { name: string };
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

export const SERVICE_TYPE_LABELS: Record<string, string> = {
  REDOVAN_SERVIS: 'Redovan servis (zamena ulja/filtera)',
  GENERALNI_REMONT: 'Generalni remont mehanizacije',
  KVAR_NJIVA: 'Vanredni kvar sa terena/njive',
};

const SERVICE_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'REDOVAN_SERVIS', label: 'Redovan servis (zamena ulja/filtera)', badge: 'REDOVAN' },
  { value: 'GENERALNI_REMONT', label: 'Generalni remont mehanizacije', badge: 'REMONT' },
  { value: 'KVAR_NJIVA', label: 'Vanredni kvar sa terena/njive', badge: 'KVAR', badgeType: 'danger' },
];

const REMONT_PRIORITY_OPTIONS: CustomSelectOption[] = [
  { value: 'KRITICNA', label: 'Kritičan prioritet', badge: 'KRITIČNO', badgeType: 'danger', isAlert: true },
  { value: 'VISOKA', label: 'Visok prioritet', badge: 'VISOK', badgeType: 'warning' },
  { value: 'SREDNJA', label: 'Srednji prioritet', badge: 'SREDNJI', badgeType: 'default' },
  { value: 'NISKA', label: 'Nizak prioritet', badge: 'NIZAK', badgeType: 'default' },
];

const toRemontPriority = (priority?: string) => {
  if (priority === 'KRITICNO' || priority === 'KRITICNA') return 'KRITICNA';
  if (priority === 'HITNO' || priority === 'VISOKA') return 'VISOKA';
  if (priority === 'SREDNJA') return 'SREDNJA';
  if (priority === 'NISKA') return 'NISKA';
  return 'VISOKA';
};

const toStandardPriority = (priority?: string) => {
  if (priority === 'KRITICNA' || priority === 'KRITICNO') return 'KRITICNO';
  if (priority === 'VISOKA' || priority === 'HITNO') return 'HITNO';
  return 'NORMALNO';
};

const formatLocalYmd = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const getLocalTodayStr = () => formatLocalYmd(new Date());
const getLocalTomorrowStr = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return formatLocalYmd(d);
};

const RadniNaloziDashboard: React.FC = () => {
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const userRole = currentUser?.role || 'OPERATER';
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(userRole);


  // Paginacija & Statistika (25 naloga po stranici)
  const [page, setPage] = useState(1);
  // Filteri - podrazumevano prikazujemo 'SVE' tako da se odmah vide svi nalozi
  const [datePreset, setDatePreset] = useState<'DANAS' | 'SUTRA' | 'SVE' | 'CUSTOM'>('SVE');
  const [customDate, setCustomDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Modal za novi nalog stanje
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [editPhotoUploading, setEditPhotoUploading] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  // Modal za slike i detalje radnog naloga
  const [detailsOrder, setDetailsOrder] = useState<WorkOrder | null>(null);

  // Brzo dodavanje / izmena parcele
  const [parcelQuickModalOpen, setParcelQuickModalOpen] = useState(false);
  const [parcelToEdit, setParcelToEdit] = useState<ParcelItem | null>(null);
  const [parcelQuickTarget, setParcelQuickTarget] = useState<'create-order' | 'edit-order'>('create-order');

  // Modal za prihvatanje naloga i zaduživanje mašine stanje
  const [selectedOrderToAccept, setSelectedOrderToAccept] = useState<WorkOrder | null>(null);

  // Form podaci za novi nalog
  const [formData, setFormData] = useState(() => ({
    orderDate: getLocalTomorrowStr(),
    packingPlan: newPackingPlan(getLocalTomorrowStr()),
    orderType: 'RAD_NJIVA',
    priority: 'NORMALNO',
    serviceType: 'REDOVAN_SERVIS',
    workerId: '',
    machineId: '',
    attachmentId: '',
    materials: [] as WorkMaterial[],
    contractorId: '',
    parcelId: '',
    workTypeId: '',
    plannedAreaHa: '',
    shift: 'PRVA',
    instructions: '',
    photoUrl: null as string | null,
  }));

  const orderDraft = useDurableSubmission('create-work-order', currentUser?.id, formData,
    (draft) => { setFormData({ ...draft, packingPlan: draft.packingPlan ?? newPackingPlan(draft.orderDate), serviceType: draft.serviceType ?? 'REDOVAN_SERVIS', photoUrl: draft.photoUrl ?? null, materials: draft.materials ?? [] }); });

  // Modal za izmenu radnog naloga
  const [editingOrder, setEditingOrder] = useState<WorkOrder | null>(null);
  const [editFormData, setEditFormData] = useState({
    packingPlan: newPackingPlan(getLocalTomorrowStr()),
    orderDate: '',
    orderType: 'RAD_NJIVA',
    priority: 'NORMALNO',
    serviceType: 'REDOVAN_SERVIS',
    workerId: '',
    machineId: '',
    attachmentId: '',
    materials: [] as WorkMaterial[],
    contractorId: '',
    parcelId: '',
    workTypeId: '',
    plannedAreaHa: '',
    shift: 'PRVA',
    instructions: '',
    photoUrl: null as string | null,
    status: 'PLANIRAN',
  });
  const [editModalLoading, setEditModalLoading] = useState(false);
  const [editModalError, setEditModalError] = useState('');
  const [editHasConflict, setEditHasConflict] = useState(false);
  const [editConflictOrder, setEditConflictOrder] = useState<WorkOrder | null>(null);

  // Modali za potvrdu akcija nad nalogom
  const [orderToCancel, setOrderToCancel] = useState<WorkOrder | null>(null);
  const [orderToReactivate, setOrderToReactivate] = useState<WorkOrder | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<WorkOrder | null>(null);

  const userId = currentUser?.id as string | undefined;
  const queryClient = useQueryClient();
  const [usageId, setUsageId] = useState<string | null>(null);
  const [otherCompletionId, setOtherCompletionId] = useState<string | null>(null);

  // Šifarnici su potrebni isključivo menadžerima u modalima za kreiranje/izmenu naloga
  const needsMasterData = Boolean(userId) && isManager && (isModalOpen || Boolean(editingOrder));
  const workersQuery = useQuery({
    ...operationalQueryOptions<{ workers: Worker[] }>(userId, userRole, 'workers'),
    enabled: needsMasterData,
  });
  const packingLookup = useQuery({
    queryKey: ['onion-lookup'],
    enabled: needsMasterData && (formData.orderType === 'PAKOVANJE' || editFormData.orderType === 'PAKOVANJE'),
    queryFn: ({ signal }) => onionRequest('/lookup', signal),
  });
  const machinesQuery = useQuery({
    ...operationalQueryOptions<{ machines: Machine[] }>(userId, userRole, 'machines'),
    enabled: needsMasterData,
  });
  const parcelsQuery = useQuery({
    ...operationalQueryOptions<{ parcels: Parcel[] }>(userId, userRole, 'parcels'),
    enabled: needsMasterData,
  });
  const workTypesQuery = useQuery({
    ...operationalQueryOptions<{ workTypes: WorkType[] }>(userId, userRole, 'workTypes'),
    enabled: needsMasterData,
  });
  const prefetchMasterData = useCallback(() => {
    if (!userId || !isManager) return;
    for (const resource of ['workers', 'machines', 'parcels', 'workTypes'] as const) {
      void queryClient.prefetchQuery(operationalQueryOptions(userId, userRole, resource));
    }
  }, [queryClient, userId, userRole, isManager]);

  const workers = useMemo(() => workersQuery.data?.workers || [], [workersQuery.data?.workers]);
  const machines = useMemo(() => machinesQuery.data?.machines || [], [machinesQuery.data?.machines]);
  const parcels = useMemo(() => parcelsQuery.data?.parcels || [], [parcelsQuery.data?.parcels]);
  const workTypes = useMemo(() => workTypesQuery.data?.workTypes || [], [workTypesQuery.data?.workTypes]);
  const masterQueries = [workersQuery, machinesQuery, parcelsQuery, workTypesQuery];
  const masterFeedback = <>{masterQueries.map((query, index) => query.isError ? <QueryErrorNotice key={index}
    title={['Radnici nisu učitani.', 'Mašine nisu učitane.', 'Parcele nisu učitane.', 'Radne operacije nisu učitane.'][index]}
    error={query.error} pending={query.isFetching} onRetry={() => { void query.refetch(); }} /> : null)}
    {masterQueries.some(query => query.isPending) && <p role="status">Učitavanje šifarnika...</p>}</>;

  const filterDate = datePreset === 'DANAS'
    ? getLocalTodayStr()
    : datePreset === 'SUTRA'
      ? getLocalTomorrowStr()
      : datePreset === 'CUSTOM'
        ? customDate
        : undefined;

  const ordersQuery = useQuery(operationalQueryOptions<{ workOrders: WorkOrder[]; pagination: PaginationData; stats: StatsData }>(userId, userRole, 'orders', {
    page, limit: 25,
    date: filterDate,
    status: statusFilter || (!isManager ? 'AKTIVNI' : undefined), type: typeFilter,
  }));
  const orders = ordersQuery.data?.workOrders || [];
  const loading = ordersQuery.isPending;
  const pagination = ordersQuery.data?.pagination || { total: 0, page, limit: 25, totalPages: 1 };
  const stats = ordersQuery.data?.stats || { totalOrders: 0, pendingOrders: 0, inProgressOrders: 0, completedOrders: 0 };
  const refreshOrders = useCallback((targetPage = page) => {
    void queryClient.invalidateQueries({ queryKey: ['onion-orders'] });
    if (targetPage !== page) setPage(targetPage);
    void queryClient.invalidateQueries({ queryKey: operationalKey(userId, userRole, 'orders'), refetchType: targetPage === page ? 'active' : 'none' });
  }, [page, queryClient, userId, userRole]);
  useEffect(() => {
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'WORK_ORDER_PUSH_RECEIVED' || event.data?.type === 'WORK_ORDER_PUSH_CLICKED') {
        void queryClient.invalidateQueries({ queryKey: operationalKey(userId, userRole, 'orders') });
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
  }, [queryClient, userId, userRole]);

  // Kreiranje naloga
  const handleCreateOrder = async (e?: React.FormEvent, replay = false) => {
    e?.preventDefault();
    if (photoUploading) return;
    setModalError('');

    if (!replay) {
      if (!formData.workerId) {
        setModalError(
          formData.orderType === 'REMONT_SERVIS'
            ? 'Molimo izaberite mehaničara / servisera kome se nalog izdaje.'
            : 'Molimo izaberite radnika kome se nalog izdaje.'
        );
        return;
      }
      if (formData.orderType === 'RAD_NJIVA' && (!formData.machineId || !formData.parcelId)) {
        setModalError('Za njivski nalog izaberite glavnu mašinu i parcelu.');
        return;
      }
      if (formData.orderType === 'REMONT_SERVIS') {
        if (!formData.machineId) {
          setModalError('Molimo izaberite mašinu ili priključak za remont.');
          return;
        }
        if (!formData.serviceType) {
          setModalError('Molimo izaberite tip servisa.');
          return;
        }
        if (formData.instructions.trim().length < 3) {
          setModalError('Uputstvo i specifikacija posla za mehaničara su obavezni (najmanje 3 karaktera).');
          return;
        }
      }
    }

    setModalLoading(true);

    try {
      const payload: any = replay && orderDraft.pending ? orderDraft.pending.payload : {
        ...formData,
        orderDate: formData.orderType === 'PAKOVANJE' ? formData.packingPlan.packagingForm.date : formData.orderDate,
        packingPlan: formData.orderType === 'PAKOVANJE' ? formData.packingPlan : undefined,
        serviceType: formData.orderType === 'REMONT_SERVIS' ? formData.serviceType : undefined,
        plannedAreaHa: formData.orderType === 'RAD_NJIVA' && formData.plannedAreaHa ? parseFloat(formData.plannedAreaHa) : null,
        machineId: formData.orderType === 'PAKOVANJE' ? null : formData.machineId || null,
        attachmentId: formData.orderType === 'RAD_NJIVA' ? (formData.attachmentId || null) : null,
        materials: materialPayload(formData.orderType === 'RAD_NJIVA' ? formData.materials : []),
        contractorId: formData.orderType === 'RAD_NJIVA' ? formData.contractorId || null : null,
        parcelId: formData.orderType === 'RAD_NJIVA' ? (formData.parcelId || null) : null,
        workTypeId: formData.orderType === 'RAD_NJIVA' ? (formData.workTypeId || null) : null,
      };

      await orderDraft.request(`${API}/work-orders`, payload);
      orderDraft.clear();

      setIsModalOpen(false);
      // Reset forme
      setFormData({
        orderDate: getLocalTomorrowStr(),
        packingPlan: newPackingPlan(getLocalTomorrowStr()),
        orderType: 'RAD_NJIVA',
        priority: 'NORMALNO',
        serviceType: 'REDOVAN_SERVIS',
        workerId: '',
        machineId: '',
        attachmentId: '',
        materials: [] as WorkMaterial[],
        contractorId: '',
        parcelId: '',
        workTypeId: '',
        plannedAreaHa: '',
        shift: 'PRVA',
        instructions: '',
        photoUrl: null as string | null,
      });

      setPage(1);
      refreshOrders(1);
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  };

  const handleConfirmMutated = useCallback((action: 'cancel' | 'reactivate' | 'delete') => {
    if (action === 'delete' && orders.length === 1 && page > 1) {
      refreshOrders(page - 1);
    } else {
      refreshOrders(page);
    }
  }, [orders.length, page, refreshOrders]);

  // Filtriranje radnika na osnovu tipa naloga:
  // - RAD_NJIVA: samo operateri / traktoristi (isključeni mehaničari i rukovodioci)
  // - REMONT_SERVIS: samo mehaničari
  // - OSTALO: svi radnici
  const getFilteredWorkers = (type: string) => {
    if (type === 'PAKOVANJE') return workers.filter(w => w.canReceivePackingOrder);
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

  // Promena tipa posla u kreiranju novog naloga
  const handleCreateOrderTypeChange = (newType: string) => {
    const filtered = getFilteredWorkers(newType);
    const isCurrentValid = filtered.some((w) => w.id === formData.workerId);
    setFormData((prev) => ({
      ...prev,
      orderType: newType as any,
      priority: newType === 'REMONT_SERVIS'
        ? (prev.orderType !== 'REMONT_SERVIS' && prev.priority === 'NORMALNO' ? 'VISOKA' : toRemontPriority(prev.priority))
        : toStandardPriority(prev.priority),
      serviceType: prev.serviceType || 'REDOVAN_SERVIS',
      materials: newType === 'RAD_NJIVA' ? prev.materials : [],
      workerId: isCurrentValid ? prev.workerId : '',
    }));
  };

  // Promena tipa posla u izmeni naloga
  const handleEditOrderTypeChange = (newType: string) => {
    const filtered = getFilteredWorkers(newType);
    const isCurrentValid = filtered.some((w) => w.id === editFormData.workerId);
    setEditFormData((prev) => ({
      ...prev,
      orderType: newType as any,
      priority: newType === 'REMONT_SERVIS'
        ? (prev.orderType !== 'REMONT_SERVIS' && prev.priority === 'NORMALNO' ? 'VISOKA' : toRemontPriority(prev.priority))
        : toStandardPriority(prev.priority),
      serviceType: prev.serviceType || 'REDOVAN_SERVIS',
      materials: newType === 'RAD_NJIVA' ? prev.materials : [],
      workerId: isCurrentValid ? prev.workerId : '',
    }));
  };

  // Opcije za filter tipa posla
  const typeFilterOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: 'Svi tipovi posla' },
      { value: 'RAD_NJIVA', label: 'Rad na njivi' },
      { value: 'PAKOVANJE', label: 'Pakovanje' },
      { value: 'REMONT_SERVIS', label: 'Remont & Servis' },
    ],
    []
  );

  // Opcije za filter statusa
  const statusFilterOptions: CustomSelectOption[] = useMemo(() => {
    if (isManager) {
      return [
        { value: '', label: 'Svi statusi' },
        { value: 'DODELJEN', label: 'Dodeljen', badge: 'Čeka', badgeType: 'warning' },
        { value: 'U_TOKU', label: 'U toku', badge: 'U toku', badgeType: 'default' },
        { value: 'ZAVRSEN', label: 'Završen', badge: 'Završen', badgeType: 'success' },
        { value: 'OTKAZAN', label: 'Otkazan', badge: 'Otkazan', badgeType: 'danger' },
      ];
    }
    return [
      { value: '', label: 'Aktivni nalozi' },
      { value: 'DODELJEN', label: 'Samo Dodeljen', badge: 'Čeka', badgeType: 'warning' },
      { value: 'U_TOKU', label: 'Samo U toku', badge: 'U toku', badgeType: 'default' },
      { value: 'ZAVRSEN', label: 'Završeni nalozi', badge: 'Završen', badgeType: 'success' },
      { value: 'SVE', label: 'Svi nalozi' },
    ];
  }, [isManager]);

  // Opcije za tip naloga u formi
  const orderTypeOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'RAD_NJIVA', label: 'Rad na njivi', subLabel: 'Rad sa mehanizacijom i oruđima na parcelama' },
      { value: 'PAKOVANJE', label: 'Pakovanje' },
      { value: 'REMONT_SERVIS', label: 'Remont & Servis mašine', subLabel: 'Popravke i servis mehanizacije u radionici' },
    ],
    []
  );

  // Opcije za prioritet
  const priorityOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'NORMALNO', label: 'Normalno', subLabel: 'Standardan prioritet rada', badge: 'Normalno', badgeType: 'default' },
      { value: 'HITNO', label: 'Hitno', subLabel: 'Visok prioritet, izvršiti što pre', badge: 'Hitno', badgeType: 'warning' },
      { value: 'KRITICNO', label: 'Kritično', subLabel: 'Maksimalan prioritet, urgentno', badge: 'Kritično', badgeType: 'danger', isAlert: true },
    ],
    []
  );

  // Opcije za radnu smenu
  const shiftOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'PRVA', label: '1. Smena (Jutarnja)', subLabel: '07:00 – 15:30' },
      { value: 'DRUGA', label: '2. Smena (Popodnevna)', subLabel: '15:30 – 23:00' },
      { value: 'TRECA', label: '3. Smena (Noćna)', subLabel: '23:00 – 07:00' },
    ],
    []
  );

  // Opcije za status u izmeni naloga
  const editStatusOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'PLANIRAN', label: 'Planiran', subLabel: 'Kreiran radni nalog u planu', badge: 'Planiran', badgeType: 'default' },
      { value: 'DODELJEN', label: 'Dodeljen', subLabel: 'Dodeljen radniku, čeka početak', badge: 'Dodeljen', badgeType: 'warning' },
      { value: 'U_TOKU', label: 'U toku', subLabel: 'Radnik je zadužio mašinu i radi', badge: 'U toku', badgeType: 'default' },
      { value: 'ZAVRSEN', label: 'Završen', subLabel: 'Rad je uspešno završen', badge: 'Završen', badgeType: 'success' },
      { value: 'OTKAZAN', label: 'Otkazan', subLabel: 'Radni nalog je storniran / otkazan', badge: 'Otkazan', badgeType: 'danger' },
    ],
    []
  );

  // Opcije za radnike kod kreiranja naloga
  const createWorkerOptions: CustomSelectOption[] = useMemo(() => {
    const filtered = getFilteredWorkers(formData.orderType);
    return filtered.map((w) => ({
      value: w.id,
      label: w.name,
      subLabel: w.user?.role
        ? `Uloga: ${w.user.role}`
        : w.type === 'SEZONAC'
          ? 'Sezonski radnik'
          : 'Zaposleni radnik',
      badge: w.type === 'SEZONAC' ? 'Sezonac' : w.user?.role || undefined,
      badgeType: (w.type === 'SEZONAC' ? 'warning' : 'default') as CustomSelectOption['badgeType'],
    }));
  }, [workers, formData.orderType]);

  // Opcije za radnike kod izmene naloga
  const editWorkerOptions: CustomSelectOption[] = useMemo(() => {
    const filtered = getFilteredWorkers(editFormData.orderType);
    return filtered.map((w) => ({
      value: w.id,
      label: w.name,
      subLabel: w.user?.role
        ? `Uloga: ${w.user.role}`
        : w.type === 'SEZONAC'
          ? 'Sezonski radnik'
          : 'Zaposleni radnik',
      badge: w.type === 'SEZONAC' ? 'Sezonac' : w.user?.role || undefined,
      badgeType: (w.type === 'SEZONAC' ? 'warning' : 'default') as CustomSelectOption['badgeType'],
    }));
  }, [workers, editFormData.orderType]);

  // Opcije za mašine
  const machineOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = machines.map((m) => {
      const isFree = m.status === 'SLOBODNA';
      const details = [
        m.type || 'Mašina',
        m.currentHours ? `${m.currentHours} rh` : '',
        m.tankCapacityLiters && m.tankCapacityLiters > 0 ? `Rez: ${m.tankCapacityLiters}L` : '',
      ]
        .filter(Boolean)
        .join(' • ');

      return {
        value: m.id,
        label: m.name,
        subLabel: details || undefined,
        badge: m.status,
        badgeType: isFree ? ('success' as const) : m.status === 'U_RADU' ? ('warning' as const) : ('default' as const),
      };
    });

    return [
      { value: '', label: '— Bez mašine (Ručni rad) —' },
      ...list,
    ];
  }, [machines]);

  const fieldMachineOptions = useMemo(() => machineOptions.filter(option => option.value), [machineOptions]);

  // Opcije za mašine u režimu Remont & Servis (usklađeno sa /masine-kvarovi)
  const remontMachineOptions: CustomSelectOption[] = useMemo(() => {
    return machines.map((m) => {
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
    });
  }, [machines]);

  // Opcije za priključke kod kreiranja
  const attachmentOptions: CustomSelectOption[] = useMemo(() => {
    const attachments = machines.filter((m) => m.type === 'PRIKLJUCAK');
    return [
      { value: '', label: '— Bez priključka (Solo mašina) —' },
      ...attachments.map((m) => ({
        value: m.id,
        label: m.name,
        subLabel: m.status ? `Status: ${m.status}` : 'Priključno oruđe',
        badge: m.status === 'SLOBODNA' ? 'Slobodan' : m.status || undefined,
        badgeType: (m.status === 'SLOBODNA' ? 'success' : 'default') as CustomSelectOption['badgeType'],
      })),
    ];
  }, [machines]);

  // Opcije za priključke kod izmene
  const editAttachmentOptions: CustomSelectOption[] = useMemo(() => {
    const attachments = machines.filter(
      (m) => m.type === 'PRIKLJUCAK' || m.id === editFormData.attachmentId
    );
    return [
      { value: '', label: '— Bez priključka (Solo mašina) —' },
      ...attachments.map((m) => ({
        value: m.id,
        label: m.name,
        subLabel: m.status ? `Status: ${m.status}` : 'Priključno oruđe',
        badge: m.status === 'SLOBODNA' ? 'Slobodan' : m.status || undefined,
        badgeType: (m.status === 'SLOBODNA' ? 'success' : 'default') as CustomSelectOption['badgeType'],
      })),
    ];
  }, [machines, editFormData.attachmentId]);

  // Opcije za parcele
  const parcelOptions: CustomSelectOption[] = useMemo(() => {
    return [
      { value: '', label: '— Izaberite parcelu —' },
      ...parcels.map((p) => ({
        value: p.id,
        label: `[${p.code}] ${p.name} (${p.areaHa} ha)`,
        subLabel: [p.location, p.currentCrop ? `Kultura: ${p.currentCrop}` : ''].filter(Boolean).join(' • ') || undefined,
        badge: `${p.areaHa} ha`,
        badgeType: 'default' as const,
      })),
    ];
  }, [parcels]);

  // Opcije za radne operacije
  const workTypeOptions: CustomSelectOption[] = useMemo(() => {
    return [
      { value: '', label: '— Izaberite radnu operaciju —' },
      ...workTypes.map((wt) => ({
        value: wt.id,
        label: wt.name,
        subLabel: wt.category ? `Kategorija: ${wt.category}` : undefined,
        badge: wt.category || undefined,
        badgeType: 'default' as const,
      })),
    ];
  }, [workTypes]);

  // Za direktore i rukovodioce uvek su otključani svi radni nalozi za izmenu (i završeni i prethodni datumi)
  const canEditOrder = useCallback(() => {
    return isManager;
  }, [isManager]);

  const handleCloseAcceptModal = useCallback(() => setSelectedOrderToAccept(null), []);
  const handleOrderAccepted = useCallback(() => {
    refreshOrders(page);
    void queryClient.invalidateQueries({ queryKey: operationalKey(userId, userRole, 'machines') });
  }, [page, queryClient, refreshOrders, userId, userRole]);
  const handleCloseCancelModal = useCallback(() => setOrderToCancel(null), []);
  const handleCloseReactivateModal = useCallback(() => setOrderToReactivate(null), []);
  const handleCloseDeleteModal = useCallback(() => setOrderToDelete(null), []);

  const handleOpenEditModal = useCallback((order: WorkOrder) => {
    setEditingOrder(order);
    setEditModalError('');
    setEditHasConflict(false);
    setEditConflictOrder(null);
    setEditFormData({
      orderDate: order.orderDate ? new Date(order.orderDate).toISOString().split('T')[0] : '',
      packingPlan: order.packingPlan ?? newPackingPlan(order.orderDate.slice(0, 10)),
      orderType: order.orderType,
      priority: order.orderType === 'REMONT_SERVIS' ? toRemontPriority(order.priority) : (order.priority || 'NORMALNO'),
      serviceType: order.maintenance?.serviceType || 'REDOVAN_SERVIS',
      workerId: order.workerId,
      machineId: order.machineId || '',
      attachmentId: order.attachmentId || '',
      materials: order.materials ?? [],
      contractorId: order.contractorId || '',
      parcelId: order.parcelId || '',
      workTypeId: order.workTypeId || '',
      plannedAreaHa: order.plannedAreaHa ? String(order.plannedAreaHa) : '',
      shift: order.shift || 'PRVA',
      instructions: order.instructions || '',
      photoUrl: order.photoUrl || null,
      status: order.status,
    });
  }, []);

  const handleReloadEditingOrder = useCallback(async () => {
    if (!editingOrder) return;
    setEditModalLoading(true);
    try {
      const res = await fetch(`${API}/work-orders/${editingOrder.id}`, {
        credentials: 'include',
      });
      const resData = await res.json();
      if (res.ok && resData.workOrder) {
        handleOpenEditModal(resData.workOrder);
        refreshOrders(page);
        return;
      }
      if (editConflictOrder) {
        handleOpenEditModal(editConflictOrder);
        refreshOrders(page);
        return;
      }
      throw new Error(resData.error || 'Greška pri učitavanju aktuelnog plana.');
    } catch (err: any) {
      if (editConflictOrder) {
        handleOpenEditModal(editConflictOrder);
        refreshOrders(page);
      } else {
        setEditModalError(err?.message || 'Greška pri učitavanju aktuelnog plana.');
      }
    } finally {
      setEditModalLoading(false);
    }
  }, [editConflictOrder, editingOrder, handleOpenEditModal, page, refreshOrders]);

  const handleUpdateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder || editPhotoUploading) return;
    setEditModalError('');
    setEditHasConflict(false);
    setEditConflictOrder(null);

    if (!editFormData.workerId) {
      setEditModalError(
        editFormData.orderType === 'REMONT_SERVIS'
          ? 'Molimo izaberite mehaničara / servisera kome se nalog izdaje.'
          : 'Molimo izaberite radnika kome se nalog izdaje.'
      );
      return;
    }

    if (editFormData.orderType === 'RAD_NJIVA' && ['PLANIRAN', 'DODELJEN'].includes(editingOrder.status)
      && (!editFormData.machineId || !editFormData.parcelId)) {
      setEditModalError('Za njivski nalog izaberite glavnu mašinu i parcelu.');
      return;
    }
    if (editFormData.orderType === 'REMONT_SERVIS') {
      if (!editFormData.machineId) {
        setEditModalError('Molimo izaberite mašinu ili priključak za remont.');
        return;
      }
      if (!editFormData.serviceType) {
        setEditModalError('Molimo izaberite tip servisa.');
        return;
      }
      if (editFormData.instructions.trim().length < 3) {
        setEditModalError('Uputstvo i specifikacija posla za mehaničara su obavezni (najmanje 3 karaktera).');
        return;
      }
    }

    setEditModalLoading(true);

    try {
      const payload: any = {
        ...editFormData,
        orderUpdatedAt: editingOrder.updatedAt,
        orderDate: editFormData.orderType === 'PAKOVANJE' ? editFormData.packingPlan.packagingForm.date : editFormData.orderDate,
        packingPlan: editFormData.orderType === 'PAKOVANJE' ? editFormData.packingPlan : undefined,
        serviceType: editFormData.orderType === 'REMONT_SERVIS' ? editFormData.serviceType : undefined,
        plannedAreaHa: editFormData.orderType === 'RAD_NJIVA' && editFormData.plannedAreaHa ? parseFloat(editFormData.plannedAreaHa) : null,
        machineId: editFormData.orderType === 'PAKOVANJE' ? null : editFormData.machineId || null,
        attachmentId: editFormData.orderType === 'RAD_NJIVA' ? (editFormData.attachmentId || null) : null,
        materials: materialPayload(editFormData.orderType === 'RAD_NJIVA' ? editFormData.materials : []),
        contractorId: editFormData.orderType === 'RAD_NJIVA' ? editFormData.contractorId || null : null,
        parcelId: editFormData.orderType === 'RAD_NJIVA' ? (editFormData.parcelId || null) : null,
        workTypeId: editFormData.orderType === 'RAD_NJIVA' ? (editFormData.workTypeId || null) : null,
      };

      const res = await fetch(`${API}/work-orders/${editingOrder.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setEditHasConflict(true);
          if (resData.workOrder) {
            setEditConflictOrder(resData.workOrder);
          }
          refreshOrders(page);
        }
        throw new Error(resData.error || 'Greška pri izmeni radnog naloga.');
      }

      setEditingOrder(null);
      refreshOrders(page);
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
      <SubmissionRecovery pending={!!orderDraft.pending} busy={modalLoading} error={orderDraft.storageError || (!isModalOpen ? modalError : '')}
        onRetry={() => void handleCreateOrder(undefined, true)} />
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
          </div>

          {isManager && (
            <button
              className={styles.newOrderBtn}
              onMouseEnter={prefetchMasterData}
              onFocus={prefetchMasterData}
              onClick={() => { orderDraft.resume(); setIsModalOpen(true); }}
            >
              <Plus size={18} />
              <span>Izdaj novi nalog</span>
            </button>
          )}
        </div>

        {/* KPI Grid */}
        {ordersQuery.isSuccess && <div className={styles.kpiGrid}>
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
        </div>}

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

            <div className={styles.filterSelectWrapper}>
              <CustomSelect
                value={typeFilter}
                onChange={(val) => {
                  setTypeFilter(val);
                  setPage(1);
                }}
                options={typeFilterOptions}
                placeholder="Svi tipovi posla"
                searchable={false}
                icon={<Filter size={15} />}
                hideTriggerSubLabel={true}
                triggerClassName={styles.filterSelectTrigger}
              />
            </div>

            <div className={styles.filterSelectWrapper}>
              <CustomSelect
                value={statusFilter}
                onChange={(val) => {
                  setStatusFilter(val);
                  setPage(1);
                }}
                options={statusFilterOptions}
                placeholder="Svi statusi"
                searchable={false}
                icon={<Layers size={15} />}
                hideTriggerSubLabel={true}
                triggerClassName={styles.filterSelectTrigger}
              />
            </div>
          </div>
        </div>

        {/* Orders Grid */}
        {ordersQuery.isError ? <QueryErrorNotice title="Radni nalozi nisu učitani." error={ordersQuery.error}
          pending={ordersQuery.isFetching} onRetry={() => { void ordersQuery.refetch(); }} /> : loading ? (
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
                <button
                  className={styles.newOrderBtn}
                  onMouseEnter={prefetchMasterData}
                  onFocus={prefetchMasterData}
                  onClick={() => { orderDraft.resume(); setIsModalOpen(true); }}
                >
                  <Plus size={18} /> Izdaj novi nalog
                </button>
              )}
            </div>
          ) : (
          <>
            <div className={styles.ordersGrid}>
              {orders.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  isManager={isManager}
                  canEdit={isManager}
                  onDetails={setDetailsOrder}
                  onAccept={setSelectedOrderToAccept}
                  onOtherComplete={setOtherCompletionId}
                  onUsage={setUsageId}
                  onEdit={handleOpenEditModal}
                  onEditPrefetch={prefetchMasterData}
                  onCancel={setOrderToCancel}
                  onReactivate={setOrderToReactivate}
                  onDelete={setOrderToDelete}
                />
              ))}
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

              <SubmissionRecovery pending={!!orderDraft.pending} busy={modalLoading} error={orderDraft.storageError}
                onRetry={() => void handleCreateOrder(undefined, true)} />

              {modalError && (
                <div style={{ padding: '0.75rem 1.5rem', background: '#fee2e2', color: '#b91c1c' }}>
                  {modalError}
                </div>
              )}

              <form onSubmit={handleCreateOrder} className={styles.modalForm}>
                {masterFeedback}
                {formData.orderType === 'PAKOVANJE' ? (
                  <>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}><label>Tip naloga *</label>
                        <CustomSelect value={formData.orderType} options={orderTypeOptions} searchable={false}
                          onChange={handleCreateOrderTypeChange} /></div>
                      <div className={styles.formGroup}><label>Dodeljeni radnik *</label>
                        <CustomSelect value={formData.workerId} options={createWorkerOptions}
                          onChange={workerId => setFormData(prev => ({ ...prev, workerId }))} /></div>
                    </div>
                    {packingLookup.isError && <QueryErrorNotice title="Učitavanje LOT-ova nije uspelo." error={packingLookup.error}
                      pending={packingLookup.isFetching} onRetry={() => void packingLookup.refetch()} />}
                    <div className={styles.packingFields}>
                      <PackingFields plan={formData.packingPlan} allSelectableLots={packingLookup.data?.allLots || []}
                        onChange={update => setFormData(prev => ({ ...prev, packingPlan: typeof update === 'function' ? update(prev.packingPlan) : update }))} />
                    </div>
                  </>
                ) : formData.orderType === 'REMONT_SERVIS' ? (
                  <>
                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Tip naloga *</label>
                      </div>
                      <CustomSelect
                        value={formData.orderType}
                        onChange={handleCreateOrderTypeChange}
                        options={orderTypeOptions}
                        placeholder="— Izaberite tip naloga —"
                        searchable={false}
                        hideTriggerSubLabel={true}
                        triggerClassName={styles.modalFormSelectTrigger}
                      />
                    </div>

                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Mašina ili priključak za remont *</label>
                      </div>
                      <CustomSelect
                        value={formData.machineId}
                        onChange={(val) => setFormData((prev) => ({ ...prev, machineId: val }))}
                        options={remontMachineOptions}
                        placeholder="Izaberite mašinu za remont..."
                        searchable
                        hideTriggerSubLabel={true}
                        triggerClassName={styles.modalFormSelectTrigger}
                      />
                    </div>

                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Dodeljeni mehaničar / serviser *</label>
                      </div>
                      <CustomSelect
                        value={formData.workerId}
                        onChange={(val) => setFormData((prev) => ({ ...prev, workerId: val }))}
                        options={createWorkerOptions}
                        placeholder="Izaberite mehaničara..."
                        searchable
                        hideTriggerSubLabel={true}
                        triggerClassName={styles.modalFormSelectTrigger}
                      />
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Tip servisa *</label>
                        </div>
                        <CustomSelect
                          value={formData.serviceType}
                          onChange={(val) => setFormData((prev) => ({ ...prev, serviceType: val }))}
                          options={SERVICE_TYPE_OPTIONS}
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>

                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Prioritet *</label>
                        </div>
                        <CustomSelect
                          value={formData.priority}
                          onChange={(val) => setFormData((prev) => ({ ...prev, priority: val }))}
                          options={REMONT_PRIORITY_OPTIONS}
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>
                    </div>

                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Datum planiranog početka *</label>
                      </div>
                      <input
                        type="date"
                        className={styles.modalInput}
                        value={formData.orderDate}
                        onChange={(e) => setFormData((prev) => ({ ...prev, orderDate: e.target.value }))}
                        required
                      />
                    </div>

                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Uputstvo i specifikacija posla za mehaničara *</label>
                      </div>
                      <textarea
                        className={styles.modalTextarea}
                        placeholder="Npr. Generalni remont ulagača semena, zamena ulja u menjaču i provera zaptivača..."
                        value={formData.instructions}
                        onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                        required
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Tip naloga *</label>
                        </div>
                        <CustomSelect
                          value={formData.orderType}
                          onChange={handleCreateOrderTypeChange}
                          options={orderTypeOptions}
                          placeholder="— Izaberite tip naloga —"
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>

                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Prioritet *</label>
                        </div>
                        <CustomSelect
                          value={formData.priority}
                          onChange={(val) => setFormData((prev) => ({ ...prev, priority: val }))}
                          options={priorityOptions}
                          placeholder="— Izaberite prioritet —"
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Datum za kada se planira *</label>
                        </div>
                        <input
                          type="date"
                          className={styles.modalInput}
                          value={formData.orderDate}
                          onChange={(e) => setFormData((prev) => ({ ...prev, orderDate: e.target.value }))}
                          required
                        />
                      </div>

                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Radna smena</label>
                        </div>
                        <CustomSelect
                          value={formData.shift}
                          onChange={(val) => setFormData((prev) => ({ ...prev, shift: val as any }))}
                          options={shiftOptions}
                          placeholder="— Izaberite smenu —"
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formGroupFull}>
                        <div className={styles.formLabelRow}>
                          <label>
                            {formData.orderType === 'RAD_NJIVA'
                              ? 'Dodeljeni operater / traktorista *'
                              : 'Radnik kome se nalog izdaje *'}
                          </label>
                        </div>
                        <CustomSelect
                          value={formData.workerId}
                          onChange={(val) => setFormData((prev) => ({ ...prev, workerId: val }))}
                          options={createWorkerOptions}
                          placeholder={
                            formData.orderType === 'RAD_NJIVA'
                              ? '— Izaberi operatera iz baze —'
                              : '— Izaberi radnika iz baze —'
                          }
                          searchable
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Glavna mašina / Traktor{formData.orderType === 'RAD_NJIVA' && ' *'}</label>
                        </div>
                        <CustomSelect
                          value={formData.machineId}
                          onChange={(val) => setFormData((prev) => ({ ...prev, machineId: val }))}
                          options={formData.orderType === 'RAD_NJIVA' ? fieldMachineOptions : machineOptions}
                          placeholder="— Izaberi mašinu —"
                          searchable
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>

                      {formData.orderType === 'RAD_NJIVA' && (
                        <div className={styles.formGroup}>
                          <div className={styles.formLabelRow}>
                            <label>Priključak (opciono)</label>
                          </div>
                          <CustomSelect
                            value={formData.attachmentId}
                            onChange={(val) => setFormData((prev) => ({ ...prev, attachmentId: val }))}
                            options={attachmentOptions}
                            placeholder="— Bez priključka / Samohodna —"
                            searchable
                            hideTriggerSubLabel={true}
                            triggerClassName={styles.modalFormSelectTrigger}
                          />
                        </div>
                      )}
                    </div>

                    {formData.orderType === 'RAD_NJIVA' && <div className={styles.formGroupFull}>
                      <ContractorSelect value={formData.contractorId || ''} onChange={value => setFormData(prev => ({ ...prev, contractorId: value }))} canManage={isManager} />
                    </div>}

                    {formData.orderType === 'RAD_NJIVA' && (
                      <div className={styles.formGrid}>
                        <div className={styles.formGroup}>
                          <div className={styles.formLabelRow}>
                            <label>Parcela / Njiva *</label>

                          </div>
                          <CustomSelect
                            value={formData.parcelId}
                            onChange={(val) => setFormData((prev) => ({ ...prev, parcelId: val }))}
                            options={parcelOptions}
                            placeholder="— Izaberi parcelu —"
                            searchable
                            hideTriggerSubLabel={true}
                            triggerClassName={styles.modalFormSelectTrigger}
                          />
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

                        <div className={styles.formGroup}>
                          <div className={styles.formLabelRow}>
                            <label>Radna operacija / Posao</label>
                          </div>
                          <CustomSelect
                            value={formData.workTypeId}
                            onChange={(val) => setFormData((prev) => ({ ...prev, workTypeId: val, materials: val === prev.workTypeId ? prev.materials : [] }))}
                            options={workTypeOptions}
                            placeholder="— Izaberi posao —"
                            searchable
                            hideTriggerSubLabel={true}
                            triggerClassName={styles.modalFormSelectTrigger}
                          />
                        </div>
                      </div>
                    )}

                    {formData.orderType === 'RAD_NJIVA' && <div className={styles.formGroupFull}>
                      <WorkMaterialsEditor kind={workTypes.find(w => w.id === formData.workTypeId)?.materialKind} required={workTypes.find(w => w.id === formData.workTypeId)?.materialRequired}
                        value={formData.materials} onChange={materials => setFormData(prev => ({ ...prev, materials }))} canManage={isManager} />
                    </div>}

                    {formData.orderType === 'RAD_NJIVA' && (
                      <div className={styles.formGrid}>
                        <div className={styles.formGroupFull}>
                          <div className={styles.formLabelRow}>
                            <label>Planirani obim rada (hektara)</label>
                          </div>
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
                      <div className={styles.formLabelRow}>
                        <label>Uputstvo / Napomena za radnika</label>
                      </div>
                      <textarea
                        className={styles.modalTextarea}
                        placeholder="npr. Počni oranje od kanala, dubina 28-30 cm, obrati pažnju na vlagu zemljišta."
                        value={formData.instructions}
                        onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                      />
                    </div>
                  </>
                )}

                <PhotoUpload photoUrl={formData.photoUrl} label="Fotografija za radnika (opciono)" onChange={(photoUrl) => setFormData((current) => ({ ...current, photoUrl }))} onUploadStateChange={setPhotoUploading} disabled={modalLoading} />
                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.cancelModalBtn}
                    onClick={() => setIsModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.saveBtn} disabled={modalLoading || photoUploading}>
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
                <div style={{ padding: '0.75rem 1.5rem', background: '#fee2e2', color: '#b91c1c', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <span>{editModalError}</span>
                  {editHasConflict && (
                    <button
                      type="button"
                      className={styles.cancelModalBtn}
                      onClick={() => { void handleReloadEditingOrder(); }}
                      disabled={editModalLoading}
                    >
                      Učitaj aktuelni plan
                    </button>
                  )}
                </div>
              )}

              {!['PLANIRAN', 'DODELJEN'].includes(editingOrder.status) && !['REMONT_SERVIS', 'PAKOVANJE'].includes(editingOrder.orderType) && <MachineUsageAction inset onClick={() => { setUsageId(editingOrder.id); setEditingOrder(null); }} />}
              <form onSubmit={handleUpdateOrder} className={styles.modalForm}>
                {masterFeedback}
                {editFormData.orderType === 'PAKOVANJE' ? (
                  <>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}><label>Tip naloga *</label>
                        <CustomSelect value={editFormData.orderType} options={orderTypeOptions.filter(option => option.value === 'PAKOVANJE')} searchable={false}
                          onChange={handleEditOrderTypeChange} /></div>
                      <div className={styles.formGroup}><label>Dodeljeni radnik *</label>
                        <CustomSelect value={editFormData.workerId} options={editWorkerOptions}
                          onChange={workerId => setEditFormData(prev => ({ ...prev, workerId }))} /></div>
                    </div>
                    {packingLookup.isError && <QueryErrorNotice title="Učitavanje LOT-ova nije uspelo." error={packingLookup.error}
                      pending={packingLookup.isFetching} onRetry={() => void packingLookup.refetch()} />}
                    <div className={styles.packingFields}>
                      <PackingFields plan={editFormData.packingPlan} allSelectableLots={packingLookup.data?.allLots || []}
                        onChange={update => setEditFormData(prev => ({ ...prev, packingPlan: typeof update === 'function' ? update(prev.packingPlan) : update }))} />
                    </div>
                  </>
                ) : editFormData.orderType === 'REMONT_SERVIS' ? (
                  <>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Status naloga *</label>
                        </div>
                        <CustomSelect
                          value={editFormData.status}
                          onChange={(val) => setEditFormData((prev) => ({ ...prev, status: val as any }))}
                          options={editStatusOptions}
                          disabled
                          placeholder="— Izaberite status —"
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>

                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Tip naloga *</label>
                        </div>
                        <CustomSelect
                          value={editFormData.orderType}
                          disabled={!["PLANIRAN", "DODELJEN"].includes(editingOrder.status)}
                          onChange={handleEditOrderTypeChange}
                          options={orderTypeOptions.filter(option => option.value !== 'PAKOVANJE')}
                          placeholder="— Izaberite tip naloga —"
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>
                    </div>

                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Mašina ili priključak za remont *</label>
                      </div>
                      <CustomSelect
                        value={editFormData.machineId}
                        disabled={!["PLANIRAN", "DODELJEN"].includes(editingOrder.status)}
                        onChange={(val) => setEditFormData((prev) => ({ ...prev, machineId: val }))}
                        options={remontMachineOptions}
                        placeholder="Izaberite mašinu za remont..."
                        searchable
                        hideTriggerSubLabel={true}
                        triggerClassName={styles.modalFormSelectTrigger}
                      />
                    </div>

                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Dodeljeni mehaničar / serviser *</label>
                      </div>
                      <CustomSelect
                        value={editFormData.workerId}
                        disabled={!["PLANIRAN", "DODELJEN"].includes(editingOrder.status)}
                        onChange={(val) => setEditFormData((prev) => ({ ...prev, workerId: val }))}
                        options={editWorkerOptions}
                        placeholder="Izaberite mehaničara..."
                        searchable
                        hideTriggerSubLabel={true}
                        triggerClassName={styles.modalFormSelectTrigger}
                      />
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Tip servisa *</label>
                        </div>
                        <CustomSelect
                          value={editFormData.serviceType}
                          onChange={(val) => setEditFormData((prev) => ({ ...prev, serviceType: val }))}
                          options={SERVICE_TYPE_OPTIONS}
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>

                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Prioritet *</label>
                        </div>
                        <CustomSelect
                          value={editFormData.priority}
                          onChange={(val) => setEditFormData((prev) => ({ ...prev, priority: val }))}
                          options={REMONT_PRIORITY_OPTIONS}
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>
                    </div>

                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Datum planiranog početka *</label>
                      </div>
                      <input
                        type="date"
                        className={styles.modalInput}
                        value={editFormData.orderDate}
                        onChange={(e) => setEditFormData((prev) => ({ ...prev, orderDate: e.target.value }))}
                        required
                      />
                    </div>

                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Uputstvo i specifikacija posla za mehaničara *</label>
                      </div>
                      <textarea
                        className={styles.modalTextarea}
                        placeholder="Npr. Generalni remont ulagača semena, zamena ulja u menjaču i provera zaptivača..."
                        value={editFormData.instructions}
                        onChange={(e) => setEditFormData({ ...editFormData, instructions: e.target.value })}
                        required
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Status naloga *</label>
                        </div>
                        <CustomSelect
                          value={editFormData.status}
                          onChange={(val) => setEditFormData((prev) => ({ ...prev, status: val as any }))}
                          options={editStatusOptions}
                          disabled
                          placeholder="— Izaberite status —"
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>

                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Prioritet *</label>
                        </div>
                        <CustomSelect
                          value={editFormData.priority}
                          onChange={(val) => setEditFormData((prev) => ({ ...prev, priority: val }))}
                          options={priorityOptions}
                          placeholder="— Izaberite prioritet —"
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Tip naloga *</label>
                        </div>
                        <CustomSelect
                          value={editFormData.orderType}
                          disabled={!["PLANIRAN", "DODELJEN"].includes(editingOrder.status)}
                          onChange={handleEditOrderTypeChange}
                          options={orderTypeOptions.filter(option => option.value !== 'PAKOVANJE')}
                          placeholder="— Izaberite tip naloga —"
                          searchable={false}
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>

                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Datum za kada se planira *</label>
                        </div>
                        <input
                          type="date"
                          className={styles.modalInput}
                          value={editFormData.orderDate}
                          onChange={(e) => setEditFormData((prev) => ({ ...prev, orderDate: e.target.value }))}
                          required
                        />
                      </div>
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formGroupFull}>
                        <div className={styles.formLabelRow}>
                          <label>
                            {editFormData.orderType === 'RAD_NJIVA'
                              ? 'Dodeljeni operater / traktorista *'
                              : 'Radnik kome se nalog izdaje *'}
                          </label>
                        </div>
                        <CustomSelect
                          value={editFormData.workerId}
                          disabled={!["PLANIRAN", "DODELJEN"].includes(editingOrder.status)}
                          onChange={(val) => setEditFormData((prev) => ({ ...prev, workerId: val }))}
                          options={editWorkerOptions}
                          placeholder={
                            editFormData.orderType === 'RAD_NJIVA'
                              ? '— Izaberi operatera iz baze —'
                              : '— Izaberi radnika iz baze —'
                          }
                          searchable
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formGroup}>
                        <div className={styles.formLabelRow}>
                          <label>Glavna mašina / Traktor{editFormData.orderType === 'RAD_NJIVA' && ' *'}</label>
                        </div>
                        <CustomSelect
                          value={editFormData.machineId}
                          disabled={!["PLANIRAN", "DODELJEN"].includes(editingOrder.status)}
                          onChange={(val) => setEditFormData((prev) => ({ ...prev, machineId: val }))}
                          options={editFormData.orderType === 'RAD_NJIVA' ? fieldMachineOptions : machineOptions}
                          placeholder={editFormData.orderType === 'RAD_NJIVA' ? '— Izaberi mašinu —' : '— Bez mašine —'}
                          searchable
                          hideTriggerSubLabel={true}
                          triggerClassName={styles.modalFormSelectTrigger}
                        />
                      </div>

                      {editFormData.orderType === 'RAD_NJIVA' && (
                        <div className={styles.formGroup}>
                          <div className={styles.formLabelRow}>
                            <label>Priključak (opciono)</label>
                          </div>
                          <CustomSelect
                            value={editFormData.attachmentId}
                            disabled={!["PLANIRAN", "DODELJEN"].includes(editingOrder.status)}
                            onChange={(val) => setEditFormData((prev) => ({ ...prev, attachmentId: val }))}
                            options={editAttachmentOptions}
                            placeholder="— Bez priključka / Samohodna —"
                            searchable
                            hideTriggerSubLabel={true}
                            triggerClassName={styles.modalFormSelectTrigger}
                          />
                        </div>
                      )}
                    </div>

                    {editFormData.orderType === 'RAD_NJIVA' && <div className={styles.formGroupFull}>
                      <ContractorSelect value={editFormData.contractorId || ''} onChange={value => setEditFormData(prev => ({ ...prev, contractorId: value }))} canManage={isManager} />
                    </div>}

                    {editFormData.orderType === 'RAD_NJIVA' && (
                      <div className={styles.formGrid}>
                        <div className={styles.formGroup}>
                          <div className={styles.formLabelRow}>
                            <label>Parcela / Njiva *</label>

                          </div>
                          <CustomSelect
                            value={editFormData.parcelId}
                            disabled={!["PLANIRAN", "DODELJEN"].includes(editingOrder.status)}
                            onChange={(val) => setEditFormData((prev) => ({ ...prev, parcelId: val }))}
                            options={parcelOptions}
                            placeholder="— Izaberi parcelu —"
                            searchable
                            hideTriggerSubLabel={true}
                            triggerClassName={styles.modalFormSelectTrigger}
                          />
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

                        <div className={styles.formGroup}>
                          <div className={styles.formLabelRow}>
                            <label>Radna operacija / Posao</label>
                          </div>
                          <CustomSelect
                            value={editFormData.workTypeId}
                            disabled={!["PLANIRAN", "DODELJEN"].includes(editingOrder.status)}
                            onChange={(val) => setEditFormData((prev) => ({ ...prev, workTypeId: val, materials: val === prev.workTypeId ? prev.materials : [] }))}
                            options={workTypeOptions}
                            placeholder="— Izaberi posao —"
                            searchable
                            hideTriggerSubLabel={true}
                            triggerClassName={styles.modalFormSelectTrigger}
                          />
                        </div>
                      </div>
                    )}

                    {editFormData.orderType === 'RAD_NJIVA' && <div className={styles.formGroupFull}>
                      <WorkMaterialsEditor kind={workTypes.find(w => w.id === editFormData.workTypeId)?.materialKind} required={workTypes.find(w => w.id === editFormData.workTypeId)?.materialRequired}
                        value={editFormData.materials} onChange={materials => setEditFormData(prev => ({ ...prev, materials }))} canManage={isManager} />
                    </div>}

                    {editFormData.orderType === 'RAD_NJIVA' && (
                      <div className={styles.formGrid}>
                        <div className={styles.formGroup}>
                          <div className={styles.formLabelRow}>
                            <label>Planirani obim rada (hektara)</label>
                          </div>
                          <input
                            type="number"
                            step="0.1"
                            className={styles.modalInput}
                            placeholder="npr. 12.5"
                            value={editFormData.plannedAreaHa}
                            onChange={(e) => setEditFormData((prev) => ({ ...prev, plannedAreaHa: e.target.value }))}
                          />
                        </div>

                        <div className={styles.formGroup}>
                          <div className={styles.formLabelRow}>
                            <label>Radna smena</label>
                          </div>
                          <CustomSelect
                            value={editFormData.shift}
                            onChange={(val) => setEditFormData((prev) => ({ ...prev, shift: val as any }))}
                            options={shiftOptions}
                            placeholder="— Izaberite smenu —"
                            searchable={false}
                            hideTriggerSubLabel={true}
                            triggerClassName={styles.modalFormSelectTrigger}
                          />
                        </div>
                      </div>
                    )}

                    <div className={styles.formGroupFull}>
                      <div className={styles.formLabelRow}>
                        <label>Uputstvo / Napomena za radnika</label>
                      </div>
                      <textarea
                        className={styles.modalTextarea}
                        placeholder="npr. Počni oranje od kanala, dubina 28-30 cm, obrati pažnju na vlagu zemljišta."
                        value={editFormData.instructions}
                        onChange={(e) => setEditFormData({ ...editFormData, instructions: e.target.value })}
                      />
                    </div>
                  </>
                )}

                <PhotoUpload photoUrl={editFormData.photoUrl} label="Fotografija za radnika (opciono)" onChange={(photoUrl) => setEditFormData((current) => ({ ...current, photoUrl }))} onUploadStateChange={setEditPhotoUploading} disabled={editModalLoading} />
                <div className={styles.modalFooter} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => {
                      const toDelete = editingOrder;
                      setEditingOrder(null);
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
                    <button type="submit" className={styles.saveBtn} disabled={editModalLoading || editPhotoUploading}>
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
          <OrderAcceptModal
            order={selectedOrderToAccept}
            onClose={handleCloseAcceptModal}
            onAccepted={handleOrderAccepted}
          />
        )}

        <OrderConfirmModals
          orderToCancel={orderToCancel}
          orderToReactivate={orderToReactivate}
          orderToDelete={orderToDelete}
          onCloseCancel={handleCloseCancelModal}
          onCloseReactivate={handleCloseReactivateModal}
          onCloseDelete={handleCloseDeleteModal}
          onMutated={handleConfirmMutated}
        />

        {/* Modal za slike i detalje radnog naloga */}
        {detailsOrder && (
          <OrderDetailsModal
            order={detailsOrder}
            onClose={() => setDetailsOrder(null)}
            onEdit={handleOpenEditModal}
            canEdit={canEditOrder()}
          />
        )}

        {/* Brzi modal za dodavanje / izmenu parcele */}
        {parcelQuickModalOpen && (
          <ParcelQuickModal
            isOpen={parcelQuickModalOpen}
            onClose={() => setParcelQuickModalOpen(false)}
            parcelToEdit={parcelToEdit}
            onSaved={(savedParcel, mode) => {
              queryClient.setQueryData(operationalQueryOptions(userId, userRole, 'parcels').queryKey, (previous: { parcels: Parcel[] } | undefined) => {
                const prev = previous?.parcels || [];
                return {
                  parcels: mode === 'edit' ? prev.map(p => p.id === savedParcel.id ? savedParcel : p)
                    : [...prev, savedParcel].sort((a, b) => a.code.localeCompare(b.code))
                };
              });
              if (parcelQuickTarget === 'create-order') {
                setFormData((prev) => ({ ...prev, parcelId: savedParcel.id }));
              } else {
                setEditFormData((prev) => ({ ...prev, parcelId: savedParcel.id }));
              }
              if (mode === 'edit') {
                refreshOrders(page);
              }
            }}
          />
        )}
      </div>
      {usageId && <MachineUsageModal contextType="order" contextId={usageId} onClose={() => setUsageId(null)}
        onSaved={() => {
          void queryClient.invalidateQueries({ queryKey: operationalKey(userId, userRole, 'orders') });
          void queryClient.invalidateQueries({ queryKey: operationalKey(userId, userRole, 'machines') });
        }} />}
      {otherCompletionId && <OtherOrderCompletion id={otherCompletionId} onClose={() => setOtherCompletionId(null)} />}
    </AppLayout>
  );
};

export default RadniNaloziDashboard;
