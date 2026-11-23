import {copyFile, mkdir, rm} from 'node:fs/promises';
import {dirname, join} from 'node:path';

const files=[
  'index.html','manifest.webmanifest','sw.js','workflow.css','workflow.js',
  'offline.js','planner-lists.js','push-client.js','task-core.js',
  'icons/icon-192.png','icons/icon-512.png','vendor/supabase-2.49.8.js','vendor/SUPABASE-LICENSE',
];
await rm('dist',{recursive:true,force:true});
await Promise.all(files.map(async file=>{
  const target=join('dist',file);
  await mkdir(dirname(target),{recursive:true});
  await copyFile(file,target);
}));
