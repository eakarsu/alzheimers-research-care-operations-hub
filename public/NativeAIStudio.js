(function (global) {
  'use strict';
  const escape = value => global.BrowserAIReport.escape(value);
  const names = ['Quick brief', 'Team planning', 'Detailed review'];
  const list = payload => {
    if (Array.isArray(payload)) return payload;
    for (const key of ['data', 'rows', 'items']) {
      if (Array.isArray(payload?.[key])) return payload[key];
    }
    throw new Error('The records response did not contain a list.');
  };
  const title = key => String(key).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, c => c.toUpperCase());
  function readable(node) {
    const clone=node.cloneNode(true);clone.querySelectorAll('p,h1,h2,h3,h4,li,dt,dd,tr,section,pre').forEach(item=>item.append('\n'));clone.querySelectorAll('td,th').forEach(item=>item.append('\t'));
    return clone.textContent.replace(/\n{3,}/g,'\n\n').trim();
  }
  function mount({element,config,request}) {
    const state={active:config.features[0]?.id,fields:{},files:{},records:{},result:null,error:'',notice:'',busy:false,controller:null,version:0,authenticated:false,selected:null};
    function cancel(message=true){state.version++;state.controller?.abort();state.controller=null;state.busy=false;if(message)state.notice='Request canceled.';}
    function feature(){return config.features.find(item=>item.id===state.active);}
    function renderFields(){return feature().fields.map(field=>{
      const value=state.fields[field.key]??'',id='native-ai-'+field.key;
      const options=field.resource?(state.records[field.resource]||[]):null;
      const input=field.type==='file'?`<input id="${escape(id)}" name="${escape(field.key)}" type="file" accept="${escape(field.accept||'image/*')}" ${field.required&&!state.files[field.key]?'required':''}>${state.files[field.key]?'<span>Selected source: '+escape(state.files[field.key].name)+'</span>':''}`:options?`<select id="${escape(id)}" name="${escape(field.key)}" ${field.required?'required':''}><option value="">Choose an existing record</option>${options.map(row=>`<option value="${escape(row.id)}" ${String(row.id)===String(value)?'selected':''}>${escape(row.name||row.title||row.employeeName||row.planName||row.id)} · ${escape(row.id)}</option>`).join('')}</select>`:field.type==='number'?`<input id="${escape(id)}" name="${escape(field.key)}" type="number" step="any" value="${escape(value)}" ${field.required?'required':''}>`:`<textarea id="${escape(id)}" name="${escape(field.key)}" rows="${field.type==='json'?6:3}" ${field.required?'required':''} placeholder="${field.manual?'Supply the actual source or reference.':field.type==='json'?'Native structured input; review before running.':''}">${escape(value)}</textarea>`;
      return `<label for="${escape(id)}">${escape(field.label)}${field.required?' *':' (optional)'}${input}</label>`;
    }).join('');}
    function render(){
      const active=feature();
      element.innerHTML=`<header><span class="eyebrow">Native AI workspace</span><h2>${escape(config.title)}</h2><p>Choose a native tool, fill a complete example, and review all fields before generating. Required record references and uploads use your actual data.</p></header><div class="native-vanilla-layout"><nav aria-label="AI tools"><label>Find a tool<input type="search" data-action="search" placeholder="Search native tools"></label>${config.features.map(item=>`<button type="button" data-action="tool" data-key="${escape(item.id)}" aria-current="${item.id===state.active?'page':'false'}">${escape(item.title)}</button>`).join('')}</nav><div><form data-native-ai-form><h3>${escape(active.title)}</h3><p>${escape(active.description)}</p>${active.fields.length?`<div class="native-vanilla-controls">${names.map((name,index)=>`<button type="button" data-action="preset" data-index="${index}" ${state.busy?'disabled':''}>${name}</button>`).join('')}</div>`:'<p>This native analysis uses the current server records; there are no editable prompt fields.</p>'}<div class="native-vanilla-fields">${renderFields()}</div><div class="native-vanilla-controls"><button type="submit" ${state.busy?'disabled':''}>${state.busy?'Generating…':active.actionLabel||'Generate with OpenRouter'}</button>${state.busy?'<button type="button" data-action="cancel">Cancel request</button>':''}</div>${state.notice?`<p role="status">${escape(state.notice)}</p>`:''}${state.error?`<p role="alert">${escape(state.error)}</p>`:''}</form>${state.result!==null?`<article class="native-vanilla-report"><header><h3>${escape(active.title)} report</h3><div class="native-vanilla-controls"><button type="button" data-action="copy">Copy report</button><button type="button" data-action="download">Download report</button></div></header><div data-report-body>${global.BrowserAIReport.render(state.result)}</div></article>`:''}</div></div><section class="native-vanilla-records"><h3>Stored records</h3><button type="button" data-action="refresh">Refresh records</button>${config.resources.map(resource=>`<article><h4>${escape(resource.label)}</h4>${!(state.records[resource.key]||[]).length?'<p>No records returned.</p>':`<div class="browser-report-table"><table><thead><tr><th>Record</th><th>Reference</th><th>Details</th></tr></thead><tbody>${state.records[resource.key].map(row=>`<tr><td>${escape(row.name||row.title||row.employeeName||row.planName||row.id)}</td><td>${escape(row.id)}</td><td><button type="button" data-action="record" data-resource="${escape(resource.key)}" data-id="${escape(row.id)}">Open record</button></td></tr>`).join('')}</tbody></table></div>`}</article>`).join('')}</section>`;
      const form=element.querySelector('[data-native-ai-form]');form.addEventListener('submit',generate);
      form.addEventListener('input',event=>{const field=active.fields.find(item=>item.key===event.target.name);if(field&&field.type!=='file')state.fields[field.key]=event.target.value;});
      form.addEventListener('change',event=>{const field=active.fields.find(item=>item.key===event.target.name);if(field){if(field.type==='file')state.files[field.key]=event.target.files[0];else state.fields[field.key]=event.target.value;}});
    }
    async function refreshRecords(){
      if(!state.authenticated)return;
      const problems=[];
      await Promise.all(config.resources.map(async resource=>{try{state.records[resource.key]=list(await request(resource.endpoint));}catch(error){state.records[resource.key]=[];problems.push(resource.label+': '+error.message);}}));
      if(!state.authenticated)return;
      state.error=problems.join('\n');render();
    }
    function preset(index){
      const manual=[];
      for(const field of feature().fields){
        if(field.type==='file'){if(!state.files[field.key])manual.push(field.label);continue;}
        if(field.resource){state.fields[field.key]=state.fields[field.key]||String((state.records[field.resource]||[])[Math.min(index,(state.records[field.resource]||[]).length-1)]?.id||'');if(!state.fields[field.key])manual.push(field.label);}
        else if(field.manual){if(!state.fields[field.key])manual.push(field.label);}
        else {const value=field.presets?.[index]??field.default??'';state.fields[field.key]=typeof value==='object'?JSON.stringify(value,null,2):String(value);}
      }
      state.notice=manual.length?'Example filled. Supply actual '+manual.join(', ')+' when required, then review before running.':'All editable native fields filled, including optional context. Review before running.';render();
    }
    async function generate(event){
      event.preventDefault();if(state.busy||!state.authenticated)return;
      const active=feature();const body={};let multipart;
      try{
        for(const field of active.fields){const value=state.fields[field.key];if(field.type==='file'){if(field.required&&!state.files[field.key])throw new Error('Choose an actual '+field.label+' before generating.');continue;}if(value==null||value===''){if(field.required)throw new Error(field.label+' is required.');continue;}body[field.key]=field.type==='json'?JSON.parse(value):field.type==='number'?Number(value):value;}
        if(active.fields.some(field=>field.type==='file')){multipart=new FormData();Object.entries(body).forEach(([key,value])=>multipart.append(key,typeof value==='object'?JSON.stringify(value):String(value)));active.fields.filter(field=>field.type==='file').forEach(field=>{if(state.files[field.key])multipart.append(field.key,state.files[field.key]);});}
      }catch(error){state.error=error.message;render();return;}
      if(active.confirm&&!global.confirm(active.confirm))return;
      cancel(false);const version=state.version;const controller=new AbortController();state.controller=controller;state.busy=true;state.error='';state.notice='';state.result=null;
      const options={method:active.method||'POST',body:multipart||JSON.stringify(body),signal:controller.signal};
      let endpoint=active.endpoint;for(const field of active.fields.filter(item=>item.pathParameter)){endpoint=endpoint.replace(':'+field.key,encodeURIComponent(state.fields[field.key]));delete body[field.key];}if(!multipart)options.body=JSON.stringify(body);
      render();
      try{const answer=await request(endpoint,options);if(state.version!==version||controller.signal.aborted)return;state.result=answer;}
      catch(error){if(state.version!==version)return;state.error=error.name==='AbortError'?'Request canceled.':error.message;}
      finally{if(state.version===version){state.busy=false;state.controller=null;render();}}
    }
    function closeDialog(){state.selected?.element.remove();state.selected=null;document.body.style.overflow='';}
    function openRecord(resource,row){
      closeDialog();const previous=document.activeElement,overlay=document.createElement('div');overlay.className='native-vanilla-backdrop';let editing=false,busy=false;
      function close(){if(busy)return;closeDialog();previous?.focus();}
      function draw(){
        overlay.innerHTML=`<section class="native-vanilla-dialog" role="dialog" aria-modal="true" aria-labelledby="native-record-heading" tabindex="-1"><header><h2 id="native-record-heading">${escape(row.name||row.title||row.planName||resource.label)} · ${escape(row.id)}</h2><button type="button" data-dialog="cancel" ${busy?'disabled':''}>Cancel</button></header><div class="native-vanilla-dialog-body">${editing?`<form data-record-form><div class="native-vanilla-fields">${resource.fields.map(key=>`<label>${escape(title(key))}<textarea name="${escape(key)}">${escape(typeof row[key]==='object'?JSON.stringify(row[key],null,2):row[key]??'')}</textarea></label>`).join('')}</div></form>`:global.BrowserAIReport.render(row)}<p role="alert" data-record-error></p></div><footer>${resource.fields.length?`<button type="button" data-dialog="${editing?'save':'edit'}" ${busy?'disabled':''}>${editing?'Save changes':'Edit'}</button>`:''}${resource.delete?`<button type="button" class="danger" data-dialog="delete" ${busy?'disabled':''}>Delete</button>`:''}<button type="button" data-dialog="cancel" ${busy?'disabled':''}>Cancel</button></footer></section>`;
        overlay.querySelector('[role=dialog]').focus();
      }
      overlay.addEventListener('click',async event=>{
        if(event.target===overlay){close();return;}const action=event.target.closest('[data-dialog]')?.dataset.dialog;if(!action)return;
        if(action==='cancel'){close();return;}if(action==='edit'){editing=true;draw();return;}
        if(action==='delete'&&!global.confirm('Delete this saved record?'))return;
        let payload={};if(action==='save'){for(const key of resource.updateFields||resource.fields)payload[key]=row[key];try{for(const node of overlay.querySelectorAll('[data-record-form] textarea'))payload[node.name]=typeof row[node.name]==='object'?JSON.parse(node.value):typeof row[node.name]==='number'?Number(node.value):typeof row[node.name]==='boolean'?node.value==='true':node.value;}catch(error){overlay.querySelector('[data-record-error]').textContent=error.message;return;}}
        busy=true;overlay.querySelectorAll('button').forEach(node=>node.disabled=true);
        try{await request(resource.endpoint+'/'+encodeURIComponent(row.id),{method:action==='delete'?'DELETE':resource.updateMethod||'PUT',...(action==='save'?{body:JSON.stringify(payload)}:{})});busy=false;close();await refreshRecords();}
        catch(error){busy=false;overlay.querySelectorAll('button').forEach(node=>node.disabled=false);overlay.querySelector('[data-record-error]').textContent=error.message;}
      });
      overlay.addEventListener('keydown',event=>{if(event.key==='Escape')close();if(event.key==='Tab'){const nodes=[...overlay.querySelectorAll('button,input,textarea,select')].filter(node=>!node.disabled);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}});
      state.selected={element:overlay};document.body.append(overlay);document.body.style.overflow='hidden';draw();
    }
    element.addEventListener('click',async event=>{
      const node=event.target.closest('[data-action]');if(!node)return;const action=node.dataset.action;
      if(action==='tool'){cancel(false);state.active=node.dataset.key;state.fields={};state.files={};state.error='';state.notice='';state.result=null;render();}
      if(action==='preset')preset(Number(node.dataset.index));
      if(action==='cancel'){cancel();render();}
      if(action==='refresh')await refreshRecords();
      if(action==='record'){
        const resource=config.resources.find(item=>item.key===node.dataset.resource);
        const row=state.records[resource.key].find(item=>String(item.id)===node.dataset.id);
        if(row){try{const detail=await request(resource.endpoint+'/'+encodeURIComponent(row.id));openRecord(resource,detail.record||detail.row||row);}catch(error){state.error=error.message;render();}}
      }
      if(action==='copy'||action==='download'){const text=readable(element.querySelector('[data-report-body]'));if(action==='copy'){try{await navigator.clipboard.writeText(text);node.textContent='Copied';}catch{state.notice='Copy is unavailable in this browser. Select report text or use Download report.';render();}}else{const url=URL.createObjectURL(new Blob([feature().title+'\n\n'+text+'\n'],{type:'text/plain;charset=utf-8'})),anchor=document.createElement('a');anchor.href=url;anchor.download='ai-report.txt';anchor.click();URL.revokeObjectURL(url);}}
    });
    element.addEventListener('input',event=>{if(event.target.dataset.action==='search'){const search=event.target.value.toLowerCase();element.querySelectorAll('[data-action=tool]').forEach(node=>node.hidden=!node.textContent.toLowerCase().includes(search));}});
    const beforeUnload=()=>cancel(false);global.addEventListener('beforeunload',beforeUnload);render();
    return {refreshRecords,destroy(){cancel(false);closeDialog();global.removeEventListener('beforeunload',beforeUnload);element.replaceChildren();},selectFeature(id,fields={}){if(!config.features.some(feature=>feature.id===id))return false;cancel(false);state.active=id;state.fields=fields;state.files={};state.result=null;state.error='';render();return true;},setAuthenticated(value){state.authenticated=value;if(!value){cancel(false);closeDialog();state.records={};state.result=null;state.fields={};state.files={};render();}else refreshRecords();},cancel};
  }
  global.NativeWorkflowStudio={mount};
})(window);
