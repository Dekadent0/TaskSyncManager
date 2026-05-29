import { useState, useEffect, useRef } from 'react';
import { API, apiRequest, withEnvironmentId } from '../../api.js';
import { formatActivityEntry } from '../../utils/syncLog.js';
import { styles } from '../../styles/theme.js';
import TopBar from '../Layout/TopBar.jsx';
import LeftPanel from '../Layout/LeftPanel.jsx';
import TrelloViewer from '../Viewer/TrelloViewer.jsx';
import JiraViewer from '../Viewer/JiraViewer.jsx';
import SettingsModal from '../Modals/SettingsModal.jsx';
import RulesModal from '../Modals/RulesModal.jsx';

export default function DashboardView({
  environmentId,
  environmentName,
  onBack,
  onRename,
}) {
  const [displayName, setDisplayName] = useState(environmentName);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [trelloBoards, setTrelloBoards] = useState([]);
  const [jiraProjects, setJiraProjects] = useState([]);
  const [jiraBoards, setJiraBoards] = useState([]);
  const [loadingAll, setLoadingAll] = useState(true);
  const [fetchError, setFetchError] = useState('');

  const [viewTrelloBoardId, setViewTrelloBoardId] = useState('');
  const [viewJiraBoardId, setViewJiraBoardId] = useState('');
  const [trelloCards, setTrelloCards] = useState([]);
  const [jiraIssues, setJiraIssues] = useState([]);
  const [loadingTrelloCards, setLoadingTrelloCards] = useState(false);
  const [loadingJiraIssues, setLoadingJiraIssues] = useState(false);
  const [viewerTick, setViewerTick] = useState(0);
  const [syncActivity, setSyncActivity] = useState([]);
  const lastActivityIdRef = useRef(null);

  const [rules, setRules] = useState([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [jiraDomain, setJiraDomain] = useState('');

  const applyFetchedData = (boards, projects, agileBoards) => {
    setTrelloBoards(boards);
    setJiraProjects(projects);
    setJiraBoards(agileBoards);

    if (boards.length) {
      setViewTrelloBoardId(boards[0].id);
    }
    if (projects.length) {
      const firstProjectId = String(projects[0].id);
      const boardsForProject = agileBoards.filter(
        (b) => String(b.projectId) === firstProjectId
      );
      if (boardsForProject.length) {
        setViewJiraBoardId(String(boardsForProject[0].id));
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await apiRequest(`${API}/environments/${environmentId}`);
        if (!cancelled) setJiraDomain(row.jira_domain ?? '');
      } catch {
        if (!cancelled) setJiraDomain('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAll(true);
      setFetchError('');
      try {
        const data = await apiRequest(
          `${API}/environments/${environmentId}/fetch-all`
        );
        if (!cancelled) {
          applyFetchedData(
            data.trelloBoards ?? [],
            data.jiraProjects ?? [],
            data.jiraBoards ?? []
          );
        }
      } catch (err) {
        if (!cancelled) setFetchError(err.message);
      } finally {
        if (!cancelled) setLoadingAll(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  const refreshRules = async () => {
    const rows = await apiRequest(withEnvironmentId(`${API}/rules`, environmentId));
    setRules(Array.isArray(rows) ? rows : []);
  };

  useEffect(() => {
    refreshRules().catch(() => setRules([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentId]);

  useEffect(() => {
    let cancelled = false;

    const pollSyncActivity = async () => {
      try {
        const rows = await apiRequest(
          `${API}/environments/${environmentId}/sync-activity`
        );
        if (!cancelled && Array.isArray(rows)) {
          setSyncActivity(
            rows.map(formatActivityEntry).filter(Boolean)
          );
        }
      } catch {
        if (!cancelled) setSyncActivity([]);
      }
    };

    pollSyncActivity();
    const intervalId = setInterval(pollSyncActivity, 4000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [environmentId]);

  useEffect(() => {
    const latestId = syncActivity[0]?.id;
    if (latestId && latestId !== lastActivityIdRef.current) {
      lastActivityIdRef.current = latestId;
      setViewerTick((t) => t + 1);
    }
  }, [syncActivity]);

  useEffect(() => {
    if (!viewTrelloBoardId) {
      setTrelloCards([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingTrelloCards(true);
      try {
        const cards = await apiRequest(
          withEnvironmentId(
            `${API}/trello/boards/${viewTrelloBoardId}/cards`,
            environmentId
          )
        );
        if (!cancelled) setTrelloCards(Array.isArray(cards) ? cards : []);
      } catch {
        if (!cancelled) setTrelloCards([]);
      } finally {
        if (!cancelled) setLoadingTrelloCards(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewTrelloBoardId, environmentId, viewerTick]);

  useEffect(() => {
    if (!viewJiraBoardId) {
      setJiraIssues([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingJiraIssues(true);
      try {
        const issues = await apiRequest(
          withEnvironmentId(
            `${API}/jira/boards/${viewJiraBoardId}/issues`,
            environmentId
          )
        );
        if (!cancelled) setJiraIssues(Array.isArray(issues) ? issues : []);
      } catch {
        if (!cancelled) setJiraIssues([]);
      } finally {
        if (!cancelled) setLoadingJiraIssues(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewJiraBoardId, environmentId, viewerTick]);

  return (
    <div style={styles.appShell}>
      <TopBar
        environmentName={displayName}
        onBack={onBack}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div style={styles.splitRow}>
        <LeftPanel
          loading={loadingAll}
          fetchError={fetchError}
          trelloBoards={trelloBoards}
          jiraProjects={jiraProjects}
          jiraBoards={jiraBoards}
          rulesCount={rules.length}
          onManageRules={() => setRulesOpen(true)}
          syncActivity={syncActivity}
        />

        <main style={styles.rightPanel}>
          <TrelloViewer
            boards={trelloBoards}
            selectedBoardId={viewTrelloBoardId}
            onBoardChange={setViewTrelloBoardId}
            cards={trelloCards}
            loading={loadingTrelloCards}
          />
          <JiraViewer
            jiraDomain={jiraDomain}
            boards={jiraBoards}
            selectedBoardId={viewJiraBoardId}
            onBoardChange={setViewJiraBoardId}
            issues={jiraIssues}
            loading={loadingJiraIssues}
          />
        </main>
      </div>

      {settingsOpen && (
        <SettingsModal
          environmentId={environmentId}
          environmentName={displayName}
          onClose={() => setSettingsOpen(false)}
          onSaved={(name) => {
            setDisplayName(name);
            onRename?.(name);
          }}
        />
      )}

      {rulesOpen && (
        <RulesModal
          environmentId={environmentId}
          trelloBoards={trelloBoards}
          jiraProjects={jiraProjects}
          jiraBoards={jiraBoards}
          rules={rules}
          onClose={() => setRulesOpen(false)}
          onRefreshRules={refreshRules}
        />
      )}
    </div>
  );
}
