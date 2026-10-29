// 调试控制台：捕获 console.log/warn/error 并展示在可折叠面板
const logs = [];
const maxLogs = 200;

const origLog = console.log.bind(console);
const origWarn = console.warn.bind(console);
const origErr = console.error.bind(console);

function push(level, args) {
  const entry = {
    level,
    time: new Date().toLocaleTimeString(),
    msg: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '),
  };
  logs.push(entry);
  if (logs.length > maxLogs) logs.shift();
  window.dispatchEvent(new CustomEvent('debuglog', { detail: entry }));
}

console.log = (...a) => { push('log', a); origLog(...a); };
console.warn = (...a) => { push('warn', a); origWarn(...a); };
console.error = (...a) => { push('error', a); origErr(...a); };

window.addEventListener('error', (e) => push('error', [e.message]));
window.addEventListener('unhandledrejection', (e) => push('error', [`Promise reject: ${e.reason}`]));

export function getLogs() { return logs; }
export function clearLogs() { logs.length = 0; window.dispatchEvent(new CustomEvent('debuglog')); }
