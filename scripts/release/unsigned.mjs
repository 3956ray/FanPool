// Offline encoder only. Output can be inspected before a separately authorized wallet request.
import {readFile} from 'node:fs/promises';import {ContractFactory,Interface,getAddress} from 'ethers';
const pack=JSON.parse(await readFile('docs/deployment/contracts.json')), [action,token,wallet]=process.argv.slice(2);let transaction;
if(action==='token')transaction=await new ContractFactory(pack.contracts.MockUSDC.abi,pack.contracts.MockUSDC.creationBytecode).getDeployTransaction();
else if(action==='factory')transaction=await new ContractFactory(pack.contracts.FanPoolFactory.abi,pack.contracts.FanPoolFactory.creationBytecode).getDeployTransaction(getAddress(token));
else if(action==='mint')transaction={to:getAddress(token),data:new Interface(pack.contracts.MockUSDC.abi).encodeFunctionData('mint',[getAddress(wallet),1000000000n])};
else throw Error('Usage: node scripts/release/unsigned.mjs token | factory <verified-token> | mint <verified-token> <wallet>');
console.log(JSON.stringify({chainId:'0x279f',value:'0x0',...transaction}));
