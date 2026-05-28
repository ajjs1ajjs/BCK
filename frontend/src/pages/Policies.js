import { useState } from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip, IconButton, Tooltip, MenuItem, Snackbar, Alert,
  Switch,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon, Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../context/LangContext';

const DEFAULT_POLICIES = [
  { id: '1', name: 'Daily Backup', description: 'Daily full backup with 7-day retention', type: 'full', retentionDays: 7, retentionCopies: 7, schedule: '0 2 * * *', enabled: true, targets: ['mysql', 'postgres'] },
  { id: '2', name: 'Weekly Archive', description: 'Weekly archive with 30-day retention', type: 'full', retentionDays: 30, retentionCopies: 4, schedule: '0 3 * * 0', enabled: true, targets: ['mysql', 'postgres', 'vmware'] },
  { id: '3', name: 'Monthly Compliance', description: 'Monthly backup for compliance (90 days)', type: 'full', retentionDays: 90, retentionCopies: 12, schedule: '0 4 1 * *', enabled: false, targets: ['all'] },
  { id: '4', name: 'Incremental Every 6h', description: 'Incremental backup every 6 hours', type: 'incremental', retentionDays: 3, retentionCopies: 12, schedule: '0 */6 * * *', enabled: false, targets: ['mysql'] },
];

const POLICY_SCHEDULES = [
  {
    value: '0 2 * * *',
    label: { en: 'Every day at 02:00', uk: 'Щодня о 02:00' },
    helper: { en: 'Best for nightly backups.', uk: 'Зручно для нічних копій.' },
  },
  {
    value: '0 3 * * 0',
    label: { en: 'Every Sunday at 03:00', uk: 'Щонеділі о 03:00' },
    helper: { en: 'Best for weekly archives.', uk: 'Зручно для тижневих архівів.' },
  },
  {
    value: '0 4 1 * *',
    label: { en: 'On the 1st day monthly at 04:00', uk: '1-го числа щомісяця о 04:00' },
    helper: { en: 'Best for monthly retention policies.', uk: 'Зручно для місячного зберігання.' },
  },
  {
    value: '0 */6 * * *',
    label: { en: 'Every 6 hours', uk: 'Кожні 6 годин' },
    helper: { en: 'Best for frequent incremental backups.', uk: 'Зручно для частих інкрементальних копій.' },
  },
  {
    value: '0 */4 * * *',
    label: { en: 'Every 4 hours', uk: 'Кожні 4 години' },
    helper: { en: 'For systems with frequent changes.', uk: 'Для систем із частими змінами.' },
  },
  {
    value: '0 */12 * * *',
    label: { en: 'Every 12 hours', uk: 'Кожні 12 годин' },
    helper: { en: 'Balanced daytime and nighttime coverage.', uk: 'Збалансований запуск вдень і вночі.' },
  },
  {
    value: '0 2 * * 1-5',
    label: { en: 'Weekdays at 02:00', uk: 'У будні о 02:00' },
    helper: { en: 'Runs Monday through Friday.', uk: 'Запускається з понеділка по пʼятницю.' },
  },
  {
    value: '0 1 * * 6,0',
    label: { en: 'Weekend at 01:00', uk: 'На вихідних о 01:00' },
    helper: { en: 'Runs on Saturday and Sunday.', uk: 'Запускається в суботу та неділю.' },
  },
  {
    value: '30 23 * * *',
    label: { en: 'Every day at 23:30', uk: 'Щодня о 23:30' },
    helper: { en: 'Useful before nightly maintenance windows.', uk: 'Зручно перед нічним технічним вікном.' },
  },
];

const getPolicySchedule = (schedule) => (
  POLICY_SCHEDULES.find(option => option.value === schedule)
);

const DEFAULT_CUSTOM_DAYS = ['1', '2', '3', '4', '5'];

const expandCronDays = (value) => {
  if (!value || value === '*') return ['0', '1', '2', '3', '4', '5', '6'];
  if (value === '1-5') return ['1', '2', '3', '4', '5'];
  return value.split(',').filter(day => ['0', '1', '2', '3', '4', '5', '6'].includes(day));
};

const parsePolicySchedule = (schedule) => {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = (schedule || '').trim().split(/\s+/);
  if (!minute || !hour || dayOfMonth !== '*' || month !== '*' || hour.includes('/')) {
    return { days: DEFAULT_CUSTOM_DAYS, time: '02:00' };
  }
  const normalizedHour = String(parseInt(hour, 10)).padStart(2, '0');
  const normalizedMinute = String(parseInt(minute, 10)).padStart(2, '0');
  return {
    days: expandCronDays(dayOfWeek),
    time: `${normalizedHour}:${normalizedMinute}`,
  };
};

const buildCustomSchedule = (days, time) => {
  const selectedDays = days.length ? days : DEFAULT_CUSTOM_DAYS;
  const [hour = '02', minute = '00'] = time.split(':');
  const dayPart = selectedDays.length === 7 ? '*' : selectedDays.join(',');
  return `${parseInt(minute, 10)} ${parseInt(hour, 10)} * * ${dayPart}`;
};

export default function Policies() {
  const [policies, setPolicies] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bck-policies')) || DEFAULT_POLICIES; }
    catch { return DEFAULT_POLICIES; }
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', type: 'full', retentionDays: 30, retentionCopies: 10, schedule: '0 2 * * *', targets: [] });
  const [customDays, setCustomDays] = useState(DEFAULT_CUSTOM_DAYS);
  const [customTime, setCustomTime] = useState('02:00');
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { can } = useAuth();
  const { t, lang } = useTranslation();
  const isUk = lang === 'uk';
  const dayLabels = [
    { value: '1', label: isUk ? 'Пн' : 'Mon' },
    { value: '2', label: isUk ? 'Вт' : 'Tue' },
    { value: '3', label: isUk ? 'Ср' : 'Wed' },
    { value: '4', label: isUk ? 'Чт' : 'Thu' },
    { value: '5', label: isUk ? 'Пт' : 'Fri' },
    { value: '6', label: isUk ? 'Сб' : 'Sat' },
    { value: '0', label: isUk ? 'Нд' : 'Sun' },
  ];
  const scheduleOptionValue = getPolicySchedule(form.schedule)?.value || 'custom';
  const scheduleLabel = (schedule) => {
    const option = getPolicySchedule(schedule);
    if (option) return option.label[isUk ? 'uk' : 'en'];
    const parsed = parsePolicySchedule(schedule);
    const allDays = parsed.days.length === 7;
    const selectedLabels = dayLabels
      .filter(day => parsed.days.includes(day.value))
      .map(day => day.label)
      .join(', ');
    if (allDays) return isUk ? `Щодня о ${parsed.time}` : `Every day at ${parsed.time}`;
    return isUk ? `${selectedLabels} о ${parsed.time}` : `${selectedLabels} at ${parsed.time}`;
  };
  const scheduleHelper = (schedule) => {
    const option = getPolicySchedule(schedule);
    if (option) return option.helper[isUk ? 'uk' : 'en'];
    return isUk ? 'Оберіть дні тижня та час запуску.' : 'Choose weekdays and run time.';
  };

  const persist = (items) => {
    localStorage.setItem('bck-policies', JSON.stringify(items));
    setPolicies(items);
  };

  const openCreate = () => {
    setEditing(null);
    setCustomDays(DEFAULT_CUSTOM_DAYS);
    setCustomTime('02:00');
    setForm({ name: '', description: '', type: 'full', retentionDays: 30, retentionCopies: 10, schedule: '0 2 * * *', targets: [] });
    setDialogOpen(true);
  };
  const openEdit = (p) => {
    setEditing(p);
    const parsed = parsePolicySchedule(p.schedule);
    setCustomDays(parsed.days);
    setCustomTime(parsed.time);
    setForm({ name: p.name, description: p.description, type: p.type, retentionDays: p.retentionDays, retentionCopies: p.retentionCopies, schedule: p.schedule, targets: p.targets });
    setDialogOpen(true);
  };

  const save = () => {
    if (!form.name) { setSnack({ open: true, msg: t('nameRequired'), severity: 'warning' }); return; }
    const item = { ...form, id: editing?.id || Date.now().toString(), enabled: editing?.enabled ?? true };
    if (editing) {
      persist(policies.map(p => p.id === editing.id ? item : p));
    } else {
      persist([...policies, item]);
    }
    setDialogOpen(false);
    setSnack({ open: true, msg: editing ? t('policyUpdated') : t('policyCreated'), severity: 'success' });
  };

  const remove = (id) => {
    persist(policies.filter(p => p.id !== id));
    setSnack({ open: true, msg: t('policyDeleted'), severity: 'success' });
  };

  const toggle = (id) => {
    persist(policies.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p));
  };

  const applyToBackups = (policy) => {
    setSnack({ open: true, msg: t('policyApplied', { name: policy.name }), severity: 'info' });
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">{t('policiesTitle')}</Typography>
        {can('manageBackups') && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>{t('newPolicy')}</Button>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('policiesSubtitle')}
      </Typography>

      <Card>
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />}>{t('refresh')}</Button>
          </Box>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>{t('policy')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('type')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('retention')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('schedule')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('targets')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{t('enabledCol')}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">{t('actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600, fontSize: 14 }}>{p.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{p.description}</Typography>
                    </TableCell>
                    <TableCell><Chip label={p.type} size="small" color={p.type === 'full' ? 'primary' : 'secondary'} variant="outlined" /></TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{p.retentionDays}d / {p.retentionCopies} copies</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }}>{scheduleLabel(p.schedule)}</Typography>
                    </TableCell>
                    <TableCell>
                      {p.targets?.map(t => <Chip key={t} label={t} size="small" variant="outlined" sx={{ mr: 0.3, mb: 0.3 }} />)}
                    </TableCell>
                    <TableCell>
                      <Switch size="small" checked={p.enabled} onChange={() => toggle(p.id)}
                        disabled={!can('manageBackups')} />
                    </TableCell>
                    <TableCell align="right">
                      {can('manageBackups') && (
                        <>
                          <Tooltip title={t('apply')}><IconButton size="small" onClick={() => applyToBackups(p)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title={t('edit')}><IconButton size="small" onClick={() => openEdit(p)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                          <Tooltip title={t('delete')}><IconButton size="small" onClick={() => remove(p.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? t('editPolicy') : t('newPolicyTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <TextField label={t('policyName')} fullWidth value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} />
            <TextField label={t('description')} fullWidth multiline rows={2} value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} />
            <TextField select label={t('backupType')} fullWidth value={form.type} onChange={(e) => setForm({...form, type: e.target.value})}>
              <MenuItem value="full">Full</MenuItem>
              <MenuItem value="incremental">Incremental</MenuItem>
              <MenuItem value="differential">Differential</MenuItem>
            </TextField>
            <TextField label={t('retentionDays')} type="number" fullWidth value={form.retentionDays} onChange={(e) => setForm({...form, retentionDays: parseInt(e.target.value)})} />
            <TextField label={t('minCopiesToKeep')} type="number" fullWidth value={form.retentionCopies} onChange={(e) => setForm({...form, retentionCopies: parseInt(e.target.value)})} />
            <TextField
              select
              label={isUk ? 'Коли запускати' : 'When to run'}
              fullWidth
              value={scheduleOptionValue}
              helperText={scheduleHelper(form.schedule)}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'custom') {
                  setForm({ ...form, schedule: buildCustomSchedule(customDays, customTime) });
                } else {
                  const parsed = parsePolicySchedule(value);
                  setCustomDays(parsed.days);
                  setCustomTime(parsed.time);
                  setForm({ ...form, schedule: value });
                }
              }}
            >
              {POLICY_SCHEDULES.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label[isUk ? 'uk' : 'en']}
                </MenuItem>
              ))}
              <MenuItem value="custom">{isUk ? 'Власний розклад' : 'Custom schedule'}</MenuItem>
            </TextField>
            {scheduleOptionValue === 'custom' && (
              <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                  {isUk ? 'Власний розклад' : 'Custom schedule'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  {isUk ? 'Оберіть дні, коли має запускатися політика, і точний час.' : 'Choose the days this policy should run and the exact time.'}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                  {dayLabels.map(day => {
                    const selected = customDays.includes(day.value);
                    return (
                      <Chip
                        key={day.value}
                        label={day.label}
                        clickable
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        onClick={() => {
                          if (selected && customDays.length === 1) return;
                          const nextDays = selected
                            ? customDays.filter(value => value !== day.value)
                            : [...customDays, day.value];
                          setCustomDays(nextDays);
                          setForm({ ...form, schedule: buildCustomSchedule(nextDays, customTime) });
                        }}
                      />
                    );
                  })}
                </Box>
                <TextField
                  label={isUk ? 'Час запуску' : 'Run time'}
                  type="time"
                  fullWidth
                  value={customTime}
                  InputLabelProps={{ shrink: true }}
                  onChange={(e) => {
                    const nextTime = e.target.value;
                    setCustomTime(nextTime);
                    setForm({ ...form, schedule: buildCustomSchedule(customDays, nextTime) });
                  }}
                />
              </Box>
            )}
            <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary">
                {isUk ? 'Обрано' : 'Selected'}:
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {scheduleLabel(form.schedule)}
              </Typography>
            </Box>
            <TextField select label={t('targetTypes')} fullWidth SelectProps={{ multiple: true }} value={form.targets} onChange={(e) => setForm({...form, targets: e.target.value})}>
              <MenuItem value="all">All types</MenuItem>
              <MenuItem value="mysql">MySQL</MenuItem>
              <MenuItem value="postgres">PostgreSQL</MenuItem>
              <MenuItem value="oracle">Oracle</MenuItem>
              <MenuItem value="vmware">VMware</MenuItem>
              <MenuItem value="hyperv">Hyper-V</MenuItem>
              <MenuItem value="cloud">Cloud Storage</MenuItem>
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={save}>{editing ? t('save') : t('create')}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
