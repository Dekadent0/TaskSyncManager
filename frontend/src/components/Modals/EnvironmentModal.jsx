import { useState, useEffect } from 'react';
import { API, apiRequest } from '../../api.js';
import { styles } from '../../styles/theme.js';

const secureFieldStyles = {
  wrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    paddingRight: 36,
  },
  toggle: {
    position: 'absolute',
    right: 6,
    top: '50%',
    transform: 'translateY(-50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    padding: 0,
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: '#5e6c84',
    cursor: 'pointer',
  },
};

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.77 21.77 0 0 1 5.06-6.94M9.9 4.24A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a21.8 21.8 0 0 1-3.17 4.49M1 1l22 22"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.88 9.88a3 3 0 0 0 4.24 4.24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SecureCredentialInput({
  visible,
  onToggleVisible,
  label,
  style: inputStyle,
  ...inputProps
}) {
  return (
    <div style={secureFieldStyles.wrap}>
      <input
        {...inputProps}
        style={{ ...styles.input, ...secureFieldStyles.input, ...inputStyle }}
        type={visible ? 'text' : 'password'}
      />
      <button
        type="button"
        style={secureFieldStyles.toggle}
        onClick={onToggleVisible}
        aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        tabIndex={-1}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EnvironmentCard({ env, menuOpen, onToggleMenu, onSelect, onDelete }) {
  const handleMenuClick = (e) => {
    e.stopPropagation();
    onToggleMenu();
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    onToggleMenu();
    if (
      !window.confirm(
        'Are you sure you want to delete this environment? This cannot be undone.'
      )
    ) {
      return;
    }
    onDelete(env.id);
  };

  return (
    <div style={styles.envCardWrap}>
      <button
        type="button"
        style={styles.envCard}
        onClick={() => onSelect({ id: env.id, name: env.name })}
      >
        <div style={styles.envName}>{env.name}</div>
        <div style={styles.envMeta}>ID {env.id}</div>
      </button>
      <button
        type="button"
        style={styles.envMenuButton}
        onClick={handleMenuClick}
        aria-label={`Options for ${env.name}`}
        aria-expanded={menuOpen}
      >
        ⋮
      </button>
      {menuOpen && (
        <div
          style={styles.envDropdown}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            style={styles.envDeleteOption}
            role="menuitem"
            onClick={handleDeleteClick}
          >
            Delete Environment
          </button>
        </div>
      )}
    </div>
  );
}

/** Welcome screen — pick an existing environment. */
export function EnvironmentWelcome({ environments, onSelect, onCreateNew, onDelete }) {
  const [openMenuId, setOpenMenuId] = useState(null);

  useEffect(() => {
    if (openMenuId === null) return;
    const close = () => setOpenMenuId(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openMenuId]);

  return (
    <div style={styles.pageCentered}>
      <div style={styles.welcomeInner}>
        <h1 style={styles.title}>Task Synchronization Manager</h1>
        <p style={styles.subtitle}>Welcome back. Choose an environment to open.</p>

        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Your environments</h2>
          <div style={styles.envGrid}>
            {environments.map((env) => (
              <EnvironmentCard
                key={env.id}
                env={env}
                menuOpen={openMenuId === env.id}
                onToggleMenu={() =>
                  setOpenMenuId((prev) => (prev === env.id ? null : env.id))
                }
                onSelect={onSelect}
                onDelete={onDelete}
              />
            ))}
          </div>
          <button type="button" style={styles.envCreateButton} onClick={onCreateNew}>
            + Create New Environment
          </button>
        </div>
      </div>
    </div>
  );
}

/** Create-environment form with Trello + Jira credentials. */
export function EnvironmentSetup({ onEnvironmentSaved, onBack }) {
  const [envName, setEnvName] = useState('');
  const [form, setForm] = useState({
    trello_api_key: '',
    trello_token: '',
    jira_domain: '',
    jira_email: '',
    jira_api_token: '',
  });
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [showTrelloKey, setShowTrelloKey] = useState(false);
  const [showTrelloToken, setShowTrelloToken] = useState(false);
  const [showJiraToken, setShowJiraToken] = useState(false);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const trimmedName = envName.trim();
    if (!trimmedName) {
      setStatus('Project / Environment name is required.');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      const created = await apiRequest(`${API}/environments`, {
        method: 'POST',
        body: JSON.stringify({
          name: trimmedName,
          trello_api_key: form.trello_api_key,
          trello_token: form.trello_token,
          jira_domain: form.jira_domain,
          jira_email: form.jira_email,
          jira_api_token: form.jira_api_token,
        }),
      });
      onEnvironmentSaved({ id: created.id, name: created.name });
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.pageCentered}>
      <div style={styles.welcomeInner}>
        <h1 style={styles.title}>New environment</h1>
        <p style={styles.subtitle}>Enter credentials for a new sync container.</p>
        <form onSubmit={handleSave} style={styles.card}>
          <label style={styles.label}>
            Project / Environment Name
            <input
              style={styles.input}
              value={envName}
              onChange={(e) => setEnvName(e.target.value)}
              placeholder="e.g., Personal Sync or Work Project"
              required
            />
          </label>
          <h3 style={styles.subHeading}>Trello</h3>
          <label style={styles.label}>
            API Key
            <SecureCredentialInput
              label="Trello API Key"
              name="trello_api_key"
              value={form.trello_api_key}
              onChange={handleChange}
              visible={showTrelloKey}
              onToggleVisible={() => setShowTrelloKey((prev) => !prev)}
              required
            />
          </label>
          <label style={styles.label}>
            Token
            <SecureCredentialInput
              label="Trello Token"
              name="trello_token"
              value={form.trello_token}
              onChange={handleChange}
              visible={showTrelloToken}
              onToggleVisible={() => setShowTrelloToken((prev) => !prev)}
              required
            />
          </label>
          <h3 style={styles.subHeading}>Jira</h3>
          <label style={styles.label}>
            Domain
            <input
              style={styles.input}
              name="jira_domain"
              placeholder="https://your-domain.atlassian.net"
              value={form.jira_domain}
              onChange={handleChange}
              required
            />
          </label>
          <label style={styles.label}>
            Email
            <input
              style={styles.input}
              name="jira_email"
              type="email"
              value={form.jira_email}
              onChange={handleChange}
              required
            />
          </label>
          <label style={styles.label}>
            API Token
            <SecureCredentialInput
              label="Jira API Token"
              name="jira_api_token"
              value={form.jira_api_token}
              onChange={handleChange}
              visible={showJiraToken}
              onToggleVisible={() => setShowJiraToken((prev) => !prev)}
              required
            />
          </label>
          <button type="submit" style={styles.btnPrimary} disabled={saving}>
            {saving ? 'Saving…' : 'Save Credentials'}
          </button>
          {status && <p style={{ ...styles.status, color: '#de350b' }}>{status}</p>}
        </form>
        {onBack && (
          <button type="button" style={styles.backToEnvironments} onClick={onBack}>
            ← Back to Environments
          </button>
        )}
      </div>
    </div>
  );
}
