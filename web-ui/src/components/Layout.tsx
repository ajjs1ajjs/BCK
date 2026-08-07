import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  Box, Drawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
  AppBar, Toolbar, Typography, IconButton, Avatar, Menu, MenuItem, Divider, Badge, Tooltip,
} from '@mui/material'
import DashboardIcon from '@mui/icons-material/Dashboard'
import BackupIcon from '@mui/icons-material/Backup'
import RestoreIcon from '@mui/icons-material/Restore'
import StorageIcon from '@mui/icons-material/Storage'
import AdminIcon from '@mui/icons-material/AdminPanelSettings'
import MenuIcon from '@mui/icons-material/Menu'
import LogoutIcon from '@mui/icons-material/Logout'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import LayersIcon from '@mui/icons-material/Layers'
import CloudIcon from '@mui/icons-material/Cloud'
import EmailIcon from '@mui/icons-material/Email'
import AlbumIcon from '@mui/icons-material/Album'
import PublicIcon from '@mui/icons-material/Public'
import GroupsIcon from '@mui/icons-material/Groups'
import HailIcon from '@mui/icons-material/Hail'
import { getUser, clearAuth } from '../api/client'

const drawerWidth = 248

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { path: '/jobs', label: 'Backup Jobs', icon: <BackupIcon /> },
  { path: '/repositories', label: 'Repositories', icon: <StorageIcon /> },
  { path: '/snapshots', label: 'Snapshots', icon: <CloudDoneIcon /> },
  { path: '/restore', label: 'Restore', icon: <RestoreIcon /> },
  { path: '/sobr', label: 'SOBR', icon: <LayersIcon /> },
  { path: '/cloud', label: 'Cloud', icon: <CloudIcon /> },
  { path: '/m365', label: 'Microsoft 365', icon: <EmailIcon /> },
  { path: '/tape', label: 'Tape Library', icon: <AlbumIcon /> },
  { path: '/dr', label: 'Disaster Recovery', icon: <PublicIcon /> },
  { path: '/tenants', label: 'Tenants', icon: <GroupsIcon /> },
  { path: '/portal', label: 'Self-service', icon: <HailIcon /> },
  { path: '/admin', label: 'Administration', icon: <AdminIcon /> },
]

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userMenu, setUserMenu] = useState<null | HTMLElement>(null)
  const user = getUser()

  const onLogout = () => {
    clearAuth()
    navigate('/login', { replace: true })
  }

  const content = (
    <>
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box
          sx={{
            width: 38, height: 38, borderRadius: 1.5, flexShrink: 0,
            background: 'linear-gradient(135deg, #1E88E5 0%, #00ACC1 100%)',
            display: 'grid', placeItems: 'center', color: '#fff',
          }}
        >
          <BackupIcon fontSize="small" />
        </Box>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
            BCK Enterprise
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
            Backup & Recovery
          </Typography>
        </Box>
      </Box>
      <Divider />
      <List sx={{ pt: 1 }}>
        {navItems.map((item) => (
          <ListItem key={item.path} disablePadding>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => { navigate(item.path); setMobileOpen(false) }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} primaryTypographyProps={{ fontSize: 13.5 }} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      <Box sx={{ flexGrow: 1 }} />
      <Box sx={{ p: 2 }}>
        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: '#F7F9FC', border: '1px solid #E2E8F0' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#43A047' }} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>System Operational</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            Agent: connected · All systems nominal
          </Typography>
        </Box>
      </Box>
    </>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        elevation={0}
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, bgcolor: '#FFFFFF', color: '#1A2332', borderBottom: '1px solid #E2E8F0' }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <IconButton
            edge="start"
            sx={{ display: { md: 'none' }, mr: 1 }}
            onClick={() => setMobileOpen(true)}
          >
            <MenuIcon />
          </IconButton>
          <Typography variant="subtitle2" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
            {navItems.find((i) => i.path === location.pathname)?.label ?? 'Console'}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Tooltip title="Backup service is running">
            <Badge color="success" variant="dot" overlap="circular" sx={{ '& .MuiBadge-dot': { boxShadow: '0 0 0 2px #fff' } }}>
              <Avatar sx={{ width: 34, height: 34, bgcolor: '#E8EEF5', color: '#1E88E5' }}>
                <BackupIcon fontSize="small" />
              </Avatar>
            </Badge>
          </Tooltip>
          <Box
            onClick={(e) => setUserMenu(e.currentTarget)}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', px: 1, py: 0.5, borderRadius: 2, '&:hover': { bgcolor: '#F1F5F9' } }}
          >
            <Avatar sx={{ width: 30, height: 30, bgcolor: '#1E88E5', fontSize: 14 }}>
              {(user?.username || 'A').slice(0, 1).toUpperCase()}
            </Avatar>
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.1 }}>{user?.username}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5, textTransform: 'capitalize' }}>
                {user?.role ?? 'operator'}
              </Typography>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}
        >
          {content}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{ display: { xs: 'none', md: 'block' }, width: drawerWidth, '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' } }}
          open
        >
          {content}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, width: { md: `calc(100% - ${drawerWidth}px)` }, p: 3, bgcolor: '#F0F3F7' }}>
        <Toolbar />
        <Outlet />
      </Box>

      <Menu
        anchorEl={userMenu}
        open={Boolean(userMenu)}
        onClose={() => setUserMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{user?.username}</Typography>
          <Typography variant="caption" color="text.secondary">{user?.role}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={onLogout}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Sign out</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  )
}
