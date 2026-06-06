import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Sun, Moon, Globe, LogOut, Shield, ChevronDown
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';

const ROLE_COLORS = { 
  admin: 'bg-rose-500 text-white', 
  operator: 'bg-amber-500 text-white', 
  viewer: 'bg-sky-500 text-white' 
};

const ROLE_TEXT = {
  admin: 'text-rose-500 dark:text-rose-400',
  operator: 'text-amber-500 dark:text-amber-400',
  viewer: 'text-sky-500 dark:text-sky-400'
};

export default function TopBar({ isDark, toggleTheme }) {
  const { user, logout } = useAuth();
  const { lang, setLang, t } = useTranslation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const toggleLang = () => setLang(lang === 'en' ? 'uk' : 'en');

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuRef]);

  const userRole = user?.role || 'viewer';

  return (
    <div className="flex items-center justify-between px-4 md:px-6 py-3 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shrink-0 h-16 z-20 sticky top-0">
      
      {/* Left side: Status */}
      <div className="flex items-center gap-2.5">
        <div className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </div>
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300 hidden sm:block">
          {t('allSystemsOperational') || 'All systems operational'}
        </span>
      </div>

      {/* Right side: Actions */}
      <div className="flex items-center gap-2">
        
        {/* Language Toggle */}
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors mr-1"
          title={lang === 'en' ? 'Українська мова' : 'English language'}
        >
          <Globe size={14} />
          <span className="text-xs font-bold">{lang === 'en' ? 'UA' : 'EN'}</span>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* User Menu */}
        <div className="relative ml-2" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 p-1.5 pr-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shadow-sm ${ROLE_COLORS[userRole]}`}>
              {(user?.username || 'U')[0].toUpperCase()}
            </div>
            <div className="text-left hidden sm:block">
              <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                {user?.username || 'User'}
              </p>
              <p className={`text-[10px] font-bold uppercase tracking-wider ${ROLE_TEXT[userRole]}`}>
                {userRole}
              </p>
            </div>
            <ChevronDown size={14} className="text-slate-400 ml-1 hidden sm:block" />
          </button>

          {/* Dropdown Menu */}
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 rounded-xl bg-white dark:bg-slate-800 shadow-lg ring-1 ring-black/5 dark:ring-white/10 overflow-hidden glass z-50">
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {user?.username}
                </p>
                <p className={`text-xs font-medium truncate ${ROLE_TEXT[userRole]}`}>
                  {userRole}
                </p>
              </div>
              <div className="p-1.5">
                <button
                  onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors"
                >
                  <Shield size={16} />
                  {t('settings') || 'Settings'}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); logout(); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors mt-0.5"
                >
                  <LogOut size={16} />
                  {t('logout') || 'Logout'}
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
