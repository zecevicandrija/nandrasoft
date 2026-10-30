import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  Tractor,
  Users,
  Settings,
  Sprout,
  Handshake,
  Search,
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  X,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { useSession } from '../lib/auth-client';
import styles from './Sifarnici.module.css';

const API = '/api';

type TabType = 'parcele' | 'masine' | 'radnici' | 'operacije' | 'kulture' | 'partneri';

const PAGE_SIZE = 25;

const MACHINE_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'TRAKTOR', label: 'Traktor' },
  { value: 'PRIKLJUCAK', label: 'Priključak / Prskalica / Vadilica' },
  { value: 'KOMBAJN', label: 'Kombajn' },
  { value: 'KAMION', label: 'Kamion / Teretno vozilo' },
  { value: 'VILJUSKAR', label: 'Viljuškar' },
  { value: 'OSTALO', label: 'Ostalo' },
];

const MACHINE_STATUS_OPTIONS: CustomSelectOption[] = [
  { value: 'SLOBODNA', label: 'Slobodna', badge: 'Slobodna', badgeType: 'success' },
  { value: 'ZADUZENA', label: 'Zadužena na njivi', badge: 'Zadužena', badgeType: 'warning' },
  { value: 'U_KVARU', label: 'U kvaru', badge: 'U kvaru', badgeType: 'danger' },
  { value: 'SERVIS', label: 'Na servisu / Remont', badge: 'Servis', badgeType: 'default' },
];

const ALL_WORKER_ROLE_OPTIONS: CustomSelectOption[] = [
  { value: 'RUKOVODILAC', label: 'Rukovodilac (Direktor / Menadžment)', badge: 'Rukovodilac', badgeType: 'purple' as any },
  { value: 'MAGACIN', label: 'Magacioner (Prijem / Izdavanje roba)', badge: 'Magacin', badgeType: 'info' },
  { value: 'MEHANICAR', label: 'Mehaničar (Održavanje i servisi)', badge: 'Mehaničar', badgeType: 'danger' },
  { value: 'OPERATER', label: 'Operater (Traktorista / Vozač)', badge: 'Operater', badgeType: 'primary' },
  { value: 'SEZONAC', label: 'Sezonski radnik (Dnevnica)', badge: 'Sezonac', badgeType: 'warning' },
];

const WORK_CATEGORY_OPTIONS: CustomSelectOption[] = [
  { value: 'OBRADA', label: 'Obrada zemlje (Oranje, Podrivanje, Tanjiranje)' },
  { value: 'SETVA', label: 'Setva / Sadnja' },
  { value: 'ZASTITA', label: 'Zaštita / Prskanje' },
  { value: 'ZETVA_BERBA', label: 'Žetva / Berba / Vađenje' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'OSTALO', label: 'Ostalo' },
];

const PARTNER_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'KUPAC', label: 'Kupac (Otkup luka / polj. proizvoda)', badge: 'Kupac', badgeType: 'success' },
  { value: 'DOBAVLJAC', label: 'Dobavljač (Đubrivo / Seme / Gorivo)', badge: 'Dobavljač', badgeType: 'warning' },
  { value: 'SERVIS', label: 'Serviser / Održavanje mašina', badge: 'Servis', badgeType: 'default' },
  { value: 'OBA', label: 'Kupac & Dobavljač', badge: 'Oba', badgeType: 'success' },
];

const FILTER_MACHINE_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Svi tipovi mašina' },
  ...MACHINE_TYPE_OPTIONS,
];

const FILTER_MACHINE_STATUS_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Svi statusi mašina' },
  ...MACHINE_STATUS_OPTIONS,
];

const FILTER_WORKER_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Sve uloge i radnici' },
  { value: 'RUKOVODILAC', label: 'Rukovodioci' },
  { value: 'MAGACIN', label: 'Magacioneri' },
  { value: 'MEHANICAR', label: 'Mehaničari' },
  { value: 'OPERATER', label: 'Operateri / Traktoristi' },
  { value: 'SEZONAC', label: 'Sezonski radnici' },
];

const FILTER_WORK_CATEGORY_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Sve kategorije operacija' },
  ...WORK_CATEGORY_OPTIONS,
];

const FILTER_PARTNER_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Svi tipovi partnera' },
  ...PARTNER_TYPE_OPTIONS,
];

interface Toast {
  message: string;
  type: 'success' | 'error';
}

interface DeleteTarget {
  id: string;
  name: string;
  tab: TabType;
  details?: { label: string; value: string }[];
}

const SifarniciHub: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUserRole = (session as any)?.user?.role;
  const isDirektor = currentUserRole === 'DIREKTOR';

  const [activeTab, setActiveTab] = useState<TabType>('parcele');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Filteri na toolbaru
  const [filterMachineType, setFilterMachineType] = useState('');
  const [filterMachineStatus, setFilterMachineStatus] = useState('');
  const [filterWorkerType, setFilterWorkerType] = useState('');
  const [filterWorkCategory, setFilterWorkCategory] = useState('');
  const [filterPartnerType, setFilterPartnerType] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [itemToDelete, setItemToDelete] = useState<DeleteTarget | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Form states
  const [form, setForm] = useState<Record<string, any>>({});

  // Dozvoljene uloge za kreiranje/izmenu radnika
  const availableWorkerRoleOptions = useMemo(() => {
    if (isDirektor) {
      return ALL_WORKER_ROLE_OPTIONS;
    }
    // Rukovodioci ne mogu da postavljaju druge rukovodioce, samo operater, magacioner, mehanicar, sezonac
    return ALL_WORKER_ROLE_OPTIONS.filter((opt) => opt.value !== 'RUKOVODILAC');
  }, [isDirektor]);

  // Provera da li ulogovani korisnik sme da menja/briše radnika
  const canModifyWorker = (w: any) => {
    const wRole = w.role || w.user?.role || (w.type === 'SEZONAC' ? 'SEZONAC' : 'OPERATER');
    if (wRole === 'DIREKTOR') return false;
    if (wRole === 'RUKOVODILAC' && !isDirektor) return false;
    return true;
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // 1. STATS QUERY
  const { data: stats } = useQuery({
    queryKey: ['master-stats'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/stats`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška');
      return res.json();
    },
  });

  // 2. DATA QUERIES
  const { data: parcelsData, isLoading: loadingParcels } = useQuery({
    queryKey: ['parcels'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/parcels`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: machinesData, isLoading: loadingMachines } = useQuery({
    queryKey: ['machines'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/machines`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: workersData, isLoading: loadingWorkers } = useQuery({
    queryKey: ['workers'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/workers`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: workTypesData, isLoading: loadingWorkTypes } = useQuery({
    queryKey: ['work-types'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/work-types`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: cropsData, isLoading: loadingCrops } = useQuery({
    queryKey: ['crops'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/crops`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: partnersData, isLoading: loadingPartners } = useQuery({
    queryKey: ['partners'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/partners`, { credentials: 'include' });
      return res.json();
    },
  });

  // 3. MUTATIONS (ADD / EDIT / DELETE)
  const saveMutation = useMutation({
    mutationFn: async ({ endpoint, id, data }: { endpoint: string; id?: string; data: any }) => {
      const url = id ? `${API}/master/${endpoint}/${id}` : `${API}/master/${endpoint}`;
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Greška pri čuvanju');
      return resData;
    },
    onSuccess: (_, variables) => {
      showToast('Uspešno sačuvano!', 'success');
      queryClient.invalidateQueries({ queryKey: [variables.endpoint] });
      queryClient.invalidateQueries({ queryKey: ['master-stats'] });
      closeModal();
    },
    onError: (err: any) => {
      showToast(err.message || 'Greška na serveru', 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ endpoint, id }: { endpoint: string; id: string }) => {
      const res = await fetch(`${API}/master/${endpoint}/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Greška pri brisanju');
      return resData;
    },
    onSuccess: (_, variables) => {
      showToast('Uspešno obrisano!', 'success');
      queryClient.invalidateQueries({ queryKey: [variables.endpoint] });
      queryClient.invalidateQueries({ queryKey: ['master-stats'] });
      setItemToDelete(null);
    },
    onError: (err: any) => {
      showToast(err.message || 'Greška pri brisanju', 'error');
    },
  });

  // Modal actions
  const openAddModal = () => {
    setEditingItem(null);
    if (activeTab === 'parcele') setForm({ code: '', name: '', areaHa: '', location: '', currentCrop: '', notes: '' });
    if (activeTab === 'masine') setForm({ name: '', type: 'TRAKTOR', brandModel: '', regNumber: '', year: new Date().getFullYear(), currentHours: 0, tankCapacityLiters: 250, status: 'SLOBODNA', notes: '' });
    if (activeTab === 'radnici') setForm({ name: '', role: 'OPERATER', phone: '', city: '', dailyWage: '' });
    if (activeTab === 'operacije') setForm({ name: '', category: 'OBRADA', unit: 'ha' });
    if (activeTab === 'kulture') setForm({ name: '', variety: '', notes: '' });
    if (activeTab === 'partneri') setForm({ name: '', type: 'KUPAC', pib: '', phone: '', email: '', address: '' });
    setModalOpen(true);
  };

  const openEditModal = (item: any) => {
    setEditingItem(item);
    if (activeTab === 'radnici') {
      const role = item.role || item.user?.role || (item.type === 'SEZONAC' ? 'SEZONAC' : 'OPERATER');
      setForm({
        ...item,
        role,
        city: item.city || '',
        dailyWage: item.dailyWage !== null && item.dailyWage !== undefined ? item.dailyWage : '',
      });
    } else {
      setForm({ ...item });
    }
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingItem(null);
    setForm({});
  };

  const handleSave = () => {
    const endpointMap: Record<TabType, string> = {
      parcele: 'parcels',
      masine: 'machines',
      radnici: 'workers',
      operacije: 'work-types',
      kulture: 'crops',
      partneri: 'partners',
    };

    const endpoint = endpointMap[activeTab];
    let payload = { ...form };

    // Parsiranje brojeva
    if (activeTab === 'parcele' && payload.areaHa) payload.areaHa = parseFloat(payload.areaHa);
    if (activeTab === 'masine') {
      if (payload.year) payload.year = parseInt(payload.year, 10);
      if (payload.currentHours !== undefined) payload.currentHours = parseFloat(payload.currentHours);
      if (payload.tankCapacityLiters !== undefined && payload.tankCapacityLiters !== '') {
        payload.tankCapacityLiters = parseFloat(payload.tankCapacityLiters);
      } else {
        payload.tankCapacityLiters = null;
      }
    }
    if (activeTab === 'radnici') {
      delete payload.hourlyRate;
      if (payload.role === 'SEZONAC') {
        if (!payload.city || !payload.city.trim()) {
          showToast('Grad / Mesto je obavezno polje za sezonskog radnika.', 'error');
          return;
        }
        payload.type = 'SEZONAC';
        if (payload.dailyWage !== '' && payload.dailyWage !== undefined && payload.dailyWage !== null) {
          payload.dailyWage = parseFloat(payload.dailyWage);
        } else {
          payload.dailyWage = null;
        }
      } else {
        payload.type = 'STALNI';
        payload.dailyWage = null;
      }
    }

    saveMutation.mutate({ endpoint, id: editingItem?.id, data: payload });
  };

  const openDeleteModal = (target: DeleteTarget) => {
    setItemToDelete(target);
  };

  const closeDeleteModal = () => {
    if (deleteMutation.isPending) return;
    setItemToDelete(null);
  };

  const confirmDelete = () => {
    if (!itemToDelete) return;
    const endpointMap: Record<TabType, string> = {
      parcele: 'parcels',
      masine: 'machines',
      radnici: 'workers',
      operacije: 'work-types',
      kulture: 'crops',
      partneri: 'partners',
    };
    deleteMutation.mutate({ endpoint: endpointMap[itemToDelete.tab], id: itemToDelete.id });
  };

  const getTabSingular = (tab: TabType) => {
    switch (tab) {
      case 'parcele':
        return 'parcelu';
      case 'masine':
        return 'mašinu';
      case 'radnici':
        return 'radnika';
      case 'operacije':
        return 'operaciju';
      case 'kulture':
        return 'kulturu / sortu';
      case 'partneri':
        return 'partnera';
      default:
        return 'stavku';
    }
  };

  // Tab change handler
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSearch('');
    setPage(1);
    setFilterMachineType('');
    setFilterMachineStatus('');
    setFilterWorkerType('');
    setFilterWorkCategory('');
    setFilterPartnerType('');
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  // Opcije za kulturu u formi parcele
  const cropSelectOptions = useMemo<CustomSelectOption[]>(() => {
    return [
      { value: '', label: '— Ugar / Slobodno (bez kulture) —' },
      ...(cropsData?.crops || []).map((c: any) => {
        const val = c.name + (c.variety ? ` - ${c.variety}` : '');
        return {
          value: val,
          label: c.name,
          subLabel: c.variety ? `Sorta: ${c.variety}` : undefined,
        };
      }),
    ];
  }, [cropsData?.crops]);

  // Filteri
  const q = search.toLowerCase();
  const parcels = useMemo(() => {
    return (parcelsData?.parcels || []).filter(
      (p: any) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.currentCrop || '').toLowerCase().includes(q)
    );
  }, [parcelsData?.parcels, q]);

  const machines = useMemo(() => {
    return (machinesData?.machines || []).filter((m: any) => {
      if (filterMachineType && m.type !== filterMachineType) return false;
      if (filterMachineStatus && m.status !== filterMachineStatus) return false;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.brandModel || '').toLowerCase().includes(q) ||
        (m.regNumber || '').toLowerCase().includes(q)
      );
    });
  }, [machinesData?.machines, filterMachineType, filterMachineStatus, q]);

  const workers = useMemo(() => {
    return (workersData?.workers || []).filter((w: any) => {
      const wRole = w.role || w.user?.role || (w.type === 'SEZONAC' ? 'SEZONAC' : 'OPERATER');
      if (filterWorkerType && wRole !== filterWorkerType) return false;
      return (
        w.name.toLowerCase().includes(q) ||
        (w.phone || '').includes(q) ||
        (w.city || '').toLowerCase().includes(q) ||
        (w.user?.email || '').toLowerCase().includes(q)
      );
    });
  }, [workersData?.workers, filterWorkerType, q]);

  const workTypes = useMemo(() => {
    return (workTypesData?.workTypes || []).filter((wt: any) => {
      if (filterWorkCategory && wt.category !== filterWorkCategory) return false;
      return wt.name.toLowerCase().includes(q) || wt.category.toLowerCase().includes(q);
    });
  }, [workTypesData?.workTypes, filterWorkCategory, q]);

  const crops = useMemo(() => {
    return (cropsData?.crops || []).filter(
      (c: any) =>
        c.name.toLowerCase().includes(q) || (c.variety || '').toLowerCase().includes(q)
    );
  }, [cropsData?.crops, q]);

  const partners = useMemo(() => {
    return (partnersData?.partners || []).filter((pt: any) => {
      if (filterPartnerType && pt.type !== filterPartnerType) return false;
      return pt.name.toLowerCase().includes(q) || (pt.pib || '').includes(q);
    });
  }, [partnersData?.partners, filterPartnerType, q]);

  // Aktivna lista i paginacija (25 po stranici)
  const currentList = useMemo(() => {
    switch (activeTab) {
      case 'parcele':
        return parcels;
      case 'masine':
        return machines;
      case 'radnici':
        return workers;
      case 'operacije':
        return workTypes;
      case 'kulture':
        return crops;
      case 'partneri':
        return partners;
      default:
        return [];
    }
  }, [activeTab, parcels, machines, workers, workTypes, crops, partners]);

  const totalItems = currentList.length;
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;

  const paginatedParcels = useMemo(
    () => parcels.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [parcels, page]
  );
  const paginatedMachines = useMemo(
    () => machines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [machines, page]
  );
  const paginatedWorkers = useMemo(
    () => workers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [workers, page]
  );
  const paginatedWorkTypes = useMemo(
    () => workTypes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [workTypes, page]
  );
  const paginatedCrops = useMemo(
    () => crops.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [crops, page]
  );
  const paginatedPartners = useMemo(
    () => partners.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [partners, page]
  );

  const getItemName = (tab: TabType) => {
    switch (tab) {
      case 'parcele':
        return 'parcela';
      case 'masine':
        return 'mašina';
      case 'radnici':
        return 'radnika';
      case 'operacije':
        return 'operacija';
      case 'kulture':
        return 'kultura';
      case 'partneri':
        return 'partnera';
      default:
        return 'zapisa';
    }
  };

  const isLoading = loadingParcels || loadingMachines || loadingWorkers || loadingWorkTypes || loadingCrops || loadingPartners;

  return (
    <AppLayout pageTitle="Šifarnici">
      {/* Toast Notification */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top Stat Cards */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.iconParcele}`}>
            <Layers size={24} />
          </div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats?.totalAreaHa || 0} ha</div>
            <div className={styles.statLabel}>{stats?.parcelsCount || 0} Parcela ukupno</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.iconMasine}`}>
            <Tractor size={24} />
          </div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats?.machinesCount || 0}</div>
            <div className={styles.statLabel}>Mašina i priključaka</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.iconRadnici}`}>
            <Users size={24} />
          </div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats?.workersCount || 0}</div>
            <div className={styles.statLabel}>{stats?.seasonalWorkers || 0} Sezonaca na stanju</div>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={`${styles.statIcon} ${styles.iconOperacije}`}>
            <Settings size={24} />
          </div>
          <div className={styles.statInfo}>
            <div className={styles.statValue}>{stats?.workTypesCount || 0}</div>
            <div className={styles.statLabel}>Definisanih operacija</div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className={styles.tabsContainer}>
        <button
          className={`${styles.tabBtn} ${activeTab === 'parcele' ? styles.tabBtnActive : ''}`}
          onClick={() => handleTabChange('parcele')}
        >
          <Layers size={17} />
          <span>Parcele</span>
          <span className={styles.tabBadge}>{parcelsData?.parcels?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'masine' ? styles.tabBtnActive : ''}`}
          onClick={() => handleTabChange('masine')}
        >
          <Tractor size={17} />
          <span>Mašine</span>
          <span className={styles.tabBadge}>{machinesData?.machines?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'radnici' ? styles.tabBtnActive : ''}`}
          onClick={() => handleTabChange('radnici')}
        >
          <Users size={17} />
          <span>Radnici</span>
          <span className={styles.tabBadge}>{workersData?.workers?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'operacije' ? styles.tabBtnActive : ''}`}
          onClick={() => handleTabChange('operacije')}
        >
          <Settings size={17} />
          <span>Operacije</span>
          <span className={styles.tabBadge}>{workTypesData?.workTypes?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'kulture' ? styles.tabBtnActive : ''}`}
          onClick={() => handleTabChange('kulture')}
        >
          <Sprout size={17} />
          <span>Kulture & Sorte</span>
          <span className={styles.tabBadge}>{cropsData?.crops?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'partneri' ? styles.tabBtnActive : ''}`}
          onClick={() => handleTabChange('partneri')}
        >
          <Handshake size={17} />
          <span>Partneri</span>
          <span className={styles.tabBadge}>{partnersData?.partners?.length || 0}</span>
        </button>
      </div>

      {/* Toolbar sa pretragom, filterima i dugmetom Dodaj */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.searchBox}>
            <Search size={18} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder={`Pretraži ${activeTab}...`}
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          {activeTab === 'masine' && (
            <>
              <div style={{ minWidth: 175, flex: '0 0 auto' }}>
                <CustomSelect
                  value={filterMachineType}
                  onChange={(val) => {
                    setFilterMachineType(val);
                    setPage(1);
                  }}
                  options={FILTER_MACHINE_TYPE_OPTIONS}
                  searchable={false}
                />
              </div>
              <div style={{ minWidth: 170, flex: '0 0 auto' }}>
                <CustomSelect
                  value={filterMachineStatus}
                  onChange={(val) => {
                    setFilterMachineStatus(val);
                    setPage(1);
                  }}
                  options={FILTER_MACHINE_STATUS_OPTIONS}
                  searchable={false}
                />
              </div>
            </>
          )}

          {activeTab === 'radnici' && (
            <div style={{ minWidth: 180, flex: '0 0 auto' }}>
              <CustomSelect
                value={filterWorkerType}
                onChange={(val) => {
                  setFilterWorkerType(val);
                  setPage(1);
                }}
                options={FILTER_WORKER_TYPE_OPTIONS}
                searchable={false}
              />
            </div>
          )}

          {activeTab === 'operacije' && (
            <div style={{ minWidth: 210, flex: '0 0 auto' }}>
              <CustomSelect
                value={filterWorkCategory}
                onChange={(val) => {
                  setFilterWorkCategory(val);
                  setPage(1);
                }}
                options={FILTER_WORK_CATEGORY_OPTIONS}
                searchable={false}
              />
            </div>
          )}

          {activeTab === 'partneri' && (
            <div style={{ minWidth: 190, flex: '0 0 auto' }}>
              <CustomSelect
                value={filterPartnerType}
                onChange={(val) => {
                  setFilterPartnerType(val);
                  setPage(1);
                }}
                options={FILTER_PARTNER_TYPE_OPTIONS}
                searchable={false}
              />
            </div>
          )}
        </div>

        <button className={styles.addBtn} onClick={openAddModal}>
          <Plus size={18} />
          <span>Dodaj</span>
        </button>
      </div>

      {/* TABLE CONTENT BY TAB */}
      <div className={styles.tableWrapper}>
        {isLoading ? (
          <div className={styles.emptyState}>
            <Loader2 size={32} className={styles.spinner} />
            <div className={styles.emptyText}>Učitavanje podataka...</div>
          </div>
        ) : (
          <>
            {/* 1. PARCELE */}
            {activeTab === 'parcele' && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Šifra</th>
                    <th>Naziv parcele</th>
                    <th>Površina (ha)</th>
                    <th>Lokacija</th>
                    <th>Trenutna kultura</th>
                    <th className={styles.thActions}>Akcije</th>
                  </tr>
                </thead>
                <tbody>
                  {parcels.length === 0 ? (
                    <tr><td colSpan={6} className={styles.emptyState}>Nema unetih parcela</td></tr>
                  ) : (
                    paginatedParcels.map((p: any) => (
                      <tr key={p.id}>
                        <td><span className={styles.codeBadge}>{p.code}</span></td>
                        <td><strong className={styles.primaryText}>{p.name}</strong><span className={styles.secondaryText}>{p.notes || ''}</span></td>
                        <td><span className={styles.numberText}>{p.areaHa} ha</span></td>
                        <td><span className={styles.secondaryText}>{p.location || '—'}</span></td>
                        <td>
                          {p.currentCrop ? (
                            <span className={`${styles.pill} ${styles.pillGreen}`}>{p.currentCrop}</span>
                          ) : (
                            <span className={styles.secondaryText}>Ugar / Slobodno</span>
                          )}
                        </td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.actionBtn} onClick={() => openEditModal(p)} title="Izmeni"><Pencil size={15} /></button>
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              onClick={() =>
                                openDeleteModal({
                                  id: p.id,
                                  name: p.name,
                                  tab: 'parcele',
                                  details: [
                                    { label: 'Šifra parcele', value: p.code },
                                    { label: 'Površina', value: `${p.areaHa} ha` },
                                    { label: 'Trenutna kultura', value: p.currentCrop || 'Ugar / Slobodno' },
                                    ...(p.location ? [{ label: 'Lokacija', value: p.location }] : []),
                                  ],
                                })
                              }
                              title="Obriši"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {/* 2. MAŠINE */}
            {activeTab === 'masine' && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Mašina</th>
                    <th>Tip</th>
                    <th>Registracija</th>
                    <th>Kapacitet rezervoara</th>
                    <th>Radni sati (h)</th>
                    <th>Status</th>
                    <th className={styles.thActions}>Akcije</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.length === 0 ? (
                    <tr><td colSpan={7} className={styles.emptyState}>Nema unetih mašina</td></tr>
                  ) : (
                    paginatedMachines.map((m: any) => (
                      <tr key={m.id}>
                        <td>
                          <strong className={styles.primaryText}>{m.name}</strong>
                          <span className={styles.secondaryText}>{m.brandModel || ''} {m.year ? `(${m.year})` : ''}</span>
                        </td>
                        <td><span className={`${styles.pill} ${styles.pillBlue}`}>{m.type}</span></td>
                        <td><span className={styles.codeBadge}>{m.regNumber || '—'}</span></td>
                        <td>
                          <span className={styles.numberText} style={{ fontWeight: 600, color: '#16a34a' }}>
                            {m.tankCapacityLiters ? `${m.tankCapacityLiters} L` : '—'}
                          </span>
                        </td>
                        <td><span className={styles.numberText}>{m.currentHours} h</span></td>
                        <td>
                          <span className={`${styles.pill} ${m.status === 'SLOBODNA' ? styles.pillGreen :
                            m.status === 'ZADUZENA' ? styles.pillAmber :
                              m.status === 'U_KVARU' ? styles.pillRed : styles.pillPurple
                            }`}>
                            {m.status}
                          </span>
                        </td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.actionBtn} onClick={() => openEditModal(m)} title="Izmeni"><Pencil size={15} /></button>
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              onClick={() =>
                                openDeleteModal({
                                  id: m.id,
                                  name: m.name,
                                  tab: 'masine',
                                  details: [
                                    { label: 'Tip mašine', value: m.type },
                                    ...(m.brandModel ? [{ label: 'Marka i model', value: m.brandModel }] : []),
                                    ...(m.regNumber ? [{ label: 'Registracija', value: m.regNumber }] : []),
                                    { label: 'Status', value: m.status },
                                  ],
                                })
                              }
                              title="Obriši"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {/* 3. RADNICI */}
            {activeTab === 'radnici' && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Radnik</th>
                    <th>Uloga / Pozicija</th>
                    <th>Mesto / Grad</th>
                    <th>Dnevnica (RSD)</th>
                    <th>Kontakt telefon</th>
                    <th>Povezan nalog</th>
                    <th className={styles.thActions}>Akcije</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.length === 0 ? (
                    <tr><td colSpan={7} className={styles.emptyState}>Nema unetih radnika za zadate filtere</td></tr>
                  ) : (
                    paginatedWorkers.map((w: any) => {
                      const wRole = w.role || w.user?.role || (w.type === 'SEZONAC' ? 'SEZONAC' : 'OPERATER');
                      const canEdit = canModifyWorker(w);

                      return (
                        <tr key={w.id}>
                          <td><strong className={styles.primaryText}>{w.name}</strong></td>
                          <td>
                            <span className={`${styles.pill} ${
                              wRole === 'RUKOVODILAC' ? styles.pillPurple :
                              wRole === 'MAGACIN' ? styles.pillCyan :
                              wRole === 'MEHANICAR' ? styles.pillRed :
                              wRole === 'SEZONAC' ? styles.pillAmber : styles.pillBlue
                            }`}>
                              {wRole === 'RUKOVODILAC' ? 'Rukovodilac' :
                               wRole === 'MAGACIN' ? 'Magacioner' :
                               wRole === 'MEHANICAR' ? 'Mehaničar' :
                               wRole === 'SEZONAC' ? 'Sezonac' : 'Operater'}
                            </span>
                          </td>
                          <td><span className={styles.secondaryText}>{w.city || '—'}</span></td>
                          <td>
                            {wRole === 'SEZONAC' ? (
                              <span className={styles.numberText} style={{ color: '#d97706' }}>
                                {w.dailyWage ? `${Number(w.dailyWage).toLocaleString('sr-RS')} RSD` : 'Nije uneta'}
                              </span>
                            ) : (
                              <span className={styles.secondaryText}>—</span>
                            )}
                          </td>
                          <td><span className={styles.secondaryText}>{w.phone || '—'}</span></td>
                          <td>
                            {w.user?.email ? (
                              <span className={styles.codeBadge}>{w.user.email}</span>
                            ) : (
                              <span className={styles.secondaryText}>Nema login nalog</span>
                            )}
                          </td>
                          <td>
                            <div className={styles.actionBtns}>
                              <button
                                className={`${styles.actionBtn} ${!canEdit ? styles.actionBtnDisabled : ''}`}
                                onClick={() => canEdit && openEditModal(w)}
                                title={canEdit ? 'Izmeni' : 'Samo direktor može menjati ovog radnika'}
                                disabled={!canEdit}
                              >
                                <Pencil size={15} />
                              </button>
                              <button
                                className={`${styles.actionBtn} ${styles.actionBtnDanger} ${!canEdit ? styles.actionBtnDisabled : ''}`}
                                onClick={() =>
                                  canEdit &&
                                  openDeleteModal({
                                    id: w.id,
                                    name: w.name,
                                    tab: 'radnici',
                                    details: [
                                      {
                                        label: 'Uloga / Pozicija',
                                        value:
                                          wRole === 'RUKOVODILAC'
                                            ? 'Rukovodilac'
                                            : wRole === 'MAGACIN'
                                            ? 'Magacioner'
                                            : wRole === 'MEHANICAR'
                                            ? 'Mehaničar'
                                            : wRole === 'SEZONAC'
                                            ? 'Sezonski radnik'
                                            : 'Operater',
                                      },
                                      ...(w.city ? [{ label: 'Grad / Mesto', value: w.city }] : []),
                                      ...(w.phone ? [{ label: 'Telefon', value: w.phone }] : []),
                                    ],
                                  })
                                }
                                title={canEdit ? 'Obriši' : 'Samo direktor može obrisati ovog radnika'}
                                disabled={!canEdit}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}

            {/* 4. OPERACIJE */}
            {activeTab === 'operacije' && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Naziv operacije</th>
                    <th>Kategorija rada</th>
                    <th>Jedinica mere</th>
                    <th className={styles.thActions}>Akcije</th>
                  </tr>
                </thead>
                <tbody>
                  {workTypes.length === 0 ? (
                    <tr><td colSpan={4} className={styles.emptyState}>Nema unetih operacija</td></tr>
                  ) : (
                    paginatedWorkTypes.map((wt: any) => (
                      <tr key={wt.id}>
                        <td><strong className={styles.primaryText}>{wt.name}</strong></td>
                        <td><span className={`${styles.pill} ${styles.pillPurple}`}>{wt.category}</span></td>
                        <td><span className={styles.codeBadge}>{wt.unit}</span></td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.actionBtn} onClick={() => openEditModal(wt)} title="Izmeni"><Pencil size={15} /></button>
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              onClick={() =>
                                openDeleteModal({
                                  id: wt.id,
                                  name: wt.name,
                                  tab: 'operacije',
                                  details: [
                                    { label: 'Kategorija rada', value: wt.category },
                                    { label: 'Jedinica mere', value: wt.unit },
                                  ],
                                })
                              }
                              title="Obriši"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {/* 5. KULTURE */}
            {activeTab === 'kulture' && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Kultura</th>
                    <th>Sorta / Hibrid</th>
                    <th>Napomena</th>
                    <th className={styles.thActions}>Akcije</th>
                  </tr>
                </thead>
                <tbody>
                  {crops.length === 0 ? (
                    <tr><td colSpan={4} className={styles.emptyState}>Nema unetih kultura</td></tr>
                  ) : (
                    paginatedCrops.map((c: any) => (
                      <tr key={c.id}>
                        <td><strong className={styles.primaryText}>{c.name}</strong></td>
                        <td><span className={`${styles.pill} ${styles.pillGreen}`}>{c.variety || '—'}</span></td>
                        <td><span className={styles.secondaryText}>{c.notes || '—'}</span></td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.actionBtn} onClick={() => openEditModal(c)} title="Izmeni"><Pencil size={15} /></button>
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              onClick={() =>
                                openDeleteModal({
                                  id: c.id,
                                  name: c.name + (c.variety ? ` (${c.variety})` : ''),
                                  tab: 'kulture',
                                  details: [
                                    { label: 'Naziv kulture', value: c.name },
                                    ...(c.variety ? [{ label: 'Sorta / Hibrid', value: c.variety }] : []),
                                    ...(c.notes ? [{ label: 'Napomena', value: c.notes }] : []),
                                  ],
                                })
                              }
                              title="Obriši"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            {/* 6. PARTNERI */}
            {activeTab === 'partneri' && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Partner / Firma</th>
                    <th>Tip</th>
                    <th>PIB</th>
                    <th>Telefon</th>
                    <th>Email</th>
                    <th>Adresa</th>
                    <th className={styles.thActions}>Akcije</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.length === 0 ? (
                    <tr><td colSpan={7} className={styles.emptyState}>Nema unetih partnera</td></tr>
                  ) : (
                    paginatedPartners.map((pt: any) => (
                      <tr key={pt.id}>
                        <td><strong className={styles.primaryText}>{pt.name}</strong></td>
                        <td>
                          <span className={`${styles.pill} ${pt.type === 'KUPAC' ? styles.pillGreen :
                            pt.type === 'DOBAVLJAC' ? styles.pillBlue : styles.pillAmber
                            }`}>
                            {pt.type}
                          </span>
                        </td>
                        <td><span className={styles.codeBadge}>{pt.pib || '—'}</span></td>
                        <td><span className={styles.secondaryText}>{pt.phone || '—'}</span></td>
                        <td><span className={styles.secondaryText}>{pt.email || '—'}</span></td>
                        <td><span className={styles.secondaryText}>{pt.address || '—'}</span></td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.actionBtn} onClick={() => openEditModal(pt)} title="Izmeni"><Pencil size={15} /></button>
                            <button
                              className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                              onClick={() =>
                                openDeleteModal({
                                  id: pt.id,
                                  name: pt.name,
                                  tab: 'partneri',
                                  details: [
                                    { label: 'Tip partnera', value: pt.type },
                                    ...(pt.pib ? [{ label: 'PIB', value: pt.pib }] : []),
                                    ...(pt.phone ? [{ label: 'Telefon', value: pt.phone }] : []),
                                    ...(pt.email ? [{ label: 'Email', value: pt.email }] : []),
                                    ...(pt.address ? [{ label: 'Adresa', value: pt.address }] : []),
                                  ],
                                })
                              }
                              title="Obriši"
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </>
        )}

        {!isLoading && totalItems > 0 && (
          <TablePagination
            currentPage={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            itemName={getItemName(activeTab)}
          />
        )}
      </div>

      {/* ===== UNIVERZALNI MODAL ZA DODAVANJE I IZMENU ===== */}
      {modalOpen && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {editingItem ? 'Izmeni zapis' : `Novi unos (${activeTab})`}
              </h3>
              <button className={styles.modalClose} onClick={closeModal}><X size={18} /></button>
            </div>

            <div className={styles.modalBody}>
              {/* FORMA PARCELE */}
              {activeTab === 'parcele' && (
                <>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Šifra parcele (npr. P-01)</label>
                      <input className={styles.formInput} value={form.code || ''} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Površina u ha</label>
                      <input className={styles.formInput} type="number" step="0.1" value={form.areaHa || ''} onChange={(e) => setForm({ ...form, areaHa: e.target.value })} required />
                    </div>
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Naziv parcele</label>
                    <input className={styles.formInput} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="npr. Potes Lug" required />
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Lokacija / KO</label>
                      <input className={styles.formInput} value={form.location || ''} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="KO Bački Petrovac" />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Trenutna kultura</label>
                      <CustomSelect
                        value={form.currentCrop || ''}
                        onChange={(val) => setForm({ ...form, currentCrop: val })}
                        options={cropSelectOptions}
                        placeholder="— Izaberite kulturu —"
                        searchable={true}
                      />
                    </div>
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Napomena</label>
                    <textarea className={styles.formTextarea} rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </>
              )}

              {/* FORMA MAŠINE */}
              {activeTab === 'masine' && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Naziv mašine</label>
                    <input className={styles.formInput} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="John Deere 6155M" required />
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Tip mašine</label>
                      <CustomSelect
                        value={form.type || 'TRAKTOR'}
                        onChange={(val) => setForm({ ...form, type: val })}
                        options={MACHINE_TYPE_OPTIONS}
                        searchable={false}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Status</label>
                      <CustomSelect
                        value={form.status || 'SLOBODNA'}
                        onChange={(val) => setForm({ ...form, status: val })}
                        options={MACHINE_STATUS_OPTIONS}
                        searchable={false}
                      />
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Registracija / Inv. broj</label>
                      <input className={styles.formInput} value={form.regNumber || ''} onChange={(e) => setForm({ ...form, regNumber: e.target.value })} placeholder="npr. NS-123-AB" />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Kapacitet rezervoara (L)</label>
                      <input
                        className={styles.formInput}
                        type="number"
                        step="1"
                        min="0"
                        value={form.tankCapacityLiters ?? ''}
                        onChange={(e) => setForm({ ...form, tankCapacityLiters: e.target.value })}
                        placeholder="npr. 250 (max litara goriva)"
                      />
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Trenutni radni sati (h)</label>
                      <input className={styles.formInput} type="number" step="1" value={form.currentHours ?? 0} onChange={(e) => setForm({ ...form, currentHours: e.target.value })} />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Marka i model (opciono)</label>
                      <input className={styles.formInput} value={form.brandModel || ''} onChange={(e) => setForm({ ...form, brandModel: e.target.value })} placeholder="npr. 6155M / MTZ 82.1" />
                    </div>
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Broj ENP taga za putarine (opciono, za kamione/vozila)</label>
                    <input className={styles.formInput} value={form.enpTagNumber || ''} onChange={(e) => setForm({ ...form, enpTagNumber: e.target.value })} placeholder="npr. ENP-104288" />
                  </div>
                </>
              )}

              {/* FORMA RADNICI */}
              {activeTab === 'radnici' && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Ime i prezime radnika *</label>
                    <input
                      className={styles.formInput}
                      value={form.name || ''}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="npr. Marko Marković"
                      required
                    />
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Pozicija / Uloga *</label>
                      <CustomSelect
                        value={form.role || 'OPERATER'}
                        onChange={(val) => setForm({ ...form, role: val })}
                        options={availableWorkerRoleOptions}
                        searchable={false}
                      />
                      {!isDirektor && (
                        <span style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'block' }}>
                          * Samo direktor ima ovlašćenje da dodeljuje ulogu rukovodioca.
                        </span>
                      )}
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Kontakt telefon</label>
                      <input
                        className={styles.formInput}
                        value={form.phone || ''}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder="+381 64..."
                      />
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>
                        Grad / Mesto stanovanja {form.role === 'SEZONAC' ? '*' : '(opciono)'}
                      </label>
                      <input
                        className={styles.formInput}
                        value={form.city || ''}
                        onChange={(e) => setForm({ ...form, city: e.target.value })}
                        placeholder="npr. Bački Petrovac, Kulpin, Gložan"
                        required={form.role === 'SEZONAC'}
                      />
                    </div>
                    {form.role === 'SEZONAC' ? (
                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>Dnevnica (RSD) - opciono</label>
                        <input
                          className={styles.formInput}
                          type="number"
                          step="100"
                          min="0"
                          value={form.dailyWage ?? ''}
                          onChange={(e) => setForm({ ...form, dailyWage: e.target.value })}
                          placeholder="npr. 4000 (RSD po danu)"
                        />
                      </div>
                    ) : (
                      <div className={styles.formGroup}>
                        <label className={styles.formLabel}>Status angažovanja</label>
                        <div
                          style={{
                            padding: '10px 12px',
                            background: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: 8,
                            fontSize: 13,
                            color: '#475569',
                            fontWeight: 500,
                          }}
                        >
                          Stalno zaposlen radnik firme
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* FORMA OPERACIJE */}
              {activeTab === 'operacije' && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Naziv operacije</label>
                    <input className={styles.formInput} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="npr. Duboko oranje" required />
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Kategorija rada</label>
                      <CustomSelect
                        value={form.category || 'OBRADA'}
                        onChange={(val) => setForm({ ...form, category: val })}
                        options={WORK_CATEGORY_OPTIONS}
                        searchable={false}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Podrazumevana jedinica</label>
                      <input className={styles.formInput} value={form.unit || 'ha'} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="ha / tura / sati" />
                    </div>
                  </div>
                </>
              )}

              {/* FORMA KULTURE */}
              {activeTab === 'kulture' && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Naziv kulture</label>
                    <input className={styles.formInput} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Luk žuti" required />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Sorta / Hibrid</label>
                    <input className={styles.formInput} value={form.variety || ''} onChange={(e) => setForm({ ...form, variety: e.target.value })} placeholder="Holandski žuti (Rijnsburger)" />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Napomena</label>
                    <textarea className={styles.formTextarea} rows={2} value={form.notes || ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                  </div>
                </>
              )}

              {/* FORMA PARTNERI */}
              {activeTab === 'partneri' && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Naziv partnera / firme</label>
                    <input className={styles.formInput} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="AgroHemija d.o.o." required />
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Tip partnera</label>
                      <CustomSelect
                        value={form.type || 'KUPAC'}
                        onChange={(val) => setForm({ ...form, type: val })}
                        options={PARTNER_TYPE_OPTIONS}
                        searchable={false}
                      />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>PIB</label>
                      <input className={styles.formInput} value={form.pib || ''} onChange={(e) => setForm({ ...form, pib: e.target.value })} />
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Telefon</label>
                      <input className={styles.formInput} value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Email</label>
                      <input className={styles.formInput} type="email" value={form.email || ''} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                  </div>
                </>
              )}

              <div className={styles.modalActions}>
                <button className={styles.modalCancelBtn} onClick={closeModal} type="button">Otkaži</button>
                <button
                  className={styles.modalSaveBtn}
                  onClick={handleSave}
                  disabled={saveMutation.isPending}
                  type="button"
                >
                  {saveMutation.isPending ? 'Čuvanje...' : 'Sačuvaj'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== UNIVERZALNI MODAL ZA POTVRDU BRISANJA ===== */}
      {itemToDelete && (
        <div className={styles.modalOverlay} onClick={closeDeleteModal}>
          <div
            className={`${styles.modal} ${styles.deleteModal}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.deleteModalHeader}>
              <div className={styles.deleteModalTitle}>
                <div className={styles.deleteModalIcon}>
                  <Trash2 size={20} />
                </div>
                <span>Potvrda brisanja</span>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={closeDeleteModal}
                disabled={deleteMutation.isPending}
                aria-label="Zatvori"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.deleteModalBody}>
              <p className={styles.deleteModalPrompt}>
                Da li ste sigurni da želite da obrišete {getTabSingular(itemToDelete.tab)}?
              </p>

              <div className={styles.deleteTargetCard}>
                <div className={styles.deleteTargetName}>{itemToDelete.name}</div>
                {itemToDelete.details && itemToDelete.details.length > 0 && (
                  <div className={styles.deleteTargetDetailsList}>
                    {itemToDelete.details.map((detail, idx) => (
                      <div key={idx} className={styles.deleteTargetDetailRow}>
                        <span className={styles.deleteTargetDetailLabel}>{detail.label}:</span>
                        <span className={styles.deleteTargetDetailValue}>{detail.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.deleteWarningBox}>
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Ova radnja je nepovratna. Podaci će biti trajno uklonjeni iz šifarnika.
                </span>
              </div>

              <div className={styles.deleteModalActions}>
                <button
                  type="button"
                  className={styles.deleteCancelBtn}
                  onClick={closeDeleteModal}
                  disabled={deleteMutation.isPending}
                >
                  Odustani
                </button>
                <button
                  type="button"
                  className={styles.deleteConfirmBtn}
                  onClick={confirmDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? (
                    <>
                      <Loader2 size={16} className={styles.spinner} />
                      <span>Brisanje...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 size={16} />
                      <span>Potvrdi brisanje</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
};

export default SifarniciHub;
