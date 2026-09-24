const FILES = ['calendar.json','roster.json','playbook.json','rsvps.json','attendance.json','excuses.json','admins.json','staff.json','activity.json'];
const PERMISSION_FOR = { 'calendar.json':'events', 'roster.json':'roster', 'playbook.json':'playbook', 'attendance.json':'attendance', 'admins.json':'users', 'staff.json':'users', 'activity.json':'users', 'rsvps.json':'events', 'excuses.json':'events' };
const DEFAULTS = { 'calendar.json':[], 'roster.json':{main:[],reserve:[],academy:[]}, 'playbook.json':{entries:[],maps:[]}, 'rsvps.json':{}, 'attendance.json':{}, 'excuses.json':{}, 'admins.json':[], 'staff.json':[], 'activity.json':[] };
const API_NAMES = { events:'calendar.json', roster:'roster.json', playbook:'playbook.json', rsvps:'rsvps.json', attendance:'attendance.json', excuses:'excuses.json', admins:'admins.json', staff:'staff.json', logs:'activity.json' };

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';
    if (!allowed || (origin && origin !== allowed)) return new Response('Forbidden origin',{status:403,headers:{'Cache-Control':'no-store'}});
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors(origin,allowed)});
    const url = new URL(request.url), path = url.pathname.replace(/\/$/,'');
    try {
      if (path === '/api/health' && request.method === 'GET') return json({ok:true,service:'Freezers ESPORT'},200,origin,allowed);
      if (path === '/api/login' && request.method === 'POST') {
        const {username,password} = await request.json();
        if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 256) return json({error:'Neplatné přihlašovací údaje.'},400,origin,allowed);
        const accounts = await readFile(env,'admins.json');
        const user = accounts.find(a => a.username?.toLowerCase() === username.trim().toLowerCase());
        if (!user || !(await verifyPassword(password,user))) return json({error:'Nesprávné jméno nebo heslo.'},401,origin,allowed);
        const claims = {sub:user.username,role:user.role||'member',permissions:user.role==='owner'?{}:(user.permissions||{}),exp:Math.floor(Date.now()/1000)+7200};
        return json({session:await sign(claims,env.SESSION_SECRET),user:{username:claims.sub,role:claims.role,permissions:claims.permissions}},200,origin,allowed);
      }
      if (path === '/api/public' && request.method === 'GET') { const [events,roster,playbook]=await Promise.all([readFile(env,'calendar.json'),readFile(env,'roster.json'),readFile(env,'playbook.json')]); return json({events,roster,playbook:{entries:[],maps:[]},playbookCount:playbook.entries?.length||0},200,origin,allowed); }
      const claims = await authenticate(request,env);
      if (!claims) return json({error:'Přihlas se znovu.'},401,origin,allowed);
      if (path === '/api/change-password' && request.method === 'POST') { const body=await request.json(); if(typeof body.oldPassword!=='string'||typeof body.newPassword!=='string'||body.newPassword.length<10)return json({error:'Nové heslo musí mít alespoň 10 znaků.'},400,origin,allowed); const accounts=await readFile(env,'admins.json'),account=accounts.find(a=>a.username?.toLowerCase()===claims.sub.toLowerCase()); if(!account||!(await verifyPassword(body.oldPassword,account)))return json({error:'Současné heslo není správné.'},401,origin,allowed); const salt=toHex(crypto.getRandomValues(new Uint8Array(16))),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(body.newPassword),'PBKDF2',false,['deriveBits']),bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:fromHex(salt),iterations:600000,hash:'SHA-256'},key,256);account.salt=salt;account.passwordHash=toHex(new Uint8Array(bits));account.iterations=600000;await writeFile(env,'admins.json',accounts,claims.sub);return json({ok:true},200,origin,allowed); }
      if (path === '/api/data' && request.method === 'GET') {
        const result = {};
        for (const filename of FILES) {
          if (filename === 'admins.json' && claims.role !== 'owner') continue;
          result[Object.keys(API_NAMES).find(key => API_NAMES[key] === filename)] = await readFile(env,filename);
        }
        return json(result,200,origin,allowed);
      }
      const dataMatch = path.match(/^\/api\/data\/([a-z-]+)$/);
      if (dataMatch) {
        const filename = API_NAMES[dataMatch[1]] || dataMatch[1]+'.json';
        if (!FILES.includes(filename)) return json({error:'Neznámý datový soubor.'},404,origin,allowed);
        if (request.method === 'GET') {
          if (filename === 'admins.json' && claims.role !== 'owner') return json({error:'Bez oprávnění.'},403,origin,allowed);
          return json(await readFile(env,filename),200,origin,allowed);
        }
        if (request.method === 'PUT') {
          const permission = PERMISSION_FOR[filename];
          const selfService = ['rsvps.json','excuses.json','attendance.json'].includes(filename);
          if (claims.role !== 'owner' && !selfService && claims.permissions?.[permission] !== true) return json({error:'Nemáš oprávnění tuto část měnit.'},403,origin,allowed);
          const body = await request.json();
          if (!Object.hasOwn(body,'data')) return json({error:'Chybí data.'},400,origin,allowed);
          if (selfService && claims.role !== 'owner' && claims.permissions?.[permission] !== true) { const old=await readFile(env,filename); if(!onlyOwnChanges(old,body.data,claims.sub,filename)) return json({error:'Můžeš měnit pouze vlastní odpovědi.'},403,origin,allowed); }
          await writeFile(env,filename,body.data,claims.sub);
          return json({ok:true},200,origin,allowed);
        }
      }
      if (path === '/api/migrate' && request.method === 'POST') {
        if (claims.role !== 'owner') return json({error:'Migraci může spustit jen owner.'},403,origin,allowed);
        for (const filename of FILES) await writeFile(env,filename,await readFile(env,filename),claims.sub);
        return json({ok:true,message:'Všechny týmové JSON soubory jsou zašifrované.'},200,origin,allowed);
      }
      return json({error:'Nenalezeno.'},404,origin,allowed);
    } catch (err) { return json({error:err.message||'Chyba služby.'},500,origin,allowed); }
  }
};

function cors(origin,allowed){return {'Access-Control-Allow-Origin':allowed==='*'?'*':(origin===allowed?origin:allowed),'Access-Control-Allow-Methods':'GET,POST,PUT,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Vary':'Origin'}}
function json(data,status,origin,allowed){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...cors(origin,allowed),'Cache-Control':'no-store'}})}
function repoPath(env,name){return [env.DATA_PATH||'',name].filter(Boolean).join('/')}
async function github(env,name,method='GET',data=null){const path=repoPath(env,name),base='https://api.github.com/repos/'+encodeURIComponent(env.REPO_OWNER)+'/'+encodeURIComponent(env.REPO_NAME)+'/contents/'+path.split('/').map(encodeURIComponent).join('/'),headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+env.GITHUB_TOKEN,'X-GitHub-Api-Version':'2022-11-28'};let sha;const existing=await fetch(base+'?ref='+encodeURIComponent(env.REPO_BRANCH||'main'),{headers});if(existing.ok)sha=(await existing.json()).sha;else if(existing.status!==404)throw Error('GitHub read '+existing.status);if(method==='GET')return existing.status===404?null:existing;const content=utf8ToBase64(await encrypt(JSON.stringify(data),env.DATA_ENCRYPTION_KEY));const response=await fetch(base,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({message:'Update '+name+' from Freezers ESPORT',content,...(sha?{sha}:{}),branch:env.REPO_BRANCH||'main'})});if(!response.ok)throw Error('GitHub write '+response.status+': '+(await response.text()).slice(0,180));return response}
async function readFile(env,name){const response=await github(env,name);if(!response)return structuredClone(DEFAULTS[name]);const result=await response.json(),text=base64ToUtf8(result.content.replace(/\n/g,'')),parsed=JSON.parse(text);if(parsed&&parsed.encrypted===true&&parsed.algorithm==='AES-GCM')return JSON.parse(await decrypt(parsed,env.DATA_ENCRYPTION_KEY));return parsed}
async function writeFile(env,name,data,actor){const envelope=await encrypt(JSON.stringify(data),env.DATA_ENCRYPTION_KEY);return github(env,name,'PUT',{encrypted:true,algorithm:'AES-GCM',version:1,...envelope})}
async function getKey(secret){if(!/^[0-9a-f]{64}$/i.test(secret||''))throw Error('DATA_ENCRYPTION_KEY musí být 64 hex znaků.');return crypto.subtle.importKey('raw',fromHex(secret),{name:'AES-GCM'},false,['encrypt','decrypt'])}
async function encrypt(text,secret){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await getKey(secret),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text));return {iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(cipher))}}
async function decrypt(envelope,secret){const key=await getKey(secret),plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64(envelope.iv)},key,fromBase64(envelope.ciphertext));return new TextDecoder().decode(plain)}
async function verifyPassword(password,user){if(!user.salt||!user.passwordHash)return false;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']),bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:fromHex(user.salt),iterations:user.iterations||600000,hash:'SHA-256'},key,256);return constantTime(toHex(new Uint8Array(bits)),user.passwordHash)}
function constantTime(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function sign(claims,secret){const data=toBase64Url(new TextEncoder().encode(JSON.stringify(claims))),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']),sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data));return data+'.'+toBase64Url(new Uint8Array(sig))}
async function authenticate(request,env){const value=request.headers.get('Authorization')||'',match=value.match(/^Bearer (.+)$/);if(!match)return null;const [data,signature]=match[1].split('.');if(!data||!signature)return null;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);if(!await crypto.subtle.verify('HMAC',key,fromBase64Url(signature),new TextEncoder().encode(data)))return null;const claims=JSON.parse(new TextDecoder().decode(fromBase64Url(data)));return claims.exp>Date.now()/1000?claims:null}
function fromHex(s){return Uint8Array.from((s.match(/.{2}/g)||[]),x=>parseInt(x,16))}function toHex(bytes){return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('')}
function toBase64(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}function fromBase64(s){return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}function toBase64Url(bytes){return toBase64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}function fromBase64Url(s){return fromBase64(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4))}function utf8ToBase64(s){return toBase64(new TextEncoder().encode(s))}function base64ToUtf8(s){return new TextDecoder().decode(fromBase64(s))}
function onlyOwnChanges(before,after,username,filename){const user=String(username).toLowerCase();for(const id of new Set([...Object.keys(before||{}),...Object.keys(after||{})])){const a=before?.[id]||{},b=after?.[id]||{};for(const key of new Set([...Object.keys(a),...Object.keys(b)])){if(key.toLowerCase()===user)continue;if(JSON.stringify(a[key])!==JSON.stringify(b[key]))return false}const ownKey=Object.keys(b).find(k=>k.toLowerCase()===user);const ownValue=ownKey?b[ownKey]:undefined;if(filename==='rsvps.json'&&ownValue!==undefined&&!['yes','no','excused'].includes(ownValue))return false;if(filename==='excuses.json'&&ownValue!==undefined&&typeof ownValue!=='object')return false;if(filename==='attendance.json'&&ownValue!==undefined&&ownValue!=='excused')return false}}return true}
