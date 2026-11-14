'use strict';
// Small connection adapter over secure MQTT WebSockets, with no retained game packets.
// Public relay carries aliases and race telemetry only. A private broker can be configured.
window.RoomPeer=(()=>{
 class Events{constructor(){this.handlers={};}on(t,f){(this.handlers[t]??=[]).push(f);return this;}emit(t,...v){for(const f of this.handlers[t]||[])f(...v);}}
 class Connection extends Events{
  constructor(owner,id){super();this.owner=owner;this.peer=id;this.open=false;}
  send(data){if(this.open)this.owner.packet(this.peer,'data',data);}
  close(){if(!this.open)return;this.open=false;this.owner.packet(this.peer,'close');this.emit('close');this.owner.links.delete(this.peer);}
 }
 return class RoomPeer extends Events{
  constructor(id,options={}){super();this.id=id||'p'+crypto.randomUUID().replaceAll('-','');this.links=new Map();this.closed=false;const cfg=window.GEO_NET_CONFIG||{};this.root='geojunior/race-v1/';
   this.client=mqtt.connect(cfg.relayUrl||'wss://broker.emqx.io:8084/mqtt',{clientId:'geo_'+crypto.randomUUID().slice(0,18),clean:true,reconnectPeriod:0,connectTimeout:15000,keepalive:15,...(cfg.relayOptions||{})});
   this.client.on('connect',()=>this.client.subscribe(this.root+this.id,{qos:0},err=>{if(err)this.emit('error',{type:'relay-subscribe'});else this.emit('open',this.id);}));
   this.client.on('message',(_,bytes)=>{if(bytes.length>16000)return;let p;try{p=JSON.parse(bytes.toString());}catch{return;}if(!p||p.v!==1||typeof p.from!=='string'||p.from.length>80)return;
    let c=this.links.get(p.from);
    if(p.kind==='offer'){if(!c){c=new Connection(this,p.from);this.links.set(p.from,c);this.emit('connection',c);c.open=true;c.emit('open');}this.packet(p.from,'accept');return;}
    if(!c)return;
    if(p.kind==='accept'){c.open=true;c.emit('open');}
    if(p.kind==='data'&&c.open)c.emit('data',p.data);
    if(p.kind==='close'){c.open=false;this.links.delete(p.from);c.emit('close');}
   });
   this.client.on('error',()=>{if(!this.closed)this.emit('error',{type:'relay-network'});});
   this.client.on('close',()=>{if(!this.closed)this.emit('error',{type:'relay-disconnected'});});
  }
  packet(to,kind,data){if(!this.closed&&this.client.connected)this.client.publish(this.root+to,JSON.stringify({v:1,from:this.id,kind,data}),{qos:0,retain:false});}
  connect(id){const c=new Connection(this,id);this.links.set(id,c);this.packet(id,'offer');return c;}
  destroy(){this.closed=true;for(const c of this.links.values())c.close();this.links.clear();this.client.end(false);}
 };
})();
