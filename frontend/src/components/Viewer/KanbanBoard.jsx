import { styles } from '../../styles/theme.js';

/**
 * Horizontal kanban: columns with scrollable task lists.
 *
 * @param {Array<{ id: string, name: string }>} columns
 * @param {Array<object>} items — raw items to bucket per column
 * @param {string} columnIdKey — field on item matching column.id (e.g. idList, statusId)
 * @param {(item: object) => import('react').ReactNode} renderCard
 * @param {(item: object) => string | null | undefined} [getItemHref] — when set, whole card is a link
 */
export default function KanbanBoard({
  columns,
  items,
  columnIdKey,
  renderCard,
  getItemHref,
}) {
  if (!columns?.length) {
    return null;
  }

  return (
    <div style={styles.kanbanRow}>
      {columns.map((col) => (
        <div key={col.id} style={styles.kanbanColumn}>
          <div style={styles.kanbanColumnHeader}>{col.name}</div>
          <div style={styles.kanbanColumnBody}>
            {items
              .filter((item) => String(item[columnIdKey]) === String(col.id))
              .map((item) => {
                const href = getItemHref?.(item);
                const content = renderCard(item);

                if (href) {
                  return (
                    <a
                      key={item.id}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="kanban-task-card"
                      style={styles.taskCard}
                      title={typeof content === 'string' ? content : undefined}
                    >
                      {content}
                    </a>
                  );
                }

                return (
                  <div key={item.id} style={styles.taskCard}>
                    {content}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
