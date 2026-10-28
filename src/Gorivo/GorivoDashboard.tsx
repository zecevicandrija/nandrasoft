import React, { useState, useEffect } from 'react';
import {
  Fuel,
  Plus,
  Truck,
  Building2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  RefreshCw,
  Trash2,
  ShieldAlert,
  Pencil,
  History,
  Lock,
  Clock,
  Eye,
  User,
  Calendar,
  Wrench,
  Receipt,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { useSession } from '../lib/auth-client';
import CustomSelect from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { NovoTocenjeModal } from './NovoTocenjeModal';
import { PrijemCisterneModal } from './PrijemCisterneModal';
import { IzmeniTocenjeModal } from './IzmeniTocenjeModal';
import { PregledRacunaModal } from './PregledRacunaModal';
import styles from './GorivoDashboard.module.css';

const API = 'http://localhost:5000/api';

interface FuelStats {
  tank: {
    capacity: number;
    currentLiters: number;
    fillPercentage: number;
    totalSuppliedLiters: number;
    dispensedCisternaLiters: number;
    isLow: boolean;
    avgCostPerLiter?: number;
    currentTankValueRSD?: number;
    totalSuppliedCost?: number;
  };
  monthStats: {
    totalLiters: number;
    bySource: {
      CISTERNA: number;
      PUMPA: number;
      KANISTER: number;
    };
    totalCostRSD?: number;
  };
  anomaliesCount: number;
}

interface FuelEntry {
  id: string;
  date: string;
  fuelSource: 'CISTERNA' | 'PUMPA' | 'KANISTER';
  gasStation?: 'PETROL' | 'EUROPETROL' | string;
  fuelType: string;
  liters: number;
  pricePerLiter?: number | null;
  totalCost?: number | null;
  receiptImageUrl?: string | null;
  hasAnomaly: boolean;
  anomalyReason?: string;
  receiptNumber?: string;
  notes?: string;
  calculatedLPerHa?: number;
  fuelNorm?: number;
  isToday?: boolean;
  canEdit?: boolean;
  machine: {
    id: string;
    name: string;
    type: string;
    brandModel?: string;
    tankCapacityLiters?: number;
    currentHours?: number;
  };
  worker: {
    id: string;
    name: string;
    type: string;
  };
  fieldWork?: {
    id: string;
    areaDoneHa: number;
    date: string;
    workType?: {
      id: string;
      name: string;
      fuelNormLitersPerHa?: number;
    };
    parcel?: {
      id: string;
      name: string;
      code: string;
      areaHa: number;
    };
  };
  createdBy: {
    id: string;
    name: string;
    role: string;
  };
}

interface FuelSupply {
  id: string;
  date: string;
  fuelType: string;
  liters: number;
  pricePerLiter?: number;
  totalCost?: number;
  supplierName?: string;
  receiptNumber?: string;
  notes?: string;
  supplier?: {
    id: string;
    name: string;
  };
  createdBy: {
    id: string;
    name: string;
  };
}

interface LPerHaAnalytic {
  workTypeId: string;
  workTypeName: string;
  category: string;
  normLPerHa: number | null;
  totalLiters: number;
  totalHa: number;
  actualLPerHa: number | null;
  variancePercent: number | null;
  status: 'OPTIMALNO' | 'UPOZORENJE' | 'ANOMALIJA' | 'NEMA_PODATAKA';
  entriesCount: number;
}

interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const renderPumpBadge = (entry: FuelEntry) => {
  let badgeClass = styles.badgePumpa;
  let label = 'Javna pumpa';

  if (entry.gasStation === 'PETROL') {
    badgeClass = styles.badgePetrol;
    label = 'Pumpa (PETROL)';
  } else if (entry.gasStation === 'EUROPETROL') {
    badgeClass = styles.badgeEuropetrol;
    label = 'Pumpa (EUROPETROL)';
  }

  return (
    <span className={`${styles.sourceBadge} ${badgeClass}`}>
      <Fuel size={13} />
      {label}
    </span>
  );
};

const GorivoDashboard: React.FC = () => {
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const userRole = currentUser?.role || 'OPERATER';
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(userRole);

  // Tabovi za rukovodioce
  const [activeTab, setActiveTab] = useState<'TOCENJA' | 'CISTERNA' | 'ANALITIKA' | 'ANOMALIJE'>('TOCENJA');

  type PeriodType = 'danas' | 'nedelja' | 'mesec' | 'sve' | 'custom';
  const PAGE_SIZE = 25;

  // Brzi period filter (Danas, Ova Nedelja, Ovaj Mesec, Svi Unosi, Prilagođen Raspon)
  const [period, setPeriod] = useState<PeriodType>('sve');
  const [suppliesPage, setSuppliesPage] = useState(1);
  const [analyticsPage, setAnalyticsPage] = useState(1);
  const [anomaliesPage, setAnomaliesPage] = useState(1);

  // Stanje za Rukovodioce (Menadžere)
  const [stats, setStats] = useState<FuelStats | null>(null);
  const [managerEntries, setManagerEntries] = useState<FuelEntry[]>([]);
  const [managerPagination, setManagerPagination] = useState<PaginationMeta | null>(null);
  const [managerPage, setManagerPage] = useState(1);
  const [supplies, setSupplies] = useState<FuelSupply[]>([]);
  const [analytics, setAnalytics] = useState<LPerHaAnalytic[]>([]);
  const [anomalies, setAnomalies] = useState<FuelEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Filteri za menadžere
  const [searchFilter, setSearchFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Promena perioda
  const handlePeriodChange = (newPeriod: PeriodType) => {
    setPeriod(newPeriod);
    setManagerPage(1);
    setSuppliesPage(1);
    setAnalyticsPage(1);
    setAnomaliesPage(1);

    const now = new Date();
    const formatYMD = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (newPeriod === 'danas') {
      const today = formatYMD(now);
      setDateFrom(today);
      setDateTo(today);
    } else if (newPeriod === 'nedelja') {
      const day = now.getDay();
      const diff = (day === 0 ? -6 : 1) - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diff);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      setDateFrom(formatYMD(monday));
      setDateTo(formatYMD(sunday));
    } else if (newPeriod === 'mesec') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setDateFrom(formatYMD(firstDay));
      setDateTo(formatYMD(lastDay));
    } else if (newPeriod === 'sve') {
      setDateFrom('');
      setDateTo('');
    }
  };

  // Stanje za Radnike (Operatere)
  const [todayEntries, setTodayEntries] = useState<FuelEntry[]>([]);
  const [todayLoading, setTodayLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<FuelEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPagination, setHistoryPagination] = useState<PaginationMeta | null>(null);

  // Šifarnici za modale i filtere
  const [machines, setMachines] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [partners, setPartners] = useState<any[]>([]);

  // Modali
  const [isTocenjeModalOpen, setIsTocenjeModalOpen] = useState(false);
  const [isSupplyModalOpen, setIsSupplyModalOpen] = useState(false);
  const [isIzmeniModalOpen, setIsIzmeniModalOpen] = useState(false);
  const [selectedEntryForEdit, setSelectedEntryForEdit] = useState<FuelEntry | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [selectedEntryForReceipt, setSelectedEntryForReceipt] = useState<FuelEntry | null>(null);

  // 1. Učitavanje šifarnika (zajedničko)
  useEffect(() => {
    const fetchMasterData = async () => {
      try {
        const [mRes, wRes, ptRes] = await Promise.all([
          fetch(`${API}/master/machines`, { credentials: 'include' }),
          fetch(`${API}/master/workers`, { credentials: 'include' }),
          fetch(`${API}/master/partners`, { credentials: 'include' }),
        ]);

        if (mRes.ok) {
          const data = await mRes.json();
          setMachines(data.machines || []);
        }
        if (wRes.ok) {
          const data = await wRes.json();
          setWorkers(data.workers || []);
        }
        if (ptRes.ok) {
          const data = await ptRes.json();
          setPartners(data.partners || []);
        }
      } catch (err) {
        console.error('Greška pri učitavanju šifarnika:', err);
      }
    };

    fetchMasterData();
  }, []);

  // 2. FUNKCIJE ZA RUKOVODIOCE (DIREKTOR / RUKOVODILAC)
  const fetchStats = async () => {
    try {
      const res = await fetch(`${API}/fuel/stats`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju statistike goriva:', err);
    }
  };

  const fetchManagerEntries = async (page = 1) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));
      if (machineFilter) params.set('machineId', machineFilter);
      if (workerFilter) params.set('workerId', workerFilter);
      if (sourceFilter) params.set('fuelSource', sourceFilter);
      if (onlyAnomalies) params.set('hasAnomaly', 'true');
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const res = await fetch(`${API}/fuel/entries?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setManagerEntries(data.entries || []);
        if (data.pagination) {
          setManagerPagination(data.pagination);
          setManagerPage(data.pagination.page);
        }
      }
    } catch (err) {
      console.error('Greška pri dohvatanju točenja:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSupplies = async () => {
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`${API}/fuel/supplies?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setSupplies(data.supplies || []);
        setSuppliesPage(1);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju prijema cisterni:', err);
    }
  };

  const fetchAnalytics = async () => {
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`${API}/fuel/analytics/l-per-ha?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data.analytics || []);
        setAnalyticsPage(1);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju L/ha analitike:', err);
    }
  };

  const fetchAnomalies = async () => {
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`${API}/fuel/anomalies?${params.toString()}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAnomalies(data.anomalies || []);
        setAnomaliesPage(1);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju anomalija:', err);
    }
  };

  const refreshAllManager = async () => {
    setLoading(true);
    await Promise.all([
      fetchStats(),
      fetchManagerEntries(managerPage),
      fetchSupplies(),
      fetchAnalytics(),
      fetchAnomalies(),
    ]);
    setLoading(false);
  };

  // 3. FUNKCIJE ZA RADNIKE (OPERATER)
  const fetchTodayEntries = async () => {
    try {
      setTodayLoading(true);
      const res = await fetch(`${API}/fuel/entries?scope=today&limit=50`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTodayEntries(data.entries || []);
      }
    } catch (err) {
      console.error('Greška pri dohvatanju današnjih točenja:', err);
    } finally {
      setTodayLoading(false);
    }
  };

  const fetchHistoryEntries = async (page = 1) => {
    try {
      setHistoryLoading(true);
      const res = await fetch(`${API}/fuel/entries?scope=history&page=${page}&limit=${PAGE_SIZE}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setHistoryEntries(data.entries || []);
        setHasLoadedHistory(true);
        if (data.pagination) {
          setHistoryPagination(data.pagination);
          setHistoryPage(data.pagination.page);
        }
      }
    } catch (err) {
      console.error('Greška pri dohvatanju prethodnih točenja:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // 4. Glavni efekat učitavanja u zavisnosti od uloge
  useEffect(() => {
    if (isManager) {
      fetchStats();
      fetchManagerEntries(1);
      fetchSupplies();
      fetchAnalytics();
      fetchAnomalies();
    } else {
      // Radnik učitava SAMO svoja današnja točenja na početku!
      fetchTodayEntries();
    }
  }, [isManager, machineFilter, workerFilter, sourceFilter, onlyAnomalies, dateFrom, dateTo]);

  // Brisanje točenja (samo menadžer)
  const handleDeleteEntry = async (id: string, machineName: string, liters: number) => {
    if (!window.confirm(`Da li sigurno želite da stornirate točenje ${liters} L u mašinu "${machineName}"?`)) {
      return;
    }
    try {
      const res = await fetch(`${API}/fuel/entries/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        refreshAllManager();
      } else {
        const err = await res.json();
        alert(err.error || 'Greška pri storniranju.');
      }
    } catch (err) {
      console.error(err);
      alert('Greška na serveru.');
    }
  };

  // Brisanje prijema cisterne (samo menadžer)
  const handleDeleteSupply = async (id: string, liters: number) => {
    if (!window.confirm(`Da li sigurno želite da stornirate prijem cisterne od ${liters} L?`)) {
      return;
    }
    try {
      const res = await fetch(`${API}/fuel/supplies/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        refreshAllManager();
      } else {
        const err = await res.json();
        alert(err.error || 'Greška pri storniranju.');
      }
    } catch (err) {
      console.error(err);
      alert('Greška na serveru.');
    }
  };

  // Otvaranje modala za izmenu
  const handleOpenEdit = (entry: FuelEntry) => {
    setSelectedEntryForEdit(entry);
    setIsIzmeniModalOpen(true);
  };

  // Otvaranje modala za pregled slike računa
  const handleOpenReceipt = (entry: FuelEntry) => {
    setSelectedEntryForReceipt(entry);
    setIsReceiptModalOpen(true);
  };

  // Menadžersko pretraživanje
  const filteredManagerEntries = managerEntries.filter((e) => {
    if (!searchFilter) return true;
    const q = searchFilter.toLowerCase();
    return (
      e.machine?.name.toLowerCase().includes(q) ||
      e.worker?.name.toLowerCase().includes(q) ||
      e.notes?.toLowerCase().includes(q) ||
      e.receiptNumber?.toLowerCase().includes(q) ||
      (e.fieldWork?.parcel?.name && e.fieldWork.parcel.name.toLowerCase().includes(q))
    );
  });

  return (
    <AppLayout pageTitle={isManager ? "Evidencija Goriva & Cisterna" : "Dnevnik točenja goriva"}>
      <div className={styles.container}>
        {/* ======================================================== */}
        {/* 1. HEADER BAR                                             */}
        {/* ======================================================== */}
        <div className={styles.headerBar}>
          <div className={styles.titleSection}>
            <h2>
              <Fuel size={26} color="#16a34a" />
              {isManager ? 'Evidencija Goriva & Cisterna' : 'Dnevnik točenja goriva'}
            </h2>
            <p>
              {isManager
                ? 'Praćenje nivoa goriva u litrima, točenja na terenu, normativa L/ha i zaliha cisterne'
                : 'Evidencija sipanja goriva u mašine.'}
            </p>
          </div>

          <div className={styles.headerActions}>
            {isManager && (
              <button
                className={styles.secondaryActionBtn}
                onClick={() => setIsSupplyModalOpen(true)}
              >
                <Truck size={18} />
                <span>Prijem cisterne (Ulaz)</span>
              </button>
            )}

            <button
              className={styles.primaryActionBtn}
              onClick={() => setIsTocenjeModalOpen(true)}
            >
              <Plus size={18} />
              <span>Novo točenje u mašinu</span>
            </button>
          </div>
        </div>

        {/* ======================================================== */}
        {/* 2. POGLED ZA RUKOVODIOCE (DIREKTOR / RUKOVODILAC)        */}
        {/* ======================================================== */}
        {isManager ? (
          <>
            {/* Hero Sekcija: Cisterna Gauge + 3 KPI kartice (SAMO MENADŽER) */}
            <div className={styles.heroGrid}>
              {/* Cisterna Gauge Card */}
              <div className={styles.tankCard}>
                <div className={styles.tankCardHeader}>
                  <div className={styles.tankTitle}>
                    <Building2 size={18} />
                    <span>Cisterna firme</span>
                  </div>
                  <span
                    className={`${styles.tankBadge} ${stats?.tank.isLow ? styles.tankBadgeLow : styles.tankBadgeOptimal
                      }`}
                  >
                    {stats?.tank.isLow ? (
                      <>
                        <AlertTriangle size={12} />
                        Niske zalihe (&lt;20%)
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={12} />
                        Optimalno
                      </>
                    )}
                  </span>
                </div>

                <div className={styles.tankVisualWrapper}>
                  {/* Animiran rezervoar sa nivoom tečnosti */}
                  <div className={styles.tankCylinder}>
                    <div
                      className={`${styles.tankLiquidFill} ${stats?.tank.isLow ? styles.tankLiquidFillLow : ''
                        }`}
                      style={{
                        height: `${Math.max(5, stats?.tank.fillPercentage || 0)}%`,
                      }}
                    />
                    <div className={styles.tankLiquidRuler}>
                      <div className={styles.rulerTick} />
                      <div className={styles.rulerTick} />
                      <div className={styles.rulerTick} />
                      <div className={styles.rulerTick} />
                    </div>
                  </div>

                  <div className={styles.tankFigures}>
                    <div className={styles.tankMainLiters}>
                      {stats ? stats.tank.currentLiters.toLocaleString() : '---'}
                      <span>L</span>
                    </div>
                    <div className={styles.tankCapacitySub}>
                      od {stats ? stats.tank.capacity.toLocaleString() : '10,000'} L kapaciteta
                    </div>
                    <div className={styles.tankFillPct}>
                      {stats ? `${stats.tank.fillPercentage}% popunjeno` : ''}
                    </div>
                  </div>
                </div>

                <div className={styles.tankCardFooter}>
                  <div className={styles.tankMetaItem}>
                    <span className={styles.tankMetaLabel}>Prosečna nabavna:</span>
                    <span className={styles.tankMetaVal}>
                      {stats?.tank.avgCostPerLiter || 171.66} RSD/L
                    </span>
                  </div>
                  <div className={styles.tankMetaItem}>
                    <span className={styles.tankMetaLabel}>Vrednost zaliha:</span>
                    <span className={styles.tankMetaVal}>
                      {stats?.tank.currentTankValueRSD?.toLocaleString() || 0} RSD
                    </span>
                  </div>
                </div>
              </div>

              {/* 3 KPI Kartice */}
              <div className={styles.kpiColumn}>
                {/* KPI 1: Točeno ovog meseca */}
                <div className={styles.kpiCard}>
                  <div className={`${styles.kpiIconBox} ${styles.iconFuel}`}>
                    <Fuel size={26} />
                  </div>
                  <div className={styles.kpiContent}>
                    <span className={styles.kpiLabel}>Točeno ovog meseca</span>
                    <span className={styles.kpiValue}>
                      {stats ? stats.monthStats.totalLiters.toLocaleString() : 0} L
                    </span>
                    <span className={styles.kpiSub}>
                      <Building2 size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                      {stats?.monthStats.bySource.CISTERNA || 0}L cisterna •{' '}
                      <Fuel size={12} style={{ display: 'inline', marginRight: 4, marginLeft: 4, verticalAlign: 'middle' }} />
                      {stats?.monthStats.bySource.PUMPA || 0}L pumpa
                    </span>
                  </div>
                </div>

                {/* KPI 2: Anomalije i nepravilnosti */}
                <div
                  className={styles.kpiCard}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setActiveTab('ANOMALIJE')}
                >
                  <div className={`${styles.kpiIconBox} ${styles.iconAlert}`}>
                    <AlertTriangle size={26} />
                  </div>
                  <div className={styles.kpiContent}>
                    <span className={styles.kpiLabel}>Upitne potrošnje</span>
                    <span className={styles.kpiValue}>
                      {stats?.anomaliesCount || 0}
                    </span>
                    <span className={styles.kpiSub}>
                      {stats && stats.anomaliesCount > 0 ? (
                        <span className={styles.anomalyAlertPill}>
                          <AlertTriangle size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                          Pažnja: detektovane upitne potrošnje
                        </span>
                      ) : (
                        'Sva točenja u granicama normativa'
                      )}
                    </span>
                  </div>
                </div>

                {/* KPI 3: Poređenje normativa L/ha */}
                <div
                  className={styles.kpiCard}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setActiveTab('ANALITIKA')}
                >
                  <div className={`${styles.kpiIconBox} ${styles.iconNorm}`}>
                    <TrendingUp size={26} />
                  </div>
                  <div className={styles.kpiContent}>
                    <span className={styles.kpiLabel}>Cenovnik normativi</span>
                    <span className={styles.kpiValue}>
                      17 operacija
                    </span>
                    <span className={styles.kpiSub}>
                      Oranje: 21 L/ha • Tanjiranje: 11 L/ha →
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Tabovi Ekrana (Samo Menadžer) */}
            <div className={styles.tabsContainer}>
              <button
                className={`${styles.tabBtn} ${activeTab === 'TOCENJA' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('TOCENJA')}
              >
                <Fuel size={17} />
                <span>Dnevnik točenja ({managerPagination?.total ?? managerEntries.length})</span>
              </button>

              <button
                className={`${styles.tabBtn} ${activeTab === 'CISTERNA' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('CISTERNA')}
              >
                <Building2 size={17} />
                <span>Prijem cisterne & Zalihe ({supplies.length})</span>
              </button>

              <button
                className={`${styles.tabBtn} ${activeTab === 'ANALITIKA' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('ANALITIKA')}
              >
                <BarChart3 size={17} />
                <span>Analitika L/ha po operacijama</span>
              </button>

              <button
                className={`${styles.tabBtn} ${activeTab === 'ANOMALIJE' ? styles.tabBtnActive : ''}`}
                onClick={() => setActiveTab('ANOMALIJE')}
              >
                <ShieldAlert size={17} />
                <span>Upitne potrošnje</span>
                {stats && stats.anomaliesCount > 0 && (
                  <span className={styles.tabBadgeAlert}>{stats.anomaliesCount}</span>
                )}
              </button>
            </div>

            {/* Brzi Period Filter (Danas, Ova Nedelja, Ovaj Mesec, Svi Unosi, Prilagođen Raspon) */}
            <div className={styles.periodRowCard}>
              <div className={styles.periodButtonGroup}>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${period === 'danas' ? styles.periodBtnActive : ''}`}
                  onClick={() => handlePeriodChange('danas')}
                >
                  Danas
                </button>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${period === 'nedelja' ? styles.periodBtnActive : ''}`}
                  onClick={() => handlePeriodChange('nedelja')}
                >
                  Ova Nedelja
                </button>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${period === 'mesec' ? styles.periodBtnActive : ''}`}
                  onClick={() => handlePeriodChange('mesec')}
                >
                  Ovaj Mesec
                </button>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${period === 'sve' ? styles.periodBtnActive : ''}`}
                  onClick={() => handlePeriodChange('sve')}
                >
                  Svi Unosi
                </button>
                <button
                  type="button"
                  className={`${styles.periodBtn} ${period === 'custom' ? styles.periodBtnActive : ''}`}
                  onClick={() => handlePeriodChange('custom')}
                >
                  Prilagođen Raspon
                </button>
              </div>

              {period === 'custom' && (
                <div className={styles.customDateRangeBox}>
                  <span>Od:</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      setPeriod('custom');
                      setManagerPage(1);
                      setSuppliesPage(1);
                      setAnalyticsPage(1);
                      setAnomaliesPage(1);
                    }}
                  />
                  <span>Do:</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      setPeriod('custom');
                      setManagerPage(1);
                      setSuppliesPage(1);
                      setAnalyticsPage(1);
                      setAnomaliesPage(1);
                    }}
                  />
                </div>
              )}
            </div>

            {/* TAB 1: Dnevnik Točenja */}
            {activeTab === 'TOCENJA' && (
              <>
                {/* Filter Traka */}
                <div className={styles.filterBar}>
                  <input
                    type="text"
                    placeholder="Pretraži točenja po mašini, radniku..."
                    className={styles.filterInput}
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    style={{ flex: '1 1 200px', minWidth: '180px' }}
                  />

                  <div className={styles.filterSelectWrapper}>
                    <CustomSelect
                      value={machineFilter}
                      onChange={(val) => setMachineFilter(val)}
                      options={[
                        { value: '', label: 'Sve mašine' },
                        ...machines.map((m) => ({
                          value: m.id,
                          label: m.name,
                          subLabel: m.brandModel || m.type,
                        })),
                      ]}
                      placeholder="Sve mašine"
                      searchable
                    />
                  </div>

                  <div className={styles.filterSelectWrapper}>
                    <CustomSelect
                      value={workerFilter}
                      onChange={(val) => setWorkerFilter(val)}
                      options={[
                        { value: '', label: 'Svi radnici' },
                        ...workers.map((w) => ({
                          value: w.id,
                          label: w.name,
                        })),
                      ]}
                      placeholder="Svi radnici"
                      searchable
                    />
                  </div>

                  <div className={styles.filterSelectWrapper}>
                    <CustomSelect
                      value={sourceFilter}
                      onChange={(val) => setSourceFilter(val)}
                      options={[
                        { value: '', label: 'Svi izvori' },
                        { value: 'CISTERNA', label: 'Cisterna firme' },
                        { value: 'PUMPA', label: 'Javna pumpa (Petrol / Europetrol)' },
                        { value: 'KANISTER', label: 'Kanister na njivi' },
                      ]}
                      placeholder="Svi izvori"
                      searchable={false}
                    />
                  </div>

                  <button
                    type="button"
                    className={`${styles.filterAnomalyToggle} ${onlyAnomalies ? styles.filterAnomalyToggleActive : ''}`}
                    onClick={() => setOnlyAnomalies(!onlyAnomalies)}
                  >
                    <AlertTriangle size={15} />
                    <span>Samo upitne potrošnje</span>
                  </button>

                  <button
                    className={styles.refreshBtn}
                    onClick={refreshAllManager}
                    title="Osveži podatke"
                    disabled={loading}
                  >
                    <RefreshCw size={15} className={loading ? styles.spinner : ''} />
                    <span>{loading ? 'Učitavanje...' : 'Osveži'}</span>
                  </button>
                </div>

                {/* Tabela Točenja */}
                <div className={styles.tableContainer}>
                  {filteredManagerEntries.length === 0 ? (
                    <div className={styles.emptyState}>
                      <Fuel size={40} />
                      <div className={styles.emptyStateTitle}>Nema pronađenih zapisa o točenju goriva</div>
                      <p>Kliknite na dugme „Novo točenje u mašinu“ kako biste zabeležili sipanje.</p>
                    </div>
                  ) : (
                    <>
                      <table className={styles.dataTable}>
                        <thead>
                          <tr>
                            <th>Datum</th>
                            <th>Mašina</th>
                            <th>Radnik</th>
                            <th>Količina (L)</th>
                            <th>Izvor točenja</th>
                            <th>Potrošnja L/ha</th>
                            <th>Status & Kontrola</th>
                            <th>Iznos (RSD) & Račun</th>
                            <th>Akcije</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredManagerEntries.map((entry) => {
                            const d = new Date(entry.date);
                            const formattedDate = `${d.toLocaleDateString('sr-RS')} ${d.toLocaleTimeString('sr-RS', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`;

                            return (
                              <tr key={entry.id}>
                                <td>{formattedDate}</td>
                                <td>
                                  <strong>{entry.machine?.name}</strong>
                                  {entry.machine?.brandModel && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                      {entry.machine.brandModel}
                                    </div>
                                  )}
                                </td>
                                <td>{entry.worker?.name}</td>
                                <td>
                                  <span className={styles.amountCell}>{entry.liters}</span>
                                  <span className={styles.amountUnit}>L</span>
                                </td>
                                <td>
                                  {entry.fuelSource === 'CISTERNA' && (
                                    <span className={`${styles.sourceBadge} ${styles.badgeCisterna}`}>
                                      <Building2 size={13} />
                                      Cisterna
                                    </span>
                                  )}
                                  {entry.fuelSource === 'PUMPA' && renderPumpBadge(entry)}
                                  {entry.fuelSource === 'KANISTER' && (
                                    <span className={`${styles.sourceBadge} ${styles.badgeKanister}`}>
                                      <MapPin size={13} />
                                      Kanister
                                    </span>
                                  )}
                                </td>
                                <td>
                                  {entry.calculatedLPerHa ? (
                                    <span
                                      className={
                                        entry.fuelNorm && entry.calculatedLPerHa > entry.fuelNorm * 1.25
                                          ? styles.normBadgeWarning
                                          : styles.normBadgeGood
                                      }
                                    >
                                      {entry.calculatedLPerHa} L/ha
                                      {entry.fuelNorm && ` (norm: ${entry.fuelNorm})`}
                                    </span>
                                  ) : (
                                    '—'
                                  )}
                                </td>
                                <td>
                                  {entry.hasAnomaly ? (
                                    <span
                                      className={styles.anomalyTag}
                                      title={entry.anomalyReason || 'Detektovano odstupanje od normativa'}
                                    >
                                      <AlertTriangle size={13} />
                                      Upitna potrošnja
                                    </span>
                                  ) : (
                                    <span style={{ color: '#059669', fontSize: '0.85rem' }}>
                                      <CheckCircle2 size={14} style={{ display: 'inline', marginRight: 4 }} />
                                      U normi
                                    </span>
                                  )}
                                </td>
                                <td>
                                  <div className={styles.financeReceiptCell}>
                                    {entry.totalCost ? (
                                      <div>
                                        <strong>{entry.totalCost.toLocaleString()} RSD</strong>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                          {entry.pricePerLiter} RSD/L
                                        </div>
                                      </div>
                                    ) : entry.receiptImageUrl ? (
                                      <span className={styles.pendingPriceBadge}>
                                        Čeka unos cene sa računa
                                      </span>
                                    ) : (
                                      '—'
                                    )}
                                    {entry.receiptImageUrl && (
                                      <button
                                        type="button"
                                        className={
                                          entry.totalCost
                                            ? styles.receiptTableBtn
                                            : styles.receiptTableBtnHighlight
                                        }
                                        onClick={() => handleOpenReceipt(entry)}
                                        title={
                                          entry.totalCost
                                            ? 'Pogledaj sliku fiskalnog računa'
                                            : 'Pogledaj račun i unesi cenu'
                                        }
                                      >
                                        <Receipt size={13} />
                                        <span>
                                          {entry.totalCost ? 'Slika računa' : 'Otvori račun & unesi cenu'}
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <div className={styles.actionCell}>
                                    <button
                                      className={styles.editRowBtn}
                                      onClick={() => handleOpenEdit(entry)}
                                      title="Izmeni točenje"
                                    >
                                      <Pencil size={13} />
                                      <span>Izmeni</span>
                                    </button>
                                    <button
                                      className={styles.deleteRowBtn}
                                      onClick={() =>
                                        handleDeleteEntry(entry.id, entry.machine.name, entry.liters)
                                      }
                                      title="Storniraj točenje"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      {/* Paginacija za menadžera (25 po strani sa direktnim unosom) */}
                      <TablePagination
                        currentPage={managerPage}
                        totalPages={managerPagination?.totalPages || 1}
                        totalItems={managerPagination?.total || filteredManagerEntries.length}
                        pageSize={PAGE_SIZE}
                        onPageChange={(p) => {
                          setManagerPage(p);
                          fetchManagerEntries(p);
                        }}
                        itemName="točenja"
                      />
                    </>
                  )}
                </div>
              </>
            )}

            {/* TAB 2: Prijem cisterne & Zalihe */}
            {activeTab === 'CISTERNA' && (
              <div className={styles.tableContainer}>
                {supplies.length === 0 ? (
                  <div className={styles.emptyState}>
                    <Truck size={40} />
                    <div className={styles.emptyStateTitle}>Nema evidentiranih prijema cisterni goriva</div>
                    <p>Kliknite na dugme „Prijem cisterne“ kako biste uneli dovoz goriva od dobavljača.</p>
                  </div>
                ) : (
                  <>
                    <table className={styles.dataTable}>
                      <thead>
                        <tr>
                          <th>Datum prijema</th>
                          <th>Dobavljač</th>
                          <th>Broj otpremnice / računa</th>
                          <th>Količina (L)</th>
                          <th>Cena / L</th>
                          <th>Ukupno RSD</th>
                          <th>Primio</th>
                          <th>Napomena</th>
                          <th>Akcije</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplies
                          .slice((suppliesPage - 1) * PAGE_SIZE, suppliesPage * PAGE_SIZE)
                          .map((s) => (
                            <tr key={s.id}>
                              <td>{new Date(s.date).toLocaleDateString('sr-RS')}</td>
                              <td>
                                <strong>{s.supplierName || s.supplier?.name || 'Dobavljač'}</strong>
                              </td>
                              <td>{s.receiptNumber || '—'}</td>
                              <td>
                                <span className={styles.amountCell}>{s.liters.toLocaleString()}</span>
                                <span className={styles.amountUnit}>L</span>
                              </td>
                              <td>{s.pricePerLiter ? `${s.pricePerLiter.toFixed(2)} RSD` : '—'}</td>
                              <td>
                                <strong>{s.totalCost ? `${s.totalCost.toLocaleString()} RSD` : '—'}</strong>
                              </td>
                              <td>{s.createdBy?.name}</td>
                              <td>{s.notes || '—'}</td>
                              <td>
                                <button
                                  className={styles.deleteRowBtn}
                                  onClick={() => handleDeleteSupply(s.id, s.liters)}
                                  title="Storniraj prijem cisterne"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>

                    <TablePagination
                      currentPage={suppliesPage}
                      totalPages={Math.max(1, Math.ceil(supplies.length / PAGE_SIZE))}
                      totalItems={supplies.length}
                      pageSize={PAGE_SIZE}
                      onPageChange={(p) => setSuppliesPage(p)}
                      itemName="prijema cisterne"
                    />
                  </>
                )}
              </div>
            )}

            {/* TAB 3: Analitika L/ha po operacijama */}
            {activeTab === 'ANALITIKA' && (
              <>
                <div className={styles.analyticsGrid}>
                  {analytics
                    .slice((analyticsPage - 1) * PAGE_SIZE, analyticsPage * PAGE_SIZE)
                    .map((item) => (
                      <div key={item.workTypeId} className={styles.analyticsCard}>
                        <div className={styles.analyticsCardHeader}>
                          <div>
                            <div className={styles.analyticsOpName}>{item.workTypeName}</div>
                            <div className={styles.analyticsCategory}>{item.category}</div>
                          </div>
                          {item.variancePercent !== null && (
                            <span
                              className={
                                item.status === 'ANOMALIJA'
                                  ? styles.normBadgeWarning
                                  : styles.normBadgeGood
                              }
                            >
                              {item.variancePercent > 0 ? `+${item.variancePercent}%` : `${item.variancePercent}%`}
                            </span>
                          )}
                        </div>

                        <div className={styles.analyticsCompareRow}>
                          <div>
                            <span className={styles.tankMetaLabel}>Ostvareno:</span>
                            <div className={styles.actualLiters}>
                              {item.actualLPerHa !== null ? `${item.actualLPerHa} L/ha` : '—'}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span className={styles.tankMetaLabel}>Propisan normativ:</span>
                            <div className={styles.normLiters}>
                              <strong>{item.normLPerHa !== null ? `${item.normLPerHa} L/ha` : 'Nije definisan'}</strong>
                            </div>
                          </div>
                        </div>

                        {/* Progress bar odstupanja */}
                        {item.normLPerHa && item.actualLPerHa && (
                          <div className={styles.varianceBarTrack}>
                            <div
                              className={
                                item.status === 'ANOMALIJA'
                                  ? styles.varianceBarFillBad
                                  : item.status === 'UPOZORENJE'
                                    ? styles.varianceBarFillWarning
                                    : styles.varianceBarFillGood
                              }
                              style={{
                                width: `${Math.min(100, (item.actualLPerHa / (item.normLPerHa * 1.5)) * 100)}%`,
                              }}
                            />
                          </div>
                        )}

                        <div className={styles.analyticsTotals}>
                          <span>Ukupno: {item.totalLiters.toLocaleString()} L</span>
                          <span>Urađeno: {item.totalHa.toLocaleString()} ha</span>
                          <span>Broj točenja: {item.entriesCount}</span>
                        </div>
                      </div>
                    ))}
                </div>

                <div style={{ marginTop: '1rem', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  <TablePagination
                    currentPage={analyticsPage}
                    totalPages={Math.max(1, Math.ceil(analytics.length / PAGE_SIZE))}
                    totalItems={analytics.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={(p) => setAnalyticsPage(p)}
                    itemName="radnih operacija"
                  />
                </div>
              </>
            )}

            {/* TAB 4: Upitne Potrošnje */}
            {activeTab === 'ANOMALIJE' && (
              <>
                <div className={styles.anomalyCardList}>
                  {anomalies.length === 0 ? (
                    <div className={styles.emptyState}>
                      <CheckCircle2 size={44} color="#059669" />
                      <div className={styles.emptyStateTitle}>Nema upitnih potrošnji</div>
                      <p>Sva točenja goriva su usklađena sa normativima iz Cenovnika, kapacitetom mašina i radovima na njivi.</p>
                    </div>
                  ) : (
                    anomalies
                      .slice((anomaliesPage - 1) * PAGE_SIZE, anomaliesPage * PAGE_SIZE)
                      .map((a) => (
                        <div key={a.id} className={styles.anomalyAlertCard}>
                          <div className={styles.anomalyInfo}>
                            <div className={styles.anomalyMachine}>
                              <AlertTriangle size={18} color="#ef4444" />
                              <span>{a.machine.name}</span>
                              <span className={styles.amountCell} style={{ fontSize: '1rem', marginLeft: 8 }}>
                                ({a.liters} L)
                              </span>
                            </div>

                            <div className={styles.anomalyReasonText}>
                              <strong>Razlog detekcije:</strong> {a.anomalyReason || 'Prekoračenje normativa ili točenje bez radnog naloga'}
                            </div>

                            <div className={styles.anomalyMeta}>
                              <span><Calendar size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> {new Date(a.date).toLocaleDateString('sr-RS')}</span>
                              <span><User size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> Točilac: {a.worker.name}</span>
                              <span><Building2 size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> Izvor: {a.fuelSource}{a.gasStation ? ` (${a.gasStation})` : ''}</span>
                              {a.fieldWork?.parcel && <span><MapPin size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> Parcela: {a.fieldWork.parcel.name}</span>}
                              {a.fieldWork?.workType && <span><Wrench size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} /> {a.fieldWork.workType.name}</span>}
                            </div>
                          </div>

                          <button
                            className={styles.deleteRowBtn}
                            onClick={() => handleDeleteEntry(a.id, a.machine.name, a.liters)}
                            title="Storniraj točenje"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      ))
                  )}
                </div>

                {anomalies.length > 0 && (
                  <div style={{ marginTop: '1rem', background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <TablePagination
                      currentPage={anomaliesPage}
                      totalPages={Math.max(1, Math.ceil(anomalies.length / PAGE_SIZE))}
                      totalItems={anomalies.length}
                      pageSize={PAGE_SIZE}
                      onPageChange={(p) => setAnomaliesPage(p)}
                      itemName="upitnih potrošnji"
                    />
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          /* ======================================================== */
          /* 3. POGLED ZA RADNIKE / OPERATERE                         */
          /* ======================================================== */
          <div className={styles.workerSection}>
            {/* SEKCIJA A: Današnja točenja radnika */}
            <div className={styles.workerSectionHeader}>
              <h3 className={styles.workerSectionTitle}>
                <Clock size={20} color="#16a34a" />
                <span>Moja današnja točenja</span>
                <span className={styles.amountUnit}>({todayEntries.length})</span>
              </h3>
            </div>

            <div className={styles.tableContainer}>
              {todayLoading ? (
                <div className={styles.emptyState}>
                  <RefreshCw size={32} className={styles.spinner} color="#16a34a" />
                  <div className={styles.emptyStateTitle}>Učitavanje današnjih točenja...</div>
                </div>
              ) : todayEntries.length === 0 ? (
                <div className={styles.emptyState}>
                  <Fuel size={40} color="#16a34a" />
                  <div className={styles.emptyStateTitle}>Danas još niste evidentirali točenje goriva</div>
                  <p>Kliknite na dugme „Novo točenje u mašinu“ iznad da zabeležite sipanje goriva.</p>
                </div>
              ) : (
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Vreme točenja</th>
                      <th>Mašina</th>
                      <th>Količina (L)</th>
                      <th>Izvor točenja</th>
                      <th>Račun / Iznos</th>
                      <th>Akcije</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayEntries.map((entry) => {
                      const d = new Date(entry.date);
                      const formattedTime = `${d.toLocaleTimeString('sr-RS', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`;

                      return (
                        <tr key={entry.id}>
                          <td>
                            <strong>Danas, {formattedTime}</strong>
                          </td>
                          <td>
                            <strong>{entry.machine?.name}</strong>
                            {entry.machine?.brandModel && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {entry.machine.brandModel}
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={styles.amountCell}>{entry.liters}</span>
                            <span className={styles.amountUnit}>L</span>
                          </td>
                          <td>
                            {entry.fuelSource === 'CISTERNA' && (
                              <span className={`${styles.sourceBadge} ${styles.badgeCisterna}`}>
                                <Building2 size={13} />
                                Cisterna
                              </span>
                            )}
                            {entry.fuelSource === 'PUMPA' && renderPumpBadge(entry)}
                            {entry.fuelSource === 'KANISTER' && (
                              <span className={`${styles.sourceBadge} ${styles.badgeKanister}`}>
                                <MapPin size={13} />
                                Kanister
                              </span>
                            )}
                          </td>
                          <td>
                            <div className={styles.financeReceiptCell}>
                              {entry.totalCost ? (
                                <strong>{entry.totalCost.toLocaleString()} RSD</strong>
                              ) : null}
                              {entry.receiptImageUrl ? (
                                <button
                                  type="button"
                                  className={styles.receiptTableBtn}
                                  onClick={() => handleOpenReceipt(entry)}
                                >
                                  <Receipt size={13} />
                                  <span>Slika računa</span>
                                </button>
                              ) : !entry.totalCost ? (
                                '—'
                              ) : null}
                            </div>
                          </td>
                          <td>
                            <button
                              className={styles.editRowBtn}
                              onClick={() => handleOpenEdit(entry)}
                              title="Izmeni točenje u slučaju greške"
                            >
                              <Pencil size={14} />
                              <span>Izmeni</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* SEKCIJA B: Prethodno sipana goriva (Istorijat) */}
            <div style={{ marginTop: '1rem' }}>
              {!showHistory ? (
                <div className={styles.historyPlaceholderCard}>
                  <History size={42} color="#2563eb" />
                  <h4>Pregled prethodnih sipanja goriva</h4>
                  <button
                    className={styles.historyLoadBtn}
                    onClick={() => {
                      setShowHistory(true);
                      fetchHistoryEntries(1);
                    }}
                  >
                    <Eye size={18} />
                    <span>Prikaži prethodna sipanja</span>
                  </button>
                </div>
              ) : (
                <div className={styles.workerSection}>
                  <div className={styles.workerSectionHeader}>
                    <h3 className={styles.workerSectionTitle}>
                      <History size={20} color="#2563eb" />
                      <span>Istorijat prethodnih sipanja</span>
                      {historyPagination && (
                        <span className={styles.amountUnit}>({historyPagination.total})</span>
                      )}
                    </h3>
                    <span className={styles.statusPillLocked}>
                      <Lock size={12} />
                      Prethodni dani su zaključani — samo pregled
                    </span>
                  </div>

                  <div className={styles.tableContainer}>
                    {historyLoading ? (
                      <div className={styles.emptyState}>
                        <RefreshCw size={32} className={styles.spinner} color="#2563eb" />
                        <div className={styles.emptyStateTitle}>Učitavanje prethodnih točenja...</div>
                      </div>
                    ) : historyEntries.length === 0 ? (
                      <div className={styles.emptyState}>
                        <History size={40} color="#94a3b8" />
                        <div className={styles.emptyStateTitle}>Nema evidentiranih ranijih točenja</div>
                        <p>Vaša istorija sipanja goriva biće prikazana na ovom mestu.</p>
                      </div>
                    ) : (
                      <>
                        <table className={styles.dataTable}>
                          <thead>
                            <tr>
                              <th>Datum točenja</th>
                              <th>Mašina</th>
                              <th>Količina (L)</th>
                              <th>Izvor točenja</th>
                              <th>Status zapisa</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyEntries.map((entry) => {
                              const d = new Date(entry.date);
                              const formattedDate = `${d.toLocaleDateString('sr-RS')} ${d.toLocaleTimeString('sr-RS', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}`;

                              return (
                                <tr key={entry.id}>
                                  <td>{formattedDate}</td>
                                  <td>
                                    <strong>{entry.machine?.name}</strong>
                                    {entry.machine?.brandModel && (
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {entry.machine.brandModel}
                                      </div>
                                    )}
                                  </td>
                                  <td>
                                    <span className={styles.amountCell}>{entry.liters}</span>
                                    <span className={styles.amountUnit}>L</span>
                                  </td>
                                  <td>
                                    {entry.fuelSource === 'CISTERNA' && (
                                      <span className={`${styles.sourceBadge} ${styles.badgeCisterna}`}>
                                        <Building2 size={13} />
                                        Cisterna
                                      </span>
                                    )}
                                    {entry.fuelSource === 'PUMPA' && renderPumpBadge(entry)}
                                    {entry.fuelSource === 'KANISTER' && (
                                      <span className={`${styles.sourceBadge} ${styles.badgeKanister}`}>
                                        <MapPin size={13} />
                                        Kanister
                                      </span>
                                    )}
                                  </td>
                                  <td>
                                    <span className={styles.statusPillLocked} title="Istekao dan unosa — zapis je trajan">
                                      <Lock size={12} />
                                      Zaključano
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>

                        {/* Paginacija za radnika (25 po strani sa direktnim unosom) */}
                        <TablePagination
                          currentPage={historyPage}
                          totalPages={historyPagination?.totalPages || 1}
                          totalItems={historyPagination?.total || historyEntries.length}
                          pageSize={PAGE_SIZE}
                          onPageChange={(page) => {
                            setHistoryPage(page);
                            fetchHistoryEntries(page);
                          }}
                          itemName="prethodnih točenja"
                        />
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 4. MODALI                                                */}
        {/* ======================================================== */}
        {/* Modal 1: Novo Točenje */}
        <NovoTocenjeModal
          isOpen={isTocenjeModalOpen}
          onClose={() => setIsTocenjeModalOpen(false)}
          onSuccess={() => {
            if (isManager) {
              refreshAllManager();
            } else {
              fetchTodayEntries();
              if (hasLoadedHistory) {
                fetchHistoryEntries(historyPage);
              }
            }
          }}
          machines={machines}
          workers={workers}
          tankCurrentLiters={stats ? stats.tank.currentLiters : 0}
          isManager={isManager}
        />

        {/* Modal 2: Prijem Cisterne (Samo Menadžer) */}
        {isManager && (
          <PrijemCisterneModal
            isOpen={isSupplyModalOpen}
            onClose={() => setIsSupplyModalOpen(false)}
            onSuccess={refreshAllManager}
            partners={partners}
            currentTankLiters={stats ? stats.tank.currentLiters : 0}
            tankCapacity={stats ? stats.tank.capacity : 10000}
          />
        )}

        {/* Modal 3: Izmena Točenja (Radnik danas / Menadžer uvek) */}
        <IzmeniTocenjeModal
          isOpen={isIzmeniModalOpen}
          onClose={() => {
            setIsIzmeniModalOpen(false);
            setSelectedEntryForEdit(null);
          }}
          onSuccess={() => {
            if (isManager) {
              refreshAllManager();
            } else {
              fetchTodayEntries();
              if (hasLoadedHistory) {
                fetchHistoryEntries(historyPage);
              }
            }
          }}
          entry={selectedEntryForEdit}
          machines={machines}
          isManager={isManager}
        />

        {/* Modal 4: Pregled Slike Računa & Direktan unos cene */}
        <PregledRacunaModal
          isOpen={isReceiptModalOpen}
          onClose={() => {
            setIsReceiptModalOpen(false);
            setSelectedEntryForReceipt(null);
          }}
          entry={selectedEntryForReceipt}
          isManager={isManager}
          onPriceSaved={() => {
            if (isManager) {
              refreshAllManager();
            } else {
              fetchTodayEntries();
            }
          }}
        />
      </div>
    </AppLayout>
  );
};

export default GorivoDashboard;
