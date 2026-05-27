import { styles } from '../../styles/theme.js';
import { getTrelloCardUrl } from '../../utils/boardLinks.js';
import KanbanBoard from './KanbanBoard.jsx';

export default function TrelloViewer({
  boards,
  selectedBoardId,
  onBoardChange,
  cards,
  loading,
}) {
  const board = boards.find((b) => b.id === selectedBoardId);
  const lists = board?.lists ?? [];

  return (
    <div style={styles.viewerBlock}>
      <h2 style={{ ...styles.viewerTitle, ...styles.viewerTitleTrello }}>
        Trello Boards Viewer
      </h2>
      <select
        style={styles.viewerSelect}
        value={selectedBoardId}
        onChange={(e) => onBoardChange(e.target.value)}
        disabled={!boards.length}
      >
        <option value="">— Select Trello board —</option>
        {boards.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {!selectedBoardId ? (
        <p style={styles.placeholder}>Select a Trello board to view live cards…</p>
      ) : loading ? (
        <p style={styles.placeholder}>Loading cards…</p>
      ) : (
        <KanbanBoard
          columns={lists}
          items={cards}
          columnIdKey="idList"
          getItemHref={getTrelloCardUrl}
          renderCard={(card) => card.name}
        />
      )}
    </div>
  );
}
