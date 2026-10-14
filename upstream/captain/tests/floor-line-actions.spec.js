import {test,expect} from '@playwright/test';
import {onTheMenu} from './support/shop.js';
import fs from 'node:fs';
const order={_id:'order-1',status:'pending',dine_type:'Dine-in',table_number:'1',person_count:2,total_amount:440,sales_total:440,updated_date:'2026-10-04T00:00:00Z',items:[
 {line_id:'first',product_id:'p-biryani',item_name:'Chicken Biryani',name:'Chicken Biryani',quantity:1,price:220,item_description:'No chilli'},
 {line_id:'second',product_id:'p-biryani',item_name:'Chicken Biryani',name:'Chicken Biryani',quantity:1,price:220,item_description:'Extra spicy'},
]};
async function floor(page,{rounds=false,paid=false,allocated=false,notes=false,repeated=false,quantity=1}={}) {
 await onTheMenu(page,'nothing');
 const source={...order,payment_status:paid?'Paid':'Unpaid',transfer_allocated:allocated,...(notes?{preparation_notes:true,preparation_note:'Serve together'}:{})};
 source.items=source.items.map(item=>({...item,quantity}));
 if(rounds)source.kitchen_rounds=[{id:'batch1',ordered_at:'2026-10-04T00:00:00Z',items:source.items.map((item,i)=>({id:'round-'+i,line_key:item.line_id,name:item.name,note:item.item_description,quantity,remaining:quantity,served:0}))}];
 if(repeated){
  source.items=source.items.map(item=>({...item,quantity:item.line_id==='second'?2:1}));
  source.kitchen_rounds.push({id:'batch2',ordered_at:'2026-10-04T00:10:00Z',items:[{...source.kitchen_rounds[0].items[1],id:'repeat-round'}]});
 }
 await page.route('**/sales/getTablesWithActiveOrders',r=>r.fulfill({json:{type:'success',data:{tables:['1']}}}));
 await page.route('**/sales/getListKot?*',r=>r.fulfill({json:{type:'success',data:{list:[source]}}}));
 // A different response order must never retarget the user's action.
 await page.route('**/sales/getOrderHistory',r=>r.fulfill({json:{type:'success',data:{orders:[{...source,items:[...source.items].reverse()}]}}}));
 const posts=[];
 await page.route('**/sales/updateOrder',r=>{posts.push(r.request().postDataJSON());return r.fulfill({json:{type:'success'}});});
 await page.goto('/kot-management.html');
 await page.locator('.floor-card').first().click();
 await expect(page.locator('.kot-card')).toBeVisible();
 return posts;
}
for (const value of ['Pack separately','']) test(`order kitchen note can be reviewed and saved: ${value || 'clear'}`,async({page})=>{
 const posts=await floor(page,{notes:true});
 await page.locator('[data-floor-order-note]').click();
 await expect(page.locator('#editor-preparation-note')).toBeVisible();
 await expect(page.locator('#editor-preparation-note')).toHaveValue('Serve together');
 await expect(page.locator('#save-order-changes')).toBeDisabled();
 await page.locator('#editor-preparation-note').fill(value);
 expect(posts).toEqual([]);
 await expect(page.locator('#save-order-changes')).toBeEnabled();
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(1);
 expect(posts[0].preparation_note).toBe(value);
 expect(posts[0].items.map(item=>item.quantity)).toEqual([1,1]);
 expect(posts[0].items.map(item=>item.item_description)).toEqual(['Extra spicy','No chilli']);
});
test('older servers do not offer an unsupported order note editor',async({page})=>{
 await floor(page);
 await expect(page.locator('[data-floor-order-note]')).toHaveCount(0);
 await page.locator('[data-line-key="second"] [data-line-action=more]').click();
 await expect(page.locator('#editor-preparation-note')).toBeHidden();
});
for(const rounds of [false,true])test(`Note beside a dish opens its exact preparation directly, rounds=${rounds}`,async({page})=>{
 const posts=await floor(page,{rounds});
 await page.locator('[data-line-key="second"] [data-line-action=note]').click();
 await expect(page.locator('#editItemNotesModal')).toBeVisible();
 await expect(page.locator('#edit-item-notes-text')).toHaveValue('Extra spicy');
 await page.locator('#edit-item-notes-text').fill('Less oil');
 await page.locator('#edit-item-notes-apply').click();
 await expect(page.locator('#editItemNotesModal')).toBeHidden();
 await expect(page.locator('.order-sheet > .kot-items-list')).toBeVisible();
 await expect(page.locator('#current-order-items [data-draft-line=false]').first()).toBeHidden();
 const unchangedRow=page.locator('.kot-items-list [data-line-key="second"]').locator('..');
 await expect(unchangedRow.locator('.service-item-note')).toHaveText('Less oil');
 await page.locator('.kot-items-list [data-line-key="second"] [data-line-action=note]').click();
 await expect(page.locator('#edit-item-notes-text')).toHaveValue('Less oil');
 await page.locator('#edit-item-notes-apply').click();
 expect(posts).toEqual([]);
 const draft=await page.evaluate(()=>editingOrder.items);
 expect(draft.find(item=>item.line_id==='second').item_description).toBe('Less oil');
 expect(draft.find(item=>item.line_id==='first').item_description).toBe('No chilli');
 await expect(page.locator('#save-order-changes')).toBeEnabled();
 await expect(page.locator("#editItemNotesModal")).toBeHidden();
 await page.screenshot({path:`test-artifacts/existing-note-inline-${rounds}.png`});
 await page.locator('#cancel-order-changes').click();
 await page.locator('[data-confirm-action=discard]').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 if(rounds) await expect(unchangedRow.locator('.service-item-note')).toHaveText('Extra spicy');
 else await expect(unchangedRow.locator('.service-item-note')).toHaveCount(0);
 expect(posts).toEqual([]);
});
test('adding another serving creates a fresh preparation and a visible pinned save before sending',async({page})=>{
 const posts=await floor(page);
 await page.locator('[data-line-key="second"] [data-line-action=more]').click();
 await expect(page.locator('#current-order-items .order-item-card')).toHaveCount(3);
 await expect(page.locator('#current-order-items .editor-items-heading').last()).toHaveText('New · Not sent');
 expect(posts).toEqual([]);
 await expect(page.locator('#save-order-changes')).toBeInViewport();
 await expect(page.locator('#save-order-changes')).toHaveText('Send only these changes');
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(1);
 expect(posts[0].items.find(item=>item.line_id==='second').quantity).toBe(1);
 expect(posts[0].items.find(item=>item.line_id==='first').quantity).toBe(1);
 const added=posts[0].items.find(item=>!['first','second'].includes(item.line_id));
 expect(added.quantity).toBe(1);
 expect(added.item_description || '').toBe('');
 expect(posts[0].items.find(item=>item.line_id==='second').item_description).toBe('Extra spicy');
});
for(const batch of [0,1]) test(`Add again works from repeated dish batch ${batch} without changing prior quantities or notes`,async({page})=>{
 const posts=await floor(page,{rounds:true,repeated:true});
 const repeated=page.locator('[data-line-key="second"]');
 await expect(repeated).toHaveCount(2);
 await expect(repeated.locator('[data-line-action=more]')).toHaveCount(2);
 // Aggregate reductions/notes cannot safely target a single historical batch.
 await expect(repeated.locator('[data-line-action=cancel]')).toHaveCount(0);
 await repeated.nth(batch).locator('[data-line-action=more]').click();
 await expect(page.locator('#current-order-items .order-item-card')).toHaveCount(3);
 const draft=await page.evaluate(()=>editingOrder.items);
 expect(draft.find(item=>item.line_id==='second').quantity).toBe(2);
 expect(draft.find(item=>item.line_id==='second').item_description).toBe('Extra spicy');
 const added=draft.filter(item=>!['first','second'].includes(item.line_id));
 expect(added).toHaveLength(1);expect(added[0].quantity).toBe(1);expect(added[0].item_description).toBe('');
 expect(posts).toEqual([]);
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(1);
 expect(posts[0].items.find(item=>item.line_id==='second').quantity).toBe(2);
});

test('direct cancellation asks before altering the item and does not submit automatically',async({page})=>{
 const posts=await floor(page);
 await page.locator('[data-line-key="second"] [data-line-action=cancel]').click();
 await expect(page.locator('#removeItemConfirmModal')).toBeVisible();
 await expect(page.locator('#remove-item-name')).toHaveText('Chicken Biryani');
 expect(posts).toEqual([]);
 expect(await page.evaluate(()=>editingOrder.items.find(item=>item.line_id==='second').quantity)).toBe(1);
});
test('existing-order quick notes preserve typing, toggle and apply only to the draft',async({page})=>{
 const posts=await floor(page,{rounds:true});
 await page.locator('[data-line-key="second"] [data-line-action=note]').click();
 const dialog=page.locator('#editItemNotesModal');
 const field=dialog.locator('textarea');
 await expect(dialog.locator('[data-editor-note="Extra spicy"]')).toHaveAttribute('aria-pressed','true');
 await field.fill('Pack separately, Less salt');
 await expect(dialog.locator('[data-editor-note="Less salt"]')).toHaveAttribute('aria-pressed','true');
 await dialog.locator('[data-editor-note="Less oil"]').click();
 await expect(field).toHaveValue('Pack separately, Less salt, Less oil');
 await dialog.locator('[data-editor-note="Less salt"]').click();
 await expect(field).toHaveValue('Pack separately, Less oil');
 await dialog.locator('#edit-item-notes-apply').click();
 expect(posts).toEqual([]);
 expect(await page.evaluate(()=>editingOrder.items.find(item=>item.line_id==='second').item_description)).toBe('Pack separately, Less oil');
 expect(await page.evaluate(()=>editingOrder.items.find(item=>item.line_id==='first').item_description)).toBe('No chilli');
});

test('paid order lines do not offer financial edits',async({page})=>{
 await floor(page,{rounds:true,paid:true});
  await expect(page.locator('[data-line-action]')).toHaveCount(0);
  await expect(page.locator('.kot-actions')).toHaveCount(0);
});

test('adding to an allocated bill uses current menu prices instead of copying its allocated amount',async({page})=>{
 await floor(page,{allocated:true});
 await page.locator('[data-line-key="second"] [data-line-action=more]').click();
 await expect(page.locator('#item-picker')).toBeVisible();
 expect(await page.evaluate(()=>editingOrder.items.length)).toBe(2);
});

test('Move table is direct, preserves the preparations and closes the old table details after saving',async({page})=>{
 const posts=await floor(page);
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[
  {tableorder_value:'1',_id:'table-1',capacity:4},
  {tableorder_value:'2',_id:'table-2',capacity:4}
 ]}}));
 await page.locator('[data-floor-move-order]').click();
 await expect(page.locator('#moveTableModal')).toBeVisible();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 await page.locator('.move-table[data-value="2"]').click();
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 await expect(page.locator('#kot-sliding-panel')).not.toHaveClass(/open/);
 expect(posts).toHaveLength(1);
 expect(posts[0]).toMatchObject({order_id:'order-1',table_number:'2',table_id:'table-2',person_count:2});
 expect(posts[0].items.map(item=>({line_id:item.line_id,quantity:item.quantity,note:item.item_description}))).toEqual([
  {line_id:'second',quantity:1,note:'Extra spicy'},
  {line_id:'first',quantity:1,note:'No chilli'}
 ]);
});

test('short line actions fit a narrow phone and stale removed lines are not replaced by another dish',async({page})=>{
 await page.setViewportSize({width:320,height:700});
 const posts=await floor(page,{rounds:true});
 const row=page.locator('[data-line-key="second"]');
 await row.scrollIntoViewIfNeeded();
 const boxes=await row.locator('button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
 for(const box of boxes){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(320);}
 for(let i=1;i<boxes.length;i++)expect(boxes[i].top>=boxes[i-1].bottom || boxes[i].left>=boxes[i-1].right).toBe(true);
 await page.screenshot({path:'test-artifacts/direct-order-actions-320.png'});
 await page.route('**/sales/getOrderHistory',r=>r.fulfill({json:{type:'success',data:{orders:[{...order,items:[order.items[0]]}]}}}));
 await row.locator('[data-line-action=cancel]').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 await expect(page.locator('#removeItemConfirmModal')).toBeHidden();
 await expect(page.locator('body')).toContainText('Table changed. Refresh and try again.');
 expect(posts).toEqual([]);
});

test('cancellation collects a reason in its own window and retains it after failure',async({page})=>{
 const posts=await floor(page);
 await page.evaluate(()=>cancelKot('order-1'));
 await expect(page.locator('#cancelOrderModal')).toBeVisible();
 await page.locator('#confirm-cancel-order').click();
 expect(posts).toEqual([]);
 await page.locator('#cancel-order-reason').fill('Customer changed plans');
 let fail=true;
 await page.route('**/sales/updateOrder',r=>{
  posts.push(r.request().postDataJSON());
  return r.fulfill({json:fail?{type:'error',message:'Please retry'}:{type:'success'}});
 });
 await page.locator('#confirm-cancel-order').click();
 await expect(page.locator('#confirm-cancel-order')).toBeEnabled();
 await expect(page.locator('#cancel-order-reason')).toHaveValue('Customer changed plans');
 expect(posts[0]).toMatchObject({status:'cancelled',change_reason:'Customer changed plans'});
 fail=false;
 await page.locator('#confirm-cancel-order').click();
 await expect(page.locator('#cancelOrderModal')).toBeHidden();
 expect(posts).toHaveLength(2);
});

test('history cancellation sends the entered reason',async({page})=>{
 await onTheMenu(page,'nothing');
 await page.goto('/order-history.html');
 await page.evaluate(source=>{allOrders=[source];cancelOrder(source._id);},order);
 await expect(page.locator('#cancelConfirmModal')).toBeVisible();
 const posts=[];
 await page.route('**/sales/updateOrder',r=>{posts.push(r.request().postDataJSON());return r.fulfill({json:{type:'success'}});});
 await page.locator('#history-cancel-reason').fill('Duplicate order');
 await page.locator('#confirm-cancel-order-btn').click();
 await expect(page.locator('#cancelConfirmModal')).toBeHidden();
 expect(posts[0]).toMatchObject({order_id:'order-1',status:'cancelled',change_reason:'Duplicate order'});
});

test('declining item cancellation leaves the original order without an empty edit screen',async({page})=>{
 const posts=await floor(page);
 await page.locator('[data-line-key="second"] [data-line-action=cancel]').click();
 await expect(page.locator('#removeItemConfirmModal')).toBeVisible();
 await page.locator('#removeItemConfirmModal [data-bs-dismiss=modal]').last().click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 await expect(page.locator('#save-order-changes')).toBeHidden();
 await expect(page.locator('.order-items-heading')).toBeVisible();
 expect(posts).toEqual([]);
});
test('quantity changes stay inside order details and have a pinned discard/save bar',async({page})=>{
 const posts=await floor(page);
 await page.locator('[data-line-key="second"] [data-line-action=more]').click();
 await expect(page.locator('.order-sheet #editOrderModal.inline-order-editor')).toBeVisible();
 await expect(page.locator('#editOrderModal .modal-header')).toBeHidden();
 await expect(page.locator('#cancel-order-changes')).toHaveText('Discard changes');
 await page.screenshot({path:'test-artifacts/inline-order-edit.png',fullPage:true});
 await expect(page.locator('#save-order-changes')).toBeInViewport();
 expect(posts).toEqual([]);
 await page.locator('#cancel-order-changes').click();
 await page.locator('[data-confirm-action=discard]').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 await expect(page.locator('.order-items-heading')).toBeVisible();
 expect(posts).toEqual([]);
});

for(const width of [320,390,480])test(`compact item actions stay readable at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:850});
 await floor(page,{rounds:true});
 const row=page.locator('.service-line').first();
 await expect(row.locator('[data-line-action=note] i')).toBeVisible();
 await expect(row.locator('[data-line-action=cancel]')).toHaveAttribute('aria-label','Cancel item');
 await expect(row.locator('[data-serve-line]')).toHaveAttribute('aria-label','Mark served');
 await expect(row.locator('.serve-item-icon')).toBeVisible();
 const noteBox=await row.locator('[data-line-action=note]').boundingBox(),serveBox=await row.locator('[data-serve-line]').boundingBox();
 expect(Math.abs(noteBox.y-serveBox.y)).toBeLessThan(3);
 expect(serveBox.width).toBeGreaterThanOrEqual(44);
 expect(await row.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
 await expect.poll(async()=>Math.abs((await page.locator('#kot-sliding-panel').boundingBox()).x)).toBeLessThan(2);
 await page.screenshot({path:`test-artifacts/compact-order-actions-${width}.png`,fullPage:true});
});

for(const width of [320,424])test(`editor preparation is a compact icon beside Note at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:850});
 await floor(page);
 await page.evaluate(()=>{ServiceDetails.supported=()=>true;});
 await page.locator('[data-line-key="second"] [data-line-action=more]').click();
 const row=page.locator('#current-order-items .order-item-card').last();
 const prep=row.locator('[data-preparation-order]'),note=row.locator('.editor-note-link');
 await expect(prep).toHaveAttribute('aria-label','Preparation');
 await expect(prep.locator('i')).toBeVisible();
 await expect(prep).toHaveText('');
 const p=await prep.boundingBox(),n=await note.boundingBox();
 expect(p.width).toBe(width<=360?32:40);expect(p.height).toBeGreaterThanOrEqual(44);
 expect(Math.abs(p.y-n.y)).toBeLessThan(3);expect(p.x).toBeGreaterThanOrEqual(n.x+n.width+7);
 expect(await row.evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
 await prep.click();await expect(page.locator('#preparation-dialog')).toBeVisible();
 await page.locator('#preparation-dialog [data-close]').first().click();
 await note.click();await expect(page.locator('#editItemNotesModal')).toBeVisible();
});

test('repeat controls and menu additions share only the fresh unannotated draft', async({page}) => {
 const posts = await floor(page);
 await page.locator('[data-line-key="second"] [data-line-action=more]').click();
 await expect(page.locator('#current-order-items [data-draft-line="true"]')).toHaveCount(1);
 const sent = page.locator('[data-line-key="second"]');
 await sent.getByRole('button', {name:'Add again', exact:true}).click();
 await page.locator('.order-sheet > .order-items-heading [data-order-add]').click();
 await page.locator('#item-picker .btn-increase[data-id="p-biryani"]').first().click();
 await page.evaluate(() => closeItemPicker());
 let draft = await page.evaluate(() => editingOrder.items);
 expect(draft.filter(item => ['first','second'].includes(item.line_id)).map(item => item.quantity)).toEqual([1,1]);
 expect(draft[2].quantity).toBe(3);
 expect(draft[2].item_description).toBe('');
 await page.locator('[data-draft-line="true"]').getByRole('button',{name:'Increase quantity',exact:true}).click();
 await page.locator('[data-draft-line="true"] .editor-note-link').click();
 await page.locator('#edit-item-notes-text').fill('Less sugar');
 await page.locator('#edit-item-notes-apply').click();
 await sent.getByRole('button',{name:'Add again',exact:true}).click();
 draft = await page.evaluate(() => editingOrder.items);
 expect(draft).toHaveLength(4);
 expect(draft[2].quantity).toBe(4);
 expect(draft[2].item_description).toBe('Less sugar');
 expect(draft[3].quantity).toBe(1);
 const newRow=page.locator('[data-draft-line="true"]').first();
 const prepBox = await newRow.locator('.editor-preparation-action').boundingBox();
 const quantityBox = await newRow.locator('.item-controls').boundingBox();
 expect(Math.abs(quantityBox.y-prepBox.y)).toBeLessThan(3);
 await page.screenshot({path:'test-artifacts/repeat-draft-groups.png',fullPage:true});
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(1);
 expect(posts[0].items.find(item=>item.line_id==='second').item_description).toBe('Extra spicy');
 expect(posts[0].items.find(item=>item.line_id==='first').item_description).toBe('No chilli');
 expect(posts[0].items.map(item=>item.quantity)).toEqual([1,1,4,1]);
});


test('Move table accepts a temporary label and reuses the normal move without changing items',async({page})=>{
 const posts=await floor(page);
 const tables=[{tableorder_value:'1',_id:'table-1',capacity:4}];
 const created=[];
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables}}));
 await page.route('**/captain/v1/tables/temporary',r=>{
  created.push(r.request().postDataJSON());
  tables.push({tableorder_value:'6A',_id:'table-6a',capacity:4});
  return r.fulfill({json:{id:'table-6a',tableorder_value:'6A'}});
 });
 await page.locator('[data-floor-move-order]').click();
 const field=page.getByLabel('Custom table',{exact:true});
 await expect(field).toBeVisible();
 await field.fill('6a');
 await expect(page.locator('#move-table-go')).toBeDisabled();
 await page.getByRole('button',{name:'Use table',exact:true}).click();
 await expect(page.locator('#move-table-go')).toHaveText('Move to table 6A');
 expect(created).toEqual([{tableorder_value:'6A'}]);
 expect(posts).toHaveLength(0);
 await field.fill('6a');
 await expect(page.locator('#move-table-go')).toBeDisabled();
 await page.getByRole('button',{name:'Use table',exact:true}).click();
 expect(created).toHaveLength(1);
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 expect(posts[0]).toMatchObject({table_number:'6A',table_id:'table-6a',person_count:2});
 expect(posts[0].items.map(item=>item.quantity)).toEqual([1,1]);
 expect(posts[0].items.map(item=>item.item_description)).toEqual(['Extra spicy','No chilli']);
});


test('temporary tables use the durable seating move when the server supports it',async({page})=>{
 await floor(page);
 const id='aaaaaaaaaaaaaaaaaaaaaaaa', added='bbbbbbbbbbbbbbbbbbbbbbbb';
 const tables=[{tableorder_value:'1',_id:id}];
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables,capabilities:{legacySourceMove:true}}}));
 await page.route('**/captain/v1/tables/temporary',r=>{
  tables.push({tableorder_value:'6C',_id:added});
  return r.fulfill({json:{id:added,tableorder_value:'6C'}});
 });
 const requests=[];
 await page.route('**/captain/v1/tables/move/prepare',r=>{
  const body=r.request().postDataJSON();requests.push(body);
  return r.fulfill({json:{request_id:body.request_id,orderId:'order-1',state:'reserved'}});
 });
 await page.route('**/captain/v1/tables/move/complete',r=>r.fulfill({json:{request_id:r.request().postDataJSON().request_id,orderId:'order-1',state:'submitting',tableIds:[added]}}));
 await page.locator('[data-floor-move-order]').click();
 await page.getByLabel('Custom table',{exact:true}).fill('6c');
 await page.getByRole('button',{name:'Use table',exact:true}).click();
 await expect(page.locator('#move-table-go')).toBeEnabled();
 await page.screenshot({path:'test-artifacts/custom-table-move.png'});
 await page.locator('#move-table-go').click();
 await expect(page.locator('#moveTableModal')).toBeHidden();
 expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({tableIds:[added],primaryId:added,guests:2});
});


for(const history of [false,true])test(`cancellation templates can be selected and edited, history=${history}`,async({page})=>{
 const posts=[];
 if(history){
  await onTheMenu(page,'nothing');await page.goto('/order-history.html');
  await page.evaluate(source=>{allOrders=[source];cancelOrder(source._id);},order);
 }else{await floor(page);await page.evaluate(()=>cancelKot('order-1'));}
 await page.route('**/sales/updateOrder',r=>{posts.push(r.request().postDataJSON());return r.fulfill({json:{type:'success'}});});
 const dialog=page.locator(history?'#cancelConfirmModal':'#cancelOrderModal');
 const field=dialog.locator('textarea');
 const choices=dialog.getByRole('group',{name:'Quick cancellation reasons'});
 await expect(choices.getByRole('button')).toHaveCount(5);
 const selected=choices.getByRole('button',{name:'Item unavailable',exact:true});
 await selected.click();await expect(field).toHaveValue('Item unavailable');
 await expect(selected).toHaveAttribute('aria-pressed','true');
 expect(posts).toHaveLength(0);
 await field.fill('Item unavailable: sold out');
 await expect(selected).toHaveAttribute('aria-pressed','false');
 const box=await selected.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 if(!history)await page.screenshot({path:'test-artifacts/cancellation-reason-templates.png'});
 await page.locator(history?'#confirm-cancel-order-btn':'#confirm-cancel-order').click();
 await expect(dialog).toBeHidden();
 expect(posts[0]).toMatchObject({status:'cancelled',change_reason:'Item unavailable: sold out'});
});


test('Add again keeps kitchen batches visible and repeated taps share the inline draft',async({page})=>{
 const posts=await floor(page,{rounds:true});
 const repeat=page.locator('[data-line-key="second"] [data-line-action=more]');
 const url=page.url();
 await repeat.click();
 await expect(page.locator('#editOrderModal')).toHaveClass(/inline-additions/);
 await expect(page.locator('.order-sheet > .kot-items-list')).toBeVisible();
 await expect(page.locator('.order-sheet > .order-items-heading')).toBeVisible();
 await expect(page.locator('[data-draft-line="false"]').first()).toBeHidden();
 await repeat.click();
 await expect(page.locator('[data-draft-line="true"] .qty-display')).toHaveText('2');
 expect(page.url()).toBe(url);expect(posts).toHaveLength(0);
 await page.locator('.order-sheet > .order-items-heading [data-order-add]').click();
 await expect(page.locator('#item-picker')).toBeVisible();
 await page.evaluate(()=>closeItemPicker());
 await page.locator('[data-draft-line="true"] .editor-note-link').click();
 await page.locator('#edit-item-notes-text').fill('Pack separately');
 await page.locator('#edit-item-notes-apply').click();
 await expect(page.locator('#editItemNotesModal')).toBeHidden();
 await expect(page.locator('.modal-backdrop')).toHaveCount(0);
 await page.screenshot({path:'test-artifacts/same-screen-add-again.png'});
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(1);
 expect(posts[0].items.find(item=>item.line_id==='second')).toMatchObject({quantity:1,item_description:'Extra spicy'});
 expect(posts[0].items.find(item=>!['first','second'].includes(item.line_id))).toMatchObject({quantity:2,item_description:'Pack separately'});
});


for(const rounds of [false,true])test(`remove item confirms and marks the original row in place, rounds=${rounds}`,async({page})=>{
 const posts=await floor(page,{rounds});
 const url=page.url();
 await page.locator('[data-line-key="second"] [data-line-action=cancel]').click();
 await expect(page.locator('.order-sheet > .kot-items-list')).toBeVisible();
 await expect(page.locator('#removeItemConfirmModal')).toBeVisible();
 expect(posts).toHaveLength(0);
 await page.locator('#cancel-item-reason').fill('Entered by mistake');
 await page.locator('#confirm-remove-item-btn').click();
 await expect(page.locator('#removeItemConfirmModal')).toBeHidden();
 await expect(page.locator('.is-draft-cancelled')).toContainText('Cancellation · Not sent yet');
 await expect(page.locator('.modal-backdrop')).toHaveCount(0);
 if(rounds)await page.screenshot({path:'test-artifacts/inline-item-cancellation.png'});
 await expect(page.locator('[data-draft-line="false"]').first()).toBeHidden();
 await expect(page.locator('#save-order-changes')).toBeInViewport();
 expect(page.url()).toBe(url);expect(posts).toHaveLength(0);
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts).toHaveLength(1);
 expect(posts[0].items).toHaveLength(1);
 expect(posts[0].items[0]).toMatchObject({line_id:'first',quantity:1,item_description:'No chilli'});
});


test('completed history bill shows paid balance and requests an exact receipt without collection',async({page})=>{
 await onTheMenu(page,'nothing');
 const id='507f1f77bcf86cd799439011',prints=[];
 await page.route('**/captain/v1/bill?*',r=>{
  expect(new URL(r.request().url()).searchParams.get('saleId')).toBe(id);
  expect(new URL(r.request().url()).searchParams.get('receipt')).toBe('true');
  return r.fulfill({json:{lines:[],labels:{},totalMinor:44000,paidMinor:44000,dueMinor:0,collectEnabled:false}});
 });
 await page.route('**/captain/v1/bill/reprint',r=>{prints.push(r.request().postDataJSON());return r.fulfill({json:{type:'success',status:'queued'}});});
 await page.goto('/order-history.html');
 await page.evaluate(source=>{allOrders=[source];viewOrderDetails(source._id);},{...order,_id:id,status:'completed',payment_status:'Paid'});
 await page.getByRole('button',{name:'View / Print bill'}).click();
 await expect(page.locator('#bill-review')).toContainText('Paid');
 await expect(page.locator('#bill-review')).toContainText('Remaining balance');
 await expect(page.locator('[data-bill-pay]')).toHaveCount(0);
 await expect(page.locator('[data-bill-split]')).toHaveCount(0);
 await page.locator('[data-bill-print]').click();
 await expect(page.locator('#bill-review [role=status]')).toHaveText('Bill asked for');
 expect(prints).toHaveLength(1);expect(prints[0].saleId).toBe(id);expect(prints[0].request_id).toBeTruthy();
});


for(const fractional of [false,true])test(`transfer quantity steps match recorded portions, fractional=${fractional}`,async({page})=>{
 await onTheMenu(page,'nothing');await page.goto('/order-history.html');
 await page.evaluate(fractional=>CaptainTransferScreen.open({_id:'transfer-test',kitchen_rounds:[{items:[{id:'line-1',name:'Masala Tea',quantity:fractional?1.5:2,served:0}]}]}),fractional);
 const input=page.locator('.transfer-screen [data-quantity]');
 await expect(input).toHaveAttribute('step',fractional?'0.001':'1');
 if(!fractional){
  await input.press('ArrowUp');await expect(input).toHaveValue('1');
  await input.fill('0.001');
  await page.locator('.transfer-screen button[type=submit]').click();
  expect(await input.evaluate(el=>el.validity.stepMismatch)).toBe(true);
  await expect(input).toBeVisible();
  await input.fill('1');expect(await input.evaluate(el=>el.checkValidity())).toBe(true);
 }else{
  await input.fill('0.5');expect(await input.evaluate(el=>el.checkValidity())).toBe(true);
 }
});


for(const status of ['cancelled','completed','paid'])test(`transfer is unavailable for ${status} orders`,async({page})=>{
 await onTheMenu(page,'nothing');await page.goto('/order-history.html');
 await page.evaluate(status=>{
  window.canMergeOrders=()=>true;
  const source={_id:'closed-order',status:status==='paid'?'pending':status,payment_status:status==='paid'?'Paid':'Unpaid',item_transfer:true,kitchen_rounds:[{items:[{id:'one',name:'Tea',quantity:1,served:0}]}]};
  document.body.insertAdjacentHTML('beforeend',ServiceRounds.render(source));
  CaptainTransferScreen.open(source);
 },status);
 await expect(page.locator('[data-transfer-order="closed-order"]')).toHaveCount(0);
 await expect(page.locator('.transfer-screen[open]')).toHaveCount(0);
});


test('open unpaid transfer completes selection destination preview and save',async({page})=>{
 await onTheMenu(page,'nothing');await page.goto('/order-history.html');
 const sourceId='aaaaaaaaaaaaaaaaaaaaaaaa',tableId='bbbbbbbbbbbbbbbbbbbbbbbb',destinationId='cccccccccccccccccccccccc';
 const writes=[];
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[{id:tableId,tableorder_value:'6A',status:'available',max:4,adjacent:[]}]}}));
 await page.route('**/captain/v1/tables/transfer/preview',r=>r.fulfill({json:{revision:'d'.repeat(64),currencyCode:'INR',currencyDigits:2,source:{totalMinor:3000},destination:{totalMinor:3000,rounds:[{name:'Tea',quantity:1,note:'Less sugar',served:0}]}}}));
 await page.route('**/captain/v1/tables/transfer/complete',r=>{const body=r.request().postDataJSON();writes.push(body);return r.fulfill({json:{requestId:body.requestId,sourceId,destinationId,sourceClosed:false,state:'completed'}});});
 await page.evaluate(sourceId=>CaptainTransferScreen.open({_id:sourceId,status:'pending',payment_status:'Unpaid',table_number:'55',kitchen_rounds:[{items:[{id:'c0i0',name:'Tea',quantity:2,served:0,note:'Less sugar'}]}]}),sourceId);
 const dialog=page.locator('.transfer-screen');
 await dialog.locator('[data-quantity]').fill('1');await dialog.getByRole('button',{name:'Continue'}).click();
 await dialog.locator('input[type=checkbox]').check();await dialog.getByRole('button',{name:'Continue'}).click();
 await expect(dialog).toContainText('Less sugar');expect(writes).toHaveLength(0);
 await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toBeHidden();
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({orderId:sourceId,items:[{id:'c0i0',quantity:1,servedQuantity:0}],destination:{tableIds:[tableId],primaryId:tableId,guests:1}});
});


for(const minus of [false,true])test(`unsent removal needs no confirmation and clears an empty draft, minus=${minus}`,async({page})=>{
 const posts=await floor(page);
 await page.locator('[data-line-key="second"] [data-line-action=more]').click();
 const row=page.locator('[data-draft-line="true"]');
 await expect(row.getByRole('button',{name:'Remove item',exact:true})).toBeVisible();
 await row.getByRole('button',{name:minus?'Decrease quantity':'Remove item',exact:true}).click();
 await expect(page.locator('#removeItemConfirmModal')).toBeHidden();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 await expect(page.locator('.order-sheet > .kot-items-list')).toBeVisible();
 expect(posts).toHaveLength(0);
});
test('sent item cancellation requires a reason and includes it in the save',async({page})=>{
 const posts=await floor(page);
 await page.locator('[data-line-key="second"] [data-line-action=cancel]').click();
 await page.locator('#confirm-remove-item-btn').click();
 await expect(page.locator('#removeItemConfirmModal')).toBeVisible();
 expect(await page.evaluate(()=>editingOrder.items.find(i=>i.line_id==='second').quantity)).toBe(1);
 await page.locator('#removeItemConfirmModal').getByRole('button',{name:'Item unavailable',exact:true}).click();
 await page.locator('#confirm-remove-item-btn').click();
 await expect(page.locator('#removeItemConfirmModal')).toBeHidden();
 await page.locator('#save-order-changes').click();
 await expect(page.locator('#editOrderModal')).toBeHidden();
 expect(posts[0].change_reason).toBe('Item unavailable');
});


test('add-more menu counts only new items and minus never changes sent quantities',async({page})=>{
 const posts=await floor(page);
 await page.locator('.order-sheet [data-order-add]').click();
 const picker=page.locator('#item-picker');
 await expect(picker).toBeVisible();
 await expect(page.locator('#picker-item-count')).toHaveText('0 new items');
 await expect(picker.locator('.dish[data-id="p-biryani"] .picker-previous-count').first()).toHaveText('Already ordered: 2');
 await picker.locator('.btn-add[data-id="p-biryani"]').first().click();
 await expect(page.locator('#picker-item-count')).toHaveText('1 new item');
 await picker.locator('.btn-increase[data-id="p-biryani"]').first().click();
 await expect(page.locator('#picker-item-count')).toHaveText('2 new items');
 const counter=picker.locator('.dish[data-id="p-biryani"] .dish-step').first();
 expect(await counter.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
 expect(await counter.locator('.dish-qty').evaluate(el=>getComputedStyle(el).color)).not.toBe('rgb(255, 255, 255)');
 await expect(picker.locator('.dish[data-id="p-biryani"] .picker-previous-count').first()).toHaveText('Already ordered: 2');
 await expect(picker.locator('.dish[data-id="p-coffee"] .picker-previous-count')).toHaveCount(0);
 await picker.locator('.btn-decrease[data-id="p-biryani"]').first().click();
 await picker.locator('.btn-decrease[data-id="p-biryani"]').first().click();
 await expect(page.locator('#picker-item-count')).toHaveText('0 new items');
 await expect(picker.locator('.dish[data-id="p-biryani"] .picker-previous-count').first()).toHaveText('Already ordered: 2');
 await expect(picker.locator('.btn-add[data-id="p-biryani"]').first()).toBeVisible();
 await expect(page.locator('#removeItemConfirmModal')).toBeHidden();
 expect(await page.evaluate(()=>editingOrder.items.map(i=>i.quantity))).toEqual([1,1]);
 expect(posts).toHaveLength(0);
 await picker.getByRole('button',{name:'Review new items',exact:true}).click();
 await expect(picker).toBeHidden();
});


for(const width of [320,540])test(`menu additions keep original rows and compact draft controls at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:850});await floor(page,{rounds:true});
 await page.locator('.order-sheet > .order-items-heading [data-order-add]').click();
 await page.locator('#item-picker .btn-add[data-id="p-biryani"]').first().click();
 await page.locator('#item-picker-done').click();
 await expect(page.locator('.order-sheet > .kot-items-list')).toBeVisible();
 const row=page.locator('.compact-draft-row');await expect(row).toBeVisible();
 await expect(row.locator('.service-quantity')).toHaveText('×1');
 const existing=page.locator('.kot-items-list .service-line').first();
 const styles=el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.lineHeight];};
 expect(await row.locator('.line-name').evaluate(styles)).toEqual(await existing.locator('.service-dish strong').evaluate(styles));
 expect(await row.locator('.editor-note-link').evaluate(el=>el.offsetHeight)).toBe(await existing.locator('[data-line-action=note]').evaluate(el=>el.offsetHeight));
 const offset=await row.evaluate(el=>Math.abs(el.querySelector('[aria-label="Note"]').getBoundingClientRect().y-el.querySelector('[aria-label="Increase quantity"]').getBoundingClientRect().y));
 expect(offset).toBeLessThan(3);
 expect((await row.boundingBox()).height).toBeLessThan(130);
 expect(await row.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(row.getByRole('button',{name:'Cancel item'})).toHaveCount(0);
 await expect(row.getByRole('button',{name:'Remove item'})).toBeVisible();
 await page.locator(".order-scroll").evaluate(el=>{el.scrollTop=el.scrollHeight;});
 expect((await row.boundingBox()).y+(await row.boundingBox()).height).toBeLessThanOrEqual((await page.locator("#editOrderModal .editor-footer").boundingBox()).y);
 await page.screenshot({path:`test-artifacts/compact-new-row-${width}.png`});
});

for(const width of [390,768])for(const mode of ['light','dark'])test(`item note dialog design ${width} ${mode}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:mode});
 await floor(page,{rounds:true});
 await page.locator('[data-line-key="second"] [data-line-action=note]').click();
 const dialog=page.locator('#editItemNotesModal');
 await expect(dialog).toBeVisible();await expect(dialog).toHaveCSS('opacity','1');
 await expect(dialog.locator('textarea')).toHaveCSS('font-weight','400');
 await expect(dialog.getByRole('button',{name:'Save note',exact:true})).toBeVisible();
 await expect(dialog.locator('textarea')).toHaveValue('Extra spicy');
 expect(await dialog.locator('.modal-content').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 const box=await dialog.locator('.modal-content').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 const rgb=await dialog.locator('.notes-btn-primary').evaluate(el=>getComputedStyle(el).backgroundColor);
 expect(rgb).not.toBe('rgb(255, 122, 26)');
 await page.screenshot({path:`test-artifacts/item-note-actual-${width}-${mode}.png`});
 const {readFileSync}=await import('node:fs');
 const reference=await page.context().newPage();await reference.setViewportSize({width,height:900});await reference.emulateMedia({colorScheme:mode});
 await reference.setContent('<style>@font-face{font-family:Inter;src:url(data:font/woff2;base64,'+readFileSync('assets/vendor/inter/InterVariable.woff2').toString('base64')+');font-weight:100 900}</style>'+readFileSync('C:/Users/Kayal/.codex/visualizations/2026/09/21/01a0c273-5439-70a1-ada1-0c9eeb5a921c/captain-fast-order.html','utf8'));
 await reference.locator('[data-lot-note]').first().click();await expect(reference.locator('#cf-note')).toBeVisible();
 await reference.screenshot({path:`test-artifacts/item-note-reference-${width}-${mode}.png`});await reference.close();
});

for(const width of [320,390,768])for(const mode of ["light","dark"])for(const discard of [false,true])test(`sent minus stays compact ${width} ${mode}, discard=${discard}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:mode});
 const posts=await floor(page,{rounds:true,quantity:3});
 const line=page.locator('.kot-items-list [data-line-key="second"]').locator('..');
 const edits=await line.locator('[data-line-action=note]').boundingBox();
 const serving=await line.locator('[data-serve-line]').boundingBox();
 expect(Math.abs(edits.y-serving.y)).toBeLessThan(2);
 expect(await line.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await line.locator('[data-line-action=less]').click();
 await expect(page.locator('#removeItemConfirmModal')).toBeVisible();
 await expect(page.locator('#remove-item-name')).toHaveText('1 × Chicken Biryani');
 await expect(page.locator('.order-sheet > .kot-items-list')).toBeVisible();
 await page.locator('#cancel-item-reason').fill('Customer requested');
 await page.locator('#confirm-remove-item-btn').click();
 await expect(page.locator('#removeItemConfirmModal')).toBeHidden();
 await expect(line.locator('.service-quantity')).toHaveText('×3');
 await expect(line.locator('.draft-cancel-label')).toContainText('Cancel 1 of 3 · Not sent');
 expect(await page.evaluate(()=>editingOrder.items.find(i=>i.line_id==='second').quantity)).toBe(2);
 if(!discard){
  await expect(page.locator('#editOrderModal')).not.toHaveClass(/modal-behind/);
  const footer=page.locator('#editOrderModal .editor-footer');
  const aligned=async()=>{const a=await footer.boundingBox(),b=await page.locator('.order-workspace').boundingBox();return Math.abs(a.x-b.x)<2&&Math.abs(a.width-b.width)<2;};
  await expect.poll(aligned).toBe(true);
  await page.locator('.order-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
  await expect.poll(aligned).toBe(true);
  await expect(footer).toBeInViewport();
  await page.setViewportSize({width:width+80,height:900});await expect.poll(aligned).toBe(true);
  await page.setViewportSize({width,height:900});await expect.poll(aligned).toBe(true);
  await page.locator('.order-scroll').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:`test-artifacts/partial-cancel-actual-${width}-${mode}.png`});
  const {readFileSync}=await import('node:fs');
  const ref=await page.context().newPage();await ref.setViewportSize({width,height:900});await ref.emulateMedia({colorScheme:mode});
  await ref.setContent('<style>@font-face{font-family:Inter;src:url(data:font/woff2;base64,'+readFileSync('assets/vendor/inter/InterVariable.woff2').toString('base64')+');font-weight:100 900}</style>'+readFileSync('C:/Users/Kayal/.codex/visualizations/2026/09/21/01a0c273-5439-70a1-ada1-0c9eeb5a921c/captain-fast-order.html','utf8'));
  await ref.locator('[data-cancel-lot]').first().click();await ref.locator('#cf-reason').fill('Customer requested');await ref.locator('[data-confirm-cancel]').click();
  await ref.screenshot({path:`test-artifacts/partial-cancel-reference-${width}-${mode}.png`});await ref.close();
 }

 expect(posts).toEqual([]);
 if(discard){
  await page.locator('#cancel-order-changes').click();await page.locator('[data-confirm-action=discard]').click();
  await expect(line.locator('.draft-cancel-label')).toHaveCount(0);await expect(line.locator('.service-quantity')).toHaveText('×3');expect(posts).toEqual([]);
 }else{
  await page.locator('#save-order-changes').click();await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0].change_reason).toBe('Customer requested');
  expect(posts[0].items.find(i=>i.line_id==='second').quantity).toBe(2);
  expect(posts[0].items.find(i=>i.line_id==='first').quantity).toBe(3);
 }
});

for(const whole of [false,true])test(`undo pending cancellation preserves other edits, whole=${whole}`,async({page})=>{
 const posts=await floor(page,{rounds:true,quantity:3});
 const line=page.locator('.kot-items-list [data-line-key="second"]').locator('..');
 await page.locator('[data-line-key="first"] [data-line-action=more]').click();
 await line.locator('[data-line-action=note]').click();
 await page.locator('#edit-item-notes-text').fill('Keep this note');
 await page.locator('#edit-item-notes-apply').click();
 await line.locator(`[data-line-action=${whole?'cancel':'less'}]`).click();
 await page.locator('#cancel-item-reason').fill('Customer requested');
 await page.locator('#confirm-remove-item-btn').click();
 const undo=line.locator('[data-undo-cancellation]');await expect(undo).toBeEnabled();
 await page.evaluate(()=>OrderEditor.setSaving(true));
 expect(await page.evaluate(()=>OrderEditor.undoCancellation(editingOrder.items.find(i=>i.line_id==='second')))).toBe(false);
 await page.evaluate(()=>OrderEditor.setSaving(false));
 await undo.click();
 await expect(line.locator('.draft-cancel-label')).toHaveCount(0);
 await expect(line.locator('[data-line-action=note]')).toBeEnabled();
 await expect(line.locator('[data-line-action=more]')).toBeEnabled();
 const restored=await page.evaluate(()=>editingOrder.items.find(i=>i.line_id==='second'));
 expect(restored.quantity).toBe(3);expect(restored.cancellation_reason).toBeUndefined();
 await expect(line).toContainText('Keep this note');
 await expect(page.locator('.compact-draft-row')).toHaveCount(1);expect(posts).toEqual([]);
 await page.locator('#save-order-changes').click();await expect.poll(()=>posts.length).toBe(1);
 expect(posts[0].items.find(i=>i.line_id==='second').quantity).toBe(3);
 expect(posts[0].change_reason).toBeUndefined();
});

for(const width of [320,768])for(const mode of ['light','dark'])test(`draft footer reserves its actual height ${width} ${mode}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:mode});
 const posts=await floor(page,{rounds:true});
 await page.locator('[data-line-key="second"] [data-line-action=more]').click();
 const footer=page.locator('#editOrderModal .editor-footer');
 // Model increased text size without replacing translated copy or application state.
 await page.addStyleTag({content:'#editOrderModal .editor-footer button,#editOrderModal .editor-save-help{font-size:24px!important;line-height:1.6!important}'});
 await expect.poll(async()=>footer.evaluate(el=>{const h=el.getBoundingClientRect().height;return h>180&&Math.abs(parseFloat(getComputedStyle(el.closest(".order-workspace")).getPropertyValue("--order-footer-height"))-h)<=1;})).toBe(true);
 await page.locator('.order-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 const row=page.locator('.compact-draft-row');
 expect(await row.locator('.qty-display').evaluate(el=>getComputedStyle(el).color)).toBe(await row.locator('strong').first().evaluate(el=>getComputedStyle(el).color));
 await expect.poll(async()=>{const r=await row.boundingBox(),f=await footer.boundingBox();return r.y>=0&&r.y+r.height<=f.y;}).toBe(true);
 await expect(row.locator('.qty-btn').last()).toBeInViewport();
 await page.screenshot({path:`test-artifacts/draft-footer-large-text-${width}-${mode}.png`});
 await page.locator('#cancel-order-changes').click();await page.locator('[data-confirm-action=discard]').click();
 await expect(page.locator('.order-workspace')).not.toHaveClass(/inline-editing/);
 expect(await page.locator('.order-workspace').evaluate(el=>el.style.getPropertyValue('--order-footer-height'))).toBe('');
 expect(posts).toEqual([]);
});

test('added item is revealed and highlighted without replacing kitchen rows',async({page})=>{
 await page.setViewportSize({width:390,height:700});await floor(page,{rounds:true});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('[data-line-key="second"] [data-line-action=more]').click();
 const row=page.locator('.compact-draft-row');await expect(row).toHaveClass(/item-change-highlight/);
 await expect.poll(async()=>{const box=await row.boundingBox(),footer=await page.locator('#editOrderModal .editor-footer').boundingBox();return box.y+box.height<=footer.y;}).toBe(true);
 await expect(page.locator('.order-sheet > .kot-items-list')).toBeVisible();
});
test('floor waits for confirmation before empty state and retains cards during refresh',async({page})=>{
 await onTheMenu(page,'nothing');let release;const gate=new Promise(r=>release=r);
 await page.route('**/sales/getTablesWithActiveOrders',async r=>{await gate;await r.fulfill({json:{type:'success',data:{tables:['1']}}});});
 await page.goto('/kot-management.html');
 await expect(page.locator('.floor-loading')).toHaveCount(1);
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('captain:pending-changed')));
 await expect(page.locator('#no-orders-message')).toBeHidden();release();
 await expect(page.locator('.floor-card')).toHaveCount(1);
 let finish;const refreshGate=new Promise(r=>finish=r);
 await page.route('**/sales/getTablesWithActiveOrders',async r=>{await refreshGate;await r.fulfill({json:{type:'success',data:{tables:['1']}}});});
 await page.evaluate(()=>{void loadTables();});
 await expect(page.locator('#tables-list')).toHaveAttribute('aria-busy','true');
 await expect(page.locator('.floor-card')).toHaveCount(1);await expect(page.locator('.section-loader')).toHaveCount(0);await expect(page.locator('#no-orders-message')).toBeHidden();finish();
 await expect(page.locator('#tables-list')).toHaveAttribute('aria-busy','false');
});

for(const theme of ['light','dark'])test(`item picker has solid surfaces and uncompressed controls ${theme}`,async({page})=>{
 await page.setViewportSize({width:390,height:740});await page.emulateMedia({colorScheme:theme});await floor(page,{rounds:true});
 await page.locator('.order-sheet [data-order-add]').click();
 const picker=page.locator('#item-picker');await expect(picker).toBeVisible();
 const search=picker.locator('.product-search-inner');const before=await search.evaluate(n=>getComputedStyle(n).backgroundColor);
 await page.locator('#picker-search-input').focus();await expect(search).toHaveCSS('background-color',before);
 const geometry=await picker.evaluate(n=>{const rect=s=>n.querySelector(s).getBoundingClientRect();const search=rect('.item-picker-search'),rail=rect('.item-picker-rail'),body=rect('.item-picker-body'),foot=rect('.item-picker-foot');return {rail:rail.height,searchBottom:search.bottom,railTop:rail.top,railBottom:rail.bottom,bodyTop:body.top,bodyBottom:body.bottom,footTop:foot.top,footBottom:foot.bottom,height:innerHeight};});
 expect(geometry.rail).toBeGreaterThanOrEqual(40);expect(Math.abs(geometry.searchBottom-geometry.railTop)).toBeLessThan(2);expect(Math.abs(geometry.railBottom-geometry.bodyTop)).toBeLessThan(2);expect(Math.abs(geometry.bodyBottom-geometry.footTop)).toBeLessThan(2);expect(geometry.footBottom).toBeLessThanOrEqual(geometry.height+1);
 await page.locator('#picker-search-input').blur();await page.screenshot({path:`test-artifacts/picker-surfaces-${theme}.png`});
});

for(const theme of ['light','dark'])test(`move table uses readable themed surfaces ${theme}`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:theme});await floor(page);
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[{tableorder_value:'1',_id:'table-1',capacity:4},{tableorder_value:'2',_id:'table-2',capacity:4}]}}));
 await page.locator('[data-floor-move-order]').click();const modal=page.locator('#moveTableModal');await expect(modal).toHaveCSS('opacity','1');await expect(modal.locator('.move-table')).toHaveCount(2);
 for(const selector of ['.modal-title','#move-table-now','#move-table-status','#move-custom-use','.modal-footer [data-bs-dismiss]','#move-table-go','.move-table:not(:disabled) .move-table-no']){
 const value=await modal.locator(selector).first().evaluate(el=>{const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);let parent=el,bg;while(parent){const c=rgb(getComputedStyle(parent).backgroundColor);if(c.length===3||c[3]===1){bg=c;break;}parent=parent.parentElement;}const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const a=lum(rgb(getComputedStyle(el).color)),b=lum(bg||[255,255,255]);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);});expect(value,selector).toBeGreaterThanOrEqual(4.5);
 }
 await modal.locator('.move-table:not(:disabled)').last().click();await expect(page.locator('#move-table-go')).toBeEnabled();await page.screenshot({path:`test-artifacts/move-table-${theme}.png`});
});

for(const scenario of ['success','rejected','reduced'])test(`kitchen send flight follows confirmation ${scenario}`,async({page})=>{
 await page.emulateMedia({reducedMotion:scenario==='reduced'?'reduce':'no-preference'});await floor(page,{notes:true});
 await page.evaluate(()=>{window.flightCount=0;new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.classList?.contains('kitchen-send-flight'))window.flightCount++;}).observe(document.body,{childList:true});});
 if(scenario==='rejected')await page.route('**/sales/updateOrder',r=>r.fulfill({status:500,json:{message:'Kitchen unavailable'}}));
 await page.locator('[data-floor-order-note]').click();await page.locator('#editor-preparation-note').fill('Pack separately');await page.locator('#save-order-changes').click();
 if(scenario==='rejected')await expect(page.locator('#save-order-changes')).toBeEnabled();else await expect(page.locator('#editOrderModal')).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>window.flightCount)).toBe(scenario==='success'?1:0);await expect(page.locator('.kitchen-send-flight')).toHaveCount(0);
});

for(const theme of ['light','dark'])test(`confirmed queued order kitchen flight ${theme}`,async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await floor(page);
 await page.evaluate(theme=>{
  window.CaptainAppearance.set(theme);
  window.dispatchEvent(new Event('posnic:orders-sent'));
  document.querySelectorAll('.kitchen-send-flight svg').forEach(el=>el.getAnimations().forEach(a=>{a.pause();a.currentTime=1000;}));
 },theme);
 await expect(page.locator('.kitchen-send-flight')).toBeVisible();
 const overlay=await page.locator('.kitchen-send-flight').boundingBox();expect(overlay.width).toBe(page.viewportSize().width);expect(overlay.height).toBe(page.viewportSize().height);
 expect(await page.locator('.kitchen-flight-plane').evaluate(el=>el.getAnimations()[0].effect.getTiming().duration)).toBe(2000);
 expect(await page.locator('.kitchen-send-flight').evaluate(el=>getComputedStyle(el).pointerEvents)).toBe('none');
 await page.screenshot({path:`test-artifacts/kitchen-flight-${theme}.png`});
 await expect(page.locator('.kitchen-send-flight')).toHaveCount(0);
});

for(const occupied of [6,7,10])test(`cheerful kitchen chef threshold ${occupied} of ten`,async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});await floor(page);
 await page.evaluate(occupied=>{window.CaptainFloorOccupancy=()=>({total:10,occupied});window.CaptainKitchenFeedback.play();},occupied);
 await expect(page.locator('.kitchen-chef-runner')).toHaveCount(occupied>=7?1:0);
 await expect(page.locator('.kitchen-flight-plane')).toHaveCount(occupied>=7?0:1);
 if(occupied===7){await page.evaluate(()=>document.querySelector('.kitchen-send-flight').getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=1000;}));await page.screenshot({path:'test-artifacts/kitchen-chef-busy.png'});}
 await expect(page.locator('.kitchen-send-flight')).toHaveCount(0);
});

test('chef occupancy uses all configured tables independently of floor filter',async({page})=>{
 await floor(page);
 const rows=Array.from({length:10},(_,i)=>({tableorder_value:String(i+1),status:i<7?'occupied':i===7?'held':i===8?'cleaning':'available'}));
 await page.route('**/captain/v1/tables',r=>r.fulfill({json:{tables:[...rows,rows[0]],cleaningEnabled:true}}));
 await page.reload();
 await expect.poll(()=>page.evaluate(()=>window.CaptainFloorOccupancy?.())).toEqual({total:10,occupied:7});
 await page.locator('[data-floor-filter="all"]').click();
 expect(await page.evaluate(()=>window.CaptainFloorOccupancy())).toEqual({total:10,occupied:7});
});

for(const theme of ['light','dark'])test(`order shows saved bill tax components ${theme}`,async({page})=>{
 await floor(page);
 await page.route('**/captain/v1/bill?*',r=>r.fulfill({json:{orderIds:['order-1'],currency:'₹',currencyDigits:2,totalMinor:42000,labels:{base:'Subtotal',discount:'Discount','tax:CGST':'CGST 2.5%','tax:SGST':'SGST 2.5%'},lines:[{components:[{key:'base',minor:41000},{key:'discount',minor:-1000},{key:'tax:CGST',minor:1000},{key:'tax:SGST',minor:1000}]}]}}));
 await page.reload();await page.evaluate(theme=>window.CaptainAppearance.set(theme),theme);await page.locator('.floor-card').first().click();
 const totals=page.locator('.order-tax-breakdown');await expect(totals).toContainText('CGST 2.5%');await expect(totals).toContainText('SGST 2.5%');await expect(totals).toContainText('410.00');await expect(totals).toContainText('₹-10.00');await expect(totals.locator('.order-tax-total')).toContainText('420.00');
 await totals.scrollIntoViewIfNeeded();await page.screenshot({path:`test-artifacts/order-tax-${theme}.png`});
});
test('order bill totals retry does not invent missing taxes',async({page})=>{
 await floor(page);let fail=true;
 await page.route('**/captain/v1/bill?*',r=>fail?r.fulfill({status:500,json:{message:'Unavailable'}}):r.fulfill({json:{orderIds:['order-1'],currency:'₹',totalMinor:44000,labels:{base:'Subtotal'},lines:[{components:[{key:'base',minor:44000}]}]}}));
 await page.reload();await page.locator('.floor-card').first().click();await expect(page.locator('.order-tax-status')).toContainText('Could not load the bill.');await expect(page.locator('.order-tax-breakdown')).toHaveCount(0);
 fail=false;await page.locator('.order-tax-status button').click();await expect(page.locator('.order-tax-breakdown')).toContainText('Tax');await expect(page.locator('.order-tax-breakdown')).toContainText('₹0.00');
});

test('inline order totals reject incomplete financial components',async({page})=>{
 await floor(page);
 await page.route('**/captain/v1/bill?*',r=>r.fulfill({json:{orderIds:['order-1'],totalMinor:44000,lines:[{components:[{key:'base',minor:43000}]}]}}));
 await page.reload();await page.locator('.floor-card').first().click();await expect(page.locator('.order-tax-status')).toContainText('Could not load the bill.');await expect(page.locator('.order-tax-breakdown')).toHaveCount(0);
});
test('inline order totals ignore response for a detached order view',async({page})=>{
 await floor(page);let release;const held=new Promise(resolve=>release=resolve);let requested=false;
 await page.route('**/captain/v1/bill?*',async r=>{requested=true;await held;await r.fulfill({json:{orderIds:['order-1'],totalMinor:44000,lines:[{components:[{key:'base',minor:44000}]}],labels:{base:'Subtotal'}}});});
 await page.reload();await page.locator('.floor-card').first().click();await expect.poll(()=>requested).toBe(true);
 await page.evaluate(()=>{window.detachedTotals=document.querySelector('[data-order-totals]');window.detachedTotals.remove();});release();
 await page.waitForTimeout(200);
 expect(await page.evaluate(()=>window.detachedTotals.querySelector('.order-tax-breakdown'))).toBeNull();
});

for(const enabled of [true,false])test(`collect payment stays discoverable when enabled ${enabled}`,async({page})=>{
 await floor(page);
 await page.route('**/captain/v1/payment-options',r=>r.fulfill({json:{enabled}}));
 await page.route('**/captain/v1/payments/table',r=>enabled?r.fulfill({json:{id:'test-plan',enabled:true,totalMinor:44000,dueMinor:44000,paidMinor:0,currency:'₹',methods:['Cash','Card','Upi'],guests:[],payments:[]}}):r.fulfill({status:403,json:{message:'Disabled'}}));
 await page.reload();await page.locator('.floor-card').first().click();await expect(page.locator('[data-collect-table]')).toBeVisible();await page.locator('[data-collect-table]').click();
 const dialog=page.locator('#captain-payments');await expect(dialog).toBeVisible();
 if(enabled){await expect(dialog.locator('[data-method="Cash"]')).toBeVisible();await expect(dialog).toContainText('440.00');}
 else{await expect(dialog).toContainText('Payment collection is not enabled for this phone.');await expect(dialog.locator('a[href="payment-settings.html"]')).toBeVisible();await expect(dialog.locator('[data-method]')).toHaveCount(0);}
});
test('dine-in inline bill uses table endpoint and validates order identity',async({page})=>{
 await floor(page);let query;
 await page.route('**/captain/v1/bill?*',r=>{query=new URL(r.request().url()).searchParams;return query.get('table')==='1'?r.fulfill({json:{orderIds:['order-1'],totalMinor:44000,labels:{base:'Subtotal'},lines:[{components:[{key:'base',minor:44000}]}]}}):r.fulfill({status:404,json:{message:'Open order not found.'}});});
 await page.reload();await page.locator('.floor-card').first().click();await expect(page.locator('.order-tax-breakdown')).toBeVisible();expect(query.get('table')).toBe('1');
});

test('inline bill isolates one order from a shared table bill',async({page})=>{
 await floor(page);
 await page.route('**/captain/v1/bill?*',r=>r.fulfill({json:{orderIds:['order-1','other'],currency:'₹',totalMinor:54000,labels:{base:'Subtotal'},lines:[{id:'order-1:0',amountMinor:44000,components:[{key:'base',minor:44000}]},{id:'other:0',amountMinor:10000,components:[{key:'base',minor:10000}]}]}}));
 await page.reload();await page.locator('.floor-card').first().click();await expect(page.locator('.order-tax-total')).toContainText('440.00');await expect(page.locator('.order-tax-breakdown')).not.toContainText('540.00');
});

for (const scenario of ['busy', 'quiet', 'unavailable', 'locked']) test(`kitchen animation outside floor ${scenario}`, async ({page}) => {
 await page.emulateMedia({reducedMotion:'no-preference'});await floor(page);
 await page.route('**/captain/v1/tables',async route=>{
  if(scenario==='unavailable')return route.fulfill({status:503,json:{}});
  if(scenario==='locked')await new Promise(resolve=>setTimeout(resolve,150));
  return route.fulfill({json:{tables:Array.from({length:10},(_,i)=>({tableorder_value:String(i+1),status:i<(scenario==='quiet'?6:9)?'occupied':'available'}))}});
 });
 await page.evaluate(scenario=>{
  delete window.CaptainFloorOccupancy;
  window.CaptainKitchenFeedback.play();
  if(scenario==='locked')window.CaptainAccess={locked:true};
 },scenario);
 if(scenario==='locked'){
  await page.waitForTimeout(600);await expect(page.locator('.kitchen-send-flight')).toHaveCount(0);
 }else{
  await expect(page.locator('.kitchen-send-flight')).toBeVisible();
  await expect(page.locator('.kitchen-chef-runner')).toHaveCount(scenario==='busy'?1:0);
  await expect(page.locator('.kitchen-flight-plane')).toHaveCount(scenario==='busy'?0:1);
 }
});

test('floor cards show item quantities instead of ticket count',async({page})=>{
 await floor(page,{quantity:6});
 await expect(page.locator('.floor-card .floor-meta').first()).toHaveText('12 items');
});

for(const failed of [false,true])test(`floor payable total includes authoritative bill tax ${failed}`,async({page})=>{
 await floor(page,{quantity:6});
 await page.route('**/captain/v1/bill?*',r=>failed?r.fulfill({status:503,json:{}}):r.fulfill({json:{totalMinor:46200,currency:'INR',currencyDecimals:2,paidMinor:10000,dueMinor:36200}}));
 await page.reload();
 await expect(page.locator('.floor-card .floor-meta').first()).toHaveText(failed?'12 items':'12 items · ₹462.00');
});

for(const theme of ['light','dark'])test(`many picker categories remain one scrolling row ${theme}`,async({page})=>{
 await page.setViewportSize({width:390,height:740});await page.emulateMedia({colorScheme:theme});await floor(page);
 await page.locator('.order-sheet [data-order-add]').click();
 const rail=page.locator('#item-picker-rail');await expect(rail).toBeVisible();
 await rail.evaluate(el=>{el.innerHTML=MenuView.rail(['Menu','Veg Starters','Drinks','Batteries & Electricals','Non-Veg Curry','Writing','Gifts','Non-Veg Starters','Veg Curry','Hair & Body Care','Fast Food','Soup & Salad','Dosa & Idli','Desserts','Indian Breads','Rice & Biryani','Noodles','Hygiene'].map((name,i)=>({key:'cat-'+i,name})),{});});
 const dimensions=await rail.evaluate(el=>({height:el.getBoundingClientRect().height,tops:[...el.children].map(c=>c.getBoundingClientRect().top),width:el.clientWidth,scroll:el.scrollWidth}));
 expect(dimensions.height).toBeLessThan(70);expect(new Set(dimensions.tops).size).toBe(1);expect(dimensions.scroll).toBeGreaterThan(dimensions.width);
 await rail.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
 await expect(rail.locator('button').last()).toBeInViewport();
 await rail.evaluate(el=>{el.scrollLeft=0;});
 await page.screenshot({path:`test-artifacts/picker-single-rail-${theme}.png`});
});

for(const theme of ['light','dark'])test(`picker Menu opens category index and jumps ${theme}`,async({page})=>{
 await page.emulateMedia({colorScheme:theme});await floor(page);await page.locator('[data-order-add]').click();
 await page.evaluate(()=>{pickerMenu=Array.from({length:12},(_,i)=>({key:'test'+i,name:'Category '+(i+1),items:[{...pickerMenu[0].items[0],id:'item'+i}]}));drawPicker();});
 await page.locator('#picker-index-btn').click();
 await expect(page.locator('#picker-index')).toBeVisible();
 await expect(page.locator('#picker-index .menu-index-row')).toHaveCount(12);
 const uncovered=await page.locator('#picker-index .ui-sheet-head').evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));});
 expect(uncovered).toBe(true);
 await page.screenshot({path:`test-artifacts/picker-menu-open-${theme}.png`});
 await page.locator('#picker-index .menu-index-row').last().click();
 await expect(page.locator('#picker-index')).toBeHidden();
 await expect(page.locator('#sec-test11')).toBeInViewport();
});

for(const width of [390,820])for(const theme of ['light','dark'])test(`Menu index keyboard and safe names ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:theme});await floor(page);await page.locator('[data-order-add]').click();
 await page.evaluate(()=>{pickerMenu=Array.from({length:18},(_,i)=>({key:'test'+i,name:i===0?'<b>Special & Soup</b>':'Category '+(i+1),items:[{...pickerMenu[0].items[0],id:'item'+i}]}));drawPicker();});
 await page.locator('#picker-index-btn').click();
 const close=page.locator('#picker-index-close'),last=page.locator('#picker-index .menu-index-row').last();
 await expect(close).toBeFocused();await expect(page.locator('#picker-index .menu-index-name').first()).toHaveText('<b>Special & Soup</b>');await expect(page.locator('#picker-index .menu-index-name b')).toHaveCount(0);
 await page.keyboard.press('Shift+Tab');await expect(last).toBeFocused();await page.keyboard.press('Tab');await expect(close).toBeFocused();
 await page.screenshot({path:`test-artifacts/menu-access-${width}-${theme}.png`});
 await page.keyboard.press('Escape');await expect(page.locator('#picker-index')).toBeHidden();await expect(page.locator('#item-picker')).toBeVisible();await expect(page.locator('#picker-index-btn')).toBeFocused();
 await page.locator('#picker-index-btn').click();await page.evaluate(()=>window.dispatchEvent(new Event('captain:back',{cancelable:true})));await expect(page.locator('#picker-index')).toBeHidden();await expect(page.locator('#item-picker')).toBeVisible();
});

for(const [variant,random] of [['hat',.1],['steam',.5],['stir',.9]])for(const theme of ['light','dark'])test(`chef loading ${variant} ${theme}`,async({page})=>{
 await page.addInitScript(value=>{Math.random=()=>value;},random);
 await page.emulateMedia({colorScheme:theme,reducedMotion:'no-preference'});await floor(page);
 await page.evaluate(()=>{document.getElementById('loader').style.display='flex';});
 const art=page.locator('#loader .chef-loading-art');await expect(art).toHaveClass('chef-loading-art chef-loading-'+variant);await expect(art).toBeVisible();
 await expect(page.locator('#loader .spinner-border')).toHaveCSS('animation-name','none');
 await expect(art).toHaveCSS('opacity','1');
 await page.screenshot({path:`test-artifacts/chef-loading-${variant}-${theme}.png`});
 await page.evaluate(()=>{document.getElementById('loader').style.display='none';});await expect(art).not.toBeVisible();
});

test('chef loaders decorate new loading states once and respect reduced motion',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await floor(page);
 await page.evaluate(()=>{document.getElementById('tables-list').innerHTML='<div class="floor-loading" role="status">Loading orders…</div>';});
 const art=page.locator('.floor-loading .chef-loading-art');await expect(art).toHaveCount(1);
 expect(await art.evaluate(el=>[el,...el.querySelectorAll('*')].every(node=>getComputedStyle(node).animationName==='none'))).toBe(true);
 await page.evaluate(()=>{document.querySelector('.floor-loading').append(document.createElement('span'));});await expect(art).toHaveCount(1);
});

test('order heading uses offline translations in every supported language',async({page})=>{
 await floor(page,{rounds:true});
 const manifest=JSON.parse(fs.readFileSync('assets/common/locales/manifest.json','utf8'));
 for(const {code} of manifest){
  const words=JSON.parse(fs.readFileSync(`assets/common/locales/${code}.json`,'utf8'));
  await page.evaluate(code=>I18N.use(code),code);
  await expect(page.locator('.order-items-heading h2')).toHaveText(words['Order items']);
  const labels=await page.evaluate(()=>['Cancel item','Remove item','Item note','Save note','Payment settings','Serve all','Custom table'].map(key=>I18N.t(key)));
  expect(labels).toEqual(['Cancel item','Remove item','Item note','Save note','Payment settings','Serve all','Custom table'].map(key=>words[key]));
 }
});
