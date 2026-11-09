import styles from './PhotoAttachment.module.css';

export default function PhotoAttachment({ url, label = 'Pogledaj fotografiju' }: { url?: string | null; label?: string }) {
  if (!url) return null;
  try { if (!['https:', 'http:'].includes(new URL(url).protocol)) return null; }
  catch { return null; }
  return <span className={styles.attachment}>
    <a className={styles.desktopLink} href={url} target="_blank" rel="noopener noreferrer">
      <img src={url} alt={label} loading="lazy" />
      <span>{label}</span>
    </a>
    <img className={styles.mobileImage} src={url} alt={label} loading="lazy" />
  </span>;
}
