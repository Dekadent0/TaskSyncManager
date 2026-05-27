import { useState, useEffect } from 'react';
import { API, apiRequest } from './api.js';
import { styles } from './styles/theme.js';
import { EnvironmentWelcome, EnvironmentSetup } from './components/Modals/EnvironmentModal.jsx';
import DashboardView from './components/Dashboard/DashboardView.jsx';

export default function App() {
  const [view, setView] = useState('loading');
  const [environments, setEnvironments] = useState([]);
  const [activeEnvironment, setActiveEnvironment] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const envs = await apiRequest(`${API}/environments`);
        if (cancelled) return;
        const list = Array.isArray(envs) ? envs : [];
        setEnvironments(list);

        const storedId = Number(localStorage.getItem('activeEnvId'));
        const storedEnv =
          storedId && !Number.isNaN(storedId)
            ? list.find((e) => Number(e.id) === storedId)
            : null;

        if (storedEnv) {
          setActiveEnvironment({ id: storedEnv.id, name: storedEnv.name });
          setView('dashboard');
        } else if (list.length > 0) {
          setView('welcome');
        } else {
          setView('setup');
        }
      } catch {
        if (!cancelled) setView('setup');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnvironmentSaved = async (env) => {
    localStorage.setItem('activeEnvId', String(env.id));
    setActiveEnvironment(env);
    try {
      const envs = await apiRequest(`${API}/environments`);
      setEnvironments(Array.isArray(envs) ? envs : []);
    } catch {
      /* ignore */
    }
    setView('dashboard');
  };

  const handleSelectEnvironment = (env) => {
    localStorage.setItem('activeEnvId', String(env.id));
    setActiveEnvironment(env);
    setView('dashboard');
  };

  const handleBack = () => {
    setActiveEnvironment(null);
    setView(environments.length > 0 ? 'welcome' : 'setup');
  };

  const handleDeleteEnvironment = async (id) => {
    try {
      await apiRequest(`${API}/environments/${id}`, { method: 'DELETE' });

      const deletedId = Number(id);
      const next = environments.filter((e) => Number(e.id) !== deletedId);
      setEnvironments(next);

      if (Number(localStorage.getItem('activeEnvId')) === deletedId) {
        localStorage.removeItem('activeEnvId');
        setActiveEnvironment(null);
      }

      if (next.length === 0) {
        setView('setup');
      } else if (
        activeEnvironment &&
        Number(activeEnvironment.id) === deletedId
      ) {
        setView('welcome');
      }
    } catch (err) {
      window.alert(err.message || 'Failed to delete environment.');
    }
  };

  if (view === 'loading') {
    return (
      <div style={styles.pageCentered}>
        <p style={styles.subtitle}>Loading…</p>
      </div>
    );
  }

  if (view === 'welcome') {
    return (
      <EnvironmentWelcome
        environments={environments}
        onSelect={handleSelectEnvironment}
        onCreateNew={() => setView('setup')}
        onDelete={handleDeleteEnvironment}
      />
    );
  }

  if (view === 'dashboard' && activeEnvironment) {
    return (
      <DashboardView
        environmentId={activeEnvironment.id}
        environmentName={activeEnvironment.name}
        onBack={handleBack}
        onRename={(name) =>
          setActiveEnvironment((prev) => (prev ? { ...prev, name } : prev))
        }
      />
    );
  }

  return (
    <EnvironmentSetup
      onEnvironmentSaved={handleEnvironmentSaved}
      onBack={environments.length > 0 ? () => setView('welcome') : undefined}
    />
  );
}
