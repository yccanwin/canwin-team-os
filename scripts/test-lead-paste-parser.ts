import assert from 'node:assert/strict'
import { parseLeadPaste } from '../src/utils/leadPasteParser.ts'

const cases = [
  {
    input: '教场新开的狗肉馆，联系人王老板，15851057688，六合区雄州街道，月底开业，想了解收银和后厨打印。',
    expected: { customerName: '教场新开的狗肉馆', contactName: '王老板', phone: '15851057688', regionText: '六合区' },
  },
  {
    input: '客户名称：老街面馆\n联系人：李经理\n联系电话：13912345678\n所在区域：盐都区\n详细地址：盐都区潘黄街道88号\n需求：月底开业',
    expected: { customerName: '老街面馆', contactName: '李经理', phone: '13912345678', regionText: '盐都区', address: '盐都区潘黄街道88号', notes: '月底开业' },
  },
  {
    input: '星河餐厅\t张店长\t13700001111\t亭湖区\t亭湖区青年路20号\t竞品年底到期',
    expected: { customerName: '星河餐厅', contactName: '张店长', phone: '13700001111', regionText: '亭湖区', address: '亭湖区青年路20号', notes: '竞品年底到期' },
  },
  { input: '海棠火锅，刘老板，13611112222，建湖县近湖街道', expected: { customerName: '海棠火锅', contactName: '刘老板', phone: '13611112222', regionText: '建湖县' } },
  { input: '门店：小城故事饭店\n手机：+86 13512345678\n区域：东台市', expected: { customerName: '小城故事饭店', phone: '13512345678', regionText: '东台市' } },
  { input: '商户名称: 云朵烘焙\n负责人: 陈店长\n电话: 138-1234-5678', expected: { customerName: '云朵烘焙', contactName: '陈店长', phone: '13812345678' } },
  { input: '联系电话：13800000000，另有微信同号', expected: { phone: '13800000000' } },
  { input: '地址：江苏省盐城市大丰区人民路9号\n备注：老店换系统', expected: { address: '江苏省盐城市大丰区人民路9号', notes: '老店换系统' } },
  { input: '店名：一碗香\n区县：射阳县\n联系人：周总', expected: { customerName: '一碗香', regionText: '射阳县', contactName: '周总' } },
  { input: '线索标题：新港咖啡\n联系方式：13499998888\n情况：朋友介绍', expected: { customerName: '新港咖啡', phone: '13499998888', notes: '朋友介绍' } },
  { input: '只有一些无法判断归属的描述', expected: { phone: '', regionText: '', address: '' } },
  {
    input: '老王火锅店 盐城市亭湖区人民路88号 王老板 13812345678 亭湖区',
    expected: { customerName: '老王火锅店', address: '盐城市亭湖区人民路88号', contactName: '王老板', phone: '13812345678', regionText: '亭湖区', notes: '' },
  },
  {
    input: '海风餐厅   大丰区幸福东路8号   李经理   13912345678   大丰区',
    expected: { customerName: '海风餐厅', address: '大丰区幸福东路8号', contactName: '李经理', phone: '13912345678', regionText: '大丰区' },
  },
  {
    input: '云端咖啡　盐都区世纪大道18号　周店长　13700001111　盐都区',
    expected: { customerName: '云端咖啡', address: '盐都区世纪大道18号', contactName: '周店长', phone: '13700001111', regionText: '盐都区' },
  },
  {
    input: '星光酒楼\t建湖县湖中南路99号\t陈老板\t13611112222\t建湖县',
    expected: { customerName: '星光酒楼', address: '建湖县湖中南路99号', contactName: '陈老板', phone: '13611112222', regionText: '建湖县' },
  },
  {
    input: '一品烧烤 盐城市 亭湖区 青年路 20号 赵老板 13512345678 亭湖区',
    expected: { customerName: '一品烧烤', address: '盐城市 亭湖区 青年路 20号', contactName: '赵老板', phone: '13512345678', regionText: '亭湖区' },
  },
  {
    input: '小城故事（盐城店） 射阳县幸福大道6号 孙经理 13499998888 射阳县',
    expected: { customerName: '小城故事（盐城店）', address: '射阳县幸福大道6号', contactName: '孙经理', phone: '13499998888', regionText: '射阳县' },
  },
  {
    input: '湖畔餐厅 东台市海陵路3号 吴店长 138-1234-5678 东台市',
    expected: { customerName: '湖畔餐厅', address: '东台市海陵路3号', contactName: '吴店长', phone: '13812345678', regionText: '东台市' },
  },
  {
    input: '新桥饭店 响水县黄海路18号 15851057688 响水县',
    expected: { phone: '15851057688', contactName: '' },
  },
  {
    input: '田园食堂\n阜宁县香港路 12号\t钱老板 133 1234 5678　阜宁县',
    expected: { customerName: '田园食堂', address: '阜宁县香港路 12号', contactName: '钱老板', phone: '13312345678', regionText: '阜宁县' },
  },
]

for (const [index, testCase] of cases.entries()) {
  const actual = parseLeadPaste(testCase.input)
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.equal(actual[key as keyof typeof actual], value, `case ${index + 1}: ${key}`)
  }
  const recognized = [actual.customerName, actual.contactName, actual.phone, actual.regionText, actual.address].filter(Boolean)
  for (const value of recognized) assert.ok(!actual.notes.includes(value), `case ${index + 1}: notes duplicated ${value}`)
  assert.equal(actual.rawText, testCase.input.trim())
}

for (const empty of ['', '   ', null, undefined, 123]) {
  const result = parseLeadPaste(empty)
  assert.equal(result.customerName, '')
  assert.equal(result.rawText, '')
}

console.log(`lead paste parser: ${cases.length + 5} cases passed`)
