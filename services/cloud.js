const { run, checkTool } = require('./exec');

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
      const dest = credentials.endpoint
        ? `s3://${credentials.bucket}/${remotePath} --endpoint-url ${credentials.endpoint}`
        : `s3://${credentials.bucket}/${remotePath}`;
      const r = run(`aws s3 cp "${localPath}" ${dest}`, { env, timeout: 3600000 });
      return { success: r.success, error: r.stderr, url: `s3://${credentials.bucket}/${remotePath}` };
    }

    case 'azure': {
      const dest = `https://${credentials.storageAccount}.blob.core.windows.net/${credentials.container}/${remotePath}`;
      const r = run(
        `az storage blob upload --account-name ${credentials.storageAccount} --account-key ${credentials.accessKey} --container-name ${credentials.container} --file "${localPath}" --name "${remotePath}"`,
        { timeout: 3600000 }
      );
      return { success: r.success, error: r.stderr, url: dest };
    }

    case 'gcp': {
      const credFile = `/tmp/bck_gcp_creds_${Date.now()}.json`;
      require('fs').writeFileSync(credFile, JSON.stringify(credentials.credentials));
      const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credFile };
      const r = run(`gsutil cp "${localPath}" gs://${credentials.bucket}/${remotePath}`, { env, timeout: 3600000 });
      try { require('fs').unlinkSync(credFile); } catch {}
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
      const src = credentials.endpoint
        ? `s3://${credentials.bucket}/${remotePath} --endpoint-url ${credentials.endpoint}`
        : `s3://${credentials.bucket}/${remotePath}`;
      const r = run(`aws s3 cp ${src} "${localPath}"`, { env, timeout: 3600000 });
      return { success: r.success, error: r.stderr };
    }

    case 'azure': {
      const r = run(
        `az storage blob download --account-name ${credentials.storageAccount} --account-key ${credentials.accessKey} --container-name ${credentials.container} --name "${remotePath}" --file "${localPath}"`,
        { timeout: 3600000 }
      );
      return { success: r.success, error: r.stderr };
    }

    case 'gcp': {
      const credFile = `/tmp/bck_gcp_creds_${Date.now()}.json`;
      require('fs').writeFileSync(credFile, JSON.stringify(credentials.credentials));
      const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: credFile };
      const r = run(`gsutil cp gs://${credentials.bucket}/${remotePath} "${localPath}"`, { env, timeout: 3600000 });
      try { require('fs').unlinkSync(credFile); } catch {}
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
      const r = run(`aws s3 ls s3://${credentials.bucket}/${prefix} --recursive`, { env, timeout: 120000 });
      if (!r.success) return [];
      return r.stdout.split('\n').filter(Boolean).map(line => {
        const parts = line.split(/\s+/);
        return { date: parts[0] + ' ' + parts[1], size: parts[2], key: parts.slice(3).join(' ') };
      });
    }

    case 'azure': {
      const r = run(
        `az storage blob list --account-name ${credentials.storageAccount} --account-key ${credentials.accessKey} --container-name ${credentials.container} --prefix "${prefix}" --query "[].{name:name, size:properties.contentLength}"`,
        { timeout: 120000 }
      );
      if (!r.success) return [];
      try { return JSON.parse(r.stdout); } catch { return []; }
    }

    case 'gcp': {
      const r = run(`gsutil ls -l gs://${credentials.bucket}/${prefix}`, { timeout: 120000 });
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

module.exports = { upload, download, list, checkTools, PROVIDERS };
