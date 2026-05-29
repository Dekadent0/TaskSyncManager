import { styles } from '../../styles/theme.js';
import { formatActivityTime, getActivityStatusLabel } from '../../utils/syncLog.js';

function activityBadgeStyle(status) {
  switch (status) {
    case 'error':
      return { ...styles.syncLogBadge, ...styles.syncLogBadgeError };
    case 'skipped':
      return { ...styles.syncLogBadge, ...styles.syncLogBadgeSkipped };
    case 'info':
      return { ...styles.syncLogBadge, ...styles.syncLogBadgeInfo };
    default:
      return { ...styles.syncLogBadge, ...styles.syncLogBadgeOk };
  }
}

function SyncActivityList({ entries }) {
  return (
    <>
      <h3 style={styles.syncLogHeading}>Recent Updates</h3>
      <div style={styles.syncLogConsole} aria-live="polite">
        {entries.length === 0 ? (
          <div style={styles.syncLogLineMuted}>No recent activity</div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={entry.id ?? index}
              style={{
                ...styles.syncLogEntry,
                ...(index === entries.length - 1 ? styles.syncLogEntryLast : {}),
              }}
            >
              {entry.status === 'error' && (
                <span style={activityBadgeStyle(entry.status)}>
                  {getActivityStatusLabel(entry.status)}
                </span>
              )}
              <span
                style={{
                  ...styles.syncLogMessage,
                  ...(entry.status === 'error' ? {} : { flex: '1 1 100%' }),
                }}
              >
                {entry.message}
              </span>
              <span style={styles.syncLogTimestamp}>
                {formatActivityTime(entry.timestamp)}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function DataSummary({ loading, fetchError, trelloBoards, jiraProjects, jiraBoards }) {
  return (
    <section style={styles.leftSection}>
      <h2 style={styles.sectionTitle}>Loaded data:</h2>
      {loading && <p style={styles.hint}>Loading…</p>}
      {fetchError && <p style={{ ...styles.status, color: '#de350b' }}>{fetchError}</p>}
      <div style={styles.summaryBox}>
        <div style={styles.summarySection}>
          <div style={styles.summaryTitle}>Trello Boards ({trelloBoards.length}):</div>
          {trelloBoards.length === 0 ? (
            <div style={styles.summaryEmpty}>None loaded</div>
          ) : (
            <ul style={styles.summaryList}>
              {trelloBoards.map((b) => (
                <li key={b.id}>{b.name}</li>
              ))}
            </ul>
          )}
        </div>
        <div style={styles.summarySection}>
          <div style={styles.summaryTitle}>Jira Projects ({jiraProjects.length}):</div>
          {jiraProjects.length === 0 ? (
            <div style={styles.summaryEmpty}>None loaded</div>
          ) : (
            <ul style={styles.summaryList}>
              {jiraProjects.map((p) => {
                const boardsInProject = jiraBoards.filter(
                  (b) =>
                    String(b.projectId) === String(p.id) ||
                    String(b.projectKey) === String(p.key)
                );
                const boardWord = boardsInProject.length === 1 ? 'board' : 'boards';
                return (
                  <li key={p.id} style={styles.summaryListItem}>
                    <div style={styles.summaryProjectLine}>
                      {p.name} ({boardsInProject.length} {boardWord})
                    </div>
                    {boardsInProject.length > 0 && (
                      <ul style={styles.summarySubList}>
                        {boardsInProject.map((b) => (
                          <li key={b.id}>{b.name}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export default function LeftPanel({
  loading,
  fetchError,
  trelloBoards,
  jiraProjects,
  jiraBoards,
  rulesCount,
  onManageRules,
  syncActivity = [],
}) {
  return (
    <aside style={styles.leftPanel}>
      <DataSummary
        loading={loading}
        fetchError={fetchError}
        trelloBoards={trelloBoards}
        jiraProjects={jiraProjects}
        jiraBoards={jiraBoards}
      />

      <section style={styles.leftSection}>
        <div style={styles.rulesSummaryTop}>
          <div style={styles.rulesSummaryCount}>{rulesCount} rules active</div>
          <button type="button" style={styles.btnPrimary} onClick={onManageRules}>
            Manage Syncing Rules
          </button>
        </div>
      </section>

      <section style={{ ...styles.leftSection, marginTop: 'auto' }}>
        <h2 style={styles.sectionTitle}>Sync:</h2>
        <p style={styles.hint}>
          Changes sync automatically when Trello cards or Jira issues update
          (webhooks).
        </p>
        <SyncActivityList entries={syncActivity} />
      </section>
    </aside>
  );
}
