// SELECT-only catalog; the public RPC set has no model/BOM listing function.
export function createManagementCatalog(client) {
  async function pages(table, columns, filter) {
    const rows=[];
    for(let offset=0;;offset+=100){
      let query=client.from(table).select(columns).order('id').range(offset,offset+99);
      if(filter)query=query.eq(...filter);
      const {data,error}=await query;if(error)throw error;
      if(!Array.isArray(data))throw new Error('Invalid catalog response');
      rows.push(...data);if(data.length<100)return rows;
    }
  }
  return {listModels:()=>pages('models','id,name,category,is_active'),
    loadBom:id=>pages('model_bom','id,material_id,qty',['model_id',id])};
}
