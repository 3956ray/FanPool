import {sourceVerifier} from '../../web/source.mjs';
export function chainVerifier(provider,config){const verify=sourceVerifier(provider,config);return async(pool,tx)=>(await verify(pool,tx)).organizer;}
