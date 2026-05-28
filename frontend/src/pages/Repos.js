import { Box, Typography, Card, CardContent } from '@mui/material';
import { Storage as StorageIcon } from '@mui/icons-material';
import { useTranslation } from '../context/LangContext';

export default function Repos() {
  const { t } = useTranslation();

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 0.5 }}>{t('repositories')}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('reposSubtitle')}
      </Typography>
      <Card>
        <CardContent sx={{ py: 8, textAlign: 'center' }}>
          <StorageIcon sx={{ fontSize: 64, color: 'text.secondary', opacity: 0.2, mb: 2 }} />
          <Typography variant="h6" color="text.secondary">{t('repoManagement')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('comingSoonRepos')}</Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
