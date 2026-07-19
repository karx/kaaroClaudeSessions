/**
 * lib/analyze-helpers.mjs — pure helpers shared by analyze, adapters, and reducer.
 */

// Harness-chrome slash-commands. The session reducer routes these to
// session.builtin_commands[]; anything NOT in this set is treated as a real
// skill and lands in session.skills[] (see hooks/sessions-schema.mjs).
export const BUILTIN_COMMANDS = new Set([
  'exit', 'clear', 'compact', 'context', 'model', 'help', 'voice',
  'plan', 'fast', 'config', 'review', 'memory', 'doctor', 'status',
  'rate-limit-options', 'mcp', 'cost', 'log',
]);

export function deriveLabel(projectId) {
  return projectId
    .replace(/^[A-Za-z]--src-/, '')
    .replace(/^[A-Za-z]--Users-[^-]+-/, '');
}

export function normPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let p = raw.replace(/\\/g, '/').replace(/\/\//g, '/').trim();
  if (/^[a-zA-Z]:\//.test(p)) p = p.toLowerCase();
  return p || null;
}

export function categorizeBash(cmd) {
  if (!cmd) return 'other';
  const c = cmd.trimStart();
  return c.startsWith('git ')    ? 'git'
       : c.startsWith('npm ')    ? 'npm'
       : c.startsWith('npx ')    ? 'npx'
       : c.startsWith('node ')   ? 'node'
       : c.startsWith('py ') || c.startsWith('python') ? 'python'
       : /^(ls|cat|head|tail|mkdir|rm |cp |mv )/.test(c) ? 'fs'
       : c.startsWith('curl ')   ? 'curl'
       : 'other';
}

export function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content))    return '';
  return content.filter(b => b.type === 'text').map(b => b.text || '').join(' ');
}

export function extractSkills(text) {
  return [...text.matchAll(/<command-name>\/?([\w-]+)<\/command-name>/g)].map(m => m[1]);
}