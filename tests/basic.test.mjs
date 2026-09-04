// Run with: node --test tests/basic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const scriptMatch=html.match(/<script>\s*([\s\S]*?)\s*<\/script>/i);
assert.ok(scriptMatch,'Inline script in index.html not found');
const script=scriptMatch[1];

function createStorage(){
  const store=new Map();
  return {
    getItem:key=>store.has(key)?store.get(key):null,
    setItem:(key,value)=>store.set(key,String(value)),
    removeItem:key=>store.delete(key),
    clear:()=>store.clear()
  };
}

function makeFakeDate(nowIso){
  const RealDate=Date;
  return class FakeDate extends RealDate {
    constructor(...args){
      super(...(args.length?args:[nowIso]));
    }
    static now(){return new RealDate(nowIso).getTime();}
    static parse(value){return RealDate.parse(value);}
    static UTC(...args){return RealDate.UTC(...args);}
  };
}

class ClassList {
  constructor(el){this.el=el;this.set=new Set();}
  add(...names){names.forEach(n=>this.set.add(n));this.sync();}
  remove(...names){names.forEach(n=>this.set.delete(n));this.sync();}
  contains(name){return this.set.has(name);}
  toggle(name,force){
    if(force===undefined){this.set.has(name)?this.set.delete(name):this.set.add(name);} else if(force)this.set.add(name); else this.set.delete(name);
    this.sync();
  }
  sync(){this.el.attributes.class=[...this.set].join(' ');}
}

class Element {
  constructor(id=''){
    this.id=id;
    this.dataset={};
    this.style={};
    this.attributes={};
    this.classList=new ClassList(this);
    this.listeners={};
    this.innerHTML='';
    this.textContent='';
    this.value='';
    this.isConnected=true;
    this.onclick=null;
    this.clientWidth=0;
    this.scrollWidth=0;
  }
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='class'){this.classList.set=new Set(String(value).split(/\s+/).filter(Boolean));this.classList.sync();}}
  getAttribute(name){return Object.prototype.hasOwnProperty.call(this.attributes,name)?this.attributes[name]:null;}
  removeAttribute(name){delete this.attributes[name];}
  focus(){this.ownerDocument.activeElement=this;}
  querySelector(selector){return this._queries?.[selector]||null;}
  closest(selector){return selector==='a[aria-disabled="true"]'&&this.getAttribute('aria-disabled')==='true'?this:null;}
  scrollIntoView(){}
}

function buildSandbox(nowIso='2026-09-10T12:00:00Z'){
  const elements=new Map();
  const navButtons=['today','days','destinations','food','bookings','tagebuch','tips'].map(view=>{const el=new Element();el.dataset.view=view;return el;});
  const navEl=new Element('nav'); navEl.clientWidth=0; navEl.scrollWidth=0;
  const ids=['search','destSearch','foodSearch','destGrid','foodList','foodCatFilters','foodPriceFilters','bookingList','today','daysList','days','destinations','food','bookings','tagebuch','tips','offlineBanner','destModal','modalTitle','modalArea','modalText','modalImg','modalCredit','modalActions','foodModal','foodModalTitle','foodModalArea','foodModalTags','foodModalWhy','foodModalDishes','foodModalInfo','foodModalActions','destMapWrap','foodMapWrap','destMapOffline','foodMapOffline','destLocateMsg','foodLocateMsg','todayLocateMsg','destLocateBtn','foodLocateBtn','todayLocateBtn','timelineSummary','timelineResult','diaryDaySelect','diaryPrevDayBtn','diaryNextDayBtn','diaryStorageUsage','diaryRouteStats','diaryDaySuggestions','diaryMapWrap','diaryMap','diaryMapEmpty','diaryPhotoSummary','diaryPhotoGallery','diaryDayUnlocated','diaryUnassignedPhotos','photoPreviewModal','photoPreviewTitle','photoPreviewImg','photoPreviewMeta','photoPreviewActions'];
  for(const id of ids){elements.set(id,new Element(id));}
  for(const id of ['today','days','destinations','food','bookings','tagebuch','tips'])elements.get(id).classList.add('view');
  const body=new Element('body');
  const document={
    body,
    activeElement:body,
    addEventListener(){},
    createElement(tag){const el=new Element(tag);el.ownerDocument=document;return el;},
    getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));const el=elements.get(id);el.ownerDocument=document;return el;},
    querySelectorAll(selector){
      if(selector==='nav button')return navButtons;
      if(selector==='.view')return ['today','days','destinations','food','bookings','tagebuch','tips'].map(id=>document.getElementById(id));
      if(selector==='.dist-badge'||selector==='.schedule-dest img[data-dest]'||selector==='a[target="_blank"]')return [];
      return [];
    },
    querySelector(selector){
      if(selector==='nav')return navEl;
      if(selector==='.modal.show')return ['destModal','foodModal'].map(id=>document.getElementById(id)).find(el=>el.classList.contains('show'))||null;
      return null;
    }
  };
  body.ownerDocument=document;
  const destModal=document.getElementById('destModal');
  const foodModal=document.getElementById('foodModal');
  const destClose=new Element('destModalClose');
  const destBox=new Element('destModalBox');
  const foodClose=new Element('foodModalClose');
  const foodBox=new Element('foodModalBox');
  [destClose,destBox,foodClose,foodBox].forEach(el=>el.ownerDocument=document);
  destModal._queries={'.modalclose':destClose,'.modalbox':destBox};
  foodModal._queries={'.modalclose':foodClose,'.modalbox':foodBox};
  const storage=createStorage();
  const sandbox={
    console,
    document,
    localStorage:storage,
    navigator:{onLine:true,serviceWorker:{register:()=>Promise.resolve()},geolocation:{getCurrentPosition(){}}},
    window:{addEventListener(){},scrollY:0,pageYOffset:0,location:{href:''},scrollTo(x,y){this.scrollY=y;this.pageYOffset=y;}},
    fetch:()=>Promise.resolve({ok:false,json:()=>Promise.resolve({})}),
    setTimeout:fn=>{if(typeof fn==='function')fn();return 1;},
    clearTimeout(){},
    Date:makeFakeDate(nowIso),
    L:undefined,
    encodeURIComponent,
    decodeURIComponent,
    Promise,
    Map,
    Set,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Math,
    RegExp,
    JSON,
    Intl,
    URL,
    URLSearchParams,
    confirm:()=>true
  };
  sandbox.window.document=document;
  sandbox.globalThis=sandbox;
  vm.runInNewContext(`${script}\n;globalThis.__app={DAYS,DESTINATIONS,DAY_DESTS,DAY_DEST_MAIN,ITEM_DESTS,RESTAURANTS,FOOD_BY_ID,escapeHtml,mapsDir,mapsNav,mapsSearch,weather,actionLink,plainTextLines,parseItemTime,fallbackRouteTarget,nextRouteTarget,defaultDayIndex,selectDay,shiftDay,jumpToToday,isTodayInTrip,dayCard,openDestination,closeDestination,openRestaurant,closeRestaurant,selectedDayIndex:()=>selectedDayIndex,isVisited,toggleVisited,visitedDestCount,renderDestFilters,renderDestProgress,renderDestinations,setDestVisitedFilter,markerPopupHtml,destVisitedFilter:()=>destVisitedFilter,parseLatLngPair,extractTimelinePoints,inTripRange,timelinePointId,lisbonDateKey,normalizeTimelinePoint,prepareTimelinePoints,mergeTimelinePoints,distanceKm,simplifyRoutePoints,routeDistanceKm,parseJpegExif,parseExifDateString};`,sandbox,{filename:'index-inline.js'});
  return {app:sandbox.__app,sandbox,document,elements,storage};
}

function makeExifSampleJpeg(){
  const exifHeader=Buffer.from('Exif\0\0','binary');
  const tiff=Buffer.alloc(190);
  let o=0;
  tiff.write('II',o,'ascii'); o+=2;
  tiff.writeUInt16LE(42,o); o+=2;
  tiff.writeUInt32LE(8,o); o+=4;
  tiff.writeUInt16LE(3,o); o+=2;
  tiff.writeUInt16LE(0x0112,o); tiff.writeUInt16LE(3,o+2); tiff.writeUInt32LE(1,o+4); tiff.writeUInt16LE(6,o+8); o+=12;
  tiff.writeUInt16LE(0x8769,o); tiff.writeUInt16LE(4,o+2); tiff.writeUInt32LE(1,o+4); tiff.writeUInt32LE(50,o+8); o+=12;
  tiff.writeUInt16LE(0x8825,o); tiff.writeUInt16LE(4,o+2); tiff.writeUInt32LE(1,o+4); tiff.writeUInt32LE(88,o+8); o+=12;
  tiff.writeUInt32LE(0,o); o+=4;
  tiff.writeUInt16LE(1,50);
  tiff.writeUInt16LE(0x9003,52); tiff.writeUInt16LE(2,54); tiff.writeUInt32LE(20,56); tiff.writeUInt32LE(68,60);
  tiff.writeUInt32LE(0,64);
  Buffer.from('2026:09:07 10:15:30\0','ascii').copy(tiff,68);
  tiff.writeUInt16LE(4,88);
  tiff.writeUInt16LE(1,90); tiff.writeUInt16LE(2,92); tiff.writeUInt32LE(2,94); tiff.write('N\0',98,'ascii');
  tiff.writeUInt16LE(2,102); tiff.writeUInt16LE(5,104); tiff.writeUInt32LE(3,106); tiff.writeUInt32LE(142,110);
  tiff.writeUInt16LE(3,114); tiff.writeUInt16LE(2,116); tiff.writeUInt32LE(2,118); tiff.write('W\0',122,'ascii');
  tiff.writeUInt16LE(4,126); tiff.writeUInt16LE(5,128); tiff.writeUInt32LE(3,130); tiff.writeUInt32LE(166,134);
  tiff.writeUInt32LE(0,138);
  const rationals=[[37,1],[7,1],[24,1],[8,1],[39,1],[0,1]];
  let rr=142;
  rationals.forEach(([num,den])=>{tiff.writeUInt32LE(num,rr);tiff.writeUInt32LE(den,rr+4);rr+=8;});
  const app1Payload=Buffer.concat([exifHeader,tiff]);
  const app1=Buffer.alloc(4);
  app1.writeUInt16BE(0xFFE1,0);
  app1.writeUInt16BE(app1Payload.length+2,2);
  const jpeg=Buffer.concat([Buffer.from([0xFF,0xD8]),app1,app1Payload,Buffer.from([0xFF,0xD9])]);
  return jpeg.buffer.slice(jpeg.byteOffset,jpeg.byteOffset+jpeg.byteLength);
}

test('inline script is syntactically valid JavaScript',()=>{
  assert.doesNotThrow(()=>new Function(script));
});

test('trip contains exactly 14 selectable days',()=>{
  const {app}=buildSandbox();
  assert.equal(app.DAYS.length,14);
  for(const [index,day] of app.DAYS.entries()){
    assert.ok(day.date,`day ${index+1} needs a date`);
    assert.ok(day.label,`day ${index+1} needs a label`);
  }
});

test('prev/next day navigation clamps to trip boundaries',()=>{
  const {app}=buildSandbox();
  app.selectDay(-3);
  assert.equal(app.selectedDayIndex(),0);
  app.shiftDay(-1);
  assert.equal(app.selectedDayIndex(),0);
  app.selectDay(app.DAYS.length-1);
  app.shiftDay(1);
  assert.equal(app.selectedDayIndex(),app.DAYS.length-1);
});

test('jump-to-today control only appears during the actual trip date range',()=>{
  const inRange=buildSandbox('2026-09-10T12:00:00Z');
  assert.equal(inRange.app.isTodayInTrip(),true);
  inRange.app.selectDay(0);
  assert.match(inRange.document.getElementById('today').innerHTML,/Zu heute springen/);

  const outOfRange=buildSandbox('2026-09-25T12:00:00Z');
  assert.equal(outOfRange.app.isTodayInTrip(),false);
  outOfRange.app.selectDay(0);
  assert.doesNotMatch(outOfRange.document.getElementById('today').innerHTML,/Zu heute springen/);
});

test('destination references are not dangling',()=>{
  const {app}=buildSandbox();
  const destIds=new Set(app.DESTINATIONS.map(d=>d.id));
  Object.values(app.DAY_DEST_MAIN).forEach(id=>assert.ok(destIds.has(id),`missing DAY_DEST_MAIN id ${id}`));
  Object.values(app.DAY_DESTS).flat().forEach(id=>assert.ok(destIds.has(id),`missing DAY_DESTS id ${id}`));
  Object.values(app.ITEM_DESTS).forEach(map=>Object.values(map).flat().forEach(id=>assert.ok(destIds.has(id),`missing ITEM_DESTS id ${id}`)));
});

test('restaurant references are not dangling',()=>{
  const {app}=buildSandbox();
  const restaurantIds=new Set(app.RESTAURANTS.map(r=>r.id));
  app.DAYS.flatMap(day=>day.restaurants||[]).forEach(id=>assert.ok(restaurantIds.has(id),`missing restaurant id ${id}`));
});

test('route and map links avoid empty destinations and fixed origins',()=>{
  const {app}=buildSandbox('2026-09-07T14:30:00Z');
  const dir=app.mapsDir('Monchique Portugal');
  assert.ok(dir);
  assert.doesNotMatch(dir,/origin=/);
  assert.equal(new URL(dir).searchParams.get('destination'),'Monchique Portugal');
  assert.equal(app.mapsDir('   '),null);
  assert.equal(app.mapsSearch(''),null);
  const target=app.nextRouteTarget(app.DAYS.find(day=>day.date==='2026-09-07'));
  assert.ok(target?.map);
  const navUrl=app.mapsNav(target.map);
  assert.ok(navUrl);
  assert.ok(new URL(navUrl).searchParams.get('destination'));
  const searchUrl=app.mapsSearch(target.map);
  assert.ok(new URL(searchUrl).searchParams.get('query'));
});

test('time parsing understands ranges, prefixes and day-parts',()=>{
  const {app}=buildSandbox();
  assert.equal(app.parseItemTime('09:00–12:00'),540);
  assert.equal(app.parseItemTime('09:00-12:00'),540);
  assert.equal(app.parseItemTime('ab 09:00'),540);
  assert.equal(app.parseItemTime('ca. 09:00'),540);
  assert.equal(app.parseItemTime('Vormittag'),540);
  assert.equal(app.parseItemTime('Mittag'),720);
  assert.equal(app.parseItemTime('Nachmittag'),900);
  assert.equal(app.parseItemTime('Abend'),1140);
  assert.equal(app.parseItemTime('danach',540),570);
});

test('notes rendering escapes HTML without changing storage semantics',()=>{
  const {app,storage}=buildSandbox();
  const attack='<img src=x onerror=alert(1)>';
  assert.equal(storage.getItem('note-2026-09-06'),null);
  storage.setItem('note-2026-09-06',attack);
  const htmlCard=app.dayCard(app.DAYS[0],true,false);
  assert.match(htmlCard,/&lt;img/);
  assert.doesNotMatch(htmlCard,/<img src=x onerror=alert\(1\)>/);
});

test('destination and restaurant modals exist and open/close hooks are wired',()=>{
  const {app,document}=buildSandbox();
  assert.match(html,/id="destModal"/);
  assert.match(html,/id="foodModal"/);
  assert.equal(typeof app.openDestination,'function');
  assert.equal(typeof app.openRestaurant,'function');

  app.openDestination('faro-altstadt');
  assert.equal(document.getElementById('destModal').classList.contains('show'),true);
  assert.equal(document.getElementById('destModal').getAttribute('aria-hidden'),'false');
  app.closeDestination();
  assert.equal(document.getElementById('destModal').classList.contains('show'),false);

  app.openRestaurant('imperio');
  assert.equal(document.getElementById('foodModal').classList.contains('show'),true);
  assert.equal(document.getElementById('foodModal').getAttribute('aria-hidden'),'false');
  app.closeRestaurant();
  assert.equal(document.getElementById('foodModal').classList.contains('show'),false);
});

test('all 28 destinations have deepened facts and background text',()=>{
  const {app}=buildSandbox();
  assert.equal(app.DESTINATIONS.length,28);
  for(const d of app.DESTINATIONS){
    assert.ok(Array.isArray(d.facts),`${d.id} facts should be an array`);
    assert.ok(d.facts.length>=1&&d.facts.length<=3,`${d.id} should have 1-3 fact chips`);
    for(const f of d.facts)assert.ok(typeof f==='string'&&f.trim().length>0,`${d.id} fact chip should be non-empty`);
    assert.equal(typeof d.deep,'string',`${d.id} should have a deep-dive text`);
    const words=d.deep.trim().split(/\s+/).filter(Boolean);
    assert.ok(words.length>=80&&words.length<=130,`${d.id} deep text should be ~80-130 words, got ${words.length}`);
  }
});

test('destination modal detail section exists, is closed by default and reflects the opened destination',()=>{
  assert.match(html,/id="modalDeepDetails"/);
  assert.doesNotMatch(html,/id="modalDeepDetails"[^>]*\bopen\b/,'detail section markup must not default to open');
  const {app,document}=buildSandbox();

  app.openDestination('faro-altstadt');
  const details=document.getElementById('modalDeepDetails');
  assert.equal(details.open,false,'details must be closed after opening a destination');
  assert.equal(document.getElementById('modalDeepText').textContent,app.DESTINATIONS.find(d=>d.id==='faro-altstadt').deep);
  const factsHtml=document.getElementById('modalFacts').innerHTML;
  for(const f of app.DESTINATIONS.find(d=>d.id==='faro-altstadt').facts)assert.match(factsHtml,new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));

  details.open=true;
  app.openDestination('arco-vila');
  assert.equal(details.open,false,'switching destinations must close a previously open detail section');
  assert.equal(document.getElementById('modalDeepText').textContent,app.DESTINATIONS.find(d=>d.id==='arco-vila').deep);
});

test('destination search finds new facts and deep-dive text',()=>{
  const {app,document}=buildSandbox();
  document.getElementById('destSearch').value='neoklassizismus';
  app.renderDestinations();
  const html2=document.getElementById('destGrid').innerHTML;
  assert.match(html2,/Arco da Vila/);

  document.getElementById('destSearch').value='syenit';
  app.renderDestinations();
  assert.match(document.getElementById('destGrid').innerHTML,/Fóia/);
});

test('visited toggle persists per destination and updates the progress counter',()=>{
  const {app,storage}=buildSandbox();
  const id=app.DESTINATIONS[0].id;
  assert.equal(app.isVisited(id),false);
  assert.equal(app.visitedDestCount(),0);
  app.toggleVisited(id);
  assert.equal(storage.getItem('visited-dest-'+id),'1');
  assert.equal(app.isVisited(id),true);
  assert.equal(app.visitedDestCount(),1);
  app.toggleVisited(id);
  assert.equal(storage.getItem('visited-dest-'+id),'0');
  assert.equal(app.isVisited(id),false);
  assert.equal(app.visitedDestCount(),0);
});

test('destination progress indicator reports "x von N Zielen besucht"',()=>{
  const {app,document}=buildSandbox();
  app.renderDestinations();
  assert.equal(document.getElementById('destProgress').textContent,`0 von ${app.DESTINATIONS.length} Zielen besucht`);
  app.toggleVisited(app.DESTINATIONS[0].id);
  app.toggleVisited(app.DESTINATIONS[1].id);
  app.renderDestinations();
  assert.equal(document.getElementById('destProgress').textContent,`2 von ${app.DESTINATIONS.length} Zielen besucht`);
});

test('Alle/Offen/Besucht filter chips render and filter the destination grid',()=>{
  const {app,document}=buildSandbox();
  app.renderDestFilters();
  const filterHtml=document.getElementById('destFilters').innerHTML;
  assert.match(filterHtml,/Alle/);
  assert.match(filterHtml,/Offen/);
  assert.match(filterHtml,/Besucht/);

  const visitedId=app.DESTINATIONS[0].id;
  const openId=app.DESTINATIONS[1].id;
  app.toggleVisited(visitedId);

  app.setDestVisitedFilter('Besucht');
  assert.equal(app.destVisitedFilter(),'Besucht');
  app.renderDestinations();
  let gridHtml=document.getElementById('destGrid').innerHTML;
  assert.match(gridHtml,new RegExp(`data-id="${visitedId}"`));
  assert.doesNotMatch(gridHtml,new RegExp(`data-id="${openId}"`));

  app.setDestVisitedFilter('Offen');
  app.renderDestinations();
  gridHtml=document.getElementById('destGrid').innerHTML;
  assert.doesNotMatch(gridHtml,new RegExp(`data-id="${visitedId}"`));
  assert.match(gridHtml,new RegExp(`data-id="${openId}"`));

  app.setDestVisitedFilter('Alle');
  app.renderDestinations();
  gridHtml=document.getElementById('destGrid').innerHTML;
  assert.match(gridHtml,new RegExp(`data-id="${visitedId}"`));
  assert.match(gridHtml,new RegExp(`data-id="${openId}"`));
});

test('marker popup exposes a visited toggle that reflects and flips state',()=>{
  const {app}=buildSandbox();
  const d=app.DESTINATIONS[0];
  let popup=app.markerPopupHtml(d);
  assert.match(popup,/aria-pressed="false"/);
  assert.match(popup,/○ Noch nicht besucht/);
  assert.match(popup,new RegExp(`toggleVisited\\('${d.id}'\\)`));

  app.toggleVisited(d.id);
  popup=app.markerPopupHtml(d);
  assert.match(popup,/aria-pressed="true"/);
  assert.match(popup,/✓ Besucht/);
});

test('Tagebuch: parses "lat, lng" style coordinate strings in various notations',()=>{
  const {app}=buildSandbox();
  const a=app.parseLatLngPair('37.123456, -8.654321');
  assert.equal(a.lat,37.123456);
  assert.equal(a.lng,-8.654321);
  const b=app.parseLatLngPair('37.123456°, -8.654321°');
  assert.equal(b.lat,37.123456);
  assert.equal(b.lng,-8.654321);
  assert.equal(app.parseLatLngPair('not-a-coordinate'),null);
  assert.equal(app.parseLatLngPair(null),null);
});

test('Tagebuch: extracts points from the legacy Google Takeout Records.json format',()=>{
  const {app}=buildSandbox();
  const data={locations:[
    {latitudeE7:371234567,longitudeE7:-86543210,timestampMs:'1757260800000'},
    {latitude:37.5,longitude:-8.7,timestamp:'2026-09-08T10:00:00Z'},
    {latitudeE7:371234567}
  ]};
  const points=app.extractTimelinePoints(data);
  assert.equal(points.length,2);
  assert.ok(Math.abs(points[0].lat-37.1234567)<1e-6);
  assert.ok(Math.abs(points[0].lng-(-8.654321))<1e-6);
  assert.equal(points[1].timestamp,'2026-09-08T10:00:00Z');
});

test('Tagebuch: extracts points from the current semanticSegments/rawSignals Timeline export',()=>{
  const {app}=buildSandbox();
  const data={
    semanticSegments:[
      {startTime:'2026-09-07T09:00:00Z',endTime:'2026-09-07T09:30:00Z',timelinePath:[{point:'37.01°, -8.41°',time:'2026-09-07T09:05:00Z'}]},
      {startTime:'2026-09-09T12:00:00Z',visit:{topCandidate:{placeLocation:'37.10, -8.67'}}}
    ],
    rawSignals:[{position:{LatLng:'37.20, -8.90',timestamp:'2026-09-10T08:00:00Z'}}]
  };
  const points=app.extractTimelinePoints(data);
  assert.equal(points.length,3);
  assert.ok(points.some(p=>p.timestamp==='2026-09-07T09:05:00Z'&&Math.abs(p.lat-37.01)<1e-6));
  assert.ok(points.some(p=>p.timestamp==='2026-09-09T12:00:00Z'&&Math.abs(p.lng-(-8.67))<1e-6));
  assert.ok(points.some(p=>p.timestamp==='2026-09-10T08:00:00Z'));
});

test('Tagebuch: only keeps points within the actual trip period 06.–19.09.2026',()=>{
  const {app}=buildSandbox();
  assert.equal(app.inTripRange('2026-09-06T00:00:00Z'),true);
  assert.equal(app.inTripRange('2026-09-19T22:59:59Z'),true);
  assert.equal(app.inTripRange('2026-09-05T22:59:59Z'),false);
  assert.equal(app.inTripRange('2026-09-19T23:00:00Z'),false);
  assert.equal(app.inTripRange('not-a-date'),false);
});

test('Tagebuch: point id is stable for identical coordinates + timestamp (dedup key)',()=>{
  const {app}=buildSandbox();
  const a={lat:37.1234561,lng:-8.654321,timestamp:'2026-09-07T09:05:00Z'};
  const b={lat:37.123456,lng:-8.654321,timestamp:'2026-09-07T10:05:00+01:00'};
  assert.equal(app.timelinePointId(a),app.timelinePointId(b));
  const c={...b,timestamp:'2026-09-07T09:06:00Z'};
  assert.notEqual(app.timelinePointId(b),app.timelinePointId(c));
});

test('Tagebuch: Lisbon-local day key and trip range honor local midnight boundaries',()=>{
  const {app}=buildSandbox();
  assert.equal(app.lisbonDateKey('2026-09-05T22:59:59Z'),'2026-09-05');
  assert.equal(app.lisbonDateKey('2026-09-05T23:00:01Z'),'2026-09-06');
  assert.equal(app.lisbonDateKey('2026-09-05T23:30:00Z'),'2026-09-06');
  assert.equal(app.inTripRange('2026-09-05T22:59:59Z'),false);
  assert.equal(app.inTripRange('2026-09-05T23:00:01Z'),true);
});

test('Tagebuch: invalid coordinates are rejected before dedup/storage prep',()=>{
  const {app}=buildSandbox();
  const prepared=app.prepareTimelinePoints([
    {lat:91,lng:-8.6,timestamp:'2026-09-07T10:00:00Z'},
    {lat:37.2,lng:-181,timestamp:'2026-09-07T10:00:00Z'},
    {lat:37.2,lng:-8.6,timestamp:'2026-09-07T10:00:00Z'}
  ]);
  assert.equal(prepared.valid,1);
  assert.equal(prepared.invalid,2);
  assert.equal(prepared.points.length,1);
});

test('Tagebuch: in-file duplicates are removed and counted before persistence',()=>{
  const {app}=buildSandbox();
  const prepared=app.prepareTimelinePoints([
    {lat:37.2,lng:-8.6,timestamp:'2026-09-07T09:05:00Z'},
    {lat:37.2,lng:-8.6,timestamp:'2026-09-07T10:05:00+01:00'},
    {lat:37.21,lng:-8.61,timestamp:'2026-09-07T09:10:00Z'}
  ]);
  assert.equal(prepared.inRange,3);
  assert.equal(prepared.duplicatesInFile,1);
  assert.equal(prepared.points.length,2);
});

test('Tagebuch: repeated import of the same normalized points yields zero new additions',()=>{
  const {app}=buildSandbox();
  const prepared=app.prepareTimelinePoints([
    {lat:37.2,lng:-8.6,timestamp:'2026-09-07T09:05:00Z'},
    {lat:37.21,lng:-8.61,timestamp:'2026-09-07T09:10:00Z'}
  ]);
  const first=app.mergeTimelinePoints(prepared.points,new Set());
  const second=app.mergeTimelinePoints(prepared.points,new Set(first.records.map(p=>p.id)));
  assert.equal(first.added,2);
  assert.equal(first.duplicates,0);
  assert.equal(second.added,0);
  assert.equal(second.duplicates,2);
});

test('Tagebuch: haversine helpers produce plausible route distances',()=>{
  const {app}=buildSandbox();
  assert.ok(app.distanceKm(0,0,0,1)>111&&app.distanceKm(0,0,0,1)<112);
  const total=app.routeDistanceKm([
    {lat:37,lng:-8,timestamp:'2026-09-07T09:00:00Z'},
    {lat:37.01,lng:-8,timestamp:'2026-09-07T09:05:00Z'},
    {lat:37.02,lng:-8,timestamp:'2026-09-07T09:10:00Z'}
  ]);
  assert.ok(total>2&&total<3);
});

test('Tagebuch: compact JPEG EXIF parser reads capture time, GPS and orientation',()=>{
  const {app}=buildSandbox();
  const exif=app.parseJpegExif(makeExifSampleJpeg());
  assert.equal(exif.orientation,6);
  assert.equal(exif.captureTime,'2026-09-07T09:15:30.000Z');
  assert.ok(exif.gps);
  assert.ok(Math.abs(exif.gps.lat-37.1233333)<1e-4);
  assert.ok(Math.abs(exif.gps.lng-(-8.65))<1e-4);
});
