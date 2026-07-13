import type { SupabaseClient } from '@supabase/supabase-js'
import type { PackageDataSource } from './packageDataSource'
import type { PackageSnapshot } from './packageTypes'
const explain=(prefix:string,error:{message:string;code?:string})=>error.code==='42501'||error.message.includes('ADMIN_REQUIRED')?'仅老板或管理员可以维护套餐':`${prefix}：${error.message}`
export function createPackageSupabaseDataSource(client:SupabaseClient):PackageDataSource{return{
 async loadSnapshot(){const{data,error}=await client.rpc('get_package_admin_snapshot');if(error)throw new Error(explain('读取套餐失败',error));return data as PackageSnapshot},
 async savePackage(draft,idempotencyKey){const{error}=await client.rpc('manage_draft_package',{p_package_id:draft.id??null,p_code:draft.code,p_name:draft.name,p_business_type:draft.businessType,p_is_active:draft.isActive,p_lines:draft.lines.map(line=>({catalog_item_id:line.catalogItemId,quantity:line.quantity})),p_idempotency_key:idempotencyKey});if(error)throw new Error(explain('保存套餐失败',error))}
}}
