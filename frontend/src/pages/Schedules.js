import { useState, useEffect, useCallback } from 'react';
import {
  Box, Card, CardContent, Typography, Button, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Switch, List, ListItem, ListItemText,
  Chip, IconButton, Tooltip, Snackbar, Alert, MenuItem,
} from '@mui/material';
import {
  Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon,
  Refresh as RefreshIcon, Schedule as ScheduleIcon,
} from '@mui/icons-material';
import { useTranslation } from '../context/LangContext';

const API = process.env.REACT_APP_API_URL || '';

export default function Schedules() {
  const [schedules, setSchedules] = useState([]);
  const [backups, setBackups] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', cronExpression: '0 0 * * *', backupId: '', enabled: true, notifyOn: 'failure', description: '' });
  const [snack, setSnack] = useState({ open: false, msg: '', severity: 'success' });
  const { t, lang } = useTranslation();

  // Builder states
  const [builderType, setBuilderType] = useState('daily');
  const [builderHourly, setBuilderHourly] = useState('1');
  const [builderMin, setBuilderMin] = useState('0');
  const [builderTime, setBuilderTime] = useState('00:00');
  const [builderDay, setBuilderDay] = useState('0');
  const [builderDate, setBuilderDate] = useState('1');

  const explainCron = (cron) => {
    if (!cron) return '';
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return lang === 'uk' ? 'Складний розклад' : 'Advanced schedule';

    const [min, hour, dom, month, dow] = parts;
    const isUk = lang === 'uk';
    const pad = (n) => String(n).padStart(2, '0');

    const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const daysUk = ['неділю', 'понеділок', 'вівторок', 'середу', 'четвер', 'п\'ятницю', 'суботу'];

    if (min === '0' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return isUk ? 'Щогодини' : 'Every hour';
    }
    if (hour === '*' && dom === '*' && month === '*') {
      return isUk ? `Щогодини на ${min}-й хвилині` : `Every hour at minute ${min}`;
    }
    if (hour.startsWith('*/') && dom === '*' && month === '*') {
      const h = hour.split('/')[1];
      return isUk ? `Кожні ${h} год. на ${min}-й хвилині` : `Every ${h} hours at minute ${min}`;
    }
    if (dom === '*' && month === '*' && dow === '*') {
      return isUk ? `Щодня о ${pad(hour)}:${pad(min)}` : `Daily at ${pad(hour)}:${pad(min)}`;
    }
    if (dom === '*' && month === '*' && dow !== '*') {
      const dayName = isUk ? daysUk[parseInt(dow)] || dow : daysEn[parseInt(dow)] || dow;
      return isUk ? `Щотижня у ${dayName} о ${pad(hour)}:${pad(min)}` : `Weekly on ${dayName} at ${pad(hour)}:${pad(min)}`;
    }
    if (dom !== '*' && month === '*' && dow === '*') {
      return isUk ? `Щомісяця ${dom}-го числа о ${pad(hour)}:${pad(min)}` : `Monthly on day ${dom} at ${pad(hour)}:${pad(min)}`;
    }

    return isUk ? `Користувацький розклад (${cron})` : `Custom schedule (${cron})`;
  };

  const parseCronToForm = (cron) => {
    const parts = (cron || '0 0 * * *').trim().split(/\s+/);
    if (parts.length !== 5) return { type: 'advanced', hourly: '1', min: '0', time: '00:00', day: '0', date: '1' };
    const [min, hour, dom, month, dow] = parts;

    if (hour === '*' && dom === '*' && month === '*') {
      return { type: 'hourly', hourly: '1', min: min, time: '00:00', day: '0', date: '1' };
    }
    if (hour.startsWith('*/') && dom === '*' && month === '*') {
      return { type: 'hourly', hourly: hour.split('/')[1], min: min, time: '00:00', day: '0', date: '1' };
    }
    if (dom === '*' && month === '*' && dow === '*') {
      const h = String(hour).padStart(2, '0');
      const m = String(min).padStart(2, '0');
      return { type: 'daily', hourly: '1', min: '0', time: `${h}:${m}`, day: '0', date: '1' };
    }
    if (dom === '*' && month === '*' && dow !== '*') {
      const h = String(hour).padStart(2, '0');
      const m = String(min).padStart(2, '0');
      return { type: 'weekly', hourly: '1', min: '0', time: `${h}:${m}`, day: dow, date: '1' };
    }
    if (dom !== '*' && month === '*' && dow === '*') {
      const h = String(hour).padStart(2, '0');
      const m = String(min).padStart(2, '0');
      return { type: 'monthly', hourly: '1', min: '0', time: `${h}:${m}`, day: '0', date: dom };
    }

    return { type: 'advanced', hourly: '1', min: '0', time: '00:00', day: '0', date: '1' };
  };

  const updateCronFromBuilder = (type, hourly, minOffset, time, day, date) => {
    let expr = '0 0 * * *';
    const [h, m] = time.split(':');
    const hr = parseInt(h);
    const mn = parseInt(m);

    if (type === 'hourly') {
      if (hourly === '1') {
        expr = `${minOffset} * * * *`;
      } else {
        expr = `${minOffset} */${hourly} * * *`;
      }
    } else if (type === 'daily') {
      expr = `${mn} ${hr} * * *`;
    } else if (type === 'weekly') {
      expr = `${mn} ${hr} * * ${day}`;
    } else if (type === 'monthly') {
      expr = `${mn} ${hr} ${date} * *`;
    } else if (type === 'advanced') {
      return;
    }
    setForm(prev => ({ ...prev, cronExpression: expr }));
  };

  const load = useCallback(() => {
    fetch(`${API}/api/schedules`).then(r => r.json()).then(setSchedules).catch(e => console.error('Load error:', e));
    fetch(`${API}/api/backups`).then(r => r.json()).then(setBackups).catch(e => console.error('Load error:', e));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setBuilderType('daily');
    setBuilderHourly('1');
    setBuilderMin('0');
    setBuilderTime('00:00');
    setBuilderDay('0');
    setBuilderDate('1');
    setForm({ name: '', cronExpression: '0 0 * * *', backupId: '', enabled: true, notifyOn: 'failure', description: '' });
    setDialogOpen(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    const cron = s.cronExpression || s.cron || '0 0 * * *';
    const parsed = parseCronToForm(cron);
    setBuilderType(parsed.type);
    setBuilderHourly(parsed.hourly);
    setBuilderMin(parsed.min);
    setBuilderTime(parsed.time);
    setBuilderDay(parsed.day);
    setBuilderDate(parsed.date);
    setForm({
      name: s.name,
      cronExpression: cron,
      backupId: s.backupId || '',
      enabled: s.enabled !== false,
      notifyOn: s.notifyOn || 'failure',
      description: s.description || ''
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name || !form.cronExpression || !form.backupId) {
      setSnack({ open: true, msg: t('allFieldsRequired'), severity: 'warning' });
      return;
    }
    const method = editing ? 'PUT' : 'POST';
    const url = editing ? `${API}/api/schedules/${editing.id}` : `${API}/api/schedules`;
    try {
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!r.ok) throw new Error();
      setSnack({ open: true, msg: editing ? t('scheduleUpdated') : t('scheduleCreated'), severity: 'success' });
      setDialogOpen(false);
      load();
    } catch {
      setSnack({ open: true, msg: t('failedToSave'), severity: 'error' });
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`${API}/api/schedules/${id}`, { method: 'DELETE' });
      setSnack({ open: true, msg: t('scheduleDeleted'), severity: 'success' });
      load();
    } catch {
      setSnack({ open: true, msg: t('failedToDelete'), severity: 'error' });
    }
  };

  const toggleEnabled = async (s) => {
    const updated = { ...s, enabled: !s.enabled };
    try {
      await fetch(`${API}/api/schedules/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      load();
    } catch { /* ignore */ }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="h4">{t('schedules')}</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          {t('newSchedule')}
        </Button>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('automatedSchedulesCount', { total: schedules.length })}
      </Typography>

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
            <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load}>{t('refresh')}</Button>
          </Box>

          {schedules.length === 0 ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography color="text.secondary">{t('noSchedulesYet')}</Typography>
            </Box>
          ) : (
            <List disablePadding>
              {schedules.map((s) => (
                <ListItem
                  key={s.id}
                  sx={{
                    px: 2, py: 1.5, borderRadius: 1, mb: 0.5,
                    bgcolor: 'action.hover', border: '1px solid', borderColor: 'divider',
                  }}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography sx={{ fontWeight: 600 }}>{s.name}</Typography>
                        <Chip label={s.enabled !== false ? t('activeScheduleLabel') : t('disabledScheduleLabel')} size="small" color={s.enabled !== false ? 'success' : 'default'} />
                      </Box>
                    }
                    secondary={
                      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 13, fontWeight: 500 }}>
                          {explainCron(s.cronExpression || s.cron)} ({s.cronExpression || s.cron})
                        </Typography>
                        {s.backupId && (
                          <Chip label={`Backup: ${backups.find(b => b.id === s.backupId)?.name || s.backupId}`} size="small" variant="outlined" />
                        )}
                        <Typography variant="caption">
                          {t('createdAt')}: {(s.createdAt || '').slice(0, 10)}
                        </Typography>
                      </Box>
                    }
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 2 }}>
                    <Switch
                      checked={s.enabled !== false}
                      onChange={() => toggleEnabled(s)}
                      size="small"
                    />
                    <Tooltip title={t('edit')}><IconButton size="small" onClick={() => openEdit(s)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title={t('delete')}><IconButton size="small" onClick={() => handleDelete(s.id)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth scroll="paper">
        <DialogTitle>{editing ? t('editSchedule') : t('newSchedule')}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2.5, py: 0.5 }}>
            <TextField label={t('scheduleName')} fullWidth required value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} placeholder="e.g. Nightly DB Backup" />

            <TextField
              select label={t('cronFrequencyType')} fullWidth value={builderType}
              onChange={(e) => {
                const newType = e.target.value;
                setBuilderType(newType);
                updateCronFromBuilder(newType, builderHourly, builderMin, builderTime, builderDay, builderDate);
              }}
            >
              <MenuItem value="hourly">{t('cronHourly')}</MenuItem>
              <MenuItem value="daily">{t('cronDaily')}</MenuItem>
              <MenuItem value="weekly">{t('cronWeekly')}</MenuItem>
              <MenuItem value="monthly">{t('cronMonthly')}</MenuItem>
              <MenuItem value="advanced">{t('cronAdvanced')}</MenuItem>
            </TextField>

            {builderType === 'hourly' && (
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  select label={t('everyXHours')} fullWidth value={builderHourly}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBuilderHourly(v);
                    updateCronFromBuilder(builderType, v, builderMin, builderTime, builderDay, builderDate);
                  }}
                >
                  {['1', '2', '3', '4', '6', '8', '12'].map(h => <MenuItem key={h} value={h}>{h}</MenuItem>)}
                </TextField>
                <TextField
                  select label={t('atMinute')} fullWidth value={builderMin}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBuilderMin(v);
                    updateCronFromBuilder(builderType, builderHourly, v, builderTime, builderDay, builderDate);
                  }}
                >
                  {['0', '5', '10', '15', '20', '30', '45'].map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                </TextField>
              </Box>
            )}

            {(builderType === 'daily' || builderType === 'weekly' || builderType === 'monthly') && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {builderType === 'weekly' && (
                  <TextField
                    select label={t('dayOfWeek')} fullWidth value={builderDay}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBuilderDay(v);
                      updateCronFromBuilder(builderType, builderHourly, builderMin, builderTime, v, builderDate);
                    }}
                  >
                    {[
                      { label: lang === 'uk' ? 'Неділя' : 'Sunday', value: '0' },
                      { label: lang === 'uk' ? 'Понеділок' : 'Monday', value: '1' },
                      { label: lang === 'uk' ? 'Вівторок' : 'Tuesday', value: '2' },
                      { label: lang === 'uk' ? 'Середа' : 'Wednesday', value: '3' },
                      { label: lang === 'uk' ? 'Четвер' : 'Thursday', value: '4' },
                      { label: lang === 'uk' ? 'П\'ятниця' : 'Friday', value: '5' },
                      { label: lang === 'uk' ? 'Субота' : 'Saturday', value: '6' },
                    ].map(d => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
                  </TextField>
                )}
                {builderType === 'monthly' && (
                  <TextField
                    select label={t('dayOfMonth')} fullWidth value={builderDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBuilderDate(v);
                      updateCronFromBuilder(builderType, builderHourly, builderMin, builderTime, builderDay, v);
                    }}
                  >
                    {Array.from({ length: 28 }, (_, i) => String(i + 1)).map(d => (
                      <MenuItem key={d} value={d}>{d}</MenuItem>
                    ))}
                  </TextField>
                )}
                <TextField
                  label={t('runTime')} type="time" fullWidth value={builderTime}
                  InputLabelProps={{ shrink: true }}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBuilderTime(v);
                    updateCronFromBuilder(builderType, builderHourly, builderMin, v, builderDay, builderDate);
                  }}
                />
              </Box>
            )}

            {builderType === 'advanced' && (
              <TextField
                label={t('cronExpressionCustom')} fullWidth value={form.cronExpression}
                onChange={(e) => setForm({ ...form, cronExpression: e.target.value })}
                placeholder="0 */6 * * *" helperText={t('cronHelper')}
              />
            )}

            <TextField select label={t('backupJob')} fullWidth required value={form.backupId} onChange={(e) => setForm({...form, backupId: e.target.value})}>
              {backups.map((b) => (
                <MenuItem key={b.id} value={b.id}>{b.name} ({b.type || b.backupType})</MenuItem>
              ))}
              {backups.length === 0 && <MenuItem disabled value="">No backup jobs — create one first</MenuItem>}
            </TextField>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="body2">{t('enabledCol')}</Typography>
              <Switch checked={form.enabled !== false} onChange={(e) => setForm({...form, enabled: e.target.checked})} />
            </Box>

            <TextField select label={t('notifyOn')} fullWidth value={form.notifyOn || 'failure'} onChange={(e) => setForm({...form, notifyOn: e.target.value})}>
              <MenuItem value="never">Never</MenuItem>
              <MenuItem value="failure">Failure only</MenuItem>
              <MenuItem value="all">All results</MenuItem>
            </TextField>

            <TextField label={t('descriptionOptional')} fullWidth multiline rows={2} value={form.description || ''} onChange={(e) => setForm({...form, description: e.target.value})} placeholder="What this schedule does" />

            <Box sx={{ display: 'flex', gap: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <ScheduleIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.3 }} />
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  {t('currentSchedule')}: <strong>{form.cronExpression || '—'}</strong>
                </Typography>
                {form.cronExpression && (
                  <Typography variant="caption" color="text.secondary">
                    {explainCron(form.cronExpression)}
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={handleSave}>{editing ? t('save') : t('create')}</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({...snack, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snack.severity} variant="filled" sx={{ borderRadius: 2 }}>{snack.msg}</Alert>
      </Snackbar>
    </Box>
  );
}
