import {handler} from '../server/public.mjs';
// Explicit rewrite carrier avoids relying on a CDN preserving the original pathname.
export default async function vercelHandler(req,res){
 const url=new URL(req.url,'https://fan-pool-eta.vercel.app');
 if(url.pathname==='/api/server'){
  const paths=url.searchParams.getAll('__fp_path');
  if(paths.length!==1||!/^[-a-zA-Z0-9/]+$/.test(paths[0])||paths[0].includes('//')){res.writeHead(404).end();return;}
  url.pathname='/api/'+paths[0];url.searchParams.delete('__fp_path');req.url=url.pathname+url.search;
 }
 return handler(req,res);
}
