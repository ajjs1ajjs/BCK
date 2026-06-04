import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, Database, Clock, FileText, Settings, RotateCcw, 
  Monitor, Cloud, Server, Shield, History, ChevronDown, ChevronRight,
  Users, ShieldCheck, Key, KeyRound, Building2, HardDrive, Inbox
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const { t } = useTranslation();
  
  const backupPaths = ['/backups', '/db-backups', '/vm-backups', '/host-backups', '/cloud-backups', '/restore', '/ssh-backups'];
  const isBackupActive = backupPaths.includes(location.pathname);
  const [backupOpen, setBackupOpen] = useState(isBackupActive);

  const isActive = (path) => location.pathname === path;

  const NavItem = ({ icon: Icon, label, path, selected, onClick, hasChildren, isOpen }) => (
    <button
      onClick={onClick || (() => navigate(path))}
      className={`w-full flex items-center gap-3 px-3 py-2.5 mb-1 rounded-xl transition-all duration-200 group ${
        selected 
          ? 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 font-semibold' 
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
      }`}
    >
      <div className={`flex items-center justify-center w-6 h-6 ${selected ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'}`}>
        <Icon size={18} />
      </div>
      <span className="flex-1 text-left text-sm whitespace-nowrap hidden md:block">
        {label}
      </span>
      {hasChildren && (
        <div className="hidden md:block">
          {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      )}
    </button>
  );

  const SubItem = ({ icon: Icon, label, path }) => (
    <button
      onClick={() => navigate(path)}
      className={`w-full flex items-center gap-3 px-3 py-2 mb-0.5 ml-2 rounded-lg transition-all duration-200 ${
        isActive(path) 
          ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold' 
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200'
      }`}
    >
      <div className={`flex items-center justify-center w-5 h-5 ${isActive(path) ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
        <Icon size={16} />
      </div>
      <span className="text-left text-sm whitespace-nowrap hidden md:block">
        {label}
      </span>
    </button>
  );

  return (
    <aside className="flex-shrink-0 w-[72px] md:w-64 h-screen bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-all duration-300">
      
      {/* Logo Area */}
      <div className="h-16 flex items-center gap-3 px-4 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-md shrink-0">
          B
        </div>
        <div className="hidden md:block">
          <h1 className="font-bold text-slate-900 dark:text-white leading-tight">BCK</h1>
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Backup Solution</p>
        </div>
      </div>

      {/* Nav List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 scrollbar-hide">
        <NavItem icon={LayoutDashboard} label={t('dashboard')} path="/" selected={isActive('/')} />
        
        {/* Backups Group */}
        <NavItem 
          icon={Database} 
          label={t('backups')} 
          selected={isBackupActive} 
          onClick={() => setBackupOpen(!backupOpen)}
          hasChildren={true}
          isOpen={backupOpen}
        />
        
        {backupOpen && (
          <div className="mb-2">
            <SubItem icon={Inbox} label={t('allBackups')} path="/backups" />
            <SubItem icon={Database} label={t('databases')} path="/db-backups" />
            <SubItem icon={Monitor} label={t('vms')} path="/vm-backups" />
            <SubItem icon={Server} label={t('hosts') || 'Hosts'} path="/host-backups" />
            <SubItem icon={Cloud} label={t('cloud')} path="/cloud-backups" />
            <SubItem icon={Key} label="SSH" path="/ssh-backups" />
            {(!can || can('restore')) && <SubItem icon={RotateCcw} label={t('restore')} path="/restore" />}
          </div>
        )}

        {(!can || can('manageSchedules')) && (
          <NavItem icon={Clock} label={t('schedules')} path="/schedules" selected={isActive('/schedules')} />
        )}

        {(!can || can('manageUsers')) && (
          <NavItem icon={Users} label={t('users')} path="/users" selected={isActive('/users')} />
        )}

        {(!can || can('manageRoles')) && (
          <NavItem icon={ShieldCheck} label={t('roles')} path="/roles" selected={isActive('/roles')} />
        )}

        <NavItem icon={Shield} label={t('policies')} path="/policies" selected={isActive('/policies')} />
        <NavItem icon={History} label={t('history')} path="/history" selected={isActive('/history')} />
        <NavItem icon={HardDrive} label="Repositories" path="/repos" selected={isActive('/repos')} />
        <NavItem icon={KeyRound} label="API Tokens" path="/tokens" selected={isActive('/tokens')} />

        {(!can || can('manageUsers')) && (
          <NavItem icon={Building2} label="Organizations" path="/organizations" selected={isActive('/organizations')} />
        )}

        <NavItem icon={FileText} label={t('logs')} path="/logs" selected={isActive('/logs')} />
        
        {(!can || can('configure')) && (
          <NavItem icon={Settings} label={t('settings')} path="/settings" selected={isActive('/settings')} />
        )}
      </div>
    </aside>
  );
}
