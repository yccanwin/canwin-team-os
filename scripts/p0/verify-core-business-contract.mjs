import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const contractPath = resolve(repoRoot, 'scripts', 'p0', 'core-business-contract.json')
const checks = []
const check = (label, result) => checks.push([label, Boolean(result)])
const exactSet = (value, expected) =>
  Array.isArray(value) && value.length === new Set(value).size &&
  JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort())
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (label, value, expected) => {
  check(label + ' is an object', isObject(value))
  if (!isObject(value)) return
  check(
    label + ' has exact fields',
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()),
  )
}

let contract
try {
  contract = JSON.parse(readFileSync(contractPath, 'utf8'))
} catch (error) {
  console.error('[p0:core-business] cannot read contract: ' + error.message)
  process.exit(1)
}

exactKeys('root', contract, [
  'schemaVersion', 'manifestType', 'status', 'deployment', 'identity', 'customerHierarchy',
  'productAndOrder', 'paymentAndEarnings', 'inventoryAndFulfillment', 'workItems', 'cases',
  'dataProtection',
])
exactKeys('status', contract.status, ['businessSemantics', 'physicalTableNames', 'physicalEnumNames'])
exactKeys('deployment', contract.deployment, ['companyCount', 'multiTenantSwitching'])
exactKeys('identity', contract.identity, [
  'primaryRoles', 'additionalFunctions', 'onePrimaryRolePerActiveMember', 'fallbackApprover',
])
exactKeys('customerHierarchy', contract.customerHierarchy, [
  'levels', 'contractingEntity', 'fulfillmentUnit', 'contactStoreRelationship',
  'maximumPrimaryStoreRelationshipsPerContact',
])
exactKeys('productAndOrder', contract.productAndOrder, [
  'priceFacts', 'quoteReservesInventory', 'formalOrderFreezesSnapshot', 'snapshotFacts',
  'orderLineAllocationGrain', 'allocationQuantityMustEqualOrderLineQuantity',
  'fulfillmentGrain', 'renewalGrain', 'caseCandidateGrain',
])
exactKeys('paymentAndEarnings', contract.paymentAndEarnings, [
  'mixedPaymentFacts', 'confirmedRecordsAppendOnly', 'correctionMethod',
  'profitSettleConditions', 'salesProfitAndLaborEarningsSeparate',
  'acceptedLaborEarningsAutoReclaimedByCustomerRefund', 'performanceAndPointsSource',
])
exactKeys('inventoryAndFulfillment', contract.inventoryAndFulfillment, [
  'internalPaymentRequiredBeforeFulfillment', 'allowExtraSku', 'allowOverIssue',
  'allowNegativeInventory', 'cancelUnshippedOrderReleasesReservation', 'shippedOrderCorrection',
])
exactKeys('workItems', contract.workItems, [
  'singleSourceFor', 'uniqueGenerationKeyRequired', 'genericReminderCanUseGenericComplete',
  'businessActionCanUseGenericComplete', 'businessActionClosure',
])
exactKeys('cases', contract.cases, [
  'autoPublish', 'customerDisplayAuthorizationRequired', 'administratorReviewRequired',
  'publicReadsInternalTables', 'publicProjectionDesensitized', 'allowedImageSlots',
  'revokeAuthorizationRemovesPublicProjection',
])
exactKeys('dataProtection', contract.dataProtection, [
  'legacyPagesRequiredOnline', 'legacyDataDeletionAuthorized',
  'historicalDataAndAttachmentsRecoverable', 'productionAndTestMayShareOneFrontendBuild',
  'testDataMayWriteBackProduction',
])

check('schema version is supported', contract.schemaVersion === 1)
check('manifest type is correct', contract.manifestType === 'canwin-team-os-core-business')
check('business semantics are frozen', contract.status?.businessSemantics === 'frozen')
check(
  'existing and additive table names are P0 supervisor frozen',
  contract.status?.physicalTableNames === 'p0-supervisor-frozen',
)
check('physical dictionary names are P0 supervisor frozen', contract.status?.physicalEnumNames === 'p0-supervisor-frozen')
check('deployment is single-company', contract.deployment?.companyCount === 1 && contract.deployment?.multiTenantSwitching === false)
check('five primary roles are exact', exactSet(contract.identity?.primaryRoles, [
  'sales', 'implementation', 'operations', 'finance', 'admin',
]))
check('additional functions are exact', exactSet(contract.identity?.additionalFunctions, ['warehouse', 'supervisor']))
check('one primary role is mandatory', contract.identity?.onePrimaryRolePerActiveMember === true)
check('admin is fallback approver', contract.identity?.fallbackApprover === 'admin')
check('customer hierarchy is exact', JSON.stringify(contract.customerHierarchy?.levels) === JSON.stringify([
  'settlement_customer', 'brand', 'store',
]))
check('settlement customer is contracting entity', contract.customerHierarchy?.contractingEntity === 'settlement_customer')
check('store is fulfillment unit', contract.customerHierarchy?.fulfillmentUnit === 'store')
check('contacts can relate to multiple stores', contract.customerHierarchy?.contactStoreRelationship === 'many-to-many')
check('contact has at most one primary store relationship', contract.customerHierarchy?.maximumPrimaryStoreRelationshipsPerContact === 1)
check('three price facts are separate', exactSet(contract.productAndOrder?.priceFacts, [
  'customer_sale_price', 'sales_internal_price', 'company_actual_cost',
]))
check('quote never reserves inventory', contract.productAndOrder?.quoteReservesInventory === false)
check('formal order freezes a snapshot', contract.productAndOrder?.formalOrderFreezesSnapshot === true)
check('order snapshot facts are complete', exactSet(contract.productAndOrder?.snapshotFacts, [
  'product', 'quantity', 'price', 'points', 'profit_rule', 'labor_earning_rule',
]))
check('allocation grain is order line by store', contract.productAndOrder?.orderLineAllocationGrain === 'order_line-by-store')
check('allocated quantity is conserved', contract.productAndOrder?.allocationQuantityMustEqualOrderLineQuantity === true)
check('fulfillment grain is store by order line', contract.productAndOrder?.fulfillmentGrain === 'store-by-order_line')
check('renewal grain is store by product subscription', contract.productAndOrder?.renewalGrain === 'store-by-product_subscription')
check('case candidate grain is store fulfillment', contract.productAndOrder?.caseCandidateGrain === 'store-fulfillment')
check('mixed-payment facts are complete', exactSet(contract.paymentAndEarnings?.mixedPaymentFacts, [
  'company_held', 'sales_held', 'sales_top_up', 'sales_payable', 'company_payable', 'company_subsidy',
]))
check('confirmed finance records are append-only', contract.paymentAndEarnings?.confirmedRecordsAppendOnly === true)
check('finance correction uses reversal or adjustment', contract.paymentAndEarnings?.correctionMethod === 'reversal-or-adjustment')
check('profit settlement requires both gates', exactSet(contract.paymentAndEarnings?.profitSettleConditions, [
  'customer_payment_complete', 'internal_coverage_balance_zero',
]))
check('sales profit and labor earnings are separate', contract.paymentAndEarnings?.salesProfitAndLaborEarningsSeparate === true)
check('accepted labor earnings are not auto-reclaimed', contract.paymentAndEarnings?.acceptedLaborEarningsAutoReclaimedByCustomerRefund === false)
check('performance and points use frozen order snapshots', contract.paymentAndEarnings?.performanceAndPointsSource === 'frozen-order-snapshot')
check('internal payment is required before fulfillment', contract.inventoryAndFulfillment?.internalPaymentRequiredBeforeFulfillment === true)
check('extra SKU is forbidden', contract.inventoryAndFulfillment?.allowExtraSku === false)
check('over-issue is forbidden', contract.inventoryAndFulfillment?.allowOverIssue === false)
check('negative inventory is forbidden', contract.inventoryAndFulfillment?.allowNegativeInventory === false)
check('unshipped cancellation releases reservation', contract.inventoryAndFulfillment?.cancelUnshippedOrderReleasesReservation === true)
check('shipped orders correct by return or reversal', contract.inventoryAndFulfillment?.shippedOrderCorrection === 'return-or-reversal')
check('three work views share one source', exactSet(contract.workItems?.singleSourceFor, [
  'workbench', 'progress_center', 'calendar',
]))
check('work item generation is idempotent', contract.workItems?.uniqueGenerationKeyRequired === true)
check('generic reminders may complete generically', contract.workItems?.genericReminderCanUseGenericComplete === true)
check('business actions cannot complete generically', contract.workItems?.businessActionCanUseGenericComplete === false)
check('business actions close after server transaction', contract.workItems?.businessActionClosure === 'successful-server-transaction')
check('cases never auto-publish', contract.cases?.autoPublish === false)
check('case publication requires customer authorization', contract.cases?.customerDisplayAuthorizationRequired === true)
check('case publication also requires administrator review', contract.cases?.administratorReviewRequired === true)
check('public case API never reads internal tables directly', contract.cases?.publicReadsInternalTables === false)
check('public case projection is desensitized', contract.cases?.publicProjectionDesensitized === true)
check('only two image slots are allowed', exactSet(contract.cases?.allowedImageSlots, [
  'case.logo', 'case.miniprogram_code',
]))
check('revoked authorization removes public projection', contract.cases?.revokeAuthorizationRemovesPublicProjection === true)
check('legacy pages are not required online', contract.dataProtection?.legacyPagesRequiredOnline === false)
check('legacy data deletion is not authorized', contract.dataProtection?.legacyDataDeletionAuthorized === false)
check('historical data and attachments remain recoverable', contract.dataProtection?.historicalDataAndAttachmentsRecoverable === true)
check('production and test cannot share a build', contract.dataProtection?.productionAndTestMayShareOneFrontendBuild === false)
check('test data cannot write back to production', contract.dataProtection?.testDataMayWriteBackProduction === false)

let passed = 0
for (const [label, result] of checks) {
  if (result) passed += 1
  else console.error('[p0:core-business] FAIL ' + label)
}
console.log(
  '[p0:core-business] semantics=' + contract.status?.businessSemantics +
    ' physical_tables=' + contract.status?.physicalTableNames,
)
console.log(
  '[p0:core-business] summary discovered=' + checks.length +
    ' run=' + checks.length + ' passed=' + passed +
    ' failed=' + (checks.length - passed) + ' skipped=0',
)
if (passed !== checks.length) process.exit(1)
