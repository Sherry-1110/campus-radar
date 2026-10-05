import { assertPublicUrl } from './original-fetch.ts'
import { load } from 'cheerio'
import { createHash } from 'node:crypto'
import { record, text, string } from './sources/shared.ts'
import type { Candidate, SourceResult } from './types.ts'
import type { Decision, Detail } from './semantic.ts'

type Page = { html: string; url: string }
type FetchPage = (url: string) => Promise<Page>
const managed = ['description', 'cover_image_url', 'source_url'] as const
// Accents folded: the alt text "Pokemon Fossil Museum" names the event "Pokémon Fossil Museum".
const words = (s: string) => text(s).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(w=>!['the','a','an','and','of','at','for','in','with'].includes(w))
function matches(a: string, b: string) {
  const x=words(a), y=new Set(words(b))
  return x.length>0 && (x.join(' ')===[...y].join(' ') || x.length>=3 && x.filter(w=>y.has(w)).length/x.length>=0.8)
}
function descriptionMatches(reference: string, passage: string) {
  const pairs=(s:string)=>{const w=words(s);return new Set(w.slice(1).map((v,i)=>`${w[i]} ${v}`))}
  const expected=pairs(reference), actual=pairs(passage)
  // ponytail: conservative text corroboration for shortened titles; dedicated parsers
  // are still needed when an organizer rewrites both the title and description.
  return expected.size>=16 && [...expected].filter(pair=>actual.has(pair)).length/expected.size>=0.75
}
export function link(value: unknown, base: string): string | null {
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
export function image(value: unknown, base: string): string | null {
  const v=Array.isArray(value)?value[0]:value
  const u=link(typeof v==='object'?record(v).url||record(v).contentUrl:v,base)
  if(u && new URL(u).hostname==='cdn.addevent.com' && /\/(?:libs\/imgs|web\/images)\//.test(new URL(u).pathname)) return null
  // Site-wide share images (a university thumbnail, a logo) say nothing about the event.
  return u && !/logo|favicon|placeholder|default[-_ ]?image|thumbnail|[-_]thumb\.|\/icons?\//i.test(new URL(u).pathname) ? u : null
}

// events.description holds at most 5000 characters; cut long organizer pages at a word.
const fit = (s: string) => s.length<=5000 ? s : s.slice(0,4999).replace(/\s+\S*$/,'')+'…'
const homepage = (url: string) => /^\/(?:home|index\.html?)?$/i.test(new URL(url).pathname)
// A homepage named after the event (chicagomarathon.com for "Bank of America Chicago Marathon") is the event's own site.
const ownSite = (url: string, title: string) => {
  const name=new URL(url).hostname.replace(/^www\./,'').split('.')[0]!, ws=words(title).filter(w=>w.length>=4)
  return homepage(url) && ws.length>0 && ws.filter(w=>name.includes(w)).length>=Math.min(2,ws.length)
}

/**
 * On a listing page that names this event among others, the picture in the event's own block:
 * the nearest enclosing element that holds its title, one heading at most, and an image.
 */
export function nearbyImage(html: string, pageUrl: string, title: string): string | null {
  const $ = load(html)
  // Compare meaningful words only: "Tuesdays: Karaoke" is the block for "CANCELLED: Tuesday Karaoke in Luna's Pub!".
  const terms = (s: string) => [...new Set(words(s).map(w => w.length > 4 ? w.replace(/s$/, '') : w)
    .filter(w => w.length > 2 && !/^(?:cancel+ed|postponed|(?:mon|tues|wednes|thurs|fri|satur|sun)day|night|event|series|weekly|annual|free)$/.test(w)))]
  const want = new Set(terms(title))
  if (!want.size) return null
  for (const el of $('h1,h2,h3,h4,h5,strong,em,a').toArray()) {
    const label = text($(el).html())
    if (label.length > 160) continue
    const heading = terms(label)
    const shared = heading.filter(w => want.has(w)).length
    // Most of the heading is in the title, and it covers a fair part of the title.
    if (!shared || shared / heading.length < 0.6 || shared / want.size < 0.25) continue
    const usable = (scope: ReturnType<typeof $>) => scope.find('img').addBack('img').toArray()
      .map(img => image($(img).attr('data-src') || $(img).attr('src'), pageUrl))
      .filter((url): url is string => Boolean(url && !/\.svg(?:$|\?)/i.test(url)))
    // A card: the nearest enclosing block with exactly one picture (a subtitle or two is fine).
    let box = $(el)
    for (let level = 0; level < 4; level++) {
      box = box.parent()
      if (!box.length || box.find('h1,h2,h3,h4').length > 3) break
      const pictures = usable(box)
      if (pictures.length === 1) return pictures[0]!
      if (pictures.length > 1) break
    }
    // A flat page: the first picture after the heading, before the next heading of the same rank or higher.
    if (/^h[1-5]$/.test(el.tagName)) {
      const rank = Number(el.tagName[1])
      for (const next of $(el).nextAll().toArray().slice(0, 8)) {
        if (/^h[1-6]$/.test(next.tagName) && Number(next.tagName[1]) <= rank) break
        const pictures = usable($(next))
        if (pictures.length) return pictures[0]!
      }
    }
  }
  return null
}
export function nodes(value: unknown): Record<string, unknown>[] {
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

function captioned($: ReturnType<typeof load>, pageUrl: string, title: string) {
  const name=words(title).join(' ')
  return $('img[alt]').toArray().map(el=>words($(el).attr('alt')!).join(' ')===name?image($(el).attr('data-src')||$(el).attr('src'),pageUrl):null).find(Boolean)??null
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
  const body=$('article .sidearm-story-body, .sidearm-story-body, [itemprop="articleBody"], article').first().clone()
  const content=body.length?body:$('main,[role="main"]').first().clone()
  content.find('script,style,nav,header,footer,aside,form,button,[aria-hidden="true"],.section-sponsors,.section-text-cta,.section-cards,.section-large-cards').remove()
  const titleWords=new Set(words(heading))
  const corroborated=$('article').length===1 && words(item.data.title).some(w=>w.length>=4 && !['campus','event','events','calendar'].includes(w) && titleWords.has(w))
    && body.find('p').toArray().some(el=>descriptionMatches(item.data.description||'',text($(el).html())))
  const pageMatches=matches(item.data.title,heading)||matches(item.data.title,$('h1').first().text())||corroborated||ownSite(pageUrl,item.data.title)
  if(!event && !pageMatches) {
    // Not this event's own page, but perhaps a listing that shows it: borrow its picture only if it has none.
    const nearby=item.data.cover_image_url||homepage(pageUrl)?null:nearbyImage(html,pageUrl,item.data.title)
    // A card or link titled exactly like the event leads to its own page on the same site: follow it.
    const titled=(label:string)=>matches(item.data.title,label)&&words(label).length<=words(item.data.title).length+3
    const own=$('a[href]').toArray().find(a=>$(a).find('*').addBack().toArray().some(el=>titled($(el).text())))
    const page=own?link($(own).attr('href'),pageUrl):null
    const next=page&&page!==pageUrl&&new URL(page).hostname===new URL(pageUrl).hostname?[page]:[]
    // A listing is not the event's page: keep the calendar's own link as the source.
    return nearby||next.length?{description:null,image:nearby,next,listing:true}:null
  }
  let article=text(content.html())
  if(/\btickets?\b/i.test(heading)) {
    // ponytail: omit premium ticket sales sections from the fallback description;
    // semantic selection handles less conventional sales-page headings.
    let section=''
    const passages:string[]=[]
    for(const el of content.find('h1,h2,h3,h4,h5,h6,p,li').toArray()) {
      const node=$(el),value=text(node.html())
      if(/^h[1-6]$/.test(el.tagName)){section=value;continue}
      if(node.is('li')&&node.find('p,li').length)continue
      if(value.length>=30 && !/vip|deluxe|backstage|consignment|group rates/i.test(section) && !passages.includes(value))passages.push(value)
    }
    article=passages.join('\n\n')
  }
  // Visible article content is often newer than stale article metadata.
  const structuredDescription=text(event?.description)
  const description=pageMatches && (!structuredDescription || /(?:…|\.{3})$/.test(structuredDescription)) && article.length>=80 && article.length>structuredDescription.length ? article : structuredDescription || text($('meta[property="og:description"]').attr('content')||$('meta[name="description"]').attr('content'))
  const titleTokens=words(item.data.title),year=occurrence.slice(0,4)
  const visiblePoster=content.find('img').toArray().map(el=>{
    const n=$(el),url=image(n.attr('data-src'),pageUrl)||image(n.attr('src'),pageUrl)
    const context=`${n.attr('alt')||''} ${url?new URL(url).pathname.split('/').pop():''}`
    const tokens=new Set(words(context))
    // Prefer explicitly identified event art, never arbitrary photos or past-year posters.
    return url && /poster|lineup|admat/i.test(context) && !/presale/i.test(context)
      && ![...tokens].some(w=>/^20\d\d$/.test(w)&&w!==year)
      && titleTokens.filter(w=>tokens.has(w)).length>=Math.min(2,titleTokens.length) ? url : null
  }).find(Boolean)
  const poster=(pageMatches?visiblePoster:null)||image(event?.image,pageUrl)||(pageMatches&&(!homepage(pageUrl)||ownSite(pageUrl,item.data.title))?image($('meta[property="og:image"]').attr('content'),pageUrl):null)
    // No share image: a picture captioned with the event's own name, such as an exhibition's hero image.
    // Lazy-loading sites keep the real <img> inside <noscript>, so read it as markup here.
    ||(pageMatches?captioned(load(html,{scriptingEnabled:false}),pageUrl,item.data.title):null)
    // The page is about this event but offers no specific share image: use the picture beside its title.
    ||(item.data.cover_image_url?null:nearbyImage(html,pageUrl,item.data.title))
  const next=event?[event.url,...(Array.isArray(event.sameAs)?event.sameAs:[event.sameAs])].map(v=>link(v,pageUrl)).filter((v):v is string=>Boolean(v&&v!==pageUrl)):[]
  for(const a of content.find('a[href]').toArray()) {
    if(/^(?:more (?:info(?:rmation)?|details)|full details|event website|official (?:event|website)|learn more)$/i.test(text($(a).text()))) {
      const target=link($(a).attr('href'),pageUrl)
      if(target && target!==pageUrl) next.unshift(target)
    }
  }
  return { description:description||null,image:poster,next:[...new Set(next)] }
}

export async function enrichSource(result: SourceResult, fetchPage: FetchPage, now=new Date(), semantic?:{mode:'shadow'|'apply';select:(html:string,url:string,item:Candidate)=>Promise<Decision>}): Promise<SourceResult> {
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
  // ponytail: at most 400 distinct pages / 8 minutes per source. Nearest events go first;
  // daily ties rotate. Add a persistent queue if this limit prevents useful coverage.
  const date=now.toISOString().slice(0,10)
  const eligible=items.filter(i=>i.related_url && Date.parse(i.data.end_time||i.data.start_time)>=now.getTime()-86400000 && Date.parse(i.data.start_time)<=now.getTime()+180*86400000)
  const priority=(i:Candidate)=>Date.parse(i.data.end_time||i.data.start_time)<now.getTime()?Infinity:Math.max(now.getTime(),Date.parse(i.data.start_time))
  eligible.sort((a,b)=>priority(a)-priority(b))
  const counts=new Map<string,number>(),ranks=new Map<Candidate,number>()
  for(const item of eligible){const count=counts.get(item.related_url!)||0;ranks.set(item,count);counts.set(item.related_url!,count+1)}
  // Visit each organizer before repeats so one long-running series cannot exhaust the AI budget.
  eligible.sort((a,b)=>ranks.get(a)!-ranks.get(b)! || priority(a)-priority(b) || createHash('sha256').update(date+a.related_url).digest('hex').localeCompare(createHash('sha256').update(date+b.related_url).digest('hex')))
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
          let extracted:(Detail&{listing?:boolean})|null=extractDetail(page.html,page.url,item)
          if(semantic) {
            const decision=await semantic.select(page.html,page.url,item)
            ;(item.semantic??=[]).push(decision.audit)
            if(semantic.mode==='apply') {
              if(decision.audit.outcome==='failed'){failed=true;details.failed++}
              if(decision.audit.outcome==='deferred'){failed=true;details.skipped++}
              // A model rejection/uncertainty never falls through to weaker matching.
              // On service/budget failure the existing rules remain available.
              if(!['failed','deferred'].includes(decision.audit.outcome)) extracted=decision.detail
            }
          }
          if(!extracted) break
          const known=words(item.data.description||'').join(' ')
          const extra=(extracted.description||'').split(/\n{2,}/).filter(p=>{
            const normalized=words(p).join(' ')
            return normalized.length>15 && !known.includes(normalized) && !/^updated:|print friendly/i.test(p)
          }).join('\n\n')
          if(extra.length>=60){
            // Keep calendar restrictions, append only new organizer paragraphs.
            item.data.description=fit([item.data.description,`Organizer details:\n${extra.replace(/<img\b[^>]*>/g,'')}`].filter(Boolean).join('\n\n'))
            fields.add('description')
          }
          if(extracted.image){item.data.cover_image_url=extracted.image;fields.add('cover_image_url')}
          if(!extracted.listing){item.data.source_url=page.url;fields.add('source_url')}
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
