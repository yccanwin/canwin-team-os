import { supabase } from '../../lib/supabase'
import { RegionAdminPage } from './RegionAdminPage'
import { createRegionSupabaseDataSource } from './regionSupabaseDataSource'

const dataSource = createRegionSupabaseDataSource(supabase)

export default function RegionAdminRealRoute() {
  return <RegionAdminPage dataSource={dataSource} />
}
