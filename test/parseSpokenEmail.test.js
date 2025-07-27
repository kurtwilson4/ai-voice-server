const assert = require('assert');
process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 = Buffer.from('{}').toString('base64');
const { parseSpokenEmail } = require('../index');

const cases = [
  ['john dot doe at gmail dot com', 'john.doe@gmail.com'],
  ['jane at example dot com', 'jane@example.com'],
  ['double you at test dot com', 'w@test.com'],
  ['double u at example dot com', 'w@example.com'],
  ['kurt wayne wilson at gmail dot com', 'kurtwaynewilson@gmail.com'],
];

for (const [input, expected] of cases) {
  const result = parseSpokenEmail(input);
  assert.strictEqual(result, expected, `${input} -> ${result}`);
}
console.log('parseSpokenEmail tests passed');
