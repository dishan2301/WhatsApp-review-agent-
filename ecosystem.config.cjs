const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'openwa',
      cwd: path.resolve(__dirname, '..', 'OpenWA-main'),
      script: 'npm',
      args: 'run start:prod',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      time: true,
    },
    {
      name: 'swastik-review-worker',
      cwd: __dirname,
      script: 'npm',
      args: 'run worker:start',
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      time: true,
    },
  ],
};
