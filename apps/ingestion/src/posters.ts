import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { fetchPublicFile } from './original-fetch.ts'

export async function normalizePoster(body: Buffer): Promise<Buffer> {
  const image=sharp(body,{limitInputPixels:40_000_000,failOn:'error'}).timeout({seconds:10})
  const meta=await image.metadata()
  if(!['jpeg','png','webp','gif','heif','tiff'].includes(meta.format||''))throw Error('Poster must be a raster image')
  const webp=await image.rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer()
  if(webp.length>5*1024*1024)throw Error('Converted poster exceeds storage limit')
  return webp
}

async function downloadPoster(url:string):Promise<Buffer>{
  const {body}=await fetchPublicFile(url,['image/jpeg','image/png','image/webp','image/gif','image/avif','image/tiff','application/octet-stream'],20*1024*1024)
  return normalizePoster(body)
}

export async function storePosters(client:SupabaseClient, urls:string[], download=downloadPoster, maxDurationMs=Infinity){
  const deadline=Date.now()+maxDurationMs
  const bucket=client.storage.from('event-posters')
  const prefix=bucket.getPublicUrl('').data.publicUrl
  const pending=[...new Set(urls)].filter(url=>!url.startsWith(prefix))
  const report={total:pending.length,uploaded:0,reused:0,failed:0,deferred:0,events_updated:0,failures:[] as Array<{url:string;error:string}>}
  const known=new Map<string,string>()
  for(let offset=0;offset<pending.length;offset+=500){
    const {data,error}=await client.rpc('get_event_poster_copies',{p_urls:pending.slice(offset,offset+500)})
    if(error)throw Error(`Cannot read poster cache: ${error.code}`)
    for(const item of data as Array<{source_url:string;stored_url:string}>)known.set(item.source_url,item.stored_url)
  }
  let next=0, completed=0
  await Promise.all(Array.from({length:6},async()=>{
    while(next<pending.length){
      if(Date.now()>=deadline){report.deferred+=pending.length-next;next=pending.length;break}
      const source=pending[next++]!
      // ponytail: immutable per source URL; a changed URL stores a new version.
      const path=`imported/${createHash('sha256').update(source).digest('hex')}.webp`
      const stored=known.get(source)||bucket.getPublicUrl(path).data.publicUrl
      if(known.has(source))report.reused++
      else{
        let body:Buffer
        try{body=await download(source)}catch(error){
          report.failed++
          // Reports must not accidentally expose token-bearing query strings.
          let safe='invalid URL';try{const u=new URL(source);safe=u.origin+u.pathname}catch{/* invalid source */}
          report.failures.push({url:safe,error:error instanceof Error?error.message.slice(0,200):'Download failed'})
          continue
        }
        const {error}=await bucket.upload(path,body,{contentType:'image/webp',cacheControl:'31536000',upsert:false})
        // A concurrent importer or interrupted backfill may already have uploaded this exact path.
        if(error&& !('statusCode' in error&&String(error.statusCode)==='409'))throw Error(`Poster upload failed: ${error.message}`)
        report.uploaded++
      }
      const {data,error}=await client.rpc('remember_event_poster',{p_source_url:source,p_storage_path:path,p_stored_url:stored})
      if(error)throw Error(`Cannot register stored poster: ${error.code}`)
      report.events_updated+=Number(data)
      if(++completed%100===0)console.log(`Poster storage: ${completed} stored/reused, ${report.failed} unavailable, ${pending.length} total`)
    }
  }))
  return report
}

async function main(){
  const {values}=parseArgs({options:{apply:{type:'boolean',default:false}}})
  if(!values.apply)throw Error('Backfill requires --apply')
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url||!key||key.startsWith('sb_publishable_'))throw Error('Backfill requires backend Supabase credentials')
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const urls:string[]=[]
  let after=''
  for(;;){
    let query=client.from('events').select('id,cover_image_url').not('cover_image_url','is',null).order('id').limit(1000)
    if(after)query=query.gt('id',after)
    const {data,error}=await query
    if(error)throw Error(`Cannot read event posters: ${error.code}`)
    if(!data.length)break
    urls.push(...data.map(item=>item.cover_image_url as string))
    after=data.at(-1)!.id
  }
  console.log(`Storing ${new Set(urls).size} distinct poster URLs`)
  const report=await storePosters(client,urls)
  await writeFile('poster-report.json',JSON.stringify(report,null,2)+'\n')
  const {failures:_,...totals}=report
  console.log(JSON.stringify(totals))
}
if(import.meta.main)main().catch(error=>{console.error(error instanceof Error?error.message:'Poster backfill failed');process.exitCode=1})
