const assert = require('assert');
process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 = Buffer.from('{}').toString('base64');
const { parseDateRange } = require('../index');

const cases = [
  ['august 10th through the 12th', ['august 10', 'august 12']],
  ['august 10 to august 12', ['august 10', 'august 12']],
  ['from august 10th until the 12th', ['august 10', 'august 12']],
  ['august 10', ['august 10']],
  ['july 30th through august first', ['july 30', 'august 1']],
];

for (const [input, expected] of cases) {
  const result = parseDateRange(input);
  assert.deepStrictEqual(result, expected, `${input} -> ${JSON.stringify(result)}`);
}
console.log('parseDateRange tests passed');
