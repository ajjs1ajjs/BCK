import { useState, useEffect, useCallback } from 'react';
import { 
  Users as UsersIcon, Plus, Trash2, Edit2, RefreshCw, 
  User, AlertCircle, CheckCircle2, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';
import { API } from '../utils/config';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer', email: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', type: 'success' });
  const { can } = useAuth();
  const { t } = useTranslation();

  const load = useCallback(() => {
    fetch(`${API}/api/users`).then(r => r.json()).then(setUsers).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/roles`).then(r => r.json()).then(setRoles).catch(e => console.error('Load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  const showSnack = (msg, type = 'success') => {
    setSnack({ open: true, msg, type });
    setTimeout(() => setSnack({ open: false, msg: '', type: 'success' }), 4000);
  };

  const openCreate = () => { 
    setEditing(null); 
    setForm({ username: '', password: '', role: 'viewer', email: '' }); 
    setDialogOpen(true); 
  };
  
  const openEdit = (u) => { 
    setEditing(u); 
    setForm({ username: u.username, password: '', role: u.role, email: u.email || '' }); 
    setDialogOpen(true); 
  };

  const save = async (e) => {
    if (e) e.preventDefault();
    if (!form.username || (!editing && !form.password) || !form.role) {
      showSnack(t('userRequiredFields') || 'Username, role, and password are required', 'warning'); return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/users/${editing.id}` : `${API}/api/users`;
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) { const err = await r.json(); throw new Error(err.error); }
      showSnack(editing ? (t('userUpdated') || 'User updated successfully') : (t('userCreated') || 'User created successfully'), 'success');
      setDialogOpen(false); 
      load();
    } catch (e) { 
      showSnack(e.message || t('error') || 'An error occurred', 'error'); 
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    try {
      await fetch(`${API}/api/users/${id}`, { method: 'DELETE' });
      load();
      showSnack(t('userDeleted') || 'User deleted successfully', 'success');
    } catch { 
      showSnack(t('failedToDelete') || 'Failed to delete user', 'error'); 
    }
  };

  const toggleActive = async (u) => {
    try {
      await fetch(`${API}/api/users/${u.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !u.active }) });
      load();
    } catch (_) { /* ignore */ }
  };

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            {t('users') || 'User Management'}
          </h1>
          <p className="text-sm font-medium text-slate-500">
            {t('usersSubtitle') || 'Manage user accounts and their access roles'}
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={load} className="btn-secondary py-2.5 px-4 flex-1 sm:flex-none">
            <RefreshCw size={16} />
            {t('refresh') || 'Refresh'}
          </button>
          {can('manageUsers') && (
            <button onClick={openCreate} className="btn-primary py-2.5 px-4 flex-1 sm:flex-none">
              <Plus size={16} />
              {t('newUser') || 'New User'}
            </button>
          )}
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <th className="p-4 font-semibold">{t('username') || 'Username'}</th>
                <th className="p-4 font-semibold">{t('role') || 'Role'}</th>
                <th className="p-4 font-semibold">{t('email') || 'Email'}</th>
                <th className="p-4 font-semibold">{t('status') || 'Status'}</th>
                <th className="p-4 font-semibold">{t('created') || 'Created'}</th>
                {can('manageUsers') && <th className="p-4 font-semibold text-right">{t('actions') || 'Actions'}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={can('manageUsers') ? 6 : 5} className="p-12 text-center text-slate-500">
                    <UsersIcon size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-medium">{t('noUsers') || 'No users configured'}</p>
                  </td>
                </tr>
              ) : users.map((u) => {
                const isAdmin = u.role === 'admin';
                const isOperator = u.role === 'operator';
                
                return (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          <User size={18} />
                        </div>
                        <span className="font-bold text-slate-900 dark:text-white">{u.username}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                        isAdmin ? 'bg-red-500/10 text-red-600 border-red-500/20' : 
                        isOperator ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' : 
                        'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                      }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-slate-600 dark:text-slate-400">
                      {u.email || '—'}
                    </td>
                    <td className="p-4">
                      {can('manageUsers') ? (
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="sr-only peer"
                            checked={u.active !== false}
                            onChange={() => toggleActive(u)}
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600 transition-colors"></div>
                        </label>
                      ) : (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                          u.active !== false ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : 'bg-slate-500/10 text-slate-600 border-slate-500/20'
                        }`}>
                          {u.active !== false ? (t('activeScheduleLabel') || 'Active') : (t('disabledScheduleLabel') || 'Disabled')}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                      {(u.createdAt || '').slice(0, 10)}
                    </td>
                    {can('manageUsers') && (
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(u)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title={t('edit') || 'Edit'}>
                            <Edit2 size={18} />
                          </button>
                          {u.id !== 'admin' && u.id !== 'operator' && u.id !== 'viewer' && (
                            <button onClick={() => remove(u.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors" title={t('delete') || 'Delete'}>
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
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm border border-slate-200 dark:border-slate-800 my-8 flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <User size={20} className="text-blue-500" />
                {editing ? (t('editUser') || 'Edit User') : (t('newUser') || 'Create User')}
              </h2>
              <button onClick={() => setDialogOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors bg-slate-100 dark:bg-slate-800 p-1.5 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 sm:p-6 overflow-y-auto flex-1">
              <form id="user-form" onSubmit={save} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('username') || 'Username'} <span className="text-red-500">*</span>
                  </label>
                  <input 
                    type="text" 
                    required 
                    value={form.username} 
                    onChange={e => setForm({...form, username: e.target.value})} 
                    disabled={editing && (editing.id === 'admin' || editing.id === 'operator' || editing.id === 'viewer')}
                    className="input-field disabled:opacity-50 disabled:cursor-not-allowed" 
                  />
                  {editing && (editing.id === 'admin' || editing.id === 'operator' || editing.id === 'viewer') && (
                    <p className="text-[11px] text-amber-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={12} /> Built-in usernames cannot be changed
                    </p>
                  )}
                </div>
                
                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('password') || 'Password'} {editing ? '' : <span className="text-red-500">*</span>}
                  </label>
                  <input 
                    type="password" 
                    required={!editing} 
                    value={form.password} 
                    onChange={e => setForm({...form, password: e.target.value})} 
                    placeholder={editing ? (t('leaveBlankToKeep') || 'Leave blank to keep current') : ''}
                    className="input-field" 
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('role') || 'Role'} <span className="text-red-500">*</span>
                  </label>
                  <select 
                    required 
                    value={form.role} 
                    onChange={e => setForm({...form, role: e.target.value})}
                    className="input-field py-2"
                  >
                    {roles.map(r => (
                      <option key={r.id} value={r.id}>{r.name} ({r.id})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('email') || 'Email Address'}
                  </label>
                  <input 
                    type="email" 
                    value={form.email} 
                    onChange={e => setForm({...form, email: e.target.value})} 
                    placeholder="user@example.com"
                    className="input-field" 
                  />
                </div>
              </form>
            </div>
            
            <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-end gap-3 shrink-0">
              <button type="button" onClick={() => setDialogOpen(false)} className="btn-secondary px-5 py-2">
                {t('cancel') || 'Cancel'}
              </button>
              <button type="submit" form="user-form" className="btn-primary px-6 py-2">
                {editing ? (t('save') || 'Save Changes') : (t('create') || 'Create User')}
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
