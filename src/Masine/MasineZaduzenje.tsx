import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tractor,
  KeyRound,
  CheckCircle2,
  Clock,
  Fuel,
  User,
  MapPin,
  FileText,
  Plus,
  Loader2,
  X,
  AlertCircle,
  Wrench,
  ShieldCheck,
} from 'lucide-react';
import AppLayout from '../components/Layout/AppLayout';
import styles from './MasineZaduzenje.module.css';

const API = 'http://localhost:5000/api';

type TabType = 'active' | 'checkout' | 'history';

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const MasineZaduzenje: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('active');
  const [toast, setToast] = useState<Toast | null>(null);

  // Form states za novo zaduženje (Checkout)
  const [checkoutMachineId, setCheckoutMachineId] = useState('');
  const [checkoutWorkerId, setCheckoutWorkerId] = useState('');
  const [checkoutParcelId, setCheckoutParcelId] = useState('');
  const [checkoutStartHours, setCheckoutStartHours] = useState<number | string>('');
  const [checkoutFuel, setCheckoutFuel] = useState<number>(100);
  const [checkoutNotes, setCheckoutNotes] = useState('');

  // Checkin Modal states
  const [checkinModalOpen, setCheckinModalOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<any | null>(null);
  const [checkinEndHours, setCheckinEndHours] = useState<number | string>('');
  const [checkinFuel, setCheckinFuel] = useState<number>(75);
  const [checkinOperational, setCheckinOperational] = useState(true);
  const [checkinNotes, setCheckinNotes] = useState('');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // 1. STATISTIKA ZADUŽENJA
  const { data: statsData } = useQuery({
    queryKey: ['assignments-stats'],
    queryFn: async () => {
      const res = await fetch(`${API}/assignments/stats`, { credentials: 'include' });
      return res.json();
    },
  });

  // 2. AKTIVNA ZADUŽENJA
  const { data: activeData, isLoading: loadingActive } = useQuery({
    queryKey: ['assignments-active'],
    queryFn: async () => {
      const res = await fetch(`${API}/assignments/active`, { credentials: 'include' });
      return res.json();
    },
  });

  // 3. SVA ZADUŽENJA (ISTORIJAT)
  const { data: historyData, isLoading: loadingHistory } = useQuery({
    queryKey: ['assignments-history'],
    queryFn: async () => {
      const res = await fetch(`${API}/assignments?limit=50`, { credentials: 'include' });
      return res.json();
    },
  });

  // 4. ŠIFARNICI
  const { data: machinesData } = useQuery({
    queryKey: ['machines-all'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/machines`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: workersData } = useQuery({
    queryKey: ['workers-all'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/workers`, { credentials: 'include' });
      return res.json();
    },
  });

  const { data: parcelsData } = useQuery({
    queryKey: ['parcels-all'],
    queryFn: async () => {
      const res = await fetch(`${API}/master/parcels`, { credentials: 'include' });
      return res.json();
    },
  });

  // Slobodne mašine za zaduženje
  const freeMachines = machinesData?.machines?.filter((m: any) => m.status === 'SLOBODNA') || [];

  // Prilikom izbora mašine, automatski preuzmi njene trenutne radne sate
  const handleSelectMachine = (machineId: string) => {
    setCheckoutMachineId(machineId);
    const m = machinesData?.machines?.find((item: any) => item.id === machineId);
    if (m) {
      setCheckoutStartHours(m.currentHours || 0);
    }
  };

  // MUTACIJA: NOVO ZADUŽENJE (CHECKOUT)
  const checkoutMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`${API}/assignments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri zaduživanju.');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['assignments-active'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-stats'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-history'] });
      queryClient.invalidateQueries({ queryKey: ['machines-all'] });

      // Reset form
      setCheckoutMachineId('');
      setCheckoutWorkerId('');
      setCheckoutParcelId('');
      setCheckoutStartHours('');
      setCheckoutNotes('');

      setActiveTab('active');
      showToast(data.message || 'Mašina je uspešno zadužena.', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  // MUTACIJA: RAZDUŽIVANJE MAŠINE (CHECKIN)
  const checkinMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch(`${API}/assignments/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri razduživanju.');
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['assignments-active'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-stats'] });
      queryClient.invalidateQueries({ queryKey: ['assignments-history'] });
      queryClient.invalidateQueries({ queryKey: ['machines-all'] });

      setCheckinModalOpen(false);
      setSelectedAssignment(null);
      showToast(data.message || 'Mašina uspešno razdužena.', 'success');
    },
    onError: (err: any) => {
      showToast(err.message, 'error');
    },
  });

  const handleOpenCheckin = (assignment: any) => {
    setSelectedAssignment(assignment);
    setCheckinEndHours(assignment.startHours);
    setCheckinFuel(assignment.startFuelLevel || 75);
    setCheckinOperational(true);
    setCheckinNotes('');
    setCheckinModalOpen(true);
  };

  const handleCheckoutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkoutMachineId || !checkoutWorkerId) {
      showToast('Molimo izaberite mašinu i radnika.', 'error');
      return;
    }

    checkoutMutation.mutate({
      machineId: checkoutMachineId,
      workerId: checkoutWorkerId,
      parcelId: checkoutParcelId || null,
      startHours: Number(checkoutStartHours),
      startFuelLevel: checkoutFuel,
      assignNotes: checkoutNotes || null,
    });
  };

  const handleCheckinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignment) return;

    const endH = Number(checkinEndHours);
    if (endH < selectedAssignment.startHours) {
      showToast(
        `Krajnji sati (${endH} rh) ne mogu biti manji od početnih (${selectedAssignment.startHours} rh).`,
        'error'
      );
      return;
    }

    checkinMutation.mutate({
      assignmentId: selectedAssignment.id,
      endHours: endH,
      endFuelLevel: checkinFuel,
      isOperational: checkinOperational,
      returnNotes: checkinNotes || null,
    });
  };

  const activeAssignments = activeData?.assignments || [];
  const historyList = historyData?.assignments || [];
  const hoursWorkedLive =
    selectedAssignment && checkinEndHours
      ? Math.round((Number(checkinEndHours) - selectedAssignment.startHours) * 10) / 10
      : 0;

  return (
    <AppLayout pageTitle="Zaduživanje Mašina">
      <div className={styles.container}>
        {/* Toast */}
        {toast && (
          <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
            {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span>{toast.message}</span>
          </div>
        )}

        {/* Zaglavlje */}
        <div className={styles.headerBar}>
          <div className={styles.titleArea}>
            <h2>
              <KeyRound size={26} color="#d97706" />
              Zaduživanje i Razduživanje Mehanizacije
            </h2>
            <div className={styles.subtitle}>
              Praćenje ko trenutno upravlja kojim traktorom, radnih sati i stanja ispravnosti mašina
            </div>
          </div>
        </div>

        {/* KPI Kartice */}
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconActive}`}>
              <Tractor size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{statsData?.activeAssignments ?? 0}</div>
              <div className={styles.statLabel}>Trenutno na Njivi (Zadužene)</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconFree}`}>
              <ShieldCheck size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{statsData?.freeMachines ?? 0}</div>
              <div className={styles.statLabel}>Slobodnih Mašina u Dvorištu</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.iconBroken}`}>
              <Wrench size={24} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{statsData?.brokenMachines ?? 0}</div>
              <div className={styles.statLabel}>Mašina u Kvaru / Servisu</div>
            </div>
          </div>
        </div>

        {/* Tasteri / Tabovi */}
        <div className={styles.tabsBar}>
          <button
            className={`${styles.tabBtn} ${activeTab === 'active' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('active')}
          >
            <Tractor size={16} />
            <span>Aktivna Zaduženja (Na Njivi)</span>
            <span className={styles.tabBadge}>{activeAssignments.length}</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'checkout' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('checkout')}
          >
            <Plus size={16} />
            <span>Novo Zaduženje (Checkout)</span>
          </button>

          <button
            className={`${styles.tabBtn} ${activeTab === 'history' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <Clock size={16} />
            <span>Dnevnik Zaduženja (Istorijat)</span>
          </button>
        </div>

        {/* TAB 1: AKTIVNA ZADUŽENJA */}
        {activeTab === 'active' && (
          <div>
            {loadingActive ? (
              <div style={{ textAlign: 'center', padding: '3rem' }}>
                <Loader2 size={32} className="spin" />
              </div>
            ) : activeAssignments.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '3.5rem',
                  backgroundColor: 'var(--bg-card)',
                  borderRadius: 16,
                  border: '1px solid var(--border-color)',
                }}
              >
                <Tractor size={42} color="var(--text-muted)" style={{ margin: '0 auto 0.75rem' }} />
                <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Nema aktivno zaduženih mašina</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginTop: '0.4rem' }}>
                  Sve mašine su trenutno parkirane u dvorištu firme. Kliknite na "Novo Zaduženje" da preuzmete traktor.
                </p>
                <button
                  onClick={() => setActiveTab('checkout')}
                  className={styles.btnCheckoutSubmit}
                  style={{ maxWidth: 220, margin: '1rem auto 0' }}
                >
                  <Plus size={16} />
                  <span>Zaduži Mašinu</span>
                </button>
              </div>
            ) : (
              <div className={styles.activeGrid}>
                {activeAssignments.map((a: any) => {
                  const assignedTime = new Date(a.assignedAt).toLocaleTimeString('sr-RS', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const assignedDate = new Date(a.assignedAt).toLocaleDateString('sr-RS');

                  return (
                    <div key={a.id} className={styles.checkoutCard}>
                      <div className={styles.checkoutHeader}>
                        <div>
                          <div className={styles.machineName}>
                            <Tractor size={18} color="#d97706" />
                            <span>{a.machine?.name}</span>
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {a.machine?.brandModel}
                          </span>
                        </div>
                        {a.machine?.regNumber && (
                          <span className={styles.regBadge}>{a.machine?.regNumber}</span>
                        )}
                      </div>

                      <div className={styles.checkoutDetails}>
                        <div className={styles.detailRow}>
                          <span className={styles.detailLabel}>
                            <User size={14} /> Radnik:
                          </span>
                          <span className={styles.detailValue}>{a.worker?.name}</span>
                        </div>

                        {a.parcel && (
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>
                              <MapPin size={14} /> Parcela:
                            </span>
                            <span className={styles.detailValue}>
                              [{a.parcel.code}] {a.parcel.name}
                            </span>
                          </div>
                        )}

                        <div className={styles.detailRow}>
                          <span className={styles.detailLabel}>
                            <Clock size={14} /> Zaduženo:
                          </span>
                          <span className={styles.detailValue}>
                            {assignedDate} u {assignedTime}
                          </span>
                        </div>

                        <div className={styles.detailRow}>
                          <span className={styles.detailLabel}>
                            <Tractor size={14} /> Početni sati:
                          </span>
                          <span className={`${styles.detailValue} ${styles.hoursBadge}`}>
                            {a.startHours} rh
                          </span>
                        </div>

                        {a.startFuelLevel !== null && (
                          <div className={styles.detailRow}>
                            <span className={styles.detailLabel}>
                              <Fuel size={14} /> Gorivo na polasku:
                            </span>
                            <span className={`${styles.detailValue} ${styles.fuelBadge}`}>
                              {a.startFuelLevel}%
                            </span>
                          </div>
                        )}

                        {a.assignNotes && (
                          <div className={styles.detailRow} style={{ marginTop: '0.2rem' }}>
                            <span className={styles.detailLabel}>
                              <FileText size={14} /> Napomena:
                            </span>
                            <span
                              style={{
                                fontSize: '0.8rem',
                                color: 'var(--text-secondary)',
                                maxWidth: 170,
                                textAlign: 'right',
                              }}
                            >
                              {a.assignNotes}
                            </span>
                          </div>
                        )}
                      </div>

                      <button
                        className={styles.btnCheckin}
                        onClick={() => handleOpenCheckin(a)}
                        title="Razduži mašinu i upiši radne sate"
                      >
                        <CheckCircle2 size={16} />
                        <span>Razduži Mašinu (Kraj Smene)</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: NOVO ZADUŽENJE (CHECKOUT FORMA) */}
        {activeTab === 'checkout' && (
          <div className={styles.formCard}>
            <div>
              <h3 className={styles.formTitle}>
                <KeyRound size={20} color="#16a34a" />
                Jutarnje Zaduženje Mašine
              </h3>
              <p className={styles.formSubtitle}>
                Izaberite slobodan traktor ili priključak, radnika i lokaciju rada. Početni sati se automatski
                povlače sa mašine.
              </p>
            </div>

            <form onSubmit={handleCheckoutSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
              {/* Izbor mašine (isključivo slobodne mašine) */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Mašina / Traktor (Slobodne jedinice)</span>
                  <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 700 }}>
                    {freeMachines.length} slobodno
                  </span>
                </label>
                <select
                  className={styles.selectField}
                  value={checkoutMachineId}
                  onChange={(e) => handleSelectMachine(e.target.value)}
                  required
                >
                  <option value="">-- Izaberite slobodnu mašinu --</option>
                  {freeMachines.map((m: any) => (
                    <option key={m.id} value={m.id}>
                      🚜 {m.name} ({m.brandModel || m.type}) — Stanje: {m.currentHours} rh
                    </option>
                  ))}
                </select>
              </div>

              {/* Početni radni sati */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Početni radni sati (rh)</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Automatski popunjeno
                  </span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  className={styles.inputField}
                  value={checkoutStartHours}
                  onChange={(e) => setCheckoutStartHours(e.target.value)}
                  placeholder="0.0"
                  required
                />
              </div>

              {/* Radnik koji zadužuje */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Radnik (Traktorista / Vozač)</label>
                <select
                  className={styles.selectField}
                  value={checkoutWorkerId}
                  onChange={(e) => setCheckoutWorkerId(e.target.value)}
                  required
                >
                  <option value="">-- Izaberite radnika --</option>
                  {workersData?.workers?.map((w: any) => (
                    <option key={w.id} value={w.id}>
                      👤 {w.name} [{w.type}]
                    </option>
                  ))}
                </select>
              </div>

              {/* Opciona parcela */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Parcela / Odredište (opciono)</span>
                </label>
                <select
                  className={styles.selectField}
                  value={checkoutParcelId}
                  onChange={(e) => setCheckoutParcelId(e.target.value)}
                >
                  <option value="">-- Nije definisano / Razne lokacije --</option>
                  {parcelsData?.parcels?.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      [{p.code}] {p.name} ({p.areaHa} ha)
                    </option>
                  ))}
                </select>
              </div>

              {/* Početni nivo goriva */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  <span>Nivo goriva na polasku</span>
                  <span style={{ color: '#16a34a', fontWeight: 800 }}>{checkoutFuel}%</span>
                </label>
                <div className={styles.fuelPresetRow}>
                  {[100, 75, 50, 25].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      className={`${styles.fuelBtn} ${checkoutFuel === pct ? styles.fuelBtnActive : ''}`}
                      onClick={() => setCheckoutFuel(pct)}
                    >
                      {pct === 100 ? 'Pun (100%)' : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Napomena */}
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Napomena pri preuzimanju</label>
                <textarea
                  rows={2}
                  className={styles.inputField}
                  value={checkoutNotes}
                  onChange={(e) => setCheckoutNotes(e.target.value)}
                  placeholder="Npr. zakačena tanjirača, prekontrolisano ulje..."
                  style={{ resize: 'vertical' }}
                />
              </div>

              <button
                type="submit"
                className={styles.btnCheckoutSubmit}
                disabled={checkoutMutation.isPending || !checkoutMachineId || !checkoutWorkerId}
              >
                {checkoutMutation.isPending ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    <span>Zaduživanje u toku...</span>
                  </>
                ) : (
                  <>
                    <KeyRound size={18} />
                    <span>Potvrdi Zaduženje Mašine</span>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* TAB 3: ISTORIJAT ZADUŽENJA */}
        {activeTab === 'history' && (
          <div className={styles.tableCard}>
            <div className={styles.tableWrapper}>
              {loadingHistory ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                  <Loader2 size={32} className="spin" />
                </div>
              ) : historyList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  Nema zabeleženih zaduženja u istorijatu.
                </div>
              ) : (
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Datum i Vreme</th>
                      <th>Mašina</th>
                      <th>Radnik</th>
                      <th>Parcela</th>
                      <th>Početni rh</th>
                      <th>Krajnji rh</th>
                      <th>Napravljeno rh</th>
                      <th>Stanje Goriva</th>
                      <th>Status</th>
                      <th>Zabeleške</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyList.map((a: any) => {
                      const dateStr = new Date(a.assignedAt).toLocaleDateString('sr-RS');
                      const hoursDiff =
                        a.endHours && a.startHours
                          ? Math.round((a.endHours - a.startHours) * 10) / 10
                          : null;

                      return (
                        <tr key={a.id}>
                          <td>
                            <strong>{dateStr}</strong>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {new Date(a.assignedAt).toLocaleTimeString('sr-RS', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>
                          <td>
                            <strong>{a.machine?.name}</strong>
                          </td>
                          <td>{a.worker?.name}</td>
                          <td>{a.parcel ? `[${a.parcel.code}] ${a.parcel.name}` : '-'}</td>
                          <td>{a.startHours} rh</td>
                          <td>{a.endHours ? `${a.endHours} rh` : '-'}</td>
                          <td>
                            {hoursDiff !== null ? (
                              <strong style={{ color: '#2563eb' }}>+{hoursDiff} rh</strong>
                            ) : (
                              <span style={{ color: '#d97706' }}>U toku</span>
                            )}
                          </td>
                          <td>
                            {a.startFuelLevel !== null && (
                              <span>
                                {a.startFuelLevel}% {a.endFuelLevel !== null ? `-> ${a.endFuelLevel}%` : ''}
                              </span>
                            )}
                          </td>
                          <td>
                            <span
                              style={{
                                padding: '0.2rem 0.5rem',
                                borderRadius: 6,
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                backgroundColor:
                                  a.status === 'ZADUZENA'
                                    ? 'rgba(217, 119, 6, 0.15)'
                                    : a.status === 'RAZDUZENA'
                                    ? 'rgba(22, 163, 74, 0.15)'
                                    : 'rgba(239, 68, 68, 0.15)',
                                color:
                                  a.status === 'ZADUZENA'
                                    ? '#d97706'
                                    : a.status === 'RAZDUZENA'
                                    ? '#16a34a'
                                    : '#ef4444',
                              }}
                            >
                              {a.status === 'ZADUZENA'
                                ? 'Zadužena'
                                : a.status === 'RAZDUZENA'
                                ? 'Razdužena'
                                : 'Vraćena s kvarom'}
                            </span>
                          </td>
                          <td style={{ maxWidth: 220, color: 'var(--text-secondary)' }}>
                            {a.returnNotes || a.assignNotes || '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* MODAL ZA RAZDUŽIVANJE MAŠINE (CHECKIN) */}
        {checkinModalOpen && selectedAssignment && (
          <div className={styles.modalOverlay} onClick={() => setCheckinModalOpen(false)}>
            <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h3 className={styles.modalTitle}>
                  Razduživanje: {selectedAssignment.machine?.name}
                </h3>
                <button className={styles.modalCloseBtn} onClick={() => setCheckinModalOpen(false)}>
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleCheckinSubmit}>
                <div className={styles.modalBody}>
                  {/* Info o početnom stanju */}
                  <div
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      padding: '0.85rem 1rem',
                      borderRadius: 10,
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                    }}
                  >
                    <span>
                      Radnik: <strong>{selectedAssignment.worker?.name}</strong>
                    </span>
                    <span>
                      Početni sati: <strong>{selectedAssignment.startHours} rh</strong>
                    </span>
                  </div>

                  {/* Krajnji radni sati */}
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      <span>Krajnji radni sati (rh) sa sata mašine</span>
                      {hoursWorkedLive > 0 && (
                        <span style={{ color: '#2563eb', fontWeight: 800 }}>
                          +{hoursWorkedLive} rh urađeno
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min={selectedAssignment.startHours}
                      className={styles.inputField}
                      value={checkinEndHours}
                      onChange={(e) => setCheckinEndHours(e.target.value)}
                      placeholder={String(selectedAssignment.startHours)}
                      required
                    />
                  </div>

                  {/* Nivo goriva na povratku */}
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      <span>Nivo goriva na povratku</span>
                      <span style={{ color: '#16a34a', fontWeight: 800 }}>{checkinFuel}%</span>
                    </label>
                    <div className={styles.fuelPresetRow}>
                      {[100, 75, 50, 25, 10].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          className={`${styles.fuelBtn} ${checkinFuel === pct ? styles.fuelBtnActive : ''}`}
                          onClick={() => setCheckinFuel(pct)}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Prekidač ispravnosti mašine */}
                  <div
                    className={`${styles.operationalSwitch} ${
                      checkinOperational ? styles.operationalSwitchActive : styles.operationalSwitchBroken
                    }`}
                    onClick={() => setCheckinOperational(!checkinOperational)}
                  >
                    <input
                      type="checkbox"
                      checked={checkinOperational}
                      onChange={(e) => setCheckinOperational(e.target.checked)}
                      style={{ width: 18, height: 18, cursor: 'pointer' }}
                    />
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>
                        {checkinOperational ? 'Mašina je potpuno ispravna' : 'PRIJAVI KVAR / OŠTEĆENJE'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {checkinOperational
                          ? 'Vraća se u status SLOBODNA za sledećeg radnika'
                          : 'Prebacuje mašinu u status U_KVARU i obaveštava mehaničara'}
                      </div>
                    </div>
                  </div>

                  {/* Polje za opis kvara / napomenu */}
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>
                      {checkinOperational ? 'Napomena pri povratku' : 'OPIS KVARA / PROBLEMA (OBAVEZNO)'}
                    </label>
                    <textarea
                      rows={3}
                      className={styles.inputField}
                      value={checkinNotes}
                      onChange={(e) => setCheckinNotes(e.target.value)}
                      placeholder={
                        checkinOperational
                          ? 'Opciono: zapažanja, pritisak u gumama...'
                          : 'Opišite kvar: npr. curi hidraulično crevo, čuje se ležaj...'
                      }
                      required={!checkinOperational}
                    />
                  </div>
                </div>

                <div className={styles.modalFooter}>
                  <button
                    type="button"
                    className={styles.fuelBtn}
                    style={{ padding: '0.6rem 1rem' }}
                    onClick={() => setCheckinModalOpen(false)}
                  >
                    Otkaži
                  </button>
                  <button
                    type="submit"
                    className={styles.btnCheckin}
                    style={{ width: 'auto', padding: '0.65rem 1.5rem' }}
                    disabled={checkinMutation.isPending}
                  >
                    {checkinMutation.isPending ? 'Razduživanje...' : 'Potvrdi Razduživanje'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default MasineZaduzenje;
