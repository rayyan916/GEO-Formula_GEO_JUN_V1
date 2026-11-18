'use strict';
// Room protocol: host admission, shared clock and player state over secure WebSockets.
window.GeoNet=(()=>{
 const VERSION='geo-junior-3-circuits-spiral',PREFIX='geojr1-',LIMIT=4;
 let peer=null,host=false,code='',self='',members=[],links=new Map(),started=false,starting=false,ready=false,offset=0,epoch=0,lastSend=0,lastRoster=0,clockTimer=null,connectTimer=null,finishShown=false,closing=false,hostLast=0;
 const now=()=>Date.now()+offset;
 const status=s=>{$('netStatus').textContent=s;};
 const safeSend=(c,p)=>{if(c?.open)try{c.send(p);}catch{}};
 function broadcast(p){for(const c of links.values())safeSend(c,p);}
 function reset(){closing=true;clearInterval(clockTimer);clearTimeout(connectTimer);for(const c of links.values())c.close();links.clear();peer?.destroy();peer=null;host=false;self='';members=[];started=false;starting=false;ready=false;offset=0;finishShown=false;closing=false;}
 function fail(s){if(closing)return;reset();if(game?.multiplayer){game=null;garage();}modal(`<div class="q-meta">連線狀態</div><h2>未能繼續比賽</h2><p>${escapeHTML(s)}</p><p>可重新建立／加入比賽，或返回單人模式。</p><div class="panel-actions"><button id="netDismiss" class="primary">返回車庫</button></div>`);$('netDismiss').onclick=()=>closeModal();status(s);}
 function me(){return members.find(m=>m.id===self);}
 function roomPacket(){return {type:'roster',v:VERSION,members:members.map(m=>({...m})),track:selectedTrack,laps:selectedLaps,code};}
 function syncRoom(){broadcast(roomPacket());lobby();}
 function lobby(){if(started||starting)return;const all=members.length>=2&&members.every(m=>m.ready);
  modal(`<div class="q-meta">2–4 PLAYER / 多人競速</div><div class="room-heading"><h2>比賽編號 <strong id="roomCode">${escapeHTML(code)}</strong></h2><button id="copyRoom">複製編號</button></div><p>${host?'你是房主。等候同學加入，所有人準備後即可開始。':'已加入比賽。準備後等待房主開始。'}<br>${Racing3D.TRACKS[selectedTrack].name} · ${selectedLaps}圈 · ${members.length}/4人</p><div class="lobby-list">${members.map((m,i)=>`<div class="lobby-player"><span>${String(i+1).padStart(2,'0')}</span><b>${escapeHTML(m.name)}${m.id===self?'（你）':''}${i===0?' · 房主':''}</b><small>${CARS[m.car].name}</small><em>${m.ready?'已準備':'準備中'}</em></div>`).join('')}</div><p class="room-note">保持本頁開啟。每位玩家獨立答題，答題不暫停賽事。</p><div id="roomFeedback" role="status"></div><div class="panel-actions"><button id="leaveRoom">離開比賽</button><button id="readyRoom">${ready?'取消準備':'我已準備'}</button>${host?`<button id="launchRoom" class="primary" ${all?'':'disabled'}>共同起跑 →</button>`:''}</div>`);
  $('leaveRoom').onclick=()=>{reset();closeModal();status('已離開比賽，可重新建立或加入。');};
  $('copyRoom').onclick=async()=>{try{await navigator.clipboard.writeText(code);$('roomFeedback').textContent='已複製比賽編號。';}catch{$('roomFeedback').textContent='請把 '+code+' 告訴其他玩家。';}};
  $('readyRoom').onclick=()=>{ready=!ready;if(host){me().ready=ready;syncRoom();}else safeSend(links.get('host'),{type:'ready',ready});};
  if(host)$('launchRoom').onclick=()=>{if(members.length>=2&&members.every(m=>m.ready)){starting=true;const packet={type:'start',v:VERSION,epoch:now()+4500,track:selectedTrack,laps:selectedLaps,members:members.map(m=>({...m})),code};broadcast(packet);begin(packet);}};
 }
 function validPlayer(p){return p&&p.v===VERSION&&typeof p.name==='string'&&p.name.trim()&&Number.isInteger(p.car)&&p.car>=0&&p.car<CARS.length&&carAllowed(p.car,p.name.trim().slice(0,18));}
 function hostConnection(c){let admitted=false;const deadline=setTimeout(()=>{if(!admitted)c.close();},10000);
  c.on('data',p=>{
   if(!p||typeof p!=='object')return;
   if(!admitted){if(p.type!=='hello')return;clearTimeout(deadline);
    if(started||starting||members.length>=LIMIT||!validPlayer(p)){safeSend(c,{type:'reject',reason:started||starting?'這場比賽已開始，請等下一場。':members.length>=LIMIT?'比賽已滿4人。':'版本不同，請使用相同的初中地理版本。'});setTimeout(()=>c.close(),500);return;}
    admitted=true;links.set(c.peer,c);members.push({id:c.peer,name:p.name.trim().slice(0,18),car:p.car,ready:false,dist:0,lane:0,speed:0,finish:null,seen:Date.now()});syncRoom();return;
   }
   const m=members.find(m=>m.id===c.peer);if(!m)return;m.seen=Date.now();
   if(p.type==='ping')safeSend(c,{type:'pong',sent:p.sent,time:Date.now()});
   if(p.type==='ready'&&!started&&!starting){m.ready=!!p.ready;syncRoom();}
   if(p.type==='state'&&started){applyState(m,p);syncRemote();}
  });
  c.on('close',()=>{clearTimeout(deadline);if(!admitted||closing)return;links.delete(c.peer);const m=members.find(m=>m.id===c.peer);if(started){if(m){m.disconnected=true;m.speed=0;}broadcast({type:'states',members,time:now()});message('有車手離線，其他車手繼續比賽',4);}else{members=members.filter(m=>m.id!==c.peer);syncRoom();}});
  c.on('error',()=>c.close());
 }
 function startPeer(isHost,joinCode){ensureCarSelection();reset();host=isHost;code=joinCode;status('正在連接比賽訊號服務…');
  if(typeof RoomPeer==='undefined'){fail('未能載入連線元件。請重新整理，或使用下載套件中的完整檔案。');return;}
  const options={...window.GEO_NET_CONFIG};peer=isHost?new RoomPeer(PREFIX+code,options):new RoomPeer(undefined,options);
  connectTimer=setTimeout(()=>fail('連線逾時。請檢查網絡是否允許多人連線服務，並確認房主仍在等候室。'),20000);
  peer.on('error',e=>fail(e.type==='unavailable-id'?'此編號正被使用，請重新建立比賽。':e.type==='peer-unavailable'?'找不到這個比賽編號，請核對編號及房主狀態。':'未能建立連線：'+(e.type||'網絡錯誤')));
  peer.on('open',id=>{self=id;if(host){clearTimeout(connectTimer);members=[{id,name:driver,car:selected,ready:false,dist:0,lane:0,speed:0,finish:null,seen:Date.now()}];status('已建立比賽 '+code);lobby();peer.on('connection',hostConnection);}else{
    const c=peer.connect(PREFIX+code,{reliable:true,serialization:'json'});links.set('host',c);
    c.on('open',()=>{safeSend(c,{type:'hello',v:VERSION,name:driver,car:selected});safeSend(c,{type:'ping',sent:Date.now()});clockTimer=setInterval(()=>safeSend(c,{type:'ping',sent:Date.now()}),2000);});
    c.on('data',p=>{if(!p)return;hostLast=Date.now();
     if(p.type==='reject'){fail(p.reason);return;}
     if(p.type==='pong'){offset=p.time+(Date.now()-p.sent)/2-Date.now();return;}
     if(p.type==='roster'){if(p.v!==VERSION){fail('版本不符，請重新載入相同的遊戲網址。');return;}clearTimeout(connectTimer);members=p.members;if(!validRaceSettings(p.track,p.laps)){fail('比賽設定無效，請更新遊戲後重新加入。');return;}selectedTrack=p.track;selectedLaps=p.laps;ready=!!me()?.ready;status('已加入比賽 '+code);lobby();}
     if(p.type==='start'&&!started){begin(p);}
     if(p.type==='states'){members=p.members;syncRemote();}
     if(p.type==='end'){fail('房主已結束這場比賽。');}
    });
    c.on('close',()=>{if(!closing)fail('與房主的連線已中斷。請重新加入下一場比賽。');});c.on('error',()=>{if(!closing)fail('與房主未能建立資料連線。可嘗試另一個網絡。');});
   }});
 }
 function applyState(m,p){const g=p.state;if(!g||!Number.isFinite(g.dist)||!Number.isFinite(g.lane)||!Number.isFinite(g.speed))return;
  m.dist=Math.max(m.dist||0,Math.min(LENGTH*LAPS,Math.max(0,g.dist)));m.lane=Math.max(-1.1,Math.min(1.1,g.lane));m.speed=Math.max(0,Math.min(CARS[m.car].max*CARS[m.car].boost*1.20,g.speed));m.boost=Math.max(0,Math.min(6,Number(g.boost)||0));m.spiral=CARS[m.car].secret?Math.max(0,Math.min(3,Number(g.spiral)||0)):0;m.braking=!!g.braking;
  if(m.finish===null&&m.dist>=LENGTH*LAPS&&Number.isFinite(g.finish))m.finish=Math.max(0,g.finish);m.seen=Date.now();
 }
 function begin(p){if(p.v!==VERSION||!validRaceSettings(p.track,p.laps)){fail('比賽設定無效，請更新遊戲後重新加入。');return;}starting=true;members=p.members;selectedTrack=p.track;selectedLaps=p.laps;epoch=p.epoch;makeGame();game.multiplayer=true;game.ai=[];const slot=members.findIndex(m=>m.id===self);game.x=[-.66,-.22,.22,.66][slot];game.collide=3;
  members.forEach((m,i)=>{m.dist=0;m.lane=[-.66,-.22,.22,.66][i];m.speed=CARS[m.car].max*.38;m.finish=null;});
  game.ai=members.filter(m=>m.id!==self).map(m=>({id:m.id,i:m.car,name:m.name,dist:0,targetDist:0,lane:m.lane,targetLane:m.lane,speed:m.speed,vx:0,finish:null,net:true,receivedAt:performance.now()}));
  showScreen('race');resize();openQuiz(true);updateHud();started=true;finishShown=false;lastSend=0;lastRoster=0;hostLast=Date.now();
  modal('<div class="q-meta">ONLINE GRID / 同步起跑</div><div class="countdown">4</div><p style="text-align:center">'+members.length+'位車手 · '+Racing3D.TRACKS[selectedTrack].name+'<br>每人獨立答題，賽事持續進行</p>');
 }
 function syncRemote(){if(!game?.multiplayer)return;for(const a of game.ai){const m=members.find(m=>m.id===a.id);if(!m)continue;a.targetDist=m.dist;a.targetLane=m.lane;a.speed=m.speed;a.boost=m.boost||0;a.spiral=m.spiral||0;a.braking=m.braking;a.finish=m.finish;a.disconnected=m.disconnected;a.receivedAt=performance.now();if(a.finish!==null){a.dist=LENGTH*LAPS;a.speed=0;}if(a.disconnected)a.speed=0;}}
 function tick(t){if(!started||!game?.multiplayer)return;const time=now();
  if(starting){const remain=epoch-time;if(remain>0){const n=document.querySelector('.countdown');if(n)n.textContent=Math.ceil(remain/1000);return;}starting=false;closeModal();game.paused=false;game.speed=game.cruise;message('綠燈！與同學同場競速',3);}
  if(!game.finished)game.elapsed=Math.max(0,(time-epoch)/1000);
  if(t-lastSend>80){lastSend=t;const state={dist:game.dist,lane:game.x,speed:game.speed,boost:game.boost,spiral:game.spiral,braking:game.braking,finish:game.finished?game.finishTime:null};
   if(host){const m=me();if(m){applyState(m,{state});broadcast({type:'states',members:members.map(m=>({...m})),time});syncRemote();}}else safeSend(links.get('host'),{type:'state',state});
  }
  if(host&&time-lastRoster>1000){lastRoster=time;for(const m of members)if(m.id!==self&&!m.finish&&!m.disconnected&&Date.now()-m.seen>15000){m.disconnected=true;m.speed=0;links.get(m.id)?.close();}broadcast({type:'states',members:members.map(m=>({...m})),time});}
  if(!host&&Date.now()-hostLast>20000){fail('房主超過20秒沒有回應，這場比賽已停止。');return;}
  if(game.track===1&&!game.finished){const cycle=Math.floor((game.elapsed-12)/27);if(cycle>=0){const at=12+cycle*27,age=game.elapsed-at;if(age<15){if(game.wave?.cycle!==cycle){game.wave={at,dist:(400+cycle*811)%LENGTH,hit:false,cycle};if(age<4)message('巨浪預警！前方固定路段即將濕滑',3);}}else game.wave=null;}}
  if(game.finished&&!finishShown){const pending=members.filter(m=>m.finish===null&&!m.disconnected);if(!pending.length||time-epoch>game.finishTime*1000+180000){finishShown=true;showOnlineResults();}else{const wait=$('finishWaiting');if(wait)wait.textContent='等候 '+pending.length+' 位車手衝線。最多等候3分鐘。';}}
 }
 const soloFinish=finish;
 finish=function(){if(!game?.multiplayer){soloFinish();return;}game.finished=true;game.paused=true;game.finishTime=Math.max(0,(now()-epoch)/1000);game.elapsed=game.finishTime;game.speed=0;const m=me();if(m){m.dist=LENGTH*LAPS;m.finish=game.finishTime;m.speed=0;}
  modal(`<div class="q-meta">CHEQUERED FLAG / 已衝線</div><h2>${escapeHTML(driver)}，完成${LAPS}圈！</h2><p>${format(game.finishTime)} · 答對 ${game.correct}/${game.total} 題</p><p id="finishWaiting">正在同步所有車手的完成時間…</p><div id="liveStandings"></div><p>請保持頁面開啟，等候最後排名。</p>`);
 };
 function sorted(){return members.slice().sort((a,b)=>a.finish!==null&&b.finish!==null?a.finish-b.finish:a.finish!==null?-1:b.finish!==null?1:(!!a.disconnected-!!b.disconnected)||b.dist-a.dist);}
 function showOnlineResults(){const rows=sorted(),rank=rows.findIndex(m=>m.id===self)+1;
  modal(`<div class="q-meta">ONLINE RESULTS / 比賽 ${code}</div><h2>多人比賽成績</h2><div class="result-rank">P${rank}<small> / ${members.length}</small></div><table class="results">${rows.map((m,i)=>`<tr class="${m.id===self?'you':''}"><td>P${i+1}</td><td>${escapeHTML(m.name)}</td><td>${CARS[m.car].name}</td><td>${m.finish!==null?format(m.finish):m.disconnected?'離線／未完成':'未完成'}</td></tr>`).join('')}</table><p>你答對 ${game.correct}/${game.total} 題 · ${Racing3D.TRACKS[selectedTrack].name} · ${LAPS}圈</p><div id="shareStatus" class="feedback"></div><div class="panel-actions"><button id="onlineCopy">複製成績</button><button id="onlineCard">下載成績卡</button><button id="onlineBack" class="primary">返回車庫</button></div>`);
  $('onlineCopy').onclick=()=>copy(`地理方程式Geo｜初中地理 · ${driver} · ${LAPS}圈 · 比賽${code} · 排名${rank}/${members.length} · ${format(game.finishTime)} · 答對${game.correct}/${game.total}題`);
  $('onlineCard').onclick=()=>downloadCard(rank);$('onlineBack').onclick=()=>{reset();closeModal();game=null;garage();};
 }
 function exitPrompt(){modal('<div class="q-meta">ONLINE RACE / 多人比賽持續進行</div><h2>要離開這場比賽嗎？</h2><p>多人比賽不能暫停。'+(host?'你是房主；離開會結束所有玩家的比賽。':'離開後將記錄為未完成。')+'</p><div class="panel-actions"><button id="confirmLeave">離開比賽</button><button id="continueOnline" class="primary">繼續比賽</button></div>');$('continueOnline').onclick=()=>closeModal();$('confirmLeave').onclick=()=>{if(host)broadcast({type:'end'});reset();closeModal();game=null;garage();};}
 $('createRoom').onclick=()=>{const bytes=new Uint8Array(6);crypto.getRandomValues(bytes);const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';startPeer(true,Array.from(bytes,b=>alphabet[b%alphabet.length]).join(''));};
 $('joinRoom').onclick=()=>{const c=$('roomCodeInput').value.trim().toUpperCase();if(!/^[A-HJ-NP-Z2-9]{6}$/.test(c)){status('請輸入正確的6位比賽編號（不含I、O、0、1）。');return;}startPeer(false,c);};
 return {tick,exitPrompt,get active(){return started;}};
})();
