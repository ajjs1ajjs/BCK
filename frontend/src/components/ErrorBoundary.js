import { Component } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import { Error as ErrorIcon, Refresh as RefreshIcon } from '@mui/icons-material';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[BCK ErrorBoundary]', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          bgcolor: 'background.default',
          p: 3,
        }}
      >
        <Paper
          elevation={0}
          sx={{
            p: 5,
            maxWidth: 480,
            textAlign: 'center',
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'error.main',
            bgcolor: 'background.paper',
          }}
        >
          <ErrorIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
          <Typography variant="h5" fontWeight={700} gutterBottom>
            Something went wrong
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            An unexpected error occurred in the interface.
          </Typography>
          {this.state.error && (
            <Typography
              variant="caption"
              component="pre"
              sx={{
                display: 'block',
                mb: 3,
                p: 1.5,
                bgcolor: 'action.hover',
                borderRadius: 1,
                textAlign: 'left',
                overflow: 'auto',
                fontSize: 11,
                color: 'error.light',
              }}
            >
              {this.state.error.message}
            </Typography>
          )}
          <Button
            variant="contained"
            startIcon={<RefreshIcon />}
            onClick={() => window.location.reload()}
            sx={{ mr: 1 }}
          >
            Reload page
          </Button>
          <Button
            variant="outlined"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </Button>
        </Paper>
      </Box>
    );
  }
}
