import { DatabaseSync } from 'node:sqlite';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const wsRoot = join(process.env.APPDATA, 'Code/User/workspaceStorage');
let shown = 0;
for (const ws of readdirSync(wsRoot)) {
  const db = join(wsRoot, ws, 'state.vscdb');
  if (!existsSync(db)) continue;
  try {
    const d = new DatabaseSync(db, { readOnly: true });
    const row = d.prepare("SELECT value FROM ItemTable WHERE key='chat.ChatSessionStore.index'").get();
    d.close();
    if (row) {
      console.log('--', ws.slice(0, 8), ':', String(row.value).slice(0, 500));
      if (++shown >= 3) break;
    }
  } catch (e) { console.log('ERR', e.message.slice(0, 60)); }
}
