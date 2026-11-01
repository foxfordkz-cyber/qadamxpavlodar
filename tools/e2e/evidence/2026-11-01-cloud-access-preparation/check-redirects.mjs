import {writeFileSync} from 'node:fs';
const results=[];
for(const origin of ['https://green-pavlodar-api.pages.dev','https://a26bd214.green-pavlodar-api.pages.dev']){
 const response=await fetch(origin+'/index.html',{redirect:'manual',signal:AbortSignal.timeout(30000)});
 const location=response.headers.get('location');
 results.push({origin,path:'/index.html',status:response.status,canonicalRootRedirect:[301,302,307,308].includes(response.status)&&new URL(location,origin).href===origin+'/'});
 await response.body?.cancel();
}
const record={checkedAt:new Date().toISOString(),scope:'Diagnostic GET only; no cookies or authentication',results};
writeFileSync(new URL('./public-index-redirects.json',import.meta.url),JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify(record));
