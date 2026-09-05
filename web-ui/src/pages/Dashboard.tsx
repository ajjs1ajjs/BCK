import { useEffect, useState } from 'react'
import {
  Grid, Card, CardContent, Typography, Box, CircularProgress, Stack, LinearProgress, Divider,
} from '@mui/material'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts'
import BackupIcon from '@mui/icons-material/Backup'
import StorageIcon from '@mui/icons-material/Storage'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import PlayCircleIcon from '@mui/icons-material/PlayCircle'
import ErrorIcon from '@mui/icons-material/Error'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ScheduleIcon from '@mui/icons-material/Schedule'
import StatCard from '../components/StatCard'
import PageHeader from '../components/PageHeader'
import StatusChip from '../components/StatusChip'
import { formatBytes, formatTs, formatRelative } from '../utils'
import { dashboardApi, eventsApi, jobsApi, type DashboardStats, type EventInfo, type Job } from '../api/client'

const PIE_COLORS = ['#1E88E5', '#00ACC1', '#43A047', '#FB8C00', '#E53935']

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [events, setEvents] = useState<EventInfo[]>([])
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    dashboardApi.stats().then((r) => setStats(r.data)).catch(() => {})
    eventsApi.list(12).then((r) => setEvents(r.data)).catch(() => {})
    jobsApi.list().then((r) => setJobs(r.data)).catch(() => {})
  }, [])

  const totalStorage = (stats?.storage_used_bytes ?? 0) + (stats?.storage_free_bytes ?? 0)
  const usedPct = totalStorage > 0 ? ((stats?.storage_used_bytes ?? 0) / totalStorage) * 100 : 0

  const storageData = [
    { name: 'Used', value: Math.max(stats?.storage_used_bytes ?? 0, 0) },
    { name: 'Free', value: Math.max(stats?.storage_free_bytes ?? 0, 0) },
  ]

  const jobStatusData = [
    { name: 'Completed', value: stats?.completed_jobs ?? 0, color: '#43A047' },
    { name: 'Active', value: stats?.active_jobs ?? 0, color: '#1E88E5' },
    { name: 'Failed', value: stats?.failed_jobs ?? 0, color: '#E53935' },
  ].filter((d) => d.value > 0)

  return (
    <Box>
      <PageHeader title="Dashboard" subtitle="Backup & recovery overview" />

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            title="Backup Jobs"
            value={stats?.total_jobs ?? <CircularProgress size={18} />}
            subtitle={`${stats?.active_jobs ?? 0} running now`}
            icon={<BackupIcon />}
            accent="#1E88E5"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            title="Repositories"
            value={stats?.total_repositories ?? 0}
            subtitle="Storage destinations"
            icon={<StorageIcon />}
            accent="#00ACC1"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            title="Snapshots"
            value={stats?.total_snapshots ?? 0}
            subtitle="Recovery points"
            icon={<CloudDoneIcon />}
            accent="#43A047"
          />
        </Grid>
        <Grid item xs={12} sm={6} lg={3}>
          <StatCard
            title="Failed Jobs"
            value={stats?.failed_jobs ?? 0}
            subtitle={stats?.failed_jobs ? 'Attention required' : 'All clear'}
            icon={<ErrorIcon />}
            accent="#E53935"
          />
        </Grid>

        <Grid item xs={12} md={8}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h6">Jobs Overview</Typography>
                <StatusChip status={`${stats?.active_jobs ?? 0} running`} size="small" />
              </Stack>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[
                  { name: 'Total', value: stats?.total_jobs ?? 0, fill: '#1E88E5' },
                  { name: 'Completed', value: stats?.completed_jobs ?? 0, fill: '#43A047' },
                  { name: 'Active', value: stats?.active_jobs ?? 0, fill: '#00ACC1' },
                  { name: 'Failed', value: stats?.failed_jobs ?? 0, fill: '#E53935' },
                ]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E8EEF5" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={60} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Storage Usage</Typography>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={storageData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={2} strokeWidth={0}>
                    {storageData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => formatBytes(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <Box sx={{ px: 1, mt: 1 }}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">Capacity used</Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>{usedPct.toFixed(1)}%</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={Math.min(usedPct, 100)} color={usedPct > 80 ? 'error' : 'primary'} />
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">Used</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatBytes(stats?.storage_used_bytes)}</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="caption" color="text.secondary" display="block">Free</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatBytes(stats?.storage_free_bytes)}</Typography>
                  </Box>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h6">Recent Activity</Typography>
                <Typography variant="caption" color="text.secondary">Latest {events.length} events</Typography>
              </Stack>
              {events.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No activity yet</Typography>
              ) : (
                <Stack divider={<Divider />} spacing={0}>
                  {events.map((ev) => (
                    <Stack key={ev.id} direction="row" spacing={1.5} alignItems="flex-start" sx={{ py: 1 }}>
                      <Box sx={{ mt: 0.25 }}>
                        {ev.event_type.includes('fail') || ev.event_type.includes('error') ? (
                          <ErrorIcon fontSize="small" color="error" />
                        ) : ev.event_type.includes('completed') ? (
                          <CheckCircleIcon fontSize="small" color="success" />
                        ) : ev.event_type.includes('run') ? (
                          <PlayCircleIcon fontSize="small" color="info" />
                        ) : (
                          <ScheduleIcon fontSize="small" color="action" />
                        )}
                      </Box>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="body2" sx={{ fontSize: 13 }}>{ev.message}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {ev.source} · {formatTs(ev.created_at)}
                        </Typography>
                      </Box>
                    </Stack>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>Latest Jobs</Typography>
              {jobs.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>No jobs yet</Typography>
              ) : (
                <Stack spacing={1.5}>
                  {jobs.slice(0, 5).map((job) => (
                    <Box key={job.id} sx={{ p: 1.5, borderRadius: 2, bgcolor: '#F7F9FC', border: '1px solid #E8EEF5' }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{job.name}</Typography>
                        <StatusChip status={job.status} size="small" />
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={job.progress}
                        sx={{ height: 5, mb: 0.75 }}
                        color={job.status.toLowerCase().includes('fail') ? 'error' : 'primary'}
                      />
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary">Last run {formatRelative(job.last_run_at)}</Typography>
                        <Typography variant="caption" color="text.secondary">{job.progress.toFixed(0)}%</Typography>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
