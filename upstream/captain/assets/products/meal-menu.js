/* Period choices use assigned restaurant IDs; searching always covers the whole menu. */
(function () {
  "use strict";
  let selected = '', catalog = {};
  const t = value => window.I18N?.t(value) || value;
  function choices() {
    const found = new Map();
    for (const [key,items] of Object.entries(catalog)) {
      if (key === 'all') continue;
      for (const item of items) {
        const availability = ServingPeriods.describe(item);
        (item.serving_periods || []).forEach((period,index) => {
          if (!period?.id || !period.name) return;
          const prior = found.get(period.id);
          found.set(period.id,{id:period.id,name:period.name,active:!!prior?.active || availability[index]?.active === true});
        });
      }
    }
    return [...found.values()];
  }
  function paint() {
    let nav = document.getElementById('meal-menu');
    if (!nav) {
      const host = document.querySelector('.fixed-heading');
      if (!host) return;
      nav = document.createElement('nav'); nav.id = 'meal-menu'; nav.setAttribute('aria-label',t('Menu')); host.append(nav);
      nav.addEventListener('click',event=>{
        const button=event.target.closest('button[data-period]'); if(!button)return;
        selected=button.dataset.period;
        void loadProducts();
      });
    }
    const periods = choices();
    if (!periods.some(period=>period.id===selected)) selected='';
    nav.hidden = !periods.length;
    const focus = nav.contains(document.activeElement) ? document.activeElement.dataset.period : null;
    nav.replaceChildren();
    for (const period of [{id:'',name:t('All')},...periods]) {
      const button=document.createElement('button'); button.type='button'; button.dataset.period=period.id;
      button.setAttribute('aria-pressed',String(selected===period.id));
      const label=document.createElement('span'); label.textContent=period.name; if(period.id)label.translate=false;
      button.append(label);
      if(period.active) { const hint=document.createElement('small'); hint.textContent=t('Available');button.append(hint); }
      nav.append(button);
      if(focus!==null && focus===period.id) button.focus({preventScroll:true});
    }
  }
  function apply(products) {
    catalog=products; paint();
    if(!selected)return products;
    return Object.fromEntries(Object.entries(products).map(([key,items])=>[key,items.filter(item=>(item.serving_periods||[]).some(period=>period.id===selected))]).filter(([key,items])=>key==='all'||items.length));
  }
  function reset() { if(selected){selected='';paint();} }
  function refreshAvailability() {
    const periods = new Map(choices().map(period=>[period.id,period]));
    document.querySelectorAll('#meal-menu button[data-period]').forEach(button=>{
      if (!button.dataset.period) return;
      let hint=button.querySelector('small');
      if (!hint) { hint=document.createElement('small');button.append(hint); }
      hint.textContent=t('Available');hint.hidden=!periods.get(button.dataset.period)?.active;
    });
  }
  window.addEventListener('posnic:serving-periods',refreshAvailability);
  window.MealMenu={apply,reset};
  window.addEventListener('posnic:language-changed',paint);
})();
