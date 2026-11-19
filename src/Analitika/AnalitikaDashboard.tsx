import { fetchFuelEfficiency, fuelFilterParams } from './fuelEfficiencyQueries';
import { FuelEfficiency } from './FuelEfficiency';
import { fuelOperationRows, fuelCriticalRows, fuelHeaders, criticalFuelHeaders } from './fuelEfficiencyReport';
import {
  AnalyticsExportError,
  calculateExportOperatingCosts,
  exportAnalyticsExcel,
  loadPdfExportData,
} from './analyticsExport';
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Tractor,
  Users,
  Fuel,
  Wrench,
  Layers,
  FileSpreadsheet,
  Printer,
  Search,
  RotateCcw,
  Coins,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Sprout,
  CheckCircle2,
  Package,
  ClipboardList,
  Clock,
  Calendar,
} from 'lucide-react';
import { applyUnicodeFont } from '../lib/pdfFont';
import AppLayout from '../components/Layout/AppLayout';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { useSession } from '../lib/auth-client';
import styles from './AnalitikaDashboard.module.css';

type PresetType = 'DANAS' | 'ZADNJIH_7' | 'MESEC' | 'ZADNJIH_30' | 'GODINA' | 'SVE' | 'CUSTOM';
type ActiveTab = 'pregled' | 'masine' | 'radnici' | 'radovi' | 'troskovi' | 'parcele' | 'gorivo';

const API = '/api';
const PAGE_SIZE = 10;
const WORKS_PAGE_SIZE = 10;

interface TableSyncScrollbarProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const TableSyncScrollbar: React.FC<TableSyncScrollbarProps> = ({ containerRef }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ scrollWidth: 0, clientWidth: 0, scrollLeft: 0 });
  const isSyncingFromTable = useRef(false);
  const isSyncingFromSelf = useRef(false);

  const updateMetrics = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    setMetrics({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
    });
    if (scrollRef.current && !isSyncingFromSelf.current) {
      scrollRef.current.scrollLeft = el.scrollLeft;
    }
  }, [containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    updateMetrics();

    const handleTableScroll = () => {
      if (isSyncingFromSelf.current) return;
      isSyncingFromTable.current = true;
      if (scrollRef.current) {
        scrollRef.current.scrollLeft = el.scrollLeft;
      }
      setMetrics((prev) => ({ ...prev, scrollLeft: el.scrollLeft }));
      isSyncingFromTable.current = false;
    };

    el.addEventListener('scroll', handleTableScroll, { passive: true });
    window.addEventListener('resize', updateMetrics);

    const ro = new ResizeObserver(() => updateMetrics());
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', handleTableScroll);
      window.removeEventListener('resize', updateMetrics);
      ro.disconnect();
    };
  }, [containerRef, updateMetrics]);

  const handleSelfScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (isSyncingFromTable.current) return;
    isSyncingFromSelf.current = true;
    const newLeft = e.currentTarget.scrollLeft;
    if (containerRef.current) {
      containerRef.current.scrollLeft = newLeft;
    }
    setMetrics((prev) => ({ ...prev, scrollLeft: newLeft }));
    requestAnimationFrame(() => {
      isSyncingFromSelf.current = false;
    });
  };

  if (metrics.scrollWidth <= metrics.clientWidth) {
    return null;
  }

  const visibleWidth = Math.max(300, metrics.clientWidth - 40);

  return (
    <div
      className={styles.inRowScrollToolbar}
      style={{ width: `${visibleWidth}px` }}
    >
      <div
        ref={scrollRef}
        className={styles.inRowScrollBarWrapper}
        onScroll={handleSelfScroll}
      >
        <div style={{ width: `${metrics.scrollWidth}px`, height: '1px' }} />
      </div>
    </div>
  );
};

export const AnalitikaDashboard: React.FC = () => {
  const { data: session, isPending: sessionLoading } = useSession();
  const currentUser = (session as any)?.user;
  const isDirector = currentUser?.role === 'DIREKTOR';

  // State za navigaciju i tabove
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => new URLSearchParams(window.location.search).get('tab') === 'gorivo' ? 'gorivo' : 'pregled');
  const [expandedMachineId, setExpandedMachineId] = useState<string | null>(null);
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null);

  // Reference na tabele za sinhronizovani skrol
  const machinesTableContainerRef = useRef<HTMLDivElement>(null);
  const workersTableContainerRef = useRef<HTMLDivElement>(null);

  // Filteri
  const [preset, setPreset] = useState<PresetType>('MESEC');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [selectedMachine, setSelectedMachine] = useState('');
  const [selectedWorker, setSelectedWorker] = useState('');
  const [selectedParcel, setSelectedParcel] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  // Paginacija za sekcije
  const [topMachinesPage, setTopMachinesPage] = useState(1);
  const [machinesPage, setMachinesPage] = useState(1);
  const [workersPage, setWorkersPage] = useState(1);
  const [worksPage, setWorksPage] = useState(1);
  const [selectedWorkTypeId, setSelectedWorkTypeId] = useState('');
  const [financialPage, setFinancialPage] = useState(1);
  const [parcelsPage, setParcelsPage] = useState(1);

  // Export loading stanja
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Funkcija za promenu brzog perioda
  const handlePresetChange = (newPreset: PresetType) => {
    setPreset(newPreset);
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (newPreset === 'DANAS') {
      setDateFrom(todayStr);
      setDateTo(todayStr);
    } else if (newPreset === 'ZADNJIH_7') {
      const past = new Date(today);
      past.setDate(today.getDate() - 7);
      setDateFrom(past.toISOString().split('T')[0]);
      setDateTo(todayStr);
    } else if (newPreset === 'MESEC') {
      const startOfMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
      setDateFrom(startOfMonth);
      setDateTo(todayStr);
    } else if (newPreset === 'ZADNJIH_30') {
      const past = new Date(today);
      past.setDate(today.getDate() - 30);
      setDateFrom(past.toISOString().split('T')[0]);
      setDateTo(todayStr);
    } else if (newPreset === 'GODINA') {
      setDateFrom(`${today.getFullYear()}-01-01`);
      setDateTo(todayStr);
    } else if (newPreset === 'SVE') {
      setDateFrom('');
      setDateTo('');
    }
  };

  // Reset filtera
  const handleResetFilters = () => {
    handlePresetChange('MESEC');
    setSelectedMachine('');
    setSelectedWorker('');
    setSelectedParcel('');
    setSelectedWorkTypeId('');
    setSearchTerm('');
    setDebouncedSearch('');
    setTopMachinesPage(1);
    setMachinesPage(1);
    setWorkersPage(1);
    setWorksPage(1);
    setFinancialPage(1);
    setParcelsPage(1);
  };

  // Resetovanje paginacije pri promeni pretrage ili filtera
  useEffect(() => {
    setMachinesPage(1);
  }, [debouncedSearch, selectedMachine, selectedWorker, selectedParcel, dateFrom, dateTo, preset]);

  useEffect(() => {
    setWorkersPage(1);
  }, [debouncedSearch, selectedMachine, selectedWorker, selectedParcel, dateFrom, dateTo, preset]);

  useEffect(() => {
    setWorksPage(1);
  }, [debouncedSearch, selectedMachine, selectedWorker, selectedParcel, selectedWorkTypeId, dateFrom, dateTo, preset]);

  useEffect(() => {
    setParcelsPage(1);
  }, [debouncedSearch, selectedMachine, selectedWorker, selectedParcel, dateFrom, dateTo, preset]);

  useEffect(() => {
    setFinancialPage(1);
  }, [selectedMachine, selectedWorker, selectedParcel, dateFrom, dateTo, preset]);

  useEffect(() => {
    setTopMachinesPage(1);
  }, [selectedMachine, selectedWorker, selectedParcel, dateFrom, dateTo, preset]);

  // 1. ŠIFARNICI ZA DROPDOWN LISTE
  const { data: filtersData } = useQuery({
    queryKey: ['analytics-filters'],
    queryFn: async () => {
      const res = await fetch(`${API}/analytics/filters`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju filtera');
      return res.json();
    },
    enabled: isDirector,
  });

  // Opcije za CustomSelect - Mašine
  const machineOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (filtersData?.machines || []).map((m: any) => ({
      value: m.id,
      label: m.name,
      subLabel: `${m.type}`,
      badge: m.type,
      badgeType: m.type === 'TRAKTOR' ? 'success' : m.type === 'KOMBAJN' ? 'warning' : 'default',
    }));
    return [{ value: '', label: 'Sve mašine' }, ...list];
  }, [filtersData?.machines]);

  // Opcije za CustomSelect - Radnici
  const workerOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (filtersData?.workers || []).map((w: any) => ({
      value: w.id,
      label: w.name,
      subLabel: w.role || 'Stalni radnik',
      badge: w.role || undefined,
      badgeType: w.role === 'RUKOVODILAC' ? 'warning' : 'default',
    }));
    return [{ value: '', label: 'Svi radnici' }, ...list];
  }, [filtersData?.workers]);

  // Opcije za CustomSelect - Parcele
  const parcelOptions: CustomSelectOption[] = useMemo(() => {
    const list: CustomSelectOption[] = (filtersData?.parcels || []).map((p: any) => ({
      value: p.id,
      label: `[${p.code}] ${p.name}`,
      subLabel: `${p.areaHa} ha`,
    }));
    return [{ value: '', label: 'Sve parcele' }, ...list];
  }, [filtersData?.parcels]);

  // Query parametri za API pozive (svi tabovi dele aktivne filtere)
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);
    if (selectedMachine) params.append('machineId', selectedMachine);
    if (selectedWorker) params.append('workerId', selectedWorker);
    if (selectedParcel) params.append('parcelId', selectedParcel);
    return params.toString();
  }, [dateFrom, dateTo, selectedMachine, selectedWorker, selectedParcel]);

  const activeFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (selectedMachine) {
      const m = (filtersData?.machines || []).find((item: any) => item.id === selectedMachine);
      if (m) parts.push(`Mašina: ${m.name}`);
    }
    if (selectedWorker) {
      const w = (filtersData?.workers || []).find((item: any) => item.id === selectedWorker);
      if (w) parts.push(`Radnik: ${w.name}`);
    }
    if (selectedParcel) {
      const p = (filtersData?.parcels || []).find((item: any) => item.id === selectedParcel);
      if (p) parts.push(`Parcela: [${p.code}] ${p.name}`);
    }
    return parts.join(' • ');
  }, [filtersData, selectedMachine, selectedWorker, selectedParcel]);

  // 2. GENERALNI PREGLED (KPIs)
  const { data: overviewData, isLoading: overviewLoading, refetch: refetchOverview } = useQuery({
    queryKey: ['analytics-overview', queryParams],
    queryFn: async () => {
      const res = await fetch(`${API}/analytics/overview?${queryParams}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju pregleda');
      return res.json();
    },
    enabled: isDirector && activeTab === 'pregled',
    placeholderData: keepPreviousData,
  });

  // 1.1 NAJAKTIVNIJE MAŠINE (Sa DB paginacijom)
  const { data: topMachinesData, refetch: refetchTopMachines } = useQuery({
    queryKey: ['analytics-top-machines', queryParams, topMachinesPage],
    queryFn: async () => {
      const p = new URLSearchParams(queryParams);
      p.append('page', String(topMachinesPage));
      p.append('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/analytics/top-machines?${p.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju top mašina');
      return res.json();
    },
    enabled: isDirector && activeTab === 'pregled',
    placeholderData: keepPreviousData,
  });

  // 3. ANALITIKA PO MAŠINAMA (Sa DB paginacijom & search)
  const { data: machinesData, refetch: refetchMachines } = useQuery({
    queryKey: ['analytics-machines', queryParams, debouncedSearch, machinesPage],
    queryFn: async () => {
      const p = new URLSearchParams(queryParams);
      if (debouncedSearch.trim()) p.append('search', debouncedSearch.trim());
      p.append('page', String(machinesPage));
      p.append('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/analytics/machines?${p.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju mašina');
      return res.json();
    },
    enabled: isDirector && activeTab === 'masine',
    placeholderData: keepPreviousData,
  });

  // 4. ANALITIKA PO RADNICIMA (Sa DB paginacijom & search)
  const { data: workersData, refetch: refetchWorkers } = useQuery({
    queryKey: ['analytics-workers', queryParams, debouncedSearch, workersPage],
    queryFn: async () => {
      const p = new URLSearchParams(queryParams);
      if (debouncedSearch.trim()) p.append('search', debouncedSearch.trim());
      p.append('page', String(workersPage));
      p.append('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/analytics/workers?${p.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju radnika');
      return res.json();
    },
    enabled: isDirector && activeTab === 'radnici',
    placeholderData: keepPreviousData,
  });

  // 5. ANALITIKA PO PARCELAMA (Sa DB paginacijom & search)
  const { data: parcelsData, refetch: refetchParcels } = useQuery({
    queryKey: ['analytics-parcels', queryParams, debouncedSearch, parcelsPage],
    queryFn: async () => {
      const p = new URLSearchParams(queryParams);
      if (debouncedSearch.trim()) p.append('search', debouncedSearch.trim());
      p.append('page', String(parcelsPage));
      p.append('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/analytics/parcels?${p.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju parcela');
      return res.json();
    },
    enabled: isDirector && activeTab === 'parcele',
    placeholderData: keepPreviousData,
  });

  // 6. FINANSIJSKI TOKOVI (Sa DB paginacijom meseci)
  const { data: financialData, refetch: refetchFinancial } = useQuery({
    queryKey: ['analytics-financial', queryParams, financialPage],
    queryFn: async () => {
      const p = new URLSearchParams(queryParams);
      p.append('page', String(financialPage));
      p.append('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/analytics/financial?${p.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju finansija');
      return res.json();
    },
    enabled: isDirector && activeTab === 'troskovi',
    placeholderData: keepPreviousData,
  });

  // 7. DETALJAN DNEVNIK RADOVA (Svi radovi + statistike po filterima)
  const { data: worksData, isLoading: worksLoading, refetch: refetchWorks } = useQuery({
    queryKey: ['analytics-works', queryParams, debouncedSearch, selectedWorkTypeId, worksPage],
    queryFn: async () => {
      const p = new URLSearchParams(queryParams);
      if (debouncedSearch.trim()) p.append('search', debouncedSearch.trim());
      if (selectedWorkTypeId) p.append('workTypeId', selectedWorkTypeId);
      p.append('page', String(worksPage));
      p.append('limit', String(WORKS_PAGE_SIZE));
      const res = await fetch(`${API}/analytics/works?${p.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju dnevnika radova');
      return res.json();
    },
    enabled: isDirector && activeTab === 'radovi',
    placeholderData: keepPreviousData,
  });

  const fuelFilters = fuelFilterParams({ dateFrom, dateTo, machineId: selectedMachine, workerId: selectedWorker, parcelId: selectedParcel, search: debouncedSearch });
  const [fuelPages, setFuelPages] = useState({ filters: '', operations: 1, critical: 1 });
  const fuelOperationsPage = fuelPages.filters === fuelFilters ? fuelPages.operations : 1;
  const fuelCriticalPage = fuelPages.filters === fuelFilters ? fuelPages.critical : 1;
  const fuelQuery = useQuery({
    queryKey: ['analytics-fuel', currentUser?.id, fuelFilters, fuelOperationsPage, fuelCriticalPage],
    queryFn: ({ signal }) => fetchFuelEfficiency(fuelFilters, fuelOperationsPage, fuelCriticalPage, signal),
    enabled: isDirector && activeTab === 'gorivo', staleTime: 30_000,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === currentUser?.id ? previous : undefined
  });
  const changeFuelPage = (table: 'operations' | 'critical', page: number) => setFuelPages({
    filters: fuelFilters, operations: table === 'operations' ? page : fuelOperationsPage,
    critical: table === 'critical' ? page : fuelCriticalPage,
  });

  // Osvežavanje podataka samo za aktivni tab
  const handleRefreshActiveTab = () => {
    if (activeTab === 'gorivo') { void fuelQuery.refetch(); return; }
    switch (activeTab) {
      case 'pregled':
        void refetchOverview();
        void refetchTopMachines();
        break;
      case 'masine': void refetchMachines(); break;
      case 'radnici': void refetchWorkers(); break;
      case 'radovi': void refetchWorks(); break;
      case 'parcele': void refetchParcels(); break;
      case 'troskovi': void refetchFinancial(); break;
    }
  };

  // Izračunavanje ukupnih operativnih troškova
  const totalOperatingCosts = useMemo(() => {
    if (!overviewData) return 0;
    return (
      (overviewData.totalFuelCost || 0) +
      (overviewData.totalMaintenanceCost || 0) +
      (overviewData.totalTollCost || 0) +
      (overviewData.totalFertilizerCost || 0) +
      (overviewData.totalSeasonalWages || 0)
    );
  }, [overviewData]);

  // ========================================================
  // PDF IZVOZ ZA DIREKTORA (Preuzima kompletan skup sa all=true)
  // ========================================================
  const handleExportPdf = async () => {
    try {
      setExportingPdf(true);
      setExportError(null);
      const { overview: exportOverview, machines: exportMachinesRes, workers: exportWorkersRes, fuelExport } =
        await loadPdfExportData({
          apiBase: API,
          queryParams,
          searchTerm,
          fuelFilters,
        });
      const exportOperatingCosts = calculateExportOperatingCosts(exportOverview);
      const [{ jsPDF }, { autoTable }] = await Promise.all([
        import('jspdf'), import('jspdf-autotable'),
      ]);
      const doc = new jsPDF('landscape', 'mm', 'a4');
      await applyUnicodeFont(doc);

      const periodText = dateFrom && dateTo ? `${dateFrom} do ${dateTo}` : 'Celokupan period';
      const generatedAt = new Date().toLocaleString('sr-RS');

      // Zaglavlje
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 297, 24, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(14);
      doc.text('NANDRA SOFTWARE  |  DIREKTORSKI IZVESTAJ I ANALITIKA POSLOVANJA', 14, 11);

      doc.setFontSize(9);
      doc.setTextColor(203, 213, 225);
      doc.text(`Period: ${periodText}   |   Generisano: ${generatedAt}   |   Kreirao: ${currentUser?.name || 'Direktor'}`, 14, 18);

      // 1. ZBIRNI KPI PREGLED
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text('1. KLJUČNI POKAZATELJI POSLOVANJA', 14, 32);

      const kpiRows = [
        [
          `Uradeno: ${(exportOverview.totalHaDone || 0).toFixed(1)} ha (${exportOverview.totalFieldWorks || 0} radova)`,
          `Gorivo: ${(exportOverview.totalFuelLiters || 0).toLocaleString('sr-RS')} L (${(exportOverview.totalFuelCost || 0).toLocaleString('sr-RS')} RSD)`,
          `Odrzavanje: ${(exportOverview.totalMaintenanceCost || 0).toLocaleString('sr-RS')} RSD (Delovi: ${(exportOverview.maintenancePartsCost || 0).toLocaleString('sr-RS')} RSD)`,
        ],
        [
          `Putarine / ENP: ${(exportOverview.totalTollCost || 0).toLocaleString('sr-RS')} RSD`,
          `Sezonci: ${(exportOverview.totalSeasonalHours || 0).toFixed(1)} h (${(exportOverview.totalSeasonalWages || 0).toLocaleString('sr-RS')} RSD dnevnica)`,
          `UKUPNI OPERATIVNI TROSKOVI: ${exportOperatingCosts.toLocaleString('sr-RS')} RSD`,
        ],
      ];

      autoTable(doc, {
        startY: 35,
        body: kpiRows,
        theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 3, font: 'Roboto' },
        columnStyles: {
          0: { cellWidth: 90 },
          1: { cellWidth: 90 },
          2: { cellWidth: 89, fontStyle: 'bold' },
        },
      });

      // 2. TABELA MAŠINA
      const lastY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 8 : 55;
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text('2. ANALITIKA MEHANIZACIJE (RAD, POTROSNJA, POPRAVKE, TROSKOVI)', 14, lastY);

      const machineTableRows = exportMachinesRes.machines.map((m, idx) => [
        idx + 1,
        m.machine.name,
        m.machine.type,
        `${(m.fieldWork.totalHa || 0).toFixed(1)} ha`,
        `${(m.fieldWork.totalWorkHours || 0).toFixed(1)} h`,
        `${(m.fuel.totalLiters || 0).toLocaleString('sr-RS')} L`,
        `${(m.maintenance.totalCost || 0).toLocaleString('sr-RS')} RSD`,
        `${m.maintenance.count || 0} popravki (${(m.maintenance.downtimeHours || 0).toFixed(1)}h zastoja)`,
        `${(m.tolls.totalCost || 0).toLocaleString('sr-RS')} RSD`,
        `${(m.totalCostMachine || 0).toLocaleString('sr-RS')} RSD`,
      ]);

      autoTable(doc, {
        startY: lastY + 3,
        head: [
          [
            '#',
            'Masina',
            'Tip',
            'Uradeno',
            'Radni sati',
            'Gorivo (L)',
            'Popravke (RSD)',
            'Kvarovi & Zastoj',
            'Putarine',
            'Ukupan trosak',
          ],
        ],
        body: machineTableRows,
        theme: 'striped',
        headStyles: { fillColor: [2, 132, 199], textColor: 255, fontSize: 8, font: 'Roboto' },
        styles: { fontSize: 7.5, cellPadding: 2, font: 'Roboto' },
      });

      // 3. TABELA RADNIKA
      doc.addPage('landscape');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text('3. ANALITIKA UCINKA RADNIKA', 14, 15);

      const workerTableRows = exportWorkersRes.workers.map((w, idx) => {
        const eff =
          w.fieldWork.totalWorkHours && w.fieldWork.totalHa
            ? (w.fieldWork.totalHa / w.fieldWork.totalWorkHours).toFixed(2)
            : '-';
        return [
          idx + 1,
          w.worker.name,
          w.worker.role || 'RADNIK',
          `${(w.fieldWork.totalHa || 0).toFixed(1)} ha`,
          `${(w.fieldWork.totalWorkHours || 0).toFixed(1)} h`,
          eff !== '-' ? `${eff} ha/h` : '-',
          `${(w.fuel.totalLiters || 0).toLocaleString('sr-RS')} L`,
          w.maintenanceReported || 0,
          `${(w.tolls.totalCost || 0).toLocaleString('sr-RS')} RSD`,
          w.fieldWork.estimatedLabourCost
            ? `${w.fieldWork.estimatedLabourCost.toLocaleString('sr-RS')} RSD`
            : '-',
        ];
      });

      autoTable(doc, {
        startY: 18,
        head: [
          [
            '#',
            'Radnik',
            'Uloga',
            'Uradeno (ha)',
            'Radni sati',
            'Efikasnost',
            'Gorivo (L)',
            'Prijavljeni kvarovi',
            'Putarine',
            'Procena rada',
          ],
        ],
        body: workerTableRows,
        theme: 'striped',
        headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 8, font: 'Roboto' },
        styles: { fontSize: 7.5, cellPadding: 2, font: 'Roboto' },
      });

      doc.addPage();
      doc.text('Efikasnost goriva i normativi', 14, 18);
      doc.setFontSize(9);
      doc.text(`Obuhvat: ${fuelExport.summary.coveredHa.toFixed(2)} / ${fuelExport.summary.totalHa.toFixed(2)} ha; bez obracuna: ${fuelExport.summary.uncoveredWorksCount} radova`, 14, 26);
      doc.text('Bilans zaduzenja sa dopunama; raspodela po satima ili hektarima. Trosak predstavlja tocenja.', 14, 32);
      doc.text(`Potrosnja: ${fuelExport.summary.totalLiters.toFixed(2)} L; trosak tocenja: ${fuelExport.summary.dispensedCostRSD.toFixed(2)} RSD`, 14, 38);
      autoTable(doc, { startY: 44, head: [fuelHeaders], body: fuelOperationRows(fuelExport), styles: { font: 'Roboto', fontSize: 7 } });
      doc.addPage();
      doc.text('Kriticna odstupanja goriva (raspodeljena potrosnja)', 14, 18);
      autoTable(doc, { startY: 25, head: [criticalFuelHeaders], body: fuelCriticalRows(fuelExport), styles: { font: 'Roboto', fontSize: 6 } });
      doc.save(`Nandra_Direktorski_Izvestaj_${dateFrom || 'sve'}_${dateTo || 'sve'}.pdf`);
    } catch (err) {
      console.error('Greška pri izradi PDF izveštaja:', err);
      const message =
        err instanceof AnalyticsExportError
          ? err.message
          : 'Došlo je do greške pri izradi PDF izveštaja.';
      setExportError(message);
    } finally {
      setExportingPdf(false);
    }
  };

  // ========================================================
  // EXCEL (XLSX) IZVOZ ZA DIREKTORA (Preuzima celokupan skup sa all=true)
  // ========================================================
  const handleExportExcel = async () => {
    try {
      setExportingExcel(true);
      setExportError(null);
      await exportAnalyticsExcel({
        apiBase: API,
        queryParams,
        searchTerm,
        fuelFilters,
        dateFrom,
        dateTo,
        loadXlsx: () => import('xlsx'),
      });
    } catch (err) {
      console.error('Greška pri izradi Excel tabele:', err);
      const message =
        err instanceof AnalyticsExportError
          ? err.message
          : 'Došlo je do greške pri izvozu u Excel.';
      setExportError(message);
    } finally {
      setExportingExcel(false);
    }
  };

  // Sigurnosna provera za rolu: ako nije DIREKTOR
  if (!sessionLoading && !isDirector) {
    return (
      <AppLayout pageTitle="Pristup Ograničen">
        <div className={styles.accessDeniedCard}>
          <ShieldAlert size={48} color="#dc2626" />
          <h2 style={{ margin: 0, color: 'var(--text-primary)' }}>Pristup Ograničen na Direktore</h2>
          <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
            Modul "Analitika" sadrži poverljive finansijske podatke gazdinstva, troškove poslovanja, cene goriva i
            radionice, i dostupan je isključivo sa administratorskom ulogom <strong>DIREKTOR</strong>.
          </p>
        </div>
      </AppLayout>
    );
  }

  const topMachinesList = topMachinesData?.topMachines || [];
  const topMachinesPagination = topMachinesData?.pagination || { total: 0, totalPages: 1 };

  const machinesList = machinesData?.machines || [];
  const machinesPagination = machinesData?.pagination || { total: 0, totalPages: 1 };

  const workersList = workersData?.workers || [];
  const workersPagination = workersData?.pagination || { total: 0, totalPages: 1 };

  const financialList = financialData?.fuelByMonth || [];
  const financialPagination = financialData?.pagination || { total: 0, totalPages: 1 };

  const parcelsList = parcelsData?.parcels || [];
  const parcelsPagination = parcelsData?.pagination || { total: 0, totalPages: 1 };

  const worksList = worksData?.works || [];
  const worksByWorkType = worksData?.byWorkType || [];
  const worksSummary = worksData?.summary || {
    totalWorks: 0,
    totalHa: 0,
    totalHours: 0,
    avgHaPerHour: null,
    avgHaPerWork: null,
    distinctParcels: 0,
    distinctWorkTypes: 0,
    distinctDays: 0,
    avgHoursPerDay: null,
    estimatedLabourCost: null,
  };
  const worksPagination = worksData?.pagination || { total: 0, totalPages: 1 };

  return (
    <AppLayout pageTitle="Analitika & Poslovni Izveštaji">
      <div className={styles.container}>
        {/* ========================================================
            HEADER
           ======================================================== */}
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <div className={styles.titleWithBadge}>
              <h2 className={styles.title}>
                <span className={styles.titleIcon}>
                  <BarChart3 size={24} />
                </span>
                Analitika Poslovanja
              </h2>
            </div>
          </div>

          <div className={styles.headerActions}>
            <button
              className={styles.btnPdf}
              onClick={handleExportPdf}
              disabled={exportingPdf || overviewLoading}
              title="Preuzmi zvanični direktorski izveštaj u PDF formatu"
            >
              <Printer size={16} />
              {exportingPdf ? 'Izrada PDF-a...' : 'Izvezi u PDF'}
            </button>

            <button
              className={styles.btnExcel}
              onClick={handleExportExcel}
              disabled={exportingExcel || overviewLoading}
              title="Preuzmi sve analitičke podatke u tabelarnom Excel (XLSX) formatu"
            >
              <FileSpreadsheet size={16} />
              {exportingExcel ? 'Izrada Excel-a...' : 'Izvezi u Excel'}
            </button>

            <button
              className={styles.btnSecondary}
              onClick={handleRefreshActiveTab}
              title="Osveži sve podatke sa servera"
            >
              <RotateCcw size={16} />
              Osveži
            </button>
          </div>
        </div>

        {exportError && (
          <div className={styles.exportErrorBanner} role="alert">
            <ShieldAlert size={18} className={styles.exportErrorIcon} />
            <span className={styles.exportErrorText}>{exportError}</span>
            <button
              type="button"
              className={styles.exportErrorClose}
              onClick={() => setExportError(null)}
              aria-label="Zatvori obaveštenje o grešci izvoza"
            >
              ×
            </button>
          </div>
        )}

        {/* ========================================================
            FILTER CARD
           ======================================================== */}
        <div className={styles.filterCard}>
          <div className={styles.filterPresets}>
            <span className={styles.presetLabel}>Vremenski raspon:</span>
            <button
              className={`${styles.presetPill} ${preset === 'DANAS' ? styles.presetPillActive : ''}`}
              onClick={() => handlePresetChange('DANAS')}
            >
              Danas
            </button>
            <button
              className={`${styles.presetPill} ${preset === 'ZADNJIH_7' ? styles.presetPillActive : ''}`}
              onClick={() => handlePresetChange('ZADNJIH_7')}
            >
              Zadnjih 7 dana
            </button>
            <button
              className={`${styles.presetPill} ${preset === 'MESEC' ? styles.presetPillActive : ''}`}
              onClick={() => handlePresetChange('MESEC')}
            >
              Ovaj mesec
            </button>
            <button
              className={`${styles.presetPill} ${preset === 'ZADNJIH_30' ? styles.presetPillActive : ''}`}
              onClick={() => handlePresetChange('ZADNJIH_30')}
            >
              Zadnjih 30 dana
            </button>
            <button
              className={`${styles.presetPill} ${preset === 'GODINA' ? styles.presetPillActive : ''}`}
              onClick={() => handlePresetChange('GODINA')}
            >
              Ova godina
            </button>
            <button
              className={`${styles.presetPill} ${preset === 'SVE' ? styles.presetPillActive : ''}`}
              onClick={() => handlePresetChange('SVE')}
            >
              Sve vreme
            </button>
          </div>

          <div className={styles.filterControlsGrid}>
            <div className={styles.filterField}>
              <label className={styles.fieldLabel}>Datum od — do:</label>
              <div className={styles.dateInputWrapper}>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPreset('CUSTOM');
                  }}
                />
                <span className={styles.dateSeparator}>—</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPreset('CUSTOM');
                  }}
                />
              </div>
            </div>

            <div className={styles.filterField}>
              <label className={styles.fieldLabel}>Mašina:</label>
              <CustomSelect
                value={selectedMachine}
                onChange={setSelectedMachine}
                options={machineOptions}
                placeholder="Sve mašine"
                icon={<Tractor size={16} />}
              />
            </div>

            <div className={styles.filterField}>
              <label className={styles.fieldLabel}>Radnik:</label>
              <CustomSelect
                value={selectedWorker}
                onChange={setSelectedWorker}
                options={workerOptions}
                placeholder="Svi radnici"
                icon={<Users size={16} />}
              />
            </div>

            <div className={styles.filterField}>
              <label className={styles.fieldLabel}>Parcela:</label>
              <CustomSelect
                value={selectedParcel}
                onChange={setSelectedParcel}
                options={parcelOptions}
                placeholder="Sve parcele"
                icon={<Sprout size={16} />}
              />
            </div>

            <button className={styles.resetBtn} onClick={handleResetFilters} title="Vrati sve filtere na početno stanje">
              <RotateCcw size={15} />
              Reset
            </button>
          </div>
        </div>

        {/* ========================================================
            NAVIGATION TABS
           ======================================================== */}
        <div className={styles.navTabs}>
          <button className={`${styles.tabBtn} ${activeTab === 'gorivo' ? styles.tabBtnActive : ''}`} onClick={() => setActiveTab('gorivo')}>
            <Fuel size={18} /> Gorivo
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'pregled' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('pregled')}
          >
            <BarChart3 size={18} />
            Opšti Pregled
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'masine' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('masine')}
          >
            <Tractor size={18} />
            Mašine
            <span className={styles.tabBadge}>{machinesPagination.total}</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'radnici' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('radnici')}
          >
            <Users size={18} />
            Radnici
            <span className={styles.tabBadge}>{workersPagination.total}</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'radovi' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('radovi')}
          >
            <ClipboardList size={18} />
            Radovi
            <span className={styles.tabBadge}>{worksPagination.total}</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'troskovi' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('troskovi')}
          >
            <Coins size={18} />
            Finansije
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'parcele' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('parcele')}
          >
            <Sprout size={18} />
            Parcele
            <span className={styles.tabBadge}>{parcelsPagination.total}</span>
          </button>
        </div>

        {/* ========================================================
            TAB 1: PREGLED & KPI
           ======================================================== */}
        {activeTab === 'gorivo' && (fuelQuery.isError ? <div role="alert">
          <p>{fuelQuery.error.message}</p><button onClick={() => { void fuelQuery.refetch(); }}>Pokusaj ponovo</button>
        </div> : fuelQuery.isPending ? <p role="status">Ucitavanje analitike goriva...</p> : <FuelEfficiency data={fuelQuery.data} fetching={fuelQuery.isFetching} search={searchTerm} onSearchChange={setSearchTerm} onOperationsPage={page => changeFuelPage('operations', page)} onCriticalPage={page => changeFuelPage('critical', page)} />)}

        {activeTab === 'pregled' && (
          <>
            {/* Executive Total Cost Banner */}
            <div className={styles.executiveBanner}>
              <div className={styles.bannerInfo}>
                <h3>
                  Ukupni operativni troškovi poslovanja (u izabranom periodu)
                  {activeFilterSummary ? ` — ${activeFilterSummary}` : ''}
                </h3>
                <div className={styles.bannerTotal}>{totalOperatingCosts.toLocaleString('sr-RS')} RSD</div>
              </div>

              <div className={styles.bannerBreakdown}>
                <div className={styles.breakdownItem}>
                  <span className={styles.breakdownLabel}>Gorivo</span>
                  <span className={styles.breakdownVal}>
                    {(overviewData?.totalFuelCost || 0).toLocaleString('sr-RS')} RSD
                  </span>
                </div>
                <div className={styles.breakdownItem}>
                  <span className={styles.breakdownLabel}>Popravke & Servis</span>
                  <span className={styles.breakdownVal}>
                    {(overviewData?.totalMaintenanceCost || 0).toLocaleString('sr-RS')} RSD
                  </span>
                </div>
                <div className={styles.breakdownItem}>
                  <span className={styles.breakdownLabel}>Putarine / ENP</span>
                  <span className={styles.breakdownVal}>
                    {(overviewData?.totalTollCost || 0).toLocaleString('sr-RS')} RSD
                  </span>
                </div>
                <div className={styles.breakdownItem}>
                  <span className={styles.breakdownLabel}>Sezonci</span>
                  <span className={styles.breakdownVal}>
                    {(overviewData?.totalSeasonalWages || 0).toLocaleString('sr-RS')} RSD
                  </span>
                </div>
                <div className={styles.breakdownItem}>
                  <span className={styles.breakdownLabel}>Đubrivo</span>
                  <span className={styles.breakdownVal}>
                    {(overviewData?.totalFertilizerCost || 0).toLocaleString('sr-RS')} RSD
                  </span>
                </div>
              </div>
            </div>

            {/* KPI Cards Grid */}
            <div className={styles.kpiGrid}>
              {/* Urađeno ha */}
              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Urađena površina</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconGreen}`}>
                    <Layers size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>
                  {(overviewData?.totalHaDone || 0).toFixed(1)} <span style={{ fontSize: '1rem' }}>ha</span>
                </div>
                <div className={styles.kpiFooter}>
                  <span>Završenih operacija:</span>
                  <span className={styles.kpiHighlight}>{overviewData?.totalFieldWorks || 0}</span>
                </div>
              </div>

              {/* Gorivo */}
              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Utrošeno goriva</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconBlue}`}>
                    <Fuel size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>
                  {(overviewData?.totalFuelLiters || 0).toLocaleString('sr-RS')}{' '}
                  <span style={{ fontSize: '1rem' }}>L</span>
                </div>
                <div className={styles.kpiFooter}>
                  <span>Ukupna vrednost:</span>
                  <span className={styles.kpiHighlight}>
                    {(overviewData?.totalFuelCost || 0).toLocaleString('sr-RS')} RSD
                  </span>
                </div>
              </div>

              {/* Popravke i servis */}
              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Uloženo u održavanje</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconRed}`}>
                    <Wrench size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>
                  {(overviewData?.totalMaintenanceCost || 0).toLocaleString('sr-RS')}{' '}
                  <span style={{ fontSize: '1rem' }}>RSD</span>
                </div>
                <div className={styles.kpiFooter}>
                  <span>Delovi: {(overviewData?.maintenancePartsCost || 0).toLocaleString('sr-RS')} RSD</span>
                  <span>Rad: {(overviewData?.maintenanceLaborCost || 0).toLocaleString('sr-RS')} RSD</span>
                </div>
              </div>

              {/* Sezonci */}
              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Sezonski radnici</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconAmber}`}>
                    <Users size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>
                  {(overviewData?.totalSeasonalHours || 0).toFixed(1)}{' '}
                  <span style={{ fontSize: '1rem' }}>h</span>
                </div>
                <div className={styles.kpiFooter}>
                  <span>Isplaćene dnevnice:</span>
                  <span className={styles.kpiHighlight}>
                    {(overviewData?.totalSeasonalWages || 0).toLocaleString('sr-RS')} RSD
                  </span>
                </div>
              </div>

              {/* Putarine */}
              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Putarine i ENP dopune</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconPurple}`}>
                    <CreditCard size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>
                  {(overviewData?.totalTollCost || 0).toLocaleString('sr-RS')}{' '}
                  <span style={{ fontSize: '1rem' }}>RSD</span>
                </div>
                <div className={styles.kpiFooter}>
                  <span>Vozni park:</span>
                  <span className={styles.kpiHighlight}>{overviewData?.machineCount || 0} mašina</span>
                </div>
              </div>

              {/* Modul Luk realizacija */}
              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Otpremljeno luka kupcima</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconTeal}`}>
                    <Package size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>
                  {(overviewData?.onionShippedKg || 0).toLocaleString('sr-RS')}{' '}
                  <span style={{ fontSize: '1rem' }}>kg</span>
                </div>
                <div className={styles.kpiFooter}>
                  <span>Fakturisano:</span>
                  <span className={styles.kpiHighlight}>
                    {(overviewData?.onionShipmentValue || 0).toLocaleString('sr-RS')} RSD
                  </span>
                </div>
              </div>
            </div>

            {/* Brzi uvid u status mašina i poslova (Sa paginacijom iz baze po 10) */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <h3 className={styles.cardTitle}>
                  <Tractor size={20} color="#0284c7" />
                  Najaktivnije mašine u izabranom periodu ({topMachinesPagination.total})
                </h3>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Prikaz mašina rangiranih po obrađenoj površini (učitava se po 10 iz baze)
                </span>
              </div>

              <div className={styles.tableContainer}>
                <table className={styles.dataTable} style={{ minWidth: '850px' }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Mašina</th>
                      <th>Tip</th>
                      <th>Urađeno (ha)</th>
                      <th>Radni sati</th>
                      <th>Gorivo (L)</th>
                      <th>Popravke (RSD)</th>
                      <th>Ukupan trošak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMachinesList.map((m: any, index: number) => {
                      const rank = (topMachinesPage - 1) * PAGE_SIZE + index + 1;
                      return (
                        <tr key={m.machine.id}>
                          <td style={{ fontWeight: 700, color: 'var(--text-muted)' }}>{rank}.</td>
                          <td>
                            <div className={styles.machineNameCell}>
                              <Tractor size={16} color="#0284c7" />
                              <span>{m.machine.name}</span>
                            </div>
                          </td>
                          <td>
                            <span className={styles.typeBadge}>{m.machine.type}</span>
                          </td>
                          <td style={{ fontWeight: 700, color: '#16a34a' }}>
                            {(m.fieldWork?.totalHa || 0).toFixed(1)} ha
                          </td>
                          <td>{(m.fieldWork?.totalWorkHours || 0).toFixed(1)} h</td>
                          <td>{(m.fuel?.totalLiters || 0).toLocaleString('sr-RS')} L</td>
                          <td className={styles.costText}>
                            {(m.maintenance?.totalCost || 0).toLocaleString('sr-RS')} RSD
                          </td>
                          <td className={styles.costTotal}>
                            {(m.totalCostMachine || 0).toLocaleString('sr-RS')} RSD
                          </td>
                        </tr>
                      );
                    })}
                    {topMachinesList.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                          Nema zabeleženih aktivnosti mašina u izabranom vremenskom periodu.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {topMachinesPagination.total > 0 && (
                <div style={{ marginTop: '0.5rem', borderRadius: 10, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  <TablePagination
                    currentPage={topMachinesPage}
                    totalPages={topMachinesPagination.totalPages}
                    totalItems={topMachinesPagination.total}
                    pageSize={PAGE_SIZE}
                    onPageChange={setTopMachinesPage}
                    itemName="aktivnih mašina"
                  />
                </div>
              )}
            </div>
          </>
        )}

        {/* ========================================================
            TAB 2: MAŠINE & ODRŽAVANJE (DB paginacija 10 po strani)
           ======================================================== */}
        {activeTab === 'masine' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h3 className={styles.cardTitle}>
                  <Tractor size={20} color="#0284c7" />
                  Analitika Mašina i Flote ({machinesPagination.total})
                </h3>
                {activeFilterSummary && (
                  <span style={{ fontSize: '0.82rem', color: '#0284c7', fontWeight: 600 }}>
                    Aktivni filteri: {activeFilterSummary}
                  </span>
                )}
              </div>

              <div className={styles.searchBox}>
                <Search size={16} color="var(--text-secondary)" />
                <input
                  type="text"
                  placeholder="Pretraži mašinu u bazi..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.tableContainer} ref={machinesTableContainerRef}>
              <table className={styles.dataTable} style={{ minWidth: '950px' }}>
                <thead>
                  <tr>
                    <th>Mašina</th>
                    <th>Status</th>
                    <th>Stanje rh</th>
                    <th>Urađeno (ha)</th>
                    <th>Radni sati</th>
                    <th>Gorivo (L & RSD)</th>
                    <th>Uloženo u popravke</th>
                    <th>Putarine</th>
                    <th>Ukupan trošak</th>
                    <th>Detalji</th>
                  </tr>
                </thead>
                <tbody>
                  {machinesList.map((m: any) => {
                    const isExpanded = expandedMachineId === m.machine.id;
                    const statusClass =
                      m.machine.status === 'SLOBODNA'
                        ? styles.statusSlobodna
                        : m.machine.status === 'ZADUZENA'
                          ? styles.statusZaduzena
                          : m.machine.status === 'U_KVARU'
                            ? styles.statusUKvaru
                            : styles.statusServis;

                    return (
                      <React.Fragment key={m.machine.id}>
                        <tr className={isExpanded ? styles.rowExpanded : ''}>
                          <td>
                            <div className={styles.machineNameCell}>
                              <Tractor size={18} color="#0284c7" />
                              <div>
                                <div>{m.machine.name}</div>
                                <span className={styles.typeBadge}>
                                  {m.machine.type} {m.machine.brandModel ? `• ${m.machine.brandModel}` : ''}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`${styles.badgeStatus} ${statusClass}`}>{m.machine.status}</span>
                          </td>
                          <td style={{ fontWeight: 600 }}>{m.machine.currentHours || 0} rh</td>
                          <td style={{ fontWeight: 700, color: '#16a34a' }}>
                            {(m.fieldWork.totalHa || 0).toFixed(1)} ha
                          </td>
                          <td>{(m.fieldWork.totalWorkHours || 0).toFixed(1)} h</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {(m.fuel.totalLiters || 0).toLocaleString('sr-RS')} L
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {(m.fuel.totalCost || 0).toLocaleString('sr-RS')} RSD
                            </div>
                          </td>
                          <td>
                            <div className={styles.costText}>
                              {(m.maintenance.totalCost || 0).toLocaleString('sr-RS')} RSD
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {m.maintenance.count} kvarova ({(m.maintenance.downtimeHours || 0).toFixed(1)}h stajanja)
                            </div>
                          </td>
                          <td>{(m.tolls.totalCost || 0).toLocaleString('sr-RS')} RSD</td>
                          <td className={styles.costTotal}>
                            {(m.totalCostMachine || 0).toLocaleString('sr-RS')} RSD
                          </td>
                          <td>
                            <button
                              className={styles.btnExpand}
                              onClick={() => setExpandedMachineId(isExpanded ? null : m.machine.id)}
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp size={14} /> Zatvori
                                </>
                              ) : (
                                <>
                                  <ChevronDown size={14} /> Otvori uvid
                                </>
                              )}
                            </button>
                          </td>
                        </tr>

                        {/* ========================================================
                            EXPANDED DEEP DIVE ZA MAŠINU (Popravke, delovi, radnici)
                           ======================================================== */}
                        {isExpanded && (
                          <tr className={styles.detailsExpandRow}>
                            <td colSpan={10}>
                              <TableSyncScrollbar containerRef={machinesTableContainerRef} />
                              <div className={styles.deepDiveGrid}>
                                {/* 1. Istorija popravki i šta je radjeno */}
                                <div className={styles.deepDiveCard}>
                                  <div className={styles.deepDiveTitle}>
                                    <Wrench size={16} color="#dc2626" />
                                    <span>Istorija popravki i zamenjeni delovi</span>
                                  </div>

                                  {m.maintenance.recentRepairs && m.maintenance.recentRepairs.length > 0 ? (
                                    m.maintenance.recentRepairs.map((r: any) => (
                                      <div key={r.id} className={styles.repairItem}>
                                        <div className={styles.repairItemHeader}>
                                          <span className={styles.repairTitle}>{r.title}</span>
                                          <span className={styles.repairDate}>
                                            {r.dateReported ? r.dateReported.substring(0, 10) : ''}
                                          </span>
                                        </div>

                                        <div className={styles.repairDetails}>
                                          <strong>Tip:</strong> {r.serviceType} | <strong>Status:</strong>{' '}
                                          {r.status}
                                        </div>

                                        {r.repairNotes && (
                                          <div
                                            style={{
                                              fontSize: '0.8rem',
                                              fontStyle: 'italic',
                                              color: 'var(--text-primary)',
                                            }}
                                          >
                                            "{r.repairNotes}"
                                          </div>
                                        )}

                                        {r.partsReplaced && (
                                          <div>
                                            <span className={styles.partsTag}>
                                              Zamenjeni delovi: {r.partsReplaced}
                                            </span>
                                          </div>
                                        )}

                                        {r.lubricantType && (
                                          <div style={{ fontSize: '0.75rem', color: '#d97706' }}>
                                            Mazivo: {r.lubricantType} ({r.lubricantLiters || 0} L)
                                          </div>
                                        )}

                                        <div
                                          style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            marginTop: '0.25rem',
                                            fontSize: '0.8rem',
                                            fontWeight: 700,
                                          }}
                                        >
                                          <span>Uloženo u popravku:</span>
                                          <span style={{ color: '#dc2626' }}>
                                            {(r.totalCost || 0).toLocaleString('sr-RS')} RSD
                                          </span>
                                        </div>
                                      </div>
                                    ))
                                  ) : (
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                      Nema zabeleženih kvarova i servisa za ovu mašinu u izabranom periodu.
                                    </div>
                                  )}
                                </div>

                                {/* 2. Ko je najviše vozio mašinu */}
                                <div className={styles.deepDiveCard}>
                                  <div className={styles.deepDiveTitle}>
                                    <Users size={16} color="#0284c7" />
                                    <span>Radnici koji su rukovali mašinom</span>
                                  </div>

                                  {m.topWorkers && m.topWorkers.length > 0 ? (
                                    <table style={{ width: '100%', fontSize: '0.82rem' }}>
                                      <thead>
                                        <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                                          <th>Radnik</th>
                                          <th>Urađeno</th>
                                          <th>Radni sati</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {m.topWorkers.map((tw: any) => (
                                          <tr key={tw.workerId} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={{ padding: '0.4rem 0', fontWeight: 600 }}>
                                              {tw.workerName}
                                            </td>
                                            <td style={{ padding: '0.4rem 0' }}>{(tw.totalHa || 0).toFixed(1)} ha</td>
                                            <td style={{ padding: '0.4rem 0' }}>{(tw.totalHours || 0).toFixed(1)} h</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                      Nema evidentiranih radnika za ovu mašinu.
                                    </div>
                                  )}
                                </div>

                                {/* 3. Struktura poslova na njivi */}
                                <div className={styles.deepDiveCard}>
                                  <div className={styles.deepDiveTitle}>
                                    <Layers size={16} color="#16a34a" />
                                    <span>Struktura poslova koje je radila</span>
                                  </div>

                                  {m.workTypeBreakdown && m.workTypeBreakdown.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                      {m.workTypeBreakdown.map((wt: any) => (
                                        <div
                                          key={wt.workTypeId}
                                          style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            fontSize: '0.82rem',
                                            padding: '0.3rem 0',
                                            borderBottom: '1px dashed var(--border-color)',
                                          }}
                                        >
                                          <span>{wt.workTypeName}</span>
                                          <span style={{ fontWeight: 700 }}>
                                            {(wt.totalHa || 0).toFixed(1)} ha ({wt.count}x)
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                      Nema zabeleženih radova.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {machinesList.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '2rem' }}>
                        Nema mašina koje odgovaraju zadatim filterima.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {machinesPagination.total > 0 && (
              <div style={{ marginTop: '0.5rem', borderRadius: 10, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <TablePagination
                  currentPage={machinesPage}
                  totalPages={machinesPagination.totalPages}
                  totalItems={machinesPagination.total}
                  pageSize={PAGE_SIZE}
                  onPageChange={setMachinesPage}
                  itemName="mašina"
                />
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 3: RADNICI & UČINAK (DB paginacija 10 po strani)
           ======================================================== */}
        {activeTab === 'radnici' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h3 className={styles.cardTitle}>
                  <Users size={20} color="#16a34a" />
                  Analitika Učinka Zaposlenih ({workersPagination.total})
                </h3>
                {activeFilterSummary && (
                  <span style={{ fontSize: '0.82rem', color: '#0284c7', fontWeight: 600 }}>
                    Aktivni filteri: {activeFilterSummary}
                  </span>
                )}
              </div>

              <div className={styles.searchBox}>
                <Search size={16} color="var(--text-secondary)" />
                <input
                  type="text"
                  placeholder="Pretraži radnika u bazi..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.tableContainer} ref={workersTableContainerRef}>
              <table className={styles.dataTable} style={{ minWidth: '900px' }}>
                <thead>
                  <tr>
                    <th>Radnik</th>
                    <th>Uloga</th>
                    <th>Urađeno (ha)</th>
                    <th>Radni sati</th>
                    <th>Efikasnost</th>
                    <th>Sipano gorivo</th>
                    <th>Prijavljeni kvarovi</th>
                    <th>Putarine</th>
                    <th>Procena troška rada</th>
                    <th>Detalji</th>
                  </tr>
                </thead>
                <tbody>
                  {workersList.map((w: any) => {
                    const isExpanded = expandedWorkerId === w.worker.id;
                    const efficiency =
                      w.fieldWork.totalWorkHours && w.fieldWork.totalHa
                        ? +(w.fieldWork.totalHa / w.fieldWork.totalWorkHours).toFixed(2)
                        : null;

                    return (
                      <React.Fragment key={w.worker.id}>
                        <tr className={isExpanded ? styles.rowExpanded : ''}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700 }}>
                              <Users size={16} color="#16a34a" />
                              <span>{w.worker.name}</span>
                            </div>
                          </td>
                          <td>
                            <span className={styles.typeBadge}>{w.worker.role || 'RADNIK'}</span>
                          </td>
                          <td style={{ fontWeight: 700, color: '#16a34a' }}>
                            {(w.fieldWork.totalHa || 0).toFixed(1)} ha
                          </td>
                          <td>{(w.fieldWork.totalWorkHours || 0).toFixed(1)} h</td>
                          <td>
                            {efficiency ? (
                              <span style={{ fontWeight: 700, color: '#0284c7' }}>{efficiency} ha/h</span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>{(w.fuel.totalLiters || 0).toLocaleString('sr-RS')} L</td>
                          <td>
                            {w.maintenanceReported > 0 ? (
                              <span style={{ color: '#d97706', fontWeight: 700 }}>
                                {w.maintenanceReported} kvarova
                              </span>
                            ) : (
                              '0'
                            )}
                          </td>
                          <td>{(w.tolls.totalCost || 0).toLocaleString('sr-RS')} RSD</td>
                          <td>
                            {w.fieldWork.estimatedLabourCost ? (
                              <span style={{ fontWeight: 700 }}>
                                {w.fieldWork.estimatedLabourCost.toLocaleString('sr-RS')} RSD
                              </span>
                            ) : (
                              <span style={{ color: 'var(--text-secondary)' }}>-</span>
                            )}
                          </td>
                          <td>
                            <button
                              className={styles.btnExpand}
                              onClick={() => setExpandedWorkerId(isExpanded ? null : w.worker.id)}
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp size={14} /> Zatvori
                                </>
                              ) : (
                                <>
                                  <ChevronDown size={14} /> Otvori profil
                                </>
                              )}
                            </button>
                          </td>
                        </tr>

                        {/* Expanded Profil Radnika */}
                        {isExpanded && (
                          <tr className={styles.detailsExpandRow}>
                            <td colSpan={10}>
                              <TableSyncScrollbar containerRef={workersTableContainerRef} />
                              <div className={styles.deepDiveGrid}>
                                {/* Mašine koje je vozio */}
                                <div className={styles.deepDiveCard}>
                                  <div className={styles.deepDiveTitle}>
                                    <Tractor size={16} color="#0284c7" />
                                    <span>Mašine kojima je rukovao</span>
                                  </div>
                                  {w.machineBreakdown && w.machineBreakdown.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                      {w.machineBreakdown.map((mb: any) => (
                                        <div
                                          key={mb.machineId}
                                          style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            fontSize: '0.82rem',
                                            padding: '0.3rem 0',
                                            borderBottom: '1px dashed var(--border-color)',
                                          }}
                                        >
                                          <span>{mb.machineName}</span>
                                          <span style={{ fontWeight: 700 }}>
                                            {(mb.totalHa || 0).toFixed(1)} ha ({(mb.totalHours || 0).toFixed(1)} h)
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                      Nema zabeleženih mašina.
                                    </div>
                                  )}
                                </div>

                                {/* Parcele na kojima je radio */}
                                <div className={styles.deepDiveCard}>
                                  <div className={styles.deepDiveTitle}>
                                    <Sprout size={16} color="#16a34a" />
                                    <span>Parcele na kojima je radio</span>
                                  </div>
                                  {w.parcelBreakdown && w.parcelBreakdown.length > 0 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                      {w.parcelBreakdown.map((pb: any) => (
                                        <div
                                          key={pb.parcelName}
                                          style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            fontSize: '0.82rem',
                                            padding: '0.3rem 0',
                                            borderBottom: '1px dashed var(--border-color)',
                                          }}
                                        >
                                          <span>{pb.parcelName}</span>
                                          <span style={{ fontWeight: 700 }}>
                                            {(pb.totalHa || 0).toFixed(1)} ha ({pb.count}x)
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                      Nema zabeleženih parcela.
                                    </div>
                                  )}
                                </div>

                                {/* Realizacija radnih naloga */}
                                <div className={styles.deepDiveCard}>
                                  <div className={styles.deepDiveTitle}>
                                    <CheckCircle2 size={16} color="#0284c7" />
                                    <span>Status dodeljenih radnih naloga</span>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.85rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span>Završeni nalozi:</span>
                                      <strong style={{ color: '#16a34a' }}>
                                        {w.orderStats?.ZAVRSEN || 0}
                                      </strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span>Nalozi u toku:</span>
                                      <strong style={{ color: '#0284c7' }}>
                                        {w.orderStats?.U_TOKU || 0}
                                      </strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span>Planirani / Dodeljeni:</span>
                                      <strong style={{ color: '#d97706' }}>
                                        {(w.orderStats?.PLANIRAN || 0) + (w.orderStats?.DODELJEN || 0)}
                                      </strong>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                      <span>Otkazani nalozi:</span>
                                      <strong style={{ color: '#dc2626' }}>
                                        {w.orderStats?.OTKAZAN || 0}
                                      </strong>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {workersList.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '2rem' }}>
                        Nema radnika koji odgovaraju zadatim filterima.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {workersPagination.total > 0 && (
              <div style={{ marginTop: '0.5rem', borderRadius: 10, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <TablePagination
                  currentPage={workersPage}
                  totalPages={workersPagination.totalPages}
                  totalItems={workersPagination.total}
                  pageSize={PAGE_SIZE}
                  onPageChange={setWorkersPage}
                  itemName="radnika"
                />
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 4: FINANSIJE & MESEČNI TOKOVI (DB paginacija 10 po strani)
           ======================================================== */}
        {activeTab === 'troskovi' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h3 className={styles.cardTitle}>
                  <Coins size={20} color="#0284c7" />
                  Mesečni Finansijski Tokovi i Troškovi Poslovanja ({financialPagination.total})
                </h3>
                {activeFilterSummary && (
                  <span style={{ fontSize: '0.82rem', color: '#0284c7', fontWeight: 600 }}>
                    Aktivni filteri: {activeFilterSummary}
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Uporedni mesečni pregled troškova goriva, servisa, putarina i sezonske radne snage (10 po stranici)
              </span>
            </div>

            <div className={styles.tableContainer}>
              <table className={styles.dataTable} style={{ minWidth: '850px' }}>
                <thead>
                  <tr>
                    <th>Mesec</th>
                    <th>Gorivo (L)</th>
                    <th>Trošak Goriva</th>
                    <th>Popravke & Delovi</th>
                    <th>Putarine</th>
                    <th>Dnevnice Sezonaca</th>
                    <th>Ukupan Trošak Meseca</th>
                  </tr>
                </thead>
                <tbody>
                  {financialList.map((f: any) => {
                    const mnt = (financialData?.maintenanceByMonth || []).find((m: any) => m.month === f.month);
                    const toll = (financialData?.tollsByMonth || []).find((t: any) => t.month === f.month);
                    const seas = (financialData?.seasonalByMonth || []).find((s: any) => s.month === f.month);

                    const fuelCost = f.total_cost || 0;
                    const maintCost = mnt ? mnt.total_cost || 0 : 0;
                    const tollCost = toll ? toll.total_amount || 0 : 0;
                    const seasCost = seas ? seas.total_wages || 0 : 0;
                    const monthTotal = fuelCost + maintCost + tollCost + seasCost;

                    return (
                      <tr key={f.month}>
                        <td style={{ fontWeight: 700 }}>{f.month}</td>
                        <td>{(f.total_liters || 0).toLocaleString('sr-RS')} L</td>
                        <td>{fuelCost.toLocaleString('sr-RS')} RSD</td>
                        <td className={styles.costText}>{maintCost.toLocaleString('sr-RS')} RSD</td>
                        <td>{tollCost.toLocaleString('sr-RS')} RSD</td>
                        <td>{seasCost.toLocaleString('sr-RS')} RSD</td>
                        <td className={styles.costTotal}>{monthTotal.toLocaleString('sr-RS')} RSD</td>
                      </tr>
                    );
                  })}
                  {financialList.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                        Nema evidentiranih mesečnih troškova za izabrani period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {financialPagination.total > 0 && (
              <div style={{ marginTop: '0.5rem', borderRadius: 10, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <TablePagination
                  currentPage={financialPage}
                  totalPages={financialPagination.totalPages}
                  totalItems={financialPagination.total}
                  pageSize={PAGE_SIZE}
                  onPageChange={setFinancialPage}
                  itemName="meseci"
                />
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 5: PARCELE & AGROTEHNIKA (DB paginacija 10 po strani)
           ======================================================== */}
        {activeTab === 'parcele' && (
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h3 className={styles.cardTitle}>
                  <Sprout size={20} color="#16a34a" />
                  Učinak i Ulaganja po Parcelama ({parcelsPagination.total})
                </h3>
                {activeFilterSummary && (
                  <span style={{ fontSize: '0.82rem', color: '#0284c7', fontWeight: 600 }}>
                    Aktivni filteri: {activeFilterSummary}
                  </span>
                )}
              </div>

              <div className={styles.searchBox}>
                <Search size={16} color="var(--text-secondary)" />
                <input
                  type="text"
                  placeholder="Pretraži parcelu po nazivu ili šifri..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className={styles.tableContainer}>
              <table className={styles.dataTable} style={{ minWidth: '850px' }}>
                <thead>
                  <tr>
                    <th>Parcela</th>
                    <th>Šifra</th>
                    <th>Površina (ha)</th>
                    <th>Urađeno operacija</th>
                    <th>Utrošak Đubriva</th>
                    <th>Sezonski rad (h)</th>
                    <th>Isplaćeno za sezonu</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelsList.map((p: any) => (
                    <tr key={p.parcel.id}>
                      <td style={{ fontWeight: 700 }}>{p.parcel.name}</td>
                      <td>
                        <span className={styles.typeBadge}>[{p.parcel.code}]</span>
                      </td>
                      <td>{p.parcel.areaHa} ha</td>
                      <td>
                        <span style={{ fontWeight: 700, color: '#16a34a' }}>
                          {(p.fieldWork?.totalHa || 0).toFixed(1)} ha
                        </span>{' '}
                        ({p.fieldWork?.count || 0} radova · {(p.fieldWork?.totalWorkHours || 0).toFixed(1)} h)
                      </td>
                      <td>
                        {(p.fertilizer?.totalQuantity || 0).toLocaleString('sr-RS')} kg/L
                        {p.fertilizer?.totalCost ? (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {p.fertilizer.totalCost.toLocaleString('sr-RS')} RSD
                          </div>
                        ) : null}
                      </td>
                      <td>{(p.seasonal?.totalHours || 0).toFixed(1)} h</td>
                      <td style={{ fontWeight: 700 }}>
                        {(p.seasonal?.totalWages || 0).toLocaleString('sr-RS')} RSD
                      </td>
                    </tr>
                  ))}
                  {parcelsList.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                        Nema parcela koje odgovaraju zadatim filterima.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {parcelsPagination.total > 0 && (
              <div style={{ marginTop: '0.5rem', borderRadius: 10, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                <TablePagination
                  currentPage={parcelsPage}
                  totalPages={parcelsPagination.totalPages}
                  totalItems={parcelsPagination.total}
                  pageSize={PAGE_SIZE}
                  onPageChange={setParcelsPage}
                  itemName="parcela"
                />
              </div>
            )}
          </div>
        )}

        {/* ========================================================
            TAB 6: DETALJAN DNEVNIK RADOVA (DB paginacija 15 po strani)
           ======================================================== */}
        {activeTab === 'radovi' && (
          <>
            <div className={styles.kpiGrid}>
              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Ukupno radova</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconBlue}`}>
                    <ClipboardList size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>{worksSummary.totalWorks}</div>
                <div className={styles.kpiFooter}>
                  <span>{worksSummary.distinctParcels} parcela</span>
                  <span className={styles.kpiHighlight}>{worksSummary.distinctWorkTypes} vrsta posla</span>
                </div>
              </div>

              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Urađena površina</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconGreen}`}>
                    <Layers size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>
                  {(worksSummary.totalHa || 0).toFixed(1)} <span style={{ fontSize: '1rem' }}>ha</span>
                </div>
                <div className={styles.kpiFooter}>
                  <span>Prosek po radu:</span>
                  <span className={styles.kpiHighlight}>
                    {worksSummary.avgHaPerWork != null ? `${worksSummary.avgHaPerWork.toFixed(2)} ha` : '-'}
                  </span>
                </div>
              </div>

              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Ukupno radnih sati</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconAmber}`}>
                    <Clock size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>
                  {(worksSummary.totalHours || 0).toFixed(1)} <span style={{ fontSize: '1rem' }}>h</span>
                </div>
                <div className={styles.kpiFooter}>
                  <span>Prosečan učinak:</span>
                  <span className={styles.kpiHighlight}>
                    {worksSummary.avgHaPerHour != null ? `${worksSummary.avgHaPerHour.toFixed(2)} ha/h` : '-'}
                  </span>
                </div>
              </div>

              <div className={styles.kpiCard}>
                <div className={styles.kpiCardHeader}>
                  <span className={styles.kpiLabel}>Radnih dana na terenu</span>
                  <div className={`${styles.kpiIconWrapper} ${styles.iconPurple}`}>
                    <Calendar size={18} />
                  </div>
                </div>
                <div className={styles.kpiMainValue}>
                  {worksSummary.distinctDays} <span style={{ fontSize: '1rem' }}>dana</span>
                </div>
                <div className={styles.kpiFooter}>
                  <span>
                    {worksSummary.avgHoursPerDay != null ? `Prosek: ${worksSummary.avgHoursPerDay.toFixed(1)} h/dan` : 'Bez satnice'}
                  </span>
                  {worksSummary.estimatedLabourCost != null && (
                    <span className={styles.kpiHighlight}>
                      {worksSummary.estimatedLabourCost.toLocaleString('sr-RS')} RSD
                    </span>
                  )}
                </div>
              </div>
            </div>

            {worksByWorkType.length > 0 && (
              <div className={styles.card}>
                <div className={styles.cardHeader}>
                  <div>
                    <h3 className={styles.cardTitle}>
                      <Layers size={18} color="#16a34a" />
                      Struktura poslova ({worksByWorkType.length})
                    </h3>
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      Klikni na operaciju da filtriraš spisak radova ispod
                    </span>
                  </div>
                  {selectedWorkTypeId && (
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      onClick={() => setSelectedWorkTypeId('')}
                    >
                      Prikaži sve operacije
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem' }}>
                  {worksByWorkType.map((wt: any) => {
                    const isSelected = selectedWorkTypeId === wt.workTypeId;
                    return (
                      <button
                        key={wt.workTypeId}
                        type="button"
                        onClick={() => setSelectedWorkTypeId(isSelected ? '' : wt.workTypeId)}
                        className={`${styles.presetPill} ${isSelected ? styles.presetPillActive : ''}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}
                      >
                        <strong>{wt.name}</strong>
                        <span>
                          {(wt.totalHa || 0).toFixed(1)} ha · {(wt.totalHours || 0).toFixed(1)} h ({wt.count}x)
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <h3 className={styles.cardTitle}>
                    <ClipboardList size={20} color="#0284c7" />
                    Dnevnik izvršenih radova ({worksPagination.total})
                  </h3>
                  {activeFilterSummary && (
                    <span style={{ fontSize: '0.82rem', color: '#0284c7', fontWeight: 600 }}>
                      Aktivni filteri: {activeFilterSummary}
                    </span>
                  )}
                </div>

                <div className={styles.searchBox}>
                  <Search size={16} color="var(--text-secondary)" />
                  <input
                    type="text"
                    placeholder="Pretraži rad, parcelu, mašinu, napomenu..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.tableContainer}>
                <table className={styles.dataTable} style={{ minWidth: '1020px' }}>
                  <thead>
                    <tr>
                      <th>Datum & Vreme</th>
                      <th>Radnik</th>
                      <th>Operacija & Materijal</th>
                      <th>Parcela</th>
                      <th>Mašina & Priključak</th>
                      <th>Urađeno</th>
                      <th>Radni sati</th>
                      <th>Napomena</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worksList.map((w: any) => {
                      const eff = w.workHours && w.areaDoneHa ? (w.areaDoneHa / w.workHours).toFixed(2) : null;
                      const assignedMachines = (w.machineAssignments || [])
                        .map((a: any) => a.machine?.name)
                        .filter(Boolean);
                      const uniqueAssignedMachines = [...new Set(assignedMachines)];
                      const hasReplacementMachines =
                        uniqueAssignedMachines.length > 1 ||
                        (uniqueAssignedMachines.length === 1 && uniqueAssignedMachines[0] !== w.machine?.name);

                      return (
                        <tr key={w.id}>
                          <td>
                            <div style={{ fontWeight: 700 }}>
                              {new Date(w.date).toLocaleDateString('sr-RS')}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {w.shift}
                              {w.startTime && w.endTime ? ` · ${w.startTime}–${w.endTime}` : ''}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{w.worker?.name || '-'}</div>
                            {w.worker?.role && (
                              <span className={styles.typeBadge}>{w.worker.role}</span>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{w.workType?.name || '-'}</div>
                            {w.materials && w.materials.length > 0 && (
                              <div style={{ fontSize: '0.75rem', color: '#0284c7', marginTop: '0.15rem' }}>
                                {w.materials
                                  .map((mat: any) =>
                                    `${mat.name}${mat.dosePerHa != null ? ` (${mat.dosePerHa} ${mat.unit}/ha)` : ''}`
                                  )
                                  .join(', ')}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {w.parcel ? `[${w.parcel.code}] ${w.parcel.name}` : '-'}
                            </div>
                            {w.parcel?.currentCrop && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {w.parcel.currentCrop}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {hasReplacementMachines
                                ? uniqueAssignedMachines.join(' → ')
                                : w.machine?.name || w.contractor?.name || '-'}
                            </div>
                            {w.attachment?.name && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                + {w.attachment.name}
                              </div>
                            )}
                          </td>
                          <td style={{ fontWeight: 700, color: '#16a34a' }}>
                            {(w.areaDoneHa || 0).toFixed(1)} ha
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {w.workHours != null ? `${Number(w.workHours).toFixed(1)} h` : '-'}
                            </div>
                            {eff && (
                              <div style={{ fontSize: '0.75rem', color: '#0284c7' }}>{eff} ha/h</div>
                            )}
                          </td>
                          <td style={{ maxWidth: '220px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            {w.notes || '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {!worksLoading && worksList.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                          Nema evidentiranih radova koji odgovaraju zadatim filterima.
                        </td>
                      </tr>
                    )}
                    {worksLoading && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                          Učitavanje radova...
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {worksPagination.total > 0 && (
                <div style={{ marginTop: '0.5rem', borderRadius: 10, border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                  <TablePagination
                    currentPage={worksPage}
                    totalPages={worksPagination.totalPages}
                    totalItems={worksPagination.total}
                    pageSize={WORKS_PAGE_SIZE}
                    onPageChange={setWorksPage}
                    itemName="radova"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default AnalitikaDashboard;
