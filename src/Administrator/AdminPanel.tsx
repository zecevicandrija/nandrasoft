import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  ClipboardList,
  Package,
  Wrench,
  HardHat,
  Users,
  UserCheck,
  UserX,
  UserPlus,
  Search,
  Pencil,
  KeyRound,
  Trash2,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Filter,
} from 'lucide-react';
import { useSession } from '../lib/auth-client';
import AppLayout from '../components/Layout/AppLayout';
import styles from './AdminPanel.module.css';

const API = 'http://localhost:5000/api';

const ROLES = ['DIREKTOR', 'RUKOVODILAC', 'MAGACIN', 'MEHANICAR', 'OPERATER'] as const;

const ROLE_LABELS: Record<string, string> = {
  DIREKTOR: 'Direktor',
  RUKOVODILAC: 'Rukovodilac',
  MAGACIN: 'Magacioner',
  MEHANICAR: 'Mehaničar',
  OPERATER: 'Operater',
};

const getRoleIcon = (role: string, size = 15) => {
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

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  pin: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type ModalMode = null | 'add' | 'edit' | 'password' | 'delete';

interface Toast {
  message: string;
  type: 'success' | 'error';
}

const AdminPanel: React.FC = () => {
  const navigate = useNavigate();
  const { data: session, isPending: sessionLoading } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedRole, setSelectedRole] = useState<string>('ALL');
  const [toast, setToast] = useState<Toast | null>(null);

  // Modal state
  const [modal, setModal] = useState<ModalMode>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formRole, setFormRole] = useState('OPERATER');
  const [formPhone, setFormPhone] = useState('');
  const [formPin, setFormPin] = useState('');
  const [formPassword, setFormPassword] = useState('');

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch(`${API}/users`, { credentials: 'include' });
      if (!res.ok) throw new Error('Greška pri dohvatanju korisnika');
      const data = await res.json();
      setUsers(data.users);
    } catch (err: any) {
      showToast(err.message || 'Greška na serveru', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Zaštita rute: samo ulogovani DIREKTOR može da vidi admin panel
  useEffect(() => {
    if (!sessionLoading) {
      const user = (session as any)?.user;
      if (!user) {
        navigate('/');
      } else if (user.role !== 'DIREKTOR') {
        navigate('/');
      } else {
        fetchUsers();
      }
    }
  }, [sessionLoading, session, fetchUsers, navigate]);

  // Filter users by search and role
  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch =
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q);
    const matchesRole = selectedRole === 'ALL' || u.role === selectedRole;
    return matchesSearch && matchesRole;
  });

  // Stats
  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.isActive).length;
  const direktorCount = users.filter((u) => u.role === 'DIREKTOR').length;
  const inactiveUsers = users.filter((u) => !u.isActive).length;

  // Modal handlers
  const openAddModal = () => {
    setFormName('');
    setFormEmail('');
    setFormRole('OPERATER');
    setFormPhone('');
    setFormPin('');
    setFormPassword('');
    setSelectedUser(null);
    setModal('add');
  };

  const openEditModal = (user: User) => {
    setFormName(user.name);
    setFormEmail(user.email);
    setFormRole(user.role);
    setFormPhone(user.phone || '');
    setFormPin(user.pin || '');
    setSelectedUser(user);
    setModal('edit');
  };

  const openPasswordModal = (user: User) => {
    setFormPassword('');
    setSelectedUser(user);
    setModal('password');
  };

  const openDeleteModal = (user: User) => {
    setSelectedUser(user);
    setModal('delete');
  };

  const closeModal = () => {
    setModal(null);
    setSelectedUser(null);
    setSaving(false);
  };

  // CRUD actions
  const handleAddUser = async () => {
    if (!formName || !formEmail || !formPassword) {
      showToast('Ime, email i lozinka su obavezni.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/users`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          email: formEmail,
          password: formPassword,
          role: formRole,
          phone: formPhone || undefined,
          pin: formPin || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška');
      showToast(`Korisnik ${formName} uspešno kreiran.`, 'success');
      closeModal();
      fetchUsers();
    } catch (err: any) {
      showToast(err.message, 'error');
      setSaving(false);
    }
  };

  const handleEditUser = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/users/${selectedUser.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formName,
          email: formEmail,
          role: formRole,
          phone: formPhone || null,
          pin: formPin || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška');
      showToast(`Korisnik ${formName} ažuriran.`, 'success');
      closeModal();
      fetchUsers();
    } catch (err: any) {
      showToast(err.message, 'error');
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!selectedUser || !formPassword) return;
    if (formPassword.length < 6) {
      showToast('Lozinka mora imati najmanje 6 karaktera.', 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/users/${selectedUser.id}/password`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: formPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška');
      showToast(`Lozinka za ${selectedUser.name} promenjena.`, 'success');
      closeModal();
    } catch (err: any) {
      showToast(err.message, 'error');
      setSaving(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/users/${selectedUser.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Greška');
      showToast(`Korisnik ${selectedUser.name} obrisan.`, 'success');
      closeModal();
      fetchUsers();
    } catch (err: any) {
      showToast(err.message, 'error');
      setSaving(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('sr-Latn-RS', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  // Loading
  if (sessionLoading || loading) {
    return (
      <AppLayout pageTitle="Korisnički Nalozi & Administracija">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh', gap: '0.75rem', color: 'var(--text-muted)' }}>
          <Loader2 className="animate-spin" size={32} />
          <span>Učitavanje korisnika...</span>
        </div>
      </AppLayout>
    );
  }

  const currentUser = (session as any)?.user;

  return (
    <AppLayout pageTitle="Korisnički Nalozi & Administracija">
      {/* Toast notification */}
      {toast && (
        <div
          className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError
            }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 size={18} className={styles.toastIcon} />
          ) : (
            <AlertCircle size={18} className={styles.toastIcon} />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Main content */}
      <div className={styles.mainContent}>
        {/* Stats */}
        <div className={styles.statsBar}>
          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconUsers}`}>
              <Users size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{totalUsers}</div>
              <div className={styles.statLabel}>Ukupno korisnika</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconActive}`}>
              <UserCheck size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{activeUsers}</div>
              <div className={styles.statLabel}>Aktivnih</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconDirektor}`}>
              <ShieldCheck size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{direktorCount}</div>
              <div className={styles.statLabel}>Direktora</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.statIcon} ${styles.statIconInactive}`}>
              <UserX size={22} />
            </div>
            <div className={styles.statInfo}>
              <div className={styles.statValue}>{inactiveUsers}</div>
              <div className={styles.statLabel}>Neaktivnih</div>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <div className={styles.searchBox}>
              <Search size={18} className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                type="text"
                placeholder="Pretraži korisnike po imenu, emailu..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className={styles.filterBox}>
              <Filter size={16} className={styles.filterIcon} />
              <select
                className={styles.filterSelect}
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                aria-label="Filter po ulozi"
              >
                <option value="ALL">Sve uloge ({users.length})</option>
                {ROLES.map((r) => {
                  const count = users.filter((u) => u.role === r).length;
                  return (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <button className={styles.addBtn} onClick={openAddModal}>
            <UserPlus size={18} />
            <span>Dodaj korisnika</span>
          </button>
        </div>

        {/* Users table */}
        <div className={styles.tableWrapper}>
          {filteredUsers.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <Users size={44} />
              </div>
              <div className={styles.emptyText}>Nema pronađenih korisnika</div>
              <div className={styles.emptySubtext}>
                {search ? 'Promenite kriterijum pretrage' : 'Dodajte prvog korisnika'}
              </div>
            </div>
          ) : (
            <table className={styles.usersTable}>
              <thead>
                <tr>
                  <th>Korisnik</th>
                  <th>Uloga</th>
                  <th>Status</th>
                  <th>Kreiran</th>
                  <th>Telefon</th>
                  <th className={styles.thActions}>Akcije</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className={styles.userCell}>
                        <div className={styles.userAvatar}>
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className={styles.userName}>{user.name}</span>
                          <span className={styles.userEmail}>{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`${styles.rolePill} ${styles[`role${user.role}` as keyof typeof styles] || ''
                          }`}
                      >
                        <span className={styles.rolePillIcon}>
                          {getRoleIcon(user.role, 14)}
                        </span>
                        <span>{ROLE_LABELS[user.role] || user.role}</span>
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          user.isActive ? styles.statusActive : styles.statusInactive
                        }
                      >
                        <span className={styles.statusDot} />
                        {user.isActive ? 'Aktivan' : 'Neaktivan'}
                      </span>
                    </td>
                    <td>
                      <span className={styles.dateText}>
                        {formatDate(user.createdAt)}
                      </span>
                    </td>
                    <td>
                      <span className={styles.dateText}>
                        {user.phone || '—'}
                      </span>
                    </td>
                    <td className={styles.tdActions}>
                      <div className={styles.actionBtns}>
                        <button
                          className={styles.actionBtn}
                          onClick={() => openEditModal(user)}
                          title="Izmeni korisnika"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnPassword}`}
                          onClick={() => openPasswordModal(user)}
                          title="Promeni lozinku"
                        >
                          <KeyRound size={15} />
                        </button>
                        <button
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          onClick={() => openDeleteModal(user)}
                          title="Obriši korisnika"
                          disabled={user.id === currentUser?.id}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ===== ADD USER MODAL ===== */}
      {modal === 'add' && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleBox}>
                <UserPlus size={20} />
                <h3 className={styles.modalTitle}>Novi korisnik</h3>
              </div>
              <button className={styles.modalClose} onClick={closeModal} title="Zatvori">
                <X size={18} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.mFormGroup}>
                <label className={styles.mFormLabel}>Ime i prezime</label>
                <input
                  className={styles.mFormInput}
                  type="text"
                  placeholder="Petar Petrović"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className={styles.mFormGroup}>
                <label className={styles.mFormLabel}>Email adresa</label>
                <input
                  className={styles.mFormInput}
                  type="email"
                  placeholder="petar@nandra.rs"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                />
              </div>
              <div className={styles.mFormGroup}>
                <label className={styles.mFormLabel}>Lozinka</label>
                <input
                  className={styles.mFormInput}
                  type="password"
                  placeholder="Minimalno 6 karaktera"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                />
              </div>
              <div className={styles.mFormRow}>
                <div className={styles.mFormGroup}>
                  <label className={styles.mFormLabel}>Uloga</label>
                  <select
                    className={styles.mFormSelect}
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.mFormGroup}>
                  <label className={styles.mFormLabel}>Telefon</label>
                  <input
                    className={styles.mFormInput}
                    type="text"
                    placeholder="+381..."
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.mFormGroup}>
                <label className={styles.mFormLabel}>PIN (opciono)</label>
                <input
                  className={styles.mFormInput}
                  type="text"
                  placeholder="4-cifreni PIN"
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value)}
                  maxLength={4}
                />
              </div>
              <div className={styles.modalActions}>
                <button className={styles.modalCancelBtn} onClick={closeModal} type="button">
                  Otkaži
                </button>
                <button
                  className={styles.modalSaveBtn}
                  onClick={handleAddUser}
                  disabled={saving || !formName || !formEmail || !formPassword}
                  type="button"
                >
                  {saving && <Loader2 className={styles.btnSpinner} size={16} />}
                  {saving ? 'Kreiranje...' : 'Kreiraj korisnika'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== EDIT USER MODAL ===== */}
      {modal === 'edit' && selectedUser && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleBox}>
                <Pencil size={20} />
                <h3 className={styles.modalTitle}>Izmeni korisnika</h3>
              </div>
              <button className={styles.modalClose} onClick={closeModal} title="Zatvori">
                <X size={18} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.mFormGroup}>
                <label className={styles.mFormLabel}>Ime i prezime</label>
                <input
                  className={styles.mFormInput}
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className={styles.mFormGroup}>
                <label className={styles.mFormLabel}>Email adresa</label>
                <input
                  className={styles.mFormInput}
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                />
              </div>
              <div className={styles.mFormRow}>
                <div className={styles.mFormGroup}>
                  <label className={styles.mFormLabel}>Uloga</label>
                  <select
                    className={styles.mFormSelect}
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.mFormGroup}>
                  <label className={styles.mFormLabel}>Telefon</label>
                  <input
                    className={styles.mFormInput}
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                  />
                </div>
              </div>
              <div className={styles.mFormGroup}>
                <label className={styles.mFormLabel}>PIN</label>
                <input
                  className={styles.mFormInput}
                  type="text"
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value)}
                  maxLength={4}
                />
              </div>
              <div className={styles.modalActions}>
                <button className={styles.modalCancelBtn} onClick={closeModal} type="button">
                  Otkaži
                </button>
                <button
                  className={styles.modalSaveBtn}
                  onClick={handleEditUser}
                  disabled={saving || !formName || !formEmail}
                  type="button"
                >
                  {saving && <Loader2 className={styles.btnSpinner} size={16} />}
                  {saving ? 'Čuvanje...' : 'Sačuvaj izmene'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== PASSWORD MODAL ===== */}
      {modal === 'password' && selectedUser && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleBox}>
                <KeyRound size={20} />
                <h3 className={styles.modalTitle}>Promena lozinke</h3>
              </div>
              <button className={styles.modalClose} onClick={closeModal} title="Zatvori">
                <X size={18} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalSubtitle}>
                Promena lozinke za <strong>{selectedUser.name}</strong> ({selectedUser.email})
              </p>
              <div className={styles.mFormGroup}>
                <label className={styles.mFormLabel}>Nova lozinka</label>
                <input
                  className={styles.mFormInput}
                  type="password"
                  placeholder="Minimalno 6 karaktera"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                />
              </div>
              <div className={styles.modalActions}>
                <button className={styles.modalCancelBtn} onClick={closeModal} type="button">
                  Otkaži
                </button>
                <button
                  className={styles.modalSaveBtn}
                  onClick={handleChangePassword}
                  disabled={saving || formPassword.length < 6}
                  type="button"
                >
                  {saving && <Loader2 className={styles.btnSpinner} size={16} />}
                  {saving ? 'Čuvanje...' : 'Promeni lozinku'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== DELETE MODAL ===== */}
      {modal === 'delete' && selectedUser && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleBoxDanger}>
                <Trash2 size={20} />
                <h3 className={styles.modalTitle}>Brisanje korisnika</h3>
              </div>
              <button className={styles.modalClose} onClick={closeModal} title="Zatvori">
                <X size={18} />
              </button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.deleteConfirmText}>
                Da li ste sigurni da želite da obrišete korisnika{' '}
                <strong>{selectedUser.name}</strong>?
              </p>
              <p className={styles.deleteWarningText}>
                Ova akcija je nepovratna. Svi povezani podaci ovog naloga biće uklonjeni.
              </p>
              <div className={styles.modalActions}>
                <button className={styles.modalCancelBtn} onClick={closeModal} type="button">
                  Otkaži
                </button>
                <button
                  className={styles.modalDeleteBtn}
                  onClick={handleDeleteUser}
                  disabled={saving}
                  type="button"
                >
                  {saving && <Loader2 className={styles.btnSpinner} size={16} />}
                  {saving ? 'Brisanje...' : 'Obriši korisnika'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
};

export default AdminPanel;
