'use strict';
const path=require('node:path'),net=require('node:net'),{createRequire}=require('node:module');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const load=createRequire(path.join(root,'package.json'));
load('dotenv').config({path:path.join(root,'.env')});
const {createClient}=load('@supabase/supabase-js');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const seed=process.argv.includes('--seed'),portArg=process.argv.find(a=>a.startsWith('--port=')),port=portArg?Number(portArg.split('=')[1]):3003;
async function listening(){return new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port});const finish=value=>{socket.destroy();resolve(value);};socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(1000,()=>finish(true));});}
(async()=>{
  if(seed&&await listening())throw new Error('Stop the current RetailFlow server before seeding weighted products.');
  const {data,error}=await db.rpc('rf_seed_weight_demo',{p_check_only:!seed});
  if(error)throw new Error('Weighted-products database setup is not ready. Run sql/weighted-products.sql in the RetailFlow Supabase SQL Editor first.');
  if(!seed&&(!data?.ready||data.scale!==100))throw new Error('Unexpected measurement configuration.');
  if(seed&&data?.demo_products!==6)throw new Error('Unexpected demo setup result. Keep the old server stopped and check the database setup.');
  if(seed){
    const {data:demoRows,error:demoError}=await db.from('rf_product_measures').select('product_id,kind').eq('is_demo',true).in('product_id',['DGW001','DGW002','DGW003','DGW004','DGO001','DGO002']);
    if(demoError||demoRows?.length!==6)throw new Error('Cannot verify demo products before assigning category names.');
    for(const [kind,category] of [['wood','العود | Oud'],['oil','دهون العود | Oud Oils']]){
      const ids=demoRows.filter(row=>row.kind===kind).map(row=>row.product_id);
      if(ids.length!==(kind==='wood'?4:2))throw new Error('Unexpected demo product kinds.');
      const {data:updated,error:categoryError}=await db.from('products').update({category}).in('product_id',ids).select('product_id');
      if(categoryError||updated?.length!==ids.length)throw new Error('Could not assign demo category names. Keep the updated code and rerun this installer.');
    }
  }
  console.log(JSON.stringify(seed?{seeded:true,demo_products:data.demo_products,through:data.through}:{ready:true,scale:data.scale,ounce_grams:data.ounce_grams}));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
