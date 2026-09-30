// Runs mock BSE (:4000) and the app (:3000). Usage: node start.js [--delay=<ms>]
const { spawn } = require('child_process');
const arg = process.argv.find(a => a.startsWith('--delay='));
const env = { ...process.env };
if (arg) env.PULL_DELAY_MS = arg.split('=')[1];
const run = f => spawn(process.execPath, [f], { stdio: 'inherit', env });
const kids = [run('bse-mock/server.js'), run('app/server.js')];
const stop = () => kids.forEach(k => k.kill());
process.on('SIGINT', stop); process.on('SIGTERM', stop);
kids.forEach(k => k.on('exit', stop));
