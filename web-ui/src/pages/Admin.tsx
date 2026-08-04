import { useState, useEffect, useCallback } from 'react'
import {
  Box, Card, CardContent, Grid, Table, TableHead, TableBody, TableRow, TableCell,
  Button, Typography, Stack, LinearProgress, Alert, IconButton, Tooltip, Divider, Chip,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteIcon from '@mui/icons-material/Delete'
import ComputerIcon from '@mui/icons-material/Computer'
import HistoryIcon from '@mui/icons-material/History'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatBytes, formatTs, formatRelative, prettyStatus } from '../utils'
import { agentsApi, eventsApi, reposApi, type Agent, type EventInfo, type Repository } from '../api/client'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [a, e, r] = await Promise.all([agentsApi.list(), eventsApi.list(100), reposApi.list()])
      setAgents(a.data)
      setEvents(e.data)
      setRepos(r.data)
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
    </Box>
  )
}
