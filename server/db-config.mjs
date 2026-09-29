import {X509Certificate} from 'node:crypto';
// Parse into explicit pg fields: URL query options can never override TLS.
export function databaseOptions(value,caPem,{allowLocal=false,hosted=false}={}){
 let url;try{url=new URL(value);}catch{throw Error('Invalid database URL');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.search||url.hash)throw Error('Database URL must not contain query/SSL overrides or fragment');
 const host=url.hostname.replace(/^\[|\]$/g,'');
 if(!host||!url.username||!url.pathname.slice(1)||url.pathname.slice(1).includes('/'))throw Error('Database URL requires host, user and database');
 let user,password,database;try{user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);database=decodeURIComponent(url.pathname.slice(1));}catch{throw Error('Invalid database URL encoding');}
 const local=['127.0.0.1','localhost','::1'].includes(host);
 let ssl;
 if(local){if(!allowLocal||hosted||caPem)throw Error('Loopback database requires explicit local-only mode');ssl=false;}
 else{
  if(typeof caPem==='string')caPem=caPem.replace(/\\n/g,'\n').trim()+'\n';
  if(typeof caPem!=='string'||!/^\s*-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(caPem))throw Error('DB_CA_PEM required for remote database');
  try{const cert=new X509Certificate(caPem);if(!cert.ca)throw Error('not CA');}catch{throw Error('DB_CA_PEM must be a valid CA certificate');}
  ssl={ca:caPem,rejectUnauthorized:true};
 }
 return {host,port:Number(url.port||5432),user,password,database,ssl};
}
