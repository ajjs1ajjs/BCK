import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, IconButton, Tooltip, Avatar, Menu, MenuItem, Divider, ListItemIcon,
} from '@mui/material';
import {
  DarkMode as DarkModeIcon, LightMode as LightModeIcon,
  Logout as LogoutIcon, Person as PersonIcon, Shield as ShieldIcon,
} from '@mui/icons-material';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

const ROLE_COLORS = { admin: '#ef4444', operator: '#f59e0b', viewer: '#6366f1' };

export default function TopBar({ isDark, toggleTheme }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(null);

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      px: 3, py: 1.5, borderBottom: '1px solid', borderColor: 'divider',
      bgcolor: 'background.paper', minHeight: 56,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{
          width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main',
          boxShadow: '0 0 8px rgba(34,197,94,0.4)',
        }} />
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
          All systems operational
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Tooltip title={isDark ? 'Light mode' : 'Dark mode'}>
          <IconButton size="small" onClick={toggleTheme} sx={{ color: 'text.secondary' }}>
            {isDark ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Tooltip>

        <Tooltip title="User menu">
          <Box
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', px: 1, py: 0.5, borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: ROLE_COLORS[user?.role] || '#6366f1' }}>
              {(user?.username || 'U')[0].toUpperCase()}
            </Avatar>
            <Box sx={{ lineHeight: 1.2 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>{user?.username || 'User'}</Typography>
              <Typography variant="caption" sx={{ color: ROLE_COLORS[user?.role] || '#6366f1', fontSize: 11, textTransform: 'capitalize' }}>
                {user?.role || 'viewer'}
              </Typography>
            </Box>
          </Box>
        </Tooltip>

        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} PaperProps={{ sx: { minWidth: 180, mt: 0.5 } }}>
          <MenuItem disabled>
            <ListItemIcon><PersonIcon fontSize="small" /></ListItemIcon>
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{user?.username}</Typography>
              <Typography variant="caption" color="text.secondary">{user?.role}</Typography>
            </Box>
          </MenuItem>
          <Divider />
          <MenuItem onClick={() => { setAnchor(null); navigate('/settings'); }}>
            <ListItemIcon><ShieldIcon fontSize="small" /></ListItemIcon> Settings
          </MenuItem>
          <MenuItem onClick={() => { setAnchor(null); logout(); }}>
            <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon> Logout
          </MenuItem>
        </Menu>
      </Box>
    </Box>
  );
}
