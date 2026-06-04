const DatabaseStrategy = require('./DatabaseStrategy');
const VMStrategy = require('./VMStrategy');
const HostStrategy = require('./HostStrategy');
const CloudStrategy = require('./CloudStrategy');
const SSHStrategy = require('./SSHStrategy');
const ResticStrategy = require('./ResticStrategy');
const GenericStrategy = require('./GenericStrategy');

class StrategyFactory {
  getStrategy(backupType) {
    if (['mysql', 'postgres', 'oracle', 'mongodb', 'mssql', 'redis'].includes(backupType)) {
      return DatabaseStrategy;
    }
    if (['vmware', 'hyperv'].includes(backupType)) {
      return VMStrategy;
    }
    if (backupType === 'host') {
      return HostStrategy;
    }
    if (backupType === 'cloud') {
      return CloudStrategy;
    }
    if (backupType === 'ssh') {
      return SSHStrategy;
    }
    if (backupType === 'restic') {
      return ResticStrategy;
    }
    return GenericStrategy;
  }
}

module.exports = new StrategyFactory();
