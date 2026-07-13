import type { PackageDraft,PackageSnapshot } from './packageTypes'
export interface PackageDataSource { loadSnapshot():Promise<PackageSnapshot>; savePackage(draft:PackageDraft,idempotencyKey:string):Promise<void> }
