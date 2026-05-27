import { styles } from '../../styles/theme.js';
import { getJiraIssueUrl } from '../../utils/boardLinks.js';
import KanbanBoard from './KanbanBoard.jsx';

export default function JiraViewer({
  jiraDomain,
  boards,
  selectedBoardId,
  onBoardChange,
  issues,
  loading,
}) {
  const board = boards.find((b) => String(b.id) === String(selectedBoardId));
  const columns = board?.columns ?? [];

  return (
    <div style={styles.viewerBlock}>
      <h2 style={{ ...styles.viewerTitle, ...styles.viewerTitleJira }}>
        Jira Boards Viewer
      </h2>
      <select
        style={styles.viewerSelect}
        value={selectedBoardId}
        onChange={(e) => onBoardChange(e.target.value)}
        disabled={!boards.length}
      >
        <option value="">— Select Jira board —</option>
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
            {b.projectName ? ` (${b.projectName})` : ''}
          </option>
        ))}
      </select>
      {!selectedBoardId ? (
        <p style={styles.placeholder}>Select a Jira board to view live issues…</p>
      ) : loading ? (
        <p style={styles.placeholder}>Loading issues…</p>
      ) : (
        <KanbanBoard
          columns={columns}
          items={issues}
          columnIdKey="statusId"
          getItemHref={(issue) => getJiraIssueUrl(jiraDomain, issue)}
          renderCard={(issue) => (
            <>
              <div style={styles.issueKey}>{issue.key}</div>
              <div>{issue.summary}</div>
            </>
          )}
        />
      )}
    </div>
  );
}
