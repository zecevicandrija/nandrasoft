import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { applyUnicodeFont } from '../lib/pdfFont';
import AppLayout from '../components/Layout/AppLayout';
import CustomSelect, { type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { useSession } from '../lib/auth-client';
import styles from './AnalitikaDashboard.module.css';

type PresetType = 'DANAS' | 'ZADNJIH_7' | 'MESEC' | 'ZADNJIH_30' | 'GODINA' | 'SVE' | 'CUSTOM';
type ActiveTab = 'pregled' | 'masine' | 'radnici' | 'troskovi' | 'parcele';

const API = '/api';
const PAGE_SIZE = 10;

export const AnalitikaDashboard: React.FC = () => {
  const { data: session, isPending: sessionLoading } = useSession();
  const currentUser = (session as any)?.user;
  const isDirector = currentUser?.role === 'DIREKTOR';

  // State za navigaciju i tabove
  const [activeTab, setActiveTab] = useState<ActiveTab>('pregled');
  const [expandedMachineId, setExpandedMachineId] = useState<string | null>(null);
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null);

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

  // Paginacija za svih 5 sekcija (10 po stranici na nivou baze)
  const [topMachinesPage, setTopMachinesPage] = useState(1);
  const [machinesPage, setMachinesPage] = useState(1);
  const [workersPage, setWorkersPage] = useState(1);
  const [financialPage, setFinancialPage] = useState(1);
  const [parcelsPage, setParcelsPage] = useState(1);

  // Export loading stanja
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

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
    setSearchTerm('');
    setTopMachinesPage(1);
    setMachinesPage(1);
    setWorkersPage(1);
    setFinancialPage(1);
    setParcelsPage(1);
  };

  // Resetovanje paginacije pri promeni pretrage ili filtera
  useEffect(() => {
    setMachinesPage(1);
  }, [searchTerm, selectedMachine, dateFrom, dateTo, preset]);

  useEffect(() => {
    setWorkersPage(1);
  }, [searchTerm, selectedWorker, dateFrom, dateTo, preset]);

  useEffect(() => {
    setParcelsPage(1);
  }, [selectedParcel, dateFrom, dateTo, preset]);

  useEffect(() => {
    setFinancialPage(1);
  }, [dateFrom, dateTo, preset]);

  useEffect(() => {
    setTopMachinesPage(1);
  }, [dateFrom, dateTo, preset]);

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
      subLabel: `${p.areaHa} ha${p.currentCrop ? ` • ${p.currentCrop}` : ''}`,
    }));
    return [{ value: '', label: 'Sve parcele' }, ...list];
  }, [filtersData?.parcels]);

  // Query parametri za API pozive
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.append('dateFrom', dateFrom);
    if (dateTo) params.append('dateTo', dateTo);
    return params.toString();
  }, [dateFrom, dateTo]);

  // 2. GENERALNI PREGLED (KPIs)
  const { data: overviewData, isLoading: overviewLoading, refetch: refetchOverview } = useQuery({
    queryKey: ['analytics-overview', queryParams],
    queryFn: async () => {
      const res = await fetch(`${API}/analytics/overview?${queryParams}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju pregleda');
      return res.json();
    },
    enabled: isDirector,
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
    enabled: isDirector,
  });

  // 3. ANALITIKA PO MAŠINAMA (Sa DB paginacijom & search)
  const { data: machinesData, refetch: refetchMachines } = useQuery({
    queryKey: ['analytics-machines', queryParams, selectedMachine, searchTerm, machinesPage],
    queryFn: async () => {
      const p = new URLSearchParams(queryParams);
      if (selectedMachine) p.append('machineId', selectedMachine);
      if (searchTerm.trim()) p.append('search', searchTerm.trim());
      p.append('page', String(machinesPage));
      p.append('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/analytics/machines?${p.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju mašina');
      return res.json();
    },
    enabled: isDirector,
  });

  // 4. ANALITIKA PO RADNICIMA (Sa DB paginacijom & search)
  const { data: workersData, refetch: refetchWorkers } = useQuery({
    queryKey: ['analytics-workers', queryParams, selectedWorker, searchTerm, workersPage],
    queryFn: async () => {
      const p = new URLSearchParams(queryParams);
      if (selectedWorker) p.append('workerId', selectedWorker);
      if (searchTerm.trim()) p.append('search', searchTerm.trim());
      p.append('page', String(workersPage));
      p.append('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/analytics/workers?${p.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju radnika');
      return res.json();
    },
    enabled: isDirector,
  });

  // 5. ANALITIKA PO PARCELAMA (Sa DB paginacijom)
  const { data: parcelsData, refetch: refetchParcels } = useQuery({
    queryKey: ['analytics-parcels', queryParams, selectedParcel, parcelsPage],
    queryFn: async () => {
      const p = new URLSearchParams(queryParams);
      if (selectedParcel) p.append('parcelId', selectedParcel);
      p.append('page', String(parcelsPage));
      p.append('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/analytics/parcels?${p.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju parcela');
      return res.json();
    },
    enabled: isDirector,
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
    enabled: isDirector,
  });

  // Osvežavanje svih podataka
  const handleRefreshAll = () => {
    refetchOverview();
    refetchTopMachines();
    refetchMachines();
    refetchWorkers();
    refetchParcels();
    refetchFinancial();
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
      const doc = new jsPDF('landscape', 'mm', 'a4');
      await applyUnicodeFont(doc);

      const periodText = dateFrom && dateTo ? `${dateFrom} do ${dateTo}` : 'Celokupan period';
      const generatedAt = new Date().toLocaleString('sr-RS');

      // Povlačenje svih stavki sa servera za celovit PDF
      const exportParams = new URLSearchParams(queryParams);
      exportParams.append('all', 'true');
      if (selectedMachine) exportParams.append('machineId', selectedMachine);
      if (selectedWorker) exportParams.append('workerId', selectedWorker);
      if (searchTerm.trim()) exportParams.append('search', searchTerm.trim());

      const [exportMachinesRes, exportWorkersRes] = await Promise.all([
        fetch(`${API}/analytics/machines?${exportParams.toString()}`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`${API}/analytics/workers?${exportParams.toString()}`, { credentials: 'include' }).then((r) => r.json()),
      ]);

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
          `Uradeno: ${(overviewData?.totalHaDone || 0).toFixed(1)} ha (${overviewData?.totalFieldWorks || 0} radova)`,
          `Gorivo: ${(overviewData?.totalFuelLiters || 0).toLocaleString('sr-RS')} L (${(overviewData?.totalFuelCost || 0).toLocaleString('sr-RS')} RSD)`,
          `Odrzavanje: ${(overviewData?.totalMaintenanceCost || 0).toLocaleString('sr-RS')} RSD (Delovi: ${(overviewData?.maintenancePartsCost || 0).toLocaleString('sr-RS')} RSD)`,
        ],
        [
          `Putarine / ENP: ${(overviewData?.totalTollCost || 0).toLocaleString('sr-RS')} RSD`,
          `Sezonci: ${(overviewData?.totalSeasonalHours || 0).toFixed(1)} h (${(overviewData?.totalSeasonalWages || 0).toLocaleString('sr-RS')} RSD dnevnica)`,
          `UKUPNI OPERATIVNI TROSKOVI: ${totalOperatingCosts.toLocaleString('sr-RS')} RSD`,
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

      const machineTableRows = (exportMachinesRes?.machines || []).map((m: any, idx: number) => [
        idx + 1,
        m.machine.name,
        m.machine.type,
        `${(m.fieldWork.totalHa || 0).toFixed(1)} ha`,
        `${(m.fieldWork.totalWorkHours || 0).toFixed(1)} h`,
        `${(m.fuel.totalLiters || 0).toLocaleString('sr-RS')} L`,
        m.fuel.avgLPerHa ? `${m.fuel.avgLPerHa} L/ha` : '-',
        `${(m.maintenance.totalCost || 0).toLocaleString('sr-RS')} RSD`,
        `${m.maintenance.count} popravki (${m.maintenance.downtimeHours || 0}h zastoja)`,
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
            'Potr. L/ha',
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

      const workerTableRows = (exportWorkersRes?.workers || []).map((w: any, idx: number) => {
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

      doc.save(`Nandra_Direktorski_Izvestaj_${dateFrom || 'sve'}_${dateTo || 'sve'}.pdf`);
    } catch (err) {
      console.error('Greška pri izradi PDF izveštaja:', err);
      alert('Došlo je do greške pri izradi PDF izveštaja.');
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
      const wb = XLSX.utils.book_new();

      const exportParams = new URLSearchParams(queryParams);
      exportParams.append('all', 'true');
      if (selectedMachine) exportParams.append('machineId', selectedMachine);
      if (selectedWorker) exportParams.append('workerId', selectedWorker);
      if (selectedParcel) exportParams.append('parcelId', selectedParcel);
      if (searchTerm.trim()) exportParams.append('search', searchTerm.trim());

      const [exportMachinesRes, exportWorkersRes, exportParcelsRes, exportFinancialRes] = await Promise.all([
        fetch(`${API}/analytics/machines?${exportParams.toString()}`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`${API}/analytics/workers?${exportParams.toString()}`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`${API}/analytics/parcels?${exportParams.toString()}`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`${API}/analytics/financial?${exportParams.toString()}`, { credentials: 'include' }).then((r) => r.json()),
      ]);

      // Sheet 1: Pregled
      const overviewRows = [
        { Metrika: 'Period izveštaja', Vrednost: `${dateFrom || 'Sve'} do ${dateTo || 'Sve'}` },
        { Metrika: 'Ukupno urađeno hektara', Vrednost: overviewData?.totalHaDone || 0 },
        { Metrika: 'Ukupno završenih radova na njivi', Vrednost: overviewData?.totalFieldWorks || 0 },
        { Metrika: 'Ukupno utrošeno goriva (litara)', Vrednost: overviewData?.totalFuelLiters || 0 },
        { Metrika: 'Ukupan trošak goriva (RSD)', Vrednost: overviewData?.totalFuelCost || 0 },
        { Metrika: 'Uloženo u popravke i servis (RSD)', Vrednost: overviewData?.totalMaintenanceCost || 0 },
        { Metrika: 'Trošak rezervnih delova (RSD)', Vrednost: overviewData?.maintenancePartsCost || 0 },
        { Metrika: 'Trošak eksternog rada servisa (RSD)', Vrednost: overviewData?.maintenanceLaborCost || 0 },
        { Metrika: 'Troškovi putarina i ENP (RSD)', Vrednost: overviewData?.totalTollCost || 0 },
        { Metrika: 'Troškovi nabavke đubriva (RSD)', Vrednost: overviewData?.totalFertilizerCost || 0 },
        { Metrika: 'Sati rada sezonskih radnika', Vrednost: overviewData?.totalSeasonalHours || 0 },
        { Metrika: 'Isplaćene dnevnice sezonaca (RSD)', Vrednost: overviewData?.totalSeasonalWages || 0 },
        { Metrika: 'Otpremljeno luka (kg)', Vrednost: overviewData?.onionShippedKg || 0 },
        { Metrika: 'Fakturisana vrednost luka (RSD)', Vrednost: overviewData?.onionShipmentValue || 0 },
        { Metrika: 'UKUPNI OPERATIVNI TROŠKOVI (RSD)', Vrednost: totalOperatingCosts },
      ];
      const wsOverview = XLSX.utils.json_to_sheet(overviewRows);
      XLSX.utils.book_append_sheet(wb, wsOverview, 'Pregled & KPI');

      // Sheet 2: Mašine
      const machineRows = (exportMachinesRes?.machines || []).map((m: any) => ({
        'Naziv Mašine': m.machine.name,
        Tip: m.machine.type,
        'Model / Marka': m.machine.brandModel || '',
        'Trenutni Radni Sati': m.machine.currentHours || 0,
        Status: m.machine.status,
        'Urađeno ha (period)': m.fieldWork.totalHa || 0,
        'Radnih Sati na Njivi': m.fieldWork.totalWorkHours || 0,
        'Utrošeno Goriva (L)': m.fuel.totalLiters || 0,
        'Trošak Goriva (RSD)': m.fuel.totalCost || 0,
        'Prosečna Potrošnja (L/ha)': m.fuel.avgLPerHa || 0,
        'Popravke Ukupno (RSD)': m.maintenance.totalCost || 0,
        'Trošak Delova (RSD)': m.maintenance.partsCost || 0,
        'Trošak Rada Servisa (RSD)': m.maintenance.laborCost || 0,
        'Broj Kvarova': m.maintenance.count || 0,
        'Sati Zastoja (Downtime)': m.maintenance.downtimeHours || 0,
        'Putarine (RSD)': m.tolls.totalCost || 0,
        'UKUPAN TROŠAK MAŠINE (RSD)': m.totalCostMachine || 0,
      }));
      const wsMachines = XLSX.utils.json_to_sheet(machineRows);
      XLSX.utils.book_append_sheet(wb, wsMachines, 'Mašine');

      // Sheet 3: Radnici
      const workerRows = (exportWorkersRes?.workers || []).map((w: any) => ({
        'Ime Radnika': w.worker.name,
        Uloga: w.worker.role || 'OPERATER',
        Tip: w.worker.type || 'STALNI',
        Telefon: w.worker.phone || '',
        'Urađeno ha (period)': w.fieldWork.totalHa || 0,
        'Radni Sati na Njivi': w.fieldWork.totalWorkHours || 0,
        'Efikasnost (ha/h)':
          w.fieldWork.totalWorkHours && w.fieldWork.totalHa
            ? +(w.fieldWork.totalHa / w.fieldWork.totalWorkHours).toFixed(2)
            : 0,
        'Sipano Gorivo Tokom Rada (L)': w.fuel.totalLiters || 0,
        'Broj Prijavljenih Kvarova': w.maintenanceReported || 0,
        'Putarine (RSD)': w.tolls.totalCost || 0,
        'Procenjen Trošak Rada (RSD)': w.fieldWork.estimatedLabourCost || 0,
      }));
      const wsWorkers = XLSX.utils.json_to_sheet(workerRows);
      XLSX.utils.book_append_sheet(wb, wsWorkers, 'Radnici');

      // Sheet 4: Istorija Popravki Mehanizacije (Šta je rađeno)
      const allRepairs: any[] = [];
      (exportMachinesRes?.machines || []).forEach((m: any) => {
        (m.maintenance.recentRepairs || []).forEach((r: any) => {
          allRepairs.push({
            Mašina: m.machine.name,
            Datum: r.dateReported ? r.dateReported.substring(0, 10) : '',
            'Naslov / Opis Kvara': r.title,
            'Tip Servisa': r.serviceType,
            Prioritet: r.priority,
            Status: r.status,
            'Zamenjeni Delovi': r.partsReplaced || '',
            'Izveštaj Mehaničara': r.repairNotes || '',
            'Utrošeno Mazivo': r.lubricantType ? `${r.lubricantType} (${r.lubricantLiters || 0} L)` : '',
            'Trošak Popravke (RSD)': r.totalCost || 0,
            'Sati Zastoja': r.downtimeHours || 0,
          });
        });
      });
      if (allRepairs.length > 0) {
        const wsRepairs = XLSX.utils.json_to_sheet(allRepairs);
        XLSX.utils.book_append_sheet(wb, wsRepairs, 'Istorija Popravki');
      }

      // Sheet 5: Parcele
      const parcelRows = (exportParcelsRes?.parcels || []).map((p: any) => ({
        'Naziv Parcele': p.parcel.name,
        Šifra: p.parcel.code,
        'Površina (ha)': p.parcel.areaHa,
        'Trenutna Kultura': p.parcel.currentCrop || '',
        'Urađeno Operacija (broj)': p.fieldWork.count || 0,
        'Urađeno ha (ukupno operacija)': p.fieldWork.totalHa || 0,
        'Utrošak Đubriva (kg/L)': p.fertilizer.totalQuantity || 0,
        'Trošak Đubriva (RSD)': p.fertilizer.totalCost || 0,
        'Sati Sezonaca na Parceli': p.seasonal.totalHours || 0,
        'Isplaćene Dnevnice na Parceli (RSD)': p.seasonal.totalWages || 0,
      }));
      const wsParcels = XLSX.utils.json_to_sheet(parcelRows);
      XLSX.utils.book_append_sheet(wb, wsParcels, 'Parcele');

      // Sheet 6: Mesečni Troškovi
      const monthlyRows = (exportFinancialRes?.allFuelByMonth || exportFinancialRes?.fuelByMonth || []).map((f: any) => {
        const mnt = (exportFinancialRes?.maintenanceByMonth || []).find((m: any) => m.month === f.month);
        const toll = (exportFinancialRes?.tollsByMonth || []).find((t: any) => t.month === f.month);
        const seas = (exportFinancialRes?.seasonalByMonth || []).find((s: any) => s.month === f.month);
        const fuelCost = f.total_cost || 0;
        const maintCost = mnt ? mnt.total_cost || 0 : 0;
        const tollCost = toll ? toll.total_amount || 0 : 0;
        const seasCost = seas ? seas.total_wages || 0 : 0;
        return {
          Mesec: f.month,
          'Gorivo (L)': f.total_liters || 0,
          'Gorivo Trošak (RSD)': fuelCost,
          'Popravke Trošak (RSD)': maintCost,
          'Putarine (RSD)': tollCost,
          'Dnevnice Sezonaca (RSD)': seasCost,
          'UKUPNO TROŠAK (RSD)': fuelCost + maintCost + tollCost + seasCost,
        };
      });
      if (monthlyRows.length > 0) {
        const wsMonthly = XLSX.utils.json_to_sheet(monthlyRows);
        XLSX.utils.book_append_sheet(wb, wsMonthly, 'Mesečni Troškovi');
      }

      XLSX.writeFile(wb, `Nandra_Direktorska_Analitika_${dateFrom || 'sve'}_${dateTo || 'sve'}.xlsx`);
    } catch (err) {
      console.error('Greška pri izradi Excel tabele:', err);
      alert('Došlo je do greške pri izvozu u Excel.');
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
            <p className={styles.subtitle}>
              Sveobuhvatna statistika rada mehanizacije, goriva, uloga u popravke, radnika, parcela i finansija
            </p>
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
              onClick={handleRefreshAll}
              title="Osveži sve podatke sa servera"
            >
              <RotateCcw size={16} />
              Osveži
            </button>
          </div>
        </div>

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
          <button
            className={`${styles.tabBtn} ${activeTab === 'pregled' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('pregled')}
          >
            <BarChart3 size={18} />
            Pregled & Ključni Pokazatelji
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'masine' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('masine')}
          >
            <Tractor size={18} />
            Mašine & Održavanje
            <span className={styles.tabBadge}>{machinesPagination.total}</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'radnici' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('radnici')}
          >
            <Users size={18} />
            Radnici & Učinak
            <span className={styles.tabBadge}>{workersPagination.total}</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'troskovi' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('troskovi')}
          >
            <Coins size={18} />
            Finansije & Mesečni Tokovi
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'parcele' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('parcele')}
          >
            <Sprout size={18} />
            Parcele & Agrotehnika
            <span className={styles.tabBadge}>{parcelsPagination.total}</span>
          </button>
        </div>

        {/* ========================================================
            TAB 1: PREGLED & KPI
           ======================================================== */}
        {activeTab === 'pregled' && (
          <>
            {/* Executive Total Cost Banner */}
            <div className={styles.executiveBanner}>
              <div className={styles.bannerInfo}>
                <h3>Ukupni operativni troškovi poslovanja (u izabranom periodu)</h3>
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
              <h3 className={styles.cardTitle}>
                <Tractor size={20} color="#0284c7" />
                Analitika Mašina i Flote ({machinesPagination.total})
              </h3>

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

            <div className={styles.tableContainer}>
              <table className={styles.dataTable} style={{ minWidth: '950px' }}>
                <thead>
                  <tr>
                    <th>Mašina</th>
                    <th>Status</th>
                    <th>Stanje rh</th>
                    <th>Urađeno (ha)</th>
                    <th>Radni sati</th>
                    <th>Gorivo (L & RSD)</th>
                    <th>Potrošnja</th>
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
                            {m.fuel.avgLPerHa ? (
                              <span style={{ fontWeight: 700, color: '#0284c7' }}>
                                {m.fuel.avgLPerHa} L/ha
                              </span>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td>
                            <div className={styles.costText}>
                              {(m.maintenance.totalCost || 0).toLocaleString('sr-RS')} RSD
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {m.maintenance.count} kvarova ({m.maintenance.downtimeHours || 0}h stajanja)
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
                            <td colSpan={11}>
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
                      <td colSpan={11} style={{ textAlign: 'center', padding: '2rem' }}>
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
              <h3 className={styles.cardTitle}>
                <Users size={20} color="#16a34a" />
                Analitika Učinka Zaposlenih ({workersPagination.total})
              </h3>

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

            <div className={styles.tableContainer}>
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
              <h3 className={styles.cardTitle}>
                <Coins size={20} color="#0284c7" />
                Mesečni Finansijski Tokovi i Troškovi Poslovanja ({financialPagination.total})
              </h3>
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
              <h3 className={styles.cardTitle}>
                <Sprout size={20} color="#16a34a" />
                Učinak i Ulaganja po Parcelama ({parcelsPagination.total})
              </h3>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                10 parcela po stranici (iz baze podataka)
              </span>
            </div>

            <div className={styles.tableContainer}>
              <table className={styles.dataTable} style={{ minWidth: '850px' }}>
                <thead>
                  <tr>
                    <th>Parcela</th>
                    <th>Šifra</th>
                    <th>Površina (ha)</th>
                    <th>Kultura</th>
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
                      <td>{p.parcel.currentCrop || 'Nije uneto'}</td>
                      <td>
                        <span style={{ fontWeight: 700, color: '#16a34a' }}>
                          {(p.fieldWork?.totalHa || 0).toFixed(1)} ha
                        </span>{' '}
                        ({p.fieldWork?.count || 0} radova)
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
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
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
      </div>
    </AppLayout>
  );
};

export default AnalitikaDashboard;
