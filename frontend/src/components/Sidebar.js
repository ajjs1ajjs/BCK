import { useNavigate, useLocation } from 'react-router-dom';
import {
  Drawer, Box, Typography, List, ListItemButton, ListItemIcon, ListItemText, Divider, Collapse,
} from '@mui/material';
import {
  Dashboard as DashboardIcon, Backup as BackupIcon, Schedule as ScheduleIcon,
  Assignment as LogIcon, Settings as SettingsIcon,
  Restore as RestoreIcon, Storage as DatabaseIcon, Computer as ComputerIcon,
  Cloud as CloudIcon, Policy as PolicyIcon, History as HistoryIcon,
  ExpandMore as ExpandIcon, ExpandLess as CollapseIcon,
  People as PeopleIcon, Security as SecurityIcon,
} from '@mui/icons-material';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const [backupOpen, setBackupOpen] = useState(
    ['/backups', '/db-backups', '/vm-backups', '/cloud-backups', '/restore'].includes(location.pathname)
  );

  const isActive = (path) => location.pathname === path;
  const backupPaths = ['/backups', '/db-backups', '/vm-backups', '/cloud-backups', '/restore'];
  const isBackupActive = backupPaths.includes(location.pathname);

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: 240,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 240,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          height: '100vh',
          position: 'fixed',
          zIndex: 1200,
        },
      }}
    >
      <Box sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{
          width: 36, height: 36, borderRadius: 2,
          background: 'linear-gradient(135deg, #6366f1, #818cf8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, fontWeight: 700, color: '#fff',
        }}>
          B
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>BCK</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
            Backup Solution
          </Typography>
        </Box>
      </Box>
      <Divider />

      <Box sx={{ overflow: 'auto', flex: 1 }}>
        <List sx={{ px: 1, pt: 1, pb: 2 }}>
          <ListItemButton onClick={() => navigate('/')} selected={isActive('/')}
            sx={{ borderRadius: 2, mb: 0.5, px: 1.5, py: 1.2,
              '&.Mui-selected': { bgcolor: 'rgba(99,102,241,0.12)' } }}>
            <ListItemIcon sx={{ minWidth: 38, color: isActive('/') ? 'primary.main' : 'text.secondary' }}>
              <DashboardIcon />
            </ListItemIcon>
            <ListItemText primary="Dashboard" primaryTypographyProps={{ fontSize: 14, fontWeight: isActive('/') ? 600 : 400, color: isActive('/') ? 'primary.main' : 'text.secondary' }} />
          </ListItemButton>

          <ListItemButton onClick={() => setBackupOpen(!backupOpen)}
            sx={{ borderRadius: 2, mb: 0.5, px: 1.5, py: 1.2 }}>
            <ListItemIcon sx={{ minWidth: 38, color: isBackupActive ? 'primary.main' : 'text.secondary' }}>
              <BackupIcon />
            </ListItemIcon>
            <ListItemText primary="Backups" primaryTypographyProps={{ fontSize: 14, fontWeight: isBackupActive ? 600 : 400, color: isBackupActive ? 'primary.main' : 'text.secondary' }} />
            {backupOpen ? <CollapseIcon fontSize="small" /> : <ExpandIcon fontSize="small" />}
          </ListItemButton>

          <Collapse in={backupOpen}>
            <List disablePadding sx={{ pl: 1 }}>
              {[
                { label: 'All Backups', icon: <BackupIcon />, path: '/backups' },
                { label: 'Databases', icon: <DatabaseIcon />, path: '/db-backups' },
                { label: 'VMs', icon: <ComputerIcon />, path: '/vm-backups' },
                { label: 'Cloud', icon: <CloudIcon />, path: '/cloud-backups' },
                { label: 'Restore', icon: <RestoreIcon />, path: '/restore', need: 'restore' },
              ].filter(item => item.need ? can(item.need) : true).map((item) => (
                <ListItemButton key={item.path} onClick={() => navigate(item.path)} selected={isActive(item.path)}
                  sx={{ borderRadius: 2, mb: 0.3, px: 1.5, py: 0.8, ml: 1.5, '&.Mui-selected': { bgcolor: 'rgba(99,102,241,0.12)' } }}>
                  <ListItemIcon sx={{ minWidth: 32, color: isActive(item.path) ? 'primary.main' : 'text.secondary' }}>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13, fontWeight: isActive(item.path) ? 600 : 400, color: isActive(item.path) ? 'primary.main' : 'text.secondary' }} />
                </ListItemButton>
              ))}
            </List>
          </Collapse>

          {can('manageSchedules') && (
            <ListItemButton onClick={() => navigate('/schedules')} selected={isActive('/schedules')}
              sx={{ borderRadius: 2, mb: 0.5, px: 1.5, py: 1.2, '&.Mui-selected': { bgcolor: 'rgba(99,102,241,0.12)' } }}>
              <ListItemIcon sx={{ minWidth: 38, color: isActive('/schedules') ? 'primary.main' : 'text.secondary' }}><ScheduleIcon /></ListItemIcon>
              <ListItemText primary="Schedules" primaryTypographyProps={{ fontSize: 14, fontWeight: isActive('/schedules') ? 600 : 400, color: isActive('/schedules') ? 'primary.main' : 'text.secondary' }} />
            </ListItemButton>
          )}

          {can('manageUsers') && (
            <ListItemButton onClick={() => navigate('/users')} selected={isActive('/users')}
              sx={{ borderRadius: 2, mb: 0.5, px: 1.5, py: 1.2, '&.Mui-selected': { bgcolor: 'rgba(99,102,241,0.12)' } }}>
              <ListItemIcon sx={{ minWidth: 38, color: isActive('/users') ? 'primary.main' : 'text.secondary' }}><PeopleIcon /></ListItemIcon>
              <ListItemText primary="Users" primaryTypographyProps={{ fontSize: 14, fontWeight: isActive('/users') ? 600 : 400, color: isActive('/users') ? 'primary.main' : 'text.secondary' }} />
            </ListItemButton>
          )}

          {can('manageRoles') && (
            <ListItemButton onClick={() => navigate('/roles')} selected={isActive('/roles')}
              sx={{ borderRadius: 2, mb: 0.5, px: 1.5, py: 1.2, '&.Mui-selected': { bgcolor: 'rgba(99,102,241,0.12)' } }}>
              <ListItemIcon sx={{ minWidth: 38, color: isActive('/roles') ? 'primary.main' : 'text.secondary' }}><SecurityIcon /></ListItemIcon>
              <ListItemText primary="Roles" primaryTypographyProps={{ fontSize: 14, fontWeight: isActive('/roles') ? 600 : 400, color: isActive('/roles') ? 'primary.main' : 'text.secondary' }} />
            </ListItemButton>
          )}

          <ListItemButton onClick={() => navigate('/policies')} selected={isActive('/policies')}
            sx={{ borderRadius: 2, mb: 0.5, px: 1.5, py: 1.2, '&.Mui-selected': { bgcolor: 'rgba(99,102,241,0.12)' } }}>
            <ListItemIcon sx={{ minWidth: 38, color: isActive('/policies') ? 'primary.main' : 'text.secondary' }}><PolicyIcon /></ListItemIcon>
            <ListItemText primary="Policies" primaryTypographyProps={{ fontSize: 14, fontWeight: isActive('/policies') ? 600 : 400, color: isActive('/policies') ? 'primary.main' : 'text.secondary' }} />
          </ListItemButton>

          <ListItemButton onClick={() => navigate('/history')} selected={isActive('/history')}
            sx={{ borderRadius: 2, mb: 0.5, px: 1.5, py: 1.2, '&.Mui-selected': { bgcolor: 'rgba(99,102,241,0.12)' } }}>
            <ListItemIcon sx={{ minWidth: 38, color: isActive('/history') ? 'primary.main' : 'text.secondary' }}><HistoryIcon /></ListItemIcon>
            <ListItemText primary="Job History" primaryTypographyProps={{ fontSize: 14, fontWeight: isActive('/history') ? 600 : 400, color: isActive('/history') ? 'primary.main' : 'text.secondary' }} />
          </ListItemButton>

          <ListItemButton onClick={() => navigate('/logs')} selected={isActive('/logs')}
            sx={{ borderRadius: 2, mb: 0.5, px: 1.5, py: 1.2, '&.Mui-selected': { bgcolor: 'rgba(99,102,241,0.12)' } }}>
            <ListItemIcon sx={{ minWidth: 38, color: isActive('/logs') ? 'primary.main' : 'text.secondary' }}><LogIcon /></ListItemIcon>
            <ListItemText primary="Activity Log" primaryTypographyProps={{ fontSize: 14, fontWeight: isActive('/logs') ? 600 : 400, color: isActive('/logs') ? 'primary.main' : 'text.secondary' }} />
          </ListItemButton>

          {can('configure') && (
            <ListItemButton onClick={() => navigate('/settings')} selected={isActive('/settings')}
              sx={{ borderRadius: 2, mb: 0.5, px: 1.5, py: 1.2, '&.Mui-selected': { bgcolor: 'rgba(99,102,241,0.12)' } }}>
              <ListItemIcon sx={{ minWidth: 38, color: isActive('/settings') ? 'primary.main' : 'text.secondary' }}><SettingsIcon /></ListItemIcon>
              <ListItemText primary="Settings" primaryTypographyProps={{ fontSize: 14, fontWeight: isActive('/settings') ? 600 : 400, color: isActive('/settings') ? 'primary.main' : 'text.secondary' }} />
            </ListItemButton>
          )}
        </List>
      </Box>
    </Drawer>
  );
}
