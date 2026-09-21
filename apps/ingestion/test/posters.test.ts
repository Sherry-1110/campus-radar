import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'

// Removing raster decoding/limits would allow HTML/SVG into the public poster bucket.
test('stored posters are decoded, resized and stripped to a bounded WebP', async () => {
  const { normalizePoster } = await import('../src/posters.ts')
  const png=await sharp({create:{width:2400,height:1200,channels:3,background:'#123456'}}).png().toBuffer()
  const converted=await normalizePoster(png)
  const meta=await sharp(converted).metadata()
  assert.equal(meta.format,'webp'); assert.equal(meta.width,1600); assert.equal(meta.height,800)
  await assert.rejects(normalizePoster(Buffer.from('<html>error</html>')))
  await assert.rejects(normalizePoster(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"></svg>')), /raster/)
})

test('poster copies are reused, failed downloads leave URLs untouched, and uploads precede registration', async t => {
  const { storePosters } = await import('../src/posters.ts')
  const copies=new Map<string,string>(), objects=new Set<string>()
  const client=createClient('https://project.supabase.co','backend-test-key',{global:{fetch:async (input,init)=>{
    const url=String(input),body=typeof init?.body==='string'?JSON.parse(init.body):null
    if(url.includes('/rpc/get_event_poster_copies'))return Response.json(body.p_urls.filter((u:string)=>copies.has(u)).map((u:string)=>({source_url:u,stored_url:copies.get(u)})))
    if(url.includes('/storage/v1/object/event-posters/')){objects.add(url.split('/event-posters/')[1]);return Response.json({Key:'stored'})}
    if(url.includes('/rpc/remember_event_poster')){
      assert.ok(objects.has(body.p_storage_path),'Do not switch the database before upload succeeds')
      copies.set(body.p_source_url,body.p_stored_url);return Response.json(1)
    }
    throw Error('Unexpected request')
  }}})
  const webp=await sharp({create:{width:10,height:10,channels:3,background:'#123456'}}).webp().toBuffer()
  let downloads=0
  const download=async (url:string)=>{downloads++;if(url.endsWith('/bad'))throw Error('HTTP 404');return webp}
  const urls=['https://images.example.com/good','https://images.example.com/good','https://images.example.com/bad']
  const first=await storePosters(client,urls,download)
  assert.equal(first.uploaded,1); assert.equal(first.failed,1); assert.equal(copies.size,1)
  assert.match(copies.get(urls[0])!,/^https:\/\/project.supabase.co\/storage\/v1\/object\/public\/event-posters\/imported\/[a-f0-9]{64}\.webp$/)
  assert.equal((await storePosters(client,[urls[0],copies.get(urls[0])!],download)).reused,1)
  assert.equal(downloads,2,'A repeated URL or own-storage URL must not be downloaded again')
  let now=0
  t.mock.method(Date,'now',()=>now)
  const bounded=await storePosters(client,Array.from({length:10},(_,n)=>`https://images.example.com/later${n}`),async()=>{now=100;return webp},50)
  assert.equal(bounded.uploaded,1)
  assert.equal(bounded.deferred,9,'Nightly image delays must leave time for event reconciliation')
})
