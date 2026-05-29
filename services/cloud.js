const { runAsync, checkTool } = require('./exec');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PROVIDERS = {
  aws: {
    name: 'Amazon S3',
    icon: 'aws',
    fields: ['accessKeyId', 'secretAccessKey', 'region', 'bucket', 'endpoint'],
  },
  azure: {
    name: 'Azure Blob',
    icon: 'azure',
    fields: ['storageAccount', 'accessKey', 'container', 'endpoint'],
  },
  gcp: {
    name: 'Google Cloud Storage',
    icon: 'gcp',
    fields: ['projectId', 'bucket', 'credentials'],
  },
};

async function upload(providerConfig, localPath, remotePath) {
  const { provider, credentials } = providerConfig;

  switch (provider) {
    case 'aws': {
      const env = {
        ...process.env,
        AWS_ACCESS_KEY_ID: credentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
        AWS_DEFAULT_REGION: credentials.region,
      };
      const args = ['s3', 'cp', localPath, `s3://${credentials.bucket}/${remotePath}`];
      if (credentials.endpoint) {
        args.push('--endpoint-url', credentials.endpoint);
      }
      const r = await runAsync('aws', args, { env });
      return { success: r.success, error: r.stderr, url: `s3://${credentials.bucket}/${remotePath}` };
    }

    case 'azure': {
      const dest = `https://${credentials.storageAccount}.blob.core.windows.net/${credentials.container}/${remotePath}`;
      const args = [
        'storage', 'blob', 'upload',
        '--account-name', credentials.storageAccount,
        '--account-key', credentials.accessKey,
        '--container-name', credentials.container,
        '--file', localPath,
        '--name', remotePath
      ];
      const r = await runAsync('az', args);
      return { success: r.success, error: r.stderr, url: dest };
    }

    case 'gcp': {
      const credFile = path.join(os.tmpdir(), `bck_gcp_creds_${Date.now()}.json`);
      fs.writeFileSync(credFile, JSON.stringify(credentials.credentials));
      const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credFile };
      const r = await runAsync('gsutil', ['cp', localPath, `gs://${credentials.bucket}/${remotePath}`], { env });
      try { fs.unlinkSync(credFile); } catch {}
      return { success: r.success, error: r.stderr, url: `gs://${credentials.bucket}/${remotePath}` };
    }

    default:
      return { success: false, error: `Unsupported cloud provider: ${provider}` };
  }
}

async function download(providerConfig, remotePath, localPath) {
  const { provider, credentials } = providerConfig;

  switch (provider) {
    case 'aws': {
      const env = {
        ...process.env,
        AWS_ACCESS_KEY_ID: credentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
        AWS_DEFAULT_REGION: credentials.region,
      };
      const args = ['s3', 'cp', `s3://${credentials.bucket}/${remotePath}`, localPath];
      if (credentials.endpoint) {
        args.push('--endpoint-url', credentials.endpoint);
      }
      const r = await runAsync('aws', args, { env });
      return { success: r.success, error: r.stderr };
    }

    case 'azure': {
      const args = [
        'storage', 'blob', 'download',
        '--account-name', credentials.storageAccount,
        '--account-key', credentials.accessKey,
        '--container-name', credentials.container,
        '--name', remotePath,
        '--file', localPath
      ];
      const r = await runAsync('az', args);
      return { success: r.success, error: r.stderr };
    }

    case 'gcp': {
      const credFile = path.join(os.tmpdir(), `bck_gcp_creds_${Date.now()}.json`);
      fs.writeFileSync(credFile, JSON.stringify(credentials.credentials));
      const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credFile };
      const r = await runAsync('gsutil', ['cp', `gs://${credentials.bucket}/${remotePath}`, localPath], { env });
      try { fs.unlinkSync(credFile); } catch {}
      return { success: r.success, error: r.stderr };
    }

    default:
      return { success: false, error: `Unsupported cloud provider: ${provider}` };
  }
}

async function list(providerConfig, prefix = '') {
  const { provider, credentials } = providerConfig;

  switch (provider) {
    case 'aws': {
      const env = {
        ...process.env,
        AWS_ACCESS_KEY_ID: credentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
        AWS_DEFAULT_REGION: credentials.region,
      };
      const args = ['s3', 'ls', `s3://${credentials.bucket}/${prefix}`, '--recursive'];
      if (credentials.endpoint) {
        args.push('--endpoint-url', credentials.endpoint);
      }
      const r = await runAsync('aws', args, { env, timeout: 120000 });
      if (!r.success) return [];
      return r.stdout.split('\n').filter(Boolean).map(line => {
        const parts = line.split(/\s+/);
        return { date: parts[0] + ' ' + parts[1], size: parts[2], key: parts.slice(3).join(' ') };
      });
    }

    case 'azure': {
      const args = [
        'storage', 'blob', 'list',
        '--account-name', credentials.storageAccount,
        '--account-key', credentials.accessKey,
        '--container-name', credentials.container,
        '--prefix', prefix,
        '--query', '[].{name:name, size:properties.contentLength}'
      ];
      const r = await runAsync('az', args, { timeout: 120000 });
      if (!r.success) return [];
      try { return JSON.parse(r.stdout); } catch { return []; }
    }

    case 'gcp': {
      const credFile = path.join(os.tmpdir(), `bck_gcp_creds_${Date.now()}.json`);
      fs.writeFileSync(credFile, JSON.stringify(credentials.credentials));
      const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credFile };
      const r = await runAsync('gsutil', ['ls', '-l', `gs://${credentials.bucket}/${prefix}`], { env, timeout: 120000 });
      try { fs.unlinkSync(credFile); } catch {}
      if (!r.success) return [];
      return r.stdout.split('\n').filter(l => l.trim()).map(l => {
        const parts = l.trim().split(/\s+/);
        return { size: parts[0], key: parts.slice(1).join(' ') };
      }).filter(f => f.key);
    }

    default:
      return [];
  }
}

function checkTools(provider) {
  switch (provider) {
    case 'aws': return checkTool('aws', 'aws --version');
    case 'azure': return checkTool('az', 'az --version');
    case 'gcp': return checkTool('gsutil', 'gsutil version');
    default: return { available: false };
  }
}

// Backup function for cloud storage
async function backup(providerConfig, sourcePath, destinationPath) {
  const uploadRes = await upload(providerConfig, sourcePath, destinationPath);
  return { success: uploadRes.success, error: uploadRes.error };
}

// Restore function for cloud storage
async function restore(providerConfig, sourcePath, destinationPath) {
  const downloadRes = await download(providerConfig, sourcePath, destinationPath);
  return { success: downloadRes.success, error: downloadRes.error };
}

module.exports = { upload, download, list, checkTools, PROVIDERS, backup, restore };
