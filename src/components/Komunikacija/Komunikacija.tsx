import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  Bell,
  Briefcase,
  Calendar,
  Camera,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  Flag,
  History as HistoryIcon,
  Info,
  Layers,
  Loader2,
  MapPin,
  MessageSquare,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Ruler,
  Search,
  Send,
  Sprout,
  ThumbsUp,
  Tractor,
  User,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useSession } from '../../lib/auth-client';
import { materialSummary } from '../../lib/workMaterials';
import { CustomSelect, type CustomSelectOption } from '../../Djubrivo/CustomSelect';
import AppLayout from '../Layout/AppLayout';
import TablePagination from '../TablePagination/TablePagination';
import { ConvertProposalModal, type ConvertProposalPayload } from './ConvertProposalModal';
import ProposalForm from './ProposalForm';
import {
  OVERVIEW_PAGE_SIZE,
  PAGE_SIZE,
  PROPOSAL_PAGE_SIZE,
  actionLabels,
  formatDateShort,
  getInitials,
  isEvidenceStale,
  machineTypeLabels,
  orderTypeLabels,
  priorityLabels,
  request,
  roleLabels,
  serviceTypeLabels,
  shiftLabels,
  statusLabels,
  time,
  type ApiError,
  type Catalog,
  type ConvertProposalResult,
  type History,
  type Message,
  type Notice,
  type Overview,
  type Page,
  type Proposal,
  type ProposalData,
} from './types';
import styles from './Komunikacija.module.css';

type TabId = 'teren' | 'poruke' | 'predlozi' | 'odobreni';
type OverviewView = 'workers' | 'machines' | 'seasonal';

const commKeys = {
  catalog: () => ['communication', 'catalog'] as const,
  overview: (userId?: string) => ['communication', userId, 'overview'] as const,
  overviewPage: (
    userId: string | undefined,
    view: OverviewView,
    page: number,
    status: string,
    q: string
  ) => ['communication', userId, 'overview', view, page, status, q] as const,
  notices: (userId?: string) => ['communication', userId, 'notices'] as const,
  messages: (userId?: string) => ['communication', userId, 'messages'] as const,
  messagesPage: (userId: string | undefined, page: number) =>
    ['communication', userId, 'messages', page] as const,
  message: (userId: string | undefined, id: string | null) =>
    ['communication', userId, 'message', id] as const,
  proposals: (userId?: string) => ['communication', userId, 'proposals'] as const,
  proposalsPage: (
    userId: string | undefined,
    page: number,
    status: string,
    orderType: string,
    q: string
  ) => ['communication', userId, 'proposals', page, status, orderType, q] as const,
  approvedProposals: (userId?: string) => ['communication', userId, 'approved-proposals'] as const,
  approvedProposalsPage: (
    userId: string | undefined,
    page: number,
    filter: string,
    orderType: string,
    q: string
  ) => ['communication', userId, 'approved-proposals', page, filter, orderType, q] as const,
  proposal: (userId: string | undefined, id: string | null) =>
    ['communication', userId, 'proposal', id] as const,
  proposalEvents: (userId: string | undefined, id: string | null) =>
    ['communication', userId, 'proposal-events', id] as const,
  proposalEventsPage: (userId: string | undefined, id: string | null, page: number) =>
    ['communication', userId, 'proposal-events', id, page] as const,
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'EVIDENTIRANO':
    case 'SLOBODNA':
    case 'ODOBREN':
      return styles.badgeSuccess;
    case 'ZADUZENA':
    case 'NA_PREGLEDU':
      return styles.badgeInfo;
    case 'PROVERA':
    case 'VRACEN_NA_DORADU':
    case 'SERVIS':
      return styles.badgeWarning;
    case 'U_KVARU':
    case 'OTKAZAN':
      return styles.badgeDanger;
    default:
      return styles.badgeMuted;
  }
}

function priorityBadgeClass(priority: string): string {
  if (priority === 'KRITICNO' || priority === 'KRITICNA') return styles.badgeDanger;
  if (priority === 'HITNO' || priority === 'VISOKA') return styles.badgeWarning;
  return styles.badgeMuted;
}

function actionBadgeClass(action: string): string {
  switch (action) {
    case 'approve':
    case 'convert':
      return styles.badgeSuccess;
    case 'submit':
    case 'create':
      return styles.badgeInfo;
    case 'request-changes':
    case 'edit':
      return styles.badgeWarning;
    case 'cancel':
      return styles.badgeDanger;
    default:
      return styles.badgeMuted;
  }
}

const ProposalSummary = memo(function ProposalSummary({ data }: { data: ProposalData }) {
  const isRemont = data.orderType === 'REMONT_SERVIS';
  const tiles = isRemont
    ? [
        {
          key: 'date',
          label: 'Datum planiranog početka',
          value: formatDateShort(data.orderDate),
          icon: <Calendar size={13} />,
        },
        {
          key: 'type',
          label: 'Tip / prioritet',
          value: `${orderTypeLabels[data.orderType] || data.orderType} · ${
            priorityLabels[data.priority] || data.priority
          }`,
          icon: <Flag size={13} />,
        },
        {
          key: 'serviceType',
          label: 'Tip servisa',
          value:
            serviceTypeLabels[data.serviceType || 'REDOVAN_SERVIS'] ||
            data.serviceType ||
            'Redovan servis',
          icon: <Wrench size={13} />,
        },
        {
          key: 'machineId',
          label: 'Mašina ili priključak',
          value: data.labels?.machineId || 'Nije određeno',
          icon: <Tractor size={13} />,
        },
        {
          key: 'workerId',
          label: 'Mehaničar / serviser',
          value: data.labels?.workerId || 'Nije određeno',
          icon: <User size={13} />,
        },
      ]
    : [
        {
          key: 'date',
          label: 'Datum / smena',
          value: `${formatDateShort(data.orderDate)} · ${shiftLabels[data.shift] || data.shift}`,
          icon: <Calendar size={13} />,
        },
        {
          key: 'type',
          label: 'Tip / prioritet',
          value: `${orderTypeLabels[data.orderType] || data.orderType} · ${
            priorityLabels[data.priority] || data.priority
          }`,
          icon: <Flag size={13} />,
        },
        {
          key: 'workerId',
          label: 'Radnik',
          value: data.labels?.workerId || 'Nije određeno',
          icon: <User size={13} />,
        },
        {
          key: 'machineId',
          label: 'Mašina',
          value: data.labels?.machineId || 'Nije određeno',
          icon: <Tractor size={13} />,
        },
        {
          key: 'attachmentId',
          label: 'Priključak',
          value: data.labels?.attachmentId || 'Nije određeno',
          icon: <Wrench size={13} />,
        },
        ...(data.orderType === 'RAD_NJIVA' || data.labels?.contractorId
          ? [
              {
                key: 'contractorId',
                label: 'Kooperant',
                value: data.labels?.contractorId || 'Bez kooperanta',
                icon: <Users size={13} />,
              },
            ]
          : []),
        {
          key: 'parcelId',
          label: 'Parcela',
          value: data.labels?.parcelId || 'Nije određeno',
          icon: <MapPin size={13} />,
        },
        {
          key: 'workTypeId',
          label: 'Vrsta rada',
          value: data.labels?.workTypeId || 'Nije određeno',
          icon: <Layers size={13} />,
        },
        {
          key: 'area',
          label: 'Planirana površina',
          value: data.plannedAreaHa ? `${data.plannedAreaHa.toLocaleString('sr-RS')} ha` : 'Nije određena',
          icon: <Ruler size={13} />,
        },
      ];

  const structuredMaterialsText = data.labels?.workMaterials?.length
    ? materialSummary(data.labels.workMaterials)
    : '';
  const combinedMaterials = [structuredMaterialsText, data.materials].filter(Boolean).join('\n');

  return (
    <>
      <div className={styles.summaryGrid}>
        {tiles.map((tile) => (
          <div key={tile.key} className={styles.summaryTile}>
            <span className={styles.summaryLabel}>
              {tile.icon}
              <span>{tile.label}</span>
            </span>
            <span className={styles.summaryValue}>{tile.value}</span>
          </div>
        ))}
      </div>

      {!isRemont && (
        <div className={styles.textBoxBlock}>
          <span className={styles.textBoxLabel}>Materijali i količine</span>
          <p className={styles.textBoxBody}>{combinedMaterials || 'Nisu navedeni'}</p>
        </div>
      )}

      <div className={styles.textBoxBlock}>
        <span className={styles.textBoxLabel}>
          {isRemont ? 'Uputstvo i specifikacija posla za mehaničara' : 'Uputstvo i napomene'}
        </span>
        <p className={styles.textBoxBody}>{data.instructions || 'Nije navedeno'}</p>
      </div>

      {data.photoUrl && (
        <div className={styles.textBoxBlock}>
          <span className={styles.textBoxLabel}>Priložena fotografija</span>
          <a
            href={data.photoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.subLine}
          >
            <Camera size={14} />
            <span>Otvori fotografiju uz predlog</span>
            <ExternalLink size={13} />
          </a>
        </div>
      )}
    </>
  );
});

const SnapshotDetails = memo(function SnapshotDetails({
  contentVersion,
  snapshot,
}: {
  contentVersion: number;
  snapshot: ProposalData;
}) {
  const [opened, setOpened] = useState(false);

  return (
    <details
      className={styles.snapshotDetails}
      onToggle={(event) => {
        if (event.currentTarget.open && !opened) setOpened(true);
      }}
    >
      <summary>Sačuvani sadržaj verzije {contentVersion}</summary>
      {opened && (
        <div className={styles.snapshotInner}>
          <h5 className={styles.snapshotTitle}>{snapshot.title}</h5>
          <ProposalSummary data={snapshot} />
        </div>
      )}
    </details>
  );
});

const MessageComposer = memo(function MessageComposer({
  busy,
  onSend,
}: {
  busy: boolean;
  onSend: (body: string, onSuccess: () => void) => void;
}) {
  const [message, setMessage] = useState('');

  return (
    <form
      className={styles.composerCard}
      onSubmit={(event) => {
        event.preventDefault();
        onSend(message, () => setMessage(''));
      }}
    >
      <h3 className={styles.sectionTitle}>
        <MessageSquare size={18} color="#16a34a" />
        <span>Nova poruka svim direktorima</span>
      </h3>
      <textarea
        className={styles.formTextarea}
        required
        maxLength={5000}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Napišite poruku, zapažanje sa terena ili dogovor za danas…"
        aria-label="Poruka svim direktorima"
      />
      <div className={styles.composerFooter}>
        <span className={styles.charCounter}>{message.length} / 5000 karaktera</span>
        <button
          type="submit"
          className={styles.btnPrimary}
          disabled={busy || !message.trim()}
        >
          {busy ? (
            <>
              <Loader2 size={16} className={styles.spinIcon} />
              <span>Slanje...</span>
            </>
          ) : (
            <>
              <Send size={16} />
              <span>Pošalji poruku</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
});

const MessagesList = memo(function MessagesList({
  items,
  total,
  isPending,
  userId,
  page,
  onPageChange,
  onOpenProposal,
}: {
  items: Message[] | undefined;
  total: number;
  isPending: boolean;
  userId?: string;
  page: number;
  onPageChange: (page: number) => void;
  onOpenProposal: (id: string) => void;
}) {
  return (
    <>
      <div className={styles.statusStrip}>
        <span>Zajednička prepiska · najnovije poruke prve · automatsko osvežavanje na 30s</span>
        {items && <span>Ukupno poruka: {total}</span>}
      </div>

      {isPending && (
        <div className={styles.tableCard}>
          <div className={styles.emptyState}>
            <Loader2 size={30} className={styles.spinIcon} color="#16a34a" />
            <span className={styles.emptyTitle}>Učitavanje poruka…</span>
          </div>
        </div>
      )}

      {items && items.length === 0 && (
        <div className={styles.tableCard}>
          <div className={styles.emptyState}>
            <MessageSquare size={36} color="#94a3b8" />
            <span className={styles.emptyTitle}>Još nema poruka</span>
            <p className={styles.emptySub}>
              Pošaljite prvu poruku iznad kako biste započeli zajednički dogovor direktora.
            </p>
          </div>
        </div>
      )}

      {items && items.length > 0 && (
        <div className={styles.messagesList}>
          {items.map((item) => {
            const isOwn = Boolean(userId && item.authorId === userId);
            return (
              <article
                key={item.id}
                className={`${styles.messageCard} ${isOwn ? styles.messageCardOwn : ''}`}
              >
                <div className={styles.messageHead}>
                  <div className={styles.personCell}>
                    <div
                      className={`${styles.avatarCircle} ${isOwn ? '' : styles.avatarCircleBlue}`}
                    >
                      {getInitials(item.authorName)}
                    </div>
                    <div className={styles.personMeta}>
                      <span className={styles.personName}>{item.authorName}</span>
                      <span className={styles.mutedText}>{time(item.createdAt)}</span>
                    </div>
                  </div>
                  <span className={`${styles.badge} ${isOwn ? styles.badgeSuccess : styles.badgeInfo}`}>
                    {isOwn ? 'Vi · Direktor' : 'Direktor'}
                  </span>
                </div>
                <p className={styles.messageBody}>{item.body}</p>
                {item.proposalId && (
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => onOpenProposal(item.proposalId!)}
                  >
                    <ClipboardList size={16} />
                    <span>Otvori predlog naloga</span>
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}

      {total > 0 && (
        <TablePagination
          currentPage={page}
          totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={onPageChange}
          itemName="poruka"
        />
      )}
    </>
  );
});

const CommentComposer = memo(function CommentComposer({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: string, onSuccess: () => void) => void;
}) {
  const [comment, setComment] = useState('');

  return (
    <form
      className={styles.composerCard}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(comment, () => setComment(''));
      }}
    >
      <h4 className={styles.sectionTitle}>
        <MessageSquare size={16} color="#16a34a" />
        <span>Komentar uz predlog</span>
      </h4>
      <textarea
        className={styles.formTextarea}
        required
        maxLength={5000}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Dodajte pitanje, predlog izmene ili napomenu za ostale direktore…"
        aria-label="Komentar uz predlog"
      />
      <div className={styles.composerFooter}>
        <span className={styles.charCounter}>{comment.length} / 5000</span>
        <button
          type="submit"
          className={styles.btnPrimary}
          disabled={busy || !comment.trim()}
        >
          <Send size={15} />
          <span>Dodaj komentar</span>
        </button>
      </div>
    </form>
  );
});

const ReturnChangesBox = memo(function ReturnChangesBox({
  busy,
  onApprove,
  onReturnChanges,
}: {
  busy: boolean;
  onApprove: () => void;
  onReturnChanges: (reason: string, onSuccess: () => void) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <div className={styles.workflowBox}>
      <div className={styles.decisionSplit}>
        <div className={styles.decisionTopBar}>
          <h4 className={styles.sectionTitle}>
            <CheckCircle2 size={17} color="#16a34a" />
            <span>Odluka direktora</span>
          </h4>
          <button
            type="button"
            className={styles.btnPrimary}
            disabled={busy}
            onClick={onApprove}
          >
            <ThumbsUp size={15} />
            <span>Odobri predlog</span>
          </button>
        </div>

        <div className={styles.returnChangesBox}>
          <label htmlFor="proposal-return-reason" className={styles.fieldLabel}>
            Ili vratite predlog na doradu (obavezan razlog):
          </label>
          <textarea
            id="proposal-return-reason"
            className={styles.formTextarea}
            maxLength={5000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Navedite šta treba dopuniti ili promeniti pre odobrenja…"
          />
          <div className={styles.composerFooter}>
            <span className={styles.charCounter}>{reason.length} / 5000</span>
            <button
              type="button"
              className={styles.btnWarning}
              disabled={busy || !reason.trim()}
              onClick={() => onReturnChanges(reason, () => setReason(''))}
            >
              <RotateCcw size={15} />
              <span>Vrati na doradu</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

const FieldOverviewSection = memo(function FieldOverviewSection({
  data,
  isPending,
  isFetching,
  isError,
  dataUpdatedAt,
  view,
  page,
  status,
  search,
  onViewChange,
  onPageChange,
  onStatusChange,
  onSearchChange,
  onReset,
}: {
  data: Overview | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  view: OverviewView;
  page: number;
  status: string;
  search: string;
  onViewChange: (view: OverviewView) => void;
  onPageChange: (page: number) => void;
  onStatusChange: (status: string) => void;
  onSearchChange: (search: string) => void;
  onReset: () => void;
}) {
  const overviewStats = useMemo(() => {
    if (data?.stats) {
      return data.stats;
    }

    const workers = data?.workers || [];
    const machines = data?.machines || [];
    const seasonal = data?.seasonalWorkers || [];

    let evidentirano = 0;
    let provera = 0;
    let nepoznato = 0;
    for (const w of workers) {
      if (w.status === 'EVIDENTIRANO') evidentirano++;
      else if (w.status === 'PROVERA') provera++;
      else if (w.status === 'NEPOZNATO') nepoznato++;
    }

    let zaduzene = 0;
    let slobodne = 0;
    let uKvaru = 0;
    let servis = 0;
    for (const m of machines) {
      if (m.status === 'ZADUZENA') zaduzene++;
      else if (m.status === 'SLOBODNA') slobodne++;
      else if (m.status === 'U_KVARU') uKvaru++;
      else if (m.status === 'SERVIS') servis++;
    }

    let seasonalWithLogs = 0;
    for (const s of seasonal) {
      if (s.workLogs.length > 0) seasonalWithLogs++;
    }

    return {
      totalWorkers: workers.length,
      evidentirano,
      provera,
      nepoznato,
      totalMachines: machines.length,
      zaduzene,
      slobodne,
      uKvaru,
      servis,
      problemMasine: uKvaru + servis,
      totalSeasonal: seasonal.length,
      seasonalWithLogs,
    };
  }, [data]);

  const viewOptions: CustomSelectOption[] = useMemo(
    () => [
      {
        value: 'workers',
        label: 'Po radnicima',
        subLabel: 'Lokacija, zadužene mašine i planirani nalozi',
        badge: data ? `${overviewStats.totalWorkers}` : undefined,
        badgeType: 'default',
      },
      {
        value: 'machines',
        label: 'Po mašinama',
        subLabel: 'Status flote i trenutni rukovaoci',
        badge: data ? `${overviewStats.totalMachines}` : undefined,
        badgeType: 'default',
      },
      {
        value: 'seasonal',
        label: 'Sezonci — dnevne evidencije',
        subLabel: 'Poslednji evidentiran rad po sezoncu',
        badge: data ? `${overviewStats.totalSeasonal}` : undefined,
        badgeType: 'default',
      },
    ],
    [data, overviewStats.totalWorkers, overviewStats.totalMachines, overviewStats.totalSeasonal]
  );

  const statusOptions: CustomSelectOption[] = useMemo(() => {
    if (view === 'workers') {
      return [
        { value: '', label: 'Svi statusi radnika', subLabel: 'Prikaži sve aktivne radnike' },
        {
          value: 'EVIDENTIRANO',
          label: statusLabels.EVIDENTIRANO,
          badge: data ? `${overviewStats.evidentirano}` : undefined,
          badgeType: 'success',
        },
        {
          value: 'PROVERA',
          label: statusLabels.PROVERA,
          subLabel: 'Više aktivnih lokacija u evidenciji',
          badge: data ? `${overviewStats.provera}` : undefined,
          isAlert: overviewStats.provera > 0,
        },
        {
          value: 'NEPOZNATO',
          label: statusLabels.NEPOZNATO,
          badge: data ? `${overviewStats.nepoznato}` : undefined,
          badgeType: 'default',
        },
      ];
    }

    if (view === 'machines') {
      return [
        { value: '', label: 'Svi statusi mašina', subLabel: 'Prikaži kompletnu mehanizaciju' },
        {
          value: 'SLOBODNA',
          label: statusLabels.SLOBODNA,
          badge: data ? `${overviewStats.slobodne}` : undefined,
          badgeType: 'success',
        },
        {
          value: 'ZADUZENA',
          label: statusLabels.ZADUZENA,
          badge: data ? `${overviewStats.zaduzene}` : undefined,
          badgeType: 'default',
        },
        {
          value: 'U_KVARU',
          label: statusLabels.U_KVARU,
          badge: data ? `${overviewStats.uKvaru}` : undefined,
          badgeType: 'danger',
          isAlert: overviewStats.uKvaru > 0,
        },
        {
          value: 'SERVIS',
          label: statusLabels.SERVIS,
          badge: data ? `${overviewStats.servis}` : undefined,
          badgeType: 'warning',
        },
      ];
    }

    return [];
  }, [view, data, overviewStats]);

  const pageSize = data?.pageSize || OVERVIEW_PAGE_SIZE;
  const totalItems =
    data?.total ??
    (view === 'workers'
      ? data?.workers.length || 0
      : view === 'machines'
        ? data?.machines.length || 0
        : data?.seasonalWorkers.length || 0);
  const totalPages = data?.totalPages || Math.max(1, Math.ceil(totalItems / pageSize));
  const filteredWorkers = view === 'workers' ? data?.workers || [] : [];
  const filteredMachines = view === 'machines' ? data?.machines || [] : [];
  const filteredSeasonal = view === 'seasonal' ? data?.seasonalWorkers || [] : [];

  return (
    <>
      <div className={styles.statsGrid}>
        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable}`}
          onClick={() => {
            onViewChange('workers');
            onStatusChange(
              view === 'workers' && status === 'EVIDENTIRANO' ? '' : 'EVIDENTIRANO'
            );
          }}
        >
          <div className={`${styles.statIcon} ${styles.iconGreen}`}>
            <Users size={22} />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>
              {overviewStats.evidentirano} / {overviewStats.totalWorkers}
            </span>
            <span className={styles.statLabel}>Evidentirano na terenu</span>
            <span className={styles.statSub}>Radnici sa potvrđenom parcelom</span>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable} ${
            overviewStats.provera > 0 ? styles.statCardAlert : ''
          }`}
          onClick={() => {
            onViewChange('workers');
            onStatusChange(overviewStats.provera > 0 ? 'PROVERA' : 'NEPOZNATO');
          }}
        >
          <div
            className={`${styles.statIcon} ${
              overviewStats.provera > 0 ? styles.iconAmber : styles.iconBlue
            }`}
          >
            <AlertTriangle size={22} />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>{overviewStats.provera}</span>
            <span className={styles.statLabel}>Za proveru evidencija</span>
            <span className={styles.statSub}>
              Nepoznata lokacija: {overviewStats.nepoznato} radnika
            </span>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable}`}
          onClick={() => {
            onViewChange('machines');
            onStatusChange('');
          }}
        >
          <div className={`${styles.statIcon} ${styles.iconBlue}`}>
            <Tractor size={22} />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>
              {overviewStats.zaduzene} / {overviewStats.totalMachines}
            </span>
            <span className={styles.statLabel}>Zadužene mašine</span>
            <span className={styles.statSub}>
              Slobodno: {overviewStats.slobodne} · Kvar/Servis: {overviewStats.problemMasine}
            </span>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable}`}
          onClick={() => {
            onViewChange('seasonal');
            onStatusChange('');
          }}
        >
          <div className={`${styles.statIcon} ${styles.iconPurple}`}>
            <Sprout size={22} />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>{overviewStats.totalSeasonal}</span>
            <span className={styles.statLabel}>Aktivni sezonci</span>
            <span className={styles.statSub}>
              Sa dnevnom evidencijom: {overviewStats.seasonalWithLogs}
            </span>
          </div>
        </button>
      </div>

      <div className={styles.filterCard}>
        <div className={styles.filterGroup}>
          <label htmlFor="overview-view-select">Pregled</label>
          <CustomSelect
            id="overview-view-select"
            value={view}
            onChange={(val) => onViewChange(val as OverviewView)}
            options={viewOptions}
            searchable={false}
          />
        </div>

        <div className={`${styles.filterGroup} ${styles.filterGroupSearch}`}>
          <label htmlFor="overview-search">Pretraga</label>
          <div className={styles.searchWrap}>
            <Search size={16} className={styles.searchIcon} />
            <input
              id="overview-search"
              className={styles.searchInput}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Radnik, mašina, parcela, posao, nalog…"
            />
            {search && (
              <button
                type="button"
                className={styles.clearSearchBtn}
                onClick={() => onSearchChange('')}
                aria-label="Obriši pretragu"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {view !== 'seasonal' && (
          <div className={styles.filterGroup}>
            <label htmlFor="overview-status-select">Status</label>
            <CustomSelect
              id="overview-status-select"
              value={status}
              onChange={onStatusChange}
              options={statusOptions}
              searchable={false}
            />
          </div>
        )}

        {(search || status) && (
          <div className={styles.filterActions}>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={onReset}
            >
              <RotateCcw size={15} />
              <span>Resetuj</span>
            </button>
          </div>
        )}
      </div>

      <div className={styles.statusStrip} role="status">
        <span className={styles.liveIndicator}>
          <span className={`${styles.liveDot} ${isError ? styles.liveDotError : ''}`} />
          {isFetching
            ? 'Osvežavanje podataka sa terena…'
            : isError
              ? 'Osvežavanje nije uspelo — prikazani podaci mogu biti zastareli.'
              : 'Automatsko osvežavanje na 30 sekundi.'}
        </span>
        {dataUpdatedAt > 0 && (
          <span>Poslednje učitavanje: {time(new Date(dataUpdatedAt).toISOString())}</span>
        )}
      </div>

      {isPending && (
        <div className={styles.tableCard}>
          <div className={styles.emptyState}>
            <Loader2 size={32} className={styles.spinIcon} color="#16a34a" />
            <span className={styles.emptyTitle}>Učitavanje stanja na terenu…</span>
          </div>
        </div>
      )}

      {data && view === 'workers' && (
        <div className={styles.tableCard}>
          <div className={styles.tableHeader}>
            <h3>
              <Users size={18} color="#16a34a" />
              <span>Pregled po radnicima</span>
            </h3>
            <span className={styles.tableCount}>
              Prikazano {filteredWorkers.length} od {totalItems} radnika
            </span>
          </div>

          {filteredWorkers.length === 0 ? (
            <div className={styles.emptyState}>
              <Users size={36} color="#94a3b8" />
              <span className={styles.emptyTitle}>Nema radnika za izabrane filtere</span>
              <p className={styles.emptySub}>
                Promenite tekst pretrage ili izabrani status radnika.
              </p>
            </div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Radnik</th>
                    <th>Status &amp; lokacija</th>
                    <th>Mašina / priključak</th>
                    <th>Posao i izvor evidencije</th>
                    <th>Planirani nalozi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkers.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className={styles.personCell}>
                          <div className={styles.personMeta}>
                            <span className={styles.personName}>{row.name}</span>
                            <span className={`${styles.badge} ${styles.badgeMuted}`}>
                              {roleLabels[row.role || row.type] || row.role || row.type}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className={styles.cellStack}>
                          <span className={`${styles.badge} ${statusBadgeClass(row.status)}`}>
                            {statusLabels[row.status] || row.status}
                          </span>
                          {row.locations.length > 0 ? (
                            <div className={styles.chipRow}>
                              {row.locations.map((loc) => (
                                <span key={loc.id} className={styles.chip}>
                                  <MapPin size={12} color="#16a34a" />
                                  <span>{loc.name}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className={styles.mutedText}>Lokacija nije zabeležena</span>
                          )}
                        </div>
                      </td>

                      <td>
                        <div className={styles.cellStack}>
                          {row.machines.length > 0 ? (
                            <div className={styles.chipRow}>
                              {row.machines.map((m) => (
                                <span key={m.id} className={styles.chip}>
                                  <Tractor size={12} color="#0284c7" />
                                  <span>{m.name}</span>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className={styles.mutedText}>Nema zadužene mašine</span>
                          )}
                          <span className={styles.subLine}>
                            <Wrench size={12} />
                            <span>
                              Priključak:{' '}
                              {row.attachments.map((a) => a.name).join(', ') || 'Nije potvrđen'}
                            </span>
                          </span>
                        </div>
                      </td>

                      <td>
                        <div className={styles.cellStack}>
                          <strong>{row.jobs.join(', ') || 'Posao nije naveden'}</strong>
                          {row.evidence.map((ev, index) => {
                            const stale = isEvidenceStale(ev.reportedAt);
                            return (
                              <div key={`${ev.id}-${index}`} className={styles.evidenceBlock}>
                                <span>
                                  <strong>{ev.source}</strong>
                                  {ev.location ? ` · ${ev.location}` : ''}
                                </span>
                                <span className={styles.subLine}>
                                  <Clock size={11} />
                                  <span>{time(ev.reportedAt)}</span>
                                </span>
                                {stale && (
                                  <span className={`${styles.badge} ${styles.badgeWarning}`}>
                                    <AlertTriangle size={11} />
                                    <span>Stara evidencija (&gt;12h)</span>
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </td>

                      <td>
                        {row.planned.length > 0 ? (
                          <div className={styles.cellStack}>
                            {row.planned.map((order) => (
                              <div key={order.id} className={styles.orderChip}>
                                <div>
                                  <span className={styles.codeBadge}>{order.orderNumber}</span>{' '}
                                  <span>{formatDateShort(order.orderDate)}</span>
                                </div>
                                <span className={styles.mutedText}>
                                  {order.parcel?.name || 'Lokacija nije navedena'} ·{' '}
                                  {order.workType?.name || 'Posao nije naveden'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className={styles.mutedText}>Nema planiranih naloga</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {totalItems > 0 && (
            <div style={{ padding: '0 1rem 1rem' }}>
              <TablePagination
                currentPage={page}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={pageSize}
                onPageChange={onPageChange}
                itemName="radnika"
              />
            </div>
          )}
        </div>
      )}

      {data && view === 'machines' && (
        <>
          {filteredMachines.length === 0 ? (
            <div className={styles.tableCard}>
              <div className={styles.emptyState}>
                <Tractor size={36} color="#94a3b8" />
                <span className={styles.emptyTitle}>Nema mašina za izabrane filtere</span>
                <p className={styles.emptySub}>
                  Promenite tekst pretrage ili izabrani status mašine.
                </p>
              </div>
            </div>
          ) : (
            <div className={styles.cardsGrid}>
              {filteredMachines.map((row) => (
                <article key={row.id} className={styles.entityCard}>
                  <div className={styles.entityCardHead}>
                    <div>
                      <h3 className={styles.entityTitle}>{row.name}</h3>
                      <div className={styles.entitySub}>
                        {row.type ? machineTypeLabels[row.type] || row.type : 'Mašina'}
                      </div>
                    </div>
                    <span className={`${styles.badge} ${statusBadgeClass(row.status)}`}>
                      {statusLabels[row.status] || row.status}
                    </span>
                  </div>

                  <div className={styles.entityBody}>
                    {row.workers.length > 0 ? (
                      row.workers.map((worker) => (
                        <div key={worker.id} className={styles.workerMiniBox}>
                          <div className={styles.messageHead}>
                            <strong>{worker.name}</strong>
                            {worker.status === 'PROVERA' && (
                              <span className={`${styles.badge} ${styles.badgeWarning}`}>
                                Proveriti evidencije
                              </span>
                            )}
                          </div>
                          <span className={styles.subLine}>
                            <MapPin size={12} color="#16a34a" />
                            <span>
                              {worker.locations.map((item) => item.name).join(', ') ||
                                'Lokacija nije poznata'}
                            </span>
                          </span>
                          {worker.evidence.map((ev, index) => (
                            <span key={`${ev.id}-${index}`} className={styles.mutedText}>
                              {ev.source} · {time(ev.reportedAt)}
                            </span>
                          ))}
                        </div>
                      ))
                    ) : (
                      <span className={styles.mutedText}>
                        Lokacija i korisnik trenutno nisu evidentirani.
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {totalItems > 0 && (
            <TablePagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageChange={onPageChange}
              itemName="mašina"
            />
          )}
        </>
      )}

      {data && view === 'seasonal' && (
        <>
          <div className={styles.infoBanner}>
            <Info size={18} className={styles.infoBannerIcon} />
            <div>
              Dnevni unos rada ne potvrđuje trenutno fizičko prisustvo. Prikazana je poslednja
              evidentirana aktivnost za svakog aktivnog sezonskog radnika.
            </div>
          </div>

          {filteredSeasonal.length === 0 ? (
            <div className={styles.tableCard}>
              <div className={styles.emptyState}>
                <Sprout size={36} color="#94a3b8" />
                <span className={styles.emptyTitle}>Nema sezonaca za izabrane filtere</span>
              </div>
            </div>
          ) : (
            <div className={styles.cardsGrid}>
              {filteredSeasonal.map((worker) => (
                <article key={worker.id} className={styles.entityCard}>
                  <div className={styles.entityCardHead}>
                    <div>
                      <h3 className={styles.entityTitle}>{worker.name}</h3>
                      <div className={styles.entitySub}>
                        {worker.groupName || 'Bez dodeljene grupe'}
                      </div>
                    </div>
                    <span className={`${styles.badge} ${styles.badgeMuted}`}>Sezonac</span>
                  </div>

                  <div className={styles.entityBody}>
                    {worker.workLogs.length > 0 ? (
                      worker.workLogs.map((log, index) => (
                        <div key={index} className={styles.workerMiniBox}>
                          <span className={styles.subLine}>
                            <Calendar size={12} />
                            <strong>{time(log.date)}</strong>
                          </span>
                          <span className={styles.subLine}>
                            <MapPin size={12} color="#16a34a" />
                            <span>{log.parcel?.name || 'Parcela nije navedena'}</span>
                          </span>
                          <span className={styles.mutedText}>{log.jobDescription}</span>
                        </div>
                      ))
                    ) : (
                      <span className={styles.mutedText}>Nema evidencije mesta rada.</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {totalItems > 0 && (
            <TablePagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageChange={onPageChange}
              itemName="sezonaca"
            />
          )}
        </>
      )}
    </>
  );
});

const PROPOSAL_STATUS_FILTER_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Svi statusi predloga' },
  { value: 'NACRT', label: statusLabels.NACRT, badge: 'Nacrt', badgeType: 'default' },
  { value: 'NA_PREGLEDU', label: statusLabels.NA_PREGLEDU, badge: 'Pregled', badgeType: 'default' },
  {
    value: 'VRACEN_NA_DORADU',
    label: statusLabels.VRACEN_NA_DORADU,
    badge: 'Dorada',
    isAlert: true,
  },
  { value: 'ODOBREN', label: statusLabels.ODOBREN, badge: 'Odobren', badgeType: 'success' },
  { value: 'OTKAZAN', label: statusLabels.OTKAZAN, badge: 'Otkazan', badgeType: 'danger' },
];

const PROPOSAL_ORDER_TYPE_FILTER_OPTIONS: CustomSelectOption[] = [
  { value: '', label: 'Svi tipovi rada' },
  { value: 'RAD_NJIVA', label: 'Rad na njivi' },
  { value: 'REMONT_SERVIS', label: 'Remont / servis' },
];

export default function Komunikacija() {
  return (
    <AppLayout pageTitle="Komunikacija direktora">
      <CommunicationContent />
    </AppLayout>
  );
}

type SessionUser = { id: string; name?: string; role?: string; isActive?: boolean };

type MutationVars = {
  path: string;
  body: unknown;
  method?: string;
  onSuccessCache?: (result: unknown) => void;
  onConflict?: () => void;
};

function CommunicationContent() {
  const { data: session } = useSession();
  const user = (session as unknown as { user?: SessionUser } | null | undefined)?.user;
  const userId = user?.id;
  const enabled = Boolean(userId && user?.role === 'DIREKTOR' && user?.isActive !== false);
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();

  const rawTab = params.get('tab');
  const tab: TabId =
    rawTab === 'teren' || rawTab === 'predlozi' || rawTab === 'poruke' || rawTab === 'odobreni'
      ? rawTab
      : 'poruke';
  const proposalId = params.get('predlog');
  const messageId = params.get('poruka');

  const [messagePage, setMessagePage] = useState(1);
  const [overviewView, setOverviewView] = useState<OverviewView>('workers');
  const [overviewPage, setOverviewPage] = useState(1);
  const [overviewStatus, setOverviewStatus] = useState('');
  const [overviewSearch, setOverviewSearch] = useState('');
  const deferredOverviewSearch = useDeferredValue(overviewSearch);
  const [proposalPage, setProposalPage] = useState(1);
  const [approvedPage, setApprovedPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [reviewer, setReviewer] = useState('');
  const [editing, setEditing] = useState<Proposal | 'new' | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Filteri na tabu Predlozi i Odobreni
  const [proposalSearch, setProposalSearch] = useState('');
  const deferredProposalSearch = useDeferredValue(proposalSearch);
  const [proposalStatusFilter, setProposalStatusFilter] = useState('');
  const [proposalOrderTypeFilter, setProposalOrderTypeFilter] = useState('');
  const [approvedSearch, setApprovedSearch] = useState('');
  const deferredApprovedSearch = useDeferredValue(approvedSearch);
  const [approvedFilter, setApprovedFilter] = useState<'all' | 'pending' | 'converted'>('all');
  const [approvedOrderTypeFilter, setApprovedOrderTypeFilter] = useState('');

  // Pretvaranje odobrenog predloga u radni nalog
  const [convertingProposal, setConvertingProposal] = useState<Proposal | null>(null);
  const [convertingDirectId, setConvertingDirectId] = useState<string | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertSaving, setConvertSaving] = useState(false);
  const convertIdempotencyKeys = useRef<Map<string, string>>(new Map());

  // Obaveštenja & Toast
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [noticeError, setNoticeError] = useState('');
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((text: string, type: 'success' | 'error' = 'success') => {
    setToast({ text, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const overviewSearchQuery = deferredOverviewSearch.trim();
  const overview = useQuery({
    queryKey: commKeys.overviewPage(
      userId,
      overviewView,
      overviewPage,
      overviewStatus,
      overviewSearchQuery
    ),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({
        view: overviewView,
        page: String(overviewPage),
        limit: String(OVERVIEW_PAGE_SIZE),
      });
      if (overviewStatus) qs.set('status', overviewStatus);
      if (overviewSearchQuery) qs.set('q', overviewSearchQuery);
      return request<Overview>(`/overview?${qs.toString()}`, undefined, 'GET', signal);
    },
    enabled: enabled && tab === 'teren',
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  const catalog = useQuery({
    queryKey: commKeys.catalog(),
    queryFn: ({ signal }) => request<Catalog>('/catalog', undefined, 'GET', signal),
    enabled: enabled && (tab === 'predlozi' || tab === 'odobreni' || editing !== null || convertingProposal !== null),
    staleTime: 10 * 60 * 1000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const messages = useQuery({
    queryKey: commKeys.messagesPage(userId, messagePage),
    queryFn: ({ signal }) =>
      request<Page<Message>>(`/messages?page=${messagePage}`, undefined, 'GET', signal),
    enabled: enabled && tab === 'poruke',
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  const focusedMessage = useQuery({
    queryKey: commKeys.message(userId, messageId),
    queryFn: ({ signal }) => request<Message>(`/messages/${messageId}`, undefined, 'GET', signal),
    enabled: enabled && tab === 'poruke' && Boolean(messageId),
    refetchInterval: false,
    refetchOnWindowFocus: false,
    initialData: () => messages.data?.items.find((item) => item.id === messageId),
    initialDataUpdatedAt: () =>
      messages.data?.items.some((item) => item.id === messageId)
        ? messages.dataUpdatedAt
        : undefined,
  });

  const notices = useQuery({
    queryKey: commKeys.notices(userId),
    queryFn: ({ signal }) => request<Page<Notice>>('/notifications', undefined, 'GET', signal),
    enabled,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const proposalSearchQuery = deferredProposalSearch.trim();
  const proposals = useQuery({
    queryKey: commKeys.proposalsPage(
      userId,
      proposalPage,
      proposalStatusFilter,
      proposalOrderTypeFilter,
      proposalSearchQuery
    ),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({
        page: String(proposalPage),
        limit: String(PROPOSAL_PAGE_SIZE),
      });
      if (proposalStatusFilter) qs.set('status', proposalStatusFilter);
      if (proposalOrderTypeFilter) qs.set('orderType', proposalOrderTypeFilter);
      if (proposalSearchQuery) qs.set('q', proposalSearchQuery);
      return request<Page<Proposal>>(`/proposals?${qs.toString()}`, undefined, 'GET', signal);
    },
    enabled: enabled && tab === 'predlozi',
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  const activeApprovedPage = tab === 'odobreni' ? approvedPage : 1;
  const activeApprovedFilter = tab === 'odobreni' ? approvedFilter : 'all';
  const activeApprovedOrderType = tab === 'odobreni' ? approvedOrderTypeFilter : '';
  const activeApprovedSearch = tab === 'odobreni' ? deferredApprovedSearch.trim() : '';
  const approvedProposals = useQuery({
    queryKey: commKeys.approvedProposalsPage(
      userId,
      activeApprovedPage,
      activeApprovedFilter,
      activeApprovedOrderType,
      activeApprovedSearch
    ),
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({
        status: 'ODOBREN',
        page: String(activeApprovedPage),
        limit: String(PROPOSAL_PAGE_SIZE),
      });
      if (activeApprovedFilter !== 'all') qs.set('converted', activeApprovedFilter);
      if (activeApprovedOrderType) qs.set('orderType', activeApprovedOrderType);
      if (activeApprovedSearch) qs.set('q', activeApprovedSearch);
      return request<Page<Proposal>>(`/proposals?${qs.toString()}`, undefined, 'GET', signal);
    },
    enabled,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    const tp = overview.data?.totalPages;
    if (tp && overviewPage > tp) setOverviewPage(tp);
  }, [overview.data?.totalPages, overviewPage]);

  useEffect(() => {
    const tp = proposals.data?.totalPages;
    if (tp && proposalPage > tp) setProposalPage(tp);
  }, [proposals.data?.totalPages, proposalPage]);

  useEffect(() => {
    const tp = approvedProposals.data?.totalPages;
    if (tab === 'odobreni' && tp && approvedPage > tp) setApprovedPage(tp);
  }, [tab, approvedProposals.data?.totalPages, approvedPage]);

  const proposal = useQuery({
    queryKey: commKeys.proposal(userId, proposalId),
    queryFn: ({ signal }) =>
      request<Proposal>(`/proposals/${proposalId}`, undefined, 'GET', signal),
    enabled: enabled && tab === 'predlozi' && Boolean(proposalId),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    initialData: () => proposals.data?.items.find((item) => item.id === proposalId),
    initialDataUpdatedAt: () =>
      proposals.data?.items.some((item) => item.id === proposalId)
        ? proposals.dataUpdatedAt
        : undefined,
  });

  const events = useQuery({
    queryKey: commKeys.proposalEventsPage(userId, proposalId, eventPage),
    queryFn: ({ signal }) =>
      request<Page<History>>(
        `/proposals/${proposalId}/events?page=${eventPage}`,
        undefined,
        'GET',
        signal
      ),
    enabled: enabled && tab === 'predlozi' && Boolean(proposalId),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
  });

  const mutation = useMutation({
    mutationFn: ({ path, body, method }: MutationVars) => request<unknown>(path, body, method),
    onSuccess: (result, vars) => {
      vars.onSuccessCache?.(result);
    },
    onError: (error, vars) => {
      if ((error as ApiError)?.status === 409) {
        vars.onConflict?.();
      }
    },
  });

  const { mutate: mutateAction, reset: resetMutation } = mutation;

  const run = useCallback(
    (
      vars: MutationVars,
      done?: (result: unknown) => void,
      successMsg?: string
    ) => {
      mutateAction(vars, {
        onSuccess: (result) => {
          if (successMsg) showToast(successMsg, 'success');
          done?.(result);
        },
      });
    },
    [mutateAction, showToast]
  );

  const refreshActiveTab = useCallback(() => {
    void client.invalidateQueries({ queryKey: commKeys.notices(userId) });
    void client.invalidateQueries({ queryKey: commKeys.approvedProposals(userId) });
    if (tab === 'teren') {
      void client.invalidateQueries({ queryKey: commKeys.overview(userId) });
    } else if (tab === 'poruke') {
      void client.invalidateQueries({ queryKey: commKeys.messages(userId) });
      if (messageId) {
        void client.invalidateQueries({ queryKey: commKeys.message(userId, messageId) });
      }
    } else if (tab === 'odobreni') {
      void client.invalidateQueries({ queryKey: commKeys.catalog() });
    } else {
      void client.invalidateQueries({ queryKey: commKeys.proposals(userId) });
      if (proposalId) {
        void client.invalidateQueries({ queryKey: commKeys.proposal(userId, proposalId) });
        void client.invalidateQueries({ queryKey: commKeys.proposalEvents(userId, proposalId) });
      }
    }
  }, [client, userId, tab, messageId, proposalId]);

  const markNoticeRead = useCallback(
    (noticeId: string) => {
      run({
        path: `/notifications/${noticeId}/read`,
        body: {},
        method: 'POST',
        onSuccessCache: () => {
          let needsRefetch = false;
          client.setQueryData<Page<Notice>>(commKeys.notices(userId), (prev) => {
            if (!prev) return prev;
            const filtered = prev.items.filter((item) => item.id !== noticeId);
            if (filtered.length === prev.items.length) return prev;
            const nextTotal = Math.max(0, prev.total - 1);
            if (prev.items.length >= PAGE_SIZE && nextTotal > filtered.length) {
              needsRefetch = true;
            }
            return { items: filtered, total: nextTotal };
          });
          if (needsRefetch) {
            void client.invalidateQueries({ queryKey: commKeys.notices(userId) });
          }
        },
      });
    },
    [client, run, userId]
  );

  const switchTab = (nextTab: TabId) => {
    setParams({ tab: nextTab });
    setConfirmCancel(false);
    mutation.reset();
    if (nextTab === 'odobreni') {
      void client.invalidateQueries({ queryKey: commKeys.approvedProposals(userId) });
    }
  };

  const openProposal = useCallback(
    (id: string) => {
      setParams({ tab: 'predlozi', predlog: id });
      setEventPage(1);
      setEditing(null);
      setConfirmCancel(false);
      setReviewer('');
      resetMutation();
    },
    [resetMutation, setConfirmCancel, setEditing, setEventPage, setParams, setReviewer]
  );

  const startNewProposal = () => {
    if (tab !== 'predlozi') {
      setParams({ tab: 'predlozi' });
    }
    setConfirmCancel(false);
    mutation.reset();
    setEditing('new');
  };

  const invalidateProposalCluster = useCallback(
    (targetId: string, alsoMessages = false) => {
      void client.invalidateQueries({ queryKey: commKeys.proposals(userId) });
      void client.invalidateQueries({ queryKey: commKeys.approvedProposals(userId) });
      void client.invalidateQueries({ queryKey: commKeys.proposal(userId, targetId) });
      void client.invalidateQueries({ queryKey: commKeys.proposalEvents(userId, targetId) });
      if (alsoMessages) {
        void client.invalidateQueries({ queryKey: commKeys.messages(userId) });
      }
    },
    [client, userId]
  );

  const executeConvertProposal = useCallback(
    async (
      target: Proposal,
      body: Partial<ConvertProposalPayload> & { version: number },
      idempotencyKey: string
    ) => {
      setConvertSaving(true);
      setConvertError(null);
      setConvertingDirectId(target.id);
      try {
        const result = await request<ConvertProposalResult>(
          `/proposals/${target.id}/convert`,
          body,
          'POST',
          undefined,
          { 'Idempotency-Key': idempotencyKey }
        );
        client.setQueryData(commKeys.proposal(userId, target.id), result.proposal);
        invalidateProposalCluster(target.id);
        void client.invalidateQueries({ queryKey: commKeys.notices(userId) });
        void client.invalidateQueries({ queryKey: commKeys.overview(userId) });
        void client.invalidateQueries({ queryKey: ['operational'] });
        setConvertingProposal(null);
        showToast(`Radni nalog #${result.workOrder.orderNumber} je uspešno kreiran.`, 'success');
      } catch (err) {
        const apiErr = err as ApiError;
        const message = apiErr?.message || 'Pretvaranje u radni nalog nije uspelo.';
        if (apiErr?.status === 409) {
          invalidateProposalCluster(target.id);
        }
        setConvertError(message);
        if (!convertingProposal) {
          showToast(message, 'error');
        }
      } finally {
        setConvertSaving(false);
        setConvertingDirectId(null);
      }
    },
    [client, convertingProposal, invalidateProposalCluster, showToast, userId]
  );

  const startConversion = useCallback(
    (item: Proposal, forceModal = false) => {
      if (item.workOrderId || convertSaving) return;
      const workType = catalog.data?.workTypes.find((wt) => wt.id === item.data.workTypeId);
      const hasProposalMaterials = (item.data.workMaterials?.length || 0) > 0;
      const catalogMissingForOperation =
        item.data.orderType === 'RAD_NJIVA' && Boolean(item.data.workTypeId) && !catalog.data;
      const needsMaterialPicker =
        item.data.orderType === 'RAD_NJIVA' &&
        !hasProposalMaterials &&
        (catalogMissingForOperation || Boolean(workType?.materialRequired));
      if (forceModal || !item.data.workerId || needsMaterialPicker) {
        setConvertError(null);
        setConvertingProposal(item);
        return;
      }
      const cacheKey = `${item.id}:${item.version}`;
      let idempotencyKey = convertIdempotencyKeys.current.get(cacheKey);
      if (!idempotencyKey) {
        idempotencyKey =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `convert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        convertIdempotencyKeys.current.set(cacheKey, idempotencyKey);
      }
      void executeConvertProposal(item, { version: item.version }, idempotencyKey);
    },
    [catalog.data, convertSaving, executeConvertProposal]
  );

  const saveProposal = (data: ProposalData) => {
    if (editing && editing !== 'new') {
      const targetId = editing.id;
      run(
        {
          path: `/proposals/${targetId}`,
          body: { version: editing.version, action: 'edit', data },
          method: 'PATCH',
          onSuccessCache: (result) => {
            const updated = result as Proposal;
            client.setQueryData(commKeys.proposal(userId, updated.id), updated);
            void client.invalidateQueries({ queryKey: commKeys.proposals(userId) });
            void client.invalidateQueries({ queryKey: commKeys.approvedProposals(userId) });
            void client.invalidateQueries({ queryKey: commKeys.proposalEvents(userId, updated.id) });
          },
          onConflict: () => invalidateProposalCluster(targetId),
        },
        () => setEditing(null),
        'Predlog je sačuvan.'
      );
    } else {
      run(
        {
          path: '/proposals',
          body: data,
          method: 'POST',
          onSuccessCache: (result) => {
            const created = result as Proposal;
            client.setQueryData(commKeys.proposal(userId, created.id), created);
            void client.invalidateQueries({ queryKey: commKeys.proposals(userId) });
          },
        },
        (result) => {
          openProposal((result as Proposal).id);
        },
        'Novi predlog je kreiran.'
      );
    }
  };

  const decideProposal = useCallback(
    (action: string, reasonText?: string, onDone?: () => void) => {
      if (!proposal.data) return;
      const targetId = proposal.data.id;
      const successMap: Record<string, string> = {
        submit: 'Predlog je poslat na pregled.',
        approve: 'Predlog je odobren.',
        'request-changes': 'Predlog je vraćen na doradu.',
        cancel: 'Predlog je povučen.',
      };
      run(
        {
          path: `/proposals/${targetId}`,
          body: {
            version: proposal.data.version,
            action,
            reviewerId: reviewer || null,
            ...(action === 'request-changes' ? { body: reasonText || '' } : {}),
          },
          method: 'PATCH',
          onSuccessCache: (result) => {
            const updated = result as Proposal;
            client.setQueryData(commKeys.proposal(userId, updated.id), updated);
            void client.invalidateQueries({ queryKey: commKeys.proposals(userId) });
            void client.invalidateQueries({ queryKey: commKeys.approvedProposals(userId) });
            void client.invalidateQueries({ queryKey: commKeys.proposalEvents(userId, updated.id) });
            if (action === 'submit') {
              void client.invalidateQueries({ queryKey: commKeys.messages(userId) });
            }
          },
          onConflict: () => invalidateProposalCluster(targetId),
        },
        () => {
          setConfirmCancel(false);
          onDone?.();
        },
        successMap[action]
      );
    },
    [client, invalidateProposalCluster, proposal.data, reviewer, run, setConfirmCancel, userId]
  );

  const handleSendMessage = useCallback(
    (body: string, clearInput: () => void) => {
      run(
        {
          path: '/messages',
          body: { body },
          method: 'POST',
          onSuccessCache: (result) => {
            const created = result as Message;
            client.setQueryData<Page<Message>>(commKeys.messagesPage(userId, 1), (prev) => {
              if (!prev) return prev;
              if (prev.items.some((item) => item.id === created.id)) return prev;
              return {
                items: [created, ...prev.items].slice(0, PAGE_SIZE),
                total: prev.total + 1,
              };
            });
            void client.invalidateQueries({
              queryKey: commKeys.messages(userId),
              predicate: (q) => q.queryKey[3] !== 1,
            });
          },
        },
        () => {
          clearInput();
          setMessagePage(1);
        }
      );
    },
    [client, run, setMessagePage, userId]
  );

  const handleAddComment = useCallback(
    (body: string, clearInput: () => void) => {
      if (!proposal.data) return;
      const targetId = proposal.data.id;
      run(
        {
          path: `/proposals/${targetId}/comments`,
          body: { body },
          method: 'POST',
          onSuccessCache: () => {
            void client.invalidateQueries({ queryKey: commKeys.proposalEvents(userId, targetId) });
          },
        },
        () => {
          clearInput();
          setEventPage(1);
        },
        'Komentar je dodat.'
      );
    },
    [client, proposal.data, run, setEventPage, userId]
  );

  const reviewerOptions: CustomSelectOption[] = useMemo(
    () => [
      {
        value: '',
        label: 'Svim direktorima',
        subLabel: 'Ostali aktivni direktori dobijaju obaveštenje',
        badge: 'Svi',
        badgeType: 'default',
      },
      ...(catalog.data?.directors || []).map((dir) => ({
        value: dir.id,
        label: dir.name,
        subLabel: 'Direktor',
        badge: dir.id === userId ? 'Vi' : 'Direktor',
        badgeType: (dir.id === userId ? 'success' : 'default') as CustomSelectOption['badgeType'],
      })),
    ],
    [catalog.data?.directors, userId]
  );

  const directorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const dir of catalog.data?.directors || []) {
      map.set(dir.id, dir.name);
    }
    return map;
  }, [catalog.data?.directors]);

  const filteredProposals = proposals.data?.items || [];
  const filteredApprovedProposals = approvedProposals.data?.items || [];

  const handleOverviewViewChange = useCallback((nextView: OverviewView) => {
    setOverviewView(nextView);
    setOverviewStatus('');
    setOverviewPage(1);
  }, []);

  const handleOverviewStatusChange = useCallback((nextStatus: string) => {
    setOverviewStatus(nextStatus);
    setOverviewPage(1);
  }, []);

  const handleOverviewSearchChange = useCallback((nextSearch: string) => {
    setOverviewSearch(nextSearch);
    setOverviewPage(1);
  }, []);

  const handleOverviewReset = useCallback(() => {
    setOverviewSearch('');
    setOverviewStatus('');
    setOverviewPage(1);
  }, []);

  const approvedFilterOptions: CustomSelectOption[] = useMemo(
    () => [
      { value: 'all', label: 'Svi odobreni predlozi' },
      { value: 'pending', label: 'Čekaju pretvaranje', badge: 'Čeka', badgeType: 'warning' },
      { value: 'converted', label: 'Pretvoreni u radne naloge', badge: 'Izvezeno', badgeType: 'success' },
    ],
    []
  );

  const pendingApprovedCount = approvedProposals.data?.approvedPendingCount ?? 0;

  const approvedPageStats = useMemo(() => {
    const list = approvedProposals.data?.items || [];
    let converted = 0;
    let readyDirect = 0;
    for (const item of list) {
      if (item.workOrderId) {
        converted++;
      } else {
        const workType = catalog.data?.workTypes.find((wt) => wt.id === item.data.workTypeId);
        const hasProposalMaterials = (item.data.workMaterials?.length || 0) > 0;
        const needsMat =
          item.data.orderType === 'RAD_NJIVA' &&
          !hasProposalMaterials &&
          Boolean(workType?.materialRequired);
        if (item.data.workerId && !needsMat) readyDirect++;
      }
    }
    return {
      total: approvedProposals.data?.total || 0,
      pending: pendingApprovedCount,
      converted,
      readyDirect,
    };
  }, [approvedProposals.data, catalog.data?.workTypes, pendingApprovedCount]);

  const proposalPageStats = useMemo(() => {
    const list = proposals.data?.items || [];
    let naPregledu = 0;
    let odobreno = 0;
    let nacrtDorada = 0;
    for (const p of list) {
      if (p.status === 'NA_PREGLEDU') naPregledu++;
      else if (p.status === 'ODOBREN') odobreno++;
      else if (p.status === 'NACRT' || p.status === 'VRACEN_NA_DORADU') nacrtDorada++;
    }
    return {
      total: proposals.data?.total || 0,
      naPregledu,
      odobreno,
      nacrtDorada,
    };
  }, [proposals.data]);

  const { unreadMessageNotices, unreadProposalNotices } = useMemo(() => {
    let msgCount = 0;
    let propCount = 0;
    for (const n of notices.data?.items || []) {
      if (n.messageId) msgCount++;
      if (n.proposalId) propCount++;
    }
    return { unreadMessageNotices: msgCount, unreadProposalNotices: propCount };
  }, [notices.data?.items]);

  const current = proposal.data;
  const errors = [
    mutation.error,
    notices.error,
    ...(tab === 'teren'
      ? [overview.error]
      : tab === 'poruke'
        ? [messages.error, focusedMessage.error]
        : tab === 'odobreni'
          ? [catalog.error, approvedProposals.error]
          : [catalog.error, proposals.error, proposal.error, events.error]),
  ].filter(Boolean);

  const unreadTotal = notices.data?.total || 0;
  const isRefreshing =
    overview.isFetching ||
    messages.isFetching ||
    proposals.isFetching ||
    approvedProposals.isFetching;

  return (
    <div className={styles.container}>
      {toast && (
        <div
          role="status"
          className={`${styles.toast} ${
            toast.type === 'success' ? styles.toastSuccess : styles.toastError
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{toast.text}</span>
        </div>
      )}

      {/* ZAGLAVLJE */}
      <div className={styles.headerBar}>
        <div className={styles.titleArea}>
          <h2>
            <span className={styles.titleIconBadge}>
              <MessageSquare size={20} />
            </span>
            <span>Dogovor i stanje na terenu</span>
          </h2>
        </div>

        <div className={styles.actionBtns}>
          <button
            type="button"
            className={`${styles.btnSecondary} ${unreadTotal > 0 ? styles.btnHasAlert : ''}`}
            onClick={() => setNoticesOpen(!noticesOpen)}
            aria-expanded={noticesOpen}
          >
            <Bell size={16} color={unreadTotal > 0 ? '#d97706' : undefined} />
            <span>Obaveštenja</span>
            <span className={`${styles.countPill} ${unreadTotal === 0 ? styles.countPillMuted : ''}`}>
              {unreadTotal}
            </span>
          </button>

          <button
            type="button"
            className={styles.btnSecondary}
            disabled={isRefreshing}
            onClick={refreshActiveTab}
            title="Osveži podatke"
          >
            <RefreshCw size={16} className={isRefreshing ? styles.spinIcon : ''} />
            <span>Osveži</span>
          </button>

          <button type="button" className={styles.btnPrimary} onClick={startNewProposal}>
            <Plus size={17} />
            <span>Novi predlog</span>
          </button>
        </div>
      </div>

      {/* PANEL SA NEPROČITANIM OBAVEŠTENJIMA */}
      {noticesOpen && (
        <section className={styles.noticesCard} aria-label="Nepročitana obaveštenja">
          <div className={styles.noticesHeader}>
            <h3>
              <Bell size={17} color="#16a34a" />
              <span>Nepročitana obaveštenja ({unreadTotal})</span>
            </h3>
            <div className={styles.noticesHeaderActions}>
              {unreadTotal > 0 && (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={mutation.isPending}
                  onClick={() => {
                    setNoticeError('');
                    run(
                      {
                        path: '/notifications/read-all',
                        body: {},
                        method: 'POST',
                        onSuccessCache: () => {
                          client.setQueryData<Page<Notice>>(commKeys.notices(userId), {
                            items: [],
                            total: 0,
                          });
                        },
                      },
                      undefined,
                      'Sva obaveštenja su označena kao pročitana.'
                    );
                  }}
                >
                  <CheckCheck size={15} />
                  <span>Označi sve kao pročitano</span>
                </button>
              )}
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setNoticesOpen(false)}
                aria-label="Zatvori obaveštenja"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {notices.isPending && (
            <div className={styles.emptyState}>
              <Loader2 size={24} className={styles.spinIcon} color="#16a34a" />
              <span>Učitavanje obaveštenja…</span>
            </div>
          )}

          {noticeError && (
            <div className={styles.errorBanner} role="alert" style={{ margin: '0.75rem' }}>
              <div className={styles.errorBannerLeft}>
                <AlertCircle size={17} />
                <span>{noticeError}</span>
              </div>
            </div>
          )}

          {!notices.isPending && notices.data?.items.length === 0 && (
            <div className={styles.emptyState} style={{ padding: '1.75rem 1rem' }}>
              <CheckCircle2 size={28} color="#16a34a" />
              <span className={styles.emptyTitle}>Sve je pročitano</span>
              <p className={styles.emptySub}>Trenutno nemate novih nepročitanih obaveštenja.</p>
            </div>
          )}

          {notices.data && notices.data.items.length > 0 && (
            <div className={styles.noticesList}>
              {notices.data.items.map((notice) => (
                <div key={notice.id} className={styles.noticeRow}>
                  <div className={styles.noticeLeft}>
                    <div
                      className={`${styles.noticeTypeIcon} ${
                        notice.messageId ? styles.iconBlue : styles.iconGreen
                      }`}
                    >
                      {notice.messageId ? <MessageSquare size={16} /> : <ClipboardList size={16} />}
                    </div>
                    <div>
                      <div className={styles.noticeTitle}>{notice.title}</div>
                      <div className={styles.noticeMeta}>
                        {notice.messageId ? 'Nova poruka direktora' : 'Aktivnost na predlogu naloga'}
                        {notice.createdAt ? ` · ${time(notice.createdAt)}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className={styles.noticeActions}>
                    <button
                      type="button"
                      className={styles.btnSecondary}
                      disabled={mutation.isPending}
                      onClick={async () => {
                        try {
                          setNoticeError('');
                          if (notice.messageId) {
                            const targetMessageId = notice.messageId;
                            await client.fetchQuery({
                              queryKey: commKeys.message(userId, targetMessageId),
                              queryFn: ({ signal }) =>
                                request<Message>(
                                  `/messages/${targetMessageId}`,
                                  undefined,
                                  'GET',
                                  signal
                                ),
                            });
                            setParams({ tab: 'poruke', poruka: targetMessageId });
                          } else if (notice.proposalId) {
                            const targetProposalId = notice.proposalId;
                            await client.fetchQuery({
                              queryKey: commKeys.proposal(userId, targetProposalId),
                              queryFn: ({ signal }) =>
                                request<Proposal>(
                                  `/proposals/${targetProposalId}`,
                                  undefined,
                                  'GET',
                                  signal
                                ),
                            });
                            openProposal(targetProposalId);
                          }
                          markNoticeRead(notice.id);
                          setNoticesOpen(false);
                        } catch (error) {
                          setNoticeError(
                            error instanceof Error
                              ? error.message
                              : 'Sadržaj nije moguće otvoriti.'
                          );
                        }
                      }}
                    >
                      Otvori
                    </button>
                    <button
                      type="button"
                      className={styles.noticeDismissBtn}
                      disabled={mutation.isPending}
                      onClick={() => {
                        setNoticeError('');
                        markNoticeRead(notice.id);
                      }}
                      aria-label={`Zatvori obaveštenje: ${notice.title}`}
                      title="Označi kao pročitano"
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB NAVIGACIJA */}
      <nav className={styles.tabsBar} aria-label="Sekcije komunikacije">
        <button
          type="button"
          aria-current={tab === 'poruke' ? 'page' : undefined}
          className={`${styles.tabBtn} ${tab === 'poruke' ? styles.tabBtnActive : ''}`}
          onClick={() => switchTab('poruke')}
        >
          <MessageSquare size={17} />
          <span>Poruke direktora</span>
          {unreadMessageNotices > 0 && (
            <span className={styles.tabBadge}>{unreadMessageNotices}</span>
          )}
        </button>

        <button
          type="button"
          aria-current={tab === 'teren' ? 'page' : undefined}
          className={`${styles.tabBtn} ${tab === 'teren' ? styles.tabBtnActive : ''}`}
          onClick={() => switchTab('teren')}
        >
          <MapPin size={17} />
          <span>Stanje na terenu</span>
        </button>

        <button
          type="button"
          aria-current={tab === 'predlozi' ? 'page' : undefined}
          className={`${styles.tabBtn} ${tab === 'predlozi' ? styles.tabBtnActive : ''}`}
          onClick={() => switchTab('predlozi')}
        >
          <ClipboardList size={17} />
          <span>Predlozi naloga</span>
          {unreadProposalNotices > 0 && (
            <span className={styles.tabBadge}>{unreadProposalNotices}</span>
          )}
        </button>

        <button
          type="button"
          aria-current={tab === 'odobreni' ? 'page' : undefined}
          className={`${styles.tabBtn} ${tab === 'odobreni' ? styles.tabBtnActive : ''}`}
          onClick={() => switchTab('odobreni')}
        >
          <CheckCheck size={17} />
          <span>Odobreni radni nalozi</span>
          {pendingApprovedCount > 0 && (
            <span className={styles.tabBadge}>{pendingApprovedCount}</span>
          )}
        </button>
      </nav>

      {/* GLOBALNA GREŠKA */}
      {errors.length > 0 && !editing && (
        <div className={styles.errorBanner} role="alert">
          <div className={styles.errorBannerLeft}>
            <AlertCircle size={18} />
            <span>{[...new Set(errors.map((err) => err?.message))].join(' ')}</span>
          </div>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={refreshActiveTab}
          >
            Pokušaj ponovo
          </button>
        </div>
      )}

      {/* ========================================================
          TAB 1: STANJE NA TERENU
         ======================================================== */}
      {tab === 'teren' && (
        <FieldOverviewSection
          data={overview.data}
          isPending={overview.isPending}
          isFetching={overview.isFetching}
          isError={overview.isError}
          dataUpdatedAt={overview.dataUpdatedAt}
          view={overviewView}
          page={overviewPage}
          status={overviewStatus}
          search={overviewSearch}
          onViewChange={handleOverviewViewChange}
          onPageChange={setOverviewPage}
          onStatusChange={handleOverviewStatusChange}
          onSearchChange={handleOverviewSearchChange}
          onReset={handleOverviewReset}
        />
      )}

      {/* ========================================================
          TAB 2: PORUKE DIREKTORA
         ======================================================== */}
      {tab === 'poruke' && (
        <>
          <MessageComposer busy={mutation.isPending} onSend={handleSendMessage} />

          {messageId && focusedMessage.data && (
            <article className={styles.highlightCard}>
              <div className={styles.messageHead}>
                <div className={styles.personCell}>
                  <div className={`${styles.avatarCircle} ${styles.avatarCircleBlue}`}>
                    {getInitials(focusedMessage.data.authorName)}
                  </div>
                  <div className={styles.personMeta}>
                    <span className={styles.personName}>{focusedMessage.data.authorName}</span>
                    <span className={styles.mutedText}>{time(focusedMessage.data.createdAt)}</span>
                  </div>
                </div>
                <div className={styles.detailActions}>
                  <span className={`${styles.badge} ${styles.badgeSuccess}`}>Otvorena poruka</span>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => setParams({ tab: 'poruke' })}
                  >
                    <X size={15} />
                    <span>Zatvori</span>
                  </button>
                </div>
              </div>
              <p className={styles.messageBody}>{focusedMessage.data.body}</p>
              {focusedMessage.data.proposalId && (
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => openProposal(focusedMessage.data.proposalId!)}
                >
                  <ClipboardList size={16} />
                  <span>Otvori predlog naloga</span>
                </button>
              )}
            </article>
          )}

          <MessagesList
            items={messages.data?.items}
            total={messages.data?.total || 0}
            isPending={messages.isPending}
            userId={userId}
            page={messagePage}
            onPageChange={setMessagePage}
            onOpenProposal={openProposal}
          />
        </>
      )}

      {/* ========================================================
          TAB 3: PREDLOZI NALOGA
         ======================================================== */}
      {tab === 'predlozi' && (
        <>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={`${styles.statIcon} ${styles.iconBlue}`}>
                <ClipboardList size={22} />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statValue}>{proposalPageStats.total}</span>
                <span className={styles.statLabel}>Ukupno predloga</span>
                <span className={styles.statSub}>Svi zabeleženi predlozi</span>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={`${styles.statIcon} ${styles.iconAmber}`}>
                <Clock size={22} />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statValue}>{proposalPageStats.naPregledu}</span>
                <span className={styles.statLabel}>Na pregledu (strana)</span>
                <span className={styles.statSub}>Čeka odluku direktora</span>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={`${styles.statIcon} ${styles.iconGreen}`}>
                <CheckCircle2 size={22} />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statValue}>{proposalPageStats.odobreno}</span>
                <span className={styles.statLabel}>Odobreno (strana)</span>
                <span className={styles.statSub}>Usaglašeni predlozi</span>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={`${styles.statIcon} ${styles.iconPurple}`}>
                <Pencil size={22} />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statValue}>{proposalPageStats.nacrtDorada}</span>
                <span className={styles.statLabel}>Nacrt / dorada (strana)</span>
                <span className={styles.statSub}>U pripremi za slanje</span>
              </div>
            </div>
          </div>

          <div className={styles.proposalsLayout}>
            {/* LEVA KOLONA: LISTA PREDLOGA */}
            <section className={styles.proposalSidebarCard} aria-label="Lista predloga">
              <div className={styles.proposalSidebarHead}>
                <div className={styles.proposalSidebarTitleRow}>
                  <h3 className={styles.sectionTitle}>
                    <ClipboardList size={18} color="#16a34a" />
                    <span>Predlozi direktora</span>
                  </h3>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    disabled={!catalog.data && catalog.isPending}
                    onClick={startNewProposal}
                  >
                    <Plus size={15} />
                    <span>Novi</span>
                  </button>
                </div>

                <div className={styles.searchWrap}>
                  <Search size={15} className={styles.searchIcon} />
                  <input
                    className={styles.searchInput}
                    value={proposalSearch}
                    onChange={(e) => {
                      setProposalSearch(e.target.value);
                      setProposalPage(1);
                    }}
                    placeholder="Pretraži naziv, autora, parcelu…"
                    aria-label="Pretraga predloga"
                  />
                  {proposalSearch && (
                    <button
                      type="button"
                      className={styles.clearSearchBtn}
                      onClick={() => {
                        setProposalSearch('');
                        setProposalPage(1);
                      }}
                      aria-label="Obriši pretragu predloga"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <CustomSelect
                  id="proposal-status-filter"
                  value={proposalStatusFilter}
                  onChange={(val) => {
                    setProposalStatusFilter(val);
                    setProposalPage(1);
                  }}
                  options={PROPOSAL_STATUS_FILTER_OPTIONS}
                  searchable={false}
                />

                <CustomSelect
                  id="proposal-order-type-filter"
                  value={proposalOrderTypeFilter}
                  onChange={(val) => {
                    setProposalOrderTypeFilter(val);
                    setProposalPage(1);
                  }}
                  options={PROPOSAL_ORDER_TYPE_FILTER_OPTIONS}
                  searchable={false}
                />
              </div>

              <div className={styles.proposalList}>
                {proposals.isPending && (
                  <div className={styles.emptyState}>
                    <Loader2 size={26} className={styles.spinIcon} color="#16a34a" />
                    <span>Učitavanje predloga…</span>
                  </div>
                )}

                {!proposals.isPending &&
                  proposals.data?.items.length === 0 &&
                  !proposalSearch.trim() &&
                  !proposalStatusFilter &&
                  !proposalOrderTypeFilter && (
                    <div className={styles.emptyState}>
                      <ClipboardList size={34} color="#94a3b8" />
                      <span className={styles.emptyTitle}>Još nema predloga</span>
                      <p className={styles.emptySub}>
                        Kreirajte prvi predlog radnog naloga klikom na dugme iznad.
                      </p>
                    </div>
                  )}

                {!proposals.isPending &&
                  filteredProposals.length === 0 &&
                  Boolean(proposalSearch.trim() || proposalStatusFilter || proposalOrderTypeFilter) && (
                    <div className={styles.emptyState}>
                      <span className={styles.emptyTitle}>Nema rezultata za izabrane filtere</span>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        onClick={() => {
                          setProposalSearch('');
                          setProposalStatusFilter('');
                          setProposalOrderTypeFilter('');
                          setProposalPage(1);
                        }}
                      >
                        Resetuj filtere
                      </button>
                    </div>
                  )}

                {filteredProposals.map((item) => {
                  const isSelected = proposalId === item.id;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={`${styles.proposalItem} ${
                        isSelected ? styles.proposalItemSelected : ''
                      }`}
                      onClick={() => openProposal(item.id)}
                    >
                      <div className={styles.proposalItemTop}>
                        <span className={styles.proposalItemTitle}>{item.data.title}</span>
                        <span className={styles.codeBadge}>v{item.contentVersion}</span>
                      </div>

                      <div className={styles.chipRow}>
                        <span className={`${styles.badge} ${statusBadgeClass(item.status)}`}>
                          {statusLabels[item.status] || item.status}
                        </span>
                        {item.data.priority !== 'NORMALNO' &&
                          item.data.priority !== 'SREDNJA' &&
                          item.data.priority !== 'NISKA' && (
                          <span
                            className={`${styles.badge} ${priorityBadgeClass(item.data.priority)}`}
                          >
                            {priorityLabels[item.data.priority] || item.data.priority}
                          </span>
                        )}
                      </div>

                      <div className={styles.proposalItemMeta}>
                        <span>{item.authorName}</span>
                        <span>·</span>
                        <span>{formatDateShort(item.data.orderDate)}</span>
                        {(item.data.labels?.parcelId ||
                          (item.data.orderType === 'REMONT_SERVIS' && item.data.labels?.machineId)) && (
                          <>
                            <span>·</span>
                            <span>
                              {item.data.labels?.parcelId || item.data.labels?.machineId}
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {proposals.data && proposals.data.total > 0 && (
                <div style={{ padding: '0 0.85rem 0.85rem' }}>
                  <TablePagination
                    currentPage={proposalPage}
                    totalPages={
                      proposals.data.totalPages ||
                      Math.max(
                        1,
                        Math.ceil(
                          proposals.data.total / (proposals.data.pageSize || PROPOSAL_PAGE_SIZE)
                        )
                      )
                    }
                    totalItems={proposals.data.total}
                    pageSize={proposals.data.pageSize || PROPOSAL_PAGE_SIZE}
                    onPageChange={setProposalPage}
                    itemName="predloga"
                  />
                </div>
              )}
            </section>

            {/* DESNA KOLONA: DETALJI I ODLUKE */}
            <section className={styles.proposalDetailCol} aria-label="Detalji predloga">
              {!proposalId && (
                <div className={styles.detailCard}>
                  <div className={styles.emptyState}>
                    <ClipboardList size={42} color="#94a3b8" />
                    <span className={styles.emptyTitle}>
                      Izaberite predlog za detalje, komentare i odluke
                    </span>
                    <p className={styles.emptySub}>
                      Kliknite na bilo koji predlog sa leve strane ili napravite novi predlog radnog
                      naloga.
                    </p>
                    <button type="button" className={styles.btnPrimary} onClick={startNewProposal}>
                      <Plus size={16} />
                      <span>Novi predlog</span>
                    </button>
                  </div>
                </div>
              )}

              {proposalId && proposal.isPending && (
                <div className={styles.detailCard}>
                  <div className={styles.emptyState}>
                    <Loader2 size={32} className={styles.spinIcon} color="#16a34a" />
                    <span className={styles.emptyTitle}>Učitavanje predloga…</span>
                  </div>
                </div>
              )}

              {current && (
                <>
                  <article className={styles.detailCard}>
                    <div className={styles.detailHeader}>
                      <div className={styles.detailTitleGroup}>
                        <div className={styles.metaPills}>
                          <span className={`${styles.badge} ${statusBadgeClass(current.status)}`}>
                            {statusLabels[current.status] || current.status}
                          </span>
                          <span className={styles.codeBadge}>verzija {current.contentVersion}</span>
                          <span
                            className={`${styles.badge} ${priorityBadgeClass(current.data.priority)}`}
                          >
                            {priorityLabels[current.data.priority] || current.data.priority}
                          </span>
                          <span className={`${styles.badge} ${styles.badgeMuted}`}>
                            <Briefcase size={11} />
                            <span>
                              {orderTypeLabels[current.data.orderType] || current.data.orderType}
                            </span>
                          </span>
                        </div>
                        <h3 className={styles.detailTitle}>{current.data.title}</h3>
                        <div className={styles.metaPills}>
                          <span className={styles.subLine}>
                            <User size={13} />
                            <span>
                              Autor: <strong>{current.authorName}</strong>
                            </span>
                          </span>
                          <span className={styles.mutedText}>·</span>
                          <span className={styles.subLine}>
                            <UserCheck size={13} />
                            <span>
                              Recenzent:{' '}
                              <strong>
                                {current.reviewerId
                                  ? directorNameById.get(current.reviewerId) ||
                                    'Izabrani direktor (nije aktivan)'
                                  : 'Svi direktori'}
                              </strong>
                            </span>
                          </span>
                          <span className={styles.mutedText}>·</span>
                          <span className={styles.subLine}>
                            <Clock size={13} />
                            <span>Ažurirano: {time(current.updatedAt)}</span>
                          </span>
                        </div>
                      </div>

                      {current.status !== 'OTKAZAN' && !current.workOrderId && !editing && (
                        <div className={styles.detailActions}>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={mutation.isPending}
                            onClick={() => {
                              mutation.reset();
                              setEditing(current);
                            }}
                          >
                            <Pencil size={15} />
                            <span>Izmeni predlog</span>
                          </button>

                          {userId === current.authorId && !confirmCancel && (
                            <button
                              type="button"
                              className={styles.btnDanger}
                              disabled={mutation.isPending}
                              onClick={() => setConfirmCancel(true)}
                            >
                              <Ban size={15} />
                              <span>Povuci predlog</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {confirmCancel && current.status !== 'OTKAZAN' && !current.workOrderId && (
                      <div className={styles.confirmCancelBox} role="alert">
                        <span>
                          <strong>Potvrda povlačenja:</strong> Otkazan predlog se naknadno ne može
                          menjati. Da li ste sigurni?
                        </span>
                        <div className={styles.detailActions}>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={mutation.isPending}
                            onClick={() => setConfirmCancel(false)}
                          >
                            Odustani
                          </button>
                          <button
                            type="button"
                            className={styles.btnDanger}
                            disabled={mutation.isPending}
                            onClick={() => decideProposal('cancel')}
                          >
                            Potvrdi povlačenje
                          </button>
                        </div>
                      </div>
                    )}

                    {current.approvedAt && (
                      <div className={styles.successBanner}>
                        <CheckCircle2 size={18} />
                        <span>
                          Odobrio/la {current.approvedByName} · {time(current.approvedAt)} · verzija{' '}
                          {current.contentVersion}
                        </span>
                      </div>
                    )}

                    {current.workOrderId ? (
                      <div className={styles.approvedCardActions}>
                        <Link to="/nalozi" className={styles.approvedOrderLink}>
                          <ExternalLink size={16} />
                          <span>
                            Pretvoreno u Radni nalog #{current.convertedOrderNumber || ''} · Otvori
                          </span>
                        </Link>
                        {current.convertedByName && current.convertedAt && (
                          <span className={styles.hintText}>
                            Izvezao/la {current.convertedByName} · {time(current.convertedAt)}
                          </span>
                        )}
                      </div>
                    ) : (
                      current.status === 'ODOBREN' &&
                      !editing && (
                        <div className={styles.approvedCardActions}>
                          <button
                            type="button"
                            className={styles.btnPrimary}
                            disabled={convertSaving}
                            onClick={() => startConversion(current, false)}
                          >
                            {convertSaving && convertingDirectId === current.id ? (
                              <Loader2 size={16} className={styles.spin} />
                            ) : (
                              <PlayCircle size={16} />
                            )}
                            <span>Pretvori u Radni nalog</span>
                          </button>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={convertSaving}
                            onClick={() => startConversion(current, true)}
                          >
                            <Pencil size={15} />
                            <span>Dopuni i pretvori</span>
                          </button>
                        </div>
                      )
                    )}

                    <ProposalSummary data={current.data} />

                    {/* WORKFLOW: SLANJE NA PREGLED */}
                    {['NACRT', 'VRACEN_NA_DORADU'].includes(current.status) && !editing && (
                      <div className={styles.workflowBox}>
                        <h4 className={styles.sectionTitle}>
                          <Send size={16} color="#0284c7" />
                          <span>Slanje na pregled</span>
                        </h4>
                        <div className={styles.workflowRow}>
                          <div className={styles.workflowSelectWrap}>
                            <label htmlFor="proposal-reviewer-select">Pošalji na pregled</label>
                            <CustomSelect
                              id="proposal-reviewer-select"
                              value={reviewer}
                              onChange={setReviewer}
                              options={reviewerOptions}
                            />
                          </div>
                          <button
                            type="button"
                            className={styles.btnBlue}
                            disabled={mutation.isPending}
                            onClick={() => decideProposal('submit')}
                          >
                            {mutation.isPending ? (
                              <>
                                <Loader2 size={16} className={styles.spinIcon} />
                                <span>Slanje...</span>
                              </>
                            ) : (
                              <>
                                <Send size={15} />
                                <span>Pošalji na pregled</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* WORKFLOW: ODOBRENJE ILI VRAĆANJE NA DORADU */}
                    {current.status === 'NA_PREGLEDU' &&
                      !editing &&
                      (!current.reviewerId ||
                        current.reviewerId === userId ||
                        current.authorId === userId) && (
                        <ReturnChangesBox
                          key={current.id}
                          busy={mutation.isPending}
                          onApprove={() => decideProposal('approve')}
                          onReturnChanges={(text, clearInput) =>
                            decideProposal('request-changes', text, clearInput)
                          }
                        />
                      )}
                  </article>

                  {/* DODAVANJE KOMENTARA */}
                  <CommentComposer
                    key={`comment-${current.id}`}
                    busy={mutation.isPending}
                    onSubmit={handleAddComment}
                  />

                  {/* ISTORIJA I KOMENTARI */}
                  <div className={styles.detailCard}>
                    <h4 className={styles.sectionTitle}>
                      <HistoryIcon size={17} color="#0284c7" />
                      <span>Dogovor i istorija ({events.data?.total ?? 0})</span>
                    </h4>

                    {events.isPending && (
                      <div className={styles.emptyState}>
                        <Loader2 size={24} className={styles.spinIcon} color="#16a34a" />
                        <span>Učitavanje istorije…</span>
                      </div>
                    )}

                    {events.data && events.data.items.length > 0 && (
                      <div className={styles.timelineList}>
                        {events.data.items.map((item) => (
                          <article key={item.id} className={styles.timelineItem}>
                            <div className={styles.timelineHead}>
                              <div className={styles.timelineActor}>
                                <strong>{item.actorName}</strong>
                                <span
                                  className={`${styles.badge} ${actionBadgeClass(item.action)}`}
                                >
                                  {actionLabels[item.action] || item.action}
                                </span>
                                <span className={styles.codeBadge}>v{item.contentVersion}</span>
                              </div>
                              <span className={styles.mutedText}>{time(item.createdAt)}</span>
                            </div>

                            {item.body && <p className={styles.messageBody}>{item.body}</p>}

                            {item.snapshot && (
                              <SnapshotDetails
                                contentVersion={item.contentVersion}
                                snapshot={item.snapshot}
                              />
                            )}
                          </article>
                        ))}
                      </div>
                    )}

                    {events.data && events.data.total > PAGE_SIZE && (
                      <TablePagination
                        currentPage={eventPage}
                        totalPages={Math.max(1, Math.ceil(events.data.total / PAGE_SIZE))}
                        totalItems={events.data.total}
                        pageSize={PAGE_SIZE}
                        onPageChange={setEventPage}
                        itemName="zapisa"
                      />
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      )}

      {/* ========================================================
          TAB 4: ODOBRENI RADNI NALOZI
         ======================================================== */}
      {tab === 'odobreni' && (
        <>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={`${styles.statIcon} ${styles.iconAmber}`}>
                <Clock size={22} />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statValue}>{approvedPageStats.pending}</span>
                <span className={styles.statLabel}>Čekaju pretvaranje</span>
                <span className={styles.statSub}>Odobreni, još bez radnog naloga</span>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={`${styles.statIcon} ${styles.iconBlue}`}>
                <CheckCheck size={22} />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statValue}>{approvedPageStats.total}</span>
                <span className={styles.statLabel}>Odobreno u filteru</span>
                <span className={styles.statSub}>Ukupno za izabrani prikaz</span>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={`${styles.statIcon} ${styles.iconGreen}`}>
                <PlayCircle size={22} />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statValue}>{approvedPageStats.readyDirect}</span>
                <span className={styles.statLabel}>Spremno jednim klikom</span>
                <span className={styles.statSub}>Na ovoj strani sa svim podacima</span>
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={`${styles.statIcon} ${styles.iconGreen}`}>
                <CheckCircle2 size={22} />
              </div>
              <div className={styles.statContent}>
                <span className={styles.statValue}>{approvedPageStats.converted}</span>
                <span className={styles.statLabel}>Pretvoreno (strana)</span>
                <span className={styles.statSub}>Već izvezeno u Radne naloge</span>
              </div>
            </div>
          </div>

          <section className={styles.filterCard} aria-label="Filteri odobrenih naloga">
            <div className={`${styles.filterGroup} ${styles.filterGroupSearch}`}>
              <label htmlFor="approved-search-input">Pretraga odobrenih</label>
              <div className={styles.searchWrap}>
                <Search size={15} className={styles.searchIcon} />
                <input
                  id="approved-search-input"
                  className={styles.searchInput}
                  value={approvedSearch}
                  onChange={(e) => {
                    setApprovedSearch(e.target.value);
                    setApprovedPage(1);
                  }}
                  placeholder="Pretraži naziv, autora, parcelu…"
                  aria-label="Pretraga odobrenih predloga"
                />
                {approvedSearch && (
                  <button
                    type="button"
                    className={styles.clearSearchBtn}
                    onClick={() => {
                      setApprovedSearch('');
                      setApprovedPage(1);
                    }}
                    aria-label="Obriši pretragu odobrenih"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="approved-status-filter">Status pretvaranja</label>
              <CustomSelect
                id="approved-status-filter"
                value={approvedFilter}
                onChange={(val) => {
                  setApprovedFilter((val as 'all' | 'pending' | 'converted') || 'all');
                  setApprovedPage(1);
                }}
                options={approvedFilterOptions}
                searchable={false}
              />
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="approved-order-type-filter">Tip rada</label>
              <CustomSelect
                id="approved-order-type-filter"
                value={approvedOrderTypeFilter}
                onChange={(val) => {
                  setApprovedOrderTypeFilter(val);
                  setApprovedPage(1);
                }}
                options={PROPOSAL_ORDER_TYPE_FILTER_OPTIONS}
                searchable={false}
              />
            </div>

            {(approvedSearch || approvedFilter !== 'all' || approvedOrderTypeFilter) && (
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => {
                  setApprovedSearch('');
                  setApprovedFilter('all');
                  setApprovedOrderTypeFilter('');
                  setApprovedPage(1);
                }}
              >
                <RotateCcw size={15} />
                <span>Resetuj</span>
              </button>
            )}
          </section>

          <div className={styles.approvedList}>
            {approvedProposals.isPending && (
              <div className={styles.emptyState}>
                <Loader2 size={26} className={styles.spinIcon} color="#16a34a" />
                <span>Učitavanje odobrenih radnih naloga…</span>
              </div>
            )}

            {!approvedProposals.isPending &&
              approvedProposals.data?.items.length === 0 &&
              !approvedSearch.trim() &&
              approvedFilter === 'all' &&
              !approvedOrderTypeFilter && (
                <div className={styles.emptyState}>
                  <CheckCheck size={34} color="#94a3b8" />
                  <span className={styles.emptyTitle}>Nema odobrenih predloga</span>
                  <p className={styles.emptySub}>
                    Kada direktor odobri predlog na tabu Predlozi naloga, pojaviće se ovde spreman za
                    pretvaranje u pravi Radni nalog.
                  </p>
                </div>
              )}

            {!approvedProposals.isPending &&
              filteredApprovedProposals.length === 0 &&
              Boolean(approvedSearch.trim() || approvedFilter !== 'all' || approvedOrderTypeFilter) && (
                <div className={styles.emptyState}>
                  <span className={styles.emptyTitle}>Nema rezultata za izabrane filtere</span>
                  <button
                    type="button"
                    className={styles.btnSecondary}
                    onClick={() => {
                      setApprovedSearch('');
                      setApprovedFilter('all');
                      setApprovedOrderTypeFilter('');
                      setApprovedPage(1);
                    }}
                  >
                    Resetuj filtere
                  </button>
                </div>
              )}

            {filteredApprovedProposals.map((item) => {
              const isConverted = Boolean(item.workOrderId);
              const isDirectBusy = convertSaving && convertingDirectId === item.id;
              return (
                <article
                  key={item.id}
                  className={`${styles.approvedCard} ${
                    isConverted ? styles.approvedCardConverted : ''
                  }`}
                >
                  <div className={styles.approvedCardHeader}>
                    <div className={styles.detailTitleGroup}>
                      <div className={styles.metaPills}>
                        {isConverted ? (
                          <span className={`${styles.badge} ${styles.badgeSuccess}`}>
                            <CheckCircle2 size={12} />
                            <span>Pretvoreno #{item.convertedOrderNumber || ''}</span>
                          </span>
                        ) : (
                          <span className={`${styles.badge} ${styles.badgeWarning}`}>
                            <Clock size={12} />
                            <span>Čeka pretvaranje</span>
                          </span>
                        )}
                        <span className={`${styles.badge} ${priorityBadgeClass(item.data.priority)}`}>
                          {priorityLabels[item.data.priority] || item.data.priority}
                        </span>
                        <span className={`${styles.badge} ${styles.badgeMuted}`}>
                          <Briefcase size={11} />
                          <span>{orderTypeLabels[item.data.orderType] || item.data.orderType}</span>
                        </span>
                      </div>
                      <h3 className={styles.detailTitle}>{item.data.title}</h3>
                      <div className={styles.metaPills}>
                        <span className={styles.subLine}>
                          <User size={13} />
                          <span>
                            Autor: <strong>{item.authorName}</strong>
                          </span>
                        </span>
                        {item.approvedByName && item.approvedAt && (
                          <>
                            <span className={styles.mutedText}>·</span>
                            <span className={styles.subLine}>
                              <CheckCircle2 size={13} />
                              <span>
                                Odobrio/la <strong>{item.approvedByName}</strong> ·{' '}
                                {time(item.approvedAt)}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className={styles.approvedCardActions}>
                      {isConverted ? (
                        <Link to="/nalozi" className={styles.approvedOrderLink}>
                          <ExternalLink size={15} />
                          <span>Otvori nalog #{item.convertedOrderNumber || ''}</span>
                        </Link>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={styles.btnPrimary}
                            disabled={convertSaving}
                            onClick={() => startConversion(item, false)}
                          >
                            {isDirectBusy ? (
                              <Loader2 size={16} className={styles.spinIcon} />
                            ) : (
                              <PlayCircle size={16} />
                            )}
                            <span>Pretvori u Radni nalog</span>
                          </button>
                          <button
                            type="button"
                            className={styles.btnSecondary}
                            disabled={convertSaving}
                            onClick={() => startConversion(item, true)}
                          >
                            <Pencil size={15} />
                            <span>Dopuni i pretvori</span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        className={styles.btnSecondary}
                        onClick={() => openProposal(item.id)}
                      >
                        <ClipboardList size={15} />
                        <span>Detalji</span>
                      </button>
                    </div>
                  </div>

                  {isConverted && item.convertedByName && item.convertedAt && (
                    <div className={styles.successBanner}>
                      <CheckCircle2 size={18} />
                      <span>
                        Radni nalog #{item.convertedOrderNumber || ''} kreirao/la{' '}
                        {item.convertedByName} · {time(item.convertedAt)}
                      </span>
                    </div>
                  )}

                  <ProposalSummary data={item.data} />
                </article>
              );
            })}
          </div>

          {approvedProposals.data && approvedProposals.data.total > 0 && (
            <TablePagination
              currentPage={approvedPage}
              totalPages={
                approvedProposals.data.totalPages ||
                Math.max(
                  1,
                  Math.ceil(
                    approvedProposals.data.total /
                      (approvedProposals.data.pageSize || PROPOSAL_PAGE_SIZE)
                  )
                )
              }
              totalItems={approvedProposals.data.total}
              pageSize={approvedProposals.data.pageSize || PROPOSAL_PAGE_SIZE}
              onPageChange={setApprovedPage}
              itemName="odobrenih predloga"
            />
          )}
        </>
      )}

      {/* MODAL ZA NOVI PREDLOG / IZMENU PREDLOGA */}
      {editing !== null && (
        <ProposalForm
          key={editing === 'new' ? 'new' : `${editing.id}-${editing.version}`}
          initial={editing === 'new' ? undefined : editing.data}
          catalog={catalog.data}
          catalogLoading={catalog.isPending}
          busy={mutation.isPending}
          error={mutation.error?.message || catalog.error?.message}
          onSave={saveProposal}
          onCancel={() => {
            mutation.reset();
            setEditing(null);
          }}
        />
      )}

      {/* MODAL ZA DOPUNU I PRETVARANJE U RADNI NALOG */}
      {convertingProposal && (
        <ConvertProposalModal
          key={`${convertingProposal.id}-${convertingProposal.version}`}
          proposal={convertingProposal}
          catalog={catalog.data}
          saving={convertSaving}
          error={convertError}
          onClose={() => {
            if (convertSaving) return;
            setConvertingProposal(null);
            setConvertError(null);
          }}
          onConvert={executeConvertProposal}
        />
      )}
    </div>
  );
}
