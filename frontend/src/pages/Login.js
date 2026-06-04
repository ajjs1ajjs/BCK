import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Cloud, Globe } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';

export default function Login() {
  const { login, loginLdap } = useAuth();
  const { lang, setLang, t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [isLdap, setIsLdap] = useState(false);
  const [error, setError] = useState('');

  const toggleLang = () => setLang(lang === 'en' ? 'uk' : 'en');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const ok = isLdap
        ? await loginLdap(username, password)
        : await login(username, password);
      if (ok) {
        navigate('/', { replace: true });
      } else {
        setError(t('loginError'));
      }
    } catch {
      setError(t('loginError'));
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 animate-ambient"
         style={{ backgroundImage: 'radial-gradient(ellipse at 50% 50%, rgba(124,58,237,0.06) 0%, transparent 60%)' }}>
      
      <div className="relative w-full max-w-md mx-4 z-10 glass-card p-8">
        
        {/* Language Toggle */}
        <button 
          onClick={toggleLang}
          className="absolute top-4 right-4 flex items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors bg-slate-100 dark:bg-slate-800/50 px-2.5 py-1.5 rounded-lg"
        >
          <Globe size={14} />
          {lang === 'en' ? 'UA' : 'EN'}
        </button>

        {/* Header */}
        <div className="text-center mb-8 mt-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/30 mb-4 animate-float">
            <Cloud className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">BCK Backup</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('loginSubtitle') || 'Sign in to your account'}</p>
        </div>

        {/* Tabs */}
        <div className="flex rounded-xl bg-slate-100/80 dark:bg-slate-800/80 p-1 mb-6 border border-slate-200/50 dark:border-slate-700/50">
          <button
            onClick={() => { setIsLdap(false); setError(''); }}
            className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-all duration-200 ${!isLdap ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
          >
            Local Account
          </button>
          <button
            onClick={() => { setIsLdap(true); setError(''); }}
            className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-all duration-200 ${isLdap ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}`}
          >
            Enterprise LDAP
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-900/50 rounded-xl">
              <p className="text-sm text-red-600 dark:text-red-400 font-medium text-center">{error}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
              {isLdap ? "Domain Username / UPN" : t('username')}
            </label>
            <input
              type="text"
              autoFocus
              className="input-field"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
              {t('password')}
            </label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                className="input-field pr-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                onClick={() => setShowPw(!showPw)}
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="pt-2">
            <button type="submit" className="w-full btn-primary py-3">
              {isLdap ? "Login with Active Directory" : t('loginButton') || 'Sign In'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
