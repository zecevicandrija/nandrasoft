import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Truck,
  Sprout,
  AlertTriangle,
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  Pencil,
  Trash2,
  Lock,
  CheckCircle2,
  AlertCircle,
  MapPin,
  Search,
  X,
  Loader2,
  Calculator,
  Warehouse,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import { useSession } from '../lib/auth-client';
import styles from './FertilizerDashboard.module.css';

const API = '/api';

type FertilizerType =
  | 'MINERALNO_GRANULISANO'
  | 'VODOTOPIVO_FERTIRIGACIJA'
  | 'TECNI_BIOSTIMULATOR'
  | 'ORGANSKO_PELETIRANO';

type FertilizerUnit = 'KG' | 'L' | 'TONA';

type StockMovementType =
  | 'PRIJEM_NABAVKA'
  | 'IZDAVANJE_NJIVA'
  | 'POVRAT_SA_NJIVE'
  | 'OTPIS_KOREKCIJA';

interface FertilizerProduct {
  id: string;
  name: string;
  type: FertilizerType;
  unit: FertilizerUnit;
  currentStock: number;
  minStockWarning: number;
  defaultPricePerUnit?: number | null;
  defaultLocation?: string | null;
  description?: string | null;
  isActive: boolean;
  isBelowMin?: boolean;
  fillPercentage?: number;
  stockValueRSD?: number;
}

interface FertilizerMovement {
  id: string;
  date: string;
  movementType: StockMovementType;
  productId: string;
  product: {
    id: string;
    name: string;
    type: FertilizerType;
    unit: FertilizerUnit;
  };
  quantity: number;
  unitPrice?: number | null;
  totalCost?: number | null;
  supplierId?: string | null;
  supplier?: { id: string; name: string; pib?: string | null } | null;
  receiptNumber?: string | null;
  warehouseLocation?: string | null;
  parcelId?: string | null;
  parcel?: {
    id: string;
    code: string;
    name: string;
    areaHa: number;
    currentCrop?: string | null;
  } | null;
  cropName?: string | null;
  areaHa?: number | null;
  kgPerHa?: number | null;
  issuedBy?: { id: string; name: string; role: string } | null;
  receivedWorker?: { id: string; name: string; type: string } | null;
  notes?: string | null;
  canEdit?: boolean;
  isToday?: boolean;
}

interface ParcelSummaryItem {
  parcelId: string;
  parcelCode: string;
  parcelName: string;
  areaHa: number;
  currentCrop: string;
  totalKgApplied: number;
  avgKgPerHa: number;
  applicationsCount: number;
  lastAppliedAt: string;
  totalCostRSD?: number;
  costPerHaRSD?: number;
  products: Array<{
    productId: string;
    productName: string;
    type: FertilizerType;
    unit: FertilizerUnit;
    totalQuantity: number;
    totalKg: number;
  }>;
}

const TYPE_LABELS: Record<FertilizerType, string> = {
  MINERALNO_GRANULISANO: 'Mineralno granulisano',
  VODOTOPIVO_FERTIRIGACIJA: 'Vodotopivo / Fertirigacija',
  TECNI_BIOSTIMULATOR: 'Tečni biostimulator',
  ORGANSKO_PELETIRANO: 'Organsko / Peletirano',
};

const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  PRIJEM_NABAVKA: 'Prijem u magacin',
  IZDAVANJE_NJIVA: 'Izdavanje na njivu',
  POVRAT_SA_NJIVE: 'Povrat sa njive',
  OTPIS_KOREKCIJA: 'Otpis / Korekcija',
};

const FertilizerDashboard: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const currentUser = (session as any)?.user;
  const userRole = currentUser?.role || 'MAGACIN';
  const isManager = ['DIREKTOR', 'RUKOVODILAC'].includes(userRole);

  // Aktivni tab
  const [activeTab, setActiveTab] = useState<'stock' | 'receive' | 'issue' | 'analytics'>('stock');

  // Filteri na tabu Stanje Zaliha
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  // Filteri na tabu Istorijat & Analitika
  const [histProductId, setHistProductId] = useState('');
  const [histParcelId, setHistParcelId] = useState('');
  const [histMovementType, setHistMovementType] = useState('');
  const [histDateFrom, setHistDateFrom] = useState('');
  const [histDateTo, setHistDateTo] = useState('');

  // Toast poruka
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 4000);
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  // 1. Dohvatanje artikala đubriva i KPI statistike
  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: ['fertilizer-products'],
    queryFn: async () => {
      const res = await fetch(`${API}/fertilizer/products`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju zaliha đubriva.');
      return res.json();
    },
  });

  const products: FertilizerProduct[] = productsData?.products || [];
  const stats = productsData?.stats || {
    totalProducts: 0,
    lowStockCount: 0,
    totalStockKg: 0,
    totalStockTons: 0,
    monthReceivedKg: 0,
    monthReceivedTons: 0,
    monthIssuedKg: 0,
    monthIssuedTons: 0,
    totalStockValueRSD: 0,
    monthReceivedCostRSD: 0,
    monthIssuedCostRSD: 0,
  };

  // 2. Dohvatanje šifarnika: Parcele, Radnici, Partneri (Dobavljači)
  const { data: parcelsData } = useQuery({
    queryKey: ['master-parcels-fert'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/parcels`, { credentials: 'include' });
      return res.json();
    },
  });
  const parcels: Array<{
    id: string;
    code: string;
    name: string;
    areaHa: number;
    currentCrop?: string | null;
    isActive: boolean;
  }> = (parcelsData?.parcels || []).filter((p: any) => p.isActive !== false);

  const { data: workersData } = useQuery({
    queryKey: ['master-workers-fert'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/workers`, { credentials: 'include' });
      return res.json();
    },
  });
  const workers: Array<{ id: string; name: string; type: string; isActive: boolean }> = (
    workersData?.workers || []
  ).filter((w: any) => w.isActive !== false);

  const { data: partnersData } = useQuery({
    queryKey: ['master-partners-fert'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/partners`, { credentials: 'include' });
      return res.json();
    },
  });
  const suppliers: Array<{ id: string; name: string; type: string; pib?: string | null }> = (
    partnersData?.partners || []
  ).filter((pt: any) => pt.isActive !== false && ['DOBAVLJAC', 'OBA'].includes(pt.type));

  // 3. Dohvatanje kretanja (dnevnik)
  const { data: movementsData, isLoading: loadingMovements } = useQuery({
    queryKey: [
      'fertilizer-movements',
      histProductId,
      histParcelId,
      histMovementType,
      histDateFrom,
      histDateTo,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (histProductId) params.append('productId', histProductId);
      if (histParcelId) params.append('parcelId', histParcelId);
      if (histMovementType) params.append('movementType', histMovementType);
      if (histDateFrom) params.append('dateFrom', histDateFrom);
      if (histDateTo) params.append('dateTo', histDateTo);

      const res = await fetch(`${API}/fertilizer/movements?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Greška pri učitavanju kretanja đubriva.');
      return res.json();
    },
  });
  const movements: FertilizerMovement[] = movementsData?.movements || [];

  // 4. Dohvatanje sumarnog utroška po parcelama
  const { data: parcelSummaryData } = useQuery({
    queryKey: ['fertilizer-parcel-summary'],
    queryFn: async () => {
      const res = await fetch(`${API}/fertilizer/parcel-summary`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri učitavanju utroška po parcelama.');
      return res.json();
    },
  });
  const parcelSummary: ParcelSummaryItem[] = parcelSummaryData?.parcelSummary || [];

  // Filtrirani proizvodi za Tab 1
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (onlyLowStock && !p.isBelowMin) return false;
      if (filterType && p.type !== filterType) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchLoc = (p.defaultLocation || '').toLowerCase().includes(q);
        const matchDesc = (p.description || '').toLowerCase().includes(q);
        if (!matchName && !matchLoc && !matchDesc) return false;
      }
      return true;
    });
  }, [products, onlyLowStock, filterType, searchQuery]);

  // ==========================================
  // FORMA ZA PRIJEM ROBE U MAGACIN (TAB 2)
  // ==========================================
  const [receiveForm, setReceiveForm] = useState({
    date: todayStr,
    productId: '',
    supplierId: '',
    quantity: '',
    unitPrice: '',
    receiptNumber: '',
    warehouseLocation: '',
    notes: '',
  });
  const [receiveLoading, setReceiveLoading] = useState(false);

  const selectedReceiveProduct = products.find((p) => p.id === receiveForm.productId);

  const handleSelectProductForReceive = (prodId: string) => {
    const prod = products.find((p) => p.id === prodId);
    setReceiveForm((prev) => ({
      ...prev,
      productId: prodId,
      unitPrice: prod?.defaultPricePerUnit ? String(prod.defaultPricePerUnit) : prev.unitPrice,
      warehouseLocation: prod?.defaultLocation || prev.warehouseLocation,
    }));
  };

  const handleJumpToReceive = (prod: FertilizerProduct) => {
    setReceiveForm({
      date: todayStr,
      productId: prod.id,
      supplierId: '',
      quantity: '',
      unitPrice: prod.defaultPricePerUnit ? String(prod.defaultPricePerUnit) : '',
      receiptNumber: '',
      warehouseLocation: prod.defaultLocation || '',
      notes: '',
    });
    setActiveTab('receive');
  };

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveForm.productId || !receiveForm.quantity || Number(receiveForm.quantity) <= 0) {
      showToast('Izaberite artikal đubriva i unesite količinu veću od 0.', 'error');
      return;
    }

    setReceiveLoading(true);
    try {
      const res = await fetch(`${API}/fertilizer/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          date: receiveForm.date,
          productId: receiveForm.productId,
          supplierId: receiveForm.supplierId || null,
          quantity: Number(receiveForm.quantity),
          unitPrice: receiveForm.unitPrice ? Number(receiveForm.unitPrice) : null,
          receiptNumber: receiveForm.receiptNumber.trim() || null,
          warehouseLocation: receiveForm.warehouseLocation.trim() || null,
          notes: receiveForm.notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri prijemu đubriva.');

      showToast(data.message || 'Prijem đubriva uspešno evidentiran!');
      setReceiveForm((prev) => ({
        ...prev,
        quantity: '',
        receiptNumber: '',
        notes: '',
      }));

      queryClient.invalidateQueries({ queryKey: ['fertilizer-products'] });
      queryClient.invalidateQueries({ queryKey: ['fertilizer-movements'] });
    } catch (err: any) {
      showToast(err.message || 'Greška pri prijemu robe.', 'error');
    } finally {
      setReceiveLoading(false);
    }
  };

  // ==========================================
  // FORMA ZA IZDAVANJE NA NJIVU (TAB 3)
  // ==========================================
  const [issueForm, setIssueForm] = useState({
    date: todayStr,
    movementType: 'IZDAVANJE_NJIVA' as 'IZDAVANJE_NJIVA' | 'POVRAT_SA_NJIVE' | 'OTPIS_KOREKCIJA',
    productId: '',
    parcelId: '',
    receivedWorkerId: '',
    quantity: '',
    areaHa: '',
    cropName: '',
    notes: '',
  });
  const [issueLoading, setIssueLoading] = useState(false);

  const selectedIssueProduct = products.find((p) => p.id === issueForm.productId);
  const selectedIssueParcel = parcels.find((p) => p.id === issueForm.parcelId);

  const handleIssueParcelChange = (parcelId: string) => {
    const p = parcels.find((item) => item.id === parcelId);
    setIssueForm((prev) => ({
      ...prev,
      parcelId,
      areaHa: p ? String(p.areaHa) : '',
      cropName: p?.currentCrop || prev.cropName,
    }));
  };

  const handleJumpToIssue = (prod: FertilizerProduct) => {
    setIssueForm((prev) => ({
      ...prev,
      date: todayStr,
      movementType: 'IZDAVANJE_NJIVA',
      productId: prod.id,
      quantity: '',
    }));
    setActiveTab('issue');
  };

  // Automatska kalkulacija kg/ha i provera stanja u realnom vremenu
  const issueQtyNum = Number(issueForm.quantity) || 0;
  const issueAreaNum = Number(issueForm.areaHa) || selectedIssueParcel?.areaHa || 0;
  const isOutflowType = ['IZDAVANJE_NJIVA', 'OTPIS_KOREKCIJA'].includes(issueForm.movementType);
  const exceedsStock =
    isOutflowType &&
    Boolean(selectedIssueProduct) &&
    issueQtyNum > (selectedIssueProduct?.currentStock || 0);

  const liveKgPerHa = useMemo(() => {
    if (issueQtyNum <= 0 || issueAreaNum <= 0 || !selectedIssueProduct) return null;
    const baseKg =
      selectedIssueProduct.unit === 'TONA' ? issueQtyNum * 1000 : issueQtyNum;
    return Number((baseKg / issueAreaNum).toFixed(1));
  }, [issueQtyNum, issueAreaNum, selectedIssueProduct]);

  const handleIssueSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!issueForm.productId || issueQtyNum <= 0) {
      showToast('Izaberite đubrivo i unesite količinu veću od 0.', 'error');
      return;
    }
    if (issueForm.movementType === 'IZDAVANJE_NJIVA' && (!issueForm.parcelId || !issueForm.receivedWorkerId)) {
      showToast('Za izdavanje na njivu obavezno izaberite parcelu i traktoristu.', 'error');
      return;
    }
    if (exceedsStock) {
      showToast('Nije moguće izdati više đubriva nego što ima na stanju u magacinu!', 'error');
      return;
    }

    setIssueLoading(true);
    try {
      const res = await fetch(`${API}/fertilizer/issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          date: issueForm.date,
          movementType: issueForm.movementType,
          productId: issueForm.productId,
          parcelId: issueForm.parcelId || null,
          receivedWorkerId: issueForm.receivedWorkerId || null,
          quantity: issueQtyNum,
          areaHa: issueAreaNum > 0 ? issueAreaNum : null,
          cropName: issueForm.cropName.trim() || null,
          notes: issueForm.notes.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri izdavanju đubriva.');

      showToast(data.message || 'Izdavanje đubriva uspešno evidentirano!');
      setIssueForm((prev) => ({
        ...prev,
        quantity: '',
        notes: '',
      }));

      queryClient.invalidateQueries({ queryKey: ['fertilizer-products'] });
      queryClient.invalidateQueries({ queryKey: ['fertilizer-movements'] });
      queryClient.invalidateQueries({ queryKey: ['fertilizer-parcel-summary'] });
    } catch (err: any) {
      showToast(err.message || 'Greška prilikom izdavanja đubriva.', 'error');
    } finally {
      setIssueLoading(false);
    }
  };

  // ==========================================
  // MODAL: NOVI ARTIKAL / IZMENA ARTIKLA ĐUBRIVA
  // ==========================================
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<FertilizerProduct | null>(null);
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState('');

  const [productForm, setProductForm] = useState({
    name: '',
    type: 'MINERALNO_GRANULISANO' as FertilizerType,
    unit: 'KG' as FertilizerUnit,
    currentStock: '0',
    minStockWarning: '500',
    defaultPricePerUnit: '',
    defaultLocation: 'Glavni magacin B1',
    description: '',
  });

  const openNewProductModal = () => {
    setEditingProduct(null);
    setProductError('');
    setProductForm({
      name: '',
      type: 'MINERALNO_GRANULISANO',
      unit: 'KG',
      currentStock: '0',
      minStockWarning: '500',
      defaultPricePerUnit: '',
      defaultLocation: 'Glavni magacin B1',
      description: '',
    });
    setProductModalOpen(true);
  };

  const openEditProductModal = (prod: FertilizerProduct) => {
    setEditingProduct(prod);
    setProductError('');
    setProductForm({
      name: prod.name,
      type: prod.type,
      unit: prod.unit,
      currentStock: String(prod.currentStock),
      minStockWarning: String(prod.minStockWarning),
      defaultPricePerUnit: prod.defaultPricePerUnit ? String(prod.defaultPricePerUnit) : '',
      defaultLocation: prod.defaultLocation || '',
      description: prod.description || '',
    });
    setProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setProductError('');

    if (!productForm.name.trim()) {
      setProductError('Naziv i formulacija đubriva su obavezni.');
      return;
    }

    setProductSaving(true);
    try {
      const url = editingProduct
        ? `${API}/fertilizer/products/${editingProduct.id}`
        : `${API}/fertilizer/products`;
      const method = editingProduct ? 'PUT' : 'POST';

      const payload: Record<string, any> = {
        name: productForm.name.trim(),
        type: productForm.type,
        unit: productForm.unit,
        minStockWarning: Number(productForm.minStockWarning) || 0,
        defaultPricePerUnit: productForm.defaultPricePerUnit
          ? Number(productForm.defaultPricePerUnit)
          : 0,
        defaultLocation: productForm.defaultLocation.trim() || null,
        description: productForm.description.trim() || null,
      };

      if (!editingProduct) {
        payload.currentStock = Number(productForm.currentStock) || 0;
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri čuvanju artikla.');

      queryClient.invalidateQueries({ queryKey: ['fertilizer-products'] });
      queryClient.invalidateQueries({ queryKey: ['fertilizer-movements'] });
      setProductModalOpen(false);
      showToast(
        editingProduct
          ? `Artikal „${productForm.name}” je uspešno ažuriran.`
          : `Novi artikal „${productForm.name}” je dodat u šifarnik magacina.`
      );
    } catch (err: any) {
      setProductError(err.message || 'Greška pri čuvanju artikla.');
    } finally {
      setProductSaving(false);
    }
  };

  // ==========================================
  // MODALI: IZMENA I BRISANJE ZAPISA KRETANJA (PRIJEMA)
  // ==========================================
  const [editMovementModalOpen, setEditMovementModalOpen] = useState(false);
  const [editingMovement, setEditingMovement] = useState<FertilizerMovement | null>(null);
  const [editMovementForm, setEditMovementForm] = useState({
    quantity: '',
    unitPrice: '',
    receiptNumber: '',
    warehouseLocation: '',
    supplierId: '',
    notes: '',
    date: '',
  });
  const [editMovementLoading, setEditMovementLoading] = useState(false);
  const [editMovementError, setEditMovementError] = useState('');

  const [deleteMovementModalOpen, setDeleteMovementModalOpen] = useState(false);
  const [deletingMovement, setDeletingMovement] = useState<FertilizerMovement | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const openEditMovementModal = (m: FertilizerMovement) => {
    setEditingMovement(m);
    setEditMovementError('');
    setEditMovementForm({
      quantity: String(m.quantity),
      unitPrice: m.unitPrice ? String(m.unitPrice) : '',
      receiptNumber: m.receiptNumber || '',
      warehouseLocation: m.warehouseLocation || '',
      supplierId: m.supplierId || '',
      notes: m.notes || '',
      date: m.date ? m.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
    });
    setEditMovementModalOpen(true);
  };

  const handleSaveMovementEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMovement) return;
    setEditMovementError('');

    const qty = Number(editMovementForm.quantity);
    if (!qty || qty <= 0) {
      setEditMovementError('Količina mora biti veća od 0.');
      return;
    }

    setEditMovementLoading(true);
    try {
      const payload: Record<string, any> = {
        quantity: qty,
        unitPrice: editMovementForm.unitPrice ? Number(editMovementForm.unitPrice) : null,
        receiptNumber: editMovementForm.receiptNumber.trim() || null,
        warehouseLocation: editMovementForm.warehouseLocation.trim() || null,
        supplierId: editMovementForm.supplierId || null,
        notes: editMovementForm.notes.trim() || null,
        date: editMovementForm.date,
      };

      const res = await fetch(`${API}/fertilizer/movements/${editingMovement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri izmeni zapisa.');

      queryClient.invalidateQueries({ queryKey: ['fertilizer-products'] });
      queryClient.invalidateQueries({ queryKey: ['fertilizer-movements'] });
      queryClient.invalidateQueries({ queryKey: ['fertilizer-parcel-summary'] });
      setEditMovementModalOpen(false);
      showToast('Zapis prijema je uspešno izmenjen i zalihe su ažurirane.');
    } catch (err: any) {
      setEditMovementError(err.message || 'Greška pri izmeni zapisa.');
    } finally {
      setEditMovementLoading(false);
    }
  };

  const openDeleteMovementModal = (m: FertilizerMovement) => {
    setDeletingMovement(m);
    setDeleteError('');
    setDeleteMovementModalOpen(true);
  };

  const handleConfirmDeleteMovement = async () => {
    if (!deletingMovement) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      const res = await fetch(`${API}/fertilizer/movements/${deletingMovement.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška pri brisanju zapisa.');

      queryClient.invalidateQueries({ queryKey: ['fertilizer-products'] });
      queryClient.invalidateQueries({ queryKey: ['fertilizer-movements'] });
      queryClient.invalidateQueries({ queryKey: ['fertilizer-parcel-summary'] });
      setDeleteMovementModalOpen(false);
      showToast('Zapis prijema je uspešno obrisan i zalihe su stornirane.');
    } catch (err: any) {
      setDeleteError(err.message || 'Greška pri brisanju zapisa.');
    } finally {
      setDeleteLoading(false);
    }
  };

  const renderTypeBadge = (type: FertilizerType) => {
    switch (type) {
      case 'MINERALNO_GRANULISANO':
        return <span className={`${styles.badge} ${styles.badgeMineral}`}>Mineralno NPK/N</span>;
      case 'VODOTOPIVO_FERTIRIGACIJA':
        return <span className={`${styles.badge} ${styles.badgeVodotopivo}`}>Vodotopivo</span>;
      case 'TECNI_BIOSTIMULATOR':
        return <span className={`${styles.badge} ${styles.badgeBio}`}>Biostimulator</span>;
      case 'ORGANSKO_PELETIRANO':
        return <span className={`${styles.badge} ${styles.badgeOrgansko}`}>Organsko</span>;
      default:
        return <span className={styles.badge}>{TYPE_LABELS[type] || type}</span>;
    }
  };

  const renderMovementBadge = (type: StockMovementType) => {
    switch (type) {
      case 'PRIJEM_NABAVKA':
        return <span className={`${styles.badge} ${styles.badgeIn}`}>+ Prijem (Nabavka)</span>;
      case 'IZDAVANJE_NJIVA':
        return <span className={`${styles.badge} ${styles.badgeOut}`}>→ Izdato na njivu</span>;
      case 'POVRAT_SA_NJIVE':
        return <span className={`${styles.badge} ${styles.badgeReturn}`}>↩ Povrat sa njive</span>;
      case 'OTPIS_KOREKCIJA':
        return <span className={`${styles.badge} ${styles.badgeWriteoff}`}>✕ Otpis / Kalo</span>;
      default:
        return <span className={styles.badge}>{MOVEMENT_LABELS[type] || type}</span>;
    }
  };

  return (
    <AppLayout pageTitle="Magacin Veštačkog Đubriva">
      <div className={styles.container}>
        {/* Toast obaveštenje */}
        {toast && (
          <div
            className={`${styles.toast} ${
              toast.type === 'error' ? styles.toastError : styles.toastSuccess
            }`}
          >
            {toast.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span>{toast.text}</span>
          </div>
        )}

        {/* Crveni alarm baner ako postoje artikli ispod minimalne zalihe */}
        {stats.lowStockCount > 0 && (
          <div className={styles.alertBanner}>
            <div className={styles.alertBannerLeft}>
              <AlertTriangle size={20} />
              <span>
                UPOZORENJE MAGACINA: <strong>{stats.lowStockCount}</strong>{' '}
                {stats.lowStockCount === 1
                  ? 'artikal đubriva je pao'
                  : 'artikla đubriva su pala'}{' '}
                ispod definisanog minimalnog praga zaliha!
              </span>
            </div>
            <button
              type="button"
              className={styles.alertBannerBtn}
              onClick={() => {
                setActiveTab('stock');
                setOnlyLowStock(true);
              }}
            >
              Prikaži kritične zalihe
            </button>
          </div>
        )}

        {/* Zaglavlje modula */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <span className={styles.titleIcon}>
                <Package size={24} />
              </span>
              Magacin Veštačkog Đubriva & Zalihe
            </h2>
            <p className={styles.subtitle}>
              Evidencija prijema robe od dobavljača, izdavanje na parcele, automatski obračun doze
              (kg/ha) i praćenje minimalnih zaliha
            </p>
          </div>

          <div className={styles.actionBtns}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={openNewProductModal}
            >
              <Plus size={17} />
              Novi artikal đubriva
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => setActiveTab('receive')}
            >
              <ArrowDownToLine size={17} />
              Prijem u magacin
            </button>
            <button
              type="button"
              className={styles.btnBlue}
              onClick={() => setActiveTab('issue')}
            >
              <ArrowUpFromLine size={17} />
              Izdavanje na njivu
            </button>
          </div>
        </div>

        {/* 4 Gornje KPI Kartice */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconGreen}`}>
              <Package size={24} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.totalStockKg.toLocaleString('sr-RS')}
                <span className={styles.statUnit}>kg ({stats.totalStockTons} t)</span>
              </div>
              <div className={styles.statLabel}>
                Ukupno na stanju ({stats.totalProducts} artikala)
              </div>
              {isManager && stats.totalStockValueRSD !== undefined && (
                <div className={styles.statSub}>
                  Vrednost zaliha: {stats.totalStockValueRSD.toLocaleString('sr-RS')} RSD
                </div>
              )}
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconBlue}`}>
              <Truck size={24} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.monthReceivedTons}
                <span className={styles.statUnit}>
                  t ({stats.monthReceivedKg.toLocaleString('sr-RS')} kg)
                </span>
              </div>
              <div className={styles.statLabel}>Primljeno u magacin ovog meseca</div>
              {isManager && stats.monthReceivedCostRSD !== undefined && (
                <div className={styles.statSub}>
                  Nabavka: {stats.monthReceivedCostRSD.toLocaleString('sr-RS')} RSD
                </div>
              )}
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconAmber}`}>
              <Sprout size={24} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.monthIssuedKg.toLocaleString('sr-RS')}
                <span className={styles.statUnit}>kg ({stats.monthIssuedTons} t)</span>
              </div>
              <div className={styles.statLabel}>Izdato na parcele ovog meseca</div>
              {isManager && stats.monthIssuedCostRSD !== undefined && (
                <div className={styles.statSub}>
                  Utrošak: {stats.monthIssuedCostRSD.toLocaleString('sr-RS')} RSD
                </div>
              )}
            </div>
          </div>

          <div
            className={`${styles.statCard} ${
              stats.lowStockCount > 0 ? styles.statCardAlert : ''
            }`}
          >
            <div
              className={`${styles.statIcon} ${
                stats.lowStockCount > 0 ? styles.iconRed : styles.iconGreen
              }`}
            >
              <AlertTriangle size={24} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.lowStockCount}
                <span className={styles.statUnit}>artikala</span>
              </div>
              <div className={styles.statLabel}>Ispod minimalne zalihe (Alarm)</div>
              <div className={styles.statSub}>
                {stats.lowStockCount > 0
                  ? 'Potrebna dopuna zaliha!'
                  : 'Svi artikli su iznad minimuma'}
              </div>
            </div>
          </div>
        </div>

        {/* Navigacija Tabova */}
        <div className={styles.tabsBar}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'stock' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('stock')}
          >
            <Warehouse size={17} />
            <span>Stanje Zaliha u Magacinu</span>
            {stats.lowStockCount > 0 && (
              <span className={styles.tabBadgeDanger}>{stats.lowStockCount}</span>
            )}
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'receive' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('receive')}
          >
            <ArrowDownToLine size={17} />
            <span>Prijem Robe (Nabavka)</span>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'issue' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('issue')}
          >
            <ArrowUpFromLine size={17} />
            <span>Izdavanje na Njivu (kg/ha)</span>
          </button>

          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'analytics' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <History size={17} />
            <span>Istorijat & Utrošak po Parcelama</span>
          </button>
        </div>

        {/* =========================================================
            TAB 1: STANJE ZALIHA U MAGACINU
           ========================================================= */}
        {activeTab === 'stock' && (
          <>
            <div className={styles.filterCard}>
              <div className={styles.filterGroup}>
                <label>Pretraga artikla ili lokacije</label>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <Search
                    size={16}
                    style={{
                      position: 'absolute',
                      left: '0.75rem',
                      color: 'var(--text-muted)',
                      pointerEvents: 'none',
                    }}
                  />
                  <input
                    type="text"
                    className={styles.filterInput}
                    style={{ paddingLeft: '2.2rem', width: '100%' }}
                    placeholder="npr. NPK 16:16:16, UREA, YaraMila, Sektor A..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.filterGroup}>
                <label>Tip đubriva</label>
                <select
                  className={styles.filterSelect}
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="">Svi tipovi đubriva</option>
                  <option value="MINERALNO_GRANULISANO">Mineralno granulisano (NPK, UREA, KAN)</option>
                  <option value="VODOTOPIVO_FERTIRIGACIJA">Vodotopivo / Fertirigacija</option>
                  <option value="TECNI_BIOSTIMULATOR">Tečni biostimulator</option>
                  <option value="ORGANSKO_PELETIRANO">Organsko / Peletirano</option>
                </select>
              </div>

              <div className={styles.filterGroup} style={{ flex: '0 0 auto' }}>
                <label>Filter alarma</label>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  style={{
                    borderColor: onlyLowStock ? '#ef4444' : undefined,
                    color: onlyLowStock ? '#dc2626' : undefined,
                    background: onlyLowStock ? 'rgba(239, 68, 68, 0.08)' : undefined,
                  }}
                  onClick={() => setOnlyLowStock(!onlyLowStock)}
                >
                  <AlertTriangle size={16} />
                  {onlyLowStock ? 'Prikazano: Samo kritične zalihe' : 'Samo ispod minimuma'}
                </button>
              </div>
            </div>

            <div className={styles.tableCard}>
              <div className={styles.tableHeader}>
                <h3>
                  <Package size={18} color="#16a34a" />
                  Trenutno stanje artikala u magacinu ({filteredProducts.length})
                </h3>
              </div>

              {loadingProducts ? (
                <div className={styles.emptyState}>
                  <Loader2 size={28} style={{ animation: 'spin 0.8s linear infinite' }} />
                  <p>Učitavanje zaliha đubriva...</p>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className={styles.emptyState}>
                  Nema pronađenih artikala đubriva za izabrane filtere.
                </div>
              ) : (
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Naziv i formulacija</th>
                        <th>Kategorija</th>
                        <th>Lokacija u skladištu</th>
                        <th>Trenutno stanje / Min. prag</th>
                        <th>Status zalihe</th>
                        {isManager && <th>Cena / Vrednost</th>}
                        <th>Brze akcije</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredProducts.map((prod) => (
                        <tr
                          key={prod.id}
                          className={prod.isBelowMin ? styles.rowBelowMin : undefined}
                        >
                          <td>
                            <div style={{ fontWeight: 800, fontSize: '0.94rem' }}>{prod.name}</div>
                            {prod.description && (
                              <div
                                style={{
                                  fontSize: '0.78rem',
                                  color: 'var(--text-secondary)',
                                  marginTop: '0.15rem',
                                }}
                              >
                                {prod.description}
                              </div>
                            )}
                          </td>
                          <td>{renderTypeBadge(prod.type)}</td>
                          <td>
                            <span style={{ fontWeight: 600 }}>
                              {prod.defaultLocation || 'Glavni magacin'}
                            </span>
                          </td>
                          <td>
                            <div className={styles.stockProgressWrap}>
                              <div className={styles.stockNumbers}>
                                <span
                                  className={`${styles.stockCurrent} ${
                                    prod.isBelowMin ? styles.stockCurrentDanger : ''
                                  }`}
                                >
                                  {prod.currentStock.toLocaleString('sr-RS')} {prod.unit}
                                </span>
                                <span className={styles.stockMinLabel}>
                                  Min: {prod.minStockWarning.toLocaleString('sr-RS')} {prod.unit}
                                </span>
                              </div>
                              <div className={styles.progressBarTrack}>
                                <div
                                  className={`${styles.progressBarFill} ${
                                    prod.isBelowMin ? styles.progressDanger : styles.progressOk
                                  }`}
                                  style={{ width: `${prod.fillPercentage || 0}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td>
                            {prod.isBelowMin ? (
                              <span className={`${styles.badge} ${styles.badgeLowStock}`}>
                                <AlertTriangle size={13} />
                                ISPOD MINIMUMA
                              </span>
                            ) : (
                              <span className={`${styles.badge} ${styles.badgeOkStock}`}>
                                <CheckCircle2 size={13} />
                                Redovna zaliha
                              </span>
                            )}
                          </td>
                          {isManager && (
                            <td>
                              <div style={{ fontWeight: 700 }}>
                                {prod.defaultPricePerUnit
                                  ? `${prod.defaultPricePerUnit.toLocaleString('sr-RS')} RSD/${prod.unit}`
                                  : '—'}
                              </div>
                              {prod.stockValueRSD !== undefined && prod.stockValueRSD > 0 && (
                                <div
                                  style={{
                                    fontSize: '0.76rem',
                                    color: 'var(--text-secondary)',
                                  }}
                                >
                                  Ukupno: {prod.stockValueRSD.toLocaleString('sr-RS')} RSD
                                </div>
                              )}
                            </td>
                          )}
                          <td>
                            <div className={styles.rowActions}>
                              <button
                                type="button"
                                className={`${styles.miniBtn} ${styles.miniBtnGreen}`}
                                onClick={() => handleJumpToReceive(prod)}
                                title="Evidentiraj prijem robe u magacin"
                              >
                                <ArrowDownToLine size={13} />
                                Prijem
                              </button>
                              <button
                                type="button"
                                className={`${styles.miniBtn} ${styles.miniBtnBlue}`}
                                onClick={() => handleJumpToIssue(prod)}
                                title="Izdaj đubrivo traktoristi za parcelu"
                              >
                                <ArrowUpFromLine size={13} />
                                Izdaj
                              </button>
                              <button
                                type="button"
                                className={styles.miniBtn}
                                onClick={() => openEditProductModal(prod)}
                                title="Izmeni minimalni prag, cenu ili lokaciju"
                              >
                                <Pencil size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* =========================================================
            TAB 2: PRIJEM ROBE U MAGACIN (NABAVKA)
           ========================================================= */}
        {activeTab === 'receive' && (
          <div className={styles.splitGrid}>
            <div className={styles.formCard}>
              <h3 className={styles.formCardTitle}>
                <ArrowDownToLine size={20} color="#16a34a" />
                Prijem Đubriva u Magacin (Ulaz od Dobavljača)
              </h3>
              <p className={styles.formCardSub}>
                Unesite podatke sa otpremnice ili fakture dobavljača. Stanje u magacinu se
                automatski uvećava.
              </p>

              <form onSubmit={handleReceiveSubmit} className={styles.formGrid}>
                <div className={styles.formField}>
                  <label>Datum prijema *</label>
                  <input
                    type="date"
                    className={styles.formInput}
                    value={receiveForm.date}
                    onChange={(e) => setReceiveForm({ ...receiveForm, date: e.target.value })}
                    required
                  />
                </div>

                <div className={styles.formField}>
                  <label>Dobavljač (iz šifarnika Partnera)</label>
                  <select
                    className={styles.formSelect}
                    value={receiveForm.supplierId}
                    onChange={(e) =>
                      setReceiveForm({ ...receiveForm, supplierId: e.target.value })
                    }
                  >
                    <option value="">— Izaberite dobavljača —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.pib ? `(PIB: ${s.pib})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={`${styles.formField} ${styles.formFieldFull}`}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <label>Artikal / Formulacija đubriva *</label>
                    <button
                      type="button"
                      onClick={openNewProductModal}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#16a34a',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      + Dodaj novo đubrivo u šifarnik
                    </button>
                  </div>
                  <select
                    className={styles.formSelect}
                    value={receiveForm.productId}
                    onChange={(e) => handleSelectProductForReceive(e.target.value)}
                    required
                  >
                    <option value="" className={styles.optionNormal}>— Izaberite đubrivo koje se prima —</option>
                    {products.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        className={p.isBelowMin ? styles.optionBelowMin : styles.optionNormal}
                      >
                        {p.name} - (Trenutno stanje: {p.currentStock.toLocaleString('sr-RS')} {p.unit}) - (Minimalno: {p.minStockWarning.toLocaleString('sr-RS')} {p.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formField}>
                  <label>
                    Primljena količina ({selectedReceiveProduct?.unit || 'KG'}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    className={styles.formInput}
                    placeholder="npr. 2500"
                    value={receiveForm.quantity}
                    onChange={(e) => setReceiveForm({ ...receiveForm, quantity: e.target.value })}
                    required
                  />
                  <div className={styles.quickQtyRow}>
                    {[500, 1000, 2500, 5000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        className={styles.quickQtyBtn}
                        onClick={() =>
                          setReceiveForm((prev) => ({
                            ...prev,
                            quantity: String((Number(prev.quantity) || 0) + val),
                          }))
                        }
                      >
                        +{val}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.formField}>
                  <label>
                    Nabavna cena po jedinici (RSD/{selectedReceiveProduct?.unit || 'KG'})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={styles.formInput}
                    placeholder="npr. 72.50"
                    value={receiveForm.unitPrice}
                    onChange={(e) => setReceiveForm({ ...receiveForm, unitPrice: e.target.value })}
                  />
                  {Number(receiveForm.quantity) > 0 && Number(receiveForm.unitPrice) > 0 && (
                    <div
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        color: '#16a34a',
                        marginTop: '0.25rem',
                      }}
                    >
                      Ukupna vrednost ulaza:{' '}
                      {Math.round(
                        Number(receiveForm.quantity) * Number(receiveForm.unitPrice)
                      ).toLocaleString('sr-RS')}{' '}
                      RSD
                    </div>
                  )}
                </div>

                <div className={styles.formField}>
                  <label>Broj dokumenta (Otpremnica / Faktura)</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="npr. OTP-2026-441"
                    value={receiveForm.receiptNumber}
                    onChange={(e) =>
                      setReceiveForm({ ...receiveForm, receiptNumber: e.target.value })
                    }
                  />
                </div>

                <div className={styles.formField}>
                  <label>Skladišna lokacija u magacinu</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="npr. Glavni magacin B1"
                    value={receiveForm.warehouseLocation}
                    onChange={(e) =>
                      setReceiveForm({ ...receiveForm, warehouseLocation: e.target.value })
                    }
                  />
                </div>

                <div className={`${styles.formField} ${styles.formFieldFull}`}>
                  <label>Napomena pri prijemu</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="npr. Džambo vreće 600 kg, ispravna ambalaža..."
                    value={receiveForm.notes}
                    onChange={(e) => setReceiveForm({ ...receiveForm, notes: e.target.value })}
                  />
                </div>

                <div className={styles.formFieldFull} style={{ marginTop: '0.4rem' }}>
                  <button
                    type="submit"
                    className={styles.btnPrimary}
                    style={{ width: '100%', padding: '0.8rem' }}
                    disabled={receiveLoading}
                  >
                    {receiveLoading ? (
                      <Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite' }} />
                    ) : (
                      <ArrowDownToLine size={18} />
                    )}
                    <span>
                      {receiveLoading
                        ? 'Evidentiranje prijema...'
                        : 'Potvrdi Prijem i Uvećaj Zalihe Magacina'}
                    </span>
                  </button>
                </div>
              </form>
            </div>

            {/* Desna kolona: Poslednji prijemi */}
            <div className={styles.tableCard}>
              <div className={styles.tableHeader}>
                <h3>
                  <Truck size={18} color="#16a34a" />
                  Poslednji prijemi u magacin
                </h3>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Đubrivo</th>
                      <th>Količina</th>
                      <th>Dobavljač / Dok.</th>
                      <th style={{ textAlign: 'center' }}>Akcije</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements
                      .filter((m) => m.movementType === 'PRIJEM_NABAVKA')
                      .slice(0, 8)
                      .map((m) => (
                        <tr key={m.id}>
                          <td>{new Date(m.date).toLocaleDateString('sr-RS')}</td>
                          <td style={{ fontWeight: 700 }}>{m.product?.name}</td>
                          <td style={{ fontWeight: 800, color: '#16a34a' }}>
                            +{m.quantity.toLocaleString('sr-RS')} {m.product?.unit}
                          </td>
                          <td>
                            <div>{m.supplier?.name || '—'}</div>
                            {m.receiptNumber && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                Dok: {m.receiptNumber}
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {m.canEdit ? (
                              <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                                <button
                                  type="button"
                                  className={styles.miniBtn}
                                  title="Izmeni prijem"
                                  onClick={() => openEditMovementModal(m)}
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.miniBtn} ${styles.miniBtnRed}`}
                                  title="Obriši / Storniraj prijem"
                                  onClick={() => openDeleteMovementModal(m)}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ) : (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem',
                                  fontSize: '0.75rem',
                                  color: 'var(--text-muted)',
                                }}
                                title="Izmena zaključana (samo direktor i rukovodilac mogu menjati starije unose)"
                              >
                                <Lock size={13} /> Zaključano
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    {movements.filter((m) => m.movementType === 'PRIJEM_NABAVKA').length ===
                      0 && (
                      <tr>
                        <td colSpan={5} className={styles.emptyState}>
                          Još uvek nema zabeleženih prijema.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 3: IZDAVANJE NA NJIVU (SA KALKULATOROM DOZE kg/ha)
           ========================================================= */}
        {activeTab === 'issue' && (
          <div className={styles.splitGrid}>
            <div className={styles.formCard}>
              <h3 className={styles.formCardTitle}>
                <ArrowUpFromLine size={20} color="#0284c7" />
                Izdavanje Đubriva na Njivu & Kalkulator Doze (kg/ha)
              </h3>
              <p className={styles.formCardSub}>
                Izaberite đubrivo, parcelu i radnika koji preuzima robu. Sistem automatski računa
                dozu po hektaru i proverava raspoloživo stanje u magacinu.
              </p>

              <form onSubmit={handleIssueSubmit} className={styles.formGrid}>
                <div className={styles.formField}>
                  <label>Vrsta promene *</label>
                  <select
                    className={styles.formSelect}
                    value={issueForm.movementType}
                    onChange={(e) =>
                      setIssueForm({
                        ...issueForm,
                        movementType: e.target.value as any,
                      })
                    }
                  >
                    <option value="IZDAVANJE_NJIVA">Izdavanje na njivu (Redovan izlaz)</option>
                    <option value="POVRAT_SA_NJIVE">Povrat neiskorišćenog đubriva sa njive</option>
                    <option value="OTPIS_KOREKCIJA">Otpis / Kalo / Oštećena ambalaža</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <label>Datum izdavanja *</label>
                  <input
                    type="date"
                    className={styles.formInput}
                    value={issueForm.date}
                    onChange={(e) => setIssueForm({ ...issueForm, date: e.target.value })}
                    required
                  />
                </div>

                <div className={`${styles.formField} ${styles.formFieldFull}`}>
                  <label>Proizvod đubriva koji se izdaje *</label>
                  <select
                    className={styles.formSelect}
                    value={issueForm.productId}
                    onChange={(e) => setIssueForm({ ...issueForm, productId: e.target.value })}
                    required
                  >
                    <option value="" className={styles.optionNormal}>— Izaberite đubrivo iz magacina —</option>
                    {products.map((p) => (
                      <option
                        key={p.id}
                        value={p.id}
                        className={p.isBelowMin ? styles.optionBelowMin : styles.optionNormal}
                      >
                        {p.name} - (Trenutno stanje: {p.currentStock.toLocaleString('sr-RS')} {p.unit}) - (Minimalno: {p.minStockWarning.toLocaleString('sr-RS')} {p.unit})
                      </option>
                    ))}
                  </select>
                </div>

                {issueForm.movementType !== 'OTPIS_KOREKCIJA' && (
                  <>
                    <div className={styles.formField}>
                      <label>
                        Parcela na koju se đubrivo odvozi{' '}
                        {issueForm.movementType === 'IZDAVANJE_NJIVA' ? '*' : ''}
                      </label>
                      <select
                        className={styles.formSelect}
                        value={issueForm.parcelId}
                        onChange={(e) => handleIssueParcelChange(e.target.value)}
                        required={issueForm.movementType === 'IZDAVANJE_NJIVA'}
                      >
                        <option value="">— Izaberite parcelu —</option>
                        {parcels.map((p) => (
                          <option key={p.id} value={p.id}>
                            [{p.code}] {p.name} ({p.areaHa} ha
                            {p.currentCrop ? ` - ${p.currentCrop}` : ''})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.formField}>
                      <label>
                        Preuzeo radnik / traktorista{' '}
                        {issueForm.movementType === 'IZDAVANJE_NJIVA' ? '*' : ''}
                      </label>
                      <select
                        className={styles.formSelect}
                        value={issueForm.receivedWorkerId}
                        onChange={(e) =>
                          setIssueForm({ ...issueForm, receivedWorkerId: e.target.value })
                        }
                        required={issueForm.movementType === 'IZDAVANJE_NJIVA'}
                      >
                        <option value="">— Izaberite radnika —</option>
                        {workers.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.formField}>
                      <label>Površina koja se đubri (ha)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className={styles.formInput}
                        placeholder="npr. 45.0"
                        value={issueForm.areaHa}
                        onChange={(e) => setIssueForm({ ...issueForm, areaHa: e.target.value })}
                      />
                    </div>

                    <div className={styles.formField}>
                      <label>Kultura na parceli</label>
                      <input
                        type="text"
                        className={styles.formInput}
                        placeholder="npr. Crni luk, Šargarepa, Pšenica..."
                        value={issueForm.cropName}
                        onChange={(e) => setIssueForm({ ...issueForm, cropName: e.target.value })}
                      />
                    </div>
                  </>
                )}

                <div className={`${styles.formField} ${styles.formFieldFull}`}>
                  <label>
                    Količina ({selectedIssueProduct?.unit || 'KG'}) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    className={styles.formInput}
                    placeholder="Unesite količinu u kg/L..."
                    value={issueForm.quantity}
                    onChange={(e) => setIssueForm({ ...issueForm, quantity: e.target.value })}
                    required
                  />
                  <div className={styles.quickQtyRow}>
                    {[100, 250, 500, 1000, 2000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        className={styles.quickQtyBtn}
                        onClick={() =>
                          setIssueForm((prev) => ({
                            ...prev,
                            quantity: String((Number(prev.quantity) || 0) + val),
                          }))
                        }
                      >
                        +{val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* UŽIVO KALKULATOR DOZE (kg/ha) I KONTROLA STANJA */}
                {selectedIssueProduct && issueQtyNum > 0 && (
                  <div className={styles.formFieldFull}>
                    <div
                      className={`${styles.dosePreviewBox} ${
                        exceedsStock ? styles.dosePreviewDanger : ''
                      }`}
                    >
                      {exceedsStock ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            color: '#dc2626',
                            fontWeight: 800,
                          }}
                        >
                          <AlertTriangle size={18} />
                          <span>
                            NEDOVOLJNO ZALIHA U MAGACINU! Na stanju ima samo{' '}
                            {selectedIssueProduct.currentStock.toLocaleString('sr-RS')}{' '}
                            {selectedIssueProduct.unit}, a uneto je{' '}
                            {issueQtyNum.toLocaleString('sr-RS')} {selectedIssueProduct.unit}.
                          </span>
                        </div>
                      ) : (
                        <>
                          <div className={styles.doseRowMain}>
                            <span className={styles.doseLabel}>
                              <Calculator
                                size={16}
                                style={{ verticalAlign: 'middle', marginRight: '0.35rem' }}
                              />
                              Automatski obračun doze po hektaru:
                            </span>
                            <span className={styles.doseValueHighlight}>
                              {liveKgPerHa !== null ? `${liveKgPerHa} kg/ha` : 'Izaberite parcelu'}
                            </span>
                          </div>
                          <div className={styles.doseMeta}>
                            <span>
                              Preostaje u magacinu nakon promene:{' '}
                              <strong>
                                {(isOutflowType
                                  ? selectedIssueProduct.currentStock - issueQtyNum
                                  : selectedIssueProduct.currentStock + issueQtyNum
                                ).toLocaleString('sr-RS')}{' '}
                                {selectedIssueProduct.unit}
                              </strong>
                            </span>
                            {issueAreaNum > 0 && (
                              <span>
                                Obračunska površina: <strong>{issueAreaNum} ha</strong>
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className={`${styles.formField} ${styles.formFieldFull}`}>
                  <label>Dodatna napomena</label>
                  <input
                    type="text"
                    className={styles.formInput}
                    placeholder="npr. Osnovno đubrenje pred oranje / Prva prihrana..."
                    value={issueForm.notes}
                    onChange={(e) => setIssueForm({ ...issueForm, notes: e.target.value })}
                  />
                </div>

                <div className={styles.formFieldFull} style={{ marginTop: '0.4rem' }}>
                  <button
                    type="submit"
                    className={styles.btnBlue}
                    style={{ width: '100%', padding: '0.8rem' }}
                    disabled={issueLoading || exceedsStock}
                  >
                    {issueLoading ? (
                      <Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite' }} />
                    ) : (
                      <ArrowUpFromLine size={18} />
                    )}
                    <span>
                      {issueLoading
                        ? 'Evidentiranje izlaza...'
                        : issueForm.movementType === 'IZDAVANJE_NJIVA'
                        ? 'Potvrdi Izdavanje na Njivu i Umanji Zalihe'
                        : 'Potvrdi Promenu Zaliha'}
                    </span>
                  </button>
                </div>
              </form>
            </div>

            {/* Desna kolona: Poslednja izdavanja na njivu */}
            <div className={styles.tableCard}>
              <div className={styles.tableHeader}>
                <h3>
                  <Sprout size={18} color="#0284c7" />
                  Poslednja izdavanja na parcele
                </h3>
              </div>
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Datum</th>
                      <th>Parcela</th>
                      <th>Đubrivo & Količina</th>
                      <th>Doza (kg/ha)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements
                      .filter((m) => m.movementType === 'IZDAVANJE_NJIVA')
                      .slice(0, 8)
                      .map((m) => (
                        <tr key={m.id}>
                          <td>{new Date(m.date).toLocaleDateString('sr-RS')}</td>
                          <td>
                            <div style={{ fontWeight: 700 }}>
                              {m.parcel ? `[${m.parcel.code}] ${m.parcel.name}` : '—'}
                            </div>
                            {m.receivedWorker && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                Preuzeo: {m.receivedWorker.name}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ fontWeight: 700 }}>{m.product?.name}</div>
                            <div style={{ fontSize: '0.8rem', color: '#0284c7', fontWeight: 700 }}>
                              -{m.quantity.toLocaleString('sr-RS')} {m.product?.unit}
                            </div>
                          </td>
                          <td>
                            {m.kgPerHa ? (
                              <span className={`${styles.badge} ${styles.badgeOut}`}>
                                {m.kgPerHa} kg/ha
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    {movements.filter((m) => m.movementType === 'IZDAVANJE_NJIVA').length ===
                      0 && (
                      <tr>
                        <td colSpan={4} className={styles.emptyState}>
                          Još uvek nema evidentiranih izdavanja na njive.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================
            TAB 4: ISTORIJAT KRETANJA & UTROŠAK PO PARCELAMA
           ========================================================= */}
        {activeTab === 'analytics' && (
          <>
            {/* 1. Zbirni pregled utroška po parcelama */}
            <div className={styles.tableCard}>
              <div className={styles.tableHeader}>
                <h3>
                  <MapPin size={18} color="#16a34a" />
                  Zbirni pregled utroška đubriva po parcelama u tekućoj sezoni (
                  {parcelSummaryData?.year || new Date().getFullYear()})
                </h3>
              </div>

              {parcelSummary.length === 0 ? (
                <div className={styles.emptyState}>
                  Još uvek nema evidentiranih izdavanja đubriva po parcelama u ovoj sezoni.
                </div>
              ) : (
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Parcela</th>
                        <th>Kultura</th>
                        <th>Površina</th>
                        <th>Ukupno bačeno</th>
                        <th>Prosečna doza</th>
                        <th>Specifikacija đubriva po vrstama</th>
                        {isManager && <th>Trošak đubriva</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {parcelSummary.map((item) => (
                        <tr key={item.parcelId}>
                          <td>
                            <div style={{ fontWeight: 800 }}>
                              [{item.parcelCode}] {item.parcelName}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              Broj izlazaka: {item.applicationsCount}
                            </div>
                          </td>
                          <td>{item.currentCrop}</td>
                          <td style={{ fontWeight: 700 }}>{item.areaHa} ha</td>
                          <td style={{ fontWeight: 800, color: '#16a34a' }}>
                            {item.totalKgApplied.toLocaleString('sr-RS')} kg
                          </td>
                          <td>
                            <span className={`${styles.badge} ${styles.badgeOut}`}>
                              {item.avgKgPerHa} kg/ha
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                              {item.products.map((p) => (
                                <span
                                  key={p.productId}
                                  className={`${styles.badge} ${styles.badgeMineral}`}
                                >
                                  {p.productName}: {p.totalQuantity.toLocaleString('sr-RS')}{' '}
                                  {p.unit}
                                </span>
                              ))}
                            </div>
                          </td>
                          {isManager && (
                            <td>
                              <div style={{ fontWeight: 800 }}>
                                {(item.totalCostRSD || 0).toLocaleString('sr-RS')} RSD
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {(item.costPerHaRSD || 0).toLocaleString('sr-RS')} RSD/ha
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* 2. Filteri za hronološki dnevnik kretanja */}
            <div className={styles.filterCard}>
              <div className={styles.filterGroup}>
                <label>Artikal đubriva</label>
                <select
                  className={styles.filterSelect}
                  value={histProductId}
                  onChange={(e) => setHistProductId(e.target.value)}
                >
                  <option value="">Sva đubriva</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.filterGroup}>
                <label>Parcela</label>
                <select
                  className={styles.filterSelect}
                  value={histParcelId}
                  onChange={(e) => setHistParcelId(e.target.value)}
                >
                  <option value="">Sve parcele</option>
                  {parcels.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.code}] {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.filterGroup}>
                <label>Vrsta kretanja</label>
                <select
                  className={styles.filterSelect}
                  value={histMovementType}
                  onChange={(e) => setHistMovementType(e.target.value)}
                >
                  <option value="">Sva kretanja (Ulaz + Izlaz)</option>
                  <option value="PRIJEM_NABAVKA">Prijem u magacin (Nabavka)</option>
                  <option value="IZDAVANJE_NJIVA">Izdavanje na njivu</option>
                  <option value="POVRAT_SA_NJIVE">Povrat sa njive</option>
                  <option value="OTPIS_KOREKCIJA">Otpis / Korekcija</option>
                </select>
              </div>

              <div className={styles.filterGroup}>
                <label>Datum od</label>
                <input
                  type="date"
                  className={styles.filterInput}
                  value={histDateFrom}
                  onChange={(e) => setHistDateFrom(e.target.value)}
                />
              </div>

              <div className={styles.filterGroup}>
                <label>Datum do</label>
                <input
                  type="date"
                  className={styles.filterInput}
                  value={histDateTo}
                  onChange={(e) => setHistDateTo(e.target.value)}
                />
              </div>
            </div>

            {/* 3. Hronološka tabela svih kretanja */}
            <div className={styles.tableCard}>
              <div className={styles.tableHeader}>
                <h3>
                  <History size={18} color="#0284c7" />
                  Hronološki dnevnik ulaza i izlaza đubriva ({movements.length})
                </h3>
              </div>

              {loadingMovements ? (
                <div className={styles.emptyState}>Učitavanje istorijata kretanja...</div>
              ) : movements.length === 0 ? (
                <div className={styles.emptyState}>
                  Nema evidentiranih kretanja đubriva za zadate filtere.
                </div>
              ) : (
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Datum i vreme</th>
                        <th>Tip kretanja</th>
                        <th>Đubrivo</th>
                        <th>Količina</th>
                        <th>Parcela / Dobavljač</th>
                        <th>Doza (kg/ha)</th>
                        <th>Magacioner / Preuzeo</th>
                        {isManager && <th>Vrednost</th>}
                        <th style={{ textAlign: 'center' }}>Akcije</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movements.map((m) => {
                        const isPositive = ['PRIJEM_NABAVKA', 'POVRAT_SA_NJIVE'].includes(
                          m.movementType
                        );
                        return (
                          <tr key={m.id}>
                            <td>
                              <div style={{ fontWeight: 700 }}>
                                {new Date(m.date).toLocaleDateString('sr-RS')}
                              </div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {new Date(m.date).toLocaleTimeString('sr-RS', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            </td>
                            <td>{renderMovementBadge(m.movementType)}</td>
                            <td style={{ fontWeight: 700 }}>{m.product?.name}</td>
                            <td>
                              <span
                                style={{
                                  fontWeight: 800,
                                  color: isPositive ? '#16a34a' : '#0284c7',
                                }}
                              >
                                {isPositive ? '+' : '-'}
                                {m.quantity.toLocaleString('sr-RS')} {m.product?.unit}
                              </span>
                            </td>
                            <td>
                              {m.parcel ? (
                                <div>
                                  <strong>
                                    [{m.parcel.code}] {m.parcel.name}
                                  </strong>{' '}
                                  ({m.areaHa || m.parcel.areaHa} ha)
                                  {m.cropName && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                      Kultura: {m.cropName}
                                    </div>
                                  )}
                                </div>
                              ) : m.supplier ? (
                                <div>
                                  <strong>Dobavljač: {m.supplier.name}</strong>
                                  {m.receiptNumber && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                      Otpremnica: {m.receiptNumber}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <span>{m.notes || '—'}</span>
                              )}
                            </td>
                            <td>
                              {m.kgPerHa ? (
                                <span style={{ fontWeight: 800 }}>{m.kgPerHa} kg/ha</span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td>
                              <div style={{ fontSize: '0.82rem' }}>
                                Izdao: <strong>{m.issuedBy?.name || 'Magacin'}</strong>
                              </div>
                              {m.receivedWorker && (
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                  Preuzeo: <strong>{m.receivedWorker.name}</strong>
                                </div>
                              )}
                            </td>
                            {isManager && (
                              <td style={{ fontWeight: 700 }}>
                                {m.totalCost
                                  ? `${Math.round(m.totalCost).toLocaleString('sr-RS')} RSD`
                                  : '—'}
                              </td>
                            )}
                            <td style={{ textAlign: 'center' }}>
                              {m.canEdit ? (
                                <div style={{ display: 'inline-flex', gap: '0.35rem' }}>
                                  <button
                                    type="button"
                                    className={styles.miniBtn}
                                    title="Izmeni zapis"
                                    onClick={() => openEditMovementModal(m)}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.miniBtn} ${styles.miniBtnRed}`}
                                    title="Obriši zapis"
                                    onClick={() => openDeleteMovementModal(m)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              ) : (
                                <span
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.25rem',
                                    fontSize: '0.75rem',
                                    color: 'var(--text-muted)',
                                  }}
                                  title="Zaključano za izmenu"
                                >
                                  <Lock size={13} />
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* =========================================================
            MODAL: DODAVANJE / IZMENA ARTIKLA ĐUBRIVA U ŠIFARNIKU
           ========================================================= */}
        {productModalOpen && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalContent}>
              <div className={styles.modalHeader}>
                <h3>
                  <Package size={20} color="#16a34a" />
                  {editingProduct
                    ? `Izmena artikla: ${editingProduct.name}`
                    : 'Novi artikal đubriva u šifarniku magacina'}
                </h3>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setProductModalOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveProduct}>
                <div className={styles.modalBody}>
                  {productError && (
                    <div className={`${styles.toast} ${styles.toastError}`}>
                      <AlertCircle size={18} />
                      <span>{productError}</span>
                    </div>
                  )}

                  <div className={styles.formField}>
                    <label>Naziv i formulacija đubriva *</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="npr. NPK 16:16:16, UREA 46% N, YaraMila Complex..."
                      value={productForm.name}
                      onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className={styles.formGrid}>
                    <div className={styles.formField}>
                      <label>Vrsta / Kategorija đubriva</label>
                      <select
                        className={styles.formSelect}
                        value={productForm.type}
                        onChange={(e) =>
                          setProductForm({
                            ...productForm,
                            type: e.target.value as FertilizerType,
                          })
                        }
                      >
                        <option value="MINERALNO_GRANULISANO">Mineralno granulisano</option>
                        <option value="VODOTOPIVO_FERTIRIGACIJA">
                          Vodotopivo / Fertirigacija
                        </option>
                        <option value="TECNI_BIOSTIMULATOR">Tečni biostimulator</option>
                        <option value="ORGANSKO_PELETIRANO">Organsko / Peletirano</option>
                      </select>
                    </div>

                    <div className={styles.formField}>
                      <label>Jedinica mere</label>
                      <select
                        className={styles.formSelect}
                        value={productForm.unit}
                        onChange={(e) =>
                          setProductForm({
                            ...productForm,
                            unit: e.target.value as FertilizerUnit,
                          })
                        }
                      >
                        <option value="KG">Kilogram (KG)</option>
                        <option value="L">Litar (L)</option>
                        <option value="TONA">Tona (TONA)</option>
                      </select>
                    </div>
                  </div>

                  <div className={styles.formGrid}>
                    {!editingProduct && (
                      <div className={styles.formField}>
                        <label>Početno stanje u magacinu ({productForm.unit})</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className={styles.formInput}
                          value={productForm.currentStock}
                          onChange={(e) =>
                            setProductForm({ ...productForm, currentStock: e.target.value })
                          }
                        />
                      </div>
                    )}

                    <div className={styles.formField}>
                      <label>Minimalni prag za crveni alarm ({productForm.unit}) *</label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        className={styles.formInput}
                        placeholder="npr. 1000"
                        value={productForm.minStockWarning}
                        onChange={(e) =>
                          setProductForm({ ...productForm, minStockWarning: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className={styles.formField}>
                      <label>Okvirna nabavna cena (RSD/{productForm.unit})</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className={styles.formInput}
                        placeholder="npr. 72"
                        value={productForm.defaultPricePerUnit}
                        onChange={(e) =>
                          setProductForm({
                            ...productForm,
                            defaultPricePerUnit: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className={styles.formField}>
                    <label>Podrazumevana lokacija u magacinu</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="npr. Glavni magacin B1, Magacin pod nadstrešnicom..."
                      value={productForm.defaultLocation}
                      onChange={(e) =>
                        setProductForm({ ...productForm, defaultLocation: e.target.value })
                      }
                    />
                  </div>

                  <div className={styles.formField}>
                    <label>Opis sastava i namena</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="npr. Osnovno jesenje đubrenje ili prihrana luka..."
                      value={productForm.description}
                      onChange={(e) =>
                        setProductForm({ ...productForm, description: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setProductModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button type="submit" className={styles.btnPrimary} disabled={productSaving}>
                    {productSaving ? 'Čuvanje...' : 'Sačuvaj artikal'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =========================================================
            MODAL: IZMENA ZAPISA KRETANJA (PRIJEMA / DOKUMENTA)
           ========================================================= */}
        {editMovementModalOpen && editingMovement && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalContent}>
              <div className={styles.modalHeader}>
                <h3>
                  <Pencil size={20} color="#16a34a" />
                  Izmena zapisa: {editingMovement.product?.name}
                </h3>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setEditMovementModalOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSaveMovementEdit}>
                <div className={styles.modalBody}>
                  {editMovementError && (
                    <div className={`${styles.toast} ${styles.toastError}`}>
                      <AlertCircle size={18} />
                      <span>{editMovementError}</span>
                    </div>
                  )}

                  <div className={styles.formGrid}>
                    <div className={styles.formField}>
                      <label>Datum *</label>
                      <input
                        type="date"
                        className={styles.formInput}
                        value={editMovementForm.date}
                        onChange={(e) =>
                          setEditMovementForm({ ...editMovementForm, date: e.target.value })
                        }
                        required
                      />
                    </div>

                    <div className={styles.formField}>
                      <label>
                        Količina ({editingMovement.product?.unit || 'KG'}) *
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className={styles.formInput}
                        value={editMovementForm.quantity}
                        onChange={(e) =>
                          setEditMovementForm({ ...editMovementForm, quantity: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>

                  {isManager && (
                    <div className={styles.formField}>
                      <label>
                        Nabavna cena po jedinici (RSD/{editingMovement.product?.unit || 'KG'})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className={styles.formInput}
                        placeholder="npr. 75.00"
                        value={editMovementForm.unitPrice}
                        onChange={(e) =>
                          setEditMovementForm({ ...editMovementForm, unitPrice: e.target.value })
                        }
                      />
                      {Number(editMovementForm.quantity) > 0 &&
                        Number(editMovementForm.unitPrice) > 0 && (
                          <div
                            style={{
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              color: '#16a34a',
                              marginTop: '0.25rem',
                            }}
                          >
                            Ukupna korigovana vrednost:{' '}
                            {Math.round(
                              Number(editMovementForm.quantity) * Number(editMovementForm.unitPrice)
                            ).toLocaleString('sr-RS')}{' '}
                            RSD
                          </div>
                        )}
                    </div>
                  )}

                  {editingMovement.movementType === 'PRIJEM_NABAVKA' && (
                    <div className={styles.formField}>
                      <label>Dobavljač (iz šifarnika Partnera)</label>
                      <select
                        className={styles.formSelect}
                        value={editMovementForm.supplierId}
                        onChange={(e) =>
                          setEditMovementForm({ ...editMovementForm, supplierId: e.target.value })
                        }
                      >
                        <option value="">— Izaberite dobavljača —</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.pib ? `(PIB: ${s.pib})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className={styles.formGrid}>
                    <div className={styles.formField}>
                      <label>Broj dokumenta (Otpremnica / Faktura)</label>
                      <input
                        type="text"
                        className={styles.formInput}
                        placeholder="npr. OTP-2026-001"
                        value={editMovementForm.receiptNumber}
                        onChange={(e) =>
                          setEditMovementForm({
                            ...editMovementForm,
                            receiptNumber: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className={styles.formField}>
                      <label>Skladišna lokacija</label>
                      <input
                        type="text"
                        className={styles.formInput}
                        placeholder="npr. Glavni magacin B1"
                        value={editMovementForm.warehouseLocation}
                        onChange={(e) =>
                          setEditMovementForm({
                            ...editMovementForm,
                            warehouseLocation: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className={styles.formField}>
                    <label>Napomena</label>
                    <input
                      type="text"
                      className={styles.formInput}
                      placeholder="npr. Ispravka unete količine sa otpremnice..."
                      value={editMovementForm.notes}
                      onChange={(e) =>
                        setEditMovementForm({ ...editMovementForm, notes: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setEditMovementModalOpen(false)}
                  >
                    Odustani
                  </button>
                  <button
                    type="submit"
                    className={styles.btnPrimary}
                    disabled={editMovementLoading}
                  >
                    {editMovementLoading ? (
                      <>
                        <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
                        <span>Čuvanje izmena...</span>
                      </>
                    ) : (
                      'Sačuvaj izmene'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* =========================================================
            MODAL: POTVRDA BRISANJA (STORNIRANJA) ZAPISA
           ========================================================= */}
        {deleteMovementModalOpen && deletingMovement && (
          <div className={styles.modalOverlay}>
            <div className={styles.modalContent}>
              <div className={styles.modalHeader}>
                <h3>
                  <AlertTriangle size={20} color="#ef4444" />
                  Potvrda brisanja zapisa
                </h3>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={() => setDeleteMovementModalOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <div className={styles.modalBody}>
                {deleteError && (
                  <div className={`${styles.toast} ${styles.toastError}`}>
                    <AlertCircle size={18} />
                    <span>{deleteError}</span>
                  </div>
                )}

                <p style={{ margin: 0, fontSize: '0.94rem', color: 'var(--text-primary)' }}>
                  Da li ste sigurni da želite da obrišete i stornirate ovaj zapis kretanja đubriva?
                </p>

                <div
                  style={{
                    background: 'var(--bg-secondary, #f8fafc)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '0.85rem 1rem',
                    fontSize: '0.88rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.35rem',
                  }}
                >
                  <div>
                    <strong>Artikal:</strong> {deletingMovement.product?.name}
                  </div>
                  <div>
                    <strong>Količina:</strong>{' '}
                    <span style={{ fontWeight: 800, color: '#dc2626' }}>
                      {deletingMovement.quantity.toLocaleString('sr-RS')}{' '}
                      {deletingMovement.product?.unit}
                    </span>
                  </div>
                  <div>
                    <strong>Tip:</strong>{' '}
                    {deletingMovement.movementType === 'PRIJEM_NABAVKA'
                      ? 'Prijem robe u magacin'
                      : deletingMovement.movementType === 'IZDAVANJE_NJIVA'
                      ? 'Izdavanje na njivu'
                      : deletingMovement.movementType}
                  </div>
                  <div>
                    <strong>Datum:</strong>{' '}
                    {new Date(deletingMovement.date).toLocaleDateString('sr-RS')}
                  </div>
                  {deletingMovement.receiptNumber && (
                    <div>
                      <strong>Dokument:</strong> {deletingMovement.receiptNumber}
                    </div>
                  )}
                  {deletingMovement.supplier?.name && (
                    <div>
                      <strong>Dobavljač:</strong> {deletingMovement.supplier.name}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--text-muted)',
                    lineHeight: 1.45,
                    borderLeft: '3px solid #ef4444',
                    paddingLeft: '0.65rem',
                  }}
                >
                  <strong>Važna napomena:</strong> Brisanje ovog zapisa će automatski stornirati
                  promenu na stanju magacina. Ako se briše prijem, zalihe će se umanjiti. Ako bi to
                  dovelo do negativnog stanja, sistem će sprečiti brisanje. Svaka promena se
                  beleži u revizorski dnevnik (Audit Log).
                </div>
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setDeleteMovementModalOpen(false)}
                >
                  Odustani
                </button>
                <button
                  type="button"
                  className={styles.btnDanger}
                  disabled={deleteLoading}
                  onClick={handleConfirmDeleteMovement}
                >
                  {deleteLoading ? (
                    <>
                      <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
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
        )}
      </div>
    </AppLayout>
  );
};

export default FertilizerDashboard;

