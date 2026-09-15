// Development-only UI fixture provider. No tokens and no network writes.
const user = { id: 'pricing-audit-fixture', email: 'prueba@example.invalid' };
const now = Date.now();
const iso = (days: number) => new Date(now - days * 86400000).toISOString();
const products = Array.from({ length: 120 }, (_, i) => ({ id: `p${i}`, sku: `TEST${String(i).padStart(3,'0')}`, name: `Producto de prueba ${i} · nombre completo para revisar diseño`, category: ['Auriculares',' AURICULARES ','Tablets','Iluminación','iluminacion'][i % 5], status: 'active', cost_without_vat: 10000 + i * 100, vat_rate: 21, stock: 30 }));
const publications = Array.from({ length: 573 }, (_, i) => ({ id: `pub${i}`, product_id: products[i % 120].id, sku: products[i % 120].sku, active: true, meli_item_id: `MLA${2000000000+i}`, meli_title: products[i % 120].name, meli_status: 'active', meli_price: 25000, meli_stock: 12, fixed_fee_amount: 1000, shipping_cost_amount: 1500, meli_listing_type_id: 'gold_special', meli_installments_text: '1 pago', meli_last_sync_at: i % 3 ? iso(0) : iso(90), updated_at: iso(0), meli_promotions: i % 7 ? [{ endpoint: `/seller-promotions/items/MLA${2000000000+i}?app_version=v2`, data: [], checked_at: iso(0) }] : [] }));
const sales = Array.from({ length: 1200 }, (_, i) => ({ id: `sale${String(i).padStart(5,'0')}`, order_id: `order${i}`, product_id: products[i % 120].id, sku: products[i % 120].sku, title: products[i % 120].name, meli_item_id: publications[i % 573].meli_item_id, status: 'paid', order_date: iso(i % 60), updated_at: iso(0), quantity: 1 + i % 3, unit_price: 25000, total_amount: 25000 * (1+i%3), real_total_net_profit: i%11 ? 2000*(1+i%3) : null, real_net_sale_price: i%11 ? 25000/1.21 : null, normalized_total_net_profit: i%11 ? 2000*(1+i%3):null, normalized_net_sale_price: i%11 ? 20000/1.21:null, normalized_cost_for_profit: 10000, normalized_profit_error: i%11 ? null : 'Costo histórico no disponible' }));
const opportunities = Array.from({length:4921},(_,i)=>({id:`offer${String(i).padStart(5,'0')}`,meli_item_id:publications[i%573].meli_item_id,promotion_id:`P-${i}`,offer_id:`OFFER-${i}`,promotion_name:'Campaña con nombre compartido',promotion_type:'SMART',item_promotion_status:['started','candidate','finished','pending','unknown'][i%5],promo_price:22000,original_price:25000,meli_percentage:3,seller_percentage:9,meli_amount:750,seller_amount:2250,start_date:iso(i%5===3?-2:3),end_date:iso(i%5===2?1:-10),last_sync_at:iso(0)}));
const tables: Record<string, any[]> = { products, mercadolibre_shipping_costs: publications, mercadolibre_order_items: sales, mercadolibre_promotion_opportunities: opportunities, tax_settings:[{id:'tax',key:'default',iibb_rate:3,idc_rate:1,iigg_rate:0,structure_rate:0}], mercadolibre_installment_fees:[{id:'mc',code:'MC',name:'MercadoLibre 1 pago',active:true,channel_type:'mercadolibre',financing_fee_rate:0}], mercadolibre_category_fees:[{id:'cat',category:'Auriculares',active:true,marketplace_fee_rate:15}], product_channel_margins:[], mercadolibre_shipping_sync_logs:[], mercadolibre_b2b_margin_guard:[] };
let requests=0, bytes=0;
class Query {
  private filters: Array<(row:any)=>boolean>=[];
  private from=0; private to=999; private singleRow=false; private signal?:AbortSignal; private columns='*';
  constructor(private table:string) {}
  select(columns='*') {this.columns=columns;return this;}
  eq(column:string,value:unknown){this.filters.push(row=>row[column]===value);return this;}
  neq(column:string,value:unknown){this.filters.push(row=>row[column]!==value);return this;}
  gte(column:string,value:any){this.filters.push(row=>row[column]>=value);return this;}
  in(column:string,values:any[]){this.filters.push(row=>values.includes(row[column]));return this;}
  order(){return this;}
  range(from:number,to:number){this.from=from;this.to=to;return this;}
  limit(value:number){this.to=value-1;return this;}
  single(){this.singleRow=true;return this;}
  maybeSingle(){this.singleRow=true;return this;}
  abortSignal(signal:AbortSignal){this.signal=signal;return this;}
  async then(resolve:any,reject:any) {
    try {
      requests++;
      await new Promise<void>((done,fail)=>{const timer=setTimeout(done,250);this.signal?.addEventListener('abort',()=>{clearTimeout(timer);fail(new DOMException('Aborted','AbortError'));},{once:true});});
      this.signal?.throwIfAborted();
      const scenario=new URLSearchParams(window.location.search).get('fixture');
      if(scenario==='error' || (scenario==='partial' && this.from>0)) return resolve({data:null,error:{message:'Error simulado de lectura'},count:null});
      const all=scenario==='empty'?[]:(tables[this.table]||[]).filter(row=>this.filters.every(filter=>filter(row)));
      const rows=all.slice(this.from,this.to+1).map(row=>this.columns==='*'?row:Object.fromEntries(this.columns.split(',').filter(key=>key in row).map(key=>[key,row[key]])));
      bytes+=JSON.stringify(rows).length;
      window.dispatchEvent(new CustomEvent('pricing-fixture-metrics',{detail:{requests,bytes}}));
      return resolve({data:this.singleRow?rows[0]||null:rows,error:null,count:all.length});
    } catch(error) {return reject?.(error);}
  }
}
export const pricingFixtureClient = { auth:{ getSession:async()=>({data:{session:{user}}}),getUser:async()=>({data:{user}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null}) },from:(table:string)=>new Query(table) };
