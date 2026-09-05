import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Grid, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem,
  Typography, Stack, LinearProgress, Alert, IconButton, Tooltip, Divider, Chip,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteIcon from '@mui/icons-material/Delete'
import ComputerIcon from '@mui/icons-material/Computer'
import HistoryIcon from '@mui/icons-material/History'
import ShieldIcon from '@mui/icons-material/Shield'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatBytes, formatTs, formatRelative, prettyStatus } from '../utils'
import {
  agentsApi, eventsApi, reposApi, ssoApi,
  type Agent, type EventInfo, type Repository, type SsoProvider, type LdapConfig,
} from '../api/client'

const SSO_TYPES = ['Oidc', 'SAML', 'Ldap', 'AzureAd', 'GoogleWorkspace']

const EMPTY_PROVIDER = {
  id: '',
  name: '',
  provider_type: 'Oidc',
  issuer_url: '',
  client_id: '',
  encrypted_client_secret: '',
  scopes: 'openid email profile',
  auto_provision: true,
  default_role: 'operator',
  enabled: true,
}

const EMPTY_LDAP = {
  url: '',
  bind_dn: '',
  bind_password: '',
  base_dn: '',
  user_filter: '(objectClass=person)',
  group_filter: '(objectClass=group)',
  tls: true,
}

function eventIcon(type: string) {
  if (type.includes('fail') || type.includes('error')) return { color: 'error' as const, emoji: '✕' }
  if (type.includes('complet')) return { color: 'success' as const, emoji: '✓' }
  if (type.includes('run') || type.includes('start')) return { color: 'info' as const, emoji: '▶' }
  return { color: 'action' as const, emoji: '•' }
}

export default function Admin() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [events, setEvents] = useState<EventInfo[]>([])
  const [repos, setRepos] = useState<Repository[]>([])
  const [providers, setProviders] = useState<SsoProvider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ssoDialog, setSsoDialog] = useState(false)
  const [ssoForm, setSsoForm] = useState(EMPTY_PROVIDER)
  const [ldapDialog, setLdapDialog] = useState(false)
  const [ldapForm, setLdapForm] = useState(EMPTY_LDAP)

  const load = useCallback(async () => {
    try {
      const [a, e, r, s] = await Promise.all([agentsApi.list(), eventsApi.list(100), reposApi.list(), ssoApi.providers()])
      setAgents(a.data)
      setEvents(e.data)
      setRepos(r.data)
      setProviders(s.data)
    } catch {
      setError('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const removeAgent = async (id: string) => {
    await agentsApi.remove(id)
    load()
  }

  const registerProvider = async () => {
    if (!ssoForm.name || !ssoForm.issuer_url) return
    setBusy(true)
    setError(null)
    try {
      await ssoApi.registerProvider({
        ...ssoForm,
        scopes: ssoForm.scopes.split(' ').filter(Boolean),
      })
      setSsoDialog(false)
      setSsoForm(EMPTY_PROVIDER)
      load()
    } catch {
      setError('Failed to register SSO provider')
    } finally {
      setBusy(false)
    }
  }

  const addLdap = async () => {
    if (!ldapForm.url) return
    setBusy(true)
    setError(null)
    try {
      await ssoApi.addLdap(ldapForm as LdapConfig)
      setLdapDialog(false)
      setLdapForm(EMPTY_LDAP)
      load()
    } catch {
      setError('Failed to add LDAP config')
    } finally {
      setBusy(false)
    }
  }

  const totalUsed = repos.reduce((acc, r) => acc + (r.used_bytes ?? 0), 0)
  const totalFree = repos.reduce((acc, r) => acc + (r.free_bytes ?? 0), 0)

  return (
    <Box>
      <PageHeader
        title="Administration"
        subtitle="Infrastructure, agents and activity log"
        actions={<Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>}
      />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <LinearProgress />
      ) : (
        <Grid container spacing={3}>
          <Grid item xs={12} md={7}>
            <Card>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                  <ComputerIcon color="primary" />
                  <Typography variant="h6">Agents</Typography>
                  <Chip label={`${agents.length} registered`} size="small" />
                </Stack>
                {agents.length === 0 ? (
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No agents have registered yet
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Host</TableCell>
                        <TableCell>OS</TableCell>
                        <TableCell>Version</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Last Seen</TableCell>
                        <TableCell align="right">Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {agents.map((a) => (
                        <TableRow key={a.id} hover>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{a.hostname}</Typography>
                            <Typography variant="caption" color="text.secondary">{a.ip_address}</Typography>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{a.os_type || '—'}</Typography>
                            <Typography variant="caption" color="text.secondary">{a.os_version}</Typography>
                          </TableCell>
                          <TableCell><Typography variant="body2">{a.agent_version || '—'}</Typography></TableCell>
                          <TableCell><StatusChip status={a.status} /></TableCell>
                          <TableCell>
                            <Typography variant="body2">{formatRelative(a.last_seen)}</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title="Remove agent">
                              <IconButton size="small" color="error" onClick={() => removeAgent(a.id)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                  <HistoryIcon color="primary" />
                  <Typography variant="h6">Activity Log</Typography>
                  <Chip label={events.length} size="small" />
                </Stack>
                {events.length === 0 ? (
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No activity yet</Typography>
                ) : (
                  <Stack divider={<Divider />} spacing={0}>
                    {events.map((ev) => {
                      const icon = eventIcon(ev.event_type)
                      return (
                        <Stack key={ev.id} direction="row" spacing={1.5} alignItems="flex-start" sx={{ py: 0.75 }}>
                          <Box sx={{ mt: 0.25, color: `${icon.color}.main`, fontSize: 14, fontWeight: 700 }}>{icon.emoji}</Box>
                          <Box sx={{ flexGrow: 1 }}>
                            <Typography variant="body2" sx={{ fontSize: 13 }}>{ev.message}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {ev.source} · {formatTs(ev.created_at)} · {prettyStatus(ev.event_type)}
                            </Typography>
                          </Box>
                        </Stack>
                      )
                    })}
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={5}>
            <Card>
              <CardContent>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                  <ShieldIcon color="primary" />
                  <Typography variant="h6">SSO Providers</Typography>
                  <Chip label={`${providers.length} configured`} size="small" />
                  <Box sx={{ flexGrow: 1 }} />
                  <Button size="small" variant="contained" onClick={() => setSsoDialog(true)}>Add OIDC</Button>
                  <Button size="small" variant="outlined" onClick={() => setLdapDialog(true)}>Add LDAP</Button>
                </Stack>
                {providers.length === 0 ? (
                  <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    No SSO providers configured
                  </Typography>
                ) : (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Name</TableCell>
                        <TableCell>Type</TableCell>
                        <TableCell>Issuer</TableCell>
                        <TableCell>Enabled</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {providers.map((p) => (
                        <TableRow key={p.id} hover>
                          <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{p.name}</Typography></TableCell>
                          <TableCell><Typography variant="body2">{p.provider_type}</Typography></TableCell>
                          <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 11 }}>{p.issuer_url}</Typography></TableCell>
                          <TableCell><StatusChip status={p.enabled ? 'online' : 'offline'} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card sx={{ mt: 3 }}>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>Storage Summary</Typography>
                <Stack spacing={1.5}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">Repositories</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{repos.length}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">Used</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatBytes(totalUsed)}</Typography>
                  </Stack>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">Free</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatBytes(totalFree)}</Typography>
                  </Stack>
                  <Divider />
                  <Typography variant="caption" color="text.secondary">
                    BCK Enterprise v0.1.0 · Agent protocol v1 · API /api/v1
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      <Dialog open={ssoDialog} onClose={() => setSsoDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Register OIDC Provider</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Provider name" value={ssoForm.name} onChange={(e) => setSsoForm({ ...ssoForm, name: e.target.value })} fullWidth required />
            <TextField
              select label="Provider type" value={ssoForm.provider_type}
              onChange={(e) => setSsoForm({ ...ssoForm, provider_type: e.target.value })}
              fullWidth
            >
              {SSO_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <TextField label="Issuer URL" value={ssoForm.issuer_url} onChange={(e) => setSsoForm({ ...ssoForm, issuer_url: e.target.value })} fullWidth required placeholder="https://accounts.google.com" />
            <TextField label="Client ID" value={ssoForm.client_id} onChange={(e) => setSsoForm({ ...ssoForm, client_id: e.target.value })} fullWidth />
            <TextField label="Client secret" type="password" value={ssoForm.encrypted_client_secret} onChange={(e) => setSsoForm({ ...ssoForm, encrypted_client_secret: e.target.value })} fullWidth />
            <TextField label="Scopes (space-separated)" value={ssoForm.scopes} onChange={(e) => setSsoForm({ ...ssoForm, scopes: e.target.value })} fullWidth />
            <TextField label="Default role" value={ssoForm.default_role} onChange={(e) => setSsoForm({ ...ssoForm, default_role: e.target.value })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSsoDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={registerProvider}>Register</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={ldapDialog} onClose={() => setLdapDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Configure LDAP</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="LDAP URL" value={ldapForm.url} onChange={(e) => setLdapForm({ ...ldapForm, url: e.target.value })} fullWidth required placeholder="ldaps://dc.example.com" />
            <TextField label="Bind DN" value={ldapForm.bind_dn} onChange={(e) => setLdapForm({ ...ldapForm, bind_dn: e.target.value })} fullWidth />
            <TextField label="Bind password" type="password" value={ldapForm.bind_password} onChange={(e) => setLdapForm({ ...ldapForm, bind_password: e.target.value })} fullWidth />
            <TextField label="Base DN" value={ldapForm.base_dn} onChange={(e) => setLdapForm({ ...ldapForm, base_dn: e.target.value })} fullWidth placeholder="dc=example,dc=com" />
            <Stack direction="row" spacing={2}>
              <TextField label="User filter" value={ldapForm.user_filter} onChange={(e) => setLdapForm({ ...ldapForm, user_filter: e.target.value })} fullWidth />
              <TextField label="Group filter" value={ldapForm.group_filter} onChange={(e) => setLdapForm({ ...ldapForm, group_filter: e.target.value })} fullWidth />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLdapDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={addLdap}>Save LDAP Config</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
