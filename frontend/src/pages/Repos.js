import { Box, Typography, Card, CardContent } from '@mui/material';
import { Storage as StorageIcon } from '@mui/icons-material';

export default function Repos() {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 0.5 }}>Repositories</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Backup storage repositories
      </Typography>
      <Card>
        <CardContent sx={{ py: 8, textAlign: 'center' }}>
          <StorageIcon sx={{ fontSize: 64, color: 'text.secondary', opacity: 0.2, mb: 2 }} />
          <Typography variant="h6" color="text.secondary">Repository Management</Typography>
          <Typography variant="body2" color="text.secondary">Coming soon — configure backup destinations</Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
