import { Box, Card, CardContent, Typography, Stack } from '@mui/material'
import { ReactNode } from 'react'

interface Props {
  title: string
  value: ReactNode
  subtitle?: string
  icon?: ReactNode
  accent?: string
  trend?: string
}

export default function StatCard({ title, value, subtitle, icon, accent = '#1E88E5', trend }: Props) {
  return (
    <Card sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, bgcolor: accent }} />
      <CardContent sx={{ pl: 2.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.75, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>
              {title}
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
              {value}
            </Typography>
            {(subtitle || trend) && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
                {trend || subtitle}
              </Typography>
            )}
          </Box>
          {icon && (
            <Box sx={{ width: 44, height: 44, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: accent + '18', color: accent }}>
              {icon}
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}
