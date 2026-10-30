import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sprout,
  Snowflake,
  Warehouse,
  Scale,
  Package,
  Truck,
  AlertTriangle,
  Search,
  Plus,
  Tractor,
  FileText,
  CheckCircle2,
  AlertCircle,
  X,
  RotateCw,
  Layers,
  QrCode,
  Calendar,
  Clock,
  Copy,
  ArrowRight,
  Download,
  ClipboardCheck,
  Box,
  Users,
  UserCheck,
  Pencil,
  Settings2,
  Trash2,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { applyUnicodeFont } from '../lib/pdfFont';
import AppLayout from '../components/Layout/AppLayout';
import { CustomSelect, type CustomSelectOption } from '../components/CustomSelect/CustomSelect';
import TablePagination from '../components/TablePagination/TablePagination';
import { useSession } from '../lib/auth-client';
import { ParcelQuickModal, ParcelQuickActions, type ParcelItem } from '../components/ParcelQuickModal';
import { BuyerQuickModal, BuyerQuickActions, type BuyerItem } from '../components/BuyerQuickModal';
import styles from './OnionDashboard.module.css';

const API = '/api/onion';

type TabKey =
  | 'dovoz'
  | 'skladiste'
  | 'sortiranje'
  | 'pakovanje'
  | 'isporuka'
  | 'otpis'
  | 'sledljivost';

const PACKAGE_LABELS: Record<string, string> = {
  DZAK_10KG: 'Mrežasti džak 10 kg (100 kom / paleta)',
  DZAK_5KG: 'Mrežasti džak 5 kg (200 kom / paleta)',
  DZAK_25KG: 'Mrežasti džak 25 kg (40 kom / paleta)',
  DZAMBO_VRECA: 'Džambo vreća (1.000 kg)',
  BOKS_PALETA: 'Drvena boks paleta 160x120x120 (1.100 kg)',
  RINFUZ: 'Rinfuz',
  DRUGO: 'Prilagođeno pakovanje',
};

const PACKAGE_WEIGHTS: Record<string, number> = {
  DZAK_5KG: 5,
  DZAK_10KG: 10,
  DZAK_25KG: 25,
  DZAMBO_VRECA: 1000,
  BOKS_PALETA: 1100,
  RINFUZ: 1,
  DRUGO: 10,
};

// Koliko džakova staje na 1 paletu spakovanog luka (1.000 kg po paleti)
const BAGS_PER_PALLET: Record<string, number> = {
  DZAK_10KG: 100, // Na paleti staje 100 džakova po 10kg
  DZAK_5KG: 200,  // Na paleti staje 200 džakova po 5kg
  DZAK_25KG: 40,  // 40 džakova po 25kg
  DZAMBO_VRECA: 1,
  BOKS_PALETA: 1,
};

const STANDARD_CHAMBER_NAMES = [
  'Komora 1',
  'Komora 2',
  'Komora 3',
  'Komora 4',
  'Komora 5',
  'Komora 6',
];

const WASTE_REASON_LABELS: Record<string, string> = {
  TRULEZ: 'Trulež i bakterijsko propadanje',
  MEHANICKO_OSTECENJE: 'Mehaničko oštećenje (vađenje/transport)',
  KALO_SUSENJE: 'Prirodni kalo i kaliranje u skladištu',
  PROKLIJAO: 'Proklijali luk',
  PRLJAVSTINA_ZEMLJA: 'Zemlja, kamen i nečistoće',
  OSTALO: 'Ostali razlozi otpisa',
  SORTIRANJE_SKART: 'Škart izdvojen na liniji sortiranja',
};

const LOT_STATUS_LABELS: Record<string, string> = {
  NA_STANJU: 'Na stanju',
  U_OBRADI: 'U obradi / pakovanju',
  ISPORUCEN: 'Isporučen',
  ARHIVIRAN: 'Arhiviran',
};

function formatKgAndTons(kgValue: number | undefined | null): string {
  const kg = Number(kgValue || 0);
  if (Math.abs(kg) >= 1000) {
    const tons = (kg / 1000).toLocaleString('sr-RS', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${kg.toLocaleString('sr-RS', { maximumFractionDigits: 0 })} kg (${tons} t)`;
  }
  return `${kg.toLocaleString('sr-RS', { maximumFractionDigits: 1 })} kg`;
}

function formatDateTime(d: string | undefined | null): string {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDateOnly(d: string | undefined | null): string {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '-';
  return dt.toLocaleDateString('sr-RS', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatTimeOnly(timeTarget: string | undefined | null, fallbackDate?: string | null): string {
  const target = timeTarget || fallbackDate;
  if (!target) return '--:--';
  const dt = new Date(target);
  if (isNaN(dt.getTime())) return '--:--';
  return dt.toLocaleTimeString('sr-RS', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const OnionDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const isManager = !currentUser || ['DIREKTOR', 'RUKOVODILAC', 'ADMIN'].includes(currentUser?.role || '');

  // Brzo dodavanje / izmena parcele
  const [parcelQuickModalOpen, setParcelQuickModalOpen] = useState(false);
  const [parcelToEdit, setParcelToEdit] = useState<ParcelItem | null>(null);
  const [parcelQuickTarget, setParcelQuickTarget] = useState<'harvest-form' | 'harvest-filter'>('harvest-form');

  // Brzo dodavanje / izmena kupca (partnera)
  const [buyerQuickModalOpen, setBuyerQuickModalOpen] = useState(false);
  const [buyerToEdit, setBuyerToEdit] = useState<BuyerItem | null>(null);
  const [buyerQuickTarget, setBuyerQuickTarget] = useState<'shipment-form' | 'shipment-filter'>('shipment-form');

  const [activeTab, setActiveTab] = useState<TabKey>('dovoz');
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Filteri po tabovima
  const [harvestSearch, setHarvestSearch] = useState('');
  const [harvestParcelFilter, setHarvestParcelFilter] = useState('ALL');
  const [storageTypeFilter, setStorageTypeFilter] = useState('ALL');
  const [packagingTypeFilter, setPackagingTypeFilter] = useState('ALL');
  const [packagingParcelFilter, setPackagingParcelFilter] = useState('ALL');
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [shipmentBuyerFilter, setShipmentBuyerFilter] = useState('ALL');
  const [traceLotInput, setTraceLotInput] = useState('');
  const [selectedTraceLot, setSelectedTraceLot] = useState('');
  const [selectedTuraId, setSelectedTuraId] = useState<string>('ALL');

  // Paginacija za sve tabele evidencije (25 po stranici)
  const PAGE_SIZE = 25;
  const [harvestPage, setHarvestPage] = useState(1);
  const [lotsPage, setLotsPage] = useState(1);
  const [storagePage, setStoragePage] = useState(1);
  const [sortingPage, setSortingPage] = useState(1);
  const [packagingPage, setPackagingPage] = useState(1);
  const [shipmentPage, setShipmentPage] = useState(1);
  const [wastePage, setWastePage] = useState(1);

  // Filteri i paginacija za tabelu raspoloživog luka za pakovanje
  const [readyLotSearch, setReadyLotSearch] = useState('');
  const [readyParcelFilter, setReadyParcelFilter] = useState('ALL');
  const [readySortOrder, setReadySortOrder] = useState<'DESC' | 'ASC'>('DESC');
  const [readyPage, setReadyPage] = useState(1);
  const READY_PAGE_SIZE = 10;

  // Modali
  const [isHarvestModalOpen, setIsHarvestModalOpen] = useState(false);
  const [isStorageModalOpen, setIsStorageModalOpen] = useState(false);
  const [isSortingModalOpen, setIsSortingModalOpen] = useState(false);
  const [isPackagingModalOpen, setIsPackagingModalOpen] = useState(false);
  const [isShipmentModalOpen, setIsShipmentModalOpen] = useState(false);
  const [isWasteModalOpen, setIsWasteModalOpen] = useState(false);

  // Edit modali (Pakerica / Pakovanje i Komora / Boksovi)
  const [editingPackaging, setEditingPackaging] = useState<any | null>(null);
  const [editingStorage, setEditingStorage] = useState<any | null>(null);

  // Modal za kreiranje / izmenu komore i podešavanje max kapaciteta boksova
  const [isChamberModalOpen, setIsChamberModalOpen] = useState(false);
  const [chamberModalForm, setChamberModalForm] = useState({
    id: '',
    name: '',
    storageType: 'HLADNJACA' as 'HLADNJACA' | 'MAGACIN',
    hasEquipment: true,
    maxBoxes: '720',
  });

  // Modal za potvrdu brisanja komore
  const [chamberToDelete, setChamberToDelete] = useState<any | null>(null);
  const [deleteChamberError, setDeleteChamberError] = useState<string | null>(null);
  const [isDeletingChamber, setIsDeletingChamber] = useState(false);

  // Modal za potvrdu brisanja pakovanja
  const [packagingToDelete, setPackagingToDelete] = useState<any | null>(null);
  const [deletePackagingError, setDeletePackagingError] = useState<string | null>(null);
  const [isDeletingPackaging, setIsDeletingPackaging] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);

  const [harvestForm, setHarvestForm] = useState({
    date: todayStr,
    parcelId: '',
    existingLotId: '',
    cropVariety: 'Žuti holandski',
    boxCount: '',
    quantityKg: '',
    vehicleId: '',
    driverId: '',
    trailerInfo: '',
    autoStore: true,
    storageType: 'HLADNJACA' as 'HLADNJACA' | 'MAGACIN',
    locationOrChamber: 'Komora 1',
    hasEquipment: true,
    notes: '',
  });

  const [storageForm, setStorageForm] = useState({
    date: todayStr,
    lotId: '',
    storageType: 'HLADNJACA' as 'HLADNJACA' | 'MAGACIN',
    locationOrChamber: 'Komora 1',
    hasEquipment: true,
    boxCount: '',
    quantityKg: '',
    notes: '',
  });

  const [sortingForm, setSortingForm] = useState({
    date: todayStr,
    lotId: '',
    storageEntryId: '',
    inputQuantityKg: '',
    qualityQuantityKg: '',
    smallQuantityKg: '0',
    wasteQuantityKg: '0',
    notes: '',
  });

  const [packagingForm, setPackagingForm] = useState({
    date: todayStr,
    lotId: '',
    packageType: 'DZAK_10KG',
    unitWeightKg: '10',
    palletsCount: '',
    packageCount: '',
    palletNumber: '',
    packerCount: '4',
    packerNotes: '',
    responsiblePerson: 'Bojan Ćorović',
    notes: '',
  });

  const [shipmentForm, setShipmentForm] = useState({
    date: todayStr,
    buyerId: '',
    packagingId: '',
    packageCount: '',
    pricePerKg: '',
    vehicleReg: '',
    driverName: '',
    notes: '',
  });

  const [wasteForm, setWasteForm] = useState({
    date: todayStr,
    lotId: '',
    storageEntryId: '',
    quantityKg: '',
    reason: 'TRULEZ',
    location: '',
    description: '',
    notes: '',
  });

  const [submitting, setSubmitting] = useState(false);

  // ==========================================
  // DATA QUERIES
  // ==========================================
  const { data: lookupData } = useQuery({
    queryKey: ['onion-lookup'],
    queryFn: async () => {
      const res = await fetch(`${API}/lookup`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju šifarnika.');
      return res.json();
    },
  });

  const { data: dashboardData, isFetching: loadingDashboard } = useQuery({
    queryKey: ['onion-dashboard'],
    queryFn: async () => {
      const res = await fetch(`${API}/dashboard`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju KPI stanja.');
      return res.json();
    },
  });

  const { data: lotsData } = useQuery({
    queryKey: ['onion-lots', lotsPage],
    queryFn: async () => {
      const res = await fetch(`${API}/lots?page=${lotsPage}&limit=${PAGE_SIZE}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju LOT-ova.');
      return res.json();
    },
  });

  const { data: harvestData } = useQuery({
    queryKey: ['onion-harvest', harvestParcelFilter, harvestSearch, harvestPage],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (harvestParcelFilter !== 'ALL') params.set('parcelId', harvestParcelFilter);
      if (harvestSearch.trim()) params.set('search', harvestSearch.trim());
      params.set('page', String(harvestPage));
      params.set('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/harvest?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju dovoza.');
      return res.json();
    },
  });

  const { data: storageData } = useQuery({
    queryKey: ['onion-storage', storageTypeFilter, storagePage],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (storageTypeFilter !== 'ALL') params.set('storageType', storageTypeFilter);
      params.set('page', String(storagePage));
      params.set('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/storage?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju skladišta.');
      return res.json();
    },
  });

  const { data: sortingData } = useQuery({
    queryKey: ['onion-sorting', sortingPage],
    queryFn: async () => {
      const res = await fetch(`${API}/sorting?page=${sortingPage}&limit=${PAGE_SIZE}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju sortiranja.');
      return res.json();
    },
  });

  const { data: packagingData } = useQuery({
    queryKey: ['onion-packaging', packagingTypeFilter, packagingParcelFilter, packagingPage],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (packagingTypeFilter !== 'ALL') params.set('packageType', packagingTypeFilter);
      if (packagingParcelFilter !== 'ALL') params.set('parcelId', packagingParcelFilter);
      params.set('page', String(packagingPage));
      params.set('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/packaging?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju pakovanja.');
      return res.json();
    },
  });

  const { data: shipmentData } = useQuery({
    queryKey: ['onion-shipment', shipmentBuyerFilter, shipmentSearch, shipmentPage],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (shipmentBuyerFilter !== 'ALL') params.set('buyerId', shipmentBuyerFilter);
      if (shipmentSearch.trim()) params.set('search', shipmentSearch.trim());
      params.set('page', String(shipmentPage));
      params.set('limit', String(PAGE_SIZE));
      const res = await fetch(`${API}/shipment?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju isporuka.');
      return res.json();
    },
  });

  const { data: wasteData } = useQuery({
    queryKey: ['onion-waste', wastePage],
    queryFn: async () => {
      const res = await fetch(`${API}/waste?page=${wastePage}&limit=${PAGE_SIZE}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju otpisa.');
      return res.json();
    },
  });

  const lots = lotsData?.lots || [];
  const allSelectableLots = lookupData?.allLots || lookupData?.activeLots || lookupData?.lots || lots;
  const activeLotNumberForTrace = selectedTraceLot || (allSelectableLots[0]?.lotNumber ?? lots[0]?.lotNumber ?? '');

  useEffect(() => {
    setSelectedTuraId('ALL');
  }, [activeLotNumberForTrace]);

  const { data: traceData, isFetching: loadingTrace } = useQuery({
    queryKey: ['onion-traceability', activeLotNumberForTrace],
    enabled: Boolean(activeLotNumberForTrace),
    queryFn: async () => {
      const res = await fetch(
        `${API}/traceability/${encodeURIComponent(activeLotNumberForTrace)}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'LOT nije pronađen.');
      }
      return res.json();
    },
  });

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['onion-lookup'] });
    queryClient.invalidateQueries({ queryKey: ['onion-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['onion-lots'] });
    queryClient.invalidateQueries({ queryKey: ['onion-harvest'] });
    queryClient.invalidateQueries({ queryKey: ['onion-storage'] });
    queryClient.invalidateQueries({ queryKey: ['onion-sorting'] });
    queryClient.invalidateQueries({ queryKey: ['onion-packaging'] });
    queryClient.invalidateQueries({ queryKey: ['onion-shipment'] });
    queryClient.invalidateQueries({ queryKey: ['onion-waste'] });
    queryClient.invalidateQueries({ queryKey: ['onion-traceability'] });
  };

  const kpi = dashboardData?.kpi || {
    totalHarvestedKg: 0,
    totalRawStockKg: 0,
    inColdStorageKg: 0,
    totalColdStorageBoxes: 0,
    maxColdStorageBoxes: 4320,
    maxColdStorageKg: 4800000,
    equippedChambersCount: 3,
    unequippedChambersCount: 3,
    totalChambersCount: 6,
    inWarehouseKg: 0,
    totalSortedQualityKg: 0,
    unpackedQualityKg: 0,
    packagedStockKg: 0,
    packagedPackagesCount: 0,
    packagedPalletsCount: 0,
    smallOnionStockKg: 0,
    shippedKg: 0,
    shippedPackagesCount: 0,
    shippedTotalValue: 0,
    totalWasteKg: 0,
    wastePercentage: 0,
    activeLotsCount: 0,
    responsiblePerson: 'Bojan Ćorović',
  };

  const parcels = lookupData?.parcels || [];
  const machines = lookupData?.machines || [];
  const workers = lookupData?.workers || [];
  const buyers = lookupData?.buyers || [];

  // ==========================================
  // CUSTOM SELECT OPCIJE (MEMOIZOVANE)
  // ==========================================
  const storageTypeFilterOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'ALL', label: 'Sve komore i skladišta' },
      { value: 'HLADNJACA', label: 'Samo Hladnjača (Komore 1–6)' },
      { value: 'MAGACIN', label: 'Samo Podni Magacin' },
    ],
    []
  );

  const packagingTypeFilterOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'ALL', label: 'Sva pakovanja (10kg, 5kg, 25kg...)' },
      ...Object.entries(PACKAGE_LABELS).map(([k, label]) => ({
        value: k,
        label,
      })),
    ],
    []
  );

  const harvestParcelFilterOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'ALL', label: 'Sve parcele' },
      ...parcels.map((p: any) => ({
        value: p.id,
        label: `${p.code} — ${p.name}`,
        subLabel: p.areaHa ? `${p.areaHa} ha` : undefined,
      })),
    ],
    [parcels]
  );

  const shipmentBuyerFilterOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'ALL', label: 'Svi kupci' },
      ...buyers.map((b: any) => ({
        value: b.id,
        label: b.name,
        subLabel: b.pib ? `PIB: ${b.pib}` : undefined,
      })),
    ],
    [buyers]
  );

  const traceLotSelectOptions: CustomSelectOption[] = useMemo(() => {
    // Prikazujemo samo do 10 najnovijih partija za brzi izbor da meni ne bi bio pretrpan
    const top10 = allSelectableLots.slice(0, 10);
    const currentLotObj = allSelectableLots.find((l: any) => l.lotNumber === activeLotNumberForTrace);
    const combined = [...top10];
    if (currentLotObj && !top10.some((l: any) => l.lotNumber === activeLotNumberForTrace)) {
      combined.unshift(currentLotObj);
    }

    return [
      { value: '', label: '— 10 najnovijih partija —' },
      ...combined.map((l: any) => ({
        value: l.lotNumber,
        label: l.lotNumber,
        subLabel: `${l.parcel?.name || 'Nepoznata parcela'} • ${formatKgAndTons(l.initialQuantityKg)}`,
        badge: LOT_STATUS_LABELS[l.status] || l.status,
        badgeType: (l.status === 'ISPORUCEN'
          ? 'default'
          : l.status === 'U_OBRADI'
            ? 'warning'
            : 'success') as 'default' | 'success' | 'warning',
      })),
    ];
  }, [allSelectableLots, activeLotNumberForTrace]);

  const harvestParcelOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: '— Izaberi parcelu sa spiska —' },
      ...parcels.map((p: any) => ({
        value: p.id,
        label: `${p.code} — ${p.name}`,
        subLabel: p.areaHa ? `${p.areaHa} ha` : undefined,
      })),
    ],
    [parcels]
  );

  const selectedHarvestParcelObj = useMemo(() => {
    return parcels.find((p: any) => p.id === harvestForm.parcelId) || null;
  }, [parcels, harvestForm.parcelId]);

  const selectedShipmentBuyerObj = useMemo(() => {
    return buyers.find((b: any) => b.id === shipmentForm.buyerId) || null;
  }, [buyers, shipmentForm.buyerId]);

  const selectedPackagingLotObj = useMemo(() => {
    return allSelectableLots.find((l: any) => l.id === packagingForm.lotId) || null;
  }, [allSelectableLots, packagingForm.lotId]);

  const readySortOrderOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'DESC', label: 'Količina: Najviše slobodno' },
      { value: 'ASC', label: 'Količina: Najmanje slobodno' },
    ],
    []
  );

  const filteredUnpackedLots = useMemo(() => {
    let list = lookupData?.activeLots || lots || [];
    list = list.filter((l: any) => (l.sortedQualityKg || 0) > 0);

    // Filter po parceli
    if (readyParcelFilter && readyParcelFilter !== 'ALL') {
      list = list.filter(
        (l: any) => l.parcelId === readyParcelFilter || l.parcel?.id === readyParcelFilter
      );
    }

    // Filter po LOT broju / pretraga
    if (readyLotSearch.trim()) {
      const q = readyLotSearch.trim().toLowerCase();
      list = list.filter(
        (l: any) =>
          l.lotNumber?.toLowerCase().includes(q) ||
          l.parcel?.name?.toLowerCase().includes(q) ||
          l.parcel?.code?.toLowerCase().includes(q) ||
          l.cropVariety?.toLowerCase().includes(q)
      );
    }

    // Sortiranje po količini slobodnoj za pakovanje (Najviše prvo / Najmanje prvo)
    return list.sort((a: any, b: any) => {
      const availA = Math.max(0, a.unpackedQualityKg || 0);
      const availB = Math.max(0, b.unpackedQualityKg || 0);
      return readySortOrder === 'ASC' ? availA - availB : availB - availA;
    });
  }, [lookupData?.activeLots, lots, readyParcelFilter, readyLotSearch, readySortOrder]);

  const totalReadyPages = Math.ceil(filteredUnpackedLots.length / READY_PAGE_SIZE) || 1;

  const paginatedReadyLots = useMemo(() => {
    const start = (readyPage - 1) * READY_PAGE_SIZE;
    return filteredUnpackedLots.slice(start, start + READY_PAGE_SIZE);
  }, [filteredUnpackedLots, readyPage]);

  const vehicleOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: 'Bez dodele vozila' },
      ...machines.map((m: any) => ({
        value: m.id,
        label: m.name,
        subLabel: m.regNumber || undefined,
      })),
    ],
    [machines]
  );

  const workerOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: 'Bez dodele vozača' },
      ...workers.map((w: any) => ({
        value: w.id,
        label: w.name,
        subLabel: w.role || undefined,
      })),
    ],
    [workers]
  );

  const availableChambers = useMemo(() => {
    if (dashboardData?.chambersSummary && dashboardData.chambersSummary.length > 0) {
      return dashboardData.chambersSummary.map((ch: any) => ({
        id: ch.id || ch.locationOrChamber,
        name: ch.locationOrChamber,
        storageType: ch.storageType || 'HLADNJACA',
        hasEquipment: ch.hasEquipment,
        maxBoxes: ch.maxBoxes || 720,
      }));
    }
    if (lookupData?.chambers && lookupData.chambers.length > 0) {
      return lookupData.chambers;
    }
    return STANDARD_CHAMBER_NAMES.map((name) => ({
      id: name,
      name,
      storageType: 'HLADNJACA',
      hasEquipment: name === 'Komora 1' || name === 'Komora 2' || name === 'Komora 3',
      maxBoxes: 720,
    }));
  }, [dashboardData?.chambersSummary, lookupData?.chambers]);

  const chamberOptions: CustomSelectOption[] = useMemo(
    () =>
      availableChambers.map((c: any) => {
        const isWithEq = c.hasEquipment;
        const maxB = c.maxBoxes || 720;
        return {
          value: c.name,
          label: c.name,
          subLabel: `${isWithEq ? 'Sa opremom' : 'Bez opreme'} — max ${maxB} boks. (${Math.round((maxB * 1100) / 1000)}t)`,
          badge: isWithEq ? 'Sa opremom' : 'Bez opreme',
          badgeType: (isWithEq ? 'default' : 'warning') as 'default' | 'warning',
        };
      }),
    [availableChambers]
  );

  const storageLotOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: '— Izaberi LOT partiju —' },
      ...allSelectableLots.map((l: any) => ({
        value: l.id,
        label: l.lotNumber,
        subLabel: `${l.parcel?.name || '-'} • Neraspoređeno: ${formatKgAndTons(l.unstoredRawKg)} (Ukupno sirovo: ${formatKgAndTons(l.rawStockKg)})`,
        badge: `${Math.round((l.rawStockKg || 0) / 1100)} boks.`,
      })),
    ],
    [allSelectableLots]
  );

  const editChamberOptions: CustomSelectOption[] = useMemo(
    () =>
      availableChambers.map((c: any) => ({
        value: c.name,
        label: `${c.name} (max ${c.maxBoxes || 720} boks.)`,
      })),
    [availableChambers]
  );

  const editStorageEquipmentOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'true', label: 'Komora sa opremom (Komore 1–3)' },
      { value: 'false', label: 'Komora bez opreme (Komore 4–6)' },
    ],
    []
  );

  const sortingLotOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: '— Izaberi LOT sa sirovim lukom —' },
      ...allSelectableLots
        .filter((l: any) => l.rawStockKg > 0)
        .map((l: any) => ({
          value: l.id,
          label: l.lotNumber,
          subLabel: `${l.parcel?.name || '-'} • Raspoloživo sirovo: ${formatKgAndTons(l.rawStockKg)}`,
          badge: `${Math.round((l.rawStockKg || 0) / 1100)} boks.`,
        })),
    ],
    [allSelectableLots]
  );

  const packagingLotOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: '— Izaberi LOT sa I klasom —' },
      ...allSelectableLots
        .filter((l: any) => l.unpackedQualityKg > 0)
        .map((l: any) => ({
          value: l.id,
          label: l.lotNumber,
          subLabel: `${l.parcel?.name || '-'} • Spremno za pakericu: ${formatKgAndTons(l.unpackedQualityKg)}`,
          badge: `${Math.round((l.unpackedQualityKg || 0) / 1000)} t`,
          badgeType: 'success' as 'success',
        })),
    ],
    [allSelectableLots]
  );

  const packageTypeOptions: CustomSelectOption[] = useMemo(
    () => [
      {
        value: 'DZAK_10KG',
        label: 'Mrežasti džak 10 kg',
        subLabel: '100 džakova na paleti = 1.000 kg',
        badge: '100 kom/pal',
        badgeType: 'success' as 'success',
      },
      {
        value: 'DZAK_5KG',
        label: 'Mrežasti džak 5 kg',
        subLabel: '200 džakova na paleti = 1.000 kg',
        badge: '200 kom/pal',
        badgeType: 'warning' as 'warning',
      },
      {
        value: 'DZAK_25KG',
        label: 'Mrežasti džak 25 kg',
        subLabel: '40 džakova na paleti = 1.000 kg',
        badge: '40 kom/pal',
      },
      {
        value: 'DZAMBO_VRECA',
        label: 'Džambo vreća',
        subLabel: '1.000 kg po vreći',
      },
      {
        value: 'BOKS_PALETA',
        label: 'Boks paleta 160x120x120',
        subLabel: '1.100 kg po boksu',
      },
      {
        value: 'RINFUZ',
        label: 'Rinfuz',
        subLabel: 'Masa u rasutom stanju',
      },
    ],
    []
  );

  const shipmentBuyerOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: '— Izaberi kupca —' },
      ...buyers.map((b: any) => ({
        value: b.id,
        label: b.name,
        subLabel: b.pib ? `PIB: ${b.pib}` : undefined,
      })),
    ],
    [buyers]
  );

  const allAvailablePackagingsList = useMemo(() => {
    const map = new Map<string, any>();
    (lookupData?.availablePackagings || []).forEach((p: any) => {
      if (p.id) map.set(p.id, p);
    });
    (packagingData?.packagings || []).forEach((p: any) => {
      if (p.id && (p.availableCount > 0 || p.availableWeightKg > 0)) {
        if (!map.has(p.id)) {
          map.set(p.id, p);
        } else {
          map.set(p.id, { ...map.get(p.id), ...p });
        }
      }
    });
    return Array.from(map.values()).filter(
      (p: any) => p.availableCount > 0 || p.availableWeightKg > 0
    );
  }, [lookupData?.availablePackagings, packagingData?.packagings]);

  const selectedShipmentPackagingObj = useMemo(() => {
    return (
      allAvailablePackagingsList.find((p: any) => p.id === shipmentForm.packagingId) ||
      packagingData?.packagings?.find((p: any) => p.id === shipmentForm.packagingId) ||
      null
    );
  }, [allAvailablePackagingsList, packagingData?.packagings, shipmentForm.packagingId]);

  const shipmentPackagingOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: '— Izaberi spakovani LOT (10kg ili 5kg) —' },
      ...allAvailablePackagingsList.map((p: any) => {
        const lotInfo = p.lot?.lotNumber || 'LOT';
        const parcelInfo = p.lot?.parcel ? ` (${p.lot.parcel.code || p.lot.parcel.name})` : '';
        const packLabel = PACKAGE_LABELS[p.packageType] || p.packageType;
        return {
          value: p.id,
          label: `${lotInfo}${parcelInfo} | ${packLabel}`,
          subLabel: `Raspoloživo: ${p.availableCount?.toLocaleString('sr-RS')} džakova (${formatKgAndTons(p.availableWeightKg)})`,
          badge: `${p.availableCount} kom`,
          badgeType: 'success' as 'success',
        };
      }),
    ],
    [allAvailablePackagingsList]
  );

  const wasteLotOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: '', label: '— Izaberi LOT za otpis —' },
      ...allSelectableLots.map((l: any) => ({
        value: l.id,
        label: l.lotNumber,
        subLabel: `${l.parcel?.name || '-'} • Sirovo: ${formatKgAndTons(l.rawStockKg)}`,
      })),
    ],
    [allSelectableLots]
  );

  const wasteReasonOptions: CustomSelectOption[] = useMemo(
    () =>
      Object.entries(WASTE_REASON_LABELS).map(([key, label]) => ({
        value: key,
        label,
      })),
    []
  );

  const handleOpenTraceability = (lotNumber: string) => {
    setSelectedTraceLot(lotNumber);
    setTraceLotInput(lotNumber);
    setSelectedTuraId('ALL');
    setActiveTab('sledljivost');
  };

  // ==========================================
  // FORM SUBMIT HANDLERS
  // ==========================================
  const handleCreateHarvest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!harvestForm.parcelId) {
      showToast('Molimo izaberite parcelu.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/harvest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...harvestForm,
          quantityKg: Number(harvestForm.quantityKg),
          boxCount: harvestForm.boxCount ? Number(harvestForm.boxCount) : undefined,
          existingLotId: harvestForm.existingLotId || null,
          vehicleId: harvestForm.vehicleId || null,
          driverId: harvestForm.driverId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri čuvanju dovoza.');
      showToast(data.message || 'Dovoz sa njive uspešno sačuvan.');
      setIsHarvestModalOpen(false);
      setHarvestForm((prev) => ({
        ...prev,
        boxCount: '',
        quantityKg: '',
        trailerInfo: '',
        notes: '',
      }));
      refreshAll();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateStorage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storageForm.lotId) {
      showToast('Molimo izaberite LOT partiju.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/storage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...storageForm,
          quantityKg: Number(storageForm.quantityKg),
          boxCount: storageForm.boxCount ? Number(storageForm.boxCount) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri uskladištenju.');
      showToast(data.message || 'Luk uspešno raspoređen u skladište.');
      setIsStorageModalOpen(false);
      setStorageForm((prev) => ({ ...prev, boxCount: '', quantityKg: '', notes: '' }));
      refreshAll();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStorage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStorage) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/storage/${editingStorage.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          locationOrChamber: editingStorage.locationOrChamber,
          hasEquipment: editingStorage.hasEquipment,
          boxCount: editingStorage.boxCount ? Number(editingStorage.boxCount) : null,
          currentQuantityKg: Number(editingStorage.currentQuantityKg),
          notes: editingStorage.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri izmeni komore.');
      showToast(data.message || 'Podaci komore su ažurirani.');
      setEditingStorage(null);
      refreshAll();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveChamber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chamberModalForm.name.trim()) {
      showToast('Naziv komore je obavezan.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const isEdit = Boolean(chamberModalForm.id);
      const url = isEdit
        ? `${API}/chambers/${encodeURIComponent(chamberModalForm.id)}`
        : `${API}/chambers`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: chamberModalForm.name.trim(),
          storageType: chamberModalForm.storageType,
          hasEquipment: chamberModalForm.hasEquipment,
          maxBoxes: Number(chamberModalForm.maxBoxes || 720),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri čuvanju komore.');
      showToast(data.message || 'Komora uspešno sačuvana.');
      setIsChamberModalOpen(false);
      setChamberModalForm({
        id: '',
        name: '',
        storageType: 'HLADNJACA',
        hasEquipment: true,
        maxBoxes: '720',
      });
      refreshAll();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDeleteChamberModal = (ch: any) => {
    setChamberToDelete(ch);
    setDeleteChamberError(null);
  };

  const handleConfirmDeleteChamber = async () => {
    if (!chamberToDelete) return;
    setIsDeletingChamber(true);
    setDeleteChamberError(null);
    try {
      const chamberKey = chamberToDelete.id || chamberToDelete.locationOrChamber || chamberToDelete.name;
      const res = await fetch(`${API}/chambers/${encodeURIComponent(chamberKey)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg =
          data.error ||
          `Nije moguće obrisati komoru "${chamberToDelete.locationOrChamber || chamberToDelete.name}" jer se u njoj trenutno nalazi ${Number(chamberToDelete.currentQuantityKg || 0).toLocaleString('sr-RS')} kg luka. Prvo ispraznite ili sortirajte luk.`;
        setDeleteChamberError(errorMsg);
        showToast(errorMsg, 'error');
        return;
      }
      showToast(data.message || 'Komora je uspešno obrisana.');
      setChamberToDelete(null);
      setDeleteChamberError(null);
      refreshAll();
    } catch (err: any) {
      const errorMsg = err.message || 'Greška pri brisanju komore.';
      setDeleteChamberError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setIsDeletingChamber(false);
    }
  };

  const handleCreateSorting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sortingForm.lotId) {
      showToast('Molimo izaberite LOT koji se sortira.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/sorting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...sortingForm,
          storageEntryId: sortingForm.storageEntryId || null,
          inputQuantityKg: Number(sortingForm.inputQuantityKg),
          qualityQuantityKg: Number(sortingForm.qualityQuantityKg),
          smallQuantityKg: Number(sortingForm.smallQuantityKg || 0),
          wasteQuantityKg: Number(sortingForm.wasteQuantityKg || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri čuvanju sortiranja.');
      showToast(data.message || 'Sortiranje uspešno sačuvano.');
      setIsSortingModalOpen(false);
      setSortingForm((prev) => ({
        ...prev,
        inputQuantityKg: '',
        qualityQuantityKg: '',
        smallQuantityKg: '0',
        wasteQuantityKg: '0',
        notes: '',
      }));
      refreshAll();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreatePackaging = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!packagingForm.lotId) {
      showToast('Molimo izaberite LOT sa sortiranim lukom I klase.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/packaging`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...packagingForm,
          unitWeightKg: Number(packagingForm.unitWeightKg),
          packageCount: Number(packagingForm.packageCount),
          palletsCount: packagingForm.palletsCount ? Number(packagingForm.palletsCount) : undefined,
          packerCount: Number(packagingForm.packerCount || 4),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri pakovanju.');
      showToast(data.message || 'Pakovanje uspešno evidentirano.');
      setIsPackagingModalOpen(false);
      setPackagingForm((prev) => ({
        ...prev,
        palletsCount: '',
        packageCount: '',
        palletNumber: '',
        packerNotes: '',
        notes: '',
      }));
      refreshAll();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePackaging = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPackaging) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/packaging/${editingPackaging.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          packageType: editingPackaging.packageType,
          unitWeightKg: Number(editingPackaging.unitWeightKg),
          packageCount: Number(editingPackaging.packageCount),
          palletsCount: editingPackaging.palletsCount
            ? Number(editingPackaging.palletsCount)
            : undefined,
          palletNumber: editingPackaging.palletNumber,
          packerCount: Number(editingPackaging.packerCount || 4),
          packerNotes: editingPackaging.packerNotes,
          responsiblePerson: editingPackaging.responsiblePerson,
          notes: editingPackaging.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri izmeni pakovanja.');
      showToast(data.message || 'Podaci o pakovanju i pakerici su ažurirani.');
      setEditingPackaging(null);
      refreshAll();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenDeletePackagingModal = (pk: any) => {
    setPackagingToDelete(pk);
    setDeletePackagingError(null);
  };

  const handleConfirmDeletePackaging = async () => {
    if (!packagingToDelete) return;
    setIsDeletingPackaging(true);
    setDeletePackagingError(null);
    try {
      const res = await fetch(`${API}/packaging/${encodeURIComponent(packagingToDelete.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        const errorMsg = data.error || 'Nije moguće obrisati ovo pakovanje.';
        setDeletePackagingError(errorMsg);
        showToast(errorMsg, 'error');
        return;
      }
      showToast(data.message || 'Pakovanje je uspešno obrisano.');
      setPackagingToDelete(null);
      setDeletePackagingError(null);
      refreshAll();
    } catch (err: any) {
      const errorMsg = err.message || 'Greška pri brisanju pakovanja.';
      setDeletePackagingError(errorMsg);
      showToast(errorMsg, 'error');
    } finally {
      setIsDeletingPackaging(false);
    }
  };

  const handleQuickShipmentFromPackaging = (pk: any) => {
    setShipmentForm((prev) => ({
      ...prev,
      buyerId: prev.buyerId || buyers[0]?.id || '',
      packagingId: pk.id,
      packageCount: pk.availableCount > 0 ? String(pk.availableCount) : '',
    }));
    setActiveTab('isporuka');
    setIsShipmentModalOpen(true);
  };

  const handleCreateShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shipmentForm.buyerId) {
      showToast('Molimo izaberite kupca.', 'error');
      return;
    }
    if (!shipmentForm.packagingId) {
      showToast('Molimo izaberite spakovanu partiju za isporuku.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...shipmentForm,
          packageCount: Number(shipmentForm.packageCount),
          pricePerKg: shipmentForm.pricePerKg ? Number(shipmentForm.pricePerKg) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri kreiranju isporuke.');
      showToast(data.message || 'Otpremnica i isporuka uspešno kreirane.');
      setIsShipmentModalOpen(false);
      setShipmentForm((prev) => ({
        ...prev,
        packageCount: '',
        pricePerKg: '',
        vehicleReg: '',
        driverName: '',
        notes: '',
      }));
      refreshAll();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wasteForm.lotId) {
      showToast('Molimo izaberite LOT za otpis.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API}/waste`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...wasteForm,
          storageEntryId: wasteForm.storageEntryId || null,
          quantityKg: Number(wasteForm.quantityKg),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri unosu otpisa.');
      showToast(data.message || 'Otpis uspešno evidentiran.');
      setIsWasteModalOpen(false);
      setWasteForm((prev) => ({ ...prev, quantityKg: '', description: '', notes: '' }));
      refreshAll();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // ==========================================
  // PDF OTPREMNICA GENERATOR
  // ==========================================
  const handleDownloadDispatchPdf = async (shipment: any) => {
    try {
      const doc = new jsPDF();
      const hasUnicode = await applyUnicodeFont(doc);
      const fontName = hasUnicode ? 'Roboto' : 'helvetica';

      doc.setFont(fontName, 'bold');
      doc.setFontSize(16);
      doc.text('NANDRA DOO — OTPREMNICA ROBE (MODUL LUK)', 14, 18);

      doc.setFont(fontName, 'normal');
      doc.setFontSize(10);
      doc.text(`Broj otpremnice: ${shipment.dispatchNumber}`, 14, 27);
      doc.text(`Datum izdavanja: ${formatDateTime(shipment.date)}`, 14, 33);
      doc.text(`LOT Sledljivost: ${shipment.lot?.lotNumber || '-'}`, 14, 39);
      doc.text(
        `Poreklo (Parcela): ${shipment.lot?.parcel?.name || '-'} (${shipment.lot?.parcel?.code || '-'})`,
        14,
        45
      );
      doc.text('Zadužen za ulaz/izlaz i pakovanje: Bojan Ćorović', 14, 51);

      doc.setFont(fontName, 'bold');
      doc.text('Podaci o kupcu i prevozu:', 115, 27);
      doc.setFont(fontName, 'normal');
      doc.text(`Kupac: ${shipment.buyer?.name || '-'}`, 115, 33);
      doc.text(`PIB: ${shipment.buyer?.pib || '-'}`, 115, 39);
      doc.text(`Vozilo / Reg: ${shipment.vehicleReg || '-'}`, 115, 45);
      doc.text(`Vozač: ${shipment.driverName || '-'}`, 115, 51);

      const rows = (shipment.items || []).map((item: any, idx: number) => [
        idx + 1,
        shipment.lot?.lotNumber || '-',
        PACKAGE_LABELS[item.packaging?.packageType] || item.packaging?.packageType || 'Pakovanje',
        `${item.packaging?.unitWeightKg || '-'} kg`,
        `${item.packageCount} kom`,
        `${Number(item.totalWeightKg).toLocaleString('sr-RS')} kg`,
        shipment.pricePerKg ? `${shipment.pricePerKg.toLocaleString('sr-RS')} RSD/kg` : '-',
        shipment.totalValue ? `${shipment.totalValue.toLocaleString('sr-RS')} RSD` : '-',
      ]);

      autoTable(doc, {
        startY: 58,
        head: [
          [
            'R.br',
            'LOT Broj',
            'Tip pakovanja',
            'Jed. masa',
            'Količina (kom)',
            'Neto masa (kg)',
            'Cena/kg',
            'Ukupno RSD',
          ],
        ],
        body:
          rows.length > 0
            ? rows
            : [
              [
                1,
                shipment.lot?.lotNumber || '-',
                'Konzumni luk I klasa',
                '-',
                `${shipment.totalPackagesCount} kom`,
                `${Number(shipment.totalWeightKg).toLocaleString('sr-RS')} kg`,
                shipment.pricePerKg ? `${shipment.pricePerKg} RSD` : '-',
                shipment.totalValue ? `${shipment.totalValue.toLocaleString('sr-RS')} RSD` : '-',
              ],
            ],
        styles: { font: fontName, fontSize: 9 },
        headStyles: { fillColor: [22, 163, 74], font: fontName, fontStyle: 'bold' },
      });

      const finalY = (doc as any).lastAutoTable?.finalY || 110;
      doc.setFont(fontName, 'normal');
      doc.setFontSize(10);
      if (shipment.notes) {
        doc.text(`Napomena: ${shipment.notes}`, 14, finalY + 12);
      }

      doc.text('Robu izdao (Zaduženo lice — Magacin):', 14, finalY + 32);
      doc.text('___________________________', 14, finalY + 42);
      doc.text(shipment.supervisor?.name || 'Bojan Ćorović', 14, finalY + 48);

      doc.text('Robu preuzeo (Vozač / Kupac):', 120, finalY + 32);
      doc.text('___________________________', 120, finalY + 42);
      doc.text(shipment.driverName || shipment.buyer?.name || '', 120, finalY + 48);

      doc.save(`Otpremnica_${shipment.dispatchNumber.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
    } catch (error) {
      console.error('Greška pri generisanju PDF otpremnice:', error);
      showToast('Greška pri generisanju PDF otpremnice.', 'error');
    }
  };

  return (
    <AppLayout pageTitle="Modul Luk & Hladnjača — Tok Robe i Sledljivost">
      <div className={styles.container}>
        {/* Gornji Header sa brzim akcijama i tehničkom specifikacijom hladnjače */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <Sprout size={26} color="#16a34a" />
              <span>Modul Luk & Hladnjača</span>
            </h2>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => {
                if (!harvestForm.parcelId && parcels[0]?.id) {
                  setHarvestForm((prev) => ({ ...prev, parcelId: parcels[0].id }));
                }
                setIsHarvestModalOpen(true);
              }}
            >
              <Plus size={16} />
              <span>Uvoz sa njive</span>
            </button>

            <button
              type="button"
              className={styles.btnBlue}
              onClick={() => {
                if (!sortingForm.lotId && lots[0]?.id) {
                  setSortingForm((prev) => ({ ...prev, lotId: lots[0].id }));
                }
                setIsSortingModalOpen(true);
              }}
            >
              <Scale size={16} />
              <span>Sortiranje</span>
            </button>

            <button
              type="button"
              className={styles.btnAmber}
              onClick={() => {
                if (!packagingForm.lotId && lots[0]?.id) {
                  setPackagingForm((prev) => ({ ...prev, lotId: lots[0].id }));
                }
                setIsPackagingModalOpen(true);
              }}
            >
              <Package size={16} />
              <span>Pakerica (10kg / 5kg)</span>
            </button>

            <button
              type="button"
              className={styles.btnSecondary}
              onClick={refreshAll}
              title="Osveži podatke"
            >
              <RotateCw size={16} className={loadingDashboard ? 'spin' : ''} />
              <span>Osveži</span>
            </button>
          </div>
        </div>

        {/* 360° KPI KARTICE STANJA (7 ključnih tačaka) */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard} onClick={() => setActiveTab('dovoz')}>
            <div className={`${styles.kpiIcon} ${styles.iconGreen}`}>
              <Tractor size={22} />
            </div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>1. Ukupan ulaz sa njive</span>
              <span className={styles.kpiValue}>{formatKgAndTons(kpi.totalHarvestedKg)}</span>
              <span className={styles.kpiSub}>Ukupno {kpi.activeLotsCount} aktivnih LOT partija</span>
            </div>
          </div>

          <div className={styles.kpiCard} onClick={() => setActiveTab('skladiste')}>
            <div className={`${styles.kpiIcon} ${styles.iconCyan}`}>
              <Snowflake size={22} />
            </div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>
                2. U hladnjači ({kpi.totalChambersCount || (dashboardData?.chambersSummary || []).length || 6} komora)
              </span>
              <span className={styles.kpiValue}>{formatKgAndTons(kpi.inColdStorageKg)}</span>
              <span className={styles.kpiSub}>
                <strong>{(kpi.totalColdStorageBoxes || 0).toLocaleString('sr-RS')}</strong> / {(kpi.maxColdStorageBoxes || 4320).toLocaleString('sr-RS')}{' '}
                boks paleta (160x120x120)
              </span>
            </div>
          </div>

          <div className={styles.kpiCard} onClick={() => setActiveTab('skladiste')}>
            <div className={`${styles.kpiIcon} ${styles.iconIndigo}`}>
              <Warehouse size={22} />
            </div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>3. Komore (Sa / Bez opreme)</span>
              <span className={styles.kpiValue}>
                {kpi.equippedChambersCount !== undefined
                  ? `${kpi.equippedChambersCount} + ${kpi.unequippedChambersCount} komora`
                  : '3 + 3 komore'}
              </span>
              <span className={styles.kpiSub}>
                Ukupno {(kpi.maxColdStorageBoxes || 4320).toLocaleString('sr-RS')} boksova ({formatKgAndTons(kpi.maxColdStorageKg || 4800000)})
              </span>
            </div>
          </div>

          <div className={styles.kpiCard} onClick={() => setActiveTab('pakovanje')}>
            <div className={`${styles.kpiIcon} ${styles.iconAmber}`}>
              <Package size={22} />
            </div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>4. Spakovano (10kg i 5kg)</span>
              <span className={styles.kpiValue}>{formatKgAndTons(kpi.packagedStockKg)}</span>
              <span className={styles.kpiSub}>
                {kpi.packagedPackagesCount.toLocaleString('sr-RS')} džakova ({kpi.packagedPalletsCount}{' '}
                paleta)
              </span>
            </div>
          </div>

          <div className={styles.kpiCard} onClick={() => setActiveTab('sortiranje')}>
            <div className={`${styles.kpiIcon} ${styles.iconPurple}`}>
              <Layers size={22} />
            </div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>5. Sitan luk (II klasa)</span>
              <span className={styles.kpiValue}>{formatKgAndTons(kpi.smallOnionStockKg)}</span>
              <span className={styles.kpiSub}>
                Za pakericu spremno: {formatKgAndTons(kpi.unpackedQualityKg)}
              </span>
            </div>
          </div>

          <div className={styles.kpiCard} onClick={() => setActiveTab('isporuka')}>
            <div className={`${styles.kpiIcon} ${styles.iconBlue}`}>
              <Truck size={22} />
            </div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>6. Isporučeno kupcima</span>
              <span className={styles.kpiValue}>{formatKgAndTons(kpi.shippedKg)}</span>
              <span className={styles.kpiSub}>
                {kpi.shippedPackagesCount.toLocaleString('sr-RS')} džakova |{' '}
                {kpi.shippedTotalValue > 0
                  ? `${kpi.shippedTotalValue.toLocaleString('sr-RS')} RSD`
                  : 'Realizovano'}
              </span>
            </div>
          </div>

          <div className={styles.kpiCard} onClick={() => setActiveTab('otpis')}>
            <div className={`${styles.kpiIcon} ${styles.iconRed}`}>
              <AlertTriangle size={22} />
            </div>
            <div className={styles.kpiContent}>
              <span className={styles.kpiLabel}>7. Ukupan otpis</span>
              <span className={styles.kpiValue}>{formatKgAndTons(kpi.totalWasteKg)}</span>
              <span className={styles.kpiSub}>
                Udeo gubitaka: <strong>{kpi.wastePercentage}%</strong> od ulaza
              </span>
            </div>
          </div>
        </div>

        {/* Glavna navigacija tabova (7 tabova poređanih po toku sledljivosti) */}
        <div className={styles.tabsBar}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'dovoz' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('dovoz')}
          >
            <Tractor size={17} />
            <span>Uvoz sa njive</span>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'skladiste' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('skladiste')}
          >
            <Snowflake size={17} />
            <span>Hladnjača</span>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'sortiranje' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('sortiranje')}
          >
            <Scale size={17} />
            <span>Sortiranje</span>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'pakovanje' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('pakovanje')}
          >
            <Package size={17} />
            <span>Pakovanje</span>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'isporuka' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('isporuka')}
          >
            <Truck size={17} />
            <span>Isporuka</span>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'otpis' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('otpis')}
          >
            <AlertTriangle size={17} />
            <span>Otpis</span>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'sledljivost' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('sledljivost')}
          >
            <QrCode size={17} />
            <span>LOT Sledljivost</span>
          </button>
        </div>

        {/* ============================================================ */}
        {/* TAB 2: SKLADIŠTE & DINAMIČKE KOMORE HLADNJAČE */}
        {/* ============================================================ */}
        {activeTab === 'skladiste' && (
          <>
            <div className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3 className={styles.sectionTitle}>
                    <Snowflake size={20} color="#0891b2" />
                    <span>
                      Pregled komora hladnjače ({dashboardData?.chambersSummary?.length || 6} komora • Kapacitet: {(kpi.maxColdStorageBoxes || 4320).toLocaleString('sr-RS')} boksova / {formatKgAndTons(kpi.maxColdStorageKg || 4800000)})
                    </span>
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Dinamičko upravljanje komorama i boks paletama (dimenzija <strong>160x120x120 cm</strong>, <strong>1.100 kg</strong> po boksu) • Zaduženo lice: <strong>Bojan Ćorović</strong>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={() => {
                      setChamberModalForm({
                        id: '',
                        name: '',
                        storageType: 'HLADNJACA',
                        hasEquipment: true,
                        maxBoxes: '720',
                      });
                      setIsChamberModalOpen(true);
                    }}
                  >
                    <Plus size={16} />
                    <span>Nova komora</span>
                  </button>

                  <button
                    type="button"
                    className={styles.btnBlue}
                    onClick={() => {
                      if (!storageForm.lotId && lots[0]?.id) {
                        setStorageForm((prev) => ({ ...prev, lotId: lots[0].id }));
                      }
                      setIsStorageModalOpen(true);
                    }}
                  >
                    <Plus size={16} />
                    <span>Unos u komoru / boksove</span>
                  </button>
                </div>
              </div>

              <div className={styles.cardsGrid}>
                {(dashboardData?.chambersSummary || []).map((ch: any, idx: number) => {
                  const maxB = ch.maxBoxes || 720;
                  const curB = ch.currentBoxes || Math.round((ch.currentQuantityKg || 0) / 1100);
                  const fillPct = Math.min(100, Math.round((curB / maxB) * 100));

                  return (
                    <div key={idx} className={styles.chamberCard}>
                      {/* Header: Naziv komore i Oprema */}
                      <div className={styles.chamberTop}>
                        <div className={styles.chamberTitleGroup}>
                          <div
                            className={`${styles.chamberIconBadge} ${ch.storageType === 'HLADNJACA'
                              ? styles.chamberIconBadgeCyan
                              : styles.chamberIconBadgeIndigo
                              }`}
                          >
                            {ch.storageType === 'HLADNJACA' ? (
                              <Snowflake size={18} />
                            ) : (
                              <Warehouse size={18} />
                            )}
                          </div>
                          <span className={styles.chamberTitle}>{ch.locationOrChamber}</span>
                        </div>

                        <span
                          className={styles.badgeStatus}
                          style={{
                            background: ch.hasEquipment
                              ? 'rgba(8, 145, 178, 0.14)'
                              : 'rgba(217, 119, 6, 0.14)',
                            color: ch.hasEquipment ? '#0891b2' : '#d97706',
                          }}
                        >
                          {ch.hasEquipment ? 'Sa opremom' : 'Bez opreme'}
                        </span>
                      </div>

                      {/* Glavna metrika: Količina i tonaža */}
                      <div className={styles.chamberHeroRow}>
                        <div className={styles.chamberHeroQty}>
                          {Number(ch.currentQuantityKg || 0).toLocaleString('sr-RS')}{' '}
                          <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                            kg
                          </span>
                        </div>
                        <span className={styles.chamberHeroBadge}>
                          {((ch.currentQuantityKg || 0) / 1000).toLocaleString('sr-RS', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          t
                        </span>
                      </div>

                      {/* Kapacitet boks paleta */}
                      <div className={styles.chamberCapacityRow}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <Box size={14} style={{ color: '#0284c7' }} />
                          <span>Boks palete (160x120x120):</span>
                        </span>
                        <span className={styles.chamberCapacityHighlight}>
                          {curB} / {maxB} boksova ({fillPct}%)
                        </span>
                      </div>

                      {/* Progress bar popunjenosti */}
                      <div className={styles.chamberProgressBarTrack}>
                        <div
                          className={styles.chamberProgressBarFill}
                          style={{
                            width: `${fillPct}%`,
                            backgroundColor: ch.hasEquipment ? '#0891b2' : '#d97706',
                          }}
                        />
                      </div>

                      {/* Specifikacija i Zaduženo lice */}
                      <div className={styles.climateRow}>
                        <span className={styles.climatePill}>
                          <Scale size={13} style={{ color: '#0284c7' }} />
                          <span>1 boks = 1.100 kg</span>
                        </span>
                        <span className={styles.climatePill}>
                          <UserCheck size={13} color="#16a34a" />
                          <span>Zadužen: Bojan Ćorović</span>
                        </span>
                      </div>

                      {/* LOT partije u komori */}
                      {ch.lots && ch.lots.length > 0 && (
                        <div className={styles.chamberLotsSection}>
                          {ch.lots.map((l: any, i: number) => (
                            <div key={i} className={styles.chamberLotRow}>
                              <span
                                className={styles.chamberLotLink}
                                onClick={() => handleOpenTraceability(l.lotNumber)}
                                title={`Prikaži sledljivost za LOT ${l.lotNumber}`}
                              >
                                {l.lotNumber} ({l.parcelName})
                              </span>
                              <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                <strong style={{ color: 'var(--text-primary)' }}>{l.currentBoxes} boks.</strong> (
                                {formatKgAndTons(l.currentQuantityKg)})
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Donji elegantni panel akcija: Izmeni komoru & Obriši */}
                      <div className={styles.chamberActionsRow}>
                        <button
                          type="button"
                          className={styles.chamberActionEditBtn}
                          onClick={() => {
                            setChamberModalForm({
                              id: ch.id || ch.locationOrChamber,
                              name: ch.locationOrChamber,
                              storageType: ch.storageType || 'HLADNJACA',
                              hasEquipment: ch.hasEquipment,
                              maxBoxes: String(ch.maxBoxes || 720),
                            });
                            setIsChamberModalOpen(true);
                          }}
                        >
                          <Settings2 size={14} />
                          <span>Podesi komoru</span>
                        </button>
                        <button
                          type="button"
                          className={styles.chamberActionDeleteBtn}
                          title="Obriši komoru iz sistema"
                          onClick={() => handleOpenDeleteChamberModal(ch)}
                        >
                          <Trash2 size={14} />
                          <span>Obriši</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  <Warehouse size={20} color="#4f46e5" />
                  <span>Evidencija komora i boks paleta sa opcijom izmene</span>
                </h3>

                <div className={styles.filterSelectWrap}>
                  <CustomSelect
                    value={storageTypeFilter}
                    onChange={(val) => {
                      setStorageTypeFilter(val);
                      setStoragePage(1);
                    }}
                    options={storageTypeFilterOptions}
                    searchable={false}
                  />
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Komora / Lokacija</th>
                      <th>Oprema komore</th>
                      <th>LOT Broj</th>
                      <th>Parcela</th>
                      <th>Broj boks paleta</th>
                      <th>Trenutno u komori</th>
                      <th>Zaduženo lice</th>
                      <th>Izmena</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(storageData?.entries || []).length === 0 ? (
                      <tr>
                        <td colSpan={8}>
                          <div className={styles.emptyState}>
                            <span>Nema zapisa u skladištu za izabrani filter.</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      (storageData?.entries || []).map((st: any) => {
                        const boxes =
                          st.boxCount || Math.round((st.currentQuantityKg || 0) / 1100);
                        return (
                          <tr key={st.id}>
                            <td style={{ fontWeight: 800 }}>
                              <Snowflake
                                size={15}
                                color="#0891b2"
                                style={{ verticalAlign: 'middle', marginRight: 6 }}
                              />
                              {st.locationOrChamber}
                            </td>
                            <td>
                              <span
                                className={styles.badgeStatus}
                                style={{
                                  backgroundColor: st.hasEquipment
                                    ? 'rgba(8, 145, 178, 0.14)'
                                    : 'rgba(217, 119, 6, 0.14)',
                                  color: st.hasEquipment ? '#0891b2' : '#d97706',
                                }}
                              >
                                {st.hasEquipment ? 'Sa opremom' : 'Bez opreme'}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className={styles.lotBadge}
                                onClick={() => handleOpenTraceability(st.lot?.lotNumber)}
                              >
                                <QrCode size={13} />
                                <span>{st.lot?.lotNumber}</span>
                              </button>
                            </td>
                            <td>{st.lot?.parcel?.name || '-'}</td>
                            <td style={{ fontWeight: 700, color: '#0284c7' }}>
                              {boxes} / 720 boksova
                              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                                160x120x120 cm (1.100 kg)
                              </div>
                            </td>
                            <td style={{ fontWeight: 800, color: '#0891b2' }}>
                              {formatKgAndTons(st.currentQuantityKg)}
                            </td>
                            <td>{st.supervisor?.name || 'Bojan Ćorović'}</td>
                            <td>
                              <button
                                type="button"
                                className={styles.btnIconSmall}
                                onClick={() =>
                                  setEditingStorage({
                                    ...st,
                                    boxCount: boxes,
                                  })
                                }
                              >
                                <Pencil size={13} />
                                <span>Izmeni</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <TablePagination
                currentPage={storagePage}
                totalPages={storageData?.totalPages || 1}
                totalItems={storageData?.total || 0}
                pageSize={PAGE_SIZE}
                onPageChange={setStoragePage}
                itemName="zapisa u skladištu"
              />
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 4: PAKOVANJE, PAKERICA & DŽAKOVI 10KG / 5KG */}
        {/* ============================================================ */}
        {activeTab === 'pakovanje' && (
          <>
            <div className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3 className={styles.sectionTitle}>
                    <Settings2 size={20} color="#d97706" />
                    <span>
                      Pakerica i zaliha spakovanog luka na paletama (10 kg i 5 kg džakovi)
                    </span>
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Na paleti staje <strong>100 džakova po 10 kg (1.000 kg)</strong> ili{' '}
                    <strong>200 džakova po 5 kg (1.000 kg)</strong>
                  </div>
                </div>

                <button
                  type="button"
                  className={styles.btnAmber}
                  onClick={() => {
                    if (!packagingForm.lotId && lots[0]?.id) {
                      setPackagingForm((prev) => ({ ...prev, lotId: lots[0].id }));
                    }
                    setIsPackagingModalOpen(true);
                  }}
                >
                  <Plus size={16} />
                  <span>Novo pakovanje na pakerici</span>
                </button>
              </div>

              {(dashboardData?.packagedByType || []).length === 0 ? (
                <div className={styles.emptyState}>
                  <Package size={28} />
                  <span>Još uvek nema spakovanih džakova na stanju.</span>
                </div>
              ) : (
                <div className={styles.cardsGrid}>
                  {(dashboardData?.packagedByType || []).map((item: any) => (
                    <div key={item.packageType} className={styles.chamberCard}>
                      <div className={styles.chamberTop}>
                        <div className={styles.chamberTitle}>
                          <Package size={18} color="#d97706" />
                          <span>{PACKAGE_LABELS[item.packageType] || item.packageType}</span>
                        </div>
                      </div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#d97706' }}>
                        {item.availableCount.toLocaleString('sr-RS')} džakova (
                        {item.availablePallets || (item.availableWeightKg / 1000).toFixed(1)} paleta)
                      </div>
                      <div style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                        Raspoloživa masa: <strong>{formatKgAndTons(item.availableWeightKg)}</strong>
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        Ukupno spakovano: {item.totalPackedCount.toLocaleString('sr-RS')} kom (
                        {formatKgAndTons(item.totalPackedWeightKg)})
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tabela: Raspoloživa sortirana I klasa spremna za pakovanje (po parcelama i LOT-ovima) */}
            <div className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3 className={styles.sectionTitle}>
                    <Scale size={20} color="#16a34a" />
                    <span>Raspoloživ sortirani luk I klase za pakovanje (po parcelama & LOT-ovima)</span>
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Sirova I klasa luka na stanju spremna za pakovanje u džakove • Ukupno raspoloživo:{' '}
                    <strong style={{ color: '#16a34a' }}>
                      {formatKgAndTons(kpi.unpackedQualityKg)}
                    </strong>
                  </div>
                </div>

                <div className={styles.filterRow}>
                  <div className={styles.searchInputWrap}>
                    <Search size={16} className={styles.searchIcon} />
                    <input
                      type="text"
                      className={styles.searchInput}
                      placeholder="Pretraži po LOT-u, parceli..."
                      value={readyLotSearch}
                      onChange={(e) => {
                        setReadyLotSearch(e.target.value);
                        setReadyPage(1);
                      }}
                    />
                  </div>

                  <div className={styles.filterSelectWrap}>
                    <CustomSelect
                      value={readyParcelFilter}
                      onChange={(val) => {
                        setReadyParcelFilter(val);
                        setReadyPage(1);
                      }}
                      options={harvestParcelFilterOptions}
                      placeholder="Sve parcele"
                    />
                  </div>

                  <div className={styles.filterSelectWrap}>
                    <CustomSelect
                      value={readySortOrder}
                      onChange={(val: any) => {
                        setReadySortOrder(val);
                        setReadyPage(1);
                      }}
                      options={readySortOrderOptions}
                      searchable={false}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>LOT Broj</th>
                      <th>Parcela porekla</th>
                      <th>Sorta luka</th>
                      <th>Sortirano I klasa</th>
                      <th>Već spakovano</th>
                      <th>Slobodno za pakovanje</th>
                      <th>Mogućnost pakovanja</th>
                      <th>Status</th>
                      <th>Akcija</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUnpackedLots.length === 0 ? (
                      <tr>
                        <td colSpan={9}>
                          <div className={styles.emptyState}>
                            <CheckCircle2 size={28} color="#16a34a" />
                            <span>Nema pronađenih partija za izabrane filtere.</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      paginatedReadyLots.map((lot: any) => {
                        const availKg = Math.max(0, lot.unpackedQualityKg || 0);
                        const packedKg = Math.max(0, (lot.sortedQualityKg || 0) - availKg);
                        const pal10 = Math.floor(availKg / 1000);
                        const pal5 = Math.floor(availKg / 1000);

                        return (
                          <tr key={lot.id}>
                            <td>
                              <button
                                type="button"
                                className={styles.lotBadge}
                                onClick={() => handleOpenTraceability(lot.lotNumber)}
                                title="Otvori 360° sledljivost ovog LOT-a"
                              >
                                <QrCode size={13} />
                                <span>{lot.lotNumber}</span>
                              </button>
                            </td>
                            <td>
                              <div style={{ fontWeight: 700 }}>
                                {lot.parcel ? `${lot.parcel.code} — ${lot.parcel.name}` : '-'}
                              </div>
                              {lot.parcel?.areaHa && (
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                                  Površina: {lot.parcel.areaHa} ha
                                </div>
                              )}
                            </td>
                            <td style={{ fontWeight: 600 }}>
                              {lot.cropVariety || lot.parcel?.currentCrop || 'Žuti luk'}
                            </td>
                            <td style={{ fontWeight: 700 }}>{formatKgAndTons(lot.sortedQualityKg)}</td>
                            <td style={{ color: 'var(--text-secondary)' }}>
                              {formatKgAndTons(packedKg)}
                            </td>
                            <td
                              style={{
                                fontWeight: 800,
                                fontSize: '0.98rem',
                                color: availKg > 0 ? '#16a34a' : 'var(--text-muted)',
                              }}
                            >
                              {formatKgAndTons(availKg)}
                            </td>
                            <td>
                              {availKg > 0 ? (
                                <div style={{ fontSize: '0.78rem', lineHeight: 1.35 }}>
                                  <div>
                                    <strong style={{ color: '#d97706' }}>~{pal10} paleta</strong> od 10 kg ({pal10 * 100} kom)
                                  </div>
                                  <div style={{ color: 'var(--text-muted)' }}>
                                    ili ~{pal5} paleta od 5 kg ({pal5 * 200} kom)
                                  </div>
                                </div>
                              ) : (
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>-</span>
                              )}
                            </td>
                            <td>
                              {availKg > 0 ? (
                                <span
                                  className={styles.badgeStatus}
                                  style={{
                                    backgroundColor: 'rgba(22, 163, 74, 0.12)',
                                    color: '#16a34a',
                                  }}
                                >
                                  Spremno
                                </span>
                              ) : (
                                <span
                                  className={styles.badgeStatus}
                                  style={{
                                    backgroundColor: 'rgba(100, 116, 139, 0.12)',
                                    color: '#64748b',
                                  }}
                                >
                                  100% Spakovano
                                </span>
                              )}
                            </td>
                            <td>
                              {availKg > 0 ? (
                                <button
                                  type="button"
                                  className={styles.btnAmberSmall}
                                  onClick={() => {
                                    setPackagingForm((prev) => ({
                                      ...prev,
                                      lotId: lot.id,
                                    }));
                                    setIsPackagingModalOpen(true);
                                  }}
                                  title={`Pokreni pakovanje za LOT ${lot.lotNumber}`}
                                >
                                  <Plus size={13} strokeWidth={2.5} />
                                  <span>Spakuj</span>
                                </button>
                              ) : (
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>-</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <TablePagination
                currentPage={readyPage}
                totalPages={totalReadyPages}
                totalItems={filteredUnpackedLots.length}
                pageSize={READY_PAGE_SIZE}
                onPageChange={setReadyPage}
                itemName="partija"
              />
            </div>

            <div className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  <Package size={20} color="#16a34a" />
                  <span>Evidencija rada pakerice i spakovanih paleta (sa opcijom izmene)</span>
                </h3>

                <div className={styles.filterRow}>
                  <div className={styles.filterSelectWrap}>
                    <CustomSelect
                      value={packagingParcelFilter}
                      onChange={(val) => {
                        setPackagingParcelFilter(val);
                        setPackagingPage(1);
                      }}
                      options={harvestParcelFilterOptions}
                      placeholder="Sve parcele"
                    />
                  </div>

                  <div className={styles.filterSelectWrap}>
                    <CustomSelect
                      value={packagingTypeFilter}
                      onChange={(val) => {
                        setPackagingTypeFilter(val);
                        setPackagingPage(1);
                      }}
                      options={packagingTypeFilterOptions}
                      searchable={false}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>LOT Broj</th>
                      <th>Parcela & Sorta</th>
                      <th>Tip pakovanja (10kg / 5kg)</th>
                      <th>Broj paleta & džakova</th>
                      <th>Preostalo na stanju</th>
                      <th>Broj pakera</th>
                      <th>Zaduženo lice</th>
                      <th>Akcije</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(packagingData?.packagings || []).length === 0 ? (
                      <tr>
                        <td colSpan={9}>
                          <div className={styles.emptyState}>
                            <span>Nema zapisa o pakovanju.</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      (packagingData?.packagings || []).map((pk: any) => {
                        const pallets =
                          pk.palletsCount || Number((pk.totalWeightKg / 1000).toFixed(1));
                        return (
                          <tr key={pk.id}>
                            <td>{formatDateTime(pk.date)}</td>
                            <td>
                              <button
                                type="button"
                                className={styles.lotBadge}
                                onClick={() => handleOpenTraceability(pk.lot?.lotNumber)}
                                title="Otvori 360° sledljivost ovog LOT-a"
                              >
                                <QrCode size={13} />
                                <span>{pk.lot?.lotNumber}</span>
                              </button>
                            </td>
                            <td>
                              <div style={{ fontWeight: 700 }}>
                                {pk.lot?.parcel ? `${pk.lot.parcel.code} — ${pk.lot.parcel.name}` : '-'}
                              </div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                Sorta: {pk.lot?.cropVariety || pk.lot?.parcel?.currentCrop || 'Žuti luk'}
                              </div>
                            </td>
                            <td style={{ fontWeight: 700 }}>
                              {PACKAGE_LABELS[pk.packageType] || pk.packageType}
                              {pk.palletNumber && (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  Oznaka: {pk.palletNumber}
                                </div>
                              )}
                            </td>
                            <td>
                              <strong>{pallets} paleta</strong> ({pk.packageCount.toLocaleString('sr-RS')}{' '}
                              kom x {pk.unitWeightKg} kg = {formatKgAndTons(pk.totalWeightKg)})
                            </td>
                            <td
                              style={{
                                fontWeight: 800,
                                color: pk.availableCount > 0 ? '#16a34a' : '#64748b',
                              }}
                            >
                              {pk.availableCount.toLocaleString('sr-RS')} kom (
                              {formatKgAndTons(pk.availableWeightKg)})
                            </td>
                            <td>
                              <span
                                className={styles.badgeStatus}
                                style={{
                                  backgroundColor: 'rgba(147, 51, 234, 0.12)',
                                  color: '#9333ea',
                                }}
                              >
                                <Users size={13} />
                                <span>{pk.packerCount || 4}</span>
                              </span>
                              {pk.packerNotes &&
                                !/^pakerica:\s*\d+\s*(pakera|žene|zene|radnika)\s*(u\s*smeni)?$/i.test(pk.packerNotes.trim()) && (
                                  <div
                                    style={{
                                      fontSize: '0.74rem',
                                      color: 'var(--text-muted)',
                                      marginTop: 2,
                                    }}
                                  >
                                    {pk.packerNotes}
                                  </div>
                                )}
                            </td>
                            <td>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                                <UserCheck size={14} color="#16a34a" />
                                {pk.responsiblePerson || 'Bojan Ćorović'}
                              </span>
                            </td>
                            <td>
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                                <button
                                  type="button"
                                  className={styles.btnIconShip}
                                  title={
                                    pk.availableCount > 0
                                      ? `Kreiraj novu isporuku za LOT ${pk.lot?.lotNumber || ''}`
                                      : 'Sva roba sa ove palete je već isporučena kupcima'
                                  }
                                  disabled={pk.availableCount <= 0}
                                  onClick={() => handleQuickShipmentFromPackaging(pk)}
                                >
                                  <Truck size={13} />
                                  <span>Isporuči</span>
                                </button>
                                <button
                                  type="button"
                                  className={styles.btnIconSmall}
                                  onClick={() =>
                                    setEditingPackaging({
                                      ...pk,
                                      packerCount: pk.packerCount || 4,
                                      responsiblePerson: pk.responsiblePerson || 'Bojan Ćorović',
                                      palletsCount: pallets,
                                    })
                                  }
                                >
                                  <Pencil size={13} />
                                  <span>Izmeni</span>
                                </button>
                                {isManager && (
                                  <button
                                    type="button"
                                    className={styles.btnIconDanger}
                                    title="Obriši zapis pakovanja"
                                    onClick={() => handleOpenDeletePackagingModal(pk)}
                                  >
                                    <Trash2 size={13} />
                                    <span>Obriši</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <TablePagination
                currentPage={packagingPage}
                totalPages={packagingData?.totalPages || 1}
                totalItems={packagingData?.total || 0}
                pageSize={PAGE_SIZE}
                onPageChange={setPackagingPage}
                itemName="spakovanih partija"
              />
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 1: DOVOZ SA NJIVE & AKTIVNI LOT-OVI */}
        {/* ============================================================ */}
        {activeTab === 'dovoz' && (
          <>
            <div className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  <Tractor size={20} color="#16a34a" />
                  <span>Evidencija dovoza luka sa njive u hladnjaču</span>
                </h3>

                <div className={styles.filterRow}>
                  <div className={styles.searchInputWrap}>
                    <Search size={16} className={styles.searchIcon} />
                    <input
                      type="text"
                      className={styles.searchInput}
                      placeholder="Pretraži po LOT broju, parceli, boksovima..."
                      value={harvestSearch}
                      onChange={(e) => {
                        setHarvestSearch(e.target.value);
                        setHarvestPage(1);
                      }}
                    />
                  </div>

                  <div className={styles.filterParcelColumn}>
                    {isManager && (
                      <div className={styles.filterParcelHeaderRow}>
                        <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                          Parcela
                        </span>
                        <div className={styles.parcelHeaderActions}>
                          <button
                            type="button"
                            onClick={() => {
                              setParcelQuickTarget('harvest-filter');
                              setParcelToEdit(null);
                              setParcelQuickModalOpen(true);
                            }}
                            className={styles.miniParcelAddBtn}
                            title="Brzo dodaj novu parcelu"
                          >
                            <Plus size={11} strokeWidth={2.5} />
                            <span>Dodaj</span>
                          </button>
                          {harvestParcelFilter && harvestParcelFilter !== 'ALL' && (
                            <button
                              type="button"
                              onClick={() => {
                                const found = parcels.find((p: any) => p.id === harvestParcelFilter);
                                if (found) {
                                  setParcelQuickTarget('harvest-filter');
                                  setParcelToEdit(found);
                                  setParcelQuickModalOpen(true);
                                }
                              }}
                              className={styles.miniParcelEditBtn}
                              title="Izmeni selektovanu parcelu"
                            >
                              <Pencil size={11} strokeWidth={2.5} />
                              <span>Izmeni</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    <CustomSelect
                      value={harvestParcelFilter}
                      onChange={(val) => {
                        setHarvestParcelFilter(val);
                        setHarvestPage(1);
                      }}
                      options={harvestParcelFilterOptions}
                      placeholder="Sve parcele"
                    />
                  </div>

                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={() => {
                      if (!harvestForm.parcelId && parcels[0]?.id) {
                        setHarvestForm((prev) => ({ ...prev, parcelId: parcels[0].id }));
                      }
                      setIsHarvestModalOpen(true);
                    }}
                  >
                    <Plus size={16} />
                    <span>Novi uvoz sa njive</span>
                  </button>
                </div>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>LOT Broj</th>
                      <th>Parcela & Sorta</th>
                      <th>Količina ture</th>
                      <th>Boks palete (1.100 kg)</th>
                      <th>Zaduženo lice</th>
                      <th>Sledljivost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(harvestData?.arrivals || []).length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <div className={styles.emptyState}>
                            <Tractor size={28} />
                            <span>Nema evidentiranih tura dovoza sa njive.</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      (harvestData?.arrivals || []).map((arr: any) => (
                        <tr key={arr.id}>
                          <td>{formatDateTime(arr.date)}</td>
                          <td>
                            <button
                              type="button"
                              className={styles.lotBadge}
                              onClick={() => handleOpenTraceability(arr.lot?.lotNumber)}
                              title="Otvori 360° sledljivost ovog LOT-a"
                            >
                              <QrCode size={13} />
                              <span>{arr.lot?.lotNumber}</span>
                            </button>
                          </td>
                          <td>
                            <div style={{ fontWeight: 700 }}>
                              {arr.parcel?.code} — {arr.parcel?.name}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                              Sorta: {arr.lot?.cropVariety || arr.parcel?.currentCrop || 'Žuti luk'}
                            </div>
                          </td>
                          <td style={{ fontWeight: 800, color: '#16a34a' }}>
                            {formatKgAndTons(arr.quantityKg)}
                          </td>
                          <td>
                            <strong>{Math.round(arr.quantityKg / 1100)} boksova</strong>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {arr.trailerInfo || '160x120x120 cm'}
                            </div>
                          </td>
                          <td>{arr.supervisor?.name || 'Bojan Ćorović'}</td>
                          <td>
                            <button
                              type="button"
                              className={styles.btnIconSmall}
                              onClick={() => handleOpenTraceability(arr.lot?.lotNumber)}
                            >
                              <ArrowRight size={14} />
                              <span>Prati LOT</span>
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <TablePagination
                currentPage={harvestPage}
                totalPages={harvestData?.totalPages || 1}
                totalItems={harvestData?.total || 0}
                pageSize={PAGE_SIZE}
                onPageChange={setHarvestPage}
                itemName="tura dovoza"
              />
            </div>

            <div className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  <ClipboardCheck size={20} color="#0284c7" />
                  <span>Pregled svih LOT partija i bilans po komorama</span>
                </h3>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>LOT Broj</th>
                      <th>Parcela</th>
                      <th>Status</th>
                      <th>Početni ulaz</th>
                      <th>U hladnjači (Sirovo)</th>
                      <th>Sortirano I klasa</th>
                      <th>Spakovano na stanju</th>
                      <th>Isporučeno</th>
                      <th>Otpis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((lot: any) => (
                      <tr key={lot.id}>
                        <td>
                          <button
                            type="button"
                            className={styles.lotBadge}
                            onClick={() => handleOpenTraceability(lot.lotNumber)}
                          >
                            <QrCode size={13} />
                            <span>{lot.lotNumber}</span>
                          </button>
                        </td>
                        <td>
                          <strong>{lot.parcel?.code}</strong> — {lot.parcel?.name}
                        </td>
                        <td>
                          <span
                            className={`${styles.badgeStatus} ${lot.status === 'ISPORUCEN'
                              ? styles.statusIsporucen
                              : lot.status === 'U_OBRADI'
                                ? styles.statusUObradi
                                : styles.statusNaStanju
                              }`}
                          >
                            {LOT_STATUS_LABELS[lot.status] || lot.status}
                          </span>
                        </td>
                        <td style={{ fontWeight: 700 }}>{formatKgAndTons(lot.initialQuantityKg)}</td>
                        <td style={{ color: '#0891b2', fontWeight: 700 }}>
                          {formatKgAndTons(lot.rawStockKg)}
                        </td>
                        <td>{formatKgAndTons(lot.sortedQualityKg)}</td>
                        <td style={{ color: '#d97706', fontWeight: 700 }}>
                          {formatKgAndTons(lot.packagedStockKg)}
                        </td>
                        <td style={{ color: '#0284c7', fontWeight: 700 }}>
                          {formatKgAndTons(lot.shippedKg)}
                        </td>
                        <td style={{ color: '#dc2626', fontWeight: 600 }}>
                          {formatKgAndTons(lot.totalWasteKg)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <TablePagination
                currentPage={lotsPage}
                totalPages={lotsData?.totalPages || 1}
                totalItems={lotsData?.total || 0}
                pageSize={PAGE_SIZE}
                onPageChange={setLotsPage}
                itemName="LOT partija"
              />
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 3: SORTIRANJE & KALIBRACIJA */}
        {/* ============================================================ */}
        {activeTab === 'sortiranje' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Scale size={20} color="#0284c7" />
                <span>Dnevnik sortiranja i kalibracije (I klasa za pakericu, Sitan luk, Kalo)</span>
              </h3>

              <button
                type="button"
                className={styles.btnBlue}
                onClick={() => {
                  if (!sortingForm.lotId && lots[0]?.id) {
                    setSortingForm((prev) => ({ ...prev, lotId: lots[0].id }));
                  }
                  setIsSortingModalOpen(true);
                }}
              >
                <Plus size={16} />
                <span>Novo sortiranje</span>
              </button>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>LOT Broj</th>
                    <th>Parcela</th>
                    <th>Ubačeno na liniju</th>
                    <th>I Klasa (Za pakericu)</th>
                    <th>Sitan luk (II klasa)</th>
                    <th>Otpad / Škart</th>
                    <th>% Kala</th>
                    <th>Odgovorno lice</th>
                  </tr>
                </thead>
                <tbody>
                  {(sortingData?.sortings || []).length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <div className={styles.emptyState}>
                          <Scale size={28} />
                          <span>Nema evidentiranih procesa sortiranja.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    (sortingData?.sortings || []).map((sr: any) => (
                      <tr key={sr.id}>
                        <td>{formatDateTime(sr.date)}</td>
                        <td>
                          <button
                            type="button"
                            className={styles.lotBadge}
                            onClick={() => handleOpenTraceability(sr.lot?.lotNumber)}
                          >
                            <QrCode size={13} />
                            <span>{sr.lot?.lotNumber}</span>
                          </button>
                        </td>
                        <td>{sr.lot?.parcel?.name || '-'}</td>
                        <td style={{ fontWeight: 700 }}>{formatKgAndTons(sr.inputQuantityKg)}</td>
                        <td style={{ fontWeight: 800, color: '#16a34a' }}>
                          {formatKgAndTons(sr.qualityQuantityKg)}
                        </td>
                        <td style={{ fontWeight: 600, color: '#9333ea' }}>
                          {formatKgAndTons(sr.smallQuantityKg)}
                        </td>
                        <td style={{ fontWeight: 600, color: '#dc2626' }}>
                          {formatKgAndTons(sr.wasteQuantityKg)}
                        </td>
                        <td>
                          <span
                            className={styles.badgeStatus}
                            style={{
                              backgroundColor:
                                sr.wastePercentage > 10
                                  ? 'rgba(220, 38, 38, 0.14)'
                                  : 'rgba(22, 163, 74, 0.14)',
                              color: sr.wastePercentage > 10 ? '#dc2626' : '#16a34a',
                            }}
                          >
                            {sr.wastePercentage}%
                          </span>
                        </td>
                        <td>{sr.supervisor?.name || 'Bojan Ćorović'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <TablePagination
              currentPage={sortingPage}
              totalPages={sortingData?.totalPages || 1}
              totalItems={sortingData?.total || 0}
              pageSize={PAGE_SIZE}
              onPageChange={setSortingPage}
              itemName="procesa sortiranja"
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 5: ISPORUKA KUPCU & OTPREMNICE */}
        {/* ============================================================ */}
        {activeTab === 'isporuka' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <Truck size={20} color="#0284c7" />
                <span>Isporuke kupcima i zvanične PDF otpremnice</span>
              </h3>

              <div className={styles.filterRow}>
                <div className={styles.searchInputWrap}>
                  <Search size={16} className={styles.searchIcon} />
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Pretraži po broju otpremnice, kupcu, LOT-u..."
                    value={shipmentSearch}
                    onChange={(e) => {
                      setShipmentSearch(e.target.value);
                      setShipmentPage(1);
                    }}
                  />
                </div>

                <div className={styles.filterParcelColumn}>
                  {isManager && (
                    <div className={styles.filterParcelHeaderRow}>
                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                        Kupac
                      </span>
                      <div className={styles.parcelHeaderActions}>
                        <button
                          type="button"
                          onClick={() => {
                            setBuyerQuickTarget('shipment-filter');
                            setBuyerToEdit(null);
                            setBuyerQuickModalOpen(true);
                          }}
                          className={styles.miniParcelAddBtn}
                          style={{
                            color: '#0284c7',
                            background: 'rgba(2, 132, 199, 0.12)',
                            borderColor: 'rgba(2, 132, 199, 0.35)',
                          }}
                          title="Brzo dodaj novog kupca"
                        >
                          <Plus size={11} strokeWidth={2.5} />
                          <span>Dodaj</span>
                        </button>
                        {shipmentBuyerFilter && shipmentBuyerFilter !== 'ALL' && (
                          <button
                            type="button"
                            onClick={() => {
                              const found = buyers.find((b: any) => b.id === shipmentBuyerFilter);
                              if (found) {
                                setBuyerQuickTarget('shipment-filter');
                                setBuyerToEdit(found);
                                setBuyerQuickModalOpen(true);
                              }
                            }}
                            className={styles.miniParcelEditBtn}
                            title="Izmeni selektovanog kupca"
                          >
                            <Pencil size={11} strokeWidth={2.5} />
                            <span>Izmeni</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  <CustomSelect
                    value={shipmentBuyerFilter}
                    onChange={(val) => {
                      setShipmentBuyerFilter(val);
                      setShipmentPage(1);
                    }}
                    options={shipmentBuyerFilterOptions}
                    placeholder="Svi kupci"
                  />
                </div>

                <button
                  type="button"
                  className={styles.btnPrimary}
                  onClick={() => {
                    if (!shipmentForm.buyerId && buyers[0]?.id) {
                      setShipmentForm((prev) => ({ ...prev, buyerId: buyers[0].id }));
                    }
                    setIsShipmentModalOpen(true);
                  }}
                >
                  <Plus size={16} />
                  <span>Nova isporuka kupcu</span>
                </button>
              </div>
            </div>

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Otpremnica</th>
                    <th>Kupac</th>
                    <th>LOT Porekla</th>
                    <th>Isporučeno džakova</th>
                    <th>Neto masa</th>
                    <th>Vrednost (RSD)</th>
                    <th>Vozilo / Vozač</th>
                    <th>PDF Otpremnica</th>
                  </tr>
                </thead>
                <tbody>
                  {(shipmentData?.shipments || []).length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <div className={styles.emptyState}>
                          <Truck size={28} />
                          <span>Nema evidentiranih isporuka kupcima.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    (shipmentData?.shipments || []).map((sh: any) => (
                      <tr key={sh.id}>
                        <td>{formatDateTime(sh.date)}</td>
                        <td style={{ fontWeight: 800, color: '#0284c7' }}>{sh.dispatchNumber}</td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{sh.buyer?.name}</div>
                          {sh.buyer?.pib && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              PIB: {sh.buyer.pib}
                            </div>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={styles.lotBadge}
                            onClick={() => handleOpenTraceability(sh.lot?.lotNumber)}
                          >
                            <QrCode size={13} />
                            <span>{sh.lot?.lotNumber}</span>
                          </button>
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {sh.totalPackagesCount.toLocaleString('sr-RS')} džakova (
                          {(sh.totalWeightKg / 1000).toFixed(1)} paleta)
                        </td>
                        <td style={{ fontWeight: 800, color: '#16a34a' }}>
                          {formatKgAndTons(sh.totalWeightKg)}
                        </td>
                        <td>
                          {sh.totalValue
                            ? `${sh.totalValue.toLocaleString('sr-RS')} RSD`
                            : sh.pricePerKg
                              ? `${sh.pricePerKg} RSD/kg`
                              : '-'}
                        </td>
                        <td>
                          <div>{sh.vehicleReg || '-'}</div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                            {sh.driverName || ''}
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            className={styles.btnIconSmall}
                            onClick={() => handleDownloadDispatchPdf(sh)}
                          >
                            <Download size={14} />
                            <span>PDF</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <TablePagination
              currentPage={shipmentPage}
              totalPages={shipmentData?.totalPages || 1}
              totalItems={shipmentData?.total || 0}
              pageSize={PAGE_SIZE}
              onPageChange={setShipmentPage}
              itemName="isporuka kupcima"
            />
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 6: OTPIS & KALO */}
        {/* ============================================================ */}
        {activeTab === 'otpis' && (
          <>
            <div className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  <AlertTriangle size={20} color="#dc2626" />
                  <span>Struktura otpisa i kala po uzrocima</span>
                </h3>

                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => {
                    if (!wasteForm.lotId && lots[0]?.id) {
                      setWasteForm((prev) => ({ ...prev, lotId: lots[0].id }));
                    }
                    setIsWasteModalOpen(true);
                  }}
                >
                  <Plus size={16} />
                  <span>Evidentiraj otpis / kalo</span>
                </button>
              </div>

              <div className={styles.cardsGrid}>
                {Object.entries(wasteData?.byReason || {}).map(([reasonKey, qty]) => {
                  const kgVal = Number(qty || 0);
                  return (
                    <div key={reasonKey} className={styles.chamberCard}>
                      <div className={styles.chamberTitle}>
                        <AlertTriangle size={16} color="#dc2626" />
                        <span>{WASTE_REASON_LABELS[reasonKey] || reasonKey}</span>
                      </div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#dc2626' }}>
                        {formatKgAndTons(kgVal)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  <FileText size={20} color="#dc2626" />
                  <span>Dnevnik vanrednih otpisa i kala u skladištu</span>
                </h3>
              </div>

              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>LOT Broj</th>
                      <th>Parcela</th>
                      <th>Količina otpisa</th>
                      <th>Uzrok</th>
                      <th>Komora / Lokacija</th>
                      <th>Opis</th>
                      <th>Evidentirao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(wasteData?.wastes || []).length === 0 ? (
                      <tr>
                        <td colSpan={8}>
                          <div className={styles.emptyState}>
                            <span>Nema pojedinačnih zapisa o otpisu u skladištu.</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      (wasteData?.wastes || []).map((w: any) => (
                        <tr key={w.id}>
                          <td>{formatDateTime(w.date)}</td>
                          <td>
                            <button
                              type="button"
                              className={styles.lotBadge}
                              onClick={() => handleOpenTraceability(w.lot?.lotNumber)}
                            >
                              <QrCode size={13} />
                              <span>{w.lot?.lotNumber}</span>
                            </button>
                          </td>
                          <td>{w.lot?.parcel?.name || '-'}</td>
                          <td style={{ fontWeight: 800, color: '#dc2626' }}>
                            {formatKgAndTons(w.quantityKg)}
                          </td>
                          <td style={{ fontWeight: 600 }}>
                            {WASTE_REASON_LABELS[w.reason] || w.reason}
                          </td>
                          <td>{w.location || '-'}</td>
                          <td>{w.description || w.notes || '-'}</td>
                          <td>{w.supervisor?.name || 'Bojan Ćorović'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <TablePagination
                currentPage={wastePage}
                totalPages={wasteData?.totalPages || 1}
                totalItems={wasteData?.total || 0}
                pageSize={PAGE_SIZE}
                onPageChange={setWastePage}
                itemName="zapisa o otpisu"
              />
            </div>
          </>
        )}

        {/* ============================================================ */}
        {/* TAB 7: 360° LOT SLEDLJIVOST (TRACEABILITY OD NJIVE DO KUPCA) */}
        {/* ============================================================ */}
        {activeTab === 'sledljivost' && (
          <div className={styles.sectionCard}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>
                <QrCode size={20} color="#0284c7" />
                <span>360° LOT Sledljivost — Kompletan put luka od parcele do kupca</span>
              </h3>

              <div className={styles.filterRow}>
                <div className={styles.filterSelectWrap}>
                  <CustomSelect
                    value={activeLotNumberForTrace}
                    onChange={(val) => {
                      setSelectedTraceLot(val);
                      setTraceLotInput(val);
                    }}
                    options={traceLotSelectOptions}
                    placeholder="— 10 najnovijih partija —"
                  />
                </div>

                <div className={styles.searchInputWrap}>
                  <Search size={16} className={styles.searchIcon} />
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Unesi LOT broj (npr. LOT-2026...)"
                    value={traceLotInput}
                    onChange={(e) => setTraceLotInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && traceLotInput.trim()) {
                        setSelectedTraceLot(traceLotInput.trim());
                      }
                    }}
                  />
                </div>

                <button
                  type="button"
                  className={styles.btnBlue}
                  onClick={() => {
                    if (traceLotInput.trim()) {
                      setSelectedTraceLot(traceLotInput.trim());
                    }
                  }}
                >
                  <Search size={16} />
                  <span>Pronađi LOT</span>
                </button>
              </div>
            </div>

            {loadingTrace ? (
              <div className={styles.emptyState}>
                <RotateCw size={26} />
                <span>Učitavanje hronologije LOT-a...</span>
              </div>
            ) : !traceData?.lot ? (
              <div className={styles.emptyState}>
                <QrCode size={32} />
                <span>Izaberite ili unesite LOT broj za prikaz kompletne sledljivosti.</span>
              </div>
            ) : (() => {
              const turas: any[] = traceData.turas || [];
              const activeTura = turas.find((t: any) => t.id === selectedTuraId);

              // Filtriranje hronologije po turi:
              // Ako je izabrana tura (npr. Tura 1), prikazuju se bazni koraci (dovoz, hladnjača, sortiranje)
              // i isključivo pakovanje i isporuka te ture.
              // Pakovanja i isporuke ostalih tura su sakriveni.
              // Sve ture se vide samo na celokupnom pogledu (selectedTuraId === 'ALL').
              const relatedPackagingIds = new Set<string>();
              if (activeTura) {
                if (activeTura.packagingId) {
                  relatedPackagingIds.add(activeTura.packagingId);
                }
                if (activeTura.packagingDetails && Array.isArray(activeTura.packagingDetails)) {
                  activeTura.packagingDetails.forEach((p: any) => {
                    if (p.packagingId) relatedPackagingIds.add(p.packagingId);
                  });
                }
              }

              const allEvents = traceData.timeline || [];
              const filteredTimeline = (!activeTura || selectedTuraId === 'ALL')
                ? allEvents
                : allEvents.filter((ev: any) => {
                  if (ev.stage === 'ISPORUKA_KUPAC' || ev.id?.startsWith('shipment-')) {
                    const shId = ev.id.replace('shipment-', '');
                    return activeTura.shipmentId === shId;
                  }
                  if (ev.stage === 'PAKOVANJE' || ev.id?.startsWith('packaging-')) {
                    const pkId = ev.id.replace('packaging-', '');
                    return relatedPackagingIds.has(pkId);
                  }
                  return true;
                });

              return (
                <>
                  {/* NAVIGACIJA KROZ TURE (1, 2, 3...) POD ISTIM LOT BROJEM */}
                  <div className={styles.turasNavContainer}>
                    <div className={styles.turasNavHeader}>
                      <div className={styles.turasNavTitle}>
                        <Layers size={16} color="#0284c7" />
                        <span>Ture i Faze Isporuke za LOT: {traceData.lot.lotNumber}</span>
                      </div>
                      <span className={styles.turasNavSubtitle}>
                        {turas.length === 0
                          ? 'Još nema formiranih tura pakovanja i isporuke za ovaj LOT'
                          : `Ukupno ${turas.length} ${turas.length === 1 ? 'tura' : 'ture'} pod istim LOT brojem`}
                      </span>
                    </div>

                    <div className={styles.turasButtonsList}>
                      <button
                        type="button"
                        className={`${styles.turaTabBtn} ${selectedTuraId === 'ALL' ? styles.turaTabBtnActive : ''}`}
                        onClick={() => setSelectedTuraId('ALL')}
                      >
                        <span className={styles.turaBadgeAll}>Zbirno</span>
                        <span className={styles.turaTitle}>Celokupan LOT</span>
                        <span className={styles.turaTabWeight}>({formatKgAndTons(traceData.lot.initialQuantityKg)})</span>
                      </button>

                      {turas.map((t: any) => {
                        const isShipped = t.status === 'ISPORUCEN';
                        const isSelected = selectedTuraId === t.id;

                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={`${styles.turaTabBtn} ${isSelected ? styles.turaTabBtnActive : ''}`}
                            onClick={() => setSelectedTuraId(t.id)}
                            title={`${t.title} — ${formatKgAndTons(t.weightKg)}`}
                          >
                            <span className={`${styles.turaNumberCircle} ${isShipped ? styles.circleShipped : styles.circlePacked}`}>
                              {t.index}
                            </span>
                            <span className={styles.turaTitle}>Tura {t.index}</span>
                            <span className={styles.turaTabWeight}>({formatKgAndTons(t.weightKg)})</span>
                            <span className={`${styles.turaMiniStatus} ${isShipped ? styles.miniShipped : styles.miniPacked}`}>
                              {isShipped ? <Truck size={12} /> : <Package size={12} />}
                              <span>{isShipped ? 'Isporučeno' : 'Spakovano'}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className={styles.traceabilityGrid}>
                    {/* LEVA STRANA: ELEGANTAN PASOŠ SLEDLJIVOSTI PARTIJE */}
                    <div className={styles.traceSummaryBox}>
                      {/* Zaglavlje: LOT Broj i Status */}
                      <div className={styles.traceHeaderCard}>
                        <div className={styles.traceLotBadgeRow}>
                          <div className={styles.traceLotTag}>
                            <QrCode size={18} className={styles.traceLotIcon} />
                            <span className={styles.traceLotText}>{traceData.lot.lotNumber}</span>
                          </div>
                          <button
                            type="button"
                            className={styles.copyLotBtn}
                            title="Kopiraj LOT broj"
                            onClick={() => {
                              navigator.clipboard.writeText(traceData.lot.lotNumber);
                              showToast(`Kopiran LOT broj: ${traceData.lot.lotNumber}`);
                            }}
                          >
                            <Copy size={13} />
                          </button>
                        </div>

                        <div className={styles.traceStatusWrapper}>
                          {activeTura ? (
                            <span
                              className={`${styles.badgeStatus} ${activeTura.status === 'ISPORUCEN'
                                ? styles.statusIsporucen
                                : styles.statusUObradi
                                } ${styles.badgeStatusLarge}`}
                            >
                              {activeTura.status === 'ISPORUCEN' ? (
                                <Truck size={14} />
                              ) : (
                                <Package size={14} />
                              )}
                              <span>
                                {activeTura.status === 'ISPORUCEN'
                                  ? `Tura ${activeTura.index}: Isporučeno`
                                  : `Tura ${activeTura.index}: Spakovano`}
                              </span>
                            </span>
                          ) : (
                            <span
                              className={`${styles.badgeStatus} ${traceData.lot.status === 'ISPORUCEN'
                                ? styles.statusIsporucen
                                : traceData.lot.status === 'U_OBRADI'
                                  ? styles.statusUObradi
                                  : styles.statusNaStanju
                                } ${styles.badgeStatusLarge}`}
                            >
                              {traceData.lot.status === 'U_OBRADI' ? (
                                <RotateCw size={14} className={styles.spinIcon} />
                              ) : traceData.lot.status === 'ISPORUCEN' ? (
                                <Truck size={14} />
                              ) : (
                                <CheckCircle2 size={14} />
                              )}
                              <span>{LOT_STATUS_LABELS[traceData.lot.status] || traceData.lot.status}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* KARTICA SELEKTOVANE TURE (AKO JE IZABRANA TURA 1, 2...) */}
                      {activeTura && (
                        <div className={styles.activeTuraCard}>
                          <div className={styles.activeTuraHeader}>
                            <div className={styles.activeTuraTitleRow}>
                              <span className={styles.activeTuraIndexBadge}>{activeTura.index}</span>
                              <strong>{activeTura.title}</strong>
                            </div>
                            <span
                              className={`${styles.turaMiniStatus} ${activeTura.status === 'ISPORUCEN' ? styles.miniShipped : styles.miniPacked
                                }`}
                            >
                              {activeTura.status === 'ISPORUCEN' ? <Truck size={12} /> : <Package size={12} />}
                              <span>{activeTura.statusLabel}</span>
                            </span>
                          </div>

                          <div className={styles.activeTuraGrid}>
                            <div className={styles.activeTuraField}>
                              <span className={styles.activeTuraLabel}>Količina ture:</span>
                              <strong className={styles.activeTuraVal}>
                                {formatKgAndTons(activeTura.weightKg)}
                                {activeTura.packageCount > 0 && ` (${activeTura.packageCount.toLocaleString('sr-RS')} kom)`}
                              </strong>
                            </div>

                            {activeTura.buyerName && (
                              <div className={styles.activeTuraField}>
                                <span className={styles.activeTuraLabel}>Kupac:</span>
                                <strong className={styles.activeTuraVal}>{activeTura.buyerName}</strong>
                              </div>
                            )}

                            {activeTura.dispatchNumber && (
                              <div className={styles.activeTuraField}>
                                <span className={styles.activeTuraLabel}>Otpremnica:</span>
                                <span className={styles.activeTuraDispatchBadge}>
                                  <FileText size={12} />
                                  <strong>{activeTura.dispatchNumber}</strong>
                                </span>
                              </div>
                            )}

                            <div className={styles.activeTuraField}>
                              <span className={styles.activeTuraLabel}>Datum i vreme:</span>
                              <span className={styles.activeTuraVal}>
                                {formatDateOnly(activeTura.date)} {formatTimeOnly(activeTura.createdAt, activeTura.date)} h
                              </span>
                            </div>

                            <div className={styles.activeTuraField}>
                              <span className={styles.activeTuraLabel}>Zaduženo lice:</span>
                              <span className={styles.activeTuraVal}>
                                <UserCheck size={13} color="#0284c7" style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                <strong>{activeTura.supervisor || 'Andrija Direktor'}</strong>
                              </span>
                            </div>

                            {(activeTura.vehicleReg || activeTura.driverName) && (
                              <div className={styles.activeTuraField}>
                                <span className={styles.activeTuraLabel}>Prevoz / Vozilo:</span>
                                <span className={styles.activeTuraVal}>
                                  {[activeTura.vehicleReg, activeTura.driverName].filter(Boolean).join(' • ')}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 1. Poreklo i Odgovorno Lice */}
                      <div className={styles.traceSection}>
                        <div className={styles.traceSectionTitle}>
                          <Sprout size={14} color="#16a34a" />
                          <span>Poreklo i Nadzor</span>
                        </div>
                        <div className={styles.traceInfoGrid}>
                          <div className={styles.traceInfoItem}>
                            <span className={styles.traceInfoLabel}>Parcela porekla:</span>
                            <span className={styles.traceInfoVal}>
                              <strong>{traceData.lot.parcel?.code}</strong> — {traceData.lot.parcel?.name}
                              {traceData.lot.parcel?.areaHa && (
                                <span className={styles.traceAreaBadge}>{traceData.lot.parcel.areaHa} ha</span>
                              )}
                            </span>
                          </div>
                          <div className={styles.traceInfoItem}>
                            <span className={styles.traceInfoLabel}>Sorta / Hibrid:</span>
                            <span className={styles.traceInfoVal}>{traceData.lot.cropVariety || 'Žuti holandski'}</span>
                          </div>
                          <div className={styles.traceInfoItem}>
                            <span className={styles.traceInfoLabel}>Zaduženo lice:</span>
                            <span className={styles.traceInfoVal}>
                              <UserCheck size={13} color="#0284c7" style={{ verticalAlign: 'middle', marginRight: 4 }} />
                              <strong>Bojan Ćorović</strong>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 2. Hero Karta: Ukupan Ulaz sa Njive */}
                      <div className={styles.traceHeroCard}>
                        <div className={styles.traceHeroHeader}>
                          <Tractor size={15} color="#16a34a" />
                          <span>Ukupno dovezeno sa njive</span>
                        </div>
                        <div className={styles.traceHeroValue}>
                          {formatKgAndTons(traceData.lot.initialQuantityKg)}
                        </div>
                      </div>

                      {/* 3. Bilans i Stanje po Fazama */}
                      <div className={styles.traceBalanceList}>
                        <div className={styles.traceBalanceItem}>
                          <div className={styles.traceBalanceLeft}>
                            <div className={`${styles.traceIconWrap} ${styles.iconColdStorage}`}>
                              <Snowflake size={15} />
                            </div>
                            <div>
                              <div className={styles.traceBalanceLabel}>U hladnjači (Sirovo)</div>
                              <div className={styles.traceBalanceSub}>Komore 1–6 (boksovi)</div>
                            </div>
                          </div>
                          <div className={styles.traceBalanceRight}>
                            <span className={styles.traceValColdStorage}>{formatKgAndTons(traceData.lot.rawStockKg)}</span>
                          </div>
                        </div>

                        <div className={styles.traceBalanceItem}>
                          <div className={styles.traceBalanceLeft}>
                            <div className={`${styles.traceIconWrap} ${styles.iconSorted}`}>
                              <Scale size={15} />
                            </div>
                            <div>
                              <div className={styles.traceBalanceLabel}>Sortirano I klasa</div>
                              <div className={styles.traceBalanceSub}>Pripremljeno za pakericu</div>
                            </div>
                          </div>
                          <div className={styles.traceBalanceRight}>
                            <span className={styles.traceValSorted}>{formatKgAndTons(traceData.lot.sortedQualityKg)}</span>
                          </div>
                        </div>

                        <div className={styles.traceBalanceItem}>
                          <div className={styles.traceBalanceLeft}>
                            <div className={`${styles.traceIconWrap} ${styles.iconPackaged}`}>
                              <Package size={15} />
                            </div>
                            <div>
                              <div className={styles.traceBalanceLabel}>Spakovano na stanju</div>
                              <div className={styles.traceBalanceSub}>Džakovi 10kg & 5kg</div>
                            </div>
                          </div>
                          <div className={styles.traceBalanceRight}>
                            <span className={styles.traceValPackaged}>{formatKgAndTons(traceData.lot.packagedStockKg)}</span>
                          </div>
                        </div>

                        <div className={styles.traceBalanceItem}>
                          <div className={styles.traceBalanceLeft}>
                            <div className={`${styles.traceIconWrap} ${styles.iconShipped}`}>
                              <Truck size={15} />
                            </div>
                            <div>
                              <div className={styles.traceBalanceLabel}>Isporučeno kupcima</div>
                              <div className={styles.traceBalanceSub}>Po zvaničnim otpremnicama</div>
                            </div>
                          </div>
                          <div className={styles.traceBalanceRight}>
                            <span className={styles.traceValShipped}>{formatKgAndTons(traceData.lot.shippedKg)}</span>
                          </div>
                        </div>

                        <div className={styles.traceBalanceItem}>
                          <div className={styles.traceBalanceLeft}>
                            <div className={`${styles.traceIconWrap} ${styles.iconWaste}`}>
                              <AlertTriangle size={15} />
                            </div>
                            <div>
                              <div className={styles.traceBalanceLabel}>Ukupan otpis i kalo</div>
                              <div className={styles.traceBalanceSub}>Prirodno sušenje, škart, trulež</div>
                            </div>
                          </div>
                          <div className={styles.traceBalanceRight}>
                            <span className={styles.traceValWaste}>{formatKgAndTons(traceData.lot.totalWasteKg)}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* DESNA STRANA: HRONOLOŠKI TOK PARTIJE */}
                    <div>
                      <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.98rem', color: 'var(--text-primary)' }}>
                        {activeTura
                          ? `Hronološki tok za Turu ${activeTura.index}`
                          : `Hronološki tok celog LOTa - sve ture`}
                      </h4>

                      <div className={styles.timelineList}>
                        {filteredTimeline.map((ev: any) => {
                          // Oznaka ture u celokupnom pogledu (Tura: 1, Tura: 2, ...)
                          const eventTura = (!activeTura && selectedTuraId === 'ALL')
                            ? (ev.stage === 'ISPORUKA_KUPAC' || ev.id?.startsWith('shipment-'))
                              ? turas.find((t: any) => t.shipmentId === ev.id.replace('shipment-', ''))
                              : (ev.stage === 'PAKOVANJE' || ev.id?.startsWith('packaging-'))
                                ? turas.find(
                                  (t: any) =>
                                    t.packagingId === ev.id.replace('packaging-', '') ||
                                    (t.packagingDetails && t.packagingDetails.some((p: any) => p.packagingId === ev.id.replace('packaging-', '')))
                                )
                                : null
                            : null;

                          return (
                            <div
                              key={ev.id}
                              className={styles.timelineItem}
                            >
                              <div className={styles.timelineDot}>
                                <CheckCircle2 size={14} />
                              </div>

                              <div className={styles.timelineHeaderRow}>
                                <div className={styles.timelineTitleBlock}>
                                  <span className={styles.timelineStageBadge}>
                                    {ev.stage || 'KORAK'}
                                  </span>
                                  <strong className={styles.timelineTitle}>
                                    {ev.title}
                                  </strong>
                                  {eventTura && (
                                    <span className={styles.activeTuraBadgeTag}>
                                      Tura: {eventTura.index}
                                    </span>
                                  )}
                                </div>

                                <div className={styles.timelineDateTimeBox}>
                                  <div className={styles.timelineDateRow}>
                                    <Calendar size={12} className={styles.timelineTimeIcon} />
                                    <span>{formatDateOnly(ev.date || ev.createdAt)}</span>
                                  </div>
                                  <div className={styles.timelineTimeRow}>
                                    <Clock size={12} className={styles.timelineTimeIcon} />
                                    <span className={styles.timelineExactTime}>
                                      {formatTimeOnly(ev.createdAt, ev.date)} h
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div className={styles.timelineQtyRow}>
                                <span className={styles.timelineQtyLabel}>Količina:</span>
                                <span>{formatKgAndTons(ev.quantityKg)}</span>
                              </div>

                              <div className={styles.timelineDetailsText}>
                                {ev.details}
                              </div>

                              {ev.notes && (
                                <div className={styles.timelineNotes}>
                                  <strong>Napomena:</strong> {ev.notes}
                                </div>
                              )}

                              {ev.supervisor && (
                                <div className={styles.timelineSupervisor}>
                                  <UserCheck size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                                  <span>Zaduženo lice: <strong>{ev.supervisor}</strong></span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 1: NOVI DOVOZ SA NJIVE (SA KALKULATOROM BOKS PALETA) */}
        {/* ============================================================ */}
        {isHarvestModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsHarvestModalOpen(false)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  <Tractor size={20} color="#16a34a" />
                  <span>Novi dovoz luka sa njive u hladnjaču</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => setIsHarvestModalOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateHarvest}>
                <div className={styles.modalBody}>
                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Datum dovoza *</label>
                      <input
                        type="date"
                        className={styles.input}
                        value={harvestForm.date}
                        onChange={(e) => setHarvestForm({ ...harvestForm, date: e.target.value })}
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <div className={styles.labelWithActionsRow}>
                        <label style={{ margin: 0 }}>Parcela sa koje stiže luk *</label>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          {selectedHarvestParcelObj?.areaHa && (
                            <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 800 }}>
                              Površina: {selectedHarvestParcelObj.areaHa} ha
                            </span>
                          )}
                          {isManager && (
                            <ParcelQuickActions
                              selectedParcel={selectedHarvestParcelObj || null}
                              onAddClick={() => {
                                setParcelQuickTarget('harvest-form');
                                setParcelToEdit(null);
                                setParcelQuickModalOpen(true);
                              }}
                              onEditClick={(parcel) => {
                                setParcelQuickTarget('harvest-form');
                                setParcelToEdit(parcel);
                                setParcelQuickModalOpen(true);
                              }}
                            />
                          )}
                        </div>
                      </div>
                      <CustomSelect
                        value={harvestForm.parcelId}
                        onChange={(val) => setHarvestForm({ ...harvestForm, parcelId: val })}
                        options={harvestParcelOptions}
                        placeholder="— Izaberi parcelu —"
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Broj boks paleta (1 boks = 1.100 kg)</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className={styles.input}
                        placeholder="npr. 20 boksova (= 22.000 kg)"
                        value={harvestForm.boxCount}
                        onChange={(e) => {
                          const b = e.target.value;
                          const kgCalc = Number(b || 0) * 1100;
                          setHarvestForm({
                            ...harvestForm,
                            boxCount: b,
                            quantityKg: kgCalc > 0 ? String(kgCalc) : harvestForm.quantityKg,
                          });
                        }}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Ukupna količina ture u kg *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className={styles.input}
                        placeholder="npr. 22000"
                        value={harvestForm.quantityKg}
                        onChange={(e) => {
                          const kg = e.target.value;
                          const bCalc = Math.round(Number(kg || 0) / 1100);
                          setHarvestForm({
                            ...harvestForm,
                            quantityKg: kg,
                            boxCount: bCalc > 0 ? String(bCalc) : '',
                          });
                        }}
                        required
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Vozilo / Traktor / Kamion</label>
                      <CustomSelect
                        value={harvestForm.vehicleId}
                        onChange={(val) => setHarvestForm({ ...harvestForm, vehicleId: val })}
                        options={vehicleOptions}
                        placeholder="— Izaberi vozilo (opciono) —"
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Vozač / Odgovorno lice</label>
                      <CustomSelect
                        value={harvestForm.driverId}
                        onChange={(val) => setHarvestForm({ ...harvestForm, driverId: val })}
                        options={workerOptions}
                        placeholder="— Izaberi radnika (opciono) —"
                      />
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '10px',
                      padding: '0.85rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.75rem',
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={harvestForm.autoStore}
                        onChange={(e) =>
                          setHarvestForm({ ...harvestForm, autoStore: e.target.checked })
                        }
                      />
                      <span>Odmah uskladišti u komoru hladnjače (Komore 1–6)</span>
                    </label>

                    {harvestForm.autoStore && (
                      <div className={styles.formGroup}>
                        <label>Komora hladnjače *</label>
                        <CustomSelect
                          value={harvestForm.locationOrChamber}
                          onChange={(ch) => {
                            const isWithEq =
                              ch === 'Komora 1' || ch === 'Komora 2' || ch === 'Komora 3';
                            setHarvestForm({
                              ...harvestForm,
                              locationOrChamber: ch,
                              hasEquipment: isWithEq,
                            });
                          }}
                          options={chamberOptions}
                          placeholder="— Izaberi komoru hladnjače —"
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setIsHarvestModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.btnPrimary} disabled={submitting}>
                    <CheckCircle2 size={16} />
                    <span>{submitting ? 'Čuvanje...' : 'Sačuvaj dovoz i generiši LOT'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 2: UNOS U KOMORU HLADNJAČE */}
        {/* ============================================================ */}
        {isStorageModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsStorageModalOpen(false)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  <Snowflake size={20} color="#0891b2" />
                  <span>Unos boks paleta u komoru hladnjače (Komore 1–6)</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => setIsStorageModalOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateStorage}>
                <div className={styles.modalBody}>
                  <div className={styles.formGroup}>
                    <label>Izaberi LOT partiju *</label>
                    <CustomSelect
                      value={storageForm.lotId}
                      onChange={(val) => setStorageForm({ ...storageForm, lotId: val })}
                      options={storageLotOptions}
                      placeholder="— Izaberi LOT partiju —"
                    />
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Komora hladnjače (720 boksova max) *</label>
                      <CustomSelect
                        value={storageForm.locationOrChamber}
                        onChange={(ch) => {
                          const isWithEq =
                            ch === 'Komora 1' || ch === 'Komora 2' || ch === 'Komora 3';
                          setStorageForm({
                            ...storageForm,
                            locationOrChamber: ch,
                            hasEquipment: isWithEq,
                          });
                        }}
                        options={chamberOptions}
                        placeholder="— Izaberi komoru —"
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Broj boks paleta (160x120x120, 1.100 kg)</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className={styles.input}
                        placeholder="npr. 50 boksova"
                        value={storageForm.boxCount}
                        onChange={(e) => {
                          const b = e.target.value;
                          const kgCalc = Number(b || 0) * 1100;
                          setStorageForm({
                            ...storageForm,
                            boxCount: b,
                            quantityKg: kgCalc > 0 ? String(kgCalc) : storageForm.quantityKg,
                          });
                        }}
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Količina za uskladištenje (kg) *</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      className={styles.input}
                      value={storageForm.quantityKg}
                      onChange={(e) =>
                        setStorageForm({ ...storageForm, quantityKg: e.target.value })
                      }
                      required
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setIsStorageModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.btnBlue} disabled={submitting}>
                    <CheckCircle2 size={16} />
                    <span>{submitting ? 'Čuvanje...' : 'Sačuvaj ulaz u komoru'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* EDIT MODAL: IZMENA KOMORE / BOKS PALETA */}
        {/* ============================================================ */}
        {editingStorage && (
          <div className={styles.modalOverlay} onClick={() => setEditingStorage(null)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  <Pencil size={20} color="#0891b2" />
                  <span>Izmena podataka komore ({editingStorage.locationOrChamber})</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => setEditingStorage(null)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleUpdateStorage}>
                <div className={styles.modalBody}>
                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Komora hladnjače</label>
                      <CustomSelect
                        value={editingStorage.locationOrChamber}
                        onChange={(val) =>
                          setEditingStorage({
                            ...editingStorage,
                            locationOrChamber: val,
                          })
                        }
                        options={editChamberOptions}
                        searchable={false}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Tip komore</label>
                      <CustomSelect
                        value={editingStorage.hasEquipment ? 'true' : 'false'}
                        onChange={(val) =>
                          setEditingStorage({
                            ...editingStorage,
                            hasEquipment: val === 'true',
                          })
                        }
                        options={editStorageEquipmentOptions}
                        searchable={false}
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Broj boks paleta (max 720, 1 boks = 1.100 kg)</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        className={styles.input}
                        value={editingStorage.boxCount || ''}
                        onChange={(e) => {
                          const b = Number(e.target.value || 0);
                          setEditingStorage({
                            ...editingStorage,
                            boxCount: e.target.value,
                            currentQuantityKg: b > 0 ? b * 1100 : editingStorage.currentQuantityKg,
                          });
                        }}
                      />
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                        Automatski proračun: 1 boks = 1.100 kg luka
                      </div>
                    </div>

                    <div className={styles.formGroup}>
                      <label>Trenutna količina u komori (kg)</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        className={styles.input}
                        value={editingStorage.currentQuantityKg}
                        onChange={(e) =>
                          setEditingStorage({
                            ...editingStorage,
                            currentQuantityKg: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setEditingStorage(null)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.btnBlue} disabled={submitting}>
                    <CheckCircle2 size={16} />
                    <span>{submitting ? 'Čuvanje...' : 'Sačuvaj izmene komore'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 3: SORTIRANJE & KALIBRACIJA */}
        {/* ============================================================ */}
        {isSortingModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsSortingModalOpen(false)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  <Scale size={20} color="#0284c7" />
                  <span>Evidencija sortiranja i kalibracije luka</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => setIsSortingModalOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateSorting}>
                <div className={styles.modalBody}>
                  <div className={styles.formGroup}>
                    <label>LOT koji se sortira *</label>
                    <CustomSelect
                      value={sortingForm.lotId}
                      onChange={(val) => setSortingForm({ ...sortingForm, lotId: val })}
                      options={sortingLotOptions}
                      placeholder="— Izaberi LOT sa sirovim lukom —"
                    />
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Datum sortiranja *</label>
                      <input
                        type="date"
                        className={styles.input}
                        value={sortingForm.date}
                        onChange={(e) => setSortingForm({ ...sortingForm, date: e.target.value })}
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Ulazna masa ubačena na liniju (kg) *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className={styles.input}
                        placeholder="npr. 10000"
                        value={sortingForm.inputQuantityKg}
                        onChange={(e) => {
                          const inputVal = e.target.value;
                          const numIn = Number(inputVal || 0);
                          const small = Number(sortingForm.smallQuantityKg || 0);
                          const waste = Number(sortingForm.wasteQuantityKg || 0);
                          const autoQuality = Math.max(0, numIn - small - waste);
                          setSortingForm({
                            ...sortingForm,
                            inputQuantityKg: inputVal,
                            qualityQuantityKg: numIn > 0 ? String(autoQuality) : '',
                          });
                        }}
                        required
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid3}>
                    <div className={styles.formGroup}>
                      <label>I Klasa — Kvalitetan (kg) *</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        className={styles.input}
                        value={sortingForm.qualityQuantityKg}
                        onChange={(e) =>
                          setSortingForm({ ...sortingForm, qualityQuantityKg: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>II Klasa — Sitan luk (kg)</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        className={styles.input}
                        value={sortingForm.smallQuantityKg}
                        onChange={(e) => {
                          const smallVal = e.target.value;
                          const numIn = Number(sortingForm.inputQuantityKg || 0);
                          const quality = Number(sortingForm.qualityQuantityKg || 0);
                          const autoWaste = Math.max(0, numIn - quality - Number(smallVal || 0));
                          setSortingForm({
                            ...sortingForm,
                            smallQuantityKg: smallVal,
                            wasteQuantityKg: String(autoWaste),
                          });
                        }}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Otpad / Škart / Zemlja (kg)</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        className={styles.input}
                        value={sortingForm.wasteQuantityKg}
                        onChange={(e) =>
                          setSortingForm({ ...sortingForm, wasteQuantityKg: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setIsSortingModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.btnBlue} disabled={submitting}>
                    <CheckCircle2 size={16} />
                    <span>{submitting ? 'Čuvanje...' : 'Potvrdi sortiranje'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 4: PAKOVANJE NA PAKERICI (10KG / 5KG, BROJ PAKERA, BOJAN ĆOROVIĆ) */}
        {/* ============================================================ */}
        {isPackagingModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsPackagingModalOpen(false)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  <Package size={20} color="#d97706" />
                  <span>Pakovanje na pakerici (10 kg i 5 kg džakovi • 100 kom / paleti)</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => setIsPackagingModalOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreatePackaging}>
                <div className={styles.modalBody}>
                  <div className={styles.formGroup}>
                    <label>Izaberi LOT sa sortiranim lukom I klase *</label>
                    <CustomSelect
                      value={packagingForm.lotId}
                      onChange={(val) =>
                        setPackagingForm({ ...packagingForm, lotId: val })
                      }
                      options={packagingLotOptions}
                      placeholder="— Izaberi LOT sa I klasom —"
                    />
                  </div>

                  {selectedPackagingLotObj && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.55rem 0.85rem',
                        borderRadius: '8px',
                        backgroundColor: 'var(--bg-secondary)',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.82rem',
                        marginTop: '-0.35rem',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <span>
                        Parcela:{' '}
                        <strong>
                          {selectedPackagingLotObj.parcel?.code} — {selectedPackagingLotObj.parcel?.name}
                        </strong>{' '}
                        ({selectedPackagingLotObj.cropVariety || 'Žuti luk'})
                      </span>
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>
                        Raspoloživo I klasa: {formatKgAndTons(selectedPackagingLotObj.unpackedQualityKg)}
                      </span>
                    </div>
                  )}

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Tip džaka / pakovanja *</label>
                      <CustomSelect
                        value={packagingForm.packageType}
                        onChange={(t) => {
                          const unitW = PACKAGE_WEIGHTS[t] || 10;
                          const bagsPerPal = BAGS_PER_PALLET[t] || 100;
                          const curPallets = Number(packagingForm.palletsCount || 0);
                          setPackagingForm({
                            ...packagingForm,
                            packageType: t,
                            unitWeightKg: String(unitW),
                            packageCount:
                              curPallets > 0
                                ? String(Math.round(curPallets * bagsPerPal))
                                : packagingForm.packageCount,
                          });
                        }}
                        options={packageTypeOptions}
                        searchable={false}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Broj paleta (1 paleta = 100x10kg ili 200x5kg)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        className={styles.input}
                        placeholder="npr. 5 paleta (= 500 džakova od 10kg)"
                        value={packagingForm.palletsCount}
                        onChange={(e) => {
                          const pal = e.target.value;
                          const bagsPerPal =
                            BAGS_PER_PALLET[packagingForm.packageType] || 100;
                          const calcBags = Math.round(Number(pal || 0) * bagsPerPal);
                          setPackagingForm({
                            ...packagingForm,
                            palletsCount: pal,
                            packageCount: calcBags > 0 ? String(calcBags) : '',
                          });
                        }}
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Ukupan broj džakova (kom) *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className={styles.input}
                        placeholder="npr. 500"
                        value={packagingForm.packageCount}
                        onChange={(e) => {
                          const bags = e.target.value;
                          const bagsPerPal =
                            BAGS_PER_PALLET[packagingForm.packageType] || 100;
                          const calcPal = Number((Number(bags || 0) / bagsPerPal).toFixed(2));
                          setPackagingForm({
                            ...packagingForm,
                            packageCount: bags,
                            palletsCount: calcPal > 0 ? String(calcPal) : '',
                          });
                        }}
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Oznaka palete / lokacije</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="npr. PALETA-01..05"
                        value={packagingForm.palletNumber}
                        onChange={(e) =>
                          setPackagingForm({ ...packagingForm, palletNumber: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  {/* Pakerica (broj pakera - izmenljivo) i Bojan Ćorović */}
                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Broj pakera na pakerici (izmenljivo) *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="30"
                        className={styles.input}
                        value={packagingForm.packerCount}
                        onChange={(e) =>
                          setPackagingForm({ ...packagingForm, packerCount: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Zadužen za ulaz, izlaz i pakovanje *</label>
                      <input
                        type="text"
                        className={styles.input}
                        value={packagingForm.responsiblePerson}
                        onChange={(e) =>
                          setPackagingForm({ ...packagingForm, responsiblePerson: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>

                  <div className={styles.formGroup}>
                    <label>Napomena za pakericu (opciono)</label>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="npr. Druga smena, priprema za Maxi..."
                      value={packagingForm.packerNotes}
                      onChange={(e) =>
                        setPackagingForm({ ...packagingForm, packerNotes: e.target.value })
                      }
                    />
                  </div>

                  {Number(packagingForm.packageCount) > 0 && (
                    <div
                      style={{
                        padding: '0.75rem 1rem',
                        borderRadius: '9px',
                        backgroundColor: 'rgba(217, 119, 6, 0.1)',
                        color: '#d97706',
                        fontWeight: 700,
                        fontSize: '0.88rem',
                      }}
                    >
                      Bilans pakovanja: {packagingForm.packageCount} džakova po{' '}
                      {packagingForm.unitWeightKg} kg ={' '}
                      <strong>
                        {formatKgAndTons(
                          Number(packagingForm.packageCount) * Number(packagingForm.unitWeightKg)
                        )}
                      </strong>{' '}
                      ({packagingForm.palletsCount || (Number(packagingForm.packageCount) * Number(packagingForm.unitWeightKg)) / 1000}{' '}
                      paleta) • Pakerica: {packagingForm.packerCount} pakera
                    </div>
                  )}
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setIsPackagingModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.btnAmber} disabled={submitting}>
                    <CheckCircle2 size={16} />
                    <span>{submitting ? 'Čuvanje...' : 'Sačuvaj pakovanje na pakerici'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* EDIT MODAL: IZMENA PAKOVANJA I RADA PAKERICE (BROJ PAKERA, 10KG/5KG) */}
        {/* ============================================================ */}
        {editingPackaging && (
          <div className={styles.modalOverlay} onClick={() => setEditingPackaging(null)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  <Pencil size={20} color="#d97706" />
                  <span>Izmena pakovanja i broja pakera</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => setEditingPackaging(null)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleUpdatePackaging}>
                <div className={styles.modalBody}>
                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Tip džaka (10 kg ili 5 kg)</label>
                      <CustomSelect
                        value={editingPackaging.packageType}
                        onChange={(t) => {
                          setEditingPackaging({
                            ...editingPackaging,
                            packageType: t,
                            unitWeightKg: PACKAGE_WEIGHTS[t] || 10,
                          });
                        }}
                        options={packageTypeOptions}
                        searchable={false}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Ukupan broj džakova (kom)</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className={styles.input}
                        value={editingPackaging.packageCount}
                        onChange={(e) =>
                          setEditingPackaging({
                            ...editingPackaging,
                            packageCount: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Broj pakera na pakerici *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="30"
                        className={styles.input}
                        value={editingPackaging.packerCount}
                        onChange={(e) =>
                          setEditingPackaging({
                            ...editingPackaging,
                            packerCount: e.target.value,
                          })
                        }
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Zadužen za ulaz, izlaz i pakovanje *</label>
                      <input
                        type="text"
                        className={styles.input}
                        value={editingPackaging.responsiblePerson || 'Bojan Ćorović'}
                        onChange={(e) =>
                          setEditingPackaging({
                            ...editingPackaging,
                            responsiblePerson: e.target.value,
                          })
                        }
                        required
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Oznaka palete</label>
                      <input
                        type="text"
                        className={styles.input}
                        value={editingPackaging.palletNumber || ''}
                        onChange={(e) =>
                          setEditingPackaging({
                            ...editingPackaging,
                            palletNumber: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Napomena za pakericu</label>
                      <input
                        type="text"
                        className={styles.input}
                        value={editingPackaging.packerNotes || ''}
                        onChange={(e) =>
                          setEditingPackaging({
                            ...editingPackaging,
                            packerNotes: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setEditingPackaging(null)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.btnAmber} disabled={submitting}>
                    <CheckCircle2 size={16} />
                    <span>{submitting ? 'Čuvanje...' : 'Sačuvaj izmene pakerice'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 5: ISPORUKA KUPCU & OTPREMNICA */}
        {/* ============================================================ */}
        {isShipmentModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsShipmentModalOpen(false)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  <Truck size={20} color="#16a34a" />
                  <span>Nova isporuka kupcu i generisanje otpremnice</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => setIsShipmentModalOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateShipment}>
                <div className={styles.modalBody}>
                  <div className={styles.formGroup}>
                    <div className={styles.labelWithActionsRow}>
                      <label style={{ margin: 0 }}>Kupac (iz šifarnika partnera) *</label>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                        {selectedShipmentBuyerObj?.pib && (
                          <span style={{ fontSize: '0.75rem', color: '#0284c7', fontWeight: 800 }}>
                            PIB: {selectedShipmentBuyerObj.pib}
                          </span>
                        )}
                        {isManager && (
                          <BuyerQuickActions
                            selectedBuyer={selectedShipmentBuyerObj || null}
                            onAddClick={() => {
                              setBuyerQuickTarget('shipment-form');
                              setBuyerToEdit(null);
                              setBuyerQuickModalOpen(true);
                            }}
                            onEditClick={(buyer) => {
                              setBuyerQuickTarget('shipment-form');
                              setBuyerToEdit(buyer);
                              setBuyerQuickModalOpen(true);
                            }}
                          />
                        )}
                      </div>
                    </div>
                    <CustomSelect
                      value={shipmentForm.buyerId}
                      onChange={(val) =>
                        setShipmentForm({ ...shipmentForm, buyerId: val })
                      }
                      options={shipmentBuyerOptions}
                      placeholder="— Izaberi kupca —"
                    />
                  </div>

                  <div className={styles.formGroup}>
                    <label>Izaberi spakovanu partiju / paletu sa stanja *</label>
                    <CustomSelect
                      value={shipmentForm.packagingId}
                      onChange={(val) => {
                        const found = allAvailablePackagingsList.find((p: any) => p.id === val);
                        setShipmentForm((prev) => ({
                          ...prev,
                          packagingId: val,
                          packageCount: found?.availableCount ? String(found.availableCount) : prev.packageCount,
                        }));
                      }}
                      options={shipmentPackagingOptions}
                      placeholder="— Izaberi spakovani LOT (10kg ili 5kg) —"
                    />
                    {selectedShipmentPackagingObj && (
                      <div
                        style={{
                          marginTop: '0.55rem',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '8px',
                          backgroundColor: 'rgba(22, 163, 74, 0.08)',
                          border: '1px solid rgba(22, 163, 74, 0.25)',
                          fontSize: '0.82rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                            LOT: {selectedShipmentPackagingObj.lot?.lotNumber || 'N/A'} • {selectedShipmentPackagingObj.lot?.parcel ? `${selectedShipmentPackagingObj.lot.parcel.code} — ${selectedShipmentPackagingObj.lot.parcel.name}` : ''}
                          </span>
                          <span style={{ fontWeight: 800, color: '#16a34a' }}>
                            {PACKAGE_LABELS[selectedShipmentPackagingObj.packageType] || selectedShipmentPackagingObj.packageType}
                          </span>
                        </div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          Na stanju za isporuku:{' '}
                          <strong style={{ color: '#16a34a' }}>
                            {selectedShipmentPackagingObj.availableCount?.toLocaleString('sr-RS')} džakova
                          </strong>{' '}
                          ({formatKgAndTons(selectedShipmentPackagingObj.availableWeightKg)})
                        </div>
                      </div>
                    )}
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Broj džakova za isporuku (kom) *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className={styles.input}
                        placeholder="npr. 300 (3 palete po 100 džakova)"
                        value={shipmentForm.packageCount}
                        onChange={(e) =>
                          setShipmentForm({ ...shipmentForm, packageCount: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Prodajna cena po kg (RSD, opciono)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        className={styles.input}
                        placeholder="npr. 48"
                        value={shipmentForm.pricePerKg}
                        onChange={(e) =>
                          setShipmentForm({ ...shipmentForm, pricePerKg: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Registracija kamiona / vozila</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="npr. VS-051-CK"
                        value={shipmentForm.vehicleReg}
                        onChange={(e) =>
                          setShipmentForm({ ...shipmentForm, vehicleReg: e.target.value })
                        }
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Ime i prezime vozača</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="npr. Stefan / Bojan Ćorović"
                        value={shipmentForm.driverName}
                        onChange={(e) =>
                          setShipmentForm({ ...shipmentForm, driverName: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setIsShipmentModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.btnPrimary} disabled={submitting}>
                    <CheckCircle2 size={16} />
                    <span>
                      {submitting ? 'Kreiranje...' : 'Potvrdi isporuku i kreiraj otpremnicu'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 6: OTPIS & KALO */}
        {/* ============================================================ */}
        {isWasteModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsWasteModalOpen(false)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  <AlertTriangle size={20} color="#dc2626" />
                  <span>Evidentiraj otpis ili kalo u komori</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => setIsWasteModalOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleCreateWaste}>
                <div className={styles.modalBody}>
                  <div className={styles.formGroup}>
                    <label>Izaberi LOT *</label>
                    <CustomSelect
                      value={wasteForm.lotId}
                      onChange={(val) => setWasteForm({ ...wasteForm, lotId: val })}
                      options={wasteLotOptions}
                      placeholder="— Izaberi LOT —"
                    />
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Količina otpisa (kg) *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className={styles.input}
                        placeholder="npr. 250"
                        value={wasteForm.quantityKg}
                        onChange={(e) =>
                          setWasteForm({ ...wasteForm, quantityKg: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Razlog otpisa *</label>
                      <CustomSelect
                        value={wasteForm.reason}
                        onChange={(val) => setWasteForm({ ...wasteForm, reason: val })}
                        options={wasteReasonOptions}
                        searchable={false}
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Komora / Lokacija gde je uočen otpis</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="npr. Komora 1"
                        value={wasteForm.location}
                        onChange={(e) => setWasteForm({ ...wasteForm, location: e.target.value })}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Detaljan opis</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="npr. Redovna kontrola komore"
                        value={wasteForm.description}
                        onChange={(e) =>
                          setWasteForm({ ...wasteForm, description: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setIsWasteModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.btnDanger} disabled={submitting}>
                    <CheckCircle2 size={16} />
                    <span>{submitting ? 'Čuvanje...' : 'Potvrdi otpis'}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 7: KREIRANJE / IZMENA KOMORE & MAX KAPACITETA BOKSOVA */}
        {/* ============================================================ */}
        {isChamberModalOpen && (
          <div className={styles.modalOverlay} onClick={() => setIsChamberModalOpen(false)}>
            <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3>
                  {chamberModalForm.id ? (
                    <>
                      <Pencil size={20} color="#0891b2" />
                      <span>Izmena komore ({chamberModalForm.name})</span>
                    </>
                  ) : (
                    <>
                      <Plus size={20} color="#16a34a" />
                      <span>Dodavanje nove komore hladnjače</span>
                    </>
                  )}
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => setIsChamberModalOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>

              <form onSubmit={handleSaveChamber}>
                <div className={styles.modalBody}>
                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Naziv komore / lokacije *</label>
                      <input
                        type="text"
                        className={styles.input}
                        placeholder="npr. Komora 7 ili Nova Komora"
                        value={chamberModalForm.name}
                        onChange={(e) =>
                          setChamberModalForm({ ...chamberModalForm, name: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Tip skladišta</label>
                      <CustomSelect
                        value={chamberModalForm.storageType}
                        onChange={(val: any) =>
                          setChamberModalForm({ ...chamberModalForm, storageType: val })
                        }
                        options={[
                          { value: 'HLADNJACA', label: 'Hladnjača (sa kontrolom)' },
                          { value: 'MAGACIN', label: 'Podni Magacin (ambijentalno)' },
                        ]}
                        searchable={false}
                      />
                    </div>
                  </div>

                  <div className={styles.formGrid2}>
                    <div className={styles.formGroup}>
                      <label>Tehnička oprema komore</label>
                      <CustomSelect
                        value={chamberModalForm.hasEquipment ? 'true' : 'false'}
                        onChange={(val) =>
                          setChamberModalForm({
                            ...chamberModalForm,
                            hasEquipment: val === 'true',
                          })
                        }
                        options={[
                          { value: 'true', label: 'Komora sa opremom' },
                          { value: 'false', label: 'Komora bez opreme' },
                        ]}
                        searchable={false}
                      />
                    </div>

                    <div className={styles.formGroup}>
                      <label>Maksimalan broj boks paleta (kapacitet) *</label>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className={styles.input}
                        placeholder="npr. 720 (ili 500, 1000...)"
                        value={chamberModalForm.maxBoxes}
                        onChange={(e) =>
                          setChamberModalForm({ ...chamberModalForm, maxBoxes: e.target.value })
                        }
                        required
                      />
                      <div
                        style={{
                          fontSize: '0.74rem',
                          color: 'var(--text-muted)',
                          marginTop: '0.25rem',
                        }}
                      >
                        1 boks = 1.100 kg luka • Procenjen ukupan kapacitet:{' '}
                        <strong>
                          {formatKgAndTons(Number(chamberModalForm.maxBoxes || 0) * 1100)}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setIsChamberModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button
                    type="submit"
                    className={chamberModalForm.id ? styles.btnBlue : styles.btnPrimary}
                    disabled={submitting}
                  >
                    <CheckCircle2 size={16} />
                    <span>
                      {submitting
                        ? 'Čuvanje...'
                        : chamberModalForm.id
                          ? 'Sačuvaj izmene komore'
                          : 'Kreiraj novu komoru'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 8: POTVRDA BRISANJA KOMORE */}
        {/* ============================================================ */}
        {chamberToDelete && (
          <div
            className={styles.modalOverlay}
            onClick={() => {
              setChamberToDelete(null);
              setDeleteChamberError(null);
            }}
          >
            <div
              className={styles.modalCard}
              style={{ maxWidth: '520px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <h3 style={{ color: '#dc2626' }}>
                  <AlertTriangle size={20} color="#dc2626" />
                  <span>Potvrda brisanja komore</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => {
                    setChamberToDelete(null);
                    setDeleteChamberError(null);
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              <div className={styles.modalBody}>
                <p style={{ fontSize: '0.95rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
                  Da li ste sigurni da želite da obrišete komoru{' '}
                  <strong>"{chamberToDelete.locationOrChamber || chamberToDelete.name}"</strong>?
                </p>

                <div className={styles.chamberDeleteInfoCard}>
                  <div className={styles.chamberDeleteInfoRow}>
                    <span>Tip skladišta:</span>
                    <strong>
                      {chamberToDelete.storageType === 'HLADNJACA' ? 'Hladnjača' : 'Podni Magacin'}
                    </strong>
                  </div>
                  <div className={styles.chamberDeleteInfoRow}>
                    <span>Oprema komore:</span>
                    <span
                      className={styles.badgeStatus}
                      style={{
                        background: chamberToDelete.hasEquipment
                          ? 'rgba(8, 145, 178, 0.14)'
                          : 'rgba(217, 119, 6, 0.14)',
                        color: chamberToDelete.hasEquipment ? '#0891b2' : '#d97706',
                      }}
                    >
                      {chamberToDelete.hasEquipment ? 'Sa opremom' : 'Bez opreme'}
                    </span>
                  </div>
                  <div className={styles.chamberDeleteInfoRow}>
                    <span>Kapacitet:</span>
                    <strong>
                      {chamberToDelete.maxBoxes || 720} boksova (
                      {formatKgAndTons((chamberToDelete.maxBoxes || 720) * 1100)})
                    </strong>
                  </div>
                  <div className={styles.chamberDeleteInfoRow}>
                    <span>Trenutno stanje luka:</span>
                    <strong
                      style={{
                        color: (chamberToDelete.currentQuantityKg || 0) > 0 ? '#dc2626' : '#16a34a',
                      }}
                    >
                      {formatKgAndTons(chamberToDelete.currentQuantityKg || 0)}
                    </strong>
                  </div>
                </div>

                {deleteChamberError && (
                  <div className={styles.modalAlertDanger}>
                    <AlertCircle size={22} className={styles.modalAlertDangerIcon} />
                    <div className={styles.modalAlertContent}>
                      <div className={styles.modalAlertTitle}>Nije moguće obrisati komoru</div>
                      <div className={styles.modalAlertText}>{deleteChamberError}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => {
                    setChamberToDelete(null);
                    setDeleteChamberError(null);
                  }}
                >
                  {deleteChamberError ? 'Zatvori' : 'Odustani'}
                </button>
                <button
                  type="button"
                  className={styles.btnDangerSolid}
                  disabled={isDeletingChamber}
                  onClick={handleConfirmDeleteChamber}
                >
                  <Trash2 size={16} />
                  <span>{isDeletingChamber ? 'Brisanje...' : 'Potvrdi brisanje'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 8B: POTVRDA BRISANJA PAKOVANJA SA PAKERICE */}
        {/* ============================================================ */}
        {packagingToDelete && (
          <div
            className={styles.modalOverlay}
            onClick={() => {
              setPackagingToDelete(null);
              setDeletePackagingError(null);
            }}
          >
            <div
              className={styles.modalCard}
              style={{ maxWidth: '560px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.modalHeader}>
                <h3 style={{ color: '#dc2626' }}>
                  <AlertTriangle size={20} color="#dc2626" />
                  <span>Potvrda brisanja pakovanja</span>
                </h3>
                <button
                  type="button"
                  className={styles.btnIconSmall}
                  onClick={() => {
                    setPackagingToDelete(null);
                    setDeletePackagingError(null);
                  }}
                >
                  <X size={16} />
                </button>
              </div>

              <div className={styles.modalBody}>
                <p style={{ fontSize: '0.95rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
                  Da li ste sigurni da želite da obrišete ovo pakovanje za partiju{' '}
                  <strong>"{packagingToDelete.lot?.lotNumber}"</strong>?
                </p>

                {/* Pregled partije za brisanje */}
                <div className={styles.chamberDeleteInfoCard}>
                  <div className={styles.chamberDeleteInfoRow}>
                    <span>Parcela porekla:</span>
                    <strong>
                      {packagingToDelete.lot?.parcel
                        ? `${packagingToDelete.lot.parcel.code} — ${packagingToDelete.lot.parcel.name}`
                        : '-'}
                    </strong>
                  </div>
                  <div className={styles.chamberDeleteInfoRow}>
                    <span>Tip ambalaže:</span>
                    <strong style={{ color: '#d97706' }}>
                      {PACKAGE_LABELS[packagingToDelete.packageType] || packagingToDelete.packageType}
                    </strong>
                  </div>
                  <div className={styles.chamberDeleteInfoRow}>
                    <span>Količina u pakovanju:</span>
                    <strong>
                      {packagingToDelete.packageCount?.toLocaleString('sr-RS')} džakova (
                      {packagingToDelete.palletsCount || (packagingToDelete.totalWeightKg / 1000).toFixed(1)} paleta •{' '}
                      {formatKgAndTons(packagingToDelete.totalWeightKg)})
                    </strong>
                  </div>
                  <div className={styles.chamberDeleteInfoRow}>
                    <span>Preostalo na stanju:</span>
                    <strong
                      style={{
                        color: packagingToDelete.availableCount > 0 ? '#16a34a' : '#64748b',
                      }}
                    >
                      {packagingToDelete.availableCount?.toLocaleString('sr-RS')} džakova (
                      {formatKgAndTons(packagingToDelete.availableWeightKg)})
                    </strong>
                  </div>
                  <div className={styles.chamberDeleteInfoRow}>
                    <span>Zaduženo lice:</span>
                    <span>{packagingToDelete.responsiblePerson || 'Bojan Ćorović'}</span>
                  </div>
                </div>

                {/* Upozorenje o posledicama u bazi i skladištu */}
                <div
                  style={{
                    backgroundColor: 'rgba(2, 132, 199, 0.08)',
                    border: '1px solid rgba(2, 132, 199, 0.3)',
                    borderRadius: '10px',
                    padding: '0.85rem 1rem',
                    fontSize: '0.84rem',
                    color: 'var(--text-primary)',
                    lineHeight: 1.5,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      color: '#0284c7',
                      marginBottom: '0.35rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <AlertCircle size={16} />
                    <span>Šta će se promeniti u sistemu nakon brisanja:</span>
                  </div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: '1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.25rem',
                    }}
                  >
                    <li>
                      <strong>Vraćanje u I klasu:</strong> Celokupna masa od{' '}
                      <span style={{ color: '#16a34a', fontWeight: 700 }}>
                        {formatKgAndTons(packagingToDelete.totalWeightKg)}
                      </span>{' '}
                      se automatski vraća u nespakovanu I klasu partije{' '}
                      <code>{packagingToDelete.lot?.lotNumber}</code> i ponovo postaje raspoloživa za
                      pakovanje.
                    </li>
                    <li>
                      <strong>Smanjenje zaliha:</strong> Sa stanja gotovih proizvoda briše se{' '}
                      <strong>{packagingToDelete.packageCount} džakova</strong> (
                      {packagingToDelete.palletsCount || (packagingToDelete.totalWeightKg / 1000).toFixed(1)}{' '}
                      paleta).
                    </li>
                    <li>
                      <strong>Evidencija:</strong> Ovaj zapis rada pakerice se trajno uklanja iz
                      evidencije.
                    </li>
                  </ul>
                </div>

                {/* Provera ako je već realizovana isporuka */}
                {packagingToDelete.availableCount < packagingToDelete.packageCount && (
                  <div className={styles.modalAlertDanger}>
                    <AlertCircle size={22} className={styles.modalAlertDangerIcon} />
                    <div className={styles.modalAlertContent}>
                      <div className={styles.modalAlertTitle}>Nije moguće obrisati pakovanje</div>
                      <div className={styles.modalAlertText}>
                        Sa ovog pakovanja je već isporučeno{' '}
                        <strong>
                          {packagingToDelete.packageCount - packagingToDelete.availableCount} džakova
                        </strong>{' '}
                        kupcima preko otpremnice. Pre brisanja ovog pakovanja morate stornirati ili
                        obrisati povezane otpremnice u tabu "Isporuka".
                      </div>
                    </div>
                  </div>
                )}

                {deletePackagingError && (
                  <div className={styles.modalAlertDanger}>
                    <AlertCircle size={22} className={styles.modalAlertDangerIcon} />
                    <div className={styles.modalAlertContent}>
                      <div className={styles.modalAlertTitle}>Greška pri brisanju</div>
                      <div className={styles.modalAlertText}>{deletePackagingError}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => {
                    setPackagingToDelete(null);
                    setDeletePackagingError(null);
                  }}
                >
                  Odustani
                </button>
                <button
                  type="button"
                  className={styles.btnDangerSolid}
                  disabled={
                    isDeletingPackaging ||
                    packagingToDelete.availableCount < packagingToDelete.packageCount
                  }
                  onClick={handleConfirmDeletePackaging}
                >
                  <Trash2 size={16} />
                  <span>
                    {isDeletingPackaging ? 'Brisanje...' : 'Potvrdi brisanje i vrati luk u I klasu'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* MODAL 9: BRZO DODAVANJE / IZMENA PARCELE (ŠIFARNIK) */}
        {/* ============================================================ */}
        <ParcelQuickModal
          isOpen={parcelQuickModalOpen}
          onClose={() => setParcelQuickModalOpen(false)}
          parcelToEdit={parcelToEdit}
          onSaved={(savedParcel, mode) => {
            queryClient.invalidateQueries({ queryKey: ['onion-lookup'] });
            queryClient.invalidateQueries({ queryKey: ['onion-dashboard'] });
            queryClient.invalidateQueries({ queryKey: ['onion-lots'] });
            queryClient.invalidateQueries({ queryKey: ['onion-harvest'] });
            queryClient.invalidateQueries({ queryKey: ['onion-traceability'] });

            if (parcelQuickTarget === 'harvest-form') {
              setHarvestForm((prev) => ({ ...prev, parcelId: savedParcel.id }));
            } else if (parcelQuickTarget === 'harvest-filter') {
              setHarvestParcelFilter(savedParcel.id);
            }
            showToast(
              mode === 'create'
                ? `Parcela "${savedParcel.code} — ${savedParcel.name}" uspešno dodata.`
                : `Parcela "${savedParcel.code} — ${savedParcel.name}" uspešno izmenjena.`,
              'success'
            );
          }}
        />

        {/* ============================================================ */}
        {/* MODAL 10: BRZO DODAVANJE / IZMENA KUPCA (ŠIFARNIK PARTNERA) */}
        {/* ============================================================ */}
        <BuyerQuickModal
          isOpen={buyerQuickModalOpen}
          onClose={() => setBuyerQuickModalOpen(false)}
          buyerToEdit={buyerToEdit}
          onSaved={(savedBuyer, mode) => {
            queryClient.invalidateQueries({ queryKey: ['onion-lookup'] });
            queryClient.invalidateQueries({ queryKey: ['onion-dashboard'] });
            queryClient.invalidateQueries({ queryKey: ['onion-shipment'] });
            queryClient.invalidateQueries({ queryKey: ['onion-traceability'] });
            queryClient.invalidateQueries({ queryKey: ['partners'] });

            if (buyerQuickTarget === 'shipment-form') {
              setShipmentForm((prev) => ({ ...prev, buyerId: savedBuyer.id }));
            } else if (buyerQuickTarget === 'shipment-filter') {
              setShipmentBuyerFilter(savedBuyer.id);
            }
            showToast(
              mode === 'create'
                ? `Kupac "${savedBuyer.name}" uspešno dodat.`
                : `Podaci o kupcu "${savedBuyer.name}" uspešno izmenjeni.`,
              'success'
            );
          }}
        />

        {/* Toast Notifikacija */}
        {toast && (
          <div
            className={`${styles.toast} ${toast.type === 'error' ? styles.toastError : styles.toastSuccess
              }`}
          >
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{toast.text}</span>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default OnionDashboard;
