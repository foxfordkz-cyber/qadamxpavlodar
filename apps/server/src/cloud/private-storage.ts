import { createHash } from 'node:crypto';
import { ApiError } from '../errors.js';
import { MAX_PHOTO_BYTES } from '../photos.js';

export type StoredPhoto = { name: string; sha256: string; byteSize: number };
export type StorageConfig = { origin: string; bucket: string; serviceKey: string; allowedHosts: string[]; localTest?:boolean };
const unavailable=()=>new ApiError(503,'PHOTO_UNAVAILABLE','Private storage unavailable or integrity check failed');
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

// Internal storage primitive only. Task/report authorization must happen before invoking this adapter.
// Cloud routes recheck task scope before using this service-only adapter; no public URLs are returned.
export class SupabasePrivateStorage {
  private readonly origin:string;
  constructor(private readonly config:StorageConfig,private readonly transport:typeof fetch=fetch) {
    const url=new URL(config.origin);
    const loopbackTest=config.localTest===true&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.protocol==='http:';
    if((url.protocol!=='https:'&&!loopbackTest)||url.origin!==config.origin||url.username||url.password||!config.allowedHosts.includes(url.hostname))
      throw Error('Storage requires a fixed, allowlisted HTTPS origin');
    if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(config.bucket)||!config.serviceKey)throw Error('Storage bucket and server credential are required');
    this.origin=url.origin;
  }
  private name(value:string) {
    if(!/^demo\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/.test(value))
      throw new ApiError(400,'INVALID_STORAGE_NAME','Use a server-generated photo object name');
    return value;
  }
  private async call(path:string,init:RequestInit={}) {
    try {
      return await this.transport(this.origin+'/storage/v1/'+path,{...init,redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{...init.headers,apikey:this.config.serviceKey,Authorization:`Bearer ${this.config.serviceKey}`}});
    } catch {throw unavailable();}
  }
  async verifyPrivateBucket() {
    const res=await this.call('bucket/'+this.config.bucket);
    if(!res.ok)throw unavailable();
    let value:any;try{value=await res.json();}catch{throw unavailable();}
    if(value.public!==false||!Number.isInteger(value.file_size_limit)||value.file_size_limit>MAX_PHOTO_BYTES||value.file_size_limit<1||
      !Array.isArray(value.allowed_mime_types)||value.allowed_mime_types.length!==1||value.allowed_mime_types[0]!=='image/webp')
      throw new ApiError(503,'UNSAFE_STORAGE_BUCKET','Bucket must be private and restricted to image/webp up to 5 MiB');
  }
  async put(name:string,normalizedWebp:Buffer):Promise<StoredPhoto> {
    this.name(name);
    if(!normalizedWebp.length||normalizedWebp.length>MAX_PHOTO_BYTES||normalizedWebp.subarray(0,4).toString()!=='RIFF'||normalizedWebp.subarray(8,12).toString()!=='WEBP')
      throw new ApiError(415,'INVALID_PHOTO_TYPE','Supply normalized WebP bytes');
    await this.verifyPrivateBucket();
    const res=await this.call(`object/${this.config.bucket}/${name}`,{method:'POST',headers:{'Content-Type':'image/webp','x-upsert':'false'},body:new Uint8Array(normalizedWebp)});
    if(res.status===409)throw new ApiError(409,'STORAGE_OBJECT_EXISTS','Object already exists; reconcile the original upload before retrying');
    if(!res.ok)throw unavailable();
    return {name,sha256:digest(normalizedWebp),byteSize:normalizedWebp.length};
  }
  async remove(name:string):Promise<void> {
    this.name(name);await this.verifyPrivateBucket();
    const res=await this.call('object/'+this.config.bucket,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[name]})});
    if(!res.ok)throw unavailable();
  }
  async read(photo:StoredPhoto):Promise<Buffer> {
    this.name(photo.name);
    if(!Number.isInteger(photo.byteSize)||photo.byteSize<1||photo.byteSize>MAX_PHOTO_BYTES||!/^[0-9a-f]{64}$/.test(photo.sha256))throw unavailable();
    await this.verifyPrivateBucket();
    const res=await this.call(`object/authenticated/${this.config.bucket}/${photo.name}`);
    if(!res.ok||!res.body)throw unavailable();
    const reader=res.body.getReader(),parts:Uint8Array[]=[];let size=0;
    try {
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>photo.byteSize)throw unavailable();parts.push(value);}
    } catch {await reader.cancel().catch(()=>{});throw unavailable();}
    const bytes=Buffer.concat(parts);
    if(bytes.length!==photo.byteSize||digest(bytes)!==photo.sha256)throw unavailable();
    return bytes;
  }
}
