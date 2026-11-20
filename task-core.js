(function(root){
  'use strict';
  const copy=x=>JSON.parse(JSON.stringify(x));
  const pad=n=>String(n).padStart(2,'0');
  const dateString=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return null;const d=new Date(value+'T12:00:00');return Number.isFinite(+d)&&dateString(d)===value?d:null}
  function tags(value){const items=Array.isArray(value)?value:String(value||'').split(/[\s,;]+/u);return [...new Set(items.map(x=>String(x).trim().replace(/^#+/,'').normalize('NFKC').toLocaleLowerCase()).filter(x=>/^[\p{L}\p{N}_-]{1,50}$/u.test(x)))].slice(0,30)}
  function subtasks(value){return Array.isArray(value)?value.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string').map(x=>({...x,done:!!x.done})):[]}
  function repeat(value){if(!value||!['day','week','month','year','weekdays'].includes(value.freq))return null;return {...value,interval:Math.max(1,Math.min(365,Math.floor(Number(value.interval)||1))),until:date(value.until)?value.until:''}}
  function decode(row){
    let raw;try{raw=JSON.parse(row.description)}catch{}
    const meta=raw&&raw.matrica===2&&typeof raw==='object'?raw:null;
    return {id:row.id,title:row.title,note:meta?String(meta.note||''):row.description||'',folderId:meta?.folderId||'',isFolder:meta?.kind==='folder',folderRank:Number.isFinite(meta?.folderRank)?meta.folderRank:undefined,
      date:row.task_date||'',time:row.task_time?.slice(0,5)||'',cat:row.quadrant==null?1:row.quadrant-1,done:!!row.completed,completedAt:row.completed_at||null,createdAt:row.created_at,
      tags:tags(meta?.tags),flagged:!!meta?.flagged,subtasks:subtasks(meta?.subtasks),repeat:repeat(meta?.repeat),url:typeof meta?.url==='string'?meta.url:'',rank:Number.isFinite(meta?.rank)?meta.rank:undefined,
      deletedAt:meta?.deletedAt||null,deletedState:meta?.deletedState||null,seriesId:meta?.seriesId||null,nextOccurrenceId:meta?.nextOccurrenceId||null,generatedFrom:meta?.generatedFrom||null,_meta:meta?copy(meta):null};
  }
  function encode(task,userId){
    const t=task,meta={...(t._meta||{}),matrica:2,kind:t.isFolder?'folder':'task',folderId:t.folderId||'',note:t.note||''};
    const optional={folderRank:t.folderRank,tags:tags(t.tags),flagged:!!t.flagged,subtasks:subtasks(t.subtasks),repeat:repeat(t.repeat),url:t.url||'',rank:t.rank,deletedAt:t.deletedAt||null,deletedState:t.deletedState||null,seriesId:t.seriesId||null,nextOccurrenceId:t.nextOccurrenceId||null,generatedFrom:t.generatedFrom||null};
    for(const [key,value] of Object.entries(optional)){if(value!=null&&value!==false&&value!==''&&(!Array.isArray(value)||value.length))meta[key]=value;else delete meta[key]}
    // Keep existing v2 envelopes and unknown keys even when all new fields are empty.
    const hasMeta=t._meta||t.isFolder||t.folderId||Object.keys(meta).some(k=>!['matrica','kind','folderId','note'].includes(k));
    return {id:t.id,user_id:userId,title:t.title,description:hasMeta?JSON.stringify(meta):t.note||'',task_date:t.date||null,task_time:t.time||null,quadrant:t.date?t.cat+1:null,completed:!!t.done,completed_at:t.completedAt||null};
  }
  function nextDate(task,after=task.date){
    const rule=repeat(task.repeat),base=date(task.date),limit=date(after);if(!rule||!base||!limit)return '';
    const anchorDay=Number(rule.anchorDay)||base.getDate(),anchorMonth=Number(rule.anchorMonth)||base.getMonth()+1;
    for(let step=1;step<=20000;step++){
      let candidate=new Date(+base);
      if(rule.freq==='day')candidate.setDate(base.getDate()+step*rule.interval);
      if(rule.freq==='week')candidate.setDate(base.getDate()+step*rule.interval*7);
      if(rule.freq==='weekdays'){candidate.setDate(base.getDate()+step);if([0,6].includes(candidate.getDay()))continue}
      if(rule.freq==='month'){candidate=new Date(base.getFullYear(),base.getMonth()+step*rule.interval,1,12);candidate.setDate(Math.min(anchorDay,new Date(candidate.getFullYear(),candidate.getMonth()+1,0).getDate()))}
      if(rule.freq==='year'){candidate=new Date(base.getFullYear()+step*rule.interval,anchorMonth-1,1,12);candidate.setDate(Math.min(anchorDay,new Date(candidate.getFullYear(),candidate.getMonth()+1,0).getDate()))}
      const out=dateString(candidate);if(rule.until&&out>rule.until)return '';if(candidate>limit)return out;
    }return '';
  }
  // A stable UUID gives concurrent devices the same next-occurrence key.
  function occurrenceId(series,dateValue){const input=series+'|'+dateValue;let hex='';for(let seed=0;seed<4;seed++){let h=(2166136261^seed*2654435761)>>>0;for(let i=0;i<input.length;i++)h=Math.imul(h^input.charCodeAt(i),16777619)>>>0;hex+=h.toString(16).padStart(8,'0')}return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`}
  function nextOccurrence(task,after,now=new Date().toISOString()){
    if(!task.done||task.deletedAt||task.isFolder||task.nextOccurrenceId)return null;
    const next=nextDate(task,after);if(!next)return null;
    const series=task.seriesId||task.id,id=occurrenceId(series,next);
    return {...copy(task),id,date:next,done:false,completedAt:null,deletedAt:null,deletedState:null,createdAt:now,seriesId:series,nextOccurrenceId:null,generatedFrom:task.id,
      subtasks:subtasks(task.subtasks).map(s=>({...s,done:false})),repeat:{...task.repeat,anchorDay:task.repeat.anchorDay||date(task.date).getDate(),anchorMonth:task.repeat.anchorMonth||date(task.date).getMonth()+1}};
  }
  function softDelete(task,now=new Date().toISOString()){if(task.isFolder||task.deletedAt)return task;return {...task,deletedAt:now,deletedState:{done:!!task.done,completedAt:task.completedAt||null},done:true,completedAt:task.completedAt||now}}
  function restore(task){if(!task.deletedAt)return task;return {...task,done:!!task.deletedState?.done,completedAt:task.deletedState?.completedAt||null,deletedAt:null,deletedState:null}}
  const normalize=s=>String(s||'').normalize('NFKC').toLocaleLowerCase().replaceAll('ё','е');
  function matches(task,query,folderName=''){const hay=normalize([task.title,task.note,task.url,folderName,...tags(task.tags).map(t=>'#'+t),...subtasks(task.subtasks).map(s=>s.title)].join(' '));return normalize(query).split(/\s+/).filter(Boolean).every(word=>hay.includes(word))}
  function sort(items,mode='manual'){return [...items].sort((a,b)=>{let n=0;if(mode==='title')n=String(a.title).localeCompare(String(b.title),'ru');else if(mode==='date')n=((a.date||'9999')+' '+(a.time||'23:59')).localeCompare((b.date||'9999')+' '+(b.time||'23:59'));else if(mode==='created')n=String(b.createdAt||'').localeCompare(String(a.createdAt||''));else if(mode==='flagged')n=Number(!!b.flagged)-Number(!!a.flagged);else n=(a.rank??0)-(b.rank??0);return n||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id).localeCompare(String(b.id))})}
  function removeFolder(items,id){if(!items.some(t=>t.id===id&&t.isFolder))return items;return items.filter(t=>t.id!==id).map(t=>t.folderId===id?{...t,folderId:''}:t)}
  function merge(base,local,remote){
    if(!base)return local.generatedFrom?remote:local;
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),out={...remote};
    for(const key of Object.keys(local)){
      if(same(local[key],base[key]))continue;
      if(key==='subtasks'){
        const old=new Map(subtasks(base[key]).map(s=>[s.id,s])),own=new Map(subtasks(local[key]).map(s=>[s.id,s]));
        out[key]=subtasks(remote[key]).filter(s=>!old.has(s.id)||own.has(s.id)).map(s=>own.has(s.id)?merge(old.get(s.id),own.get(s.id),s):s);
        for(const s of own.values())if(!out[key].some(r=>r.id===s.id)&&(!old.has(s.id)||!same(s,old.get(s.id))))out[key].push(copy(s));
      }else if(key==='_meta'){out[key]={...(remote[key]||{})};for(const k of Object.keys(local[key]||{}))if(!same(local[key][k],base[key]?.[k]))out[key][k]=local[key][k]}
      else out[key]=local[key];
    }return out;
  }
  function wallTime(value=new Date(),zone){let parts;try{parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone||undefined,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value)}catch{return wallTime(value)}const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`}}
  const api={copy,date,dateString,tags,subtasks,repeat,decode,encode,nextDate,occurrenceId,nextOccurrence,softDelete,restore,matches,sort,removeFolder,merge,wallTime};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.MatricaCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
