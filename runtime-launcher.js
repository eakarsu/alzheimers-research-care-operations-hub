'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const ports = [process.env.BACKEND_PORT, process.env.FRONTEND_PORT];
const children = ports.map((port) => spawn('node', ['src/server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
  stdio: 'inherit',
}));

let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill(signal);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));
for (const child of children) {
  child.on('error', (error) => {
    console.error('Unable to start runtime', error.message);
    process.exitCode = 1;
    stop();
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      process.exitCode = code ?? (signal ? 1 : 0);
      stop();
    }
  });
}
