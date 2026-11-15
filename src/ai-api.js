// S.A.M uses a same-origin Gemini proxy. Credentials exist only on the server.
export const AI_CONFIG={enabled:true,endpoint:'/api/si/chat',statusEndpoint:'/api/si/status',timeoutMs:30000,maxHistory:19};
export class AINotConnectedError extends Error {}
export class AIClient {
  constructor(config=AI_CONFIG){this.config=config;this.history=[];}
  get connected(){return Boolean(this.config.enabled&&this.config.endpoint);}
  clear(){this.history=[];}
  async send(text,context={}){
    if(!this.connected)throw new AINotConnectedError('S.A.M is unavailable.');
    const messages=[...this.history,{role:'user',content:text}].slice(-this.config.maxHistory);
    const response=await fetch(this.config.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages,context}),signal:AbortSignal.timeout(this.config.timeoutMs)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'S.A.M could not respond. Please try again.');
    if(typeof data.reply!=='string'||!data.reply.trim())throw new Error('S.A.M returned an empty response.');
    this.history=[...messages,{role:'assistant',content:data.reply}];
    return data.reply;
  }
}
export function initAIPanel({getContext}){
  const client=new AIClient();
  const panel=document.querySelector('#aiPanel'),messages=document.querySelector('#aiMessages'),form=document.querySelector('#aiForm'),input=document.querySelector('#aiInput'),status=document.querySelector('#aiStatus'),send=form.querySelector('button');
  let busy=false,returnFocus=null;
  const addMessage=(role,text)=>{const item=document.createElement('div');item.className=`ai-message ${role}`;item.textContent=text;messages.appendChild(item);messages.scrollTop=messages.scrollHeight;return item;};
  const refreshStatus=async()=>{
    try{const response=await fetch(client.config.statusEndpoint,{signal:AbortSignal.timeout(5000)});const data=await response.json();status.classList.toggle('online',Boolean(data.configured));status.querySelector('span').textContent=data.configured?'Ready · Gemini':'Not configured';}
    catch{status.classList.remove('online');status.querySelector('span').textContent='Unavailable';}
  };
  const setOpen=open=>{if(open)returnFocus=document.activeElement;panel.classList.toggle('open',open);panel.setAttribute('aria-hidden',String(!open));panel.inert=!open;if(open){input.focus();refreshStatus();}else returnFocus?.focus();};
  panel.inert=true;
  document.querySelector('#openAI').addEventListener('click',()=>setOpen(!panel.classList.contains('open')));
  document.querySelector('#closeAI').addEventListener('click',()=>setOpen(false));
  panel.addEventListener('keydown',event=>{if(event.key==='Escape')setOpen(false);});
  document.querySelectorAll('.ai-chip').forEach(chip=>chip.addEventListener('click',()=>{input.value=chip.dataset.prompt;input.focus();}));
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(!busy)form.requestSubmit();}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();const text=input.value.trim();if(!text||busy)return;
    if(text.length>4000)return;
    busy=true;send.disabled=true;input.disabled=true;form.setAttribute('aria-busy','true');addMessage('user',text);input.value='';
    const pending=addMessage('assistant','S.A.M is thinking…');
    try{pending.textContent=await client.send(text,getContext());}
    catch(error){pending.classList.add('error');pending.textContent=error.name==='TimeoutError'?'S.A.M took too long to respond. Please try again.':error.message;refreshStatus();}
    finally{busy=false;send.disabled=false;input.disabled=false;form.removeAttribute('aria-busy');if(panel.classList.contains('open'))input.focus();messages.scrollTop=messages.scrollHeight;}
  });
  addMessage('assistant',"Hello, explorer. I’m S.A.M, your Mars companion. Ask me about a NASA layer, a mission, or the weather observations on this map.");
  refreshStatus();return client;
}
