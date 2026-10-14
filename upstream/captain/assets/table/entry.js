(function(){
 'use strict';
 let choseTable=false,choseGuests=false,advancing=false;
 async function advance(){
  if(advancing || !choseTable || !choseGuests || !document.getElementById('order_type_dinein').checked)return;
  const table=document.querySelector('input[name="table_no"]:checked');
  if(!table || table.disabled || table.value==='other')return;
  advancing=true;
  try{await goToProductsWithTableCheck();}finally{advancing=false;}
 }
 document.addEventListener('change',event=>{
  if(event.target.matches('input[name="table_no"]')){choseTable=true;void advance();}
  if(event.target.matches('input[name="order_type"]')){
   choseTable=false;choseGuests=false;
   if(event.target.value==='Take away' && !advancing){
    advancing=true;
    Promise.resolve(goToProductsWithTableCheck()).finally(()=>{advancing=false;});
   }
  }
 });
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-person]')){choseGuests=true;void advance();}
 });
})();
