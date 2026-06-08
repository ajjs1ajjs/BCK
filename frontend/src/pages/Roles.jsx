import { useState, useEffect, useCallback } from 'react';
import { 
  ShieldAlert, Shield, ShieldCheck, Plus, 
  Trash2, Edit2, RefreshCw, AlertCircle, 
  CheckCircle2, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';
import { API } from '../utils/config';

const defaultPermissions = {
  manageUsers: false, manageBackups: true, manageSchedules: true,
  restore: true, delete: false, configure: false, viewLogs: true, manageRoles: false,
};

export default function Roles() {
  const [roles, setRoles] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', permissions: { ...defaultPermissions } });
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const { can, token } = useAuth();
  const { t } = useTranslation();
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(() => {
    fetch(`${API}/api/roles`, { headers }).then(r => r.json()).then(setRoles).catch(e => console.error('Load error:', e));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

  const openCreate = () => { 
    setEditing(null); 
    setForm({ name: '', description: '', permissions: { ...defaultPermissions } }); 
    setDialogOpen(true); 
  };
  
  const openEdit = (r) => { 
    setEditing(r); 
    setForm({ name: r.name, description: r.description || '', permissions: { ...r.permissions } }); 
    setDialogOpen(true); 
  };

  const togglePerm = (key) => {
    setForm({ ...form, permissions: { ...form.permissions, [key]: !form.permissions[key] } });
  };

  const save = async (e) => {
    if (e) e.preventDefault();
    if (!form.name) { showSnack(t('nameRequired') || 'Role name is required', 'warning'); return; }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/roles/${editing.id}` : `${API}/api/roles`;
    try {
      const r = await fetch(url, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) { const err = await r.json(); throw new Error(err.error); }
      showSnack(editing ? (t('roleUpdated') || 'Role updated successfully') : (t('roleCreated') || 'Role created successfully'), 'success');
      setDialogOpen(false); 
      load();
    } catch (e) { 
      showSnack(e.message || t('error') || 'An error occurred', 'error'); 
    }
  };

  const remove = async (id, name) => {
    if (['admin', 'operator', 'viewer'].includes(id)) {
      showSnack(t('cannotDeleteBuiltIn') || 'Cannot delete built-in roles', 'warning'); return;
    }
    if (!window.confirm(`Are you sure you want to delete the role "${name}"?`)) return;
    try {
      await fetch(`${API}/api/roles/${id}`, { method: 'DELETE', headers });
      load(); 
      showSnack((t('roleDeleted', { name }) || `Role ${name} deleted`), 'success');
    } catch { 
      showSnack(t('failedToDelete') || 'Failed to delete role', 'error'); 
    }
  };

  const builtIn = (id) => ['admin', 'operator', 'viewer'].includes(id);

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            {t('roles') || 'Role Management'}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {t('rolesSubtitle') || 'Configure roles and permissions for system access'}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={load} className="btn-secondary py-2.5 px-4 flex-1 sm:flex-none">
            <RefreshCw size={16} />
            {t('refresh') || 'Refresh'}
          </button>
          {can('manageRoles') && (
            <button onClick={openCreate} className="btn-primary py-2.5 px-4 flex-1 sm:flex-none">
              <Plus size={16} />
              {t('newRole') || 'New Role'}
            </button>
          )}
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <th className="p-4 font-semibold">{t('role') || 'Role'}</th>
                <th className="p-4 font-semibold">{t('description') || 'Description'}</th>
                <th className="p-4 font-semibold">{t('permissionsCol') || 'Permissions'}</th>
                <th className="p-4 font-semibold">{t('levelCol') || 'Level'}</th>
                {can('manageRoles') && <th className="p-4 font-semibold text-right">{t('actions') || 'Actions'}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {roles.length === 0 ? (
                <tr>
                  <td colSpan={can('manageRoles') ? 5 : 4} className="p-12 text-center text-slate-500">
                    <ShieldAlert size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-medium">{t('noRoles') || 'No roles configured'}</p>
                  </td>
                </tr>
              ) : roles.map((r) => {
                const enabled = Object.entries(r.permissions || {}).filter(([, v]) => v).length;
                const total = Object.keys(r.permissions || {}).length;
                const isBuiltIn = builtIn(r.id);
                
                return (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isBuiltIn ? 'bg-blue-500/10 text-blue-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'}`}>
                          {isBuiltIn ? <ShieldCheck size={18} /> : <Shield size={18} />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            {r.name}
                            {isBuiltIn && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-600 border-blue-500/20 uppercase tracking-wider">Built-in</span>}
                          </p>
                          <p className="text-xs font-mono text-slate-500 mt-0.5">{r.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm text-slate-600 dark:text-slate-400 max-w-sm">{r.description || '—'}</p>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${enabled === total ? 'bg-emerald-500' : enabled === 0 ? 'bg-slate-300' : 'bg-blue-500'}`}
                            style={{ width: `${(enabled / total) * 100}%` }}
                          ></div>
                        </div>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          {enabled}/{total}
                        </span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                        {r.level ?? 1}
                      </span>
                    </td>
                    {can('manageRoles') && (
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(r)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title={t('edit') || 'Edit'}>
                            <Edit2 size={18} />
                          </button>
                          {!isBuiltIn && (
                            <button onClick={() => remove(r.id, r.name)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete') || 'Delete'}>
                              <Trash2 size={18} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-200 dark:border-slate-800 my-8 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Shield size={20} className="text-blue-500" />
                {editing ? (t('editRole') || 'Edit Role') : (t('newRole') || 'Create Role')}
              </h2>
              <button onClick={() => setDialogOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors bg-slate-100 dark:bg-slate-800 p-1.5 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 sm:p-6 overflow-y-auto flex-1">
              <form id="role-form" onSubmit={save} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('roleName') || 'Role Name'} <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    required 
                    value={form.name} 
                    onChange={e => setForm({...form, name: e.target.value})} 
                    disabled={editing && builtIn(editing.id)}
                    className="input-field disabled:opacity-50 disabled:cursor-not-allowed" 
                    placeholder="e.g., Audit Manager"
                  />
                  {editing && builtIn(editing.id) && (
                    <p className="text-[11px] text-amber-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={12} /> Built-in role names cannot be changed
                    </p>
                  )}
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('description') || 'Description'}
                  </label>
                  <textarea 
                    value={form.description} 
                    onChange={e => setForm({...form, description: e.target.value})}
                    rows="2"
                    className="input-field resize-none"
                    placeholder="Brief description of this role's purpose..."
                  ></textarea>
                </div>

                <hr className="border-slate-100 dark:border-slate-800 my-4" />

                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                    <ShieldCheck size={16} className="text-blue-500" />
                    {t('permissions') || 'Permissions'}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/30 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
                    {Object.keys(form.permissions).map(key => (
                      <label key={key} className="flex items-center gap-3 cursor-pointer group">
                        <div className="relative flex items-center">
                          <input 
                            type="checkbox" 
                            className="sr-only peer"
                            checked={form.permissions[key]}
                            onChange={() => togglePerm(key)}
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                        </div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition-colors">
                          {t('perm_' + key) || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </form>
            </div>
            
            <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={() => setDialogOpen(false)} className="btn-secondary px-5 py-2">
                {t('cancel') || 'Cancel'}
              </button>
              <button type="submit" form="role-form" disabled={!form.name} className="btn-primary px-6 py-2 disabled:opacity-50">
                {editing ? (t('save') || 'Save Changes') : (t('create') || 'Create Role')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Snackbar */}
      {snack.open && (
        <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg border ${
            snack.type === 'error' ? 'bg-red-500 text-white border-red-600 shadow-red-500/20' : 
            snack.type === 'warning' ? 'bg-amber-500 text-white border-amber-600 shadow-amber-500/20' : 
            snack.type === 'info' ? 'bg-blue-500 text-white border-blue-600 shadow-blue-500/20' :
            'bg-slate-900 text-white border-slate-800 shadow-slate-900/20'
          }`}>
            {snack.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            <span className="text-sm font-semibold">{snack.msg}</span>
            <button onClick={() => setSnack({...snack, open: false})} className="ml-2 text-white/70 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
