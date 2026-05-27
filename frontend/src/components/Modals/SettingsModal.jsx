import { useState, useEffect } from 'react';
import { API, apiRequest } from '../../api.js';
import { styles } from '../../styles/theme.js';

export default function SettingsModal({ environmentId, environmentName, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: environmentName,
    trello_api_key: '',
    trello_token: '',
    jira_domain: '',
    jira_email: '',
    jira_api_token: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const row = await apiRequest(`${API}/environments/${environmentId}`);
        setForm({
          name: row.name ?? environmentName,
          trello_api_key: row.trello_api_key ?? '',
          trello_token: '',
          jira_domain: row.jira_domain ?? '',
          jira_email: row.jira_email ?? '',
          jira_api_token: '',
        });
      } catch (err) {
        setStatus(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [environmentId, environmentName]);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setStatus('');
    try {
      await apiRequest(`${API}/environments/${environmentId}`, {
        method: 'PUT',
        body: JSON.stringify(form),
      });
      onSaved(form.name);
      onClose();
    } catch (err) {
      setStatus(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose} role="presentation">
      <div
        style={styles.modalCard}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-title"
      >
        <div style={styles.modalHeader}>
          <h2 id="settings-title" style={styles.modalTitle}>
            Environment settings
          </h2>
          <button type="button" style={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {loading ? (
          <p style={styles.hint}>Loading credentials…</p>
        ) : (
          <form onSubmit={handleSave} style={styles.modalForm}>
            <label style={styles.label}>
              Name
              <input style={styles.input} name="name" value={form.name} onChange={handleChange} />
            </label>
            <hr style={styles.formDivider} />
            <label style={styles.label}>
              Trello API Key
              <input
                style={styles.input}
                name="trello_api_key"
                value={form.trello_api_key}
                onChange={handleChange}
              />
            </label>
            <label style={styles.label}>
              Trello Token
              <input
                style={styles.input}
                name="trello_token"
                type="password"
                placeholder="Leave blank to keep current"
                value={form.trello_token}
                onChange={handleChange}
              />
            </label>
            <hr style={styles.formDivider} />
            <label style={styles.label}>
              Jira Domain
              <input
                style={styles.input}
                name="jira_domain"
                value={form.jira_domain}
                onChange={handleChange}
              />
            </label>
            <label style={styles.label}>
              Jira Email
              <input
                style={styles.input}
                name="jira_email"
                type="email"
                value={form.jira_email}
                onChange={handleChange}
              />
            </label>
            <label style={styles.label}>
              Jira API Token
              <input
                style={styles.input}
                name="jira_api_token"
                type="password"
                placeholder="Leave blank to keep current"
                value={form.jira_api_token}
                onChange={handleChange}
              />
            </label>
            {status && <p style={{ ...styles.status, color: '#de350b' }}>{status}</p>}
            <button type="submit" style={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
