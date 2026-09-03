const CACHE='algarve-reise-v21';
const STATIC=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./vendor/leaflet/leaflet.js','./vendor/leaflet/leaflet.css','./vendor/leaflet/images/layers.png','./vendor/leaflet/images/layers-2x.png','./vendor/leaflet/images/marker-icon.png','./vendor/leaflet/images/marker-icon-2x.png','./vendor/leaflet/images/marker-shadow.png','./images/SOURCES.json','./images/faro-altstadt.jpg','./images/arco-vila.jpg','./images/se-faro.jpg','./images/monchique.jpg','./images/caldas.jpg','./images/foia.jpg','./images/lagos-altstadt.jpg','./images/ponta.jpg','./images/dona-ana.jpg','./images/aljezur.jpg','./images/arrifana.jpg','./images/amoreira.jpg','./images/silves.jpg','./images/silves-castle.jpg','./images/arade.jpg','./images/tavira.jpg','./images/caco.jpg','./images/ria-formosa.jpg','./images/cabanas.jpg','./images/sagres.jpg','./images/fortaleza.jpg','./images/cabo.jpg','./images/loule.jpg','./images/mercado-loule.jpg','./images/alte.jpg','./images/ferragudo.jpg','./images/carvoeiro.jpg','./images/algar-seco.jpg'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)));});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))]));});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 if(event.request.mode==='navigate'){
   event.respondWith(fetch(event.request,{cache:'no-store'}).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy)).catch(()=>{});return resp;}).catch(()=>caches.match('./index.html')));
   return;
 }
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return resp;})));
});
