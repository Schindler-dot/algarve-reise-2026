// Run with: node --test tests/basic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const scriptMatch=html.match(/<script>\s*([\s\S]*?)\s*<\/script>/i);
assert.ok(scriptMatch,'Inline script in index.html not found');
const script=scriptMatch[1];

// Minimal in-memory IndexedDB fake used only for local-media persistence tests below.
// Supports exactly what index.html's arch* helpers need: open/upgrade, put/get/getAll/delete/clear,
// and transaction oncomplete/onabort callbacks fired as microtasks (mirrors real IDB async semantics).
function createFakeIndexedDB(databases=new Map()){
  function makeRequest(){return {result:undefined,error:null,onsuccess:null,onerror:null,onupgradeneeded:null,transaction:null};}
  function makeStoreHandle(dbEntry,storeName){
    const store=dbEntry.stores.get(storeName);
    return {
      keyPath:store.keyPath,
      indexNames:{contains:()=>false},
      put(record){store.data.set(record[store.keyPath],record);return makeRequest();},
      get(key){const r=makeRequest();queueMicrotask(()=>{r.result=store.data.get(key);if(r.onsuccess)r.onsuccess();});return r;},
      getAll(){const r=makeRequest();queueMicrotask(()=>{r.result=[...store.data.values()];if(r.onsuccess)r.onsuccess();});return r;},
      delete(key){store.data.delete(key);return makeRequest();},
      clear(){store.data.clear();return makeRequest();}
    };
  }
  const indexedDB={
    open(name,version){
      const req=makeRequest();
      queueMicrotask(()=>{
        let dbEntry=databases.get(name);
        const isNew=!dbEntry;
        if(!dbEntry){dbEntry={version:0,stores:new Map()};databases.set(name,dbEntry);}
        const needsUpgrade=isNew||(version||0)>dbEntry.version;
        const db={
          objectStoreNames:{contains:n=>dbEntry.stores.has(n)},
          createObjectStore(storeName,opts){dbEntry.stores.set(storeName,{keyPath:opts&&opts.keyPath,data:new Map()});return makeStoreHandle(dbEntry,storeName);},
          transaction(storeNames){
            const tx={oncomplete:null,onabort:null,error:null,objectStore:n=>makeStoreHandle(dbEntry,n)};
            queueMicrotask(()=>{if(tx.oncomplete)tx.oncomplete();});
            return tx;
          },
          close(){}
        };
        req.result=db;
        if(needsUpgrade){
          dbEntry.version=version||1;
          req.transaction=db.transaction([]);
          if(req.onupgradeneeded)req.onupgradeneeded();
        }
        if(req.onsuccess)req.onsuccess();
      });
      return req;
    }
  };
  return {indexedDB,databases};
}
// Stub browser-only Object URL APIs so local-image priority/revocation logic is testable in Node.
let __objectUrlSeq=0;
const __liveObjectUrls=new Set();
const __revokedObjectUrls=[];
if(typeof URL.createObjectURL!=='function'){
  URL.createObjectURL=blob=>{const u=`blob:test-${++__objectUrlSeq}`;__liveObjectUrls.add(u);return u;};
  URL.revokeObjectURL=u=>{__liveObjectUrls.delete(u);__revokedObjectUrls.push(u);};
}

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
  // Minimal canvas stub: enough for archOptimizeImage() to run its transform math without a real renderer.
  // toBlob is intentionally left unset so the code takes its documented "no blob" fallback branch.
  getContext(type){
    if(type!=='2d')return null;
    return {save(){},restore(){},scale(){},transform(){},drawImage(){}};
  }
}

function buildSandbox(nowIso='2026-09-10T12:00:00Z',opts={}){
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
    confirm:()=>true,
    prompt:()=>null
  };
  sandbox.confirm=opts.confirm||sandbox.confirm;
  sandbox.prompt=opts.prompt||sandbox.prompt;
  sandbox.indexedDB=(opts.indexedDB||createFakeIndexedDB()).indexedDB;
  sandbox.createImageBitmap=opts.createImageBitmap;
  sandbox.window.document=document;
  sandbox.globalThis=sandbox;
  vm.runInNewContext(`${script}\n;globalThis.__app={DAYS,DESTINATIONS,DAY_DESTS,DAY_DEST_MAIN,ITEM_DESTS,RESTAURANTS,FOOD_BY_ID,escapeHtml,mapsDir,mapsNav,mapsSearch,weather,actionLink,plainTextLines,parseItemTime,fallbackRouteTarget,nextRouteTarget,defaultDayIndex,selectDay,shiftDay,jumpToToday,isTodayInTrip,dayCard,openDestination,closeDestination,openRestaurant,closeRestaurant,selectedDayIndex:()=>selectedDayIndex,isVisited,toggleVisited,visitedDestCount,renderDestFilters,renderDestProgress,renderDestinations,setDestVisitedFilter,setDestCategoryFilter,markerPopupHtml,destVisitedFilter:()=>destVisitedFilter,destCategory:()=>destCategory,parseLatLngPair,extractTimelinePoints,inTripRange,timelinePointId,lisbonDateKey,normalizeTimelinePoint,prepareTimelinePoints,mergeTimelinePoints,distanceKm,simplifyRoutePoints,routeDistanceKm,parseJpegExif,parseExifDateString,STATIC_DEST_IMAGES,ARCH_DB_NAME,ARCH_STORE,ARCH_MAX_EDGE,ARCH_QUALITY,ARCH_FOLDER_MAPPING,ARCH_DEST_CARD_ALIAS,normalizeArchFolderName,archSplitLeadingNumber,matchArchFolder,archIsSupportedImageName,archIsIgnoredName,buildArchImportGroups,archDestCardId,archDestKeyForCardId,archOrientationSwapsAxes,archOptimizeImage,archStoreFile,archReadAll,archPutRecord,archDeleteAll,archOpenDb,refreshArchImageCache,archImageCache:()=>archImageCache,archGetImageUrl,archResolveImageSrc,archHasLocalImage,archLocalBadgeHtml,archSummaryText,deleteArchImages,processArchImportGroups,setArchReviewGroups,archReviewGroups:()=>archReviewGroups,renderArchReview,promptArchSinglePhotos,handleArchFiles,destCardHtml,DAY_EXTRA_LOCATIONS,DAY_SINGLE_LOCATION,DAY_ROUTE_COLORS,dayColor,resolveLocation,stopTimeLabel,dayRouteStops,dayMapMarkerCount,totalDayMapMarkerCount,showAllDayRoutes,focusDay,showCurrentDayRoute,dayMapFocus:()=>dayMapFocus,renderDayButtons,renderDayMapLegend,onDayMapToggle};`,sandbox,{filename:'index-inline.js'});
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

test('all 51 destinations have deepened facts and background text',()=>{
  const {app}=buildSandbox();
  assert.equal(app.DESTINATIONS.length,51);
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

test('all destination ids are unique',()=>{
  const {app}=buildSandbox();
  const ids=app.DESTINATIONS.map(d=>d.id);
  assert.equal(new Set(ids).size,ids.length,'destination ids must be unique');
});

test('"Moderne & Gegenwart" filter shows only modern architecture destinations and combines with search/visited filters',()=>{
  const {app,document}=buildSandbox();
  app.renderDestinations();
  const allCount=document.getElementById('destGrid').innerHTML.match(/class="destcard/g).length;

  app.setDestCategoryFilter('Moderne & Gegenwart');
  assert.equal(app.destCategory(),'Moderne & Gegenwart');
  app.renderDestinations();
  const modernIds=app.DESTINATIONS.filter(d=>d.modern===true).map(d=>d.id);
  assert.ok(modernIds.length>=7,'expected at least 7 modern architecture destinations');
  const gridHtml=document.getElementById('destGrid').innerHTML;
  for(const id of modernIds)assert.match(gridHtml,new RegExp(`data-id="${id}"`));
  assert.doesNotMatch(gridHtml,/data-id="faro-altstadt"/);
  assert.ok(gridHtml.match(/class="destcard/g).length<allCount);

  document.getElementById('destSearch').value='souto de moura';
  app.renderDestinations();
  const combinedHtml=document.getElementById('destGrid').innerHTML;
  assert.match(combinedHtml,/data-id="convento-bernardas"/);
  assert.doesNotMatch(combinedHtml,/data-id="biblioteca-tavira"/);
  document.getElementById('destSearch').value='';

  app.toggleVisited('convento-bernardas');
  app.setDestVisitedFilter('Besucht');
  app.renderDestinations();
  const visitedModernHtml=document.getElementById('destGrid').innerHTML;
  assert.match(visitedModernHtml,/data-id="convento-bernardas"/);
  assert.doesNotMatch(visitedModernHtml,/data-id="casa-luz-tavira"/);

  app.setDestVisitedFilter('Alle');
  app.setDestCategoryFilter('Alle');
});

test('architecture metadata is rendered for architecture destinations and hidden otherwise',()=>{
  const {app,document}=buildSandbox();
  app.openDestination('convento-bernardas');
  const archHtml=document.getElementById('modalArchBlock').innerHTML;
  assert.match(archHtml,/Eduardo Souto de Moura/);
  assert.match(archHtml,/2012/);
  assert.match(archHtml,/Zisterzienserinnenkloster/);
  assert.equal(document.getElementById('modalArchBlock').style.display,'');

  app.openDestination('faro-altstadt');
  assert.equal(document.getElementById('modalArchBlock').style.display,'none');
});

test('private/restricted architecture destinations show their access hint',()=>{
  const {app}=buildSandbox();
  for(const id of ['casa-luz-tavira','casa-quinta-lago','bairro-pescadores-olhao']){
    const d=app.DESTINATIONS.find(x=>x.id===id);
    assert.ok(d.arch&&/nur von außen|nicht öffentlich/.test(d.arch.access),`${id} should state a restrictive access hint`);
  }
});

test('"Faro – Route der Moderne" is flagged as an architecture route with multiple verified stations',()=>{
  const {app,document}=buildSandbox();
  const route=app.DESTINATIONS.find(d=>d.id==='faro-route-moderna');
  assert.equal(route.route,true);
  assert.ok(Array.isArray(route.stations)&&route.stations.length>=5);
  for(const s of route.stations){
    assert.ok(typeof s.name==='string'&&s.name.trim().length>0);
    assert.ok(typeof s.lat!=='number'||typeof s.lng!=='number'||(!Number.isNaN(s.lat)&&!Number.isNaN(s.lng)));
  }
  app.openDestination('faro-route-moderna');
  const stationsHtml=document.getElementById('modalStations').innerHTML;
  assert.match(stationsHtml,/THE MODERNIST/);
  assert.match(stationsHtml,/Casa Gago/);
  assert.match(stationsHtml,/Rua de Berlim/);
});

test('deep-dive sections for new architecture destinations remain closed by default',()=>{
  const {app,document}=buildSandbox();
  for(const id of ['convento-bernardas','faro-route-moderna','biblioteca-tavira','igreja-santa-luzia-tavira']){
    app.openDestination(id);
    assert.equal(document.getElementById('modalDeepDetails').open,false,`${id} deep-dive must be closed by default`);
  }
});

test('visited status and map marker toggling work for new architecture destinations',()=>{
  const {app}=buildSandbox();
  const id='convento-bernardas';
  assert.equal(app.isVisited(id),false);
  app.toggleVisited(id);
  assert.equal(app.isVisited(id),true);
  const popup=app.markerPopupHtml(app.DESTINATIONS.find(d=>d.id===id));
  assert.match(popup,/aria-pressed="true"/);
  app.toggleVisited(id);
});

test('destination search finds architect names (Souto de Moura, Manuel Gomes da Costa, Carrilho da Graça)',()=>{
  const {app,document}=buildSandbox();
  document.getElementById('destSearch').value='Souto de Moura';
  app.renderDestinations();
  let html2=document.getElementById('destGrid').innerHTML;
  assert.match(html2,/Convento das Bernardas/);

  document.getElementById('destSearch').value='Manuel Gomes da Costa';
  app.renderDestinations();
  html2=document.getElementById('destGrid').innerHTML;
  assert.match(html2,/Faro – Route der Moderne/);

  document.getElementById('destSearch').value='Carrilho da Graça';
  app.renderDestinations();
  html2=document.getElementById('destGrid').innerHTML;
  assert.match(html2,/Biblioteca Municipal/);
  document.getElementById('destSearch').value='';
});

test('Convento das Bernardas is linked to the existing Tavira day',()=>{
  const {app}=buildSandbox();
  assert.ok((app.DAY_DESTS['2026-09-13']||[]).includes('convento-bernardas'));
});

// ---- Lokale Architektur-Fotos: Import aus Google-Drive-Ordnerstruktur "09_Fotos/App" ----
const ARCH_EXPECTED_MAPPING=[
  ['01','convento-bernardas'],['02','casa-em-tavira'],['03','casa-quinta-do-lago'],
  ['04','faro-route-moderne'],['05','biblioteca-alvaro-de-campos'],['06','igreja-santa-luzia'],
  ['07','bairro-pescadores-olhao'],['08','capela-do-monte'],['09','casa-gago'],
  ['10','the-modernist-faro'],['11','casa-1923-faro'],['12','edificio-tridente'],
  ['13','edificio-nogueira'],['14','cafe-chelsea-faro'],['15','rua-de-berlim-faro'],
  ['16','casa-dos-abracos'],['17','casa-um-tavira'],['18','house-agostos'],
  ['19','frame-house-faro'],['20','house-silves-bomo'],['21','cabrita-moleiro-house'],
  ['22','house-olhao-ods'],['23','house-martinhal']
];

function makeImageFile(name,type='image/jpeg',bytes=[0xff,0xd8,0xff,0xd9]){
  return new File([new Uint8Array(bytes)],name,{type});
}

test('all 23 leading-number folder-to-destination-ID mappings resolve correctly',()=>{
  const {app}=buildSandbox();
  assert.equal(app.ARCH_FOLDER_MAPPING.length,23);
  for(const [number,destinationId] of ARCH_EXPECTED_MAPPING){
    const entry=app.ARCH_FOLDER_MAPPING.find(m=>m.number===number);
    assert.ok(entry,`mapping for number ${number} must exist`);
    assert.equal(entry.destinationId,destinationId);
    const match=app.matchArchFolder(`${number} Irgendein Name`);
    assert.ok(match,`folder starting with ${number} must match`);
    assert.equal(match.destinationId,destinationId);
  }
  const ids=app.ARCH_FOLDER_MAPPING.map(m=>m.destinationId);
  assert.equal(new Set(ids).size,23,'all 23 Ziel-IDs must be unique');
});

test('all 23 ARCH_FOLDER_MAPPING projects are visible destination cards, keeping existing alias mappings',()=>{
  const {app}=buildSandbox();
  for(const m of app.ARCH_FOLDER_MAPPING){
    const cardId=app.archDestCardId(m.destinationId);
    const dest=app.DESTINATIONS.find(d=>d.id===cardId);
    assert.ok(dest,`project ${m.number} (${m.destinationId} → card ${cardId}) must exist as a visible destination card`);
    assert.ok(dest.arch,`${cardId} should carry architecture metadata (arch block)`);
    assert.ok(Array.isArray(dest.facts)&&dest.facts.length>=1,`${cardId} should have fact chips`);
  }
  // Pre-existing alias mappings must remain untouched.
  assert.equal(app.ARCH_DEST_CARD_ALIAS['casa-em-tavira'],'casa-luz-tavira');
  assert.equal(app.ARCH_DEST_CARD_ALIAS['casa-quinta-do-lago'],'casa-quinta-lago');
  assert.equal(app.ARCH_DEST_CARD_ALIAS['faro-route-moderne'],'faro-route-moderna');
  assert.equal(app.ARCH_DEST_CARD_ALIAS['biblioteca-alvaro-de-campos'],'biblioteca-tavira');
  assert.equal(app.ARCH_DEST_CARD_ALIAS['igreja-santa-luzia'],'igreja-santa-luzia-tavira');
});

test('folder matching falls back to normalized name (accents, umlauts, dashes, spacing) when the number is missing',()=>{
  const {app}=buildSandbox();
  const m1=app.matchArchFolder('Biblioteca Municipal Álvaro de Campos');
  assert.equal(m1.destinationId,'biblioteca-alvaro-de-campos');
  const m2=app.matchArchFolder('biblioteca   municipal  alvaro de campos');
  assert.equal(m2.destinationId,'biblioteca-alvaro-de-campos');
  const m3=app.matchArchFolder('Café—Chelsea—Gebäude');
  assert.equal(m3.destinationId,'cafe-chelsea-faro');
  const m4=app.matchArchFolder('casa em tavira – souto de moura');
  assert.equal(m4.destinationId,'casa-em-tavira');
  assert.equal(app.matchArchFolder('Ein völlig unbekannter Ordner'),null);
});

test('leading number takes priority over the normalized name fallback',()=>{
  const {app}=buildSandbox();
  const match=app.matchArchFolder('01 Ein komplett anderer Name');
  assert.equal(match.destinationId,'convento-bernardas');
});

test('supported image types (JPEG, PNG, WebP) are recognized and unsupported/ignored files are rejected',()=>{
  const {app}=buildSandbox();
  for(const name of ['foto.jpg','foto.jpeg','foto.JPG','foto.png','foto.webp']){
    assert.equal(app.archIsSupportedImageName(name),true,name);
    assert.equal(app.archIsIgnoredName(name),false,name);
  }
  for(const name of ['notiz.txt','dokument.pdf','Link zu Google Drive.gdoc','Freigabe.url','archiv.gsheet','Thumbs.db.lnk']){
    assert.equal(app.archIsIgnoredName(name),true,name);
  }
});

test('missing project folders are reported as red (no image found) when the folder is recognized but empty',()=>{
  const {app}=buildSandbox();
  const groups=app.buildArchImportGroups([
    {file:{name:'hinweis.txt'},relativeFolder:'01 Convento das Bernardas'}
  ]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].destinationId,'convento-bernardas');
  assert.equal(groups[0].files.length,0);
  assert.equal(groups[0].status,'red');
});

test('a project folder with multiple valid images is flagged yellow and keeps all candidates selectable',()=>{
  const {app}=buildSandbox();
  const groups=app.buildArchImportGroups([
    {file:{name:'a.jpg'},relativeFolder:'02 Casa em Tavira – Souto de Moura'},
    {file:{name:'b.png'},relativeFolder:'02 Casa em Tavira – Souto de Moura'},
    {file:{name:'notes.pdf'},relativeFolder:'02 Casa em Tavira – Souto de Moura'}
  ]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].status,'yellow');
  assert.equal(groups[0].destinationId,'casa-em-tavira');
  assert.equal(groups[0].files.length,2);
  assert.equal(groups[0].ignoredFiles.length,1);
});

test('a single valid image in a recognized folder is flagged green; an unmatched folder is flagged red',()=>{
  const {app}=buildSandbox();
  const groups=app.buildArchImportGroups([
    {file:{name:'foto.webp'},relativeFolder:'23 House in Martinhal – ARX Portugal'},
    {file:{name:'foto.jpg'},relativeFolder:'Ein unbekannter Ordner'}
  ]);
  const green=groups.find(g=>g.folderName.startsWith('23'));
  assert.equal(green.status,'green');
  assert.equal(green.destinationId,'house-martinhal');
  const red=groups.find(g=>g.folderName==='Ein unbekannter Ordner');
  assert.equal(red.status,'red');
  assert.equal(red.destinationId,null);
});

test('a folder containing only ignored files (txt/pdf/Drive-share-link) is flagged gray',()=>{
  const {app}=buildSandbox();
  const groups=app.buildArchImportGroups([
    {file:{name:'Google Drive Link.url'},relativeFolder:'sonstiges'},
    {file:{name:'readme.txt'},relativeFolder:'sonstiges'}
  ]);
  assert.equal(groups.length,1);
  assert.equal(groups[0].status,'gray');
});

test('"Zuordnung prüfen" always lists all 23 expected projects as red, even with no import at all',()=>{
  const {app,document}=buildSandbox();
  app.renderArchReview();
  const html=document.getElementById('archReviewList').innerHTML;
  for(const [number]of ARCH_EXPECTED_MAPPING){
    assert.ok(html.includes(`>${number} ·`),`row for project ${number} must be listed even without any import`);
  }
  const redCount=(html.match(/archReviewDot red/g)||[]).length;
  assert.equal(redCount,23,'all 23 rows must be red when no folders/images exist at all');
});

test('"Zuordnung prüfen" reflects locally stored images as green and missing ones as red',async()=>{
  const {app,document}=buildSandbox();
  await app.archStoreFile('convento-bernardas',makeImageFile('foto.jpg'),'01 Convento das Bernardas');
  await app.refreshArchImageCache();
  app.renderArchReview();
  const rows=document.getElementById('archReviewList').innerHTML.split('<div class="archReviewRow">').slice(1);
  const storedRow=rows.find(r=>r.includes('>01 ·'));
  assert.match(storedRow,/archReviewDot green/);
  const missingRow=rows.find(r=>r.includes('>02 ·'));
  assert.match(missingRow,/archReviewDot red/);
  assert.equal(rows.length,23,'exactly 23 rows must always be rendered');
});

test('"Zuordnung prüfen" flags multiple candidate images yellow and keeps them selectable',()=>{
  const {app,document}=buildSandbox();
  const groups=app.buildArchImportGroups([
    {file:{name:'a.jpg'},relativeFolder:'02 Casa em Tavira – Souto de Moura'},
    {file:{name:'b.png'},relativeFolder:'02 Casa em Tavira – Souto de Moura'}
  ]);
  app.setArchReviewGroups(groups);
  const html=document.getElementById('archReviewList').innerHTML;
  const rows=html.split('<div class="archReviewRow">').slice(1);
  const yellowRow=rows.find(r=>r.includes('>02 ·'));
  assert.match(yellowRow,/archReviewDot yellow/);
  assert.match(yellowRow,/a\.jpg/);
  assert.match(yellowRow,/b\.png/);
});

test('single-photo import without a folder path asks explicitly for the target number (01–23) instead of guessing from the filename',async()=>{
  const {app}=buildSandbox();
  const asked=[];
  const file=makeImageFile('IMG_20260101_010101.jpg');
  const res=await app.promptArchSinglePhotos([file],undefined);
  // Without any prompt implementation returning a value (default sandbox prompt returns null), the photo must be skipped, not guessed.
  assert.equal(res.stored,0);
  assert.equal(res.skippedNoMatch,1);
  assert.equal(app.archImageCache().size,0);
});

test('single-photo import stores the photo under the destination chosen by the explicit target-number prompt',async()=>{
  const {app}=buildSandbox('2026-09-10T12:00:00Z',{prompt:()=>'9'});
  const file=makeImageFile('random-name-that-must-not-be-guessed.jpg');
  const res=await app.promptArchSinglePhotos([file],undefined);
  assert.equal(res.stored,1);
  await app.refreshArchImageCache();
  assert.ok(app.archImageCache().has('casa-gago'),'number "9" must resolve to project 09 (casa-gago)');
});

test('single-photo import skips the photo when the user cancels the target-number prompt',async()=>{
  const {app}=buildSandbox('2026-09-10T12:00:00Z',{prompt:()=>null});
  const file=makeImageFile('foto.jpg');
  const res=await app.promptArchSinglePhotos([file],undefined);
  assert.equal(res.stored,0);
  assert.equal(res.skippedNoMatch,1);
});

test('single-photo import skips the photo when the entered number is out of the 01–23 range',async()=>{
  const {app}=buildSandbox('2026-09-10T12:00:00Z',{prompt:()=>'99'});
  const file=makeImageFile('foto.jpg');
  const res=await app.promptArchSinglePhotos([file],undefined);
  assert.equal(res.stored,0);
  assert.equal(res.skippedNoMatch,1);
});

test('archOptimizeImage requests createImageBitmap with imageOrientation:"none" to avoid double-applying EXIF rotation',async()=>{
  let receivedOptions=null;
  const fakeCreateImageBitmap=(file,options)=>{receivedOptions=options;return Promise.resolve({width:2,height:1,close(){}});};
  const {app}=buildSandbox('2026-09-10T12:00:00Z',{createImageBitmap:fakeCreateImageBitmap});
  const file=makeImageFile('foto.jpg');
  await app.archOptimizeImage(file);
  assert.ok(receivedOptions,'createImageBitmap must be called with an options object');
  assert.equal(receivedOptions.imageOrientation,'none');
});

test('storing and reading back an architecture image from IndexedDB round-trips blob + metadata together',async()=>{
  const shared=createFakeIndexedDB();
  const {app}=buildSandbox('2026-09-10T12:00:00Z',{indexedDB:shared});
  const file=makeImageFile('bernardas.jpg');
  const record=await app.archStoreFile('convento-bernardas','bernardas.jpg'?file:file,'01 Convento das Bernardas');
  assert.equal(record.destinationId,'convento-bernardas');
  assert.equal(record.originalFileName,'bernardas.jpg');
  assert.equal(record.sourceFolder,'01 Convento das Bernardas');
  assert.ok(record.importedAt);
  assert.ok(record.blob);
  const all=await app.archReadAll();
  assert.equal(all.length,1);
  assert.equal(all[0].destinationId,'convento-bernardas');
  assert.ok(all[0].blob,'blob must be persisted alongside its metadata');
});

test('the app survives an offline restart: previously imported images are still available from a fresh session',async()=>{
  const shared=createFakeIndexedDB();
  const first=buildSandbox('2026-09-10T12:00:00Z',{indexedDB:shared});
  await first.app.archStoreFile('house-martinhal',makeImageFile('m.jpg'),'23 House in Martinhal – ARX Portugal');
  // Simulate an app restart: a brand-new script/session, but the same underlying device storage.
  const second=buildSandbox('2026-09-10T12:00:00Z',{indexedDB:shared});
  await second.app.refreshArchImageCache();
  assert.equal(second.app.archImageCache().size,1);
  assert.ok(second.app.archImageCache().get('house-martinhal'));
});

test('local image takes priority over the bundled repository image and the placeholder',async()=>{
  const shared=createFakeIndexedDB();
  const {app,document}=buildSandbox('2026-09-10T12:00:00Z',{indexedDB:shared});
  const beforeHtml=app.destCardHtml(app.DESTINATIONS.find(d=>d.id==='convento-bernardas'));
  assert.match(beforeHtml,/images\/convento-bernardas\.jpg/);
  assert.doesNotMatch(beforeHtml,/Auf diesem Gerät gespeichert/);
  await app.archStoreFile('convento-bernardas',makeImageFile('foto.jpg'),'01 Convento das Bernardas');
  await app.refreshArchImageCache();
  const afterHtml=document.getElementById('destGrid').innerHTML;
  assert.match(afterHtml,/data-id="convento-bernardas"[\s\S]*?src="blob:/);
  assert.match(afterHtml,/Auf diesem Gerät gespeichert/);
});

test('a destination without any local or repository image would fall back to the SVG placeholder',()=>{
  const {app}=buildSandbox();
  const src=app.archResolveImageSrc('no-such-destination',app.placeholderData?app.placeholderData('x'):'data:image/svg+xml;fallback');
  assert.ok(src);
});

test('done/"besucht" dimming still applies to destination cards that show a locally imported photo',async()=>{
  const shared=createFakeIndexedDB();
  const {app,document}=buildSandbox('2026-09-10T12:00:00Z',{indexedDB:shared});
  await app.archStoreFile('convento-bernardas',makeImageFile('foto.jpg'),'01 Convento das Bernardas');
  await app.refreshArchImageCache();
  app.toggleVisited('convento-bernardas');
  app.renderDestinations();
  const html=document.getElementById('destGrid').innerHTML;
  assert.match(html,/class="destcard visited" data-id="convento-bernardas"/);
  assert.match(html,/data-id="convento-bernardas"[\s\S]*?Auf diesem Gerät gespeichert/);
  app.toggleVisited('convento-bernardas');
});

test('deleting local architecture images clears IndexedDB completely and updates the summary',async()=>{
  const shared=createFakeIndexedDB();
  const {app}=buildSandbox('2026-09-10T12:00:00Z',{confirm:()=>true,indexedDB:shared});
  await app.archStoreFile('convento-bernardas',makeImageFile('a.jpg'),'01 Convento das Bernardas');
  await app.archStoreFile('house-martinhal',makeImageFile('b.jpg'),'23 House in Martinhal – ARX Portugal');
  await app.refreshArchImageCache();
  assert.equal(app.archImageCache().size,2);
  app.deleteArchImages();
  await new Promise(r=>setImmediate(r));
  await new Promise(r=>setImmediate(r));
  const remaining=await app.archReadAll();
  assert.equal(remaining.length,0);
});

test('deleting local images is skipped entirely when the confirmation dialog is declined',async()=>{
  const shared=createFakeIndexedDB();
  const {app}=buildSandbox('2026-09-10T12:00:00Z',{confirm:()=>false,indexedDB:shared});
  await app.archStoreFile('convento-bernardas',makeImageFile('a.jpg'),'01 Convento das Bernardas');
  app.deleteArchImages();
  await new Promise(r=>setImmediate(r));
  const remaining=await app.archReadAll();
  assert.equal(remaining.length,1,'declining the confirmation must not delete anything');
});

test('the delete confirmation dialog names the exact total number of local architecture photos (23)',()=>{
  let confirmMessage=null;
  const {app}=buildSandbox('2026-09-10T12:00:00Z',{confirm:(msg)=>{confirmMessage=msg;return false;}});
  app.deleteArchImages();
  assert.equal(confirmMessage,'Alle 23 lokal gespeicherten Architektur-Fotos von diesem Gerät entfernen?');
});

test('never stores base64 image data in localStorage; images only ever live as Blobs in IndexedDB',async()=>{
  const shared=createFakeIndexedDB();
  const {app,storage}=buildSandbox('2026-09-10T12:00:00Z',{indexedDB:shared});
  const written=[];
  const originalSetItem=storage.setItem.bind(storage);
  storage.setItem=(key,value)=>{written.push([key,value]);return originalSetItem(key,value);};
  await app.archStoreFile('convento-bernardas',makeImageFile('foto.jpg'),'01 Convento das Bernardas');
  await app.refreshArchImageCache();
  app.toggleVisited('convento-bernardas');
  app.toggleVisited('convento-bernardas');
  const rawKeys=[...shared.databases.keys()];
  assert.ok(rawKeys.includes('algarve-local-media'),'images must be persisted in the algarve-local-media IndexedDB');
  assert.equal(written.length,2,'only the existing visited-toggle keys may be written to localStorage');
  for(const [key,value] of written){
    assert.doesNotMatch(key,/photo|image|foto/i);
    assert.doesNotMatch(String(value),/^data:image\//);
    assert.ok(String(value).length<100,'localStorage values must stay tiny (no embedded image data)');
  }
});

test('local architecture images are never part of the service-worker precache list',()=>{
  const swSource=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  assert.doesNotMatch(swSource,/destination-images/);
  assert.doesNotMatch(swSource,/algarve-local-media/);
  assert.doesNotMatch(swSource,/09_Fotos/);
});

test('optimizeArchImage never upscales and gracefully falls back when canvas/createImageBitmap are unavailable',async()=>{
  const {app}=buildSandbox();
  const file=makeImageFile('plain.png','image/png');
  const result=await app.archOptimizeImage(file);
  assert.ok(result.blob);
  assert.equal(result.mimeType,'image/png');
});

// ---- Tagesrouten-Karte (day routes overview map on the "Tage" tab) ------------------------

test('every trip day resolves to at least one route stop with valid coordinates (fehlende Koordinaten)',()=>{
  const {app}=buildSandbox();
  for(const day of app.DAYS){
    const stops=app.dayRouteStops(day.date);
    assert.ok(stops.length>0,`day ${day.date} must resolve at least one map stop`);
    for(const stop of stops){
      assert.equal(typeof stop.lat,'number',`stop ${stop.id||stop.name} of ${day.date} needs a numeric lat`);
      assert.equal(typeof stop.lng,'number',`stop ${stop.id||stop.name} of ${day.date} needs a numeric lng`);
      assert.ok(Number.isFinite(stop.lat)&&Number.isFinite(stop.lng));
      assert.ok(stop.name);
    }
  }
});

test('days with a DAY_DESTS route produce stops in the exact DAY_DESTS order (Reihenfolge der Zwischenziele)',()=>{
  const {app}=buildSandbox();
  for(const [date,ids] of Object.entries(app.DAY_DESTS)){
    const stops=app.dayRouteStops(date);
    assert.deepEqual(stops.map(s=>s.id),ids,`route order for ${date} must follow DAY_DESTS`);
  }
});

test('days without a DAY_DESTS route (rest/arrival/flex/departure days) get exactly one location marker',()=>{
  const {app}=buildSandbox();
  const noRouteDates=app.DAYS.map(d=>d.date).filter(date=>!(app.DAY_DESTS[date]&&app.DAY_DESTS[date].length));
  assert.ok(noRouteDates.length>0);
  for(const date of noRouteDates){
    assert.equal(app.dayMapMarkerCount(date),1,`${date} should render as a single-location day`);
  }
});

test('the departure day (19.09.) resolves to the explicit Faro-Airport coordinates (no entry in DESTINATIONS)',()=>{
  const {app}=buildSandbox();
  const stops=app.dayRouteStops('2026-09-19');
  assert.equal(stops.length,1);
  assert.equal(stops[0].id,'faro-airport');
  assert.ok(!app.DESTINATIONS.some(d=>d.id==='faro-airport'),'Faro Airport must not be added to DESTINATIONS / the Ziele tab');
  assert.equal(app.DAY_EXTRA_LOCATIONS['faro-airport'].lat,stops[0].lat);
  assert.equal(app.DAY_EXTRA_LOCATIONS['faro-airport'].lng,stops[0].lng);
});

test('total marker count across all 14 days matches the sum of each day\'s resolved stops (Markerzahl)',()=>{
  const {app}=buildSandbox();
  const expected=app.DAYS.reduce((sum,d)=>sum+app.dayRouteStops(d.date).length,0);
  assert.equal(app.totalDayMapMarkerCount(),expected);
  assert.ok(app.totalDayMapMarkerCount()>=app.DAYS.length,'at least one marker per day');
});

test('every trip day gets a distinct, defined route color',()=>{
  const {app}=buildSandbox();
  const colors=app.DAYS.map(d=>app.dayColor(d.date));
  colors.forEach(c=>assert.ok(/^#[0-9a-f]{6}$/i.test(c)));
  assert.equal(new Set(colors).size,app.DAYS.length,'all 14 day colors must be unique');
});

test('focusDay() selects a single day and showAllDayRoutes() resets the focus back to "all"',()=>{
  const {app}=buildSandbox();
  assert.equal(app.dayMapFocus(),'all');
  app.focusDay('2026-09-13');
  assert.equal(app.dayMapFocus(),'2026-09-13');
  app.showAllDayRoutes();
  assert.equal(app.dayMapFocus(),'all');
});

test('focusDay() ignores dates that cannot be resolved to any stop',()=>{
  const {app}=buildSandbox();
  app.focusDay('2026-09-13');
  app.focusDay('not-a-real-date');
  assert.equal(app.dayMapFocus(),'2026-09-13','focus must stay unchanged for an unresolvable date');
});

test('showCurrentDayRoute() focuses the selected/today trip day',()=>{
  const {app}=buildSandbox('2026-09-10T12:00:00Z'); // fake "today" is a trip day
  app.showCurrentDayRoute();
  assert.equal(app.dayMapFocus(),'2026-09-10');
});

test('stopTimeLabel() derives the day-part/time label from ITEM_DESTS for mapped destinations',()=>{
  const {app}=buildSandbox();
  const label=app.stopTimeLabel('2026-09-08','foia');
  assert.equal(label,'Später Nachmittag');
});

test('resolveLocation() returns null for unknown ids and never invents coordinates',()=>{
  const {app}=buildSandbox();
  assert.equal(app.resolveLocation('does-not-exist'),null);
  const loc=app.resolveLocation('monchique');
  const dest=app.DESTINATIONS.find(d=>d.id==='monchique');
  assert.equal(loc.lat,dest.lat);
  assert.equal(loc.lng,dest.lng);
});
