import gearIcon from '../../assets/gear_icon.png';
import { styles } from '../../styles/theme.js';

export default function TopBar({ environmentName, onBack, onOpenSettings }) {
  return (
    <header style={styles.globalTopBar}>
      <div style={styles.topBarLeft}>
        <span style={styles.envLabel}>
          Environment: <strong>{environmentName}</strong>
        </span>
        <button type="button" style={styles.linkButton} onClick={onBack}>
          ← Back to Switch Screen
        </button>
      </div>
      <button
        type="button"
        style={styles.gearButton}
        onClick={onOpenSettings}
        title="Settings"
        aria-label="Open settings"
      >
        <img src={gearIcon} alt="" style={styles.gearIcon} />
      </button>
    </header>
  );
}
