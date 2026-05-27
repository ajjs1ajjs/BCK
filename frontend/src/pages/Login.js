import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, TextField, Button, Card, CardContent, Alert, InputAdornment, IconButton,
} from '@mui/material';
import { Visibility, VisibilityOff, CloudUpload as Logo } from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const ok = await login(username, password);
      if (ok) {
        navigate('/', { replace: true });
      } else {
        setError('Invalid credentials. Try: admin/291263');
      }
    } catch {
      setError('Invalid credentials. Try: admin/291263');
    }
  };

  return (
    <Box sx={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      bgcolor: 'background.default',
    }}>
      <Card sx={{ maxWidth: 400, width: '100%', mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Box sx={{
              width: 56, height: 56, borderRadius: 2.5, mx: 'auto', mb: 1.5,
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Logo sx={{ fontSize: 30, color: '#fff' }} />
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>BCK Backup</Typography>
            <Typography variant="body2" color="text.secondary">Sign in to your account</Typography>
          </Box>

          <Box component="form" onSubmit={handleSubmit}>
            {error && <Alert severity="warning" sx={{ mb: 2, borderRadius: 2, fontSize: 12 }}>{error}</Alert>}
            <TextField label="Username" fullWidth value={username} onChange={(e) => setUsername(e.target.value)}
              sx={{ mb: 2 }} autoFocus />
            <TextField label="Password" type={showPw ? 'text' : 'password'} fullWidth value={password}
              onChange={(e) => setPassword(e.target.value)} sx={{ mb: 3 }}
              InputProps={{
                endAdornment: <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShowPw(!showPw)} edge="end">
                    {showPw ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>,
              }} />
            <Button type="submit" variant="contained" fullWidth size="large">Sign In</Button>
          </Box>

          <Box sx={{ mt: 3, p: 2, bgcolor: 'action.hover', borderRadius: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>Demo Accounts</Typography>
            <Typography variant="caption" display="block" color="text.secondary">admin/291263 — operator/operator — viewer/viewer</Typography>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
