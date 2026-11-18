import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import styles from './MachineUsageModal.module.css';

type Props = { onClick: () => void; disabled?: boolean; compact?: boolean; inset?: boolean };

export default function MachineUsageAction({ onClick, disabled, compact, inset }: Props) {
  return <div className={inset ? styles.launchInset : undefined}>
    <button type="button" className={compact ? styles.inlineButton : styles.launchButton} disabled={disabled} onClick={onClick}>
      <span className={compact ? styles.inlineIcon : styles.launchIcon}><ArrowRightLeft size={compact ? 16 : 20} /></span>
      <span className={styles.launchCopy}><strong>Promeni mašinu</strong>{!compact && <span>Ispravi izbor, zameni ili dodaj korišćenu mašinu.</span>}</span>
      {!compact && <ArrowRight size={18} className={styles.launchArrow} />}
    </button>
  </div>;
}
