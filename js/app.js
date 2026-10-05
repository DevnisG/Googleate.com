(() => {
  const root = document.getElementById('pastel-search-final');
  if (!root || root.dataset.ready === '1') return;
  root.dataset.ready = '1';

  const DEFAULT_BACKGROUND = 'assets/wallpaper.jpg';
  const LEGACY_STORAGE_KEY = 'buscadorPastelStudio.v4';
  const DB_NAME = 'BuscadorPastelStudioDB';
  const DB_VERSION = 1;
  const DB_STORE = 'app';
  const DB_STATE_KEY = 'studio-state';
  const RECORDING_TAIL_MS = 650;
  const $ = s => root.querySelector(s);
  const $$ = s => [...root.querySelectorAll(s)];

  const makeId = () => 'ex_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  const starterExamples = () => [
    {id:makeId(),query:'la persona más bondadosa de esta escuela',name:'Alma Moreno',photoUrl:'',secondPhotoUrl:'',backgroundUrl:DEFAULT_BACKGROUND,description:'Siempre encuentra una forma de ayudar, escuchar y hacer que quienes la rodean se sientan acompañados.',geminiPrompt:'¿Quién destaca especialmente por su bondad en esta escuela?',geminiResponse:'Alma Moreno destaca por su empatía, su generosidad y su forma de estar presente para los demás.',showGemini:true,initialDelay:.3,totalTime:8},
    {id:makeId(),query:'quién tiene la sonrisa más contagiosa del curso',name:'Mateo Rivas',photoUrl:'',secondPhotoUrl:'',backgroundUrl:DEFAULT_BACKGROUND,description:'Su buen humor aparece justo cuando hace falta y tiene el talento de hacer reír a todo el salón.',geminiPrompt:'¿Quién suele contagiar más alegría al curso?',geminiResponse:'Mateo Rivas parece tener una energía capaz de cambiar el ambiente apenas llega.',showGemini:true,initialDelay:.3,totalTime:8},
    {id:makeId(),query:'la persona que siempre está para los demás',name:'Sofía Luna',photoUrl:'',secondPhotoUrl:'',backgroundUrl:DEFAULT_BACKGROUND,description:'Amiga incondicional, gran oyente y especialista en hacer más llevadero un día complicado.',geminiPrompt:'¿Quién acompaña a los demás cuando lo necesitan?',geminiResponse:'Sofía Luna aparece como una presencia constante y confiable.',showGemini:true,initialDelay:.3,totalTime:8}
  ];

  let data = [];
  let selected = 0;
  let recorder = null, recorderStream = null, recordedChunks = [], recordingMime = '', recordingActive = false;
  let editorWasHiddenBeforeRecording = false;
  let timingScale = 1;
  let timelinePosition = 0;
  let timelineStartedAt = 0;
  let timelinePauseStartedAt = 0;
  let timelinePausedTotal = 0;
  let timelineRaf = 0;
  let playbackPaused = false;
  let playing = false;
  let tasks = new Set();
  let persistTimer = null;

  const stage = $('#stage'), editor = $('#editor'), page = $('#page'), home = $('#home'), results = $('#results');
  const box = $('#searchBox'), input = $('#searchInput'), searchButton = $('#searchButton'), loader = $('#loader'), address = $('#addressText');
  const rq = $('#resultQuery'), link = $('#firstLink'), thumb = $('#thumb'), avatarInitials = $('#avatarInitials'), thumbImage = $('#thumbImage'), pn = $('#personName'), desc = $('#description');
  const secondLink = $('#secondLink'), secondResultImage = $('#secondResultImage'), secondPhotoFallback = $('#secondPhotoFallback'), secondPersonName = $('#secondPersonName');
  const gemini = $('#geminiCard'), resultsContent = $('#resultsContent'), gp = $('#geminiPrompt'), ga = $('#geminiAnswer'), caret = $('#caret');
  const cursor = $('#cursor'), ring = $('#ring'), finalPhoto = $('#finalPhoto'), finalInner = $('#finalInner'), finalPortraitImage = $('#finalPortraitImage'), finalAvatarInitials = $('#finalAvatarInitials'), finalSecondPortraitImage = $('#finalSecondPortraitImage'), finalSecondAvatarInitials = $('#finalSecondAvatarInitials'), finalName = $('#finalName');
  const sel = $('#exampleSelect'), qe = $('#queryEdit'), ne = $('#nameEdit'), photoEdit = $('#photoEdit'), secondPhotoEdit = $('#secondPhotoEdit'), backgroundEdit = $('#backgroundEdit'), de = $('#descEdit'), pe = $('#promptEdit'), re = $('#responseEdit');
  const delayEdit = $('#delayEdit'), delayValue = $('#delayValue'), totalTimeEdit = $('#totalTimeEdit'), totalTimeValue = $('#totalTimeValue'), timelineEdit = $('#timelineEdit'), timelineValue = $('#timelineValue');
  const statusChip = $('#statusChip'), headerTimeChip = $('#headerTimeChip'), autosaveState = $('#autosaveState'), fullscreenBtn = $('#fullscreenBtn'), toggleEditorBtn = $('#toggleEditorBtn'), playBtn = $('#playBtn'), pauseBtn = $('#pauseBtn'), recordBtn = $('#recordBtn'), nextBtn = $('#nextBtn'), geminiSwitch = $('#geminiSwitch'), geminiFields = $('#geminiFields');

  function setStatus(text){ statusChip.textContent = text; }
  function initials(s){ return (s || '?').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || '?'; }
  function imageUrl(url){ return (url||'').trim(); }
  function normalizeExample(x={}){ const backgroundUrl=(x.backgroundUrl||'').trim(); const isHostedFilePreview=/\/file\/d\/[^/?#]+\/view(?:\?[^#]*)?$/i.test(backgroundUrl); return {id:x.id||makeId(),query:x.query||'la persona más especial de esta escuela',name:x.name||'Nombre Apellido',photoUrl:x.photoUrl||'',secondPhotoUrl:x.secondPhotoUrl||'',backgroundUrl:!backgroundUrl||isHostedFilePreview?DEFAULT_BACKGROUND:backgroundUrl,description:x.description||'Una descripción breve, cálida y fácil de leer.',geminiPrompt:x.geminiPrompt||'¿Qué hace especial a esta persona?',geminiResponse:x.geminiResponse||'Su forma de estar presente y acompañar a los demás hace que destaque de una manera muy especial.',showGemini:x.showGemini!==false,initialDelay:Number.isFinite(Number(x.initialDelay))?Number(x.initialDelay):.3,totalTime:Number.isFinite(Number(x.totalTime))?Number(x.totalTime):8}; }

  let dbPromise = null;
  function openDatabase(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){ reject(new Error('IndexedDB no disponible')); return; }
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE); };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('No se pudo abrir IndexedDB'));
    });
    return dbPromise;
  }
  async function dbGet(key){ const db=await openDatabase(); return new Promise((resolve,reject)=>{ const tx=db.transaction(DB_STORE,'readonly'); const req=tx.objectStore(DB_STORE).get(key); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); }); }
  async function dbSet(key,value){ const db=await openDatabase(); return new Promise((resolve,reject)=>{ const tx=db.transaction(DB_STORE,'readwrite'); tx.objectStore(DB_STORE).put(value,key); tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error); }); }
  async function updateStorageUsage(){
    const usageEl=$('#storageUsage'), badge=$('#storageBadge');
    if(!usageEl) return;
    try{
      if(navigator.storage?.persist) await navigator.storage.persist();
      if(navigator.storage?.estimate){
        const e=await navigator.storage.estimate();
        const mb=n=>((n||0)/1024/1024);
        usageEl.textContent=`Usando ${mb(e.usage).toFixed(mb(e.usage)<10?1:0)} MB de hasta ${mb(e.quota).toFixed(0)} MB disponibles para este sitio.`;
      }else usageEl.textContent='Guardado automático activo en este navegador.';
      if(badge) badge.textContent='IndexedDB ✓';
    }catch(err){ usageEl.textContent='Guardado local activo.'; }
  }
  async function loadStored(){
    try{
      const parsed=await dbGet(DB_STATE_KEY);
      const examples=Array.isArray(parsed)?parsed:parsed?.examples;
      if(Array.isArray(examples)&&examples.length){ data=examples.map(normalizeExample); selected=Math.min(Math.max(0,Number(parsed.selected)||0),data.length-1); return; }
    }catch(err){ console.warn('No se pudo leer IndexedDB',err); }

    // Migración transparente desde la versión antigua que usaba localStorage.
    try{
      const raw=localStorage.getItem(LEGACY_STORAGE_KEY);
      if(raw){
        const parsed=JSON.parse(raw), examples=Array.isArray(parsed)?parsed:parsed.examples;
        if(Array.isArray(examples)&&examples.length){
          data=examples.map(normalizeExample); selected=Math.min(Math.max(0,Number(parsed.selected)||0),data.length-1);
          await dbSet(DB_STATE_KEY,{version:5,selected,examples:data});
          localStorage.removeItem(LEGACY_STORAGE_KEY);
          return;
        }
      }
    }catch(err){ console.warn('No se pudo migrar localStorage',err); }
    data=starterExamples(); selected=0;
  }
  async function persistNow(){
    try{ await dbSet(DB_STATE_KEY,{version:5,selected,examples:data}); autosaveState.textContent='✓ Guardado automático'; updateStorageUsage(); }
    catch(err){ autosaveState.textContent='⚠ No se pudo guardar'; setStatus('El navegador no pudo guardar la biblioteca local. Probá Chrome o Edge y evitá el modo incógnito.'); console.warn(err); }
  }
  function queuePersist(){ autosaveState.textContent='Guardando…'; clearTimeout(persistTimer); persistTimer=setTimeout(()=>{persistNow();},250); }

  function populateSelect(){ sel.innerHTML=''; data.forEach((x,i)=>{ const o=document.createElement('option'); o.value=i; o.textContent=(i+1)+' · '+(x.name||x.query||'Sin nombre'); sel.appendChild(o); }); sel.value=String(selected); $('#deleteExampleBtn').disabled=data.length<=1; }
  function current(){ return data[selected]; }
  function syncEditorToData(){
    const x=current(); if(!x) return null;
    x.query=qe.value.trim(); x.name=ne.value.trim(); x.description=de.value.trim(); x.geminiPrompt=pe.value.trim(); x.geminiResponse=re.value.trim(); if(photoEdit.value.trim()) x.photoUrl=photoEdit.value.trim(); if(secondPhotoEdit.value.trim()) x.secondPhotoUrl=secondPhotoEdit.value.trim(); if(backgroundEdit.value.trim()) x.backgroundUrl=backgroundEdit.value.trim(); x.showGemini=geminiSwitch.checked; x.initialDelay=Number(delayEdit.value)||0; x.totalTime=Number(totalTimeEdit.value)||8;
    queuePersist(); populateSelect(); render(x); return x;
  }
  function loadEditor(){ const x=current(); if(!x) return; qe.value=x.query; ne.value=x.name; photoEdit.value=x.photoUrl.startsWith('data:')?'':x.photoUrl; secondPhotoEdit.value=x.secondPhotoUrl.startsWith('data:')?'':x.secondPhotoUrl; backgroundEdit.value=x.backgroundUrl.startsWith('data:')?'':x.backgroundUrl; de.value=x.description; pe.value=x.geminiPrompt; re.value=x.geminiResponse; geminiSwitch.checked=x.showGemini; delayEdit.value=x.initialDelay; totalTimeEdit.value=x.totalTime; timelinePosition=0; populateSelect(); updateTimingLabels(); updateAllUploaderPreviews(); applyGeminiVisibility(x.showGemini); }

  function setPortraitImage(img, fallbackEl, url){ const normalized=imageUrl(url); if(!normalized){ img.removeAttribute('src'); img.style.display='none'; fallbackEl.style.display=''; return; } img.onload=()=>{img.style.display='block';fallbackEl.style.display='none'}; img.onerror=()=>{img.style.display='none';fallbackEl.style.display=''}; img.src=normalized; }
  function setSecondResultImage(url){ const normalized=imageUrl(url); secondPhotoFallback.textContent=initials(current()?.name); if(!normalized){secondResultImage.removeAttribute('src');secondResultImage.style.display='none';secondPhotoFallback.style.display='grid';return;} secondResultImage.onload=()=>{secondResultImage.style.display='block';secondPhotoFallback.style.display='none'}; secondResultImage.onerror=()=>{secondResultImage.style.display='none';secondPhotoFallback.style.display='grid'}; secondResultImage.src=normalized; }
  function setBackground(el,url){ const normalized=imageUrl(url); if(!normalized){el.style.backgroundImage='';return;} el.style.backgroundImage='url("'+normalized.replace(/"/g,'%22')+'")'; }
  function applyGeminiVisibility(show){ gemini.hidden=!show; resultsContent.classList.toggle('gemini-disabled',!show); geminiFields.classList.toggle('is-off',!show); }
  function applyImages(x){ setPortraitImage(thumbImage,avatarInitials,x.photoUrl); setPortraitImage(finalPortraitImage,finalAvatarInitials,x.photoUrl); setSecondResultImage(x.secondPhotoUrl); setPortraitImage(finalSecondPortraitImage,finalSecondAvatarInitials,x.secondPhotoUrl); setBackground(thumb,x.backgroundUrl); setBackground(finalInner,x.backgroundUrl); }
  function render(x){ if(!x) return; rq.textContent=x.query; link.textContent=x.name; secondLink.textContent=x.name; avatarInitials.textContent=initials(x.name); pn.textContent=x.name; secondPersonName.textContent=x.name; desc.textContent=x.description; gp.textContent=x.geminiPrompt; finalAvatarInitials.textContent=initials(x.name); finalSecondAvatarInitials.textContent=initials(x.name); finalName.textContent=x.name; applyGeminiVisibility(x.showGemini); applyImages(x); }

  function previewPhoto(imgId,fallbackId,stateId,value){ const img=$(imgId),fallback=$(fallbackId),state=$(stateId),src=imageUrl(value); if(!src){img.style.display='none';img.removeAttribute('src');fallback.style.display='';state.textContent='Sin foto';return;} img.onload=()=>{img.style.display='block';fallback.style.display='none';state.textContent=value.startsWith('data:')?'Guardada desde el equipo':'Link cargado'}; img.onerror=()=>{img.style.display='none';fallback.style.display='';state.textContent='No se pudo cargar'}; img.src=src; }
  function updateAllUploaderPreviews(){ const x=current(); if(!x)return; previewPhoto('#photoPreview','#photoPreviewFallback','#photoState',x.photoUrl); previewPhoto('#secondPhotoPreview','#secondPhotoPreviewFallback','#secondPhotoState',x.secondPhotoUrl); const bg=imageUrl(x.backgroundUrl); $('#backgroundPreview').style.backgroundImage=bg?'url("'+bg.replace(/"/g,'%22')+'")':''; $('#backgroundState').textContent=x.backgroundUrl===DEFAULT_BACKGROUND?'Predeterminado':x.backgroundUrl.startsWith('data:')?'Guardado desde el equipo':x.backgroundUrl?'Link cargado':'Sin fondo'; }

  async function imageFileToDataUrl(file,maxSide=1400,quality=.84){
    if(!file||!file.type.startsWith('image/')) throw new Error('Elegí un archivo de imagen.');
    let bitmap=null, img=null, width=0, height=0, drawSource=null, revoke=null;
    try{
      if('createImageBitmap' in window){ bitmap=await createImageBitmap(file); width=bitmap.width;height=bitmap.height;drawSource=bitmap; }
      else{ const url=URL.createObjectURL(file); revoke=()=>URL.revokeObjectURL(url); img=await new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=rej;im.src=url}); width=img.naturalWidth;height=img.naturalHeight;drawSource=img; }
      const scale=Math.min(1,maxSide/Math.max(width,height)); const w=Math.max(1,Math.round(width*scale)),h=Math.max(1,Math.round(height*scale)); const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.drawImage(drawSource,0,0,w,h);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality)); if(!blob) throw new Error('No se pudo optimizar la imagen.');
      return await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)});
    }finally{ if(bitmap&&bitmap.close)bitmap.close(); if(revoke)revoke(); }
  }
  async function useLocalFile(field,file){
    const card=$('.upload-card[data-field="'+field+'"]'); card?.classList.remove('dragging'); setStatus('Optimizando imagen…');
    try{ const max=field==='backgroundUrl'?1800:1400; const value=await imageFileToDataUrl(file,max,field==='backgroundUrl'?.82:.86); current()[field]=value; if(field==='photoUrl')photoEdit.value=''; if(field==='secondPhotoUrl')secondPhotoEdit.value=''; if(field==='backgroundUrl')backgroundEdit.value=''; queuePersist(); render(current()); updateAllUploaderPreviews(); setStatus('Imagen cargada y guardada ✓'); }
    catch(err){ setStatus(err.message||'No se pudo cargar la imagen.'); }
  }
  function applyUrlField(field){ const inputEl=field==='photoUrl'?photoEdit:field==='secondPhotoUrl'?secondPhotoEdit:backgroundEdit; const v=inputEl.value.trim(); if(!v){setStatus('Pegá primero una URL directa a una imagen.');return;} current()[field]=v; queuePersist(); render(current()); updateAllUploaderPreviews(); setStatus('Link aplicado ✓'); }
  function clearImage(field){ current()[field]=''; if(field==='photoUrl')photoEdit.value=''; if(field==='secondPhotoUrl')secondPhotoEdit.value=''; if(field==='backgroundUrl')backgroundEdit.value=''; queuePersist(); render(current()); updateAllUploaderPreviews(); }

  function armTask(task,delay){ task.remaining=Math.max(0,delay); task.startedAt=performance.now(); task.id=setTimeout(()=>{ task.id=null; tasks.delete(task); if(playbackPaused){ tasks.add(task); return; } task.fn(); },task.remaining); }
  function schedule(fn,ms,scaled=true){ const task={fn,remaining:Math.max(0,scaled?ms*timingScale:ms),startedAt:0,id:null}; tasks.add(task); if(!playbackPaused)armTask(task,task.remaining); return task; }
  const later=(fn,ms)=>schedule(fn,ms,true); const laterRaw=(fn,ms)=>schedule(fn,ms,false);
  function stopTimelineTicker(){ if(timelineRaf){cancelAnimationFrame(timelineRaf);timelineRaf=0;} }
  function stopTimers(){ tasks.forEach(t=>{if(t.id)clearTimeout(t.id)}); tasks.clear(); stopTimelineTicker(); playbackPaused=false; playing=false; document.body.classList.remove('playback-paused'); updatePauseButton(); }
  function pausePlayback(){ if(!playing||playbackPaused)return; const now=performance.now(); playbackPaused=true; timelinePauseStartedAt=now; document.body.classList.add('playback-paused'); tasks.forEach(t=>{if(t.id){clearTimeout(t.id);t.id=null;t.remaining=Math.max(0,t.remaining-(now-t.startedAt));}}); stopTimelineTicker(); setStatus('Reproducción pausada · '+timelinePosition.toFixed(1)+' s'); updatePauseButton(); }
  function resumePlayback(){ if(!playing||!playbackPaused)return; const now=performance.now(); timelinePausedTotal+=Math.max(0,now-timelinePauseStartedAt); playbackPaused=false; document.body.classList.remove('playback-paused'); [...tasks].forEach(t=>{if(!t.id)armTask(t,t.remaining)}); startTimelineTicker(); setStatus('Continuando · '+timelinePosition.toFixed(1)+' s'); updatePauseButton(); }
  function updatePauseButton(){ pauseBtn.disabled=!playing; pauseBtn.textContent=playbackPaused?'▶ Continuar':'⏸ Pausar'; }

  function initialDelayMs(x){ return Math.max(0,(Number(x?.initialDelay)||0)*1000); }
  function searchDurationMs(x){ return Math.max(4000,(Number(x?.totalTime)||8)*1000); }
  function rawAnimationFinalMs(x){ return 5650+((x?.query||'').length*48); }
  function timingScaleFor(x){ return searchDurationMs(x)/Math.max(1,rawAnimationFinalMs(x)); }
  function realVideoDurationMs(x){ return initialDelayMs(x)+rawAnimationFinalMs(x)*timingScaleFor(x)+RECORDING_TAIL_MS; }
  function realVideoDurationSeconds(x){ return realVideoDurationMs(x)/1000; }

  function setTimelinePosition(value){
    const x=current(),total=Math.max(.1,realVideoDurationSeconds(x)),v=Math.max(0,Math.min(total,Number(value)||0));
    timelinePosition=v; timelineEdit.max=String(total); timelineEdit.value=String(v);
    timelineValue.textContent=v.toFixed(2)+' / '+total.toFixed(2)+' s';
    if(headerTimeChip){headerTimeChip.textContent=v.toFixed(2)+' / '+total.toFixed(2)+' s';headerTimeChip.title='Tiempo real del video: '+v.toFixed(2)+' de '+total.toFixed(2)+' segundos (delay + búsqueda + cierre)';}
  }
  function updateTimingLabels(){
    const x=current(),delay=Number(delayEdit.value)||0,search=Number(totalTimeEdit.value)||8,total=realVideoDurationSeconds(x);
    delayValue.textContent=delay.toFixed(1)+' s'; totalTimeValue.textContent=search.toFixed(1)+' s'; setTimelinePosition(Math.min(timelinePosition,total));
  }
  function baseAnimationMs(x){ return rawAnimationFinalMs(x); }
  function timelineModel(x){
    const initialMs=initialDelayMs(x),searchMs=searchDurationMs(x);
    const queryDone=1200+((x.query||'').length*48),clickSearch=queryDone+900,resultsAt=clickSearch+720,geminiAt=resultsAt+430,aiStart=resultsAt+650,linkMove=resultsAt+1750,linkClick=resultsAt+2650,finalAt=linkClick+180;
    const scale=searchMs/Math.max(1,finalAt),finalStartMs=initialMs+(finalAt*scale),totalMs=finalStartMs+RECORDING_TAIL_MS;
    return {totalMs,initialMs,searchMs,finalStartMs,scale,queryDone,clickSearch,resultsAt,geminiAt,aiStart,linkMove,linkClick,finalAt};
  }
  function previewTimelineAt(seconds){
    const x=current(); if(!x)return; const m=timelineModel(x),absoluteMs=Math.max(0,Math.min(m.totalMs,seconds*1000)); setTimelinePosition(absoluteMs/1000);
    render(x); home.style.display='flex';results.style.display='none';finalPhoto.classList.remove('show');finalPhoto.style.display='none';gemini.classList.remove('show');loader.classList.remove('active');box.classList.remove('focused');link.classList.remove('clicked');secondLink.classList.remove('clicked');input.value='';ga.textContent='';caret.style.display='inline-block';address.textContent='google.com';cursor.classList.remove('down');ring.classList.remove('pop');cursor.style.display='block';cursor.style.left='80%';cursor.style.top='72%';
    if(absoluteMs<m.initialMs)return;
    const v=(absoluteMs-m.initialMs)/m.scale;
    if(v>=350){const p=point(box);cursor.style.left=p.x+'px';cursor.style.top=p.y+'px';}
    if(v>=950)box.classList.add('focused');
    if(v>=1200){const chars=Math.max(0,Math.min((x.query||'').length,Math.floor((v-1200)/48)));input.value=(x.query||'').slice(0,chars);}
    if(v>=m.queryDone){input.value=x.query||'';const p=point(searchButton);cursor.style.left=p.x+'px';cursor.style.top=p.y+'px';}
    if(v>=m.clickSearch){loader.classList.add('active');address.textContent='google.com/search?q='+(x.query||'').replace(/\s+/g,'+').slice(0,55);}
    if(v>=m.resultsAt){home.style.display='none';results.style.display='block';loader.classList.remove('active');}
    if(v>=m.geminiAt&&x.showGemini)gemini.classList.add('show');
    if(v>=m.aiStart&&x.showGemini){const chars=Math.max(0,Math.min((x.geminiResponse||'').length,Math.floor((v-m.aiStart)/13)));ga.textContent=(x.geminiResponse||'').slice(0,chars);if(chars>=(x.geminiResponse||'').length)caret.style.display='none';}
    if(v>=m.linkMove){const p=point(link);cursor.style.left=p.x+'px';cursor.style.top=p.y+'px';}
    if(v>=m.linkClick)link.classList.add('clicked');
    if(v>=m.finalAt){finalPhoto.style.display='block';finalPhoto.classList.add('show');cursor.style.display='none';}
  }
  function startTimelineTicker(){
    stopTimelineTicker();
    const tick=()=>{if(!playing||playbackPaused)return;const elapsed=Math.max(0,performance.now()-timelineStartedAt-timelinePausedTotal);setTimelinePosition(elapsed/1000);timelineRaf=requestAnimationFrame(tick)};
    timelineRaf=requestAnimationFrame(tick);
  }
  function point(el){ const a=el.getBoundingClientRect(),b=page.getBoundingClientRect(); return{x:a.left-b.left+a.width/2,y:a.top-b.top+a.height/2}; }
  function moveTo(el,delay=0){ later(()=>{const p=point(el);cursor.style.left=p.x+'px';cursor.style.top=p.y+'px'},delay); }
  function clickEl(el,delay=0,cb){ later(()=>{const p=point(el);cursor.style.left=p.x+'px';cursor.style.top=p.y+'px';cursor.classList.add('down');ring.style.left=p.x+'px';ring.style.top=p.y+'px';ring.classList.remove('pop');void ring.offsetWidth;ring.classList.add('pop');later(()=>cursor.classList.remove('down'),130);if(cb)cb()},delay); }
  function type(text,delay,done){ let i=0; later(function step(){input.value=text.slice(0,i++);if(i<=text.length)later(step,48);else if(done)done()},delay); }
  function typeAI(text,delay){ let i=0;ga.textContent='';later(function step(){ga.textContent=text.slice(0,i++);if(i<=text.length)later(step,13);else caret.style.display='none'},delay); }
  function resetScene(x){ stopTimers(); render(x); home.style.display='flex';results.style.display='none';finalPhoto.classList.remove('show');finalPhoto.style.display='none';gemini.classList.remove('show');loader.classList.remove('active');box.classList.remove('focused');link.classList.remove('clicked');secondLink.classList.remove('clicked');input.value='';ga.textContent='';caret.style.display='inline-block';address.textContent='google.com';cursor.style.display='block';cursor.style.left='80%';cursor.style.top='72%';setTimelinePosition(0); }
  function completePlayback(){
    const total=realVideoDurationSeconds(current()); setTimelinePosition(total); stopTimelineTicker(); playing=false; updatePauseButton();
    if(recordingActive&&recorder&&recorder.state!=='inactive'){ setStatus('Cerrando grabación…'); recorder.stop(); }
    else setStatus('Animación terminada · '+total.toFixed(2)+' s');
  }
  function showFinal(){
    finalPhoto.style.display='block';requestAnimationFrame(()=>finalPhoto.classList.add('show'));cursor.style.display='none';
    if(!playing){setTimelinePosition(realVideoDurationSeconds(current()));stopTimelineTicker();updatePauseButton();return;}
    setStatus(recordingActive?'Grabando cierre…':'Mostrando cierre…'); laterRaw(completePlayback,RECORDING_TAIL_MS);
  }
  function runAnimation(x){ moveTo(box,350);later(()=>box.classList.add('focused'),950);type(x.query,1200,()=>{moveTo(searchButton,150);clickEl(searchButton,900,()=>{loader.classList.add('active');address.textContent='google.com/search?q='+x.query.replace(/\s+/g,'+').slice(0,55);later(()=>{home.style.display='none';results.style.display='block';loader.classList.remove('active');if(x.showGemini){later(()=>gemini.classList.add('show'),430);typeAI(x.geminiResponse,650)}moveTo(link,1750);clickEl(link,2650,()=>{link.classList.add('clicked');later(showFinal,180)})},720)})}); }
  function play(){
    const x=syncEditorToData(); if(!x||!x.query||!x.name){setStatus('Completá al menos nombre y búsqueda.');return;}
    resetScene(x); timingScale=timingScaleFor(x); updateTimingLabels();
    const initialDelay=initialDelayMs(x),videoTotal=realVideoDurationSeconds(x); playing=true;timelineStartedAt=performance.now();timelinePausedTotal=0;timelinePauseStartedAt=0;setTimelinePosition(0);startTimelineTicker();updatePauseButton();setStatus('Reproduciendo · video '+videoTotal.toFixed(2)+' s');
    if(initialDelay>0)laterRaw(()=>runAnimation(x),initialDelay);else runAnimation(x);
  }

  function bestRecordingMime(){ if(!window.MediaRecorder)return ''; const c=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']; return c.find(t=>MediaRecorder.isTypeSupported(t))||''; }
  function slugify(text){return(text||'ejemplo').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'ejemplo'}
  function restoreAfterRecording(){document.body.classList.remove('recording-mode');if(!editorWasHiddenBeforeRecording)editor.classList.remove('is-hidden');toggleEditorBtn.textContent=editor.classList.contains('is-hidden')?'✎ Mostrar editor':'✎ Ocultar editor';recordBtn.disabled=false}
  async function recordCurrentExample(){ const x=syncEditorToData(); if(!x)return; if(!navigator.mediaDevices||!navigator.mediaDevices.getDisplayMedia||!window.MediaRecorder){setStatus('Usá Chrome o Edge actualizado para la grabación automática.');return;} editorWasHiddenBeforeRecording=editor.classList.contains('is-hidden');recordBtn.disabled=true;setStatus('Elegí “Esta pestaña” y tocá Compartir'); try{ recorderStream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:60}},audio:false,preferCurrentTab:true,selfBrowserSurface:'include',surfaceSwitching:'exclude'});document.body.classList.add('recording-mode');const mime=bestRecordingMime();recordingMime=mime||'video/webm';recordedChunks=[];recorder=mime?new MediaRecorder(recorderStream,{mimeType:mime,videoBitsPerSecond:8000000}):new MediaRecorder(recorderStream);recorder.ondataavailable=e=>{if(e.data&&e.data.size>0)recordedChunks.push(e.data)};recorder.onstop=()=>{recordingActive=false;if(recorderStream){recorderStream.getTracks().forEach(t=>t.stop());recorderStream=null}const actual=recorder.mimeType||recordingMime||'video/webm',isMp4=actual.toLowerCase().includes('mp4'),ext=isMp4?'mp4':'webm',blob=new Blob(recordedChunks,{type:actual}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=String(selected+1).padStart(2,'0')+'-'+slugify(x.name)+'.'+ext;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);restoreAfterRecording();setStatus(isMp4?'Video MP4 descargado ✓':'Video WebM descargado ✓')};recorderStream.getVideoTracks()[0].addEventListener('ended',()=>{if(recorder&&recorder.state!=='inactive')recorder.stop()});await new Promise(r=>setTimeout(r,450));recordingActive=true;recorder.start(250);play(); }catch(err){recordingActive=false;if(recorderStream){recorderStream.getTracks().forEach(t=>t.stop());recorderStream=null}restoreAfterRecording();setStatus('Grabación cancelada o no autorizada.')} }


  function addNewExample(){ syncEditorToData(); data.push(normalizeExample({name:'Nuevo ejemplo',backgroundUrl:DEFAULT_BACKGROUND,showGemini:true}));selected=data.length-1;persistNow();loadEditor();render(current());setStatus('Nuevo ejemplo creado'); }
  function duplicateExample(){ const copy=normalizeExample({...current(),id:makeId(),name:(current().name||'Ejemplo')+' copia'});data.splice(selected+1,0,copy);selected++;persistNow();loadEditor();render(current());setStatus('Ejemplo duplicado'); }
  function deleteExample(){ if(data.length<=1)return; const name=current().name||'este ejemplo'; if(!confirm('¿Eliminar “'+name+'”?'))return; data.splice(selected,1);selected=Math.min(selected,data.length-1);persistNow();loadEditor();render(current());setStatus('Ejemplo eliminado'); }

  [qe,ne,de,pe,re].forEach(el=>el.addEventListener('input',()=>{syncEditorToData()}));
  delayEdit.addEventListener('input',()=>{syncEditorToData();updateTimingLabels();previewTimelineAt(Math.min(timelinePosition,realVideoDurationSeconds(current())))}); totalTimeEdit.addEventListener('input',()=>{syncEditorToData();updateTimingLabels();previewTimelineAt(Math.min(timelinePosition,realVideoDurationSeconds(current())))});
  timelineEdit.addEventListener('input',()=>{stopTimers();previewTimelineAt(Number(timelineEdit.value)||0);setStatus('Timeline · '+Number(timelineEdit.value).toFixed(1)+' s')});
  geminiSwitch.addEventListener('change',()=>{current().showGemini=geminiSwitch.checked;applyGeminiVisibility(geminiSwitch.checked);queuePersist();render(current());setStatus(geminiSwitch.checked?'Gemini visible':'Gemini oculto')});
  sel.addEventListener('change',()=>{const next=Number(sel.value)||0;syncEditorToData();selected=Math.min(next,data.length-1);loadEditor();render(current());setStatus('Ejemplo cargado')});
  playBtn.addEventListener('click',play); pauseBtn.addEventListener('click',()=>playbackPaused?resumePlayback():pausePlayback()); recordBtn.addEventListener('click',recordCurrentExample); nextBtn.addEventListener('click',()=>{syncEditorToData();selected=(selected+1)%data.length;loadEditor();render(current());play()});
  $('#newExampleBtn').addEventListener('click',addNewExample);$('#duplicateExampleBtn').addEventListener('click',duplicateExample);$('#deleteExampleBtn').addEventListener('click',deleteExample);$('#resetStorageBtn').addEventListener('click',()=>{if(!confirm('¿Restaurar los ejemplos iniciales? Se perderán los cambios guardados en este navegador.'))return;data=starterExamples();selected=0;persistNow();loadEditor();render(current());setStatus('Ejemplos restaurados')});
  $('#photoFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)useLocalFile('photoUrl',f);e.target.value=''});$('#secondPhotoFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)useLocalFile('secondPhotoUrl',f);e.target.value=''});$('#backgroundFile').addEventListener('change',e=>{const f=e.target.files?.[0];if(f)useLocalFile('backgroundUrl',f);e.target.value=''});
  $$('[data-apply-url]').forEach(b=>b.addEventListener('click',()=>applyUrlField(b.dataset.applyUrl)));$$('[data-clear-image]').forEach(b=>b.addEventListener('click',()=>clearImage(b.dataset.clearImage)));$('#restoreBackgroundBtn').addEventListener('click',()=>{current().backgroundUrl=DEFAULT_BACKGROUND;backgroundEdit.value=DEFAULT_BACKGROUND;queuePersist();render(current());updateAllUploaderPreviews();setStatus('Fondo predeterminado restaurado')});
  [photoEdit,secondPhotoEdit,backgroundEdit].forEach((el,i)=>el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyUrlField(i===0?'photoUrl':i===1?'secondPhotoUrl':'backgroundUrl')}}));
  $$('.upload-card').forEach(card=>{const field=card.dataset.field;['dragenter','dragover'].forEach(ev=>card.addEventListener(ev,e=>{e.preventDefault();card.classList.add('dragging')}));['dragleave','drop'].forEach(ev=>card.addEventListener(ev,e=>{e.preventDefault();card.classList.remove('dragging')}));card.addEventListener('drop',e=>{const f=[...(e.dataTransfer?.files||[])].find(f=>f.type.startsWith('image/'));if(f)useLocalFile(field,f)})});
  fullscreenBtn.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await stage.requestFullscreen()}catch(err){setStatus('El navegador no permitió pantalla completa.')}});document.addEventListener('fullscreenchange',()=>{fullscreenBtn.textContent=document.fullscreenElement?'⤢ Salir de pantalla completa':'⛶ Pantalla completa'});toggleEditorBtn.addEventListener('click',()=>{editor.classList.toggle('is-hidden');toggleEditorBtn.textContent=editor.classList.contains('is-hidden')?'✎ Mostrar editor':'✎ Ocultar editor'});
  link.addEventListener('click',e=>{e.preventDefault();showFinal()});secondLink.addEventListener('click',e=>{e.preventDefault();showFinal()});

  (async()=>{ await loadStored(); loadEditor(); render(current()); updateTimingLabels(); await persistNow(); updateStorageUsage(); setStatus('Listo para editar'); setTimeout(play,350); })();
})();
