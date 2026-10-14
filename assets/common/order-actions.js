(function (root) {
  'use strict';
  const t=text=>root.I18N?.t(text)||text;
  function ask({title,label,secret=false}) {
    return new Promise(resolve=>{
      const dialog=document.createElement('dialog');dialog.className='captain-action-dialog';
      const form=document.createElement('form'),heading=document.createElement('h2'),caption=document.createElement('label'),input=document.createElement('input'),footer=document.createElement('footer'),cancel=document.createElement('button'),submit=document.createElement('button');
      heading.textContent=t(title);caption.textContent=t(label);input.type=secret?'password':'text';input.required=true;input.minLength=secret?4:3;input.maxLength=secret?8:200;input.autocomplete='off';
      if(secret){input.inputMode='numeric';input.pattern='[0-9]{4,8}';}
      const reasons=document.createElement('div');reasons.className='change-reason-choices';
      if(!secret) for(const reason of ['Customer requested','Customer left','Entered by mistake','Item unavailable','Duplicate order']) {
        const choice=document.createElement('button');choice.type='button';choice.textContent=t(reason);choice.setAttribute('aria-pressed','false');
        choice.onclick=()=>{input.value=t(reason);updateChoices();};reasons.append(choice);
      }
      function updateChoices(){for(const choice of reasons.children)choice.setAttribute('aria-pressed',String(choice.textContent===input.value));}
      input.addEventListener('input',updateChoices);
      caption.append(input);cancel.type='button';cancel.textContent=t('Cancel');submit.type='submit';submit.textContent=t('Continue');footer.append(cancel,submit);form.append(heading,reasons,caption,footer);dialog.append(form);document.body.append(dialog);
      const previous=document.activeElement;
      const nativeBack=event=>{event.preventDefault();event.stopImmediatePropagation();finish(null);};
      const finish=value=>{input.value='';window.removeEventListener('captain:back',nativeBack,true);dialog.close();dialog.remove();previous?.focus({preventScroll:true});resolve(value);};
      window.addEventListener('captain:back',nativeBack,true);
      cancel.onclick=()=>finish(null);dialog.oncancel=event=>{event.preventDefault();finish(null);};form.onsubmit=event=>{event.preventDefault();input.value=input.value.trim();if(form.reportValidity())finish(input.value);};dialog.showModal();if(secret)input.focus();else reasons.querySelector('button')?.focus();
    });
  }
  async function save(body) {
    const request={...body};
    const authority=POSNIC.session?.base || POSNIC.server?.baseUrl;
    for(let attempt=0;attempt<4;attempt++){
      try{return await POSNIC.api.post('/sales/updateOrder',request);}
      catch(error){
        if(['Manager approval required: cancellation','Manager approval required: discount'].includes(error.message)){
          const action=error.message.endsWith('cancellation')?'void_sale':'discount_apply';
          const pin=await ask({title:'Manager approval',label:'Manager PIN',secret:true});
          if(pin===null)throw new Error(t('Changes were not saved.'));
          const result=await POSNIC.api.post('/authorizations/verify-pin',{pin,action,sale_id:request.order_id});
          if(!result.data?.approval_token)throw new Error(result.message||t('Manager approval required.'));
          request.approval_tokens={...request.approval_tokens,[action]:result.data.approval_token};continue;
        }
        if(request.status==='cancelled' && request.order_id){
          try {
            // A failed acknowledgement is not proof that the write failed.
            // Read this exact sale; never infer cancellation from an empty floor.
            const result=await POSNIC.api.get('/sales/'+encodeURIComponent(request.order_id));
            const sale=result?.data;
            if(authority===(POSNIC.session?.base || POSNIC.server?.baseUrl) &&
              result?.type==='success' && String(sale?._id || sale?.id)===String(request.order_id) &&
              sale.sale_process==='cancelled' && sale.payment_status==='Cancelled')
              return {type:'success',message:'Order cancelled',data:{order_id:request.order_id}};
          } catch { /* Preserve the original failure unless the server confirms cancellation. */ }
        }
        throw error;
      }
    }
    throw new Error(t('Could not save. Please try again.'));
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-handover-sale]');if(!button||button.disabled)return;
    if(document.querySelector('[data-handover-dialog]'))return;
    const dialog=document.createElement('dialog');dialog.className='captain-action-dialog';dialog.dataset.handoverDialog='';
    dialog.innerHTML='<form><h2>Hand over order</h2><p role="status">Loading...</p><button type="button" data-retry hidden>Retry</button><label><span>Staff member</span><select required disabled></select></label><footer><button type="button" data-close>Cancel</button><button type="submit" disabled>Hand over</button></footer></form>';
    document.body.append(dialog);root.I18N?.apply(dialog);dialog.showModal();
    let saving=false,loading=false,closed=false,request=null;
    const finish=()=>{closed=true;window.removeEventListener('captain:back',nativeBack,true);dialog.close();dialog.remove();button.focus();};
    const close=()=>{if(!saving)finish();};
    const nativeBack=event=>{event.preventDefault();event.stopImmediatePropagation();close();};
    window.addEventListener('captain:back',nativeBack,true);
    const cancel=dialog.querySelector('[data-close]'),retry=dialog.querySelector('[data-retry]');
    cancel.onclick=close;dialog.oncancel=event=>{event.preventDefault();close();};
    const status=dialog.querySelector('[role=status]'),submit=dialog.querySelector('[type=submit]'),select=dialog.querySelector('select');
    select.onchange=()=>{submit.disabled=!select.value;};
    const load=async()=>{
      if(loading||closed)return;loading=true;retry.hidden=true;status.textContent=t('Loading...');
      try{
        const response=await POSNIC.api.get('/sales/handoverStaff');
        if(closed)return;
        if(response.type!=='success'||!Array.isArray(response.data))throw new Error(response.message||'Could not load staff.');
        select.replaceChildren();
        const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=t('Choose a staff member.');select.append(placeholder);
        for(const staff of response.data){const option=document.createElement('option');option.value=staff.id;option.textContent=staff.name;option.translate=false;select.append(option);}
        select.disabled=!response.data.length;submit.disabled=true;
        status.textContent=response.data.length?'':t('Choose an active staff member in this branch.');retry.hidden=!!response.data.length;
      }catch(error){if(!closed){status.textContent=t(error.message||'Could not load staff.');retry.hidden=false;}}
      finally{loading=false;}
    };
    retry.onclick=load;
    dialog.querySelector('form').onsubmit=async event=>{
      event.preventDefault();if(saving||!select.value)return;
      if(!request||request.staffId!==select.value)request={saleId:button.dataset.handoverSale,branchId:button.dataset.handoverBranch,staffId:select.value,requestId:crypto.randomUUID()};
      saving=true;submit.disabled=true;select.disabled=true;cancel.disabled=true;dialog.setAttribute('aria-busy','true');status.textContent=t('Saving…');
      try{
        const response=await POSNIC.api.post('/sales/handoverOrder',request);
        if(response.type!=='success'||!response.data?.staff)throw new Error(response.message||'Could not save. Please try again.');
        const assignee=button.closest('.service-order-options')?.querySelector('.service-assignee');if(assignee)assignee.textContent=response.data.staff.name;
        finish();
      }catch(error){status.textContent=t(error.message||'Could not save. Please try again.');}
      finally{saving=false;submit.disabled=false;select.disabled=false;cancel.disabled=false;dialog.removeAttribute('aria-busy');}
    };
    await load();
  });
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-delivery-sale]');if(!button||document.querySelector('[data-delivery-dialog]'))return;
    const dialog=document.createElement('dialog');dialog.className='captain-action-dialog';dialog.dataset.deliveryDialog='';
    dialog.innerHTML='<h2>Kitchen delivery</h2><p class="delivery-status" role="status">Loading...</p><div class="delivery-body"></div><footer><button type="button" data-refresh>Refresh</button><button type="button" data-close>Close</button></footer>';
    document.body.append(dialog);root.I18N?.apply(dialog);dialog.showModal();
    let closed=false,loading=false;
    const close=()=>{closed=true;window.removeEventListener('captain:back',nativeBack,true);dialog.close();dialog.remove();button.focus();};
    const nativeBack=event=>{event.preventDefault();event.stopImmediatePropagation();close();};
    window.addEventListener('captain:back',nativeBack,true);
    dialog.querySelector('[data-close]').onclick=close;dialog.oncancel=event=>{event.preventDefault();close();};
    const body=dialog.querySelector('.delivery-body'),refresh=dialog.querySelector('[data-refresh]'),status=dialog.querySelector('.delivery-status');
    const load=async()=>{
      if(closed||loading)return;loading=true;
      refresh.disabled=true;dialog.setAttribute('aria-busy','true');status.textContent=t('Loading...');
      try{
        const response=await POSNIC.api.get('/sales/kitchenDeliveryStatus?saleId='+encodeURIComponent(button.dataset.deliverySale));
        if(closed)return;
        if(response.type!=='success'||!response.data||!Array.isArray(response.data.displays)||!Array.isArray(response.data.reports)||response.data.reports.some(report=>!Array.isArray(report.printers)))throw new Error(response.message||'Could not load delivery status.');
        body.replaceChildren();status.textContent='';
        const add=(text,tag='p')=>{const element=document.createElement(tag);element.textContent=text;body.append(element);};
        add(t('Order saved on server'));
        add(t('Kitchen display'),'h3');
        const displays=response.data.displays || [];
        for(const display of displays)add(display.till+' · '+t('Last confirmed on display: {0}').replace('{0}',new Date(display.at).toLocaleString()));
        if(!displays.some(display=>display.recent))add(t('No recent display confirmation. Check the kitchen screen.'));
        const reports=response.data.reports || [];
        if(!reports.length)add(t('Waiting for the desktop printer report.'));
        for(const report of reports){
          add(new Date(report.at).toLocaleString(),'h3');
          for(const printer of report.printers){
            add(printer.name+' · '+t({accepted:'Accepted by printer system',failed:'Printing failed',pending:'Printing pending',unknown:'Check printer before retrying'}[printer.state] || 'Printing pending'));
            if(printer.reason)add(printer.reason);
          }
        }
        add(t('Printer acceptance does not confirm paper output. Check the desktop printing log before reprinting.'));
      }catch(error){if(!closed)status.textContent=t(error.message||'Could not load delivery status.');}
      finally{loading=false;refresh.disabled=false;dialog.removeAttribute('aria-busy');}
    };
    refresh.onclick=load;await load();
  });
  function installCancellationReasons() {
    for (const id of ['cancel-order-reason', 'history-cancel-reason', 'cancel-item-reason']) {
      const field = document.getElementById(id);
      if (!field || field.parentElement.querySelector('[data-cancellation-reasons]')) continue;
      const choices = document.createElement('div');
      choices.className = 'cancellation-reason-choices';
      choices.dataset.cancellationReasons = '';
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', t('Quick cancellation reasons'));
      const refresh = () => {
        for (const button of choices.children)
          button.setAttribute('aria-pressed', String(field.value.trim() === button.textContent));
      };
      for (const reason of ['Customer requested', 'Entered by mistake', 'Duplicate order', 'Item unavailable', 'Customer left']) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = t(reason); button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => {
          field.value = button.textContent;
          field.dispatchEvent(new Event('input', {bubbles: true}));
        });
        choices.append(button);
      }
      field.before(choices);
      field.placeholder = t('Choose a reason above or write your own.');
      field.addEventListener('input', refresh);
      field.closest('.modal')?.addEventListener('show.bs.modal', refresh);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installCancellationReasons);
  else installCancellationReasons();
  root.CaptainOrderActions={save,ask};
})(window);
