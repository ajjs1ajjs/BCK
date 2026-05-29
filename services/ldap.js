/**
 * BCK LDAP / Active Directory Authentication Service
 * Uses ldapts — pure JS LDAP client (no native bindings needed)
 */
const { Client } = require('ldapts');

/**
 * Build LDAP client from settings config
 */
function createClient(config) {
  return new Client({
    url: `${config.ssl ? 'ldaps' : 'ldap'}://${config.host}:${config.port || (config.ssl ? 636 : 389)}`,
    tlsOptions: config.ssl ? { rejectUnauthorized: config.sslVerify !== false } : undefined,
    connectTimeout: 8000,
    timeout: 10000,
  });
}

/**
 * Test LDAP connectivity and bind with service account
 * @returns {{ success: boolean, error?: string, userCount?: number }}
 */
async function testConnection(config) {
  const client = createClient(config);
  try {
    await client.bind(config.bindDn, config.bindPassword);

    // Count users matching the filter
    const { searchEntries } = await client.search(config.baseDn, {
      scope: 'sub',
      filter: config.userFilter || '(objectClass=person)',
      attributes: ['dn'],
      sizeLimit: 5,
    });

    return { success: true, userCount: searchEntries.length };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await client.unbind().catch(() => {});
  }
}

/**
 * Authenticate a user against LDAP and return mapped user attributes
 * @param {object} config - LDAP settings from DB
 * @param {string} username
 * @param {string} password
 * @returns {{ success: boolean, user?: object, error?: string }}
 */
async function authenticate(config, username, password) {
  if (!config || !config.host || !config.baseDn) {
    return { success: false, error: 'LDAP not configured' };
  }

  const client = createClient(config);

  try {
    // Step 1: Bind with service account to search
    await client.bind(config.bindDn, config.bindPassword);

    // Step 2: Search for the user
    const usernameAttr = config.usernameAttr || 'sAMAccountName'; // AD default
    const filter = config.userFilter
      ? config.userFilter.replace('{username}', username)
      : `(${usernameAttr}=${username})`;

    const { searchEntries } = await client.search(config.baseDn, {
      scope: 'sub',
      filter,
      attributes: [
        'dn', 'cn', 'mail', 'sAMAccountName', 'uid',
        'givenName', 'sn', 'memberOf', 'displayName',
      ],
    });

    if (searchEntries.length === 0) {
      return { success: false, error: 'User not found in directory' };
    }

    const entry = searchEntries[0];
    const userDn = entry.dn;

    // Step 3: Verify user's password by binding as them
    const userClient = createClient(config);
    try {
      await userClient.bind(userDn, password);
    } catch {
      return { success: false, error: 'Invalid credentials' };
    } finally {
      await userClient.unbind().catch(() => {});
    }

    // Step 4: Determine BCK role from group membership
    const memberOf = Array.isArray(entry.memberOf)
      ? entry.memberOf
      : entry.memberOf ? [entry.memberOf] : [];

    let mappedRole = config.defaultRole || 'viewer';
    if (config.groupMappings) {
      const mappings = typeof config.groupMappings === 'string'
        ? JSON.parse(config.groupMappings)
        : config.groupMappings;

      // Check groups from highest to lowest privilege
      for (const [group, role] of Object.entries(mappings)) {
        if (memberOf.some(g => g.toLowerCase().includes(group.toLowerCase()))) {
          mappedRole = role;
          break;
        }
      }
    }

    return {
      success: true,
      user: {
        ldapDn: userDn,
        username: entry.sAMAccountName || entry.uid || username,
        email: entry.mail || '',
        displayName: entry.displayName || entry.cn || username,
        role: mappedRole,
        authProvider: 'ldap',
      },
    };
  } catch (err) {
    return { success: false, error: `LDAP error: ${err.message}` };
  } finally {
    await client.unbind().catch(() => {});
  }
}

module.exports = { authenticate, testConnection };
