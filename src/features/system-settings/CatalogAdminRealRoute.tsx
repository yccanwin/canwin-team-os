import { supabase } from '../../lib/supabase'
import { CatalogAdminPage } from './CatalogAdminPage'
import { createCatalogSupabaseDataSource } from './catalogSupabaseDataSource'

const dataSource = createCatalogSupabaseDataSource(supabase)

export default function CatalogAdminRealRoute() {
  return <CatalogAdminPage dataSource={dataSource} />
}
