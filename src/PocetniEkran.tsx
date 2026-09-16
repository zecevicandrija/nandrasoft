import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  ShieldCheck,
  ClipboardList,
  Package,
  Wrench,
  HardHat,
  CheckCircle2,
  AlertCircle,
  Settings,
  Database,
  LogOut,
  Loader2,
  Tractor,
  PlusCircle,
  KeyRound,
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

          <div className={styles.profileMeta}>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Uloga sistema</span>
              <span className={styles.metaValue}>{role}</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Korisnički ID</span>
              <span className={styles.metaValue}>{user.id?.slice(0, 14)}...</span>
            </div>
            <div className={styles.metaRow}>
              <span className={styles.metaLabel}>Status naloga</span>
              <span className={styles.statusActiveBadge}>
                <CheckCircle2 size={14} />
                Aktivan
              </span>
            </div>
          </div>

          <div className={styles.actionButtonsCol}>
            <Link to="/radovi" className={styles.adminBtn} style={{ backgroundColor: '#16a34a', color: '#ffffff' }}>
              <Tractor size={18} />
              Dnevnik radova na njivi
            </Link>

            <Link to="/radovi/novi" className={styles.adminBtn} style={{ backgroundColor: 'rgba(22, 163, 74, 0.12)', color: '#16a34a' }}>
              <PlusCircle size={18} />
              Brzi mobilni unos rada
            </Link>

            <Link to="/masine/zaduzenje" className={styles.adminBtn} style={{ backgroundColor: 'rgba(217, 119, 6, 0.12)', color: '#d97706' }}>
              <KeyRound size={18} />
              Zaduženje / Razduženje mašina
            </Link>

            {['DIREKTOR', 'RUKOVODILAC', 'MAGACIN'].includes(role) && (
              <Link to="/sifarnici" className={styles.adminBtn}>
                <Database size={18} />
                Šifarnici (Master Data)
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
            <span className={styles.loginBrandTag}>Upravljanje Proizvodnjom</span>
          </div>
        </div>

        <p className={styles.loginSubtitle}>
          Prijavite se na sistem za evidenciju proizvodnje, mašina, radnika i zaliha.
        </p>

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
