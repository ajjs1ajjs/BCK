import { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Button, Chip, List, ListItem,
  Avatar,   TextField, MenuItem, InputAdornment,
} from '@mui/material';
import {
  Refresh as RefreshIcon, Search as SearchIcon,
  FilterList as FilterIcon,
} from '@mui/icons-material';

const API = process.env.REACT_APP_API_URL || '';

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    fetch(`${API}/api/logs`).then(r => r.json()).then(setLogs).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = logs.filter((log) => {
    if (filter !== 'all' && log.status !== filter) return false;
    if (search && !log.message?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const getColor = (status) => {
    switch (status) {
      case 'error': return 'error';
      case 'warning': return 'warning';
      case 'success': return 'success';
      default: return 'info';
    }
  };

  const getIcon = (status) => {
    switch (status) {
      case 'error': return '!';
      case 'warning': return '?';
      case 'success': return '\u2713';
      default: return 'i';
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">Activity Log</Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        System events and backup activity — {logs.length} entries
      </Typography>

      <Card>
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <TextField
              select size="small" value={filter}
              onChange={(e) => setFilter(e.target.value)}
              sx={{ minWidth: 130 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><FilterIcon fontSize="small" /></InputAdornment> }}
            >
              <MenuItem value="all">All levels</MenuItem>
              <MenuItem value="info">Info</MenuItem>
              <MenuItem value="success">Success</MenuItem>
              <MenuItem value="warning">Warning</MenuItem>
              <MenuItem value="error">Error</MenuItem>
            </TextField>
            <TextField
              size="small" placeholder="Search log messages..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: 1, maxWidth: 320 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            />
          </Box>

          {filtered.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography color="text.secondary">No log entries found</Typography>
            </Box>
          ) : (
            <List disablePadding>
              {filtered.map((log) => (
                <ListItem
                  key={log.id}
                  sx={{
                    px: 0, py: 1.2, borderBottom: '1px solid', borderColor: 'divider',
                    '&:last-child': { borderBottom: 'none' },
                  }}
                >
                  <Avatar sx={{
                    width: 32, height: 32, fontSize: 13, mr: 1.5,
                    bgcolor: `${getColor(log.status)}.main`,
                    color: '#fff',
                  }}>
                    {getIcon(log.status)}
                  </Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{log.message}</Typography>
                    <Typography variant="caption">
                      {(log.timestamp || '').slice(0, 19).replace('T', ' ')}
                    </Typography>
                  </Box>
                  <Chip label={log.status} size="small" color={getColor(log.status)} variant="outlined" sx={{ ml: 1, textTransform: 'capitalize' }} />
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
