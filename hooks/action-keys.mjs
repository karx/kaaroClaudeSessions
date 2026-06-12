/**
 * hooks/action-keys.mjs — canonical tool-action vocabulary.
 *
 * Maps raw harness tool names (+ bash category) onto the small canonical key
 * set carried on tool_call pulses (data.key). This is normalization-layer
 * vocabulary: adapters stay sonic-unaware, the pulse transformer derives keys
 * here, and the experience layer (Event Registry) attaches sonic defaults to
 * these same keys.
 *
 * Adding a harness with new tool names: extend the alias lists here only.
 */

export const TOOL_ACTION_KEYS = new Set([
  'read', 'write', 'edit', 'grep_glob', 'agent',
  'bash_git', 'bash_run', 'bash_other', 'web', 'other',
]);

/**
 * Translate a raw harness tool name + optional bash category into a canonical
 * TOOL_ACTION_KEYS value. Case-insensitive. Returns 'other' for unknowns.
 *
 * @param {string|null} name     — raw tool name from the harness record
 * @param {string|null} category — bash category (git|npm|node|python|other)
 */
export function toolNameToKey(name, category = null) {
  const t = (name || '').toLowerCase().trim();
  if (['read', 'view_file', 'read_file', 'readfile'].includes(t))           return 'read';
  if (['write', 'write_to_file', 'createfile', 'create_file'].includes(t))   return 'write';
  if (['edit', 'replace_file_content', 'search_replace',
       'strreplace', 'editnotebook', 'editfile', 'replacestring',
       'applypatch', 'insert_edit_into_file',
       'replace_string_in_file', 'apply_patch'].includes(t))                  return 'edit';
  if (['grep', 'glob', 'grep_search', 'list_dir', 'findtextinfiles',
       'filesearch', 'listdirectory', 'codebase', 'file_search',
       'semantic_search'].includes(t))                                        return 'grep_glob';
  if (['agent', 'task'].includes(t))                                          return 'agent';
  if (['bash', 'powershell', 'shell', 'run_command', 'runinterminal',
       'run_in_terminal'].includes(t)) {
    if (category === 'git')                                                   return 'bash_git';
    if (['npm', 'npx', 'node', 'python'].includes(category))                 return 'bash_run';
    return 'bash_other';
  }
  if (['web_fetch', 'webfetch', 'web_search', 'websearch',
       'web search:', 'fetchwebpage'].includes(t))                            return 'web';
  return 'other';
}
