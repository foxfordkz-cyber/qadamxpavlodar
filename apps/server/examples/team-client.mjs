/** Backend-owned browser integration example. No mock, implicit retries or role headers. */
export function createBackendClient({base='/api/v1',fetchImpl=globalThis.fetch}={}) {
  let csrf='';
  async function request(method,path,{body,key,signal,binary=false}={}) {
    const headers=new Headers({Accept:binary?'*/*':'application/json'});
    const isForm=typeof FormData!=='undefined'&&body instanceof FormData;
    if(method!=='GET'&&method!=='HEAD'&&path!=='/auth/login')headers.set('X-CSRF-Token',csrf);
    if(key)headers.set('Idempotency-Key',key);
    if(body!==undefined&&!isForm)headers.set('Content-Type','application/json');
    const response=await fetchImpl(base+path,{method,credentials:'include',headers,body:body===undefined?undefined:isForm?body:JSON.stringify(body),signal:signal??AbortSignal.timeout(20000)});
    if(!response.ok){let errorBody;try{errorBody=await response.json();}catch{}const error=new Error(errorBody?.error?.message??`HTTP ${response.status}`);Object.assign(error,{status:response.status,code:errorBody?.error?.code,requestId:errorBody?.error?.requestId,details:errorBody?.error?.details});throw error;}
    if(binary)return response.blob();
    const envelope=await response.json();
    if(!Object.hasOwn(envelope,'data'))throw Error('Invalid {data,meta?} response');
    if(path==='/auth/login'||path==='/auth/me')csrf=envelope.data.csrfToken;
    if(path==='/auth/logout')csrf='';
    return envelope;
  }
  return {
    request,
    login:async(login,password)=>(await request('POST','/auth/login',{body:{login,password}})).data,
    session:async()=>(await request('GET','/auth/me')).data,
    logout:()=>request('POST','/auth/logout',{body:{}}),
    async listAll(path){const rows=[];let offset=0;while(true){const page=await request('GET',`${path}${path.includes('?')?'&':'?'}limit=100&offset=${offset}`);rows.push(...page.data);offset+=page.data.length;if(offset>=page.meta.total||page.data.length===0)return rows;}}
  };
}
