// Kept for compatibility with older automation. The maintained suite is `npm test`.
require('node:child_process').spawnSync(process.execPath, ['--test', 'test/*.test.js'], { stdio: 'inherit', shell: true });
