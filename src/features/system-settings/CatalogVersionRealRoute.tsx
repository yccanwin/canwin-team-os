import { supabase } from '../../lib/supabase'
import { CatalogVersionPage } from './CatalogVersionPage'
import { createCatalogVersionSupabaseDataSource } from './catalogVersionSupabaseDataSource'
const dataSource = createCatalogVersionSupabaseDataSource(supabase)
export default function CatalogVersionRealRoute() { return <CatalogVersionPage dataSource={dataSource} /> }
