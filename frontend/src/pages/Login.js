import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, TextField, Button, Card, CardContent, Alert, InputAdornment, IconButton,
} from '@mui/material';
import { Visibility, VisibilityOff, CloudUpload as Logo } from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';

export default function Login() {
  const { login } = useAuth();
  const { lang, setLang, t } = useTranslation();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');

  const toggleLang = () => setLang(lang === 'en' ? 'uk' : 'en');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const ok = await login(username, password);
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
    <Box sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'background.default',
      backgroundImage: 'radial-gradient(ellipse at 50% 50%, rgba(124,58,237,0.06) 0%, transparent 60%)',
    }}>
      <Card sx={{ maxWidth: 400, width: '100%', mx: 2, position: 'relative' }}>
        <Button
          onClick={toggleLang}
          size="small"
          sx={{
            position: 'absolute', top: 16, right: 16,
            color: 'text.secondary', fontWeight: 700, minWidth: 32, px: 1, fontSize: 11
          }}
        >
          {lang === 'en' ? 'UA' : 'EN'}
        </Button>

        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Box sx={{
              width: 56, height: 56, borderRadius: 2.5, mx: 'auto', mb: 1.5,
              background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(124,58,237,0.3)',
            }}>
              <Logo sx={{ fontSize: 30, color: '#fff' }} />
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>BCK Backup</Typography>
            <Typography variant="body2" color="text.secondary">{t('loginSubtitle')}</Typography>
          </Box>

          <Box component="form" onSubmit={handleSubmit}>
            {error && <Alert severity="warning" sx={{ mb: 2, borderRadius: 2, fontSize: 12 }}>{error}</Alert>}
            <TextField label={t('username')} fullWidth value={username} onChange={(e) => setUsername(e.target.value)}
              sx={{ mb: 2 }} autoFocus />
            <TextField label={t('password')} type={showPw ? 'text' : 'password'} fullWidth value={password}
              onChange={(e) => setPassword(e.target.value)} sx={{ mb: 3 }}
              InputProps={{
                endAdornment: <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShowPw(!showPw)} edge="end">
                    {showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>,
              }} />
            <Button type="submit" variant="contained" fullWidth size="large">{t('loginButton')}</Button>
          </Box>


        </CardContent>
      </Card>
    </Box>
  );
}
