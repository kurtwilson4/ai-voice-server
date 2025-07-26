const assert = require('assert');
process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 = Buffer.from('{}').toString('base64');
const { parseSpokenName } = require('../index');

const cases = [
  ['bee', 'B'],
  ['kay', 'K'],
  ['k a y', 'K'],
  ['bee cee', 'Bc'],
  ['why', 'Y'],
  ['the name is carrigan c-a-r-r-i-g-a-n', 'Carrigan'],
  ['double you', 'W'],
  ['double u', 'W'],

];

for (const [input, expected] of cases) {
  const result = parseSpokenName(input);
  assert.strictEqual(result, expected, `${input} -> ${result}`);
}
console.log('parseSpokenName tests passed');
