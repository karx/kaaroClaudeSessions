/**
 * hooks/policy.mjs — policy file loader + merge (W-POL-01).
 *
 * Loads `.agents/policy.json` (project) and `~/.agents/policy.json` (global);
 * project rules prepend global rules — same merge semantics as kaaroSkills.
 * Loading never throws: absent → null, malformed → console.warn + null.
 * Policy output is signals only; kaaroSessions is an auditor, never a gatekeeper.
 */

import fs   from 'fs';
import os   from 'os';
import path from 'path';

/** Read + validate one policy file. Absent → null; malformed/invalid → warn + null. */
export function loadPolicyFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (obj.rules !== undefined && !Array.isArray(obj.rules)) {
      console.warn(`policy ${filePath} invalid — rules must be an array; ignoring`);
      return null;
    }
    return obj;
  } catch (err) {
    console.warn(`policy ${filePath} unreadable — ignoring: ${err.message}`);
    return null;
  }
}

/** Merge project policy over global: project rules prepend, anomaly keys override. */
export function mergePolicies(projectPolicy, globalPolicy) {
  if (!projectPolicy && !globalPolicy) return null;
  if (!projectPolicy) return globalPolicy;
  if (!globalPolicy)  return projectPolicy;
  return {
    ...globalPolicy,
    ...projectPolicy,
    rules: [...(projectPolicy.rules || []), ...(globalPolicy.rules || [])],
    builtin_anomalies: {
      ...(globalPolicy.builtin_anomalies  || {}),
      ...(projectPolicy.builtin_anomalies || {}),
    },
  };
}

/** Load and merge project + global policy. Both absent → null. */
export function loadPolicy({ projectDir = process.cwd(), homeDir = os.homedir() } = {}) {
  const project = loadPolicyFile(path.join(projectDir, '.agents', 'policy.json'));
  const global  = loadPolicyFile(path.join(homeDir,    '.agents', 'policy.json'));
  return mergePolicies(project, global);
}
