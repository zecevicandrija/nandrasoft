import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { fuelQueryOptions, fuelRequest } from './fuelQueries';
import QueryErrorNotice from '../components/QueryErrorNotice';
import {
  Fuel,
  Plus,
  Truck,
  Building2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  BarChart3,
  RefreshCw,
  Trash2,
  Pencil,
  History,
  Lock,
  Clock,
  Eye,
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

interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function queryFeedback(query: UseQueryResult<unknown, Error>, title: string) {
  if (query.isError) return <QueryErrorNotice error={query.error} title={title}
    pending={query.isFetching} onRetry={() => { void query.refetch(); }} />;
  if (query.isPending) return <p role="status">Učitavanje podataka…</p>;
  return null;
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
  const [activeTab, setActiveTab] = useState<'TOCENJA' | 'CISTERNA'>('TOCENJA');

  type PeriodType = 'danas' | 'nedelja' | 'mesec' | 'sve' | 'custom';
  const PAGE_SIZE = 25;

  // Brzi period filter (Danas, Ova Nedelja, Ovaj Mesec, Svi Unosi, Prilagođen Raspon)
  const [period, setPeriod] = useState<PeriodType>('sve');
  const [suppliesPage, setSuppliesPage] = useState(1);

  // Stanje za Rukovodioce (Menadžere)
  const [managerPage, setManagerPage] = useState(1);

  // Filteri za menadžere
  const [searchFilter, setSearchFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Promena perioda
  const handlePeriodChange = (newPeriod: PeriodType) => {
    setPeriod(newPeriod);
    setManagerPage(1);
    setSuppliesPage(1);

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
  const [showHistory, setShowHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  // Modali
  const [isTocenjeModalOpen, setIsTocenjeModalOpen] = useState(false);
  const [isSupplyModalOpen, setIsSupplyModalOpen] = useState(false);
  const [isIzmeniModalOpen, setIsIzmeniModalOpen] = useState(false);
  const [selectedEntryForEdit, setSelectedEntryForEdit] = useState<FuelEntry | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [selectedEntryForReceipt, setSelectedEntryForReceipt] = useState<FuelEntry | null>(null);

  const queryClient = useQueryClient();
  const userId = currentUser?.id as string | undefined;
  const enabled = Boolean(userId);
  const dateFilters = { dateFrom, dateTo };
  const machinesQuery = useQuery(fuelQueryOptions<{ machines: any[] }>(userId, 'machines'));
  const workersQuery = useQuery(fuelQueryOptions<{ workers: any[] }>(userId, 'workers'));
  const partnersQuery = useQuery(fuelQueryOptions<{ partners: any[] }>(userId, 'partners'));
  const statsQuery = useQuery({ ...fuelQueryOptions<FuelStats>(userId, 'stats'), enabled: enabled && isManager });
  const managerEntriesQuery = useQuery({
    ...fuelQueryOptions<{ entries: FuelEntry[]; pagination: PaginationMeta }>(userId, 'entries', {
      ...dateFilters, page: managerPage, limit: PAGE_SIZE, machineId: machineFilter,
      workerId: workerFilter, fuelSource: sourceFilter,
    }),
    enabled: enabled && isManager && activeTab === 'TOCENJA',
  });
  const suppliesQuery = useQuery({ ...fuelQueryOptions<{ supplies: FuelSupply[] }>(userId, 'supplies', dateFilters),
    enabled: enabled && isManager && activeTab === 'CISTERNA' });
  const todayQuery = useQuery({ ...fuelQueryOptions<{ entries: FuelEntry[] }>(userId, 'entries', { scope: 'today', limit: 50 }),
    enabled: enabled && !isManager });
  const historyQuery = useQuery({
    ...fuelQueryOptions<{ entries: FuelEntry[]; pagination: PaginationMeta }>(userId, 'entries', { scope: 'history', page: historyPage, limit: PAGE_SIZE }),
    enabled: enabled && !isManager && showHistory,
  });

  const stats = statsQuery.data;
  const managerEntries = managerEntriesQuery.data?.entries || [];
  const managerPagination = managerEntriesQuery.data?.pagination;
  const supplies = suppliesQuery.data?.supplies || [];
  const todayEntries = todayQuery.data?.entries || [];
  const historyEntries = historyQuery.data?.entries || [];
  const historyPagination = historyQuery.data?.pagination;
  const machines = machinesQuery.data?.machines || [];
  const workers = workersQuery.data?.workers || [];
  const partners = partnersQuery.data?.partners || [];
  const activeManagerQuery = activeTab === 'TOCENJA' ? managerEntriesQuery : suppliesQuery;
  const loading = activeManagerQuery.isFetching;
  const todayLoading = todayQuery.isFetching;
  const historyLoading = historyQuery.isFetching;
  const refreshFuel = () => queryClient.invalidateQueries({ queryKey: ['fuel', userId] });

  const deleteMutation = useMutation({
    mutationFn: ({ kind, id }: { kind: 'entries' | 'supplies'; id: string }) =>
      fuelRequest(`/fuel/${kind}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: refreshFuel,
  });
  const handleDeleteEntry = (id: string, machineName: string, liters: number) => {
    if (window.confirm(`Da li sigurno želite da stornirate točenje ${liters} L u mašinu "${machineName}"?`)) {
      deleteMutation.mutate({ kind: 'entries', id });
    }
  };
  const handleDeleteSupply = (id: string, liters: number) => {
    if (window.confirm(`Da li sigurno želite da stornirate prijem cisterne od ${liters} L?`)) {
      deleteMutation.mutate({ kind: 'supplies', id });
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
        {[machinesQuery, workersQuery, partnersQuery].map((query, index) => query.isError && (
          <QueryErrorNotice key={index} error={query.error} title="Šifarnici nisu učitani."
            pending={query.isFetching} onRetry={() => { void query.refetch(); }} />
        ))}
        {deleteMutation.isError && <QueryErrorNotice error={deleteMutation.error} title="Storniranje nije uspelo."
          pending={deleteMutation.isPending} onRetry={() => {
            if (deleteMutation.variables) deleteMutation.mutate(deleteMutation.variables);
          }} />}
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
            {queryFeedback(statsQuery, 'Stanje goriva nije učitano.')}
            {!statsQuery.isError && !statsQuery.isPending && <div className={styles.heroGrid}>
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

                {userRole === 'DIREKTOR' && <a className={styles.kpiCard} href="/analitika?tab=gorivo">
                  <BarChart3 size={26} /><span>Efikasnost goriva i normativi u analitici direktora</span>
                </a>}
              </div>
            </div>}

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
                      onChange={(val) => { setMachineFilter(val); setManagerPage(1); }}
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
                      onChange={(val) => { setWorkerFilter(val); setManagerPage(1); }}
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
                      onChange={(val) => { setSourceFilter(val); setManagerPage(1); }}
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
                    className={styles.refreshBtn}
                    onClick={refreshFuel}
                    title="Osveži podatke"
                    disabled={loading}
                  >
                    <RefreshCw size={15} className={loading ? styles.spinner : ''} />
                    <span>{loading ? 'Učitavanje...' : 'Osveži'}</span>
                  </button>
                </div>

                {/* Tabela Točenja */}
                <div className={styles.tableContainer}>
                  {managerEntriesQuery.isError || managerEntriesQuery.isPending ? queryFeedback(managerEntriesQuery, 'Točenja nisu učitana.') : filteredManagerEntries.length === 0 ? (
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
              queryFeedback(suppliesQuery, 'Prijemi cisterne nisu učitani.') ||
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
              {todayQuery.isError ? queryFeedback(todayQuery, 'Današnja točenja nisu učitana.') : todayLoading ? (
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
                      setHistoryPage(1);
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
                    {historyQuery.isError ? queryFeedback(historyQuery, 'Istorija točenja nije učitana.') : historyLoading ? (
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
                            setHistoryPage(page);
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
            void refreshFuel();
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
            onSuccess={refreshFuel}
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
            void refreshFuel();
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
            void refreshFuel();
          }}
        />
      </div>
    </AppLayout>
  );
};

export default GorivoDashboard;
