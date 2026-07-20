import { useState, useEffect } from 'react'
import {
  Grid, Card, CardContent, Typography, Box, CircularProgress,
} from '@mui/material'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import axios from 'axios'

interface Stats {
  total_jobs: number
  active_jobs: number
  completed_jobs: number
  failed_jobs: number
  total_repositories: number
  total_snapshots: number
  storage_used_bytes: number
  storage_free_bytes: number
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    axios.get('/api/v1/dashboard/stats').then((r) => setStats(r.data)).catch(() => {})
  }, [])

  const chartData = [
    { name: 'Jobs', Total: stats?.total_jobs ?? 0, Active: stats?.active_jobs ?? 0 },
    { name: 'Snapshots', Value: stats?.total_snapshots ?? 0 },
  ]

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Dashboard</Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>Total Jobs</Typography>
              <Typography variant="h3">{stats?.total_jobs ?? <CircularProgress size={20} />}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>Active Jobs</Typography>
              <Typography variant="h3" color="primary">{stats?.active_jobs ?? 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>Repositories</Typography>
              <Typography variant="h3">{stats?.total_repositories ?? 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <Card>
            <CardContent>
              <Typography color="text.secondary" gutterBottom>Snapshots</Typography>
              <Typography variant="h3">{stats?.total_snapshots ?? 0}</Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Overview</Typography>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="Total" fill="#00bcd4" />
                  <Bar dataKey="Active" fill="#ff5722" />
                  <Bar dataKey="Value" fill="#00bcd4" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
