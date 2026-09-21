import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enrichSource, extractDetail } from '../src/enrichment.ts'
import type { Candidate } from '../src/types.ts'
const item: Candidate = { external_id:'1',related_url:'https://organizer.org/event/concert',data:{title:'Student Chamber Concert',description:'Short calendar note.',cover_image_url:null,start_time:'2026-09-25T00:00:00Z',end_time:null,location:null,location_url:null,is_free:false,fee_text:null,category:'music',is_cancelled:false,is_all_day:false,source_url:'https://calendar.org/event/1'} }
const html = (event: object) => `<script type="application/ld+json">${JSON.stringify(event)}</script>`
const event = {'@type':'MusicEvent',name:item.data.title,startDate:'2026-09-24T19:00:00-05:00',description:'A detailed program with three student ensembles and a reception after the concert.',image:'/poster.jpg',url:'https://organizer.org/event/concert'}
test('matches event details, follows explicit event links, and retains occurrence identity and schedule', async()=>{
  let fetches=0
  const result=await enrichSource({items:[item,{...item,external_id:'2'}],warnings:[]},async url=>{fetches++;return {url,html:html(event)}},new Date('2026-09-20'))
  assert.equal(fetches,1,'Repeated occurrences share a page fetch')
  assert.equal(result.items[0].data.cover_image_url,'https://organizer.org/poster.jpg')
  assert.equal(result.items[0].data.start_time,item.data.start_time)
  assert.equal(result.items[0].listing_url,item.data.source_url)
  assert.equal(result.items[0].data.source_url,item.related_url)
  assert.equal(result.items[0].external_id,'1')
  assert.equal(result.details?.enriched,2)
})
test('rejects unrelated structured events, dates, generic logos, and follows only matching event links',()=>{
  assert.equal(extractDetail(html({...event,name:'Unrelated event'})+'<meta property="og:image" content="/logo.png">',item.related_url!,item),null)
  assert.equal(extractDetail(html({...event,startDate:'2024-01-01'})+`<meta property="og:title" content="${item.data.title}">`,item.related_url!,item),null)
  assert.equal(extractDetail(html({...event,image:'/logo.png'}),item.related_url!,item)?.image,null)
  const detail=extractDetail(html({'@type':'Organization',sameAs:'https://social.org/profile'})+html(event),item.related_url!,item)
  assert.deepEqual(detail?.next,[])
})
test('uses matching article body over stale metadata and keeps failures separate from base sync',async()=>{
  const page='<meta property="og:title" content="Student Chamber Concert"><meta property="og:description" content="Old"><article><h1>Student Chamber Concert</h1><nav>Ignore me</nav><p>The full updated concert program and admission details are available here.</p></article>'
  assert.match(extractDetail(page,item.related_url!,item)!.description!,/full updated/)
  const failed=await enrichSource({items:[item],warnings:[]},async()=>{throw Error('HTTP 503')},new Date('2026-09-20'))
  assert.equal(failed.items[0].data.description,item.data.description)
  assert.equal(failed.items[0].enrichment?.status,'unavailable')
  assert.equal(failed.details?.failed,1)
})
test('bounds link traversal and preserves the best verified page when a deeper page fails',async()=>{
  const result=await enrichSource({items:[item],warnings:[]},async url=>{
    if(url.endsWith('/next')) throw Error('404')
    return {url,html:html({...event,url:'https://organizer.org/next'})}
  },new Date('2026-09-20'))
  assert.equal(result.items[0].data.cover_image_url,'https://organizer.org/poster.jpg')
  assert.equal(result.details?.failed,1)
})

test('matches UTC instants on their Chicago day and excludes generic provider images',()=>{
  const candidate={...item,data:{...item.data,start_time:'2026-09-25T01:00:00Z'}}
  assert.ok(extractDetail(html({...event,startDate:'2026-09-25T01:00:00Z'}),item.related_url!,candidate))
  assert.equal(extractDetail(html({...event,image:'https://cdn.addevent.com/web/images/opengraph-image.png'}),item.related_url!,item)?.image,null)
})
test('follows explicitly labeled more-info links only after matching the parent event',()=>{
  const page=`<meta property="og:title" content="${item.data.title}"><article><a href="/full">More information</a><a href="/tickets">Buy tickets</a></article>`
  assert.deepEqual(extractDetail(page,item.related_url!,item)?.next,['https://organizer.org/full'])
})

test('matches a short event heading despite site branding and reads main content',()=>{
  const candidate={...item,data:{...item.data,title:'Dinos!'}}
  const page='<title>Dinos! | Events at Brookfield Zoo Chicago</title><meta property="og:title" content="Dinos! | Events at Brookfield Zoo Chicago"><meta property="og:image" content="/dinos.png"><main><h1>Dinos!</h1><p>Meet life-size dinosaurs throughout the zoo and dig for fossils on the weekends. Included with zoo admission.</p><a href="/events/dinos/full">More info</a><nav>Other attractions</nav><section class="section-sponsors"><p>Our generous corporate sponsors</p></section><section class="section-text-cta"><p>Buy a membership today for extra rewards</p></section></main>'
  const detail=extractDetail(page,item.related_url!,candidate)
  assert.match(detail?.description||'',/dig for fossils/)
  assert.equal(detail?.image,'https://organizer.org/dinos.png')
  assert.deepEqual(detail?.next,['https://organizer.org/events/dinos/full'])
  assert.doesNotMatch(detail?.description||'',/corporate sponsors|extra rewards/)
  assert.equal(extractDetail(page.replace('<h1>Dinos!</h1>','<h1>Other attractions</h1>'),item.related_url!,candidate),null)
})

test('prefers the current lineup poster to presale art and excludes ticket upsells',()=>{
  const candidate={...item,data:{...item.data,title:'Riot Fest 2026'}}
  const page='<meta property="og:title" content="Riot Fest 2026 Tickets"><meta property="og:image" content="/RIOT-FEST-2026-PRESALE.jpg"><main><h1>Riot Fest 2026 Tickets</h1><img src="/Riot_2025_ADMAT.jpg"><img src="/Riot_2026_SINGLE-DAY-ADMAT.jpg"><h2>General Admission</h2><p>Daily festival entry includes over 90 artists, complimentary water stations and arcade games.</p><h3>VIP</h3><p>Premium lounge upgrades with a private bar and exclusive concierge services.</p></main>'
  const detail=extractDetail(page,item.related_url!,candidate)!
  assert.equal(detail.image,'https://organizer.org/Riot_2026_SINGLE-DAY-ADMAT.jpg')
  assert.match(detail.description!,/90 artists/)
  assert.doesNotMatch(detail.description!,/concierge/)
  assert.equal(extractDetail(page.replace('/Riot_2026_SINGLE-DAY-ADMAT.jpg','/uploads/2025/12/Riot_2026_SINGLE-DAY-ADMAT.jpg'),item.related_url!,candidate)?.image,
    'https://organizer.org/uploads/2025/12/Riot_2026_SINGLE-DAY-ADMAT.jpg','Upload year is not the event year')
})

test('prioritizes explicit More info over alternate calendar URLs in structured data',()=>{
  const page=html({...event,url:'https://calendar.org/event/1?view=full'})+`<article><h1>${item.data.title}</h1><a href="https://organizer.org/full">More info</a></article>`
  assert.equal(extractDetail(page,'https://calendar.org/event/1',item)?.next[0],'https://organizer.org/full')
})

test('uses the full visible description when structured metadata is only a teaser',()=>{
  const page=html({...event,description:'A detailed program…'})+'<article><h1>Student Chamber Concert</h1><p>A detailed program with three student ensembles and a reception after the concert. Doors open at six.</p></article>'
  assert.match(extractDetail(page,item.related_url!,item)!.description!,/Doors open at six/)
})

test('corroborates shortened organizer titles with specific calendar description text',async()=>{
  const candidate={...item,external_id:'645684',related_url:'https://sheilcatholiccenter.org/worship/mass/',data:{...item.data,
    title:'Catholic Mass, Evanston Campus',
    description:"During the academic year, Mass is celebrated on Sundays at 9:30 a.m., 11:00 a.m., and 5:00 p.m. in Sheil's Evanston chapel located at 2110 Sheridan Road."}}
  const sunday="Evanston Campus: During the academic year, Mass is celebrated on Sundays at 9:30 a.m. (livestreamed here), 11:00 a.m., and 5:00 p.m. in Sheil's Evanston chapel."
  const weekday="Evanston Campus: During the academic year, Mass is celebrated Monday through Friday at 5:00 p.m. in Sheil's Evanston chapel."
  const page=`<meta property="og:title" content="Mass - Sheil Catholic Center"><meta property="og:image" content="/mass-photo.jpg"><article><h1>Mass</h1><h2>Sunday Mass</h2><p>${sunday}</p><h2>Weekday Mass</h2><p>${weekday}</p><h2>Prepare for Your Visit</h2><p>Weekend parking is available in the Northwestern lot across Sheridan Road.</p></article>`
  const result=await enrichSource({items:[candidate],warnings:[]},async url=>({url,html:page}),new Date('2026-09-20'))
  assert.equal(result.items[0].data.cover_image_url,'https://sheilcatholiccenter.org/mass-photo.jpg')
  assert.match(result.items[0].data.description!,/Weekend parking/)
  assert.equal(result.items[0].data.start_time,candidate.data.start_time)
  assert.equal(result.items[0].data.source_url,candidate.related_url)
  assert.equal(extractDetail(page.replace(`<p>${sunday}</p>`,''),candidate.related_url,candidate),null,'Weekday schedule alone does not corroborate Sunday Mass')
  assert.equal(extractDetail(page.replace('Mass - Sheil Catholic Center','Campus news'),candidate.related_url,candidate),null,'Shared boilerplate cannot override an unrelated page title')
  assert.equal(extractDetail(page+html({...event,name:candidate.data.title,startDate:'2024-01-01'}),candidate.related_url,candidate),null,'Contradictory structured event dates still reject the page')
})
