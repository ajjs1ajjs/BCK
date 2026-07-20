import { Box, Typography, Card, CardContent } from '@mui/material'

export default function Admin() {
  return (
    <Box>
      <Typography variant="h4" gutterBottom>Administration</Typography>
      <Card>
        <CardContent>
          <Typography color="text.secondary">
            User management and settings will be available in a future update.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  )
}
