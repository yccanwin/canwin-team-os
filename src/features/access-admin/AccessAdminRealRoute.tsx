import { supabase } from '@/lib/supabase'
import { AccessAdminEditor } from './AccessAdminEditor'
import { createSupabaseAccessAdminDataSource } from './supabaseDataSource'

const dataSource = createSupabaseAccessAdminDataSource(supabase)
export default function AccessAdminRealRoute() { return <AccessAdminEditor dataSource={dataSource} /> }
