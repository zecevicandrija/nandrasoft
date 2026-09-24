import React, { useState } from 'react';
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
  Loader2,
  X,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import styles from './Sifarnici.module.css';

const API = 'http://localhost:5000/api';

type TabType = 'parcele' | 'masine' | 'radnici' | 'operacije' | 'kulture' | 'partneri';

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const SifarniciHub: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('parcele');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  // Form states
  const [form, setForm] = useState<Record<string, any>>({});

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
    },
    onError: (err: any) => {
      showToast(err.message || 'Greška pri brisanju', 'error');
    },
  });

  // Modal actions
  const openAddModal = () => {
    setEditingItem(null);
    if (activeTab === 'parcele') setForm({ code: '', name: '', areaHa: '', location: '', currentCrop: '', notes: '' });
    if (activeTab === 'masine') setForm({ name: '', type: 'TRAKTOR', brandModel: '', regNumber: '', year: new Date().getFullYear(), currentHours: 0, status: 'SLOBODNA', notes: '' });
    if (activeTab === 'radnici') setForm({ name: '', type: 'STALNI', phone: '', hourlyRate: 500 });
    if (activeTab === 'operacije') setForm({ name: '', category: 'OBRADA', unit: 'ha' });
    if (activeTab === 'kulture') setForm({ name: '', variety: '', notes: '' });
    if (activeTab === 'partneri') setForm({ name: '', type: 'KUPAC', pib: '', phone: '', email: '', address: '' });
    setModalOpen(true);
  };

  const openEditModal = (item: any) => {
    setEditingItem(item);
    setForm({ ...item });
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
    }
    if (activeTab === 'radnici' && payload.hourlyRate !== undefined) payload.hourlyRate = parseFloat(payload.hourlyRate);

    saveMutation.mutate({ endpoint, id: editingItem?.id, data: payload });
  };

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(`Da li ste sigurni da želite da obrišete "${name}"?`)) return;
    const endpointMap: Record<TabType, string> = {
      parcele: 'parcels',
      masine: 'machines',
      radnici: 'workers',
      operacije: 'work-types',
      kulture: 'crops',
      partneri: 'partners',
    };
    deleteMutation.mutate({ endpoint: endpointMap[activeTab], id });
  };

  // Filteri
  const q = search.toLowerCase();
  const parcels = (parcelsData?.parcels || []).filter((p: any) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.currentCrop || '').toLowerCase().includes(q));
  const machines = (machinesData?.machines || []).filter((m: any) => m.name.toLowerCase().includes(q) || (m.brandModel || '').toLowerCase().includes(q) || (m.regNumber || '').toLowerCase().includes(q));
  const workers = (workersData?.workers || []).filter((w: any) => w.name.toLowerCase().includes(q) || (w.phone || '').includes(q));
  const workTypes = (workTypesData?.workTypes || []).filter((wt: any) => wt.name.toLowerCase().includes(q) || wt.category.toLowerCase().includes(q));
  const crops = (cropsData?.crops || []).filter((c: any) => c.name.toLowerCase().includes(q) || (c.variety || '').toLowerCase().includes(q));
  const partners = (partnersData?.partners || []).filter((pt: any) => pt.name.toLowerCase().includes(q) || (pt.pib || '').includes(q));

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
          onClick={() => { setActiveTab('parcele'); setSearch(''); }}
        >
          <Layers size={17} />
          <span>Parcele</span>
          <span className={styles.tabBadge}>{parcelsData?.parcels?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'masine' ? styles.tabBtnActive : ''}`}
          onClick={() => { setActiveTab('masine'); setSearch(''); }}
        >
          <Tractor size={17} />
          <span>Mašine</span>
          <span className={styles.tabBadge}>{machinesData?.machines?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'radnici' ? styles.tabBtnActive : ''}`}
          onClick={() => { setActiveTab('radnici'); setSearch(''); }}
        >
          <Users size={17} />
          <span>Radnici</span>
          <span className={styles.tabBadge}>{workersData?.workers?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'operacije' ? styles.tabBtnActive : ''}`}
          onClick={() => { setActiveTab('operacije'); setSearch(''); }}
        >
          <Settings size={17} />
          <span>Operacije</span>
          <span className={styles.tabBadge}>{workTypesData?.workTypes?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'kulture' ? styles.tabBtnActive : ''}`}
          onClick={() => { setActiveTab('kulture'); setSearch(''); }}
        >
          <Sprout size={17} />
          <span>Kulture & Sorte</span>
          <span className={styles.tabBadge}>{cropsData?.crops?.length || 0}</span>
        </button>

        <button
          className={`${styles.tabBtn} ${activeTab === 'partneri' ? styles.tabBtnActive : ''}`}
          onClick={() => { setActiveTab('partneri'); setSearch(''); }}
        >
          <Handshake size={17} />
          <span>Partneri</span>
          <span className={styles.tabBadge}>{partnersData?.partners?.length || 0}</span>
        </button>
      </div>

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search size={18} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder={`Pretraži ${activeTab}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
                    parcels.map((p: any) => (
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
                            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(p.id, p.name)} title="Obriši"><Trash2 size={15} /></button>
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
                    <th>Radni sati (h)</th>
                    <th>Status</th>
                    <th className={styles.thActions}>Akcije</th>
                  </tr>
                </thead>
                <tbody>
                  {machines.length === 0 ? (
                    <tr><td colSpan={6} className={styles.emptyState}>Nema unetih mašina</td></tr>
                  ) : (
                    machines.map((m: any) => (
                      <tr key={m.id}>
                        <td>
                          <strong className={styles.primaryText}>{m.name}</strong>
                          <span className={styles.secondaryText}>{m.brandModel || ''} {m.year ? `(${m.year})` : ''}</span>
                        </td>
                        <td><span className={`${styles.pill} ${styles.pillBlue}`}>{m.type}</span></td>
                        <td><span className={styles.codeBadge}>{m.regNumber || '—'}</span></td>
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
                            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(m.id, m.name)} title="Obriši"><Trash2 size={15} /></button>
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
                    <th>Tip angažovanja</th>
                    <th>Kontakt telefon</th>
                    <th>Satnica (RSD/h)</th>
                    <th>Povezan login nalog</th>
                    <th className={styles.thActions}>Akcije</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.length === 0 ? (
                    <tr><td colSpan={6} className={styles.emptyState}>Nema unetih radnika</td></tr>
                  ) : (
                    workers.map((w: any) => (
                      <tr key={w.id}>
                        <td><strong className={styles.primaryText}>{w.name}</strong></td>
                        <td>
                          <span className={`${styles.pill} ${w.type === 'STALNI' ? styles.pillBlue : styles.pillAmber}`}>
                            {w.type === 'STALNI' ? 'Stalni radnik' : 'Sezonac'}
                          </span>
                        </td>
                        <td><span className={styles.secondaryText}>{w.phone || '—'}</span></td>
                        <td><span className={styles.numberText}>{w.hourlyRate || 0} RSD/h</span></td>
                        <td><span className={styles.secondaryText}>{w.user?.email || 'Nema (samo njiva)'}</span></td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.actionBtn} onClick={() => openEditModal(w)} title="Izmeni"><Pencil size={15} /></button>
                            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(w.id, w.name)} title="Obriši"><Trash2 size={15} /></button>
                          </div>
                        </td>
                      </tr>
                    ))
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
                    workTypes.map((wt: any) => (
                      <tr key={wt.id}>
                        <td><strong className={styles.primaryText}>{wt.name}</strong></td>
                        <td><span className={`${styles.pill} ${styles.pillPurple}`}>{wt.category}</span></td>
                        <td><span className={styles.codeBadge}>{wt.unit}</span></td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.actionBtn} onClick={() => openEditModal(wt)} title="Izmeni"><Pencil size={15} /></button>
                            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(wt.id, wt.name)} title="Obriši"><Trash2 size={15} /></button>
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
                    crops.map((c: any) => (
                      <tr key={c.id}>
                        <td><strong className={styles.primaryText}>{c.name}</strong></td>
                        <td><span className={`${styles.pill} ${styles.pillGreen}`}>{c.variety || '—'}</span></td>
                        <td><span className={styles.secondaryText}>{c.notes || '—'}</span></td>
                        <td>
                          <div className={styles.actionBtns}>
                            <button className={styles.actionBtn} onClick={() => openEditModal(c)} title="Izmeni"><Pencil size={15} /></button>
                            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(c.id, `${c.name} ${c.variety}`)} title="Obriši"><Trash2 size={15} /></button>
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
                    partners.map((pt: any) => (
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
                            <button className={`${styles.actionBtn} ${styles.actionBtnDanger}`} onClick={() => handleDelete(pt.id, pt.name)} title="Obriši"><Trash2 size={15} /></button>
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
                      <input className={styles.formInput} value={form.currentCrop || ''} onChange={(e) => setForm({ ...form, currentCrop: e.target.value })} placeholder="Luk žuti" />
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
                      <select className={styles.formSelect} value={form.type || 'TRAKTOR'} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                        <option value="TRAKTOR">Traktor</option>
                        <option value="PRIKLJUCAK">Priključak / Prskalica / Vadilica</option>
                        <option value="KOMBAJN">Kombajn</option>
                        <option value="KAMION">Kamion</option>
                        <option value="VILJUSKAR">Viljuškar</option>
                        <option value="OSTALO">Ostalo</option>
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Status</label>
                      <select className={styles.formSelect} value={form.status || 'SLOBODNA'} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                        <option value="SLOBODNA">Slobodna</option>
                        <option value="ZADUZENA">Zadužena na njivi</option>
                        <option value="U_KVARU">U kvaru</option>
                        <option value="SERVIS">Na servisu</option>
                      </select>
                    </div>
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Registracija / Inv. broj</label>
                      <input className={styles.formInput} value={form.regNumber || ''} onChange={(e) => setForm({ ...form, regNumber: e.target.value })} />
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Trenutni radni sati (h)</label>
                      <input className={styles.formInput} type="number" step="1" value={form.currentHours ?? 0} onChange={(e) => setForm({ ...form, currentHours: e.target.value })} />
                    </div>
                  </div>
                </>
              )}

              {/* FORMA RADNICI */}
              {activeTab === 'radnici' && (
                <>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Ime i prezime</label>
                    <input className={styles.formInput} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Marko Marković" required />
                  </div>
                  <div className={styles.formRow}>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Tip angažovanja</label>
                      <select className={styles.formSelect} value={form.type || 'STALNI'} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                        <option value="STALNI">Stalni radnik (Traktorista)</option>
                        <option value="SEZONAC">Sezonac (Berba / Magacin)</option>
                      </select>
                    </div>
                    <div className={styles.formGroup}>
                      <label className={styles.formLabel}>Satnica (RSD/h)</label>
                      <input className={styles.formInput} type="number" step="10" value={form.hourlyRate || 500} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} />
                    </div>
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Telefon</label>
                    <input className={styles.formInput} value={form.phone || ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+381 64..." />
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
                      <select className={styles.formSelect} value={form.category || 'OBRADA'} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                        <option value="OBRADA">Obrada zemlje</option>
                        <option value="SETVA">Setva / Sadnja</option>
                        <option value="ZASTITA">Zaštita / Prskanje</option>
                        <option value="ZETVA_BERBA">Žetva / Berba / Vađenje</option>
                        <option value="TRANSPORT">Transport</option>
                        <option value="OSTALO">Ostalo</option>
                      </select>
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
                      <select className={styles.formSelect} value={form.type || 'KUPAC'} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                        <option value="KUPAC">Kupac (Otkup luka)</option>
                        <option value="DOBAVLJAC">Dobavljač (Đubrivo / Seme)</option>
                        <option value="SERVIS">Serviser mašina</option>
                        <option value="OBA">Kupac & Dobavljač</option>
                      </select>
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
    </AppLayout>
  );
};

export default SifarniciHub;
