import { useState, useEffect, useCallback } from 'react';
import { 
  Key, Plus, Trash2, Copy, Eye,
  X
} from 'lucide-react';
import { API } from '../utils/config';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

const ALL_PERMISSIONS = [
  { key: 'manageBackups', label: 'Manage Backups' },
  { key: 'manageSchedules', label: 'Manage Schedules' },
  { key: 'restore', label: 'Restore' },
  { key: 'viewLogs', label: 'View Logs' },
  { key: 'configure', label: 'Configure Settings' },
  { key: 'manageUsers', label: 'Manage Users' },
];

export default function ApiTokens() {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newExpiry, setNewExpiry] = useState('');
  const [newPerms, setNewPerms] = useState({});
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState(null); // { id, token }
  const [copied, setCopied] = useState(false);

  const token = (() => {
    try {
      const saved = sessionStorage.getItem('bck-auth');
      return saved ? JSON.parse(saved).token || '' : '';
    } catch (e) {
      return '';
    }
  })();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/tokens`, { headers });
      setTokens(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTokens(); }, [loadTokens]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const r = await fetch(`${API}/api/tokens`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: newName, permissions: newPerms, expiresAt: newExpiry || null }),
      });
      const data = await r.json();
      if (r.ok) {
        setRevealed({ id: data.id, token: data.token });
        setCreateOpen(false);
        setNewName('');
        setNewExpiry('');
        setNewPerms({});
        loadTokens();
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id, name) => {
    if (!window.confirm(`Revoke token "${name}"?`)) return;
    await fetch(`${API}/api/tokens/${id}`, { method: 'DELETE', headers });
    setTokens(prev => prev.filter(t => t.id !== id));
  };

  const copyToken = () => {
    navigator.clipboard.writeText(revealed?.token || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            API Tokens
          </h1>
          <p className="text-sm font-medium text-slate-500">
            Generate tokens for CI/CD pipelines and external integrations — no login required
          </p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary py-2.5 px-4 w-full sm:w-auto">
          <Plus size={18} />
          New Token
        </button>
      </div>

      {/* Revealed token alert */}
      {revealed && (
        <div className="mb-6 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-4 animate-fade-in">
          <Eye className="text-emerald-600 mt-1 flex-shrink-0" size={20} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-400 mb-2">
              Token created — save it now, it won't be shown again:
            </h3>
            <div className="bg-emerald-950/20 dark:bg-emerald-950/50 p-3 rounded font-mono text-sm text-emerald-900 dark:text-emerald-100 break-all mb-3 select-all">
              {revealed.token}
            </div>
            <div className="flex gap-2">
              <button 
                onClick={copyToken} 
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Copy size={14} />
                {copied ? 'Copied!' : 'Copy to clipboard'}
              </button>
              <button 
                onClick={() => setRevealed(null)} 
                className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-sm font-medium rounded-lg transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="glass-card mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <th className="p-4 font-semibold">Name</th>
                <th className="p-4 font-semibold">Created</th>
                <th className="p-4 font-semibold">Expires</th>
                <th className="p-4 font-semibold">Last Used</th>
                <th className="p-4 font-semibold">Permissions</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="p-4">
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-3/4"></div>
                      </td>
                    ))}
                  </tr>
                ))
              ) : tokens.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-12 text-center text-slate-500">
                    <Key size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-medium mb-4">No API tokens yet — create one to start automating</p>
                    <button onClick={() => setCreateOpen(true)} className="btn-secondary px-4 py-2">
                      <Plus size={16} /> Create Token
                    </button>
                  </td>
                </tr>
              ) : tokens.map(t => (
                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Key size={16} className="text-slate-400" />
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{t.name}</span>
                    </div>
                  </td>
                  <td className="p-4 text-xs font-medium text-slate-500">
                    {formatDate(t.createdAt)}
                  </td>
                  <td className="p-4">
                    {t.expiresAt ? (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                        new Date(t.expiresAt) < new Date() 
                          ? 'bg-red-500/10 text-red-600 border-red-500/20' 
                          : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                      }`}>
                        {formatDate(t.expiresAt)}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 uppercase tracking-wider">
                        Never
                      </span>
                    )}
                  </td>
                  <td className="p-4 text-xs font-medium text-slate-500">
                    {formatDate(t.lastUsedAt)}
                  </td>
                  <td className="p-4">
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(t.permissions || {}).filter(([, v]) => v).map(([k]) => (
                        <span key={k} className="text-[10px] font-medium px-1.5 py-0.5 rounded border bg-blue-500/5 text-blue-600 border-blue-500/20 uppercase tracking-wider">
                          {k}
                        </span>
                      ))}
                      {Object.values(t.permissions || {}).every(v => !v) && (
                        <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                          All (role-based)
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => handleRevoke(t.id, t.name)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title="Revoke">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Usage Example */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-2">
          <TerminalIcon size={16} className="text-slate-400" />
          Usage Example
        </h3>
        <p className="text-sm text-slate-500 mb-3">
          Use the token in the Authorization header to authenticate API requests:
        </p>
        <div className="bg-slate-950 rounded-lg p-4 overflow-x-auto">
          <code className="text-sm font-mono text-emerald-400 whitespace-nowrap">
            curl -H "Authorization: Bearer <span className="text-blue-400">bck_your_token_here</span>" http://localhost:9000/api/backups
          </code>
        </div>
      </div>

      {/* Create Token Dialog */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                Create API Token
              </h2>
              <button onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCreate}>
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Token Name</label>
                  <input type="text" required autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. github-ci, deploy-script" className="input-field" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Expires At (optional)</label>
                  <input type="datetime-local" value={newExpiry} onChange={e => setNewExpiry(e.target.value)} className="input-field" />
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Permissions 
                    <span className="text-xs font-normal text-slate-500 block">Leave all unchecked to inherit role permissions</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    {ALL_PERMISSIONS.map(p => (
                      <label key={p.key} className="flex items-center gap-2 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={!!newPerms[p.key]} 
                          onChange={e => setNewPerms(prev => ({ ...prev, [p.key]: e.target.checked }))}
                          className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                          {p.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end gap-3 p-6 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setCreateOpen(false)} className="btn-secondary px-4 py-2">
                  Cancel
                </button>
                <button type="submit" disabled={creating || !newName.trim()} className="btn-primary px-6 py-2 disabled:opacity-50">
                  {creating ? 'Creating...' : 'Create Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TerminalIcon({ size, className }) {
  return (
    <svg 
      xmlns="http://www.w3.org/2000/svg" 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      className={className}
    >
      <polyline points="4 17 10 11 4 5"></polyline>
      <line x1="12" y1="19" x2="20" y2="19"></line>
    </svg>
  );
}
