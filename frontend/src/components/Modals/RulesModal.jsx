import { useState, useEffect } from 'react';
import { API, apiRequest, withEnvironmentId } from '../../api.js';
import { styles } from '../../styles/theme.js';

export default function RulesModal({
  environmentId,
  trelloBoards,
  jiraProjects,
  jiraBoards,
  rules,
  onClose,
  onRefreshRules,
}) {
  const [view, setView] = useState('grid'); // grid | editor
  const [menuRuleId, setMenuRuleId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  // Editor state
  const [editingId, setEditingId] = useState(null);
  const [direction, setDirection] = useState('trello-to-jira');
  const [ruleName, setRuleName] = useState('');
  const [trelloBoardId, setTrelloBoardId] = useState('');
  const [trelloListId, setTrelloListId] = useState('');
  const [jiraProjectId, setJiraProjectId] = useState('');
  const [jiraBoardId, setJiraBoardId] = useState('');
  const [jiraColumnId, setJiraColumnId] = useState('');

  const nextRuleNumber = rules.length + 1;
  const ruleTrelloBoard = trelloBoards.find((b) => b.id === trelloBoardId);
  const ruleLists = ruleTrelloBoard?.lists ?? [];
  const boardsForProject = jiraBoards.filter(
    (b) =>
      String(b.projectId) === String(jiraProjectId) ||
      String(b.projectKey) === String(jiraProjectId)
  );
  const ruleJiraBoard = jiraBoards.find((b) => String(b.id) === String(jiraBoardId));
  const ruleColumns = ruleJiraBoard?.columns ?? [];

  useEffect(() => {
    const close = () => setMenuRuleId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const openNewRule = () => {
    setStatus('');
    setEditingId(null);
    setDirection('trello-to-jira');
    setRuleName(`Rule ${nextRuleNumber}`);

    const firstTrello = trelloBoards[0];
    setTrelloBoardId(firstTrello?.id ?? '');
    setTrelloListId(firstTrello?.lists?.[0]?.id ?? '');

    const firstProject = jiraProjects[0];
    const firstProjectId = firstProject ? String(firstProject.id) : '';
    setJiraProjectId(firstProjectId);

    const firstBoards = jiraBoards.filter((b) => String(b.projectId) === firstProjectId);
    const firstBoardId = firstBoards[0] ? String(firstBoards[0].id) : '';
    setJiraBoardId(firstBoardId);
    setJiraColumnId(firstBoards[0]?.columns?.[0]?.id ?? '');

    setView('editor');
  };

  const openEditRule = (rule) => {
    setStatus('');
    setEditingId(rule.id);
    setDirection(rule.direction === 'jira-to-trello' ? 'jira-to-trello' : 'trello-to-jira');
    setRuleName(rule.name || `Rule ${rule.id}`);
    setTrelloBoardId(rule.trello_board_id ?? '');
    setTrelloListId(rule.trello_source_column_id ?? '');
    setJiraProjectId(String(rule.jira_project_id ?? ''));
    setJiraBoardId(String(rule.jira_board_id ?? ''));
    setJiraColumnId(rule.jira_target_column_id ?? '');
    setView('editor');
  };

  const handleSaveRule = async () => {
    if (
      !ruleName.trim() ||
      !trelloBoardId ||
      !trelloListId ||
      !jiraProjectId ||
      !jiraBoardId ||
      !jiraColumnId
    ) {
      setStatus('Please complete all fields.');
      return;
    }

    setSaving(true);
    setStatus('');
    try {
      if (editingId) {
        await apiRequest(`${API}/rules/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({
            environmentId,
            name: ruleName.trim(),
            direction,
            trello_board_id: trelloBoardId,
            trello_source_column_id: trelloListId,
            jira_project_id: jiraProjectId,
            jira_board_id: jiraBoardId,
            jira_target_column_id: jiraColumnId,
          }),
        });
      } else {
        await apiRequest(`${API}/rules`, {
          method: 'POST',
          body: JSON.stringify({
            environmentId,
            name: ruleName.trim(),
            direction,
            trello_board_id: trelloBoardId,
            trello_source_column_id: trelloListId,
            jira_project_id: jiraProjectId,
            jira_board_id: jiraBoardId,
            jira_target_column_id: jiraColumnId,
          }),
        });
      }

      await onRefreshRules();
      setView('grid');
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId) => {
    if (!window.confirm('Delete this rule?')) return;
    try {
      await apiRequest(withEnvironmentId(`${API}/rules/${ruleId}`, environmentId), {
        method: 'DELETE',
      });
      await onRefreshRules();
    } catch (err) {
      window.alert(err.message || 'Failed to delete rule.');
    } finally {
      setMenuRuleId(null);
    }
  };

  const handleTrelloBoardChange = (e) => {
    const id = e.target.value;
    setTrelloBoardId(id);
    const board = trelloBoards.find((b) => b.id === id);
    setTrelloListId(board?.lists?.[0]?.id ?? '');
  };

  const handleJiraProjectChange = (e) => {
    const id = e.target.value;
    setJiraProjectId(id);
    const matching = jiraBoards.filter(
      (b) => String(b.projectId) === id || String(b.projectKey) === id
    );
    const first = matching[0];
    setJiraBoardId(first ? String(first.id) : '');
    setJiraColumnId(first?.columns?.[0]?.id ?? '');
  };

  const handleJiraBoardChange = (e) => {
    const id = e.target.value;
    setJiraBoardId(id);
    const board = jiraBoards.find((b) => String(b.id) === String(id));
    setJiraColumnId(board?.columns?.[0]?.id ?? '');
  };

  const modalBody =
    view === 'grid' ? (
      <>
        <div style={styles.rulesModalHeaderRow}>
          <h2 style={styles.modalTitle}>Syncing Rules</h2>
          <button type="button" style={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div style={styles.rulesGrid}>
          <button type="button" style={styles.newRuleTile} onClick={openNewRule}>
            <div style={styles.newRulePlus}>+</div>
            <div style={styles.newRuleText}>New Rule</div>
          </button>

          {rules.map((r) => (
            <div key={r.id} style={styles.ruleTileWrap}>
              <button
                type="button"
                style={styles.ruleTile}
                onClick={() => openEditRule(r)}
                title={r.name || `Rule ${r.id}`}
              >
                <div style={styles.ruleTileName}>{r.name || `Rule ${r.id}`}</div>
              </button>
              <button
                type="button"
                style={styles.ruleTileMenuButton}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuRuleId((prev) => (prev === r.id ? null : r.id));
                }}
                aria-label="Rule menu"
              >
                ⋯
              </button>
              {menuRuleId === r.id && (
                <div
                  style={styles.ruleTileMenu}
                  role="menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    style={styles.ruleTileDelete}
                    role="menuitem"
                    onClick={() => handleDeleteRule(r.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </>
    ) : (
      <>
        <div style={styles.rulesModalHeaderRow}>
          <h2 style={styles.modalTitle}>Rule Editor</h2>
          <button type="button" style={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div style={styles.rulesEditor}>
          <div style={styles.directionToggle} role="group" aria-label="Sync direction">
            <button
              type="button"
              style={{
                ...styles.directionToggleBtn,
                ...(direction === 'trello-to-jira' ? styles.directionToggleBtnActive : {}),
              }}
              onClick={() => setDirection('trello-to-jira')}
              aria-pressed={direction === 'trello-to-jira'}
            >
              Trello ➔ Jira
            </button>
            <button
              type="button"
              style={{
                ...styles.directionToggleBtn,
                ...(direction === 'jira-to-trello' ? styles.directionToggleBtnActive : {}),
              }}
              onClick={() => setDirection('jira-to-trello')}
              aria-pressed={direction === 'jira-to-trello'}
            >
              Jira ➔ Trello
            </button>
          </div>

          <label style={styles.label}>
            Rule Name
            <input
              style={styles.input}
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder={`Rule ${nextRuleNumber}`}
            />
          </label>
          <hr style={styles.formDivider} />

          <div style={styles.rulesMappingRow}>
            <div style={styles.rulesMappingCol}>
              <div style={styles.rulesMappingColHeader}>Source</div>
              {direction === 'trello-to-jira' ? (
                <>
                  <label style={styles.label}>
                    Trello board
                    <select
                      style={styles.select}
                      value={trelloBoardId}
                      onChange={handleTrelloBoardChange}
                      disabled={!trelloBoards.length}
                    >
                      <option value="">— Select —</option>
                      {trelloBoards.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={styles.label}>
                    Trello list
                    <select
                      style={styles.select}
                      value={trelloListId}
                      onChange={(e) => setTrelloListId(e.target.value)}
                      disabled={!ruleLists.length}
                    >
                      <option value="">— Select —</option>
                      {ruleLists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label style={styles.label}>
                    Jira project
                    <select
                      style={styles.select}
                      value={jiraProjectId}
                      onChange={handleJiraProjectChange}
                      disabled={!jiraProjects.length}
                    >
                      <option value="">— Select —</option>
                      {jiraProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.key})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={styles.label}>
                    Jira board
                    <select
                      style={styles.select}
                      value={jiraBoardId}
                      onChange={handleJiraBoardChange}
                      disabled={!boardsForProject.length}
                    >
                      <option value="">— Select —</option>
                      {boardsForProject.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={styles.label}>
                    Jira column
                    <select
                      style={styles.select}
                      value={jiraColumnId}
                      onChange={(e) => setJiraColumnId(e.target.value)}
                      disabled={!ruleColumns.length}
                    >
                      <option value="">— Select —</option>
                      {ruleColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>

            <div style={styles.rulesMappingArrow} aria-hidden>
              ➔
            </div>

            <div style={styles.rulesMappingCol}>
              <div style={styles.rulesMappingColHeader}>Target</div>
              {direction === 'trello-to-jira' ? (
                <>
                  <label style={styles.label}>
                    Jira project
                    <select
                      style={styles.select}
                      value={jiraProjectId}
                      onChange={handleJiraProjectChange}
                      disabled={!jiraProjects.length}
                    >
                      <option value="">— Select —</option>
                      {jiraProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.key})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={styles.label}>
                    Jira board
                    <select
                      style={styles.select}
                      value={jiraBoardId}
                      onChange={handleJiraBoardChange}
                      disabled={!boardsForProject.length}
                    >
                      <option value="">— Select —</option>
                      {boardsForProject.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={styles.label}>
                    Jira column
                    <select
                      style={styles.select}
                      value={jiraColumnId}
                      onChange={(e) => setJiraColumnId(e.target.value)}
                      disabled={!ruleColumns.length}
                    >
                      <option value="">— Select —</option>
                      {ruleColumns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label style={styles.label}>
                    Trello board
                    <select
                      style={styles.select}
                      value={trelloBoardId}
                      onChange={handleTrelloBoardChange}
                      disabled={!trelloBoards.length}
                    >
                      <option value="">— Select —</option>
                      {trelloBoards.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={styles.label}>
                    Trello list
                    <select
                      style={styles.select}
                      value={trelloListId}
                      onChange={(e) => setTrelloListId(e.target.value)}
                      disabled={!ruleLists.length}
                    >
                      <option value="">— Select —</option>
                      {ruleLists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
            </div>
          </div>

          <hr style={styles.formDivider} />

          {status && <p style={{ ...styles.status, color: '#de350b' }}>{status}</p>}

          <div style={styles.rulesEditorButtons}>
            <button type="button" style={styles.btnSecondary} onClick={() => setView('grid')}>
              Back to Rules
            </button>
            <button type="button" style={styles.btnPrimary} onClick={handleSaveRule} disabled={saving}>
              {saving ? 'Saving…' : 'Save Rule'}
            </button>
          </div>
        </div>
      </>
    );

  return (
    <div style={styles.modalOverlay} onClick={onClose} role="presentation">
      <div
        style={{
          ...styles.rulesModalCard,
          ...(view === 'editor' ? styles.rulesEditorModalCard : {}),
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="rules-title"
      >
        {modalBody}
      </div>
    </div>
  );
}
