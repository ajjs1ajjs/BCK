import { useState, useEffect } from 'react'
import {
  Box, Typography, Card, CardContent, Table, TableHead, TableBody,
  TableRow, TableCell, Button, Chip, CircularProgress,
} from '@mui/material'
import axios from 'axios'

interface Job {
  id: string
  name: string
  status: string
  progress: number
  started_at: number | null
  finished_at: number | null
}

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    axios.get('/api/v1/jobs').then((r) => setJobs(r.data)).catch(() => {})
  }, [])

  const runJob = (id: string) => {
    axios.post(`/api/v1/jobs/${id}/run`).then(() => {
      axios.get('/api/v1/jobs').then((r) => setJobs(r.data))
    })
  }

  const statusColor = (s: string) => {
    if (s.includes('running')) return 'info'
    if (s.includes('completed')) return 'success'
    if (s.includes('failed')) return 'error'
    return 'default'
  }

  return (
    <Box>
      <Typography variant="h4" gutterBottom>Backup Jobs</Typography>
      <Card>
        <CardContent>
          {jobs.length === 0 ? (
            <Typography color="text.secondary">No jobs yet. Create one via CLI.</Typography>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Progress</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>{job.name}</TableCell>
                    <TableCell>
                      <Chip label={job.status} color={statusColor(job.status) as any} size="small" />
                    </TableCell>
                    <TableCell>{job.progress.toFixed(1)}%</TableCell>
                    <TableCell>
                      <Button size="small" variant="contained" onClick={() => runJob(job.id)}>
                        Run
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
