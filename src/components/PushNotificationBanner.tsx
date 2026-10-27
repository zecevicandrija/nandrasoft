import React, { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCircle2, AlertCircle, Loader2, X } from 'lucide-react';
import {
  autoSyncPushSubscription,
  subscribeUserToPush,
  sendTestPush,
  isPushSupported,
} from '../lib/pushClient';

interface PushNotificationBannerProps {
  userId?: string;
  onPushReceived?: () => void;
  showActiveStatus?: boolean;
  variant?: 'banner' | 'sidebar';
}

const PushNotificationBanner: React.FC<PushNotificationBannerProps> = ({
  userId,
  onPushReceived,
  showActiveStatus = false,
  variant = 'banner',
}) => {
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(
    null
  );

  const onPushReceivedRef = useRef(onPushReceived);
  useEffect(() => {
    onPushReceivedRef.current = onPushReceived;
  }, [onPushReceived]);

  useEffect(() => {
    if (!userId) return;

    const pushOk = isPushSupported();
    setSupported(pushOk);
    if (!pushOk) {
      setPermission('unsupported');
      return;
    }

    setPermission(Notification.permission);

    // Automatski poveži pretplatu (izvršava mrežni zahtev samo jednom po sesiji)
    autoSyncPushSubscription(userId).then((res) => {
      setPermission(res.permission);
      setSubscribed(res.subscribed);
    });

    // Slušaj poruke iz Service Worker-a (kada stigne Web Push dok je aplikacija otvorena)
    const handleSwMessage = (event: MessageEvent) => {
      if (
        event.data?.type === 'WORK_ORDER_PUSH_RECEIVED' ||
        event.data?.type === 'WORK_ORDER_PUSH_CLICKED'
      ) {
        onPushReceivedRef.current?.();
      }
    };

    navigator.serviceWorker?.addEventListener('message', handleSwMessage);

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
    };
  }, [userId]);

  const handleEnablePush = async () => {
    setLoading(true);
    setFeedback(null);
    const res = await subscribeUserToPush(userId);
    setLoading(false);
    setPermission(res.permission);
    setSubscribed(res.success);

    if (res.success) {
      setFeedback({
        text: 'Notifikacije su uspešno uključene za ovaj uređaj!',
        type: 'success',
      });
      setTimeout(() => setFeedback(null), 4000);
    } else if (res.error) {
      setFeedback({
        text: res.error,
        type: 'error',
      });
    }
  };

  const handleSendTest = async () => {
    setTesting(true);
    setFeedback(null);
    await subscribeUserToPush(userId);
    const res = await sendTestPush();
    setTesting(false);

    if (res.ok) {
      setFeedback({
        text: 'Test notifikacija je poslata! Proverite obaveštenje na ekranu.',
        type: 'success',
      });
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setFeedback({
        text: res.error || 'Greška pri slanju test notifikacije.',
        type: 'error',
      });
    }
  };

  if (!userId || !supported) {
    return null;
  }

  // ==========================================
  // VARIJANTA ZA LEVI MENI (SIDEBAR SKROZ DOLE)
  // ==========================================
  if (variant === 'sidebar') {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setModalOpen(true);
            setFeedback(null);
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            padding: '0.65rem 0.85rem',
            borderRadius: '9px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-card, #ffffff)',
            color: 'var(--text-primary)',
            fontSize: '0.86rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxSizing: 'border-box',
          }}
          title="Podešavanje obaveštenja za radne naloge"
        >
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {subscribed ? (
              <BellRing size={17} color="#16a34a" />
            ) : permission === 'denied' ? (
              <AlertCircle size={17} color="#ef4444" />
            ) : (
              <Bell size={17} color="#0284c7" />
            )}
          </span>
          <span style={{ flex: 1, textAlign: 'left' }}>Notifikacije</span>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '0.15rem 0.45rem',
              borderRadius: '999px',
              backgroundColor: subscribed
                ? 'rgba(22, 163, 74, 0.12)'
                : permission === 'denied'
                ? 'rgba(239, 68, 68, 0.12)'
                : 'rgba(2, 132, 199, 0.12)',
              color: subscribed ? '#16a34a' : permission === 'denied' ? '#ef4444' : '#0284c7',
            }}
          >
            {subscribed ? 'Aktivno' : permission === 'denied' ? 'Blokirano' : 'Uključi'}
          </span>
        </button>

        {modalOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.6)',
              backdropFilter: 'blur(3px)',
              zIndex: 99999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1rem',
            }}
          >
            <div
              style={{
                backgroundColor: 'var(--bg-card, #ffffff)',
                border: '1px solid var(--border-color)',
                borderRadius: '14px',
                width: '100%',
                maxWidth: '460px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
                overflow: 'hidden',
                textAlign: 'left',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  padding: '1rem 1.25rem',
                  borderBottom: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontWeight: 800,
                    fontSize: '1rem',
                    color: 'var(--text-primary)',
                  }}
                >
                  <BellRing size={19} color="#0284c7" />
                  <span>Obaveštenja za radne naloge</span>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    padding: '0.2rem',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {subscribed
                    ? 'Push notifikacije za radne naloge su uključene za ovaj uređaj. Čim poslovođa izda radni zadatak, dobićete zvučno i vizuelno obaveštenje na telefon.'
                    : permission === 'denied'
                    ? 'Notifikacije su blokirane u pretraživaču. Da biste ih omogućili, kliknite na ikonicu katanca pored adrese sajta u pretraživaču i dozvolite Obaveštenja (Notifications).'
                    : 'Uključite notifikacije da vam na telefon stigne poruka čim se izda novi radni nalog.'}
                </p>

                {subscribed && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      background: 'rgba(22, 163, 74, 0.08)',
                      border: '1px solid rgba(22, 163, 74, 0.25)',
                      color: '#16a34a',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                    }}
                  >
                    <CheckCircle2 size={16} />
                    <span>Push notifikacije su aktivne na ovom uređaju</span>
                  </div>
                )}

                {feedback && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      background:
                        feedback.type === 'success'
                          ? 'rgba(22, 163, 74, 0.08)'
                          : 'rgba(239, 68, 68, 0.08)',
                      border: `1px solid ${
                        feedback.type === 'success'
                          ? 'rgba(22, 163, 74, 0.25)'
                          : 'rgba(239, 68, 68, 0.25)'
                      }`,
                      color: feedback.type === 'success' ? '#16a34a' : '#dc2626',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                    }}
                  >
                    {feedback.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                    <span>{feedback.text}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    style={{
                      padding: '0.55rem 0.95rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Zatvori
                  </button>

                  {!subscribed && permission !== 'denied' && (
                    <button
                      type="button"
                      onClick={handleEnablePush}
                      disabled={loading}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        padding: '0.55rem 1.15rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#0284c7',
                        color: '#ffffff',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: loading ? 'wait' : 'pointer',
                      }}
                    >
                      {loading ? (
                        <Loader2 size={15} style={{ animation: 'spin 0.8s linear infinite' }} />
                      ) : (
                        <Bell size={15} />
                      )}
                      <span>{loading ? 'Uključivanje...' : 'Uključi notifikacije'}</span>
                    </button>
                  )}

                  {subscribed && (
                    <button
                      type="button"
                      onClick={handleSendTest}
                      disabled={testing}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        padding: '0.55rem 1.15rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-secondary, #f8fafc)',
                        color: 'var(--text-primary)',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        cursor: testing ? 'wait' : 'pointer',
                      }}
                    >
                      <BellRing size={15} color="#0284c7" />
                      <span>{testing ? 'Slanje...' : 'Pošalji test notifikaciju'}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Ako još nije odobrena dozvola (default) ili još nije pretplaćen — prikaži uočljiv poziv za aktivaciju
  if (permission === 'default' || (permission === 'granted' && !subscribed)) {
    return (
      <div
        style={{
          width: '100%',
          background: 'rgba(2, 132, 199, 0.1)',
          border: '1.5px solid rgba(2, 132, 199, 0.35)',
          borderRadius: '12px',
          padding: '0.85rem 1rem',
          margin: '0.5rem 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: '1 1 220px' }}>
          <BellRing size={20} color="#0284c7" style={{ flexShrink: 0 }} />
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
              Obaveštenja za radne naloge
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Uključite notifikacije da vam na telefon stigne poruka čim se izda novi radni nalog.
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleEnablePush}
          disabled={loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.4rem',
            padding: '0.55rem 1rem',
            borderRadius: '8px',
            border: 'none',
            background: '#0284c7',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: '0.83rem',
            cursor: loading ? 'wait' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? <Loader2 size={15} className="spin" /> : <Bell size={15} />}
          <span>{loading ? 'Uključivanje...' : 'Uključi notifikacije'}</span>
        </button>

        {feedback && (
          <div
            style={{
              width: '100%',
              fontSize: '0.8rem',
              fontWeight: 600,
              color: feedback.type === 'success' ? '#16a34a' : '#dc2626',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
            }}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span>{feedback.text}</span>
          </div>
        )}
      </div>
    );
  }

  // Ako su notifikacije blokirane u pretraživaču
  if (permission === 'denied') {
    return (
      <div
        style={{
          width: '100%',
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '10px',
          padding: '0.7rem 0.9rem',
          margin: '0.5rem 0',
          display: 'flex',
          alignItems: 'center',
          gap: '0.55rem',
          fontSize: '0.8rem',
          color: 'var(--text-primary)',
          textAlign: 'left',
          boxSizing: 'border-box',
        }}
      >
        <AlertCircle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
        <span>
          Notifikacije su blokirane u pretraživaču. Kliknite na ikonicu katanca pored adrese sajta i
          dozvolite <strong>Obaveštenja (Notifications)</strong> kako bi vam stizali radni nalozi.
        </span>
      </div>
    );
  }

  // Ako su aktivne i tražen je prikaz statusa (npr. na početnom ekranu radnika)
  if (showActiveStatus && subscribed) {
    return (
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
          margin: '0.4rem 0',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.5rem',
            padding: '0.5rem 0.8rem',
            borderRadius: '10px',
            background: 'rgba(22, 163, 74, 0.08)',
            border: '1px solid rgba(22, 163, 74, 0.25)',
            fontSize: '0.78rem',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              color: '#16a34a',
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={15} />
            <span>Push notifikacije za naloge su aktivne</span>
          </div>

          <button
            type="button"
            onClick={handleSendTest}
            disabled={testing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.28rem 0.65rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: '0.74rem',
              fontWeight: 600,
              cursor: testing ? 'wait' : 'pointer',
            }}
          >
            <BellRing size={12} />
            <span>{testing ? 'Slanje...' : 'Test notifikacija'}</span>
          </button>
        </div>

        {feedback && (
          <div
            style={{
              fontSize: '0.76rem',
              fontWeight: 600,
              color: feedback.type === 'success' ? '#16a34a' : '#dc2626',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.35rem',
            }}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            <span>{feedback.text}</span>
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default PushNotificationBanner;
