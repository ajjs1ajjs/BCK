import { useState, useEffect, useMemo } from 'react';
import { 
  Database, FolderSync, FileText, Download, Trash2, 
  Search, Cloud, History, RotateCcw, X, Loader2, RefreshCw, AlertCircle
} from 'lucide-react';
import { API } from '../utils/config';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function getStatusConfig(status) {
  if (status === 'completed') return { color: 'text-emerald-600', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' };
  if (status === 'failed') return { color: 'text-red-600', bg: 'bg-red-500/10', border: 'border-red-500/20' };
  if (status === 'running') return { color: 'text-amber-600', bg: 'bg-amber-500/10', border: 'border-amber-500/20' };
  return { color: 'text-slate-600', bg: 'bg-slate-500/10', border: 'border-slate-500/20' };
}

export default function Repos() {
  const [backups, setBackups] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deleting, setDeleting] = useState(null);

  // S3 Versioning state
  const [versionDialogOpen, setVersionDialogOpen] = useState(false);
  const [versioningData, setVersioningData] = useState(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState(null);

  const token = useMemo(() => {
    try {
      const saved = sessionStorage.getItem('bck-auth');
      return saved ? JSON.parse(saved).token || '' : '';
    } catch (e) {
      return '';
    }
  }, []);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [bRes, sRes] = await Promise.all([
        fetch(`${API}/api/backups?limit=500`, { headers }),
        fetch(`${API}/api/stats`, { headers }),
      ]);
      const bData = await bRes.json();
      const sData = await sRes.json();
      setBackups(bData?.data || (Array.isArray(bData) ? bData : []));
      setStats(sData);
    } catch (e) {
      console.error('Repos load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  const filtered = useMemo(() => {
    if (!search) return backups;
    const q = search.toLowerCase();
    return backups.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.backupType || b.type || '').toLowerCase().includes(q) ||
      (b.destination || '').toLowerCase().includes(q)
    );
  }, [backups, search]);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete backup "${name}"?`)) return;
    setDeleting(id);
    try {
      await fetch(`${API}/api/backups/${id}`, { method: 'DELETE', headers });
      setBackups(prev => prev.filter(b => b.id !== id));
    } catch (e) {
      alert('Delete failed: ' + e.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleDownload = (id) => {
    window.open(`${API}/api/backups/${id}/download?token=${token}`, '_blank');
  };

  const handleExport = (fmt) => {
    window.open(`${API}/api/backups/export?format=${fmt}&token=${token}`, '_blank');
  };

  // S3 versioning handlers
  const handleOpenVersions = async (backup) => {
    setSelectedBackup(backup);
    setVersionDialogOpen(true);
    setLoadingVersions(true);
    setVersioningData(null);
    try {
      const res = await fetch(`${API}/api/versions/${backup.id}`, { headers });
      if (!res.ok) {
        const errorText = await res.text();
        let parsedError = errorText;
        try { parsedError = JSON.parse(errorText).error; } catch (e) { parsedError = errorText; }
        throw new Error(parsedError || 'S3 versioning details not found or disabled.');
      }
      const data = await res.json();
      setVersioningData(data);
    } catch (e) {
      console.error('Failed to load S3 versions:', e);
      setVersioningData({ error: e.message });
    } finally {
      setLoadingVersions(false);
    }
  };

  const handleEnableVersioning = async () => {
    if (!selectedBackup) return;
    try {
      const res = await fetch(`${API}/api/versions/${selectedBackup.id}/enable`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        alert('S3 Bucket Versioning enabled successfully!');
        handleOpenVersions(selectedBackup);
      } else {
        alert('Failed to enable versioning');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleRestoreVersion = async (versionId) => {
    if (!selectedBackup) return;
    if (!window.confirm(`Are you sure you want to restore version "${versionId}"?`)) return;
    try {
      const res = await fetch(`${API}/api/versions/${selectedBackup.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ versionId })
      });
      if (res.ok) {
        alert('Restore initiated successfully! Check Activity Log for status.');
        setVersionDialogOpen(false);
      } else {
        const err = await res.json();
        alert('Failed to initiate restore: ' + (err.error || res.statusText));
      }
    } catch (e) {
      alert('Error initiating restore: ' + e.message);
    }
  };

  // Aggregate stats
  const totalSize = useMemo(() => backups.reduce((acc, b) => acc + (b.size || 0), 0), [backups]);
  const completed = useMemo(() => backups.filter(b => b.status === 'completed').length, [backups]);
  const failed = useMemo(() => backups.filter(b => b.status === 'failed').length, [backups]);
  const diskUsedGB = stats?.diskSpace ? (stats.diskSpace.usedBytes / 1073741824).toFixed(1) : null;
  const diskTotalGB = stats?.diskSpace ? (stats.diskSpace.totalBytes / 1073741824).toFixed(1) : null;
  const diskPct = diskTotalGB > 0 ? Math.min(((diskUsedGB / diskTotalGB) * 100), 100) : 0;

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            Repositories
          </h1>
          <p className="text-sm font-medium text-slate-500">
            Backup storage overview and file management
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button onClick={() => handleExport('csv')} className="btn-secondary py-2.5 px-4 flex-1 sm:flex-none">
            <Download size={16} />
            Export CSV
          </button>
          <button onClick={() => handleExport('json')} className="btn-secondary py-2.5 px-4 flex-1 sm:flex-none">
            <Download size={16} />
            Export JSON
          </button>
          <button onClick={loadData} className="btn-primary py-2.5 px-4 flex-1 sm:flex-none">
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Backups', value: loading ? '—' : backups.length, icon: Database, color: 'text-blue-500', bg: 'bg-blue-500/10' },
          { label: 'Completed', value: loading ? '—' : completed, icon: Cloud, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
          { label: 'Failed', value: loading ? '—' : failed, icon: FolderSync, color: 'text-red-500', bg: 'bg-red-500/10' },
          { label: 'Total Size', value: loading ? '—' : formatBytes(totalSize), icon: FileText, color: 'text-purple-500', bg: 'bg-purple-500/10' },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="glass-card p-5 flex items-center gap-4">
              <div className={`p-3 rounded-xl ${s.bg} ${s.color}`}>
                <Icon size={24} />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white leading-none mb-1">{s.value}</h3>
                <p className="text-sm font-medium text-slate-500">{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Disk Usage */}
      {stats?.diskSpace && (
        <div className="glass-card p-5 mb-6">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Disk Usage</h3>
            <p className="text-xs font-semibold text-slate-500">
              {formatBytes(stats.diskSpace.usedBytes)} / {formatBytes(stats.diskSpace.totalBytes)}
            </p>
          </div>
          <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full ${diskPct > 85 ? 'bg-red-500' : diskPct > 65 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${diskPct}%` }}
            ></div>
          </div>
          <p className="text-xs font-medium text-slate-500 mt-2">
            {formatBytes(stats.diskSpace.freeBytes)} free ({(100 - diskPct).toFixed(1)}%)
          </p>
        </div>
      )}

      {/* Search + Table */}
      <div className="glass-card overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-wrap gap-4 items-center">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="Search backups..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 text-slate-700 dark:text-slate-200"
            />
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                <th className="p-4 font-semibold">Name</th>
                <th className="p-4 font-semibold">Type</th>
                <th className="p-4 font-semibold">Status</th>
                <th className="p-4 font-semibold">Size</th>
                <th className="p-4 font-semibold">Created</th>
                <th className="p-4 font-semibold">Completed</th>
                <th className="p-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="p-4">
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-3/4"></div>
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan="7" className="p-12 text-center text-slate-500">
                    <Database size={48} className="mx-auto mb-4 opacity-20" />
                    <p className="text-sm font-medium">No backups found</p>
                  </td>
                </tr>
              ) : filtered.map(b => {
                let hasCloud = false;
                try {
                  const cfg = JSON.parse(b.config || '{}');
                  if (cfg.cloudCredentialId || b.backupType === 'cloud' || b.type === 'cloud') {
                    hasCloud = true;
                  }
                } catch (e) { hasCloud = false; }
                const sConf = getStatusConfig(b.status);

                return (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors group">
                    <td className="p-4">
                      <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight">{b.name}</p>
                      <p className="text-xs font-medium text-slate-500 mt-0.5 truncate max-w-[200px]" title={b.destination}>{b.destination}</p>
                    </td>
                    <td className="p-4">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 uppercase tracking-wider">
                        {b.backupType || b.type}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider ${sConf.bg} ${sConf.color} ${sConf.border}`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="p-4 text-xs font-mono text-slate-600 dark:text-slate-400">
                      {formatBytes(b.size)}
                    </td>
                    <td className="p-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                      {formatDate(b.createdAt)}
                    </td>
                    <td className="p-4 text-xs font-medium text-slate-500 whitespace-nowrap">
                      {formatDate(b.completedAt)}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {hasCloud && (
                          <button onClick={() => handleOpenVersions(b)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors" title="S3 Version History">
                            <History size={18} />
                          </button>
                        )}
                        <button onClick={() => handleDownload(b.id)} disabled={b.status !== 'completed'} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400" title="Download">
                          <Download size={18} />
                        </button>
                        <button onClick={() => handleDelete(b.id, b.name)} disabled={deleting === b.id} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-slate-400" title="Delete">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 0 && (
          <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 text-xs font-medium text-slate-500">
            Showing {filtered.length} of {backups.length} backups
          </div>
        )}
      </div>

      {/* S3 Object Versions Dialog */}
      {versionDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-800 my-8 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <History size={20} className="text-blue-500" />
                S3 Object Versions — {selectedBackup?.name}
              </h2>
              <button onClick={() => setVersionDialogOpen(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors bg-slate-100 dark:bg-slate-800 p-1.5 rounded-lg">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 sm:p-6 overflow-y-auto flex-1">
              {loadingVersions ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Loader2 size={32} className="animate-spin mb-4" />
                  <p className="text-sm font-medium">Loading S3 versions...</p>
                </div>
              ) : versioningData?.error ? (
                <div className="py-4">
                  <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl mb-6">
                    <AlertCircle size={20} className="text-red-500 shrink-0 mt-0.5" />
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">{versioningData.error}</p>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-xl border border-slate-100 dark:border-slate-700 text-center">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-2">Enable Bucket Versioning</h3>
                    <p className="text-sm text-slate-500 mb-4">Would you like to enable versioning for this storage bucket to keep track of changes?</p>
                    <button onClick={handleEnableVersioning} className="btn-primary px-5 py-2 inline-flex">
                      Enable Bucket Versioning
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex flex-wrap gap-4 justify-between items-center mb-5 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700">
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Status</p>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">{versioningData?.versioningStatus || 'Unknown'}</p>
                    </div>
                    {!versioningData?.versioningEnabled && (
                      <button onClick={handleEnableVersioning} className="btn-secondary px-4 py-2 text-sm">
                        Enable Versioning
                      </button>
                    )}
                  </div>
                  
                  <div className="space-y-3">
                    {(!versioningData?.versions || versioningData.versions.length === 0) ? (
                      <div className="p-8 text-center text-slate-500 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                        <History size={32} className="mx-auto mb-3 opacity-20" />
                        <p className="text-sm font-medium">No S3 object versions found.</p>
                      </div>
                    ) : (
                      versioningData.versions.map((v, index) => (
                        <div key={v.versionId || index} className="p-4 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-blue-500/50 dark:hover:border-blue-500/50 transition-colors flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-white dark:bg-slate-900">
                          <div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <h4 className="text-sm font-bold text-slate-900 dark:text-white font-mono break-all">
                                {v.versionId === 'null' ? 'Null/Unversioned' : (v.versionId?.substring(0, 12) || '—')}
                              </h4>
                              {v.isLatest && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-600 border-emerald-500/20 uppercase tracking-wider whitespace-nowrap">Latest</span>
                              )}
                              {v.isDeleteMarker && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-red-500/10 text-red-600 border-red-500/20 uppercase tracking-wider whitespace-nowrap">Delete Marker</span>
                              )}
                            </div>
                            <div className="text-xs font-medium text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1">
                              <span>Modified: {formatDate(v.lastModified)}</span>
                              {!v.isDeleteMarker && (
                                <>
                                  <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                                  <span>Size: {formatBytes(v.size)}</span>
                                </>
                              )}
                            </div>
                          </div>
                          {!v.isDeleteMarker && (
                            <button 
                              onClick={() => handleRestoreVersion(v.versionId)}
                              className="btn-secondary px-3 py-1.5 text-xs whitespace-nowrap w-full sm:w-auto"
                            >
                              <RotateCcw size={14} />
                              Restore
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            
            <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex justify-end shrink-0">
              <button onClick={() => setVersionDialogOpen(false)} className="btn-secondary px-5 py-2">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
