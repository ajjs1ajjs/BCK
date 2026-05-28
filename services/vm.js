const { runAsync, checkTool } = require('./exec');

async function backup(backupConfig) {
  const { type, vmName, host, user, password, datastore, backupPath } = backupConfig;

  switch (type) {
    case 'vmware': {
      const tool = checkTool('govc', 'govc version');
      if (!tool.available) {
        return { success: false, error: 'govc CLI not found. Install VMware vSphere CLI.' };
      }
      const env = {
        ...process.env,
        GOVC_URL: host,
        GOVC_USERNAME: user,
        GOVC_PASSWORD: password,
        GOVC_INSECURE: '1',
      };
      const outFile = `${backupPath}/${vmName}_${Date.now()}.ova`;
      const r = await runAsync('govc', ['export.ova', '-vm', vmName, outFile], { env });
      return { success: r.success, file: outFile, error: r.stderr };
    }

    case 'hyperv': {
      const tool = checkTool('powershell', 'powershell -Command "Get-Command"');
      if (!tool.available) {
        return { success: false, error: 'PowerShell not available for Hyper-V backup.' };
      }
      // Run powershell with arguments to prevent injection
      const r = await runAsync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Param($vmName, $path) $vm = Get-VM -Name $vmName; Export-VM -Name $vmName -Path $path -ErrorAction Stop',
        vmName,
        backupPath
      ]);
      return { success: r.success, error: r.stderr };
    }

    default:
      return { success: false, error: `Unsupported VM platform: ${type}` };
  }
}

async function restore(restoreConfig) {
  const { type, vmName, host, user, password, file } = restoreConfig;

  switch (type) {
    case 'vmware': {
      const env = {
        ...process.env,
        GOVC_URL: host,
        GOVC_USERNAME: user,
        GOVC_PASSWORD: password,
        GOVC_INSECURE: '1',
      };
      const r = await runAsync('govc', ['import.ova', '-name', vmName, file], { env });
      return { success: r.success, error: r.stderr };
    }

    case 'hyperv': {
      const r = await runAsync('powershell', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Param($filePath) Import-VM -Path $filePath -Copy -GenerateNewId -ErrorAction Stop',
        file
      ]);
      return { success: r.success, error: r.stderr };
    }

    default:
      return { success: false, error: `Unsupported VM platform: ${type}` };
  }
}

function checkTools(type) {
  if (type === 'vmware') return checkTool('govc', 'govc version');
  if (type === 'hyperv') return checkTool('powershell', 'powershell -Command "Get-Command"');
  return { available: false };
}

module.exports = { backup, restore, checkTools };
