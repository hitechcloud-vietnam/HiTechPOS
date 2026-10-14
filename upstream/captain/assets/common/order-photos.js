(function () {
  'use strict';
  const t = text => window.I18N?.t ? I18N.t(text) : text;
  const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
  const safeImage = value => typeof value === 'string' && value.length <= 7100000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(value);
  const owner = () => JSON.stringify([POSNIC.session.shopKey || POSNIC.server.baseUrl, localStorage.getItem('branch_id'), POSNIC.session.user?.id]);
  async function storage(key, value) {
    const db = await new Promise((resolve,reject) => {
      const request = indexedDB.open('captain-order-references',1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try { return await new Promise((resolve,reject) => {
      const tx=db.transaction('drafts',value === undefined ? 'readonly' : 'readwrite');
      const store=tx.objectStore('drafts');
      const request=value === undefined ? store.get(key) : value === null ? store.delete(key) : store.put(value,key);
      tx.oncomplete=()=>resolve(request.result);
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    }); } finally { db.close(); }
  }
  function render(order) {
    const photos = [order?.paper_order, ...(Array.isArray(order?.order_photos) ? order.order_photos : [])];
    const ids = [...new Set(photos.map(photo => photo?.id).filter(validId))];
    const sale = /^[a-f0-9]{24}$/i.test(order?._id || '') ? order._id : '';
    return `<div data-order-photos="${sale}">${ids.map(photoRow).join('')}${sale ? `<button class="order-photo-add" type="button" hidden>+ ${t('Photo')}</button>` : ''}</div>`;
  }
  function photoRow(id) {
    return `<section class="order-photo" data-order-photo="${id}"><button type="button" class="order-photo-open"><span class="order-photo-thumb" aria-hidden="true">▧</span><span><strong>${t('Photo')}</strong><small>${t('View')}</small></span></button><span class="order-photo-status" role="status"></span></section>`;
  }
  function attachment(host) {
    const dialog = document.createElement('dialog'); dialog.classList.add('order-photo-viewer','order-photo-upload');
    dialog.innerHTML=`<header><h2>${t('Photo')}</h2><button type="button" data-close aria-label="${t('Close')}">×</button></header><div class="order-photo-full"><label>${t('Take or choose photo')}<input type="file" accept="image/jpeg,image/png" capture="environment"></label><img hidden alt="${t('Photo')}"><p role="status"></p></div><footer><button type="button" data-save disabled>${t('Save')}</button></footer>`;
    const openedOwner=owner(), saleId=host.dataset.orderPhotos, key=openedOwner+':'+saleId;
    let original='', id='', busy=false, attempted=false;
    const input=dialog.querySelector('input'), save=dialog.querySelector('[data-save]'), status=dialog.querySelector('[role=status]'), preview=dialog.querySelector('img');
    dialog.querySelector('[data-close]').onclick=()=>{if(!busy)dialog.close();};
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    dialog.addEventListener('close',()=>dialog.remove());
    input.onchange=async()=>{
      const file=input.files[0]; if(!file)return;
      original='';save.disabled=true;preview.hidden=true;
      if(file.size>5*1024*1024){status.textContent=t('Choose a photo under 5 MB.');return;}
      try {
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
        if(!safeImage(data)){status.textContent=t('Take or choose photo');return;}
        if(owner() !== openedOwner){dialog.close();return;}
        const nextId=crypto.randomUUID();
        await storage(key,{id:nextId,original:data,attempted:false});
        original=data;id=nextId;attempted=false;preview.src=data;preview.hidden=false;save.disabled=false;status.textContent='';
      } catch {status.textContent=t('Photo could not be saved. Free phone storage and retry.');}
    };
    save.onclick=async()=>{
      if(busy||!original)return;
      busy=true;dialog.dataset.busy='1';save.disabled=true;input.disabled=true;status.textContent=t('Loading...');
      try {
        if(owner() !== openedOwner){dialog.close();return;}
        // Save before sending: a lost response must retry this exact photo ID.
        await storage(key,{id,original,attempted:true});
        attempted=true;
        if(owner() !== openedOwner){dialog.close();return;}
        const result=await POSNIC.api.post('/captain/v1/paper-orders/reference',{id,original,saleId});
        if(result?.photo?.id!==id)throw new TypeError();
        await storage(key,null);
        if(owner() !== openedOwner){dialog.close();return;}
        if(host.isConnected && !host.querySelector(`[data-order-photo="${id}"]`)){
          host.insertAdjacentHTML('afterbegin',photoRow(id));mount(host);
        }
        dialog.close();
      } catch {status.textContent=t('Retry');save.textContent=t('Retry');}
      finally {busy=false;delete dialog.dataset.busy;save.disabled=false;input.disabled=attempted;}
    };
    (host.closest('.modal.show')||document.body).append(dialog);dialog.showModal();
    input.disabled=true;
    storage(key).then(draft=>{
      if(!dialog.open || owner()!==openedOwner)return;
      if(validId(draft?.id)&&safeImage(draft?.original)){
        id=draft.id;original=draft.original;attempted=draft.attempted===true;
        preview.src=original;preview.hidden=false;save.disabled=false;
        save.textContent=t(attempted?'Retry':'Save');
      }
      input.disabled=attempted;
    }).catch(()=>{status.textContent=t('Photo could not be saved. Free phone storage and retry.');});
  }
  function viewer(data, opener) {
    const dialog = document.createElement('dialog');
    dialog.className = 'order-photo-viewer';
    dialog.innerHTML = `<header><h2>${t('Photo')}</h2><button type="button" aria-label="${t('Close')}">×</button></header><div class="order-photo-full"><img alt="${t('Photo')}"></div>`;
    const image = dialog.querySelector('img');
    image.src = data;
    image.addEventListener('click', () => image.classList.toggle('order-photo-zoom'));
    dialog.querySelector('button').onclick = () => dialog.close();
    dialog.addEventListener('close', () => { dialog.remove(); if (opener.isConnected) opener.focus(); });
    (opener.closest('.modal.show') || document.body).append(dialog);
    dialog.showModal();
  }
  function mount(root) {
    const attachments=[...root?.querySelectorAll('[data-order-photos]')||[]].filter(host=>host.dataset.orderPhotos && !host.dataset.attachMounted);
    if(attachments.length) {
      attachments.forEach(host=>{host.dataset.attachMounted='1';});
      POSNIC.api.get('/captain/v1/paper-orders/options').then(options=>{
        if(!options.enabled||!options.configured||!options.referenceAttachments)return;
        attachments.forEach(host=>{const add=host.querySelector('.order-photo-add');if(add){add.hidden=false;add.onclick=()=>attachment(host);}});
      }).catch(()=>{});
    }
    root?.querySelectorAll('[data-order-photo]').forEach(host => {
      if (host.dataset.mounted) return;
      host.dataset.mounted = '1';
      const button = host.querySelector('button'), status = host.querySelector('[role=status]');
      let data, loading;
      async function load() {
        if (data) return data;
        if (loading) return loading;
        status.textContent = t('Loading...');
        loading = POSNIC.api.get('/captain/v1/paper-orders/photos/' + host.dataset.orderPhoto).then(result => {
          if (!safeImage(result?.data)) throw new TypeError();
          data = result.data;
          if (host.isConnected) {
            const img = document.createElement('img'); img.src = data; img.alt = '';
            host.querySelector('.order-photo-thumb').replaceChildren(img);
            status.textContent = '';
          }
          return data;
        }).catch(() => { if (host.isConnected) status.textContent = t('Retry'); return null; })
          .finally(() => { loading = null; });
        return loading;
      }
      button.onclick = async () => {
        button.disabled = true;
        try { const photo = await load(); if (photo && host.isConnected) viewer(photo, button); }
        finally { button.disabled = false; }
      };
      // Authentication stays in POSNIC.api; never place a private S3 URL or a
      // credential in an image URL. Data is held only for this detail view.
      void load();
    });
  }
  window.OrderPhotos = {render, mount};
  window.addEventListener('captain:back', event => {
    if (event.defaultPrevented) return;
    const top = [...document.querySelectorAll('dialog[open]')].at(-1);
    if (top?.classList.contains('order-photo-viewer')) { event.preventDefault(); if(!top.dataset.busy)top.close(); }
  });
})();
