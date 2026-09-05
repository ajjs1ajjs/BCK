import { FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, CircularProgress, Stack,
  TextField, Typography, InputAdornment, IconButton,
} from '@mui/material'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import ShieldIcon from '@mui/icons-material/Shield'
import { authApi, saveAuth } from '../api/client'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { data } = await authApi.login(username, password)
      saveAuth(data.token, data.user)
      navigate('/dashboard', { replace: true })
    } catch {
      setError('Invalid credentials. Use the credentials provided by your administrator.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background:
          'radial-gradient(1200px 600px at 10% -10%, rgba(30,136,229,0.18), transparent), radial-gradient(900px 500px at 100% 0%, rgba(0,172,193,0.14), transparent), linear-gradient(180deg, #F7FAFC 0%, #E8EEF5 100%)',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 420, boxShadow: '0 16px 48px rgba(16,24,40,0.12)' }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={3} alignItems="center">
            <Box
              sx={{
                width: 56, height: 56, borderRadius: 2,
                background: 'linear-gradient(135deg, #1E88E5 0%, #00ACC1 100%)',
                display: 'grid', placeItems: 'center', color: '#fff',
                boxShadow: '0 8px 24px rgba(30,136,229,0.35)',
              }}
            >
              <ShieldIcon />
            </Box>
            <Box textAlign="center">
              <Typography variant="h5" fontWeight={800}>BCK Enterprise</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Sign in to the backup & recovery console
              </Typography>
            </Box>

            {error && <Alert severity="error" sx={{ width: '100%' }}>{error}</Alert>}

            <Box component="form" onSubmit={onSubmit} sx={{ width: '100%' }}>
              <Stack spacing={2}>
                <TextField label="Username" value={username} onChange={(e) => setUsername(e.target.value)} fullWidth autoFocus required />
                <TextField
                  label="Password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  fullWidth
                  required
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowPw((v) => !v)} edge="end">
                          {showPw ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
                <Button type="submit" variant="contained" size="large" disabled={loading} fullWidth sx={{ mt: 1, py: 1.25 }}>
                  {loading ? <CircularProgress size={22} color="inherit" /> : 'Sign in'}
                </Button>
              </Stack>
            </Box>

            <Typography variant="caption" color="text.secondary" textAlign="center">
              Use the credentials provided by your administrator
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
