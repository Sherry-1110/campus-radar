import { assertPublicUrl } from './original-fetch.ts'
import { load } from 'cheerio'
import { createHash } from 'node:crypto'
import { record, text, string } from './sources/shared.ts'
import type { Candidate, SourceResult } from './types.ts'

type Page = { html: string; url: string }
type FetchPage = (url: string) => Promise<Page>
const managed = ['description', 'cover_image_url', 'source_url'] as const
const words = (s: string) => text(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(w=>!['the','a','an','and','of','at','for','in','with'].includes(w))
function matches(a: string, b: string) {
  const x=words(a), y=new Set(words(b))
  return x.length>0 && (x.join(' ')===[...y].join(' ') || x.length>=3 && x.filter(w=>y.has(w)).length/x.length>=0.8)
}
function link(value: unknown, base: string): string | null {
  const raw=string(value).trim()
  if(!raw) return null
  try {
    const u=new URL(load('<textarea></textarea>').root().find('textarea').html(raw).text(),base)
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password) return null
    u.protocol='https:'; u.hash=''
    const keys=[...u.searchParams.keys()]
    for(const key of keys) if(/^utm_|^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key)
    return assertPublicUrl(u.href).href
  } catch { return null }
}
function image(value: unknown, base: string): string | null {
  const v=Array.isArray(value)?value[0]:value
  const u=link(typeof v==='object'?record(v).url||record(v).contentUrl:v,base)
  if(u && new URL(u).hostname==='cdn.addevent.com' && /\/(?:libs\/imgs|web\/images)\//.test(new URL(u).pathname)) return null
  return u && !/logo|favicon|placeholder|default[-_ ]?image/i.test(new URL(u).pathname) ? u : null
}
function nodes(value: unknown): Record<string, unknown>[] {
  if(Array.isArray(value)) return value.flatMap(nodes)
  const r=record(value)
  return [r,...nodesArray(r['@graph']),...nodesArray(r.mainEntity)]
}
function nodesArray(value: unknown) { return value && typeof value==='object' ? nodes(value) : [] }
const chicagoDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'})
function day(value: unknown) {
  const raw=string(value)
  if(!/^\d{4}-\d\d-\d\d/.test(raw)) return null
  return /(?:Z|[+-]\d\d:\d\d)$/.test(raw) && Number.isFinite(Date.parse(raw)) ? chicagoDay.format(new Date(raw)) : raw.slice(0,10)
}

export function extractDetail(html: string, pageUrl: string, item: Candidate) {
  const $=load(html)
  const data=$('script[type="application/ld+json"]').toArray().flatMap(el=>{try{return nodes(JSON.parse($(el).text()))}catch{return []}})
  const events=data.filter(n=>(Array.isArray(n['@type'])?n['@type']:[n['@type']]).some(t=>string(t).endsWith('Event')))
  const named=events.filter(n=>matches(item.data.title,string(n.name)))
  const occurrence=chicagoDay.format(new Date(item.data.start_time))
  const matching=named.filter(n=>{const start=day(n.startDate),end=day(n.endDate)||start;return !start || start<=occurrence && end!>=occurrence})
  // Multiple matching records can describe different performances. Do not guess.
  const event=matching.length===1?matching[0]:undefined
  if(events.length && !event) return null
  const heading=$('meta[property="og:title"]').attr('content')||$('h1').first().text()||$('title').text()
  if(!event && !matches(item.data.title,heading)) return null
  const body=$('article .sidearm-story-body, .sidearm-story-body, [itemprop="articleBody"], article').first().clone()
  body.find('script,style,nav,header,footer,aside,form,button,[aria-hidden="true"]').remove()
  const article=text(body.html())
  // Visible article content is often newer than stale article metadata.
  const description=event ? text(event.description) : article.length>=80 ? article : text($('meta[property="og:description"]').attr('content')||$('meta[name="description"]').attr('content'))
  const poster=image(event?.image,pageUrl)||(matches(item.data.title,heading)?image($('meta[property="og:image"]').attr('content'),pageUrl):null)
  const next=event?[event.url,...(Array.isArray(event.sameAs)?event.sameAs:[event.sameAs])].map(v=>link(v,pageUrl)).filter((v):v is string=>Boolean(v&&v!==pageUrl)):[]
  for(const a of body.find('a[href]').toArray()) {
    if(/^(?:more (?:info(?:rmation)?|details)|full details|event website|official (?:event|website)|learn more)$/i.test(text($(a).text()))) {
      const target=link($(a).attr('href'),pageUrl)
      if(target && target!==pageUrl) next.push(target)
    }
  }
  return { description:description||null,image:poster,next:[...new Set(next)] }
}

export async function enrichSource(result: SourceResult, fetchPage: FetchPage, now=new Date()): Promise<SourceResult> {
  const items=structuredClone(result.items)
  const details={checked:0,enriched:0,failed:0,skipped:0}
  const cache=new Map<string,Promise<Page>>()
  const hosts=new Map<string,Promise<unknown>>()
  const started=Date.now()
  const warnings:string[]=[]
  const get=(url:string):Promise<Page>=>{
    let page=cache.get(url)
    if(!page){
      const host=new URL(url).hostname
      const previous=hosts.get(host)||Promise.resolve()
      page=previous.catch(()=>{}).then(()=>{
        if(Date.now()-started>8*60_000) throw Error('Detail time budget reached')
        return fetchPage(url)
      })
      hosts.set(host,page);cache.set(url,page)
    }
    return page
  }
  // ponytail: at most 400 distinct pages / 8 minutes per source. Daily ordering rotates
  // overflow fairly; add a persistent queue only if this limit prevents useful coverage.
  const date=now.toISOString().slice(0,10)
  const eligible=items.filter(i=>i.related_url && Date.parse(i.data.end_time||i.data.start_time)>=now.getTime()-86400000 && Date.parse(i.data.start_time)<=now.getTime()+180*86400000)
  eligible.sort((a,b)=>createHash('sha256').update(date+a.related_url).digest('hex').localeCompare(createHash('sha256').update(date+b.related_url).digest('hex')))
  let index=0
  await Promise.all(Array.from({length:4},async()=>{
    while(index<eligible.length){
      const item=eligible[index++]!
      item.listing_url=item.data.source_url
      const base=Object.fromEntries(managed.map(k=>[k,item.data[k]]))
      const chain:string[]=[]
      const fields=new Set<typeof managed[number]>()
      let target=link(item.related_url!,item.data.source_url)
      let failed=false
      for(let depth=0;target && depth<2 && !chain.includes(target);depth++){
        if(!cache.has(target) && (cache.size>=400||Date.now()-started>8*60_000)){details.skipped++;break}
        if(!depth) details.checked++
        try{
          const page=await get(target);chain.push(page.url)
          const extracted=extractDetail(page.html,page.url,item)
          if(!extracted) break
          const known=words(item.data.description||'').join(' ')
          const extra=(extracted.description||'').split(/\n{2,}/).filter(p=>{
            const normalized=words(p).join(' ')
            return normalized.length>15 && !known.includes(normalized) && !/^updated:|print friendly/i.test(p)
          }).join('\n\n')
          if(extra.length>=60){
            // Keep calendar restrictions, append only new organizer paragraphs.
            item.data.description=[item.data.description,`Organizer details:\n${extra}`].filter(Boolean).join('\n\n')
            fields.add('description')
          }
          if(extracted.image){item.data.cover_image_url=extracted.image;fields.add('cover_image_url')}
          item.data.source_url=page.url;fields.add('source_url')
          target=extracted.next[0]||null
        }catch{
          failed=true;details.failed++
          // Do not log arbitrary organizer URLs: they can contain registration tokens.
          break
        }
      }
      if(fields.size) details.enriched++
      item.enrichment={status:failed||!fields.size?'unavailable':'enriched',fields:[...fields],base,chain}
    }
  }))
  // Mark unvisited linked occurrences too, so persisted enrichment survives seasonal windows.
  for(const item of items) if(item.related_url && !item.enrichment) item.enrichment={status:'unavailable',fields:[],base:{},chain:[]}
  if(details.failed) warnings.push(`${details.failed} original-page checks failed; calendar updates continue and previous verified details are retained`)
  if(details.skipped) warnings.push(`${details.skipped} original-page checks deferred by the per-run budget`)
  return {...result,items,warnings:[...result.warnings,...warnings],details}
}
