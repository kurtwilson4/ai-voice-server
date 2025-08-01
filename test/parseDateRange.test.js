const assert = require('assert');
process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 = Buffer.from('{}').toString('base64');
const { parseDateRange } = require('../index');

const validCases = [
  ['august 10th through the 12th', ['august 10', 'august 12']],
  ['august 10 to august 12', ['august 10', 'august 12']],
  ['from august 10th until the 12th', ['august 10', 'august 12']],
  ['july 30th through august first', ['july 30', 'august 1']],
];

const invalidCases = ['august 10'];

for (const [input, expected] of validCases) {
  const result = parseDateRange(input);
  assert.deepStrictEqual(result, expected, `${input} -> ${JSON.stringify(result)}`);
}

for (const input of invalidCases) {
  const result = parseDateRange(input);
  assert.strictEqual(result, null, `${input} should be null but was ${JSON.stringify(result)}`);
}

console.log('parseDateRange tests passed');
