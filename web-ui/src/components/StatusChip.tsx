import { Chip } from '@mui/material'
import { prettyStatus, statusTone } from '../utils'

export default function StatusChip({ status, size = 'small' as const }: { status: string; size?: 'small' | 'medium' }) {
  const tone = statusTone(status)
  return (
    <Chip
      label={prettyStatus(status)}
      color={tone === 'default' ? undefined : tone}
      size={size}
      variant={tone === 'default' ? 'outlined' : 'filled'}
      sx={{ minWidth: 88 }}
    />
  )
}
