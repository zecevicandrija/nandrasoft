import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  ShieldCheck,
  ClipboardList,
  Package,
  Wrench,
  HardHat,
  AlertCircle,
  Settings,
  Database,
  LogOut,
  Loader2,
  Tractor,
  PlusCircle,
  KeyRound,
  MapPin,
  Play,
  Fuel,
  X,
} from 'lucide-react';
import styles from './PocetniEkran.module.css';
import { signIn, signOut, useSession } from './lib/auth-client';
import ThemeToggle from './components/ThemeToggle';

const ROLE_LABELS: Record<string, string> = {
  DIREKTOR: 'Direktor / Administrator',
  RUKOVODILAC: 'Rukovodilac / Proizvodnja',
  MAGACIN: 'Magacioner / Skladište',
  MEHANICAR: 'Mehaničar / Održavanje',
  OPERATER: 'Operater / Radnik',
};

export const getRoleIcon = (role: string, size = 18) => {
  switch (role) {
    case 'DIREKTOR':
      return <ShieldCheck size={size} />;
    case 'RUKOVODILAC':
      return <ClipboardList size={size} />;
    case 'MAGACIN':
      return <Package size={size} />;
    case 'MEHANICAR':
      return <Wrench size={size} />;
    case 'OPERATER':
    default:
      return <HardHat size={size} />;
  }
};

const TEST_ACCOUNTS = [
  { email: 'direktor@nandra.rs', role: 'DIREKTOR' },
  { email: 'rukovodilac@nandra.rs', role: 'RUKOVODILAC' },
  { email: 'magacin@nandra.rs', role: 'MAGACIN' },
  { email: 'mehanicar@nandra.rs', role: 'MEHANICAR' },
  { email: 'operater@nandra.rs', role: 'OPERATER' },
];

const PocetniEkran: React.FC = () => {
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [todayOrder, setTodayOrder] = useState<any | null>(null);

  // Accept modal state
  const [isAcceptOpen, setIsAcceptOpen] = useState(false);
  const [acceptFuelLiters, setAcceptFuelLiters] = useState<string | number>('');
  const [acceptHours, setAcceptHours] = useState<string | number>('');
  const [acceptNotes, setAcceptNotes] = useState('');
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [acceptError, setAcceptError] = useState('');

  const fetchTodayOrder = () => {
    const user = (session as any)?.user;
    if (user) {
      fetch('http://localhost:5000/api/work-orders/my-today', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.todayOrder) {
            setTodayOrder(data.todayOrder);
          } else {
            setTodayOrder(null);
          }
        })
        .catch((err) => console.error('Greška pri dohvatanju današnjeg naloga:', err));
    }
  };

  // Dohvati današnji nalog za radnika
  useEffect(() => {
    fetchTodayOrder();
  }, [session]);

  const handleOpenAcceptModal = (order: any) => {
    setIsAcceptOpen(true);
    setAcceptError('');
    const cap = order.machine?.tankCapacityLiters || 200;
    const curFuel =
      order.machine?.currentFuelLiters !== undefined && order.machine.currentFuelLiters > 0
        ? order.machine.currentFuelLiters
        : cap;
    setAcceptFuelLiters(curFuel);
    setAcceptHours(order.machine?.currentHours || 0);
    setAcceptNotes('');
  };

  const handleConfirmAcceptOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!todayOrder) return;
    setAcceptError('');
    setAcceptLoading(true);

    try {
      const res = await fetch(`http://localhost:5000/api/work-orders/${todayOrder.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          startFuelLiters: parseFloat(String(acceptFuelLiters)) || 0,
          startHours: acceptHours !== '' ? parseFloat(String(acceptHours)) : null,
          notes: acceptNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Greška pri prihvatanju radnog naloga.');
      }

      setIsAcceptOpen(false);
      fetchTodayOrder();
    } catch (err: any) {
      setAcceptError(err.message);
    } finally {
      setAcceptLoading(false);
    }
  };

  // Ako je ulogovan kao DIREKTOR, automatski preusmeri na /admin
  useEffect(() => {
    const user = (session as any)?.user;
    if (!isPending && user && user.role === 'DIREKTOR') {
      navigate('/admin');
    }
  }, [isPending, session, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn.email({
        email,
        password,
      });

      if (result.error) {
        setError(result.error.message || 'Neuspešna prijava. Proverite podatke.');
      }
    } catch (err: any) {
      setError(err?.message || 'Greška prilikom povezivanja sa serverom.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = (testEmail: string) => {
    setEmail(testEmail);
    setPassword('nandra123');
    setError('');
  };

  const handleLogout = async () => {
    await signOut({});
  };

  // Loading state
  if (isPending) {
    return (
      <div className={styles.loadingPage}>
        <Loader2 className={styles.loadingSpinnerLarge} size={38} />
      </div>
    );
  }

  // Logged in view
  const user = (session as any)?.user;
  if (user) {
    const role = user.role || 'OPERATER';
    const initials = user.name
      ? user.name
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
      : '?';

    return (
      <div className={styles.pageContainer}>
        <div className={styles.themeToggleCorner}>
          <ThemeToggle showLabel />
        </div>

        <div className={styles.profileCard}>
          <div className={styles.profileAvatar}>{initials}</div>
          <h2 className={styles.profileName}>{user.name}</h2>
          <p className={styles.profileEmail}>{user.email}</p>

          <div className={`${styles.roleBadge} ${styles[`role${role}`]}`}>
            <span className={styles.roleIconWrapper}>{getRoleIcon(role, 16)}</span>
            <span>{ROLE_LABELS[role] || role}</span>
          </div>

          {todayOrder && (
            <div
              style={{
                width: '100%',
                background:
                  todayOrder.status === 'U_TOKU'
                    ? 'rgba(2, 132, 199, 0.08)'
                    : 'rgba(22, 163, 74, 0.08)',
                border: `2px solid ${todayOrder.status === 'U_TOKU' ? '#0284c7' : '#16a34a'}`,
                borderRadius: '12px',
                padding: '1rem',
                margin: '1rem 0',
                textAlign: 'left',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  color: todayOrder.status === 'U_TOKU' ? '#0284c7' : '#15803d',
                  fontWeight: 700,
                  marginBottom: '0.5rem',
                }}
              >
                {todayOrder.status === 'U_TOKU' ? (
                  <>
                    <Play size={20} />
                    <span>RADNI NALOG JE U TOKU — MAŠINA ZADUŽENA</span>
                  </>
                ) : (
                  <>
                    <ClipboardList size={20} />
                    <span>DODELJEN RADNI ZADATAK ZA DANAS!</span>
                  </>
                )}
              </div>
              <div
                style={{
                  fontSize: '0.9rem',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.25rem',
                }}
              >
                {todayOrder.machine && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Tractor size={16} color="var(--primary, #16a34a)" />
                    <span>
                      <strong>Mašina:</strong> {todayOrder.machine.name}
                    </span>
                  </div>
                )}
                {todayOrder.machineAssignments &&
                  todayOrder.machineAssignments.length > 0 &&
                  todayOrder.machineAssignments[0].startFuelLiters !== undefined && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#0284c7' }}>
                      <Fuel size={16} />
                      <span>
                        Zaduženo gorivo: <strong>{todayOrder.machineAssignments[0].startFuelLiters} L</strong>
                      </span>
                    </div>
                  )}
                {todayOrder.parcel && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <MapPin size={16} color="#0284c7" />
                    <span>
                      <strong>Parcela:</strong> {todayOrder.parcel.name}
                    </span>
                  </div>
                )}
                {todayOrder.workType && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Wrench size={16} color="#d97706" />
                    <span>
                      <strong>Posao:</strong> {todayOrder.workType.name}{' '}
                      {todayOrder.plannedAreaHa ? `(Plan: ${todayOrder.plannedAreaHa} ha)` : ''}
                    </span>
                  </div>
                )}
                {todayOrder.instructions && (
                  <div
                    style={{
                      fontStyle: 'italic',
                      color: 'var(--text-secondary)',
                      marginTop: '0.25rem',
                    }}
                  >
                    "{todayOrder.instructions}"
                  </div>
                )}
              </div>

              {todayOrder.status === 'U_TOKU' ? (
                <Link
                  to={`/radovi/novi?orderId=${todayOrder.id}&parcelId=${todayOrder.parcelId || ''}&machineId=${
                    todayOrder.machineId || ''
                  }&workTypeId=${todayOrder.workTypeId || ''}&workerId=${todayOrder.workerId}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    marginTop: '0.75rem',
                    padding: '0.7rem 1rem',
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                    borderRadius: '6px',
                    fontWeight: 700,
                    textDecoration: 'none',
                    boxShadow: '0 2px 4px rgba(22, 163, 74, 0.2)',
                  }}
                >
                  <Play size={16} />
                  <span>Prijavi rad na njivi i razduži mašinu</span>
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => handleOpenAcceptModal(todayOrder)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    marginTop: '0.75rem',
                    padding: '0.7rem 1rem',
                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                    color: '#ffffff',
                    borderRadius: '6px',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
                  }}
                >
                  <KeyRound size={16} />
                  <span>Prihvati nalog i zaduži mašinu</span>
                </button>
              )}
            </div>
          )}

          {/* Modal za prihvatanje naloga na početnom ekranu */}
          {isAcceptOpen && todayOrder && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.6)',
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                backdropFilter: 'blur(3px)',
              }}
              onClick={() => setIsAcceptOpen(false)}
            >
              <div
                style={{
                  background: 'var(--card-bg, #ffffff)',
                  borderRadius: '12px',
                  width: '100%',
                  maxWidth: '500px',
                  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.3)',
                  overflow: 'hidden',
                  textAlign: 'left',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    borderBottom: '1px solid var(--border-color, #e5e7eb)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      fontSize: '1.15rem',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <KeyRound size={20} color="#0284c7" />
                    Zaduženje Mašine za Nalog
                  </h3>
                  <button
                    onClick={() => setIsAcceptOpen(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>

                {acceptError && (
                  <div style={{ padding: '0.75rem 1.25rem', background: '#fee2e2', color: '#b91c1c' }}>
                    {acceptError}
                  </div>
                )}

                <form onSubmit={handleConfirmAcceptOrder} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {todayOrder.machine && (
                    <div
                      style={{
                        background: 'var(--bg-hover, #f8fafc)',
                        padding: '0.75rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color, #e2e8f0)',
                      }}
                    >
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                        {todayOrder.machine.name}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Kapacitet rezervoara: <strong>{todayOrder.machine.tankCapacityLiters || 200} L</strong> | Radni sati: <strong>{todayOrder.machine.currentHours || 0} rh</strong>
                      </div>
                    </div>
                  )}

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                      Početno stanje goriva u rezervoaru (litara) *
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max={todayOrder.machine?.tankCapacityLiters || 1000}
                      style={{
                        width: '100%',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '6px',
                        border: '1.5px solid var(--border-color, #e5e7eb)',
                        fontSize: '0.95rem',
                        boxSizing: 'border-box',
                      }}
                      placeholder="npr. 180"
                      value={acceptFuelLiters}
                      onChange={(e) => setAcceptFuelLiters(e.target.value)}
                      required
                    />
                    {todayOrder.machine?.tankCapacityLiters && (
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => setAcceptFuelLiters(todayOrder.machine.tankCapacityLiters)}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
                        >
                          Pun (100%)
                        </button>
                        <button
                          type="button"
                          onClick={() => setAcceptFuelLiters(Math.round(todayOrder.machine.tankCapacityLiters * 0.75))}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
                        >
                          3/4 (75%)
                        </button>
                        <button
                          type="button"
                          onClick={() => setAcceptFuelLiters(Math.round(todayOrder.machine.tankCapacityLiters * 0.5))}
                          style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
                        >
                          Pola (50%)
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                      Početni radni sati mašine (rh)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      style={{
                        width: '100%',
                        padding: '0.65rem 0.85rem',
                        borderRadius: '6px',
                        border: '1.5px solid var(--border-color, #e5e7eb)',
                        fontSize: '0.95rem',
                        boxSizing: 'border-box',
                      }}
                      value={acceptHours}
                      onChange={(e) => setAcceptHours(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
                      Napomena pri preuzimanju (opciono)
                    </label>
                    <textarea
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        border: '1.5px solid var(--border-color, #e5e7eb)',
                        fontSize: '0.85rem',
                        boxSizing: 'border-box',
                        minHeight: '60px',
                      }}
                      placeholder="npr. Provereni nivoi tečnosti, sve u redu"
                      value={acceptNotes}
                      onChange={(e) => setAcceptNotes(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setIsAcceptOpen(false)}
                      style={{ padding: '0.6rem 1rem', background: 'transparent', border: '1px solid #e5e7eb', borderRadius: '6px', cursor: 'pointer' }}
                    >
                      Odustani
                    </button>
                    <button
                      type="submit"
                      disabled={acceptLoading}
                      style={{
                        padding: '0.6rem 1.25rem',
                        background: '#0284c7',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {acceptLoading ? 'Zaduživanje...' : 'Potvrdi i Zaduži mašinu'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          <div className={styles.actionButtonsCol}>
            <Link to="/nalozi" className={styles.adminBtn} style={{ backgroundColor: '#0284c7', color: '#ffffff' }}>
              <ClipboardList size={18} />
              Radni nalozi & Dispečing
            </Link>

            <Link to="/radovi" className={styles.adminBtn} style={{ backgroundColor: '#16a34a', color: '#ffffff' }}>
              <Tractor size={18} />
              Dnevnik radova na njivi
            </Link>

            <Link to="/radovi/novi" className={styles.adminBtn} style={{ backgroundColor: 'rgba(22, 163, 74, 0.12)', color: '#16a34a' }}>
              <PlusCircle size={18} />
              Brzi mobilni unos rada
            </Link>

            <Link to="/gorivo" className={styles.adminBtn} style={{ backgroundColor: 'rgba(2, 132, 199, 0.12)', color: '#0284c7' }}>
              <Fuel size={18} />
              Evidencija goriva & Cisterna
            </Link>

            <Link to="/masine/zaduzenje" className={styles.adminBtn} style={{ backgroundColor: 'rgba(217, 119, 6, 0.12)', color: '#d97706' }}>
              <KeyRound size={18} />
              Zaduženje / Razduženje mašina
            </Link>

            {['DIREKTOR', 'RUKOVODILAC', 'MAGACIN'].includes(role) && (
              <Link to="/sifarnici" className={styles.adminBtn}>
                <Database size={18} />
                Šifarnici
              </Link>
            )}

            {role === 'DIREKTOR' && (
              <Link to="/admin" className={styles.adminBtn}>
                <Settings size={18} />
                Korisnički nalozi
              </Link>
            )}
          </div>

          <button className={styles.logoutBtn} onClick={handleLogout}>
            <LogOut size={18} />
            Odjavi se
          </button>
        </div>
      </div>
    );
  }

  // Login form
  return (
    <div className={styles.pageContainer}>
      <div className={styles.themeToggleCorner}>
        <ThemeToggle showLabel />
      </div>

      <div className={styles.loginCard}>
        <div className={styles.loginBrand}>
          <div className={styles.loginLogo}>
            <Building2 size={24} />
          </div>
          <div className={styles.loginBrandText}>
            <span className={styles.loginBrandName}>NANDRA</span>
            <span className={styles.loginBrandTag}>SOFTVER</span>
          </div>
        </div>

        {error && (
          <div className={styles.errorBox}>
            <AlertCircle size={18} className={styles.errorIcon} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className={styles.form}>
          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="email">
              Email adresa
            </label>
            <input
              id="email"
              className={styles.formInput}
              type="email"
              placeholder="korisnik@nandra.rs"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.formLabel} htmlFor="password">
              Lozinka
            </label>
            <input
              id="password"
              className={styles.formInput}
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={loading || !email || !password}
          >
            {loading && <Loader2 className={styles.btnSpinner} size={18} />}
            {loading ? 'Prijavljivanje...' : 'Prijavi se'}
          </button>
        </form>

        <div className={styles.quickRolesSection}>
          <div className={styles.quickRolesTitle}>Brzi test nalozi</div>
          <div className={styles.quickRolesGrid}>
            {TEST_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                className={styles.roleBtn}
                onClick={() => handleQuickLogin(account.email)}
                type="button"
                title={account.email}
              >
                <span className={styles.roleBtnIcon}>
                  {getRoleIcon(account.role, 16)}
                </span>
                <span className={styles.roleBtnText}>{account.role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PocetniEkran;
