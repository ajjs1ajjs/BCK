/**
 * BCK S3 Versioning Service
 * Lists and restores object versions in S3-compatible storage (AWS S3, MinIO).
 * Uses AWS CLI — already required for cloud backup, works with any --endpoint-url.
 */
const { runAsync } = require('./exec');

/**
 * List all versions of a specific object (or all objects in a prefix)
 * @param {object} cred - cloud credential with credentials.{accessKeyId, secretAccessKey, region, bucket, endpoint}
 * @param {string} prefix - S3 key prefix to list versions for
 * @returns {{ success: boolean, versions?: Array, error?: string }}
 */
async function listVersions(cred, prefix) {
  const { credentials } = cred;
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_DEFAULT_REGION: credentials.region || 'us-east-1',
  };

  const args = [
    's3api', 'list-object-versions',
    '--bucket', credentials.bucket,
    '--prefix', prefix || '',
    '--output', 'json',
  ];

  if (credentials.endpoint) {
    args.push('--endpoint-url', credentials.endpoint);
  }

  const r = await runAsync('aws', args, { env });

  if (!r.success) {
    return { success: false, error: r.stderr || 'Failed to list versions' };
  }

  try {
    const data = JSON.parse(r.stdout || '{}');
    const versions = (data.Versions || []).map(v => ({
      versionId: v.VersionId,
      key: v.Key,
      size: v.Size,
      lastModified: v.LastModified,
      isLatest: v.IsLatest,
      etag: v.ETag,
    }));
    const deleteMarkers = (data.DeleteMarkers || []).map(d => ({
      versionId: d.VersionId,
      key: d.Key,
      lastModified: d.LastModified,
      isLatest: d.IsLatest,
      isDeleteMarker: true,
    }));

    return { success: true, versions: [...versions, ...deleteMarkers].sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified)) };
  } catch (e) {
    return { success: false, error: 'Failed to parse versions: ' + e.message };
  }
}

/**
 * Restore (copy) a specific version to a local file
 * @param {object} cred - cloud credential
 * @param {string} key - S3 object key
 * @param {string} versionId - S3 Version ID
 * @param {string} localPath - target local path to download to
 */
async function restoreVersion(cred, key, versionId, localPath) {
  const { credentials } = cred;
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_DEFAULT_REGION: credentials.region || 'us-east-1',
  };

  const args = [
    's3api', 'get-object',
    '--bucket', credentials.bucket,
    '--key', key,
    '--version-id', versionId,
    localPath,
    '--output', 'json',
  ];

  if (credentials.endpoint) {
    args.push('--endpoint-url', credentials.endpoint);
  }

  const r = await runAsync('aws', args, { env });
  return { success: r.success, error: r.success ? null : (r.stderr || 'Download failed') };
}

/**
 * Enable versioning on a bucket (MinIO / AWS S3)
 */
async function enableVersioning(cred) {
  const { credentials } = cred;
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_DEFAULT_REGION: credentials.region || 'us-east-1',
  };

  const args = [
    's3api', 'put-bucket-versioning',
    '--bucket', credentials.bucket,
    '--versioning-configuration', 'Status=Enabled',
    '--output', 'json',
  ];

  if (credentials.endpoint) {
    args.push('--endpoint-url', credentials.endpoint);
  }

  const r = await runAsync('aws', args, { env });
  return { success: r.success, error: r.success ? null : (r.stderr || 'Failed to enable versioning') };
}

/**
 * Get versioning status for a bucket
 */
async function getVersioningStatus(cred) {
  const { credentials } = cred;
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: credentials.accessKeyId,
    AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    AWS_DEFAULT_REGION: credentials.region || 'us-east-1',
  };

  const args = ['s3api', 'get-bucket-versioning', '--bucket', credentials.bucket, '--output', 'json'];
  if (credentials.endpoint) args.push('--endpoint-url', credentials.endpoint);

  const r = await runAsync('aws', args, { env });
  if (!r.success) return { enabled: false, error: r.stderr };

  try {
    const data = JSON.parse(r.stdout || '{}');
    return { enabled: data.Status === 'Enabled', status: data.Status || 'Disabled' };
  } catch {
    return { enabled: false };
  }
}

module.exports = { listVersions, restoreVersion, enableVersioning, getVersioningStatus };
