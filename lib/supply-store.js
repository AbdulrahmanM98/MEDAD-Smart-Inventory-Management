'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=function supplyStore(dataDir){
  const file=path.join(dataDir,'supply-requests.json');
  function read(){if(!fs.existsSync(file))return [];const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.schema!==1||!Array.isArray(value.requests))throw new Error('Invalid supply data.');return value.requests;}
  function change(fn){
    fs.mkdirSync(dataDir,{recursive:true});
    // Exclusive lock prevents two local Node processes from overwriting requests.
    let lock;try{lock=fs.openSync(file+'.lock','wx',0o600);}catch{throw Object.assign(new Error('Supply data is busy. Retry shortly.'),{status:503});}
    try{const rows=read(),result=fn(rows),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify({schema:1,requests:rows},null,2),{mode:0o600});fs.renameSync(temp,file);return result;}
    finally{fs.closeSync(lock);fs.unlinkSync(file+'.lock');}
  }
  return {read,change};
};
