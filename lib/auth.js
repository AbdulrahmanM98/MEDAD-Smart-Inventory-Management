'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {promisify} = require('util');
const scrypt = promisify(crypto.scrypt);
const ROLES = ['admin','approver','warehouse','branch_manager','viewer'];
const publicUser = u => ({id:u.id,name:u.name,email:u.email,role:u.role,branch_id:u.branch_id,active:u.active});

function createAuth(app, {dataDir, db}) {
  fs.mkdirSync(dataDir,{recursive:true});
  const file = path.join(dataDir,'accounts.json');
  let users = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
  const sessions = new Map(), attempts = new Map();
  const save = () => { const temp=file+'.tmp'; fs.writeFileSync(temp,JSON.stringify(users,null,2),{mode:0o600}); fs.renameSync(temp,file); };
  const audit = (actor, action, details) => fs.appendFileSync(path.join(dataDir,'audit.jsonl'),JSON.stringify({at:new Date().toISOString(),actor:actor?.id||null,action,details})+'\n');
  const cookie = (req,res,id,maxAge=28800000) => res.cookie('rf_session',id,{httpOnly:true,sameSite:'strict',secure:req.secure,path:'/',maxAge});
  const resolve = req => {
    const token = /(?:^|;\s*)rf_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expires < Date.now()) { sessions.delete(token); return null; }
    return users.find(u=>u.id===session.userId&&u.active) || null;
  };
  const begin = (req,res,u) => {
    const id=crypto.randomBytes(32).toString('hex');
    sessions.set(id,{userId:u.id,expires:Date.now()+28800000}); cookie(req,res,id);
    return publicUser(u);
  };
  // Cookie authentication also requires same-origin JSON writes (CSRF protection).
  app.use('/api',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const origin=req.get('origin');
      if (origin && origin!==`${req.protocol}://${req.get('host')}`) return res.status(403).json({error:'Cross-origin writes are not allowed.'});
      if (!req.is('application/json')) return res.status(415).json({error:'Send application/json.'});
    }
    next();
  });
  const wrap = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
  app.get('/api/auth/config',(req,res)=>res.json({setup_required:users.length===0,roles:ROLES}));
  app.get('/api/auth/me',(req,res)=>{const u=resolve(req);res.json({user:u?publicUser(u):null});});
  function validate(body) {
    const email=String(body.email||'').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254) throw Object.assign(new Error('Enter a valid email.'),{status:400});
    if(typeof body.password!=='string'||body.password.length<12||body.password.length>128) throw Object.assign(new Error('Use a password with 12–128 characters.'),{status:400});
    const name=String(body.name||'').trim();
    if(!name||name.length>80) throw Object.assign(new Error('Name must be 1–80 characters.'),{status:400});
    return {email,name};
  }
  async function newUser(body,role,branch_id=null) {
    const fields=validate(body);
    const salt=crypto.randomBytes(16).toString('hex');
    const hash=(await scrypt(body.password,salt,64)).toString('hex');
    // Recheck after async hashing; this prevents concurrent duplicate accounts.
    if(users.some(u=>u.email===fields.email)) throw Object.assign(new Error('Email already exists.'),{status:409});
    return {id:crypto.randomUUID(),...fields,role,branch_id,active:true,salt,hash};
  }
  app.post('/api/auth/setup',wrap(async(req,res)=>{
    if(users.length) return res.status(409).json({error:'Setup has already been completed.'});
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !['localhost','127.0.0.1','::1','[::1]'].includes(req.hostname)) return res.status(403).json({error:'First administrator must be created on this computer through localhost.'});
    const u=await newUser(req.body,'admin');
    if(users.length) return res.status(409).json({error:'Setup has already been completed.'});
    users.push(u);save();audit(u,'account.setup',{});res.status(201).json({user:begin(req,res,u)});
  }));
  app.post('/api/auth/login',wrap(async(req,res)=>{
    const key=req.socket.remoteAddress;
    const recent=(attempts.get(key)||[]).filter(t=>t>Date.now()-900000);
    if(recent.length>=10) return res.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
    recent.push(Date.now());attempts.set(key,recent);
    const u=users.find(u=>u.email===String(req.body.email||'').trim().toLowerCase()&&u.active);
    const password=typeof req.body.password==='string'?req.body.password:'';
    if(password.length>128) return res.status(401).json({error:'Invalid email or password.'});
    const candidate=await scrypt(password,u?.salt||'retailflow-login-dummy-salt',64);
    if(!u||!crypto.timingSafeEqual(candidate,Buffer.from(u.hash,'hex'))) return res.status(401).json({error:'Invalid email or password.'});
    attempts.delete(key);audit(u,'account.login',{});res.json({user:begin(req,res,u)});
  }));
  app.post('/api/auth/logout',(req,res)=>{
    const token=/(?:^|;\s*)rf_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
    sessions.delete(token);cookie(req,res,'',0);res.json({ok:true});
  });
  app.use('/api',(req,res,next)=>{
    if(req.path==='/health')return next();
    const u=resolve(req);
    if(!u) return res.status(users.length?401:428).json({error:users.length?'Sign in to continue.':'Create the first administrator to continue.'});
    req.user=publicUser(u);next();
  });
  app.get('/api/admin/users',(req,res)=>{
    if(req.user.role!=='admin')return res.status(403).json({error:'Administrator access required.'});
    res.json({data:users.map(publicUser)});
  });
  app.post('/api/admin/users',wrap(async(req,res)=>{
    if(req.user.role!=='admin')return res.status(403).json({error:'Administrator access required.'});
    const {role,branch_id}=req.body;
    if(!ROLES.includes(role))return res.status(400).json({error:'Invalid role.'});
    if(role==='branch_manager'){
      const {data,error}=await db.from('branches').select('branch_id').eq('branch_id',branch_id||'').single();
      if(error||!data)return res.status(400).json({error:'Choose an existing branch.'});
    }
    const u=await newUser(req.body,role,role==='branch_manager'?branch_id:null);
    users.push(u);save();audit(req.user,'account.create',{userId:u.id,role,branch_id:u.branch_id});res.status(201).json({user:publicUser(u)});
  }));
  app.patch('/api/admin/users/:id',wrap(async(req,res)=>{
    if(req.user.role!=='admin')return res.status(403).json({error:'Administrator access required.'});
    const u=users.find(u=>u.id===req.params.id);
    if(!u)return res.status(404).json({error:'Account not found.'});
    if(typeof req.body.active!=='boolean')return res.status(400).json({error:'active must be a boolean.'});
    if(u.id===req.user.id&&!req.body.active)return res.status(400).json({error:'You cannot disable your own account.'});
    if(u.role==='admin'&&!req.body.active&&users.filter(x=>x.active&&x.role==='admin').length<=1)return res.status(400).json({error:'Keep at least one active administrator.'});
    u.active=req.body.active;save();
    for(const [token,session] of sessions)if(session.userId===u.id)sessions.delete(token);
    audit(req.user,'account.active',{userId:u.id,active:u.active});res.json({user:publicUser(u)});
  }));
  // Clean expired sessions and old login attempt buckets without extending login lifetimes.
  const timer=setInterval(()=>{
    for(const [key,s] of sessions)if(s.expires<Date.now())sessions.delete(key);
    for(const [key,list] of attempts)if(!list.some(t=>t>Date.now()-900000))attempts.delete(key);
  },60000);timer.unref();
  return {audit};
}
module.exports={createAuth};
