import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Tractor,
  Fuel,
  Wrench,
  Package,
  Users,
  Database,
  ShieldCheck,
  Menu,
  X,
  LogOut,
  LayoutDashboard,
  Sprout,
} from 'lucide-react';
import { useSession, signOut } from '../../lib/auth-client';
import ThemeToggle from '../ThemeToggle';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children: React.ReactNode;
  pageTitle?: string;
}

interface NavItem {
  title: string;
  to: string;
  icon: React.ReactNode;
  allowedRoles: string[];
}

interface NavGroup {
  groupName: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    groupName: 'Operativa & Njiva',
    items: [
      {
        title: 'Dashboard',
        to: '/',
        icon: <LayoutDashboard size={18} />,
        allowedRoles: ['DIREKTOR', 'RUKOVODILAC'],
      },
      {
        title: 'Radovi na njivi',
        to: '/radovi',
        icon: <Tractor size={18} />,
        allowedRoles: ['DIREKTOR', 'RUKOVODILAC', 'OPERATER'],
      },
      {
        title: 'Evidencija goriva',
        to: '/gorivo',
        icon: <Fuel size={18} />,
        allowedRoles: ['DIREKTOR', 'RUKOVODILAC', 'MEHANICAR', 'OPERATER'],
      },
      {
        title: 'Mašine & Kvarovi',
        to: '/masine-kvarovi',
        icon: <Wrench size={18} />,
        allowedRoles: ['DIREKTOR', 'RUKOVODILAC', 'MEHANICAR', 'OPERATER'],
      },
    ],
  },
  {
    groupName: 'Skladište & Proizvodnja',
    items: [
      {
        title: 'Đubrivo & Zalihe',
        to: '/magacin-djubrivo',
        icon: <Package size={18} />,
        allowedRoles: ['DIREKTOR', 'RUKOVODILAC', 'MAGACIN'],
      },
      {
        title: 'Modul Luk & Hladnjača',
        to: '/modul-luk',
        icon: <Sprout size={18} />,
        allowedRoles: ['DIREKTOR', 'RUKOVODILAC', 'MAGACIN'],
      },
      {
        title: 'Sezonski radnici',
        to: '/sezonci',
        icon: <Users size={18} />,
        allowedRoles: ['DIREKTOR', 'RUKOVODILAC'],
      },
    ],
  },
  {
    groupName: 'Sistem & Podaci',
    items: [
      {
        title: 'Šifarnici (Master Data)',
        to: '/sifarnici',
        icon: <Database size={18} />,
        allowedRoles: ['DIREKTOR', 'RUKOVODILAC', 'MAGACIN'],
      },
      {
        title: 'Korisnički nalozi',
        to: '/admin',
        icon: <ShieldCheck size={18} />,
        allowedRoles: ['DIREKTOR'],
      },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  DIREKTOR: 'Direktor',
  RUKOVODILAC: 'Rukovodilac',
  MAGACIN: 'Magacioner',
  MEHANICAR: 'Mehaničar',
  OPERATER: 'Operater',
};

const AppLayout: React.FC<AppLayoutProps> = ({ children, pageTitle }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentUser = (session as any)?.user;
  const userRole = currentUser?.role || 'OPERATER';

  const handleLogout = async () => {
    await signOut({});
    navigate('/');
  };

  // Filtriraj grupe i linkove na osnovu RBAC uloge korisnika
  const filteredNavGroups = NAV_GROUPS.map((group) => ({
    groupName: group.groupName,
    items: group.items.filter((item) => item.allowedRoles.includes(userRole)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className={styles.layoutContainer}>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div className={styles.mobileOverlay} onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${mobileOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarHeader}>
          <div className={styles.brandLogo}>
            <Tractor size={22} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>NANDRA</span>
            <span className={styles.brandSub}>Agro Proizvodnja</span>
          </div>
        </div>

        <nav className={styles.sidebarNav}>
          {filteredNavGroups.map((group) => (
            <div key={group.groupName} className={styles.navSection}>
              <div className={styles.navSectionTitle}>{group.groupName}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `${styles.navLink} ${
                      isActive || (item.to !== '/' && location.pathname.startsWith(item.to))
                        ? styles.navLinkActive
                        : ''
                    }`
                  }
                >
                  <span className={styles.navLinkIcon}>{item.icon}</span>
                  <span>{item.title}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.userInfoCompact}>
            <span className={styles.userNameCompact}>{currentUser?.name || 'Korisnik'}</span>
            <span className={styles.userRoleCompact}>{ROLE_LABELS[userRole] || userRole}</span>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={styles.mainWrapper}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              className={styles.mobileMenuBtn}
              onClick={() => setMobileOpen(!mobileOpen)}
              title="Otvori navigaciju"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <h1 className={styles.pageHeading}>{pageTitle || 'NANDRA Software'}</h1>
          </div>

          <div className={styles.topbarRight}>
            <div className={styles.userPill}>
              <span>{currentUser?.name}</span>
              <span
                className={`${styles.userRoleBadge} ${
                  styles[`role${userRole}` as keyof typeof styles] || ''
                }`}
              >
                {ROLE_LABELS[userRole] || userRole}
              </span>
            </div>

            <button className={styles.logoutBtn} onClick={handleLogout} title="Odjavi se">
              <LogOut size={16} />
              <span>Odjava</span>
            </button>
          </div>
        </header>

        <main className={styles.pageContent}>{children}</main>
      </div>
    </div>
  );
};

export default AppLayout;
