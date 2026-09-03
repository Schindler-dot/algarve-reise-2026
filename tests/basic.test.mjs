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
  }
  addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='class'){this.classList.set=new Set(String(value).split(/\s+/).filter(Boolean));this.classList.sync();}}
  getAttribute(name){return Object.prototype.hasOwnProperty.call(this.attributes,name)?this.attributes[name]:null;}
  removeAttribute(name){delete this.attributes[name];}
  focus(){this.ownerDocument.activeElement=this;}
  querySelector(selector){return this._queries?.[selector]||null;}
  closest(selector){return selector==='a[aria-disabled="true"]'&&this.getAttribute('aria-disabled')==='true'?this:null;}
}

function buildSandbox(nowIso='2026-09-10T12:00:00Z'){
  const elements=new Map();
  const navButtons=['today','days','destinations','food','bookings','tips'].map(view=>{const el=new Element();el.dataset.view=view;return el;});
  const ids=['search','destSearch','foodSearch','destGrid','foodList','foodCatFilters','foodPriceFilters','bookingList','today','daysList','days','destinations','food','bookings','tips','offlineBanner','destModal','modalTitle','modalArea','modalText','modalImg','modalCredit','modalActions','foodModal','foodModalTitle','foodModalArea','foodModalTags','foodModalWhy','foodModalDishes','foodModalInfo','foodModalActions','destMapWrap','foodMapWrap','destMapOffline','foodMapOffline','destLocateMsg','foodLocateMsg','todayLocateMsg','destLocateBtn','foodLocateBtn','todayLocateBtn'];
  for(const id of ids){elements.set(id,new Element(id));}
  for(const id of ['today','days','destinations','food','bookings','tips'])elements.get(id).classList.add('view');
  const body=new Element('body');
  const document={
    body,
    activeElement:body,
    addEventListener(){},
    getElementById(id){if(!elements.has(id))elements.set(id,new Element(id));const el=elements.get(id);el.ownerDocument=document;return el;},
    querySelectorAll(selector){
      if(selector==='nav button')return navButtons;
      if(selector==='.view')return ['today','days','destinations','food','bookings','tips'].map(id=>document.getElementById(id));
      if(selector==='.dist-badge'||selector==='.schedule-dest img[data-dest]'||selector==='a[target="_blank"]')return [];
      return [];
    },
    querySelector(selector){
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
    window:{addEventListener(){},scrollY:0,pageYOffset:0,scrollTo(x,y){this.scrollY=y;this.pageYOffset=y;}},
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
    URL,
    URLSearchParams
  };
  sandbox.window.document=document;
  sandbox.globalThis=sandbox;
  vm.runInNewContext(`${script}\n;globalThis.__app={DAYS,DESTINATIONS,DAY_DESTS,DAY_DEST_MAIN,ITEM_DESTS,RESTAURANTS,FOOD_BY_ID,escapeHtml,mapsDir,mapsNav,mapsSearch,weather,actionLink,plainTextLines,parseItemTime,fallbackRouteTarget,nextRouteTarget,defaultDayIndex,selectDay,shiftDay,jumpToToday,isTodayInTrip,dayCard,openDestination,closeDestination,openRestaurant,closeRestaurant,selectedDayIndex:()=>selectedDayIndex};`,sandbox,{filename:'index-inline.js'});
  return {app:sandbox.__app,sandbox,document,elements,storage};
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
