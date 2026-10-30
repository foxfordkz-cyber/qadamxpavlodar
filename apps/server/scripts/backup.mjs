// Offline-consistent SQLite + uploads backup. Stop the backend before invoking.
import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { mkdirSync, existsSync, cpSync, writeFileSync } from 'node:fs';
const [storage, destination] = process.argv.slice(2);
if (!storage || !destination) throw Error('Usage: node scripts/backup.mjs STORAGE_ROOT NEW_BACKUP_DIRECTORY (stop server first)');
const root=resolve(storage), target=resolve(destination), rel=relative(root,target);
if (!rel || (!rel.startsWith('..') && !isAbsolute(rel)) || existsSync(target)) throw Error('Use a new backup directory outside STORAGE_ROOT');
const source=join(root,'db/green-pavlodar.sqlite');
if (!existsSync(source)) throw Error('Source database not found');
const db=new DatabaseSync(source,{readOnly:true});
try {
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Source integrity failed');
 mkdirSync(target,{recursive:true});
 await backup(db,join(target,'green-pavlodar.sqlite'));
 if(existsSync(join(root,'uploads')))cpSync(join(root,'uploads'),join(target,'uploads'),{recursive:true,errorOnExist:true,force:false});
 const copy=new DatabaseSync(join(target,'green-pavlodar.sqlite'),{readOnly:true});
 try {if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity failed');}finally{copy.close();}
 writeFileSync(join(target,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),schema:db.prepare('PRAGMA user_version').get().user_version,requiresStoppedWriter:true},null,2));
 console.log('Backup integrity PASS; protect this directory as sensitive data');
}finally{db.close();}
