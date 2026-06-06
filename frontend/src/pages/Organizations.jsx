import { useState, useEffect, useCallback } from 'react';
import { 
  Building2, Users, Edit2, Trash2, Plus, AlertCircle, X
} from 'lucide-react';
import { API } from '../utils/config';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

export default function Organizations() {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOrg, setEditOrg] = useState(null);
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const token = (() => {
    try {
      const saved = sessionStorage.getItem('bck-auth');
      return saved ? JSON.parse(saved).token || '' : '';
    } catch (e) {
      return '';
    }
  })();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/organizations`, { headers });
      setOrgs(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  const openCreate = () => { setFormName(''); setFormSlug(''); setError(''); setEditOrg(null); setCreateOpen(true); };
  const openEdit = (org) => { setFormName(org.name); setFormSlug(org.slug); setError(''); setEditOrg(org); setCreateOpen(true); };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    if (!formName.trim()) return setError('Name is required');
    if (!editOrg && !formSlug.trim()) return setError('Slug is required');
    setSaving(true);
    try {
      const url = editOrg ? `${API}/api/organizations/${editOrg.id}` : `${API}/api/organizations`;
      const method = editOrg ? 'PUT' : 'POST';
      const body = editOrg ? { name: formName } : { name: formName, slug: formSlug };
      const r = await fetch(url, { method, headers, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) return setError(data.error || 'Failed');
      setCreateOpen(false);
      loadOrgs();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (org) => {
    if (org.id === 'default') return;
    if (!window.confirm(`Delete "${org.name}"? Users will be moved to Default Organization.`)) return;
    await fetch(`${API}/api/organizations/${org.id}`, { method: 'DELETE', headers });
    loadOrgs();
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            Organizations
          </h1>
          <p className="text-sm font-medium text-slate-500">
            Manage multi-tenant organizations and user grouping
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary py-2.5 px-4 w-full sm:w-auto">
          <Plus size={18} />
          New Organization
        </button>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <th className="p-4 font-semibold">Name</th>
                <th className="p-4 font-semibold">Slug</th>
                <th className="p-4 font-semibold">Users</th>
                <th className="p-4 font-semibold">Created</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {loading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="p-4">
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-3/4"></div>
                      </td>
                    ))}
                  </tr>
                ))
              ) : orgs.map(org => (
                <tr key={org.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <Building2 size={16} className="text-slate-400" />
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{org.name}</span>
                      {org.id === 'default' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-600 border-blue-500/20 uppercase tracking-wider">
                          Default
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 px-2 py-1 rounded inline-block">
                      {org.slug}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                      <Users size={14} className="text-slate-400" />
                      {org.userCount || 0}
                    </div>
                  </td>
                  <td className="p-4 text-xs font-medium text-slate-500">
                    {formatDate(org.createdAt)}
                  </td>
                  <td className="p-4 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(org)} className="p-1.5 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded transition-colors" title="Edit">
                        <Edit2 size={18} />
                      </button>
                      {org.id !== 'default' && (
                        <button onClick={() => handleDelete(org)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title="Delete">
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Dialog */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {editOrg ? 'Edit Organization' : 'New Organization'}
              </h2>
              <button onClick={() => setCreateOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSave}>
              <div className="p-5 space-y-4">
                {error && (
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <AlertCircle size={16} />
                    {error}
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Organization Name</label>
                  <input type="text" required autoFocus value={formName} onChange={e => setFormName(e.target.value)} className="input-field" />
                </div>
                
                {!editOrg && (
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">Slug</label>
                    <input 
                      type="text" 
                      required 
                      value={formSlug} 
                      onChange={e => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} 
                      className="input-field font-mono" 
                    />
                    <p className="text-[11px] text-slate-500 mt-1">URL-safe, e.g. my-org</p>
                  </div>
                )}
              </div>
              
              <div className="flex justify-end gap-3 p-5 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800">
                <button type="button" onClick={() => setCreateOpen(false)} className="btn-secondary px-4 py-2 text-sm">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn-primary px-5 py-2 text-sm disabled:opacity-50">
                  {saving ? 'Saving...' : editOrg ? 'Save Changes' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
