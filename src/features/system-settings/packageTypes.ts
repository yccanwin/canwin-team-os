export interface PackageItemOption { id:string; sku:string; name:string; itemType:'software'|'hardware'|'service'; listPrice:number }
export interface PackageLine { catalogItemId:string; quantity:number }
export interface PackageView { id:string; code:string; name:string; businessType:string; isActive:boolean; lines:PackageLine[] }
export interface PackageSnapshot { draftVersionId:string|null; draftVersionNo:number|null; items:PackageItemOption[]; packages:PackageView[] }
export interface PackageDraft extends Omit<PackageView,'id'> { id?:string }
